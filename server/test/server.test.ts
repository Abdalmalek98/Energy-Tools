import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { signCode, encodeMachineId, hashComponent, PRODUCT } from "@lsr/licensing";
import { ADMIN, DAY, SALT, activateBody, licKey, machine, makeKey, newCode, startHarness, startUpstream, verify, type Harness } from "./harness";

let h: Harness;
beforeEach(async () => { h = await startHarness(); });
afterEach(async () => { await h.close(); });
const other = () => machine({ guid: hashComponent("guid", "X", SALT), cpu: hashComponent("cpu", "X", SALT), bios: hashComponent("bios", "X", SALT), mac: hashComponent("mac", "X", SALT) });

describe("activation", () => {
  it("activates and returns a signed receipt that echoes the nonce", async () => {
    const { code, payload } = newCode(); const n = h.nonce();
    const r = await h.call("/v1/activate", activateBody(code, machine(), n));
    expect(r.status).toBe(200);
    const v = verify(h, r.json.receipt, n, payload.licenseId);
    expect(v.ok && v.payload).toMatchObject({ status: "active", licenseId: payload.licenseId, product: PRODUCT });
    expect(v.ok && Date.parse(v.payload.validUntil) - Date.parse(v.payload.issuedAt)).toBe(168 * 3600_000);
  });
  it("a replayed response (other nonce) is detectable by the client", async () => {
    const { code } = newCode(); const r = await h.call("/v1/activate", activateBody(code, machine(), h.nonce()));
    expect(verify(h, r.json.receipt, "some-other-nonce-123456").ok).toBe(false);
  });
  it("refuses tampered, forged, unknown-key, wrong-product and dev-key codes", async () => {
    const { code } = newCode();
    const post = (c: string) => h.call("/v1/activate", activateBody(c, machine()));
    expect((await post(code.slice(0, -4) + "AAAA")).json.error).toBe("bad_signature");
    expect((await post(newCode({}, makeKey("lic-1")).code)).json.error).toBe("bad_signature");
    expect((await post(newCode({ kid: "zz" }, makeKey("zz")).code)).json.error).toBe("unknown_key");
    expect((await post(newCode({ product: "other" }).code)).json.error).toBe("wrong_product");
    expect((await post("garbage")).json.error).toBe("format");
    const dev = makeKey("dev-1", { dev: true }); await h.close();
    h = await startHarness({ licenseKeys: [licKey.entry, dev.entry] });
    expect((await h.call("/v1/activate", activateBody(newCode({}, dev).code, machine()))).json.error).toBe("dev_key_in_release");
  });
  it("enforces the activation limit, allows the same machine again (also with hardware drift)", async () => {
    const { code } = newCode({ maxActivations: 1 });
    expect((await h.call("/v1/activate", activateBody(code, machine()))).status).toBe(200);
    const drift = machine({ disk: hashComponent("disk", "NEW", SALT), mac: hashComponent("mac", "NEW", SALT) });
    expect((await h.call("/v1/activate", activateBody(code, drift))).status).toBe(200);
    const r = await h.call("/v1/activate", activateBody(code, other()));
    expect(r.status).toBe(409); expect(r.json.error).toBe("activation_limit");
  });
  it("max 2 activations: a third computer is refused", async () => {
    const { code } = newCode({ maxActivations: 2 });
    for (const m of [machine(), other()]) expect((await h.call("/v1/activate", activateBody(code, m))).status).toBe(200);
    const third = machine({ guid: hashComponent("guid", "Z", SALT), cpu: hashComponent("cpu", "Z", SALT), bios: hashComponent("bios", "Z", SALT), mac: hashComponent("mac", "Z", SALT), disk: hashComponent("disk", "Z", SALT) });
    expect((await h.call("/v1/activate", activateBody(code, third))).json.error).toBe("activation_limit");
  });
  it("expired and not-yet-valid codes are refused with clear messages", async () => {
    expect((await h.call("/v1/activate", activateBody(newCode({ expiresAt: new Date(Date.now() - 1000).toISOString() }).code, machine()))).json).toMatchObject({ error: "expired", message: "License expired. Please enter a valid activation code." });
    expect((await h.call("/v1/activate", activateBody(newCode({ notBefore: new Date(Date.now() + 9 * DAY).toISOString() }).code, machine()))).json.error).toBe("not_yet_valid");
  });
  it("machine-specific code works only on that machine (±drift)", async () => {
    const { code } = newCode({ offline: true, machine: { mode: "specific", comps: machine() } });
    expect((await h.call("/v1/activate", activateBody(code, other()))).json.error).toBe("machine_mismatch");
    expect((await h.call("/v1/activate", activateBody(code, machine()))).status).toBe(200);
  });
  it("rejects malformed requests", async () => {
    const { code } = newCode();
    expect((await h.call("/v1/activate", { code, machine: { comps: { guid: "short" } }, nonce: h.nonce() })).status).toBe(400);
    expect((await h.call("/v1/activate", { code, machine: { comps: machine() }, nonce: "x" })).status).toBe(400);
    expect((await h.call("/v1/activate", { machine: { comps: machine() }, nonce: h.nonce() })).status).toBe(400);
  });
  it("rate-limits activation attempts per IP", async () => {
    let last = 0; for (let i = 0; i < 20; i++) last = (await h.call("/v1/activate", activateBody("garbage", machine()))).status;
    expect(last).toBe(429);
  });
});

