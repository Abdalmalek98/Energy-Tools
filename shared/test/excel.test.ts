import ExcelJS from "exceljs";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { COLKEY, exportWorkbook, resolveFile, type ResolvedRow } from "../src";
import { answerRows, templateBuf, toRawFile } from "./golden-helpers";

const plain = (v: any) => (v && typeof v === "object" && "result" in v ? v.result : v);
const DITTO_KEYS = ["floor", "led", "normal_emergency", "unit_desc", "lamp_desc", "voltage", "int_ext", "holder", "mounted", "dimmable", "sensors", "ceiling", "height", "switch_status", "color_temp", "lamps_per_fixture", "lamp_watt", "fixture_qty"] as const;

let answers: Awaited<ReturnType<typeof answerRows>>;
let resolved: ResolvedRow[];
let out: Awaited<ReturnType<typeof exportWorkbook>>;
let wb: ExcelJS.Workbook;
let ws: ExcelJS.Worksheet;
let tpl: ExcelJS.Workbook;

beforeAll(async () => {
  // Golden: the 39 rows the team typed for one health centre (template rows 3-41).
  answers = await answerRows(3, 41);
  resolved = resolveFile(toRawFile(answers, [...DITTO_KEYS]), { dateFormat: "DMY" });
  out = await exportWorkbook({ template: templateBuf(), rows: resolved, mode: "new" });
  wb = new ExcelJS.Workbook(); await wb.xlsx.load(out.data);
  ws = wb.getWorksheet("Lighting Survey Template")!;
  tpl = new ExcelJS.Workbook(); await tpl.xlsx.load(templateBuf());
});

