import { useState, type DragEvent } from 'react';
import { useStore } from '../app/store';
import { Banner, Card, Chip, Kpi, PageHead, Table } from '../components/ui';
import { XYChart } from '../components/charts';
import { loggerSeries } from '../charts/chartData';
import { fmt, fmt0, fmtTs } from '../utils/format';

export function LoggerImportPage() {
  const { loggerAnalyses, loggerError, dismissLoggerError, importLoggers, importLoggerFiles, removeLogger, setLoggerChiller, parsed, settings, updateSettings, analysis } = useStore();
  const [over, setOver] = useState(false);
  const chillerOptions = parsed?.chillers ?? [];
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = await Promise.all([...e.dataTransfer.files].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    await importLoggerFiles(files);
  };
  return (
    <>
      <PageHead title="Logger Import" subtitle="Fluke 1732 / 1734 / 1736 / 1738 / 1742 / 1746 / 1748 – .txt, .csv, .fca2, .fca. Works with or without BMS data." />
      <Card>
        <div className={`dropzone${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
          <p style={{ marginTop: 0 }}>Drop one or more logger export files here, or</p>
          <button className="btn primary" onClick={importLoggers}>Choose logger file(s)…</button>
          <p className="hint">Prefers <span className="mono">PowerP_Total_avg</span>. Minimum, maximum, reactive, apparent, fundamental, voltage, current and PF columns are never chosen automatically.</p>
        </div>
        {loggerError && (
          <div style={{ marginTop: 12 }}>
            <Banner kind="error" title={`Cannot import ${loggerError.title}`}>
              <pre>{loggerError.message}</pre>
              <button className="btn sm" style={{ marginTop: 8 }} onClick={dismissLoggerError}>Dismiss</button>
            </Banner>
          </div>
        )}
      </Card>
      {loggerAnalyses.length > 0 && (
        <Card title="Merge with BMS data">
          <label className="check"><input type="checkbox" checked={settings.analyseLoggedPeriodOnly} onChange={(e) => updateSettings({ analyseLoggedPeriodOnly: e.target.checked })} /> Analyse only logged period</label>
          <p className="hint">For every BMS timestamp T the logger readings whose midpoint lies in [T − interval/2, T + interval/2] are averaged; if none, the nearest reading within one interval is used. The result is written to a derived power column – original BMS data is never overwritten.{analysis ? ` Currently ${analysis.exclusions.total.toLocaleString('en-US')} rows in scope.` : ''}</p>
        </Card>
      )}
      {loggerAnalyses.map(({ entry, analysis: a }, i) => {
        const d = entry.data;
        const pts = loggerSeries(d, 1200);
        return (
          <Card key={d.fileName} title={`${d.chiller}${d.serial ? ` · SN ${d.serial}` : ''}${d.model ? ` · Fluke ${d.model}` : ''}`} actions={<button className="btn sm danger" onClick={() => removeLogger(i)}>Remove logger</button>}>
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="mono hint">{d.fileName}</span>
              <span>column <b className="mono">{d.powerColumn}</b> ({d.sourceUnit}{d.unitAssumed ? ', assumed' : ''})</span>
              <span>{fmt0(a.rows)} rows · {a.intervalMinutes} min</span>
              {chillerOptions.length > 0 ? (
                <label className="row">Attach to chiller&nbsp;
                  <select value={entry.chiller} onChange={(e) => setLoggerChiller(i, e.target.value)}>
                    {!chillerOptions.includes(entry.chiller) && <option value={entry.chiller}>{entry.chiller} (no BMS match)</option>}
                    {chillerOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              ) : (
                <label className="row">Chiller name&nbsp;<input type="text" style={{ width: 100 }} value={entry.chiller} onChange={(e) => setLoggerChiller(i, e.target.value)} /></label>
              )}
            </div>
            {a.flags.length > 0 && <div style={{ marginBottom: 12, display: 'grid', gap: 6 }}>{a.flags.map((f, j) => <div key={j} className="row"><Chip label={f.status} /><b>{f.title}</b><span>{f.text}</span></div>)}</div>}
            <div className="kpis">
              <Kpi label="Total energy" value={fmt0(a.totalKWh)} unit="kWh" />
              <Kpi label="Running hours" value={fmt(a.runningHours, 1)} unit="h" sub={`of ${fmt(a.loggedHours, 1)} h logged · ${fmt(a.runningShare * 100, 0)} %`} />
              <Kpi label="Running threshold" value={fmt(a.runningThresholdKW, 0)} unit="kW" sub="max(5 kW, 8 % of P99)" />
              <Kpi label="Avg running power" value={fmt0(a.avgRunningKW)} unit="kW" sub={`P10 ${fmt0(a.p10KW)} · P90 ${fmt0(a.p90KW)}`} />
              <Kpi label="Peak" value={fmt0(a.peakKW)} unit="kW" sub={fmtTs(a.peakTs)} />
              <Kpi label="Starts" value={String(a.starts)} sub={`longest run ${fmt(a.longestRunHours, 1)} h`} />
              <Kpi label="Standby" value={fmt(a.standbyKW, 1)} unit="kW" sub={`${fmt0(a.standbyKWh)} kWh`} />
              <Kpi label="Phases L1/L2/L3" value={a.phaseAvgKW ? a.phaseAvgKW.map((v) => v.toFixed(0)).join('/') : '—'} unit="kW" sub={a.phaseDeviationPct !== null ? `deviation ${fmt(a.phaseDeviationPct, 1)} %` : undefined} />
            </div>
            <div style={{ marginTop: 14 }}>
              <XYChart height={260} xLabel="Time" yLabel="kW" xTime yZero
                series={[
                  { name: 'Active power', mode: 'line', points: pts.map((p) => ({ x: p.ts, y: p.kW })) },
                  { name: 'Running threshold', mode: 'line', dash: true, color: 'var(--c5)', points: pts.map((p) => ({ x: p.ts, y: a.runningThresholdKW })) },
                ]} />
            </div>
            {d.notes.length > 0 && <ul className="hint">{d.notes.map((n, j) => <li key={j}>{n}</li>)}</ul>}
            <details style={{ marginTop: 8 }}><summary className="hint">Detected columns ({d.columns.length})</summary><div className="mono" style={{ fontSize: 12 }}>{d.columns.join(' · ')}</div></details>
          </Card>
        );
      })}
      {!loggerAnalyses.length && !loggerError && <div className="card empty"><p>No logger files loaded.</p></div>}
      {loggerAnalyses.length > 0 && <Card title="Logger summary"><Table head={['Chiller', 'Rows', 'kWh', 'Running h', 'Starts', 'Peak kW', 'Standby kW', 'Flags']} numeric={[1, 2, 3, 4, 5, 6]} rows={loggerAnalyses.map(({ analysis: a, entry }) => [entry.chiller, fmt0(a.rows), fmt0(a.totalKWh), fmt(a.runningHours, 1), a.starts, fmt0(a.peakKW), fmt(a.standbyKW, 1), a.flags.length ? a.flags.map((f) => f.title).join(', ') : '—'])} /></Card>}
    </>
  );
}
