import { EventEmitter } from "node:events";
import { evaluate, REFRESH_INTERVAL_MS, type LicenseInfo, type LicenseState, type LockReason, type StoredLicense } from "./licenseCore";
import type { LeaseResponse, Service, ServiceError } from "./service";

export interface LicenseDeps {
  service: Service; publicKey: string; deviceId: string; appVersion: string;
  load: () => StoredLicense | null; save: (s: StoredLicense | null) => void; now?: () => number;
}
const LOCK_ERRORS = new Set(["locked", "expired", "device_revoked", "invalid"]);

/** Owns the licence state. The lease never leaves the main process. */
export class LicenseManager extends EventEmitter {
  state: LicenseState = { kind: "unlicensed" };
  private stored: StoredLicense | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private now: () => number;
  constructor(private d: LicenseDeps) { super(); this.now = d.now ?? (() => Math.floor(Date.now() / 1000)); }

  private set(s: LicenseState) { this.state = s; this.emit("status", s); }

  /** At launch: evaluate what's on disk, then refresh online (always, when a lease exists). */
  async init() {
    this.stored = this.d.load();
    const ev = evaluate(this.stored, this.d.publicKey, this.now());
    this.state = ev.state;
    if (this.stored) await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    this.timer.unref?.();
  }
  stop() { if (this.timer) clearInterval(this.timer); }

  private applyLease(r: LeaseResponse) {
    this.stored = { lease: r.lease, lastServerTime: Math.max(r.serverTime, this.stored?.lastServerTime ?? 0), info: r.license };
    this.d.save(this.stored);
    this.set(evaluate(this.stored, this.d.publicKey, Math.max(this.now(), r.serverTime)).state);
  }
  private lock(reason: LockReason, message: string) {
    if (this.stored) {
      // keep the record (so a restart stays locked) unless the lease itself is dead
      const dead = reason === "device_revoked" || reason === "invalid";
      this.stored = dead ? null : { ...this.stored, lock: { reason, message } };
      this.d.save(this.stored);
    }
    this.set({ kind: "locked", reason, message });
  }
  private onServiceError(e: ServiceError) {
    if (LOCK_ERRORS.has(e.error)) { this.lock(e.error as LockReason, e.message); return true; }
    return false;
  }

  async activate(code: string): Promise<{ ok: true } | { ok: false; error: string; message: string }> {
    const r = await this.d.service.activate(code, this.d.deviceId, this.d.appVersion);
    if (!r.ok) return { ok: false, error: r.error, message: r.message };
    this.stored = null; this.applyLease(r.data);
    return { ok: true };
  }

  async refresh() {
    if (!this.stored) return;
    const r = await this.d.service.refresh(this.stored.lease);
    if (r.ok) return this.applyLease(r.data);
    if (this.onServiceError(r)) return;
    // network / transient: keep going only while the offline grace lease is valid and the clock is sane
    const ev = evaluate(this.stored, this.d.publicKey, this.now());
    this.set(ev.state.kind === "active" ? { ...ev.state, offline: true } : ev.state);
  }

  async deactivate() {
    if (this.stored) await this.d.service.deactivate(this.stored.lease);   // best effort; local wipe regardless
    this.stored = null; this.d.save(null); this.set({ kind: "unlicensed" });
  }

  /** Reads one page through the service. Locks the app immediately if the service says locked/expired. */
  async readPage(images: Uint8Array[], quality: "best" | "fast", hint?: string) {
    if (this.state.kind !== "active" || !this.stored) return { ok: false as const, error: "locked", message: "The app is locked." };
    const r = await this.d.service.readPage(this.stored.lease, images, quality, hint);
    if (r.ok) {
      const ql = r.data.quotaLeft;
      if (this.state.kind === "active") { this.stored.info = { ...this.stored.info, quotaLeft: ql }; this.d.save(this.stored); this.set({ ...this.state, info: { ...this.state.info, quotaLeft: ql } as LicenseInfo }); }
      return { ok: true as const, page: r.data.page };
    }
    this.onServiceError(r);
    return { ok: false as const, error: r.error, message: r.message, retryable: r.retryable };
  }
}
