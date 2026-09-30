// Pure licence logic (no Electron): lease verification, clock-tamper rule, state machine.
import { createPublicKey, verify } from "node:crypto";

export interface LeasePayload { v: 1; cid: number; did: number; end: number | null; iat: number; exp: number; ql: number | null }
export interface LicenseInfo { customer: string; endsAt: number | null; leaseExpiresAt: number; quotaMonth: number | null; quotaLeft: number | null }
export type LockReason = "locked" | "expired" | "device_revoked" | "invalid" | "lease_expired" | "clock";

export type LicenseState =
  | { kind: "unlicensed" }
  | { kind: "active"; info: LicenseInfo; offline: boolean }
  | { kind: "locked"; reason: LockReason; message: string };

export const CLOCK_TOLERANCE_S = 3600;
export const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

const b64u = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Verifies the Ed25519 signature; returns the payload or null. Expiry is checked separately. */
export function verifyLeaseToken(token: string, publicKeyB64Spki: string): LeasePayload | null {
  try {
    const [h, b, s] = token.split(".");
    if (!h || !b || !s) return null;
    const key = createPublicKey({ key: Buffer.from(publicKeyB64Spki, "base64"), format: "der", type: "spki" });
    if (!verify(null, Buffer.from(`${h}.${b}`), key, b64u(s))) return null;
    const p = JSON.parse(b64u(b).toString("utf8")) as LeasePayload;
    return p.v === 1 ? p : null;
  } catch { return null; }
}

export interface StoredLicense { lease: string; info: LicenseInfo; lastServerTime: number; lock?: { reason: LockReason; message: string } }

/**
 * Decides what state the app is in given what is on disk and the local clock.
 * `needsRefresh` = the app must reach the service before it may be used (lease expired or clock moved back).
 */
export function evaluate(stored: StoredLicense | null, publicKey: string, nowS: number): { state: LicenseState; needsRefresh: boolean } {
  if (!stored) return { state: { kind: "unlicensed" }, needsRefresh: false };
  const p = verifyLeaseToken(stored.lease, publicKey);
  if (!p) return { state: { kind: "unlicensed" }, needsRefresh: false };
  // the service refused this code earlier: stay locked (even offline / after restart) until a refresh succeeds
  if (stored.lock) return { state: { kind: "locked", ...stored.lock }, needsRefresh: true };
  if (p.end != null && nowS > p.end) return { state: { kind: "locked", reason: "expired", message: "This code has expired. Please enter a new code." }, needsRefresh: false };
  if (nowS < stored.lastServerTime - CLOCK_TOLERANCE_S)
    return { state: { kind: "locked", reason: "clock", message: "The PC clock is behind the last time the licence was checked. Connect to the internet to continue." }, needsRefresh: true };
  if (nowS > p.exp)
    return { state: { kind: "locked", reason: "lease_expired", message: "The offline grace period has ended. Connect to the internet to continue." }, needsRefresh: true };
  return { state: { kind: "active", info: { ...stored.info, endsAt: p.end, leaseExpiresAt: p.exp }, offline: false }, needsRefresh: false };
}

export function daysLeft(endsAt: number | null, nowS: number): number | null {
  return endsAt == null ? null : Math.max(0, Math.ceil((endsAt - nowS) / 86400));
}
