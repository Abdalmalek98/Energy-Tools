import type { IplvResult, RegressionModel, RegressionResult } from '../types';
import { fitOls } from './ols';
import { std } from '../utils/stats';
import { KW_PER_TR } from '../calculations/units';

export interface RegSample {
  q: number; // TR
  kW: number;
  ecwt: number; // NaN when not available
  lchwt: number;
}

export function fitLinear(d: RegSample[], intervalMinutes: number): RegressionModel | null {
  return fitOls({
    kind: 'linear', y: d.map((r) => r.kW), x: [d.map((r) => r.q)], names: ['Q'], intervalMinutes,
    predictor: (b) => (q) => b[0] + b[1] * q,
  });
}

export function fitQuadratic(d: RegSample[], intervalMinutes: number): RegressionModel | null {
  return fitOls({
    kind: 'quadratic', y: d.map((r) => r.kW), x: [d.map((r) => r.q), d.map((r) => r.q * r.q)], names: ['Q', 'Q²'], intervalMinutes,
    predictor: (b) => (q) => b[0] + b[1] * q + b[2] * q * q,
  });
}

/** Multivariate: only with ECWT present and n > 20. LCHWT is dropped when its std ≤ 0.05. */
export function fitMultivariate(all: RegSample[], intervalMinutes: number): RegressionModel | null {
  const d = all.filter((r) => Number.isFinite(r.ecwt));
  if (d.length <= 20) return null;
  const lch = d.filter((r) => Number.isFinite(r.lchwt));
  const useL = lch.length === d.length && std(d.map((r) => r.lchwt)) > 0.05;
  const cols = [d.map((r) => r.q), d.map((r) => r.q * r.q), d.map((r) => r.ecwt)];
  const names = ['Q', 'Q²', 'ECWT'];
  if (useL) {
    cols.push(d.map((r) => r.lchwt));
    names.push('LCHWT');
  }
  cols.push(d.map((r) => r.q * r.ecwt));
  names.push('Q×ECWT');
  return fitOls({
    kind: 'multivariate', y: d.map((r) => r.kW), x: cols, names, intervalMinutes, droppedLchwt: !useL,
    predictor: (b) => (q, ecwt = 0, lchwt = 0) => {
      let v = b[0] + b[1] * q + b[2] * q * q + b[3] * ecwt;
      let i = 4;
      if (useL) v += b[i++] * lchwt;
      return v + b[i] * q * ecwt;
    },
  });
}

/** Fit all candidate models and select: linear first; move up only if CV < 95% of best AND adjR² improves. */
export function regress(subject: string, data: RegSample[], intervalMinutes: number): RegressionResult {
  const notes: string[] = [];
  const d = data.filter((r) => Number.isFinite(r.q) && Number.isFinite(r.kW));
  const models: RegressionModel[] = [];
  const lin = fitLinear(d, intervalMinutes);
  if (!lin) {
    return { subject, models, selected: null, notes: ['Not enough (or degenerate) data for regression.'] };
  }
  models.push(lin);
  let best = lin;
  const quad = fitQuadratic(d, intervalMinutes);
  if (quad) {
    models.push(quad);
    if (quad.cv < 0.95 * best.cv && quad.adjR2 > best.adjR2) best = quad;
  }
  const hasEcwt = d.some((r) => Number.isFinite(r.ecwt));
  if (hasEcwt) {
    const mv = fitMultivariate(d, intervalMinutes);
    if (mv) {
      models.push(mv);
      if (mv.cv < 0.95 * best.cv && mv.adjR2 > best.adjR2) best = mv;
      if (mv.droppedLchwt) notes.push('LCHWT dropped from the multivariate model (standard deviation ≤ 0.05 °C).');
    } else notes.push('Multivariate model skipped (needs ECWT and n > 20).');
  } else notes.push('Multivariate model skipped: no ECWT data.');
  return { subject, models, selected: best, notes };
}

export const IPLV_POINTS = [
  { plr: 1.0, ecwt: 29.44, weight: 0.01 },
  { plr: 0.75, ecwt: 23.89, weight: 0.42 },
  { plr: 0.5, ecwt: 18.33, weight: 0.45 },
  { plr: 0.25, ecwt: 18.33, weight: 0.12 },
] as const;
export const IPLV_LCHWT = 6.67;

/**
 * IPLV from a chiller's multivariate model. Efficiency at each point is expressed as COP and
 * combined as IPLV = 1 / Σ(wi / effi). Flagged (extrapolated) when a rating point lies outside the
 * measured ECWT ±0.5 °C or PLR ±0.05 envelope.
 */
export function computeIplv(
  model: RegressionModel,
  ratedTR: number,
  measured: { ecwtMin: number; ecwtMax: number; plrMin: number; plrMax: number },
): IplvResult {
  let extrap = false;
  const points = IPLV_POINTS.map((p) => {
    const tr = p.plr * ratedTR;
    const kW = model.predict(tr, p.ecwt, IPLV_LCHWT);
    const kwPerTR = kW / tr;
    const out =
      p.ecwt < measured.ecwtMin - 0.5 || p.ecwt > measured.ecwtMax + 0.5 ||
      p.plr < measured.plrMin - 0.05 || p.plr > measured.plrMax + 0.05;
    if (out) extrap = true;
    return { plr: p.plr, ecwt: p.ecwt, weight: p.weight, tr, kW, kwPerTR, cop: KW_PER_TR / kwPerTR, outOfRange: out };
  });
  const valid = points.every((p) => Number.isFinite(p.cop) && p.cop > 0);
  const iplvCOP = valid ? 1 / points.reduce((a, p) => a + p.weight / p.cop, 0) : NaN;
  return { points, iplvCOP, iplvKwPerTR: KW_PER_TR / iplvCOP, extrapolated: extrap };
}
