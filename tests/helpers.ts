import { DEFAULT_SETTINGS } from '../src/settings/defaults';
import type { Settings } from '../src/types';

export const S = (o: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...o });

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pad(n: number) { return String(n).padStart(2, '0'); }

/** Build a long-format BMS CSV: 2 chillers, 5-minute interval, n steps. */
export function makeBmsCsv(opts: { steps?: number; delimiter?: string; decimalComma?: boolean; bom?: boolean; quote?: boolean } = {}) {
  const steps = opts.steps ?? 288;
  const d = opts.delimiter ?? ',';
  const r = rng(42);
  const num = (v: number, dp = 2) => { const t = v.toFixed(dp); return opts.decimalComma ? t.replace('.', ',') : t; };
  const q = (v: string) => (opts.quote ? `"${v}"` : v);
  const lines = [['Timestamp', 'Chiller ID', 'Chiller kW', 'CHW Flow L/s', 'LCHWT', 'ECHWT', 'ECWT', 'Aux kW'].map(q).join(d)];
  for (let i = 0; i < steps; i++) {
    const t = new Date(Date.UTC(2026, 6, 1, 0, 0) + i * 300000);
    const ts = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
    const load = 0.5 + 0.42 * Math.sin(((i % 288) / 288) * 2 * Math.PI - Math.PI / 2); // daily cycle
    for (const [id, eff] of [['CH1', 0.6], ['CH2', 0.7]] as const) {
      const flow = 20 + 60 * load + r() * 2;
      const dT = 5.5;
      const tr = (flow * 4.186 * dT) / 3.51685;
      const kW = tr * (eff + 0.1 * (1 - load)) + r();
      lines.push([q(ts), q(id), num(kW), num(flow), num(6.5), num(6.5 + dT), num(26 + 4 * load + r()), num(40 + r())].join(d));
    }
  }
  return (opts.bom ? '﻿' : '') + lines.join('\n');
}
