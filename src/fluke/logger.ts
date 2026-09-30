import type { LoggerAnalysis, LoggerData, LoggerFlag } from '../types';
import { percentile } from '../utils/stats';
import { fmt } from '../utils/format';

export const RUNNING_MIN_KW = 5;
export const RUNNING_P99_FRACTION = 0.08;

/** Logger-only analysis – works without any BMS data. */
export function analyzeLogger(d: LoggerData): LoggerAnalysis {
  const dtH = d.intervalMinutes / 60;
  const S = d.samples.filter((s) => Number.isFinite(s.kW));
  const kw = S.map((s) => s.kW);
  const p99 = percentile(kw, 99);
  const thr = Math.max(RUNNING_MIN_KW, RUNNING_P99_FRACTION * p99);
  const run = S.map((s) => s.kW > thr);

  let runningKWh = 0, standbyKWh = 0, runN = 0, sbSum = 0, sbN = 0;
  S.forEach((s, i) => {
    if (run[i]) { runningKWh += s.kW * dtH; runN++; } else { standbyKWh += s.kW * dtH; sbSum += s.kW; sbN++; }
  });

  // runs
  const runs: { start: number; end: number }[] = []; // inclusive indices
  let cur = -1;
  run.forEach((r, i) => {
    if (r && cur < 0) cur = i;
    if (!r && cur >= 0) { runs.push({ start: cur, end: i - 1 }); cur = -1; }
  });
  if (cur >= 0) runs.push({ start: cur, end: run.length - 1 });
  const starts = runs.filter((r) => r.start > 0); // a run already active at the first sample is not a start
  const longest = runs.reduce((m, r) => Math.max(m, (r.end - r.start + 1) * dtH), 0);
  const shortRuns = runs.filter((r) => r.start > 0 && r.end < S.length - 1 && (r.end - r.start + 1) * d.intervalMinutes < 30).length;
  const perDay = new Map<string, number>();
  for (const r of starts) {
    const day = new Date(S[r.start].ts).toISOString().slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const maxStartsPerDay = Math.max(0, ...perDay.values());

  const runKw = S.filter((_, i) => run[i]).map((s) => s.kW);
  let peakIdx = 0;
  S.forEach((s, i) => { if (s.kW > S[peakIdx].kW) peakIdx = i; });

  // phases (during running)
  let phaseAvg: [number, number, number] | null = null;
  let dev: number | null = null;
  let neg = false;
  const withPh = S.filter((s, i) => run[i] && s.phases && s.phases.every(Number.isFinite));
  if (withPh.length) {
    phaseAvg = [0, 1, 2].map((p) => withPh.reduce((a, s) => a + s.phases![p], 0) / withPh.length) as [number, number, number];
    const m = (phaseAvg[0] + phaseAvg[1] + phaseAvg[2]) / 3;
    dev = m !== 0 ? (Math.max(...phaseAvg.map((v) => Math.abs(v - m))) / Math.abs(m)) * 100 : 0;
  }
  neg = S.some((s, i) => run[i] && s.phases?.some((v) => Number.isFinite(v) && v < 0));

  const runningHours = runN * dtH;
  const loggedHours = S.length * dtH;
  const standbyKW = sbN ? sbSum / sbN : NaN;
  const a: LoggerAnalysis = {
    chiller: d.chiller, serial: d.serial, rows: S.length, intervalMinutes: d.intervalMinutes, sourceUnit: d.sourceUnit,
    totalKWh: runningKWh + standbyKWh, loggedHours, runningThresholdKW: thr, runningKWh, standbyKWh, runningHours,
    runningShare: loggedHours ? runningHours / loggedHours : NaN, avgRunningKW: runN ? runningKWh / runningHours : NaN,
    p10KW: percentile(runKw, 10), p90KW: percentile(runKw, 90), peakKW: S[peakIdx]?.kW ?? NaN, peakTs: S[peakIdx]?.ts ?? NaN,
    starts: starts.length, longestRunHours: longest, standbyKW, phaseAvgKW: phaseAvg, phaseDeviationPct: dev, negativePhase: neg,
    shortRuns, maxStartsPerDay, flags: [], firstTs: S[0]?.ts ?? NaN, lastTs: S[S.length - 1]?.ts ?? NaN,
  };
  a.flags = loggerFlags(a);
  return a;
}

export function loggerFlags(a: LoggerAnalysis): LoggerFlag[] {
  const f: LoggerFlag[] = [];
  if (a.negativePhase) f.push({ status: 'Priority', title: 'Negative phase power', text: 'One or more phases show negative active power while running – check CT orientation/polarity and voltage-lead connections; the measurement is unreliable until fixed.' });
  if (a.maxStartsPerDay > 4) f.push({ status: 'Action', title: 'Excessive starts', text: `Up to ${a.maxStartsPerDay} starts on a single operating day (limit 4) – short-cycling wears the compressor.` });
  if (a.shortRuns > 0) f.push({ status: 'Review', title: 'Short runs', text: `${a.shortRuns} run(s) shorter than 30 minutes.` });
  if (a.standbyKW > 15) f.push({ status: 'Review', title: 'High standby power', text: `Average standby draw ${fmt(a.standbyKW, 1)} kW exceeds 15 kW (heaters/controls).` });
  if (a.phaseDeviationPct !== null) {
    if (a.phaseDeviationPct > 10) f.push({ status: 'Action', title: 'Phase imbalance', text: `Phase power deviates ${fmt(a.phaseDeviationPct, 1)} % from the mean (>10 %).` });
    else if (a.phaseDeviationPct > 5) f.push({ status: 'Review', title: 'Phase imbalance', text: `Phase power deviates ${fmt(a.phaseDeviationPct, 1)} % from the mean (>5 %).` });
  }
  return f;
}
