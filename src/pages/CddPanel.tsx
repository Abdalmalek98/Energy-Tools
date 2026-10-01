import type { AnalysisResult } from '../types';
import { Banner, Card, Chip, Kpi, Table } from '../components/ui';
import { XYChart } from '../components/charts';
import { fmt, fmt0 } from '../utils/format';

const iso = (d: number) => new Date(d).toISOString().slice(0, 10);

/** Weather (cooling degree days) results: daily regression, normalised efficiency, actual vs weather-expected. */
export function CddPanel({ a }: { a: AnalysisResult }) {
  const c = a.cdd!;
  const m = c.energyModel;
  const used = c.days.filter((d) => d.used);
  return (
    <>
      {c.notes.map((n, i) => <div key={i} style={{ marginBottom: 8 }}><Banner kind={/not|Only|hardly|left out|no CDD/.test(n) ? 'warn' : 'info'}>{n}</Banner></div>)}
      {m && (
        <>
          <Card title="Daily plant energy vs cooling degree days">
            <div className="kpis" style={{ marginBottom: 14 }}>
              <Kpi hero label="Days in regression" value={String(c.usedDays)} sub={`of ${c.days.length} logged days`} />
              <Kpi label="R²" value={fmt(m.r2, 3)} sub={<Chip label={m.guideline14.pass ? 'PASS' : 'FAIL'} />} />
              <Kpi label="CV(RMSE)" value={fmt(m.cv, 1)} unit="%" sub={`limit ${m.guideline14.cvLimit} % (daily)`} />
              <Kpi label="NMBE" value={fmt(m.nmbe, 2)} unit="%" sub={`limit ±${m.guideline14.nmbeLimit} %`} />
              <Kpi label="Weather slope" value={fmt0(m.coefs[1].value)} unit="kWh/CDD" sub={`95 % CI ${fmt0(m.coefs[1].ciLow)} … ${fmt0(m.coefs[1].ciHigh)}`} />
              <Kpi label="Base load" value={fmt0(m.coefs[0].value)} unit="kWh/day" sub={c.baseShare !== null ? `${fmt(c.baseShare * 100, 0)} % of average day` : undefined} />
              {c.normalised && <Kpi label="Normalised plant kW/TR" value={fmt(c.normalised.kwPerTR, 3)} sub={`at ${c.refLabel}`} />}
              {c.weatherShare !== null && <Kpi label="Weather-driven share" value={fmt(c.weatherShare * 100, 0)} unit="%" sub="of mean daily energy" />}
            </div>
            <XYChart height={320} xLabel="Cooling degree days (CDD)" yLabel="kWh/day" yZero
              series={[
                { name: 'Days', points: used.map((d) => ({ x: d.cdd as number, y: d.kWh })) },
                { name: 'Fit', mode: 'line', color: 'var(--c5)', points: [Math.min(...used.map((d) => d.cdd as number)), Math.max(...used.map((d) => d.cdd as number))].map((x) => ({ x, y: m.predict(x) })) },
              ]} />
            <p className="hint">kWh/day = {fmt(m.coefs[0].value, 1)} + {fmt(m.coefs[1].value, 2)} × CDD. Energy is that of the intervals that passed the row filters; days logged for less than the minimum share are excluded.</p>
          </Card>
          <Card title="Actual vs weather-expected daily energy">
            <XYChart height={280} xLabel="Day" yLabel="kWh/day" xTime yZero
              series={[
                { name: 'Actual', color: 'var(--c2)', mode: 'line', points: used.map((d) => ({ x: d.day, y: d.kWh })) },
                { name: 'Expected from CDD', color: 'var(--c1)', mode: 'line', dash: true, points: used.map((d) => ({ x: d.day, y: d.expectedKWh as number })) },
              ]} />
            <p className="hint">
              Total actual {fmt0(c.actualKWh)} kWh vs expected {fmt0(c.expectedKWh)} kWh.
              {c.firstHalfResidualPct !== null && c.secondHalfResidualPct !== null ? ` First half ${fmt(c.firstHalfResidualPct, 1)} %, second half ${fmt(c.secondHalfResidualPct, 1)} % versus the weather-expected energy.` : ''}
              {' '}The baseline is fitted over the whole analysed period, so a late change is partly absorbed by the fit and drift is understated.
            </p>
          </Card>
          {c.normalised && (
            <Card title="Weather-normalised results">
              <Table head={['Quantity', 'Value', 'Basis']} numeric={[1]} rows={[
                ['Reference CDD', fmt(c.refCdd, 2), c.refLabel],
                ['Energy per day', `${fmt0(c.normalised.kWhPerDay)} kWh`, 'b0 + b1 × reference CDD'],
                ['Cooling per day', `${fmt0(c.normalised.trHoursPerDay)} TR·h`, 'daily TR·h regression on CDD'],
                ['Plant kW/TR', fmt(c.normalised.kwPerTR, 3), 'energy ÷ cooling at the reference CDD'],
                ...(c.annual ? [['Annual energy (typical year)', `${fmt0(c.annual.kWh)} kWh`, `365 × b0 + b1 × ${fmt0(c.annual.typicalCdd)} CDD`], ['Annual cooling (typical year)', `${fmt0(c.annual.trHours)} TR·h`, 'same method']] : []),
              ]} />
              <p className="hint">Set a typical annual CDD in Plant Settings to add annual figures.</p>
            </Card>
          )}
          <Card title="Model coefficients">
            <Table head={['Term', 'Coefficient', 'Std error', 't', 'p', '95 % CI low', '95 % CI high']} numeric={[1, 2, 3, 4, 5, 6]}
              rows={m.coefs.map((k) => [k.name, k.value.toPrecision(5), k.se.toPrecision(3), fmt(k.t, 2), k.p < 0.0001 ? '<0.0001' : fmt(k.p, 4), k.ciLow.toPrecision(5), k.ciHigh.toPrecision(5)])} />
          </Card>
        </>
      )}
      <Card title="Daily data">
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          <Table head={['Day', 'CDD', 'Logged', 'kWh', 'TR·h', 'kW/TR', 'Expected kWh', 'Residual', 'In model']} numeric={[1, 2, 3, 4, 5, 6, 7]}
            rows={c.days.map((d) => [iso(d.day), d.cdd === null ? '—' : fmt(d.cdd, 1), `${fmt(d.coverage * 100, 0)} %`, fmt0(d.kWh), fmt0(d.trHours), fmt(d.kwPerTR, 3), d.expectedKWh === null ? '—' : fmt0(d.expectedKWh), d.residualKWh === null ? '—' : fmt0(d.residualKWh), d.used ? 'yes' : 'no'])} />
        </div>
      </Card>
    </>
  );
}
