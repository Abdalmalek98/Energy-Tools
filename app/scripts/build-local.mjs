#!/usr/bin/env node
// Builds the app against your local licence service (URL + public key from .local-licence.json). --e2e = scripted dialogs for tests; --run = launch it.
import { readFileSync, existsSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cfgPath = path.join(root, ".local-licence.json");
if (!existsSync(cfgPath)) { console.error("No local licence yet. Run:  ANTHROPIC_API_KEY=... node scripts/local-licence.mjs"); process.exit(1); }
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const env = { ...process.env, LSR_SERVICE_URL: cfg.url, LSR_PUBLIC_KEY: cfg.publicKey, LSR_CONTACT: "Local licence (your own service)", ...(process.argv.includes("--e2e") ? { LSR_E2E: "1" } : {}) };
execSync("npx electron-vite build", { cwd: path.join(root, "app"), stdio: "inherit", env });
if (process.argv.includes("--run")) spawn("npx", ["electron", "."], { cwd: path.join(root, "app"), stdio: "inherit", env });
