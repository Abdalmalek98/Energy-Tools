import type { CddData, RawTable, Settings, WeatherHour, WeatherHourlyData } from '../types';
import { decodeText, parseNumber, parseTable } from '../utils/csv';
import { parseTimestamps } from '../utils/timestamps';

export class WeatherError extends Error {}

const HOUR = 3600000;
const listCols = (t: RawTable) => t.headers.map((h, i) => `  ${i + 1}. ${h || '(unnamed)'}`).join('\n');

/** Saturation vapour pressure (kPa), Magnus formula – accurate to ~0.1 % over −20…60 °C. */
export const satPressureKPa = (tC: number) => 0.61094 * Math.exp((17.625 * tC) / (tC + 243.04));

/**
 * Specific enthalpy of moist air, kJ/kg dry air:  h = 1.006·T + W·(2501 + 1.86·T),
 * W = 0.622·pv / (P − pv),  pv = RH·psat(T).   (ASHRAE Fundamentals, ch. 1)
 */
export function enthalpyKJkg(tC: number, rhPercent: number, pressureKPa = 101.325): number {
  const pv = Math.min(Math.max(rhPercent, 0), 100) / 100 * satPressureKPa(tC);
  const w = (0.622 * pv) / (pressureKPa - pv);
  return 1.006 * tC + w * (2501 + 1.86 * tC);
}

/**
 * Read an hourly weather file: temperature (required), relative humidity and enthalpy (both optional).
 *  • °F temperatures are converted to °C; enthalpy in Btu/lb to kJ/kg (× 2.326); humidity given as a 0–1 fraction to %.
 *  • Sub-hourly rows are averaged into their hour. Without an enthalpy column but with humidity, enthalpy is computed.
 *  • With `settings.weatherHourEnding`, a stamp of 01:00 is the hour 00:00–01:00.
 */
