import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { openDb } from '../src/db.js';
import { KeyRing } from '../src/keys.js';
import { LicenseService, LicenseError } from '../src/service.js';

const DEV_PEM = readFileSync(new URL('../dev/dev-private-key.pem', import.meta.url), 'utf8');
const DAY = 86400000;
const T0 = Date.parse('2026-09-30T00:00:00Z');
const h = (s) => createHash('sha256').update(s).digest('hex');
const machine = (tag, n = 5) => { const parts = Array.from({ length: n }, (_, i) => h(`${tag}-part${i}`)); return { fp: h(parts.join('|')), parts }; };
const M1 = machine('A'), M2 = machine('B');

function setup(opts = {}) {
  const clock = { now: T0 };
  const keys = new KeyRing({ 'dev-1': DEV_PEM }, 'dev-1');
  const svc = new LicenseService(openDb(':memory:'), keys, { now: () => clock.now, ...opts });
  return { svc, clock, keys };
}
const create = (svc, o = {}) => svc.createLicense({ customerName: 'ABC', companyName: 'ABC Co', durationDays: 365, ...o });
const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof LicenseError, String(e)); return e.code; } assert.fail('expected LicenseError'); };

test('creates licenses with sequential ids, expiry, perpetual and feature flags', () => {
  const { svc } = setup();
  const a = create(svc, { durationDays: 30 });
  const b = create(svc, { durationDays: 365 });
  const c = create(svc, { durationDays: undefined });
  assert.equal(a.license.licenseId, 'CPA-2026-000001');
  assert.equal(b.license.licenseId, 'CPA-2026-000002');
  assert.equal(a.license.remainingDays, 30);
  assert.equal(b.license.remainingDays, 365);
  assert.equal(c.license.expiryDate, null);
  assert.equal(c.license.remainingDays, null);
  assert.equal(a.license.features.excelExport, true);
  assert.match(a.token, /^CPA1\.[\w-]+\.[\w-]+$/);
  const payload = JSON.parse(Buffer.from(a.token.split('.')[1], 'base64url'));
  assert.equal(payload.lid, a.license.licenseId);
  assert.equal(payload.kid, 'dev-1');
  assert.ok(!('status' in payload), 'status is server-side only');
});

test('rejects invalid creation input', () => {
  const { svc } = setup();
  assert.equal(code(() => svc.createLicense({})), 'invalid_request');
  assert.equal(code(() => create(svc, { durationDays: -1 })), 'invalid_request');
  assert.equal(code(() => create(svc, { maxActivations: 0 })), 'invalid_request');
  assert.equal(code(() => create(svc, { machineBinding: 'specific' })), 'invalid_request');
  assert.equal(code(() => create(svc, { machineBinding: 'weird' })), 'invalid_request');
});

test('valid activation returns a signed receipt echoing the nonce', () => {
  const { svc, keys } = setup();
  const { license, token } = create(svc);
  const { receipt } = svc.activate({ token, machine: M1, appVersion: '1.0.0', nonce: 'n-123' });
  const r = keys.open('CPR1', receipt);
  assert.equal(r.lid, license.licenseId);
  assert.equal(r.status, 'active');
  assert.equal(r.nonce, 'n-123');
  assert.equal(r.fp, M1.fp);
  assert.equal(r.exp, license.expiryDate);
  assert.equal(r.checkIntervalDays, 7);
  assert.equal(r.graceDays, 14);
  assert.equal(svc.getLicense(license.licenseId).license.currentActivations, 1);
});

