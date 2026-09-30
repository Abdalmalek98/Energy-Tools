import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openDb } from '../src/db.js';
import { KeyRing } from '../src/keys.js';
import { LicenseService } from '../src/service.js';
import { createHandler } from '../src/http.js';

const DEV_PEM = readFileSync(new URL('../dev/dev-private-key.pem', import.meta.url), 'utf8');
const h = (s) => createHash('sha256').update(s).digest('hex');
const parts = Array.from({ length: 5 }, (_, i) => h('m' + i));
const machine = { fp: h(parts.join()), parts };
const ADMIN = 'test-admin-token-0123456789';

async function start(opts = {}) {
  const svc = new LicenseService(openDb(':memory:'), new KeyRing({ 'dev-1': DEV_PEM }, 'dev-1'));
  const server = http.createServer(createHandler(svc, { adminToken: ADMIN, ...opts }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  return { svc, server, call, close: () => server.close() };
}

test('admin API requires authentication; the public API needs none', async () => {
  const s = await start();
  assert.equal((await s.call('GET', '/v1/admin/licenses')).status, 401);
  assert.equal((await s.call('GET', '/v1/admin/licenses', null, 'wrong')).status, 401);
  assert.equal((await s.call('POST', '/v1/admin/licenses', { customerName: 'X' })).status, 401);
  const created = await s.call('POST', '/v1/admin/licenses', { customerName: 'X', durationDays: 30 }, ADMIN);
  assert.equal(created.status, 201);
  // desktop endpoints work without credentials
  const act = await s.call('POST', '/v1/activate', { token: created.body.token, machine, appVersion: '1.0.0', nonce: 'n' });
  assert.equal(act.status, 200);
  assert.ok(act.body.receipt.startsWith('CPR1.'));
  // no admin operation reachable through public paths
  assert.equal((await s.call('POST', '/v1/revoke', { licenseId: created.body.license.licenseId })).status, 404);
  const v = await s.call('POST', '/v1/validate', { licenseId: created.body.license.licenseId, machine, nonce: 'n2' });
  assert.equal(v.status, 200);
  const hb = await s.call('POST', '/v1/heartbeat', { licenseId: created.body.license.licenseId, machine });
  assert.deepEqual(hb.body, { ok: true, status: 'active' });
  // revoke via admin -> validate returns revoked receipt
  await s.call('POST', `/v1/admin/licenses/${created.body.license.licenseId}/revoke`, null, ADMIN);
  const v2 = await s.call('POST', '/v1/validate', { licenseId: created.body.license.licenseId, machine });
  const payload = JSON.parse(Buffer.from(v2.body.receipt.split('.')[1], 'base64url'));
  assert.equal(payload.status, 'revoked');
  const d = await s.call('POST', '/v1/deactivate', { licenseId: created.body.license.licenseId, machine });
  assert.equal(d.body.ok, true);
  s.close();
});

test('admin API disabled when no admin token is configured; errors are JSON', async () => {
  const s = await start({ adminToken: '' });
  assert.equal((await s.call('GET', '/v1/admin/licenses', null, 'anything')).status, 503);
  const bad = await s.call('POST', '/v1/activate', { token: 'nope', machine });
  assert.equal(bad.status, 400); assert.equal(bad.body.error, 'invalid_token');
  assert.equal((await s.call('GET', '/nope')).status, 404);
  s.close();
});

test('public endpoints are rate limited; oversized bodies rejected', async () => {
  const s = await start({ publicLimit: 5 });
  let last;
  for (let i = 0; i < 8; i++) last = await s.call('POST', '/v1/validate', { licenseId: 'CPA-2026-000001', machine });
  assert.equal(last.status, 429);
  s.close();
  const s2 = await start();
  const big = await fetch(`http://127.0.0.1:${s2.server.address().port}/v1/activate`, { method: 'POST', body: 'x'.repeat(100_000) });
  assert.equal(big.status, 413);
  s2.close();
});

test('health and public key list expose no secrets', async () => {
  const s = await start();
  assert.deepEqual((await s.call('GET', '/v1/health')).body, { ok: true });
  const k = await s.call('GET', '/v1/public-keys');
  assert.equal(k.body.keys[0].kid, 'dev-1');
  assert.ok(!JSON.stringify(k.body).includes('PRIVATE'));
  s.close();
});
