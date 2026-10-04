// Reading provider: Anthropic or Groq, chosen and keyed from the License Manager (admin API)
import { afterEach, describe, expect, it } from "vitest";
import { activateBody, machine, newCode, startHarness, startUpstream, type Harness } from "./harness";

let h: Harness | null = null;
afterEach(async () => { await h?.close(); h = null; });
const page = { header: { building_name: "X", section: null, floor: "GF", collected_by: "S", date: "10-2-26", page_label: null, upright: true }, section_changes: [], rows: [{ row: 1, room_name: "OFFICE", uncertain: [] }], copy_notes: [] };
const img = btoa("x".repeat(1000));
const groqOk = (text = JSON.stringify(page)) => ({ status: 200, body: { choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 21, completion_tokens: 9 } } });
async function readOnce(hh: Harness, q: "best" | "fast" = "best", hint?: string) {
  const store = hh as unknown as { _rcpt?: string };
  if (!store._rcpt) store._rcpt = (await hh.call("/v1/activate", activateBody(newCode().code, machine()))).json.receipt;     // one activation per test
  return hh.call("/v1/read-page", { receipt: store._rcpt, images: [img, img, img], quality: q, hint });
}

describe("provider settings (admin API)", () => {
  it("defaults to Anthropic, requires the admin token, and never returns a key", async () => {
    h = await startHarness();
    expect((await h.call("/admin/v1/provider")).status).toBe(401);
    const r = (await h.admin("/provider")).json;
    expect(r.provider).toBe("anthropic"); expect(r.anthropic).toMatchObject({ configured: true, source: "env" }); expect(r.groq).toMatchObject({ configured: false, keyHint: null });
    const save = await h.admin("/provider", { provider: "groq", groq: { apiKey: "gsk_SECRETKEY123456789", modelBest: "vision-big", modelFast: "vision-small" } });
    expect(save.status).toBe(200); expect(save.json.provider).toBe("groq"); expect(save.json.groq).toMatchObject({ configured: true, keyHint: "…6789", source: "stored", modelBest: "vision-big" });
    expect(JSON.stringify(save.json)).not.toContain("SECRETKEY");
    expect(JSON.stringify((await h.admin("/provider")).json)).not.toContain("SECRETKEY");
  });
  it("stores the key ENCRYPTED: it is not in the database, not in the audit log, and a copy of the DB cannot be read without the server's key", async () => {
    h = await startHarness();
    await h.admin("/provider", { groq: { apiKey: "gsk_SECRETKEY123456789" } });
    const dump = JSON.stringify(h.app.db.prepare("SELECT * FROM settings").all()) + JSON.stringify(h.app.db.prepare("SELECT * FROM audit").all());
    expect(dump).not.toContain("SECRETKEY"); expect(dump).toContain("groq.apiKey"); expect(dump).toContain("provider_update");
  });
  it("validates input: provider name, key shape, model ids, https base URL (no credentials)", async () => {
    h = await startHarness();
    expect((await h.admin("/provider", { provider: "openai" })).status).toBe(400);
    expect((await h.admin("/provider", { groq: { apiKey: "short" } })).status).toBe(400);
    expect((await h.admin("/provider", { groq: { apiKey: "has space inside the key value" } })).status).toBe(400);
    expect((await h.admin("/provider", { groq: { modelBest: "bad model!" } })).status).toBe(400);
    await h.close(); h = await startHarness({ allowInsecureUpstream: false });
    for (const u of ["http://api.groq.com/openai/v1", "ftp://x", "not a url", "https://user:pw@api.groq.com/x"]) expect((await h.admin("/provider", { groq: { baseUrl: u } })).status).toBe(400);
    expect((await h.admin("/provider", { groq: { baseUrl: "https://api.groq.com/openai/v1/" } })).json.groq.baseUrl).toBe("https://api.groq.com/openai/v1");
  });
  it("a saved key can be removed; environment settings then apply again", async () => {
    h = await startHarness({ groq: { apiKey: "gsk_FROMENV0000000000", baseUrl: "https://api.groq.com/openai/v1", modelBest: "a", modelFast: "b" } });
    await h.admin("/provider", { groq: { apiKey: "gsk_SAVEDKEY00000000" } });
    expect((await h.admin("/provider")).json.groq).toMatchObject({ source: "stored", keyHint: "…0000" });
    await h.admin("/provider", { groq: { clearKey: true } });
    expect((await h.admin("/provider")).json.groq).toMatchObject({ source: "env", configured: true });
  });
});

