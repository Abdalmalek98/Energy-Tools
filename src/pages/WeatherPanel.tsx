import type { AnalysisResult, HourlyWeatherAnalysis, RegressionModel, WeatherBin } from '../types';
import { Banner, Card, Chip, Kpi, Table } from '../components/ui';
import { BarChart, XYChart } from '../components/charts';
import { thin } from '../charts/chartData';
import { fmt, fmt0 } from '../utils/format';

const ID_LABEL = { temperature: 'Temperature', enthalpy: 'Enthalpy', 'temperature+humidity': 'Temperature + humidity' } as const;

function binTable(bins: WeatherBin[]) {
  return <Table head={['Bin', 'Hours', 'Avg kW', 'Avg TR', 'kW/TR']} numeric={[1, 2, 3, 4]} rows={bins.map((b) => [b.label, fmt0(b.hours), fmt0(b.avgKW), fmt0(b.avgTR), fmt(b.kwPerTR, 3)])} />;
}

function coefRows(m: RegressionModel) {
  return m.coefs.map((k) => [k.name, k.value.toPrecision(5), k.se.toPrecision(3), fmt(k.t, 2), k.p < 0.0001 ? '<0.0001' : fmt(k.p, 4), k.ciLow.toPrecision(5), k.ciHigh.toPrecision(5), k.significant ? 'Yes' : 'No']);
}

