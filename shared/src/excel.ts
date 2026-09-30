import ExcelJS from "exceljs";
import { COLKEY, colOf, labelOf, type DataKey } from "./fields";
import type { Cell } from "./normalize";
import type { ResolvedRow } from "./resolve";

export const SURVEY_SHEET = "Lighting Survey Template";
const FLAG_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } } as const;     // yellow: check
const CARRY_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } } as const;    // light blue: copied from above
const DATE_FMT = "dd-mm-yyyy";

/** Clean dropdown lists (the template's own lists are fragmented and contain typos such as "Emergncy"). */
export const VALID: Record<string, string> = {
  J: "LED,Non-LED", K: "Normal,Emergency", R: "3000K,3500K,4000K,5000K,6500K", S: "110,220", T: "Internal,External",
  V: "Surface,Recessed,Wall-Mounted,Suspended,Floor Mounted", X: "Yes,No", Y: "Yes,No", Z: "No Ceiling,Gypsum,Panel,Others",
  AC: "Good,To be replaced,No Switch,Not Working",
};
const COLS = Array.from({ length: 30 }, (_, i) => (i < 26 ? String.fromCharCode(65 + i) : "A" + String.fromCharCode(65 + i - 26)));

export interface ExportOptions {
  /** Bundled template workbook (used for "new"). */
  template: ArrayBuffer | Uint8Array;
  rows: ResolvedRow[];
  mode: "new" | "append";
  /** The user's master workbook when mode = "append". */
  existing?: ArrayBuffer | Uint8Array;
}
export interface ExportResult { data: Uint8Array; firstRow: number; lastRow: number; appendedAfter?: number }

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const isBlankCell = (v: unknown) => v === null || v === undefined || v === "";
const plain = (v: ExcelJS.CellValue): unknown => (v && typeof v === "object" && "result" in v ? (v as { result: unknown }).result : v && typeof v === "object" && "richText" in v ? (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("") : v);

export async function exportWorkbook(o: ExportOptions): Promise<ExportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((o.mode === "append" ? o.existing! : o.template) as ArrayBuffer);
  const ws = wb.getWorksheet(SURVEY_SHEET) ?? wb.worksheets[0];
  if (!ws) throw new Error("The workbook has no worksheets.");

  // capture row-3 styles as the base for new rows (drop any fill so old highlight colours don't leak)
  const srcRow = ws.getRow(o.mode === "append" ? Math.max(3, lastDataRow(ws)) : 3);
  const base: Record<string, Partial<ExcelJS.Style>> = {};
  for (const c of COLS) { const st = clone(srcRow.getCell(c).style) as Partial<ExcelJS.Style>; delete st.fill; base[c] = st; }

  let first: number; let serial: number; let appendedAfter: number | undefined;
  if (o.mode === "new") {
    // spliceRows(3, n) silently keeps the old rows for large n, so drop the data rows directly
    (ws as unknown as { _rows: unknown[] })._rows.splice(2);
    (ws as unknown as { dataValidations: { model: object } }).dataValidations.model = {};
    ws.getCell("Q2").value = "Lamp Load (W)";
    first = 3; serial = 0;
  } else {
    const last = lastDataRow(ws);
    appendedAfter = last; first = last + 1;
    serial = 0;
    for (let r = 3; r <= last; r++) { const v = ws.getCell("A" + r).value; if (typeof v === "number") serial = Math.max(serial, v); }
    if (!serial) serial = Math.max(0, last - 2);   // existing rows unnumbered: number by position
    if (isBlankCell(ws.getCell("Q2").value)) ws.getCell("Q2").value = "Lamp Load (W)";
  }

  o.rows.forEach((x, i) => writeRow(ws, first + i, x, serial + i + 1, base));
  const lastRow = first + o.rows.length - 1;
  addValidations(ws, first, Math.max(lastRow, first));

  const surveyRows = collectSurveyRows(ws);
  const flagsSheet = wb.getWorksheet("Review Flags"); if (flagsSheet) wb.removeWorksheet(flagsSheet.id);
  const sumSheet = wb.getWorksheet("Summary"); if (sumSheet) wb.removeWorksheet(sumSheet.id);
  addSummary(wb, ws, surveyRows);
  addFlagSheet(wb, o.rows, first);
  const buf = await wb.xlsx.writeBuffer();
  return { data: new Uint8Array(buf as ArrayBuffer), firstRow: first, lastRow, appendedAfter };
}

