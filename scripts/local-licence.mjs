#!/usr/bin/env node
/**
 * Your own local licence for testing and the accuracy run: runs the REAL licensing server on this PC with throw-away keys and
 * creates a code for you. (Developer tool: needs Node. Production keys and the production server are separate; see docs/LICENSING.md.)
 *
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/local-licence.mjs       real reading with your Claude key
 *   GROQ_API_KEY=gsk_... node scripts/local-licence.mjs               real reading through Groq (optional GROQ_MODEL_BEST / GROQ_MODEL_FAST)
 *   node scripts/local-licence.mjs --stub                              fake model (no key, no cost): tests the plumbing
 * Then: node app/scripts/build-local.mjs --run   (the app, trusting your local keys)    npm run accuracy
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, ".local-licence"); mkdirSync(dir, { recursive: true });
const CFG = path.join(dir, "config.json");
const PORT = Number(process.env.LSR_LOCAL_PORT ?? 8788), STUB = 8790;
const stub = process.argv.includes("--stub");
const pub = (k) => k.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const pem = (k) => k.privateKey.export({ type: "pkcs8", format: "pem" });

let cfg = existsSync(CFG) ? JSON.parse(readFileSync(CFG, "utf8")) : null;
if (!cfg) {
  const lic = generateKeyPairSync("ed25519"), rcp = generateKeyPairSync("ed25519");
  cfg = { url: `http://127.0.0.1:${PORT}`, adminToken: randomBytes(24).toString("hex"), licensePub: pub(lic), receiptPub: pub(rcp), code: null };
  writeFileSync(path.join(dir, "license-key.pem"), pem(lic), { mode: 0o600 });
  writeFileSync(path.join(dir, "receipt-key.pem"), pem(rcp), { mode: 0o600 });
  writeFileSync(path.join(dir, "keys.json"), JSON.stringify({ license: [{ kid: "local-lic", publicKey: cfg.licensePub }] }));
  writeFileSync(CFG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
if (!process.env.ANTHROPIC_API_KEY && !process.env.GROQ_API_KEY && !stub) { console.error("Set ANTHROPIC_API_KEY (console.anthropic.com) or GROQ_API_KEY (console.groq.com), or use --stub."); process.exit(1); }
execSync("npm run build -w server", { cwd: root, stdio: "ignore" });

const kids = [];
if (stub) {   // fake Anthropic Messages API
  const row = (n, room) => ({ row: n, room_name: room, floor: "GF", led: "LED", normal_emergency: "Normal", unit_desc: "2FT", lamp_desc: "T8", fixture_qty: 2, lamps_per_fixture: 2, lamp_watt: 18, color_temp: "6500K", voltage: 220, int_ext: "Internal", mounted: "Surface", dimmable: "No", sensors: "No", ceiling: "Panel", height: 3, switch_status: "Good", uncertain: [] });
  createServer((q, r) => { q.resume(); q.on("end", () => { const page = { header: { building_name: "STUB", floor: "GF", upright: true }, section_changes: [], rows: [row(1, "OFFICE"), row(2, "STORE")], copy_notes: [] }; r.writeHead(200, { "content-type": "application/json" }); r.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(page) }], usage: { input_tokens: 1000, output_tokens: 300 } })); }); }).listen(STUB, "127.0.0.1");
}
const srv = spawn(process.execPath, ["--no-warnings", path.join(root, "server/dist/server.mjs")], { stdio: ["ignore", "ignore", "inherit"], env: {
  PATH: process.env.PATH, PORT: String(PORT), BEHIND_PROXY: "1", ADMIN_TOKEN: cfg.adminToken, DB_PATH: path.join(dir, "licensing.sqlite"), LICENSE_KEYS_FILE: path.join(dir, "keys.json"),
  RECEIPT_KEY_FILE: path.join(dir, "receipt-key.pem"), RECEIPT_KID: "local-rcp", LICENSE_SIGNING_KEY_FILE: path.join(dir, "license-key.pem"), LICENSE_SIGNING_KID: "local-lic",
  ...(process.env.GROQ_API_KEY && !stub ? { PROVIDER: "groq", GROQ_API_KEY: process.env.GROQ_API_KEY, ...(process.env.GROQ_MODEL_BEST ? { GROQ_MODEL_BEST: process.env.GROQ_MODEL_BEST, GROQ_MODEL_FAST: process.env.GROQ_MODEL_FAST ?? process.env.GROQ_MODEL_BEST } : {}) } : {}),
  ANTHROPIC_API_KEY: stub ? "sk-stub" : process.env.ANTHROPIC_API_KEY ?? "", ...(stub ? { ANTHROPIC_BASE_URL: `http://127.0.0.1:${STUB}` } : {}) } });
kids.push(srv);
const stop = () => { kids.forEach((k) => k.kill()); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
for (let i = 0; i < 150; i++) { try { if ((await fetch(cfg.url + "/healthz")).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 200)); }
if (!cfg.code) {
  const r = await fetch(cfg.url + "/admin/v1/licenses", { method: "POST", headers: { authorization: `Bearer ${cfg.adminToken}`, "content-type": "application/json" }, body: JSON.stringify({ customer: "Local owner", company: "me", days: 3650, maxActivations: 5 }) });
  const j = await r.json(); if (!r.ok) { console.error(j.message); stop(); }
  cfg.code = j.code; writeFileSync(CFG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
console.log(`\n=== Your local licence ===\nServer:           ${cfg.url}   (License Manager: ${cfg.url}/manager, token in .local-licence/config.json)\nActivation code:  ${cfg.code}\n\nRun the app:      node app/scripts/build-local.mjs --run\nAccuracy report:  npm run accuracy      (second terminal, this one stays open)\n${stub ? "STUB MODE: no real reading." : process.env.GROQ_API_KEY ? "Real reading through Groq." : "Real reading with your Anthropic key."} Ctrl+C stops.\n`);
await new Promise(() => {});
