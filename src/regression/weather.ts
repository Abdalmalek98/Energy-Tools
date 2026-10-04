import type { RegressionModel, WeatherPredictorSet } from '../types';
import { fitOls } from './ols';

export interface WeatherSample {
  tempC: number;
  rh: number | null;
  enthalpy: number | null;
  y: number; // kW or TR for the hour
}

/**
 * Hourly weather models (hourly data ⇒ Guideline 14 limits CV ≤ 30 %, |NMBE| ≤ 10 %).
 *   temperature          y = b0 + b1·T
 *   enthalpy             y = b0 + b1·h              (captures sensible + latent load)
 *   temperature+humidity y = b0 + b1·T + b2·RH
 * predict(first, second): first = T (or h for the enthalpy model), second = RH for the T+RH model.
 */
export function fitWeatherModel(set: WeatherPredictorSet, d: WeatherSample[]): RegressionModel | null {
  const y = d.map((r) => r.y);
  if (set === 'temperature') {
    return fitOls({ kind: 'linear', y, x: [d.map((r) => r.tempC)], names: ['T'], intervalMinutes: 60, predictor: (b) => (t) => b[0] + b[1] * t });
  }
  if (set === 'enthalpy') {
    const rows = d.filter((r) => r.enthalpy !== null);
    return fitOls({ kind: 'linear', y: rows.map((r) => r.y), x: [rows.map((r) => r.enthalpy as number)], names: ['h'], intervalMinutes: 60, predictor: (b) => (h) => b[0] + b[1] * h });
  }
  const rows = d.filter((r) => r.rh !== null);
  return fitOls({
    kind: 'linear', y: rows.map((r) => r.y), x: [rows.map((r) => r.tempC), rows.map((r) => r.rh as number)], names: ['T', 'RH'], intervalMinutes: 60,
    predictor: (b) => (t, rh = 0) => b[0] + b[1] * t + b[2] * rh,
  });
}
