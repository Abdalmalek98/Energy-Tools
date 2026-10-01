import { describe, expect, it } from "vitest";
import { advanceHighWater, decodeMachineId, encodeMachineId, evaluate, hashComponent, machineMatches, matchRatio, verifyCode, verifyReceipt, type EvalContext, type StoredLicense, PRODUCT } from "../src";
import { DAY, SALT, T0, code, iso, keyring, licKey, machine, makeKey, payload, rcpKey, receipt } from "./helpers";
import { signCode } from "../src/codec";

const ctx = (o: Partial<EvalContext> = {}): EvalContext => ({ keys: keyring(), product: PRODUCT, nowMs: T0, current: machine(), releaseBuild: true, ...o });
const stored = (o: Partial<StoredLicense> = {}): StoredLicense => ({ code: code(), activatedAt: iso(T0), machineRef: machine(), receipt: receipt(), lastValidatedAt: iso(T0), highWater: iso(T0), ...o });

describe("activation code verification", () => {
  it("accepts a valid code, even pasted with line breaks and spaces", () => {
    const c = code(); const mangled = c.slice(0, 40) + "\n  " + c.slice(40, 90) + " \r\n" + c.slice(90);
    expect(verifyCode(mangled, { keys: keyring().license, product: PRODUCT })).toMatchObject({ ok: true, kid: "lic-1" });
  });
  it("rejects a tampered payload (signature no longer matches)", () => {
    const [p, body, sig] = code().split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload(), expiresAt: null, maxActivations: 999 })).toString("base64url");
    expect(verifyCode(`${p}.${forged}.${sig}`, { keys: keyring().license, product: PRODUCT })).toMatchObject({ ok: false, reason: "bad_signature" }); void body;
  });
  it("rejects a forged signature made with another key, and an unknown kid", () => {
    const attacker = makeKey("lic-1");                                       // same kid, different key
    expect(verifyCode(code({}, attacker), { keys: keyring().license, product: PRODUCT })).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(verifyCode(code({ kid: "nope" }, makeKey("nope")), { keys: keyring().license, product: PRODUCT })).toMatchObject({ ok: false, reason: "unknown_key" });
  });
  it("rejects garbage, truncated and wrong-prefix codes", () => {
    for (const t of ["", "hello", "LSR1.abc", "LSR1..", "XXX1.a.b", code().slice(0, -5), code().replace("LSR1", "CPA1")]) expect(verifyCode(t, { keys: keyring().license, product: PRODUCT }).ok).toBe(false);
  });
  it("rejects another product", () => {
    expect(verifyCode(code({ product: "other-app" }), { keys: keyring().license, product: PRODUCT })).toMatchObject({ ok: false, reason: "wrong_product" });
  });
  it("rejects a development key in a release build, accepts it in a debug build", () => {
    const dev = makeKey("dev-1", { dev: true });
    const keys = [dev.entry];
    const c = code({}, dev);
    expect(verifyCode(c, { keys, product: PRODUCT, releaseBuild: true })).toMatchObject({ ok: false, reason: "dev_key_in_release" });
    expect(verifyCode(c, { keys, product: PRODUCT, releaseBuild: false }).ok).toBe(true);
  });
  it("key rotation: codes from the old and the new key both verify; a withdrawn key does not", () => {
    const k2 = makeKey("lic-2");
    const keys = [licKey.entry, k2.entry];
    expect(verifyCode(code({}, licKey), { keys, product: PRODUCT }).ok).toBe(true);
    expect(verifyCode(code({}, k2), { keys, product: PRODUCT }).ok).toBe(true);
    const withdrawn = [{ ...licKey.entry, revoked: true }, k2.entry];
    expect(verifyCode(code({}, licKey), { keys: withdrawn, product: PRODUCT })).toMatchObject({ ok: false, reason: "key_revoked" });
    expect(verifyCode(code({}, k2), { keys: withdrawn, product: PRODUCT }).ok).toBe(true);
    const expired = [{ ...licKey.entry, notAfter: iso(T0 - 1) }];
    expect(verifyCode(code({}, licKey), { keys: expired, product: PRODUCT, nowMs: T0 })).toMatchObject({ ok: false, reason: "key_expired" });
  });
  it("rejects incomplete payloads (missing fields, specific binding without components, bad activations)", () => {
    const k = licKey;
    const mk = (o: object) => signCode({ ...payload(), ...o } as never, k.priv);
    for (const o of [{ maxActivations: 0 }, { machine: { mode: "specific" } }, { offline: "yes" }, { licenseId: "" }, { notBefore: "garbage" }, { machine: { mode: "weird" } }])
      expect(verifyCode(mk(o), { keys: keyring().license, product: PRODUCT }).ok).toBe(false);
  });
});

