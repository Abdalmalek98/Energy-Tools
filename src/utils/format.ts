export function fmt(v: number | undefined | null, digits = 2): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export const fmt0 = (v: number | undefined | null) => fmt(v, 0);

export function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}
/** Timestamps are naive local times encoded as UTC ms. */
export function fmtTs(ts: number): string {
  if (!Number.isFinite(ts)) return '—';
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
export function fmtDate(ts: number): string {
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
