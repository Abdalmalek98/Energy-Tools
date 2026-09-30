import { describe, it, expect, vi, afterEach } from "vitest";
import { activate, admin, b64, call, dev, env, goodPage, newCode } from "./helpers";
import { generateCode, normalizeCode, totpAt, verifyLease } from "../src/crypto";

const now = () => Math.floor(Date.now() / 1000);
const claudeReply = (text: string, status = 200) =>
  new Response(JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 5 } }), { status, headers: { "content-type": "application/json" } });
function mockClaude(fn: (body: any) => Response) {
  const real = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
    if (String(input?.url ?? input).startsWith(env.ANTHROPIC_BASE_URL)) return fn(JSON.parse(init.body));
    return real(input, init);
  });
}
afterEach(() => vi.restoreAllMocks());

describe("codes", () => {
  it("has 20 Crockford chars grouped 5-5-5-5 and normalises input", () => {
    const c = generateCode();
    expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
    expect(normalizeCode(c.toLowerCase().replaceAll("-", " "))).toBe(c.replaceAll("-", ""));
    expect(normalizeCode("nope")).toBeNull();
  });
  it("stores only a hash + last 5", async () => {
    const { id, code } = await newCode();
    const row: any = await env.DB.prepare("SELECT * FROM codes WHERE id=?").bind(id).first();
    expect(JSON.stringify(row)).not.toContain(code.replaceAll("-", ""));
    expect(row.last5).toBe(code.replaceAll("-", "").slice(-5));
  });
});

describe("activation & lease", () => {
  it("activates, issues a verifiable Ed25519 lease and starts the validity clock", async () => {
    const { code } = await newCode({ validDays: 10, leaseHours: 48, pageQuotaMonth: 100 });
    const r = await activate(code);
    expect(r.status).toBe(200);
    const p = await verifyLease(r.json.lease, env.LEASE_PUBLIC_KEY);
    expect(p).toBeTruthy();
    expect(p!.exp - p!.iat).toBe(48 * 3600);
    expect(Math.abs(p!.end! - (now() + 10 * 86400))).toBeLessThan(5);
    expect(p!.ql).toBe(100);
    expect(await verifyLease(r.json.lease.slice(0, -2) + "AA", env.LEASE_PUBLIC_KEY)).toBeNull();
  });
  it("rejects wrong code with 'invalid'", async () => {
    const r = await activate("AAAAA-AAAAA-AAAAA-AAAAA");
    expect(r.status).toBe(404); expect(r.json.error).toBe("invalid");
  });
  it("enforces device limit, allows same device again, deactivate frees a slot", async () => {
    const { code } = await newCode({ maxDevices: 2 });
    const a = await activate(code, 1), b = await activate(code, 2);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await activate(code, 1)).status).toBe(200);
    const c = await activate(code, 3);
    expect(c.status).toBe(409); expect(c.json.error).toBe("device_limit");
    await call("/v1/deactivate", { lease: a.json.lease });
    expect((await activate(code, 3)).status).toBe(200);
  });
  it("lock takes effect on refresh immediately; unlock restores", async () => {
    const { id, code } = await newCode();
    const a = await activate(code);
    expect((await admin(`/codes/${id}/lock`, { reason: "unpaid" })).status).toBe(200);
    const r = await call("/v1/refresh", { lease: a.json.lease });
    expect(r.status).toBe(403); expect(r.json.error).toBe("locked"); expect(r.json.message).toContain("unpaid");
    expect((await activate(code)).json.error).toBe("locked");
    await admin(`/codes/${id}/unlock`, {});
    expect((await call("/v1/refresh", { lease: a.json.lease })).status).toBe(200);
  });
  it("expired code is refused; extend revives it", async () => {
    const { id, code } = await newCode({ validDays: 1 });
    const a = await activate(code);
    await env.DB.prepare("UPDATE codes SET ends_at=? WHERE id=?").bind(now() - 10, id).run();
    const r = await call("/v1/refresh", { lease: a.json.lease });
    expect(r.json.error).toBe("expired");
    await admin(`/codes/${id}/extend`, { days: 5 });
    expect((await call("/v1/refresh", { lease: a.json.lease })).status).toBe(200);
  });
  it("fixed end date in the past is 'expired' at activation", async () => {
    const { code } = await newCode({ validDays: undefined, fixedEnd: "2020-01-01" });
    expect((await activate(code)).json.error).toBe("expired");
  });
  it("reset devices revokes existing leases", async () => {
    const { id, code } = await newCode();
    const a = await activate(code);
    await admin(`/codes/${id}/reset-devices`, {});
    expect((await call("/v1/refresh", { lease: a.json.lease })).json.error).toBe("device_revoked");
  });
  it("rate-limits activation attempts per IP", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await activate("AAAAA-AAAAA-AAAAA-AAAAA", 1, "9.9.9.9")).status;
    expect(last).toBe(429);
  });
});

