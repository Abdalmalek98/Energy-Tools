import { useCallback, useEffect, useState } from "react";
import { images } from "./images";
import { emptyProject, type Project } from "./model";
import { ProjectProvider, useProject } from "./store";
import { Home } from "./screens/Home";
import { ActivationScreen } from "./screens/Activation";
import { ProjectView } from "./screens/ProjectView";
import { Review } from "./screens/Review";
import { ExportView } from "./screens/Export";
import { SettingsView } from "./screens/SettingsView";
import { isError, type LicStatus, type View } from "./types";

function Shell({ status }: { status: LicStatus }) {
  const { dispatch, project } = useProject();
  const [view, setView] = useState<View>("home");
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const newProject = () => { images.clear(); dispatch({ t: "load", p: emptyProject() }); setSavedPath(null); setView("project"); };
  const open = useCallback(async (path?: string) => {
    setErr("");
    const r = await window.api.project.open(path);
    if (!r) return;
    if (isError(r)) return setErr(`Couldn’t open the project: ${r.error}`);
    images.clear();
    for (const [id, buf] of Object.entries(r.images as Record<string, ArrayBuffer>)) images.set(id, new Blob([buf], { type: "image/jpeg" }));
    const p = r.project as Project;
    // pages that were mid-read when saved go back to "new"
    p.files = p.files.map((f) => ({ ...f, loading: false, pages: f.pages.map((pg) => (pg.status === "reading" || pg.status === "queued" ? { ...pg, status: "new" as const } : pg)) }));
    dispatch({ t: "load", p }); setSavedPath(r.path as string); setView("project");
  }, [dispatch]);

  const tabs: [View, string][] = [["home", "Home"], ["project", "Project"], ["review", "Review"], ["export", "Export"], ["settings", "Settings"]];
  const hasProject = project.files.length > 0 || view !== "home";
  return (
    <>
      <nav className="tabs" aria-label="Main">
        <span className="brand">Lighting Survey Reader</span>
        {tabs.map(([v, label]) => <button key={v} data-testid={`tab-${v}`} className={view === v ? "on" : ""} disabled={(v === "project" || v === "review" || v === "export") && !hasProject} onClick={() => setView(v)}>{label}</button>)}
        
      </nav>
      {status.personal && <p className="warnbanner" role="status" data-testid="personal-banner">PERSONAL BUILD: no licence, uses your own Gemini or Groq key. Not for customers. <button className="link" onClick={() => setView("settings")}>API key</button></p>}
      {status.evaluation.warning && <p className="warnbanner" role="status" data-testid="warning-banner">{status.evaluation.warning} <button className="link" onClick={() => setView("settings")}>License details</button></p>}
      {err && <p className="error banner" role="alert" data-testid="app-error">{err}</p>}
      {view === "home" && <Home status={status} onNew={newProject} onOpen={(p) => void open(p)} />}
      {view === "project" && <ProjectView onReview={() => setView("review")} />}
      {view === "review" && <Review />}
      {view === "export" && <ExportView savedPath={savedPath} onSaved={setSavedPath} />}
      {view === "settings" && <SettingsView status={status} />}
    </>
  );
}

export default function App() {
  const [status, setStatus] = useState<LicStatus | null>(null);
  useEffect(() => {
    void window.api.license.status().then(setStatus);
    return window.api.license.onStatus((s) => setStatus(s as LicStatus));
  }, []);
  if (!status) return <main className="lock"><p>Loading…</p></main>;
  if (!status.evaluation.usable) return <ActivationScreen status={status} />;   // client-side gate = UX only; the server enforces every page read
  return <ProjectProvider initial={emptyProject()}>{() => <Shell status={status} />}</ProjectProvider>;
}
