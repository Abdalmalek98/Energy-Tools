// Builds the REAL server and the app for E2E with throw-away keys:
//  - licence signing key (the "owner's" key; its public half is compiled into the app as a debug key, the private half is given to the test server as the optional issuer)
//  - receipt key (the server's own key; public half compiled into the app)
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const pub = (k) => k.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const pem = (k) => k.privateKey.export({ type: "pkcs8", format: "pem" });
const lic = generateKeyPairSync("ed25519"), rcp = generateKeyPairSync("ed25519");
const keys = { licensePub: pub(lic), licensePem: pem(lic), receiptPub: pub(rcp), receiptPem: pem(rcp) };
writeFileSync(path.join(here, ".keys.json"), JSON.stringify(keys));
execSync("npm run build -w server", { cwd: path.join(here, "../.."), stdio: "inherit" });
const extra = JSON.stringify({ license: [{ kid: "e2e-lic", publicKey: keys.licensePub }], receipt: [{ kid: "e2e-rcp", publicKey: keys.receiptPub }] });
execSync("npx electron-vite build", { cwd: path.join(here, ".."), stdio: "inherit", env: { ...process.env, LSR_E2E: "1", LSR_SERVICE_URL: "http://127.0.0.1:8787", LSR_EXTRA_KEYS: extra, LSR_CONTACT: "Contact: test@example.com", LSR_SUPPORT_URL: "mailto:test@example.com" } });
