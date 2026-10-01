import { useState } from "react";
import { fmtDate, fmtDay, type LicStatus } from "../types";
import { ActivationForm, MachineId } from "./Activation";

const LABEL: Record<string, string> = { active: "Active", warning: "Active (validation overdue)", expired: "Expired", revoked: "Revoked", suspended: "Suspended", invalid: "Invalid", wrong_machine: "Other computer", not_yet_valid: "Not valid yet", validation_required: "Validation required", unlicensed: "Not activated" };

/** The licence page: details + Check, Change, Deactivate (with confirmation). */
export function LicensePanel({ status }: { status: LicStatus }) {
  const ev = status.evaluation; const i = ev.info;
  const [msg, setMsg] = useState(""); const [changing, setChanging] = useState(false); const [busy, setBusy] = useState(false);
  const check = async () => { setBusy(true); setMsg("Checking…"); const s = (await window.api.license.check()) as LicStatus; setBusy(false); setMsg(s.evaluation.usable ? "Licence checked." : s.evaluation.message); };
  const deactivate = async () => {
    if (!confirm("Deactivate this PC?\n\nThe app will stop working here until you enter a code again. The activation is freed so you can use it on another computer.")) return;
    const r = await window.api.license.deactivate();
    if (r && "error" in r) setMsg(r.error); else if (r && !r.serverNotified) setMsg("This PC was deactivated here, but the licensing server could not be reached to free the activation. Ask support to reset it.");
  };
  return (
    <div className="card" data-testid="licence-panel">
      <h2>License</h2>
      {i ? (
        <dl className="kv">
          <dt>Product</dt><dd>Lighting Survey Reader</dd>
          <dt>License ID</dt><dd data-testid="lic-id">{i.licenseId}</dd>
          <dt>Customer</dt><dd dir="auto">{i.customer}{i.company ? ` · ${i.company}` : ""}</dd>
          <dt>Activated</dt><dd>{fmtDate(i.activatedAt)}</dd>
          <dt>Expires</dt><dd>{fmtDay(i.expiresAt)}</dd>
          <dt>Days remaining</dt><dd data-testid="lic-days">{i.daysRemaining ?? "No end date"}</dd>
          <dt>Status</dt><dd data-testid="lic-status">{LABEL[ev.status] ?? ev.status}</dd>
          <dt>Machine</dt><dd>{i.machine}</dd>
          <dt>Last validation</dt><dd>{i.offline && !i.lastValidatedAt ? "Offline licence (no validation needed)" : fmtDate(i.lastValidatedAt)}</dd>
        </dl>
      ) : <p>{ev.message}</p>}
      {ev.warning && <p className="error" role="status">{ev.warning}</p>}
      <div className="row">
        <button data-testid="check-licence" disabled={busy} onClick={() => void check()}>Check License</button>
        <button data-testid="change-licence" onClick={() => setChanging(!changing)}>Change License</button>
        <button className="danger" data-testid="deactivate" onClick={() => void deactivate()}>Deactivate</button>
      </div>
      {msg && <p className="muted" role="status" data-testid="licence-msg">{msg}</p>}
      {changing && <div className="card"><ActivationForm status={status} compact onDone={() => { setChanging(false); setMsg("New licence activated."); }} /></div>}
      <MachineId id={status.machineId} />
    </div>
  );
}
