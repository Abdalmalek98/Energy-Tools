import { useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { Banner, Card, Chip, NeedData, PageHead, Table } from '../components/ui';
import { XYChart } from '../components/charts';
import type { RegressionModel, RegressionResult } from '../types';
import { fmt } from '../utils/format';

function ModelDetail({ m, selected }: { m: RegressionModel; selected: boolean }) {
  return (
    <Card title={`${m.kind} model${selected ? ' · selected' : ''}`}>
      <div className="row" style={{ gap: 22, marginBottom: 10 }}>
        <span>n <b className="num">{m.n}</b></span><span>R² <b className="num">{fmt(m.r2, 4)}</b></span><span>Adj R² <b className="num">{fmt(m.adjR2, 4)}</b></span>
        <span>RMSE <b className="num">{fmt(m.rmse, 2)} kW</b></span><span>CV(RMSE) <b className="num">{fmt(m.cv, 2)} %</b></span><span>NMBE <b className="num">{fmt(m.nmbe, 3)} %</b></span>
        <Chip label={m.guideline14.pass ? 'PASS' : 'FAIL'} />
      </div>
      <Table head={['Term', 'Coefficient', 'Std error', 't', 'p', '95 % CI low', '95 % CI high', 'Significant']} numeric={[1, 2, 3, 4, 5, 6]}
        rows={m.coefs.map((c) => [c.name, c.value.toPrecision(5), c.se.toPrecision(3), fmt(c.t, 2), c.p < 0.0001 ? '<0.0001' : fmt(c.p, 4), c.ciLow.toPrecision(5), c.ciHigh.toPrecision(5), c.significant ? 'Yes' : 'No'])} />
      <p className="hint">Guideline 14 limits for this data interval: CV ≤ {m.guideline14.cvLimit} %, |NMBE| ≤ {m.guideline14.nmbeLimit} %.{m.droppedLchwt ? ' LCHWT dropped (σ ≤ 0.05 °C).' : ''}</p>
    </Card>
  );
}

export function RegressionPage() {
  const { analysis: a, table } = useStore();
  const subjects: RegressionResult[] = useMemo(() => (a ? [...(a.plantRegression ? [a.plantRegression] : []), ...a.chillerRegressions] : []), [a]);
  const [sel, setSel] = useState('Plant');
  if (!table || !a) return (<><PageHead title="Regression" /><NeedData /></>);
  const reg = subjects.find((s) => s.subject === sel) ?? subjects[0];
  if (!reg) return null;
  // observed data and fitted curve
  const pts = sel === 'Plant' || !reg
    ? a.plantRows.filter((_, i) => i % Math.ceil(a.plantRows.length / 1500) === 0).map((p) => ({ x: p.tr, y: p.kW + p.aux, e: p.ecwt, l: p.lchwt }))
    : a.chillerRows.filter((r) => r.chiller === reg.subject).filter((_, i, arr) => i % Math.ceil(arr.length / 1500) === 0).map((r) => ({ x: r.load, y: r.kW, e: r.ecwt, l: r.lchwt }));
  const xs = pts.map((p) => p.x);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const meanE = pts.filter((p) => Number.isFinite(p.e)).reduce((t, p, _, arr) => t + p.e / arr.length, 0);
  const meanL = pts.filter((p) => Number.isFinite(p.l)).reduce((t, p, _, arr) => t + p.l / arr.length, 0);
  const curve = (m: RegressionModel) => Array.from({ length: 40 }, (_, i) => { const q = x0 + ((x1 - x0) * i) / 39; return { x: q, y: m.predict(q, meanE, meanL) }; });
  return (
    <>
      <PageHead title="Regression" subtitle="OLS baseline models of kW against load (and condenser/chilled-water temperature), assessed with ASHRAE Guideline 14." />
      <div className="tabs" role="tablist">{subjects.map((s) => <button key={s.subject} role="tab" aria-selected={s.subject === reg.subject} className="tab" onClick={() => setSel(s.subject)}>{s.subject === 'Plant' ? 'Plant' : s.subject}</button>)}</div>
      {reg.notes.map((n, i) => <div key={i} style={{ marginBottom: 8 }}><Banner>{n}</Banner></div>)}
      {reg.models.length > 0 && (
        <>
          <Card title="Model comparison">
            <Table head={['Model', 'n', 'R²', 'Adj R²', 'RMSE kW', 'CV(RMSE) %', 'NMBE %', 'Guideline 14', 'Selected']} numeric={[1, 2, 3, 4, 5, 6]}
              rows={reg.models.map((m) => [m.kind, m.n, fmt(m.r2, 4), fmt(m.adjR2, 4), fmt(m.rmse, 2), fmt(m.cv, 2), fmt(m.nmbe, 3), <Chip key="c" label={m.guideline14.pass ? 'PASS' : 'FAIL'} />, m === reg.selected ? '◄ selected' : ''])} />
            <p className="hint">Selection: start with linear; move to a later model only if its CV(RMSE) &lt; 95 % of the current best AND its adjusted R² is higher.</p>
          </Card>
          <Card title="Observed vs fitted">
            <XYChart height={320} xLabel="Load (TR)" yLabel="kW" yZero
              series={[{ name: 'Observed', points: pts.map((p) => ({ x: p.x, y: p.y })) }, ...reg.models.map((m, i) => ({ name: `${m.kind}${m === reg.selected ? ' (selected)' : ''}`, mode: 'line' as const, points: curve(m), color: ['var(--c2)', 'var(--c4)', 'var(--c5)'][i] }))]} />
            <p className="hint">Fitted curves are drawn at the mean ECWT ({fmt(meanE, 1)} °C) and LCHWT ({fmt(meanL, 1)} °C).</p>
          </Card>
          {reg.models.map((m) => <ModelDetail key={m.kind} m={m} selected={m === reg.selected} />)}
        </>
      )}
    </>
  );
}
