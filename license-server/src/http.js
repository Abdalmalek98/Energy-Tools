import { createHash, timingSafeEqual } from 'node:crypto';
import { LicenseError } from './service.js';

const MAX_BODY = 64 * 1024;

const sha = (s) => createHash('sha256').update(String(s)).digest();
export function safeEqual(a, b) {
  return timingSafeEqual(sha(a), sha(b));
}

class RateLimiter {
  constructor(limit, windowMs) { this.limit = limit; this.windowMs = windowMs; this.hits = new Map(); }
  allow(key, now = Date.now()) {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 10000) this.hits.clear();
    return arr.length <= this.limit;
  }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new LicenseError('too_large', 'Request body too large', 413);
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new LicenseError('invalid_json', 'Body must be JSON', 400); }
}

/**
 * Request handler factory.
 * Public (desktop app):  POST /v1/activate  /v1/validate  /v1/deactivate  /v1/heartbeat
 * Admin (Bearer token):  /v1/admin/...   – the desktop application never has or needs these credentials.
 */
export function createHandler(service, { adminToken, trustProxy = false, publicLimit = 60 } = {}) {
  const limiter = new RateLimiter(publicLimit, 60_000);
  return async function handler(req, res) {
    const send = (code, body) => {
      const data = JSON.stringify(body);
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(data);
    };
    try {
      const url = new URL(req.url, 'http://x');
      const path = url.pathname.replace(/\/+$/, '') || '/';
      const ip = (trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress;
      if (req.method === 'GET' && path === '/v1/health') return send(200, { ok: true });
      if (req.method === 'GET' && path === '/v1/public-keys') return send(200, { keys: service.keys.publicEntries() });

      // ---- public
      if (req.method === 'POST' && ['/v1/activate', '/v1/validate', '/v1/deactivate', '/v1/heartbeat'].includes(path)) {
        if (!limiter.allow(ip)) throw new LicenseError('rate_limited', 'Too many requests', 429);
        const b = await readJson(req);
        const common = { machine: b.machine, appVersion: String(b.appVersion ?? '').slice(0, 32), ip, nonce: typeof b.nonce === 'string' ? b.nonce.slice(0, 64) : null };
        if (path === '/v1/activate') return send(200, service.activate({ ...common, token: b.token }));
        if (path === '/v1/validate') return send(200, service.validate({ ...common, licenseId: b.licenseId }));
        if (path === '/v1/deactivate') return send(200, service.deactivate({ ...common, licenseId: b.licenseId }));
        return send(200, service.heartbeat({ ...common, licenseId: b.licenseId }));
      }

      // ---- admin
      if (path.startsWith('/v1/admin/')) {
        if (!adminToken) throw new LicenseError('admin_disabled', 'Admin API is not configured on this server.', 503);
        const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
        if (!m || !safeEqual(m[1], adminToken)) {
          if (!limiter.allow('admin-fail:' + ip)) throw new LicenseError('rate_limited', 'Too many requests', 429);
          throw new LicenseError('unauthorized', 'Admin authentication required.', 401);
        }
        const actor = 'admin';
        const seg = path.split('/').slice(3); // after /v1/admin
        if (seg[0] === 'licenses') {
          if (!seg[1]) {
            if (req.method === 'GET') return send(200, { licenses: service.listLicenses() });
            if (req.method === 'POST') return send(201, service.createLicense(await readJson(req), actor));
          } else {
            const id = decodeURIComponent(seg[1]);
            const act = seg[2];
            if (!act && req.method === 'GET') return send(200, service.getLicense(id));
            if (!act && req.method === 'PATCH') return send(200, { license: service.update(id, await readJson(req), actor) });
            if (act === 'token' && req.method === 'GET') return send(200, { token: service.getToken(id) });
            if (req.method === 'POST') {
              const b = ['renew', 'extend', 'replacement', 'authorize-replacement'].includes(act) ? await readJson(req) : {};
              switch (act) {
                case 'revoke': return send(200, { license: service.revoke(id, actor) });
                case 'suspend': return send(200, { license: service.suspend(id, actor) });
                case 'reinstate': return send(200, { license: service.reinstate(id, actor) });
                case 'renew': return send(200, { license: service.renew(id, b, actor) });
                case 'extend': return send(200, { license: service.extend(id, b.days, actor) });
                case 'replacement': return send(201, service.replacement(id, b, actor));
                case 'reset-activations': return send(200, service.resetActivations(id, actor));
                case 'authorize-replacement': return send(200, service.authorizeReplacement(id, b.machine ?? null, actor));
              }
            }
          }
        }
        if (seg[0] === 'activations' && seg[2] === 'deactivate' && req.method === 'POST') return send(200, service.deactivateActivation(Number(seg[1]), actor));
        if (seg[0] === 'audit' && req.method === 'GET') {
          const lic = url.searchParams.get('license');
          const rows = lic ? service.db.prepare('SELECT * FROM audit WHERE license_id = ? ORDER BY id DESC LIMIT 200').all(lic) : service.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all();
          return send(200, { audit: rows });
        }
      }
      throw new LicenseError('not_found', 'Not found', 404);
    } catch (e) {
      if (e instanceof LicenseError) return send(e.http, { error: e.code, message: e.message });
      console.error('Unhandled error', e);
      return send(500, { error: 'internal', message: 'Internal server error' });
    }
  };
}
