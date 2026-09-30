import { useEffect, useState } from 'react';
import { useStore, type PageId } from './store';
import { NAV } from '../components/ui';
import { Banner } from '../components/ui';
import { DashboardPage } from '../pages/Dashboard';
import { DataImportPage } from '../pages/DataImport';
import { ColumnMappingPage } from '../pages/ColumnMapping';
import { PlantSettingsPage } from '../pages/PlantSettings';
import { LoggerImportPage } from '../pages/LoggerImport';
import { AnalysisPage } from '../pages/Analysis';
import { RegressionPage } from '../pages/Regression';
import { PerformancePage } from '../pages/Performance';
import { ChillersPage } from '../pages/Chillers';
import { FindingsPage } from '../pages/Findings';
import { ExportPage } from '../pages/Export';
import { SettingsPage } from '../pages/Settings';
import { LicensePage, ActivationScreen } from '../pages/License';
import { AboutPage } from '../pages/About';
import { PRODUCT_NAME } from '../settings/defaults';

const PAGES: Record<PageId, () => JSX.Element | null> = {
  dashboard: DashboardPage, import: DataImportPage, mapping: ColumnMappingPage, plant: PlantSettingsPage, logger: LoggerImportPage,
  analysis: AnalysisPage, regression: RegressionPage, performance: PerformancePage, chillers: ChillersPage, findings: FindingsPage,
  export: ExportPage, settings: SettingsPage, license: LicensePage, about: AboutPage,
};

export function App() {
  const { license, page, setPage, project, saveCurrent, newProject, openProjectDialog, toasts, analysisError } = useStore();
  const [entered, setEntered] = useState(false);

  // Ctrl+S / Ctrl+O / Ctrl+N
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 's') { e.preventDefault(); void saveCurrent(); }
      if (e.key === 'o') { e.preventDefault(); void openProjectDialog(); }
      if (e.key === 'n') { e.preventDefault(); newProject(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [saveCurrent, openProjectDialog, newProject]);

  // Startup sequence: local storage → verify license → show Dashboard (or the activation screen).
  if (!license) return <div className="splash"><div>Starting {PRODUCT_NAME}…</div></div>;
  if (!license.allowed || (!entered && license.state === 'unlicensed')) return <ActivationScreen onDone={() => { setEntered(true); setPage('dashboard'); }} />;

  const Page = PAGES[page];
  const groups = [0, 1, 2, 3];
  return (
    <div className="shell">
      <header className="topbar">
        <span className="title">{PRODUCT_NAME}</span>
        <span className="proj">{project.name}{project.dirty ? ' •' : ''}</span>
        <span className="spacer" />
        <button className="btn sm" onClick={newProject}>New</button>
        <button className="btn sm" onClick={openProjectDialog}>Open</button>
        <button className="btn sm" onClick={saveCurrent}>Save</button>
      </header>
      <nav className="side" aria-label="Sections">
        {groups.map((g) => (
          <div key={g}>
            {g > 0 && <div className="nav-sep" />}
            {NAV.filter((n) => n.group === g).map((n) => (
              <button key={n.id} className="nav-item" aria-current={page === n.id ? 'page' : undefined} onClick={() => setPage(n.id)}>
                <span className="ico" aria-hidden>{n.icon}</span>{n.label}
                {n.id === 'mapping' && analysisError && <span className="dot" title="Mapping needs attention" />}
                {n.id === 'license' && license.state === 'warning' && <span className="dot" title="Validation overdue" />}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <main className="main">
        {license.state === 'warning' && <div style={{ marginBottom: 14 }}><Banner kind="warn" title="License validation overdue. ">{license.message} <button className="btn sm" onClick={() => setPage('license')}>Open License</button></Banner></div>}
        {license.daysRemaining !== null && license.daysRemaining <= 14 && !license.perpetual && <div style={{ marginBottom: 14 }}><Banner kind="warn">Your license expires in {license.daysRemaining} day(s).</Banner></div>}
        <Page />
      </main>
      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}</div>
    </div>
  );
}
