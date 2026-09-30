import { useEffect, useState } from "react";
import { baseName, daysLeft, type LicStatus } from "../types";

export function Home({ status, onNew, onOpen }: { status: LicStatus; onNew: () => void; onOpen: (path?: string) => void }) {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => { void window.api.project.recent().then(setRecent); }, []);
  const s = status.state; const info = s.kind === "active" ? s.info : null;
  const d = info ? daysLeft(info.endsAt, status.now) : null;
  return (
    <div className="page">
      <h1>Lighting Survey Reader</h1>
      <div className="row">
        <div className="card grow" data-testid="licence-card">
          <h2>Licence</h2>
          {info && <>
            <p><b>{info.customer}</b></p>
            <p>{d == null ? "No end date" : `${d} day${d === 1 ? "" : "s"} left`}{s.kind === "active" && s.offline ? " · offline" : ""}</p>
            <p>{info.quotaMonth == null ? "Unlimited pages" : `${info.quotaLeft ?? 0} of ${info.quotaMonth} pages left this month`}</p>
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
