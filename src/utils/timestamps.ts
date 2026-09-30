import { parseNumber } from './csv';

export type DateKind = 'iso' | 'dmy' | 'mdy' | 'excel' | 'epoch-s' | 'epoch-ms' | 'ticks' | 'unknown';

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const TICKS_UNIX_EPOCH = 621355968000000000n; // .NET ticks at 1970-01-01
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export interface TimestampParse {
  kind: DateKind;
  values: number[]; // NaN when unparsable
  badCount: number;
}

function fromParts(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): number {
  if (mo < 0 || mo > 11 || d < 1 || d > 31 || h > 24 || mi > 59 || s > 60) return NaN;
  if (y < 100) y += 2000;
  return Date.UTC(y, mo, d, h, mi, s, ms);
}

const TIME_RE = '(?:[ T]+(\\d{1,2}):(\\d{2})(?::(\\d{2})(?:[.,](\\d{1,3})\\d*)?)?\\s*([AaPp][Mm])?)?';
const ISO = new RegExp(`^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})${TIME_RE}(?:\\s*Z|[+-]\\d{2}:?\\d{2})?$`);
const SLASH = new RegExp(`^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{2,4})${TIME_RE}$`);
const TEXTMON = new RegExp(`^(\\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\\d{2,4})${TIME_RE}$`);

function timePart(m: RegExpMatchArray, i: number): [number, number, number, number] {
  let h = m[i] ? Number(m[i]) : 0;
  const mi = m[i + 1] ? Number(m[i + 1]) : 0;
  const s = m[i + 2] ? Number(m[i + 2]) : 0;
  const ms = m[i + 3] ? Number(m[i + 3].padEnd(3, '0')) : 0;
  const ap = m[i + 4]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return [h, mi, s, ms];
}

/** Decide day/month order from the whole column: a first/second field >12 settles it. Default DMY. */
export function detectSlashOrder(values: string[]): 'dmy' | 'mdy' {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    const m = v.trim().match(SLASH);
    if (!m) continue;
    if (Number(m[1]) > 12) dmy++;
    if (Number(m[2]) > 12) mdy++;
  }
  return mdy > dmy ? 'mdy' : 'dmy';
}

export function parseTimestamps(values: string[], forceOrder?: 'dmy' | 'mdy'): TimestampParse {
  const sample = values.map((v) => v.trim()).filter((v) => v !== '');
  const order = forceOrder ?? detectSlashOrder(sample);
  // Numeric column? -> Excel serial / epoch / ticks
  const nums = sample.slice(0, 200).map((v) => (/^[-+0-9.,eE]+$/.test(v) ? parseNumber(v) : NaN));
  const allNumeric = sample.length > 0 && nums.every((n) => Number.isFinite(n));
  let kind: DateKind = 'unknown';
  if (allNumeric) {
    const med = [...nums].sort((a, b) => a - b)[Math.floor(nums.length / 2)];
    if (med > 6e17) kind = 'ticks';
    else if (med > 1e11) kind = 'epoch-ms';
    else if (med > 1e8) kind = 'epoch-s';
    else if (med > 20000 && med < 80000) kind = 'excel';
  }
  const out: number[] = [];
  let bad = 0;
  let seenKind: DateKind | null = null;
  for (const raw of values) {
    const v = raw.trim();
    let t = NaN;
    if (v === '') {
      out.push(NaN);
      bad++;
      continue;
    }
    if (kind === 'ticks') {
      try {
        const bi = BigInt(v.replace(/[.,]\d*$/, ''));
        t = Number((bi - TICKS_UNIX_EPOCH) / 10000n);
      } catch {
        t = NaN;
      }
    } else if (kind === 'epoch-ms') t = parseNumber(v);
    else if (kind === 'epoch-s') t = parseNumber(v) * 1000;
    else if (kind === 'excel') {
      const n = parseNumber(v);
      t = Number.isFinite(n) ? Math.round((EXCEL_EPOCH_MS + n * 86400000) / 1000) * 1000 : NaN;
    } else {
      let m = v.match(ISO);
      if (m) {
        const [h, mi, s, ms] = timePart(m, 4);
        t = fromParts(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, mi, s, ms);
        seenKind ??= 'iso';
      } else if ((m = v.match(SLASH))) {
        const [h, mi, s, ms] = timePart(m, 4);
        const a = Number(m[1]);
        const b = Number(m[2]);
        t = order === 'dmy' ? fromParts(Number(m[3]), b - 1, a, h, mi, s, ms) : fromParts(Number(m[3]), a - 1, b, h, mi, s, ms);
        seenKind ??= order;
      } else if ((m = v.match(TEXTMON))) {
        const mo = MONTHS[m[2].toLowerCase()];
        const [h, mi, s, ms] = timePart(m, 4);
        if (mo !== undefined) t = fromParts(Number(m[3]), mo, Number(m[1]), h, mi, s, ms);
        seenKind ??= 'dmy';
      }
    }
    if (!Number.isFinite(t)) bad++;
    out.push(t);
  }
  return { kind: kind !== 'unknown' ? kind : seenKind ?? 'unknown', values: out, badCount: bad };
}

/** Median positive spacing (minutes) of a set of timestamps. */
export function detectIntervalMinutes(ts: number[]): number {
  const u = [...new Set(ts.filter(Number.isFinite))].sort((a, b) => a - b);
  if (u.length < 2) return NaN;
  const diffs: number[] = [];
  for (let i = 1; i < u.length; i++) diffs.push(u[i] - u[i - 1]);
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] / 60000;
}
