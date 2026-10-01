import type { CddData, CddDay, RawTable, Settings } from '../types';
import { decodeText, parseNumber, parseTable } from '../utils/csv';
import { parseTimestamps } from '../utils/timestamps';

export class CddError extends Error {}

const DAY_MS = 86400000;
const dayOf = (ts: number) => Math.floor(ts / DAY_MS) * DAY_MS;
const listCols = (t: RawTable) => t.headers.map((h, i) => `  ${i + 1}. ${h || '(unnamed)'}`).join('\n');

/**
 * Read a customer's weather file into daily cooling degree days (CDD).
 *  • A CDD column ("CDD", "Cooling Degree Days") is used as-is (several rows per day are summed, e.g. hourly CDD).
 *  • Otherwise daily temperature is used: a mean/avg column, or (Tmax+Tmin)/2; CDD = max(0, T − base temperature).
 *    Several rows per day (hourly temperatures) are averaged first.
 *  • Temperatures in °F (header says F) are converted to °C. The base temperature setting is always °C.
 */
export function parseCdd(table: RawTable, settings: Pick<Settings, 'cddBaseTemp'>, fileName = table.fileName ?? 'weather'): CddData {
  const notes: string[] = [];
  const h = table.headers.map((x) => x.toLowerCase());
  if (!table.rows.length) throw new CddError('The weather file contains no data rows.');

  // ---- date column
  let dateIdx = h.findIndex((x) => /(^|\b)(date|day|time|timestamp|period)(\b|$)/.test(x));
  if (dateIdx < 0) {
    dateIdx = h.findIndex((_, i) => {
      const vals = table.rows.slice(0, 30).map((r) => r[i] ?? '');
      return vals.every((v) => v !== '') && /\d[/\-.]\d/.test(vals[0]) && parseTimestamps(vals).badCount === 0;
    });
  }
  if (dateIdx < 0) throw new CddError(`Unable to identify the date column in the weather file.\n\nDetected columns:\n${listCols(table)}`);

  // ---- value columns
  const cddIdx = h.findIndex((x) => /\bcdd\b|cooling.?degree|degree.?day/.test(x));
  const tmaxIdx = h.findIndex((x) => /t.?max|max(imum)?\b.*temp|temp.*max|high/.test(x));
  const tminIdx = h.findIndex((x) => /t.?min|min(imum)?\b.*temp|temp.*min|low/.test(x));
  let tmeanIdx = h.findIndex((x, i) => i !== dateIdx && /(mean|avg|average).*temp|temp.*(mean|avg|average)|^t.?(mean|avg)$|^temp(erature)?\b/.test(x) && !/max|min/.test(x));
  if (cddIdx < 0 && tmeanIdx < 0 && (tmaxIdx < 0 || tminIdx < 0)) {
    tmeanIdx = h.findIndex((x, i) => i !== dateIdx && /temp|°c|°f|\(c\)|\(f\)|deg/.test(x) && !/max|min/.test(x));
  }
  if (cddIdx < 0 && tmeanIdx < 0 && (tmaxIdx < 0 || tminIdx < 0)) {
    throw new CddError(`No CDD or temperature column was found in the weather file.\n\nExpected a column named "CDD" / "Cooling Degree Days", or daily temperature ("Temperature", "Tmean", or both "Tmax" and "Tmin").\n\nDetected columns:\n${listCols(table)}`);
  }

  const tp = parseTimestamps(table.rows.map((r) => r[dateIdx] ?? ''));
  if (tp.badCount > table.rows.length * 0.5) throw new CddError(`Unable to read the dates in "${table.headers[dateIdx]}" (first value: "${table.rows[0][dateIdx]}").`);

  const useCdd = cddIdx >= 0;
  const fahrenheit = (i: number) => /\(\s*°?\s*f\s*\)|°\s*f\b|deg\s*f|fahrenheit/i.test(table.headers[i] ?? '');
  const toC = (v: number, i: number) => (fahrenheit(i) ? ((v - 32) * 5) / 9 : v);
  if (!useCdd && [tmeanIdx, tmaxIdx, tminIdx].some((i) => i >= 0 && fahrenheit(i))) notes.push('Temperatures in °F were converted to °C.');

  const byDay = new Map<number, number[]>();
  let bad = 0;
  table.rows.forEach((r, k) => {
    const ts = tp.values[k];
    if (!Number.isFinite(ts)) { bad++; return; }
    let v: number;
    if (useCdd) v = parseNumber(r[cddIdx]);
    else if (tmeanIdx >= 0) v = toC(parseNumber(r[tmeanIdx]), tmeanIdx);
    else v = (toC(parseNumber(r[tmaxIdx]), tmaxIdx) + toC(parseNumber(r[tminIdx]), tminIdx)) / 2;
    if (!Number.isFinite(v)) { bad++; return; }
    const d = dayOf(ts);
    const arr = byDay.get(d);
    if (arr) arr.push(v); else byDay.set(d, [v]);
  });
  if (!byDay.size) throw new CddError('No usable rows were found in the weather file (dates or values could not be read).');
  if (bad) notes.push(`${bad} row(s) with an unreadable date or value were skipped.`);

  const multi = [...byDay.values()].some((a) => a.length > 1);
  const days: CddDay[] = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, vals]) => {
    if (useCdd) return { day, cdd: Math.max(0, vals.reduce((x, y) => x + y, 0)) }; // hourly CDD shares add up to the daily CDD
    const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
    return { day, cdd: Math.max(0, mean - settings.cddBaseTemp), tempC: mean };
  });
  if (multi) notes.push(useCdd ? 'Several CDD rows per day were summed.' : 'Several temperature rows per day were averaged before computing CDD.');
  if (useCdd) notes.push(`CDD taken from column "${table.headers[cddIdx]}".`);
  else notes.push(`CDD computed from ${tmeanIdx >= 0 ? `"${table.headers[tmeanIdx]}"` : `(Tmax + Tmin)/2`} with a base temperature of ${settings.cddBaseTemp} °C.`);
  return { fileName, source: useCdd ? 'cdd' : 'temperature', baseTempC: useCdd ? undefined : settings.cddBaseTemp, days, rowCount: table.rows.length, notes };
}

export function parseCddBytes(fileName: string, bytes: Uint8Array, settings: Pick<Settings, 'cddBaseTemp'>): CddData {
  return parseCdd(parseTable(decodeText(bytes), fileName), settings, fileName);
}
