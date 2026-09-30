import { useEffect, useMemo, useRef, useState } from "react";
import { FIELDS, labelOf, type DataKey, type ResolvedRow } from "@lsr/shared";
import { images } from "../images";
import { viewBlob } from "../imaging";
import { useProject } from "../store";

/** Scan viewer: wheel zoom, drag to pan, fit button. */
function ScanView({ pageId, rotation }: { pageId: string; rotation: 0 | 90 | 180 | 270 }) {
  const [url, setUrl] = useState<string>();
  const [z, setZ] = useState(1); const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    let dead = false; let u = "";
    const b = images.get(pageId);
    if (b) void viewBlob(b, rotation).then((v) => { if (!dead) { u = URL.createObjectURL(v); setUrl(u); } });
    setZ(1); setPos({ x: 0, y: 0 });
    return () => { dead = true; if (u) URL.revokeObjectURL(u); };
  }, [pageId, rotation]);
  return (
    <div className="scan" data-testid="scan"
      onWheel={(e) => setZ((v) => Math.min(6, Math.max(0.5, v * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))}
      onPointerDown={(e) => { drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
      onPointerMove={(e) => drag.current && setPos({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y })}
      onPointerUp={() => { drag.current = null; }}>
      <div className="scanctl"><button onClick={() => setZ((v) => v * 1.25)} aria-label="Zoom in">+</button><button onClick={() => setZ((v) => v / 1.25)} aria-label="Zoom out">−</button><button onClick={() => { setZ(1); setPos({ x: 0, y: 0 }); }}>Fit</button></div>
      {url && <img src={url} alt="Scanned page" draggable={false} style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${z})` }} />}
    </div>
  );
}

export function Review() {
  const { project, dispatch, resolved, totals } = useProject();
  const pages = useMemo(() => project.files.flatMap((f) => f.pages.map((p, i) => ({ f, p, i }))).filter((x) => x.p.status === "done"), [project.files]);
  const [idx, setIdx] = useState(0);
  const [flagOnly, setFlagOnly] = useState(false);
  const [focus, setFocus] = useState<{ key: string } | null>(null);
  const cur = pages[Math.min(idx, Math.max(0, pages.length - 1))];
  const rows = useMemo(() => resolved.filter((r) => cur && r.pageId === cur.p.id), [resolved, cur]);
  const gridRef = useRef<HTMLDivElement>(null);

  const flags = useMemo(() => resolved.flatMap((r) => Object.entries(r.flags).filter(([k]) => k !== "dimensions").map(([k, m]) => ({ r, k, m }))), [resolved]);
  const pageIndexOf = (pid: string) => pages.findIndex((x) => x.p.id === pid);
  const cellKey = (r: ResolvedRow, k: string) => `${r.pageId}:${r.rawId ?? "x" + r.sheetRow}:${k}`;

  useEffect(() => { // jump to a flag: focus + scroll the cell
    if (!focus) return;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${CSS.escape(focus.key)}"]`);
    if (el) { el.focus(); el.scrollIntoView({ block: "center", inline: "center" }); setFocus(null); }
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.altKey && e.key === "ArrowRight") setIdx((i) => Math.min(pages.length - 1, i + 1)); if (e.altKey && e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1)); };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [pages.length]);

  if (!cur) return <div className="page"><h1>Review</h1><p className="muted">No pages have been read yet. Go to the Project screen and press “Read pages”.</p></div>;

  const move = (e: React.KeyboardEvent<HTMLInputElement>, ri: number, k: string) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
    e.preventDefault();
    const cells = Array.from(gridRef.current!.querySelectorAll<HTMLElement>(`[data-col="${k}"]`));
    const at = cells.indexOf(e.currentTarget); const next = cells[at + (e.key === "ArrowUp" ? -1 : 1)];
    next?.focus(); (next as HTMLInputElement | undefined)?.select?.(); void ri;
  };
  const shown = rows.filter((r) => !flagOnly || Object.keys(r.flags).some((k) => k !== "dimensions"));
  const h = cur.p.header;
  const header = (key: "date" | "collected_by" | "floor" | "section", label: string, placeholder: string) =>
    <label className="field">{label}<input dir="auto" data-testid={`hdr-${key}`} value={h[key] ?? ""} placeholder={placeholder} onChange={(e) => dispatch({ t: "header", pageId: cur.p.id, key, value: e.target.value })} /></label>;

  return (
    <div className="review" data-testid="review">
      <div className="row bar">
        <button onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0} aria-label="Previous page">←</button>
        <b data-testid="page-title" dir="auto">{cur.f.building} · page {cur.i + 1} of {cur.f.pages.length}</b>
        <button onClick={() => setIdx(Math.min(pages.length - 1, idx + 1))} disabled={idx >= pages.length - 1} aria-label="Next page">→</button>
        {header("date", "Date on sheet", rows[0]?.dateTxt ?? "same as before")}{header("collected_by", "Collected by", rows[0]?.collected ?? "same as before")}
        {header("floor", "Floor", "—")}{header("section", "Section (added to building name)", "none")}
        <label className="check"><input type="checkbox" data-testid="flag-only" checked={flagOnly} onChange={(e) => setFlagOnly(e.target.checked)} /> Rows with flags only</label>
      </div>
      <div className="split">
        <ScanView pageId={cur.p.id} rotation={cur.p.rotation} />
        <div className="gridcol">
          <div className="gridwrap" ref={gridRef}>
            <table className="grid" data-testid="grid">
              <thead><tr><th>#</th>{FIELDS.map(([k, l]) => <th key={k}>{l}</th>)}<th>Lamps</th><th>Area m²</th><th /></tr></thead>
              <tbody>
                {shown.map((r, ri) => {
                  const editable = r.rawId != null;
                  const q = r.v.fixture_qty, l = r.v.lamps_per_fixture;
                  return (
                    <tr key={r.rawId ?? `x${ri}`} className={r.expanded ? "expanded" : ""} data-testid="grid-row">
                      <td className="rn">{r.sheetRow ?? "＋"}</td>
                      {FIELDS.map(([k]) => {
                        const cls = [r.dit[k] ? "ditto" : "", r.carried[k] ? "carried" : "", r.flags[k] ? "flag" : ""].join(" ").trim();
                        const tip = r.flags[k] ?? (r.carried[k] ? "Blank on sheet, copied from above" : r.dit[k] ? "From a ditto mark" : "");
                        return (
                          <td key={k} className={cls} title={tip}>
                            <input dir="auto" data-cell={cellKey(r, k)} data-col={k} data-testid={`cell-${k}`} readOnly={!editable} aria-label={labelOf(k)}
                              defaultValue={String(r.v[k] ?? "")} key={String(r.v[k] ?? "") + (editable ? "" : "ro")} className={`w-${k}`}
                              onBlur={(e) => { if (editable && e.target.value !== String(r.v[k] ?? "")) dispatch({ t: "edit", pageId: r.pageId, rowId: r.rawId!, key: k as DataKey, value: e.target.value }); }}
                              onKeyDown={(e) => { if (e.key === "Enter" && editable) (e.target as HTMLInputElement).blur(); move(e, ri, k); }} />
                          </td>
                        );
                      })}
                      <td className="calc">{typeof q === "number" && typeof l === "number" ? q * l : ""}</td>
                      <td className={`calc ${r.flags.__area ? "flag" : ""}`} title={r.flags.__area}>{r.area ?? ""}</td>
                      <td>{editable && <button aria-label="Delete row" onClick={() => dispatch({ t: "delRow", pageId: r.pageId, rowId: r.rawId! })}>×</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button onClick={() => dispatch({ t: "addRow", pageId: cur.p.id })}>+ Add row</button>
          </div>
          <details className="flaglist" open={flags.length > 0 && flags.length < 60}>
            <summary data-testid="flag-count">{flags.length} cell{flags.length === 1 ? "" : "s"} to check</summary>
            <ol>{flags.map(({ r, k, m }, i) => (
              <li key={i}><button className="link" onClick={() => { const at = pageIndexOf(r.pageId); if (at >= 0) setIdx(at); setFlagOnly(false); setFocus({ key: cellKey(r, k === "__area" ? "dimensions" : k === "__date" ? "room_name" : k) }); }}>
                <b>{cur && pages[pageIndexOf(r.pageId)]?.f.building}</b> p{r.pageNo} row {r.sheetRow ?? "＋"} · {k === "__area" ? "Area" : k === "__date" ? "Date" : labelOf(k)}
              </button> — <span className="muted">{m}</span></li>))}
            </ol>
          </details>
        </div>
      </div>
      <div className="totals" data-testid="totals"><span>Rows <b>{totals.rows}</b></span><span>Cells to check <b>{totals.flaggedCells}</b></span><span>Fixtures <b>{totals.fixtures}</b></span><span>Connected load <b>{totals.kw} kW</b></span></div>
    </div>
  );
}
