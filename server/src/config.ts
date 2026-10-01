import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { PRODUCT, type KeyEntry } from "@lsr/licensing";

export interface Config {
  product: string;
  dbPath: string;
  adminToken: string;
  /** public keys that may sign activation codes */
  licenseKeys: KeyEntry[];
  /** the server's own receipt-signing key */
  receiptKey: KeyObject;
  receiptKid: string;
  /** optional: lets the License Manager create codes. Without it, sign codes on your own PC with scripts/offline-license.sh and import them. */
  issuerKey?: KeyObject;
  issuerKid?: string;
  graceHours: number;
  allowDevKeys: boolean;
  trustProxy: boolean;
  anthropic: { apiKey: string; baseUrl: string; modelBest: string; modelFast: string };
}

const need = (env: NodeJS.ProcessEnv, k: string) => { const v = env[k]; if (!v) throw new Error(`Missing environment variable ${k}. See docs/DEPLOYMENT.md.`); return v; };
const pem = (path: string) => createPrivateKey(readFileSync(path));

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const adminToken = need(env, "ADMIN_TOKEN");
  if (adminToken.length < 32) throw new Error("ADMIN_TOKEN must be at least 32 characters (use: openssl rand -hex 32).");
  const keysFile = JSON.parse(readFileSync(need(env, "LICENSE_KEYS_FILE"), "utf8")) as { license?: KeyEntry[] };
  if (!keysFile.license?.length) throw new Error("LICENSE_KEYS_FILE contains no licence public keys.");
  return {
    product: env.PRODUCT ?? PRODUCT,
    dbPath: env.DB_PATH ?? "./data/licensing.sqlite",
    adminToken,
    licenseKeys: keysFile.license,
    receiptKey: pem(need(env, "RECEIPT_KEY_FILE")),
    receiptKid: need(env, "RECEIPT_KID"),
    issuerKey: env.LICENSE_SIGNING_KEY_FILE ? pem(env.LICENSE_SIGNING_KEY_FILE) : undefined,
    issuerKid: env.LICENSE_SIGNING_KID,
    graceHours: Number(env.GRACE_HOURS ?? 168),
    allowDevKeys: env.ALLOW_DEV_KEYS === "1",
    trustProxy: env.BEHIND_PROXY === "1",
    anthropic: { apiKey: env.ANTHROPIC_API_KEY ?? "", baseUrl: env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com", modelBest: env.MODEL_BEST ?? "claude-opus-5-5", modelFast: env.MODEL_FAST ?? "claude-sonnet-5-5" },
  };
}
export const receiptPublicEntry = (c: Config): KeyEntry => ({ kid: c.receiptKid, publicKey: createPublicKey(c.receiptKey).export({ type: "spki", format: "der" }).toString("base64") });