describe("receipt verification (server → client)", () => {
  it("accepts a receipt for the same nonce, rejects a replayed one with another nonce", () => {
    const r = receipt({ nonce: "AAA" });
    expect(verifyReceipt(r, { keys: keyring().receipt, product: PRODUCT, nonce: "AAA", licenseId: "L-TEST-0001" }).ok).toBe(true);
    const replay = verifyReceipt(r, { keys: keyring().receipt, product: PRODUCT, nonce: "BBB" });
    expect(replay.ok).toBe(false); expect(!replay.ok && replay.message).toContain("replay");
  });
  it("rejects a receipt signed by a licence key (keys are separate), a forged one, and one for another licence", () => {
    expect(verifyReceipt(receipt({}, licKey as never), { keys: keyring().receipt, product: PRODUCT }).ok).toBe(false);
    expect(verifyReceipt(receipt({}, makeKey("srv-1")), { keys: keyring().receipt, product: PRODUCT })).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(verifyReceipt(receipt(), { keys: keyring().receipt, product: PRODUCT, licenseId: "L-OTHER" }).ok).toBe(false);
  });
});

describe("machine fingerprint", () => {
  it("tolerates hardware drift: ≥ 60 % of components may stay equal", () => {
    const ref = machine();
    const changed = (n: number) => { const c = { ...ref }; Object.keys(c).slice(0, n).forEach((k) => (c[k] = hashComponent(k, "new-" + k, SALT))); return c; };
    expect(machineMatches(ref, changed(0))).toBe(true);
    expect(machineMatches(ref, changed(2))).toBe(true);       // 4/6 = 67 %: new disk + new NIC
    expect(machineMatches(ref, changed(3))).toBe(false);      // 3/6 = 50 %
    expect(matchRatio(ref, changed(6))).toBe(0);
  });
  it("a missing component counts as a mismatch; tiny reference sets must match fully", () => {
    const ref = machine(); const cur = { ...ref }; delete (cur as Record<string, string>).cpu;
    expect(machineMatches(ref, cur)).toBe(true);              // 5/6
    expect(machineMatches({ a: "1", b: "2" }, { a: "1", b: "x" })).toBe(false);
    expect(machineMatches({}, {})).toBe(false);
  });
  it("Machine ID round-trips and rejects junk", () => {
    const m = machine(); const id = encodeMachineId(m);
    expect(id.startsWith("MID1.")).toBe(true); expect(decodeMachineId(id)).toEqual(m); expect(decodeMachineId(" " + id.slice(0, 20) + "\n" + id.slice(20))).toEqual(m);
    for (const j of ["", "MID1.", "MID2." + id.slice(5), "MID1.!!!", "MID1." + Buffer.from('{"v":2,"comps":{"a":"b"}}').toString("base64url"), "MID1." + Buffer.from('{"v":1,"comps":{"A B":"zz"}}').toString("base64url")]) expect(decodeMachineId(j)).toBeNull();
  });
  it("components are hashed, never raw", () => { expect(hashComponent("guid", "SECRET-GUID", SALT)).not.toContain("SECRET"); expect(hashComponent("guid", "a", "s1")).not.toBe(hashComponent("guid", "a", "s2")); });
});

