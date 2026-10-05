import type { AnalysisResult, AnnualMethodResult } from '../types';
import { Banner, Card, Kpi, Table } from '../components/ui';
import { BarChart, XYChart } from '../components/charts';
import { thin } from '../charts/chartData';
import { fmt, fmt0 } from '../utils/format';
import { wetBulbStull as wb } from '../analysis/psychro';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function methodKpis(m: AnnualMethodResult) {
  return (
    <div className="kpis" style={{ marginBottom: 14 }}>
      <Kpi hero label="Annual energy" value={fmt0(m.kWh)} unit="kWh/yr" />
      <Kpi label="Annual cooling" value={fmt0(m.trHours)} unit="TR·h/yr" />
      <Kpi label="Plant efficiency" value={fmt(m.kwPerTR, 3)} unit="kW/TR" />
      <Kpi label="R² energy vs weather" value={fmt(m.energyModel.r2, 3)} sub={`n = ${m.energyModel.n}`} />
      <Kpi label={m.loadFrom === 'weather' ? 'R² load vs weather' : 'R² load vs energy'} value={fmt(m.loadModel.r2, 3)} sub={`n = ${m.loadModel.n}`} />
      {m.eflh !== null && <Kpi label="Full-load hours" value={fmt0(m.eflh)} unit="h/yr" sub="kWh ÷ installed kW" />}
      {(m.outliersPct.energy > 0 || m.outliersPct.load > 0) && <Kpi label="Outliers removed" value={`${fmt(m.outliersPct.energy, 1)} / ${fmt(m.outliersPct.load, 1)}`} unit="%" sub="energy / load fit" />}
    </div>
  );
}

