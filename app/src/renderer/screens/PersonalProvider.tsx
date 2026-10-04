import { useEffect, useState } from "react";
import { isError } from "../types";

type Name = "gemini" | "groq";
interface Entry { label: string; configured: boolean; keyHint: string | null; model: string; defaultModel: string }
interface View { provider: Name; gemini: Entry; groq: Entry }
const HELP: Record<Name, string> = { gemini: "Free key: aistudio.google.com/apikey (Google account, no card).", groq: "Key: console.groq.com → API Keys." };

/** Personal build only: the owner's own Gemini or Groq key, stored encrypted on this PC. */
export function PersonalProvider() {
  const [v, setV] = useState<View | null>(null);
  const [key, setKey] = useState(""); const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const apply = (r: unknown) => { if (isError(r)) { setErr(r.error); return false; } const n = r as View; setErr(""); setV(n); setModel(n[n.provider].model); setModels([]); return true; };
  useEffect(() => { void window.api.personal.get().then(apply); }, []);
  const pick = async (p: Name) => { setKey(""); setMsg(""); apply(await window.api.personal.set({ provider: p })); };
  const save = async (extra: { clearKey?: boolean } = {}) => {
    setBusy(true); setMsg("");
    const ok = apply(await window.api.personal.set({ apiKey: key, model, ...extra }));
    setBusy(false); if (ok) { setKey(""); setMsg(extra.clearKey ? "Key removed." : "Saved."); }
  };
  const test = async () => {
    setBusy(true); setMsg("Testing…");
    const r = await window.api.personal.test() as { ok: boolean; message: string; models: string[] } | { error: string };
    setBusy(false);
    if (isError(r)) { setMsg(""); return setErr(r.error); }
    setErr(""); setMsg(r.message); setModels(r.models);
  };
  const cur = v?.[v.provider];
  return (
    <div className="card" data-testid="personal-groq">
      <h2>Reading service (personal build)</h2>
      <p className="muted small">This copy reads pages directly with your own key. The key is stored encrypted on this PC only. Do not give this build to customers.</p>
      {err && <p className="error" role="alert" data-testid="personal-error">{err}</p>}
      <div className="row" role="radiogroup" aria-label="Provider">
        {(["gemini", "groq"] as Name[]).map((p) => <label key={p}><input type="radio" name="pprov" data-testid={`prov-${p}`} checked={v?.provider === p} onChange={() => void pick(p)} /> {v?.[p].label ?? p}{p === "gemini" ? " (free tier)" : ""}</label>)}
      </div>
      {v && <p className="muted small">{HELP[v.provider]}</p>}
      <p data-testid="personal-state">{cur?.configured ? <>A key is saved ({cur.keyHint}).</> : "No key saved yet."}</p>
      <label htmlFor="pg-key">{cur?.label ?? ""} API key</label>
      <input id="pg-key" type="password" autoComplete="off" spellCheck={false} placeholder={cur?.configured ? "Paste a new key to replace it" : "Paste your key"} value={key} onChange={(e) => setKey(e.target.value)} />
      <label htmlFor="pg-model">Model (must accept images)</label>
      <input id="pg-model" list="pg-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder={cur?.defaultModel} />
      <datalist id="pg-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
      <div className="row">
        <button className="primary" disabled={busy} data-testid="personal-save" onClick={() => void save()}>Save</button>
        <button disabled={busy || !cur?.configured} data-testid="personal-test" onClick={() => void test()}>Test connection</button>
        <button className="danger" disabled={busy || !cur?.configured} onClick={() => void save({ clearKey: true })}>Remove key</button>
      </div>
      {msg && <p className="muted" role="status" data-testid="personal-msg">{msg}</p>}
    </div>
  );
}
