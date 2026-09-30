import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];
export const color = (i: number) => PALETTE[i % PALETTE.length];

export interface Series {
  name: string;
  points: { x: number; y: number }[];
  mode?: 'markers' | 'line';
  dash?: boolean;
  color?: string;
}

/** "Nice" tick positions covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}
const dp = (v: number, step: number) => (step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)) + (step < 0.1 ? 1 : 0)));

interface XYProps {
  title?: string;
  series: Series[];
  xLabel: string;
  yLabel: string;
  height?: number;
  xTime?: boolean;
  xDomain?: [number, number];
  yDomain?: [number, number];
  yZero?: boolean;
  ariaLabel?: string;
}

const M = { l: 56, r: 14, t: 10, b: 40 };

/** Track the container width so the SVG is drawn 1:1 (text keeps its real pixel size at any window size). */
function useWidth(ref: RefObject<HTMLElement>): number {
  const [w, setW] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setW(Math.max(300, Math.round(el.getBoundingClientRect().width)));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function fmtTime(ts: number, span: number) {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return span > 3 * 86400000 ? `${p(d.getUTCDate())}-${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}` : `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function XYChart({ title, series, xLabel, yLabel, height = 300, xTime, xDomain, yDomain, yZero, ariaLabel }: XYProps) {
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const W = useWidth(wrap);
  const geo = useMemo(() => {
    const all = series.flatMap((s) => s.points).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    let x0 = Math.min(...all.map((p) => p.x)), x1 = Math.max(...all.map((p) => p.x));
    let y0 = Math.min(...all.map((p) => p.y)), y1 = Math.max(...all.map((p) => p.y));
    if (xDomain) [x0, x1] = xDomain;
    if (yDomain) [y0, y1] = yDomain;
    else if (yZero) { y0 = Math.min(0, y0); y1 = y1 * 1.05; }
    else { const pad = (y1 - y0) * 0.06 || 0.5; y0 -= pad; y1 += pad; }
    const yt = niceTicks(y0, y1, 5);
    y0 = Math.min(y0, yt[0]); y1 = Math.max(y1, yt[yt.length - 1]);
    const xt = xTime ? niceTicks(x0, x1, 6).filter((v) => v >= x0) : niceTicks(x0, x1, 6);
    return { all, x0, x1, y0, y1, xt, yt };
  }, [series, xDomain, yDomain, yZero, xTime]);
  if (!geo.all.length) return <div className="empty">No data to plot.</div>;
  const { x0, x1, y0, y1, xt, yt } = geo;
  const H = height;
  const sx = (v: number) => M.l + ((v - x0) / (x1 - x0 || 1)) * (W - M.l - M.r);
  const sy = (v: number) => H - M.b - ((v - y0) / (y1 - y0 || 1)) * (H - M.t - M.b);
  const xs = xt.length > 1 ? xt[1] - xt[0] : 1;
  const ys = yt.length > 1 ? yt[1] - yt[0] : 1;
  const nearest = (mx: number) => {
    let best: { s: number; p: { x: number; y: number } } | null = null;
    let bd = Infinity;
    series.forEach((s, si) => {
      const step = Math.max(1, Math.floor(s.points.length / 4000));
      for (let i = 0; i < s.points.length; i += step) {
        const p = s.points[i];
        const d = Math.abs(sx(p.x) - mx);
        if (d < bd) { bd = d; best = { s: si, p }; }
      }
    });
    return best as { s: number; p: { x: number; y: number } } | null;
  };
  return (
    <div className="chart" ref={wrap} style={{ position: 'relative' }}>
      {title && <div className="chart-title">{title}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={ariaLabel ?? title ?? `${yLabel} versus ${xLabel}`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const mx = ((e.clientX - r.left) / r.width) * W;
          const n = nearest(mx);
          if (n) setHover({ x: (sx(n.p.x) / W) * 100, y: (sy(n.p.y) / H) * 100, text: `${series[n.s].name}: ${xTime ? fmtTime(n.p.x, x1 - x0) : n.p.x.toFixed(dp(0, xs) + 1)} → ${n.p.y.toFixed(dp(0, ys) + 1)}` });
        }}
        onMouseLeave={() => setHover(null)}>
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line className="gridline" x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} />
            <text x={M.l - 6} y={sy(v) + 4} textAnchor="end">{v.toFixed(dp(v, ys))}</text>
          </g>
        ))}
        {xt.map((v) => (
          <g key={`x${v}`}>
            <line className="gridline" x1={sx(v)} x2={sx(v)} y1={M.t} y2={H - M.b} />
            <text x={sx(v)} y={H - M.b + 16} textAnchor="middle">{xTime ? fmtTime(v, x1 - x0) : v.toFixed(dp(v, xs))}</text>
          </g>
        ))}
        <line className="axis" x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} />
        <line className="axis" x1={M.l} x2={M.l} y1={M.t} y2={H - M.b} />
        <text className="axis-title" x={(M.l + W - M.r) / 2} y={H - 6} textAnchor="middle">{xLabel}</text>
        <text className="axis-title" transform={`translate(13 ${(M.t + H - M.b) / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
        {series.map((s, i) => {
          const c = s.color ?? color(i);
          const pts = s.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
          if (s.mode === 'line') {
            let d = '';
            let pen = false;
            for (const p of s.points) {
              if (!Number.isFinite(p.y)) { pen = false; continue; }
              d += `${pen ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`;
              pen = true;
            }
            return <path key={i} d={d} fill="none" stroke={c} strokeWidth={s.dash ? 1.5 : 2} strokeDasharray={s.dash ? '6 4' : undefined} strokeLinejoin="round" />;
          }
          return <g key={i} fill={c} fillOpacity={0.55}>{pts.map((p, j) => <circle key={j} cx={sx(p.x)} cy={sy(p.y)} r={2.6} />)}</g>;
        })}
        {hover && <circle cx={(hover.x / 100) * W} cy={(hover.y / 100) * H} r={5} fill="none" stroke="var(--ink)" strokeWidth={1.5} />}
      </svg>
      {hover && <div className="tip" style={{ left: `min(calc(${hover.x}% + 10px), calc(100% - 200px))`, top: `${hover.y}%`, transform: 'translateY(-130%)' }}>{hover.text}</div>}
      <div className="legend">{series.map((s, i) => <span key={i}><i style={{ background: s.color ?? color(i), borderRadius: s.mode === 'line' ? 0 : '50%', height: s.mode === 'line' ? 3 : 10 }} />{s.name}</span>)}</div>
    </div>
  );
}

export interface BarSeries { name: string; values: number[]; color?: string; }
export function BarChart({ title, categories, series, yLabel, xLabel, height = 260, format = (v: number) => v.toFixed(2) }: { title?: string; categories: string[]; series: BarSeries[]; yLabel: string; xLabel?: string; height?: number; format?: (v: number) => string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const W = useWidth(wrap);
  const H = height;
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  if (!all.length) return <div className="empty">No data to plot.</div>;
  const yt = niceTicks(0, Math.max(...all) * 1.08, 5);
  const y1 = yt[yt.length - 1];
  const sy = (v: number) => H - M.b - (v / y1) * (H - M.t - M.b);
  const band = (W - M.l - M.r) / categories.length;
  const bw = Math.min(46, (band * 0.72) / series.length);
  const step = yt[1] - yt[0];
  return (
    <div className="chart" ref={wrap}>
      {title && <div className="chart-title">{title}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={title ?? yLabel}>
        {yt.map((v) => (
          <g key={v}>
            <line className="gridline" x1={M.l} x2={W - M.r} y1={sy(v)} y2={sy(v)} />
            <text x={M.l - 6} y={sy(v) + 4} textAnchor="end">{v.toFixed(dp(v, step))}</text>
          </g>
        ))}
        <line className="axis" x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} />
        {categories.map((c, ci) => {
          const cx = M.l + band * ci + band / 2;
          return (
            <g key={ci}>
              {series.map((s, si) => {
                const v = s.values[ci];
                if (!Number.isFinite(v)) return null;
                const x = cx - (bw * series.length) / 2 + si * bw;
                return (
                  <g key={si}>
                    <rect x={x} y={sy(v)} width={bw - 2} height={Math.max(0, H - M.b - sy(v))} fill={s.color ?? color(si)} rx={2}><title>{`${s.name} – ${c}: ${format(v)}`}</title></rect>
                    {series.length * categories.length <= 14 && <text x={x + (bw - 2) / 2} y={sy(v) - 4} textAnchor="middle">{format(v)}</text>}
                  </g>
                );
              })}
              <text x={cx} y={H - M.b + 16} textAnchor="middle">{c}</text>
            </g>
          );
        })}
        {xLabel && <text className="axis-title" x={(M.l + W - M.r) / 2} y={H - 4} textAnchor="middle">{xLabel}</text>}
        <text className="axis-title" transform={`translate(13 ${(M.t + H - M.b) / 2}) rotate(-90)`} textAnchor="middle">{yLabel}</text>
      </svg>
      {series.length > 1 && <div className="legend">{series.map((s, i) => <span key={i}><i style={{ background: s.color ?? color(i) }} />{s.name}</span>)}</div>}
    </div>
  );
}
