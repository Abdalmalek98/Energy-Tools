// The REAL client (LicenseClient) against the REAL server (HTTP), no mocks of either.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AesFileStore, LicenseClient, fetchHttp, hashComponent, PRODUCT, type Comps, type Http, type StoredLicense } from "@lsr/licensing";
import { DAY, SALT, licKey, machine, makeKey, newCode, startHarness, startUpstream, type Harness } from "./harness";

let h: Harness; let dir: string; let clock: number;
beforeEach(async () => { h = await startHarness(); dir = mkdtempSync(path.join(tmpdir(), "cli-")); clock = Date.now(); });
afterEach(async () => { await h.close(); });
const other = (): Comps => machine({ guid: hashComponent("guid", "X", SALT), cpu: hashComponent("cpu", "X", SALT), bios: hashComponent("bios", "X", SALT), mac: hashComponent("mac", "X", SALT) });

function client(opts: { comps?: Comps; http?: Http; file?: string; keys?: any; releaseBuild?: boolean } = {}) {
  const file = opts.file ?? path.join(dir, "license.dat");
  let comps = opts.comps ?? machine();
  const c = new LicenseClient({
    keys: opts.keys ?? { license: [licKey.entry], receipt: h.receiptKeys }, product: PRODUCT, releaseBuild: opts.releaseBuild ?? true, appVersion: "1.0.0",
    collect: () => comps, http: opts.http ?? fetchHttp(h.url), store: new AesFileStore(file, "machine-secret"), now: () => clock, sleep: async () => {},
  });
  return { c, file, setComps: (x: Comps) => { comps = x; } };
}
const noNetwork: Http = { post: async () => { throw new Error("NETWORK CALL MADE"); } };
const down: Http = { post: async () => ({ ok: false, status: 0, json: {}, network: true }) };
const img = new Uint8Array(1000).fill(1);

