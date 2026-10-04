import { describe, expect, it } from 'vitest';
import { parseTable } from '../src/utils/csv';
import { enthalpyKJkg, parseWeatherHourly, weatherToCdd, WeatherError } from '../src/analysis/weather';
import { runPipeline } from '../src/analysis/pipeline';
import { S, pad } from './helpers';
import type { WeatherHourlyData } from '../src/types';

const st = { weatherHourEnding: false, atmPressureKPa: 101.325 };

describe('psychrometrics', () => {
  it('enthalpy of moist air matches chart values', () => {
    expect(enthalpyKJkg(30, 50)).toBeCloseTo(64.3, 0); // 30 °C / 50 % RH ≈ 64.3 kJ/kg
    expect(enthalpyKJkg(25, 50)).toBeCloseTo(50.4, 0);
    expect(enthalpyKJkg(35, 0)).toBeCloseTo(1.006 * 35, 6); // dry air
    expect(enthalpyKJkg(35, 60)).toBeGreaterThan(enthalpyKJkg(35, 40));
  });
});

describe('hourly weather import', () => {
  it('reads temperature only', () => {
    const w = parseWeatherHourly(parseTable('Date/Time,Temperature (C)\n2026-07-01 00:00,28.5\n2026-07-01 01:00,27.9\n'), st);
    expect(w.hours.map((h) => h.tempC)).toEqual([28.5, 27.9]);
    expect(w.hasHumidity).toBe(false);
    expect(w.hasEnthalpy).toBe(false);
    expect(w.hours[0].enthalpy).toBeUndefined();
  });
  it('computes enthalpy from temperature + humidity when no enthalpy column exists', () => {
    const w = parseWeatherHourly(parseTable('time,Dry Bulb (C),RH (%)\n2026-07-01 00:00,30,50\n'), st);
    expect(w.hasHumidity && w.hasEnthalpy && w.enthalpyComputed).toBe(true);
    expect(w.hours[0].enthalpy).toBeCloseTo(enthalpyKJkg(30, 50), 9);
    expect(w.notes.join(' ')).toContain('computed');
  });
  it('uses a supplied enthalpy column (kJ/kg or Btu/lb) instead of computing', () => {
    const a = parseWeatherHourly(parseTable('time,Temp C,Humidity %,Enthalpy kJ/kg\n2026-07-01 00:00,30,50,70\n'), st);
    expect(a.hours[0].enthalpy).toBe(70);
    expect(a.enthalpyComputed).toBe(false);
    const b = parseWeatherHourly(parseTable('time,Temp C,Enthalpy (Btu/lb)\n2026-07-01 00:00,30,30\n'), st);
    expect(b.hours[0].enthalpy).toBeCloseTo(30 * 2.326, 9);
    expect(b.hasHumidity).toBe(false);
    expect(b.hasEnthalpy).toBe(true);
  });
  it('converts °F, humidity fractions, averages sub-hourly rows and honours hour-ending stamps', () => {
    const f = parseWeatherHourly(parseTable('time,Temperature (F),Humidity\n2026-07-01 00:00,95,0.5\n2026-07-01 00:30,95,0.7\n'), st);
    expect(f.hours).toHaveLength(1);
    expect(f.hours[0].tempC).toBeCloseTo(35, 9);
    expect(f.hours[0].rh).toBeCloseTo(60, 9);
    const he = parseWeatherHourly(parseTable('time,Temperature (C)\n2026-07-01 01:00,30\n'), { ...st, weatherHourEnding: true });
    expect(he.hours[0].ts).toBe(Date.UTC(2026, 6, 1, 0, 0));
  });
  it('explains missing columns', () => {
    expect(() => parseWeatherHourly(parseTable('time,Humidity\n2026-07-01 00:00,40\n'), st)).toThrow(/No temperature column/);
    expect(() => parseWeatherHourly(parseTable('foo,bar\n1,2\n'), st)).toThrow(WeatherError);
  });
  it('derives daily CDD from hourly temperatures (complete days only)', () => {
    const rows = ['time,temperature'];
    for (let h = 0; h < 24; h++) rows.push(`2026-07-01 ${pad(h)}:00,${h < 12 ? 20 : 40}`);
    for (let h = 0; h < 10; h++) rows.push(`2026-07-02 ${pad(h)}:00,50`);
    const c = weatherToCdd(parseWeatherHourly(parseTable(rows.join('\n')), st), { cddBaseTemp: 18.3 });
    expect(c.days).toHaveLength(1);
    expect(c.days[0].cdd).toBeCloseTo(30 - 18.3, 9);
    expect(c.days[0].tempC).toBeCloseTo(30, 9);
  });
});

