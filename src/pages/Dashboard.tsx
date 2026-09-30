import { useStore } from '../app/store';
import { Card, Chip, Kpi, PageHead } from '../components/ui';
import { XYChart } from '../components/charts';
import { plantSeries } from '../charts/chartData';
import { fmt, fmt0 } from '../utils/format';

export function DashboardPage() {
  const { analysis: a, loggerAnalyses, setPage, bmsFileName, importBms, recent, openRecent, license } = useStore();
  if (!a) {
    return (
      <>
        <PageHead title="Dashboard" subtitle="Chilled-water plant efficiency at a glance." />
        {loggerAnalyses.length > 0 && (
          <Card title="Logger data loaded">
            <p>{loggerAnalyses.length} Fluke logger file(s) loaded without BMS data – see <button className="btn sm" onClick={() => setPage('logger')}>Logger Import</button> for the power profile.</p>
          </Card>
        )}
        <div className="grid g3">
          <Card title="1 · Import BMS data"><p>Load a CSV / TSV trend export with chiller power, chilled-water flow and temperatures.</p><button className="btn primary" onClick={importBms}>Import BMS file…</button></Card>
          <Card title="2 · Check the mapping"><p>Columns are mapped automatically – confirm timestamp, chiller, power, load, temperatures and auxiliary power.</p><button className="btn" onClick={() => setPage('mapping')}>Column Mapping</button></Card>
          <Card title="3 · Add Fluke loggers (optional)"><p>Use logger power instead of BMS power, or analyse a logger on its own.</p><button className="btn" onClick={() => setPage('logger')}>Logger Import</button></Card>
        </div>
        {recent.length > 0 && (
          <Card title="Recent projects">
            {recent.map((r) => <div key={r.path} className="row" style={{ padding: '4px 0' }}><button className="btn sm" onClick={() => openRecent(r)}>{r.name}</button><span className="hint">{r.path}</span></div>)}
          </Card>
        )}
        {license?.state === 'warning' && <p className="hint">License validation is overdue – see the License page.</p>}
      </>
    );
  }
  const k = a.kpis;
  const series = plantSeries(a, 500);
  const overTarget = k.plantKwPerTR > a.settings.targetKwPerTR;
  const worst = a.findings.filter((f) => f.status !== 'OK').length;
  return (
    <>
      <PageHead title="Dashboard" subtitle={`${bmsFileName ?? 'Project'} · ${a.firstDate} → ${a.lastDate} · ${a.intervalMinutes} min interval · ${a.chillers.length} chiller(s)`} />
      <div className="kpis">
        <Kpi hero label="Plant kW/TR" value={fmt(k.plantKwPerTR, 3)} sub={<><Chip label={k.plantRating} /><span>target {fmt(a.settings.targetKwPerTR, 2)}</span></>} />
        <Kpi label="Plant COP" value={fmt(k.plantCOP, 2)} sub={<span>EER {fmt(12 / k.plantKwPerTR, 1)}</span>} />
        <Kpi label="Chiller kW/TR" value={fmt(k.chillerKwPerTR, 3)} sub={<Chip label={k.chillerRating} />} />
        <Kpi label="Chiller COP" value={fmt(k.chillerCOP, 2)} />
        <Kpi label="Cooling delivered" value={fmt0(k.trHours)} unit="TR·h" sub={<span>{fmt0(k.thermalKWh)} kWh thermal</span>} />
        <Kpi label="Energy (chiller + aux)" value={fmt0(k.chillerKWh + k.auxKWh)} unit="kWh" sub={<span>aux {fmt(k.auxShare * 100, 1)} %</span>} />
        <Kpi label="Peak load" value={fmt0(k.peakLoad)} unit="TR" sub={<span>avg {fmt0(k.avgLoad)} TR · load factor {fmt(k.loadFactor * 100, 0)} %</span>} />
        <Kpi label="Above target" value={fmt0(k.kWhAboveTarget)} unit="kWh" sub={<span>{fmt0(k.costAboveTarget)} {a.settings.currency} · {fmt0(k.annualizedCost)}/yr</span>} />
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Plant efficiency vs target">
          <XYChart height={250} xLabel="Date" yLabel="kW/TR" xTime
            series={[
              { name: 'Plant kW/TR', mode: 'line', points: series.map((s) => ({ x: s.ts, y: s.kwPerTR })), color: 'var(--c2)' },
              { name: 'Target', mode: 'line', dash: true, points: series.map((s) => ({ x: s.ts, y: a.settings.targetKwPerTR })), color: 'var(--c5)' },
            ]} />
          <p className="hint">{overTarget ? `Plant is ${fmt((k.plantKwPerTR / a.settings.targetKwPerTR - 1) * 100, 1)} % above the target.` : 'Plant meets the target.'}</p>
        </Card>
        <Card title="Plant load">
          <XYChart height={250} xLabel="Date" yLabel="TR" xTime yZero series={[{ name: 'Plant TR', mode: 'line', points: series.map((s) => ({ x: s.ts, y: s.tr })) }]} />
        </Card>
      </div>
      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title="Findings" actions={<button className="btn sm" onClick={() => setPage('findings')}>All findings</button>}>
          <p style={{ marginTop: 0 }}>{worst} of {a.findings.length} areas need attention.</p>
          {a.findings.slice(0, 5).map((f) => <div key={f.id} className="row" style={{ padding: '3px 0' }}><Chip label={f.status} /><span>{f.title}</span></div>)}
        </Card>
        <Card title="Rows analysed">
          <div className="kpis" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <Kpi label="Kept" value={fmt0(a.exclusions.kept)} sub={`of ${fmt0(a.exclusions.total)}`} />
            <Kpi label="Excluded" value={fmt0(a.exclusions.excluded)} sub={<button className="btn sm" onClick={() => setPage('analysis')}>Reasons</button>} />
          </div>
          {a.sources.loggers.length > 0 && <p className="hint">Power from {a.sources.loggers.length} Fluke logger(s) where attached.</p>}
        </Card>
      </div>
    </>
  );
}
