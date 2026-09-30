// License Manager backend: serves the admin UI on 127.0.0.1 only and forwards actions to the licensing service.
//   CPA_SERVER_URL=https://licensing.example.com node src/server.js      (then open http://127.0.0.1:5177)
// The admin token is typed into the UI at login and kept in this process's memory – never written to disk.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { AdminApi } from './api.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url));

export function createManager({ serverUrl }) {
  const sessions = new Map(); // session cookie -> AdminApi
  const readBody = async (req) => { const c = []; for await (const x of req) c.push(x); return c.length ? JSON.parse(Buffer.concat(c).toString()) : {}; };
  const handler = async (req, res) => {
    const send = (code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); };
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self' 'unsafe-inline'" }); return res.end(html); }
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403, { message: 'cross-origin request refused' });
      const sid = /(?:^|; )sid=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const { token, server } = await readBody(req);
        const api = new AdminApi(server || serverUrl, token);
        await api.list(); // validates the token
        const id = randomBytes(24).toString('hex');
        sessions.set(id, api);
        return send(200, { ok: true, server: api.base }, { 'set-cookie': `sid=${id}; HttpOnly; SameSite=Strict; Path=/` });
      }
      if (url.pathname === '/api/logout') { sessions.delete(sid); return send(200, { ok: true }); }
      if (url.pathname === '/api/config') return send(200, { server: serverUrl });
      const api = sessions.get(sid);
      if (!api) return send(401, { message: 'Sign in with the admin token first.' });
      const seg = url.pathname.split('/').slice(2); // /api/<...>
      if (seg[0] === 'licenses' && !seg[1]) return send(200, req.method === 'POST' ? await api.create(await readBody(req)) : await api.list());
      if (seg[0] === 'licenses' && seg[1] && !seg[2]) return send(200, await api.get(seg[1]));
      if (seg[0] === 'licenses' && seg[2] === 'token') return send(200, await api.token_(seg[1]));
      if (seg[0] === 'licenses' && seg[2] === 'update') return send(200, await api.update(seg[1], await readBody(req)));
      if (seg[0] === 'licenses' && seg[2]) return send(200, await api.action(seg[1], seg[2], await readBody(req)));
      if (seg[0] === 'activations' && seg[2] === 'deactivate') return send(200, await api.deactivateMachine(seg[1]));
      if (seg[0] === 'audit') return send(200, await api.audit(url.searchParams.get('license')));
      send(404, { message: 'not found' });
    } catch (e) {
      send(e.status && e.status < 600 ? e.status : 500, { message: e.message, code: e.code });
    }
  };
  return http.createServer(handler);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const serverUrl = process.env.CPA_SERVER_URL || 'https://licensing.abdalmalek.com';
  const port = Number(process.env.CPA_MANAGER_PORT || 5177);
  createManager({ serverUrl }).listen(port, '127.0.0.1', () => console.log(`License Manager: http://127.0.0.1:${port}  (service: ${serverUrl})`));
}