// ---- exactly solvable: hourly plant data, kW = 100 + 10·T (+ 0.5·RH in the humidity case), TR = 500 + 20·T
function build(days: number, opts: { rhEffect?: boolean; offNight?: boolean } = {}) {
  const lines = ['time,kW,TR'];
  const wx = ['time,Temperature (C),Relative Humidity (%)'];
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      const T = 22 + 8 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + (d % 5) * 0.7;
      const RH = 45 + 25 * Math.cos((h / 24) * 2 * Math.PI) + (d % 3) * 4;
      const t = new Date(Date.UTC(2026, 6, 1 + d, h));
      const stamp = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:00`;
      const off = opts.offNight && h < 5;
      const kw = off ? 0.2 : 100 + 10 * T + (opts.rhEffect ? 0.5 * RH : 0);
      const tr = off ? 0 : 500 + 20 * T;
      // four 15-minute rows per hour
      for (let q = 0; q < 4; q++) lines.push(`${stamp.slice(0, 14)}${pad(q * 15)},${kw},${tr}`);
      wx.push(`${stamp},${T.toFixed(8)},${RH.toFixed(8)}`);
    }
  }
  return { bms: lines.join('\n'), wx: wx.join('\n') };
}
const settings = S({ loadSource: 'column', loadUnit: 'TR', minPLR: 0.05, outlierFilter: false });
const run = (b: { bms: string; wx: string }, st = settings, weather: WeatherHourlyData | null = parseWeatherHourly(parseTable(b.wx), st)) =>
  runPipeline({ table: parseTable(b.bms), mapping: { timestamp: 0, power: 1, load: 2 }, settings: st, loggers: [], weather });

describe('hourly weather regression', () => {
  const b = build(10);
  const out = run(b).analysis!;
  const w = out.weather!;
  it('joins by hour and recovers exact coefficients; hourly Guideline 14 limits', () => {
    expect(out.weather).not.toBeNull();
    expect(w.usedHours).toBe(240);
    const t = w.candidates.find((c) => c.id === 'temperature')!;
    expect(t.energy.coefs[0].value).toBeCloseTo(100, 4);
    expect(t.energy.coefs[1].value).toBeCloseTo(10, 5);
    expect(t.load!.coefs[1].value).toBeCloseTo(20, 5);
    expect(t.energy.guideline14.cvLimit).toBe(30);
    expect(t.energy.guideline14.nmbeLimit).toBe(10);
    expect(t.energy.r2).toBeCloseTo(1, 10);
    expect(w.correlations.temperature).toBeCloseTo(1, 8);
  });
  it('offers enthalpy and temperature + humidity models when humidity is present, and keeps the simplest adequate model', () => {
    expect(w.candidates.map((c) => c.id)).toEqual(['temperature', 'enthalpy', 'temperature+humidity']);
    expect(w.enthalpyComputed).toBe(true);
    expect(w.selected!.id).toBe('temperature'); // temperature already explains everything – no model beats it by 5 %
  });
  it('selects the humidity model when humidity truly drives power', () => {
    const o = run(build(10, { rhEffect: true })).analysis!.weather!;
    expect(o.selected!.id).toBe('temperature+humidity');
    const m = o.selected!.energy;
    expect(m.coefs[1].value).toBeCloseTo(10, 4);
    expect(m.coefs[2].value).toBeCloseTo(0.5, 5);
    expect(o.correlations.humidity).not.toBeNull();
  });
  it('weather-normalised result and bins', () => {
    expect(w.normalised!.kwPerTR).toBeGreaterThan(0);
    const meanT = w.reference!.tempC;
    expect(w.normalised!.kW).toBeCloseTo(100 + 10 * meanT, 4);
    expect(w.normalised!.tr).toBeCloseTo(500 + 20 * meanT, 4);
    expect(w.tempBins.reduce((a, x) => a + x.hours, 0)).toBe(240);
    expect(w.enthalpyBins!.reduce((a, x) => a + x.hours, 0)).toBe(240);
    const hot = w.tempBins[w.tempBins.length - 1];
    expect(hot.avgKW).toBeGreaterThanOrEqual(100 + 10 * hot.lo - 1e-6); // average of the hot bin lies inside the bin's own range
    expect(hot.avgKW).toBeLessThanOrEqual(100 + 10 * hot.hi + 1e-6);
    expect(hot.kwPerTR).toBeCloseTo((100 + 10 * ((hot.lo + hot.hi) / 2)) / (500 + 20 * ((hot.lo + hot.hi) / 2)), 1);
  });
  it('temperature-only weather works (no humidity, no enthalpy bins)', () => {
    const o = run(b, settings, parseWeatherHourly(parseTable(b.wx.split('\n').map((l) => l.split(',').slice(0, 2).join(',')).join('\n')), settings)).analysis!.weather!;
    expect(o.candidates.map((c) => c.id)).toEqual(['temperature']);
    expect(o.hasHumidity).toBe(false);
    expect(o.enthalpyBins).toBeNull();
  });
  it('hours with the plant off are left out by default and kept on request', () => {
    const nb = build(10, { offNight: true });
    const a = run(nb).analysis!.weather!;
    expect(a.usedHours).toBe(10 * 19);
    expect(a.skipped.partial).toBe(50);
    const b2 = run(nb, { ...settings, weatherIncludeOffHours: true }).analysis!.weather!;
    expect(b2.usedHours).toBe(240);
  });
  it('hours without weather are reported; too little overlap gives a note instead of a model', () => {
    const half = build(10);
    const short = { ...half, wx: half.wx.split('\n').slice(0, 1 + 24 * 3).join('\n') };
    const o = run(short).analysis!.weather!;
    expect(o.skipped.noWeather).toBe(7 * 24);
    expect(o.usedHours).toBe(72);
    const tiny = run({ ...half, wx: half.wx.split('\n').slice(0, 1 + 10).join('\n') }).analysis!.weather!;
    expect(tiny.selected).toBeNull();
    expect(tiny.notes.join(' ')).toContain('at least 24');
  });
  it('drives the daily CDD analysis too when no CDD file is loaded, and an explicit CDD file wins', () => {
    expect(out.cdd).not.toBeNull();
    expect(out.cdd!.notes.join(' ')).toContain('derived from the hourly temperatures');
    expect(out.cdd!.usedDays).toBe(10);
    const explicit = runPipeline({ table: parseTable(b.bms), mapping: { timestamp: 0, power: 1, load: 2 }, settings, loggers: [], weather: parseWeatherHourly(parseTable(b.wx), settings), cdd: { fileName: 'cdd.csv', source: 'cdd', rowCount: 10, notes: [], days: Array.from({ length: 10 }, (_, d) => ({ day: Date.UTC(2026, 6, 1 + d), cdd: d + 1 })) } }).analysis!;
    expect(explicit.cdd!.fileName).toBe('cdd.csv');
  });
  it('adds the hourly weather finding only with weather data', () => {
    expect(out.findings.map((f) => f.id)).toContain('weather-hourly');
    expect(run(b, settings, null).analysis!.findings.map((f) => f.id)).not.toContain('weather-hourly');
    expect(out.findings.find((f) => f.id === 'weather-hourly')!.text).toContain('R²');
  });
});

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import XLSX from 'xlsx-js-style';
import JSZip from 'jszip';
import { buildWorkbook } from '../src/excel/workbook';

describe('Excel with hourly weather', () => {
  it('adds the sheet and the weather charts', async () => {
    const out = await buildWorkbook({ analysis: run(build(10)).analysis!, loggers: [] });
    expect(out.sheets).toContain('Weather Hourly');
    const z = await JSZip.loadAsync(out.bytes);
    const titles = await Promise.all(Object.keys(z.files).filter((f) => /charts\/chart\d+\.xml$/.test(f)).map((f) => z.file(f)!.async('string')));
    expect(titles.some((t) => t.includes('Hourly plant kW vs outdoor temperature'))).toBe(true);
    expect(titles.some((t) => t.includes('vs enthalpy'))).toBe(true);
  });
  it.skipIf(spawnSync('which', ['soffice']).status !== 0)('formulas recalculate in LibreOffice and match the cached values', async () => {
    const a = run(build(10)).analysis!;
    const dir = mkdtempSync(join(tmpdir(), 'cpa-wx-'));
    const cached = await buildWorkbook({ analysis: a, loggers: [] });
    const bare = await buildWorkbook({ analysis: a, loggers: [], noCache: true });
    writeFileSync(join(dir, 'bare.xlsx'), bare.bytes);
    execFileSync('soffice', ['--headless', '--norestore', `-env:UserInstallation=file://${dir}/lo`, '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', join(dir, 'out'), join(dir, 'bare.xlsx')], { timeout: 180000 });
    const rec = XLSX.read(readFileSync(join(dir, 'out', 'bare.xlsx')), { type: 'buffer', cellFormula: true });
    const ref = XLSX.read(cached.bytes, { type: 'array', cellFormula: true });
    let n = 0;
    for (const [addr, cell] of Object.entries(ref.Sheets['Weather Hourly']) as [string, any][]) {
      if (addr.startsWith('!') || !cell.f) continue;
      n++;
      const rc = rec.Sheets['Weather Hourly'][addr] as any;
      expect(rc.t, `${addr} ${cell.f}`).not.toBe('e');
      if (typeof cell.v === 'number') expect(rc.v, `${addr} ${cell.f}`).toBeCloseTo(cell.v, 5);
    }
    expect(n).toBeGreaterThan(500);
  }, 240000);
});
