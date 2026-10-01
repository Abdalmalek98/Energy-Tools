import { createServer, type Server } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { AddressInfo } from "node:net";
import { signCode, verifyReceipt, PRODUCT, type Comps, type LicensePayload, type KeyEntry } from "@lsr/licensing";
import { createApp, type App } from "../src/app";
import type { Config } from "../src/config";
import { receiptPublicEntry } from "../src/config";
import { openDb } from "../src/db";
import { DAY, SALT, T0, licKey, machine, makeKey, iso } from "../../licensing/test/helpers";
import { hashComponent } from "@lsr/licensing";
export { DAY, SALT, licKey, machine, makeKey, hashComponent };

export const ADMIN = "a".repeat(40);
export interface Harness { app: App; url: string; cfg: Config; close(): Promise<void>; call(path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; json: any }>; admin(path: string, body?: unknown, method?: string): Promise<{ status: number; json: any }>; nonce(): string; receiptKeys: KeyEntry[] }
let n = 0;
export const nonce = () => `nonce-${Date.now()}-${++n}-abcdefghij`;

export async function startHarness(over: Partial<Config> = {}): Promise<Harness> {
  const { privateKey } = generateKeyPairSync("ed25519");
  const issuer = makeKey("lic-1"); void issuer;
  const cfg: Config = {
    product: PRODUCT, dbPath: ":memory:", adminToken: ADMIN, licenseKeys: [licKey.entry], receiptKey: privateKey, receiptKid: "srv-1", graceHours: 168, allowDevKeys: false, trustProxy: false,
    anthropic: { apiKey: "sk-test", baseUrl: "http://127.0.0.1:1", modelBest: "claude-opus-5-5", modelFast: "claude-sonnet-5-5" }, ...over,
  };
  const app = createApp(cfg, openDb(":memory:"));
  const server: Server = createServer((q, r) => void app.handle(q, r));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(url + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const admin = (path: string, body?: unknown, method?: string) => fetch(url + "/admin/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  return { app, url, cfg, call, admin, nonce, receiptKeys: [receiptPublicEntry(cfg)], close: async () => { await new Promise((r) => server.close(r)); app.close(); } };
}
export function newCode(over: Partial<LicensePayload> = {}, key = licKey) {
  const p: LicensePayload = {
    v: 1, licenseId: over.licenseId ?? `L-${Math.random().toString(36).slice(2, 10)}`, product: PRODUCT, customer: "Jane", company: "Acme", issuedAt: iso(Date.now() - DAY), notBefore: iso(Date.now() - DAY),
    expiresAt: iso(Date.now() + 365 * DAY), maxActivations: 1, offline: false, machine: { mode: "first" }, features: {}, kid: key.kid, ...over,
  };
  return { code: signCode(p, key.priv), payload: p };
}
export const verify = (h: Harness, receipt: string, nonce: string, licenseId?: string) => verifyReceipt(receipt, { keys: h.receiptKeys, product: PRODUCT, nonce, licenseId });
export const activateBody = (code: string, comps: Comps, nonceV = nonce()) => ({ code, machine: { comps }, appVersion: "1.0.0", nonce: nonceV });
export { T0 };

/** A tiny fake Anthropic Messages API. */
export async function startUpstream(reply: (body: any) => { status: number; body: unknown }) {
  const calls: any[] = [];
  const s = createServer((q, r) => { const ch: Buffer[] = []; q.on("data", (c) => ch.push(c)); q.on("end", () => { const b = JSON.parse(Buffer.concat(ch).toString() || "{}"); calls.push({ b, key: q.headers["x-api-key"] }); const x = reply(b); r.writeHead(x.status, { "content-type": "application/json" }); r.end(JSON.stringify(x.body)); }); });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, calls, close: () => new Promise<void>((r) => s.close(() => r())) };
}
