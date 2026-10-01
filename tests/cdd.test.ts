import { describe, expect, it } from 'vitest';
import { parseTable } from '../src/utils/csv';
import { CddError, parseCdd } from '../src/analysis/cdd';
import { runPipeline } from '../src/analysis/pipeline';
import { buildFindings } from '../src/analysis/findings';
import { S, pad } from './helpers';
import { buildWorkbook } from '../src/excel/workbook';
import type { CddData } from '../src/types';

const base = { cddBaseTemp: 18.3 };

describe('CDD file import', () => {
  it('reads a CDD column with US dates', () => {
    const t = parseTable('Date,CDD\n6/28/2026,10.5\n6/29/2026,12\n6/30/2026,-1\n');
    const d = parseCdd(t, base);
    expect(d.source).toBe('cdd');
    expect(d.days.map((x) => x.cdd)).toEqual([10.5, 12, 0]); // negative CDD is clamped to 0
    expect(new Date(d.days[0].day).toISOString()).toBe('2026-06-28T00:00:00.000Z');
  });
  it('computes CDD from mean temperature with the base temperature (and keeps the temperature for later base changes)', () => {
    const d = parseCdd(parseTable('date;Tmean (C)\n2026-07-01;30.3\n2026-07-02;15\n'), base);
    expect(d.source).toBe('temperature');
    expect(d.days[0].cdd).toBeCloseTo(12, 9);
    expect(d.days[0].tempC).toBeCloseTo(30.3, 9);
    expect(d.days[1].cdd).toBe(0);
  });
  it('uses (Tmax+Tmin)/2 and converts °F', () => {
    const d = parseCdd(parseTable('Date,Tmax (F),Tmin (F)\n2026-07-01,104,86\n'), base);
    expect(d.days[0].tempC).toBeCloseTo(35, 6); // mean 95 °F
    expect(d.days[0].cdd).toBeCloseTo(35 - 18.3, 6);
    expect(d.notes.join(' ')).toContain('°F');
  });
  it('sums hourly CDD rows and averages hourly temperatures per day', () => {
    const rows = (v: (h: number) => number) => Array.from({ length: 24 }, (_, h) => `2026-07-01 ${pad(h)}:00,${v(h)}`).join('\n');
    expect(parseCdd(parseTable(`time,cdd\n${rows(() => 0.5)}`), base).days[0].cdd).toBeCloseTo(12, 9);
    expect(parseCdd(parseTable(`time,temperature\n${rows((h) => (h < 12 ? 20 : 40))}`), base).days[0].cdd).toBeCloseTo(30 - 18.3, 9);
  });
  it('explains what is wrong when the file has no usable columns', () => {
    expect(() => parseCdd(parseTable('Date,Humidity\n2026-07-01,40\n'), base)).toThrow(/No CDD or temperature column/);
    try { parseCdd(parseTable('foo,bar\n1,2\n'), base); expect.unreachable(); } catch (e) { expect(e).toBeInstanceOf(CddError); expect((e as Error).message).toContain('Detected columns'); }
  });
});

// ---- exactly solvable data: one chiller, 5-min rows, TR(day) = 200 + 40·CDD, kW = 0.6·TR  ⇒  kWh/day = 2880 + 576·CDD
const CDDS = [3, 7, 2, 9, 12, 5, 8, 14, 6, 10, 4, 11, 13, 1];
function csv(opts: { skipHalfDay?: number; offDay?: number } = {}) {
  const lines = ['time,kW,TR'];
  CDDS.forEach((c, d) => {
    for (let i = 0; i < 288; i++) {
      if (opts.skipHalfDay === d && i >= 144) break;
      const tr = opts.offDay === d ? 0 : 200 + 40 * c;
      const kw = opts.offDay === d ? 0.2 : 0.6 * tr;
      const t = new Date(Date.UTC(2026, 6, 1 + d, 0, i * 5));
      lines.push(`${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())},${kw},${tr}`);
    }
  });
  return lines.join('\n');
}
const cddData = (days = CDDS): CddData => ({ fileName: 'w.csv', source: 'cdd', rowCount: days.length, notes: [], days: days.map((cdd, d) => ({ day: Date.UTC(2026, 6, 1 + d), cdd })) });
const settings = S({ loadSource: 'column', loadUnit: 'TR' });
const run = (o: Parameters<typeof csv>[0] = {}, cdd: CddData | null = cddData(), st = settings) => {
  const t = parseTable(csv(o));
  return runPipeline({ table: t, mapping: { timestamp: 0, power: 1, load: 2 }, settings: st, loggers: [], cdd });
};

