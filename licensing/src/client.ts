import { randomBytes } from "node:crypto";
import { cleanCode, verifyCode, verifyReceipt } from "./codec";
import { advanceHighWater, evaluate, type Evaluation, type StoredLicense } from "./evaluate";
import { encodeMachineId, machineMatches } from "./fingerprint";
import type { Comps, Keyring } from "./types";

export type HttpResult = { ok: true; status: number; json: Record<string, any> } | { ok: false; status: number; json: Record<string, any>; network: boolean };
export interface Http { post(path: string, body: unknown, timeoutMs?: number): Promise<HttpResult> }

/** The only network code of the licensing client. */
export function fetchHttp(base: string): Http {
  return {
    async post(path, body, timeoutMs = 20_000) {
      try {
        const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
        const json = (await r.json().catch(() => ({}))) as Record<string, any>;
        return r.ok ? { ok: true, status: r.status, json } : { ok: false, status: r.status, json, network: false };
      } catch { return { ok: false, status: 0, json: {}, network: true }; }
    },
  };
}
export interface Store { load(): StoredLicense | null; save(s: StoredLicense | null): void }
export interface ClientDeps {
  keys: Keyring; product: string; releaseBuild: boolean; appVersion: string;
  collect(): Comps; http: Http; store: Store;
  now?: () => number; nonce?: () => string; sleep?: (ms: number) => Promise<void>;
}
export type Result = { ok: true } | { ok: false; error: string; message: string };
export interface ClientStatus { evaluation: Evaluation; machineId: string; notice: string | null }

const NET_MSG = "Could not reach the licensing server. Check your internet connection.";
const DAY = 86_400_000;
const REFUSALS = new Set(["revoked", "suspended", "expired", "not_activated", "machine_mismatch"]);

export class LicenseClient {
  private stored: StoredLicense | null = null;
  private notice: string | null = null;
  private lastFull = 0;
  private now: () => number;
  private nonce: () => string;
  constructor(private d: ClientDeps) {
    this.now = d.now ?? Date.now;
    this.nonce = d.nonce ?? (() => randomBytes(18).toString("base64url"));
    this.reload();
  }

  /** Reads the (encrypted) store again. A damaged or foreign file is discarded with a notice instead of crashing. */
  reload() {
    try { this.stored = this.d.store.load(); this.notice = null; }
    catch { this.stored = null; this.notice = "The saved licence data was damaged or belongs to another computer. Please enter your activation code again."; try { this.d.store.save(null); } catch { /* nothing to remove */ } }
  }
  private save(s: StoredLicense | null) { this.stored = s; this.d.store.save(s); }
  private current() { return this.d.collect(); }

  /** Full re-verification on every call: signature, product, dates, machine, status, grace period. */
  status(): ClientStatus {
    const nowMs = this.now();
    if (this.stored) {
      const hw = advanceHighWater(this.stored, nowMs);
      if (Date.parse(hw) - Date.parse(this.stored.highWater) > 60_000) this.save({ ...this.stored, highWater: hw });
    }
    const evaluation = evaluate(this.stored, { keys: this.d.keys, product: this.d.product, nowMs, current: this.current(), releaseBuild: this.d.releaseBuild });
    return { evaluation, machineId: encodeMachineId(this.current()), notice: this.notice };
  }

  private fail(error: string, message: string): Result { return { ok: false, error, message }; }

  /** Enter a code. Offline licences activate with NO server contact; online licences activate with the server. */
  async activate(codeText: string): Promise<Result> {
    // never trust a clock that is behind the furthest time already seen (re-entering a code must not undo a clock rollback)
    const prevHigh = this.stored ? Date.parse(this.stored.highWater) || 0 : 0;
    const nowMs = Math.max(this.now(), prevHigh);
    const v = verifyCode(codeText, { keys: this.d.keys.license, product: this.d.product, nowMs, releaseBuild: this.d.releaseBuild });
    if (!v.ok) return this.fail(v.reason, v.message);
    const p = v.payload;
    if (Date.parse(p.notBefore) > nowMs) return this.fail("not_yet_valid", `This licence is not valid until ${p.notBefore.slice(0, 10)}.`);
    if (p.expiresAt && Date.parse(p.expiresAt) <= nowMs) return this.fail("expired", "License expired. Please enter a valid activation code.");
    const comps = this.current();
    if (p.machine.mode === "specific" && !machineMatches(p.machine.comps!, comps)) return this.fail("machine_mismatch", "This code was made for a different computer. Send your Machine ID to support to get a code for this one.");
    if (p.offline && p.machine.mode !== "specific") return this.fail("bad_payload", "An offline licence must be tied to one computer.");

    const base: StoredLicense = { code: cleanCode(codeText), activatedAt: new Date(nowMs).toISOString(), machineRef: comps, highWater: new Date(Math.max(nowMs, prevHigh)).toISOString() };
    if (p.offline) { this.save(base); this.notice = null; return { ok: true }; }                      // no network call at all

    const r = await this.serverActivate(base);
    if (!r.ok) return r;
    this.notice = null; return { ok: true };
  }

