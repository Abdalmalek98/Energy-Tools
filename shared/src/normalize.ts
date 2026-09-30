import type { DataKey } from "./fields";

export type Cell = string | number | null;

const SUPERSCRIPT: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
const up = (v: unknown) => String(v).trim().toUpperCase();

/**
 * Safety-net normaliser applied after the model (ported from the prototype's norm(), extended with the
 * short forms from the brief). Returns a canonical template value, or the input unchanged if unrecognised.
 */
export function norm(key: DataKey | string, v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    v = v.trim();
    if (v === "") return null;
    if (/^(\^|"|”|“|″|〃|,,?|\/+|-do-|do)$/i.test(v as string)) return "^";
  }
  const raw = typeof v === "number" ? v : String(v);
  let s = up(v).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => SUPERSCRIPT[c]);
  const num = () => {
    const n = Number(String(v).replace(/[^\d.]/g, ""));
    return /\d/.test(String(v)) && isFinite(n) ? n : (raw as Cell);
  };
  switch (key) {
    case "led":
      if (/^N(ON)?[\s-]*L?(ED)?$|^NON|^N0N|^NL$/.test(s)) return "Non-LED";
      if (/^L(ED)?$/.test(s)) return "LED";
      return raw;
    case "normal_emergency":
      if (/^N(O|OR(MAL)?)?$/.test(s)) return "Normal";
      if (/^E(M|MR|MERG\w*)?$/.test(s)) return "Emergency";
      return raw;
    case "color_temp": {
      const m = s.match(/^(\d{4})\s*K?$/);
      if (m) return m[1] + "K";
      if (/^65$/.test(s)) return "6500K";
      return raw;
    }
    case "int_ext":
      if (/^IN/.test(s)) return "Internal";
      if (/^(EX|OUT)/.test(s)) return "External";
      return raw;
    case "mounted": {
      const t = s.replace(/\./g, "");
      if (/^(S|SM|SURFACE( MOUNTED)?)$/.test(t)) return "Surface";
      if (/^(R|CR|RC|REC|RECESSED)$/.test(t)) return "Recessed";
      if (/^(W|WM|WALL|WALL[- ]?MOUNTED)$/.test(t)) return "Wall-Mounted";
      if (/^SUSP/.test(t)) return "Suspended";
      if (/^FLOOR/.test(t)) return "Floor Mounted";
      return raw;
    }
    case "dimmable":
    case "sensors":
      if (/^(N|NO)$/.test(s)) return "No";
      if (/^(Y|YES)$/.test(s)) return "Yes";
      return raw;
    case "ceiling":
      if (/^(N|NO|NONE|NO CEILING)$/.test(s)) return "No Ceiling";
      if (/^(G|GYP|GYPSUM)/.test(s)) return "Gypsum";
      if (/^(P|PANEL|PANNEL|TILE|60\s*[X×*/]\s*60|CEILING TILE)/.test(s)) return "Panel";
      if (/^OTHER/.test(s)) return "Others";
      return raw;
    case "switch_status":
      if (/^(GOOD|G|OK)$/.test(s)) return "Good";
      if (/REPLAC/.test(s)) return "To be replaced";
      if (/NO SWITCH/.test(s)) return "No Switch";
      if (/NOT WORK/.test(s)) return "Not Working";
      return raw;
    case "unit_desc":
      return s
        .replace(/^([24])\s*(F|FT|')$/, "$1FT")
        .replace(/^DOWA?N( LED)?$/, "DOWN LIGHT")
        .replace(/^DOWA?N\s*(LIGHT\s*)?S[QU]+ARE?$/, "DOWN LIGHT SQUARE")
        .replace(/^60\s*[X×*/]\s*60(\s*(PANEL|PANNEL))?$/, "60X60 PANEL")
        .replace(/^(PANNEL|PANEL)\s*60\s*[X×*/]\s*60$/, "60X60 PANEL")
        .replace(/^PANNEL$/, "PANEL");
    case "lamp_desc":
    case "holder":
      return s.replace(/^T-(\d)$/, "T$1").replace(/^E-(\d{2})$/, "E$1").replace(/^PANNEL$/, "PANEL").replace(/^SQARE LED$/, "SQUARE LED");
    case "cutout": {
      const c = String(v).trim().toUpperCase().replace(/\s+/g, "");
      return /^\d+(\.\d+)?[X×*/]\d+(\.\d+)?$/.test(c) ? c.replace(/[×*/]/g, "X") : c;
    }
    case "room_name":
    case "space_type":
    case "remarks":
    case "floor":
      return s;
    case "room_tag":
      return s.replace(/\s+/g, "");
    case "fixture_qty":
    case "lamps_per_fixture":
    case "lamp_watt":
    case "voltage":
    case "height":
      return num();
    case "dimensions":
      return String(v).replace(/[×*X]/g, "x").replace(/\s+/g, "");
    default:
      return typeof v === "string" ? v : String(v);
  }
}

/** Row-level fixes that need two columns (swapped "Pannel"/"60/60"). */
export function normRow(v: Record<string, Cell>): void {
  const isPanelWord = (x: Cell) => typeof x === "string" && /^(PANEL|PANNEL)$/i.test(x);
  const is6060 = (x: Cell) => typeof x === "string" && /^60\s*[X×*/]\s*60$/i.test(x);
  if ((isPanelWord(v.unit_desc) && is6060(v.lamp_desc)) || (is6060(v.unit_desc) && isPanelWord(v.lamp_desc)) || (is6060(v.unit_desc) && v.lamp_desc == null)) {
    v.unit_desc = "60X60 PANEL";
    v.lamp_desc = "PANEL";
  }
}

export function areaOf(d: unknown): number | null {
  if (!d) return null;
  const m = String(d).match(/(\d+(?:\.\d+)?)\s*[x×*X]\s*(\d+(?:\.\d+)?)/);
  return m ? Math.round(parseFloat(m[1]) * parseFloat(m[2]) * 100) / 100 : null;
}

export type DateFormat = "DMY" | "MDY";
/** Parses a sheet date such as "10-2-26", "15-02-2026", "2026/2/10". Returns a UTC-midnight Date or null. */
export function parseDate(txt: unknown, fmt: DateFormat = "DMY"): Date | null {
  if (!txt) return null;
  const m = String(txt).match(/(\d{1,4})\s*[-\/.\s]\s*(\d{1,2})\s*[-\/.\s]\s*(\d{2,4})/);
  if (!m) return null;
  const a = +m[1], b = +m[2], c = +m[3];
  let y: number, mo: number, d: number;
  if (m[1].length === 4) { y = a; mo = b; d = c; }
  else { y = c < 100 ? 2000 + c : c; if (fmt === "MDY") { mo = a; d = b; } else { d = a; mo = b; } }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null; // rejects 31 Feb etc.
}
export const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
