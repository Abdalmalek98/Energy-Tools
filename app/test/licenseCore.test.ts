import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CLOCK_TOLERANCE_S, daysLeft, evaluate, verifyLeaseToken, type LeasePayload, type StoredLicense } from "../src/main/licenseCore";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const b64u = (b: Buffer) => b.toString("base64url");
const mk = (p: Partial<LeasePayload> = {}, key = privateKey) => {
  const payload: LeasePayload = { v: 1, cid: 1, did: 1, end: 2_000_000_000, iat: 1_000_000, exp: 1_000_000 + 72 * 3600, ql: null, ...p };
  const h = b64u(Buffer.from(JSON.stringify({ alg: "EdDSA" }))), b = b64u(Buffer.from(JSON.stringify(payload)));
  return `${h}.${b}.${b64u(sign(null, Buffer.from(`${h}.${b}`), key))}`;
};
const stored = (p: Partial<LeasePayload> = {}, last = 1_000_000): StoredLicense => ({
  lease: mk(p), lastServerTime: last, info: { customer: "Acme", endsAt: null, leaseExpiresAt: 0, quotaMonth: null, quotaLeft: null },
});
const T0 = 1_000_000;

describe("lease verification", () => {
  it("accepts a valid token and rejects tampering / another key / garbage", () => {
    const t = mk();
    expect(verifyLeaseToken(t, PUB)?.cid).toBe(1);
    const [h, b, s] = t.split(".");
    const forged = b64u(Buffer.from(JSON.stringify({ v: 1, cid: 1, did: 1, end: 9_999_999_999, iat: 1, exp: 9_999_999_999, ql: null })));
    expect(verifyLeaseToken(`${h}.${forged}.${s}`, PUB)).toBeNull();
    expect(verifyLeaseToken(mk({}, generateKeyPairSync("ed25519").privateKey), PUB)).toBeNull();
    expect(verifyLeaseToken("a.b.c", PUB)).toBeNull(); expect(verifyLeaseToken("", PUB)).toBeNull();
  });
});

describe("evaluate()", () => {
  it("no stored licence → unlicensed", () => expect(evaluate(null, PUB, T0).state.kind).toBe("unlicensed"));
  it("bad signature → unlicensed (treated as never activated)", () => {
    const s = stored(); s.lease = s.lease.slice(0, -3) + "AAA";
    expect(evaluate(s, PUB, T0).state.kind).toBe("unlicensed");
  });
  it("valid lease → active, from the token's own end/expiry", () => {
    const r = evaluate(stored(), PUB, T0 + 100);
    expect(r.state).toMatchObject({ kind: "active", info: { customer: "Acme", endsAt: 2_000_000_000, leaseExpiresAt: T0 + 72 * 3600 } });
    expect(r.needsRefresh).toBe(false);
  });
  it("licence end passed → locked 'expired', no refresh can help", () => {
    const r = evaluate(stored({ end: T0 + 10 }), PUB, T0 + 11);
    expect(r.state).toMatchObject({ kind: "locked", reason: "expired" }); expect(r.needsRefresh).toBe(false);
  });
  it("lease expired (offline grace over) → locked, needs online refresh", () => {
    const r = evaluate(stored(), PUB, T0 + 72 * 3600 + 1);
    expect(r.state).toMatchObject({ kind: "locked", reason: "lease_expired" }); expect(r.needsRefresh).toBe(true);
  });
  it("clock moved back more than 1 h → needs online refresh; within 1 h is tolerated", () => {
    const last = T0 + 10 * 3600;
    const back = evaluate(stored({}, ), PUB, last - CLOCK_TOLERANCE_S - 1); void back;
    const s = stored({}, last);
    expect(evaluate(s, PUB, last - CLOCK_TOLERANCE_S - 60)).toMatchObject({ needsRefresh: true, state: { reason: "clock" } });
    expect(evaluate(s, PUB, last - 600).needsRefresh).toBe(false);
  });
});

describe("persisted lock", () => {
  it("stays locked after restart (even with a valid lease) and asks for a refresh", () => {
    const s = { ...stored(), lock: { reason: "locked" as const, message: "This code has been locked." } };
    const r = evaluate(s, PUB, T0 + 100);
    expect(r.state).toMatchObject({ kind: "locked", reason: "locked" }); expect(r.needsRefresh).toBe(true);
  });
});

describe("daysLeft", () => {
  it("rounds up and floors at 0; null when no end", () => {
    expect(daysLeft(null, 0)).toBeNull(); expect(daysLeft(86400 * 2 + 1, 0)).toBe(3); expect(daysLeft(10, 100)).toBe(0);
  });
});
