import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AesBox } from "@lsr/licensing";
import { hintText, ModelPage, SYSTEM_PROMPT } from "@lsr/shared";

/**
 * PERSONAL BUILD ONLY (LSR_PERSONAL=1). The owner's own PC reads pages straight from Gemini (free tier) or Groq with their own key:
 * no licence, no server. The key is stored encrypted on this PC (DPAPI on Windows). Never ship this build to customers:
 * a key inside a customer's PC can be extracted. The release gate refuses a bundle that contains this mode.
 */
export type Provider = "gemini" | "groq";
export const PROVIDERS: Record<Provider, { label: string; base: string; defaultModel: string; maxTokens: Record<string, number> }> = {
  gemini: { label: "Google Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "gemini-2.5-flash", maxTokens: { max_tokens: 16384 } },   // free tier; Gemini's OpenAI-compatible endpoint
  groq: { label: "Groq", base: "https://api.groq.com/openai/v1", defaultModel: "meta-llama/llama-4-scout-17b-16e-instruct", maxTokens: { max_completion_tokens: 8192 } },
};
/** Both providers speak the OpenAI chat format. E2E builds may point them at a local stub. */
const baseOf = (p: Provider) => (__E2E__ && process.env[`LSR_${p.toUpperCase()}_BASE`]) || PROVIDERS[p].base;
interface Entry { apiKey?: string; model?: string }
interface Saved { provider?: Provider; gemini?: Entry; groq?: Entry; apiKey?: string; model?: string }   // apiKey/model at the top level = an older Groq-only file

const file = () => join(app.getPath("userData"), "personal-groq.dat");
const aes = () => new AesBox(`personal|${app.getPath("userData")}|${process.env.USERNAME ?? process.env.USER ?? ""}`);
function load(): Saved {
  try {
    if (!existsSync(file())) return {};
    const raw = readFileSync(file());
    if (!raw.length) return {};
    const text = process.platform === "win32" ? safeStorage.decryptString(raw) : aes().open(raw.toString("utf8"));
    const s = JSON.parse(text) as Saved;
    if (s.apiKey && !s.groq) { s.groq = { apiKey: s.apiKey, model: s.model }; s.provider ??= "groq"; delete s.apiKey; delete s.model; }
    return s;
  } catch { return {}; }
}
function save(s: Saved) {
  mkdirSync(dirname(file()), { recursive: true });
  const text = JSON.stringify(s);
  if (process.platform === "win32" && !safeStorage.isEncryptionAvailable()) throw new Error("Windows data protection (DPAPI) is not available, so the key cannot be stored securely on this PC.");
  const data = process.platform === "win32" ? safeStorage.encryptString(text) : Buffer.from(aes().seal(text), "utf8");
  const tmp = file() + ".tmp"; writeFileSync(tmp, data); renameSync(tmp, file());
}
const current = (s: Saved): Provider => s.provider ?? "gemini";

/** The window may see which provider is active, whether a key is set and its last 4 characters, never the key. */
export function personalGet() {
  const s = load();
  const view = (p: Provider) => { const e = s[p] ?? {}; return { label: PROVIDERS[p].label, configured: !!e.apiKey, keyHint: e.apiKey ? `…${e.apiKey.slice(-4)}` : null, model: e.model || PROVIDERS[p].defaultModel, defaultModel: PROVIDERS[p].defaultModel }; };
  return { provider: current(s), gemini: view("gemini"), groq: view("groq") };
}
export function personalSet(p: { provider?: Provider; apiKey?: string; model?: string; clearKey?: boolean }) {
  const s = load();
  if (p.provider !== undefined) { if (!(p.provider in PROVIDERS)) throw new Error("Unknown provider."); s.provider = p.provider; }
  const name = current(s); const e: Entry = { ...(s[name] ?? {}) };
  if (p.clearKey) delete e.apiKey;
  if (typeof p.apiKey === "string" && p.apiKey.trim()) {
    const k = p.apiKey.trim();
    if (!/^[\x21-\x7e]{12,400}$/.test(k)) throw new Error("That does not look like an API key (no spaces, 12-400 characters).");
    e.apiKey = k;
  }
  if (typeof p.model === "string") {
    const m = p.model.trim();
    if (m && !/^[A-Za-z0-9._:/@+-]{1,120}$/.test(m)) throw new Error("A model id may contain letters, digits and . _ : / @ + - only.");
    if (m) e.model = m; else delete e.model;
  }
  s[name] = e; save(s);
  return personalGet();
}

/** The provider's own short reason (never contains our key). */
async function providerReason(res: Response): Promise<string> {
  try { const j = (await res.json()) as { error?: { message?: string } | string }; const m = typeof j.error === "string" ? j.error : j.error?.message ?? ""; return m.replace(/\s+/g, " ").slice(0, 160); } catch { return ""; }
}

/** Asks the active provider which models this key can use (reads no page). */
export async function personalTest() {
  const s = load(); const name = current(s); const e = s[name] ?? {};
  if (!e.apiKey) return { ok: false, message: `No ${PROVIDERS[name].label} API key is saved yet.`, models: [] as string[] };
  let res: Response;
  try { res = await fetch(`${baseOf(name)}/models`, { headers: { authorization: `Bearer ${e.apiKey}` }, signal: AbortSignal.timeout(15_000) }); }
  catch { return { ok: false, message: `Could not reach ${PROVIDERS[name].label}. Check this PC's internet connection.`, models: [] }; }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    const why = await providerReason(res);
    const wrong = name === "gemini" && e.apiKey.startsWith("gsk_") ? " This looks like a Groq key (gsk_…): choose Groq above, or paste your Gemini key." : name === "groq" && e.apiKey.startsWith("AIza") ? " This looks like a Gemini key (AIza…): choose Google Gemini above." : "";
    return { ok: false, message: `${PROVIDERS[name].label} rejected this API key${why ? ` (“${why}”)` : ""}.${wrong} Paste the key again with no spaces or quotes; for Gemini create it at aistudio.google.com/apikey.`, models: [] };
  }
  if (!res.ok) return { ok: false, message: `${PROVIDERS[name].label} answered HTTP ${res.status}.`, models: [] };
  const j = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] };
  const models = (j.data ?? []).map((m) => String(m.id ?? "").replace(/^models\//, "")).filter(Boolean).sort();
  const model = e.model || PROVIDERS[name].defaultModel;
  return { ok: true, message: models.length && !models.includes(model) ? `Key accepted, but the model "${model}" is not in your list. Pick one from the list.` : "Key accepted.", models };
}

type ReadResult = { ok: true; page: unknown } | { ok: false; error: string; message: string; retryable?: boolean };
const fail = (error: string, message: string, retryable = false): ReadResult => ({ ok: false, error, message, retryable });

export async function personalReadPage(images: Uint8Array[], hint?: string): Promise<ReadResult> {
  const saved = load(); const name = current(saved); const label = PROVIDERS[name].label; const e = saved[name] ?? {};
  if (!e.apiKey) return fail("not_configured", `No ${label} API key yet. Open Settings and paste your key.`);
  const model = e.model || PROVIDERS[name].defaultModel;
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
    res = await fetch(`${baseOf(name)}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${e.apiKey}` },
      body: JSON.stringify({ model, temperature: 0, ...PROVIDERS[name].maxTokens, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content }] }),
      signal: AbortSignal.timeout(170_000),
    });
  } catch { return fail("network", `Could not reach ${label}. Check this PC's internet connection.`, true); }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) return fail("provider_auth", `${label} rejected your API key. Check it in Settings (Test connection).`);
    if (res.status === 404) return fail("provider_model", `${label} does not know the model "${model}". Choose a vision model in Settings.`);
    if (res.status === 400 || res.status === 413) return fail("provider_input", `${label} could not accept this page (${res.status}). The model may not support images, or the key is not valid.`);
    return fail("provider_busy", `${label} is busy or its free limit was reached (${res.status}). Wait a minute and try again.`, res.status === 429 || res.status >= 500);
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
