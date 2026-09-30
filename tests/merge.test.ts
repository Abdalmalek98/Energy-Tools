import { describe, expect, it } from 'vitest';
import { mergeLoggers } from '../src/analysis/merge';
import { analyze } from '../src/analysis/analyze';
import { autoMap, parseBms } from '../src/analysis/bms';
import { parseTable } from '../src/utils/csv';
import { makeBmsCsv, S } from './helpers';
import type { LoggerData } from '../src/types';

const T0 = Date.UTC(2026, 6, 1);
const logger = (chiller: string, samples: [number, number][], intervalMinutes: number): LoggerData => ({
  fileName: `${chiller}.txt`, chiller, serial: '1', model: '1738', sourceUnit: 'kW', unitAssumed: false, powerColumn: 'p',
  intervalMinutes, samples: samples.map(([ts, kW]) => ({ ts, kW })), rowCount: samples.length, notes: [], columns: [],
});
function bmsOf() {
  const t = parseTable(makeBmsCsv({ steps: 48 }));
  const s = S();
  return { bms: parseBms(t, autoMap(t.headers), s), s };
}

describe('logger / BMS merge', () => {
  it('averages readings whose midpoint lies in [T−Δ/2, T+Δ/2] and never overwrites BMS kW', () => {
    const { bms } = bmsOf();
    const T = T0 + 30 * 60000; // 00:30
    const lg = logger('CH1', [[T - 150000, 100], [T - 60000, 200], [T, 300], [T + 150000, 400], [T + 151000, 9999]], 1);
    const before = bms.rows.map((r) => r.kW);
    const { rows } = mergeLoggers(bms, [{ logger: lg, chiller: 'CH1' }]);
    const r = rows.find((x) => x.chiller === 'CH1' && x.ts === T)!;
    expect(r.kWLogger).toBeCloseTo((100 + 200 + 300 + 400) / 4, 9); // window is inclusive at both ends, 9999 is outside
    expect(rows.map((x) => x.kW)).toEqual(before);
    expect(bms.rows.every((x) => x.kWLogger === undefined)).toBe(true);
  });
  it('falls back to the nearest reading within one interval, else nothing', () => {
    const { bms } = bmsOf();
    const T = T0 + 60 * 60000;
    const lg = logger('CH1', [[T + 4 * 60000, 500], [T + 60 * 60000, 700]], 10); // 4 min after; far away
    const { rows } = mergeLoggers(bms, [{ logger: lg, chiller: 'CH1' }]);
    expect(rows.find((x) => x.chiller === 'CH1' && x.ts === T)!.kWLogger).toBe(500);
    expect(rows.find((x) => x.chiller === 'CH1' && x.ts === T + 15 * 60000)!.kWLogger).toBeNaN();
    expect(rows.find((x) => x.chiller === 'CH2' && x.ts === T)!.kWLogger).toBeUndefined();
  });
  it('is independent of upload order (BMS first or logger first) and of logger order', () => {
    const { bms, s } = bmsOf();
    const a = logger('CH1', Array.from({ length: 200 }, (_, i) => [T0 + i * 60000 + 30000, 200 + (i % 7)] as [number, number]), 1);
    const b = logger('CH2', Array.from({ length: 200 }, (_, i) => [T0 + i * 60000 + 30000, 250 + (i % 5)] as [number, number]), 1);
    const r1 = analyze({ bms, settings: s, attachments: [{ logger: a, chiller: 'CH1' }, { logger: b, chiller: 'CH2' }] });
    const r2 = analyze({ bms, settings: s, attachments: [{ logger: b, chiller: 'CH2' }, { logger: a, chiller: 'CH1' }] });
    expect(r1.kpis.chillerKWh).toBeCloseTo(r2.kpis.chillerKWh, 9);
    expect(r1.exclusions).toEqual(r2.exclusions);
  });
  it('"Analyse only logged period" restricts the rows; disabled keeps them (falling back to BMS kW)', () => {
    const { bms } = bmsOf();
    const lg = logger('CH1', Array.from({ length: 60 }, (_, i) => [T0 + i * 60000 + 30000, 250] as [number, number]), 1); // 1 h
    const on = analyze({ bms, settings: S({ analyseLoggedPeriodOnly: true }), attachments: [{ logger: lg, chiller: 'CH1' }] });
    const off = analyze({ bms, settings: S({ analyseLoggedPeriodOnly: false }), attachments: [{ logger: lg, chiller: 'CH1' }] });
    expect(on.exclusions.total).toBeLessThan(off.exclusions.total);
    expect(on.plantRows.every((p) => p.ts >= T0 - 150000 && p.ts <= T0 + 3600000 + 150000)).toBe(true);
    expect(off.exclusions.total).toBe(bms.rows.length);
    // CH1 rows inside the window use logger power (250 kW)
    expect(on.chillerRows.filter((r) => r.chiller === 'CH1').every((r) => r.kW === 250)).toBe(true);
  });
  it('a logger can be removed: analysis reverts to BMS power', () => {
    const { bms, s } = bmsOf();
    const lg = logger('CH1', [[T0 + 30000, 250]], 1);
    const without = analyze({ bms, settings: s });
    const withL = analyze({ bms, settings: S({ analyseLoggedPeriodOnly: false }), attachments: [{ logger: lg, chiller: 'CH1' }] });
    const removed = analyze({ bms, settings: S({ analyseLoggedPeriodOnly: false }), attachments: [] });
    expect(removed.kpis.chillerKWh).toBeCloseTo(without.kpis.chillerKWh, 9);
    expect(withL.kpis.chillerKWh).not.toBeCloseTo(without.kpis.chillerKWh, 3);
  });
});