describe("online licence", () => {
  it("activate → active → validate → admin revokes → next validation locks, and the lock survives a restart (offline)", async () => {
    const { code, payload } = newCode({ customer: "Jane Doe", company: "Acme" });
    const { c, file } = client();
    expect(c.status().evaluation.status).toBe("unlicensed");
    expect(await c.activate(code)).toEqual({ ok: true });
    const st = c.status(); expect(st.evaluation).toMatchObject({ status: "active", usable: true });
    expect(st.evaluation.info).toMatchObject({ licenseId: payload.licenseId, customer: "Jane Doe", company: "Acme", offline: false }); expect(st.machineId).toMatch(/^MID1\./);
    expect((await c.validateNow()).evaluation.status).toBe("active");
    await h.admin(`/licenses/${payload.licenseId}/revoke`, { reason: "chargeback" });
    expect((await c.tick()).evaluation).toMatchObject({ status: "revoked", usable: false, message: "chargeback" });
    const again = client({ file, http: down }).c;                    // restart, no internet: still locked (signed receipt says revoked)
    expect(again.status().evaluation.status).toBe("revoked");
    await h.admin(`/licenses/${payload.licenseId}/reinstate`, {});
    expect((await c.validateNow()).evaluation.status).toBe("active");
  });
  it("wrong, tampered, forged, unknown-key, wrong-product codes are refused with clear messages", async () => {
    const { c } = client(); const { code } = newCode();
    expect(await c.activate("hello")).toMatchObject({ ok: false, error: "format" });
    expect(await c.activate(code.slice(0, -4) + "AAAA")).toMatchObject({ ok: false, error: "bad_signature" });
    expect(await c.activate(newCode({}, makeKey("lic-1")).code)).toMatchObject({ ok: false, error: "bad_signature" });
    expect(await c.activate(newCode({ kid: "k9" }, makeKey("k9")).code)).toMatchObject({ ok: false, error: "unknown_key" });
    expect(await c.activate(newCode({ product: "x" }).code)).toMatchObject({ ok: false, error: "wrong_product" });
    expect(c.status().evaluation.status).toBe("unlicensed");
  });
  it("expired and future codes", async () => {
    const { c } = client();
    expect(await c.activate(newCode({ expiresAt: new Date(clock - 1000).toISOString() }).code)).toMatchObject({ ok: false, error: "expired", message: "License expired. Please enter a valid activation code." });
    expect(await c.activate(newCode({ notBefore: new Date(clock + 5 * DAY).toISOString() }).code)).toMatchObject({ ok: false, error: "not_yet_valid" });
  });
  it("activation limit: a second computer is refused until the first deactivates", async () => {
    const { code } = newCode({ maxActivations: 1 });
    const a = client({ file: path.join(dir, "a.dat") }), b = client({ comps: other(), file: path.join(dir, "b.dat") });
    expect(await a.c.activate(code)).toEqual({ ok: true });
    expect(await b.c.activate(code)).toMatchObject({ ok: false, error: "activation_limit" });
    expect(await a.c.deactivate()).toEqual({ ok: true, serverNotified: true });
    expect(a.c.status().evaluation.status).toBe("unlicensed");
    expect(await b.c.activate(code)).toEqual({ ok: true });
  });
  it("copied licence file on another computer is refused; the original keeps working", async () => {
    const { code } = newCode({ maxActivations: 5 });
    const a = client({ file: path.join(dir, "a.dat") }); await a.c.activate(code);
    writeFileSync(path.join(dir, "copy.dat"), readFileSync(a.file));
    const thief = client({ comps: other(), file: path.join(dir, "copy.dat"), http: down });
    expect(thief.c.status().evaluation.status).toBe("wrong_machine");
    expect(a.c.status().evaluation.status).toBe("active");
  });
  it("hardware drift: two replaced components keep the licence valid; five do not", async () => {
    const { code } = newCode(); const a = client(); await a.c.activate(code);
    a.setComps(machine({ disk: hashComponent("disk", "N", SALT), mac: hashComponent("mac", "N", SALT) }));
    expect((await a.c.validateNow()).evaluation.status).toBe("active");
    a.setComps(other());
    expect(a.c.status().evaluation.status).toBe("wrong_machine");
  });
  it("server unavailable: works through the grace period with a warning, then locks (and a later successful validation unlocks)", async () => {
    const { code } = newCode(); const a = client(); await a.c.activate(code);
    const offline = client({ file: a.file, http: down }).c; let clockOffset = 0; void clockOffset;
    expect((await offline.tick()).evaluation.status).toBe("active");
    clock += 2 * DAY;
    expect((await offline.tick()).evaluation).toMatchObject({ status: "warning", usable: true });
    expect(offline.status().evaluation.warning).toContain("overdue");
    clock += 6 * DAY;
    expect(offline.status().evaluation).toMatchObject({ status: "validation_required", usable: false });
    clock = Date.now();                                                // the user fixes the PC clock and connects
    const online = client({ file: a.file }).c;
    expect((await online.validateNow()).evaluation.status).toBe("active");
  });
  it("renewal/extension on the server reaches the client at the next validation", async () => {
    const { code, payload } = newCode({ expiresAt: new Date(clock + 10 * DAY).toISOString() });
    const a = client(); await a.c.activate(code);
    expect(a.c.status().evaluation.info?.daysRemaining).toBe(10);
    await h.admin(`/licenses/${payload.licenseId}/extend`, { days: 90 });
    expect((await a.c.validateNow()).evaluation.info?.daysRemaining).toBe(100);
  });
  it("a replayed server response is rejected", async () => {
    const { code } = newCode(); const a = client(); await a.c.activate(code);
    const real = fetchHttp(h.url); let saved: any = null;
    const replay: Http = { post: async (p, b, t) => { const r = await real.post(p, b, t); if (r.ok && !saved && p === "/v1/validate") saved = r.json; return r.ok && saved && p === "/v1/heartbeat" ? { ...r, json: saved } : r; } };
    const b = client({ file: a.file, http: replay }).c;
    await b.validateNow("validate");
    const before = JSON.stringify(readFileSync(a.file));
    await b.validateNow("heartbeat");                                  // gets the OLD receipt (other nonce) → must be ignored
    expect(JSON.stringify(readFileSync(a.file))).toBe(before);
  });
  it("tampered licence cache is detected and discarded with a notice", async () => {
    const { code } = newCode(); const a = client(); await a.c.activate(code);
    const raw = Buffer.from(readFileSync(a.file, "utf8"), "base64"); raw[40] ^= 0xff; writeFileSync(a.file, raw.toString("base64"));
    const b = client({ file: a.file, http: down }).c;
    expect(b.status()).toMatchObject({ evaluation: { status: "unlicensed" }, notice: expect.stringContaining("damaged") });
  });
  it("a licence file copied to another install (different store secret) does not open", async () => {
    const { code } = newCode(); const a = client(); await a.c.activate(code);
    const c2 = new LicenseClient({ keys: { license: [licKey.entry], receipt: h.receiptKeys }, product: PRODUCT, releaseBuild: true, appVersion: "1", collect: () => machine(), http: down, store: new AesFileStore(a.file, "different-machine-secret") });
    expect(c2.status().evaluation.status).toBe("unlicensed");
  });
  it("clock rollback cannot extend a licence or the grace period", async () => {
    const { code } = newCode({ expiresAt: new Date(clock + 3 * DAY).toISOString() }); const a = client(); await a.c.activate(code);
    clock += 4 * DAY; expect(a.c.status().evaluation.status).toBe("expired");
    clock -= 10 * DAY;                                                 // user sets the clock back
    expect(a.c.status().evaluation).toMatchObject({ status: "expired", clockRollback: true });
  });
  it("re-entering a code offline cannot reset the clock-rollback protection", async () => {
    const { code } = newCode({ offline: true, machine: { mode: "specific", comps: machine() }, expiresAt: new Date(clock + 3 * DAY).toISOString() });
    const a = client({ http: noNetwork }); await a.c.activate(code);
    clock += 4 * DAY; expect(a.c.status().evaluation.status).toBe("expired");
    clock -= 10 * DAY;                                                 // roll back, then try to "activate again"
    expect(await a.c.activate(code)).toMatchObject({ ok: false, error: "expired" });
    expect(a.c.status().evaluation).toMatchObject({ status: "expired", clockRollback: true });
  });
  it("key rotation: codes from the old and the new key both work after both public keys are shipped", async () => {
    const k2 = makeKey("lic-2"); await h.close();
    h = await startHarness({ licenseKeys: [licKey.entry, k2.entry] });
    const keys = { license: [licKey.entry, k2.entry], receipt: h.receiptKeys };
    expect(await client({ keys, file: path.join(dir, "o.dat") }).c.activate(newCode({}, licKey).code)).toEqual({ ok: true });
    expect(await client({ keys, file: path.join(dir, "n.dat") }).c.activate(newCode({}, k2).code)).toEqual({ ok: true });
    const oldApp = { license: [licKey.entry], receipt: h.receiptKeys };            // an app that was not updated does not know the new key
    expect(await client({ keys: oldApp, file: path.join(dir, "x.dat") }).c.activate(newCode({}, k2).code)).toMatchObject({ ok: false, error: "unknown_key" });
  });
  it("a development key is refused by a release client and accepted by a debug client", async () => {
    const dev = makeKey("dev-1", { dev: true }); await h.close();
    h = await startHarness({ licenseKeys: [dev.entry], allowDevKeys: true });
    const keys = { license: [dev.entry], receipt: h.receiptKeys }; const code = newCode({}, dev).code;
    expect(await client({ keys, releaseBuild: true, file: path.join(dir, "r.dat") }).c.activate(code)).toMatchObject({ ok: false, error: "dev_key_in_release" });
    expect(await client({ keys, releaseBuild: false, file: path.join(dir, "d.dat") }).c.activate(code)).toEqual({ ok: true });
  });
});

