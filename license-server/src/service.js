// Licensing business logic. Pure functions over (db, keyring) – HTTP lives in http.js.
import { sameMachine, validMachine } from './fingerprint.js';

export const PRODUCT = 'Chiller Plant Analyzer';
export const DEFAULT_FEATURES = { bmsAnalysis: true, flukeAnalysis: true, excelExport: true, plantAnalysis: true, advancedRegression: true };

export class LicenseError extends Error {
  constructor(code, message, http = 403) {
    super(message ?? code);
    this.code = code;
    this.http = http;
  }
}

const iso = (d) => new Date(d).toISOString();
const DAY = 86400000;
const parseFeatures = (s) => { try { return JSON.parse(s); } catch { return {}; } };
const parseParts = (s) => { try { return JSON.parse(s); } catch { return []; } };

export class LicenseService {
  constructor(db, keys, opts = {}) {
    this.db = db;
    this.keys = keys;
    this.checkIntervalDays = Number(opts.checkIntervalDays ?? 7);
    this.graceDays = Number(opts.graceDays ?? 14);
    this.now = opts.now ?? (() => Date.now());
  }

  // ------------------------------------------------------------------ helpers
  audit(actor, action, licenseId, detail) {
    this.db.prepare('INSERT INTO audit(at, actor, action, license_id, detail) VALUES (?,?,?,?,?)').run(iso(this.now()), actor, action, licenseId ?? null, detail ? JSON.stringify(detail) : null);
  }
  row(id) {
    const r = this.db.prepare('SELECT * FROM licenses WHERE license_id = ?').get(id);
    if (!r) throw new LicenseError('unknown_license', 'License not found', 404);
    return r;
  }
  activeActivations(id) {
    return this.db.prepare('SELECT * FROM activations WHERE license_id = ? AND deactivated_at IS NULL ORDER BY activation_id').all(id);
  }
  syncCount(id) {
    const n = this.activeActivations(id).length;
    this.db.prepare('UPDATE licenses SET current_activations = ? WHERE license_id = ?').run(n, id);
    return n;
  }
  nextId() {
    const year = new Date(this.now()).getUTCFullYear();
    const name = `license-${year}`;
    this.db.prepare('INSERT INTO counters(name, value) VALUES (?, 0) ON CONFLICT(name) DO NOTHING').run(name);
    this.db.prepare('UPDATE counters SET value = value + 1 WHERE name = ?').run(name);
    const { value } = this.db.prepare('SELECT value FROM counters WHERE name = ?').get(name);
    return `CPA-${year}-${String(value).padStart(6, '0')}`;
  }
  /** Public, camel-cased view with computed fields. */
  view(r) {
    const active = this.activeActivations(r.license_id);
    const exp = r.expiry_date;
    return {
      licenseId: r.license_id, customer: r.customer_name, company: r.company_name, email: r.email, product: r.product,
      createdAt: r.created_at, startDate: r.start_date, expiryDate: exp, status: r.status,
      effectiveStatus: r.status !== 'active' ? r.status : exp && Date.parse(exp) <= this.now() ? 'expired' : Date.parse(r.start_date) > this.now() ? 'pending' : 'active',
      remainingDays: exp ? Math.ceil((Date.parse(exp) - this.now()) / DAY) : null,
      maxActivations: r.max_activations, currentActivations: active.length, machineBinding: r.machine_binding,
      boundFp: r.bound_fp, features: parseFeatures(r.features), keyId: r.key_id, lastValidation: r.last_validation, replacedBy: r.replaced_by, notes: r.notes,
    };
  }
  tokenFor(r) {
    return this.keys.seal('CPA1', {
      v: 1, lid: r.license_id, product: r.product, customer: r.customer_name, company: r.company_name,
      iat: r.created_at, nbf: r.start_date, exp: r.expiry_date, maxAct: r.max_activations,
      bind: r.machine_binding === 'specific' ? { mode: 'specific', fp: r.bound_fp, parts: parseParts(r.bound_parts) } : { mode: r.machine_binding },
      features: parseFeatures(r.features),
    });
  }
  receipt(r, act, nonce) {
    const eff = r.status === 'active' && r.expiry_date && Date.parse(r.expiry_date) <= this.now() ? 'expired' : r.status;
    return this.keys.seal('CPR1', {
      v: 1, lid: r.license_id, status: eff, exp: r.expiry_date, nbf: r.start_date, fp: act.machine_fingerprint, parts: parseParts(act.machine_parts),
      validatedAt: iso(this.now()), checkIntervalDays: this.checkIntervalDays, graceDays: this.graceDays,
      activations: this.activeActivations(r.license_id).length, maxAct: r.max_activations, features: parseFeatures(r.features), nonce: nonce ?? null,
    });
  }

