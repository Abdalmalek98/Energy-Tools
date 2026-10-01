import { verifyCode, verifyReceipt } from "./codec";
import { machineHash, machineMatches } from "./fingerprint";
import type { Comps, Keyring, LicensePayload, ReceiptPayload } from "./types";

/** What the app keeps (encrypted) on disk. Everything in it is re-verified on every status query. */
export interface StoredLicense {
  code: string;                    // the activation code, exactly as signed
  activatedAt: string;
  machineRef: Comps;               // hashed components of the machine it was activated on
  activationId?: string;           // issued by the server
  receipt?: string;                // latest verified server receipt
  lastValidatedAt?: string;        // server time of the last successful validation
  highWater: string;               // latest time ever observed (clock-rollback protection)
}

export type LicenseStatus =
  | "unlicensed" | "active" | "warning" | "expired" | "revoked" | "suspended" | "invalid" | "wrong_machine" | "not_yet_valid" | "validation_required";

export interface LicenseInfo {
  licenseId: string; product: string; customer: string; company: string; issuedAt: string; activatedAt: string;
  expiresAt: string | null; daysRemaining: number | null; machine: string; lastValidatedAt: string | null; offline: boolean;
  features: Record<string, unknown>;
}
export interface Evaluation {
  status: LicenseStatus;
  /** true when the app may be used */
  usable: boolean;
  message: string;
  warning: string | null;
  info: LicenseInfo | null;
  clockRollback: boolean;
  effectiveNowMs: number;
}
export interface EvalContext {
  keys: Keyring; product: string; nowMs: number; current: Comps; releaseBuild: boolean;
  /** show a warning when the last validation is older than this (default 24 h) */
  validateIntervalMs?: number;
  /** show a warning when the offline grace period ends within this long (default 48 h) */
  warnBeforeLockMs?: number;
}
const HOUR = 3_600_000, DAY = 86_400_000;
export const CLOCK_TOLERANCE_MS = HOUR;
export const EXPIRED_MESSAGE = "License expired. Please enter a valid activation code.";

const bad = (status: LicenseStatus, message: string, effectiveNowMs: number, info: LicenseInfo | null = null, clockRollback = false): Evaluation =>
  ({ status, usable: false, message, warning: null, info, clockRollback, effectiveNowMs });

export function evaluate(stored: StoredLicense | null, c: EvalContext): Evaluation {
  if (!stored) return bad("unlicensed", "Enter your activation code to start.", c.nowMs);
  const high = Date.parse(stored.highWater);
  const effNow = Math.max(c.nowMs, Number.isNaN(high) ? 0 : high);       // a rolled-back clock can never extend a licence
  const rollback = !Number.isNaN(high) && c.nowMs < high - CLOCK_TOLERANCE_MS;

  const v = verifyCode(stored.code, { keys: c.keys.license, product: c.product, nowMs: effNow, releaseBuild: c.releaseBuild });
  if (!v.ok) return bad("invalid", v.message, effNow, null, rollback);
  const p: LicensePayload = v.payload;

  let receipt: ReceiptPayload | null = null;
  if (stored.receipt) {
    const r = verifyReceipt(stored.receipt, { keys: c.keys.receipt, product: c.product, licenseId: p.licenseId, nowMs: effNow, releaseBuild: c.releaseBuild });
    if (!r.ok) return bad("invalid", "The saved licence data is damaged. Please activate again.", effNow, null, rollback);
    receipt = r.payload;
  }

  const exp = receipt ? receipt.expiresAt : p.expiresAt;                       // the server is authoritative for renewals/extensions
  const days = exp ? Math.ceil((Date.parse(exp) - effNow) / DAY) : null;
  const info: LicenseInfo = {
    licenseId: p.licenseId, product: p.product, customer: p.customer, company: p.company, issuedAt: p.issuedAt, activatedAt: stored.activatedAt,
    expiresAt: exp, daysRemaining: days === null ? null : Math.max(0, days), machine: machineHash(stored.machineRef).slice(0, 12).toUpperCase(),
    lastValidatedAt: stored.lastValidatedAt ?? null, offline: p.offline, features: receipt?.features && Object.keys(receipt.features).length ? receipt.features : p.features,
  };

  if (effNow < Date.parse(p.notBefore)) return bad("not_yet_valid", `This licence is not valid until ${p.notBefore.slice(0, 10)}.`, effNow, info, rollback);

  // machine binding: the code's own machine (specific) or the machine it was first activated on; copying the file elsewhere fails here
  const ref = p.machine.mode === "specific" ? p.machine.comps! : p.machine.mode === "first" ? stored.machineRef : null;
  if (ref && !machineMatches(ref, c.current)) return bad("wrong_machine", "This licence is registered to a different computer.", effNow, info, rollback);
  if (p.machine.mode === "none" && p.offline) return bad("invalid", "An offline licence must be tied to one computer.", effNow, info, rollback);

  if (receipt) {
    if (receipt.status === "revoked") return bad("revoked", receipt.message || "This licence has been revoked. Please contact support.", effNow, info, rollback);
    if (receipt.status === "suspended") return bad("suspended", receipt.message || "This licence is suspended. Please contact support.", effNow, info, rollback);
    if (receipt.status === "deactivated") return bad("invalid", "This computer was deactivated for the licence. Please activate again.", effNow, info, rollback);
    if (receipt.status === "expired") return bad("expired", EXPIRED_MESSAGE, effNow, info, rollback);
  }
  if (exp && effNow >= Date.parse(exp)) return bad("expired", EXPIRED_MESSAGE, effNow, info, rollback);

  let warning: string | null = null;
  if (!p.offline) {                                                              // online licences must keep validating
    if (!receipt) return bad("validation_required", "This licence must be validated online. Please connect to the internet.", effNow, info, rollback);
    const until = Date.parse(receipt.validUntil);
    if (effNow > until) return bad("validation_required", "The offline grace period has ended. Please connect to the internet to validate your licence.", effNow, info, rollback);
    const last = Date.parse(stored.lastValidatedAt ?? receipt.issuedAt);
    const left = until - effNow;
    if (effNow - last > (c.validateIntervalMs ?? 24 * HOUR) || left < (c.warnBeforeLockMs ?? 48 * HOUR))
      warning = `Licence validation is overdue. Please connect to the internet within ${Math.max(1, Math.ceil(left / DAY))} day(s) to keep using the app.`;
    if (rollback) warning = "The computer clock is behind. Please connect to the internet to validate your licence.";
  }
  return { status: warning ? "warning" : "active", usable: true, message: warning ? "Licence valid (validation overdue)." : "Licence valid.", warning, info, clockRollback: rollback, effectiveNowMs: effNow };
}

/** Returns the new high-water mark: never moves backwards. */
export const advanceHighWater = (stored: { highWater: string }, nowMs: number, serverTimeMs?: number) =>
  new Date(Math.max(Date.parse(stored.highWater) || 0, nowMs, serverTimeMs ?? 0)).toISOString();
