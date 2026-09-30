import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LicenseManager } from "../src/main/license";
import type { StoredLicense } from "../src/main/licenseCore";
import type { LeaseResponse, Service } from "../src/main/service";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const b64u = (b: Buffer) => b.toString("base64url");
let clock = 1_000_000;
const lease = (o: { end?: number | null; hours?: number } = {}): LeaseResponse => {
  const payload = { v: 1, cid: 1, did: 1, end: o.end === undefined ? 2_000_000_000 : o.end, iat: clock, exp: clock + (o.hours ?? 72) * 3600, ql: 50 };
  const h = b64u(Buffer.from("{}")), b = b64u(Buffer.from(JSON.stringify(payload)));
  return { lease: `${h}.${b}.${b64u(sign(null, Buffer.from(`${h}.${b}`), privateKey))}`, serverTime: clock, license: { customer: "Acme", endsAt: payload.end, leaseExpiresAt: payload.exp, quotaMonth: 100, quotaLeft: 50 } };
};
const err = (error: string, status = 403, extra = {}) => ({ ok: false as const, error, message: `msg:${error}`, status, ...extra });
function make(svc: Partial<Service>, initial: StoredLicense | null = null) {
  let disk = initial;
  const m = new LicenseManager({ service: svc as Service, publicKey: PUB, deviceId: "d", appVersion: "1", load: () => disk, save: (s) => { disk = s; }, now: () => clock });
  return { m, disk: () => disk };
}

describe("LicenseManager", () => {
  it("activate → active; stores the lease; wrong code surfaces the service message", async () => {
    const ok = make({ activate: async () => ({ ok: true, data: lease() }) });
    expect(await ok.m.activate("X")).toEqual({ ok: true }); expect(ok.m.state).toMatchObject({ kind: "active", info: { customer: "Acme" } }); expect(ok.disk()?.lease).toBeTruthy();
    const bad = make({ activate: async () => err("device_limit", 409) });
    expect(await bad.m.activate("X")).toMatchObject({ ok: false, error: "device_limit", message: "msg:device_limit" }); expect(bad.m.state.kind).toBe("unlicensed");
  });
  it("service says locked/expired on refresh → locks immediately and stays locked after restart, until an online refresh succeeds", async () => {
    let mode: "ok" | "locked" | "net" = "ok";
    const svc: Partial<Service> = { activate: async () => ({ ok: true, data: lease() }), refresh: async () => (mode === "ok" ? { ok: true, data: lease() } : mode === "locked" ? err("locked") : { ok: false, error: "network", message: "net", status: 0, network: true }) };
    const a = make(svc); await a.m.activate("X");
    mode = "locked"; await a.m.refresh();
    expect(a.m.state).toMatchObject({ kind: "locked", reason: "locked", message: "msg:locked" });
    // restart offline: still locked despite a valid lease on disk
    mode = "net"; const b = make(svc, a.disk()); await b.m.init(); b.m.stop();
    expect(b.m.state).toMatchObject({ kind: "locked", reason: "locked" });
    // admin unlocks → refresh succeeds → active again
    mode = "ok"; await b.m.refresh(); expect(b.m.state.kind).toBe("active"); expect(b.disk()?.lock).toBeUndefined();
  });
  it("network failure keeps the app usable inside the offline grace period, then locks when it ends", async () => {
    const svc: Partial<Service> = { activate: async () => ({ ok: true, data: lease({ hours: 72 }) }), refresh: async () => ({ ok: false, error: "network", message: "net", status: 0, network: true }) };
    const a = make(svc); await a.m.activate("X");
    clock += 3600; await a.m.refresh(); expect(a.m.state).toMatchObject({ kind: "active", offline: true });
    clock += 72 * 3600; await a.m.refresh(); expect(a.m.state).toMatchObject({ kind: "locked", reason: "lease_expired" });
  });
  it("device_revoked wipes the local licence", async () => {
    const svc: Partial<Service> = { activate: async () => ({ ok: true, data: lease() }), refresh: async () => err("device_revoked") };
    const a = make(svc); await a.m.activate("X"); await a.m.refresh();
    expect(a.m.state).toMatchObject({ kind: "locked", reason: "device_revoked" }); expect(a.disk()).toBeNull();
  });
  it("readPage refuses while locked, locks on a service 'locked', and tracks quota", async () => {
    let read: () => Promise<any> = async () => ({ ok: true, data: { page: { rows: [] }, quotaLeft: 7 } });
    const svc: Partial<Service> = { activate: async () => ({ ok: true, data: lease() }), readPage: (async () => read()) as any };
    const a = make(svc);
    expect((await a.m.readPage([new Uint8Array(1)], "best")).ok).toBe(false);
    await a.m.activate("X");
    const r = await a.m.readPage([new Uint8Array(1)], "best"); expect(r).toMatchObject({ ok: true });
    expect(a.m.state).toMatchObject({ kind: "active", info: { quotaLeft: 7 } });
    read = async () => err("locked");
    expect(await a.m.readPage([new Uint8Array(1)], "best")).toMatchObject({ ok: false, error: "locked" });
    expect(a.m.state.kind).toBe("locked");
    expect(await a.m.readPage([new Uint8Array(1)], "best")).toMatchObject({ ok: false });
  });
  it("quota errors do not lock the app", async () => {
    const svc: Partial<Service> = { activate: async () => ({ ok: true, data: lease() }), readPage: (async () => err("quota", 402)) as any };
    const a = make(svc); await a.m.activate("X");
    expect(await a.m.readPage([new Uint8Array(1)], "best")).toMatchObject({ error: "quota" }); expect(a.m.state.kind).toBe("active");
  });
});