/** Last row (≥2) that has data in E, G, L or N. */
export function lastDataRow(ws: ExcelJS.Worksheet): number {
  let last = 2;
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn > 2 && ["E", "G", "L", "N"].some((c) => !isBlankCell(plain(row.getCell(c).value)))) last = Math.max(last, rn);
  });
  return last;
}

function writeRow(ws: ExcelJS.Worksheet, rn: number, x: ResolvedRow, serial: number, base: Record<string, Partial<ExcelJS.Style>>) {
  const set = (c: string, val: unknown) => { const cell = ws.getCell(c + rn); cell.style = clone(base[c] ?? {}) as ExcelJS.Style; cell.value = (val ?? null) as ExcelJS.CellValue; return cell; };
  set("A", serial);
  const dc = set("B", x.date ?? x.dateTxt ?? null); if (x.date) dc.numFmt = DATE_FMT;
  set("C", x.collected); set("D", null); set("E", x.building || null);
  for (const [c, k] of Object.entries(COLKEY)) {
    let val: Cell = x.v[k as DataKey];
    if (k === "cutout" && typeof val === "string" && /^\d+(\.\d+)?$/.test(val)) val = Number(val);   // template holds numbers here
    set(c, val);
  }
  const q = x.v.fixture_qty, l = x.v.lamps_per_fixture;
  set("P", { formula: `N${rn}*O${rn}`, result: typeof q === "number" && typeof l === "number" ? q * l : 0 });
  set("AA", x.area);
  const mark = (c: string, fill: typeof FLAG_FILL | typeof CARRY_FILL, msg?: string) => {
    const cell = ws.getCell(c + rn); cell.fill = fill; if (msg) cell.note = { texts: [{ text: msg }] };
  };
  for (const [k] of Object.entries(x.carried)) mark(colOf(k), CARRY_FILL, "Blank on sheet, copied from above");
  for (const [k, m] of Object.entries(x.flags)) {
    if (k === "dimensions") continue;
    mark(colOf(k), FLAG_FILL, k === "__area" ? `${m} (sheet: ${x.v.dimensions ?? "—"})` : m);
  }
}

function addValidations(ws: ExcelJS.Worksheet, r0: number, r1: number) {
  for (const [c, list] of Object.entries(VALID)) {
    for (let r = r0; r <= r1; r++) {
      ws.getCell(c + r).dataValidation = { type: "list", allowBlank: true, formulae: [`"${list}"`], showErrorMessage: false };
    }
  }
}

interface SurveyRow { e: string; rn: number }
function collectSurveyRows(ws: ExcelJS.Worksheet) {
  const seen = new Map<string, number>(); const last = lastDataRow(ws);
  for (let r = 3; r <= last; r++) { const e = plain(ws.getCell("E" + r).value); if (!isBlankCell(e)) { const k = String(e); if (!seen.has(k)) seen.set(k, r); } }
  return { buildings: [...seen.keys()], last };
}

