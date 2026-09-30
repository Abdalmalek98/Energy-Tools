import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Build-time constants: service URL and Ed25519 public key are baked into the app (never read at runtime).
const define = {
  __SERVICE_URL__: JSON.stringify(process.env.LSR_SERVICE_URL ?? "https://REPLACE-ME.workers.dev"),
  __PUBLIC_KEY__: JSON.stringify(process.env.LSR_PUBLIC_KEY ?? ""),
  __DEVICE_SALT__: JSON.stringify(process.env.LSR_DEVICE_SALT ?? "lsr-device-salt-v1"),
  __CONTACT__: JSON.stringify(process.env.LSR_CONTACT ?? "Contact your supplier for an activation code."),
  __E2E__: JSON.stringify(process.env.LSR_E2E === "1"),
};

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin({ exclude: ["@lsr/shared"] })], define },
  preload: { plugins: [externalizeDepsPlugin({ exclude: ["@lsr/shared"] })], define },
  renderer: { root: resolve("src/renderer"), plugins: [react()], define: { __E2E__: define.__E2E__ }, build: { rollupOptions: { input: resolve("src/renderer/index.html") } } },
});
