import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { decodeMachineId, PRODUCT, signCode, verifyCode, verifyReceipt, type LicensePayload } from "@lsr/licensing";
import type { Config } from "./config";
import { receiptPublicEntry } from "./config";
import { audit, nowIso, openDb, rateLimit, row, rows, run, type Db } from "./db";
import { activate, adminAction, ApiError, deactivate, effectiveExpiry, getLicense, licenseStatus, listLicenses, registerLicense, validate, type ActivationRow, type LicenseRow } from "./licenses";
import { decodedSize, MAX_IMAGE_BYTES, MAX_IMAGES, UpstreamError } from "./claude";
import { publicProvider, readWithProvider, saveProvider, testProvider, PROVIDERS, type ProviderName } from "./providers";
import { MANAGER_HTML } from "./manager";

export interface App { handle(req: IncomingMessage, res: ServerResponse): Promise<void>; db: Db; close(): void }

const sha = (s: string) => createHash("sha256").update(s).digest();
const sameToken = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));   // constant time, independent of length

async function readBody(req: IncomingMessage, max: number): Promise<unknown> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > max) throw new ApiError(413, "too_large", "Request too large."); chunks.push(c as Buffer); }
  if (!n) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ApiError(400, "bad_request", "Invalid JSON."); }
}
const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
  res.end(JSON.stringify(body));
};