describe("validate / heartbeat / deactivate", () => {
  async function activated(over = {}) {
    const { code, payload } = newCode(over); const a = await h.call("/v1/activate", activateBody(code, machine()));
    return { code, payload, activationId: a.json.activationId as string, licenseId: payload.licenseId };
  }
  it("validate returns a fresh receipt; mismatching machine is refused; drift tolerated", async () => {
    const a = await activated(); const n = h.nonce();
    const r = await h.call("/v1/validate", { licenseId: a.licenseId, activationId: a.activationId, machine: { comps: machine() }, appVersion: "1.0.1", nonce: n });
    expect(r.status).toBe(200); expect(verify(h, r.json.receipt, n).ok).toBe(true);
    const bad = await h.call("/v1/validate", { licenseId: a.licenseId, activationId: a.activationId, machine: { comps: other() }, nonce: h.nonce() });
    expect(bad.status).toBe(403); expect(bad.json.error).toBe("machine_mismatch");
    const drift = machine({ disk: hashComponent("disk", "N2", SALT), host: hashComponent("host", "N2", SALT) });
    expect((await h.call("/v1/validate", { licenseId: a.licenseId, activationId: a.activationId, machine: { comps: drift }, nonce: h.nonce() })).status).toBe(200);
  });
  it("heartbeat needs no machine components", async () => {
    const a = await activated(); const n = h.nonce();
    const r = await h.call("/v1/heartbeat", { licenseId: a.licenseId, activationId: a.activationId, appVersion: "1.0.0", nonce: n });
    expect(r.status).toBe(200); expect(verify(h, r.json.receipt, n).ok).toBe(true);
  });
  it("revoke / suspend / reinstate: the next validation returns a signed receipt carrying the status", async () => {
    const a = await activated();
    const ask = async () => { const n = h.nonce(); const r = await h.call("/v1/heartbeat", { licenseId: a.licenseId, activationId: a.activationId, nonce: n }); const v = verify(h, r.json.receipt, n); return v.ok ? v.payload : null; };
    expect((await h.admin(`/licenses/${a.licenseId}/suspend`, { reason: "late payment" })).status).toBe(200);
    expect(await ask()).toMatchObject({ status: "suspended", message: "late payment" });
    await h.admin(`/licenses/${a.licenseId}/reinstate`, {}); expect(await ask()).toMatchObject({ status: "active" });
    await h.admin(`/licenses/${a.licenseId}/revoke`, { reason: "chargeback" }); expect(await ask()).toMatchObject({ status: "revoked", message: "chargeback" });
    expect((await h.call("/v1/activate", activateBody(a.code, machine()))).json).toMatchObject({ error: "revoked", message: "chargeback" });
  });
  it("renew / extend change the expiry the client sees (server is authoritative)", async () => {
    const a = await activated({ expiresAt: new Date(Date.now() + 10 * DAY).toISOString() });
    const exp = async () => { const n = h.nonce(); const r = await h.call("/v1/heartbeat", { licenseId: a.licenseId, activationId: a.activationId, nonce: n }); const v = verify(h, r.json.receipt, n); return v.ok ? v.payload : null; };
    await h.admin(`/licenses/${a.licenseId}/extend`, { days: 30 });
    const e1 = await exp(); expect(Math.round((Date.parse(e1!.expiresAt!) - Date.now()) / DAY)).toBe(40);
    await h.admin(`/licenses/${a.licenseId}/renew`, { expiresAt: null }); expect((await exp())!.expiresAt).toBeNull();
    await h.admin(`/licenses/${a.licenseId}/renew`, { expiresAt: new Date(Date.now() - 1000).toISOString() }); expect((await exp())!.status).toBe("expired");
    expect((await h.admin(`/licenses/${a.licenseId}/extend`, { days: 0 })).status).toBe(400);
  });
  it("deactivate frees the slot for another computer", async () => {
    const a = await activated(); expect((await h.call("/v1/activate", activateBody(a.code, other()))).status).toBe(409);
    const n = h.nonce(); const d = await h.call("/v1/deactivate", { licenseId: a.licenseId, activationId: a.activationId, nonce: n });
    expect(d.status).toBe(200); expect(verify(h, d.json.receipt, n).ok && (verify(h, d.json.receipt, n) as any).payload.status).toBe("deactivated");
    expect((await h.call("/v1/activate", activateBody(a.code, other()))).status).toBe(200);
    expect((await h.call("/v1/heartbeat", { licenseId: a.licenseId, activationId: a.activationId, nonce: h.nonce() })).json.error).toBe("not_activated");
  });
  it("replacement: the next new computer replaces the old one even at the limit; reset clears everything", async () => {
    const a = await activated(); await h.admin(`/licenses/${a.licenseId}/replacement`, {});
    expect((await h.call("/v1/activate", activateBody(a.code, other()))).status).toBe(200);
    const old = await h.call("/v1/validate", { licenseId: a.licenseId, activationId: a.activationId, machine: { comps: machine() }, nonce: h.nonce() });
    expect(old.json.error).toBe("not_activated"); expect(old.json.message).toContain("replaced");
    expect((await h.call("/v1/activate", activateBody(a.code, machine()))).status).toBe(409);       // flag is single-use
    await h.admin(`/licenses/${a.licenseId}/reset`, {});
    expect((await h.call("/v1/activate", activateBody(a.code, machine()))).status).toBe(200);
  });
  it("authorize-machine lets a specific machine activate beyond the limit", async () => {
    const a = await activated();
    expect((await h.admin(`/licenses/${a.licenseId}/authorize-machine`, { machineId: "nope" })).status).toBe(400);
    await h.admin(`/licenses/${a.licenseId}/authorize-machine`, { machineId: encodeMachineId(other()) });
    expect((await h.call("/v1/activate", activateBody(a.code, other()))).status).toBe(200);
  });
});

