import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// node:sqlite is loaded through createRequire so bundlers/test runners that do not know the (still young) built-in leave it alone
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
export type Db = InstanceType<typeof DatabaseSync>;
export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [new URL("../schema.sql", import.meta.url), new URL("./schema.sql", import.meta.url), `${here}/schema.sql`];
  let sql: string | null = null;
  for (const c of candidates) { try { sql = readFileSync(c, "utf8"); break; } catch { /* try next */ } }
  if (!sql) throw new Error("schema.sql not found next to the server.");
  db.exec(sql);
  return db;
}
export const row = <T,>(db: Db, sql: string, ...p: (string | number | null)[]) => db.prepare(sql).get(...p) as T | undefined;
export const rows = <T,>(db: Db, sql: string, ...p: (string | number | null)[]) => db.prepare(sql).all(...p) as T[];
export const run = (db: Db, sql: string, ...p: (string | number | null)[]) => db.prepare(sql).run(...p);
export const nowIso = () => new Date().toISOString();

export function audit(db: Db, actor: "admin" | "client" | "system", action: string, licenseId: string | null, ip: string | null, detail: unknown = {}) {
  run(db, "INSERT INTO audit (ts, actor, action, license_id, ip, detail) VALUES (?,?,?,?,?,?)", nowIso(), actor, action, licenseId, ip, JSON.stringify(detail));
}
/** Fixed-window counter; true = allowed. */
export function rateLimit(db: Db, key: string, limit: number, windowSec: number): boolean {
  const t = Math.floor(Date.now() / 1000), w = t - (t % windowSec);
  const r = row<{ count: number }>(db, "INSERT INTO rate_limits (key, window_start, count) VALUES (?,?,1) ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1 RETURNING count", key, w);
  if (Math.random() < 0.02) run(db, "DELETE FROM rate_limits WHERE window_start < ?", t - 86400);
  return (r?.count ?? 1) <= limit;
}