describe("reading with Groq", () => {
  it("sends an OpenAI-style request (Bearer key, system prompt, 3 image_url data URIs, chosen model per quality) and returns the validated page", async () => {
    const up = await startUpstream(() => groqOk());
    h = await startHarness();
    await h.admin("/provider", { provider: "groq", groq: { apiKey: "gsk_TESTKEY0000000000", baseUrl: up.url, modelBest: "vision-big", modelFast: "vision-small" } });
    const r = await readOnce(h, "best", "Primary school");
    expect(r.status).toBe(200); expect(r.json.page.rows[0].room_name).toBe("OFFICE");
    const c = up.calls[0]; expect(c.method).toBe("POST"); expect(c.url).toBe("/chat/completions"); expect(c.auth).toBe("Bearer gsk_TESTKEY0000000000"); expect(c.key).toBeUndefined();
    expect(c.b.model).toBe("vision-big"); expect(c.b.temperature).toBe(0); expect(c.b.max_completion_tokens).toBeGreaterThan(1000);
    expect(c.b.messages[0].role).toBe("system"); expect(c.b.messages[0].content).toContain("lighting survey");
    const parts = c.b.messages[1].content; const images = parts.filter((p: any) => p.type === "image_url");
    expect(images).toHaveLength(3); expect(images[0].image_url.url).toBe(`data:image/jpeg;base64,${img}`);
    expect(parts.at(-1).text).toContain("Primary school");
    await readOnce(h, "fast"); expect(up.calls[1].b.model).toBe("vision-small");
    const lic = (await h.admin("/licenses")).json.licenses[0].license_id;
    expect((await h.admin(`/usage/${lic}`)).json.usage[0]).toMatchObject({ ok: 1, model: "vision-small", tokens_in: 21, tokens_out: 9 });
    await up.close();
  });
  it("accepts JSON wrapped in code fences; invalid or cut-off output is a non-retryable upstream error", async () => {
    let reply: any = groqOk("```json\n" + JSON.stringify(page) + "\n```");
    const up = await startUpstream(() => reply);
    h = await startHarness(); await h.admin("/provider", { provider: "groq", groq: { apiKey: "gsk_TESTKEY0000000000", baseUrl: up.url } });
    expect((await readOnce(h)).status).toBe(200);
    reply = groqOk("sorry I cannot read this"); expect((await readOnce(h)).json).toMatchObject({ error: "upstream", retryable: false });
    reply = { status: 200, body: { choices: [{ message: { content: '{"header":' }, finish_reason: "length" }] } }; const r = await readOnce(h);
    expect(r.json.message).toContain("cut off"); expect(r.json.retryable).toBe(false);
    await up.close();
  });
  it("maps provider errors to clear messages: bad key, unknown model, bad request, overloaded (retryable); the provider's own text goes only to the owner's usage log", async () => {
    let reply: any = { status: 401, body: { error: { message: "Invalid API Key SECRET-DETAIL" } } };
    const up = await startUpstream(() => reply);
    h = await startHarness(); await h.admin("/provider", { provider: "groq", groq: { apiKey: "gsk_TESTKEY0000000000", baseUrl: up.url } });
    const bad = await readOnce(h); expect(bad.json.message).toContain("rejected the server's API key"); expect(bad.json.retryable).toBe(false); expect(JSON.stringify(bad.json)).not.toContain("SECRET-DETAIL");
    reply = { status: 404, body: { error: { message: "model_not_found" } } }; expect((await readOnce(h)).json.message).toContain("model was not found");
    reply = { status: 400, body: { error: { message: "image too large" } } }; expect((await readOnce(h)).json.message).toContain("could not accept this page");
    reply = { status: 429, body: {} }; expect((await readOnce(h)).json).toMatchObject({ error: "upstream", retryable: true });
    reply = { status: 503, body: {} }; expect((await readOnce(h)).json.retryable).toBe(true);
    const lic = (await h.admin("/licenses")).json.licenses[0].license_id;
    expect(JSON.stringify((await h.admin(`/usage/${lic}`)).json.usage)).toContain("SECRET-DETAIL");
    await up.close();
  });
  it("is refused with a clear message when the chosen provider has no key", async () => {
    h = await startHarness(); await h.admin("/provider", { provider: "groq" });
    const r = await readOnce(h); expect(r.status).toBe(503); expect(r.json).toMatchObject({ error: "not_configured" }); expect(r.json.message).toContain("no API key");
  });
  it("switching back to Anthropic uses the Anthropic request format and key", async () => {
    const groq = await startUpstream(() => groqOk()); const anth = await startUpstream(() => ({ status: 200, body: { content: [{ type: "text", text: JSON.stringify(page) }], usage: { input_tokens: 5, output_tokens: 2 } } }));
    h = await startHarness({ anthropic: { apiKey: "sk-anth", baseUrl: anth.url, modelBest: "claude-opus-5-5", modelFast: "claude-sonnet-5-5" } });
    await h.admin("/provider", { provider: "groq", groq: { apiKey: "gsk_TESTKEY0000000000", baseUrl: groq.url } });
    await readOnce(h); expect(groq.calls).toHaveLength(1);
    await h.admin("/provider", { provider: "anthropic" });
    expect((await readOnce(h)).status).toBe(200); expect(anth.calls[0].key).toBe("sk-anth"); expect(anth.calls[0].url).toBe("/v1/messages"); expect(groq.calls).toHaveLength(1);
    await groq.close(); await anth.close();
  });
  it("revoked licences are still refused before any provider is called", async () => {
    const up = await startUpstream(() => groqOk());
    h = await startHarness(); await h.admin("/provider", { provider: "groq", groq: { apiKey: "gsk_TESTKEY0000000000", baseUrl: up.url } });
    const a = await h.call("/v1/activate", activateBody(newCode().code, machine()));
    await h.admin(`/licenses/${a.json.licenseId}/revoke`, { reason: "stop" });
    expect((await h.call("/v1/read-page", { receipt: a.json.receipt, images: [img], quality: "best" })).json.error).toBe("revoked");
    expect(up.calls).toHaveLength(0); await up.close();
  });
});

