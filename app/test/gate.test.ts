// The release gate must stop an unsafe release and let a properly keyed one through (bash + OpenSSL + a real build).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const GATE = path.join(ROOT, "scripts/release-gate.sh");
const ok = process.platform !== "win32" && spawnSync("bash", ["-c", "openssl version | grep -q 'OpenSSL 3'"]).status === 0;
const d = ok ? describe : describe.skip;

const gen = (cwd: string, args: string[]) => JSON.parse(spawnSync("bash", [path.join(ROOT, "scripts/gen-license-key.sh"), ...args], { cwd, encoding: "utf8", env: { PATH: process.env.PATH!, HOME: cwd } }).stdout.trim().split("\n").pop()!);
const gate = (env: Record<string, string>, ...args: string[]) => spawnSync("bash", [GATE, ...args], { encoding: "utf8", env: { PATH: process.env.PATH!, ...env } });
const goodEnv = (keys: string) => ({ LSR_KEYS_FILE: keys, LSR_SERVICE_URL: "https://licensing.test.invalid", LSR_RELEASE: "1" });

d("release gate", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gate-"));
  const lic = gen(dir, ["--kid", "lic-1"]), rcp = gen(dir, ["--role", "receipt", "--kid", "srv-1"]), dev = gen(dir, ["--dev", "--out", path.join(dir, "d.pem")]);
  const write = (name: string, o: unknown) => { const f = path.join(dir, name); writeFileSync(f, JSON.stringify(o, null, 2)); return f; };
  const good = write("good.json", { license: [lic], receipt: [rcp] });

  it("FAILS for the repository as shipped until the server's receipt key is added (the licence key lic-1 is already there)", () => {
    const r = spawnSync("bash", [GATE], { encoding: "utf8", env: { PATH: process.env.PATH!, LSR_SERVICE_URL: "https://licensing.test.invalid", LSR_RELEASE: "1" } });
    expect(r.status).toBe(1); expect(r.stderr).toContain("no production receipt key"); expect(r.stderr).not.toContain("no production license key");
  });
  it("fails for a development key, a malformed key, a missing receipt key, an http/local/placeholder URL, E2E mode and a missing LSR_RELEASE", () => {
    expect(gate(goodEnv(write("dev.json", { license: [dev], receipt: [rcp] }))).stderr).toContain("development key");
    expect(gate(goodEnv(write("bad.json", { license: [{ kid: "lic-1", publicKey: "AAAA" }], receipt: [rcp] }))).stderr).toContain("Ed25519");
    expect(gate(goodEnv(write("norcp.json", { license: [lic], receipt: [] }))).stderr).toContain("no production receipt key");
    for (const url of ["http://licensing.example.org", "https://localhost:8443", "https://REPLACE-ME.workers.dev"]) expect(gate({ ...goodEnv(good), LSR_SERVICE_URL: url }).status).toBe(1);
    expect(gate({ ...goodEnv(good), LSR_E2E: "1" }).stderr).toContain("LSR_E2E");
    expect(gate({ ...goodEnv(good), LSR_RELEASE: "" }).stderr).toContain("LSR_RELEASE");
  });
  it("passes with production keys + https URL, and the built RELEASE bundle contains the production key but NOT the development keyring", () => {
    expect(gate(goodEnv(good)).status).toBe(0);
    const build = spawnSync("npx", ["electron-vite", "build"], { cwd: path.join(ROOT, "app"), encoding: "utf8", env: { ...process.env, ...goodEnv(good) } });
    expect(build.status).toBe(0);
    const bundle = readFileSync(path.join(ROOT, "app/out/main/index.js"), "utf8");
    expect(bundle).toContain(lic.publicKey); expect(bundle).toContain(rcp.publicKey);
    expect(bundle).not.toMatch(/dev-1|dev-srv-1|DEBUG_KEYRING|keyring\.debug/);
    const post = gate(goodEnv(good), "--post"); expect(post.stderr).toBe(""); expect(post.status).toBe(0);
  }, 180_000);
  it("--post FAILS for a debug build (development keyring compiled in)", () => {
    const env = { ...process.env, LSR_KEYS_FILE: good, LSR_SERVICE_URL: "https://licensing.test.invalid" } as Record<string, string>; delete env.LSR_RELEASE;
    expect(spawnSync("npx", ["electron-vite", "build"], { cwd: path.join(ROOT, "app"), encoding: "utf8", env }).status).toBe(0);
    const r = gate({ LSR_KEYS_FILE: good, LSR_SERVICE_URL: "https://licensing.test.invalid" }, "--post");
    expect(r.status).toBe(1); expect(r.stderr).toContain("development keyring");
    void mkdirSync;
  }, 180_000);
});
