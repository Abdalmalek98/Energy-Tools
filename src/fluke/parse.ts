import JSZip from 'jszip';
import type { LoggerData, LoggerSample, RawTable } from '../types';
import { decodeText, parseNumber, parseTable } from '../utils/csv';
import { detectIntervalMinutes, parseTimestamps } from '../utils/timestamps';
import { binaryMessage, FlukeError, signatureOf } from './errors';
import { sqliteToTable } from './sqlite';

export const SUPPORTED_MODELS = ['1732', '1734', '1736', '1738', '1742', '1746', '1748'];
export const SUPPORTED_EXTENSIONS = ['txt', 'csv', 'fca2', 'fca'];

// Columns that must never be auto-selected as the power series.
const NEVER_AUTO = /(_min\b|_max\b|\bmin\b|\bmax\b|powerq|powers|reactive|apparent|fundamental|fund_|voltage|current|\bpf\b|cos|thd|freq|^u_|^i_|_pf|harm|unbal|flicker|angle)/i;

export interface FlukeOptions {
  /** Force a specific power column (header text). */
  powerColumn?: string;
  /** What the timestamp refers to. Default 'start' (Energy Analyze trend rows are period starts). */
  timestampRefersTo?: 'start' | 'mid' | 'end';
}

function isZip(b: Uint8Array) { return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5); }
function isSqlite(b: Uint8Array) { return b.length > 16 && new TextDecoder('latin1').decode(b.subarray(0, 15)) === 'SQLite format 3'; }

function looksBinary(b: Uint8Array): boolean {
  const n = Math.min(b.length, 2000);
  if (n === 0) return false;
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) return false; // UTF-16 BOM
  let ctrl = 0;
  let nul = 0;
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 0) nul++;
    else if (c < 9 || (c > 13 && c < 32)) ctrl++;
  }
  // UTF-16 without BOM has NULs in alternating positions – decodeText handles; treat as text
  if (nul > 0 && nul >= n / 4 && ctrl === 0) return false;
  return (ctrl + nul) / n > 0.02;
}

export async function parseFlukeFile(fileName: string, bytes: Uint8Array, opts: FlukeOptions = {}): Promise<LoggerData> {
  const sig = signatureOf(bytes);
  if (bytes.length === 0) throw new FlukeError('The file is empty.', sig, 'empty');
  let table: RawTable;
  let preamble = '';
  if (isSqlite(bytes)) {
    const r = await sqliteToTable(bytes, fileName);
    if (!r.table.headers.length) throw new FlukeError(`The SQLite file contains no usable table (tables: ${r.tables.join(', ') || 'none'}).`, sig);
    table = r.table;
  } else if (isZip(bytes)) {
    const zip = await JSZip.loadAsync(bytes).catch(() => null);
    if (!zip) throw new FlukeError(binaryMessage(sig), sig, 'binary');
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    const dbEntry = entries.find((f) => /\.(db|sqlite|sqlite3|fca2db)$/i.test(f.name));
    const textEntries = entries.filter((f) => /\.(csv|txt|tsv)$/i.test(f.name)).sort((a, b) => (b as any)._data?.uncompressedSize - (a as any)._data?.uncompressedSize);
    if (textEntries.length) {
      const inner = await textEntries[0].async('uint8array');
      const tp = extractTable(fileName, inner);
      table = tp.table;
      preamble = tp.preamble;
    } else if (dbEntry) {
      const inner = await dbEntry.async('uint8array');
      if (!isSqlite(inner)) throw new FlukeError(binaryMessage(signatureOf(inner)), signatureOf(inner), 'binary');
      table = (await sqliteToTable(inner, fileName)).table;
    } else {
      throw new FlukeError(`The archive does not contain a CSV/TXT trend export or a database.\nEntries: ${entries.map((e) => e.name).join(', ') || 'none'}`, sig, 'binary');
    }
  } else if (looksBinary(bytes)) {
    throw new FlukeError(binaryMessage(sig), sig, 'binary');
  } else {
    const tp = extractTable(fileName, bytes);
    table = tp.table;
    preamble = tp.preamble;
  }
  return tableToLogger(fileName, table, preamble, opts);
}

