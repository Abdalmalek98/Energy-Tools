import { cleanPage, type ModelPage } from "@lsr/shared";
import { modelImages } from "./imaging";
import { images } from "./images";
import type { Action } from "./store";
import type { Project } from "./model";

const CONCURRENCY = 2;
let stopFlag = false;
export const stopReading = () => { stopFlag = true; };

export interface ReadDeps { dispatch: (a: Action) => void; getProject: () => Project }

/** Reads pages 2 at a time. Locked/expired stops the queue; quota stops it; other errors are per-page (retry button). */
export async function readPages(pageIds: string[], deps: ReadDeps, onProgress: (done: number, total: number) => void) {
  stopFlag = false;
  const queue = [...pageIds]; let finished = 0; let fatal = false;
  pageIds.forEach((id) => deps.dispatch({ t: "page", pageId: id, patch: { status: "queued", error: undefined } }));
  const one = async (id: string) => {
    const page = deps.getProject().files.flatMap((f) => f.pages).find((p) => p.id === id);
    const blob = images.get(id);
    if (!page || !blob) return;
    deps.dispatch({ t: "page", pageId: id, patch: { status: "reading" } });
    try {
      const imgs = await modelImages(blob, page.rotation);
      const proj = deps.getProject();
      const r = await window.api.read.page(imgs, proj.quality, proj.hint || undefined);
      if (r.ok) {
        const cp = cleanPage(id, r.page as ModelPage);
        deps.dispatch({ t: "page", pageId: id, patch: { status: "done", error: undefined, header: cp.header, section_changes: cp.section_changes, copy_notes: cp.copy_notes, rows: cp.rows } });
      } else {
        deps.dispatch({ t: "page", pageId: id, patch: { status: "error", error: r.message } });
        if (["locked", "expired", "device_revoked", "invalid", "quota"].includes(r.error)) fatal = true;
      }
    } catch (e) {
      deps.dispatch({ t: "page", pageId: id, patch: { status: "error", error: `Couldn’t prepare or read this page (${(e as Error).message}).` } });
    }
  };
  const worker = async () => {
    while (queue.length && !stopFlag && !fatal) { await one(queue.shift()!); onProgress(++finished, pageIds.length); }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // anything not started goes back to "new"
  for (const id of queue) deps.dispatch({ t: "page", pageId: id, patch: { status: "new" } });
  return { stopped: stopFlag, fatal };
}
