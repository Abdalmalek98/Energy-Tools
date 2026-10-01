import { randomUUID } from "node:crypto";
import { decodeMachineId, machineHash, machineMatches, signReceipt, verifyCode, type Comps, type LicensePayload, type ReceiptPayload, type ReceiptStatus } from "@lsr/licensing";
import { createHash } from "node:crypto";
import type { Config } from "./config";
import { audit, nowIso, row, rows, run, type Db } from "./db";

export class ApiError extends Error {
  retryable?: boolean;
  constructor(public status: number, public error: string, message: string) { super(message); }
}
export interface LicenseRow {
  license_id: string; product: string; customer: string; company: string; kid: string; offline: number; max_activations: number;
  issued_at: string; not_before: string; expires_at: string | null; expires_override: string | null; expires_overridden: number;
  binding_mode: string; binding_comps: string | null; features: string; status: "active" | "suspended" | "revoked"; status_reason: string | null;
  grace_hours: number; replacement_ok: number; code_sha256: string; notes: string; created_at: string; last_seen: string | null;
}
export interface ActivationRow { activation_id: string; license_id: string; comps: string; machine_hash: string; first_seen: string; last_seen: string; app_version: string | null; active: number; ended_at: string | null; ended_reason: string | null }

export const effectiveExpiry = (l: LicenseRow) => (l.expires_overridden ? l.expires_override : l.expires_at);
export function parseComps(x: unknown): Comps {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new ApiError(400, "bad_request", "machine.comps is required.");
  const out: Comps = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (!/^[a-z0-9_]{1,24}$/.test(k) || typeof v !== "string" || !/^[0-9a-f]{16,64}$/.test(v)) throw new ApiError(400, "bad_request", "Bad machine component.");
    out[k] = v;
  }
  const n = Object.keys(out).length;
  if (n < 1 || n > 16) throw new ApiError(400, "bad_request", "Bad machine component count.");
  return out;
}
export const parseNonce = (x: unknown) => {
  if (typeof x !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(x)) throw new ApiError(400, "bad_request", "A nonce of 16-64 URL-safe characters is required.");
  return x;
};
const parseVersion = (x: unknown) => (typeof x === "string" ? x.slice(0, 32) : "");

export const licenseStatus = (l: LicenseRow, nowMs = Date.now()): ReceiptStatus => {
  if (l.status !== "active") return l.status;
  const e = effectiveExpiry(l);
  return e && nowMs >= Date.parse(e) ? "expired" : "active";
};

export function issueReceipt(cfg: Config, l: LicenseRow, activationId: string, nonce: string, status: ReceiptStatus = licenseStatus(l)): string {
  const now = Date.now();
  const payload: ReceiptPayload = {
    v: 1, kid: cfg.receiptKid, licenseId: l.license_id, activationId, product: l.product, status, nonce, issuedAt: new Date(now).toISOString(),
    validUntil: new Date(now + l.grace_hours * 3_600_000).toISOString(), expiresAt: effectiveExpiry(l), features: JSON.parse(l.features) as Record<string, unknown>,
    ...(l.status_reason && status !== "active" ? { message: l.status_reason } : {}),
  };
  return signReceipt(payload, cfg.receiptKey);
}