/** Find the real header row (files may have metadata lines first) and parse the table below it. */
function extractTable(fileName: string, bytes: Uint8Array): { table: RawTable; preamble: string } {
  const text = decodeText(bytes);
  const lines = text.split(/\r?\n/);
  let hdr = 0;
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    if (/trend_period|powerp_|activeenergy_|date.?time|timestamp|^\s*"?date"?\s*[,;\t]/i.test(lines[i]) && /[,;\t]/.test(lines[i])) {
      hdr = i;
      break;
    }
  }
  const preamble = lines.slice(0, hdr).join('\n');
  const table = parseTable(lines.slice(hdr).join('\n'), fileName);
  return { table, preamble };
}

const UNIT_TOKEN = /^\[?\(?\s*(k?w|k?wh|v|a|var|kvar|va|kva|hz|%|°c|deg|-)?\s*\)?\]?$/i;

function unitFromText(s: string): 'W' | 'kW' | 'Wh' | 'kWh' | null {
  const t = s.trim();
  if (/(^|[\s_\[(])kwh(\b|[\])])/i.test(t)) return 'kWh';
  if (/(^|[\s_\[(])wh(\b|[\])])/i.test(t)) return 'Wh';
  if (/(^|[\s_\[(])kw(\b|[\])])/i.test(t)) return 'kW';
  if (/(^|[\s_\[(])w(\b|[\])])/i.test(t)) return 'W';
  return null;
}

