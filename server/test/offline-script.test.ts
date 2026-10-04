// codes produced by scripts/offline-license.sh (bash + OpenSSL only) must be accepted by the real client and the real server
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AesFileStore, encodeMachineId, fetchHttp, hashComponent, LicenseClient, PRODUCT, verifyCode, type Http } from "@lsr/licensing";
import { DAY, SALT, machine, startHarness } from "./harness";

const SCRIPTS = path.resolve(__dirname, "../../scripts");
const ok = process.platform !== "win32" && spawnSync("bash", ["-c", "openssl version | grep -q 'OpenSSL 3'"]).status === 0;
const d = ok ? describe : describe.skip;
const noNetwork: Http = { post: async () => { throw new Error("NETWORK CALL MADE"); } };

function sh(script: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  const r = spawnSync("bash", [path.join(SCRIPTS, script), ...args], { cwd, encoding: "utf8", env: { PATH: process.env.PATH!, HOME: cwd, ...env } });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "offl-"));
  const gen = sh("gen-license-key.sh", [], dir);
  expect(gen.status).toBe(0);
  const entry = JSON.parse(gen.out.trim().split("\n").pop()!) as { kid: string; publicKey: string };
  const keysFile = path.join(dir, "keys.json");
  writeFileSync(keysFile, JSON.stringify({ license: [entry], receipt: [] }, null, 2));
  const key = path.join(dir, "lsr-private-keys/license-key.pem");
  return { dir, entry, keysFile, key, keys: { license: [entry], receipt: [] } };
}
const base = (s: ReturnType<typeof setup>, extra: string[]) => ["--key", s.key, "--kid", s.entry.kid, "--keys-file", s.keysFile, "--customer", "Jane Doe", "--company", "Acme", ...extra];
const client = (s: ReturnType<typeof setup>, comps = machine(), http: Http = noNetwork, receiptKeys: any[] = []) =>
  new LicenseClient({ keys: { license: s.keys.license, receipt: receiptKeys }, product: PRODUCT, releaseBuild: true, appVersion: "1", collect: () => comps, http, store: new AesFileStore(path.join(s.dir, "lic.dat"), "s") });

d("scripts/gen-license-key.sh", () => {
  it("works when the working directory is unrelated or does not even exist", () => {
    const home = mkdtempSync(path.join(tmpdir(), "home-"));
    const r = spawnSync("bash", [path.join(SCRIPTS, "gen-license-key.sh")], { cwd: tmpdir(), encoding: "utf8", env: { PATH: process.env.PATH!, HOME: home } });
    expect(r.status).toBe(0); expect(readFileSync(path.join(home, "lsr-private-keys/license-key.pem"), "utf8")).toContain("PRIVATE KEY");
    const bad = spawnSync("bash", [path.join(SCRIPTS, "gen-license-key.sh"), "--out", "/proc/nope/key.pem"], { encoding: "utf8", env: { PATH: process.env.PATH!, HOME: home } });
    expect(bad.status).toBe(5); expect(bad.stderr).toContain("Cannot create the folder"); expect(bad.stderr).toContain("--out");
  });
  it("creates a private key in ~/lsr-private-keys (0600) from ANY working directory, prints only the public key JSON on stdout, refuses to overwrite", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gen-"));
    const r = sh("gen-license-key.sh", [], dir);
    expect(r.status).toBe(0);
    const line = r.out.trim(); expect(line.split("\n")).toHaveLength(1);
    expect(JSON.parse(line)).toMatchObject({ kid: "lic-1" }); expect(line).not.toContain("PRIVATE");
    expect(readFileSync(path.join(dir, "lsr-private-keys/license-key.pem"), "utf8")).toContain("BEGIN PRIVATE KEY");
    expect(r.err).toContain("NEVER paste it"); expect(r.err).toContain(path.join(dir, "lsr-private-keys")); expect(sh("gen-license-key.sh", [], dir).status).toBe(2);
    expect(JSON.parse(sh("gen-license-key.sh", ["--role", "receipt"], dir).out.trim())).toMatchObject({ kid: "srv-1" });
    expect(JSON.parse(sh("gen-license-key.sh", ["--dev"], dir).out.trim())).toMatchObject({ kid: "dev-lic-1", dev: true });
  });
});

