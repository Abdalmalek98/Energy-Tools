import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import { parseTable, detectDelimiter, parseNumber, decodeText } from '../src/utils/csv';
import { parseTimestamps, detectIntervalMinutes } from '../src/utils/timestamps';
import { autoMap, parseBms, MappingError } from '../src/analysis/bms';
import { analyze } from '../src/analysis/analyze';
import { parseFlukeFile, parseMeta } from '../src/fluke/parse';
import { FlukeError } from '../src/fluke/errors';
import { analyzeLogger } from '../src/fluke/logger';
import { makeBmsCsv, S } from './helpers';
import { makeFlukeTxt, utf16le } from './fixtures';

const enc = (s: string) => new TextEncoder().encode(s);

describe('delimited text', () => {
  it('detects comma, semicolon and tab', () => {
    expect(detectDelimiter('a,b,c\n1,2,3\n4,5,6')).toBe(',');
    expect(detectDelimiter('a;b;c\n1;2;3\n4;5;6')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3\n4\t5\t6')).toBe('\t');
  });
  it('handles quoted fields, escaped quotes, embedded delimiters and BOM', () => {
    const t = parseTable('﻿"Time","Note","kW"\n"2026-01-01 00:00","a, ""b""","1,5"\n');
    expect(t.headers).toEqual(['Time', 'Note', 'kW']);
    expect(t.rows[0]).toEqual(['2026-01-01 00:00', 'a, "b"', '1,5']);
  });
  it('parses decimal commas and thousands separators', () => {
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('1,234,567')).toBe(1234567);
    expect(parseNumber('abc')).toBeNaN();
    expect(parseNumber('')).toBeNaN();
  });
  it('decodes UTF-8 BOM and UTF-16 with/without BOM', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
    expect(decodeText(utf16le('héllo;1'))).toBe('héllo;1');
    expect(decodeText(utf16le('hello;1', false))).toBe('hello;1');
  });
});

describe('timestamps', () => {
  it('ISO, DMY/MDY detection, AM/PM', () => {
    expect(parseTimestamps(['2026-07-01 10:05:00']).values[0]).toBe(Date.UTC(2026, 6, 1, 10, 5));
    expect(parseTimestamps(['13/07/2026 10:05', '01/07/2026 10:10']).values[1]).toBe(Date.UTC(2026, 6, 1, 10, 10)); // DMY (13 > 12)
    expect(parseTimestamps(['07/13/2026 10:05', '07/01/2026 10:10']).values[1]).toBe(Date.UTC(2026, 6, 1, 10, 10)); // MDY
    expect(parseTimestamps(['07/01/2026 10:05 PM']).values[0]).toBe(Date.UTC(2026, 0, 7, 22, 5)); // ambiguous → DMY
  });
  it('Excel serial, epoch seconds/ms and .NET ticks', () => {
    const ref = Date.UTC(2026, 6, 1, 12, 0);
    const serial = (ref - Date.UTC(1899, 11, 30)) / 86400000;
    expect(parseTimestamps([String(serial)]).values[0]).toBe(ref);
    expect(parseTimestamps([String(ref / 1000)]).values[0]).toBe(ref);
    expect(parseTimestamps([String(ref)]).values[0]).toBe(ref);
    const ticks = (BigInt(ref) * 10000n + 621355968000000000n).toString();
    expect(parseTimestamps([ticks]).values[0]).toBe(ref);
  });
  it('detects the logging interval', () => {
    expect(detectIntervalMinutes([0, 300000, 600000, 900000, 1500000])).toBe(5);
  });
});