/** Hourly weather results: temperature / enthalpy / humidity relationships, models, normalised efficiency and bins. */
export function WeatherPanel({ a }: { a: AnalysisResult }) {
  const w: HourlyWeatherAnalysis = a.weather!;
  const sel = w.selected;
  const used = w.rows.filter((r) => r.used);
  const pts = thin(used, 1800);
  const hasH = w.rows.some((r) => r.enthalpy !== null);
  return (
    <>
      {w.notes.map((n, i) => <div key={i} style={{ marginBottom: 8 }}><Banner kind={/not|Only|hardly|left out|no weather/.test(n) ? 'warn' : 'info'}>{n}</Banner></div>)}
      {sel && (
        <>
          <Card title="Hourly plant power vs weather">
            <div className="kpis" style={{ marginBottom: 14 }}>
              <Kpi hero label="Hours in regression" value={fmt0(w.usedHours)} sub={`best model: ${ID_LABEL[sel.id]}`} />
              <Kpi label="R²" value={fmt(sel.energy.r2, 3)} sub={<Chip label={sel.energy.guideline14.pass ? 'PASS' : 'FAIL'} />} />
              <Kpi label="CV(RMSE)" value={fmt(sel.energy.cv, 1)} unit="%" sub={`limit ${sel.energy.guideline14.cvLimit} % (hourly)`} />
              <Kpi label="NMBE" value={fmt(sel.energy.nmbe, 2)} unit="%" sub={`limit ±${sel.energy.guideline14.nmbeLimit} %`} />
              {w.normalised && <Kpi label="Normalised plant kW/TR" value={fmt(w.normalised.kwPerTR, 3)} sub="at the mean weather" />}
              {w.correlations.temperature !== null && <Kpi label="r (kW, temperature)" value={fmt(w.correlations.temperature, 2)} />}
              {w.correlations.enthalpy !== null && <Kpi label="r (kW, enthalpy)" value={fmt(w.correlations.enthalpy, 2)} />}
              {w.correlations.humidity !== null && <Kpi label="r (kW, humidity)" value={fmt(w.correlations.humidity, 2)} />}
            </div>
            <div className="grid g2">
              <XYChart title="Plant kW vs outdoor temperature" height={290} xLabel="Dry-bulb temperature (°C)" yLabel="kW" yZero series={[{ name: 'Hours', points: pts.map((r) => ({ x: r.tempC as number, y: r.kW })) }]} />
              {hasH
                ? <XYChart title="Plant kW vs enthalpy" height={290} xLabel="Enthalpy (kJ/kg)" yLabel="kW" yZero series={[{ name: 'Hours', color: 'var(--c2)', points: pts.filter((r) => r.enthalpy !== null).map((r) => ({ x: r.enthalpy as number, y: r.kW })) }]} />
                : <XYChart title="Plant kW/TR vs outdoor temperature" height={290} xLabel="Dry-bulb temperature (°C)" yLabel="kW/TR" series={[{ name: 'Hours', color: 'var(--c2)', points: pts.filter((r) => Number.isFinite(r.kwPerTR)).map((r) => ({ x: r.tempC as number, y: r.kwPerTR })) }]} />}
            </div>
            {hasH && <div style={{ marginTop: 14 }}><XYChart title="Plant kW/TR vs outdoor temperature" height={290} xLabel="Dry-bulb temperature (°C)" yLabel="kW/TR" series={[{ name: 'Hours', color: 'var(--c4)', points: pts.filter((r) => Number.isFinite(r.kwPerTR)).map((r) => ({ x: r.tempC as number, y: r.kwPerTR })) }]} /></div>}
            <p className="hint">Only hours in which the plant ran are used unless "include off hours" is set in Plant Settings. Weather time stamps are read as {a.settings.weatherHourEnding ? 'hour-ending' : 'hour-starting'}.</p>
          </Card>
          <Card title="Model comparison (hourly plant kW)">
            <Table head={['Predictors', 'n', 'R²', 'Adj R²', 'RMSE kW', 'CV(RMSE) %', 'NMBE %', 'Guideline 14', 'Selected']} numeric={[1, 2, 3, 4, 5, 6]}
              rows={w.candidates.map((c) => [c.label, c.energy.n, fmt(c.energy.r2, 4), fmt(c.energy.adjR2, 4), fmt(c.energy.rmse, 1), fmt(c.energy.cv, 2), fmt(c.energy.nmbe, 3), <Chip key="g" label={c.energy.guideline14.pass ? 'PASS' : 'FAIL'} />, c === sel ? '◄ selected' : ''])} />
            <p className="hint">Start with temperature; use enthalpy or temperature + humidity only if CV(RMSE) falls below 95 % of the current best AND adjusted R² rises.{!w.hasHumidity ? ' No humidity data was supplied, so only the temperature model is available.' : ''}</p>
          </Card>
          {w.reference && w.normalised && (
            <Card title="Weather-normalised results">
              <Table head={['Quantity', 'Value']} numeric={[1]} rows={[
                ['Mean temperature', `${fmt(w.reference.tempC, 1)} °C`],
                ...(w.reference.rh !== null ? [['Mean relative humidity', `${fmt(w.reference.rh, 0)} %`]] : []),
                ...(w.reference.enthalpy !== null ? [['Mean enthalpy', `${fmt(w.reference.enthalpy, 1)} kJ/kg`]] : []),
                ['Plant power at mean weather', `${fmt0(w.normalised.kW)} kW`],
                ['Cooling load at mean weather', `${fmt0(w.normalised.tr)} TR`],
                ['Plant kW/TR at mean weather', fmt(w.normalised.kwPerTR, 3)],
              ]} />
            </Card>
          )}
          <div className="grid g2" style={{ marginTop: 16 }}>
            <Card title="Temperature bins (2 °C)">
              <BarChart height={240} yLabel="kW/TR" xLabel="Dry-bulb temperature bin" categories={w.tempBins.map((b) => `${b.lo}`)} series={[{ name: 'kW/TR', values: w.tempBins.map((b) => b.kwPerTR), color: 'var(--c2)' }]} format={(v) => v.toFixed(2)} />
              {binTable(w.tempBins)}
            </Card>
            {w.enthalpyBins && (
              <Card title="Enthalpy bins (5 kJ/kg)">
                <BarChart height={240} yLabel="kW/TR" xLabel="Enthalpy bin" categories={w.enthalpyBins.map((b) => `${b.lo}`)} series={[{ name: 'kW/TR', values: w.enthalpyBins.map((b) => b.kwPerTR), color: 'var(--c4)' }]} format={(v) => v.toFixed(2)} />
                {binTable(w.enthalpyBins)}
              </Card>
            )}
          </div>
          <Card title={`Selected model – ${sel.label}`}>
            <Table head={['Term', 'Coefficient', 'Std error', 't', 'p', '95 % CI low', '95 % CI high', 'Significant']} numeric={[1, 2, 3, 4, 5, 6]} rows={coefRows(sel.energy)} />
          </Card>
        </>
      )}
      <Card title="Hourly data">
        <div style={{ maxHeight: 340, overflow: 'auto' }}>
          <Table head={['Hour', 'Temp °C', 'RH %', 'Enthalpy', 'kW', 'TR', 'kW/TR', 'Expected kW', 'In model']} numeric={[1, 2, 3, 4, 5, 6, 7]}
            rows={thin(w.rows, 2000).map((r) => [new Date(r.ts).toISOString().slice(0, 16).replace('T', ' '), r.tempC === null ? '—' : fmt(r.tempC, 1), r.rh === null ? '—' : fmt(r.rh, 0), r.enthalpy === null ? '—' : fmt(r.enthalpy, 1), fmt0(r.kW), fmt0(r.tr), fmt(r.kwPerTR, 3), r.expectedKW === null ? '—' : fmt0(r.expectedKW), r.used ? 'yes' : 'no'])} />
        </div>
      </Card>
    </>
  );
}
