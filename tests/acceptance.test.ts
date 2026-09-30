import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseFlukeFile } from '../src/fluke/parse';
import { analyzeLogger } from '../src/fluke/logger';
import { fmtTs } from '../src/utils/format';

const FILE = 'sample-data/LC5_CH3__SN_62934227__260628_1539_trend.txt';

/**
 * Original acceptance test. The real Fluke export is customer data and is NOT part of this repository;
 * drop it at `sample-data/…trend.txt` and this suite runs (otherwise it is skipped, and reported as such).
 */
describe.skipIf(!existsSync(FILE))('acceptance: LC5_CH3 Fluke sample', () => {
  it('reproduces the original figures', async () => {
    const d = await parseFlukeFile('LC5_CH3__SN_62934227__260628_1539_trend.txt', new Uint8Array(readFileSync(FILE)));
    const a = analyzeLogger(d);
    expect(d.rowCount).toBe(4259);
    expect(d.intervalMinutes).toBe(5);
    expect(d.chiller).toBe('CH3');
    expect(d.serial).toBe('62934227');
    expect(d.sourceUnit).toBe('W');
    expect(a.totalKWh).toBeCloseTo(181957, -2);
    expect(a.runningThresholdKW).toBeCloseTo(104, 0);
    expect(a.runningHours).toBeCloseTo(155.3, 0);
    expect(a.loggedHours).toBeCloseTo(354.8, 0);
    expect(a.starts).toBe(2);
    expect(a.avgRunningKW).toBeCloseTo(1169, -1);
    expect(a.peakKW).toBeCloseTo(1314, -1);
    expect(fmtTs(a.peakTs)).toBe('2026-07-03 05:32');
    expect(a.standbyKW).toBeCloseTo(2.1, 0);
    expect(a.phaseAvgKW!.map(Math.round)).toEqual([392, 391, 386]);
  });
});
