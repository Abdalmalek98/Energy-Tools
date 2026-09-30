#!/usr/bin/env node
// Build the app against your local licence (scripted dialogs), then run the accuracy suite (xvfb on Linux without a display).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { stdio: "inherit", cwd: app, shell: process.platform === "win32", ...opts }); if (r.status) process.exit(r.status); };
run(process.execPath, [path.join(app, "scripts/build-local.mjs"), "--e2e"]);
const headless = process.platform === "linux" && !process.env.DISPLAY;
run(headless ? "xvfb-run" : "npx", headless ? ["-a", "npx", "playwright", "test", "-c", "playwright.accuracy.config.ts"] : ["playwright", "test", "-c", "playwright.accuracy.config.ts"]);