describe("admin API", () => {
  it("requires the bearer token (wrong, missing, near-miss), logs failures, and limits guessing", async () => {
    expect((await h.call("/admin/v1/licenses")).status).toBe(401);
    expect((await h.call("/admin/v1/licenses", undefined, { authorization: "Bearer " + "a".repeat(39) })).status).toBe(401);
    expect((await h.call("/admin/v1/licenses", undefined, { authorization: "Bearer " + ADMIN })).status).toBe(200);
    expect((await h.admin("/audit")).json.audit.some((x: any) => x.action === "auth_failed")).toBe(true);
    let last = 0; for (let i = 0; i < 14; i++) last = (await h.call("/admin/v1/licenses", undefined, { authorization: "Bearer wrong" })).status;
    expect(last).toBe(429);
  });
  it("imports a signed code, lists licences, records every admin action in the audit log", async () => {
    const { code, payload } = newCode({ customer: "Imported Co" });
    expect((await h.admin("/licenses", { code })).status).toBe(201);
    expect((await h.admin("/licenses", { code: code.slice(0, -3) + "AAA" })).status).toBe(400);
    const list = (await h.admin("/licenses")).json.licenses; expect(list.find((l: any) => l.license_id === payload.licenseId)).toMatchObject({ customer: "Imported Co", state: "active", active_count: 0 });
    await h.admin(`/licenses/${payload.licenseId}/suspend`, { reason: "x" });
    const acts = (await h.admin(`/audit?license=${payload.licenseId}`)).json.audit.map((a: any) => a.action);
    expect(acts).toEqual(expect.arrayContaining(["import", "suspend"]));
    expect((await h.admin("/licenses/L-nope/revoke", {})).status).toBe(404);
  });
  it("cannot create codes unless the server holds a signing key; with one it issues verifiable codes", async () => {
    expect((await h.admin("/licenses", { customer: "X" })).json.error).toBe("no_issuer");
    await h.close(); h = await startHarness({ issuerKey: licKey.priv, issuerKid: "lic-1" });
    const r = await h.admin("/licenses", { customer: "Made Here", company: "Co", days: 30, maxActivations: 2 });
    expect(r.status).toBe(201); expect(r.json.code).toMatch(/^LSR1\./);
    expect((await h.call("/v1/activate", activateBody(r.json.code, machine()))).status).toBe(200);
    expect((await h.admin("/licenses", { customer: "Off", offline: true })).json.error).toBe("bad_request");     // offline needs a machine id
    const off = await h.admin("/licenses", { customer: "Off", offline: true, machineId: encodeMachineId(machine()) }); expect(off.status).toBe(201);
  });
  it("stores only hashes and the licence id (privacy)", async () => {
    const { code } = newCode(); await h.call("/v1/activate", activateBody(code, machine()));
    const dump = JSON.stringify(h.app.db.prepare("SELECT * FROM activations").all()) + JSON.stringify(h.app.db.prepare("SELECT * FROM audit").all());
    expect(dump).not.toMatch(/G-1|Ryzen|PC1|aa:bb/);
  });
  it("serves the manager page with a strict CSP and a health check", async () => {
    const r = await fetch(h.url + "/manager"); expect(r.headers.get("content-security-policy")).toContain("default-src 'none'"); expect(await r.text()).not.toContain("__NONCE__");
    expect((await h.call("/healthz")).json.ok).toBe(true);
  });
});

