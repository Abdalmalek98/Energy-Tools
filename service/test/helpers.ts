import { SELF, env } from "cloudflare:test";

let ipn = 0;
export const H = "https://svc.test";
export const KEY = { authorization: "Bearer test-api-key", "content-type": "application/json" };
export const dev = (n: number) => n.toString(16).padStart(64, "0");

export async function call(path: string, body?: unknown, headers: Record<string, string> = { "content-type": "application/json" }, method = body === undefined ? "GET" : "POST") {
  const r = await SELF.fetch(H + path, { method, headers: { "cf-connecting-ip": (headers as any)["x-ip"] ?? `20.0.${Math.floor(++ipn / 250)}.${ipn % 250}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}
export const admin = (path: string, body?: unknown, method?: string) => call("/admin/api" + path, body, KEY, method);

export async function newCode(opts: Record<string, unknown> = {}) {
  const r = await admin("/codes", { customer: "Acme", validDays: 30, ...opts });
  if (r.status !== 201) throw new Error(JSON.stringify(r));
  return r.json as { id: number; code: string };
}
export const activate = (code: string, n = 1, ip = `10.0.${Math.floor(++ipn / 250)}.${ipn % 250}`) =>
  call("/v1/activate", { code, deviceId: dev(n), appVersion: "1.0.0" }, { "content-type": "application/json", "x-ip": ip });

export const b64 = (n: number) => btoa("x".repeat(n));
export const goodPage = { header: { building_name: "X", section: null, floor: "GF", collected_by: "S", date: "10-2-26", page_label: null, upright: true }, section_changes: [], rows: [{ row: 1, room_name: "OFFICE", fixture_qty: 2, uncertain: [] }], copy_notes: [] };
export { env };