export function parseWeatherHourly(table: RawTable, settings: Pick<Settings, 'weatherHourEnding' | 'atmPressureKPa'>, fileName = table.fileName ?? 'weather'): WeatherHourlyData {
  const notes: string[] = [];
  const h = table.headers.map((x) => x.toLowerCase());
  if (!table.rows.length) throw new WeatherError('The weather file contains no data rows.');

  let timeIdx = h.findIndex((x) => /(date.?time|time.?stamp|^time$|^date$|\bdate\b|\btime\b|hour)/.test(x));
  if (timeIdx < 0) {
    timeIdx = h.findIndex((_, i) => {
      const vals = table.rows.slice(0, 30).map((r) => r[i] ?? '');
      return vals.every((v) => v !== '') && /\d[/\-.]\d/.test(vals[0]) && parseTimestamps(vals).badCount === 0;
    });
  }
  if (timeIdx < 0) throw new WeatherError(`Unable to identify the date/time column in the weather file.\n\nDetected columns:\n${listCols(table)}`);

  const used = new Set<number>([timeIdx]);
  const find = (re: RegExp, not?: RegExp) => {
    const i = h.findIndex((x, k) => !used.has(k) && re.test(x) && !(not && not.test(x)));
    if (i >= 0) used.add(i);
    return i;
  };
  const tIdx = find(/dry.?bulb|\bt.?db\b|\boat\b|outdoor|ambient|temp|°c|°f|\(c\)|\(f\)/, /dew|wet|wb|max|min|enthalp|humid|soil|water|supply|return/);
  if (tIdx < 0) {
    throw new WeatherError(`No temperature column was found in the weather file.\n\nExpected a column such as "Temperature", "Dry bulb" or "OAT" (°C or °F). Humidity and enthalpy are optional.\n\nDetected columns:\n${listCols(table)}`);
  }
  const rhIdx = find(/humid|\brh\b|%.?rh|rel.?hum/);
  const hIdx = find(/enthalp|\bh\b.*(kj|btu)|(kj\/kg|btu\/lb)/);

  const tp = parseTimestamps(table.rows.map((r) => r[timeIdx] ?? ''));
  if (tp.badCount > table.rows.length * 0.5) throw new WeatherError(`Unable to read the dates/times in "${table.headers[timeIdx]}" (first value: "${table.rows[0][timeIdx]}").`);

  const isF = /\(\s*°?\s*f\s*\)|°\s*f\b|deg\s*f|fahrenheit/i.test(table.headers[tIdx]);
  if (isF) notes.push('Temperatures in °F were converted to °C.');
  const btu = hIdx >= 0 && /btu/i.test(table.headers[hIdx]);
  if (btu) notes.push('Enthalpy in Btu/lb was converted to kJ/kg.');

  const rhRaw = rhIdx >= 0 ? table.rows.map((r) => parseNumber(r[rhIdx])).filter(Number.isFinite) : [];
  const rhFraction = rhRaw.length > 0 && Math.max(...rhRaw) <= 1.0001;
  if (rhFraction) notes.push('Humidity given as a 0–1 fraction was converted to %.');

  const shift = settings.weatherHourEnding ? -HOUR : 0;
  const byHour = new Map<number, { t: number[]; rh: number[]; en: number[] }>();
  let bad = 0;
  table.rows.forEach((r, k) => {
    const ts = tp.values[k];
    let t = parseNumber(r[tIdx]);
    if (!Number.isFinite(ts) || !Number.isFinite(t)) { bad++; return; }
    if (isF) t = ((t - 32) * 5) / 9;
    // an hour stamped 01:00 with hour-ending convention belongs to the hour starting 00:00; otherwise floor to the hour
    const hour = Math.floor(ts / HOUR) * HOUR + shift;
    const g = byHour.get(hour) ?? { t: [], rh: [], en: [] };
    g.t.push(t);
    if (rhIdx >= 0) { const v = parseNumber(r[rhIdx]); if (Number.isFinite(v)) g.rh.push(rhFraction ? v * 100 : v); }
    if (hIdx >= 0) { const v = parseNumber(r[hIdx]); if (Number.isFinite(v)) g.en.push(btu ? v * 2.326 : v); }
    byHour.set(hour, g);
  });
  if (!byHour.size) throw new WeatherError('No usable rows were found in the weather file (dates or temperatures could not be read).');
  if (bad) notes.push(`${bad} row(s) with an unreadable time or temperature were skipped.`);

  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const hours: WeatherHour[] = [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([ts, g]) => {
    const w: WeatherHour = { ts, tempC: avg(g.t) };
    if (g.rh.length) w.rh = Math.min(100, Math.max(0, avg(g.rh)));
    if (g.en.length) w.enthalpy = avg(g.en);
    return w;
  });
  const hasHumidity = hours.some((x) => x.rh !== undefined);
  const hasEnthalpyCol = hours.some((x) => x.enthalpy !== undefined);
  let enthalpyComputed = false;
  if (!hasEnthalpyCol && hasHumidity) {
    for (const x of hours) if (x.rh !== undefined) x.enthalpy = enthalpyKJkg(x.tempC, x.rh, settings.atmPressureKPa);
    enthalpyComputed = true;
    notes.push(`Enthalpy was computed from temperature and humidity at ${settings.atmPressureKPa} kPa.`);
  }
  if (hours.length > 1) {
    const gaps = hours.slice(1).filter((x, i) => x.ts - hours[i].ts > HOUR * 1.5).length;
    if (gaps) notes.push(`${gaps} gap(s) longer than one hour in the weather data.`);
  }
  notes.unshift(`Temperature from "${table.headers[tIdx]}"${rhIdx >= 0 ? `, humidity from "${table.headers[rhIdx]}"` : ''}${hIdx >= 0 ? `, enthalpy from "${table.headers[hIdx]}"` : ''}.`);
  return { fileName, hours, hasHumidity, hasEnthalpy: hasEnthalpyCol || enthalpyComputed, enthalpyComputed, rowCount: table.rows.length, notes };
}

export function parseWeatherBytes(fileName: string, bytes: Uint8Array, settings: Pick<Settings, 'weatherHourEnding' | 'atmPressureKPa'>): WeatherHourlyData {
  return parseWeatherHourly(parseTable(decodeText(bytes), fileName), settings, fileName);
}

/**
 * Daily CDD from hourly temperatures (days with at least 18 hourly values), so one hourly file also drives the daily
 * CDD analysis when no separate CDD file was uploaded. Keeps the daily mean temperature so the base can be changed.
 */
export function weatherToCdd(w: WeatherHourlyData, settings: Pick<Settings, 'cddBaseTemp'>): CddData {
  const DAY = 24 * HOUR;
  const byDay = new Map<number, number[]>();
  for (const x of w.hours) {
    const d = Math.floor(x.ts / DAY) * DAY;
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(x.tempC);
  }
  const days = [...byDay.entries()].filter(([, v]) => v.length >= 18).sort((a, b) => a[0] - b[0]).map(([day, v]) => {
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    return { day, cdd: Math.max(0, mean - settings.cddBaseTemp), tempC: mean };
  });
  return {
    fileName: w.fileName, source: 'temperature', baseTempC: settings.cddBaseTemp, days, rowCount: w.rowCount,
    notes: [`Daily CDD derived from the hourly temperatures in ${w.fileName} (days with at least 18 hourly values; base ${settings.cddBaseTemp} °C).`],
  };
}
