#!/usr/bin/env node
// Usage: ADMIN_URL=https://<worker>.workers.dev ADMIN_API_KEY=lsr_... node cli.mjs <command> [args]
const [, , cmd, ...args] = process.argv;
const URL_ = (process.env.ADMIN_URL || "").replace(/\/$/, "");
const KEY = process.env.ADMIN_API_KEY;
if (!URL_ || !KEY) { console.error("Set ADMIN_URL and ADMIN_API_KEY"); process.exit(2); }

const flags = {}; const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) { const k = args[i].slice(2); const v = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true"; flags[k] = v; } else pos.push(args[i]);
}
async function api(path, method = "GET", body) {
  const r = await fetch(URL_ + "/admin/api" + path, { method, headers: { authorization: "Bearer " + KEY, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(`Error ${r.status}: ${j.message || j.error}`); process.exit(1); }
  return j;
}
const d = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") : "-");
const id = () => { if (!pos[0]) { console.error("Missing <id>"); process.exit(2); } return pos[0]; };

const commands = {
  async list() {
    const { codes } = await api("/codes");
    console.table(codes.map((c) => ({ id: c.id, customer: c.customer, code: "…" + c.last5, state: c.state, ends: d(c.ends_at), devices: `${c.devices_used}/${c.max_devices}`, pages: `${c.pages_month}/${c.page_quota_month ?? "∞"}`, seen: d(c.last_seen_at) })));
  },
  async create() {
    const b = { customer: flags.customer, notes: flags.notes || "", maxDevices: +(flags.devices || 1), leaseHours: +(flags["lease-hours"] || 72), pageQuotaMonth: flags.quota ? +flags.quota : null };
    if (flags.days) b.validDays = +flags.days; if (flags.end) b.fixedEnd = flags.end;
    const r = await api("/codes", "POST", b);
    console.log(`Created id ${r.id}\nCODE: ${r.code}\n(shown only once)`);
  },
  async lock() { await api(`/codes/${id()}/lock`, "POST", { reason: flags.reason }); console.log("locked"); },
  async unlock() { await api(`/codes/${id()}/unlock`, "POST", {}); console.log("unlocked"); },
  async extend() { await api(`/codes/${id()}/extend`, "POST", flags.end ? { fixedEnd: flags.end } : { days: +flags.days }); console.log("extended"); },
  async "reset-devices"() { await api(`/codes/${id()}/reset-devices`, "POST", {}); console.log("devices reset"); },
  async delete() { await api(`/codes/${id()}`, "DELETE"); console.log("deleted"); },
  async usage() { const j = await api(`/codes/${id()}/usage`); console.log("devices:", j.devices); console.table(j.usage.map((u) => ({ time: d(u.ts), pages: u.pages, model: u.model, ok: u.ok, error: u.error }))); },
  async audit() { const j = await api("/audit"); console.table(j.audit.map((a) => ({ time: d(a.ts), actor: a.actor, action: a.action, code: a.code_id, ip: a.ip, detail: a.detail }))); },
};
if (!commands[cmd]) {
  console.log(`Commands:
  list
  create --customer "Name" (--days 365 | --end 2027-01-31) [--devices 1] [--quota 500] [--lease-hours 72] [--notes "..."]
  lock <id> [--reason "..."]     unlock <id>
  extend <id> (--days 30 | --end 2027-06-30)
  reset-devices <id>             delete <id>
  usage <id>                     audit`);
  process.exit(cmd ? 2 : 0);
}
await commands[cmd]();
