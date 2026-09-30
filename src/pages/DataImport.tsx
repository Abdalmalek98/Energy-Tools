import { useState, type DragEvent } from 'react';
import { useStore } from '../app/store';
import { Banner, Card, PageHead, Table } from '../components/ui';
import { fmt0 } from '../utils/format';

const DELIM: Record<string, string> = { ',': 'comma', ';': 'semicolon', '\t': 'tab' };

export function DataImportPage() {
  const { table, bmsFileName, importBms, importBmsFile, clearBms, parsed, analysisError, setPage, project, newProject, openProjectDialog, saveCurrent, saveAs, exportBackup, importBackup, recent, openRecent } = useStore();
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
