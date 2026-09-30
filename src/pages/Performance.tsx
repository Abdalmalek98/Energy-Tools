import { useState } from 'react';
import { useStore } from '../app/store';
import { Card, NeedData, PageHead, Table } from '../components/ui';
import { BarChart, XYChart, color } from '../components/charts';
import { plantSeries, scatterPlrEff } from '../charts/chartData';
import { fmt, fmt0 } from '../utils/format';

export function PerformancePage() {
  const { analysis: a, table } = useStore();
  const [ch, setCh] = useState<string>('');
  if (!table || !a) return (<><PageHead title="Performance" /><NeedData /></>);
  const pts = scatterPlrEff(a, 3000);
  const ids = a.chillers.map((c) => c.id);
  const s = plantSeries(a, 700);
  const withE = pts.filter((p) => Number.isFinite(p.ecwt));
  const sel = ch || ids[0];
  const bins = a.chillerPlrBins[sel] ?? [];
  return (
    <>
      <PageHead title="Performance" subtitle="How efficiency responds to load and condenser conditions." />
      <div className="grid g2">
        <Card title="kW/TR vs part-load ratio">
          <XYChart height={300} xLabel="PLR (load / rated TR)" yLabel="kW/TR" xDomain={[0, Math.max(1.05, ...pts.map((p) => p.plr))]}
            series={ids.map((id, i) => ({ name: id, color: color(i), points: pts.filter((p) => p.chiller === id).map((p) => ({ x: p.plr, y: p.eff })) }))} />
        </Card>
        <Card title="kW/TR vs ECWT / OAT">
          {withE.length > 3 ? <XYChart height={300} xLabel="ECWT / OAT (°C)" yLabel="kW/TR" series={ids.map((id, i) => ({ name: id, color: color(i), points: withE.filter((p) => p.chiller === id).map((p) => ({ x: p.ecwt, y: p.eff })) }))} /> : <div className="empty">No ECWT / OAT column mapped.</div>}
        </Card>
        <Card title="Plant load">
          <XYChart height={260} xLabel="Date" yLabel="TR" xTime yZero series={[{ name: 'Plant TR', mode: 'line', points: s.map((p) => ({ x: p.ts, y: p.tr })) }]} />
        </Card>
        <Card title="Plant & chiller efficiency">
          <XYChart height={260} xLabel="Date" yLabel="kW/TR" xTime yZero series={[
            { name: 'Plant kW/TR', mode: 'line', color: 'var(--c2)', points: s.map((p) => ({ x: p.ts, y: p.kwPerTR })) },
            { name: 'Chiller kW/TR', mode: 'line', color: 'var(--c1)', points: s.map((p) => ({ x: p.ts, y: p.chillerKwPerTR })) },
            { name: 'Target', mode: 'line', dash: true, color: 'var(--c5)', points: s.map((p) => ({ x: p.ts, y: a.settings.targetKwPerTR })) },
          ]} />
        </Card>
        <Card title="Plant load profile">
          <BarChart height={250} yLabel="Hours" xLabel="% of installed capacity" categories={a.loadProfile.map((b) => b.label)} series={[{ name: 'Hours', values: a.loadProfile.map((b) => b.hours) }]} format={(v) => v.toFixed(0)} />
        </Card>
        <Card title="Chiller PLR bins" actions={<select aria-label="Chiller" value={sel} onChange={(e) => setCh(e.target.value)}>{ids.map((i) => <option key={i}>{i}</option>)}</select>}>
          <BarChart height={250} yLabel="kW/TR" xLabel="PLR bin" categories={bins.map((b) => b.label)} series={[{ name: 'kW/TR', values: bins.map((b) => b.kwPerTR), color: 'var(--c2)' }]} />
        </Card>
      </div>
      <Card title={`Chiller ${sel} – PLR bins`}>
        <Table head={['PLR bin', 'Hours', 'TR·h', 'kWh', 'kW/TR']} numeric={[1, 2, 3, 4]} rows={bins.map((b) => [b.label, fmt(b.hours, 1), fmt0(b.trHours), fmt0(b.kWh), fmt(b.kwPerTR, 3)])} />
      </Card>
    </>
  );
}
