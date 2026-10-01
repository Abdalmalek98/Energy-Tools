import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import XLSX from 'xlsx-js-style';
import { buildWorkbook } from '../src/excel/workbook';
import { analyze } from '../src/analysis/analyze';
import { autoMap, parseBms } from '../src/analysis/bms';
import { parseTable } from '../src/utils/csv';
import { parseFlukeFile } from '../src/fluke/parse';
import { makeBmsCsv, S } from './helpers';
import { makeFlukeTxt } from './fixtures';

const t = parseTable(makeBmsCsv({ steps: 576 }));
const s = S();
const bms = parseBms(t, autoMap(t.headers), s);
const analysis = analyze({ bms, settings: s });
const hasSoffice = spawnSync('which', ['soffice']).status === 0;

describe('Excel export', () => {
  it('has all required sheets, native charts and cached formula values', async () => {
    const out = await buildWorkbook({ analysis, loggers: [] });
    expect(out.fileName).toBe(`Chiller_Plant_Analysis_${analysis.firstDate}.xlsx`);
    expect(out.sheets).toEqual(['Summary', 'Charts', 'Findings', 'Chillers', 'Regression', 'Load Profile', 'Plant Hourly', 'Chiller Data', 'Chart Data']);
    const zip = await JSZip.loadAsync(out.bytes);
    const charts = Object.keys(zip.files).filter((f) => /^xl\/charts\/chart\d+\.xml$/.test(f));
    expect(charts.length).toBeGreaterThanOrEqual(5);
    const sheet2 = await zip.file('xl/worksheets/sheet2.xml')!.async('string');
    expect(sheet2).toContain('<drawing r:id="rIdDrawing1"/>');
    // Excel is strict about CT_Worksheet child order: sheetPr first, then … pageSetup … ignoredErrors … drawing last
    const pos = (t: string) => sheet2.indexOf(t);
    expect(pos('<sheetPr')).toBeGreaterThan(-1);
    expect(pos('<sheetPr')).toBeLessThan(pos('<dimension'));
    expect(pos('</sheetData>')).toBeLessThan(pos('<pageSetup'));
    if (pos('<ignoredErrors') >= 0) expect(pos('<pageSetup')).toBeLessThan(pos('<ignoredErrors'));
    expect(pos('<pageSetup')).toBeLessThan(pos('<drawing'));
    expect(pos('<drawing')).toBeGreaterThan(pos('</sheetData>'));
    expect(sheet2.trimEnd().endsWith('<drawing r:id="rIdDrawing1"/></worksheet>')).toBe(true);
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('drawingml.chart+xml');
    const wb = XLSX.read(out.bytes, { type: 'array', cellFormula: true });
    const sum = wb.Sheets['Summary'];
    const kw = Object.values(sum).find((c: any) => c?.f && /\(B\d+\+B\d+\)\/B\d+/.test(c.f)) as any;
    expect(kw.v).toBeCloseTo(analysis.kpis.plantKwPerTR, 9);
  });
  it('logger-only export uses the power-profile name and has logger sheets', async () => {
    const lg = await parseFlukeFile('LC5_CH3__SN_62934227__x.txt', new TextEncoder().encode(makeFlukeTxt({ rows: 800 }).text));
    const out = await buildWorkbook({ analysis: null, loggers: [lg] });
    expect(out.fileName).toMatch(/^Chiller_Power_Profile_CH3_2026-06-28\.xlsx$/);
    expect(out.sheets).toEqual(['Summary', 'Charts', 'Findings', 'Logger Data', 'Chart Data']);
    const zip = await JSZip.loadAsync(out.bytes);
    expect(Object.keys(zip.files).filter((f) => /charts\/chart\d/.test(f)).length).toBe(2);
  });
  it('BMS + logger export appends logger sheets', async () => {
    const lg = await parseFlukeFile('LC5_CH1__SN_1_x.txt', new TextEncoder().encode(makeFlukeTxt({ rows: 100 }).text));
    const out = await buildWorkbook({ analysis, loggers: [lg] });
    expect(out.sheets.slice(-2)).toEqual(['Logger Summary', 'Logger Data']);
  });

  it.skipIf(!hasSoffice)('recalculates in LibreOffice without formula errors and matches cached values', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpa-xlsx-'));
    const lg = await parseFlukeFile('LC5_CH1__SN_1_x.txt', new TextEncoder().encode(makeFlukeTxt({ rows: 300 }).text));
    const cached = await buildWorkbook({ analysis, loggers: [lg] });
    const bare = await buildWorkbook({ analysis, loggers: [lg], noCache: true });
    writeFileSync(join(dir, 'bare.xlsx'), bare.bytes);
    writeFileSync(join(dir, 'cached.xlsx'), cached.bytes);
    execFileSync('soffice', ['--headless', '--norestore', `-env:UserInstallation=file://${dir}/lo`, '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', join(dir, 'out'), join(dir, 'bare.xlsx')], { timeout: 180000 });
    const recalced = XLSX.read(readFileSync(join(dir, 'out', 'bare.xlsx')), { type: 'buffer', cellFormula: true });
    const ref = XLSX.read(cached.bytes, { type: 'array', cellFormula: true });
    let formulas = 0;
    for (const name of ref.SheetNames) {
      for (const [addr, cell] of Object.entries(ref.Sheets[name]) as [string, any][]) {
        if (addr.startsWith('!') || !cell.f) continue;
        formulas++;
        const rc = recalced.Sheets[name][addr] as any;
        expect(rc, `${name}!${addr}`).toBeDefined();
        expect(rc.t, `${name}!${addr} (${cell.f}) is an error: ${rc.v}`).not.toBe('e');
        if (typeof cell.v === 'number') expect(rc.v, `${name}!${addr} ${cell.f}`).toBeCloseTo(cell.v, 6);
        else if (cell.v !== '' ) expect(String(rc.v), `${name}!${addr}`).toBe(String(cell.v));
      }
    }
    expect(formulas).toBeGreaterThan(500);
    // charts survive a LibreOffice round trip => package is well formed
    const rz = await JSZip.loadAsync(readFileSync(join(dir, 'out', 'bare.xlsx')));
    expect(Object.keys(rz.files).filter((f) => /charts\/chart\d+\.xml/.test(f)).length).toBeGreaterThanOrEqual(5);
    expect(existsSync(join(dir, 'out', 'bare.xlsx'))).toBe(true);
  }, 240000);
});