describe("read-page proxy", () => {
  const page = { header: { building_name: "X", section: null, floor: "GF", collected_by: "S", date: "10-2-26", page_label: null, upright: true }, section_changes: [], rows: [{ row: 1, room_name: "OFFICE", uncertain: [] }], copy_notes: [] };
  const img = btoa("x".repeat(1000));
  it("proxies with the server-side key; revoke takes effect on the very next read; quota enforced; usage logged", async () => {
    const up = await startUpstream(() => ({ status: 200, body: { content: [{ type: "text", text: JSON.stringify(page) }], usage: { input_tokens: 11, output_tokens: 7 } } }));
    await h.close(); h = await startHarness({ anthropic: { apiKey: "sk-server", baseUrl: up.url, modelBest: "claude-opus-5-5", modelFast: "claude-sonnet-5-5" } });
    const { code, payload } = newCode({ features: { pagesPerMonth: 2 } });
    const a = await h.call("/v1/activate", activateBody(code, machine()));
    const read = () => h.call("/v1/read-page", { receipt: a.json.receipt, images: [img, img, img], quality: "best", hint: "School" });
    const r1 = await read(); expect(r1.status).toBe(200); expect(r1.json.page.rows[0].room_name).toBe("OFFICE");
    expect(up.calls[0].key).toBe("sk-server"); expect(up.calls[0].b.model).toBe("claude-opus-5-5");
    expect((await read()).status).toBe(200);
    expect((await read()).json.error).toBe("quota");
    expect((await h.admin(`/usage/${payload.licenseId}`)).json.usage[0]).toMatchObject({ ok: 1, tokens_in: 11, tokens_out: 7 });
    await h.admin(`/licenses/${payload.licenseId}/revoke`, { reason: "stop" });
    expect((await read()).json).toMatchObject({ error: "revoked", message: "stop" });
    expect(up.calls).toHaveLength(2);                                  // no upstream call after revoke
    await up.close();
  });
  it("refuses forged / foreign receipts, deactivated computers and bad images", async () => {
    const { code } = newCode(); const a = await h.call("/v1/activate", activateBody(code, machine()));
    expect((await h.call("/v1/read-page", { receipt: a.json.receipt.slice(0, -4) + "AAAA", images: [img], quality: "fast" })).status).toBe(401);
    expect((await h.call("/v1/read-page", { images: [img], quality: "fast" })).status).toBe(401);
    expect((await h.call("/v1/read-page", { receipt: a.json.receipt, images: [img, img, img, img], quality: "fast" })).json.error).toBe("too_large");
    expect((await h.call("/v1/read-page", { receipt: a.json.receipt, images: ["!!"], quality: "fast" })).status).toBe(400);
    await h.call("/v1/deactivate", { licenseId: a.json.licenseId, activationId: a.json.activationId, nonce: h.nonce() });
    expect((await h.call("/v1/read-page", { receipt: a.json.receipt, images: [img], quality: "fast" })).json.error).toBe("not_activated");
  });
  it("invalid model output is an upstream error", async () => {
    const up = await startUpstream(() => ({ status: 200, body: { content: [{ type: "text", text: "sorry" }] } }));
    await h.close(); h = await startHarness({ anthropic: { apiKey: "k", baseUrl: up.url, modelBest: "a", modelFast: "b" } });
    const a = await h.call("/v1/activate", activateBody(newCode().code, machine()));
    const r = await h.call("/v1/read-page", { receipt: a.json.receipt, images: [img], quality: "best" });
    expect(r.status).toBe(502); expect(r.json).toMatchObject({ error: "upstream", retryable: false }); await up.close();
  });
});

