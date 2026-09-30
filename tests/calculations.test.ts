import { describe, expect, it } from 'vitest';
import { coolingLoadTR, copFromKwPerTR, deltaToC, eerFromKwPerTR, flowToKgPerS, loadToTR, KW_PER_TR } from '../src/calculations/units';
import { computeKpis, rate } from '../src/calculations/kpis';
import { filterRows, aggregatePlant } from '../src/analysis/filter';
import { S } from './helpers';
import type { Row } from '../src/types';

describe('cooling load and unit conversions', () => {
  it('Q[TR] = m·4.186·ΔT/3.51685', () => {
    expect(coolingLoadTR(100, 12, 6.5)).toBeCloseTo((100 * 4.186 * 5.5) / 3.51685, 9);
    expect(coolingLoadTR(100, 12, 6.5)).toBeCloseTo(654.6, 0);
  });
  it('flow conversions', () => {
    expect(flowToKgPerS(10, 'L/s')).toBe(10);
    expect(flowToKgPerS(360, 'm3/h')).toBeCloseTo(100, 9);
    expect(flowToKgPerS(1000, 'gpm')).toBeCloseTo(63.0902, 9);
  });
  it('°F ΔT × 5/9', () => expect(deltaToC(9, 'F')).toBeCloseTo(5, 12));
  it('load unit conversions', () => {
    expect(loadToTR(351.685, 'kWth', 1)).toBeCloseTo(100, 9);
    expect(loadToTR(50, 'TRh', 0.25)).toBeCloseTo(200, 9);
    expect(loadToTR(100, 'TR', 1)).toBe(100);
    expect(loadToTR(351.685 * 0.5, 'kWhth', 0.5)).toBeCloseTo(100, 9);
  });
  it('kW/TR, COP, EER', () => {
    expect(copFromKwPerTR(0.6)).toBeCloseTo(KW_PER_TR / 0.6, 12);
    expect(eerFromKwPerTR(0.6)).toBeCloseTo(20, 12);
  });
});

describe('rating bands', () => {
  it.each([
    ['plant', 'water', 0.75, 'Excellent'], ['plant', 'water', 0.7501, 'Good'], ['plant', 'water', 0.9, 'Good'],
    ['plant', 'water', 1.0, 'Fair'], ['plant', 'water', 1.01, 'Needs improvement'],
    ['chiller', 'water', 0.6, 'Excellent'], ['chiller', 'water', 0.7, 'Good'], ['chiller', 'water', 0.85, 'Fair'], ['chiller', 'water', 0.86, 'Needs improvement'],
    ['plant', 'air', 1.15, 'Excellent'], ['plant', 'air', 1.3, 'Good'], ['plant', 'air', 1.45, 'Fair'], ['plant', 'air', 1.46, 'Needs improvement'],
    ['chiller', 'air', 1.0, 'Excellent'], ['chiller', 'air', 1.2, 'Good'], ['chiller', 'air', 1.4, 'Fair'], ['chiller', 'air', 1.41, 'Needs improvement'],
  ] as const)('%s %s %s → %s', (k, t, v, exp) => expect(rate(k, t, v)).toBe(exp));
});

const row = (o: Partial<Row>): Row => ({ ts: 0, chiller: 'CH1', kW: 300, load: 500, lchwt: 6.5, echwt: 12, ecwt: 28, aux: 50, ...o });