  // ------------------------------------------------------------------ admin operations
  createLicense(input, actor = 'admin') {
    const customer = String(input.customerName ?? input.customer ?? '').trim();
    if (!customer) throw new LicenseError('invalid_request', 'customerName is required', 400);
    const now = this.now();
    const start = input.startDate ? Date.parse(input.startDate) : now;
    if (!Number.isFinite(start)) throw new LicenseError('invalid_request', 'startDate is invalid', 400);
    let expiry = null;
    if (input.expiresAt) {
      expiry = Date.parse(input.expiresAt);
      if (!Number.isFinite(expiry)) throw new LicenseError('invalid_request', 'expiresAt is invalid', 400);
    } else if (input.durationDays !== undefined && input.durationDays !== null && input.durationDays !== '') {
      const d = Number(input.durationDays);
      if (!(d > 0)) throw new LicenseError('invalid_request', 'durationDays must be > 0 (omit both for a perpetual license)', 400);
      expiry = start + d * DAY;
    }
    if (expiry !== null && expiry <= start) throw new LicenseError('invalid_request', 'Expiry must be after the start date', 400);
    const binding = input.machineBinding ?? 'none';
    if (!['none', 'first', 'specific'].includes(binding)) throw new LicenseError('invalid_request', 'machineBinding must be none | first | specific', 400);
    let boundFp = null;
    let boundParts = null;
    if (binding === 'specific') {
      const m = input.machine ?? parseMachineId(input.machineId);
      if (!validMachine(m)) throw new LicenseError('invalid_request', 'A valid machine ID (from the customer\'s License page) is required for specific-machine binding', 400);
      boundFp = m.fp;
      boundParts = JSON.stringify(m.parts);
    }
    const status = input.status ?? 'active';
    if (!['active', 'suspended', 'revoked'].includes(status)) throw new LicenseError('invalid_request', 'invalid status', 400);
    const maxAct = Number(input.maxActivations ?? 1);
    if (!Number.isInteger(maxAct) || maxAct < 1) throw new LicenseError('invalid_request', 'maxActivations must be an integer ≥ 1', 400);
    const id = this.nextId();
    this.db.prepare(`INSERT INTO licenses (license_id, customer_name, company_name, email, product, created_at, start_date, expiry_date, status, max_activations, current_activations, machine_binding, bound_fp, bound_parts, features, key_id, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)`).run(
      id, customer, input.companyName ?? input.company ?? '', input.email ?? '', input.product ?? PRODUCT, iso(now), iso(start), expiry === null ? null : iso(expiry), status,
      maxAct, binding, boundFp, boundParts, JSON.stringify({ ...DEFAULT_FEATURES, ...(input.features ?? {}) }), this.keys.activeKid, input.notes ?? '');
    this.audit(actor, 'create', id, { customer, expiry: expiry && iso(expiry), maxAct, binding });
    const r = this.row(id);
    return { license: this.view(r), token: this.tokenFor(r) };
  }
  listLicenses() {
    return this.db.prepare('SELECT * FROM licenses ORDER BY created_at DESC, license_id DESC').all().map((r) => this.view(r));
  }
  getLicense(id) {
    const r = this.row(id);
    const acts = this.db.prepare('SELECT * FROM activations WHERE license_id = ? ORDER BY activation_id').all(id).map((a) => ({
      activationId: a.activation_id, machine: a.machine_fingerprint.slice(0, 12), activatedAt: a.activated_at, lastSeen: a.last_seen, deactivatedAt: a.deactivated_at, ip: a.ip_address, appVersion: a.application_version,
    }));
    return { license: this.view(r), activations: acts };
  }
  getToken(id) { return this.tokenFor(this.row(id)); }
  setStatus(id, status, actor = 'admin') {
    this.row(id);
    this.db.prepare('UPDATE licenses SET status = ? WHERE license_id = ?').run(status, id);
    this.audit(actor, status === 'active' ? 'reinstate' : status === 'revoked' ? 'revoke' : 'suspend', id);
    return this.view(this.row(id));
  }
  revoke(id, actor) { return this.setStatus(id, 'revoked', actor); }
  suspend(id, actor) { return this.setStatus(id, 'suspended', actor); }
  reinstate(id, actor) { return this.setStatus(id, 'active', actor); }
  /** Set a new expiry: `expiresAt` (absolute, or null = perpetual) or `days` counted from max(now, current expiry). */
  renew(id, { expiresAt, days, perpetual } = {}, actor = 'admin') {
    const r = this.row(id);
    let exp;
    if (perpetual) exp = null;
    else if (expiresAt) {
      exp = Date.parse(expiresAt);
      if (!Number.isFinite(exp)) throw new LicenseError('invalid_request', 'expiresAt is invalid', 400);
    } else if (Number(days) > 0) {
      const base = Math.max(this.now(), r.expiry_date ? Date.parse(r.expiry_date) : this.now());
      exp = base + Number(days) * DAY;
    } else throw new LicenseError('invalid_request', 'Provide expiresAt, days or perpetual', 400);
    if (exp !== null && exp <= Date.parse(r.start_date)) throw new LicenseError('invalid_request', 'Expiry must be after the start date', 400);
    this.db.prepare('UPDATE licenses SET expiry_date = ? WHERE license_id = ?').run(exp === null ? null : iso(exp), id);
    if (r.status === 'active') { /* nothing else */ }
    this.audit(actor, 'renew', id, { from: r.expiry_date, to: exp && iso(exp) });
    return this.view(this.row(id));
  }
  /** Extend by N days from the CURRENT expiry (even if already past). */
  extend(id, days, actor = 'admin') {
    const r = this.row(id);
    if (!r.expiry_date) throw new LicenseError('invalid_request', 'Perpetual license cannot be extended', 400);
    if (!(Number(days) > 0)) throw new LicenseError('invalid_request', 'days must be > 0', 400);
    const exp = Date.parse(r.expiry_date) + Number(days) * DAY;
    this.db.prepare('UPDATE licenses SET expiry_date = ? WHERE license_id = ?').run(iso(exp), id);
    this.audit(actor, 'extend', id, { days: Number(days), to: iso(exp) });
    return this.view(this.row(id));
  }
  update(id, patch, actor = 'admin') {
    this.row(id);
    if (patch.maxActivations !== undefined) {
      const n = Number(patch.maxActivations);
      if (!Number.isInteger(n) || n < 1) throw new LicenseError('invalid_request', 'maxActivations must be an integer ≥ 1', 400);
      this.db.prepare('UPDATE licenses SET max_activations = ? WHERE license_id = ?').run(n, id);
    }
    if (patch.notes !== undefined) this.db.prepare('UPDATE licenses SET notes = ? WHERE license_id = ?').run(String(patch.notes), id);
    if (patch.features) this.db.prepare('UPDATE licenses SET features = ? WHERE license_id = ?').run(JSON.stringify(patch.features), id);
    this.audit(actor, 'update', id, patch);
    return this.view(this.row(id));
  }
  /** New license for the same customer; the old one is revoked and linked. */
  replacement(id, overrides = {}, actor = 'admin') {
    const r = this.row(id);
    const created = this.createLicense({
      customerName: r.customer_name, companyName: r.company_name, email: r.email, product: r.product,
      startDate: r.start_date, expiresAt: r.expiry_date, maxActivations: r.max_activations, machineBinding: r.machine_binding === 'specific' ? 'first' : r.machine_binding,
      features: parseFeatures(r.features), notes: `Replacement for ${id}. ${r.notes}`.trim(), ...overrides,
    }, actor);
    this.db.prepare("UPDATE licenses SET status = 'revoked', replaced_by = ? WHERE license_id = ?").run(created.license.licenseId, id);
    this.audit(actor, 'replace', id, { by: created.license.licenseId });
    return created;
  }
  deactivateActivation(activationId, actor = 'admin') {
    const a = this.db.prepare('SELECT * FROM activations WHERE activation_id = ?').get(activationId);
    if (!a) throw new LicenseError('unknown_activation', 'Activation not found', 404);
    this.db.prepare('UPDATE activations SET deactivated_at = ? WHERE activation_id = ? AND deactivated_at IS NULL').run(iso(this.now()), activationId);
    this.syncCount(a.license_id);
    this.audit(actor, 'deactivate-machine', a.license_id, { activationId });
    return this.getLicense(a.license_id);
  }
  resetActivations(id, actor = 'admin') {
    this.row(id);
    this.db.prepare('UPDATE activations SET deactivated_at = ? WHERE license_id = ? AND deactivated_at IS NULL').run(iso(this.now()), id);
    this.db.prepare('UPDATE licenses SET bound_fp = CASE WHEN machine_binding = \'first\' THEN NULL ELSE bound_fp END, bound_parts = CASE WHEN machine_binding = \'first\' THEN NULL ELSE bound_parts END WHERE license_id = ?').run(id);
    this.syncCount(id);
    this.audit(actor, 'reset-activations', id);
    return this.getLicense(id);
  }
  /** Authorise a replacement machine: frees the old binding; optionally binds a new machine ID right away. */
  authorizeReplacement(id, machine, actor = 'admin') {
    const r = this.row(id);
    this.db.prepare('UPDATE activations SET deactivated_at = ? WHERE license_id = ? AND deactivated_at IS NULL').run(iso(this.now()), id);
    if (r.machine_binding === 'first' || r.machine_binding === 'specific') {
      if (machine) {
        if (!validMachine(machine)) throw new LicenseError('invalid_request', 'Invalid machine ID', 400);
        this.db.prepare('UPDATE licenses SET bound_fp = ?, bound_parts = ? WHERE license_id = ?').run(machine.fp, JSON.stringify(machine.parts), id);
      } else if (r.machine_binding === 'first') {
        this.db.prepare('UPDATE licenses SET bound_fp = NULL, bound_parts = NULL WHERE license_id = ?').run(id);
      } else throw new LicenseError('invalid_request', 'A new machine ID is required for a specific-machine license', 400);
    }
    this.syncCount(id);
    this.audit(actor, 'authorize-replacement', id, machine ? { fp: machine.fp.slice(0, 12) } : {});
    return this.getLicense(id);
  }

