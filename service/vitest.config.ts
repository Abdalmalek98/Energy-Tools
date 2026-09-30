import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import { generateKeyPairSync, pbkdf2Sync, createHash } from "node:crypto";
import path from "node:path";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const salt = Buffer.from("testsalttestsalt");
const b64u = (b: Buffer) => b.toString("base64url");
const migrations = await readD1Migrations(path.join(__dirname, "migrations"));

export default defineWorkersConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    poolOptions: {
      workers: {
        singleWorker: true,
        isolatedStorage: false,
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          d1Databases: ["DB"],
          bindings: {
            TEST_MIGRATIONS: migrations,
            LEASE_PUBLIC_KEY: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
            LEASE_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
            ANTHROPIC_API_KEY: "sk-test",
            ADMIN_PASSWORD_HASH: `pbkdf2$100000$${b64u(salt)}$${b64u(pbkdf2Sync("correct horse", salt, 100000, 32, "sha256"))}`,
            ADMIN_TOTP_SECRET: "JBSWY3DPEHPK3PXP",
            ADMIN_SESSION_SECRET: "session-secret-for-tests",
            ADMIN_API_KEY_HASH: createHash("sha256").update("test-api-key").digest("hex"),
          },
        },
      },
    },
  },
});