describe('BMS import', () => {
  const variants: [string, Parameters<typeof makeBmsCsv>[0]][] = [
    ['comma', {}], ['semicolon', { delimiter: ';' }], ['tab', { delimiter: '\t' }],
    ['semicolon + decimal comma', { delimiter: ';', decimalComma: true }], ['BOM', { bom: true }], ['quoted', { quote: true }],
    ['semicolon + decimal comma + quoted + BOM', { delimiter: ';', decimalComma: true, quote: true, bom: true }],
  ];
  it.each(variants)('%s parses to identical KPIs', (_n, o) => {
    const base = analyzeCsv(makeBmsCsv());
    const v = analyzeCsv(makeBmsCsv(o));
    expect(v.kpis.plantKwPerTR).toBeCloseTo(base.kpis.plantKwPerTR, 6);
    expect(v.exclusions.total).toBe(base.exclusions.total);
    expect(v.intervalMinutes).toBe(5);
  });
  it('auto-maps the standard columns', () => {
    const t = parseTable(makeBmsCsv());
    const m = autoMap(t.headers);
    expect(t.headers[m.timestamp!]).toBe('Timestamp');
    expect(t.headers[m.chillerId!]).toBe('Chiller ID');
    expect(t.headers[m.power!]).toBe('Chiller kW');
    expect(t.headers[m.flow!]).toBe('CHW Flow L/s');
    expect(t.headers[m.lchwt!]).toBe('LCHWT');
    expect(t.headers[m.echwt!]).toBe('ECHWT');
    expect(t.headers[m.ecwt!]).toBe('ECWT');
    expect(t.headers[m.aux!]).toBe('Aux kW');
  });
  it('reports a helpful message when the timestamp column is missing', () => {
    const t = parseTable('foo,bar\n1,2\n');
    try { parseBms(t, {}, S()); expect.unreachable(); } catch (e) {
      expect(e).toBeInstanceOf(MappingError);
      expect((e as Error).message).toContain('Unable to identify the timestamp column.');
      expect((e as Error).message).toContain('Detected columns:');
      expect((e as Error).message).toContain('foo');
    }
  });
  it('single-meter format (no chiller column) and cumulative kWh / interval kWh modes', () => {
    const lines = ['time,kWh,load'];
    for (let i = 0; i < 12; i++) lines.push(`2026-01-01 ${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')},${100 + i * 30},300`);
    const t = parseTable(lines.join('\n'));
    const m = autoMap(t.headers);
    const cum = parseBms(t, { ...m, power: 1, load: 2 }, S({ powerMode: 'cumulativeKWh', loadSource: 'column', loadUnit: 'TR' }));
    expect(cum.chillers).toEqual(['CH1']);
    expect(cum.rows[1].kW).toBeCloseTo(30 / 0.25, 9); // 120 kW
    expect(cum.rows[0].kW).toBeNaN();
    const iv = parseBms(t, { ...m, power: 1, load: 2 }, S({ powerMode: 'intervalKWh', loadSource: 'column', loadUnit: 'TR' }));
    expect(iv.rows[0].kW).toBeCloseTo(100 / 0.25, 9);
  });
  it('°F and gpm inputs give the same load as °C and L/s', () => {
    const c = parseBms(parseTable('t,kw,f,l,e\n2026-01-01 00:00,300,63.09,6.5,12\n2026-01-01 00:15,300,63.09,6.5,12'), { timestamp: 0, power: 1, flow: 2, lchwt: 3, echwt: 4 }, S());
    const f = parseBms(parseTable(`t,kw,f,l,e\n2026-01-01 00:00,300,1000,${6.5 * 9 / 5 + 32},${12 * 9 / 5 + 32}\n2026-01-01 00:15,300,1000,${6.5 * 9 / 5 + 32},${12 * 9 / 5 + 32}`), { timestamp: 0, power: 1, flow: 2, lchwt: 3, echwt: 4 }, S({ flowUnit: 'gpm', tempUnit: 'F' }));
    expect(f.rows[0].load).toBeCloseTo(c.rows[0].load, 1);
  });
});

function analyzeCsv(csv: string) {
  const t = parseTable(csv);
  const s = S();
  const bms = parseBms(t, autoMap(t.headers), s);
  return analyze({ bms, settings: s });
}

describe('BMS end-to-end analysis', () => {
  const r = analyzeCsv(makeBmsCsv());
  it('produces KPIs, chillers, regression, findings', () => {
    expect(r.exclusions.kept).toBeGreaterThan(500);
    expect(r.chillers.map((c) => c.id)).toEqual(['CH1', 'CH2']);
    expect(r.kpis.plantKwPerTR).toBeGreaterThan(0.5);
    expect(r.kpis.plantKwPerTR).toBeLessThan(1.2);
    expect(r.plantRegression!.selected).not.toBeNull();
    expect(r.findings.map((f) => f.id)).toEqual(['overall', 'staging', 'condenser', 'chwreset', 'worst', 'aux', 'deltat', 'regression', 'quality']);
    expect(r.loadProfile.reduce((a, b) => a + b.hours, 0)).toBeCloseTo(r.kpis.loggedHours, 6);
    for (const c of r.chillers) expect(['On spec', 'Degraded', 'Poor', 'Investigate']).toContain(c.status);
  });
});