describe('daily CDD regression and weather normalisation', () => {
  const a = run().analysis!;
  const c = a.cdd!;
  it('rolls the plant up per day and recovers the exact coefficients', () => {
    expect(c.usedDays).toBe(14);
    expect(c.days[0].kWh).toBeCloseTo(2880 + 576 * 3, 6);
    expect(c.days[0].coverage).toBeCloseTo(1, 9);
    const m = c.energyModel!;
    expect(m.coefs[0].value).toBeCloseTo(2880, 4);
    expect(m.coefs[1].value).toBeCloseTo(576, 5);
    expect(m.r2).toBeCloseTo(1, 10);
    expect(m.guideline14.cvLimit).toBe(15); // daily data uses the coarser-than-hourly limits
    expect(m.guideline14.nmbeLimit).toBe(5);
    expect(m.guideline14.pass).toBe(true);
    expect(c.loadModel!.coefs[1].value).toBeCloseTo(24 * 40, 5);
    expect(c.days.every((d) => Math.abs(d.residualKWh!) < 1e-6)).toBe(true);
  });
  it('weather-normalised efficiency, shares and reference CDD', () => {
    const mean = CDDS.reduce((x, y) => x + y, 0) / CDDS.length;
    expect(c.refCdd).toBeCloseTo(mean, 9);
    expect(c.refLabel).toContain('mean CDD');
    expect(c.normalised!.kwPerTR).toBeCloseTo(0.6, 8);
    expect(c.normalised!.kWhPerDay).toBeCloseTo(2880 + 576 * mean, 4);
    expect(c.weatherShare!).toBeCloseTo((576 * mean) / (2880 + 576 * mean), 8);
    expect(c.weatherShare! + c.baseShare!).toBeCloseTo(1, 8);
    expect(c.actualKWh).toBeCloseTo(c.expectedKWh, 4);
  });
  it('typical-year CDD gives annual weather-normalised energy', () => {
    const y = run({}, cddData(), { ...settings, typicalAnnualCdd: 3650 }).analysis!.cdd!;
    expect(y.refCdd).toBeCloseTo(10, 9);
    expect(y.refLabel).toContain('typical year');
    expect(y.annual!.kWh).toBeCloseTo(365 * 2880 + 576 * 3650, 2);
    expect(y.normalised!.kWhPerDay).toBeCloseTo(2880 + 5760, 4);
  });
  it('a partly logged day is left out; a day with the plant off is still a complete day', () => {
    const p = run({ skipHalfDay: 3 }).analysis!.cdd!;
    expect(p.skipped.partial).toBe(1);
    expect(p.usedDays).toBe(13);
    expect(p.days[3].used).toBe(false);
    const off = run({ offDay: 5 }).analysis!.cdd!;
    expect(off.days[5].used).toBe(true); // filtered-out rows still count as logged time
    expect(off.days[5].kWh).toBe(0);
  });
  it('days without a CDD value are left out and reported', () => {
    const short = run({}, cddData(CDDS.slice(0, 10))).analysis!.cdd!;
    expect(short.skipped.noCdd).toBe(4);
    expect(short.usedDays).toBe(10);
    expect(short.notes.join(' ')).toContain('no CDD value');
  });
  it('too few days or constant CDD gives a clear note instead of a model', () => {
    const few = run({}, cddData(CDDS.map((_, i) => (i < 3 ? CDDS[i] : NaN)).filter(Number.isFinite).concat([]))).analysis!.cdd!;
    expect(few.energyModel).toBeNull();
    expect(few.notes.join(' ')).toContain('at least 5');
    const flat = run({}, cddData(CDDS.map(() => 8))).analysis!.cdd!;
    expect(flat.energyModel).toBeNull();
    expect(flat.notes.join(' ')).toContain('hardly varies');
  });
  it('changing the base temperature recomputes CDD from a temperature file', () => {
    const temps: CddData = { fileName: 't.csv', source: 'temperature', baseTempC: 18.3, rowCount: 14, notes: [], days: CDDS.map((x, d) => ({ day: Date.UTC(2026, 6, 1 + d), cdd: x, tempC: 18.3 + x })) };
    const a1 = run({}, temps, { ...settings, cddBaseTemp: 18.3 }).analysis!.cdd!;
    const a2 = run({}, temps, { ...settings, cddBaseTemp: 20.3 }).analysis!.cdd!;
    expect(a1.days[0].cdd).toBeCloseTo(3, 9);
    expect(a2.days[0].cdd).toBeCloseTo(1, 9);
    expect(a2.days[2].cdd).toBe(0); // 2 CDD at 18.3 → below the new base
  });
  it('adds the weather finding only when CDD data is present; flags consumption drift', () => {
    expect(run({}, null).analysis!.findings.map((f) => f.id)).not.toContain('weather');
    const f = a.findings.find((x) => x.id === 'weather')!;
    expect(f.status).toBe('OK');
    expect(f.text).toContain('576');
    // second half uses 50 % more than the weather explains (the baseline is fitted over the whole period, which dilutes the drift)
    const lines = csv().split('\n');
    const boosted = lines.map((l, i) => {
      if (i === 0) return l;
      const [ts, kw, tr] = l.split(',');
      return Date.parse(ts.replace(' ', 'T') + 'Z') >= Date.UTC(2026, 6, 8) ? `${ts},${(+kw * 1.5).toFixed(3)},${tr}` : l;
    }).join('\n');
    const out = runPipeline({ table: parseTable(boosted), mapping: { timestamp: 0, power: 1, load: 2 }, settings, loggers: [], cdd: cddData() }).analysis!;
    const g = out.findings.find((x) => x.id === 'weather')!;
    expect(out.cdd!.secondHalfResidualPct!).toBeGreaterThan(10);
    expect(g.status).toBe('Action');
    expect(g.savingsKWh).toBeGreaterThan(0);
    expect(buildFindings).toBeTypeOf('function');
  });
});

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import XLSX from 'xlsx-js-style';

