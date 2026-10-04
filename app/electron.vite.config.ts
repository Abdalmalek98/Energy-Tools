import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

// Build-time constants: service URL and Ed25519 public key are baked into the app (never read at runtime).
// Keys: production public keys are read from licensing/keys/production.json. Development keys are compiled in only when LSR_RELEASE is not "1".
const prodKeys = (() => { try { return readFileSync(process.env.LSR_KEYS_FILE ?? resolve("../licensing/keys/production.json"), "utf8"); } catch { return '{"license":[],"receipt":[]}'; } })();
const debugKeys = process.env.LSR_RELEASE !== "1";
const define = {
  __PROD_KEYS__: JSON.stringify(prodKeys),
  __DEBUG_KEYS__: JSON.stringify(debugKeys),
  __EXTRA_KEYS__: JSON.stringify(debugKeys ? process.env.LSR_EXTRA_KEYS ?? '{"license":[],"receipt":[]}' : '{"license":[],"receipt":[]}'),
  __SUPPORT_URL__: JSON.stringify(process.env.LSR_SUPPORT_URL ?? ""),
  __SERVICE_URL__: JSON.stringify(process.env.LSR_SERVICE_URL ?? "https://REPLACE-ME.workers.dev"),
  __DEVICE_SALT__: JSON.stringify(process.env.LSR_DEVICE_SALT ?? "lsr-device-salt-v1"),
  __CONTACT__: JSON.stringify(process.env.LSR_CONTACT ?? "Contact your supplier for an activation code."),
  __PERSONAL__: JSON.stringify(process.env.LSR_PERSONAL === "1"),
  __E2E__: JSON.stringify(process.env.LSR_E2E === "1"),
};

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin({ exclude: ["@lsr/shared", "@lsr/licensing"] })], define },
  preload: { plugins: [externalizeDepsPlugin({ exclude: ["@lsr/shared", "@lsr/licensing"] })], define },
  renderer: { root: resolve("src/renderer"), plugins: [react()], define: { __E2E__: define.__E2E__, __PERSONAL__: define.__PERSONAL__ }, build: { rollupOptions: { input: resolve("src/renderer/index.html") } } },
});
