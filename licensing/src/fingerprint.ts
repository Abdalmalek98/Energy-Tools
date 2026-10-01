import { createHash } from "node:crypto";
import { b64u, unb64u } from "./codec";
import { MACHINE_ID_PREFIX, type Comps } from "./types";

export const MATCH_THRESHOLD = 0.6;
export const hashComponent = (name: string, value: string, salt: string) => createHash("sha256").update(`${salt}|${name}|${value.trim().toLowerCase()}`).digest("hex").slice(0, 32);

/** Fraction of the REFERENCE components that also match in the current machine (components missing now count as mismatches). */
export function matchRatio(reference: Comps, current: Comps): number {
  const names = Object.keys(reference);
  if (!names.length) return 0;
  return names.filter((n) => current[n] !== undefined && current[n] === reference[n]).length / names.length;
}
/**
 * ≥ 60 % of the reference components must match. With fewer than 3 reference components there is no room for drift,
 * so every one must match (otherwise a single changed value could still pass 60 % rounding).
 */
export function machineMatches(reference: Comps, current: Comps, threshold = MATCH_THRESHOLD): boolean {
  const n = Object.keys(reference).length;
  if (n === 0) return false;
  const r = matchRatio(reference, current);
  return n < 3 ? r === 1 : r >= threshold;
}
/** Stable identifier of a component set (what the server stores). */
export const machineHash = (c: Comps) => createHash("sha256").update(JSON.stringify(Object.keys(c).sort().map((k) => [k, c[k]]))).digest("hex");

/** "MID1.<base64url json>": what a customer sends the owner to get a machine-bound code. */
export const encodeMachineId = (comps: Comps) => `${MACHINE_ID_PREFIX}.${b64u(JSON.stringify({ v: 1, comps }))}`;
export function decodeMachineId(text: string): Comps | null {
  const t = text.replace(/\s+/g, "");
  const [p, body, ...rest] = t.split(".");
  if (p !== MACHINE_ID_PREFIX || !body || rest.length) return null;
  try {
    const j = JSON.parse(unb64u(body).toString("utf8")) as { v?: number; comps?: Comps };
    if (j.v !== 1 || !j.comps || typeof j.comps !== "object") return null;
    const out: Comps = {};
    for (const [k, v] of Object.entries(j.comps)) { if (!/^[a-z0-9_]{1,24}$/.test(k) || typeof v !== "string" || !/^[0-9a-f]{16,64}$/.test(v)) return null; out[k] = v; }
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}
