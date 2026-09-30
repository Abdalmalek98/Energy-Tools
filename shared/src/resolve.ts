import { CONSTANT_KEYS, DATA_KEYS, type DataKey } from "./fields";
import { areaOf, norm, normRow, parseDate, type Cell, type DateFormat } from "./normalize";
import { ENUMS, SPACE_TYPES } from "./vocab";
import { mapSpaceType, DEFAULT_SPACE_RULES, type SpaceRule } from "./spaceType";
import type { ModelPage, ModelRow } from "./schema";

/** A row after norm(): every data key present, "^" still unresolved. */
export interface RawRow {
  id: string;
  row: number | null;                     // printed row number on the sheet
  uncertain: string[];
  note: string | null;
  manual?: Partial<Record<DataKey, true>>; // user edited this cell in review; don't overwrite
  v: Record<DataKey, Cell>;
}
export interface PageInput {
  id: string;
  header: { building_name?: string | null; section?: string | null; floor?: string | null; collected_by?: string | null; date?: string | null; page_label?: string | null };
  section_changes: { from_row: number; section: string }[];
  copy_notes: NonNullable<ModelPage["copy_notes"]>;
  rows: RawRow[];
  done: boolean;
}
export interface FileInput { id: string; name: string; building: string; pages: PageInput[] }

export interface ResolvedRow {
  fileId: string; pageId: string; pageNo: number; sheetRow: number | null; rawId: string | null;
  v: Record<DataKey, Cell>;
  dit: Partial<Record<DataKey, true>>;      // came from a ditto mark
  carried: Partial<Record<DataKey, true>>;  // blank on sheet, copied from above (light blue)
  estimated: Partial<Record<DataKey, true>>; // unreadable on the sheet; value is a best guess (yellow)
  flags: Record<string, string>;            // key → message; also __area, __date
  area: number | null; date: Date | null; dateTxt: string | null;
  collected: string | null; section: string | null; building: string; expanded?: boolean;
}
export interface ResolveOptions { dateFormat?: DateFormat; spaceRules?: SpaceRule[] }

const up = (s: string | null | undefined) => (s ? s.trim().toUpperCase() : null);
const blank = (x: Cell | undefined) => x == null || x === "";

/** ModelRow (JSON from the service) → RawRow with normalisers applied. */
export function cleanRow(r: ModelRow, id: string): RawRow {
  const v = {} as Record<DataKey, Cell>;
  const src = r as unknown as Record<string, unknown>;
  for (const k of DATA_KEYS) v[k] = norm(k, src[k]);
  normRow(v);
  return { id, row: r.row ?? null, uncertain: (r.uncertain ?? []).filter((k) => (DATA_KEYS as string[]).includes(k)), note: r.note ?? null, v };
}
export function cleanPage(id: string, m: ModelPage): Omit<PageInput, "done"> {
  return {
    id,
    header: m.header ?? {},
    section_changes: m.section_changes ?? [],
    copy_notes: m.copy_notes ?? [],
    rows: m.rows.map((r, i) => cleanRow(r, `${id}:${i}`)),
  };
}

/**
 * Deterministic post-processing of one file (pages in file order). Ported from the prototype's resolveFile(),
 * extended per brief §4.5: section carry-down, blank-constant copy, holder rules, "same as" expansion,
 * extra checks, space-type mapping.
 */
const ESTIMATE_ALWAYS: DataKey[] = ["fixture_qty", "lamps_per_fixture", "lamp_watt", "unit_desc"];
const mode = (xs: Cell[]): Cell => {
  const c = new Map<string, { n: number; v: Cell }>();
  for (const x of xs) if (!blank(x) && x !== "^" && x !== 0) { const k = String(x); c.set(k, { n: (c.get(k)?.n ?? 0) + 1, v: x }); }
  return [...c.values()].sort((a, b) => b.n - a.n)[0]?.v ?? null;
};
/** Best-guess value for an unreadable cell: most common value for the same fixture type in this file, else the row above. */
function estimate(k: DataKey, v: Record<DataKey, Cell>, prev: Record<DataKey, Cell> | null, all: RawRow[]): Cell {
  const same = (keys: DataKey[]) => all.filter((r) => keys.every((q) => !blank(v[q]) && r.v[q] === v[q]));
  let g: Cell = null;
  if (k === "lamps_per_fixture") g = mode(same(["unit_desc", "lamp_desc"]).map((r) => r.v[k])) ?? mode(same(["unit_desc"]).map((r) => r.v[k]));
  else if (k === "lamp_watt") g = mode(same(["unit_desc", "lamp_desc", "lamps_per_fixture"]).map((r) => r.v[k])) ?? mode(same(["unit_desc", "lamp_desc"]).map((r) => r.v[k])) ?? mode(same(["unit_desc"]).map((r) => r.v[k]));
  else if (k === "fixture_qty") g = mode(same(["unit_desc"]).map((r) => r.v[k]));
  g = g ?? (blank(prev?.[k]) ? null : prev![k]);
  if (g == null && k === "fixture_qty") g = 1;
  return g ?? mode(all.map((r) => r.v[k]));
}

