import { useState } from "react";
import type { LicStatus } from "../types";

const TITLES: Record<string, string> = {
  unlicensed: "Activate Lighting Survey Reader", expired: "License expired", revoked: "This licence was revoked", suspended: "This licence is suspended",
  invalid: "Activation needed", wrong_machine: "This licence belongs to another computer", not_yet_valid: "This licence is not valid yet", validation_required: "Please connect to the internet",
};

/** Machine ID with a Copy button: what the customer sends to get a machine-bound (offline) code. */
export function MachineId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="machineid">
      <label>Machine ID</label>
      <div className="row"><code data-testid="machine-id" className="mid">{id}</code>
        <button data-testid="copy-machine-id" onClick={() => { void window.api.clipboard.write(id).then((ok: boolean) => { setCopied(ok); setTimeout(() => setCopied(false), 2000); }); }}>{copied ? "Copied" : "Copy"}</button></div>
    </div>
  );
}

/** Code box + Activate + Contact Support. Shared by the first-run screen and "Change licence". */
export function ActivationForm({ status, onDone, compact }: { status: LicStatus; onDone?: () => void; compact?: boolean }) {
  const [code, setCode] = useState(""); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setMsg(null);
    const r = await window.api.license.activate(code);
    setBusy(false);
    if (r.ok) { setCode(""); onDone?.(); } else setMsg(r.message);
  };
  return (
    <>
      <label htmlFor="code">{compact ? "New activation code" : "Activation code"}</label>
      <textarea id="code" data-testid="code-input" className="codefield" rows={4} value={code} placeholder="LSR1.…" autoComplete="off" spellCheck={false} onChange={(e) => setCode(e.target.value)} />
      <div className="row">
        <button className="primary" data-testid="activate" disabled={busy || !code.trim()} onClick={() => void go()}>{busy ? "Checking…" : "Activate"}</button>
        {status.supportUrl && <button data-testid="contact-support" onClick={() => void window.api.support.open()}>Contact Support</button>}
      </div>
      {msg && <p className="error" role="alert" data-testid="activate-error">{msg}</p>}
    </>
  );
}

/** First run / locked / expired. The client-side gate is for a clear experience; the server is what really enforces the licence. */
export function ActivationScreen({ status }: { status: LicStatus }) {
  const ev = status.evaluation;
  const locked = ev.status !== "unlicensed";
  return (
    <main className="lock" data-testid="lock-screen">
      <div className="card lockcard">
        <h1>{TITLES[ev.status] ?? "Activate Lighting Survey Reader"}</h1>
        {locked && <p className="reason" data-testid="lock-reason" role="alert">{ev.message}</p>}
        {status.notice && <p className="error" data-testid="notice" role="alert">{status.notice}</p>}
        {!locked && <p className="muted">Enter the activation code you received. You only need to do this once on this PC.</p>}
        {ev.status === "validation_required" && <p><button data-testid="retry" onClick={() => void window.api.license.check()}>Try again</button></p>}
        <ActivationForm status={status} compact={locked} />
        <hr />
        <MachineId id={status.machineId} />
        <p className="muted small">Need a code for this computer only? Send the Machine ID to support.</p>
        <p className="muted small contact">{status.contact}</p>
        <p className="muted small">Your exported Excel files are not affected by the licence.</p>
      </div>
    </main>
  );
}
