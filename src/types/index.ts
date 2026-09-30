// Shared domain types. Pure data – no logic.

export type Delimiter = ',' | ';' | '\t';
export type FlowUnit = 'L/s' | 'm3/h' | 'gpm';
export type TempUnit = 'C' | 'F';
export type PowerMode = 'demandKW' | 'intervalKWh' | 'cumulativeKWh';
export type LoadSource = 'flowDT' | 'column';
export type LoadUnit = 'TR' | 'kWth' | 'TRh' | 'kWhth';
export type PlantType = 'water' | 'air';
export type AuxMode = 'max' | 'sum';
export type Status = 'OK' | 'Review' | 'Action' | 'Priority';
export type Rating = 'Excellent' | 'Good' | 'Fair' | 'Needs improvement';

export interface Settings {
  powerMode: PowerMode;
  loadSource: LoadSource;
  loadUnit: LoadUnit;
  flowUnit: FlowUnit;
  tempUnit: TempUnit;
  plantType: PlantType;
  ratedTR: number; // default rated capacity per chiller
  ratedKwPerTR: number; // default rated kW/TR per chiller
  designDeltaT: number; // °C
  targetKwPerTR: number; // plant target
  tariff: number; // currency per kWh
  currency: string;
  outlierFilter: boolean;
  outlierMin: number;
  outlierMax: number;
  minPLR: number;
  auxMode: AuxMode;
  analyseLoggedPeriodOnly: boolean;
  chillerOverrides: Record<string, { ratedTR?: number; ratedKwPerTR?: number }>;
}

export interface RawTable {
  delimiter: Delimiter;
  headers: string[];
  rows: string[][];
  fileName?: string;
}

/** Column indices into RawTable.headers (or -1 / undefined when unmapped). */
export interface ColumnMapping {
  timestamp?: number;
  chillerId?: number;
  power?: number;
  load?: number;
  flow?: number;
  lchwt?: number;
  echwt?: number;
  ecwt?: number;
  aux?: number;
}

export interface Row {
  ts: number; // ms, timestamps are treated as naive local time encoded as UTC
  chiller: string;
  kW: number; // NaN when missing
  load: number; // TR, NaN when missing
  lchwt: number;
  echwt: number;
  ecwt: number;
  aux: number;
  /** Derived power from an attached logger (BMS kW is never overwritten). */
  kWLogger?: number;
}

export type ExclusionReason = 'nonNumeric' | 'lowPower' | 'lowLoad' | 'outlier' | 'badTimestamp';

export interface ExclusionCounts {
  total: number;
  kept: number;
  excluded: number;
  reasons: Record<ExclusionReason, number>;
}

export interface ChillerRow extends Row {
  kwPerTR: number;
  plr: number;
  ratedTR: number;
}

export interface ParsedBms {
  interval: number; // minutes
  intervalHours: number;
  rows: Row[];
  duplicateCount: number;
  gapCount: number;
  chillers: string[];
  parseWarnings: string[];
}

export interface PlantRow {
  ts: number;
  kW: number; // chiller kW
  tr: number;
  aux: number;
  ecwt: number;
  lchwt: number;
  echwt: number;
  nRunning: number;
}

export interface Kpis {
  plantKwPerTR: number;
  plantCOP: number;
  chillerKwPerTR: number;
  chillerCOP: number;
  trHours: number;
  thermalKWh: number;
  chillerKWh: number;
  auxKWh: number;
  auxShare: number;
  peakLoad: number;
  avgLoad: number;
  loadFactor: number;
  installedTR: number;
  kWhAboveTarget: number;
  costAboveTarget: number;
  annualizedCost: number;
  loggedHours: number;
  plantRating: Rating;
  chillerRating: Rating;
}

export interface RegressionCoef {
  name: string;
  value: number;
  se: number;
  t: number;
  p: number;
  ciLow: number;
  ciHigh: number;
  significant: boolean;
}

export type ModelKind = 'linear' | 'quadratic' | 'multivariate';

