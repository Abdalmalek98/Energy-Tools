import type {
  HourlyWeatherAnalysis, HourlyWeatherRow, PlantRow, Settings, WeatherBin, WeatherCandidate, WeatherHourlyData, WeatherPredictorSet,
} from '../types';
import { fitWeatherModel, type WeatherSample } from '../regression/weather';
import { mean } from '../utils/stats';

const HOUR = 3600000;
const MIN_RUNNING_COVERAGE = 0.5; // an hour counts as "running" when the plant has rows for ≥ half of it
const MIN_OBSERVED_COVERAGE = 0.9; // …and as "logged" when ≥ 90 % of it has timestamps in the data

function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 3) return null;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

function bins(rows: HourlyWeatherRow[], value: (r: HourlyWeatherRow) => number | null, width: number, unit: string): WeatherBin[] {
  const pts = rows.filter((r) => value(r) !== null);
  if (!pts.length) return [];
  const vals = pts.map((r) => value(r) as number);
  const lo0 = Math.floor(Math.min(...vals) / width) * width;
  const hi0 = Math.ceil((Math.max(...vals) + 1e-9) / width) * width;
  const out: WeatherBin[] = [];
  for (let lo = lo0; lo < hi0; lo += width) {
    const g = pts.filter((r) => (value(r) as number) >= lo && (value(r) as number) < lo + width);
    const sk = g.reduce((a, r) => a + r.kW, 0);
    const st = g.reduce((a, r) => a + r.tr, 0);
    out.push({ label: `${lo}–${lo + width} ${unit}`, lo, hi: lo + width, hours: g.length, avgKW: g.length ? sk / g.length : NaN, avgTR: g.length ? st / g.length : NaN, kwPerTR: st > 0 ? sk / st : NaN });
  }
  return out.filter((b) => b.hours > 0);
}

/**
 * Join plant results with hourly weather and relate plant kW (and cooling delivered) to temperature, enthalpy and
 * temperature + humidity. `observed` = logged hours per clock hour from ALL data timestamps.
 * By default only hours in which the plant ran are used (efficiency and load relationships are meaningless for
 * hours with the plant off); `settings.weatherIncludeOffHours` adds the logged off hours as zero-energy hours.
 */
