#!/usr/bin/env node
// Builds the Windows installer + portable exe. RELEASE mode (default) runs the release gate and compiles OUT the development keyring.
//   node scripts/dist.mjs             release build  (needs production keys + LSR_SERVICE_URL)
//   node scripts/dist.mjs --preview   debug-keyring build for testing (never ship it)
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(app, "..");
const preview = process.argv.includes("--preview");
const extra = process.argv.slice(2).filter((a) => a !== "--preview");
const env = { ...process.env, ...(preview ? {} : { LSR_RELEASE: "1" }) };
const run = (cmd, args, e = env, shell = process.platform === "win32") => { const r = spawnSync(cmd, args, { cwd: app, stdio: "inherit", env: e, shell }); if (r.status) process.exit(r.status ?? 1); };
if (!preview) run("bash", [path.join(repo, "scripts/release-gate.sh")], env, false);
run("npx", ["electron-vite", "build"]);
if (!preview) run("bash", [path.join(repo, "scripts/release-gate.sh"), "--post"], env, false);
run("npx", ["electron-builder", "--win", "nsis", "portable", "--x64", ...extra]);
