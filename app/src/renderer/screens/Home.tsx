import { useEffect, useState } from "react";
import { baseName, fmtDay, isError, type LicStatus } from "../types";

export function Home({ status, onNew, onOpen }: { status: LicStatus; onNew: () => void; onOpen: (path?: string) => void }) {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => { void window.api.project.recent().then((r: string[] | { error: string }) => { if (!isError(r)) setRecent(r); }); }, []);
  const info = status.evaluation.info;
  return (
    <div className="page">
      <h1>Lighting Survey Reader</h1>
      <div className="row">
        <div className="card grow" data-testid="licence-card">
          <h2>Licence</h2>
          {info && <>
            <p><b dir="auto">{info.customer}</b>{info.company ? <span dir="auto"> · {info.company}</span> : null}</p>
            <p>{info.daysRemaining == null ? "No end date" : `${info.daysRemaining} day${info.daysRemaining === 1 ? "" : "s"} left`} · expires {fmtDay(info.expiresAt)}</p>
            <p className="muted small">{info.offline ? "Offline licence" : "Online licence"} · ID {info.licenseId}</p>
          </>}
        </div>
        <div className="card grow">
          <h2>Start</h2>
          <div className="row"><button className="primary" data-testid="new-project" onClick={onNew}>New project</button><button data-testid="open-project" onClick={() => onOpen()}>Open project…</button></div>
        </div>
      </div>
      <h2>Recent projects</h2>
      {recent.length === 0 ? <p className="muted">Nothing yet. Start a new project and add your scanned PDFs or photos.</p> :
        <ul className="recent">{recent.map((p) => <li key={p}><button className="link" onClick={() => onOpen(p)} title={p} dir="auto">{baseName(p)}</button></li>)}</ul>}
    </div>
  );
}
