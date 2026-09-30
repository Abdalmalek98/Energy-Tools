import { describe, expect, it } from "vitest";
import { mapSpaceType } from "../src";

describe("space type from room name (brief §4.5 + generic)", () => {
  const cases: [string, string | null][] = [
    ["TOILET", "TOILET"], ["MALE WC", "TOILET"], ["HAND WASH", "TOILET"],
    ["CORRIDOR", "LOBBY"], ["MAIN ENTRANCE", "LOBBY"], ["WAITING AREA", "LOBBY"],
    ["LINEN STORE", "STORE"], ["WAREHOUSE", "STORE"], ["DIRTY UTILITY", "STORE"], ["CLEAN ROOM", "STORE"],
    ["PATIENT ROOM-3", "WARD"], ["BED LIGHT", "WARD"], ["ISOLATION", "WARD"], ["OBSERVATION", "WARD"],
    ["OPERATION THEATRE", "OPERATION THEATRE"], ["RECOVERY", "OPERATION THEATRE"],
    ["PUMP ROOM", "PUMP ROOM"], ["R.O PLANT", "PUMP ROOM"], ["WATER STATION", "PUMP ROOM"],
    ["ELECTRICAL ROOM", "ELE ROOM"], ["GENERATOR", "ELE ROOM"], ["MEDICAL GAS", "ELE ROOM"],
    ["KITCHEN", "KITCHEN"], ["FOOD STORE", "KITCHEN"],
    ["LAB", "LAB"], ["BLOOD BANK", "LAB"], ["CSSD", "LAB"],
    ["MASJID", "MOSQUE"], ["EXTERNAL", "OUT SIDE"], ["AROUND BUILDING", "OUT SIDE"],
    ["DR CLINIC-2", "CLINIC"], ["MANAGER OFFICE", "OFFICE"], ["SECURITY ROOM", "OFFICE"],
    ["CLASS 4", "CLASSROOM"], ["LIBRARY", "LIBRARY"], ["WORKSHOP", "WORKSHOP"], ["SHOWROOM", "SHOP"],
    ["مصلى", null], ["MYSTERY", null], ["", null], [null as any, null],
  ];
  it.each(cases)("%s → %s", (name, type) => expect(mapSpaceType(name)).toBe(type));
  it("uses a custom table when supplied", () => expect(mapSpaceType("CAFE", [{ keywords: ["CAFE"], type: "DINING AREA" }])).toBe("DINING AREA"));
  it("does not match keywords inside other words", () => expect(mapSpaceType("SLAB AREA")).toBeNull());
});