/** Records (or refreshes) a licence from a signed code. Status, overrides and notes of an existing record are kept. */
export function registerLicense(db: Db, p: LicensePayload, codeText: string): LicenseRow {
  const sha = createHash("sha256").update(codeText).digest("hex");
  const existing = row<LicenseRow>(db, "SELECT * FROM licenses WHERE license_id = ?", p.licenseId);
  if (!existing) {
    run(db, `INSERT INTO licenses (license_id, product, customer, company, kid, offline, max_activations, issued_at, not_before, expires_at, binding_mode, binding_comps, features, code_sha256, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      p.licenseId, p.product, p.customer, p.company, p.kid, p.offline ? 1 : 0, p.maxActivations, p.issuedAt, p.notBefore, p.expiresAt, p.machine.mode,
      p.machine.comps ? JSON.stringify(p.machine.comps) : null, JSON.stringify(p.features ?? {}), sha, nowIso());
  } else if (existing.code_sha256 !== sha && Date.parse(p.issuedAt) >= Date.parse(existing.issued_at)) {   // a re-issued code (same id, newer): refresh the signed fields
    run(db, `UPDATE licenses SET customer=?, company=?, kid=?, offline=?, max_activations=?, issued_at=?, not_before=?, expires_at=?, binding_mode=?, binding_comps=?, features=?, code_sha256=? WHERE license_id=?`,
      p.customer, p.company, p.kid, p.offline ? 1 : 0, p.maxActivations, p.issuedAt, p.notBefore, p.expiresAt, p.machine.mode, p.machine.comps ? JSON.stringify(p.machine.comps) : null, JSON.stringify(p.features ?? {}), sha, p.licenseId);
  }
  return row<LicenseRow>(db, "SELECT * FROM licenses WHERE license_id = ?", p.licenseId)!;
}

const activeActivations = (db: Db, id: string) => rows<ActivationRow>(db, "SELECT * FROM activations WHERE license_id = ? AND active = 1", id);

export function activate(db: Db, cfg: Config, body: { code: unknown; machine: unknown; appVersion: unknown; nonce: unknown }, ip: string) {
  const nonce = parseNonce(body.nonce);
  const comps = parseComps((body.machine as { comps?: unknown } | undefined)?.comps);
  if (typeof body.code !== "string" || body.code.length > 4000) throw new ApiError(400, "bad_request", "A code is required.");
  const v = verifyCode(body.code, { keys: cfg.licenseKeys, product: cfg.product, releaseBuild: !cfg.allowDevKeys });
  if (!v.ok) { audit(db, "client", "activate_refused", null, ip, { reason: v.reason }); throw new ApiError(400, v.reason, v.message); }
  const p = v.payload;
  const l = registerLicense(db, p, body.code);
  const refuse = (status: number, error: string, message: string) => { audit(db, "client", "activate_refused", l.license_id, ip, { reason: error }); throw new ApiError(status, error, message); };
  if (l.status === "revoked") refuse(403, "revoked", l.status_reason || "This licence has been revoked. Please contact support.");
  if (l.status === "suspended") refuse(403, "suspended", l.status_reason || "This licence is suspended. Please contact support.");
  const nowMs = Date.now();
  if (nowMs < Date.parse(l.not_before)) refuse(403, "not_yet_valid", `This licence is not valid until ${l.not_before.slice(0, 10)}.`);
  const exp = effectiveExpiry(l);
  if (exp && nowMs >= Date.parse(exp)) refuse(403, "expired", "License expired. Please enter a valid activation code.");
  if (l.binding_mode === "specific" && !machineMatches(JSON.parse(l.binding_comps!) as Comps, comps)) refuse(403, "machine_mismatch", "This licence is registered to a different computer.");

  const act = activeActivations(db, l.license_id);
  let mine = act.find((a) => machineMatches(JSON.parse(a.comps) as Comps, comps));
  if (!mine) {
    const authorized = rows<{ comps: string }>(db, "SELECT comps FROM authorized_machines WHERE license_id = ?", l.license_id).some((m) => machineMatches(JSON.parse(m.comps) as Comps, comps));
    if (l.replacement_ok) {
      run(db, "UPDATE activations SET active = 0, ended_at = ?, ended_reason = 'replaced' WHERE license_id = ? AND active = 1", nowIso(), l.license_id);
      run(db, "UPDATE licenses SET replacement_ok = 0 WHERE license_id = ?", l.license_id);
    } else if (!authorized && act.length >= l.max_activations) {
      refuse(409, "activation_limit", `This licence is already active on ${l.max_activations} computer${l.max_activations > 1 ? "s" : ""}. Deactivate it there first, or ask support to authorise a replacement.`);
    }
    const id = randomUUID();
    run(db, "INSERT INTO activations (activation_id, license_id, comps, machine_hash, first_seen, last_seen, app_version) VALUES (?,?,?,?,?,?,?)", id, l.license_id, JSON.stringify(comps), machineHash(comps), nowIso(), nowIso(), parseVersion(body.appVersion));
    mine = row<ActivationRow>(db, "SELECT * FROM activations WHERE activation_id = ?", id)!;
    audit(db, "client", "activate", l.license_id, ip, { activationId: id, appVersion: parseVersion(body.appVersion) });
  } else {
    run(db, "UPDATE activations SET comps = ?, machine_hash = ?, last_seen = ?, app_version = ? WHERE activation_id = ?", JSON.stringify(comps), machineHash(comps), nowIso(), parseVersion(body.appVersion), mine.activation_id);
    audit(db, "client", "reactivate", l.license_id, ip, { activationId: mine.activation_id });
  }
  run(db, "UPDATE licenses SET last_seen = ? WHERE license_id = ?", nowIso(), l.license_id);
  return { receipt: issueReceipt(cfg, l, mine.activation_id, nonce), serverTime: nowIso(), activationId: mine.activation_id, licenseId: l.license_id };
}

function loadActivation(db: Db, body: { licenseId?: unknown; activationId?: unknown }) {
  if (typeof body.licenseId !== "string" || typeof body.activationId !== "string") throw new ApiError(400, "bad_request", "licenseId and activationId are required.");
  const l = row<LicenseRow>(db, "SELECT * FROM licenses WHERE license_id = ?", body.licenseId);
  const a = row<ActivationRow>(db, "SELECT * FROM activations WHERE activation_id = ? AND license_id = ?", body.activationId, body.licenseId);
  if (!l || !a) throw new ApiError(403, "not_activated", "This computer is not activated for the licence. Please activate again.");
  return { l, a };
}

/** validate (with machine components) and heartbeat (without) both return a fresh signed receipt. Revoked/suspended/expired are returned as signed receipts so the client can lock offline. */
export function validate(db: Db, cfg: Config, body: { licenseId?: unknown; activationId?: unknown; machine?: unknown; appVersion?: unknown; nonce?: unknown }, ip: string, withMachine: boolean) {
  const nonce = parseNonce(body.nonce);
  const { l, a } = loadActivation(db, body);
  const status = licenseStatus(l);
  if (!a.active) {
    audit(db, "client", withMachine ? "validate_refused" : "heartbeat_refused", l.license_id, ip, { reason: a.ended_reason });
    throw new ApiError(403, "not_activated", a.ended_reason === "replaced" ? "This computer was replaced by another one. Please contact support." : "This computer is not activated for the licence. Please activate again.");
  }
  if (withMachine) {
    const comps = parseComps((body.machine as { comps?: unknown } | undefined)?.comps);
    if (!machineMatches(JSON.parse(a.comps) as Comps, comps)) { audit(db, "client", "validate_refused", l.license_id, ip, { reason: "machine_mismatch" }); throw new ApiError(403, "machine_mismatch", "This licence is registered to a different computer."); }
    run(db, "UPDATE activations SET comps = ?, machine_hash = ? WHERE activation_id = ?", JSON.stringify(comps), machineHash(comps), a.activation_id);
  }
  run(db, "UPDATE activations SET last_seen = ?, app_version = ? WHERE activation_id = ?", nowIso(), parseVersion(body.appVersion), a.activation_id);
  run(db, "UPDATE licenses SET last_seen = ? WHERE license_id = ?", nowIso(), l.license_id);
  return { receipt: issueReceipt(cfg, l, a.activation_id, nonce, status), serverTime: nowIso() };
}

export function deactivate(db: Db, cfg: Config, body: { licenseId?: unknown; activationId?: unknown; nonce?: unknown }, ip: string) {
  const nonce = parseNonce(body.nonce);
  const { l, a } = loadActivation(db, body);
  run(db, "UPDATE activations SET active = 0, ended_at = ?, ended_reason = 'deactivated' WHERE activation_id = ?", nowIso(), a.activation_id);
  audit(db, "client", "deactivate", l.license_id, ip, { activationId: a.activation_id });
  return { receipt: issueReceipt(cfg, l, a.activation_id, nonce, "deactivated"), serverTime: nowIso() };
}

// ---- admin operations ----
export const getLicense = (db: Db, id: string) => { const l = row<LicenseRow>(db, "SELECT * FROM licenses WHERE license_id = ?", id); if (!l) throw new ApiError(404, "not_found", "No such licence."); return l; };
export function listLicenses(db: Db) {
  return rows<LicenseRow & { active_count: number }>(db, `SELECT l.*, (SELECT COUNT(*) FROM activations a WHERE a.license_id = l.license_id AND a.active = 1) AS active_count FROM licenses l ORDER BY l.created_at DESC`)
    .map((l) => ({ ...l, effective_expires_at: effectiveExpiry(l), state: licenseStatus(l), binding_comps: undefined, code_sha256: undefined }));
}
export function adminAction(db: Db, id: string, action: string, body: Record<string, unknown>, actor = "admin", ip: string | null = null) {
  const l = getLicense(db, id);
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : null;
  switch (action) {
    case "revoke": run(db, "UPDATE licenses SET status='revoked', status_reason=? WHERE license_id=?", reason, id); break;
    case "suspend": run(db, "UPDATE licenses SET status='suspended', status_reason=? WHERE license_id=?", reason, id); break;
    case "reinstate": run(db, "UPDATE licenses SET status='active', status_reason=NULL WHERE license_id=?", id); break;
    case "renew": {
      const e = body.expiresAt;
      if (e !== null && (typeof e !== "string" || Number.isNaN(Date.parse(e)))) throw new ApiError(400, "bad_request", "expiresAt must be an ISO date or null.");
      run(db, "UPDATE licenses SET expires_override=?, expires_overridden=1 WHERE license_id=?", e as string | null, id); break;
    }
    case "extend": {
      const d = Number(body.days);
      if (!Number.isInteger(d) || d < 1 || d > 3650) throw new ApiError(400, "bad_request", "days must be 1-3650.");
      const cur = effectiveExpiry(l); const base = Math.max(cur ? Date.parse(cur) : Date.now(), Date.now());
      if (!cur && l.expires_overridden === 0 && l.expires_at === null) throw new ApiError(400, "bad_request", "This licence never expires.");
      run(db, "UPDATE licenses SET expires_override=?, expires_overridden=1 WHERE license_id=?", new Date(base + d * 86_400_000).toISOString(), id); break;
    }
    case "replacement": run(db, "UPDATE licenses SET replacement_ok=1 WHERE license_id=?", id); break;
    case "reset": run(db, "UPDATE activations SET active=0, ended_at=?, ended_reason='reset' WHERE license_id=? AND active=1", nowIso(), id); break;
    case "authorize-machine": {
      const comps = typeof body.machineId === "string" ? decodeMachineId(body.machineId) : null;
      if (!comps) throw new ApiError(400, "bad_request", "machineId must be a MID1.… string from the activation screen.");
      run(db, "INSERT INTO authorized_machines (license_id, comps, created_at) VALUES (?,?,?)", id, JSON.stringify(comps), nowIso()); break;
    }
    case "set-grace": {
      const h = Number(body.hours);
      if (!Number.isInteger(h) || h < 1 || h > 24 * 365) throw new ApiError(400, "bad_request", "hours must be 1-8760.");
      run(db, "UPDATE licenses SET grace_hours=? WHERE license_id=?", h, id); break;
    }
    case "notes": run(db, "UPDATE licenses SET notes=? WHERE license_id=?", String(body.notes ?? "").slice(0, 2000), id); break;
    case "delete": run(db, "DELETE FROM licenses WHERE license_id=?", id); break;
    default: throw new ApiError(404, "not_found", "Unknown action.");
  }
  audit(db, actor as "admin", action, id, ip, { reason, ...(action === "authorize-machine" ? {} : body) });
}
