import type { AnalysisResult, LoggerAnalysis, LoggerData } from '../types';

export interface XY { x: number; y: number; }

/** Evenly thin an array to at most `max` items (keeps first and last). */
export function thin<T>(a: T[], max: number): T[] {
  if (a.length <= max) return a;
  const out: T[] = [];
  const step = (a.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(a[Math.round(i * step)]);
  return out;
}

export interface HourRow {
  ts: number; // hour start
  hours: number; // logged hours in bucket
  chillerKW: number; // average
  planTR: number; // average
  auxKW: number; // average
  chillerKWh: number;
  auxKWh: number;
  trHours: number;
  peakTR: number;
  ecwt: number;
  lchwt: number;
}

/** Hourly aggregation of plant rows. Efficiency stays energy weighted (sums of kWh and TR·h). */
export function hourlyPlant(a: AnalysisResult): HourRow[] {
  const dt = a.intervalHours;
  const m = new Map<number, { n: number; kw: number; tr: number; aux: number; peak: number; e: number[]; l: number[] }>();
  for (const p of a.plantRows) {
    const h = Math.floor(p.ts / 3600000) * 3600000;
    const g = m.get(h) ?? { n: 0, kw: 0, tr: 0, aux: 0, peak: 0, e: [], l: [] };
    g.n++; g.kw += p.kW; g.tr += p.tr; g.aux += p.aux; g.peak = Math.max(g.peak, p.tr);
    if (Number.isFinite(p.ecwt)) g.e.push(p.ecwt);
    if (Number.isFinite(p.lchwt)) g.l.push(p.lchwt);
    m.set(h, g);
  }
  const avg = (v: number[]) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN);
  return [...m.entries()].sort((x, y) => x[0] - y[0]).map(([ts, g]) => ({
    ts, hours: g.n * dt, chillerKW: g.kw / g.n, planTR: g.tr / g.n, auxKW: g.aux / g.n,
    chillerKWh: g.kw * dt, auxKWh: g.aux * dt, trHours: g.tr * dt, peakTR: g.peak, ecwt: avg(g.e), lchwt: avg(g.l),
  }));
}

export function scatterPlrEff(a: AnalysisResult, max = 1500) {
  return thin(a.chillerRows, max).map((r) => ({ plr: r.plr, eff: r.kwPerTR, ecwt: r.ecwt, chiller: r.chiller }));
}

/** Time series of plant load and (energy-weighted) plant kW/TR, bucketed to at most `max` points. */
export function plantSeries(a: AnalysisResult, max = 800) {
  const rows = a.plantRows;
  const size = Math.max(1, Math.ceil(rows.length / max));
  const out: { ts: number; tr: number; kwPerTR: number; chillerKwPerTR: number }[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const g = rows.slice(i, i + size);
    const tr = g.reduce((x, p) => x + p.tr, 0);
    const kw = g.reduce((x, p) => x + p.kW, 0);
    const aux = g.reduce((x, p) => x + p.aux, 0);
    out.push({ ts: g[Math.floor(g.length / 2)].ts, tr: tr / g.length, kwPerTR: tr > 0 ? (kw + aux) / tr : NaN, chillerKwPerTR: tr > 0 ? kw / tr : NaN });
  }
  return out;
}

export function loggerSeries(d: LoggerData, max = 1500) {
  return thin(d.samples, max);
}

export const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
export const toExcelDate = (ts: number) => (ts - EXCEL_EPOCH) / 86400000;
export type { LoggerAnalysis };
