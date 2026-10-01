import type {
  CddData,
  AnalysisResult, BinRow, ChillerRow, ChillerSummary, ParsedBms, RegressionResult, Row, Settings,
} from '../types';
import { aggregatePlant, filterRows, ratedKwPerTROf, ratedTROf } from './filter';
import { mergeLoggers, type LoggerAttachment } from './merge';
import { computeKpis } from '../calculations/kpis';
import { KW_PER_TR } from '../calculations/units';
import { computeIplv, regress, type RegSample } from '../regression/models';
import { mean, percentile } from '../utils/stats';
import { fmtDate } from '../utils/format';
import { buildFindings } from './findings';
import { analyzeCdd } from './cddAnalysis';

const fin = (a: number[]) => a.filter(Number.isFinite);

export function statusOf(pct: number): ChillerSummary['status'] {
  if (pct <= 5) return 'On spec';
  if (pct <= 12) return 'Degraded';
  if (pct <= 25) return 'Poor';
  return 'Investigate';
}

/** Bin values by a 0..1 ratio in 10 % steps; the top bin is open-ended. */
export function binRows(rows: { ratio: number; kW: number; tr: number }[], dtH: number): BinRow[] {
  const bins: BinRow[] = Array.from({ length: 10 }, (_, i) => ({
    label: i === 9 ? '90%+' : `${i * 10}–${i * 10 + 10}%`, lo: i / 10, hi: i === 9 ? Infinity : (i + 1) / 10,
    hours: 0, trHours: 0, kWh: 0, kwPerTR: NaN,
  }));
  for (const r of rows) {
    const i = Math.max(0, Math.min(9, Math.floor(r.ratio * 10)));
    bins[i].hours += dtH;
    bins[i].trHours += r.tr * dtH;
    bins[i].kWh += r.kW * dtH;
  }
  for (const b of bins) b.kwPerTR = b.trHours > 0 ? b.kWh / b.trHours : NaN;
  return bins;
}

export interface AnalysisInput {
  bms: ParsedBms;
  settings: Settings;
  attachments?: LoggerAttachment[];
  bmsFileName?: string;
  /** Customer-supplied cooling degree days (or daily temperatures) */
  cdd?: CddData | null;
}

export function analyze(input: AnalysisInput): AnalysisResult {
  const { bms, settings: s } = input;
  const warnings = [...bms.parseWarnings];
  const attachments = input.attachments ?? [];
  let rows: Row[] = bms.rows;

  if (attachments.length) {
    const merged = mergeLoggers(bms, attachments);
    const loggedChillers = new Set(attachments.map((a) => a.chiller.toLowerCase()));
    const win = merged.window;
    rows = merged.rows
      .filter((r) => {
        if (!s.analyseLoggedPeriodOnly || !win) return true;
        return r.ts >= win[0] && r.ts <= win[1];
      })
      .map((r) => {
        if (!loggedChillers.has(r.chiller.toLowerCase())) return r;
        if (Number.isFinite(r.kWLogger)) return { ...r, kW: r.kWLogger as number };
        // logger attached but no reading for this timestamp
        return s.analyseLoggedPeriodOnly ? { ...r, kW: NaN } : r;
      });
    if (!merged.matched) warnings.push('Loggers are attached but none of their readings overlap the BMS timestamps.');
  }

  const { kept, counts } = filterRows(rows, s);
  const plant = aggregatePlant(kept, s);
  const dtH = bms.intervalHours;
  const kpis = computeKpis(plant, kept, dtH, s);

  // Chillers
  const ids = [...new Set(kept.map((r) => r.chiller))].sort();
  const chillerRegressions: RegressionResult[] = [];
  const chillers: ChillerSummary[] = ids.map((id) => {
    const cr = kept.filter((r) => r.chiller === id);
    const ratedTR = ratedTROf(id, s);
    const ratedKw = ratedKwPerTROf(id, s);
    const trh = cr.reduce((a, r) => a + r.load, 0) * dtH;
    const kwh = cr.reduce((a, r) => a + r.kW, 0) * dtH;
    const kwtr = kwh / trh;
    const samples: RegSample[] = cr.map((r) => ({ q: r.load, kW: r.kW, ecwt: r.ecwt, lchwt: r.lchwt }));
    const reg = regress(id, samples, bms.interval);
    chillerRegressions.push(reg);
    const mv = reg.models.find((m) => m.kind === 'multivariate');
    let iplv = null;
    if (mv) {
      const e = fin(cr.map((r) => r.ecwt));
      iplv = computeIplv(mv, ratedTR, {
        ecwtMin: Math.min(...e), ecwtMax: Math.max(...e),
        plrMin: Math.min(...cr.map((r) => r.plr)), plrMax: Math.max(...cr.map((r) => r.plr)),
      });
    }
    const pct = (kwtr / ratedKw - 1) * 100;
    return {
      id, ratedTR, ratedKwPerTR: ratedKw, runHours: cr.length * dtH, trHours: trh, kWh: kwh,
      avgPLR: mean(cr.map((r) => r.plr)), kwPerTR: kwtr, cop: KW_PER_TR / kwtr,
      p10: percentile(cr.map((r) => r.kwPerTR), 10), p90: percentile(cr.map((r) => r.kwPerTR), 90),
      pctVsRated: pct, avgDeltaT: mean(fin(cr.map((r) => r.echwt - r.lchwt))), iplv, status: statusOf(pct),
    };
  });

  // Bins
  const loadProfile = binRows(plant.map((p) => ({ ratio: kpis.installedTR ? p.tr / kpis.installedTR : 0, kW: p.kW + p.aux, tr: p.tr })), dtH);
  const chillerPlrBins: Record<string, BinRow[]> = {};
  for (const id of ids) {
    chillerPlrBins[id] = binRows(kept.filter((r) => r.chiller === id).map((r) => ({ ratio: r.plr, kW: r.kW, tr: r.load })), dtH);
  }

  const plantRegression = plant.length
    ? regress('Plant', plant.map((p) => ({ q: p.tr, kW: p.kW + p.aux, ecwt: p.ecwt, lchwt: p.lchwt })), bms.interval)
    : null;

  const firstTs = plant.length ? plant[0].ts : kept.length ? kept[0].ts : NaN;
  const lastTs = plant.length ? plant[plant.length - 1].ts : NaN;
  if (!kept.length) warnings.push('All rows were excluded by the filters – check the mapping, units and thresholds.');

  const result: AnalysisResult = {
    settings: s, intervalMinutes: bms.interval, intervalHours: dtH, exclusions: counts,
    chillerRows: kept as ChillerRow[], plantRows: plant, kpis, chillers, loadProfile, chillerPlrBins,
    plantRegression, chillerRegressions, findings: [], warnings,
    firstDate: fmtDate(firstTs), lastDate: fmtDate(lastTs),
    sources: { bmsFile: input.bmsFileName, loggers: attachments.map((a) => a.logger.fileName) },
    cdd: null,
  };
  if (input.cdd && kept.length) {
    // logged hours per day from ALL timestamps, so hours with the plant off still count as covered
    const seen = new Map<number, Set<number>>();
    for (const r of rows) {
      if (!Number.isFinite(r.ts)) continue;
      const d = Math.floor(r.ts / 86400000) * 86400000;
      (seen.get(d) ?? seen.set(d, new Set()).get(d)!).add(r.ts);
    }
    const observed = new Map([...seen].map(([d, set]) => [d, set.size * dtH]));
    result.cdd = analyzeCdd(plant, dtH, observed, input.cdd, s);
  }
  result.findings = kept.length ? buildFindings(result, bms) : [];
  return result;
}
