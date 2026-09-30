import { describe, expect, it } from "vitest";
import { cleanPage, resolveFile, resolveProject, totals, type FileInput, type ModelPage } from "../src";

const row = (n: number, o: Record<string, unknown> = {}) => ({ row: n, room_name: "", fixture_qty: 1, lamps_per_fixture: 1, lamp_watt: 10, uncertain: [], ...o });
const page = (id: string, rows: any[], header: any = {}, extra: Partial<ModelPage> = {}) =>
  ({ ...cleanPage(id, { header: { upright: true, ...header }, section_changes: [], copy_notes: [], rows, ...extra } as ModelPage), done: true });
const file = (pages: any[], building = "TEST BUILDING"): FileInput => ({ id: "f", name: "x.pdf", building, pages });

describe("ditto resolution", () => {
  it("copies from the resolved row above, across pages", () => {
    const f = file([
      page("p1", [row(1, { room_name: "office", led: "L", unit_desc: "2FT", lamp_watt: 20 }), row(2, { room_name: "clinic", led: "^", unit_desc: "^", lamp_watt: "^" })]),
      page("p2", [row(1, { room_name: "store", led: "^", unit_desc: "^", lamp_watt: "^" })]),
    ]);
    const r = resolveFile(f);
    expect(r.map((x) => x.v.led)).toEqual(["LED", "LED", "LED"]);
    expect(r.map((x) => x.v.lamp_watt)).toEqual([20, 20, 20]);
    expect(r[1].dit.led).toBe(true); expect(r[2].v.unit_desc).toBe("2FT");
  });
  it("changing a value changes every ditto below it", () => {
    const f = file([page("p1", [row(1, { room_name: "a", unit_desc: "2F" }), row(2, { room_name: "b", unit_desc: "^" }), row(3, { room_name: "c", unit_desc: "^" })])]);
    f.pages[0].rows[0].v.unit_desc = "4FT";
    expect(resolveFile(f).map((r) => r.v.unit_desc)).toEqual(["4FT", "4FT", "4FT"]);
  });
  it("ditto on the very first row resolves to null (and is flagged if required)", () => {
    const r = resolveFile(file([page("p", [row(1, { room_name: "^", unit_desc: "^" })])]));
    expect(r[0].v.room_name).toBeNull(); expect(r[0].flags.room_name).toBe("Missing");
  });
});

describe("header carry-down", () => {
  it("date, collector, floor and section carry to later pages until changed", () => {
    const f = file([
      page("p1", [row(1, { room_name: "a" })], { date: "10-2-26", collected_by: "sujan", floor: "gf", section: "opd area" }),
      page("p2", [row(1, { room_name: "b" })], {}),
      page("p3", [row(1, { room_name: "c" })], { floor: "ff", collected_by: "sayed" }),
    ]);
    const r = resolveFile(f);
    expect(r.map((x) => x.v.floor)).toEqual(["GF", "GF", "FF"]);
    expect(r.map((x) => x.collected)).toEqual(["SUJAN", "SUJAN", "SAYED"]);
    expect(r.map((x) => x.section)).toEqual(["OPD AREA", "OPD AREA", "OPD AREA"]);
    expect(r.map((x) => x.dateTxt)).toEqual(["10-2-26", "10-2-26", "10-2-26"]);
    expect(r[0].date!.toISOString().slice(0, 10)).toBe("2026-02-10");
    expect(r[0].building).toBe("TEST BUILDING - OPD AREA");
  });
  it("section_changes apply from the given row", () => {
    const f = file([page("p1", [row(1, { room_name: "a" }), row(2, { room_name: "b" }), row(3, { room_name: "c" })], { section: "WARD" }, { section_changes: [{ from_row: 2, section: "Laundry" }] })]);
    expect(resolveFile(f).map((x) => x.building)).toEqual(["TEST BUILDING - WARD", "TEST BUILDING - LAUNDRY", "TEST BUILDING - LAUNDRY"]);
  });
  it("unparsable date is flagged", () => {
    const r = resolveFile(file([page("p", [row(1, { room_name: "a" })], { date: "sometime" })]));
    expect(r[0].flags.__date).toBeTruthy();
  });
});