describe("evaluate()", () => {
  it("no licence → unlicensed", () => expect(evaluate(null, ctx()).status).toBe("unlicensed"));
  it("valid online licence with fresh receipt → active, shows the details", () => {
    const e = evaluate(stored(), ctx());
    expect(e).toMatchObject({ status: "active", usable: true, warning: null });
    expect(e.info).toMatchObject({ licenseId: "L-TEST-0001", customer: "Jane Doe", company: "Acme Energy", daysRemaining: 365, offline: false });
  });
  it("tampered / forged stored code → invalid", () => {
    expect(evaluate(stored({ code: code().slice(0, -4) + "AAAA" }), ctx()).status).toBe("invalid");
    expect(evaluate(stored({ code: code({}, makeKey("lic-1")) }), ctx()).status).toBe("invalid");
  });
  it("wrong product, dev key in release", () => {
    expect(evaluate(stored({ code: code({ product: "x" }) }), ctx()).status).toBe("invalid");
    const dev = makeKey("dev-1", { dev: true });
    expect(evaluate(stored({ code: code({}, dev) }), ctx({ keys: { license: [dev.entry], receipt: [rcpKey.entry] } })).status).toBe("invalid");
  });
  it("expired → the exact message; future (notBefore) → not_yet_valid", () => {
    const e = evaluate(stored({ code: code({ expiresAt: iso(T0 - 1000) }), receipt: receipt({ expiresAt: iso(T0 - 1000) }) }), ctx());
    expect(e).toMatchObject({ status: "expired", usable: false, message: "License expired. Please enter a valid activation code." });
    expect(evaluate(stored({ code: code({ notBefore: iso(T0 + 5 * DAY) }) }), ctx()).status).toBe("not_yet_valid");
  });
  it("revoked and suspended receipts lock the app with the server's message", () => {
    expect(evaluate(stored({ receipt: receipt({ status: "revoked", message: "Chargeback" }) }), ctx())).toMatchObject({ status: "revoked", usable: false, message: "Chargeback" });
    expect(evaluate(stored({ receipt: receipt({ status: "suspended" }) }), ctx()).status).toBe("suspended");
  });
  it("wrong machine / copied licence file → wrong_machine (first-activation and specific binding)", () => {
    const other = machine({ guid: hashComponent("guid", "OTHER", SALT), cpu: hashComponent("cpu", "OTHER", SALT), bios: hashComponent("bios", "OTHER", SALT), mac: hashComponent("mac", "OTHER", SALT) });
    expect(evaluate(stored(), ctx({ current: other })).status).toBe("wrong_machine");
    const specific = code({ offline: true, machine: { mode: "specific", comps: machine() } });
    expect(evaluate(stored({ code: specific, receipt: undefined }), ctx({ current: other })).status).toBe("wrong_machine");
    expect(evaluate(stored({ code: specific, receipt: undefined }), ctx()).status).toBe("active");
  });
  it("hardware drift within tolerance still works", () => {
    const drift = machine({ disk: hashComponent("disk", "NEW", SALT), mac: hashComponent("mac", "NEW", SALT) });
    expect(evaluate(stored(), ctx({ current: drift })).status).toBe("active");
  });
  it("copied stored licence on a machine whose offline code is unbound is refused (offline needs a machine)", () => {
    expect(evaluate(stored({ code: code({ offline: true, machine: { mode: "none" } }), receipt: undefined }), ctx()).status).toBe("invalid");
  });
  it("offline grace: warning when validation is overdue, lock when the grace period ends", () => {
    expect(evaluate(stored(), ctx({ nowMs: T0 + 2 * DAY })).status).toBe("warning");                      // > 24 h since validation
    expect(evaluate(stored(), ctx({ nowMs: T0 + 2 * DAY })).warning).toContain("overdue");
    expect(evaluate(stored(), ctx({ nowMs: T0 + 6.5 * DAY })).status).toBe("warning");                    // < 48 h left
    expect(evaluate(stored(), ctx({ nowMs: T0 + 7 * DAY + 1000 }))).toMatchObject({ status: "validation_required", usable: false });
  });
  it("fresh validation clears the warning", () => {
    const s = stored({ receipt: receipt({ issuedAt: iso(T0 + 2 * DAY), validUntil: iso(T0 + 9 * DAY) }), lastValidatedAt: iso(T0 + 2 * DAY) });
    expect(evaluate(s, ctx({ nowMs: T0 + 2.1 * DAY })).status).toBe("active");
  });
  it("renewal/extension: the server's expiresAt wins over the code's", () => {
    const s = stored({ code: code({ expiresAt: iso(T0 + 10 * DAY) }), receipt: receipt({ expiresAt: iso(T0 + 400 * DAY) }) });
    expect(evaluate(s, ctx({ nowMs: T0 + 30 * DAY, validateIntervalMs: 9e9, warnBeforeLockMs: 0 })).info?.daysRemaining).toBe(370);
    const shortened = stored({ receipt: receipt({ expiresAt: iso(T0 + DAY) }) });
    expect(evaluate(shortened, ctx({ nowMs: T0 + 2 * DAY })).status).toBe("expired");
  });
  it("clock rollback cannot extend a licence or reset the grace period", () => {
    const s = stored({ code: code({ expiresAt: iso(T0 + DAY) }), receipt: receipt({ expiresAt: iso(T0 + DAY) }), highWater: iso(T0 + 3 * DAY) });
    const e = evaluate(s, ctx({ nowMs: T0 }));                       // user set the clock back to before expiry
    expect(e.status).toBe("expired"); expect(e.clockRollback).toBe(true);
    const g = evaluate(stored({ highWater: iso(T0 + 8 * DAY) }), ctx({ nowMs: T0 + DAY }));
    expect(g.status).toBe("validation_required");                    // grace measured against the furthest time seen
  });
  it("online licence without any receipt must validate; offline licence never needs the network", () => {
    expect(evaluate(stored({ receipt: undefined }), ctx()).status).toBe("validation_required");
    const off = stored({ code: code({ offline: true, machine: { mode: "specific", comps: machine() } }), receipt: undefined, lastValidatedAt: undefined });
    expect(evaluate(off, ctx({ nowMs: T0 + 300 * DAY })).status).toBe("active");           // months later, still no server needed
  });
  it("a tampered stored receipt makes the licence invalid", () => {
    const r = receipt(); expect(evaluate(stored({ receipt: r.slice(0, -4) + "AAAA" }), ctx()).status).toBe("invalid");
  });
  it("high-water mark only moves forward", () => {
    expect(advanceHighWater({ highWater: iso(T0 + DAY) }, T0)).toBe(iso(T0 + DAY));
    expect(advanceHighWater({ highWater: iso(T0) }, T0 + DAY, T0 + 2 * DAY)).toBe(iso(T0 + 2 * DAY));
  });
});
