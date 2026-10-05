import { describe, expect, it } from 'vitest';
import { parseTable } from '../src/utils/csv';
import { parseWeatherHourly } from '../src/analysis/weather';
import { runPipeline } from '../src/analysis/pipeline';
import { lineFit, predictorValue } from '../src/analysis/annualize';
import { wetBulbStull } from '../src/analysis/psychro';
import { S } from './helpers';

const pad = (n: number) => String(n).padStart(2, '0');
const stampOf = (t: Date) => `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:00`;

/** logged period: kW = 50 + 80·Tw, TR = 2·kW + 300 (exactly linear in wet-bulb temperature) */
function logged(days: number) {
  const bms = ['time,kW,TR'];
  const wx = ['time,Temperature (C),Relative Humidity (%)'];
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      const T = 24 + 8 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + (d % 5) * 0.9;
      const RH = 50 + 25 * Math.cos((h / 24) * 2 * Math.PI) + (d % 3) * 5;
      const stamp = stampOf(new Date(Date.UTC(2026, 6, 1 + d, h)));
      const tw = wetBulbStull(+T.toFixed(8), +RH.toFixed(8));
      const kw = 50 + 80 * tw;
      for (let q = 0; q < 4; q++) bms.push(`${stamp.slice(0, 14)}${pad(q * 15)},${kw},${2 * kw + 300}`);
      wx.push(`${stamp},${T.toFixed(8)},${RH.toFixed(8)}`);
    }
  }
  return { bms: bms.join('\n'), wx: wx.join('\n') };
}
function typicalYear(hours = 8760, rh = true) {
  const rows = [`time,Temperature (C)${rh ? ',Relative Humidity (%)' : ''}`];
  for (let i = 0; i < hours; i++) {
    const t = new Date(Date.UTC(2025, 0, 1, i));
    const T = 26 + 9 * Math.sin(((i % 24) - 9) / 24 * 2 * Math.PI) + 6 * Math.sin(((i / 24 - 100) / 365) * 2 * Math.PI);
    const RH = 55 + 20 * Math.cos(((i % 24) / 24) * 2 * Math.PI);
    rows.push(`${stampOf(t)},${T.toFixed(8)}${rh ? `,${RH.toFixed(8)}` : ''}`);
  }
  return rows.join('\n');
}
const settings = S({ loadSource: 'column', loadUnit: 'TR', minPLR: 0.05, outlierFilter: false });
function run(b: ReturnType<typeof logged>, typ: string | null, st = settings) {
  return runPipeline({
    table: parseTable(b.bms), mapping: { timestamp: 0, power: 1, load: 2 }, settings: st, loggers: [],
    weather: parseWeatherHourly(parseTable(b.wx), st), typicalWeather: typ ? parseWeatherHourly(parseTable(typ), st) : null,
  }).analysis!;
}

describe('lineFit', () => {
  it('matches the closed-form least squares line and R²', () => {
    const f = lineFit([1, 2, 3, 4], [2, 4, 5, 9])!;
    expect(f.slope).toBeCloseTo(2.2, 12);
    expect(f.intercept).toBeCloseTo(-0.5, 12);
    expect(f.r2).toBeCloseTo(121 / 130, 12);
    expect(lineFit([1, 1, 1], [1, 2, 3])).toBeNull();
  });
  it('predictorValue picks wet-bulb, temperature or enthalpy', () => {
    expect(predictorValue('temperature', { tempC: 30 })).toBe(30);
    expect(predictorValue('wetbulb', { tempC: 36, rh: 31 })).toBeCloseTo(23.1598, 3);
    expect(predictorValue('wetbulb', { tempC: 36 })).toBeNull();
    expect(predictorValue('enthalpy', { tempC: 30, enthalpy: 70 })).toBe(70);
  });
});

