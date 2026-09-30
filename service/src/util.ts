import type { Context } from "hono";

export const now = () => Math.floor(Date.now() / 1000);
export const monthKey = (t = now()) => new Date(t * 1000).toISOString().slice(0, 7);

export function clientIp(c: Context<any>): string {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}

export async function audit(
  db: D1Database, actor: string, action: string, codeId: number | null, ip: string | null, detail: unknown = {},
) {
  await db.prepare("INSERT INTO audit (ts, actor, action, code_id, ip, detail) VALUES (?,?,?,?,?,?)")
    .bind(now(), actor, action, codeId, ip, JSON.stringify(detail)).run();
}

/** Fixed-window counter. Returns true if the call is allowed. */
export async function rateLimit(db: D1Database, key: string, limit: number, windowSec: number): Promise<boolean> {
  const t = now();
  const w = t - (t % windowSec);
  const row = await db.prepare(
    "INSERT INTO rate_limits (key, window_start, count) VALUES (?,?,1) ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1 RETURNING count",
  ).bind(key, w).first<{ count: number }>();
  if (Math.random() < 0.02) {
    await db.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(t - 86400).run();
  }
  return (row?.count ?? 1) <= limit;
}
