import type { Delimiter, RawTable } from '../types';

/** Decode bytes: handles UTF-8 (with/without BOM), UTF-16 LE/BE (BOM or NUL heuristic). */
export function decodeText(buf: Uint8Array): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf.subarray(3));
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf.subarray(2));
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf.subarray(2));
  }
  // BOM-less UTF-16: many NULs in odd/even positions
  if (buf.length >= 4) {
    const n = Math.min(buf.length, 400);
    let evenNul = 0;
    let oddNul = 0;
    for (let i = 0; i < n; i++) {
      if (buf[i] === 0) (i % 2 === 0 ? evenNul++ : oddNul++);
    }
    if (oddNul > n / 4 && evenNul === 0) return new TextDecoder('utf-16le').decode(buf);
    if (evenNul > n / 4 && oddNul === 0) return new TextDecoder('utf-16be').decode(buf);
  }
  return new TextDecoder('utf-8').decode(buf);
}

/** Pick the delimiter that yields the most consistent column count over the first lines. */
export function detectDelimiter(text: string): Delimiter {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 20);
  const cands: Delimiter[] = [',', ';', '\t'];
  let best: Delimiter = ',';
  let bestScore = -1;
  for (const d of cands) {
    const counts = lines.map((l) => splitLine(l, d).length);
    if (!counts.length) continue;
    const modal = mode(counts);
    if (modal <= 1) continue;
    const consistent = counts.filter((c) => c === modal).length / counts.length;
    const score = consistent * 1000 + modal;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function mode(a: number[]): number {
  const m = new Map<number, number>();
  for (const v of a) m.set(v, (m.get(v) ?? 0) + 1);
  let best = a[0];
  let bc = 0;
  for (const [k, c] of m) if (c > bc || (c === bc && k > best)) [best, bc] = [k, c];
  return best;
}

function splitLine(line: string, d: string): string[] {
  return parseDelimited(line, d as Delimiter)[0] ?? [''];
}

/** RFC-4180-ish parser with quoted fields, escaped quotes and embedded newlines. */
export function parseDelimited(text: string, delimiter: Delimiter): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      inQ = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      out.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    out.push(row);
  }
  return out;
}

export function parseTable(text: string, fileName?: string, forced?: Delimiter): RawTable {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delimiter = forced ?? detectDelimiter(text);
  const all = parseDelimited(text, delimiter).filter((r) => r.some((c) => c.trim() !== ''));
  if (!all.length) return { delimiter, headers: [], rows: [], fileName };
  const headers = all[0].map((h) => h.trim());
  const rows = all.slice(1).map((r) => r.map((c) => c.trim()));
  return { delimiter, headers, rows, fileName };
}

/**
 * Parse a number tolerant of decimal commas and thousands separators.
 * "1.234,56" -> 1234.56 ; "1,234.56" -> 1234.56 ; "12,5" -> 12.5
 */
export function parseNumber(s: string | undefined): number {
  if (s === undefined) return NaN;
  let t = s.trim().replace(/\s/g, '').replace(/^[+]/, '');
  if (t === '' || /^(nan|null|n\/a|na|-|--|#n\/a|#div\/0!)$/i.test(t)) return NaN;
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // A single comma is a decimal comma (Fluke/European exports); several commas are thousands separators.
    const parts = t.split(',');
    t = parts.length === 2 ? parts[0] + '.' + parts[1] : parts.join('');
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return NaN;
  return Number(t);
}
