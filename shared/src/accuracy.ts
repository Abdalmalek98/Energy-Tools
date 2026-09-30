import { COLKEY, labelOf, type DataKey } from "./fields";
import { areaOf, norm, normRow, type Cell } from "./normalize";

/** One survey row read from an Excel sheet (the typed answers, or our export) in comparable form. */
export interface SheetRow { room: string; v: Partial<Record<DataKey, Cell>>; area: number | null; date: Date | null; collected: string | null }

const plain = (c: unknown) => (c && typeof c === "object" && "result" in c ? (c as { result: unknown }).result : c && typeof c === "object" && "richText" in c ? (c as { richText: { text: string }[] }).richText.map((t) => t.text).join("") : c);
/** get(col) returns the raw cell value for that Excel column letter. */
export function sheetRow(get: (col: string) => unknown): SheetRow {
  const v: Partial<Record<DataKey, Cell>> = {};
  for (const [c, k] of Object.entries(COLKEY)) v[k] = norm(k, plain(get(c)) as never);
  normRow(v as Record<string, Cell>);
  const a = plain(get("AA")); const d = plain(get("B"));
  return { room: String(v.room_name ?? ""), v, area: typeof a === "number" ? a : null, date: d instanceof Date ? d : null, collected: (plain(get("C")) as string | null) ?? null };
}

const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9؀-ۿ]/g, "");
/** Needleman–Wunsch on room names so an inserted/missed row doesn't shift every later row. Returns [gotIdx|null, wantIdx|null] pairs. */
export function alignRows(got: SheetRow[], want: SheetRow[]): [number | null, number | null][] {
  const n = got.length, m = want.length, S = (i: number, j: number) => (key(got[i].room) === key(want[j].room) ? 2 : key(got[i].room) && key(want[j].room) && (key(got[i].room).includes(key(want[j].room)) || key(want[j].room).includes(key(got[i].room))) ? 1 : -1);
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) dp[i][0] = -i; for (let j = 1; j <= m; j++) dp[0][j] = -j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) dp[i][j] = Math.max(dp[i - 1][j - 1] + S(i - 1, j - 1), dp[i - 1][j] - 1, dp[i][j - 1] - 1);
  const out: [number | null, number | null][] = []; let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + S(i - 1, j - 1)) { out.push([i - 1, j - 1]); i--; j--; }
    else if (i > 0 && dp[i][j] === dp[i - 1][j] - 1) { out.push([i - 1, null]); i--; }
    else { out.push([null, j - 1]); j--; }
  }
  return out.reverse();
}

const blank = (x: unknown) => x == null || x === "";
const same = (a: Cell | undefined, b: Cell | undefined) => {
  if (blank(a) && blank(b)) return true;
  if (blank(a) || blank(b)) return false;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a).trim().toUpperCase() === String(b).trim().toUpperCase();
};
/** Day/month swapped counts as the same date: the typed answers were entered month-first (see DECISIONS #27). */
export const sameDate = (a: Date | null, b: Date | null) => {
  if (!a || !b) return !a && !b;
  const [ay, am, ad, by, bm, bd] = [a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate(), b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()];
  return ay === by && ((am === bm && ad === bd) || (am + 1 === bd && ad === bm + 1));
};

export interface ColumnScore { col: string; label: string; compared: number; matched: number }
export interface SampleResult { name: string; rowsGot: number; rowsWant: number; aligned: number; missed: number; extra: number; columns: ColumnScore[]; mismatches: string[] }