describe('row filtering', () => {
  it('counts each exclusion reason separately', () => {
    const rows = [
      row({}), // ok (0.6 kW/TR)
      row({ kW: 0.5 }), // lowPower (and outlier: 0.5/500)
      row({ load: 20 }), // lowLoad (500*0.05 = 25), and outlier 300/20
      row({ kW: NaN }), // non-numeric
      row({ kW: 1400 }), // 2.8 kW/TR outlier only
      row({ kW: 1 }), // kW ≤ 1
      row({ ts: NaN }), // bad timestamp
    ];
    const { kept, counts } = filterRows(rows, S());
    expect(kept).toHaveLength(1);
    expect(counts.reasons.nonNumeric).toBe(1);
    expect(counts.reasons.lowPower).toBe(2);
    expect(counts.reasons.lowLoad).toBe(1);
    expect(counts.reasons.outlier).toBe(4); // kW 0.5, load 20, kW 1400, kW 1
    expect(counts.reasons.badTimestamp).toBe(1);
    expect(counts.excluded).toBe(6);
    expect(counts.kept + counts.excluded).toBe(counts.total);
  });
  it('load exactly at rated×minPLR is rejected (≤)', () => {
    expect(filterRows([row({ load: 25, kW: 20 })], S()).kept).toHaveLength(0);
    expect(filterRows([row({ load: 25.01, kW: 20 })], S()).kept).toHaveLength(1);
  });
  it('outlier filter can be disabled', () => {
    expect(filterRows([row({ kW: 1400 })], S({ outlierFilter: false })).kept).toHaveLength(1);
  });
  it('per-chiller rated capacity override', () => {
    const s = S({ chillerOverrides: { CH1: { ratedTR: 1000 } } });
    expect(filterRows([row({ load: 40, kW: 30 })], s).kept).toHaveLength(0); // 1000×0.05 = 50
  });
});

describe('plant aggregation and energy weighting', () => {
  it('sums kW/TR, averages temperatures, aux max vs sum', () => {
    const rows = [
      row({ chiller: 'CH1', kW: 300, load: 500, aux: 60, ecwt: 26 }),
      row({ chiller: 'CH2', kW: 350, load: 500, aux: 60, ecwt: 30 }),
    ];
    const { kept } = filterRows(rows, S());
    const max = aggregatePlant(kept, S({ auxMode: 'max' }))[0];
    expect(max.kW).toBe(650); expect(max.tr).toBe(1000); expect(max.aux).toBe(60); expect(max.ecwt).toBe(28);
    expect(aggregatePlant(kept, S({ auxMode: 'sum' }))[0].aux).toBe(120);
  });
  it('period efficiency is ΣkWh/ΣTR·h, not the mean of interval ratios', () => {
    // interval A: 100 kW / 1000 TR = 0.1 (outside outlier band but filter disabled); interval B: 400 kW / 500 TR = 0.8
    const s = S({ outlierFilter: false });
    const rows = [row({ ts: 0, kW: 100, load: 1000, aux: 0 }), row({ ts: 300000, kW: 400, load: 500, aux: 0 })];
    const { kept } = filterRows(rows, s);
    const k = computeKpis(aggregatePlant(kept, s), kept, 5 / 60, s);
    expect(k.plantKwPerTR).toBeCloseTo(500 / 1500, 12); // 0.3333
    expect(k.plantKwPerTR).not.toBeCloseTo((0.1 + 0.8) / 2, 3);
  });
  it('plant kW/TR includes aux; KPIs are consistent', () => {
    const s = S();
    const rows = [row({ ts: 0, kW: 300, load: 500, aux: 50 }), row({ ts: 3600000, kW: 300, load: 500, aux: 50 })];
    const { kept } = filterRows(rows, s);
    const k = computeKpis(aggregatePlant(kept, s), kept, 1, s);
    expect(k.chillerKWh).toBe(600); expect(k.auxKWh).toBe(100); expect(k.trHours).toBe(1000);
    expect(k.plantKwPerTR).toBeCloseTo(0.7, 12); expect(k.chillerKwPerTR).toBeCloseTo(0.6, 12);
    expect(k.auxShare).toBeCloseTo(100 / 700, 12);
    expect(k.thermalKWh).toBeCloseTo(1000 * 3.51685, 6);
    expect(k.peakLoad).toBe(500); expect(k.avgLoad).toBe(500); expect(k.loadFactor).toBe(1);
    expect(k.installedTR).toBe(500);
    expect(k.kWhAboveTarget).toBeCloseTo(0, 9); // 0.7 < 0.75 target
    const k2 = computeKpis(aggregatePlant(kept, S({ targetKwPerTR: 0.6 })), kept, 1, S({ targetKwPerTR: 0.6 }));
    expect(k2.kWhAboveTarget).toBeCloseTo(700 - 600, 9);
    expect(k2.costAboveTarget).toBeCloseTo(100 * 0.2, 9);
    expect(k2.annualizedCost).toBeCloseTo(100 * 0.2 * 8760 / 2, 6);
  });
});
