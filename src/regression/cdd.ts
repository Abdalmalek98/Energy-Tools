import type { RegressionModel } from '../types';
import { fitOls } from './ols';

/** Daily linear model y = b0 + b1·CDD. Daily data is "coarser than hourly", so Guideline 14 uses CV ≤ 15 %, |NMBE| ≤ 5 %. */
export function fitCddLinear(cdd: number[], y: number[]): RegressionModel | null {
  if (cdd.length < 5) return null;
  return fitOls({
    kind: 'linear', y, x: [cdd], names: ['CDD'], intervalMinutes: 1440,
    predictor: (b) => (q) => b[0] + b[1] * q, // first argument is the CDD value
  });
}
