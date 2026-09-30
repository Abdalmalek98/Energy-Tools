// Machine fingerprint matching with hardware-change tolerance.
// The client sends `fp` (hash of all components) and `parts` (hash of each component).
// Two machines are "the same" when fp is identical OR at least 60 % of the components match.
export const MATCH_RATIO = 0.6;

export function sameMachine(a, b) {
  if (!a || !b) return false;
  if (a.fp && b.fp && a.fp === b.fp) return true;
  const pa = Array.isArray(a.parts) ? a.parts : [];
  const pb = Array.isArray(b.parts) ? b.parts : [];
  if (!pa.length || !pb.length) return false;
  const set = new Set(pb);
  const overlap = pa.filter((x) => set.has(x)).length;
  return overlap >= Math.ceil(MATCH_RATIO * Math.max(pa.length, pb.length));
}

const HEX64 = /^[0-9a-f]{64}$/;
export function validMachine(m) {
  return m && HEX64.test(m.fp ?? '') && Array.isArray(m.parts) && m.parts.length >= 3 && m.parts.length <= 12 && m.parts.every((p) => HEX64.test(p));
}
