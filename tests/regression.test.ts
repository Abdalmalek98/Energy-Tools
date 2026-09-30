import { describe, expect, it } from 'vitest';
import { tCritical, tTwoSidedP } from '../src/regression/tdist';
import { fitLinear, fitQuadratic, fitMultivariate, regress, computeIplv, IPLV_POINTS } from '../src/regression/models';
import { fitOls } from '../src/regression/ols';
import { rng } from './helpers';

describe('Student t', () => {
  it.each([[1, 12.7062], [5, 2.5706], [10, 2.2281], [30, 2.0423], [120, 1.9799], [1000, 1.9623]])('t crit df=%i', (df, exp) => {
    expect(tCritical(df)).toBeCloseTo(exp, 3);
  });
  it('p-value', () => {
    expect(tTwoSidedP(2.2281, 10)).toBeCloseTo(0.05, 3);
    expect(tTwoSidedP(0, 10)).toBeCloseTo(1, 9);
  });
});

function linearData(n: number, seed = 1) {
  const r = rng(seed);
  const d = [];
  for (let i = 0; i < n; i++) {
    const q = 100 + r() * 400;
    d.push({ q, kW: 50 + 0.5 * q + (r() - 0.5) * 20, ecwt: NaN, lchwt: NaN });
  }
  return d;
}

describe('OLS', () => {
  it('matches closed-form simple regression (coefficients, SE, R², CI)', () => {
    const d = linearData(200);
    const m = fitLinear(d, 5)!;
    const n = d.length;
    const mx = d.reduce((a, r) => a + r.q, 0) / n, my = d.reduce((a, r) => a + r.kW, 0) / n;
    const sxx = d.reduce((a, r) => a + (r.q - mx) ** 2, 0), sxy = d.reduce((a, r) => a + (r.q - mx) * (r.kW - my), 0);
    const b1 = sxy / sxx, b0 = my - b1 * mx;
    const rss = d.reduce((a, r) => a + (r.kW - b0 - b1 * r.q) ** 2, 0), tss = d.reduce((a, r) => a + (r.kW - my) ** 2, 0);
    const s2 = rss / (n - 2);
    expect(m.coefs[0].value).toBeCloseTo(b0, 6);
    expect(m.coefs[1].value).toBeCloseTo(b1, 8);
    expect(m.coefs[1].se).toBeCloseTo(Math.sqrt(s2 / sxx), 8);
    expect(m.coefs[0].se).toBeCloseTo(Math.sqrt(s2 * (1 / n + (mx * mx) / sxx)), 6);
    expect(m.r2).toBeCloseTo(1 - rss / tss, 10);
    expect(m.adjR2).toBeCloseTo(1 - ((1 - m.r2) * (n - 1)) / (n - 2), 10);
    expect(m.rmse).toBeCloseTo(Math.sqrt(s2), 8);
    expect(m.cv).toBeCloseTo((Math.sqrt(s2) / my) * 100, 6);
    expect(Math.abs(m.nmbe)).toBeLessThan(1e-6);
    const tc = tCritical(n - 2);
    expect(m.coefs[1].ciLow).toBeCloseTo(b1 - tc * Math.sqrt(s2 / sxx), 8);
    expect(m.coefs[1].significant).toBe(true);
    expect(m.n).toBe(n);
  });
  it('recovers an exact quadratic in original units (back-transform)', () => {
    const d = Array.from({ length: 50 }, (_, i) => { const q = 50 + i * 10; return { q, kW: 20 + 0.3 * q + 0.0004 * q * q, ecwt: NaN, lchwt: NaN }; });
    const m = fitQuadratic(d, 5)!;
    expect(m.coefs[0].value).toBeCloseTo(20, 4);
    expect(m.coefs[1].value).toBeCloseTo(0.3, 6);
    expect(m.coefs[2].value).toBeCloseTo(0.0004, 8);
    expect(m.predict(300)).toBeCloseTo(20 + 90 + 36, 4);
    expect(m.r2).toBeCloseTo(1, 10);
  });
  it('back-transformed covariance equals unstandardised OLS on centred data with huge offsets', () => {
    // numerical stability: q around 1e6
    const r = rng(7);
    const y = [], q = [];
    for (let i = 0; i < 100; i++) { const x = 1e6 + r() * 1000; q.push(x); y.push(3 + 0.002 * x + (r() - 0.5) * 1e-4); }
    const m = fitOls({ kind: 'linear', y, x: [q], names: ['Q'], intervalMinutes: 5, predictor: (b) => (x) => b[0] + b[1] * x })!;
    expect(m.coefs[1].value).toBeCloseTo(0.002, 6);
  });
  it('returns null for degenerate data', () => {
    expect(fitLinear([{ q: 1, kW: 1, ecwt: NaN, lchwt: NaN }, { q: 1, kW: 2, ecwt: NaN, lchwt: NaN }, { q: 1, kW: 3, ecwt: NaN, lchwt: NaN }], 5)).toBeNull();
  });
});