/** Summary per building/section as live formulas over the survey sheet (cached results included). */
function addSummary(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, s: { buildings: string[]; last: number }) {
  const sm = wb.addWorksheet("Summary");
  const sn = `'${SURVEY_SHEET}'`;
  const rng = (c: string) => `${sn}!$${c}$3:$${c}$${Math.max(s.last, 3)}`;
  sm.columns = [{ header: "Building / section", width: 46 }, { header: "Rows", width: 8 }, { header: "Fixtures", width: 10 }, { header: "Lamps", width: 10 }, { header: "Connected kW", width: 14 }, { header: "LED fixtures", width: 13 }, { header: "Non-LED fixtures", width: 16 }];
  sm.getRow(1).font = { bold: true }; sm.views = [{ state: "frozen", ySplit: 1 }];
  const val = (r: number, c: string) => { const v = plain(ws.getCell(c + r).value); return typeof v === "number" ? v : Number(v) || 0; };
  const numAt = (r: number, c: string) => { const v = plain(ws.getCell(c + r).value); return typeof v === "number" ? v : 0; };
  const tot = { rows: 0, fix: 0, lamps: 0, kw: 0, led: 0, non: 0 };
  s.buildings.forEach((b, i) => {
    const rn = i + 2;
    let rows = 0, fix = 0, lamps = 0, kw = 0, led = 0, non = 0;
    for (let r = 3; r <= s.last; r++) {
      if (String(plain(ws.getCell("E" + r).value) ?? "") !== b) continue;
      rows++; const q = numAt(r, "N"), l = numAt(r, "O"), w = numAt(r, "Q"); fix += q; lamps += q * l; kw += q * l * w / 1000;
      const led_ = String(plain(ws.getCell("J" + r).value) ?? ""); if (led_ === "LED") led += q; else if (led_ === "Non-LED") non += q;
    }
    void val;
    tot.rows += rows; tot.fix += fix; tot.lamps += lamps; tot.kw += kw; tot.led += led; tot.non += non;
    const A = `$A${rn}`;
    sm.getCell("A" + rn).value = b;
    sm.getCell("B" + rn).value = { formula: `COUNTIFS(${rng("E")},${A})`, result: rows };
    sm.getCell("C" + rn).value = { formula: `SUMIFS(${rng("N")},${rng("E")},${A})`, result: fix };
    sm.getCell("D" + rn).value = { formula: `SUMPRODUCT(--(${rng("E")}=${A}),${rng("N")},${rng("O")})`, result: lamps };
    sm.getCell("E" + rn).value = { formula: `SUMPRODUCT(--(${rng("E")}=${A}),${rng("N")},${rng("O")},${rng("Q")})/1000`, result: kw };
    sm.getCell("F" + rn).value = { formula: `SUMIFS(${rng("N")},${rng("E")},${A},${rng("J")},"LED")`, result: led };
    sm.getCell("G" + rn).value = { formula: `SUMIFS(${rng("N")},${rng("E")},${A},${rng("J")},"Non-LED")`, result: non };
    sm.getCell("E" + rn).numFmt = "0.00";
  });
  const t = s.buildings.length + 2; const a = 2, z = t - 1;
  sm.getCell("A" + t).value = "TOTAL"; sm.getRow(t).font = { bold: true };
  const sum = (c: string, result: number) => ({ formula: `SUM(${c}${a}:${c}${Math.max(z, a)})`, result });
  sm.getCell("B" + t).value = sum("B", tot.rows); sm.getCell("C" + t).value = sum("C", tot.fix); sm.getCell("D" + t).value = sum("D", tot.lamps);
  sm.getCell("E" + t).value = sum("E", tot.kw); sm.getCell("E" + t).numFmt = "0.00"; sm.getCell("F" + t).value = sum("F", tot.led); sm.getCell("G" + t).value = sum("G", tot.non);
}

function addFlagSheet(wb: ExcelJS.Workbook, rows: ResolvedRow[], firstRow: number) {
  const fs = wb.addWorksheet("Review Flags");
  fs.columns = [{ header: "Excel row", width: 10 }, { header: "Scan page", width: 10 }, { header: "Sheet row", width: 10 }, { header: "Section", width: 26 }, { header: "Room", width: 22 }, { header: "Column", width: 24 }, { header: "Value", width: 18 }, { header: "What to check", width: 60 }];
  fs.getRow(1).font = { bold: true };
  rows.forEach((x, i) => {
    for (const [k, m] of Object.entries(x.flags)) {
      if (k === "dimensions") continue;
      const label = k === "__area" ? "Area" : k === "__date" ? "Date" : labelOf(k);
      const value = k === "__area" ? x.v.dimensions : k === "__date" ? x.dateTxt : x.v[k as DataKey];
      fs.addRow([firstRow + i, x.pageNo, x.sheetRow, x.section ?? "", x.v.room_name ?? "", `${colOf(k)} · ${label}`, value ?? "", m]);
    }
  });
  fs.views = [{ state: "frozen", ySplit: 1 }];
  fs.autoFilter = "A1:H1";
}
