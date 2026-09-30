// DEVELOPMENT ONLY – issues a test activation code with the committed dev key (kid "dev-1").
// Codes signed with it are rejected by release builds of the desktop app (dev keys are only trusted in debug builds).
//   node scripts/dev-license.mjs [--days 30] [--customer "Test Co"] [--binding none|first] [--max 1] [--perpetual]
import { readFileSync } from 'node:fs';
import { KeyRing } from '../src/keys.js';
import { openDb } from '../src/db.js';
import { LicenseService } from '../src/service.js';

if (process.env.NODE_ENV === 'production') { console.error('dev-license must not be used in production.'); process.exit(1); }
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const pem = readFileSync(new URL('../dev/dev-private-key.pem', import.meta.url), 'utf8');
const svc = new LicenseService(openDb(process.env.CPA_DB_PATH || ':memory:'), new KeyRing({ 'dev-1': pem }, 'dev-1'));
const perpetual = process.argv.includes('--perpetual');
const { license, token } = svc.createLicense({
  customerName: arg('customer', 'Dev Customer'), companyName: 'Dev Co', email: 'dev@example.com',
  durationDays: perpetual ? undefined : Number(arg('days', 30)), maxActivations: Number(arg('max', 1)), machineBinding: arg('binding', 'none'),
});
console.log(JSON.stringify(license, null, 2));
console.log('\nACTIVATION CODE (dev key):\n' + token);
if (!process.env.CPA_DB_PATH) console.log('\nNote: in-memory database – the record vanishes on exit, so online activation will not find it. Set CPA_DB_PATH to the dev server\'s database to keep it.');
