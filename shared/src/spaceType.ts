export interface SpaceRule { keywords: string[]; type: string }

/**
 * Default keyword table (editable in Settings). First rule with a matching keyword wins, so more specific
 * rules come first. Matching is on whole words/phrases of the upper-cased room name.
 * Seeded from the prototype + brief §4.5, plus generic sets for non-health facilities.
 */
export const DEFAULT_SPACE_RULES: SpaceRule[] = [
  { keywords: ["OPERATION THEATRE", "OPERATION THEATER", "RECOVERY", "DELIVERY", "CHANGING"], type: "OPERATION THEATRE" },
  { keywords: ["PUMP", "R.O PLANT", "RO PLANT", "WATER STATION"], type: "PUMP ROOM" },
  { keywords: ["ELECTRICAL", "GENERATOR", "BATTERY", "MEDICAL GAS", "PANEL ROOM", "TRANSFORMER"], type: "ELE ROOM" },
  { keywords: ["DATA ROOM", "SERVER", "IT ROOM"], type: "IT ROOM" },
  { keywords: ["KITCHEN", "COOKING", "FOOD", "PANTRY"], type: "KITCHEN" },
  { keywords: ["BLOOD BANK", "CSSD", "LAB", "LABORATORY", "SAMPLING"], type: "LAB" },
  { keywords: ["MASJID", "MOSQUE", "PRAYER"], type: "MOSQUE" },
  { keywords: ["EXTERNAL", "EXTARNAL", "AROUND BUILDING", "BOUNDARY", "PARKING LIGHT", "POLE"], type: "OUT SIDE" },
  { keywords: ["ROOF TOP", "ROOF"], type: "ROOF" },
  { keywords: ["PARKING"], type: "PARKING" },
  { keywords: ["TOILET", "WC", "HAND WASH", "WASH ROOM", "WASHROOM", "BATHROOM", "RESTROOM"], type: "TOILET" },
  { keywords: ["CORRIDOR", "LOBBY", "ENTRANCE", "WAITING", "HALLWAY", "PASSAGE"], type: "LOBBY" },
  { keywords: ["STAIR"], type: "STAIR CASE" },
  { keywords: ["STORE", "STORAGE", "WAREHOUSE", "LINEN", "LAUNDRY", "DIRTY", "CLEAN ROOM", "FILE ROOM", "MEDICAL WASTE"], type: "STORE" },
  { keywords: ["PATIENT ROOM", "BED LIGHT", "ISOLATION", "OBSERVATION", "WARD", "BED ROOM", "BEDROOM"], type: "WARD" },
  { keywords: ["PHARMACY"], type: "PHARMACY" },
  { keywords: ["RECEPTION"], type: "RECEPTION" },
  { keywords: ["MEETING", "CONFERENCE"], type: "MEETING ROOM" },
  { keywords: ["CLASSROOM", "CLASS", "TEACHER", "TEACHERS"], type: "CLASSROOM" },
  { keywords: ["LIBRARY"], type: "LIBRARY" },
  { keywords: ["WORKSHOP"], type: "WORKSHOP" },
  { keywords: ["FACTORY", "HANGAR", "PRODUCTION"], type: "FACTORY" },
  { keywords: ["SHOP", "SHOWROOM", "STORE FRONT"], type: "SHOP" },
  { keywords: ["DINING", "CAFETERIA", "CANTEEN", "RESTAURANT"], type: "DINING AREA" },
  { keywords: ["GARDEN"], type: "GARDEN AREA" },
  { keywords: ["HALL"], type: "HALL" },
  { keywords: ["CLINIC", "X-RAY", "XRAY", "DENTAL", "DRESSING", "NURSING", "TRIAGE", "VACCINATION", "EXAMINATION", "DOCTOR", "DR "], type: "CLINIC" },
  { keywords: ["OFFICE", "MANAGER", "SUPERVISOR", "SECURITY", "ADMIN", "DIRECTOR", "SECRETARY", "ACCOUNT", "HR", "RECORD"], type: "OFFICE" },
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Returns the space type for a room name, or null when no keyword matches (caller keeps the model's value / flags it). */
export function mapSpaceType(roomName: string | null | undefined, rules: SpaceRule[] = DEFAULT_SPACE_RULES): string | null {
  if (!roomName) return null;
  const n = " " + roomName.toUpperCase().replace(/[^A-Z0-9.\- ]+/g, " ").replace(/\s+/g, " ").trim() + " ";
  for (const r of rules) {
    for (const k of r.keywords) {
      if (new RegExp(`(^|[^A-Z0-9])${esc(k.toUpperCase())}([^A-Z0-9]|$)`).test(n) || (k.length > 4 && n.includes(k.toUpperCase()))) return r.type;
    }
  }
  return null;
}
