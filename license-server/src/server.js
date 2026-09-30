import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { openDb } from './db.js';
import { KeyRing } from './keys.js';
import { LicenseService } from './service.js';
import { createHandler } from './http.js';

export function buildServer(env = process.env) {
  const db = openDb(env.CPA_DB_PATH || './data/licenses.db');
  const keys = KeyRing.fromEnv(env);
  const service = new LicenseService(db, keys, { checkIntervalDays: env.CPA_CHECK_INTERVAL_DAYS ?? 7, graceDays: env.CPA_GRACE_DAYS ?? 14 });
  const handler = createHandler(service, { adminToken: env.CPA_ADMIN_TOKEN, trustProxy: env.CPA_TRUST_PROXY === '1' });
  const tls = env.CPA_TLS_CERT && env.CPA_TLS_KEY ? { cert: readFileSync(env.CPA_TLS_CERT), key: readFileSync(env.CPA_TLS_KEY) } : null;
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  return { server, service, db, tls: !!tls };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { server, tls } = buildServer();
  const port = Number(process.env.CPA_PORT || 8443);
  const host = process.env.CPA_HOST || '0.0.0.0';
  if (!tls && !process.env.CPA_ALLOW_PLAIN_HTTP) {
    console.error('Refusing to start without TLS. Provide CPA_TLS_CERT/CPA_TLS_KEY, or run behind an HTTPS reverse proxy and set CPA_ALLOW_PLAIN_HTTP=1 (loopback only!).');
    process.exit(1);
  }
  server.listen(port, host, () => console.log(`Licensing service listening on ${tls ? 'https' : 'http'}://${host}:${port}`));
}
