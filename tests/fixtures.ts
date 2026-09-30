import { pad, rng } from './helpers';

export interface FlukeSynth { text: string; truth: { rows: number; running: number; starts: number; runningKWhW: number; totalKWh: number; peakKW: number; peakIdx: number; standbyKW: number } }

/** Synthetic Energy-Analyze-style trend export (tab separated, W, 5-minute periods, decimal comma optional). */
export function makeFlukeTxt(opts: { rows?: number; decimalComma?: boolean; negativePhase?: boolean; start?: Date } = {}): FlukeSynth {
  const rows = opts.rows ?? 4259;
  const start = opts.start ?? new Date(Date.UTC(2026, 5, 28, 15, 40));
  const r = rng(99);
  const num = (v: number, dp = 1) => { const t = v.toFixed(dp); return opts.decimalComma ? t.replace('.', ',') : t; };
  const lines = [
    'Fluke 1738 Power Logger export',
    'Serial number: 62934227',
    'Site: LC5 CH3',
    '',
    ['Trend_Period', 'PowerP_Total_avg', 'PowerP_Total_min', 'PowerP_Total_max', 'PowerP_L1_avg', 'PowerP_L2_avg', 'PowerP_L3_avg', 'PowerQ_Total_avg', 'PowerS_Total_avg', 'Voltage_L1_avg', 'ActiveEnergy_Total'].join('\t'),
  ];
  // two long runs separated by an off period
  const runA: [number, number] = [200, 2000];
  const runB: [number, number] = [2600, 3700];
  let running = 0, runKWhW = 0, totalW = 0, peak = 0, peakIdx = 0, sbSum = 0, sbN = 0;
  for (let i = 0; i < rows; i++) {
    const t = new Date(start.getTime() + i * 300000);
    const on = (i >= runA[0] && i < runA[1]) || (i >= runB[0] && i < runB[1]);
    const P = on ? 1000000 + 300000 * Math.sin(i / 60) + r() * 20000 : 1500 + r() * 1200;
    if (on) { running++; runKWhW += P; } else { sbSum += P / 1000; sbN++; }
    totalW += P;
    if (P > peak) { peak = P; peakIdx = i; }
    const ph = on ? [P * 0.335, P * 0.333, P * 0.332] : [P / 3, P / 3, P / 3];
    if (opts.negativePhase && i === 500) ph[2] = -1200;
    const ts = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:00`;
    lines.push([ts, num(P), num(P * 0.95), num(P * 1.05), num(ph[0]), num(ph[1]), num(ph[2]), num(P * 0.3), num(P * 1.05), num(400.5, 2), num(P / 12)].join('\t'));
  }
  return {
    text: lines.join('\r\n') + '\r\n',
    truth: { rows, running, starts: 2, runningKWhW: runKWhW / 12 / 1000, totalKWh: totalW / 12 / 1000, peakKW: peak / 1000, peakIdx, standbyKW: sbSum / sbN },
  };
}

export const utf16le = (s: string, bom = true) => {
  const b = new Uint8Array((s.length + (bom ? 1 : 0)) * 2);
  let o = 0;
  if (bom) { b[o++] = 0xff; b[o++] = 0xfe; }
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); b[o++] = c & 255; b[o++] = c >> 8; }
  return b;
};
