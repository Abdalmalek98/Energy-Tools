import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import { admin } from "./admin";
import { activate, authorize, deactivate, LicenseError, refresh } from "./license";
import { MAX_IMAGE_BYTES, MAX_IMAGES, decodedSize, readPage, UpstreamError } from "./claude";
import { audit, clientIp, monthKey, now, rateLimit } from "./util";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    return c.json({ error: "bad_request", message: "HTTPS only." }, 400);
  }
  await next();
  c.res.headers.set("x-content-type-options", "nosniff");
});

app.onError((e, c) => {
  if (e instanceof LicenseError) return c.json({ error: e.code, message: e.message }, e.status as 403);
  console.error("unhandled", e);
  return c.json({ error: "upstream", message: "Unexpected server error." }, 500);
});

const limited = (c: any) => c.json({ error: "rate_limited", message: "Too many requests. Please wait a moment." }, 429);
async function json(c: any): Promise<any> {
  const len = parseInt(c.req.header("content-length") ?? "0", 10);
  if (len > 16 * 1024 * 1024) return null;
  return c.req.json().catch(() => null);
}

app.get("/v1/ping", (c) => c.json({ ok: true, serverTime: now() }));

app.post("/v1/activate", async (c) => {
  const ip = clientIp(c);
  if (!(await rateLimit(c.env.DB, `act:ip:${ip}`, 10, 60)) || !(await rateLimit(c.env.DB, `act:ip-h:${ip}`, 60, 3600))) return limited(c);
  const b = z.object({ code: z.string().max(64), deviceId: z.string().regex(/^[0-9a-f]{64}$/), appVersion: z.string().max(32) }).safeParse(await json(c));
  if (!b.success) return c.json({ error: "bad_request", message: "Bad request." }, 400);
  return c.json(await activate(c.env, b.data.code, b.data.deviceId, b.data.appVersion, ip));
});

app.post("/v1/refresh", async (c) => {
  const ip = clientIp(c);
  if (!(await rateLimit(c.env.DB, `ref:ip:${ip}`, 60, 60))) return limited(c);
  const b = await json(c);
  return c.json(await refresh(c.env, b?.lease, ip));
});

app.post("/v1/deactivate", async (c) => {
  const ip = clientIp(c);
  if (!(await rateLimit(c.env.DB, `deact:ip:${ip}`, 10, 60))) return limited(c);
  const b = await json(c);
  await deactivate(c.env, b?.lease, ip);
  return c.json({ ok: true });
});

app.post("/v1/read-page", async (c) => {
  const ip = clientIp(c);
  if (!(await rateLimit(c.env.DB, `read:ip:${ip}`, 60, 60))) return limited(c);
  const b = await json(c);
  if (!b) return c.json({ error: "too_large", message: "Request too large." }, 413);
  const { c: code, deviceId } = await authorize(c.env, b.lease);            // locked / expired / revoked → thrown
  if (!(await rateLimit(c.env.DB, `read:code:${code.id}`, 30, 60))) return limited(c);

  const images: unknown = b.images;
  const quality = b.quality === "fast" ? "fast" : b.quality === "best" ? "best" : null;
  if (!Array.isArray(images) || images.length < 1 || !quality || images.some((x) => typeof x !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(x))) {
    return c.json({ error: "bad_request", message: "Send 1–3 base64 JPEG images and quality best|fast." }, 400);
  }
  if (images.length > MAX_IMAGES || images.some((x: string) => decodedSize(x) > MAX_IMAGE_BYTES)) {
    return c.json({ error: "too_large", message: `Max ${MAX_IMAGES} images of about 4 MB each.` }, 413);
  }

  // Reserve one page atomically; refund if the upstream call fails.
  const month = monthKey();
  const quota = code.page_quota_month;
  if (quota === 0) return c.json({ error: "quota", message: "Monthly page quota reached." }, 402);
  const r = await c.env.DB.prepare(
    `INSERT INTO quota_counters (code_id, month, pages) VALUES (?1, ?2, 1)
     ON CONFLICT(code_id, month) DO UPDATE SET pages = pages + 1 WHERE ?3 IS NULL OR pages < ?3`,
  ).bind(code.id, month, quota).run();
  if (r.meta.changes === 0) return c.json({ error: "quota", message: `Monthly quota of ${quota} pages reached. It resets on the 1st (UTC).` }, 402);

  try {
    const out = await readPage(c.env, images as string[], quality);
    await c.env.DB.prepare("INSERT INTO usage (code_id,device_id,ts,pages,model,ok,tokens_in,tokens_out) VALUES (?,?,?,?,?,1,?,?)")
      .bind(code.id, deviceId, now(), 1, out.model, out.tokensIn, out.tokensOut).run();
    await c.env.DB.prepare("UPDATE codes SET last_seen_at=? WHERE id=?").bind(now(), code.id).run();
    const left = quota == null ? null : Math.max(0, quota - (await c.env.DB.prepare("SELECT pages FROM quota_counters WHERE code_id=? AND month=?").bind(code.id, month).first<{ pages: number }>().then((x) => x?.pages ?? 0)));
    return c.json({ page: out.page, quotaLeft: left });
  } catch (e) {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE quota_counters SET pages = MAX(0, pages - 1) WHERE code_id=? AND month=?").bind(code.id, month),
      c.env.DB.prepare("INSERT INTO usage (code_id,device_id,ts,pages,ok,error) VALUES (?,?,?,0,0,?)").bind(code.id, deviceId, now(), String((e as Error).message).slice(0, 200)),
    ]);
    if (e instanceof UpstreamError) return c.json({ error: "upstream", message: e.message, retryable: e.retryable }, 502);
    await audit(c.env.DB, "system", "read_page_exception", code.id, ip, { m: String((e as Error).message).slice(0, 200) });
    return c.json({ error: "upstream", message: "Unexpected error while reading the page.", retryable: false }, 502);
  }
});

app.route("/", admin);
app.notFound((c) => c.json({ error: "bad_request", message: "Not found." }, 404));

export default app;
