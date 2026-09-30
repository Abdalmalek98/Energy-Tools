import { z } from "zod";

/** Model output for one page (brief §4.4). Lenient on types the model often gets loose (numbers as strings). */
const num = z.union([z.number(), z.string()]).nullable().optional();
const str = z.string().nullable().optional();

export const ModelRow = z.object({
  row: z.number().int(),
  room_name: str,
  space_type: str,
  floor: str,
  room_tag: str,
  led: str,
  normal_emergency: str,
  unit_desc: str,
  lamp_desc: str,
  fixture_qty: num,
  lamps_per_fixture: num,
  lamp_watt: num,
  color_temp: num,
  voltage: num,
  int_ext: str,
  holder: str,
  mounted: str,
  cutout: str,
  dimmable: str,
  sensors: str,
  ceiling: str,
  height: num,
  switch_status: str,
  dimensions: str,
  remarks: str,
  uncertain: z.array(z.string()).default([]),
  note: str,
});

export const ModelPage = z.object({
  header: z.object({
    building_name: str, section: str, floor: str, collected_by: str,
    date: str, page_label: str, upright: z.boolean().optional(),
  }),
  section_changes: z.array(z.object({ from_row: z.number().int(), section: z.string() })).default([]),
  rows: z.array(ModelRow),
  copy_notes: z.array(z.object({
    source_rows: z.array(z.number().int()),
    targets: z.array(z.object({ room_name: str, room_tag: str })),
    text: str,
  })).default([]),
});

export type ModelPage = z.infer<typeof ModelPage>;
export type ModelRow = z.infer<typeof ModelRow>;

export type Quality = "best" | "fast";
export const ErrorCodes = [
  "invalid", "locked", "expired", "device_limit", "device_revoked", "quota",
  "upstream", "too_large", "bad_request", "rate_limited", "unauthorized",
] as const;
export type ErrorCode = (typeof ErrorCodes)[number];
