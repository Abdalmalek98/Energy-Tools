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
  // a single-meter BMS file has only one chiller: a lone logger belongs to it whatever it is called
  return hit ?? (bmsChillers.length === 1 ? bmsChillers[0] : logger.chiller);
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
 * midpoint lies in [T − Δ/2, T + Δ/2] are averaged (loggers on the same chiller are summed); if none, the nearest sample within one Δ is used.
 * Returns NEW rows with `kWLogger` populated; the original BMS `kW` is untouched. Independent of upload order.
 */
export function mergeLoggers(bms: ParsedBms, attachments: LoggerAttachment[]): { rows: Row[]; matched: number; window: [number, number] | null } {
  const half = (bms.interval * 60000) / 2;
  const full = bms.interval * 60000;
  // one sorted series per logger; loggers attached to the same chiller are different meters (e.g. one per
  // feeder) so their per-window means are SUMMED, never pooled.
  type Series = { ts: number[]; kW: number[] };
  const byChiller = new Map<string, Series[]>();
  for (const a of attachments) {
    const pairs = a.logger.samples.filter((s) => Number.isFinite(s.kW)).sort((x, y) => x.ts - y.ts);
    if (!pairs.length) continue;
    const key = lower(a.chiller);
    byChiller.set(key, [...(byChiller.get(key) ?? []), { ts: pairs.map((p) => p.ts), kW: pairs.map((p) => p.kW) }]);
  }
  let wmin = Infinity;
  let wmax = -Infinity;
  for (const list of byChiller.values()) {
    for (const v of list) {
      wmin = Math.min(wmin, v.ts[0] - half);
      wmax = Math.max(wmax, v.ts[v.ts.length - 1] + half);
    }
  }
  const windowMean = (src: Series, t: number): number => {
    const lo = lowerBound(src.ts, t - half);
    let hi = lowerBound(src.ts, t + half + 1); // inclusive upper bound
    if (hi < lo) hi = lo;
    if (hi > lo) {
      let s = 0;
      for (let i = lo; i < hi; i++) s += src.kW[i];
      return s / (hi - lo);
    }
    // nearest reading within one interval
    let best = -1;
    let bd = Infinity;
    for (const i of [lo - 1, lo]) {
      if (i >= 0 && i < src.ts.length) {
        const d = Math.abs(src.ts[i] - t);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
    }
    return best >= 0 && bd <= full ? src.kW[best] : NaN;
  };
  let matched = 0;
  const rows = bms.rows.map((r) => {
    const list = byChiller.get(lower(r.chiller));
    if (!list || !Number.isFinite(r.ts)) return { ...r };
    let v = NaN;
    for (const src of list) {
      const m = windowMean(src, r.ts);
      if (Number.isFinite(m)) v = (Number.isFinite(v) ? v : 0) + m;
    }
    if (Number.isFinite(v)) matched++;
    return { ...r, kWLogger: v };
  });
  return { rows, matched, window: Number.isFinite(wmin) ? [wmin, wmax] : null };
}
