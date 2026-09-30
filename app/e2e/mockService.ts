import { createServer, type Server } from "node:http";
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const keys = JSON.parse(readFileSync(join(__dirname, ".keys.json"), "utf8")) as { pub: string; priv: string };
const b64u = (b: Buffer) => b.toString("base64url");

export interface Mock { server: Server; state: { locked: Set<string>; pages: unknown[]; readCalls: { images: number; sizes: number[]; magic: boolean[]; quality: string; hint?: string }[]; failNext: string | null; leaseHours: number }; close(): Promise<void> }

const CODES: Record<string, { customer: string; kind: "ok" | "locked" | "expired" | "device_limit" }> = {
  AAAAAAAAAAAAAAAAAAAA: { customer: "Acme Test", kind: "ok" },
  BBBBBBBBBBBBBBBBBBBB: { customer: "Locked Co", kind: "locked" },
  CCCCCCCCCCCCCCCCCCCC: { customer: "Expired Co", kind: "expired" },
  DDDDDDDDDDDDDDDDDDDD: { customer: "Full Co", kind: "device_limit" },
};
function lease(code: string, m: Mock["state"]) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { v: 1, cid: 1, did: 1, end: now + 30 * 86400, iat: now, exp: now + m.leaseHours * 3600, ql: 100, code };
  const h = b64u(Buffer.from(JSON.stringify({ alg: "EdDSA" }))), b = b64u(Buffer.from(JSON.stringify(payload)));
  const sig = b64u(sign(null, Buffer.from(`${h}.${b}`), createPrivateKey({ key: Buffer.from(keys.priv, "base64"), format: "der", type: "pkcs8" })));
  return { lease: `${h}.${b}.${sig}`, serverTime: now, license: { customer: CODES[code].customer, endsAt: payload.end, leaseExpiresAt: payload.exp, quotaMonth: 100, quotaLeft: 100 - m.readCalls.length } };
}

export async function startMock(pages: unknown[], port = 8787): Promise<Mock> {
  const state: Mock["state"] = { locked: new Set(), pages, readCalls: [], failNext: null, leaseHours: 72 };
  const codeOf = (t: string) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).code as string;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const send = (status: number, j: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
    const check = (code: string) => state.locked.has(code) ? { s: 403, e: "locked", m: "This code has been locked. Please contact your supplier." } : null;
    if (req.url === "/v1/activate") {
      const code = String(body.code).toUpperCase().replace(/[\s-]/g, ""); const c = CODES[code];
      if (!c) return send(404, { error: "invalid", message: "That code is not valid. Check it and try again." });
      if (c.kind === "locked") return send(403, { error: "locked", message: "This code has been locked. Please contact your supplier." });
      if (c.kind === "expired") return send(403, { error: "expired", message: "This code has expired. Please enter a new code." });
      if (c.kind === "device_limit") return send(409, { error: "device_limit", message: "This code is already active on 1 PC. Deactivate it on another PC or contact your supplier." });
      return send(200, lease(code, state));
    }
    if (req.url === "/v1/refresh" || req.url === "/v1/read-page" || req.url === "/v1/deactivate") {
      let code: string; try { code = codeOf(body.lease); } catch { return send(401, { error: "invalid", message: "Licence token is not valid." }); }
      const l = check(code); if (l && req.url !== "/v1/deactivate") return send(l.s, { error: l.e, message: l.m });
      if (req.url === "/v1/refresh") return send(200, lease(code, state));
      if (req.url === "/v1/deactivate") return send(200, { ok: true });
      const imgs: string[] = body.images ?? [];
      const bufs = imgs.map((s) => Buffer.from(s, "base64"));
      state.readCalls.push({ images: imgs.length, sizes: bufs.map((b) => b.length), magic: bufs.map((b) => b[0] === 0xff && b[1] === 0xd8), quality: body.quality, hint: body.hint });
      if (state.failNext) { const e = state.failNext; state.failNext = null; return send(502, { error: "upstream", message: e, retryable: false }); }
      await new Promise((r) => setTimeout(r, 250));
      const page = state.pages[(state.readCalls.length - 1) % state.pages.length];
      return send(200, { page, quotaLeft: 100 - state.readCalls.length });
    }
    send(404, { error: "bad_request", message: "Not found" });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return { server, state, close: () => new Promise((r) => server.close(() => r())) };
}
