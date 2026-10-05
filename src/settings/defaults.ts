import type { Settings } from '../types';

export const APP_VERSION = '1.0.0';
export const PRODUCT_NAME = 'Chiller Plant Analyzer';

export const DEFAULT_SETTINGS: Settings = {
  powerMode: 'demandKW',
  loadSource: 'flowDT',
  loadUnit: 'TR',
  flowUnit: 'L/s',
  tempUnit: 'C',
  plantType: 'water',
  ratedTR: 500,
  ratedKwPerTR: 0.58,
  designDeltaT: 5.5,
  targetKwPerTR: 0.75,
  tariff: 0.2,
  currency: 'SAR',
  outlierFilter: true,
  outlierMin: 0.2,
  outlierMax: 2.5,
  minPLR: 0.05,
  auxMode: 'max',
  analyseLoggedPeriodOnly: true,
  cddBaseTemp: 18.3,
  annualPredictor: 'auto',
  annualProposedKwPerTR: 0,
  annualSafetyPct: 10,
  annualOutlierSigma: 0,
  typicalAnnualCdd: 0,
  cddMinCoverage: 0.9,
  weatherHourEnding: false,
  weatherIncludeOffHours: false,
  atmPressureKPa: 101.325,
  chillerOverrides: {},
};

export function mergeSettings(partial: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...(partial ?? {}), chillerOverrides: { ...(partial?.chillerOverrides ?? {}) } };
}