describe("golden: pipeline output vs the team's answer rows", () => {
  it("has exactly one row per answer row, starting at row 3", () => {
    expect(out.firstRow).toBe(3); expect(out.lastRow).toBe(41);
    expect(ws.getCell("E42").value).toBeNull();
  });
  it("matches every data cell (only deliberate differences: carried blanks, serials, dates)", () => {
    const mismatches: string[] = [];
    answers.forEach((a, i) => {
      const r = i + 3;
      for (const [c, k] of Object.entries(COLKEY)) {
        const got = plain(ws.getCell(c + r).value) ?? null;
        const want = a.v[k] ?? null;
        if (String(got ?? "") === String(want ?? "")) continue;
        if (resolved[i].carried[k]) continue;                         // blank on sheet → copied from above, light blue
        if (resolved[i].estimated[k]) {                               // unreadable → estimated, must be yellow with a note
          expect((ws.getCell(c + r).fill as any).fgColor.argb).toBe("FFFFF2CC"); expect(JSON.stringify(ws.getCell(c + r).note)).toContain("Estimated"); continue;
        }
        mismatches.push(`${c}${r} ${k}: want ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
      }
      const area = plain(ws.getCell("AA" + r).value) ?? null;
      if (area !== ((a.v as any).__area ?? null) && (a.v as any).__area != null) mismatches.push(`AA${r}: want ${(a.v as any).__area} got ${area}`);
      expect(plain(ws.getCell("E" + r).value)).toBe(a.building);
    });
    expect(mismatches).toEqual([]);
  });
  it("marks the carried blanks light blue with an explanatory note", () => {
    const carriedCells = resolved.flatMap((x, i) => Object.keys(x.carried).map((k) => [i + 3, Object.entries(COLKEY).find(([, kk]) => kk === k)![0]] as const));
    expect(carriedCells.length).toBeGreaterThan(0);
    for (const [r, c] of carriedCells) {
      const cell = ws.getCell(c + r);
      expect((cell.fill as any).fgColor.argb).toBe("FFDDEBF7");
      expect(JSON.stringify(cell.note)).toContain("copied from above");
    }
  });
});

describe("template fidelity", () => {
  it("keeps header rows 1-2, merges, freeze pane, column widths and fonts", () => {
    const t = tpl.getWorksheet("Lighting Survey Template")!;
    for (const r of [1, 2]) for (let c = 1; c <= 30; c++) {
      if (r === 2 && c === 17) continue;                               // Q2 is set below
      expect(plain(ws.getRow(r).getCell(c).value)).toEqual(plain(t.getRow(r).getCell(c).value));
    }
    expect(Object.keys((ws as any)._merges).sort()).toEqual(Object.keys((t as any)._merges).sort());
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: t.views[0].ySplit });
    for (let c = 1; c <= 30; c++) expect(ws.getColumn(c).width).toBe(t.getColumn(c).width);
    expect(ws.getCell("E2").font).toEqual(t.getCell("E2").font);
    expect(ws.getCell("E3").border).toEqual(t.getCell("E3").border);
  });
  it("sets Q2 = Lamp Load (W)", () => expect(ws.getCell("Q2").value).toBe("Lamp Load (W)"));
  it("writes running S.No, real dates (dd-mm-yyyy) and =N*O lamp count", () => {
    expect(ws.getCell("A3").value).toBe(1); expect(ws.getCell("A41").value).toBe(39);
    const b = ws.getCell("B3");
    expect(b.value).toBeInstanceOf(Date); expect((b.value as Date).toISOString().slice(0, 10)).toBe("2026-02-10"); expect(b.numFmt).toBe("dd-mm-yyyy");
    expect((ws.getCell("P3").value as any).formula).toBe("N3*O3");
    expect((ws.getCell("P3").value as any).result).toBe((ws.getCell("N3").value as number) * (ws.getCell("O3").value as number));
    expect(ws.getCell("D3").value).toBeNull();
  });
  it("has dropdown validations on the new rows with the clean lists", () => {
    expect((ws.getCell("K10").dataValidation as any).formulae[0]).toBe('"Normal,Emergency"');
    expect((ws.getCell("Z41").dataValidation as any).formulae[0]).toContain("No Ceiling");
    expect(ws.getCell("K42").dataValidation).toBeUndefined();
  });
  it("old template data rows are gone", () => {
    expect(ws.actualRowCount).toBe(41);
    expect(plain(ws.getCell("E42").value)).toBeNull();
  });
});

describe("extra sheets", () => {
  it("Summary has live formulas per building/section with correct cached results and a total", () => {
    const sm = wb.getWorksheet("Summary")!;
    expect(sm.getCell("A2").value).toBe(answers[0].building);
    expect((sm.getCell("C2").value as any).formula).toContain("SUMIFS");
    expect((sm.getCell("E2").value as any).formula).toContain("SUMPRODUCT");
    const fixtures = answers.reduce((s, a) => s + (Number(a.v.fixture_qty) || 0), 0);
    expect((sm.getCell("B2").value as any).result).toBe(39);
    expect((sm.getCell("C2").value as any).result).toBe(fixtures);
    expect((sm.getCell("A3").value)).toBe("TOTAL");
    expect((sm.getCell("B3").value as any).formula).toBe("SUM(B2:B2)");
  });
  it("Review Flags lists flagged cells with Excel row / scan page / sheet row / section / room / column / value / what to check", async () => {
    const fs = wb.getWorksheet("Review Flags")!;
    expect(fs.getRow(1).values).toEqual([undefined, "Excel row", "Scan page", "Sheet row", "Section", "Room", "Column", "Value", "What to check"]);
    const nFlags = resolved.reduce((n, r) => n + Object.keys(r.flags).filter((k) => k !== "dimensions").length, 0);
    expect(fs.rowCount - 1).toBe(nFlags);
  });
  it("flagged cells are yellow with a note", async () => {
    const f = resolveFile(toRawFile(answers.slice(0, 2), [...DITTO_KEYS]));
    f[0].flags.lamp_watt = "Model wasn’t sure: overwritten";
    const r = await exportWorkbook({ template: templateBuf(), rows: f, mode: "new" });
    const w = new ExcelJS.Workbook(); await w.xlsx.load(r.data);
    const c = w.getWorksheet("Lighting Survey Template")!.getCell("Q3");
    expect((c.fill as any).fgColor.argb).toBe("FFFFF2CC"); expect(JSON.stringify(c.note)).toContain("overwritten");
  });
});

describe("append to an existing workbook", () => {
  it("adds after the last filled row, continues S.No, keeps other sheets, replaces Review Flags, never touches old rows", async () => {
    const master = await exportWorkbook({ template: templateBuf(), rows: resolved.slice(0, 10), mode: "new" });
    // user adds their own sheet + a stale flags sheet to the master
    const m = new ExcelJS.Workbook(); await m.xlsx.load(master.data);
    m.addWorksheet("My notes").getCell("A1").value = "keep me";
    m.getWorksheet("Review Flags")!.getCell("A5").value = "stale";
    const masterBuf = await m.xlsx.writeBuffer();
    const more = await exportWorkbook({ template: templateBuf(), existing: masterBuf as ArrayBuffer, rows: resolved.slice(10, 15), mode: "append" });
    expect(more.appendedAfter).toBe(12); expect(more.firstRow).toBe(13); expect(more.lastRow).toBe(17);
    const w = new ExcelJS.Workbook(); await w.xlsx.load(more.data);
    const s = w.getWorksheet("Lighting Survey Template")!;
    expect(s.getCell("A13").value).toBe(11); expect(s.getCell("A17").value).toBe(15);
    expect(plain(s.getCell("G13").value)).toBe(resolved[10].v.room_name);
    for (let r = 3; r <= 12; r++) expect(plain(s.getCell("G" + r).value)).toBe(resolved[r - 3].v.room_name);
    expect(w.getWorksheet("My notes")!.getCell("A1").value).toBe("keep me");
    const fl = w.getWorksheet("Review Flags")!;
    expect(fl.getCell("A5").value).not.toBe("stale");
    const flagRows = new Set<number>(); fl.eachRow((r, n) => n > 1 && flagRows.add(Number(r.getCell(1).value)));
    for (const n of flagRows) expect(n).toBeGreaterThanOrEqual(13);
    expect(s.getCell("K14").dataValidation).toBeDefined();
  });
  it("finds the last row using E/G/L/N only and numbers by position when existing rows have no S.No", async () => {
    // the raw template has 552 filled rows, no S.No
    const r = await exportWorkbook({ template: templateBuf(), existing: templateBuf(), rows: resolved.slice(0, 2), mode: "append" });
    expect(r.appendedAfter).toBe(554); expect(r.firstRow).toBe(555);
    const w = new ExcelJS.Workbook(); await w.xlsx.load(r.data);
    expect(w.getWorksheet("Lighting Survey Template")!.getCell("A555").value).toBe(553);
    expect(w.getWorksheet("Summary")!.getCell("A2").value).toBe("AL FATHIA HEALTH CENTER");
  });
});

describe("file validity", () => {
  const soffice = spawnSync("which", ["soffice"]).status === 0;
  it.skipIf(!soffice)("LibreOffice opens the export and recalculates the formulas to the cached values", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lsr-"));
    const f = path.join(dir, "out.xlsx"); writeFileSync(f, out.data);
    execFileSync("soffice", ["--headless", "--convert-to", "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1", "--outdir", dir, f], { timeout: 90_000 });
    // sheet 2 = Summary → out-Summary.csv
    const csv = require("node:fs").readFileSync(path.join(dir, "out-Summary.csv"), "utf8").split("\n");
    const cells = csv[1].split(",");
    const fixtures = answers.reduce((s, a) => s + (Number(a.v.fixture_qty) || 0), 0);
    expect(Number(cells[1])).toBe(39); expect(Number(cells[2])).toBe(fixtures);
    const kw = answers.reduce((s, a) => s + (Number(a.v.fixture_qty) || 0) * (Number(a.v.lamps_per_fixture) || 0) * (Number(a.v.lamp_watt) || 0), 0) / 1000;
    expect(Number(cells[4])).toBeCloseTo(kw, 2);
  }, 120_000);
});

describe("estimated cells", () => {
  it("are written with the estimate, yellow fill and an 'Estimated' note, and listed in Review Flags", async () => {
    const f = resolveFile({ id: "f", name: "x", building: "B", pages: [{ id: "p", header: {}, section_changes: [], copy_notes: [], done: true, rows: [
      { id: "1", row: 1, uncertain: [], note: null, v: { ...Object.fromEntries((await import("../src")).DATA_KEYS.map((k) => [k, null])), room_name: "OFFICE", unit_desc: "2FT", lamp_desc: "T8", fixture_qty: 2, lamps_per_fixture: 2, lamp_watt: 18 } as any },
      { id: "2", row: 2, uncertain: ["lamp_watt"], note: "ESTIMATED", v: { ...Object.fromEntries((await import("../src")).DATA_KEYS.map((k) => [k, null])), room_name: "STORE", unit_desc: "2FT", lamp_desc: "T8", fixture_qty: 1, lamps_per_fixture: 2, lamp_watt: 0 } as any },
    ] }] });
    const r = await exportWorkbook({ template: templateBuf(), rows: f, mode: "new" });
    const w = new ExcelJS.Workbook(); await w.xlsx.load(r.data);
    const c = w.getWorksheet("Lighting Survey Template")!.getCell("Q4");
    expect(c.value).toBe(18); expect((c.fill as any).fgColor.argb).toBe("FFFFF2CC"); expect(JSON.stringify(c.note)).toContain("Estimated");
    const flags = w.getWorksheet("Review Flags")!; let found = false;
    flags.eachRow((row) => { if (String(row.getCell(6).value).startsWith("Q") && String(row.getCell(8).value).startsWith("Estimated")) found = true; });
    expect(found).toBe(true);
  });
});
