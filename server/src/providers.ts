import { AesBox } from "@lsr/licensing";
import { createHash } from "node:crypto";
import { hintText, SYSTEM_PROMPT, type Quality } from "@lsr/shared";
import type { Config } from "./config";
import { DEFAULT_GROQ_MODEL } from "./config";
import { anthropicReadPage, finishPage, UpstreamError, type ProviderCreds } from "./claude";
import { nowIso, row, run, type Db } from "./db";
import { ApiError } from "./licenses";

export type ProviderName = "anthropic" | "groq";
export const PROVIDERS: ProviderName[] = ["anthropic", "groq"];

interface StoredProvider { apiKeyEnc?: string; baseUrl?: string; modelBest?: string; modelFast?: string }
interface Stored { provider?: ProviderName; anthropic?: StoredProvider; groq?: StoredProvider }

/** Keys saved from the License Manager are encrypted with a key derived from the server's own receipt key file (not from the admin token, not stored in the DB), so a copied backup of the database does not expose them. */
const box = (cfg: Config) => new AesBox(createHash("sha256").update("lsr-settings-v1").update(cfg.receiptKey.export({ type: "pkcs8", format: "der" })).digest("hex"));
const loadStored = (db: Db): Stored => { const r = row<{ value: string }>(db, "SELECT value FROM settings WHERE key = 'provider'"); return r ? (JSON.parse(r.value) as Stored) : {}; };
const saveStored = (db: Db, s: Stored) => run(db, "INSERT INTO settings (key, value, updated_at) VALUES ('provider', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", JSON.stringify(s), nowIso());

export interface Effective { provider: ProviderName; anthropic: ProviderCreds & { source: "stored" | "env" | "none" }; groq: ProviderCreds & { source: "stored" | "env" | "none" } }

/** Saved settings (License Manager) win over environment defaults. */
export function resolveProvider(db: Db, cfg: Config): Effective {
  const st = loadStored(db); const b = box(cfg);
  const one = (name: ProviderName): Effective["anthropic"] => {
    const env = cfg[name], s = st[name] ?? {};
    let stored = ""; try { stored = s.apiKeyEnc ? b.open(s.apiKeyEnc) : ""; } catch { stored = ""; }
    return { apiKey: stored || env.apiKey, source: stored ? "stored" : env.apiKey ? "env" : "none", baseUrl: s.baseUrl || env.baseUrl, modelBest: s.modelBest || env.modelBest, modelFast: s.modelFast || env.modelFast };
  };
  return { provider: st.provider ?? cfg.provider, anthropic: one("anthropic"), groq: one("groq") };
}

/** What the License Manager may see: never the key, only whether one is set and its last 4 characters. */
export function publicProvider(db: Db, cfg: Config) {
  const e = resolveProvider(db, cfg);
  const view = (p: Effective["anthropic"]) => ({ configured: !!p.apiKey, keyHint: p.apiKey ? `…${p.apiKey.slice(-4)}` : null, source: p.source, baseUrl: p.baseUrl, modelBest: p.modelBest, modelFast: p.modelFast });
  return { provider: e.provider, anthropic: view(e.anthropic), groq: view(e.groq), defaults: { groqModel: DEFAULT_GROQ_MODEL } };
}

const MODEL_RE = /^[A-Za-z0-9._:/@+-]{1,120}$/;
function checkUrl(cfg: Config, v: unknown): string {
  let u: URL; try { u = new URL(String(v)); } catch { throw new ApiError(400, "bad_request", "The base URL is not valid."); }
  const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost";
  if (u.protocol !== "https:" && !(cfg.allowInsecureUpstream && loopback)) throw new ApiError(400, "bad_request", "The base URL must start with https://.");
  if (u.username || u.password) throw new ApiError(400, "bad_request", "The base URL must not contain credentials.");
  return u.toString().replace(/\/+$/, "");
}

/** Returns the names of the fields that changed (never their values). */
export function saveProvider(db: Db, cfg: Config, body: Record<string, any>): string[] {
  const st = loadStored(db); const b = box(cfg); const changed: string[] = [];
  if (body.provider !== undefined) {
    if (!PROVIDERS.includes(body.provider)) throw new ApiError(400, "bad_request", "provider must be anthropic or groq.");
    st.provider = body.provider; changed.push("provider");
  }
  for (const name of PROVIDERS) {
    const inp = body[name]; if (inp === undefined) continue;
    if (!inp || typeof inp !== "object") throw new ApiError(400, "bad_request", `${name} must be an object.`);
    const cur: StoredProvider = { ...(st[name] ?? {}) };
    if (inp.clearKey === true) { delete cur.apiKeyEnc; changed.push(`${name}.apiKey (removed)`); }
    if (inp.apiKey !== undefined && inp.apiKey !== "") {
      const k = String(inp.apiKey).trim();
      if (!/^[\x21-\x7e]{12,400}$/.test(k)) throw new ApiError(400, "bad_request", "That does not look like an API key (no spaces, 12-400 characters).");
      cur.apiKeyEnc = b.seal(k); changed.push(`${name}.apiKey`);
    }
    for (const f of ["modelBest", "modelFast"] as const) if (inp[f] !== undefined) {
      const v = String(inp[f]).trim();
      if (v && !MODEL_RE.test(v)) throw new ApiError(400, "bad_request", "A model id may contain letters, digits and . _ : / @ + - only.");
      if (v) cur[f] = v; else delete cur[f]; changed.push(`${name}.${f}`);
    }
    if (inp.baseUrl !== undefined) { if (String(inp.baseUrl).trim()) cur.baseUrl = checkUrl(cfg, inp.baseUrl); else delete cur.baseUrl; changed.push(`${name}.baseUrl`); }
    st[name] = cur;
  }
  saveStored(db, st);
  return changed;
}