export function resolveFile(f: FileInput, opts: ResolveOptions = {}): ResolvedRow[] {
  const fmt = opts.dateFormat ?? "DMY";
  const rules = opts.spaceRules ?? DEFAULT_SPACE_RULES;
  const out: ResolvedRow[] = [];
  const allRaw = f.pages.filter((p) => p.done).flatMap((p) => p.rows);
  let prev: Record<DataKey, Cell> | null = null;
  const hd = { date: null as string | null, collected_by: null as string | null, floor: null as string | null, section: null as string | null };

  f.pages.forEach((p, pi) => {
    if (!p.done) return;
    const h = p.header ?? {};
    for (const k of ["date", "collected_by", "floor", "section"] as const) if (h[k]) hd[k] = h[k]!;
    const pageDate = hd.date;
    const pageRows: ResolvedRow[] = [];

    for (const r of p.rows) {
      const v = {} as Record<DataKey, Cell>;
      const dit: ResolvedRow["dit"] = {};
      for (const k of DATA_KEYS) {
        let x = r.v[k] ?? null;
        if (x === "^") { x = prev?.[k] ?? null; dit[k] = true; }
        v[k] = x;
      }
      if (v.floor == null) v.floor = up(hd.floor);
      // unreadable values → best estimate, highlighted
      const estimated: ResolvedRow["estimated"] = {};
      for (const k of DATA_KEYS) {
        const unreadable = blank(v[k]) || v[k] === 0;
        if (!unreadable || dit[k] || r.manual?.[k]) continue;
        if (!(ESTIMATE_ALWAYS.includes(k) || r.uncertain.includes(k))) continue;
        if (k === "room_name" || k === "dimensions") continue;   // never invent a room name or a room size
        const g = estimate(k, v, prev, allRaw);
        if (!blank(g)) { v[k] = g; estimated[k] = true; }
      }
      // section: latest section_change at or before this row, else page header, else carried from earlier pages
      let section = hd.section;
      const sc = [...p.section_changes].filter((s) => r.row != null && s.from_row <= r.row).sort((a, b) => b.from_row - a.from_row)[0];
      if (sc) { section = sc.section; hd.section = sc.section; }
      // blank constants copied from above when the surveyor was dittoing the rest of the row
      const carried: ResolvedRow["carried"] = {};
      const dittoedConstants = CONSTANT_KEYS.filter((k) => dit[k]).length;
      if (prev && dittoedConstants >= 2) {
        for (const k of CONSTANT_KEYS) if (blank(v[k]) && !blank(prev[k])) { v[k] = prev[k]; carried[k] = true; }
      }
      // holder defaults
      if (blank(v.holder)) {
        if (v.lamp_desc === "T8") v.holder = "T8";
        else if (v.lamp_desc === "BULB-E27") v.holder = "E27";
      }
      // space type: keyword table on the resolved room name; model value only as fallback; manual edits win
      if (!r.manual?.space_type) {
        const mapped = mapSpaceType(typeof v.room_name === "string" ? v.room_name : null, rules);
        if (mapped) { v.space_type = mapped; delete dit.space_type; }
      }
      const rr = finishRow(f, p, pi, r, v, dit, carried, section, pageDate, fmt, estimated);
      pageRows.push(rr);
      prev = { ...v };
    }
    expandCopyNotes(f, p, pi, pageRows, fmt).forEach(({ after, rows }) => {
      const at = pageRows.indexOf(after);
      pageRows.splice(at + 1, 0, ...rows);
    });
    out.push(...pageRows);
  });
  return out;
}

