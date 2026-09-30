#!/usr/bin/env node
// Refuses to package a build that isn't safe to ship. Run before the build (env) and after it (--post: inspects the bundle).
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errs = [];
if (!process.argv.includes("--post")) {
  const url = process.env.LSR_SERVICE_URL ?? "", key = process.env.LSR_PUBLIC_KEY ?? "";
  if (!/^https:\/\/[^/]+/.test(url) || /REPLACE-ME|example\.com/.test(url)) errs.push("LSR_SERVICE_URL must be your real https:// service address.");
  let ok = false; try { ok = Buffer.from(key, "base64").length === 44; } catch { /* invalid */ }
  if (!ok) errs.push("LSR_PUBLIC_KEY must be the base64 Ed25519 public key printed by `npm run setup-secrets`.");
  if (process.env.LSR_E2E === "1") errs.push("LSR_E2E must not be set for a release build (it scripts file dialogs).");
} else {
  const f = path.join(app, "out/main/index.js");
  if (!existsSync(f)) errs.push("out/main/index.js is missing: build first.");
  else {
    const js = readFileSync(f, "utf8");
    const urls = js.match(/https?:\/\/[^"'`\s)]+/g) ?? [];
    if (urls.some((u) => /127\.0\.0\.1|localhost|REPLACE-ME/.test(u))) errs.push("The bundle still points at a local or placeholder service URL.");
    if (/\be2e\s*=\s*(true|isDev)\b/.test(js)) errs.push("The bundle was built in E2E mode (scripted file dialogs).");
  }
}
if (errs.length) { console.error("\nRelease check FAILED:\n - " + errs.join("\n - ") + "\n"); process.exit(1); }
console.log("Release check passed.");