  // ------------------------------------------------------------------ client operations
  activate({ token, machine, appVersion, ip, nonce }) {
    if (!validMachine(machine)) throw new LicenseError('invalid_request', 'Invalid machine fingerprint', 400);
    let t;
    try { t = this.keys.open('CPA1', token); } catch (e) {
      throw new LicenseError(e.message === 'unknown_key' ? 'unknown_key' : 'invalid_token', 'The activation code is not valid.', 400);
    }
    const r = this.db.prepare('SELECT * FROM licenses WHERE license_id = ?').get(t.lid);
    if (!r) throw new LicenseError('unknown_license', 'This license is not known to the licensing service.', 404);
    if (r.product !== PRODUCT || t.product !== PRODUCT) throw new LicenseError('wrong_product', 'This activation code is for a different product.');
    this.checkUsable(r);
    const me = { fp: machine.fp, parts: machine.parts };
    if (r.machine_binding === 'specific' || (r.machine_binding === 'first' && r.bound_fp)) {
      if (!sameMachine(me, { fp: r.bound_fp, parts: parseParts(r.bound_parts) })) throw new LicenseError('wrong_machine', 'This license is bound to a different computer.');
    }
    const now = iso(this.now());
    const existing = this.activeActivations(r.license_id).find((a) => sameMachine(me, { fp: a.machine_fingerprint, parts: parseParts(a.machine_parts) }));
    let act;
    if (existing) {
      this.db.prepare('UPDATE activations SET last_seen = ?, machine_fingerprint = ?, machine_parts = ?, ip_address = ?, application_version = ? WHERE activation_id = ?')
        .run(now, machine.fp, JSON.stringify(machine.parts), ip ?? null, appVersion ?? null, existing.activation_id);
      act = this.db.prepare('SELECT * FROM activations WHERE activation_id = ?').get(existing.activation_id);
    } else {
      if (this.activeActivations(r.license_id).length >= r.max_activations) throw new LicenseError('max_activations', `Maximum number of activations (${r.max_activations}) reached. Deactivate another computer or contact support.`);
      const info = this.db.prepare('INSERT INTO activations (license_id, machine_fingerprint, machine_parts, activated_at, last_seen, ip_address, application_version) VALUES (?,?,?,?,?,?,?)')
        .run(r.license_id, machine.fp, JSON.stringify(machine.parts), now, now, ip ?? null, appVersion ?? null);
      act = this.db.prepare('SELECT * FROM activations WHERE activation_id = ?').get(Number(info.lastInsertRowid));
      if (r.machine_binding === 'first' && !r.bound_fp) this.db.prepare('UPDATE licenses SET bound_fp = ?, bound_parts = ? WHERE license_id = ?').run(machine.fp, JSON.stringify(machine.parts), r.license_id);
    }
    this.db.prepare('UPDATE licenses SET last_validation = ? WHERE license_id = ?').run(now, r.license_id);
    this.syncCount(r.license_id);
    this.audit('client', 'activate', r.license_id, { fp: machine.fp.slice(0, 12), appVersion });
    return { receipt: this.receipt(this.row(r.license_id), act, nonce) };
  }
  checkUsable(r) {
    if (r.status === 'revoked') throw new LicenseError('revoked', 'This license has been revoked.');
    if (r.status === 'suspended') throw new LicenseError('suspended', 'This license is suspended.');
    if (Date.parse(r.start_date) > this.now()) throw new LicenseError('not_yet_valid', `This license is not valid until ${r.start_date.slice(0, 10)}.`);
    if (r.expiry_date && Date.parse(r.expiry_date) <= this.now()) throw new LicenseError('expired', 'This license has expired.');
  }
  findActivation(r, machine) {
    const me = { fp: machine.fp, parts: machine.parts };
    return this.activeActivations(r.license_id).find((a) => sameMachine(me, { fp: a.machine_fingerprint, parts: parseParts(a.machine_parts) }));
  }
  /** Revoked / suspended / expired licences still receive a (signed) receipt so the client can lock and show why. */
  validate({ licenseId, machine, appVersion, ip, nonce }) {
    if (!validMachine(machine)) throw new LicenseError('invalid_request', 'Invalid machine fingerprint', 400);
    const r = this.row(licenseId);
    const act = this.findActivation(r, machine);
    if (!act) throw new LicenseError('not_activated', 'This computer is not activated for this license (it may have been deactivated). Please activate again.');
    const now = iso(this.now());
    this.db.prepare('UPDATE activations SET last_seen = ?, machine_fingerprint = ?, machine_parts = ?, ip_address = ?, application_version = ? WHERE activation_id = ?')
      .run(now, machine.fp, JSON.stringify(machine.parts), ip ?? null, appVersion ?? null, act.activation_id);
    this.db.prepare('UPDATE licenses SET last_validation = ? WHERE license_id = ?').run(now, r.license_id);
    const fresh = this.db.prepare('SELECT * FROM activations WHERE activation_id = ?').get(act.activation_id);
    return { receipt: this.receipt(this.row(r.license_id), fresh, nonce) };
  }
  heartbeat({ licenseId, machine, appVersion, ip }) {
    const r = this.row(licenseId);
    const act = this.findActivation(r, machine);
    if (!act) throw new LicenseError('not_activated', 'This computer is not activated for this license.');
    const now = iso(this.now());
    this.db.prepare('UPDATE activations SET last_seen = ?, ip_address = ?, application_version = ? WHERE activation_id = ?').run(now, ip ?? null, appVersion ?? null, act.activation_id);
    return { ok: true, status: this.view(r).effectiveStatus };
  }
  deactivate({ licenseId, machine }) {
    const r = this.row(licenseId);
    const act = this.findActivation(r, machine);
    if (act) {
      this.db.prepare('UPDATE activations SET deactivated_at = ? WHERE activation_id = ?').run(iso(this.now()), act.activation_id);
      this.syncCount(r.license_id);
      this.audit('client', 'deactivate', r.license_id, { activationId: act.activation_id });
    }
    return { ok: true };
  }
}

/** Machine ID string shown to customers: `MID1.<base64url(JSON {fp, parts})>` */
export function parseMachineId(s) {
  if (!s) return null;
  try {
    const m = String(s).trim().replace(/\s+/g, '');
    if (!m.startsWith('MID1.')) return null;
    return JSON.parse(Buffer.from(m.slice(5), 'base64url').toString('utf8'));
  } catch { return null; }
}
