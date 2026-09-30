import type { ReactNode } from 'react';
import { useStore, type PageId } from '../app/store';

export const chipClass = (label: string) => label.replace(/\s+/g, '-');
export function Chip({ label, kind }: { label: string; kind?: string }) {
  return <span className={`chip ${chipClass(kind ?? label)}`}>{label}</span>;
}

export function PageHead({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="row">{children}</div>
    </div>
  );
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          {title && <h3 style={{ margin: 0 }}>{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, unit, sub, hero }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; hero?: boolean }) {
  return (
    <div className={`kpi${hero ? ' hero' : ''}`}>
      <div className="l">{label}</div>
      <div className="v">
        {value}
        {unit && <span className="u">{unit}</span>}
      </div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

export function Banner({ kind = 'info', title, children }: { kind?: 'info' | 'error' | 'warn' | 'ok'; title?: string; children?: ReactNode }) {
  return (
    <div className={`banner ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div style={{ minWidth: 0 }}>
        {title && <strong>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function ErrorText({ text }: { text: string }) {
  return <pre>{text}</pre>;
}

export function Table({ head, rows, numeric = [] }: { head: string[]; rows: ReactNode[][]; numeric?: number[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{head.map((h, i) => <th key={i} className={numeric.includes(i) ? 'n' : ''}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={numeric.includes(j) ? 'n' : ''}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

/** Shown on analysis pages until data has been imported. */
export function NeedData({ what = 'BMS trend data' }: { what?: string }) {
  const { setPage } = useStore();
  return (
    <div className="card empty">
      <h2>No data yet</h2>
      <p>Import {what} to see this page.</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn primary" onClick={() => setPage('import')}>Go to Data Import</button>
        <button className="btn" onClick={() => setPage('logger')}>Fluke logger only…</button>
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      {label}
      {children}
      {hint && <span className="hint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{hint}</span>}
    </label>
  );
}

export function NumberField({ label, value, onChange, step = 'any', hint, min }: { label: string; value: number; onChange: (v: number) => void; step?: string; hint?: string; min?: number }) {
  return (
    <Field label={label} hint={hint}>
      <input type="number" value={Number.isFinite(value) ? value : ''} step={step} min={min} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); }} />
    </Field>
  );
}

export const NAV: { id: PageId; label: string; icon: string; group?: number }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦', group: 0 },
  { id: 'import', label: 'Data Import', icon: '⇪', group: 0 },
  { id: 'mapping', label: 'Column Mapping', icon: '⇄', group: 0 },
  { id: 'plant', label: 'Plant Settings', icon: '⚙', group: 0 },
  { id: 'logger', label: 'Logger Import', icon: '⌁', group: 0 },
  { id: 'analysis', label: 'Analysis', icon: '∑', group: 1 },
  { id: 'regression', label: 'Regression', icon: '↗', group: 1 },
  { id: 'performance', label: 'Performance', icon: '◔', group: 1 },
  { id: 'chillers', label: 'Chiller Comparison', icon: '❄', group: 1 },
  { id: 'findings', label: 'Findings', icon: '⚑', group: 1 },
  { id: 'export', label: 'Export', icon: '⇩', group: 2 },
  { id: 'settings', label: 'Settings', icon: '☰', group: 3 },
  { id: 'license', label: 'License', icon: '🔑', group: 3 },
  { id: 'about', label: 'About', icon: 'ⓘ', group: 3 },
];
