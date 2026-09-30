import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import { b64u, generateCode, hashCode, hmac, sha256Hex, timingSafeEqual, verifyPassword, verifyTotp } from "./crypto";
import { audit, clientIp, monthKey, now, rateLimit } from "./util";
import { ADMIN_HTML } from "./adminui";

type Actor = "admin" | "cli";
type AdminEnv = { Bindings: Env; Variables: { actor: Actor } };
const COOKIE = "__Host-lsr_admin";
const SESSION_SEC = 8 * 3600;

export const admin = new Hono<AdminEnv>();

admin.get("/admin", (c) => {
  const nonce = b64u(crypto.getRandomValues(new Uint8Array(16)));
  return new Response(ADMIN_HTML.replaceAll("__NONCE__", nonce), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
});

async function readSession(c: Context<AdminEnv>): Promise<{ exp: number; csrf: string } | null> {
  const cookie = c.req.header("cookie") ?? "";
  const m = cookie.split(/;\s*/).find((x) => x.startsWith(COOKIE + "="));
  if (!m) return null;
  const [body, sig] = m.slice(COOKIE.length + 1).split(".");
  if (!body || !sig || !timingSafeEqual(await hmac(c.env.ADMIN_SESSION_SECRET, body), sig)) return null;
  try {
    const p = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))) as { exp: number; csrf: string };
    return p.exp > now() ? p : null;
  } catch { return null; }
}