d("scripts/offline-license.sh", () => {
  it("prints the code LAST on stdout (and only that), details on stderr; the real client accepts it with NO network call", async () => {
    const s = setup();
    const r = sh("offline-license.sh", base(s, ["--machine-id", encodeMachineId(machine()), "--days", "365"]), s.dir);
    expect(r.status).toBe(0);
    expect(r.out.trim().split("\n")).toHaveLength(1); expect(r.out.trim()).toMatch(/^LSR1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(r.err).toContain("signature verified"); expect(r.err).toContain("Jane Doe"); expect(r.err).not.toContain("LSR1.");
    const code = r.out.trim();
    const v = verifyCode(code, { keys: s.keys.license, product: PRODUCT, releaseBuild: true });
    expect(v.ok && v.payload).toMatchObject({ customer: "Jane Doe", company: "Acme", offline: true, maxActivations: 1, machine: { mode: "specific" }, kid: s.entry.kid });
    const c = client(s);
    expect(await c.activate(code)).toEqual({ ok: true });                       // noNetwork http would throw if called
    expect(c.status().evaluation).toMatchObject({ status: "active", usable: true });
    expect(c.status().evaluation.info?.daysRemaining).toBe(365);
    const other = client(s, machine({ guid: hashComponent("guid", "O", SALT), cpu: hashComponent("cpu", "O", SALT), bios: hashComponent("bios", "O", SALT), mac: hashComponent("mac", "O", SALT) }));
    expect(await other.activate(code)).toMatchObject({ ok: false, error: "machine_mismatch" });
  });
  it("handles Arabic names, quotes, perpetual licences, a fixed end date and a page quota", async () => {
    const s = setup();
    const r = sh("offline-license.sh", ["--key", s.key, "--kid", s.entry.kid, "--keys-file", s.keysFile, "--customer", 'مؤسسة "النور" للطاقة', "--machine-id", encodeMachineId(machine()), "--perpetual", "--pages-per-month", "500"], s.dir);
    expect(r.status).toBe(0);
    const v = verifyCode(r.out.trim(), { keys: s.keys.license, product: PRODUCT });
    expect(v.ok && v.payload).toMatchObject({ customer: 'مؤسسة "النور" للطاقة', expiresAt: null, features: { pagesPerMonth: 500 } });
    const e = sh("offline-license.sh", base(s, ["--machine-id", encodeMachineId(machine()), "--expires", "2099-12-31"]), s.dir);
    expect((verifyCode(e.out.trim(), { keys: s.keys.license, product: PRODUCT }) as any).payload.expiresAt).toBe("2099-12-31T23:59:59Z");
  });
  it("(a) stops with a clear error when the private key does not match the public key embedded in the app", () => {
    const s = setup();
    const other = sh("gen-license-key.sh", ["--out", path.join(s.dir, "other.pem")], s.dir); expect(other.status).toBe(0);
    const r = sh("offline-license.sh", ["--key", path.join(s.dir, "other.pem"), "--kid", s.entry.kid, "--keys-file", s.keysFile, "--customer", "X", "--machine-id", encodeMachineId(machine()), "--days", "30"], s.dir);
    expect(r.status).toBe(3); expect(r.out).toBe(""); expect(r.err).toContain("does NOT match the public key"); expect(r.err).toContain("Nothing was created");
    const unknown = sh("offline-license.sh", ["--key", s.key, "--kid", "lic-9", "--keys-file", s.keysFile, "--customer", "X", "--machine-id", encodeMachineId(machine()), "--days", "30"], s.dir);
    expect(unknown.status).toBe(3); expect(unknown.out).toBe("");
    writeFileSync(s.keysFile, JSON.stringify({ license: [{ ...s.entry, dev: true }], receipt: [] }));
    const dev = sh("offline-license.sh", base(s, ["--machine-id", encodeMachineId(machine()), "--days", "30"]), s.dir);
    expect(dev.status).toBe(3); expect(dev.err).toContain("DEVELOPMENT key");
  });
  it("(b) its own signature check really runs: a corrupted openssl result is never printed", () => {
    const s = setup();
    // a fake 'openssl' that signs with garbage must make the script fail instead of printing a bad code
    const bin = path.join(s.dir, "fakebin"); require("node:fs").mkdirSync(bin);
    writeFileSync(path.join(bin, "openssl"), `#!/usr/bin/env bash\nif [ "$1" = pkeyutl ] && [ "$2" = -sign ]; then for a in "$@"; do last=$a; done; i=0; for a in "$@"; do if [ "$a" = -out ]; then :; fi; done; out=""; while [ $# -gt 0 ]; do [ "$1" = -out ] && out="$2"; shift; done; head -c 64 /dev/zero > "$out"; exit 0; fi\nexec /usr/bin/openssl "$@"\n`, { mode: 0o755 });
    const r = sh("offline-license.sh", base(s, ["--machine-id", encodeMachineId(machine()), "--days", "30"]), s.dir, { PATH: `${bin}:${process.env.PATH}` });
    expect(r.status).toBe(5); expect(r.out).toBe(""); expect(r.err).toContain("did not verify");
  });
  it("rejects bad input with clear messages (exit 2 usage / 4 invalid)", () => {
    const s = setup(); const mid = encodeMachineId(machine());
    expect(sh("offline-license.sh", base(s, ["--days", "30"]), s.dir)).toMatchObject({ status: 2 });                          // offline needs a machine id
    expect(sh("offline-license.sh", base(s, ["--machine-id", "MID1.!!", "--days", "30"]), s.dir).status).toBe(4);
    expect(sh("offline-license.sh", base(s, ["--machine-id", mid]), s.dir).status).toBe(2);                                    // no validity given
    expect(sh("offline-license.sh", base(s, ["--machine-id", mid, "--days", "30", "--perpetual"]), s.dir).status).toBe(2);
    expect(sh("offline-license.sh", base(s, ["--machine-id", mid, "--expires", "2026-13-45"]), s.dir).status).toBe(4);
    expect(sh("offline-license.sh", base(s, ["--machine-id", mid, "--days", "30", "--max-activations", "0"]), s.dir).status).toBe(4);
    expect(sh("offline-license.sh", base(s, ["--machine-id", mid, "--days", "30", "--features", "nope"]), s.dir).status).toBe(4);
    expect(sh("offline-license.sh", [], s.dir).status).toBe(2);
  });
  it("--online codes work with the real server: activation limit, validation and revoke", async () => {
    const s = setup(); const h = await startHarness({ licenseKeys: s.keys.license });
    try {
      const r = sh("offline-license.sh", base(s, ["--online", "--days", "30", "--max-activations", "1"]), s.dir); expect(r.status).toBe(0);
      const code = r.out.trim();
      const mk = (comps = machine(), f = "a.dat") => new LicenseClient({ keys: { license: s.keys.license, receipt: h.receiptKeys }, product: PRODUCT, releaseBuild: true, appVersion: "1", collect: () => comps, http: fetchHttp(h.url), store: new AesFileStore(path.join(s.dir, f), "s") });
      const a = mk(); expect(await a.activate(code)).toEqual({ ok: true });
      const lic = (await h.admin("/licenses")).json.licenses[0].license_id;
      expect(await mk(machine({ guid: hashComponent("guid", "O", SALT), cpu: hashComponent("cpu", "O", SALT), bios: hashComponent("bios", "O", SALT), mac: hashComponent("mac", "O", SALT) }), "b.dat").activate(code)).toMatchObject({ ok: false, error: "activation_limit" });
      await h.admin(`/licenses/${lic}/revoke`, { reason: "test" });
      expect((await a.tick()).evaluation.status).toBe("revoked");
      void DAY;
    } finally { await h.close(); }
  });
  it("an offline code can be imported into the server so it can be revoked later", async () => {
    const s = setup(); const h = await startHarness({ licenseKeys: s.keys.license });
    try {
      const code = sh("offline-license.sh", base(s, ["--machine-id", encodeMachineId(machine()), "--days", "30"]), s.dir).out.trim();
      expect((await h.admin("/licenses", { code })).status).toBe(201);
      expect((await h.admin("/licenses")).json.licenses[0]).toMatchObject({ customer: "Jane Doe", offline: 1, state: "active" });
    } finally { await h.close(); }
  });
});