describe("start-up", () => {
  it.skipIf(process.platform === "win32")("refuses to start without TLS unless explicitly behind a proxy", () => {
    const build = spawnSync("npx", ["esbuild", "src/main.ts", "--bundle", "--platform=node", "--format=esm", "--target=node22", "--outfile=dist/test-server.mjs", "--external:node:*", "--log-level=error"], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
    expect(build.status).toBe(0);
    const dir = mkdtempSync(path.join(tmpdir(), "srv-")); const keys = path.join(dir, "keys.json"); writeFileSync(keys, JSON.stringify({ license: [licKey.entry] }));
    const { generateKeyPairSync } = require("node:crypto"); const pem = path.join(dir, "r.pem"); writeFileSync(pem, generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }));
    const env = { PATH: process.env.PATH, ADMIN_TOKEN: ADMIN, LICENSE_KEYS_FILE: keys, RECEIPT_KEY_FILE: pem, RECEIPT_KID: "srv-1", DB_PATH: path.join(dir, "db.sqlite") };
    const r = spawnSync(process.execPath, ["--no-warnings", path.resolve(__dirname, "../dist/test-server.mjs")], { env, encoding: "utf8", timeout: 20000 });
    expect(r.status).toBe(1); expect(r.stderr).toContain("Refusing to start without TLS");
    const weak = spawnSync(process.execPath, ["--no-warnings", path.resolve(__dirname, "../dist/test-server.mjs")], { env: { ...env, ADMIN_TOKEN: "short", BEHIND_PROXY: "1" }, encoding: "utf8", timeout: 20000 });
    expect(weak.status).toBe(1); expect(weak.stderr).toContain("at least 32 characters");
    void signCode;
  }, 60000);
});
