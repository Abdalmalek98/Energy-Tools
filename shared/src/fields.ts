export type DataKey =
  | "floor" | "room_name" | "space_type" | "room_tag" | "led" | "normal_emergency" | "unit_desc" | "lamp_desc"
  | "fixture_qty" | "lamps_per_fixture" | "lamp_watt" | "color_temp" | "voltage" | "int_ext" | "holder" | "mounted"
  | "cutout" | "dimmable" | "sensors" | "ceiling" | "dimensions" | "height" | "switch_status" | "remarks";

/** key, label — order = review-grid column order (ported from the prototype's FIELDS). */
export const FIELDS: ReadonlyArray<readonly [DataKey, string]> = [
  ["floor", "Floor"], ["room_name", "Room name"], ["space_type", "Space type"], ["room_tag", "Tag"],
  ["led", "LED / Non"], ["normal_emergency", "Normal / Emerg."], ["unit_desc", "Unit description"], ["lamp_desc", "Lamp description"],
  ["fixture_qty", "Fix. qty"], ["lamps_per_fixture", "Lamp / fix"], ["lamp_watt", "Load W"],
  ["color_temp", "CCT"], ["voltage", "Volt"], ["int_ext", "Int / Ext"], ["holder", "Holder"], ["mounted", "Mounted"],
  ["cutout", "Cut-out"], ["dimmable", "Dim."], ["sensors", "Sensor"], ["ceiling", "Ceiling"], ["dimensions", "L × W m"],
  ["height", "Ht m"], ["switch_status", "Switch"], ["remarks", "Remarks"],
];
export const DATA_KEYS: DataKey[] = FIELDS.map((f) => f[0]);
export const labelOf = (k: string) => FIELDS.find((f) => f[0] === k)?.[1] ?? k;

/** Excel column letter → data key (template layout, brief §4.6). */
export const COLKEY: Record<string, DataKey> = {
  F: "floor", G: "room_name", H: "space_type", I: "room_tag", J: "led", K: "normal_emergency", L: "unit_desc", M: "lamp_desc",
  N: "fixture_qty", O: "lamps_per_fixture", Q: "lamp_watt", R: "color_temp", S: "voltage", T: "int_ext", U: "holder", V: "mounted",
  W: "cutout", X: "dimmable", Y: "sensors", Z: "ceiling", AB: "height", AC: "switch_status", AD: "remarks",
};
export const colOf = (k: string): string => Object.entries(COLKEY).find(([, kk]) => kk === k)?.[0] ?? (k === "__area" ? "AA" : k === "__date" ? "B" : "");

/** Columns whose blank cell is copied from the row above when the surveyor was dittoing the row (brief §4.5). */
export const CONSTANT_KEYS: DataKey[] = ["led", "normal_emergency", "color_temp", "voltage", "int_ext", "mounted", "dimmable", "sensors", "ceiling", "height", "switch_status"];