describe('Excel with CDD', () => {
  it.skipIf(spawnSync('which', ['soffice']).status !== 0)('CDD sheet formulas recalculate in LibreOffice and match the cached values', async () => {
    const a = run().analysis!;
    const dir = mkdtempSync(join(tmpdir(), 'cpa-cdd-'));
    const cached = await buildWorkbook({ analysis: a, loggers: [] });
    const bare = await buildWorkbook({ analysis: a, loggers: [], noCache: true });
    writeFileSync(join(dir, 'bare.xlsx'), bare.bytes);
    execFileSync('soffice', ['--headless', '--norestore', `-env:UserInstallation=file://${dir}/lo`, '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', join(dir, 'out'), join(dir, 'bare.xlsx')], { timeout: 180000 });
    const rec = XLSX.read(readFileSync(join(dir, 'out', 'bare.xlsx')), { type: 'buffer', cellFormula: true });
    const ref = XLSX.read(cached.bytes, { type: 'array', cellFormula: true });
    let n = 0;
    for (const [addr, cell] of Object.entries(ref.Sheets['CDD Daily']) as [string, any][]) {
      if (addr.startsWith('!') || !cell.f) continue;
      n++;
      const rc = rec.Sheets['CDD Daily'][addr] as any;
      expect(rc.t, `${addr} ${cell.f}`).not.toBe('e');
      if (typeof cell.v === 'number') expect(rc.v, `${addr} ${cell.f}`).toBeCloseTo(cell.v, 6);
    }
    expect(n).toBeGreaterThan(50);
    expect(ref.Sheets['CDD Daily']['B5'].v).toBeCloseTo(2880, 3); // base load b0
    expect(ref.Sheets['CDD Daily']['B6'].v).toBeCloseTo(576, 4); // slope b1
    expect(ref.Sheets['CDD Daily']['B17'].v).toBeCloseTo(0.6, 6); // normalised kW/TR
  }, 240000);
  it('adds the CDD sheets', async () => {
    const out = await buildWorkbook({ analysis: run().analysis!, loggers: [] });
    expect(out.sheets).toContain('CDD Daily');
  });
});
