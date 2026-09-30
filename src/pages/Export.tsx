import { useStore } from '../app/store';
import { Banner, Card, PageHead } from '../components/ui';

export function ExportPage() {
  const { analysis, loggerAnalyses, exportExcel, exporting, exportBackup, importBackup, project, saveAs } = useStore();
  const hasBms = !!analysis;
  const hasLogger = loggerAnalyses.length > 0;
  const name = analysis ? `Chiller_Plant_Analysis_${analysis.firstDate}.xlsx` : hasLogger ? `Chiller_Power_Profile_${loggerAnalyses[0].entry.data.chiller}_….xlsx` : '—';
  return (
    <>
      <PageHead title="Export" subtitle="Excel workbook with native charts, live formulas and cached values – generated entirely on this computer." />
      <Card title="Excel workbook">
        {!hasBms && !hasLogger && <Banner kind="warn">Import BMS data or a Fluke logger file first.</Banner>}
        <p>File name: <b className="mono">{name}</b></p>
        <ul>
          <li><b>Summary</b> – KPIs as formulas over Plant Hourly (editable target and tariff), row-filter counts</li>
          <li><b>Charts</b> – native Excel charts (kW/TR vs PLR and ECWT, load and efficiency time series, load profile, chiller comparison)</li>
          <li><b>Findings</b>, <b>Chillers</b> (incl. IPLV), <b>Regression</b> (all models, coefficients, Guideline 14), <b>Load Profile</b></li>
          <li><b>Plant Hourly</b>, <b>Chiller Data</b>, <b>Chart Data</b>{hasLogger ? ', plus Logger Summary and Logger Data' : ''}</li>
        </ul>
        <button className="btn primary" disabled={(!hasBms && !hasLogger) || exporting} onClick={exportExcel}>{exporting ? 'Building workbook…' : 'Export to Excel…'}</button>
      </Card>
      <Card title="Project files (.cpa) and backups">
        <p>Projects contain the imported data, mappings, settings and the last results. Nothing is uploaded anywhere.</p>
        <div className="row">
          <button className="btn" onClick={saveAs}>Save project as…</button>
          <button className="btn" onClick={exportBackup}>Export backup…</button>
          <button className="btn" onClick={importBackup}>Import backup…</button>
        </div>
        <p className="hint">Current project: {project.name}</p>
      </Card>
    </>
  );
}
