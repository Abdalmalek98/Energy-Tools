#!/usr/bin/env node
// Builds the Windows installer + portable exe. RELEASE mode (default) runs the release gate and compiles OUT the development keyring.
//   node scripts/dist.mjs             release build  (needs production keys + LSR_SERVICE_URL)
//   node scripts/dist.mjs --preview   debug-keyring build for testing (never ship it)
//   node scripts/dist.mjs --personal  owner-only build: no licence, own Groq key in Settings (never ship it)
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(app, "..");
const personal = process.argv.includes("--personal");
const preview = process.argv.includes("--preview") || personal;
const extra = process.argv.slice(2).filter((a) => a !== "--preview" && a !== "--personal");
const env = { ...process.env, ...(preview ? {} : { LSR_RELEASE: "1" }), ...(personal ? { LSR_PERSONAL: "1" } : {}) };
const run = (cmd, args, e = env, shell = process.platform === "win32") => { const r = spawnSync(cmd, args, { cwd: app, stdio: "inherit", env: e, shell }); if (r.status) process.exit(r.status ?? 1); };
if (!preview) run("bash", [path.join(repo, "scripts/release-gate.sh")], env, false);
run("npx", ["electron-vite", "build"]);
if (!preview) run("bash", [path.join(repo, "scripts/release-gate.sh"), "--post"], env, false);
if (personal) run("npx", ["electron-builder", "--win", "portable", "--x64", "-c.artifactName=LightingSurveyReader-Personal.exe", ...extra]);   // portable only: no installer to confuse with the licensed app
else run("npx", ["electron-builder", "--win", "nsis", "portable", "--x64", ...extra]);