describe('Fluke parsing', () => {
  const synth = makeFlukeTxt();
  it('parses the TXT export and picks PowerP_Total_avg (never min/max/reactive/apparent/voltage)', async () => {
    const d = await parseFlukeFile('LC5_CH3__SN_62934227__260628_1539_trend.txt', enc(synth.text));
    expect(d.powerColumn).toBe('PowerP_Total_avg');
    expect(d.rowCount).toBe(4259);
    expect(d.intervalMinutes).toBe(5);
    expect(d.chiller).toBe('CH3');
    expect(d.serial).toBe('62934227');
    expect(d.model).toBe('1738');
    expect(d.sourceUnit).toBe('W');
    expect(d.samples[0].ts).toBe(Date.UTC(2026, 5, 28, 15, 40) + 150000); // period start + 2.5 min midpoint
  });
  it('CSV with decimal commas and semicolons', async () => {
    const s = makeFlukeTxt({ rows: 300, decimalComma: true }).text.replace(/\t/g, ';');
    const d = await parseFlukeFile('x_CH1__SN_123456_trend.csv', enc(s));
    expect(d.powerColumn).toBe('PowerP_Total_avg');
    expect(d.samples[300 - 1].kW).toBeGreaterThan(0);
    const ref = await parseFlukeFile('x.txt', enc(makeFlukeTxt({ rows: 300 }).text));
    expect(d.samples[250].kW).toBeCloseTo(ref.samples[250].kW, 3);
  });
  it('UTF-16 (BOM and BOM-less)', async () => {
    const text = makeFlukeTxt({ rows: 100 }).text;
    expect((await parseFlukeFile('a.txt', utf16le(text))).rowCount).toBe(100);
    expect((await parseFlukeFile('a.txt', utf16le(text, false))).rowCount).toBe(100);
  });
  it('unit row / kW headers', async () => {
    const txt = 'Date Time\tActive Power Total Avg (kW)\n2026-01-01 00:00\t100,5\n2026-01-01 00:10\t101,5\n2026-01-01 00:20\t102';
    const d = await parseFlukeFile('t.txt', enc(txt));
    expect(d.sourceUnit).toBe('kW');
    expect(d.samples[0].kW).toBeCloseTo(100.5);
    expect(d.intervalMinutes).toBe(10);
  });
  it('Excel serial / epoch timestamps', async () => {
    const t0 = Date.UTC(2026, 0, 1);
    const txt = 'Timestamp\tPowerP_Total_avg\n' + [0, 1, 2, 3].map((i) => `${(t0 + i * 600000) / 1000}\t${1000 * (i + 1)}`).join('\n');
    const d = await parseFlukeFile('e.txt', enc(txt));
    expect(d.intervalMinutes).toBe(10);
    expect(d.samples[0].kW).toBe(1);
  });
  it('never auto-selects a non-active-power column; asks for manual selection', async () => {
    const txt = 'Trend_Period\tPowerP_Total_min\tPowerP_Total_max\tPowerQ_Total_avg\tVoltage_L1_avg\n2026-01-01 00:00\t1\t2\t3\t400\n2026-01-01 00:05\t1\t2\t3\t400';
    await expect(parseFlukeFile('n.txt', enc(txt))).rejects.toThrow(/No active-power column/);
    const d = await parseFlukeFile('n.txt', enc(txt), { powerColumn: 'PowerP_Total_max' });
    expect(d.powerColumn).toBe('PowerP_Total_max');
  });
  it('sums three phases when no total column exists', async () => {
    const txt = 'Trend_Period\tPowerP_L1_avg\tPowerP_L2_avg\tPowerP_L3_avg\n2026-01-01 00:00\t1000\t2000\t3000\n2026-01-01 00:05\t1000\t2000\t3000';
    const d = await parseFlukeFile('p.txt', enc(txt));
    expect(d.samples[0].kW).toBe(6);
  });
  it('FCA2 as ZIP containing a CSV', async () => {
    const zip = new JSZip();
    zip.file('trend/data.csv', makeFlukeTxt({ rows: 120 }).text.replace(/\t/g, ','));
    zip.file('info.xml', '<x/>');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const d = await parseFlukeFile('run.fca2', bytes);
    expect(d.rowCount).toBe(120);
  });
  it('FCA2 as SQLite database (bare and inside a ZIP)', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE meta(k TEXT, v TEXT); CREATE TABLE trend(Trend_Period TEXT, PowerP_Total_avg REAL, PowerP_Total_max REAL);');
    for (let i = 0; i < 50; i++) db.run('INSERT INTO trend VALUES (?,?,?)', [`2026-01-01 00:${String(i * 5 % 60).padStart(2, '0')}:00`.replace('00:', `${String(Math.floor(i * 5 / 60)).padStart(2, '0')}:`), 1000 * (i + 1), 9e9]);
    const bytes = db.export();
    const d = await parseFlukeFile('x.fca2', bytes);
    expect(d.rowCount).toBe(50);
    expect(d.powerColumn).toBe('PowerP_Total_avg');
    expect(d.samples[9].kW).toBe(10);
    const zip = new JSZip(); zip.file('data.db', bytes);
    expect((await parseFlukeFile('y.fca2', await zip.generateAsync({ type: 'uint8array' }))).rowCount).toBe(50);
  });
  it('unsupported closed-binary FCA/FCA2 gives the Energy Analyze Plus instructions and the file signature', async () => {
    const bin = new Uint8Array(400); for (let i = 0; i < bin.length; i++) bin[i] = (i * 37 + 3) & 255; bin.set([0x46, 0x43, 0x41, 0x32, 0x00, 0x01, 0x02, 0xfe]);
    try { await parseFlukeFile('closed.fca2', bin); expect.unreachable(); } catch (e) {
      expect(e).toBeInstanceOf(FlukeError);
      const m = (e as FlukeError).message;
      expect(m).toContain('This file appears to be a closed binary format.');
      expect(m).toContain('Please open it in Energy Analyze Plus and use:');
      expect(m).toContain('Export → CSV');
      expect(m).toContain('- Total Active Power Average');
      expect(m).toContain('File signature: 46 43 41 32');
      expect((e as FlukeError).kind).toBe('binary');
    }
  });
  it('empty and garbage text files fail gracefully', async () => {
    await expect(parseFlukeFile('e.txt', new Uint8Array(0))).rejects.toBeInstanceOf(FlukeError);
    await expect(parseFlukeFile('g.txt', enc('hello world\nthis is not a trend'))).rejects.toBeInstanceOf(FlukeError);
  });
  it('parseMeta from file name', () => {
    expect(parseMeta('LC5_CH3__SN_62934227__260628_1539_trend.txt')).toEqual({ chiller: 'CH3', serial: '62934227', model: '' });
  });
});