function tableToLogger(fileName: string, table0: RawTable, preamble: string, opts: FlukeOptions): LoggerData {
  let table = table0;
  const notes: string[] = [];
  const headers = table.headers;
  if (!headers.length || !table.rows.length) throw new FlukeError('No data rows were found in the file.', undefined, 'empty');

  // optional unit row directly under the header
  let unitRow: string[] | null = null;
  const first = table.rows[0];
  const numericCells = first.filter((c) => Number.isFinite(parseNumber(c))).length;
  if (numericCells === 0 || (first.filter((c) => c === '' || UNIT_TOKEN.test(c)).length >= first.length * 0.6 && numericCells <= 1)) {
    if (first.some((c) => UNIT_TOKEN.test(c) && c !== '')) {
      unitRow = first;
      table = { ...table, rows: table.rows.slice(1) };
      notes.push('Unit row detected below the header.');
    }
  }
  const rows = table.rows;
  const col = (re: RegExp) => headers.findIndex((h) => re.test(h));

  // ---- timestamp / duration columns
  let tsIdx = col(/^(trend_period|date.?time|time.?stamp|timestamp)/i);
  if (tsIdx < 0) tsIdx = col(/(^|_)(date.?time|time.?stamp|start)/i);
  const dateIdx = col(/^date$/i);
  const timeIdx = col(/^time$/i);
  let durationSec: number | null = null;
  let values: string[] | null = null;
  if (tsIdx >= 0) {
    values = rows.map((r) => (r[tsIdx] ?? '').split(/\s+(?:-|–|to)\s+/i)[0]);
    // Trend_Period may be a duration ("00:05:00" or seconds) rather than a timestamp
    const s0 = (rows[0]?.[tsIdx] ?? '').trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s0) && !/\d{4}/.test(s0)) {
      const [h, m, s] = s0.split(':').map(Number);
      durationSec = h * 3600 + m * 60 + (s || 0);
      values = null;
    }
  }
  if (!values && dateIdx >= 0 && timeIdx >= 0) values = rows.map((r) => `${r[dateIdx]} ${r[timeIdx]}`);
  if (!values && dateIdx >= 0) values = rows.map((r) => r[dateIdx]);
  if (!values) {
    throw new FlukeError(`Unable to identify the timestamp column.\n\nDetected columns:\n${headers.map((h, i) => `  ${i + 1}. ${h}`).join('\n')}`);
  }
  const tp = parseTimestamps(values);
  if (tp.badCount > rows.length * 0.5) {
    throw new FlukeError(`Unable to read the timestamps in "${headers[tsIdx >= 0 ? tsIdx : dateIdx]}" (first value: "${values[0]}").`);
  }
  let interval = detectIntervalMinutes(tp.values);
  if (durationSec) interval = durationSec / 60;
  if (!Number.isFinite(interval)) interval = NaN;
  const dCol = col(/^(trend_)?(period|duration|interval)(_s|_sec)?$/i);
  if (dCol >= 0 && dCol !== tsIdx && !Number.isFinite(interval)) {
    const v = parseNumber(rows[0][dCol]);
    if (Number.isFinite(v)) interval = v > 3600 ? v / 60000 : v / 60;
  }
  if (!Number.isFinite(interval) || interval <= 0) throw new FlukeError('Unable to determine the logging interval (need at least two timestamps).');

  // ---- power column selection
  const auto = (re: RegExp) => headers.findIndex((h) => re.test(h) && !NEVER_AUTO.test(h));
  let powerIdx = -1;
  let powerName = '';
  let derivedFromPhases = false;
  if (opts.powerColumn) {
    powerIdx = headers.indexOf(opts.powerColumn);
    if (powerIdx < 0) throw new FlukeError(`Column "${opts.powerColumn}" not found.`);
    powerName = headers[powerIdx];
  } else {
    powerIdx = auto(/^PowerP_Total_avg$/i);
    if (powerIdx < 0) powerIdx = auto(/^PowerP_Total(_avg)?$/i);
    if (powerIdx < 0) powerIdx = auto(/^PowerP_.*total.*avg/i);
    if (powerIdx < 0) powerIdx = auto(/total.*active.*power.*(avg|average)|active.?power.*total.*(avg|average)|^p_?total(_avg)?$|^total.?(active.?)?power/i);
    if (powerIdx < 0) powerIdx = auto(/^active.?power(.*avg|.*average)?$|^kw$|^power.*\(k?w\)/i);
    if (powerIdx >= 0) powerName = headers[powerIdx];
  }
  const phaseIdx = [1, 2, 3].map((n) => headers.findIndex((h) => new RegExp(`^PowerP_L${n}(_avg)?$`, 'i').test(h)));
  const havePhases = phaseIdx.every((i) => i >= 0);

  let kwSeries: number[] | null = null;
  let sourceUnit: LoggerData['sourceUnit'] = 'W';
  let unitAssumed = false;
  const unitFor = (idx: number, vals: number[]): { unit: 'W' | 'kW' | 'Wh' | 'kWh'; assumed: boolean } => {
    const u = unitFromText(headers[idx]) ?? (unitRow ? unitFromText(unitRow[idx] ?? '') : null);
    if (u) return { unit: u, assumed: false };
    const fin = vals.filter(Number.isFinite).map(Math.abs).sort((a, b) => a - b);
    const p99 = fin[Math.floor(fin.length * 0.99)] ?? 0;
    // Fluke trend exports store PowerP in W; a value above ~20 000 cannot plausibly be kW for a single logger
    return { unit: p99 > 20000 || /^PowerP_/i.test(headers[idx]) ? 'W' : 'kW', assumed: true };
  };

  let powerVals: number[] = [];
  if (powerIdx >= 0) {
    powerVals = rows.map((r) => parseNumber(r[powerIdx]));
    const u = unitFor(powerIdx, powerVals);
    sourceUnit = u.unit;
    unitAssumed = u.assumed;
    const scale = u.unit === 'W' ? 1 / 1000 : u.unit === 'kW' ? 1 : NaN;
    if (Number.isNaN(scale)) {
      // an energy unit on a power column: treat as interval energy
      const h = interval / 60;
      kwSeries = powerVals.map((v) => (u.unit === 'Wh' ? v / 1000 : v) / h);
    } else kwSeries = powerVals.map((v) => v * scale);
  } else if (havePhases) {
    const cols = phaseIdx.map((i) => rows.map((r) => parseNumber(r[i])));
    const u = unitFor(phaseIdx[0], cols[0]);
    sourceUnit = u.unit === 'kW' ? 'kW' : 'W';
    unitAssumed = u.assumed;
    const scale = sourceUnit === 'W' ? 1 / 1000 : 1;
    kwSeries = rows.map((_, i) => (cols[0][i] + cols[1][i] + cols[2][i]) * scale);
    powerName = 'PowerP_L1+L2+L3';
    derivedFromPhases = true;
    notes.push('No total power column found – total computed as the sum of the three phase active-power columns.');
  }

  // ---- energy column
  const eIdx = auto(/^ActiveEnergy_Total(_avg|_sum)?$/i) >= 0 ? auto(/^ActiveEnergy_Total(_avg|_sum)?$/i) : auto(/^ActiveEnergy_/i);
  let energyKWh: number | undefined;
  let energyUnit: 'Wh' | 'kWh' | undefined;
  let energyVals: number[] | undefined;
  if (eIdx >= 0) {
    energyVals = rows.map((r) => parseNumber(r[eIdx]));
    const u = unitFor(eIdx, energyVals);
    energyUnit = u.unit === 'kWh' || u.unit === 'kW' ? 'kWh' : 'Wh';
    const f = energyUnit === 'Wh' ? 1 / 1000 : 1;
    energyKWh = energyVals.filter(Number.isFinite).reduce((a, b) => a + b, 0) * f;
    // Cumulative counter? (monotonic non-decreasing) – then the sum is meaningless
    const fin = energyVals.filter(Number.isFinite);
    const mono = fin.length > 3 && fin.every((v, i) => i === 0 || v >= fin[i - 1]);
    if (mono) {
      energyKWh = (fin[fin.length - 1] - fin[0]) * f;
      notes.push('Active-energy column is a cumulative counter; total taken as last − first.');
      if (!kwSeries) {
        const h = interval / 60;
        kwSeries = energyVals.map((v, i) => (i === 0 ? NaN : ((v - energyVals![i - 1]) * f) / h));
        powerName = headers[eIdx] + ' (Δ)';
        sourceUnit = energyUnit;
      }
    } else if (!kwSeries) {
      const h = interval / 60;
      kwSeries = energyVals.map((v) => (v * f) / h);
      powerName = headers[eIdx] + ' (per interval)';
      sourceUnit = energyUnit;
      notes.push('No power column found – average power derived from interval active energy.');
    }
  }
  if (!kwSeries) {
    throw new FlukeError(
      `No active-power column could be identified automatically.\n\nDetected columns:\n${headers.map((h, i) => `  ${i + 1}. ${h}`).join('\n')}\n\nSelect the total active power (average) column manually. Min/max, reactive, apparent, fundamental, voltage, current and PF columns are never chosen automatically.`,
    );
  }

  // ---- phases
  let phaseKw: number[][] | null = null;
  if (havePhases) {
    const sc = sourceUnit === 'kW' ? 1 : 1 / 1000;
    phaseKw = phaseIdx.map((i) => rows.map((r) => parseNumber(r[i]) * sc));
  }

  // ---- timestamps → midpoints
  const refers = opts.timestampRefersTo ?? 'start';
  const shift = refers === 'start' ? (interval * 60000) / 2 : refers === 'end' ? -(interval * 60000) / 2 : 0;
  const samples: LoggerSample[] = [];
  for (let i = 0; i < rows.length; i++) {
    const t = tp.values[i];
    if (!Number.isFinite(t)) continue;
    const s: LoggerSample = { ts: t + shift, kW: kwSeries[i] };
    if (phaseKw) s.phases = [phaseKw[0][i], phaseKw[1][i], phaseKw[2][i]];
    samples.push(s);
  }
  samples.sort((a, b) => a.ts - b.ts);
  if (!samples.length) throw new FlukeError('No rows with a valid timestamp were found.');
  if (tp.kind !== 'unknown') notes.push(`Timestamp format: ${tp.kind}.`);
  notes.push(`Timestamps treated as ${refers === 'mid' ? 'interval midpoints' : `interval ${refers}s; midpoint = ${refers === 'start' ? 'start + ' : 'end − '}${fmtHalf(interval)}`}.`);
  if (unitAssumed) notes.push(`Power unit not stated in the file – assumed ${sourceUnit}.`);
  if (derivedFromPhases) sourceUnit = sourceUnit === 'kW' ? 'kW' : 'W';

  const meta = parseMeta(fileName, preamble);
  return {
    fileName, chiller: meta.chiller, serial: meta.serial, model: meta.model, sourceUnit, unitAssumed,
    powerColumn: powerName, energyColumn: eIdx >= 0 ? headers[eIdx] : undefined,
    intervalMinutes: interval, samples, rowCount: rows.length, notes, columns: headers,
    energyKWhFromColumn: energyKWh,
  };
}

function fmtHalf(min: number) { return `${min / 2} min`; }

export function parseMeta(fileName: string, preamble = ''): { chiller: string; serial: string; model: string } {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const sn = base.match(/SN[_-]?(\d{5,})/i) ?? preamble.match(/serial[^\d]{0,20}(\d{5,})/i);
  const model = (base + ' ' + preamble).match(/\b(17(?:32|34|36|38|42|46|48))\b/);
  let chiller = '';
  const head = base.split(/__/)[0];
  const ch = head.match(/(CH[-_ ]?\d+[A-Za-z]?|chiller[-_ ]?[A-Za-z0-9]+)/i);
  if (ch) chiller = ch[1].replace(/[-_ ]/g, '').toUpperCase().replace(/^CHILLER/, 'CH');
  else chiller = head.split('_').pop() || base;
  return { chiller, serial: sn ? sn[1] : '', model: model ? model[1] : '' };
}