/** Annual projection from a typical-year weather file (hourly + daily regression methods). */
export function AnnualPanel({ a }: { a: AnalysisResult }) {
  const p = a.annual;
  if (!p) {
    return <Banner kind="info">Import a <b>typical-year hourly weather</b> file on the Data Import page (together with the hourly weather of the logged period) to project annual consumption.</Banner>;
  }
  const hd = p.hourly, dl = p.daily;
  const used = a.weather ? a.weather.rows.filter((r) => r.used) : [];
  const xOf = (r: (typeof used)[number]) => (p.predictor === 'temperature' ? r.tempC : p.predictor === 'enthalpy' ? r.enthalpy : r.tempC !== null && r.rh !== null ? wb(r.tempC, r.rh) : null);
  const pts = thin(used.filter((r) => xOf(r) !== null), 1800);
  const sc = p.scenario;
  return (
    <>
      {p.notes.map((n, i) => <div key={i} style={{ marginBottom: 8 }}><Banner kind={/not|Only|too few|needs|lack|could not/.test(n) ? 'warn' : 'info'}>{n}</Banner></div>)}
      <Card title="Weather driver">
        <p style={{ margin: 0 }}>Typical year: <b>{p.typicalFile}</b> ({fmt0(p.typicalHours)} h). Driver: <b>{p.predictorLabel}</b>. Fitted on {fmt0(p.fitHours)} logged hours{p.fitDays ? ` and ${fmt0(p.fitDays)} complete days` : ''}.</p>
      </Card>
      {hd && (
        <Card title="Hourly method">
          {methodKpis(hd)}
          <p className="hint">Hourly energy = {fmt(hd.energyModel.slope, 3)} × weather {hd.energyModel.intercept < 0 ? '−' : '+'} {fmt(Math.abs(hd.energyModel.intercept), 1)}; hourly TR·h = {fmt(hd.loadModel.slope, 4)} × {hd.loadFrom === 'weather' ? 'weather' : 'kWh'} {hd.loadModel.intercept < 0 ? '−' : '+'} {fmt(Math.abs(hd.loadModel.intercept), 1)}. Negative predictions are set to zero.</p>
          <div className="grid g2">
            <XYChart title="Hourly plant kWh vs weather" height={280} xLabel={p.predictorLabel} yLabel="kWh" yZero series={[{ name: 'Logged hours', points: pts.map((r) => ({ x: xOf(r) as number, y: r.kW })) }]} />
            <XYChart title={hd.loadFrom === 'weather' ? 'Hourly cooling load vs weather' : 'Hourly cooling load vs plant kWh'} height={280} xLabel={hd.loadFrom === 'weather' ? p.predictorLabel : 'kWh'} yLabel="TR·h" yZero series={[{ name: 'Logged hours', color: 'var(--c2)', points: pts.filter((r) => r.tr > 0).map((r) => ({ x: hd.loadFrom === 'weather' ? (xOf(r) as number) : r.kW, y: r.tr })) }]} />
          </div>
        </Card>
      )}
      {dl && (
        <Card title="Daily method">
          {methodKpis(dl)}
          <p className="hint">Daily energy = {fmt(dl.energyModel.slope, 3)} × Σ(hourly weather) {dl.energyModel.intercept < 0 ? '−' : '+'} {fmt(Math.abs(dl.energyModel.intercept), 0)}; daily TR·h = {fmt(dl.loadModel.slope, 4)} × {dl.loadFrom === 'weather' ? 'Σ(hourly weather)' : 'kWh'} {dl.loadModel.intercept < 0 ? '−' : '+'} {fmt(Math.abs(dl.loadModel.intercept), 0)}.</p>
        </Card>
      )}
      {hd && dl && p.methodDifferencePct !== null && (
        <Banner kind={Math.abs(p.methodDifferencePct) > 25 ? 'warn' : 'info'}>The daily method gives {fmt(Math.abs(p.methodDifferencePct), 1)} % {p.methodDifferencePct >= 0 ? 'more' : 'less'} annual energy than the hourly method. {Math.abs(p.methodDifferencePct) > 25 ? 'A difference this large means the logged period does not represent the year well – treat the projection as an estimate and extend the logging if possible.' : ''}</Banner>
      )}
      {(dl ?? hd) && (
        <Card title="Monthly projection">
          <BarChart height={250} yLabel="kWh" categories={MONTHS} series={[
            ...(hd ? [{ name: 'Hourly method', values: hd.monthly.map((m) => m.kWh), color: 'var(--c1)' }] : []),
            ...(dl ? [{ name: 'Daily method', values: dl.monthly.map((m) => m.kWh), color: 'var(--c2)' }] : []),
          ]} format={(v) => fmt0(v)} />
          <Table head={['Month', ...(hd ? ['kWh (hourly)', 'TR·h (hourly)', 'kW/TR (hourly)'] : []), ...(dl ? ['kWh (daily)', 'TR·h (daily)', 'kW/TR (daily)'] : [])]}
            numeric={Array.from({ length: (hd ? 3 : 0) + (dl ? 3 : 0) }, (_, i) => i + 1)}
            rows={MONTHS.map((mn, i) => [mn, ...(hd ? [fmt0(hd.monthly[i].kWh), fmt0(hd.monthly[i].trHours), fmt(hd.monthly[i].kwPerTR, 3)] : []), ...(dl ? [fmt0(dl.monthly[i].kWh), fmt0(dl.monthly[i].trHours), fmt(dl.monthly[i].kwPerTR, 3)] : [])])} />
        </Card>
      )}
      {sc && (
        <Card title="Savings scenario">
          <p className="hint" style={{ marginTop: 0 }}>Based on the {(hd ?? dl)!.method} method's annual cooling load.</p>
          <div className="kpis">
            <Kpi label="Proposed efficiency" value={fmt(sc.proposedKwPerTR, 3)} unit="kW/TR" sub={`+${fmt0(sc.safetyPct)} % safety factor`} />
            <Kpi label="Proposed consumption" value={fmt0(sc.proposedKWh)} unit="kWh/yr" />
            <Kpi hero label="Annual saving" value={fmt0(sc.savingKWh)} unit="kWh/yr" sub={`${fmt(sc.savingPct, 1)} %`} />
            <Kpi label="Saving value" value={fmt0(sc.savingCost)} unit={a.settings.currency + '/yr'} />
          </div>
        </Card>
      )}
    </>
  );
}
