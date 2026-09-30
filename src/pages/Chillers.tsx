import { useStore } from '../app/store';
import { Card, Chip, NeedData, PageHead, Table } from '../components/ui';
import { BarChart } from '../components/charts';
import { fmt, fmt0 } from '../utils/format';

export function ChillersPage() {
  const { analysis: a, table } = useStore();
  if (!table || !a) return (<><PageHead title="Chiller Comparison" /><NeedData /></>);
  const withIplv = a.chillers.filter((c) => c.iplv);
  return (
    <>
      <PageHead title="Chiller Comparison" subtitle="On spec ≤ 5 % above rated · Degraded ≤ 12 % · Poor ≤ 25 % · otherwise Investigate." />
      <Card>
        <Table
          head={['Chiller', 'Rated TR', 'Rated kW/TR', 'Run h', 'TR·h', 'kWh', 'Avg PLR', 'kW/TR', 'COP', 'P10', 'P90', '% vs rated', 'Avg ΔT °C', 'IPLV kW/TR', 'Status']}
          numeric={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]}
          rows={a.chillers.map((c) => [
            <b key="i">{c.id}</b>, fmt0(c.ratedTR), fmt(c.ratedKwPerTR, 2), fmt(c.runHours, 1), fmt0(c.trHours), fmt0(c.kWh), `${fmt(c.avgPLR * 100, 0)} %`,
            fmt(c.kwPerTR, 3), fmt(c.cop, 2), fmt(c.p10, 3), fmt(c.p90, 3), `${c.pctVsRated >= 0 ? '+' : ''}${fmt(c.pctVsRated, 1)} %`, fmt(c.avgDeltaT, 2),
            c.iplv && Number.isFinite(c.iplv.iplvKwPerTR) ? `${fmt(c.iplv.iplvKwPerTR, 3)}${c.iplv.extrapolated ? '*' : ''}` : 'n/a', <Chip key="s" label={c.status} />,
          ])} />
        <p className="hint">* IPLV rating point outside the measured ECWT ±0.5 °C or PLR ±0.05 range – the model is extrapolated.</p>
      </Card>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Actual vs rated kW/TR"><BarChart yLabel="kW/TR" categories={a.chillers.map((c) => c.id)} series={[{ name: 'Actual', values: a.chillers.map((c) => c.kwPerTR), color: 'var(--c2)' }, { name: 'Rated', values: a.chillers.map((c) => c.ratedKwPerTR), color: 'var(--c1)' }]} /></Card>
        <Card title="Energy share"><BarChart yLabel="kWh" categories={a.chillers.map((c) => c.id)} series={[{ name: 'kWh', values: a.chillers.map((c) => c.kWh), color: 'var(--c6)' }]} format={(v) => v.toFixed(0)} /></Card>
      </div>
      {withIplv.length > 0 ? (
        <Card title="IPLV rating points (multivariate model)">
          <Table head={['Chiller', 'PLR', 'ECWT °C', 'Weight', 'kW', 'kW/TR', 'COP', 'Range']} numeric={[1, 2, 3, 4, 5, 6]}
            rows={withIplv.flatMap((c) => c.iplv!.points.map((p) => [c.id, `${p.plr * 100} %`, fmt(p.ecwt, 2), fmt(p.weight, 2), fmt(p.kW, 1), fmt(p.kwPerTR, 3), fmt(p.cop, 2), p.outOfRange ? '* extrapolated' : 'measured']))} />
          <p className="hint">IPLV = 1 / Σ(wᵢ / COPᵢ) with LCHWT 6.67 °C and weights 1 / 42 / 45 / 12 % at 100 / 75 / 50 / 25 % PLR. Reported here as kW/TR = 3.51685 / IPLV(COP).</p>
        </Card>
      ) : <Card title="IPLV"><p>IPLV needs the multivariate model: map ECWT/OAT and provide more than 20 valid samples per chiller.</p></Card>}
    </>
  );
}
