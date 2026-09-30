import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { openProject, saveProject, ProjectError, type ProjectState } from '../src/storage/project';
import { parseTable } from '../src/utils/csv';
import { makeBmsCsv, S } from './helpers';
import { parseFlukeFile } from '../src/fluke/parse';
import { makeFlukeTxt } from './fixtures';

async function sample(): Promise<ProjectState> {
  const lg = await parseFlukeFile('LC5_CH3__SN_1_x.txt', new TextEncoder().encode(makeFlukeTxt({ rows: 50 }).text));
  lg.samples[3].kW = NaN;
  return { name: 'Test plant', settings: S({ targetKwPerTR: 0.7 }), mapping: { timestamp: 0, power: 2 }, bmsFileName: 'a.csv', bmsTable: parseTable(makeBmsCsv({ steps: 20 })), loggers: [{ data: lg, chiller: 'CH1' }], results: { kpi: 1 } };
}

describe('project files (.cpa)', () => {
  it('round-trips metadata, BMS data, loggers (incl. NaN), settings and mapping', async () => {
    const p = await sample();
    const { project, manifest } = await openProject(await saveProject(p));
    expect(manifest.kind).toBe('project');
    expect(project.name).toBe('Test plant');
    expect(project.settings.targetKwPerTR).toBe(0.7);
    expect(project.mapping).toEqual({ timestamp: 0, power: 2 });
    expect(project.bmsTable!.rows).toEqual(p.bmsTable!.rows);
    expect(project.loggers[0].chiller).toBe('CH1');
    expect(project.loggers[0].data.samples.length).toBe(50);
    expect(project.loggers[0].data.samples[3].kW).toBeNaN();
  });
  it('backup kind and tamper detection', async () => {
    const bytes = await saveProject(await sample(), 'backup');
    expect((await openProject(bytes)).manifest.kind).toBe('backup');
    const zip = await JSZip.loadAsync(bytes);
    zip.file('settings.json', JSON.stringify({ targetKwPerTR: 0.1 }));
    await expect(openProject(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/Integrity check failed/);
  });
  it('rejects non-project files with a useful message', async () => {
    await expect(openProject(new TextEncoder().encode('hello'))).rejects.toBeInstanceOf(ProjectError);
    const z = new JSZip(); z.file('x.txt', 'y');
    await expect(openProject(await z.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/manifest/);
  });
});