describe("offline licence", () => {
  const off = () => newCode({ offline: true, machine: { mode: "specific", comps: machine() }, maxActivations: 1 });
  it("activates and runs with NO network call at all (for months)", async () => {
    const a = client({ http: noNetwork }); expect(await a.c.activate(off().code)).toEqual({ ok: true });
    expect(a.c.status().evaluation).toMatchObject({ status: "active", usable: true });
    expect((await a.c.tick()).evaluation.status).toBe("active");               // tick makes no call either
    clock += 200 * DAY; expect(a.c.status().evaluation.status).toBe("active");
  });
  it("is refused on a different computer before any network call", async () => {
    expect(await client({ comps: other(), http: noNetwork }).c.activate(off().code)).toMatchObject({ ok: false, error: "machine_mismatch" });
  });
  it("reading pages registers with the server on first use; revocation then stops reading immediately", async () => {
    const page = { header: { building_name: "X", section: null, floor: "GF", collected_by: null, date: null, page_label: null, upright: true }, section_changes: [], rows: [{ row: 1, room_name: "A", uncertain: [] }], copy_notes: [] };
    const up = await startUpstream(() => ({ status: 200, body: { content: [{ type: "text", text: JSON.stringify(page) }], usage: { input_tokens: 1, output_tokens: 1 } } }));
    await h.close(); h = await startHarness({ anthropic: { apiKey: "k", baseUrl: up.url, modelBest: "a", modelFast: "b" } });
    const { code, payload } = off(); const a = client(); await a.c.activate(code);
    const r1 = await a.c.readPage([img], "best"); expect(r1).toMatchObject({ ok: true });
    expect((await h.admin(`/licenses/${payload.licenseId}`)).json.activations).toHaveLength(1);
    await h.admin(`/licenses/${payload.licenseId}/revoke`, { reason: "refund" });
    expect(await a.c.readPage([img], "best")).toMatchObject({ ok: false, error: "revoked", message: "refund" });
    expect(a.c.status().evaluation).toMatchObject({ status: "revoked", usable: false });   // learned the next time it talked to the server
    expect(up.calls).toHaveLength(1); await up.close();
  });
});

describe("read-page through the client", () => {
  it("retries overloaded upstream with back-off but never invalid output; network errors are reported", async () => {
    let n = 0;
    const up = await startUpstream(() => (++n < 3 ? { status: 529, body: {} } : { status: 200, body: { content: [{ type: "text", text: "not json" }] } }));
    await h.close(); h = await startHarness({ anthropic: { apiKey: "k", baseUrl: up.url, modelBest: "a", modelFast: "b" } });
    const a = client(); await a.c.activate(newCode().code);
    const r = await a.c.readPage([img], "best");
    expect(n).toBe(3); expect(r).toMatchObject({ ok: false, error: "upstream", retryable: false });   // two retries for 529, then a non-retryable invalid output
    await up.close();
    expect(await client({ http: down, file: a.file }).c.readPage([img], "best")).toMatchObject({ ok: false, error: "network" });
  });
  it("refuses to read while the app is locked", async () => {
    const a = client(); expect(await a.c.readPage([img], "best")).toMatchObject({ ok: false, error: "locked" });
  });
});
