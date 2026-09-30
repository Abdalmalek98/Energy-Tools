import { useStore } from '../app/store';
import { Banner, Card, Chip, Kpi, NeedData, PageHead, Table } from '../components/ui';
import { BarChart, XYChart } from '../components/charts';
import { plantSeries } from '../charts/chartData';
import { fmt, fmt0 } from '../utils/format';

export function AnalysisPage() {
  const { analysis: a, analysisError, table } = useStore();
  if (!table) return (<><PageHead title="Analysis" /><NeedData /></>);
  if (analysisError || !a) return (<><PageHead title="Analysis" /><Banner kind="error" title="Cannot analyse yet. "><pre>{analysisError}</pre></Banner></>);
  const k = a.kpis;
  const e = a.exclusions;
  const s = plantSeries(a, 700);
  return (
    <>
      <PageHead title="Analysis" subtitle={`${a.firstDate} → ${a.lastDate} · efficiency is energy weighted: Σ kWh / Σ TR·h`} />
      {a.warnings.map((w, i) => <div key={i} style={{ marginBottom: 8 }}><Banner kind="warn">{w}</Banner></div>)}
      <Card title="Key performance indicators">
        <div className="kpis">
          <Kpi label="Plant kW/TR" value={fmt(k.plantKwPerTR, 3)} sub={<Chip label={k.plantRating} />} hero />
          <Kpi label="Plant COP" value={fmt(k.plantCOP, 2)} />
          <Kpi label="Chiller kW/TR" value={fmt(k.chillerKwPerTR, 3)} sub={<Chip label={k.chillerRating} />} />
          <Kpi label="Chiller COP" value={fmt(k.chillerCOP, 2)} />
          <Kpi label="TR·h" value={fmt0(k.trHours)} />
          <Kpi label="Thermal energy" value={fmt0(k.thermalKWh)} unit="kWh" />
          <Kpi label="Chiller energy" value={fmt0(k.chillerKWh)} unit="kWh" />
          <Kpi label="Auxiliary energy" value={fmt0(k.auxKWh)} unit="kWh" sub={`${fmt(k.auxShare * 100, 1)} % of plant energy`} />
          <Kpi label="Peak load" value={fmt0(k.peakLoad)} unit="TR" />
          <Kpi label="Average load" value={fmt0(k.avgLoad)} unit="TR" />
          <Kpi label="Load factor" value={fmt(k.loadFactor * 100, 1)} unit="%" />
          <Kpi label="Installed capacity" value={fmt0(k.installedTR)} unit="TR" />
          <Kpi label="kWh above target" value={fmt0(k.kWhAboveTarget)} unit="kWh" />
          <Kpi label="Cost above target" value={fmt0(k.costAboveTarget)} unit={a.settings.currency} />
          <Kpi label="Annualised cost" value={fmt0(k.annualizedCost)} unit={`${a.settings.currency}/yr`} />
          <Kpi label="Logged time" value={fmt(k.loggedHours, 1)} unit="h" />
        </div>
      </Card>
      <Card title="Row filtering">
        <Table head={['Rule', 'Rows']} numeric={[1]} rows={[
          ['Total rows', fmt0(e.total)],
          ['Non-numeric / missing value', fmt0(e.reasons.nonNumeric)],
          ['Unreadable timestamp', fmt0(e.reasons.badTimestamp)],
          ['kW ≤ 1', fmt0(e.reasons.lowPower)],
          [`Load ≤ rated capacity × ${a.settings.minPLR}`, fmt0(e.reasons.lowLoad)],
          [`kW/TR outside ${a.settings.outlierMin}–${a.settings.outlierMax} (${a.settings.outlierFilter ? 'on' : 'off'})`, fmt0(e.reasons.outlier)],
          [<b key="x">Rows excluded (distinct)</b>, <b key="y">{fmt0(e.excluded)}</b>],
          [<b key="a">Rows analysed</b>, <b key="b">{fmt0(e.kept)}</b>],
        ]} />
        <p className="hint">A row can match more than one rule; each reason is counted separately.</p>
      </Card>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Plant load"><XYChart height={250} xLabel="Date" yLabel="TR" xTime yZero series={[{ name: 'Plant TR', mode: 'line', points: s.map((p) => ({ x: p.ts, y: p.tr })) }]} /></Card>
        <Card title="Load profile (hours by % of installed capacity)"><BarChart height={250} yLabel="Hours" categories={a.loadProfile.map((b) => b.label)} series={[{ name: 'Hours', values: a.loadProfile.map((b) => b.hours) }]} format={(v) => v.toFixed(0)} /></Card>
      </div>
      <Card title="Load profile table">
        <Table head={['Bin', 'Hours', 'TR·h', 'kWh', 'kW/TR']} numeric={[1, 2, 3, 4]} rows={a.loadProfile.map((b) => [b.label, fmt(b.hours, 1), fmt0(b.trHours), fmt0(b.kWh), fmt(b.kwPerTR, 3)])} />
      </Card>
    </>
  );
}
