import { describe, expect, it } from 'vitest';
import { parseTable } from '../src/utils/csv';
import { autoMapTable, detectUnitSettings, parseBms } from '../src/analysis/bms';
import { runPipeline } from '../src/analysis/pipeline';
import { suggestChiller } from '../src/analysis/merge';
import { parseFlukeFile } from '../src/fluke/parse';
import { makeFlukeTxt } from './fixtures';
import { S } from './helpers';

/** Layout of a stand-alone data-logger export (flow + two RTD probes, no power, no chiller column):
 *  the first "Time" column is only filled for the first rows; the real time is in a trailing unnamed column. */
function dlogCsv(rows = 400) {
  const lines = ['Time (YY:MM:DD hh:mm:ss.s),Flow (US GPM),RTD1 Temperature (C),RTD2 Temperature (C),'];
  for (let i = 0; i < rows; i++) {
    const t = new Date(Date.UTC(2026, 5, 28, 15, 40) + i * 300000); // 28 Jun 2026, 5-minute rows
    const ts = `${t.getUTCMonth() + 1}/${t.getUTCDate()}/${t.getUTCFullYear()} ${t.getUTCHours()}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
    lines.push(`${i < 8 ? ts : ''},${(8400 + (i % 7) * 10).toFixed(2)},5.39,9.42,${ts}`);
  }
  return lines.join('\r\n');
}

describe('stand-alone data-logger CSV (dlog layout)', () => {
  const table = parseTable(dlogCsv());
  const s = S({ ...detectUnitSettings(table, autoMapTable(table)), analyseLoggedPeriodOnly: true });

  it('maps flow and the two RTD probes (colder = leaving, warmer = entering) and reads units from the headers', () => {
    const m = autoMapTable(table);
    expect(table.headers[m.timestamp!]).toMatch(/^Time/);
    expect(table.headers[m.flow!]).toContain('Flow');
    expect(table.headers[m.lchwt!]).toContain('RTD1');
    expect(table.headers[m.echwt!]).toContain('RTD2');
    expect(detectUnitSettings(table, m)).toEqual({ flowUnit: 'gpm', tempUnit: 'C' });
  });

  it('fills the blank time cells from the trailing time column instead of rejecting those rows', () => {
    const parsed = parseBms(table, autoMapTable(table), s, { powerOptional: true });
    expect(parsed.rows.every((r) => Number.isFinite(r.ts))).toBe(true);
    expect(parsed.interval).toBe(5);
    expect(parsed.parseWarnings.join(' ')).toContain('missing times were taken from column 5');
    expect(parsed.rows[0].load).toBeGreaterThan(2000); // 8400 gpm × 4.07 °C ≈ 2 500 TR
  });

  it('a Fluke logger attaches to the single unnamed chiller and supplies the power', async () => {
    const lg = await parseFlukeFile('LC5_CH3__SN_62934227__x_trend.txt', new TextEncoder().encode(makeFlukeTxt({ rows: 300, start: new Date(Date.UTC(2026, 5, 28, 15, 40)) }).text));
    const t = parseTable(dlogCsv(300));
    const mapping = autoMapTable(t);
    const parsed = parseBms(t, mapping, s, { powerOptional: true });
    expect(parsed.chillers).toEqual(['CH1']);
    expect(suggestChiller(lg, parsed.chillers)).toBe('CH1');
    const out = runPipeline({ table: t, mapping, settings: { ...s, ratedTR: 2500 }, loggers: [{ data: lg, chiller: 'CH1' }] });
    expect(out.error).toBeNull();
    expect(out.analysis!.warnings.join(' ')).not.toContain('none of their readings overlap');
    expect(out.analysis!.exclusions.reasons.badTimestamp).toBe(0);
    expect(out.analysis!.exclusions.kept).toBeGreaterThan(50);
    expect(out.analysis!.kpis.plantKwPerTR).toBeGreaterThan(0);
  });
});

describe('load column without flow/temperatures', () => {
  it('switches the cooling-load source to the column and reads the unit from the header', () => {
    for (const [hdr, unit] of [['Cooling Load (TR)', 'TR'], ['Cooling load kWth', 'kWth'], ['Load TR.h', 'TRh'], ['Cooling load kWh thermal', 'kWhth']] as const) {
      const t = parseTable(`time,kW,${hdr}\n2026-07-01 00:00,100,300\n2026-07-01 00:05,100,300`);
      const u = detectUnitSettings(t, autoMapTable(t));
      expect(u.loadSource, hdr).toBe('column');
      expect(u.loadUnit, hdr).toBe(unit);
    }
    const t2 = parseTable('time,kW,Flow L/s,LCHWT,ECHWT\n2026-07-01 00:00,1,2,3,4');
    expect(detectUnitSettings(t2, autoMapTable(t2)).loadSource).toBeUndefined();
  });
});
