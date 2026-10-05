import type {
  AnnualMethodResult, AnnualPredictor, AnnualProjection, AnnualScenario, HourlyWeatherAnalysis, HourlyWeatherRow, Settings, WeatherHour, WeatherHourlyData,
} from '../types';
import { wetBulbStull } from './psychro';

const DAY = 86400000;
const HOURS_PER_YEAR = 8760;

const LABEL: Record<AnnualPredictor, string> = { wetbulb: 'Wet-bulb temperature (°C)', temperature: 'Dry-bulb temperature (°C)', enthalpy: 'Enthalpy (kJ/kg)' };

/** Plain least-squares line y = a·x + b with R². Null when x does not vary or fewer than 3 points. */
export function lineFit(x: number[], y: number[]): { slope: number; intercept: number; r2: number; n: number } | null {
  const n = x.length;
  if (n < 3) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); syy += (y[i] - my) ** 2; }
  if (!(sxx > 1e-12)) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  return { slope, intercept, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : 0, n };
}

/** Value of the chosen weather variable for an hour, or null when the inputs for it are missing. */
export function predictorValue(p: AnnualPredictor, h: { tempC: number; rh?: number | null; enthalpy?: number | null }): number | null {
  if (p === 'temperature') return h.tempC;
  if (p === 'enthalpy') return h.enthalpy ?? null;
  return h.rh !== null && h.rh !== undefined ? wetBulbStull(h.tempC, h.rh) : null;
}

export function resolvePredictor(choice: Settings['annualPredictor'], fit: HourlyWeatherAnalysis, typical: WeatherHourlyData): { predictor: AnnualPredictor; note?: string } {
  const both = (p: AnnualPredictor) => {
    if (p === 'temperature') return true;
    if (p === 'enthalpy') return fit.hasEnthalpy && typical.hasEnthalpy;
    return fit.hasHumidity && typical.hasHumidity;
  };
  if (choice !== 'auto') {
    if (both(choice)) return { predictor: choice };
    return { predictor: 'temperature', note: `${LABEL[choice]} needs humidity data in both the logged-period weather and the typical-year file – dry-bulb temperature was used instead.` };
  }
  return { predictor: both('wetbulb') ? 'wetbulb' : 'temperature' };
}

function monthOf(ts: number) { return new Date(ts).getUTCMonth(); }

function project(
  method: 'hourly' | 'daily',
  energy: NonNullable<ReturnType<typeof lineFit>>,
  load: NonNullable<ReturnType<typeof lineFit>>,
  units: { ts: number; x: number }[],
  scale: number,
): AnnualMethodResult {
  const mon = Array.from({ length: 12 }, () => ({ kWh: 0, tr: 0 }));
  for (const u of units) {
    const kwh = Math.max(0, energy.slope * u.x + energy.intercept);
    const trh = Math.max(0, load.slope * kwh + load.intercept);
    const m = mon[monthOf(u.ts)];
    m.kWh += kwh * scale;
    m.tr += trh * scale;
  }
  const kWh = mon.reduce((a, m) => a + m.kWh, 0);
  const trHours = mon.reduce((a, m) => a + m.tr, 0);
  return {
    method, energyModel: energy, loadModel: load, kWh, trHours, kwPerTR: trHours > 0 ? kWh / trHours : NaN,
    monthly: mon.map((m, i) => ({ month: i + 1, kWh: m.kWh, trHours: m.tr, kwPerTR: m.tr > 0 ? m.kWh / m.tr : NaN })),
  };
}

/**
 * Annual consumption from a typical-year weather file, by two regression chains:
 *  • hourly: kWh_h = a·x_h + b, then TR·h_h = c·kWh_h + d, summed over every typical hour;
 *  • daily:  kWh_d = a·Σx_d + b, then TR·h_d = c·kWh_d + d, summed over every typical day (days with 24 hours).
 * x is the wet-bulb temperature (from dry-bulb + humidity), dry-bulb temperature or enthalpy. Negative predictions
 * are clamped to zero. The logged hours used are those the hourly weather analysis kept (plant running).
 */