function finishRow(f: FileInput, p: PageInput, pi: number, r: RawRow | null, v: Record<DataKey, Cell>, dit: ResolvedRow["dit"],
  carried: ResolvedRow["carried"], section: string | null, dateTxt: string | null, fmt: DateFormat, estimated: ResolvedRow["estimated"] = {}): ResolvedRow {
  const flags: Record<string, string> = {};
  const uncertain = r?.uncertain ?? [];
  for (const k of uncertain) flags[k] = "Model wasn’t sure" + (r?.note ? ": " + r.note : "");
  for (const k of Object.keys(estimated)) flags[k] = "Estimated: couldn’t be read on the sheet, please check" + (r?.note ? " (" + r.note + ")" : "");
  for (const k of ["fixture_qty", "lamps_per_fixture", "lamp_watt"] as const)
    if (!blank(v[k]) && typeof v[k] !== "number") flags[k] = "Not a number";
  for (const k of ["fixture_qty", "lamp_watt", "room_name", "unit_desc"] as const)
    if (blank(v[k]) && !flags[k]) flags[k] = "Missing";
  for (const [k, list] of Object.entries(ENUMS))
    if (!blank(v[k as DataKey]) && !(list as readonly string[]).includes(String(v[k as DataKey]))) flags[k] = "Not one of the template’s dropdown values";
  if (!blank(v.space_type) && !(SPACE_TYPES as readonly string[]).includes(String(v.space_type)) && !flags.space_type) flags.space_type = "Not in the space-type list (fine if intended)";
  if (blank(v.space_type) && !blank(v.room_name)) flags.space_type = "No space type matched this room name";
  if (typeof v.voltage === "number" && ![110, 220].includes(v.voltage) && !flags.voltage) flags.voltage = "Not one of the template’s dropdown values";
  const area = areaOf(v.dimensions);
  if (!blank(v.dimensions) && area == null) flags.dimensions = "Couldn’t work out L × W";
  if (typeof v.lamp_watt === "number" && (v.lamp_watt > 1000 || v.lamp_watt < 1)) flags.lamp_watt = "Unusual wattage";
  if (uncertain.includes("dimensions") || flags.dimensions) flags.__area = flags.dimensions ?? "Check room size";
  const date = parseDate(dateTxt, fmt);
  if (dateTxt && !date) flags.__date = "Date on the sheet couldn’t be read as a date";
  const building = [f.building, section ? section.toUpperCase() : null].filter(Boolean).join(" - ");
  return {
    fileId: f.id, pageId: p.id, pageNo: pi + 1, sheetRow: r?.row ?? null, rawId: r?.id ?? null, v, dit, carried, estimated, flags, area, date,
    dateTxt: dateTxt ?? null, collected: up(pageCollector(f, pi)), section: section ? section.toUpperCase() : null, building,
  };
}
function pageCollector(f: FileInput, pi: number): string | null {
  for (let i = pi; i >= 0; i--) { const c = f.pages[i].header?.collected_by; if (c) return c; }
  return null;
}

/** "Room 2-7 same as Room 1": copy the source block's fixtures to each target room, right after the block. */
function expandCopyNotes(f: FileInput, p: PageInput, pi: number, rows: ResolvedRow[], fmt: DateFormat) {
  const res: { after: ResolvedRow; rows: ResolvedRow[] }[] = [];
  for (const n of p.copy_notes ?? []) {
    if (!n.source_rows?.length) continue;
    const lo = Math.min(...n.source_rows), hi = Math.max(...n.source_rows);
    const block = rows.filter((r) => r.sheetRow != null && r.sheetRow >= lo && r.sheetRow <= hi);
    if (!block.length) continue;
    const srcName = String(block[0].v.room_name ?? "").toUpperCase();
    const text = (n.text ?? "").trim().toUpperCase();
    const remark = `SAME AS ${srcName}${text ? ` (${text})` : ""}`;
    const made: ResolvedRow[] = [];
    for (const t of n.targets ?? []) {
      for (const src of block) {
        const v = { ...src.v };
        if (t.room_name) v.room_name = t.room_name.toUpperCase();
        if (t.room_tag != null) v.room_tag = t.room_tag.replace(/\s+/g, "").toUpperCase();
        v.remarks = remark;
        v.dimensions = null;
        const cp = finishRow(f, p, pi, null, v, {}, {}, src.section, src.dateTxt, fmt);
        cp.expanded = true;
        made.push(cp);
      }
    }
    res.push({ after: block[block.length - 1], rows: made });
  }
  return res;
}

export function resolveProject(files: FileInput[], opts: ResolveOptions = {}): ResolvedRow[] {
  return files.flatMap((f) => resolveFile(f, opts));
}

export interface Totals { rows: number; flaggedCells: number; fixtures: number; kw: number }
export function totals(rows: ResolvedRow[]): Totals {
  let flagged = 0, fixtures = 0, load = 0;
  for (const r of rows) {
    flagged += Object.keys(r.flags).filter((k) => k !== "dimensions").length;
    const q = r.v.fixture_qty, l = r.v.lamps_per_fixture, w = r.v.lamp_watt;
    if (typeof q === "number") fixtures += q;
    if (typeof q === "number" && typeof l === "number" && typeof w === "number") load += q * l * w;
  }
  return { rows: rows.length, flaggedCells: flagged, fixtures, kw: Math.round(load) / 1000 };
}
