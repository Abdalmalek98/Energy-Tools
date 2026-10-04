import { useEffect, useState } from "react";
import { isError } from "../types";

interface View { configured: boolean; keyHint: string | null; model: string; defaultModel: string }

/** Personal build only: the owner's own Groq key, stored encrypted on this PC. */
export function PersonalGroq() {
  const [v, setV] = useState<View | null>(null);
  const [key, setKey] = useState(""); const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const apply = (r: unknown) => { if (isError(r)) { setErr(r.error); return false; } setErr(""); setV(r as View); setModel((r as View).model); return true; };
  useEffect(() => { void window.api.personal.get().then(apply); }, []);
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
  return (
    <div className="card" data-testid="personal-groq">
      <h2>Groq API key (personal build)</h2>
      <p className="muted small">This copy reads pages directly with your own Groq key. The key is stored encrypted on this PC only. Do not give this build to customers.</p>
      {err && <p className="error" role="alert" data-testid="personal-error">{err}</p>}
      <p data-testid="personal-state">{v?.configured ? <>A key is saved ({v.keyHint}).</> : "No key saved yet."}</p>
      <label htmlFor="pg-key">Groq API key</label>
      <input id="pg-key" type="password" autoComplete="off" spellCheck={false} placeholder={v?.configured ? "Paste a new key to replace it" : "gsk_…"} value={key} onChange={(e) => setKey(e.target.value)} />
      <label htmlFor="pg-model">Model (must accept images)</label>
      <input id="pg-model" list="pg-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder={v?.defaultModel} />
      <datalist id="pg-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
      <div className="row">
        <button className="primary" disabled={busy} data-testid="personal-save" onClick={() => void save()}>Save</button>
        <button disabled={busy || !v?.configured} data-testid="personal-test" onClick={() => void test()}>Test connection</button>
        <button className="danger" disabled={busy || !v?.configured} onClick={() => void save({ clearKey: true })}>Remove key</button>
      </div>
      {msg && <p className="muted" role="status" data-testid="personal-msg">{msg}</p>}
    </div>
  );
}
