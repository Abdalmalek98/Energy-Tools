import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AesBox } from "@lsr/licensing";
import { hintText, ModelPage, SYSTEM_PROMPT } from "@lsr/shared";

/**
 * PERSONAL BUILD ONLY (LSR_PERSONAL=1). The owner's own PC reads pages straight from Groq with their own key:
 * no licence, no server. The key is stored encrypted on this PC (DPAPI on Windows). Never ship this build to customers:
 * a key inside a customer's PC can be extracted. The release gate refuses a bundle that contains this mode.
 */
export const DEFAULT_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const BASE = __E2E__ && process.env.LSR_GROQ_BASE ? process.env.LSR_GROQ_BASE : "https://api.groq.com/openai/v1";   // overridable in E2E builds only
interface Saved { apiKey?: string; model?: string }

const file = () => join(app.getPath("userData"), "personal-groq.dat");
const aes = () => new AesBox(`personal|${app.getPath("userData")}|${process.env.USERNAME ?? process.env.USER ?? ""}`);
function load(): Saved {
  try {
    if (!existsSync(file())) return {};
    const raw = readFileSync(file());
    if (!raw.length) return {};
    const text = process.platform === "win32" ? safeStorage.decryptString(raw) : aes().open(raw.toString("utf8"));
    return JSON.parse(text) as Saved;
  } catch { return {}; }
}
function save(s: Saved) {
  mkdirSync(dirname(file()), { recursive: true });
  const text = JSON.stringify(s);
  if (process.platform === "win32" && !safeStorage.isEncryptionAvailable()) throw new Error("Windows data protection (DPAPI) is not available, so the key cannot be stored securely on this PC.");
  const data = process.platform === "win32" ? safeStorage.encryptString(text) : Buffer.from(aes().seal(text), "utf8");
  const tmp = file() + ".tmp"; writeFileSync(tmp, data); renameSync(tmp, file());
}

/** The window may see whether a key is set and its last 4 characters, never the key. */
export function personalGet() {
  const s = load();
  return { configured: !!s.apiKey, keyHint: s.apiKey ? `…${s.apiKey.slice(-4)}` : null, model: s.model || DEFAULT_MODEL, defaultModel: DEFAULT_MODEL };
}
export function personalSet(p: { apiKey?: string; model?: string; clearKey?: boolean }) {
  const s = load();
  if (p.clearKey) delete s.apiKey;
  if (typeof p.apiKey === "string" && p.apiKey.trim()) {
    const k = p.apiKey.trim();
    if (!/^[\x21-\x7e]{12,400}$/.test(k)) throw new Error("That does not look like an API key (no spaces, 12-400 characters).");
    s.apiKey = k;
  }
  if (typeof p.model === "string") {
    const m = p.model.trim();
    if (m && !/^[A-Za-z0-9._:/@+-]{1,120}$/.test(m)) throw new Error("A model id may contain letters, digits and . _ : / @ + - only.");
    if (m) s.model = m; else delete s.model;
  }
  save(s);
  return personalGet();
}

/** Asks Groq which models this key can use (reads no page, costs nothing). */
export async function personalTest() {
  const s = load();
  if (!s.apiKey) return { ok: false, message: "No Groq API key is saved yet.", models: [] as string[] };
  let res: Response;
  try { res = await fetch(`${BASE}/models`, { headers: { authorization: `Bearer ${s.apiKey}` }, signal: AbortSignal.timeout(15_000) }); }
  catch { return { ok: false, message: "Could not reach Groq. Check this PC's internet connection.", models: [] }; }
  if (res.status === 401 || res.status === 403) return { ok: false, message: "Groq rejected this API key.", models: [] };
  if (!res.ok) return { ok: false, message: `Groq answered HTTP ${res.status}.`, models: [] };
  const j = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] };
  const models = (j.data ?? []).map((m) => String(m.id ?? "")).filter(Boolean).sort();
  const model = s.model || DEFAULT_MODEL;
  return { ok: true, message: models.length && !models.includes(model) ? `Key accepted, but the model "${model}" is not in your list. Pick one from the list.` : "Key accepted.", models };
}

type ReadResult = { ok: true; page: unknown } | { ok: false; error: string; message: string; retryable?: boolean };
const fail = (error: string, message: string, retryable = false): ReadResult => ({ ok: false, error, message, retryable });

export async function personalReadPage(images: Uint8Array[], hint?: string): Promise<ReadResult> {
  const s = load();
  if (!s.apiKey) return fail("not_configured", "No Groq API key yet. Open Settings and paste your key.");
  const model = s.model || DEFAULT_MODEL;
  const labels = ["Whole page", "Top 56% of the page (zoomed)", "Bottom 56% of the page (zoomed)"];
  const content: unknown[] = [];
  images.forEach((b, i) => {
    content.push({ type: "text", text: labels[i] ?? `Image ${i + 1}` });
    content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${Buffer.from(b).toString("base64")}` } });
  });
  const ctx = hintText(hint);
  content.push({ type: "text", text: (ctx ? ctx + "\n" : "") + "Transcribe this page. Return the JSON object only." });
  let res: Response;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s.apiKey}` },
      body: JSON.stringify({ model, temperature: 0, max_completion_tokens: 8192, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content }] }),
      signal: AbortSignal.timeout(170_000),
    });
  } catch { return fail("network", "Could not reach Groq. Check this PC's internet connection.", true); }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) return fail("provider_auth", "Groq rejected your API key. Check it in Settings.");
    if (res.status === 404) return fail("provider_model", `Groq does not know the model "${model}". Choose a vision model in Settings.`);
    if (res.status === 400 || res.status === 413) return fail("provider_input", `Groq could not accept this page (${res.status}). The model may not support images, or the images are too large.`);
    return fail("provider_busy", `Groq is busy or unavailable (${res.status}). Try again.`, res.status === 429 || res.status >= 500);
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string | null }; finish_reason?: string }[] };
  const choice = body.choices?.[0];
  if (choice?.finish_reason === "length") return fail("too_long", "The model's answer was cut off. Try again.");
  const text = (choice?.message?.content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  let parsed: unknown;
  try { parsed = JSON.parse(text.slice(a, b + 1)); } catch { return fail("bad_output", "The model did not return valid JSON. Press Try again."); }
  const v = ModelPage.safeParse(parsed);
  return v.success ? { ok: true, page: v.data } : fail("bad_output", "The model output did not match the expected format. Press Try again.");
}