export interface RegressionModel {
  kind: ModelKind;
  n: number;
  k: number; // parameters incl. intercept
  r2: number;
  adjR2: number;
  rmse: number;
  cv: number; // %
  nmbe: number; // %
  coefs: RegressionCoef[];
  terms: string[];
  droppedLchwt: boolean;
  guideline14: { pass: boolean; cvLimit: number; nmbeLimit: number };
  predict: (q: number, ecwt?: number, lchwt?: number) => number;
}

export interface RegressionResult {
  subject: string; // chiller id or 'Plant'
  models: RegressionModel[];
  selected: RegressionModel | null;
  notes: string[];
}

export interface IplvPoint {
  plr: number;
  ecwt: number;
  weight: number;
  tr: number;
  kW: number;
  kwPerTR: number;
  cop: number;
  outOfRange: boolean;
}

export interface IplvResult {
  points: IplvPoint[];
  iplvCOP: number;
  iplvKwPerTR: number;
  extrapolated: boolean; // true -> value should be marked with *
}

export interface ChillerSummary {
  id: string;
  ratedTR: number;
  ratedKwPerTR: number;
  runHours: number;
  trHours: number;
  kWh: number;
  avgPLR: number;
  kwPerTR: number;
  cop: number;
  p10: number;
  p90: number;
  pctVsRated: number;
  avgDeltaT: number;
  iplv: IplvResult | null;
  status: 'On spec' | 'Degraded' | 'Poor' | 'Investigate';
}

export interface BinRow {
  label: string;
  lo: number;
  hi: number;
  hours: number;
  trHours: number;
  kWh: number;
  kwPerTR: number;
}

export interface Finding {
  id: string;
  status: Status;
  title: string;
  text: string;
  numbers: { label: string; value: string }[];
  savingsKWh?: number;
  savingsCost?: number;
}

export interface AnalysisResult {
  settings: Settings;
  intervalMinutes: number;
  intervalHours: number;
  exclusions: ExclusionCounts;
  chillerRows: ChillerRow[];
  plantRows: PlantRow[];
  kpis: Kpis;
  chillers: ChillerSummary[];
  loadProfile: BinRow[];
  chillerPlrBins: Record<string, BinRow[]>;
  plantRegression: RegressionResult | null;
  chillerRegressions: RegressionResult[];
  findings: Finding[];
  warnings: string[];
  firstDate: string;
  lastDate: string;
  sources: { bmsFile?: string; loggers: string[] };
}

// ---- Logger (Fluke) ----

export interface LoggerSample {
  ts: number; // midpoint, ms
  kW: number;
  phases?: [number, number, number]; // kW per phase (may be NaN)
}

export interface LoggerData {
  fileName: string;
  chiller: string;
  serial: string;
  model: string;
  sourceUnit: 'W' | 'kW' | 'Wh' | 'kWh';
  unitAssumed: boolean;
  powerColumn: string;
  energyColumn?: string;
  intervalMinutes: number;
  samples: LoggerSample[];
  rowCount: number;
  notes: string[];
  columns: string[];
  energyKWhFromColumn?: number;
}

export interface LoggerFlag {
  status: Status;
  title: string;
  text: string;
}

export interface LoggerAnalysis {
  chiller: string;
  serial: string;
  rows: number;
  intervalMinutes: number;
  sourceUnit: string;
  totalKWh: number;
  loggedHours: number;
  runningThresholdKW: number;
  runningKWh: number;
  standbyKWh: number;
  runningHours: number;
  runningShare: number;
  avgRunningKW: number;
  p10KW: number;
  p90KW: number;
  peakKW: number;
  peakTs: number;
  starts: number;
  longestRunHours: number;
  standbyKW: number;
  phaseAvgKW: [number, number, number] | null;
  phaseDeviationPct: number | null;
  negativePhase: boolean;
  shortRuns: number;
  maxStartsPerDay: number;
  flags: LoggerFlag[];
  firstTs: number;
  lastTs: number;
}