describe('Logger-only analysis (synthetic ground truth)', () => {
  it('matches independently computed statistics', async () => {
    const synth = makeFlukeTxt();
    const d = await parseFlukeFile('LC5_CH3__SN_62934227_trend.txt', enc(synth.text));
    const a = analyzeLogger(d);
    const t = synth.truth;
    expect(a.rows).toBe(t.rows);
    expect(a.runningHours).toBeCloseTo((t.running * 5) / 60, 6);
    expect(a.loggedHours).toBeCloseTo((t.rows * 5) / 60, 6);
    expect(a.totalKWh).toBeCloseTo(t.totalKWh, 3);
    expect(a.runningKWh).toBeCloseTo(t.runningKWhW, 3);
    expect(a.starts).toBe(2);
    expect(a.peakKW).toBeCloseTo(t.peakKW, 3); // fixture text is rounded to 0.1 W
    expect(a.peakTs).toBe(d.samples[t.peakIdx].ts);
    expect(a.standbyKW).toBeCloseTo(t.standbyKW, 3);
    const sorted = d.samples.map((x) => x.kW).sort((x, y) => x - y);
    const idx = 0.99 * (sorted.length - 1);
    const p99 = sorted[Math.floor(idx)] + (sorted[Math.ceil(idx)] - sorted[Math.floor(idx)]) * (idx - Math.floor(idx));
    expect(a.runningThresholdKW).toBeCloseTo(Math.max(5, 0.08 * p99), 9);
    expect(a.longestRunHours).toBeCloseTo((1800 * 5) / 60, 6);
    expect(a.avgRunningKW).toBeCloseTo(t.runningKWhW / a.runningHours, 6);
    expect(a.phaseAvgKW!.reduce((x, y) => x + y, 0)).toBeCloseTo(a.avgRunningKW, 0);
    expect(a.negativePhase).toBe(false);
    expect(a.flags.find((f) => f.title === 'Negative phase power')).toBeUndefined();
  });
  it('running threshold = max(5 kW, 8 % of P99)', async () => {
    const d = await parseFlukeFile('t.txt', enc('Trend_Period\tPowerP_Total_avg\n' + Array.from({ length: 100 }, (_, i) => `2026-01-01 ${String(Math.floor(i * 5 / 60)).padStart(2, '0')}:${String(i * 5 % 60).padStart(2, '0')}\t${i < 50 ? 2000 : 1_000_000}`).join('\n')));
    const a = analyzeLogger(d);
    expect(a.runningThresholdKW).toBeCloseTo(80, 0); // 8 % of ~1000 kW
    const d2 = await parseFlukeFile('t.txt', enc('Trend_Period\tPowerP_Total_avg\n' + Array.from({ length: 40 }, (_, i) => `2026-01-01 00:${String(i * 5 % 60).padStart(2, '0')}\t${30_000}`.replace('00:', `${String(Math.floor(i * 5 / 60)).padStart(2, '0')}:`)).join('\n')));
    expect(analyzeLogger(d2).runningThresholdKW).toBeCloseTo(5, 6); // 8 % of 30 kW = 2.4 → the 5 kW floor applies
  });
  it('flags negative phase power as Priority', async () => {
    const d = await parseFlukeFile('n.txt', enc(makeFlukeTxt({ negativePhase: true }).text));
    const a = analyzeLogger(d);
    expect(a.negativePhase).toBe(true);
    // sample 500 is in run A (200..2000) so it counts
    expect(a.flags[0]).toMatchObject({ status: 'Priority', title: 'Negative phase power' });
  });
  it('flags starts/day, short runs, standby and phase deviation', () => {
    const dt = 5, mk = (kw: number[], ph?: [number, number, number][]) => ({
      fileName: 'x', chiller: 'CH1', serial: '', model: '', sourceUnit: 'kW' as const, unitAssumed: false, powerColumn: 'p', intervalMinutes: dt,
      samples: kw.map((k, i) => ({ ts: Date.UTC(2026, 0, 1) + i * dt * 60000, kW: k, phases: ph?.[i] })), rowCount: kw.length, notes: [], columns: [],
    });
    // 6 short runs (10 min each) in one day, standby 20 kW
    const kw: number[] = [];
    for (let i = 0; i < 6; i++) kw.push(20, 20, 500, 500, 20, 20);
    kw.push(20);
    const a = analyzeLogger(mk(kw));
    expect(a.starts).toBe(6);
    expect(a.maxStartsPerDay).toBe(6);
    expect(a.shortRuns).toBe(6);
    expect(a.standbyKW).toBeCloseTo(20);
    const titles = a.flags.map((f) => f.title);
    expect(titles).toContain('Excessive starts'); expect(titles).toContain('Short runs'); expect(titles).toContain('High standby power');
    const ph = Array.from({ length: 10 }, () => [400, 300, 300] as [number, number, number]);
    const b = analyzeLogger(mk(Array(10).fill(1000), ph));
    expect(b.phaseDeviationPct).toBeCloseTo(((400 - 333.33) / 333.33) * 100, 1);
    expect(b.flags.find((f) => f.title === 'Phase imbalance')!.status).toBe('Action');
    const ph2 = Array.from({ length: 10 }, () => [350, 330, 320] as [number, number, number]);
    expect(analyzeLogger(mk(Array(10).fill(1000), ph2)).flags.find((f) => f.title === 'Phase imbalance')!.status).toBe('Review');
  });
});