test('invalid signature / tampered / foreign-key / malformed tokens are rejected', () => {
  const { svc } = setup();
  const { token } = create(svc);
  const [p, body, sig] = token.split('.');
  const tampered = JSON.parse(Buffer.from(body, 'base64url')); tampered.exp = null;
  assert.equal(code(() => svc.activate({ token: [p, Buffer.from(JSON.stringify(tampered)).toString('base64url'), sig].join('.'), machine: M1 })), 'invalid_token');
  assert.equal(code(() => svc.activate({ token: token.slice(0, -4) + 'AAAA', machine: M1 })), 'invalid_token');
  assert.equal(code(() => svc.activate({ token: 'garbage', machine: M1 })), 'invalid_token');
  const other = new KeyRing({ evil: generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }) }, 'evil');
  assert.equal(code(() => svc.activate({ token: other.seal('CPA1', { v: 1, lid: 'CPA-2026-000001', product: 'Chiller Plant Analyzer' }), machine: M1 })), 'unknown_key');
  // forge a token with dev-1 kid but the attacker's signature
  const forged = other.seal('CPA1', { v: 1, lid: 'CPA-2026-000001', product: 'Chiller Plant Analyzer' }).split('.');
  const fp = JSON.parse(Buffer.from(forged[1], 'base64url')); fp.kid = 'dev-1';
  assert.equal(code(() => svc.activate({ token: ['CPA1', Buffer.from(JSON.stringify(fp)).toString('base64url'), forged[2]].join('.'), machine: M1 })), 'invalid_token');
  assert.equal(code(() => svc.activate({ token, machine: { fp: 'x', parts: [] } })), 'invalid_request');
});

test('expired, future (not yet valid), revoked, suspended and wrong-product licenses', () => {
  const { svc, clock } = setup();
  const exp = create(svc, { durationDays: 10 });
  clock.now = T0 + 11 * DAY;
  assert.equal(code(() => svc.activate({ token: exp.token, machine: M1 })), 'expired');
  clock.now = T0;
  const fut = create(svc, { startDate: new Date(T0 + 5 * DAY).toISOString() });
  assert.equal(code(() => svc.activate({ token: fut.token, machine: M1 })), 'not_yet_valid');
  assert.equal(fut.license.effectiveStatus, 'pending');
  const rev = create(svc); svc.revoke(rev.license.licenseId);
  assert.equal(code(() => svc.activate({ token: rev.token, machine: M1 })), 'revoked');
  const sus = create(svc); svc.suspend(sus.license.licenseId);
  assert.equal(code(() => svc.activate({ token: sus.token, machine: M1 })), 'suspended');
  const wp = create(svc, { product: 'Other Product' });
  assert.equal(code(() => svc.activate({ token: wp.token, machine: M1 })), 'wrong_product');
});

test('maximum activations, re-activation of the same machine, hardware-drift tolerance', () => {
  const { svc } = setup();
  const { license, token } = create(svc, { maxActivations: 2 });
  svc.activate({ token, machine: M1 });
  svc.activate({ token, machine: M1 }); // same machine again: no new slot
  assert.equal(svc.getLicense(license.licenseId).license.currentActivations, 1);
  // machine with one replaced component (4 of 5 match) is the same machine
  const upgraded = { parts: [...M1.parts.slice(0, 4), h('new-disk')], fp: h('upgraded') };
  svc.activate({ token, machine: upgraded });
  assert.equal(svc.getLicense(license.licenseId).license.currentActivations, 1);
  svc.activate({ token, machine: M2 });
  assert.equal(svc.getLicense(license.licenseId).license.currentActivations, 2);
  assert.equal(code(() => svc.activate({ token, machine: machine('C') })), 'max_activations');
});

test('machine binding: first machine only, and specific machine', () => {
  const { svc } = setup();
  const first = create(svc, { machineBinding: 'first', maxActivations: 5 });
  svc.activate({ token: first.token, machine: M1 });
  assert.equal(code(() => svc.activate({ token: first.token, machine: M2 })), 'wrong_machine');
  svc.activate({ token: first.token, machine: M1 });

  const mid = 'MID1.' + Buffer.from(JSON.stringify(M1)).toString('base64url');
  const spec = create(svc, { machineBinding: 'specific', machineId: mid });
  assert.equal(code(() => svc.activate({ token: spec.token, machine: M2 })), 'wrong_machine');
  svc.activate({ token: spec.token, machine: M1 });
  const p = JSON.parse(Buffer.from(spec.token.split('.')[1], 'base64url'));
  assert.deepEqual(p.bind, { mode: 'specific', fp: M1.fp, parts: M1.parts });
});

