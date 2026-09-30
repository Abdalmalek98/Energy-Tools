import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import { DATA_KEYS, norm, resolveProject, totals, type DataKey, type RawRow, type ResolvedRow, type SpaceRule } from "@lsr/shared";
import { nid, toFileInputs, type FileState, type PageState, type Project, type Rotation } from "./model";

export type Action =
  | { t: "load"; p: Project }
  | { t: "meta"; patch: Partial<Pick<Project, "name" | "hint" | "quality" | "dateFormat">> }
  | { t: "addFile"; file: FileState }
  | { t: "patchFile"; id: string; patch: Partial<FileState> }
  | { t: "addPage"; fileId: string; page: PageState }
  | { t: "removeFile"; id: string }
  | { t: "rotate"; pageId: string; rotation: Rotation }
  | { t: "page"; pageId: string; patch: Partial<PageState> }
  | { t: "edit"; pageId: string; rowId: string; key: DataKey; value: string }
  | { t: "header"; pageId: string; key: "date" | "collected_by" | "floor" | "section"; value: string }
  | { t: "addRow"; pageId: string }
  | { t: "delRow"; pageId: string; rowId: string };

const mapPage = (p: Project, id: string, fn: (pg: PageState) => PageState): Project => ({ ...p, files: p.files.map((f) => ({ ...f, pages: f.pages.map((pg) => (pg.id === id ? fn(pg) : pg)) })) });

export function reducer(p: Project, a: Action): Project {
  switch (a.t) {
    case "load": return a.p;
    case "meta": return { ...p, ...a.patch };
    case "addFile": return { ...p, files: [...p.files, a.file] };
    case "patchFile": return { ...p, files: p.files.map((f) => (f.id === a.id ? { ...f, ...a.patch } : f)) };
    case "addPage": return { ...p, files: p.files.map((f) => (f.id === a.fileId ? { ...f, pages: [...f.pages, a.page] } : f)) };
    case "removeFile": return { ...p, files: p.files.filter((f) => f.id !== a.id) };
    case "rotate": return mapPage(p, a.pageId, (pg) => ({ ...pg, rotation: a.rotation }));
    case "page": return mapPage(p, a.pageId, (pg) => ({ ...pg, ...a.patch }));
    case "edit": return mapPage(p, a.pageId, (pg) => ({
      ...pg, rows: pg.rows.map((r) => {
        if (r.id !== a.rowId) return r;
        const v = norm(a.key, a.value);
        return { ...r, v: { ...r.v, [a.key]: v }, uncertain: r.uncertain.filter((k) => k !== a.key), manual: { ...r.manual, [a.key]: true } };
      }),
    }));
    case "header": return mapPage(p, a.pageId, (pg) => ({ ...pg, header: { ...pg.header, [a.key]: a.value.trim() || null } }));
    case "addRow": return mapPage(p, a.pageId, (pg) => {
      const v = Object.fromEntries(DATA_KEYS.map((k) => [k, "^"])) as RawRow["v"];
      Object.assign(v, { room_name: null, room_tag: null, fixture_qty: null, dimensions: null, remarks: null });
      return { ...pg, rows: [...pg.rows, { id: nid("r"), row: pg.rows.length + 1, uncertain: [], note: null, v }] };
    });
    case "delRow": return mapPage(p, a.pageId, (pg) => ({ ...pg, rows: pg.rows.filter((r) => r.id !== a.rowId) }));
  }
}

interface Ctx { project: Project; dispatch: Dispatch<Action>; resolved: ResolvedRow[]; totals: ReturnType<typeof totals>; spaceRules: SpaceRule[] | undefined; setSpaceRules: (r: SpaceRule[] | undefined) => void }
const C = createContext<Ctx>(null as unknown as Ctx);
export const useProject = () => useContext(C);

import { useState } from "react";
export function ProjectProvider({ initial, children }: { initial: Project; children: (ctx: Ctx) => ReactNode }) {
  const [project, dispatch] = useReducer(reducer, initial);
  const [spaceRules, setSpaceRules] = useState<SpaceRule[] | undefined>(undefined);
  const resolved = useMemo(() => resolveProject(toFileInputs(project.files), { dateFormat: project.dateFormat, spaceRules }), [project.files, project.dateFormat, spaceRules]);
  const t = useMemo(() => totals(resolved), [resolved]);
  const ctx = { project, dispatch, resolved, totals: t, spaceRules, setSpaceRules };
  return <C.Provider value={ctx}>{children(ctx)}</C.Provider>;
}