describe('annual projection', () => {
  const b = logged(10);
  const typ = typicalYear();
  const a = run(b, typ);
  const p = a.annual!;
  const hoursTw = parseWeatherHourly(parseTable(typ), settings).hours.map((h) => wetBulbStull(h.tempC, h.rh!));

  it('uses the wet-bulb temperature when humidity exists and recovers the exact hourly model', () => {
    expect(p.predictor).toBe('wetbulb');
    expect(p.hourly!.energyModel.slope).toBeCloseTo(80, 4);
    expect(p.hourly!.energyModel.intercept).toBeCloseTo(50, 3);
    expect(p.hourly!.loadModel.slope).toBeCloseTo(2, 6);
    expect(p.hourly!.energyModel.r2).toBeCloseTo(1, 10);
    expect(p.fitHours).toBe(240);
    expect(p.fitDays).toBe(10);
  });
  it('annual kWh, TR·h and kW/TR equal the sum over the typical year', () => {
    const kwh = hoursTw.reduce((s, tw) => s + Math.max(0, 50 + 80 * tw), 0);
    const trh = hoursTw.reduce((s, tw) => s + Math.max(0, 2 * Math.max(0, 50 + 80 * tw) + 300), 0);
    expect(p.hourly!.kWh).toBeCloseTo(kwh, 0);
    expect(p.hourly!.trHours).toBeCloseTo(trh, 0);
    expect(p.hourly!.kwPerTR).toBeCloseTo(kwh / trh, 8);
    expect(p.hourly!.monthly).toHaveLength(12);
    expect(p.hourly!.monthly.reduce((s, m) => s + m.kWh, 0)).toBeCloseTo(p.hourly!.kWh, 3);
  });
  it('the daily method reproduces the hourly one for an exactly linear plant', () => {
    expect(p.daily).not.toBeNull();
    expect(p.daily!.energyModel.slope).toBeCloseTo(80, 4);
    expect(p.daily!.kWh).toBeCloseTo(p.hourly!.kWh, -1);
    expect(Math.abs(p.methodDifferencePct!)).toBeLessThan(0.01);
  });
  it('scales a short typical year to 8,760 h with a note, and clamps negative predictions at zero', () => {
    const half = run(b, typicalYear(4380)).annual!;
    expect(half.scaledFrom).toBe(4380);
    expect(half.notes.join(' ')).toContain('scaled');
    expect(half.hourly!.kWh).toBeGreaterThan(0);
  });
  it('falls back to dry-bulb temperature when the typical year has no humidity, and explains why', () => {
    const t = run(b, typicalYear(8760, false)).annual!;
    expect(t.predictor).toBe('temperature');
    const forced = run(b, typicalYear(), S({ ...settings, annualPredictor: 'enthalpy' })).annual!;
    expect(forced.predictor).toBe('enthalpy');
    const wbForced = run(b, typicalYear(8760, false), S({ ...settings, annualPredictor: 'wetbulb' })).annual!;
    expect(wbForced.predictor).toBe('temperature');
    expect(wbForced.notes.join(' ')).toContain('dry-bulb');
  });
  it('savings scenario: proposed kW/TR with a safety factor', () => {
    const sc = run(b, typ, S({ ...settings, annualProposedKwPerTR: 0.6, annualSafetyPct: 10, tariff: 0.1 })).annual!.scenario!;
    const base = p.hourly!;
    expect(sc.proposedKWh).toBeCloseTo(base.trHours * 0.6 * 1.1, 3);
    expect(sc.savingKWh).toBeCloseTo(base.kWh - sc.proposedKWh, 3);
    expect(sc.savingCost).toBeCloseTo(sc.savingKWh * 0.1, 3);
    expect(p.scenario).toBeNull();
  });
  it('is absent without a typical-year file, and adds a finding with one', () => {
    expect(run(b, null).annual).toBeNull();
    expect(a.findings.some((f) => f.id === 'annual')).toBe(true);
    expect(run(b, null).findings.some((f) => f.id === 'annual')).toBe(false);
  });
});

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import XLSX from 'xlsx-js-style';
import JSZip from 'jszip';
import { buildWorkbook } from '../src/excel/workbook';

describe('Excel with annual projection', () => {
  const a = run(logged(10), typicalYear(), S({ ...settings, annualProposedKwPerTR: 0.6, tariff: 0.1 }));
  it('adds the Annual Projection sheet and the monthly chart', async () => {
    const out = await buildWorkbook({ analysis: a, loggers: [] });
    expect(out.sheets).toContain('Annual Projection');
    const z = await JSZip.loadAsync(out.bytes);
    const charts = await Promise.all(Object.keys(z.files).filter((f) => /charts\/chart\d+\.xml$/.test(f)).map((f) => z.file(f)!.async('string')));
    expect(charts.some((t) => t.includes('Projected monthly energy'))).toBe(true);
  });
  it.skipIf(spawnSync('which', ['soffice']).status !== 0)('formulas (Stull wet-bulb, annual totals, scenario) recalculate in LibreOffice and match', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpa-an-'));
    const cached = await buildWorkbook({ analysis: a, loggers: [] });
    const bare = await buildWorkbook({ analysis: a, loggers: [], noCache: true });
    writeFileSync(join(dir, 'bare.xlsx'), bare.bytes);
    execFileSync('soffice', ['--headless', '--norestore', `-env:UserInstallation=file://${dir}/lo`, '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', join(dir, 'out'), join(dir, 'bare.xlsx')], { timeout: 180000 });
    const rec = XLSX.read(readFileSync(join(dir, 'out', 'bare.xlsx')), { type: 'buffer', cellFormula: true });
    const ref = XLSX.read(cached.bytes, { type: 'array', cellFormula: true });
    let n = 0;
    for (const [addr, cell] of Object.entries(ref.Sheets['Annual Projection']) as [string, any][]) {
      if (addr.startsWith('!') || !cell.f) continue;
      n++;
      const rc = rec.Sheets['Annual Projection'][addr] as any;
      expect(rc.t, `${addr} ${cell.f}`).not.toBe('e');
      if (typeof cell.v === 'number') expect(rc.v, `${addr} ${cell.f}`).toBeCloseTo(cell.v, Math.abs(cell.v) > 1e5 ? 0 : 5);
    }
    expect(n).toBeGreaterThan(30000);
  }, 300000);
});
