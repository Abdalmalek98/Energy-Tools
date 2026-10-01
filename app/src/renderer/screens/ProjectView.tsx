import { useCallback, useEffect, useRef, useState } from "react";
import { autoRotation, imageToPage, renderPdf, thumbUrl } from "../imaging";
import { images } from "../images";
import { cleanName, nid, type FileState, type PageState, type Rotation } from "../model";
import { readPages, stopReading } from "../reader";
import { useProject } from "../store";
import { isError } from "../types";

const blankPage = (n: number, rotation: Rotation): PageState => ({ id: nid("p"), n, rotation, status: "new", header: {}, section_changes: [], copy_notes: [], rows: [] });

function Thumb({ page, index, onRotate, onRetry }: { page: PageState; index: number; onRotate: (r: Rotation) => void; onRetry: () => void }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { const b = images.get(page.id); if (b) void thumbUrl(b, page.rotation).then(setUrl); }, [page.id, page.rotation]);
  const label = { new: "not read", queued: "waiting", reading: "reading…", done: `✓ ${page.rows.length} rows`, error: "failed" }[page.status];
  return (
    <figure className={`thumb ${page.status}`} data-testid={`page-${page.status}`}>
      <div className="thumbimg">{url ? <img src={url} alt={`Page ${index + 1}`} /> : <span className="muted">…</span>}</div>
      <figcaption>
        <span>Page {index + 1} · {label}</span>
        <span className="row tight">
          <button title="Rotate left" aria-label="Rotate left" onClick={() => onRotate(((page.rotation + 270) % 360) as Rotation)}>↺</button>
          <button title="Rotate right" aria-label="Rotate right" onClick={() => onRotate(((page.rotation + 90) % 360) as Rotation)}>↻</button>
        </span>
        {page.status === "error" && <span className="error small" role="alert">{page.error} <button onClick={onRetry}>Try again</button></span>}
      </figcaption>
    </figure>
  );
}

export function ProjectView({ onReview }: { onReview: () => void }) {
  const { project, dispatch, totals } = useProject();
  const ref = useRef(project); ref.current = project;
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState("");
  const [drag, setDrag] = useState(false);

  const addBytes = useCallback(async (name: string, data: ArrayBuffer, type: string) => {
    const file: FileState = { id: nid("f"), name, building: cleanName(name), pages: [], loading: true };
    dispatch({ t: "addFile", file });
    try {
      if (/pdf/i.test(type) || /\.pdf$/i.test(name)) {
        let n = 0;
        for await (const blob of renderPdf(data)) { const pg = blankPage(++n, await autoRotation(blob)); images.set(pg.id, blob); dispatch({ t: "addPage", fileId: file.id, page: pg }); }
      } else {
        const blob = await imageToPage(data, type || "image/jpeg"); const pg = blankPage(1, await autoRotation(blob)); images.set(pg.id, blob); dispatch({ t: "addPage", fileId: file.id, page: pg });
      }
    } catch (e) { setNote(`Couldn’t open “${name}”: ${(e as Error).message}`); dispatch({ t: "removeFile", id: file.id }); return; }
    dispatch({ t: "patchFile", id: file.id, patch: { loading: false } });
  }, [dispatch]);

  const pick = async () => {
    const r = await window.api.files.pick();
    if (isError(r)) return setNote(`Couldn’t open the selected files: ${r.error}`);
    for (const f of r) await addBytes(f.name, f.data, "");
  };
  const drop = async (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    for (const f of Array.from(e.dataTransfer.files)) if (/\.(pdf|jpe?g|png)$/i.test(f.name)) await addBytes(f.name, await f.arrayBuffer(), f.type);
  };

  const pending = project.files.flatMap((f) => f.pages).filter((p) => p.status === "new" || p.status === "error");
  const allPages = project.files.flatMap((f) => f.pages);
  const doRead = async (ids: string[]) => {
    setNote(""); setProgress({ done: 0, total: ids.length });
    const r = await readPages(ids, { dispatch, getProject: () => ref.current }, (done, total) => setProgress({ done, total }));
    setProgress(null); if (r.stopped) setNote("Stopped."); else if (r.fatal) setNote("Reading stopped because of a licence or quota problem. See the message on the failed page.");
  };
  const anyDone = allPages.some((p) => p.status === "done");
  const opening = project.files.some((f) => f.loading);          // don't start reading while a PDF is still being opened

  return (
    <div className="page">
      <div className="row bar">
        <label className="field grow">Project name<input dir="auto" value={project.name} onChange={(e) => dispatch({ t: "meta", patch: { name: e.target.value } })} /></label>
        <label className="field">Accuracy<select data-testid="quality" value={project.quality} onChange={(e) => dispatch({ t: "meta", patch: { quality: e.target.value as "best" | "fast" } })}><option value="best">Best accuracy</option><option value="fast">Faster</option></select></label>
        <label className="field">Dates on sheets<select value={project.dateFormat} onChange={(e) => dispatch({ t: "meta", patch: { dateFormat: e.target.value as "DMY" | "MDY" } })}><option value="DMY">Day-Month-Year</option><option value="MDY">Month-Day-Year</option></select></label>
        <label className="field grow">Notes for the reader (optional)<input dir="auto" maxLength={500} placeholder="e.g. Primary school, Arabic room names" value={project.hint} onChange={(e) => dispatch({ t: "meta", patch: { hint: e.target.value } })} /></label>
      </div>

      <div className={`drop ${drag ? "over" : ""}`} data-testid="dropzone" onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => void drop(e)}>
        <p>Drop PDFs or photos here</p><button data-testid="add-files" onClick={() => void pick()}>Add files…</button>
      </div>

      {project.files.map((f) => (
        <section className="card file" key={f.id} data-testid="file-card">
          <div className="row">
            <label className="field grow">Building name<input dir="auto" data-testid="building" value={f.building} onChange={(e) => dispatch({ t: "patchFile", id: f.id, patch: { building: e.target.value } })} /></label>
            <span className="muted small"><bdi>{f.name}</bdi>{f.loading ? " · opening…" : ` · ${f.pages.length} page${f.pages.length === 1 ? "" : "s"}`}</span>
            <button className="danger" onClick={() => { f.pages.forEach((p) => images.delete(p.id)); dispatch({ t: "removeFile", id: f.id }); }}>Remove</button>
          </div>
          <div className="thumbs">{f.pages.map((p, i) => <Thumb key={p.id} page={p} index={i} onRotate={(r) => dispatch({ t: "rotate", pageId: p.id, rotation: r })} onRetry={() => void doRead([p.id])} />)}</div>
        </section>
      ))}

      <div className="row bar">
        <button className="primary" data-testid="read-pages" disabled={!pending.length || !!progress || opening} onClick={() => void doRead(pending.map((p) => p.id))}>{pending.length ? `Read ${pending.length} page${pending.length === 1 ? "" : "s"}` : "Read pages"}</button>
        {progress && <><progress value={progress.done} max={progress.total} data-testid="progress" /><span>{progress.done} / {progress.total}</span><button onClick={stopReading}>Stop</button></>}
        <span className="grow" />
        {anyDone && <button data-testid="go-review" onClick={onReview}>Review results →</button>}
      </div>
      {note && <p className={/Couldn|failed|stopped/i.test(note) ? "error" : "muted"} role="status" data-testid="project-note">{note}</p>}
      <p className="muted small">Rows {totals.rows} · Cells to check {totals.flaggedCells} · Fixtures {totals.fixtures} · {totals.kw} kW</p>
    </div>
  );
}
