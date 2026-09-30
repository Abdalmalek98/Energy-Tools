// Generates a test Ed25519 key pair and builds the app with it (public key + mock service URL are build-time constants).
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const keys = { pub: publicKey.export({ type: "spki", format: "der" }).toString("base64"), priv: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64") };
writeFileSync(new URL("./.keys.json", import.meta.url), JSON.stringify(keys));
execSync("npx electron-vite build", { stdio: "inherit", env: { ...process.env, LSR_E2E: "1", LSR_SERVICE_URL: "http://127.0.0.1:8787", LSR_PUBLIC_KEY: keys.pub, LSR_CONTACT: "Contact: test@example.com" } });