  /** POST /v1/activate with the stored code; stores the verified receipt. Also used to register an offline licence the first time it reads a page. */
  private async serverActivate(base: StoredLicense): Promise<Result> {
    const nonce = this.nonce(); const comps = this.current();
    const r = await this.d.http.post("/v1/activate", { code: base.code, machine: { comps }, appVersion: this.d.appVersion, nonce });
    if (!r.ok) return r.network ? this.fail("network", NET_MSG) : this.fail(String(r.json.error ?? "server_error"), String(r.json.message ?? "The licensing server refused the request."));
    return this.acceptReceipt(base, r.json.receipt, nonce, r.json.activationId, r.json.serverTime, true);
  }

  private acceptReceipt(base: StoredLicense, receipt: unknown, nonce: string, activationId: unknown, serverTime: unknown, replace: boolean): Result {
    const parsed = verifyCode(base.code, { keys: this.d.keys.license, product: this.d.product, releaseBuild: this.d.releaseBuild });
    if (!parsed.ok) return this.fail(parsed.reason, parsed.message);
    const v = typeof receipt === "string" ? verifyReceipt(receipt, { keys: this.d.keys.receipt, product: this.d.product, nonce, licenseId: parsed.payload.licenseId, releaseBuild: this.d.releaseBuild }) : null;
    if (!v || !v.ok) return this.fail("bad_server_response", v && !v.ok ? v.message : "The server response could not be verified.");
    const st = Date.parse(typeof serverTime === "string" ? serverTime : v.payload.issuedAt) || Date.parse(v.payload.issuedAt);
    const next: StoredLicense = { ...base, activationId: v.payload.activationId, receipt: receipt as string, lastValidatedAt: new Date(st).toISOString(), highWater: new Date(st).toISOString(), refused: undefined };   // the server's clock is authoritative: a successful contact also repairs a high-water mark left by a one-off clock glitch
    void replace; this.save(next); return { ok: true };
  }

  /**
   * Contacts the server for an online licence: a full validation (with machine components) or a light heartbeat.
   * Network problems change nothing (the grace period in the last receipt decides); refusals are remembered.
   */
  async validateNow(kind: "validate" | "heartbeat" = "validate"): Promise<ClientStatus> {
    const s = this.stored; const p = s ? verifyCode(s.code, { keys: this.d.keys.license, product: this.d.product, releaseBuild: this.d.releaseBuild }) : null;
    if (!s || !p || !p.ok || !s.activationId || (p.payload.offline && !s.receipt)) return this.status();   // offline licences never call the server on their own
    const nonce = this.nonce();
    const body = { licenseId: p.payload.licenseId, activationId: s.activationId, appVersion: this.d.appVersion, nonce, ...(kind === "validate" ? { machine: { comps: this.current() } } : {}) };
    const r = await this.d.http.post(`/v1/${kind}`, body);
    if (r.ok) { this.acceptReceipt(s, r.json.receipt, nonce, s.activationId, r.json.serverTime, false); if (kind === "validate") this.lastFull = this.now(); }
    else if (!r.network && REFUSALS.has(String(r.json.error))) this.save({ ...s, refused: { error: String(r.json.error), message: String(r.json.message ?? "The licence was refused by the server.") } });
    return this.status();
  }
  /** Called at launch and every 30 minutes: full validation at least once a day, heartbeats in between. */
  async tick(): Promise<ClientStatus> {
    const full = !this.lastFull || this.now() - this.lastFull > DAY;
    return this.validateNow(full ? "validate" : "heartbeat");
  }

  async deactivate(): Promise<{ ok: true; serverNotified: boolean }> {
    const s = this.stored; let notified = true;
    if (s?.activationId) {
      const p = verifyCode(s.code, { keys: this.d.keys.license, product: this.d.product, releaseBuild: this.d.releaseBuild });
      if (p.ok) { const r = await this.d.http.post("/v1/deactivate", { licenseId: p.payload.licenseId, activationId: s.activationId, nonce: this.nonce() }); notified = r.ok; }
    }
    this.save(null); this.notice = null; this.lastFull = 0;
    return { ok: true, serverNotified: notified };
  }

  /** Reads a page through the server. Offline licences register with the server the first time they read. */
  async readPage(images: Uint8Array[], quality: "best" | "fast", hint?: string): Promise<{ ok: true; page: unknown } | { ok: false; error: string; message: string; retryable?: boolean }> {
    const ev = this.status().evaluation;
    if (!ev.usable || !this.stored) return { ok: false, error: "locked", message: ev.message };
    if (!this.stored.receipt) { const r = await this.serverActivate(this.stored); if (!r.ok) return r; }
    const body = { receipt: this.stored.receipt, quality, hint, images: images.map((b) => Buffer.from(b).toString("base64")) };
    const waits = [1500, 5000, 12000]; const sleep = this.d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let attempt = 0; ; attempt++) {
      const r = await this.d.http.post("/v1/read-page", body, 190_000);
      if (r.ok) return { ok: true, page: r.json.page };
      if (r.network) return { ok: false, error: "network", message: NET_MSG };
      const err = String(r.json.error ?? "server_error"), msg = String(r.json.message ?? "The server refused the request.");
      if ((r.json.retryable || err === "rate_limited") && attempt < waits.length) { await sleep(waits[attempt]); continue; }
      if (REFUSALS.has(err) || err === "invalid") this.save({ ...this.stored, refused: { error: err, message: msg } });
      return { ok: false, error: err, message: msg, retryable: Boolean(r.json.retryable) };
    }
  }
}