describe('Guideline 14 thresholds', () => {
  const noisy = (sd: number, interval: number) => {
    const r = rng(3);
    const d = Array.from({ length: 300 }, () => { const q = 100 + r() * 400; return { q, kW: 50 + 0.5 * q + (r() - 0.5) * sd, ecwt: NaN, lchwt: NaN }; });
    return fitLinear(d, interval)!;
  };
  it('hourly-or-finer: CV ≤ 30 %, |NMBE| ≤ 10 %', () => {
    const m = noisy(20, 60);
    expect(m.guideline14.cvLimit).toBe(30); expect(m.guideline14.nmbeLimit).toBe(10);
    expect(m.guideline14.pass).toBe(true);
    expect(noisy(2000, 5).guideline14.pass).toBe(false);
  });
  it('coarser data uses CV ≤ 15 %, |NMBE| ≤ 5 %', () => {
    const m = noisy(20, 1440);
    expect(m.guideline14.cvLimit).toBe(15); expect(m.guideline14.nmbeLimit).toBe(5);
    // a model with CV between 15 and 30 passes hourly but fails daily
    const rough = noisy(150, 60); const roughDaily = noisy(150, 1440);
    expect(rough.cv).toBeGreaterThan(15); expect(rough.cv).toBeLessThan(30);
    expect(rough.guideline14.pass).toBe(true); expect(roughDaily.guideline14.pass).toBe(false);
  });
});

describe('model selection', () => {
  it('stays linear when quadratic gives no material gain', () => {
    const res = regress('X', linearData(200), 5);
    expect(res.selected!.kind).toBe('linear');
  });
  it('moves to quadratic on curved data', () => {
    const r = rng(5);
    const d = Array.from({ length: 300 }, () => { const q = 50 + r() * 450; return { q, kW: 30 + 0.05 * q + 0.0012 * q * q + (r() - 0.5) * 4, ecwt: NaN, lchwt: NaN }; });
    expect(regress('X', d, 5).selected!.kind).toBe('quadratic');
  });
  const mvData = (lchSd: number) => {
    const r = rng(11);
    return Array.from({ length: 400 }, () => {
      const q = 100 + r() * 400; const e = 20 + r() * 12; const l = 6.5 + (r() - 0.5) * lchSd;
      return { q, kW: 30 + 0.3 * q + 0.0003 * q * q + 1.5 * e + 0.002 * q * e + 3 * l + (r() - 0.5) * 3, ecwt: e, lchwt: l };
    });
  };
  it('picks multivariate when ECWT matters and n > 20; drops LCHWT when σ ≤ 0.05', () => {
    const res = regress('X', mvData(4), 5);
    expect(res.selected!.kind).toBe('multivariate');
    expect(res.selected!.terms).toContain('LCHWT');
    const res2 = regress('X', mvData(0.05), 5); // uniform ±0.025 → σ ≈ 0.0144
    const mv = res2.models.find((m) => m.kind === 'multivariate')!;
    expect(mv.droppedLchwt).toBe(true);
    expect(mv.terms).not.toContain('LCHWT');
    expect(mv.terms).toContain('Q×ECWT');
  });
  it('skips multivariate for n ≤ 20 or no ECWT', () => {
    expect(fitMultivariate(mvData(4).slice(0, 20), 5)).toBeNull();
    expect(fitMultivariate(mvData(4).slice(0, 21), 5)).not.toBeNull();
    expect(regress('X', linearData(100), 5).models.map((m) => m.kind)).not.toContain('multivariate');
  });
});

describe('IPLV', () => {
  const fakeModel = {
    predict: (q: number, e = 0) => q * (0.4 + 0.005 * (e - 18)) , // kW/TR depends on ECWT only
  } as any;
  it('IPLV = 1 / Σ(wi/effi) with the four rating points', () => {
    const res = computeIplv(fakeModel, 500, { ecwtMin: 15, ecwtMax: 32, plrMin: 0.1, plrMax: 1 });
    const kw = IPLV_POINTS.map((p) => 0.4 + 0.005 * (p.ecwt - 18));
    const cop = kw.map((k) => 3.51685 / k);
    const exp = 1 / (0.01 / cop[0] + 0.42 / cop[1] + 0.45 / cop[2] + 0.12 / cop[3]);
    expect(res.iplvCOP).toBeCloseTo(exp, 10);
    expect(res.iplvKwPerTR).toBeCloseTo(3.51685 / exp, 10);
    expect(res.points.map((p) => p.weight)).toEqual([0.01, 0.42, 0.45, 0.12]);
    expect(res.points.map((p) => p.ecwt)).toEqual([29.44, 23.89, 18.33, 18.33]);
    expect(res.extrapolated).toBe(false);
  });
  it('marks * when a point is outside measured ECWT ±0.5 or PLR ±0.05', () => {
    expect(computeIplv(fakeModel, 500, { ecwtMin: 20, ecwtMax: 32, plrMin: 0.1, plrMax: 1 }).extrapolated).toBe(true); // 18.33 < 19.5
    expect(computeIplv(fakeModel, 500, { ecwtMin: 18, ecwtMax: 29, plrMin: 0.1, plrMax: 1 }).extrapolated).toBe(false); // 29.44 ≤ 29.5, 0.25 ≥ 0.05
    expect(computeIplv(fakeModel, 500, { ecwtMin: 18, ecwtMax: 29, plrMin: 0.4, plrMax: 1 }).extrapolated).toBe(true); // 0.25 < 0.35
    expect(computeIplv(fakeModel, 500, { ecwtMin: 18, ecwtMax: 28.9, plrMin: 0.1, plrMax: 1 }).extrapolated).toBe(true); // 29.44 > 29.4
  });
});
