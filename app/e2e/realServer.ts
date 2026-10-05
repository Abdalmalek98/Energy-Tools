import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const keys = JSON.parse(readFileSync(path.join(__dirname, ".keys.json"), "utf8")) as { licensePub: string; licensePem: string; receiptPub: string; receiptPem: string };
export const ADMIN_TOKEN = "e2e-admin-token-".padEnd(40, "x");
export const PORT = 8787, UPSTREAM_PORT = 8790, GROQ_PORT = 8791;
export const URL_ = `http://127.0.0.1:${PORT}`;

/** The real, built licensing server (server/dist/server.mjs) as a child process behind "a proxy" (loopback HTTP). */
export class RealServer {
  private child: ChildProcess | null = null;
  readonly dir = mkdtempSync(path.join(tmpdir(), "lsr-srv-"));
  constructor(private upstreamPort = UPSTREAM_PORT) {
    writeFileSync(path.join(this.dir, "keys.json"), JSON.stringify({ license: [{ kid: "e2e-lic", publicKey: keys.licensePub }] }));
    writeFileSync(path.join(this.dir, "receipt.pem"), keys.receiptPem);
    writeFileSync(path.join(this.dir, "issuer.pem"), keys.licensePem);
  }
  async start() {
    this.child = spawn(process.execPath, ["--no-warnings", path.resolve(__dirname, "../../server/dist/server.mjs")], {
      env: { PATH: process.env.PATH, PORT: String(PORT), BEHIND_PROXY: "1", ADMIN_TOKEN, DB_PATH: path.join(this.dir, "db.sqlite"), LICENSE_KEYS_FILE: path.join(this.dir, "keys.json"),
        RECEIPT_KEY_FILE: path.join(this.dir, "receipt.pem"), RECEIPT_KID: "e2e-rcp", LICENSE_SIGNING_KEY_FILE: path.join(this.dir, "issuer.pem"), LICENSE_SIGNING_KID: "e2e-lic",
        ANTHROPIC_API_KEY: "sk-e2e", ANTHROPIC_BASE_URL: `http://127.0.0.1:${this.upstreamPort}`, GROQ_BASE_URL: `http://127.0.0.1:${GROQ_PORT}` }, stdio: ["ignore", "ignore", "inherit"],
    });
    for (let i = 0; i < 100; i++) { try { if ((await fetch(URL_ + "/healthz")).ok) return; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 100)); }
    throw new Error("server did not start");
  }
  async stop() { const c = this.child; this.child = null; if (c) { c.kill("SIGTERM"); await new Promise((r) => c.once("exit", r)); } }
  async admin(p: string, body?: unknown, method?: string) {
    const r = await fetch(`${URL_}/admin/v1${p}`, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as any };
  }
  /** Creates a licence through the admin API (this test server holds the optional issuing key). */
  async create(over: Record<string, unknown> = {}) {
    const r = await this.admin("/licenses", { customer: "Jane Doe", company: "Acme Energy", days: 30, maxActivations: 1, ...over });
    if (r.status !== 201) throw new Error("create failed: " + JSON.stringify(r.json));
    return r.json as { licenseId: string; code: string };
  }
}

/** Stub of the Anthropic Messages API: returns the next canned page. */
export async function startUpstream(pages: unknown[]) {
  const calls: { model: string; key: string | undefined; images: number }[] = [];
  const s: Server = createServer((q, r) => {
    const ch: Buffer[] = []; q.on("data", (c) => ch.push(c));
    q.on("end", () => {
      const b = JSON.parse(Buffer.concat(ch).toString() || "{}");
      calls.push({ model: b.model, key: q.headers["x-api-key"] as string | undefined, images: (b.messages?.[0]?.content ?? []).filter((c: any) => c.type === "image").length });
      const page = pages[(calls.length - 1) % pages.length];
      setTimeout(() => { r.writeHead(200, { "content-type": "application/json" }); r.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(page) }], usage: { input_tokens: 1000, output_tokens: 300 } })); }, 200);
    });
  });
  await new Promise<void>((r) => s.listen(UPSTREAM_PORT, "127.0.0.1", r));
  return { calls, close: () => new Promise<void>((r) => s.close(() => r())) };
}

/** Stub of Groq's OpenAI-compatible API: GET /models and POST /chat/completions (records the request). */
export async function startGroqUpstream(pages: unknown[], opts: { models?: string[]; goneModel?: string } = {}) {
  const calls: { method: string; url: string; auth?: string; model?: string; images: number }[] = [];
  const s: Server = createServer((q, r) => {
    const ch: Buffer[] = []; q.on("data", (c) => ch.push(c));
    q.on("end", () => {
      const raw = Buffer.concat(ch).toString(); const b = raw ? JSON.parse(raw) : {};
      const images = (b.messages?.[1]?.content ?? []).filter((c: any) => c.type === "image_url").length;
      calls.push({ method: q.method ?? "", url: q.url ?? "", auth: q.headers.authorization, model: b.model, images });
      if (q.method === "POST" && opts.goneModel && b.model === opts.goneModel) { r.writeHead(404, { "content-type": "application/json" }); return void r.end(JSON.stringify({ error: { message: "model not found" } })); }
      r.writeHead(200, { "content-type": "application/json" });
      if (q.method === "GET") return void r.end(JSON.stringify({ data: (opts.models ?? ["e2e-vision-a", "e2e-vision-b"]).map((id) => ({ id })) }));
      const n = calls.filter((c) => c.method === "POST").length;
      r.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(pages[(n - 1) % pages.length]) }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 250 } }));
    });
  });
  await new Promise<void>((r) => s.listen(GROQ_PORT, "127.0.0.1", r));
  return { calls, close: () => new Promise<void>((r) => s.close(() => r())) };
}