export function analyzeAnnual(fit: HourlyWeatherAnalysis, typical: WeatherHourlyData, s: Settings): AnnualProjection {
  const notes: string[] = [];
  const { predictor, note } = resolvePredictor(s.annualPredictor, fit, typical);
  if (note) notes.push(note);
  const out: AnnualProjection = {
    typicalFile: typical.fileName, predictor, predictorLabel: LABEL[predictor], fitHours: 0, fitDays: 0, typicalHours: typical.hours.length,
    scaledFrom: null, typical: [], hourly: null, daily: null, methodDifferencePct: null, scenario: null, notes,
  };

  // ---- fit data ----
  const used = fit.rows.filter((r) => r.used);
  const pts: { r: HourlyWeatherRow; x: number }[] = [];
  for (const r of used) {
    if (r.tempC === null) continue;
    const x = predictorValue(predictor, { tempC: r.tempC, rh: r.rh, enthalpy: r.enthalpy });
    if (x !== null && Number.isFinite(x)) pts.push({ r, x });
  }
  out.fitHours = pts.length;
  if (pts.length < 24) { notes.push(`Only ${pts.length} logged hour(s) with weather – at least 24 are needed for an annual projection.`); return out; }

  // ---- typical-year hours ----
  const tx: { ts: number; x: number }[] = [];
  const kept: WeatherHour[] = [];
  let missing = 0;
  for (const h of typical.hours as WeatherHour[]) {
    const x = predictorValue(predictor, h);
    if (x === null || !Number.isFinite(x)) { missing++; continue; }
    tx.push({ ts: h.ts, x });
    kept.push(h);
  }
  if (missing) notes.push(`${missing} typical-year hour(s) lack the ${LABEL[predictor].toLowerCase()} and were skipped.`);
  if (tx.length < 24) { notes.push('The typical-year weather file has too few usable hours.'); return out; }
  out.typical = kept;
  const scale = HOURS_PER_YEAR / tx.length;
  if (Math.abs(scale - 1) > 0.02) {
    out.scaledFrom = tx.length;
    notes.push(`The typical-year file has ${tx.length.toLocaleString()} usable hours instead of ${HOURS_PER_YEAR.toLocaleString()}; annual totals were scaled by ${scale.toFixed(3)}.`);
  }

  // ---- hourly chain ----
  const he = lineFit(pts.map((p) => p.x), pts.map((p) => p.r.kW));
  const hl = he ? lineFit(pts.map((p) => p.r.kW), pts.map((p) => p.r.tr)) : null;
  if (he && hl) out.hourly = project('hourly', he, hl, tx, scale);
  else notes.push('The hourly regression could not be computed (weather variable hardly varies).');

  // ---- daily chain ----
  const dayFit = new Map<number, { x: number; kwh: number; tr: number; n: number }>();
  const hourRows = new Map(fit.rows.map((r) => [r.ts, r]));
  const fitDays = new Set<number>();
  for (const r of fit.rows) fitDays.add(Math.floor(r.ts / DAY) * DAY);
  for (const day of fitDays) {
    let x = 0, kwh = 0, tr = 0, n = 0;
    for (let k = 0; k < 24; k++) {
      const r = hourRows.get(day + k * 3600000);
      if (!r || r.tempC === null) break;
      const v = predictorValue(predictor, { tempC: r.tempC, rh: r.rh, enthalpy: r.enthalpy });
      if (v === null) break;
      x += v; kwh += r.kW; tr += r.tr; n++;
    }
    if (n === 24) dayFit.set(day, { x, kwh, tr, n });
  }
  out.fitDays = dayFit.size;
  const dArr = [...dayFit.values()];
  const de = lineFit(dArr.map((d) => d.x), dArr.map((d) => d.kwh));
  const dl = de ? lineFit(dArr.map((d) => d.kwh), dArr.map((d) => d.tr)) : null;
  if (de && dl) {
    const byDay = new Map<number, { ts: number; x: number; n: number }>();
    for (const h of tx) {
      const d = Math.floor(h.ts / DAY) * DAY;
      const g = byDay.get(d) ?? { ts: d, x: 0, n: 0 };
      g.x += h.x; g.n++;
      byDay.set(d, g);
    }
    const days = [...byDay.values()].filter((g) => g.n === 24);
    if (days.length >= 300) out.daily = project('daily', de, dl, days, HOURS_PER_YEAR / (days.length * 24));
    else notes.push(`Only ${days.length} complete typical days (24 hourly values) – the daily method needs at least 300.`);
  } else notes.push(`Only ${dArr.length} complete logged day(s) with weather – the daily method needs at least 5.`);

  const h = out.hourly, d = out.daily;
  if (h && d && h.kWh > 0) out.methodDifferencePct = ((d.kWh - h.kWh) / h.kWh) * 100;

  // ---- scenario ----
  const base = h ?? d;
  if (base && s.annualProposedKwPerTR > 0) {
    const kWh = base.trHours * s.annualProposedKwPerTR * (1 + s.annualSafetyPct / 100);
    const saving = base.kWh - kWh;
    const sc: AnnualScenario = {
      proposedKwPerTR: s.annualProposedKwPerTR, safetyPct: s.annualSafetyPct, proposedKWh: kWh, savingKWh: saving,
      savingPct: base.kWh > 0 ? (saving / base.kWh) * 100 : 0, savingCost: saving * s.tariff,
    };
    out.scenario = sc;
    notes.push(`Scenario is based on the ${base.method} method's annual cooling load.`);
  }
  return out;
}