test('validate: active, then revoked / suspended / expired receipts; unknown machine; deactivation', () => {
  const { svc, clock, keys } = setup();
  const { license, token } = create(svc, { durationDays: 30 });
  const id = license.licenseId;
  svc.activate({ token, machine: M1 });
  clock.now = T0 + 3 * DAY;
  let r = keys.open('CPR1', svc.validate({ licenseId: id, machine: M1, appVersion: '1.0.1', nonce: 'x' }).receipt);
  assert.equal(r.status, 'active');
  assert.equal(r.validatedAt, new Date(T0 + 3 * DAY).toISOString());
  assert.equal(svc.getLicense(id).license.lastValidation, r.validatedAt);

  svc.suspend(id);
  assert.equal(keys.open('CPR1', svc.validate({ licenseId: id, machine: M1 }).receipt).status, 'suspended');
  svc.reinstate(id);
  svc.revoke(id);
  assert.equal(keys.open('CPR1', svc.validate({ licenseId: id, machine: M1 }).receipt).status, 'revoked');
  svc.reinstate(id);
  clock.now = T0 + 31 * DAY;
  assert.equal(keys.open('CPR1', svc.validate({ licenseId: id, machine: M1 }).receipt).status, 'expired');
  clock.now = T0 + 5 * DAY;
  assert.equal(code(() => svc.validate({ licenseId: id, machine: M2 })), 'not_activated');
  assert.equal(code(() => svc.validate({ licenseId: 'CPA-2026-999999', machine: M1 })), 'unknown_license');

  svc.deactivate({ licenseId: id, machine: M1 });
  assert.equal(svc.getLicense(id).license.currentActivations, 0);
  assert.equal(code(() => svc.validate({ licenseId: id, machine: M1 })), 'not_activated');
  svc.activate({ token, machine: M2 }); // slot freed
});

test('renewal, extension, perpetual and independent per-customer control (no rebuild needed)', () => {
  const { svc, clock, keys } = setup();
  const A = create(svc, { customerName: 'A', durationDays: 30 });
  const B = create(svc, { customerName: 'B', durationDays: 365 });
  const C = create(svc, { customerName: 'C' });
  const D = create(svc, { customerName: 'D', durationDays: undefined });
  svc.revoke(C.license.licenseId);
  assert.equal(svc.getLicense(A.license.licenseId).license.remainingDays, 30);
  assert.equal(svc.getLicense(B.license.licenseId).license.remainingDays, 365);
  assert.equal(svc.getLicense(C.license.licenseId).license.effectiveStatus, 'revoked');
  assert.equal(svc.getLicense(D.license.licenseId).license.expiryDate, null);

  svc.activate({ token: A.token, machine: M1 });
  clock.now = T0 + 29 * DAY;
  svc.extend(A.license.licenseId, 60);
  assert.equal(svc.getLicense(A.license.licenseId).license.expiryDate, new Date(T0 + 90 * DAY).toISOString());
  clock.now = T0 + 40 * DAY; // beyond the ORIGINAL expiry: the old token is still fine – receipt carries the new expiry
  const r = keys.open('CPR1', svc.validate({ licenseId: A.license.licenseId, machine: M1 }).receipt);
  assert.equal(r.status, 'active'); assert.equal(r.exp, new Date(T0 + 90 * DAY).toISOString());
  svc.renew(A.license.licenseId, { days: 30 }); // from max(now, expiry)
  assert.equal(svc.getLicense(A.license.licenseId).license.expiryDate, new Date(T0 + 120 * DAY).toISOString());
  svc.renew(A.license.licenseId, { expiresAt: '2030-01-01T00:00:00Z' });
  assert.equal(svc.getLicense(A.license.licenseId).license.expiryDate, '2030-01-01T00:00:00.000Z');
  svc.renew(A.license.licenseId, { perpetual: true });
  assert.equal(svc.getLicense(A.license.licenseId).license.expiryDate, null);
  assert.equal(code(() => svc.extend(A.license.licenseId, 5)), 'invalid_request');
  assert.equal(code(() => svc.renew(B.license.licenseId, {})), 'invalid_request');
  assert.equal(code(() => svc.renew(B.license.licenseId, { expiresAt: '2020-01-01' })), 'invalid_request');
  // an expired license can be renewed and then activated
  const E = create(svc, { durationDays: 1 }); clock.now += 3 * DAY;
  assert.equal(code(() => svc.activate({ token: E.token, machine: M2 })), 'expired');
  svc.renew(E.license.licenseId, { days: 10 });
  svc.activate({ token: E.token, machine: M2 });
});

