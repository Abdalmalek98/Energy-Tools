import { useState } from 'react';
import { useStore } from '../app/store';
import { Banner, Card, Chip, PageHead } from '../components/ui';
import type { LicenseStatus } from '../licensing/types';
import { PRODUCT_NAME } from '../settings/defaults';

export const SUPPORT_EMAIL = 'support@energy-tools.example';

const STATE_LABEL: Record<string, string> = {
  unlicensed: 'Not activated', active: 'Active', warning: 'Validation overdue', expired: 'Expired', revoked: 'Revoked', suspended: 'Suspended',
  notYetValid: 'Not yet valid', validationOverdue: 'Validation required', wrongMachine: 'Wrong computer', deactivated: 'Deactivated', invalid: 'Invalid',
};
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' }) : '—');
const fmtDateTime = (s: string | null) => (s ? new Date(s).toLocaleString('en-GB', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const MACHINE: Record<string, string> = { notBound: 'Not bound to a computer', bound: 'Bound – this computer', mismatch: 'Mismatch – different computer', unknown: '—' };

export function LicenseDetails({ s }: { s: LicenseStatus }) {
  const kind = s.state === 'active' ? 'Active' : s.state === 'warning' ? 'Warning' : 'Locked';
  return (
    <dl className="kv" aria-label="License information">
      <dt>Product</dt><dd>{s.product ?? PRODUCT_NAME}</dd>
      <dt>License ID</dt><dd>{s.licenseId ?? '—'}</dd>
      <dt>Customer</dt><dd>{[s.customer, s.company].filter(Boolean).join(' · ') || '—'}</dd>
      <dt>Activation date</dt><dd>{fmtDate(s.activatedAt)}</dd>
      <dt>Expiry date</dt><dd>{s.perpetual ? 'Perpetual (no expiry)' : fmtDate(s.expiresAt)}</dd>
      <dt>Days remaining</dt><dd>{s.perpetual ? '∞' : s.daysRemaining ?? '—'}</dd>
      <dt>Status</dt><dd><span className={`chip ${kind}`}>{STATE_LABEL[s.state] ?? s.state}</span></dd>
      <dt>Machine</dt><dd>{MACHINE[s.machineStatus]}</dd>
      <dt>Last validation</dt><dd>{fmtDateTime(s.lastValidation)}</dd>
      <dt>Next validation due</dt><dd>{fmtDate(s.nextValidationDue)}{s.graceEndsAt ? ` (offline grace until ${fmtDate(s.graceEndsAt)})` : ''}</dd>
    </dl>
  );
}

function MachineId({ id }: { id: string }) {
  const { toast } = useStore();
  return (
    <div>
      <div className="hint">Machine ID (only needed if you requested a license bound to this computer)</div>
      <div className="row" style={{ marginTop: 4 }}>
        <input type="text" readOnly value={id} style={{ flex: 1, fontSize: 11 }} aria-label="Machine ID" onFocus={(e) => e.currentTarget.select()} />
        <button className="btn sm" onClick={() => navigator.clipboard?.writeText(id).then(() => toast('Machine ID copied'))}>Copy</button>
      </div>
    </div>
  );
}

/** Full-screen gate shown when no valid license is present. */
export function ActivationScreen({ onDone, onStart, onCancel }: { onDone: () => void; onStart: () => void; onCancel: () => void }) {
  const { license, activate, licenseBusy } = useStore();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<LicenseStatus | null>(null);
  if (!license) return <div className="splash">Checking license…</div>;

  const expired = license.state === 'expired';
  const go = async () => {
    setError(null);
    onStart();
    try {
      const s = await activate(code.trim());
      setDone(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      onCancel();
    }
  };
  return (
    <div className="lic-screen">
      <div className="lic-card">
        <h1>Activate {PRODUCT_NAME}</h1>
        {done ? (
          <>
            <Banner kind="ok" title="Activation successful. " />
            <div style={{ margin: '14px 0' }}><LicenseDetails s={done} /></div>
            <button className="btn primary" onClick={onDone}>Start using {PRODUCT_NAME}</button>
          </>
        ) : (
          <>
            {license.state !== 'unlicensed' && (
              <div style={{ margin: '12px 0' }}>
                <Banner kind="error" title={expired ? 'License expired.' : 'License unavailable. '}>
                  {expired ? <div>Please enter a valid activation code.</div> : <div>{license.message}</div>}
                </Banner>
              </div>
            )}
            {license.state === 'unlicensed' && <p style={{ color: 'var(--ink-2)' }}>Enter the activation code you received from your software provider. Internet access is needed once, for the initial activation. Afterwards all analysis works offline; your engineering data never leaves this computer.</p>}
            {license.state !== 'unlicensed' && license.licenseId && <div style={{ margin: '12px 0' }}><LicenseDetails s={license} /></div>}
            <label className="field" style={{ marginTop: 10 }}>
              Activation code
              <textarea value={code} onChange={(e) => setCode(e.target.value)} placeholder="CPA1.eyJ2Ijox…" spellCheck={false} aria-label="Activation code" />
            </label>
            {error && <div style={{ marginTop: 10 }}><Banner kind="error" title="Activation failed. ">{error}</Banner></div>}
            <div className="row" style={{ margin: '16px 0' }}>
              <button className="btn primary" disabled={!code.trim() || licenseBusy} onClick={go}>{licenseBusy ? 'Activating…' : 'Activate'}</button>
              <a className="btn" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(PRODUCT_NAME + ' – activation')}`}>Contact Support</a>
            </div>
            <MachineId id={license.machineId} />
          </>
        )}
      </div>
    </div>
  );
}

export function LicensePage() {
  const { license, checkLicense, deactivate, licenseBusy, setPage, toast } = useStore();
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!license) return null;
  const doDeactivate = async (force: boolean) => {
    setErr(null);
    try { await deactivate(force); setConfirm(false); toast('This machine has been deactivated.'); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <>
      <PageHead title="License" subtitle="Activation and validation status of this computer." />
      <div className="grid g2">
        <Card title="License information">
          <LicenseDetails s={license} />
          {license.offlineNote && <div style={{ marginTop: 12 }}><Banner kind="warn">{license.offlineNote}</Banner></div>}
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn primary" disabled={licenseBusy} onClick={checkLicense}>{licenseBusy ? 'Checking…' : 'Check License'}</button>
            <button className="btn danger" onClick={() => setConfirm(true)}>Deactivate This Machine</button>
          </div>
          <p className="hint">Validation runs automatically; the application keeps working offline within the grace period. A revoked license takes effect the next time this computer validates online.</p>
        </Card>
        <Card title="Activate / change license">
          <ChangeLicense />
          <div style={{ marginTop: 14 }}><MachineIdBlock /></div>
        </Card>
      </div>
      <Card title="Included features">
        <div className="row">
          {Object.entries(license.features).map(([k, v]) => <span key={k} className={`chip ${v ? 'OK' : 'Neutral'}`}>{v ? '✓' : '✗'}&nbsp;{k}</span>)}
          {!Object.keys(license.features).length && <span className="hint">—</span>}
        </div>
        <p className="hint">Activations used: {license.activations ?? '—'} of {license.maxActivations ?? '—'} · signing key: {license.keyId ?? '—'}</p>
      </Card>
      {confirm && (
        <div role="dialog" aria-modal="true" aria-label="Confirm deactivation" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 40 }}>
          <div className="card" style={{ maxWidth: 480 }}>
            <h2>Deactivate this machine?</h2>
            <p>The license is removed from this computer and its activation slot is released so you can activate another computer. Your projects and data are not affected.</p>
            {err && <Banner kind="error">{err}</Banner>}
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn danger" disabled={licenseBusy} onClick={() => doDeactivate(false)}>Deactivate</button>
              {err && <button className="btn" onClick={() => doDeactivate(true)}>Remove locally only</button>}
              <button className="btn" onClick={() => { setConfirm(false); setErr(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MachineIdBlock() {
  const { license } = useStore();
  return license ? <MachineId id={license.machineId} /> : null;
}

function ChangeLicense() {
  const { activate, licenseBusy, toast } = useStore();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <textarea value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste a new activation code (renewal or replacement)" spellCheck={false} aria-label="Activation code" />
      {error && <div style={{ marginTop: 8 }}><Banner kind="error">{error}</Banner></div>}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" disabled={!code.trim() || licenseBusy} onClick={async () => {
          setError(null);
          try { await activate(code.trim()); setCode(''); toast('License activated'); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        }}>Activate / Change License</button>
      </div>
    </>
  );
}

export { Chip };
