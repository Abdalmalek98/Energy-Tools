export function sum(a: number[]): number {
  let s = 0;
  for (const v of a) s += v;
  return s;
}
export function mean(a: number[]): number {
  return a.length ? sum(a) / a.length : NaN;
}
export function std(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (const v of a) s += (v - m) * (v - m);
  return Math.sqrt(s / (a.length - 1));
}
export function min(a: number[]): number {
  let m = Infinity;
  for (const v of a) if (v < m) m = v;
  return m;
}
export function max(a: number[]): number {
  let m = -Infinity;
  for (const v of a) if (v > m) m = v;
  return m;
}
/** Linear-interpolated percentile (p in 0..100) – same as Excel PERCENTILE.INC. */
export function percentile(a: number[], p: number): number {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}
export function median(a: number[]): number {
  return percentile(a, 50);
}
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
