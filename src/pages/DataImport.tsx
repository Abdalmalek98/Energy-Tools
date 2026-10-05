import { useState, type DragEvent } from 'react';
import { useStore } from '../app/store';
import { Banner, Card, PageHead, Table } from '../components/ui';
import { fmt0 } from '../utils/format';

const DELIM: Record<string, string> = { ',': 'comma', ';': 'semicolon', '\t': 'tab' };

export function DataImportPage() {
  const { typicalWeather, typicalWeatherError, importTypicalWeather, clearTypicalWeather, weather, weatherError, importWeather, clearWeather, cdd, cddError, importCdd, clearCdd, settings, table, bmsFileName, importBms, importBmsFile, clearBms, parsed, analysisError, setPage, project, newProject, openProjectDialog, saveCurrent, saveAs, exportBackup, importBackup, recent, openRecent } = useStore();
  const [over, setOver] = useState(false);
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) await importBmsFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  };
  return (
    <>
      <PageHead title="Data Import" subtitle="BMS / trend data – comma, semicolon or tab delimited; quoted fields, BOM, long or single-meter layout." />
      <Card>
        <div className={`dropzone${over ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
          <p style={{ marginTop: 0 }}>Drop a CSV / TXT / TSV file here, or</p>
          <button className="btn primary" onClick={importBms}>Choose BMS file…</button>
          <p className="hint">The file is read locally and never uploaded.</p>
        </div>
      </Card>
      {table && (
        <Card title={`Loaded: ${bmsFileName}`} actions={<button className="btn sm danger" onClick={clearBms}>Remove</button>}>
          <div className="row" style={{ gap: 24, marginBottom: 12 }}>
            <span><b className="num">{fmt0(table.rows.length)}</b> rows</span>
            <span><b className="num">{table.headers.length}</b> columns</span>
            <span>delimiter: <b>{DELIM[table.delimiter]}</b></span>
            {parsed && <span>interval: <b className="num">{parsed.interval} min</b></span>}
            {parsed && <span>chillers: <b>{parsed.chillers.join(', ')}</b></span>}
          </div>
          {analysisError && <Banner kind="error" title="Mapping needs attention. "><pre>{analysisError}</pre></Banner>}
          {parsed?.parseWarnings.map((w, i) => <div key={i} style={{ marginBottom: 6 }}><Banner kind="warn">{w}</Banner></div>)}
          <h3 style={{ margin: '14px 0 8px' }}>Preview</h3>
          <Table head={table.headers} rows={table.rows.slice(0, 8)} />
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={() => setPage('mapping')}>Continue to Column Mapping</button>
          </div>
        </Card>
      )}
      <Card title="Weather – cooling degree days (optional)" actions={cdd ? <button className="btn sm danger" onClick={clearCdd}>Remove</button> : undefined}>
        <p style={{ marginTop: 0 }}>Upload the customer's daily weather file: a <b>CDD</b> column, or daily temperature (mean, or Tmax + Tmin; CDD = max(0, T − base {settings.cddBaseTemp} °C)). The analysis then regresses daily plant energy on CDD and reports weather-normalised results.</p>
        {cddError && <div style={{ marginBottom: 10 }}><Banner kind="error" title="Cannot use this weather file. "><pre>{cddError}</pre></Banner></div>}
        {cdd ? (
          <div className="row" style={{ gap: 22 }}>
            <span><b>{cdd.fileName}</b></span><span><b className="num">{cdd.days.length}</b> days</span>
            <span>{new Date(cdd.days[0].day).toISOString().slice(0, 10)} → {new Date(cdd.days[cdd.days.length - 1].day).toISOString().slice(0, 10)}</span>
            <span>source: {cdd.source === 'cdd' ? 'CDD column' : 'temperature'}</span>
            <span>mean CDD <b className="num">{(cdd.days.reduce((a, d) => a + d.cdd, 0) / cdd.days.length).toFixed(1)}</b></span>
            <button className="btn sm" onClick={importCdd}>Replace…</button>
          </div>
        ) : <button className="btn" onClick={importCdd}>Import CDD / weather file…</button>}
        {cdd && cdd.notes.length > 0 && <ul className="hint">{cdd.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      </Card>
      <Card title="Weather – hourly data (optional)" actions={weather ? <button className="btn sm danger" onClick={clearWeather}>Remove</button> : undefined}>
        <p style={{ marginTop: 0 }}>Hourly outdoor conditions: a time column and <b>temperature</b> (required), plus <b>relative humidity</b> and <b>enthalpy</b> (both optional; with humidity but no enthalpy column the enthalpy is computed). The analysis relates hourly plant power and cooling load to temperature, enthalpy and humidity, and also derives daily CDD from the temperatures.</p>
        {weatherError && <div style={{ marginBottom: 10 }}><Banner kind="error" title="Cannot use this weather file. "><pre>{weatherError}</pre></Banner></div>}
        {weather ? (
          <div className="row" style={{ gap: 22 }}>
            <span><b>{weather.fileName}</b></span><span><b className="num">{weather.hours.length.toLocaleString('en-US')}</b> hours</span>
            <span>{new Date(weather.hours[0].ts).toISOString().slice(0, 10)} → {new Date(weather.hours[weather.hours.length - 1].ts).toISOString().slice(0, 10)}</span>
            <span>temperature ✓</span><span>humidity {weather.hasHumidity ? '✓' : '—'}</span><span>enthalpy {weather.hasEnthalpy ? (weather.enthalpyComputed ? '✓ (computed)' : '✓') : '—'}</span>
            <button className="btn sm" onClick={importWeather}>Replace…</button>
          </div>
        ) : <button className="btn" onClick={importWeather}>Import hourly weather file…</button>}
        {weather && weather.notes.length > 0 && <ul className="hint">{weather.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      </Card>
      <Card title="Weather – typical year for annual projection (optional)" actions={typicalWeather ? <button className="btn sm danger" onClick={clearTypicalWeather}>Remove</button> : undefined}>
        <p style={{ marginTop: 0 }}>A typical-year hourly file (8,760 hours: time, <b>temperature</b>, and <b>humidity</b> for the wet-bulb method). With the hourly weather of the logged period above, the tool projects annual kWh, TR·h and kW/TR by regression (hourly and daily methods).</p>
        {typicalWeatherError && <div style={{ marginBottom: 10 }}><Banner kind="error" title="Cannot use this weather file. "><pre>{typicalWeatherError}</pre></Banner></div>}
        {typicalWeather ? (
          <div className="row" style={{ gap: 22 }}>
            <span><b>{typicalWeather.fileName}</b></span><span><b className="num">{typicalWeather.hours.length.toLocaleString('en-US')}</b> hours</span>
            <span>humidity {typicalWeather.hasHumidity ? '✓' : '—'}</span>
            <button className="btn sm" onClick={importTypicalWeather}>Replace…</button>
          </div>
        ) : <button className="btn" onClick={importTypicalWeather}>Import typical-year weather file…</button>}
        {!weather && typicalWeather && <div style={{ marginTop: 8 }}><Banner kind="warn">The annual projection also needs the hourly weather of the logged period (card above).</Banner></div>}
      </Card>
      <Card title="Project">
        <div className="row">
          <span>Current: <b>{project.name}</b>{project.dirty ? ' •' : ''}</span>
          <button className="btn sm" onClick={newProject}>New Project</button>
          <button className="btn sm" onClick={openProjectDialog}>Open Project…</button>
          <button className="btn sm" onClick={saveCurrent}>Save Project</button>
          <button className="btn sm" onClick={saveAs}>Save As…</button>
          <button className="btn sm" onClick={exportBackup}>Export Backup…</button>
          <button className="btn sm" onClick={importBackup}>Import Backup…</button>
        </div>
        {recent.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="hint">Recent projects</div>
            {recent.map((r) => <div key={r.path}><button className="btn sm" style={{ marginTop: 4 }} onClick={() => openRecent(r)}>{r.name}</button> <span className="hint">{r.path}</span></div>)}
          </div>
        )}
      </Card>
    </>
  );
}
