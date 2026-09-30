import { describe, expect, it } from "vitest";
import { areaOf, norm, normRow, parseDate } from "../src";

describe("norm(): short forms from the brief", () => {
  const cases: [string, unknown, unknown][] = [
    ["led", "L", "LED"], ["led", "led", "LED"], ["led", "NON", "Non-LED"], ["led", "NL", "Non-LED"], ["led", "N0N-LED", "Non-LED"],
    ["normal_emergency", "N", "Normal"], ["normal_emergency", "NOR", "Normal"], ["normal_emergency", "No", "Normal"], ["normal_emergency", "E", "Emergency"], ["normal_emergency", "EM", "Emergency"],
    ["int_ext", "IN", "Internal"], ["int_ext", "EX", "External"], ["int_ext", "EXT", "External"], ["int_ext", "OUT", "External"],
    ["mounted", "SM", "Surface"], ["mounted", "S", "Surface"], ["mounted", "CR", "Recessed"], ["mounted", "C.R", "Recessed"], ["mounted", "R", "Recessed"],
    ["mounted", "WM", "Wall-Mounted"], ["mounted", "W", "Wall-Mounted"], ["mounted", "wall", "Wall-Mounted"],
    ["ceiling", "60x60", "Panel"], ["ceiling", "60/60", "Panel"], ["ceiling", "GYP", "Gypsum"], ["ceiling", "Gypsum", "Gypsum"], ["ceiling", "other", "Others"], ["ceiling", "NO ceiling", "No Ceiling"],
    ["color_temp", 6500, "6500K"], ["color_temp", "6500", "6500K"], ["color_temp", "65⁰⁰", "6500K"], ["color_temp", "3000k", "3000K"],
    ["unit_desc", "2F", "2FT"], ["unit_desc", "4F", "4FT"], ["unit_desc", "4ft", "4FT"], ["unit_desc", "Dowan", "DOWN LIGHT"], ["unit_desc", "Down", "DOWN LIGHT"],
    ["lamp_desc", "T-8", "T8"], ["holder", "T-8", "T8"], ["lamp_desc", "Pannel", "PANEL"],
    ["cutout", "120/60", "120X60"], ["switch_status", "no switch", "No Switch"], ["switch_status", "OK", "Good"],
    ["room_tag", "G 13", "G13"], ["dimensions", "4 X 5", "4x5"], ["fixture_qty", "12", 12], ["lamp_watt", "18W", 18],
    ["remarks", "db control", "DB CONTROL"],
  ];
  it.each(cases)("%s: %j → %j", (k, input, out) => expect(norm(k, input)).toBe(out));
  it.each(["/", "//", "〃", '"', ",,", "-do-", "^"])("ditto %j → ^", (m) => expect(norm("led", m)).toBe("^"));
  it("blank → null; unknown values are left as written", () => {
    expect(norm("led", "")).toBeNull(); expect(norm("led", null)).toBeNull(); expect(norm("led", "HALOGEN")).toBe("HALOGEN");
    expect(norm("fixture_qty", "abc")).toBe("abc");
  });
  it("swapped Pannel / 60/60 columns → 60X60 PANEL + PANEL", () => {
    const v: any = { unit_desc: "Pannel", lamp_desc: "60/60" }; normRow(v);
    expect(v).toMatchObject({ unit_desc: "60X60 PANEL", lamp_desc: "PANEL" });
    const w: any = { unit_desc: "60/60", lamp_desc: "Pannel" }; normRow(w);
    expect(w).toMatchObject({ unit_desc: "60X60 PANEL", lamp_desc: "PANEL" });
  });
});

describe("areaOf / parseDate", () => {
  it("computes area", () => { expect(areaOf("4x5")).toBe(20); expect(areaOf("3.5×2")).toBe(7); expect(areaOf("big")).toBeNull(); expect(areaOf(null)).toBeNull(); });
  it("parses day-month-year by default", () => {
    expect(parseDate("10-2-26")!.toISOString()).toBe("2026-02-10T00:00:00.000Z");
    expect(parseDate("15-02-2026")!.toISOString()).toBe("2026-02-15T00:00:00.000Z");
    expect(parseDate("10/2/26", "MDY")!.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(parseDate("2026-2-10")!.toISOString()).toBe("2026-02-10T00:00:00.000Z");
  });
  it("rejects nonsense", () => { expect(parseDate("31-2-26")).toBeNull(); expect(parseDate("13-13-26")).toBeNull(); expect(parseDate("hello")).toBeNull(); expect(parseDate(null)).toBeNull(); });
});
