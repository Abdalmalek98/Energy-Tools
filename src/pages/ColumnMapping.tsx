import { useStore } from '../app/store';
import { Banner, Card, NeedData, PageHead } from '../components/ui';
import type { ColumnMapping } from '../types';

const ROLES: { key: keyof ColumnMapping; label: string; hint: string; optional?: boolean }[] = [
  { key: 'timestamp', label: 'Timestamp', hint: 'Date/time of each reading' },
  { key: 'chillerId', label: 'Chiller ID', hint: 'Long format: one row per chiller per timestamp. Leave unmapped for a single-meter file.', optional: true },
  { key: 'power', label: 'Chiller power / energy', hint: 'kW demand, interval kWh or cumulative kWh (see Plant Settings)', optional: true },
  { key: 'load', label: 'Cooling load', hint: 'Only when the load is taken from a column', optional: true },
  { key: 'flow', label: 'CHW flow', hint: 'Chilled-water flow (unit in Plant Settings)', optional: true },
  { key: 'lchwt', label: 'LCHWT (leaving CHW)', hint: 'Chilled-water supply temperature', optional: true },
  { key: 'echwt', label: 'ECHWT (entering CHW)', hint: 'Chilled-water return temperature', optional: true },
  { key: 'ecwt', label: 'ECWT / OAT', hint: 'Entering condenser-water (or outdoor-air) temperature', optional: true },
  { key: 'aux', label: 'Auxiliary power', hint: 'Pumps, towers, … (max or sum per timestamp)', optional: true },
];

export function ColumnMappingPage() {
  const { table, mapping, setMapping, autoMapNow, settings, analysisError, parsed, setPage } = useStore();
  if (!table) return (<><PageHead title="Column Mapping" /><NeedData /></>);
  const sample = (idx?: number) => (idx === undefined || idx < 0 ? '' : table.rows.slice(0, 3).map((r) => r[idx]).join('  ·  '));
  const needLoadCol = settings.loadSource === 'column';
  return (
    <>
      <PageHead title="Column Mapping" subtitle="Columns were mapped automatically from their headers – adjust anything that is wrong.">
        <button className="btn" onClick={autoMapNow}>Re-run auto-map</button>
      </PageHead>
      {analysisError && <div style={{ marginBottom: 14 }}><Banner kind="error" title="Cannot analyse yet. "><pre>{analysisError}</pre></Banner></div>}
      {parsed && !analysisError && <div style={{ marginBottom: 14 }}><Banner kind="ok">Mapping is valid – {parsed.rows.length.toLocaleString('en-US')} rows, {parsed.interval} min interval, chillers: {parsed.chillers.join(', ')}.</Banner></div>}
      <Card>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Role</th><th>Column in file</th><th>Sample values</th></tr></thead>
            <tbody>
              {ROLES.map((r) => {
                const needed = r.key === 'timestamp' || (r.key === 'load' && needLoadCol) || (['flow', 'lchwt', 'echwt'].includes(r.key) && !needLoadCol) || r.key === 'power';
                return (
                  <tr key={r.key}>
                    <td><b>{r.label}</b>{needed && <span className="hint"> · required</span>}<div className="hint">{r.hint}</div></td>
                    <td>
                      <select aria-label={r.label} value={mapping[r.key] ?? -1} onChange={(e) => { const v = Number(e.target.value); setMapping({ ...mapping, [r.key]: v < 0 ? undefined : v }); }}>
                        <option value={-1}>— not mapped —</option>
                        {table.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                      </select>
                    </td>
                    <td className="mono" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }}>{sample(mapping[r.key])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" onClick={() => setPage('plant')}>Continue to Plant Settings</button>
          <button className="btn" onClick={() => setPage('analysis')} disabled={!!analysisError}>Go to Analysis</button>
        </div>
      </Card>
    </>
  );
}
