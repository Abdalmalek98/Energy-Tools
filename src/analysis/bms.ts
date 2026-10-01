import type { ColumnMapping, ParsedBms, RawTable, Row, Settings } from '../types';
import { parseNumber } from '../utils/csv';
import { detectIntervalMinutes, parseTimestamps } from '../utils/timestamps';
import { coolingLoadTR, flowToKgPerS, loadToTR, tempToC } from '../calculations/units';

type Key = keyof ColumnMapping;

const RULES: { key: Key; test: RegExp; not?: RegExp }[] = [
  { key: 'timestamp', test: /(time.?stamp|date.?time|^date$|^time$|datetime|\bdate\b|\btime\b)/i },
  { key: 'chillerId', test: /(chiller|unit|equip|asset|device|machine)[\s_-]*(id|name|no|number|#|tag)\b|^(chiller|unit|equipment|device)$/i },
  { key: 'aux', test: /(aux|ancillar|pump|tower|cooling.?tower|\bct\b|\bfan\b|cwp|chwp|balance.?of.?plant)/i },
  { key: 'flow', test: /(flow|gpm|l\/s|m3\/h|m³\/h)/i },
  { key: 'lchwt', test: /(lchwt|leaving.*(chw|chilled|evap)|chws|chw.?s\b|chilled.*supply|chw.*supply|evap.*leav|supply.*temp|\bleaving\b)/i },
  { key: 'echwt', test: /(echwt|entering.*(chw|chilled|evap)|chwr|chw.?r\b|chilled.*return|chw.*return|evap.*enter|return.*temp)/i },
  { key: 'ecwt', test: /(ecwt|entering.*cond|cond.*enter|cond.*(in|ent)|cwrt|cw.?supply|\boat\b|outdoor|ambient|wet.?bulb|wetbulb|dry.?bulb|\bcwt\b|cw.?in)/i },
  { key: 'load', test: /(cooling.?load|\bload\b|\btr\b|\brt\b|tons?\b|capacity|kwth|kw.?th|btu|tr.?h)/i },
  { key: 'power', test: /(kw|power|demand|watt|energy|kwh|consumption)/i, not: /(aux|th\b|kwth|thermal|flow|load|cool)/i },
];

/** Auto-map columns by header name. Each column is used at most once. */
export function autoMap(headers: string[]): ColumnMapping {
  const map: ColumnMapping = {};
  const used = new Set<number>();
  for (const rule of RULES) {
    for (let i = 0; i < headers.length; i++) {
      if (used.has(i)) continue;
      const h = headers[i];
      if (rule.test.test(h) && !(rule.not && rule.not.test(h))) {
        map[rule.key] = i;
        used.add(i);
        break;
      }
    }
  }
  return map;
}

/**
 * Header-based auto-map plus a data-based step for generic temperature probes ("RTD1", "RTD2", "Temperature (C)"):
 * when LCHWT and ECHWT were not recognised and two probe columns remain, the colder one is the leaving (supply)
 * temperature and the warmer one the entering (return) temperature.
 */
export function autoMapTable(table: RawTable): ColumnMapping {
  const m = autoMap(table.headers);
  const used = new Set(Object.values(m).filter((v): v is number => v !== undefined));
  if (m.lchwt === undefined && m.echwt === undefined) {
    const mean = (i: number) => {
      const v = table.rows.map((r) => parseNumber(r[i])).filter(Number.isFinite);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
    };
    const probes = table.headers
      .map((h, i) => ({ h, i }))
      .filter(({ h, i }) => !used.has(i) && /rtd|temp|\((°?c|°?f)\)/i.test(h) && Number.isFinite(mean(i)))
      .map(({ i }) => ({ i, m: mean(i) }));
    if (probes.length >= 2) {
      probes.sort((a, b) => a.m - b.m);
      m.lchwt = probes[0].i;
      m.echwt = probes[1].i;
    }
  }
  return m;
}

/** Units stated in the column headers, e.g. "Flow (US GPM)", "RTD1 Temperature (C)". */
export function detectUnitSettings(table: RawTable, m: ColumnMapping): Partial<Settings> {
  const out: Partial<Settings> = {};
  const h = (i?: number) => (i === undefined ? '' : table.headers[i] ?? '');
  const f = h(m.flow);
  if (/gpm/i.test(f)) out.flowUnit = 'gpm';
  else if (/m3\/h|m³\/h|m3h/i.test(f)) out.flowUnit = 'm3/h';
  else if (/l\/s|lps/i.test(f)) out.flowUnit = 'L/s';
  const t = `${h(m.lchwt)} ${h(m.echwt)}`;
  if (/\((°\s*)?f\)|°f|deg\s*f/i.test(t)) out.tempUnit = 'F';
  else if (/\((°\s*)?c\)|°c|deg\s*c/i.test(t)) out.tempUnit = 'C';
  // a load column without flow + both temperatures: take the load from the column, unit from its header
  const haveFlowDt = m.flow !== undefined && m.lchwt !== undefined && m.echwt !== undefined;
  if (m.load !== undefined && !haveFlowDt) {
    out.loadSource = 'column';
    const lh = h(m.load);
    out.loadUnit = /kwh.?th|kwh\s*thermal/i.test(lh) ? 'kWhth' : /tr.?h\b|ton.?h/i.test(lh) ? 'TRh' : /kw.?th|kw\s*thermal/i.test(lh) ? 'kWth' : 'TR';
  }
  return out;
}

export class MappingError extends Error {
  constructor(message: string, public detectedColumns: string[]) {
    super(message);
  }
}

const cell = (r: string[], i: number | undefined) => (i === undefined || i < 0 ? undefined : r[i]);

export function parseBms(table: RawTable, mapping: ColumnMapping, s: Settings, opts: { powerOptional?: boolean } = {}): ParsedBms {
  const warnings: string[] = [];
  if (mapping.timestamp === undefined || mapping.timestamp < 0) {
    throw new MappingError(
      `Unable to identify the timestamp column.\n\nDetected columns:\n${table.headers.map((h, i) => `  ${i + 1}. ${h}`).join('\n')}`,
      table.headers,
    );
  }
  if ((mapping.power === undefined || mapping.power < 0) && !opts.powerOptional) {
    throw new MappingError(
      `Unable to identify the chiller power/energy column.\n\nDetected columns:\n${table.headers.map((h, i) => `  ${i + 1}. ${h}`).join('\n')}`,
      table.headers,
    );
  }
  if (s.loadSource === 'flowDT') {
    if ([mapping.flow, mapping.lchwt, mapping.echwt].some((v) => v === undefined || v < 0)) {
      throw new MappingError(
        'Cooling load is set to "Flow × ΔT" but the CHW flow, LCHWT and/or ECHWT column is not mapped.\n\nMap the columns or switch the cooling-load source to a load column.',
        table.headers,
      );
    }
  } else if (mapping.load === undefined || mapping.load < 0) {
    throw new MappingError('Cooling load is set to a load column but no column is mapped.', table.headers);
  }

  let tsCol = table.rows.map((r) => cell(r, mapping.timestamp) ?? '');
  // Some data loggers write the time into a different column for most rows (first column blank, real time in a
  // trailing unnamed column). Fill blanks from any other column that holds readable timestamps.
  if (tsCol.filter((v) => v.trim() === '').length > table.rows.length * 0.02) {
    const alts = table.headers
      .map((_, i) => i)
      .filter((i) => i !== mapping.timestamp)
      .filter((i) => {
        const vals = table.rows.map((r) => r[i] ?? '').filter((v) => v.trim() !== '');
        return vals.length > table.rows.length * 0.5 && vals.length > 0 && /\d[/\-.]\d|\d:\d/.test(vals[0]) && parseTimestamps(vals.slice(0, 50)).badCount === 0;
      });
    if (alts.length) {
      tsCol = tsCol.map((v, r) => (v.trim() !== '' ? v : table.rows[r][alts[0]] ?? ''));
      warnings.push(`Timestamp column "${table.headers[mapping.timestamp]}" is blank for many rows – the missing times were taken from column ${alts[0] + 1}${table.headers[alts[0]] ? ` ("${table.headers[alts[0]]}")` : ' (unnamed)'}.`);
    }
  }
  const tsParse = parseTimestamps(tsCol);
  const ts = tsParse.values;
  const interval = detectIntervalMinutes(ts);
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new MappingError(
      `Unable to determine the logging interval – fewer than two valid timestamps were found in "${table.headers[mapping.timestamp]}".`,
      table.headers,
    );
  }
  const intervalHours = interval / 60;
  if (tsParse.badCount > 0) warnings.push(`${tsParse.badCount} row(s) have an unreadable timestamp.`);

  // Power
  let kwArr: number[] = table.rows.map((r) => parseNumber(cell(r, mapping.power)));
  const chillerOf = (r: string[]) => {
    const v = cell(r, mapping.chillerId);
    return v !== undefined && v !== '' ? v : mapping.chillerId === undefined ? 'CH1' : 'UNKNOWN';
  };
  const chillers = table.rows.map(chillerOf);
  if (s.powerMode === 'intervalKWh') kwArr = kwArr.map((v) => v / intervalHours);
  else if (s.powerMode === 'cumulativeKWh') {
    const byCh = new Map<string, number[]>();
    chillers.forEach((c, i) => byCh.set(c, [...(byCh.get(c) ?? []), i]));
    const out = new Array<number>(kwArr.length).fill(NaN);
    for (const idx of byCh.values()) {
      idx.sort((a, b) => ts[a] - ts[b]);
      for (let j = 1; j < idx.length; j++) {
        const dtH = (ts[idx[j]] - ts[idx[j - 1]]) / 3600000;
        const d = kwArr[idx[j]] - kwArr[idx[j - 1]];
        out[idx[j]] = dtH > 0 && d >= 0 ? d / dtH : NaN; // negative delta = meter reset
      }
    }
    kwArr = out;
  }

  const rows: Row[] = table.rows.map((r, i) => {
    const lchwt = tempToC(parseNumber(cell(r, mapping.lchwt)), s.tempUnit);
    const echwt = tempToC(parseNumber(cell(r, mapping.echwt)), s.tempUnit);
    let load: number;
    if (s.loadSource === 'flowDT') {
      const flow = flowToKgPerS(parseNumber(cell(r, mapping.flow)), s.flowUnit);
      // Temperatures are already in °C, so ΔT(°C) = ΔT(°F) × 5/9 holds automatically.
      load = coolingLoadTR(flow, echwt, lchwt);
    } else {
      load = loadToTR(parseNumber(cell(r, mapping.load)), s.loadUnit, intervalHours);
    }
    return {
      ts: ts[i],
      chiller: chillers[i],
      kW: kwArr[i],
      load,
      lchwt,
      echwt,
      ecwt: tempToC(parseNumber(cell(r, mapping.ecwt)), s.tempUnit),
      aux: parseNumber(cell(r, mapping.aux)),
    };
  });

  // Data quality: duplicates (same chiller+ts) and gaps
  const seen = new Set<string>();
  let dup = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.ts)) continue;
    const k = `${r.chiller}|${r.ts}`;
    if (seen.has(k)) dup++;
    else seen.add(k);
  }
  const uts = [...new Set(rows.map((r) => r.ts).filter(Number.isFinite))].sort((a, b) => a - b);
  let gaps = 0;
  for (let i = 1; i < uts.length; i++) if (uts[i] - uts[i - 1] > interval * 60000 * 1.5) gaps++;
  if (dup) warnings.push(`${dup} duplicate chiller/timestamp row(s) found.`);
  if (gaps) warnings.push(`${gaps} gap(s) longer than 1.5× the logging interval.`);

  return {
    interval,
    intervalHours,
    rows,
    duplicateCount: dup,
    gapCount: gaps,
    chillers: [...new Set(chillers)],
    parseWarnings: warnings,
  };
}
