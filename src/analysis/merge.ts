import type { LoggerData, ParsedBms, Row } from '../types';

export interface LoggerAttachment {
  logger: LoggerData;
  chiller: string; // BMS chiller id the logger is attached to
}

const lower = (s: string) => s.toLowerCase();

/** Suggest a chiller id for a logger by matching its name against the BMS chillers. */
export function suggestChiller(logger: LoggerData, bmsChillers: string[]): string {
  const hit = bmsChillers.find((c) => lower(c) === lower(logger.chiller)) ??
    bmsChillers.find((c) => lower(c).includes(lower(logger.chiller)) || lower(logger.chiller).includes(lower(c)));
  return hit ?? logger.chiller;
}

/** First index in sorted `a` with a[i] >= v. */
function lowerBound(a: number[], v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/**
 * Merge logger power onto BMS rows. For BMS timestamp T with interval Δ, logger samples whose
 * midpoint lies in [T − Δ/2, T + Δ/2] are averaged; if none, the nearest sample within one Δ is used.
 * Returns NEW rows with `kWLogger` populated; the original BMS `kW` is untouched. Independent of upload order.
 */
export function mergeLoggers(bms: ParsedBms, attachments: LoggerAttachment[]): { rows: Row[]; matched: number; window: [number, number] | null } {
  const half = (bms.interval * 60000) / 2;
  const full = bms.interval * 60000;
  const byChiller = new Map<string, { ts: number[]; kW: number[] }>();
  for (const a of attachments) {
    const key = lower(a.chiller);
    const cur = byChiller.get(key) ?? { ts: [], kW: [] };
    for (const s of a.logger.samples) {
      if (Number.isFinite(s.kW)) {
        cur.ts.push(s.ts);
        cur.kW.push(s.kW);
      }
    }
    byChiller.set(key, cur);
  }
  // sort
  for (const v of byChiller.values()) {
    const idx = v.ts.map((_, i) => i).sort((a, b) => v.ts[a] - v.ts[b]);
    v.ts = idx.map((i) => v.ts[i]);
    v.kW = idx.map((i) => v.kW[i]);
  }
  let wmin = Infinity;
  let wmax = -Infinity;
  for (const v of byChiller.values()) {
    if (v.ts.length) {
      wmin = Math.min(wmin, v.ts[0] - half);
      wmax = Math.max(wmax, v.ts[v.ts.length - 1] + half);
    }
  }
  let matched = 0;
  const rows = bms.rows.map((r) => {
    const src = byChiller.get(lower(r.chiller));
    if (!src || !Number.isFinite(r.ts)) return { ...r };
    const lo = lowerBound(src.ts, r.ts - half);
    let hi = lowerBound(src.ts, r.ts + half + 1); // inclusive upper bound
    if (hi < lo) hi = lo;
    let v = NaN;
    if (hi > lo) {
      let s = 0;
      for (let i = lo; i < hi; i++) s += src.kW[i];
      v = s / (hi - lo);
    } else {
      // nearest reading within one interval
      let best = -1;
      let bd = Infinity;
      for (const i of [lo - 1, lo]) {
        if (i >= 0 && i < src.ts.length) {
          const d = Math.abs(src.ts[i] - r.ts);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
      }
      if (best >= 0 && bd <= full) v = src.kW[best];
    }
    if (Number.isFinite(v)) matched++;
    return { ...r, kWLogger: v };
  });
  return { rows, matched, window: Number.isFinite(wmin) ? [wmin, wmax] : null };
}
