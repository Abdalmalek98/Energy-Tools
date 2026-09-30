#!/usr/bin/env node
/**
 * Your own local licence: runs the real service on this PC (local D1 database, no Cloudflare account) with YOUR Anthropic key,
 * and creates an activation code for you.
 *
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/local-licence.mjs          # set up (first time), start, print your code
 *   node scripts/local-licence.mjs --stub                                # fake Anthropic (no key, no cost) to test the plumbing
 *   node scripts/local-licence.mjs setup | code | env                     # individual steps
 *
 * Everything private stays in service/.dev.vars and .local-licence.json (both git-ignored).
 */
import { generateKeyPairSync, randomBytes, pbkdf2Sync, createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svc = path.join(root, "service");
const CFG = path.join(root, ".local-licence.json");
const PORT = Number(process.env.LSR_LOCAL_PORT ?? 8788), STUB_PORT = 8790;
const URL_ = `http://127.0.0.1:${PORT}`;
const args = process.argv.slice(2);
const stub = args.includes("--stub");
const cmd = args.find((a) => !a.startsWith("--")) ?? "up";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32 = (buf) => { let bits = "", out = ""; for (const b of buf) bits += b.toString(2).padStart(8, "0"); for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]; return out; };
const load = () => (existsSync(CFG) ? JSON.parse(readFileSync(CFG, "utf8")) : null);
const save = (c) => writeFileSync(CFG, JSON.stringify(c, null, 2), { mode: 0o600 });

function setup() {
  let cfg = load();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!cfg) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const password = randomBytes(12).toString("base64url"), salt = randomBytes(16);
    const adminKey = "lsr_" + randomBytes(24).toString("base64url");
    cfg = {
      url: URL_, adminKey, adminPassword: password, adminTotp: b32(randomBytes(20)), code: null,
      publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
      passwordHash: `pbkdf2$100000$${salt.toString("base64url")}$${pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("base64url")}`,
      sessionSecret: randomBytes(32).toString("base64url"),
    };
    save(cfg);
  }
  if (!key && !stub) { console.error("Set ANTHROPIC_API_KEY (your key from console.anthropic.com), or use --stub to test without it."); process.exit(1); }
  const vars = {
    ANTHROPIC_API_KEY: stub ? "sk-stub" : key, LEASE_PRIVATE_KEY: cfg.privateKey, LEASE_PUBLIC_KEY: cfg.publicKey,
    ADMIN_PASSWORD_HASH: cfg.passwordHash, ADMIN_TOTP_SECRET: cfg.adminTotp, ADMIN_SESSION_SECRET: cfg.sessionSecret,
    ADMIN_API_KEY_HASH: createHash("sha256").update(cfg.adminKey).digest("hex"),
    ...(stub ? { ANTHROPIC_BASE_URL: `http://127.0.0.1:${STUB_PORT}` } : {}),
  };
  writeFileSync(path.join(svc, ".dev.vars"), Object.entries(vars).map(([k, v]) => `${k}="${v}"`).join("\n") + "\n", { mode: 0o600 });
  execSync("npx wrangler d1 migrations apply DB --local", { cwd: svc, stdio: "ignore" });
  return cfg;
}

async function waitFor(url, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 400)); }
  throw new Error("The local service did not start. See service log above.");
}
async function ensureCode(cfg) {
  if (cfg.code) return cfg.code;
  const r = await fetch(`${cfg.url}/admin/api/codes`, { method: "POST", headers: { authorization: `Bearer ${cfg.adminKey}`, "content-type": "application/json" },
    body: JSON.stringify({ customer: "Local owner", notes: "my own local licence", validDays: 3650, maxDevices: 5, leaseHours: 720 }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.message || r.status);
  cfg.code = j.code; save(cfg); return j.code;
}
function printInfo(cfg) {
  console.log(`\n=== Your local licence ===\nService:        ${cfg.url}\nActivation code: ${cfg.code}\nAdmin page:     ${cfg.url}/admin   (password: ${cfg.adminPassword}, authenticator secret: ${cfg.adminTotp})\nAdmin CLI:      ADMIN_URL=${cfg.url} ADMIN_API_KEY=${cfg.adminKey} node admin-cli/cli.mjs list\n\nRun the app against it:   npm run app:local\nAccuracy run:             npm run accuracy\n`);
}

if (cmd === "setup") { const c = setup(); console.log("Set up. Next: node scripts/local-licence.mjs (starts the service and prints your code)."); void c; }
else if (cmd === "env") { const c = load(); if (!c) { console.error("Run setup first."); process.exit(1); } console.log(`LSR_SERVICE_URL=${c.url}\nLSR_PUBLIC_KEY=${c.publicKey}`); }
else {
  const cfg = setup();
  const kids = [];
  if (stub) kids.push(spawn(process.execPath, [path.join(root, "scripts/stub-anthropic.mjs"), String(STUB_PORT)], { stdio: "inherit" }));
  const wr = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1"], { cwd: svc, stdio: ["ignore", "ignore", "inherit"] });
  kids.push(wr);
  const stop = () => { kids.forEach((k) => k.kill()); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  await waitFor(`${cfg.url}/v1/ping`);
  await ensureCode(cfg); printInfo(cfg);
  console.log(stub ? "STUB MODE: no real reading happens. Press Ctrl+C to stop." : "Service is running. Keep this window open while you use the app. Press Ctrl+C to stop.");
  if (cmd === "code") stop();
  await new Promise(() => {});
}
