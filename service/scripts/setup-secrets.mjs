#!/usr/bin/env node
// Generates every secret the service needs. Prints to the terminal only (nothing is written to disk).
// Optional: ADMIN_PASSWORD=... to choose your own password instead of a random one.
import { generateKeyPairSync, randomBytes, pbkdf2Sync, createHash } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (buf) => { let bits = "", out = ""; for (const b of buf) bits += b.toString(2).padStart(8, "0"); for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]; return out; };

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const password = process.env.ADMIN_PASSWORD || randomBytes(18).toString("base64url");
if (password.length < 12) { console.error("Password must be at least 12 characters."); process.exit(1); }
const salt = randomBytes(16);
const hash = `pbkdf2$100000$${salt.toString("base64url")}$${pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("base64url")}`;
const totp = b32(randomBytes(20));
const apiKey = "lsr_" + randomBytes(24).toString("base64url");

const secrets = {
  LEASE_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  ADMIN_PASSWORD_HASH: hash,
  ADMIN_TOTP_SECRET: totp,
  ADMIN_SESSION_SECRET: randomBytes(32).toString("base64url"),
  ADMIN_API_KEY_HASH: createHash("sha256").update(apiKey).digest("hex"),
};
const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");

console.log("=== 1. Put these in Cloudflare (run each, paste the value when asked) ===");
for (const [k, v] of Object.entries(secrets)) console.log(`\nnpx wrangler secret put ${k}\n  value: ${v}`);
console.log("\nnpx wrangler secret put ANTHROPIC_API_KEY\n  value: <your key from console.anthropic.com>");
console.log("\n=== 2. Public key (not secret) ===");
console.log(`Set in service/wrangler.toml [vars]  LEASE_PUBLIC_KEY = "${pub}"`);
console.log(`and use the same value for the app build:  LSR_PUBLIC_KEY=${pub}`);
console.log("\n=== 3. Your admin login (save in a password manager — shown once) ===");
console.log(`Password: ${password}`);
console.log(`Authenticator: add manually, type "time based", secret ${totp}`);
console.log(`otpauth://totp/LightingSurveyAdmin?secret=${totp}&issuer=LightingSurveyReader`);
console.log("\n=== 4. Admin CLI key (shown once) ===");
console.log(`ADMIN_API_KEY=${apiKey}`);
