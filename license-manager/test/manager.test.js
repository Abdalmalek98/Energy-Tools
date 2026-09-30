import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { openDb } from '../../license-server/src/db.js';
import { KeyRing } from '../../license-server/src/keys.js';
import { LicenseService } from '../../license-server/src/service.js';
import { createHandler } from '../../license-server/src/http.js';
import { createManager } from '../src/server.js';

test('manager signs in with the admin token, creates, revokes, renews via the service', async () => {
  const pem = readFileSync(new URL('../../license-server/dev/dev-private-key.pem', import.meta.url), 'utf8');
  const svc = new LicenseService(openDb(':memory:'), new KeyRing({ 'dev-1': pem }, 'dev-1'));
  const lic = http.createServer(createHandler(svc, { adminToken: 'tok-1234567890' }));
  await new Promise((r) => lic.listen(0, '127.0.0.1', r));
  const serverUrl = `http://127.0.0.1:${lic.address().port}`;
  const mgr = createManager({ serverUrl });
  await new Promise((r) => mgr.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${mgr.address().port}`;
  const call = async (path, method = 'GET', body, cookie) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, cookie: r.headers.get('set-cookie')?.split(';')[0], json: await r.json().catch(() => ({})) };
  };
  assert.equal((await call('/api/licenses')).status, 401);
  assert.equal((await call('/api/login', 'POST', { token: 'wrong' })).status, 401);
  const login = await call('/api/login', 'POST', { token: 'tok-1234567890' });
  assert.equal(login.status, 200);
  const c = login.cookie;
  const created = await call('/api/licenses', 'POST', { customerName: 'Acme', durationDays: 30 }, c);
  const id = created.json.license.licenseId;
  assert.match(created.json.token, /^CPA1\./);
  assert.equal((await call(`/api/licenses/${id}/revoke`, 'POST', {}, c)).json.license.status, 'revoked');
  assert.equal((await call(`/api/licenses/${id}/reinstate`, 'POST', {}, c)).json.license.status, 'active');
  assert.equal((await call(`/api/licenses/${id}/extend`, 'POST', { days: 10 }, c)).json.license.remainingDays, 40);
  // the code is re-signed from the current record, so it now carries the extended expiry
  const reissued = (await call(`/api/licenses/${id}/token`, 'GET', undefined, c)).json.token;
  assert.match(reissued, /^CPA1\./);
  assert.notEqual(reissued, created.json.token);
  lic.closeAllConnections(); mgr.closeAllConnections(); lic.close(); mgr.close();
});