test('replacement license, reset activations, authorise replacement machine, deactivate one machine', () => {
  const { svc } = setup();
  const { license, token } = create(svc, { maxActivations: 1, machineBinding: 'first' });
  svc.activate({ token, machine: M1 });
  assert.equal(code(() => svc.activate({ token, machine: M2 })), 'wrong_machine');
  svc.authorizeReplacement(license.licenseId, null);
  assert.equal(svc.getLicense(license.licenseId).license.currentActivations, 0);
  svc.activate({ token, machine: M2 }); // new PC accepted, binds to M2
  assert.equal(code(() => svc.activate({ token, machine: M1 })), 'wrong_machine');
  const { activations } = svc.getLicense(license.licenseId);
  svc.deactivateActivation(activations.find((a) => !a.deactivatedAt).activationId);
  assert.equal(svc.getLicense(license.licenseId).license.currentActivations, 0);
  svc.activate({ token, machine: M2 });
  svc.resetActivations(license.licenseId);
  assert.equal(svc.getLicense(license.licenseId).license.currentActivations, 0);
  svc.activate({ token, machine: M1 });

  const rep = svc.replacement(license.licenseId, {});
  assert.notEqual(rep.license.licenseId, license.licenseId);
  assert.equal(svc.getLicense(license.licenseId).license.status, 'revoked');
  assert.equal(svc.getLicense(license.licenseId).license.replacedBy, rep.license.licenseId);
  assert.equal(code(() => svc.activate({ token, machine: M1 })), 'revoked');
  svc.activate({ token: rep.token, machine: M1 });
});

test('signing-key rotation: tokens from the retired key stay valid, new licenses use the new key', () => {
  const { svc, keys } = setup();
  const old = create(svc);
  const newPem = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
  const rotated = new KeyRing({ 'dev-1': DEV_PEM, k2: newPem }, 'k2');
  const svc2 = new LicenseService(svc.db, rotated, { now: () => T0 });
  svc2.activate({ token: old.token, machine: M1 }); // signed by dev-1, still accepted
  const fresh = svc2.createLicense({ customerName: 'New', durationDays: 10 });
  assert.equal(JSON.parse(Buffer.from(fresh.token.split('.')[1], 'base64url')).kid, 'k2');
  assert.equal(rotated.publicEntries().length, 2);
  // the old-only ring cannot validate k2 tokens (the app must ship the new public key)
  assert.throws(() => keys.open('CPA1', fresh.token), /unknown_key/);
});

test('audit trail records admin actions', () => {
  const { svc } = setup();
  const { license } = create(svc); svc.revoke(license.licenseId);
  const rows = svc.db.prepare('SELECT action FROM audit ORDER BY id').all().map((r) => r.action);
  assert.deepEqual(rows, ['create', 'revoke']);
});

test('offline licenses: require a specific machine, carry off:1, are refused by /activate, survive replacement', () => {
  const { svc } = setup();
  const mid = 'MID1.' + Buffer.from(JSON.stringify(M1)).toString('base64url');
  assert.equal(code(() => create(svc, { offline: true })), 'invalid_request'); // unbound offline code refused
  assert.equal(code(() => create(svc, { offline: true, machineBinding: 'first' })), 'invalid_request');
  const { license, token } = create(svc, { offline: true, machineBinding: 'specific', machineId: mid, durationDays: undefined });
  assert.equal(license.offline, true);
  assert.equal(license.expiryDate, null);
  const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  assert.equal(p.off, 1);
  assert.deepEqual(p.bind, { mode: 'specific', fp: M1.fp, parts: M1.parts });
  assert.equal(code(() => svc.activate({ token, machine: M1 })), 'offline_license');
  const rep = svc.replacement(license.licenseId, {});
  assert.equal(JSON.parse(Buffer.from(rep.token.split('.')[1], 'base64url')).off, 1);
  // online licenses do not carry the flag
  assert.equal('off' in JSON.parse(Buffer.from(create(svc).token.split('.')[1], 'base64url')), false);
});