/** Scores every template column over aligned rows; counted only where either side has a value. */
export function compareSheets(name: string, got: SheetRow[], want: SheetRow[], maxMismatches = 40): SampleResult {
  const pairs = alignRows(got, want);
  const cols: Record<string, ColumnScore> = {};
  const add = (col: string, label: string) => (cols[col] ??= { col, label, compared: 0, matched: 0 });
  const mismatches: string[] = []; let aligned = 0, missed = 0, extra = 0;
  for (const [gi, wi] of pairs) {
    if (gi == null) { missed++; continue; } if (wi == null) { extra++; continue; }
    aligned++;
    const g = got[gi], w = want[wi];
    const test = (col: string, label: string, a: Cell | undefined, b: Cell | undefined, ok = same(a, b)) => {
      if (blank(a) && blank(b)) return; const s = add(col, label); s.compared++; if (ok) s.matched++; else if (mismatches.length < maxMismatches) mismatches.push(`${w.room || "?"} · ${col} ${label}: expected ${JSON.stringify(b ?? null)}, got ${JSON.stringify(a ?? null)}`);
    };
    for (const [c, k] of Object.entries(COLKEY)) test(c, labelOf(k), g.v[k], w.v[k]);
    test("AA", "Area", g.area, w.area, (g.area ?? null) === (w.area ?? null));
    test("B", "Date", g.date?.toISOString() ?? null, w.date?.toISOString() ?? null, sameDate(g.date, w.date));
    test("C", "Collected by", g.collected, w.collected);
  }
  const order = (c: string) => (c.length === 1 ? c.charCodeAt(0) - 65 : 26 + c.charCodeAt(1) - 65);
  return { name, rowsGot: got.length, rowsWant: want.length, aligned, missed, extra, columns: Object.values(cols).sort((a, b) => order(a.col) - order(b.col)), mismatches };
}
export { areaOf };

const pct = (s: ColumnScore) => (s.compared ? (100 * s.matched) / s.compared : 100);
export function reportMarkdown(results: SampleResult[], meta: { date: string; quality: string; note?: string }): string {
  const total = (rs: ColumnScore[]) => { const c = rs.reduce((a, s) => a + s.compared, 0); return c ? (100 * rs.reduce((a, s) => a + s.matched, 0)) / c : 100; };
  const allCols = new Map<string, ColumnScore>();
  for (const r of results) for (const c of r.columns) { const a = allCols.get(c.col) ?? { ...c, compared: 0, matched: 0 }; a.compared += c.compared; a.matched += c.matched; allCols.set(c.col, a); }
  const cols = [...allCols.values()];
  const L: string[] = [`# Accuracy report`, ``, `Run: ${meta.date} · quality: **${meta.quality}**${meta.note ? ` · ${meta.note}` : ""}`, ``,
    `Compared with the team's typed answers in the template workbook. A cell counts only where either side has a value. Typist typos are normalised before comparing; day/month-swapped dates count as equal.`, ``,
    `## Overall`, ``, `| Sample | Rows read | Rows expected | Aligned | Missed | Extra | Cell accuracy |`, `|---|---:|---:|---:|---:|---:|---:|`,
    ...results.map((r) => `| ${r.name} | ${r.rowsGot} | ${r.rowsWant} | ${r.aligned} | ${r.missed} | ${r.extra} | ${total(r.columns).toFixed(1)}% |`),
    `| **All** | ${results.reduce((a, r) => a + r.rowsGot, 0)} | ${results.reduce((a, r) => a + r.rowsWant, 0)} | ${results.reduce((a, r) => a + r.aligned, 0)} | ${results.reduce((a, r) => a + r.missed, 0)} | ${results.reduce((a, r) => a + r.extra, 0)} | **${total(cols).toFixed(1)}%** |`, ``,
    `## By column`, ``, `| Column | Field | Compared | Matched | Accuracy | |`, `|---|---|---:|---:|---:|---|`,
    ...cols.map((c) => `| ${c.col} | ${c.label} | ${c.compared} | ${c.matched} | ${pct(c).toFixed(1)}% | ${pct(c) < 90 ? "⚠ weak" : ""} |`), ``];
  const weak = cols.filter((c) => pct(c) < 90);
  L.push(`## Weak columns (< 90 %)`, ``, weak.length ? weak.map((c) => `- **${c.col} ${c.label}** ${pct(c).toFixed(1)}%`).join("\n") : "None.", ``);
  for (const r of results) if (r.mismatches.length) L.push(`## Mismatches: ${r.name}`, ``, ...r.mismatches.map((m) => `- ${m}`), ``);
  return L.join("\n");
}
