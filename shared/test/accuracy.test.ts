import { describe, expect, it } from "vitest";
import { alignRows, compareSheets, reportMarkdown, sameDate, sheetRow } from "../src";

const row = (room: string, o: Record<string, unknown> = {}) => sheetRow((c) => ({ G: room, J: "LED", N: 2, O: 2, Q: 18, L: "2FT", ...o })[c] ?? null);

describe("alignment", () => {
  it("absorbs a missed and an extra row without shifting the rest", () => {
    const want = ["A", "B", "C", "D", "E"].map((r) => row(r)), got = ["A", "C", "X", "D", "E"].map((r) => row(r));
    const pairs = alignRows(got, want);
    expect(pairs.filter(([g, w]) => g != null && w != null && got[g].room === want[w].room).length).toBe(4);
    expect(pairs.some(([g, w]) => g == null && want[w!].room === "B")).toBe(true);
    expect(pairs.some(([g, w]) => w == null && got[g!].room === "X")).toBe(true);
  });
});

describe("compareSheets", () => {
  const want = [row("OFFICE"), row("STORE", { J: "Non-LED", Q: 36, AA: 12 })];
  it("perfect read = 100 %", () => {
    const r = compareSheets("s", want, want);
    expect(r.aligned).toBe(2); expect(r.columns.every((c) => c.matched === c.compared)).toBe(true);
  });
  it("counts wrong cells per column and lists mismatches; blank-vs-blank is ignored", () => {
    const got = [row("OFFICE", { Q: 20 }), row("STORE", { J: "Non-LED", Q: 36, AA: 12 })];
    const r = compareSheets("s", got, want);
    const q = r.columns.find((c) => c.col === "Q")!; expect([q.compared, q.matched]).toEqual([2, 1]);
    expect(r.columns.find((c) => c.col === "H")).toBeUndefined();               // blank on both sides
    expect(r.mismatches[0]).toContain("Q Load W");
  });
  it("normalises the typist's typos before comparing", () => {
    const r = compareSheets("s", [row("A", { J: "Non-LED", L: "4FT" })], [row("A", { J: "N0N-LED", L: "4F" })]);
    expect(r.columns.filter((c) => c.matched !== c.compared)).toEqual([]);
  });
  it("numbers compare numerically; a missed row is reported", () => {
    const r = compareSheets("s", [row("A", { N: "2" })], [row("A", { N: 2 }), row("B")]);
    expect(r.columns.find((c) => c.col === "N")).toMatchObject({ compared: 1, matched: 1 }); expect(r.missed).toBe(1);
  });
});

describe("dates", () => {
  it("day/month swap is tolerated (typed answers were entered month-first)", () => {
    expect(sameDate(new Date(Date.UTC(2026, 1, 10)), new Date(Date.UTC(2026, 9, 2)))).toBe(true);   // 10 Feb vs 2 Oct
    expect(sameDate(new Date(Date.UTC(2026, 1, 10)), new Date(Date.UTC(2026, 1, 10)))).toBe(true);
    expect(sameDate(new Date(Date.UTC(2026, 1, 10)), new Date(Date.UTC(2026, 3, 10)))).toBe(false);
  });
});

describe("report", () => {
  it("renders per-sample, per-column tables and flags weak columns", () => {
    const got = [row("OFFICE", { Q: 99, N: 9 }), row("STORE")];
    const md = reportMarkdown([compareSheets("Sample A", got, want())], { date: "2026-01-01", quality: "best" });
    expect(md).toContain("| Sample A |"); expect(md).toContain("⚠ weak"); expect(md).toContain("## Weak columns");
    function want() { return [row("OFFICE"), row("STORE")]; }
  });
});
