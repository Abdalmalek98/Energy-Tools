import type { Env } from "./env";
import { hashCode, normalizeCode, signLease, verifyLease, type LeasePayload } from "./crypto";
import { audit, monthKey, now } from "./util";

export interface CodeRow {
  id: number; code_hash: string; last5: string; customer: string; notes: string;
  status: "active" | "locked"; locked_reason: string | null; valid_days: number | null;
  ends_at: number | null; max_devices: number; lease_hours: number; page_quota_month: number | null;
  created_at: number; first_activated_at: number | null; last_seen_at: number | null;
}
export class LicenseError extends Error {
  constructor(public code: "invalid" | "locked" | "expired" | "device_limit" | "device_revoked" | "quota", message: string, public status = 403) {
    super(message);
  }
}

export async function pagesUsed(db: D1Database, codeId: number): Promise<number> {
  const r = await db.prepare("SELECT pages FROM quota_counters WHERE code_id=? AND month=?").bind(codeId, monthKey()).first<{ pages: number }>();
  return r?.pages ?? 0;
}
export async function quotaLeft(db: D1Database, c: CodeRow): Promise<number | null> {
  if (c.page_quota_month == null) return null;
  return Math.max(0, c.page_quota_month - (await pagesUsed(db, c.id)));
}

/** Throws LicenseError if the code cannot be used right now. */
export function assertUsable(c: CodeRow) {
  if (c.status === "locked") throw new LicenseError("locked", c.locked_reason ? `This code has been locked: ${c.locked_reason}` : "This code has been locked. Please contact your supplier.");
  if (c.ends_at != null && now() > c.ends_at) throw new LicenseError("expired", "This code has expired. Please enter a new code.");
}

export async function issueLease(env: Env, c: CodeRow, deviceId: number) {
  const iat = now();
  const ql = await quotaLeft(env.DB, c);
  const payload: LeasePayload = { v: 1, cid: c.id, did: deviceId, end: c.ends_at, iat, exp: iat + c.lease_hours * 3600, ql };
  return {
    lease: await signLease(payload, env.LEASE_PRIVATE_KEY),
    license: { customer: c.customer, endsAt: c.ends_at, leaseExpiresAt: payload.exp, quotaMonth: c.page_quota_month, quotaLeft: ql },
    serverTime: iat,
  };
}

export async function activate(env: Env, rawCode: string, deviceHash: string, appVersion: string, ip: string) {
  const norm = normalizeCode(rawCode);
  if (!norm) throw new LicenseError("invalid", "That code is not valid. Check it and try again.", 404);
  const c = await env.DB.prepare("SELECT * FROM codes WHERE code_hash=?").bind(await hashCode(norm)).first<CodeRow>();
  if (!c) {
    await audit(env.DB, "client", "activate_failed", null, ip, { reason: "invalid" });
    throw new LicenseError("invalid", "That code is not valid. Check it and try again.", 404);
  }
  try { assertUsable(c); } catch (e) {
    await audit(env.DB, "client", "activate_failed", c.id, ip, { reason: (e as LicenseError).code, last5: c.last5 });
    throw e;
  }
  const t = now();
  // atomic device-limit: insert only if a slot is free or this device is already bound
  await env.DB.prepare(
    `INSERT INTO devices (code_id, device_hash, first_seen, last_seen, app_version)
     SELECT ?1, ?2, ?3, ?3, ?4 WHERE (SELECT COUNT(*) FROM devices WHERE code_id=?1) < ?5
     ON CONFLICT(code_id, device_hash) DO NOTHING`,
  ).bind(c.id, deviceHash, t, appVersion, c.max_devices).run();
  const dev = await env.DB.prepare("SELECT id FROM devices WHERE code_id=? AND device_hash=?").bind(c.id, deviceHash).first<{ id: number }>();
  if (!dev) {
    await audit(env.DB, "client", "activate_failed", c.id, ip, { reason: "device_limit", last5: c.last5 });
    throw new LicenseError("device_limit", `This code is already active on ${c.max_devices} PC${c.max_devices > 1 ? "s" : ""}. Deactivate it on another PC or contact your supplier.`, 409);
  }
  await env.DB.prepare("UPDATE devices SET last_seen=?, app_version=? WHERE id=?").bind(t, appVersion, dev.id).run();
  // first activation: start the validity clock
  if (c.first_activated_at == null) {
    const ends = c.ends_at ?? (c.valid_days != null ? t + c.valid_days * 86400 : null);
    await env.DB.prepare("UPDATE codes SET first_activated_at=?, ends_at=? WHERE id=? AND first_activated_at IS NULL").bind(t, ends, c.id).run();
    c.first_activated_at = t; c.ends_at = ends;
  }
  await env.DB.prepare("UPDATE codes SET last_seen_at=? WHERE id=?").bind(t, c.id).run();
  await audit(env.DB, "client", "activate", c.id, ip, { last5: c.last5, deviceId: dev.id });
  return issueLease(env, c, dev.id);
}

/** Verifies the lease signature, then loads the authoritative DB state (lock / expiry / device binding). */
export async function authorize(env: Env, leaseToken: unknown) {
  const p = typeof leaseToken === "string" ? await verifyLease(leaseToken, env.LEASE_PUBLIC_KEY) : null;
  if (!p) throw new LicenseError("invalid", "Licence token is not valid. Please activate again.", 401);
  const c = await env.DB.prepare("SELECT * FROM codes WHERE id=?").bind(p.cid).first<CodeRow>();
  if (!c) throw new LicenseError("invalid", "This code no longer exists. Please enter a new code.", 401);
  assertUsable(c);
  const dev = await env.DB.prepare("SELECT id FROM devices WHERE id=? AND code_id=?").bind(p.did, c.id).first<{ id: number }>();
  if (!dev) throw new LicenseError("device_revoked", "This PC is no longer activated for the code. Please activate again.", 403);
  return { c, deviceId: dev.id };
}

export async function refresh(env: Env, leaseToken: unknown, ip: string) {
  const { c, deviceId } = await authorize(env, leaseToken);
  const t = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE devices SET last_seen=? WHERE id=?").bind(t, deviceId),
    env.DB.prepare("UPDATE codes SET last_seen_at=? WHERE id=?").bind(t, c.id),
  ]);
  void ip;
  return issueLease(env, c, deviceId);
}

export async function deactivate(env: Env, leaseToken: unknown, ip: string) {
  const p = typeof leaseToken === "string" ? await verifyLease(leaseToken, env.LEASE_PUBLIC_KEY) : null;
  if (!p) throw new LicenseError("invalid", "Licence token is not valid.", 401);
  await env.DB.prepare("DELETE FROM devices WHERE id=? AND code_id=?").bind(p.did, p.cid).run();
  await audit(env.DB, "client", "deactivate", p.cid, ip, { deviceId: p.did });
}