describe('real Energy Analyze export layout (Start;Stop;Trend_Period;PowerP_A/B/C/Total_avg, semicolons, CRLF)', () => {
  const text = [
    'Start(Arab Standard Time);Stop(Arab Standard Time);Trend_Period;PowerP_A_avg;PowerP_B_avg;PowerP_C_avg;PowerP_Total_avg;PowerPfund_Total_avg;ActiveEnergy_Total_avg',
    '2026-06-28 15:39:48.124;2026-06-28 15:40:00.129;300;3196.12;-3961.29;2580.97;1815.79;1829.42;6.05',
    '2026-06-28 15:40:00.129;2026-06-28 15:45:00.172;300;3009.34;-4002.01;2470.23;1477.56;1538.37;123.1',
    '2026-06-28 15:45:00.172;2026-06-28 15:50:00.061;300;3004.6;-3992.82;2482.58;1494.35;1553;124.4',
  ].join('\r\n');
  it('uses Trend_Period seconds as the interval, Start/Stop midpoints, PowerP_Total_avg and A/B/C phases', async () => {
    const d = await parseFlukeFile('LC5_CH3__SN_62934227__x_trend.txt', new TextEncoder().encode(text));
    expect(d.intervalMinutes).toBe(5);
    expect(d.powerColumn).toBe('PowerP_Total_avg');
    expect(d.samples[1].kW).toBeCloseTo(1.47756, 6);
    expect(d.samples[1].phases![1]).toBeCloseTo(-4.00201, 6);
    expect(d.samples[1].ts).toBe((Date.UTC(2026, 5, 28, 15, 40, 0, 129) + Date.UTC(2026, 5, 28, 15, 45, 0, 172)) / 2);
    expect(d.samples).toHaveLength(3);
  });
});