admin.post("/admin/api/login", async (c) => {
  const ip = clientIp(c);
  if (!(await rateLimit(c.env.DB, `login:${ip}`, 8, 900))) return c.json({ error: "rate_limited", message: "Too many attempts. Wait 15 minutes." }, 429);
  const st = await c.env.DB.prepare("SELECT * FROM admin_state WHERE id=1").first<{ failed_attempts: number; locked_until: number; last_totp_step: number }>();
  if (st && st.locked_until > now()) return c.json({ error: "rate_limited", message: "Login temporarily locked." }, 429);
  const body = await c.req.json().catch(() => ({})) as { password?: string; totp?: string };
  const okPw = typeof body.password === "string" && (await verifyPassword(body.password, c.env.ADMIN_PASSWORD_HASH));
  const step = typeof body.totp === "string" ? await verifyTotp(c.env.ADMIN_TOTP_SECRET, body.totp, now()) : null;
  const okTotp = step != null && step > (st?.last_totp_step ?? 0);
  if (!okPw || !okTotp) {
    const fails = (st?.failed_attempts ?? 0) + 1;
    await c.env.DB.prepare("UPDATE admin_state SET failed_attempts=?, locked_until=? WHERE id=1").bind(fails >= 30 ? 0 : fails, fails >= 30 ? now() + 900 : 0).run();
    await audit(c.env.DB, "admin", "login_failed", null, ip);
    return c.json({ error: "unauthorized", message: "Wrong password or authenticator code." }, 401);
  }
  await c.env.DB.prepare("UPDATE admin_state SET failed_attempts=0, locked_until=0, last_totp_step=? WHERE id=1").bind(step).run();
  const csrf = b64u(crypto.getRandomValues(new Uint8Array(18)));
  const payload = btoa(JSON.stringify({ exp: now() + SESSION_SEC, csrf })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const cookie = `${COOKIE}=${payload}.${await hmac(c.env.ADMIN_SESSION_SECRET, payload)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SEC}`;
  await audit(c.env.DB, "admin", "login", null, ip);
  return c.json({ ok: true, csrf }, 200, { "set-cookie": cookie });
});

admin.post("/admin/api/logout", (c) =>
  c.json({ ok: true }, 200, { "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` }));

// ---- auth middleware for everything else under /admin/api ----
admin.use("/admin/api/*", async (c, next) => {
  if (c.req.path === "/admin/api/login" || c.req.path === "/admin/api/logout") return next();
  const bearer = (c.req.header("authorization") ?? "").match(/^Bearer (.+)$/)?.[1];
  if (bearer) {
    if (!(await rateLimit(c.env.DB, `apikey:${clientIp(c)}`, 60, 60))) return c.json({ error: "rate_limited", message: "Slow down." }, 429);
    if (timingSafeEqual(await sha256Hex(bearer), c.env.ADMIN_API_KEY_HASH)) { c.set("actor", "cli"); return next(); }
    return c.json({ error: "unauthorized", message: "Bad API key." }, 401);
  }
  const s = await readSession(c);
  if (!s) return c.json({ error: "unauthorized", message: "Please sign in." }, 401);
  if (c.req.method !== "GET" && !timingSafeEqual(c.req.header("x-csrf-token") ?? "", s.csrf)) return c.json({ error: "unauthorized", message: "CSRF check failed." }, 403);
  c.set("actor", "admin");
  c.header("cache-control", "no-store");
  return next();
});

admin.get("/admin/api/session", async (c) => c.json({ ok: true, csrf: (await readSession(c))?.csrf ?? null }));

const statusOf = (r: { status: string; ends_at: number | null; first_activated_at: number | null }) =>
  r.status === "locked" ? "locked" : r.ends_at != null && now() > r.ends_at ? "expired" : r.first_activated_at == null ? "unused" : "active";

admin.get("/admin/api/codes", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM devices d WHERE d.code_id=c.id) AS devices_used,
            COALESCE((SELECT pages FROM quota_counters q WHERE q.code_id=c.id AND q.month=?),0) AS pages_month
     FROM codes c ORDER BY c.created_at DESC, c.id DESC`,
  ).bind(monthKey()).all<Record<string, any>>();
  return c.json({ codes: rows.results.map(({ code_hash, ...r }) => ({ ...r, state: statusOf(r as any) })) });
});

const Create = z.object({
  customer: z.string().trim().min(1).max(200),
  notes: z.string().max(2000).default(""),
  validDays: z.number().int().min(1).max(3650).optional(),
  fixedEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  maxDevices: z.number().int().min(1).max(50).default(1),
  leaseHours: z.number().int().min(1).max(24 * 30).default(72),
  pageQuotaMonth: z.number().int().min(0).max(1_000_000).nullable().optional(),
}).refine((v) => (v.validDays != null) !== (v.fixedEnd != null), { message: "Give exactly one of validDays or fixedEnd" });

admin.post("/admin/api/codes", async (c) => {
  const p = Create.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: "bad_request", message: p.error.issues.map((i) => i.message).join("; ") }, 400);
  const v = p.data;
  const code = generateCode();
  const norm = code.replaceAll("-", "");
  const ends = v.fixedEnd ? Math.floor(Date.parse(v.fixedEnd + "T23:59:59Z") / 1000) : null;
  const r = await c.env.DB.prepare(
    `INSERT INTO codes (code_hash,last5,customer,notes,valid_days,ends_at,max_devices,lease_hours,page_quota_month,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).bind(await hashCode(norm), norm.slice(-5), v.customer, v.notes, v.validDays ?? null, ends, v.maxDevices, v.leaseHours, v.pageQuotaMonth ?? null, now()).run();
  const id = r.meta.last_row_id;
  await audit(c.env.DB, c.get("actor"), "create_code", id, clientIp(c), { customer: v.customer, last5: norm.slice(-5) });
  return c.json({ id, code, note: "This is the only time the full code is shown." }, 201);
});

async function withCode(c: Context<AdminEnv>, fn: (id: number) => Promise<Response>) {
  const id = parseInt(c.req.param("id") ?? "", 10);
  const row = await c.env.DB.prepare("SELECT id FROM codes WHERE id=?").bind(id).first();
  if (!row) return c.json({ error: "invalid", message: "No such code." }, 404);
  return fn(id);
}

admin.post("/admin/api/codes/:id/lock", (c) => withCode(c, async (id) => {
  const b = await c.req.json().catch(() => ({})) as { reason?: string };
  await c.env.DB.prepare("UPDATE codes SET status='locked', locked_reason=? WHERE id=?").bind((b.reason ?? "").slice(0, 300) || null, id).run();
  await audit(c.env.DB, c.get("actor"), "lock", id, clientIp(c), { reason: b.reason ?? null });
  return c.json({ ok: true });
}));
admin.post("/admin/api/codes/:id/unlock", (c) => withCode(c, async (id) => {
  await c.env.DB.prepare("UPDATE codes SET status='active', locked_reason=NULL WHERE id=?").bind(id).run();
  await audit(c.env.DB, c.get("actor"), "unlock", id, clientIp(c));
  return c.json({ ok: true });
}));
admin.post("/admin/api/codes/:id/extend", (c) => withCode(c, async (id) => {
  const b = z.object({ days: z.number().int().min(1).max(3650).optional(), fixedEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!b.success || (b.data.days == null) === (b.data.fixedEnd == null)) return c.json({ error: "bad_request", message: "Give exactly one of days or fixedEnd." }, 400);
  const row = (await c.env.DB.prepare("SELECT ends_at, valid_days, first_activated_at FROM codes WHERE id=?").bind(id).first<any>())!;
  if (b.data.fixedEnd) {
    await c.env.DB.prepare("UPDATE codes SET ends_at=? WHERE id=?").bind(Math.floor(Date.parse(b.data.fixedEnd + "T23:59:59Z") / 1000), id).run();
  } else if (row.ends_at != null) {
    await c.env.DB.prepare("UPDATE codes SET ends_at=? WHERE id=?").bind(Math.max(row.ends_at, now()) + b.data.days! * 86400, id).run();
  } else {
    await c.env.DB.prepare("UPDATE codes SET valid_days=COALESCE(valid_days,0)+? WHERE id=?").bind(b.data.days, id).run();
  }
  await audit(c.env.DB, c.get("actor"), "extend", id, clientIp(c), b.data);
  return c.json({ ok: true });
}));
admin.post("/admin/api/codes/:id/reset-devices", (c) => withCode(c, async (id) => {
  await c.env.DB.prepare("DELETE FROM devices WHERE code_id=?").bind(id).run();
  await audit(c.env.DB, c.get("actor"), "reset_devices", id, clientIp(c));
  return c.json({ ok: true });
}));
admin.post("/admin/api/codes/:id/update", (c) => withCode(c, async (id) => {
  const b = z.object({ customer: z.string().min(1).max(200).optional(), notes: z.string().max(2000).optional(),
    maxDevices: z.number().int().min(1).max(50).optional(), leaseHours: z.number().int().min(1).max(720).optional(),
    pageQuotaMonth: z.number().int().min(0).nullable().optional() }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "bad_request", message: "Bad fields." }, 400);
  const d = b.data;
  await c.env.DB.prepare(
    `UPDATE codes SET customer=COALESCE(?,customer), notes=COALESCE(?,notes), max_devices=COALESCE(?,max_devices), lease_hours=COALESCE(?,lease_hours),
     page_quota_month = CASE WHEN ? THEN ? ELSE page_quota_month END WHERE id=?`,
  ).bind(d.customer ?? null, d.notes ?? null, d.maxDevices ?? null, d.leaseHours ?? null, "pageQuotaMonth" in d ? 1 : 0, d.pageQuotaMonth ?? null, id).run();
  await audit(c.env.DB, c.get("actor"), "update", id, clientIp(c), d);
  return c.json({ ok: true });
}));
admin.delete("/admin/api/codes/:id", (c) => withCode(c, async (id) => {
  const r = (await c.env.DB.prepare("SELECT last5, customer FROM codes WHERE id=?").bind(id).first<any>())!;
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM devices WHERE code_id=?").bind(id),
    c.env.DB.prepare("DELETE FROM quota_counters WHERE code_id=?").bind(id),
    c.env.DB.prepare("DELETE FROM usage WHERE code_id=?").bind(id),
    c.env.DB.prepare("DELETE FROM codes WHERE id=?").bind(id),
  ]);
  await audit(c.env.DB, c.get("actor"), "delete", id, clientIp(c), r);
  return c.json({ ok: true });
}));
admin.get("/admin/api/codes/:id/usage", (c) => withCode(c, async (id) => {
  const usage = await c.env.DB.prepare("SELECT ts,device_id,pages,model,ok,error,tokens_in,tokens_out FROM usage WHERE code_id=? ORDER BY ts DESC, id DESC LIMIT 200").bind(id).all();
  const devices = await c.env.DB.prepare("SELECT id,first_seen,last_seen,app_version FROM devices WHERE code_id=?").bind(id).all();
  const log = await c.env.DB.prepare("SELECT ts,actor,action,ip,detail FROM audit WHERE code_id=? ORDER BY ts DESC, id DESC LIMIT 100").bind(id).all();
  return c.json({ usage: usage.results, devices: devices.results, audit: log.results });
}));
admin.get("/admin/api/audit", async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM audit ORDER BY ts DESC, id DESC LIMIT 200").all();
  return c.json({ audit: r.results });
});
