import { useState } from "react";
import type { LicStatus } from "../types";

const TITLES: Record<string, string> = {
  locked: "This code is locked", expired: "This code has expired", device_revoked: "This PC was deactivated for the code",
  invalid: "This code is no longer valid", lease_expired: "Please connect to the internet", clock: "Please connect to the internet",
};
const fmt = (raw: string) => raw.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 20).match(/.{1,5}/g)?.join("-") ?? "";

/** First run / locked / expired: reason + field for a (new) code. Client-side only for UX; the service is the real gate. */
export function LockScreen({ status }: { status: LicStatus }) {
  const [code, setCode] = useState(""); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const s = status.state;
  const locked = s.kind === "locked" ? s : null;
  const canRetry = locked && (locked.reason === "lease_expired" || locked.reason === "clock");
  const go = async () => {
    setBusy(true); setMsg(null);
    const r = await window.api.license.activate(code);
    setBusy(false); if (!r.ok) setMsg(r.message);
  };
  return (
    <main className="lock" data-testid="lock-screen">
      <div className="card lockcard">
        <h1>{locked ? TITLES[locked.reason] : "Activate Lighting Survey Reader"}</h1>
        {locked && <p className="reason" data-testid="lock-reason">{locked.message}</p>}
        {!locked && <p className="muted">Enter the activation code you received. You only need to do this once on this PC.</p>}
        {canRetry && <p><button data-testid="retry" onClick={() => void window.api.license.refresh()}>Try again</button></p>}
        <label htmlFor="code">{locked ? "Enter a new code" : "Activation code"}</label>
        <input id="code" data-testid="code-input" className="codefield" value={code} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autoComplete="off" spellCheck={false}
          onChange={(e) => setCode(fmt(e.target.value))} onKeyDown={(e) => e.key === "Enter" && code.length >= 23 && void go()} />
        <button className="primary" data-testid="activate" disabled={busy || code.length < 23} onClick={() => void go()}>{busy ? "Checking…" : "Activate"}</button>
        {msg && <p className="error" role="alert" data-testid="activate-error">{msg}</p>}
        <p className="muted small contact">{status.contact}</p>
        <p className="muted small">Your exported Excel files are not affected by the licence.</p>
      </div>
    </main>
  );
}