describe("blank constants among dittoed cells", () => {
  const base = row(1, { room_name: "a", led: "L", normal_emergency: "N", int_ext: "IN", ceiling: "gyp", height: 3, holder: "T8", cutout: "8" });
  it("copies from above and marks light blue when the row is otherwise dittoed", () => {
    const f = file([page("p", [base, row(2, { room_name: "b", led: "^", normal_emergency: "^", int_ext: "^", ceiling: null, holder: null, cutout: null })])]);
    const r = resolveFile(f)[1];
    expect(r.v.ceiling).toBe("Gypsum"); expect(r.carried.ceiling).toBe(true);
    expect(r.v.holder).toBeNull(); expect(r.v.cutout).toBeNull();      // never for holder / cut-out / tag / qty / watts / dimensions
  });
  it("does not copy when the row is written out in full", () => {
    const r = resolveFile(file([page("p", [base, row(2, { room_name: "b", led: "L", normal_emergency: "N", ceiling: null })])]))[1];
    expect(r.v.ceiling).toBeNull(); expect(r.carried.ceiling).toBeUndefined();
  });
});

describe("holder defaults", () => {
  it("T8 lamp → holder T8; BULB-E27 → E27; others stay blank", () => {
    const r = resolveFile(file([page("p", [row(1, { room_name: "a", lamp_desc: "T-8" }), row(2, { room_name: "b", lamp_desc: "BULB-E27" }), row(3, { room_name: "c", lamp_desc: "LED" })])]));
    expect(r.map((x) => x.v.holder)).toEqual(["T8", "E27", null]);
  });
});

describe("space type", () => {
  it("is derived from the (resolved) room name; manual edits win; model value is the fallback", () => {
    const f = file([page("p", [row(1, { room_name: "Meeting room", space_type: "OFFICE" }), row(2, { room_name: "^" }), row(3, { room_name: "zzz", space_type: "CLINIC" })])]);
    f.pages[0].rows[2].manual = { space_type: true } as any;
    const r = resolveFile(f);
    expect(r.map((x) => x.v.space_type)).toEqual(["MEETING ROOM", "MEETING ROOM", "CLINIC"]);
    const g = resolveFile(file([page("p", [row(1, { room_name: "zzz", space_type: "clinic" })])]));
    expect(g[0].v.space_type).toBe("CLINIC");
  });
});

describe("'same as' notes", () => {
  it("expands targets after the source block with the SAME AS remark", () => {
    const f = file([page("p", [row(1, { room_name: "Patient Room 1", fixture_qty: 2, lamp_watt: 18, dimensions: "4x5" }), row(2, { room_name: "Patient Room 1", fixture_qty: 1, lamp_watt: 9 }), row(3, { room_name: "Corridor" })], {}, {
      copy_notes: [{ source_rows: [1, 2], targets: [{ room_name: "Patient Room 2", room_tag: "MWD 2" }, { room_name: "Patient Room 3", room_tag: "MWD-3" }], text: "Patient Room 2-3 same as Patient Room 1" }],
    })]);
    const r = resolveFile(f);
    expect(r.map((x) => x.v.room_name)).toEqual(["PATIENT ROOM 1", "PATIENT ROOM 1", "PATIENT ROOM 2", "PATIENT ROOM 2", "PATIENT ROOM 3", "PATIENT ROOM 3", "CORRIDOR"]);
    expect(r[2].v.remarks).toBe("SAME AS PATIENT ROOM 1 (PATIENT ROOM 2-3 SAME AS PATIENT ROOM 1)");
    expect(r[2].v.room_tag).toBe("MWD2"); expect(r[2].v.fixture_qty).toBe(2); expect(r[3].v.lamp_watt).toBe(9);
    expect(r[2].v.dimensions).toBeNull(); expect(r[2].expanded).toBe(true);
    expect(r[2].v.space_type).toBe("WARD");
  });
  it("ignores notes whose source rows do not exist", () => {
    const r = resolveFile(file([page("p", [row(1, { room_name: "a" })], {}, { copy_notes: [{ source_rows: [9], targets: [{ room_name: "x" }], text: "" }] })]));
    expect(r).toHaveLength(1);
  });
});

