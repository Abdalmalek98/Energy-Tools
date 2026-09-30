import type { ModelKind, RegressionCoef, RegressionModel } from '../types';
import { mean, std } from '../utils/stats';
import { tCritical, tTwoSidedP } from './tdist';

/** Invert a small symmetric matrix by Gauss–Jordan with partial pivoting. Returns null when singular. */
export function invert(a: number[][]): number[][] | null {
  const n = a.length;
  const m = a.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c];
    for (let j = 0; j < 2 * n; j++) m[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((r) => r.slice(n));
}

export interface OlsInput {
  kind: ModelKind;
  y: number[];
  /** Predictor columns (raw units) – intercept is added automatically. */
  x: number[][];
  names: string[]; // predictor names (without Intercept)
  intervalMinutes: number;
  droppedLchwt?: boolean;
  predictor: (b: number[]) => (q: number, ecwt?: number, lchwt?: number) => number;
}

/**
 * OLS on standardized predictors (numerical stability), then back-transformed coefficients and covariance:
 *   y = b0s + Σ bjs (xj − mj)/sj  →  bj = bjs/sj ,  b0 = b0s − Σ bj mj ,  Cov = A Covs Aᵀ.
 */
export function fitOls(inp: OlsInput): RegressionModel | null {
  const n = inp.y.length;
  const p = inp.x.length + 1;
  if (n <= p) return null;
  const means = inp.x.map(mean);
  const sds = inp.x.map(std);
  if (sds.some((s) => !(s > 1e-12))) return null;
  // design matrix (standardized)
  const X: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = [1];
    for (let j = 0; j < inp.x.length; j++) row.push((inp.x[j][i] - means[j]) / sds[j]);
    X.push(row);
  }
  const XtX: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const Xty = new Array<number>(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      Xty[a] += X[i][a] * inp.y[i];
      for (let b = a; b < p; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
  const inv = invert(XtX);
  if (!inv) return null;
  const bs = inv.map((row) => row.reduce((acc, v, j) => acc + v * Xty[j], 0));
  let rss = 0;
  let sumRes = 0;
  const ybar = mean(inp.y);
  let tss = 0;
  for (let i = 0; i < n; i++) {
    const yh = X[i].reduce((acc, v, j) => acc + v * bs[j], 0);
    const e = inp.y[i] - yh;
    rss += e * e;
    sumRes += e;
    tss += (inp.y[i] - ybar) ** 2;
  }
  const dof = n - p;
  const sigma2 = rss / dof;
  // back-transform
  const A: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  A[0][0] = 1;
  for (let j = 1; j < p; j++) {
    A[0][j] = -means[j - 1] / sds[j - 1];
    A[j][j] = 1 / sds[j - 1];
  }
  const b = A.map((row) => row.reduce((acc, v, j) => acc + v * bs[j], 0));
  const covS = inv.map((r) => r.map((v) => v * sigma2));
  const AC = A.map((row) => covS[0].map((_, c) => row.reduce((acc, v, k) => acc + v * covS[k][c], 0)));
  const cov = AC.map((row) => A.map((_, c) => row.reduce((acc, v, k) => acc + v * A[c][k], 0)));
  const tc = tCritical(dof);
  const names = ['Intercept', ...inp.names];
  const coefs: RegressionCoef[] = b.map((val, i) => {
    const se = Math.sqrt(Math.max(0, cov[i][i]));
    const t = val / se;
    const pv = tTwoSidedP(t, dof);
    return { name: names[i], value: val, se, t, p: pv, ciLow: val - tc * se, ciHigh: val + tc * se, significant: pv < 0.05 };
  });
  const r2 = tss > 0 ? 1 - rss / tss : NaN;
  const adjR2 = 1 - ((1 - r2) * (n - 1)) / dof;
  const rmse = Math.sqrt(sigma2);
  const cv = (rmse / ybar) * 100;
  const nmbe = (sumRes / (dof * ybar)) * 100;
  const fine = inp.intervalMinutes <= 60;
  const cvLimit = fine ? 30 : 15;
  const nmbeLimit = fine ? 10 : 5;
  return {
    kind: inp.kind,
    n,
    k: p,
    r2,
    adjR2,
    rmse,
    cv,
    nmbe,
    coefs,
    terms: names,
    droppedLchwt: !!inp.droppedLchwt,
    guideline14: { pass: cv <= cvLimit && Math.abs(nmbe) <= nmbeLimit, cvLimit, nmbeLimit },
    predict: inp.predictor(b),
  };
}