/** "Test connection": asks the provider which models this key can use (no page is read, nothing is billed). */
export async function testProvider(db: Db, cfg: Config, name: ProviderName) {
  const e = resolveProvider(db, cfg)[name];
  if (!e.apiKey) return { ok: false, message: `No ${name === "groq" ? "Groq" : "Anthropic"} API key is saved or configured on the server.`, models: [] as string[] };
  const url = name === "groq" ? `${e.baseUrl}/models` : `${e.baseUrl}/v1/models`;
  const headers: Record<string, string> = name === "groq" ? { authorization: `Bearer ${e.apiKey}` } : { "x-api-key": e.apiKey, "anthropic-version": "2023-06-01" };
  let res: Response;
  try { res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) }); } catch { return { ok: false, message: "Could not reach the provider. Check the base URL and the server's internet access.", models: [] }; }
  if (res.status === 401 || res.status === 403) return { ok: false, message: "The provider rejected this API key.", models: [] };
  if (!res.ok) return { ok: false, message: `The provider answered HTTP ${res.status}.`, models: [] };
  const j = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] };
  const models = (j.data ?? []).map((m) => String(m.id ?? "")).filter(Boolean).sort();
  const chosen = [e.modelBest, e.modelFast];
  const missing = chosen.filter((m) => models.length && !models.includes(m));
  return { ok: true, message: missing.length ? `Key accepted, but the selected model(s) are not in the provider's list: ${[...new Set(missing)].join(", ")}. Pick one from the list.` : "Key accepted.", models };
}

function groqRead(g: ProviderCreds, images: string[], quality: Quality, hint?: string | null) {
  const model = quality === "fast" ? g.modelFast : g.modelBest;
  const labels = ["Whole page", "Top 56% of the page (zoomed)", "Bottom 56% of the page (zoomed)"];
  const content: unknown[] = [];
  images.forEach((data, i) => {
    content.push({ type: "text", text: labels[i] ?? `Image ${i + 1}` });
    content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${data}` } });
  });
  const ctx = hintText(hint);
  content.push({ type: "text", text: (ctx ? ctx + "\n" : "") + "Transcribe this page. Return the JSON object only." });
  return (async () => {
    let res: Response;
    try {
      res = await fetch(`${g.baseUrl}/chat/completions`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${g.apiKey}` },
        body: JSON.stringify({ model, temperature: 0, max_completion_tokens: 8192, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content }] }),
        signal: AbortSignal.timeout(170_000),
      });
    } catch { throw new UpstreamError("The reading service could not be reached. Try again.", true); }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      if (res.status === 401 || res.status === 403) throw new UpstreamError("The reading provider rejected the server's API key. The owner must check it in the License Manager.", false, 502, detail);
      if (res.status === 404) throw new UpstreamError("The selected reading model was not found at the provider. The owner must choose a valid vision model in the License Manager.", false, 502, detail);
      if (res.status === 413 || res.status === 400) throw new UpstreamError(`The reading provider could not accept this page (${res.status}). The model may not support images or the images are too large.`, false, 502, detail);
      throw new UpstreamError(`Reading service busy or unavailable (${res.status}).`, res.status === 429 || res.status >= 500, 502, detail);
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string | null }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const choice = body.choices?.[0];
    if (choice?.finish_reason === "length") throw new UpstreamError("The model's answer was cut off (too long). Try again, or use the other accuracy setting.", false);
    return finishPage(choice?.message?.content ?? "", model, body.usage?.prompt_tokens ?? null, body.usage?.completion_tokens ?? null);
  })();
}

/** The one entry point used by /v1/read-page. */
export function readWithProvider(db: Db, cfg: Config, images: string[], quality: Quality, hint?: string | null) {
  const e = resolveProvider(db, cfg); const p = e[e.provider];
  if (!p.apiKey) throw new ApiError(503, "not_configured", "Page reading is not set up on the server yet (no API key). Please tell your supplier.");
  return e.provider === "groq" ? groqRead(p, images, quality, hint) : anthropicReadPage(p, images, quality, hint);
}
