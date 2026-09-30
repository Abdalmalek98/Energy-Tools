import type { FlowUnit, LoadUnit, TempUnit } from '../types';

export const KW_PER_TR = 3.51685;
export const CP_WATER = 4.186; // kJ/(kg·K)

/** Flow -> kg/s (1 L/s = 1 kg/s; m³/h ÷ 3.6; gpm × 0.0630902). */
export function flowToKgPerS(v: number, unit: FlowUnit): number {
  switch (unit) {
    case 'L/s': return v;
    case 'm3/h': return v / 3.6;
    case 'gpm': return v * 0.0630902;
  }
}

/** Temperature difference -> °C (°F ΔT × 5/9). */
export function deltaToC(dt: number, unit: TempUnit): number {
  return unit === 'F' ? (dt * 5) / 9 : dt;
}

/** Absolute temperature -> °C. */
export function tempToC(t: number, unit: TempUnit): number {
  return unit === 'F' ? ((t - 32) * 5) / 9 : t;
}

/** Cooling load Q[TR] = ṁ[kg/s] × 4.186 × (CHWR − CHWS) / 3.51685. */
export function coolingLoadTR(flowKgPerS: number, chwr: number, chws: number): number {
  return (flowKgPerS * CP_WATER * (chwr - chws)) / KW_PER_TR;
}

/** Direct load column -> TR. intervalHours needed for energy units. */
export function loadToTR(v: number, unit: LoadUnit, intervalHours: number): number {
  switch (unit) {
    case 'TR': return v;
    case 'kWth': return v / KW_PER_TR;
    case 'TRh': return v / intervalHours;
    case 'kWhth': return v / KW_PER_TR / intervalHours;
  }
}

export const kwPerTR = (kW: number, tr: number) => kW / tr;
export const copFromKwPerTR = (k: number) => KW_PER_TR / k;
export const eerFromKwPerTR = (k: number) => 12 / k;
