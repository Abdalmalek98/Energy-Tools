// Generate an Ed25519 signing key pair.
//   node scripts/keygen.mjs <keyId> [outDir]
// - The PRIVATE key is written to <outDir>/<keyId>.private.pem (mode 0600). Keep it OFF the repository,
//   load it into the license server via CPA_SIGNING_KEY_FILE_<keyId> (or a secrets manager).
// - The PUBLIC entry is printed; add it to src-tauri/licensing-core/keys/public-keys.json and rebuild the app.
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const kid = process.argv[2];
const out = process.argv[3] ?? './private-keys';
if (!kid || !/^[A-Za-z0-9_-]{1,32}$/.test(kid)) { console.error('usage: node scripts/keygen.mjs <keyId> [outDir]'); process.exit(2); }
mkdirSync(out, { recursive: true, mode: 0o700 });
const file = join(out, `${kid}.private.pem`);
if (existsSync(file)) { console.error(`${file} already exists – refusing to overwrite.`); process.exit(1); }
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
writeFileSync(file, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
const entry = { kid, alg: 'ed25519', public: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64') };
console.log(`Private key written to ${file}  (never commit or distribute this file)`);
console.log('Public keyring entry for the desktop app:');
console.log(JSON.stringify(entry, null, 2));