export function createApp(cfg: Config, db: Db = openDb(cfg.dbPath)): App {
  const ownReceiptKey = receiptPublicEntry(cfg);
  const ipOf = (req: IncomingMessage) => {
    if (cfg.trustProxy) { const x = String(req.headers["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean); if (x.length) return x[x.length - 1]; }
    return req.socket.remoteAddress ?? "unknown";
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://x"); const path = url.pathname; const ip = ipOf(req);
    try {
      if (req.method === "GET" && path === "/healthz") return send(res, 200, { ok: true, serverTime: nowIso() });
      if (req.method === "GET" && (path === "/manager" || path === "/manager/")) {
        const nonce = createHash("sha256").update(String(Math.random()) + Date.now()).digest("base64url").slice(0, 22);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
          "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` });
        return void res.end(MANAGER_HTML.replaceAll("__NONCE__", nonce));
      }
      if (path.startsWith("/admin/v1/")) return await admin(req, res, path, url, ip);
      if (req.method !== "POST") throw new ApiError(404, "not_found", "Not found.");

      if (!rateLimit(db, `ip:${ip}`, 120, 60)) throw new ApiError(429, "rate_limited", "Too many requests. Please wait a moment.");
      const limit = path === "/v1/read-page" ? 16 * 1024 * 1024 : 64 * 1024;
      const body = (await readBody(req, limit)) as Record<string, unknown>;
      const perLicense = (id: unknown, n = 60) => { if (typeof id === "string" && !rateLimit(db, `lic:${id}`, n, 60)) throw new ApiError(429, "rate_limited", "Too many requests for this licence."); };

      if (path === "/v1/activate") {
        if (!rateLimit(db, `act:${ip}`, 15, 60)) throw new ApiError(429, "rate_limited", "Too many activation attempts. Please wait a minute.");
        return send(res, 200, activate(db, cfg, body as never, ip));
      }
      if (path === "/v1/validate") { perLicense(body.licenseId); return send(res, 200, validate(db, cfg, body, ip, true)); }
      if (path === "/v1/heartbeat") { perLicense(body.licenseId); return send(res, 200, validate(db, cfg, body, ip, false)); }
      if (path === "/v1/deactivate") { perLicense(body.licenseId, 10); return send(res, 200, deactivate(db, cfg, body, ip)); }
      if (path === "/v1/read-page") return await readPageRoute(res, body, ip);
      throw new ApiError(404, "not_found", "Not found.");
    } catch (e) {
      if (e instanceof ApiError) return send(res, e.status, { error: e.error, message: e.message, ...(e.retryable !== undefined ? { retryable: e.retryable } : {}) });
      console.error("unhandled", e);
      send(res, 500, { error: "server_error", message: "Unexpected server error." });
    }
  }

  /** Every page read is authorised against the database: revoked/suspended/expired licences are refused immediately. */
  async function readPageRoute(res: ServerResponse, body: Record<string, unknown>, ip: string) {
    const v = typeof body.receipt === "string" ? verifyReceipt(body.receipt, { keys: [ownReceiptKey], product: cfg.product }) : null;
    if (!v || !v.ok) throw new ApiError(401, "invalid", "Licence token is not valid. Please activate again.");
    const l = row<LicenseRow>(db, "SELECT * FROM licenses WHERE license_id = ?", v.payload.licenseId);
    const a = row<ActivationRow>(db, "SELECT * FROM activations WHERE activation_id = ? AND license_id = ?", v.payload.activationId, v.payload.licenseId);
    if (!l || !a || !a.active) throw new ApiError(403, "not_activated", "This computer is not activated for the licence. Please activate again.");
    const st = licenseStatus(l);
    if (st === "revoked") throw new ApiError(403, "revoked", l.status_reason || "This licence has been revoked. Please contact support.");
    if (st === "suspended") throw new ApiError(403, "suspended", l.status_reason || "This licence is suspended. Please contact support.");
    if (st === "expired") throw new ApiError(403, "expired", "License expired. Please enter a valid activation code.");
    if (!rateLimit(db, `read:${l.license_id}`, 30, 60) || !rateLimit(db, `readip:${ip}`, 60, 60)) throw new ApiError(429, "rate_limited", "Too many requests. Please wait a moment.");
    const images = body.images; const quality = body.quality === "fast" ? "fast" : body.quality === "best" ? "best" : null;
    if (!Array.isArray(images) || images.length < 1 || !quality || images.some((x) => typeof x !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(x))) throw new ApiError(400, "bad_request", "Send 1–3 base64 JPEG images and quality best|fast.");
    if (images.length > MAX_IMAGES || images.some((x: string) => decodedSize(x) > MAX_IMAGE_BYTES)) throw new ApiError(413, "too_large", `Max ${MAX_IMAGES} images of about 4 MB each.`);
    const quota = Number((JSON.parse(l.features) as { pagesPerMonth?: number }).pagesPerMonth ?? 0);
    if (quota > 0) {
      const used = row<{ n: number }>(db, "SELECT COALESCE(SUM(pages),0) AS n FROM usage WHERE license_id = ? AND ok = 1 AND ts >= ?", l.license_id, new Date().toISOString().slice(0, 7) + "-01T00:00:00.000Z")!.n;
      if (used >= quota) throw new ApiError(402, "quota", `Monthly quota of ${quota} pages reached. It resets on the 1st (UTC).`);
    }
    try {
      const out = await readWithProvider(db, cfg, images as string[], quality, typeof body.hint === "string" ? body.hint : null);
      run(db, "INSERT INTO usage (license_id, ts, pages, model, ok, tokens_in, tokens_out) VALUES (?,?,1,?,1,?,?)", l.license_id, nowIso(), out.model, out.tokensIn, out.tokensOut);
      return send(res, 200, { page: out.page });
    } catch (e) {
      run(db, "INSERT INTO usage (license_id, ts, pages, ok, error) VALUES (?,?,0,0,?)", l.license_id, nowIso(), String(e instanceof UpstreamError && e.detail ? `${e.message} [${e.detail}]` : (e as Error).message).slice(0, 400));
      if (e instanceof ApiError) throw e;
      if (e instanceof UpstreamError) throw Object.assign(new ApiError(502, "upstream", e.message), { retryable: e.retryable });
      throw new ApiError(502, "upstream", "Unexpected error while reading the page.");
    }
  }

  async function admin(req: IncomingMessage, res: ServerResponse, path: string, url: URL, ip: string) {
    if (!rateLimit(db, `admin:${ip}`, 120, 60)) throw new ApiError(429, "rate_limited", "Slow down.");
    const m = String(req.headers.authorization ?? "").match(/^Bearer (.+)$/);
    if (!m || !sameToken(m[1], cfg.adminToken)) {
      if (!rateLimit(db, `adminfail:${ip}`, 10, 900)) throw new ApiError(429, "rate_limited", "Too many failed attempts. Wait 15 minutes.");
      audit(db, "admin", "auth_failed", null, ip);
      throw new ApiError(401, "unauthorized", "Bad admin token.");
    }
    const parts = path.slice("/admin/v1/".length).split("/").filter(Boolean);
    const body = req.method === "POST" ? ((await readBody(req, 64 * 1024)) as Record<string, unknown>) : {};
    if (req.method === "GET" && parts[0] === "licenses" && parts.length === 1) return send(res, 200, { licenses: listLicenses(db) });
    if (req.method === "GET" && parts[0] === "licenses" && parts.length === 2) {
      const l = getLicense(db, parts[1]);
      return send(res, 200, { license: { ...l, code_sha256: undefined, effective_expires_at: effectiveExpiry(l), state: licenseStatus(l) },
        activations: rows(db, "SELECT activation_id, machine_hash, first_seen, last_seen, app_version, active, ended_at, ended_reason FROM activations WHERE license_id = ? ORDER BY first_seen", l.license_id),
        authorized: row<{ n: number }>(db, "SELECT COUNT(*) AS n FROM authorized_machines WHERE license_id = ?", l.license_id)!.n });
    }
    if (req.method === "GET" && parts[0] === "usage" && parts[1]) return send(res, 200, { usage: rows(db, "SELECT ts, pages, model, ok, error, tokens_in, tokens_out FROM usage WHERE license_id = ? ORDER BY id DESC LIMIT 300", parts[1]) });
    if (req.method === "GET" && parts[0] === "audit") {
      const id = url.searchParams.get("license");
      return send(res, 200, { audit: id ? rows(db, "SELECT * FROM audit WHERE license_id = ? ORDER BY id DESC LIMIT 300", id) : rows(db, "SELECT * FROM audit ORDER BY id DESC LIMIT 300") });
    }
    if (parts[0] === "provider") {
      if (req.method === "GET" && parts.length === 1) return send(res, 200, publicProvider(db, cfg));
      if (req.method === "POST" && parts.length === 1) {
        const changed = saveProvider(db, cfg, body);
        audit(db, "admin", "provider_update", null, ip, { changed });          // field names only, never values
        return send(res, 200, { ok: true, ...publicProvider(db, cfg) });
      }
      if (req.method === "POST" && parts[1] === "test") {
        const name = (body.provider ?? publicProvider(db, cfg).provider) as ProviderName;
        if (!PROVIDERS.includes(name)) throw new ApiError(400, "bad_request", "provider must be anthropic or groq.");
        return send(res, 200, await testProvider(db, cfg, name));
      }
    }
    if (req.method === "GET" && parts[0] === "info") return send(res, 200, { product: cfg.product, receiptKid: cfg.receiptKid, issuer: !!cfg.issuerKey, issuerKid: cfg.issuerKid ?? null, serverTime: nowIso() });
    if (req.method === "POST" && parts[0] === "licenses" && parts.length === 1) {
      // import a code signed on the owner's PC (recommended) …
      if (typeof body.code === "string") {
        const v = verifyCode(body.code, { keys: cfg.licenseKeys, product: cfg.product, releaseBuild: !cfg.allowDevKeys });
        if (!v.ok) throw new ApiError(400, v.reason, v.message);
        const l = registerLicense(db, v.payload, body.code);
        audit(db, "admin", "import", l.license_id, ip, { customer: l.customer });
        return send(res, 201, { licenseId: l.license_id });
      }
      // … or issue one here, only if this server was given a signing key
      if (!cfg.issuerKey || !cfg.issuerKid) throw new ApiError(400, "no_issuer", "This server has no signing key. Create the code on your PC with scripts/offline-license.sh and import it here.");
      const days = body.days === undefined ? null : Number(body.days);
      const expiresAt = typeof body.expiresAt === "string" ? new Date(body.expiresAt).toISOString() : days ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
      const comps = typeof body.machineId === "string" ? decodeMachineId(body.machineId) : null;
      const offline = body.offline === true;
      if (offline && !comps) throw new ApiError(400, "bad_request", "An offline licence needs the customer's machineId.");
      const p: LicensePayload = {
        v: 1, licenseId: `L-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, product: PRODUCT, customer: String(body.customer ?? "").slice(0, 200), company: String(body.company ?? "").slice(0, 200),
        issuedAt: nowIso(), notBefore: typeof body.notBefore === "string" ? new Date(body.notBefore).toISOString() : nowIso(), expiresAt, maxActivations: Math.max(1, Number(body.maxActivations ?? 1) | 0), offline,
        machine: comps ? { mode: "specific", comps } : { mode: body.binding === "none" ? "none" : "first" }, features: typeof body.features === "object" && body.features ? (body.features as Record<string, unknown>) : {}, kid: cfg.issuerKid,
      };
      if (!p.customer) throw new ApiError(400, "bad_request", "customer is required.");
      const code = signCode(p, cfg.issuerKey);
      registerLicense(db, p, code);
      audit(db, "admin", "create", p.licenseId, ip, { customer: p.customer });
      return send(res, 201, { licenseId: p.licenseId, code, note: "Copy it now and send it to the customer." });
    }
    if (req.method === "POST" && parts[0] === "licenses" && parts.length === 3) { adminAction(db, parts[1], parts[2], body, "admin", ip); return send(res, 200, { ok: true }); }
    throw new ApiError(404, "not_found", "Not found.");
  }

  return { handle, db, close: () => db.close() };
}