export function analyzeHourlyWeather(plant: PlantRow[], intervalHours: number, observed: Map<number, number>, w: WeatherHourlyData, s: Settings): HourlyWeatherAnalysis {
  const notes: string[] = [...w.notes];
  const wx = new Map(w.hours.map((x) => [x.ts, x]));
  const acc = new Map<number, { kw: number; tr: number; n: number }>();
  for (const p of plant) {
    const h = Math.floor(p.ts / HOUR) * HOUR;
    const a = acc.get(h) ?? { kw: 0, tr: 0, n: 0 };
    a.kw += p.kW + p.aux;
    a.tr += p.tr;
    a.n++;
    acc.set(h, a);
  }
  const hoursAll = [...new Set([...acc.keys(), ...observed.keys()])].sort((a, b) => a - b);
  const rows: HourlyWeatherRow[] = [];
  let noWeather = 0;
  let partial = 0;
  for (const ts of hoursAll) {
    const a = acc.get(ts);
    const obsH = Math.min(1, observed.get(ts) ?? 0);
    const runCov = a ? (a.n * intervalHours) : 0;
    const running = runCov >= MIN_RUNNING_COVERAGE;
    const x = wx.get(ts);
    const denom = Math.max(obsH, runCov, 1e-9);
    const kW = a ? (a.kw * intervalHours) / denom : 0;
    const tr = a ? (a.tr * intervalHours) / denom : 0;
    const row: HourlyWeatherRow = {
      ts, kW, tr, kwPerTR: tr > 0 ? kW / tr : NaN, tempC: x ? x.tempC : null, rh: x?.rh ?? null, enthalpy: x?.enthalpy ?? null, expectedKW: null, used: false,
    };
    rows.push(row);
    if (!x) { noWeather++; continue; }
    if (running) row.used = true;
    else if (s.weatherIncludeOffHours && obsH >= MIN_OBSERVED_COVERAGE) row.used = true;
    else partial++;
  }
  const used = rows.filter((r) => r.used);
  const result: HourlyWeatherAnalysis = {
    fileName: w.fileName, rows, usedHours: used.length, skipped: { noWeather, partial }, candidates: [], selected: null,
    correlations: { temperature: null, humidity: null, enthalpy: null }, reference: null, normalised: null, tempBins: [], enthalpyBins: null,
    hasHumidity: w.hasHumidity, hasEnthalpy: w.hasEnthalpy, enthalpyComputed: w.enthalpyComputed, notes,
  };
  if (noWeather) notes.push(`${noWeather} logged hour(s) have no weather record and were left out.`);
  if (partial) notes.push(`${partial} hour(s) with the plant off or barely running were left out (enable "include off hours" in Plant Settings to keep them).`);
  if (used.length < 24) {
    notes.push(`Only ${used.length} usable hour(s) overlap the weather data – at least 24 are needed for a regression.`);
    return result;
  }
  const temps = used.map((r) => r.tempC as number);
  if (new Set(temps.map((t) => t.toFixed(2))).size < 3) {
    notes.push('Temperature hardly varies over the usable hours – a weather regression is not meaningful.');
    return result;
  }

  const sample = (field: 'kW' | 'tr') => used.map((r): WeatherSample => ({ tempC: r.tempC as number, rh: r.rh, enthalpy: r.enthalpy, y: r[field] }));
  const energyS = sample('kW');
  const loadS = sample('tr');
  const sets: { id: WeatherPredictorSet; label: string; ok: boolean }[] = [
    { id: 'temperature', label: 'Temperature', ok: true },
    { id: 'enthalpy', label: w.enthalpyComputed ? 'Enthalpy (computed from T & RH)' : 'Enthalpy', ok: used.filter((r) => r.enthalpy !== null).length >= 24 },
    { id: 'temperature+humidity', label: 'Temperature + humidity', ok: used.filter((r) => r.rh !== null).length >= 24 },
  ];
  const candidates: WeatherCandidate[] = [];
  for (const c of sets) {
    if (!c.ok) continue;
    const energy = fitWeatherModel(c.id, energyS);
    if (!energy) continue;
    candidates.push({ id: c.id, label: c.label, energy, load: fitWeatherModel(c.id, loadS) });
  }
  result.candidates = candidates;
  if (!candidates.length) { notes.push('The weather regression could not be computed.'); return result; }

  // same selection rule as the plant regression: move on only if CV(RMSE) < 95 % of the best AND adjusted R² is higher
  let best = candidates[0];
  for (const c of candidates.slice(1)) if (c.energy.cv < 0.95 * best.energy.cv && c.energy.adjR2 > best.energy.adjR2) best = c;
  result.selected = best;

  const x1 = (r: HourlyWeatherRow) => (best.id === 'enthalpy' ? (r.enthalpy as number) : (r.tempC as number));
  for (const r of used) {
    r.expectedKW = best.id === 'enthalpy' || best.id === 'temperature' ? best.energy.predict(x1(r)) : best.energy.predict(r.tempC as number, r.rh as number);
  }

  const kws = used.map((r) => r.kW);
  result.correlations.temperature = pearson(temps, kws);
  const withRh = used.filter((r) => r.rh !== null);
  const withH = used.filter((r) => r.enthalpy !== null);
  result.correlations.humidity = withRh.length >= 24 ? pearson(withRh.map((r) => r.rh as number), withRh.map((r) => r.kW)) : null;
  result.correlations.enthalpy = withH.length >= 24 ? pearson(withH.map((r) => r.enthalpy as number), withH.map((r) => r.kW)) : null;

  // weather-normalised: mean weather of the analysed hours
  const ref = { tempC: mean(temps), rh: withRh.length ? mean(withRh.map((r) => r.rh as number)) : null, enthalpy: withH.length ? mean(withH.map((r) => r.enthalpy as number)) : null };
  result.reference = ref;
  if (best.load) {
    const at = (m: typeof best.energy) => (best.id === 'enthalpy' ? m.predict(ref.enthalpy as number) : best.id === 'temperature' ? m.predict(ref.tempC) : m.predict(ref.tempC, ref.rh as number));
    const kW = at(best.energy);
    const tr = at(best.load);
    result.normalised = { kW, tr, kwPerTR: tr > 0 ? kW / tr : NaN };
  }
  result.tempBins = bins(used, (r) => r.tempC, 2, '°C');
  result.enthalpyBins = withH.length >= 24 ? bins(used, (r) => r.enthalpy, 5, 'kJ/kg') : null;
  if (best.energy.coefs[1].value <= 0 && best.id !== 'enthalpy') notes.push('Plant power does not rise with temperature in this data (slope ≤ 0) – the plant is not weather driven over this period, or the weather file does not match (check the time convention and time zone).');
  return result;
}
