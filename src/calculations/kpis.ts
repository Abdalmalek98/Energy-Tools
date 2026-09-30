import type { ChillerRow, Kpis, PlantRow, Rating, Settings } from '../types';
import { KW_PER_TR, copFromKwPerTR } from './units';
import { ratedTROf } from '../analysis/filter';

/** Rating bands: value <= threshold. */
const BANDS = {
  plant: { water: [0.75, 0.9, 1.0], air: [1.15, 1.3, 1.45] },
  chiller: { water: [0.6, 0.7, 0.85], air: [1.0, 1.2, 1.4] },
} as const;

export function rate(kind: 'plant' | 'chiller', type: 'water' | 'air', v: number): Rating {
  if (!Number.isFinite(v)) return 'Needs improvement';
  const [e, g, f] = BANDS[kind][type];
  if (v <= e) return 'Excellent';
  if (v <= g) return 'Good';
  if (v <= f) return 'Fair';
  return 'Needs improvement';
}

/** Period KPIs. Efficiency is ALWAYS energy weighted: Σ kWh / Σ TR·h (never a mean of ratios). */
export function computeKpis(plant: PlantRow[], chRows: ChillerRow[], intervalHours: number, s: Settings): Kpis {
  const chillerKWh = plant.reduce((a, p) => a + p.kW, 0) * intervalHours;
  const auxKWh = plant.reduce((a, p) => a + p.aux, 0) * intervalHours;
  const trHours = plant.reduce((a, p) => a + p.tr, 0) * intervalHours;
  const loggedHours = plant.length * intervalHours;
  const plantKwPerTR = (chillerKWh + auxKWh) / trHours;
  const chillerKwPerTR = chillerKWh / trHours;
  const peakLoad = plant.reduce((m, p) => Math.max(m, p.tr), 0);
  const avgLoad = loggedHours > 0 ? trHours / loggedHours : NaN;
  const ids = [...new Set(chRows.map((r) => r.chiller))];
  const installedTR = ids.reduce((a, id) => a + ratedTROf(id, s), 0);
  const kWhAboveTarget = Math.max(0, chillerKWh + auxKWh - s.targetKwPerTR * trHours);
  const costAboveTarget = kWhAboveTarget * s.tariff;
  const annualizedCost = loggedHours > 0 ? (costAboveTarget * 8760) / loggedHours : NaN;
  return {
    plantKwPerTR,
    plantCOP: copFromKwPerTR(plantKwPerTR),
    chillerKwPerTR,
    chillerCOP: copFromKwPerTR(chillerKwPerTR),
    trHours,
    thermalKWh: trHours * KW_PER_TR,
    chillerKWh,
    auxKWh,
    auxShare: chillerKWh + auxKWh > 0 ? auxKWh / (chillerKWh + auxKWh) : NaN,
    peakLoad,
    avgLoad,
    loadFactor: peakLoad > 0 ? avgLoad / peakLoad : NaN,
    installedTR,
    kWhAboveTarget,
    costAboveTarget,
    annualizedCost,
    loggedHours,
    plantRating: rate('plant', s.plantType, plantKwPerTR),
    chillerRating: rate('chiller', s.plantType, chillerKwPerTR),
  };
}
