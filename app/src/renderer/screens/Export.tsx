import { useState } from "react";
import { images } from "../images";
import { useProject } from "../store";
import { baseName, isError } from "../types";

export function ExportView({ savedPath, onSaved }: { savedPath: string | null; onSaved: (p: string) => void }) {
  const { project, resolved, totals } = useProject();
  const [msg, setMsg] = useState<{ ok: boolean; text: string; path?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const name = project.files.length === 1 ? project.files[0].building : project.name;

  const run = async (mode: "new" | "append") => {
    setBusy(true); setMsg(null);
    const r = await window.api.export.run({ mode, rows: resolved, name });
    setBusy(false);
    if (!r) return;
    if (isError(r)) return setMsg({ ok: false, text: r.error.startsWith("Couldn") ? r.error : `Couldn’t export: ${r.error}` });
    setMsg({ ok: true, path: r.path, text: mode === "append" ? `Added ${resolved.length} rows after row ${r.appendedAfter} → ${baseName(r.path)}` : `Saved ${resolved.length} rows → ${baseName(r.path)}` });
  };
  const save = async (asNew: boolean) => {
    setBusy(true);
    const imgs: Record<string, ArrayBuffer> = {};
    for (const f of project.files) for (const p of f.pages) { const b = images.get(p.id); if (b) imgs[p.id] = await b.arrayBuffer(); }
    const p = await window.api.project.save(project, imgs, asNew ? undefined : savedPath ?? undefined);
    setBusy(false); if (isError(p)) return setMsg({ ok: false, text: `Couldn’t save the project: ${p.error}` }); if (p) { onSaved(p); setMsg({ ok: true, path: p, text: `Project saved → ${baseName(p)}` }); }
  };
  return (
    <div className="page">
      <h1>Export</h1>
      <p className="muted">{totals.rows} rows · {totals.flaggedCells} cells highlighted for checking · {totals.fixtures} fixtures · {totals.kw} kW</p>
      <div className="row">
        <div className="card grow"><h2>New workbook</h2><p className="muted small">Your template layout with all rows, a Summary sheet and a Review Flags sheet.</p><button className="primary" data-testid="export-new" disabled={busy || !resolved.length} onClick={() => void run("new")}>Export to Excel…</button></div>
        <div className="card grow"><h2>Add to an existing workbook</h2><p className="muted small">Appends under the last filled row of your master workbook. Saved as “… (updated).xlsx”; the original is not changed.</p><button data-testid="export-append" disabled={busy || !resolved.length} onClick={() => void run("append")}>Choose workbook…</button></div>
        <div className="card grow"><h2>Save project</h2><p className="muted small">Pause and resume later (pages, readings and your edits).</p>
          <div className="row"><button data-testid="save-project" disabled={busy} onClick={() => void save(false)}>{savedPath ? "Save" : "Save…"}</button>{savedPath && <button onClick={() => void save(true)}>Save as…</button>}</div></div>
      </div>
      {msg && <p role="status" data-testid="export-msg" className={msg.ok ? "ok" : "error"}>{msg.text} {msg.path && <button className="link" onClick={() => void window.api.reveal(msg.path!)}>Show in folder</button>}</p>}
    </div>
  );
}
