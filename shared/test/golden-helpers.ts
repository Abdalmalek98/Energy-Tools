import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { COLKEY, DATA_KEYS, norm, normRow, type Cell, type DataKey, type FileInput, type RawRow } from "../src";

export const REF = path.resolve(__dirname, "../../reference");
export const TEMPLATE = path.join(REF, "MOH-JZ - Lightings - Raeds team.xlsx");
export const templateBuf = () => readFileSync(TEMPLATE);

const plain = (v: any) => (v && typeof v === "object" && "result" in v ? v.result : v && typeof v === "object" && "richText" in v ? v.richText.map((t: any) => t.text).join("") : v);

/** Rows [r0..r1] of the template's answer data, canonicalised with norm() (the typist's typos removed). */
export async function answerRows(r0: number, r1: number) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(templateBuf());
  const ws = wb.getWorksheet("Lighting Survey Template")!;
  const out: { building: string; collected: string; v: Record<DataKey, Cell> }[] = [];
  for (let r = r0; r <= r1; r++) {
    const v = {} as Record<DataKey, Cell>;
    for (const [c, k] of Object.entries(COLKEY)) v[k] = norm(k, plain(ws.getCell(c + r).value));
    const area = plain(ws.getCell("AA" + r).value);
    v.dimensions = null; (v as any).__area = typeof area === "number" ? area : null;
    normRow(v);
    out.push({ building: String(plain(ws.getCell("E" + r).value) ?? ""), collected: String(plain(ws.getCell("C" + r).value) ?? ""), v });
  }
  return out;
}

/** Turn answer rows into a raw "model" page: cells equal to the row above become "^" (as a surveyor would write them). */
export function toRawFile(rows: Awaited<ReturnType<typeof answerRows>>, dittoKeys: DataKey[]): FileInput {
  let prev: Record<string, Cell> | null = null;
  const raw: RawRow[] = rows.map((r, i) => {
    const v = {} as Record<DataKey, Cell>;
    for (const k of DATA_KEYS) v[k] = r.v[k] ?? null;
    const area = (r.v as any).__area; if (typeof area === "number") v.dimensions = `${area}x1`;   // the answer file only holds the area
    if (prev) for (const k of dittoKeys) if (v[k] != null && v[k] === prev[k]) v[k] = "^";
    prev = r.v;
    return { id: "r" + i, row: i + 1, uncertain: [], note: null, v };
  });
  return {
    id: "f1", name: "golden.pdf", building: rows[0].building,
    pages: [{ id: "p1", header: { collected_by: rows[0].collected, date: "10-2-26" }, section_changes: [], copy_notes: [], rows: raw, done: true }],
  };
}
