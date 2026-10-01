import type { CddAnalysis, CddData, DailyRow, PlantRow, Settings } from '../types';
import { fitCddLinear } from '../regression/cdd';
import { mean } from '../utils/stats';

const DAY_MS = 86400000;
const dayOf = (ts: number) => Math.floor(ts / DAY_MS) * DAY_MS;

/** CDD for a day, honouring a changed base temperature when the source was a temperature file. */
export function cddValue(d: CddData['days'][number], source: CddData['source'], s: Pick<Settings, 'cddBaseTemp'>): number {
  return source === 'temperature' && d.tempC !== undefined ? Math.max(0, d.tempC - s.cddBaseTemp) : d.cdd;
}

/**
 * Daily roll-up of the plant results joined with customer-supplied CDD, a daily regression of energy and cooling
 * delivered on CDD, and weather-normalised results.
 *
 * `observedHours` = logged hours per day taken from ALL timestamps in the data (not only rows that passed the filters),
 * so hours with the plant off are still "covered"; a day enters the regression when coverage ≥ settings.cddMinCoverage.
 */
export function analyzeCdd(plant: PlantRow[], intervalHours: number, observedHours: Map<number, number>, cdd: CddData, s: Settings): CddAnalysis {
  const notes: string[] = [...cdd.notes];
  const cddByDay = new Map(cdd.days.map((d) => [d.day, cddValue(d, cdd.source, s)]));

  const acc = new Map<number, { ch: number; aux: number; tr: number }>();
  for (const p of plant) {
    const d = dayOf(p.ts);
    const a = acc.get(d) ?? { ch: 0, aux: 0, tr: 0 };
    a.ch += p.kW * intervalHours;
    a.aux += p.aux * intervalHours;
    a.tr += p.tr * intervalHours;
    acc.set(d, a);
  }
  const allDays = [...new Set([...acc.keys(), ...observedHours.keys()])].sort((a, b) => a - b);
  const days: DailyRow[] = allDays.map((day) => {
    const a = acc.get(day) ?? { ch: 0, aux: 0, tr: 0 };
    const hours = Math.min(24, observedHours.get(day) ?? 0);
    const kWh = a.ch + a.aux;
    return {
      day, hoursLogged: hours, coverage: hours / 24, chillerKWh: a.ch, auxKWh: a.aux, kWh, trHours: a.tr,
      kwPerTR: a.tr > 0 ? kWh / a.tr : NaN, cdd: cddByDay.get(day) ?? null, expectedKWh: null, residualKWh: null, used: false,
    };
  });

  let noCdd = 0;
  let partial = 0;
  for (const d of days) {
    if (d.cdd === null) noCdd++;
    else if (d.coverage < s.cddMinCoverage) partial++;
    else d.used = true;
  }
  const used = days.filter((d) => d.used);
  const result: CddAnalysis = {
    fileName: cdd.fileName, source: cdd.source, days, usedDays: used.length, skipped: { noCdd, partial },
    energyModel: null, loadModel: null, refCdd: NaN, refLabel: '', normalised: null, annual: null,
    weatherShare: null, baseShare: null, actualKWh: 0, expectedKWh: 0, firstHalfResidualPct: null, secondHalfResidualPct: null, notes,
  };
  if (noCdd) notes.push(`${noCdd} logged day(s) have no CDD value in the weather file and were left out.`);
  if (partial) notes.push(`${partial} day(s) are less than ${Math.round(s.cddMinCoverage * 100)} % logged and were left out of the regression.`);
  if (used.length < 5) {
    notes.push(`Only ${used.length} complete day(s) with CDD overlap – at least 5 are needed for a regression.`);
    return result;
  }
  const x = used.map((d) => d.cdd as number);
  if (new Set(x.map((v) => v.toFixed(4))).size < 3) {
    notes.push('CDD hardly varies over the analysed days (fewer than 3 distinct values) – a CDD regression is not meaningful.');
    return result;
  }
  result.energyModel = fitCddLinear(x, used.map((d) => d.kWh));
  result.loadModel = fitCddLinear(x, used.map((d) => d.trHours));
  const em = result.energyModel;
  const lm = result.loadModel;
  if (!em) {
    notes.push('The CDD regression could not be computed.');
    return result;
  }
  for (const d of used) {
    d.expectedKWh = em.predict(d.cdd as number);
    d.residualKWh = d.kWh - d.expectedKWh;
  }
  result.actualKWh = used.reduce((a, d) => a + d.kWh, 0);
  result.expectedKWh = used.reduce((a, d) => a + (d.expectedKWh as number), 0);

  // reference CDD for normalisation: a typical year when supplied, else the mean CDD of the analysed days
  const meanCdd = mean(x);
  if (s.typicalAnnualCdd > 0) {
    result.refCdd = s.typicalAnnualCdd / 365;
    result.refLabel = `typical year (${s.typicalAnnualCdd.toFixed(0)} CDD/yr ÷ 365)`;
  } else {
    result.refCdd = meanCdd;
    result.refLabel = 'mean CDD of the analysed days';
  }
  const b = em.coefs.map((c) => c.value);
  const meanKWh = mean(used.map((d) => d.kWh));
  result.weatherShare = meanKWh > 0 ? (b[1] * meanCdd) / meanKWh : null;
  result.baseShare = meanKWh > 0 ? b[0] / meanKWh : null;
  if (lm) {
    const kwhRef = em.predict(result.refCdd);
    const trhRef = lm.predict(result.refCdd);
    result.normalised = { kWhPerDay: kwhRef, trHoursPerDay: trhRef, kwPerTR: trhRef > 0 ? kwhRef / trhRef : NaN };
    if (s.typicalAnnualCdd > 0) {
      const bl = lm.coefs.map((c) => c.value);
      result.annual = { typicalCdd: s.typicalAnnualCdd, kWh: 365 * b[0] + b[1] * s.typicalAnnualCdd, trHours: 365 * bl[0] + bl[1] * s.typicalAnnualCdd };
    }
  }
  if (b[1] <= 0) notes.push('Energy does not rise with CDD in this data (slope ≤ 0) – the plant is not weather driven over this period, or the weather file does not match.');

  // drift of actual vs weather-expected: first vs second half of the analysed period
  const mid = Math.floor(used.length / 2);
  const pct = (rows: DailyRow[]) => {
    const e = rows.reduce((a, d) => a + (d.expectedKWh as number), 0);
    return e > 0 ? (rows.reduce((a, d) => a + d.kWh, 0) / e - 1) * 100 : null;
  };
  if (used.length >= 8) {
    result.firstHalfResidualPct = pct(used.slice(0, mid));
    result.secondHalfResidualPct = pct(used.slice(mid));
  }
  return result;
}