describe("checks (yellow flags)", () => {
  const flags = (o: Record<string, unknown>) => resolveFile(file([page("p", [row(1, { room_name: "office", unit_desc: "2FT", led: "L", ...o })])]))[0].flags;
  it("model-uncertain fields", () => expect(flags({ uncertain: ["lamp_watt"], note: "overwritten" }).lamp_watt).toContain("overwritten"));
  it("missing qty / watts / room / unit", () => {
    const f = resolveFile(file([page("p", [row(1, { room_name: "", unit_desc: "", fixture_qty: null, lamp_watt: null })])]))[0].flags;
    for (const k of ["room_name", "unit_desc", "lamp_watt"]) expect(f[k]).toBe("Missing");   // nothing to estimate from
    expect(f.fixture_qty).toMatch(/^Estimated/);                                              // falls back to 1, highlighted
  });
  it("non-numeric numbers", () => expect(flags({ fixture_qty: "two" }).fixture_qty).toBe("Not a number"));
  it("values outside dropdown lists", () => { expect(flags({ led: "HALOGEN" }).led).toBeTruthy(); expect(flags({ voltage: 230 }).voltage).toBeTruthy(); expect(flags({ color_temp: "5500" }).color_temp).toBeTruthy(); });
  it("watts < 1 or > 1000", () => { expect(flags({ lamp_watt: 0 }).lamp_watt).toBe("Unusual wattage"); expect(flags({ lamp_watt: 1500 }).lamp_watt).toBe("Unusual wattage"); expect(flags({ lamp_watt: 36 }).lamp_watt).toBeUndefined(); });
  it("unparsable dimensions", () => { const f = flags({ dimensions: "big" }); expect(f.dimensions).toBeTruthy(); expect(f.__area).toBeTruthy(); });
  it("clean row has no flags", () => expect(flags({ led: "L", normal_emergency: "N", voltage: 220, color_temp: "6500" })).toEqual({}));
});

describe("totals", () => {
  it("counts rows, flagged cells, fixtures and kW", () => {
    const r = resolveProject([file([page("p", [row(1, { room_name: "a", unit_desc: "2FT", fixture_qty: 10, lamps_per_fixture: 2, lamp_watt: 18 }), row(2, { room_name: "b", unit_desc: "2FT", fixture_qty: 5, lamps_per_fixture: 1, lamp_watt: 60 })])])]);
    expect(totals(r)).toMatchObject({ rows: 2, fixtures: 15, kw: 0.66 });
  });
});

describe("unreadable values are estimated and highlighted", () => {
  const rows = [
    row(1, { room_name: "a", unit_desc: "2FT", lamp_desc: "T8", lamps_per_fixture: 2, lamp_watt: 18, fixture_qty: 3 }),
    row(2, { room_name: "b", unit_desc: "2FT", lamp_desc: "T8", lamps_per_fixture: 2, lamp_watt: 18, fixture_qty: 3 }),
    row(3, { room_name: "c", unit_desc: "2FT", lamp_desc: "T8", lamps_per_fixture: 2, lamp_watt: 0, fixture_qty: 4, uncertain: ["lamp_watt"], note: "smudged" }),
    row(4, { room_name: "d", unit_desc: "2FT", lamp_desc: "T8", lamps_per_fixture: null, lamp_watt: 18, fixture_qty: null }),
    row(5, { room_name: "e", unit_desc: "DOWN LIGHT", lamp_desc: "LED", lamps_per_fixture: 1, lamp_watt: 9, fixture_qty: 2, color_temp: null, uncertain: ["color_temp"] }),
  ];
  const r = resolveFile(file([page("p", rows)]));
  it("watts 0 flagged as uncertain → estimated from the same fixture type, yellow", () => {
    expect(r[2].v.lamp_watt).toBe(18); expect(r[2].estimated.lamp_watt).toBe(true);
    expect(r[2].flags.lamp_watt).toMatch(/^Estimated/); expect(r[2].flags.lamp_watt).toContain("smudged");
  });
  it("missing qty / lamps-per-fixture are estimated too", () => {
    expect(r[3].v.lamps_per_fixture).toBe(2); expect(r[3].v.fixture_qty).toBe(3);
    expect(r[3].estimated).toMatchObject({ lamps_per_fixture: true, fixture_qty: true });
  });
  it("an uncertain blank optional value is estimated (row above)", () => {
    expect(r[4].estimated.color_temp).toBeUndefined();              // nothing to estimate from → stays blank, flagged as uncertain
    expect(r[4].flags.color_temp).toBeTruthy();
  });
  it("legible values are left alone; room name and dimensions are never invented", () => {
    expect(r[0].estimated).toEqual({}); expect(r[0].flags).not.toHaveProperty("lamp_watt");
    const x = resolveFile(file([page("p", [row(1, { room_name: "a", unit_desc: "2FT" }), row(2, { room_name: "", unit_desc: "2FT", dimensions: null, uncertain: ["room_name", "dimensions"] })])]))[1];
    expect(x.v.room_name).toBeNull(); expect(x.flags.room_name).toBeTruthy(); expect(x.estimated.room_name).toBeUndefined();
  });
  it("falls back to the row above when the file has no other example", () => {
    const y = resolveFile(file([page("p", [row(1, { room_name: "a", unit_desc: "X", lamp_watt: 40 }), row(2, { room_name: "b", unit_desc: "Y", lamp_watt: 0, uncertain: ["lamp_watt"] })])]))[1];
    expect(y.v.lamp_watt).toBe(40); expect(y.estimated.lamp_watt).toBe(true);
  });
});
