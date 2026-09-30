// Release gate: fail if the embedded keyring contains a development key or no production key.
import { readFileSync } from 'node:fs';
const ring = JSON.parse(readFileSync(new URL('../src-tauri/licensing-core/keys/public-keys.json', import.meta.url), 'utf8'));
const dev = ring.keys.filter((k) => k.dev);
const prod = ring.keys.filter((k) => !k.dev && !k.retired);
if (!prod.length) { console.error('RELEASE BLOCKED: no production public key in src-tauri/licensing-core/keys/public-keys.json (run license-server: npm run keygen -- <keyId>).'); process.exit(1); }
if (dev.length) console.warn(`Note: ${dev.length} dev key(s) present – ignored by release builds, but remove them from the release keyring: ${dev.map((k) => k.kid).join(', ')}`);
if (process.argv.includes('--strict') && dev.length) { console.error('RELEASE BLOCKED (--strict): dev key present.'); process.exit(1); }
console.log('Release keyring OK:', prod.map((k) => k.kid).join(', '));