describe("read-page", () => {
  const imgs = [b64(1000), b64(1000), b64(1000)];
  it("proxies to Claude with server-side key/model, counts pages, enforces quota", async () => {
    const spy = mockClaude(() => claudeReply(JSON.stringify(goodPage)));
    const { code } = await newCode({ pageQuotaMonth: 2 });
    const a = await activate(code);
    const r1 = await call("/v1/read-page", { lease: a.json.lease, images: imgs, quality: "best" });
    expect(r1.status).toBe(200); expect(r1.json.page.rows[0].room_name).toBe("OFFICE"); expect(r1.json.quotaLeft).toBe(1);
    const sent = spy.mock.calls[0]; const hdr = (sent[1] as any).headers;
    expect(hdr["x-api-key"]).toBe("sk-test");
    expect(JSON.parse((sent[1] as any).body).model).toBe("claude-opus-5-5");
    const r2 = await call("/v1/read-page", { lease: a.json.lease, images: [imgs[0]], quality: "fast" });
    expect(JSON.parse((spy.mock.calls[1][1] as any).body).model).toBe("claude-sonnet-5-5");
    expect(r2.json.quotaLeft).toBe(0);
    const r3 = await call("/v1/read-page", { lease: a.json.lease, images: imgs, quality: "best" });
    expect(r3.status).toBe(402); expect(r3.json.error).toBe("quota");
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it("refuses locked codes before calling Claude", async () => {
    const spy = mockClaude(() => claudeReply(JSON.stringify(goodPage)));
    const { id, code } = await newCode();
    const a = await activate(code);
    await admin(`/codes/${id}/lock`, {});
    const r = await call("/v1/read-page", { lease: a.json.lease, images: imgs, quality: "best" });
    expect(r.json.error).toBe("locked"); expect(spy).not.toHaveBeenCalled();
  });
  it("invalid model JSON → upstream, not retryable, page refunded", async () => {
    mockClaude(() => claudeReply("sorry I cannot"));
    const { id, code } = await newCode({ pageQuotaMonth: 5 });
    const a = await activate(code);
    const r = await call("/v1/read-page", { lease: a.json.lease, images: imgs, quality: "best" });
    expect(r.status).toBe(502); expect(r.json.error).toBe("upstream"); expect(r.json.retryable).toBe(false);
    const q: any = await env.DB.prepare("SELECT pages FROM quota_counters WHERE code_id=?").bind(id).first();
    expect(q.pages).toBe(0);
  });
  it("schema-invalid JSON → upstream", async () => {
    mockClaude(() => claudeReply(JSON.stringify({ rows: "nope" })));
    const { code } = await newCode();
    const a = await activate(code);
    expect((await call("/v1/read-page", { lease: a.json.lease, images: imgs, quality: "best" })).json.error).toBe("upstream");
  });
  it("529 overloaded → retryable upstream", async () => {
    mockClaude(() => new Response("{}", { status: 529 }));
    const { code } = await newCode();
    const a = await activate(code);
    const r = await call("/v1/read-page", { lease: a.json.lease, images: imgs, quality: "best" });
    expect(r.json.retryable).toBe(true);
  });
  it("accepts JSON wrapped in code fences", async () => {
    mockClaude(() => claudeReply("```json\n" + JSON.stringify(goodPage) + "\n```"));
    const { code } = await newCode();
    const a = await activate(code);
    expect((await call("/v1/read-page", { lease: a.json.lease, images: imgs, quality: "fast" })).status).toBe(200);
  });
  it("enforces image count/size and rejects bad tokens", async () => {
    const { code } = await newCode();
    const a = await activate(code);
    expect((await call("/v1/read-page", { lease: a.json.lease, images: [...imgs, imgs[0]], quality: "best" })).json.error).toBe("too_large");
    expect((await call("/v1/read-page", { lease: a.json.lease, images: [b64(5 * 1024 * 1024)], quality: "best" })).json.error).toBe("too_large");
    expect((await call("/v1/read-page", { lease: "a.b.c", images: imgs, quality: "best" })).json.error).toBe("invalid");
  });
});

describe("admin", () => {
  it("rejects unauthenticated / wrong key", async () => {
    expect((await call("/admin/api/codes")).status).toBe(401);
    expect((await call("/admin/api/codes", undefined, { authorization: "Bearer nope" })).status).toBe(401);
  });
  it("serves the page with a strict CSP", async () => {
    const r = await (await import("cloudflare:test")).SELF.fetch("https://svc.test/admin");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await r.text()).not.toContain("__NONCE__");
  });
  it("password+TOTP login, cookie session, CSRF required for writes, replay blocked", async () => {
    const step = Math.floor(now() / 30);
    const totp = await totpAt(env.ADMIN_TOTP_SECRET, step);
    const bad = await call("/admin/api/login", { password: "wrong", totp });
    expect(bad.status).toBe(401);
    const { SELF } = await import("cloudflare:test");
    const res = await SELF.fetch("https://svc.test/admin/api/login", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "5.5.5.5" }, body: JSON.stringify({ password: "correct horse", totp }) });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/); expect(cookie).toMatch(/Secure/); expect(cookie).toMatch(/SameSite=Strict/);
    const { csrf } = (await res.json()) as any;
    const ck = cookie.split(";")[0];
    const get = await SELF.fetch("https://svc.test/admin/api/codes", { headers: { cookie: ck } });
    expect(get.status).toBe(200);
    const noCsrf = await SELF.fetch("https://svc.test/admin/api/codes", { method: "POST", headers: { cookie: ck, "content-type": "application/json" }, body: JSON.stringify({ customer: "x", validDays: 1 }) });
    expect(noCsrf.status).toBe(403);
    const ok = await SELF.fetch("https://svc.test/admin/api/codes", { method: "POST", headers: { cookie: ck, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ customer: "x", validDays: 1 }) });
    expect(ok.status).toBe(201);
    const replay = await SELF.fetch("https://svc.test/admin/api/login", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "5.5.5.5" }, body: JSON.stringify({ password: "correct horse", totp }) });
    expect(replay.status).toBe(401);
  });
  it("lists status/devices/usage, updates, audits and deletes", async () => {
    const { id, code } = await newCode({ customer: "Listed", maxDevices: 2, pageQuotaMonth: 50 });
    await activate(code);
    const list = (await admin("/codes")).json.codes.find((c: any) => c.id === id);
    expect(list).toMatchObject({ customer: "Listed", state: "active", devices_used: 1, max_devices: 2, pages_month: 0, page_quota_month: 50 });
    expect(list.code_hash).toBeUndefined();
    await admin(`/codes/${id}/update`, { maxDevices: 3 });
    const u = (await admin(`/codes/${id}/usage`)).json;
    expect(u.audit.map((a: any) => a.action)).toEqual(expect.arrayContaining(["create_code", "activate", "update"]));
    expect((await admin(`/codes/${id}`, undefined, "DELETE")).status).toBe(200);
    expect((await activate(code)).json.error).toBe("invalid");
    expect((await admin("/audit")).json.audit.some((a: any) => a.action === "delete")).toBe(true);
  });
  it("validates create input", async () => {
    expect((await admin("/codes", { customer: "x" })).status).toBe(400);
    expect((await admin("/codes", { customer: "x", validDays: 5, fixedEnd: "2030-01-01" })).status).toBe(400);
  });
});
