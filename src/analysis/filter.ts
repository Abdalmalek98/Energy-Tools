import type { ChillerRow, ExclusionCounts, PlantRow, Row, Settings } from '../types';
import { mean } from '../utils/stats';

export function ratedTROf(id: string, s: Settings): number {
  return s.chillerOverrides[id]?.ratedTR ?? s.ratedTR;
}
export function ratedKwPerTROf(id: string, s: Settings): number {
  return s.chillerOverrides[id]?.ratedKwPerTR ?? s.ratedKwPerTR;
}

/**
 * Row filtering. Every applicable reason is counted separately (a row can be counted under
 * several reasons); `excluded` counts distinct rows.
 */
export function filterRows(rows: Row[], s: Settings): { kept: ChillerRow[]; counts: ExclusionCounts } {
  const counts: ExclusionCounts = {
    total: rows.length,
    kept: 0,
    excluded: 0,
    reasons: { nonNumeric: 0, lowPower: 0, lowLoad: 0, outlier: 0, badTimestamp: 0 },
  };
  const kept: ChillerRow[] = [];
  for (const r of rows) {
    const rated = ratedTROf(r.chiller, s);
    let bad = false;
    if (!Number.isFinite(r.ts)) {
      counts.reasons.badTimestamp++;
      bad = true;
    }
    const numeric = Number.isFinite(r.kW) && Number.isFinite(r.load);
    if (!numeric) {
      counts.reasons.nonNumeric++;
      bad = true;
    } else {
      if (r.kW <= 1) {
        counts.reasons.lowPower++;
        bad = true;
      }
      if (r.load <= rated * s.minPLR) {
        counts.reasons.lowLoad++;
        bad = true;
      }
      if (s.outlierFilter && r.load > 0) {
        const e = r.kW / r.load;
        if (e < s.outlierMin || e > s.outlierMax) {
          counts.reasons.outlier++;
          bad = true;
        }
      }
    }
    if (bad) {
      counts.excluded++;
      continue;
    }
    counts.kept++;
    kept.push({ ...r, kwPerTR: r.kW / r.load, plr: r.load / rated, ratedTR: rated });
  }
  return { kept, counts };
}

/**
 * Plant aggregation per timestamp: kW and TR summed; aux = max (or sum) of the rows' aux;
 * ECWT / LCHWT / ECHWT averaged over finite values.
 */
export function aggregatePlant(rows: ChillerRow[], s: Settings): PlantRow[] {
  const by = new Map<number, ChillerRow[]>();
  for (const r of rows) {
    const a = by.get(r.ts);
    if (a) a.push(r);
    else by.set(r.ts, [r]);
  }
  const fin = (a: number[]) => a.filter(Number.isFinite);
  const out: PlantRow[] = [];
  for (const ts of [...by.keys()].sort((a, b) => a - b)) {
    const g = by.get(ts)!;
    const aux = fin(g.map((r) => r.aux));
    let auxV = 0;
    if (aux.length) auxV = s.auxMode === 'max' ? Math.max(...aux) : aux.reduce((x, y) => x + y, 0);
    out.push({
      ts,
      kW: g.reduce((x, r) => x + r.kW, 0),
      tr: g.reduce((x, r) => x + r.load, 0),
      aux: auxV,
      ecwt: mean(fin(g.map((r) => r.ecwt))),
      lchwt: mean(fin(g.map((r) => r.lchwt))),
      echwt: mean(fin(g.map((r) => r.echwt))),
      nRunning: g.length,
    });
  }
  return out;
}