describe("Test connection", () => {
  it("lists the models the key can use, flags a selected model that is missing, and reports a rejected key", async () => {
    let reply: any = { status: 200, body: { data: [{ id: "model-a" }, { id: "vision-big" }, { id: "model-c" }] } };
    const up = await startUpstream(() => reply);
    h = await startHarness();
    expect((await h.admin("/provider/test", { provider: "groq" })).json).toMatchObject({ ok: false, message: expect.stringContaining("No Groq API key") });
    await h.admin("/provider", { groq: { apiKey: "gsk_TESTKEY0000000000", baseUrl: up.url, modelBest: "vision-big", modelFast: "gone-model" } });
    const r = (await h.admin("/provider/test", { provider: "groq" })).json;
    expect(r.ok).toBe(true); expect(r.models).toEqual(["model-a", "model-c", "vision-big"]); expect(r.message).toContain("gone-model");
    expect(up.calls[0]).toMatchObject({ method: "GET", url: "/models", auth: "Bearer gsk_TESTKEY0000000000" });
    reply = { status: 401, body: {} }; expect((await h.admin("/provider/test", { provider: "groq" })).json).toMatchObject({ ok: false, message: "The provider rejected this API key." });
    expect((await h.admin("/provider/test", { provider: "nope" })).status).toBe(400);
    await up.close();
  });
});
