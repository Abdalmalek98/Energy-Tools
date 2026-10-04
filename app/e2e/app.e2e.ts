import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ADMIN_TOKEN, RealServer, startGroqUpstream, startUpstream, URL_ } from "./realServer";

const APP = path.resolve(__dirname, "..");
const REF = path.resolve(APP, "../reference");
const tmp = () => mkdtempSync(path.join(tmpdir(), "lsr-e2e-"));
const SHOTS = process.env.LSR_SHOTS;                       // optional: save screenshots for the user guide
const shot = async (p: Page, name: string) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + ".png") }); } };

// ---- canned model output: the team's typed answers (template rows 3-41) as three sheets of 13 rows ----
const COLKEY: Record<string, string> = { F: "floor", G: "room_name", H: "space_type", I: "room_tag", J: "led", K: "normal_emergency", L: "unit_desc", M: "lamp_desc", N: "fixture_qty", O: "lamps_per_fixture", Q: "lamp_watt", R: "color_temp", S: "voltage", T: "int_ext", U: "holder", V: "mounted", W: "cutout", X: "dimmable", Y: "sensors", Z: "ceiling", AB: "height", AC: "switch_status", AD: "remarks" };
async function modelPages() {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(REF, "MOH-JZ - Lightings - Raeds team.xlsx"));
  const ws = wb.getWorksheet("Lighting Survey Template")!;
  const v = (c: any) => (c && typeof c === "object" && "result" in c ? c.result : c) ?? null;
  const rows: Record<string, any>[] = []; let prev: Record<string, any> = {};
  for (let r = 3; r <= 41; r++) {
    if ((r - 3) % 13 === 0) prev = {};                                                     // each canned sheet is self-contained (no ditto across pages)
    const o: Record<string, any> = { row: ((r - 3) % 13) + 1, uncertain: [], note: null };
    for (const [c, k] of Object.entries(COLKEY)) { const x = v(ws.getCell(c + r).value); o[k] = x !== null && x === prev[k] && !["room_name", "room_tag"].includes(k) ? "^" : x; prev[k] = x; }
    const area = v(ws.getCell("AA" + r).value); o.dimensions = area ? `${area}x1` : null;
    rows.push(o);
  }
  // pages are served in arrival order (2 are read in parallel), so every canned page has the same shape
  const pages = [0, 1, 2].map((i) => ({
    header: { building_name: "AL FATHIA HEALTH CENTER", section: null, floor: "GF", collected_by: "SUJAN", date: "10-2-26", page_label: `${i + 1}/3`, upright: true },
    section_changes: [], rows: rows.slice(i * 13, i * 13 + 13).map((r): Record<string, any> => ({ ...r, uncertain: [...r.uncertain] })), copy_notes: [],
  }));
  for (const p of pages) {
    p.rows[1].uncertain = ["lamp_watt"]; p.rows[1].note = "smudged";                                    // flagged by the model
    p.rows[2].lamp_watt = 0; p.rows[2].uncertain = ["lamp_watt"]; p.rows[2].note = "ESTIMATED";          // unreadable → app estimates + highlights
    Object.assign(p.rows[0], { unit_desc: "2FT", lamp_desc: "T8", lamps_per_fixture: 2, lamp_watt: 18, fixture_qty: 3 });
    for (const r of [p.rows[1], p.rows[2]]) Object.assign(r, { unit_desc: "^", lamp_desc: "^", lamps_per_fixture: "^" });   // dittos under row 1
  }
  return pages;
}

async function launch(userData: string, env: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: ["--no-sandbox", "--disable-gpu", APP], env: { ...process.env, LSR_USER_DATA: userData, LSR_E2E: "1", ...env } as Record<string, string> });
  const page = await app.firstWindow(); await page.setViewportSize({ width: 1440, height: 900 });
  return { app, page };
}
const activate = async (page: Page, code: string) => { await page.getByTestId("code-input").fill(code); await page.getByTestId("activate").click(); };

let srv: RealServer; let upstream: Awaited<ReturnType<typeof startUpstream>>;
test.beforeAll(async () => { upstream = await startUpstream(await modelPages()); srv = new RealServer(); await srv.start(); });
test.afterAll(async () => { await srv.stop(); await upstream.close(); });
test.beforeEach(() => { upstream.calls.length = 0; });

test("activation: bad, tampered, expired and 'second PC' codes show clear messages; a good code opens the app and the licence page shows every detail", async () => {
  const good = await srv.create({ customer: "Jane Doe", company: "Acme Energy", days: 30 });
  const { app, page } = await launch(tmp());
  await expect(page.getByTestId("lock-screen")).toBeVisible();
  await expect(page.getByText("Contact: test@example.com")).toBeVisible();
  await expect(page.getByTestId("contact-support")).toBeVisible();
  await expect(page.getByTestId("machine-id")).toHaveText(/^MID1\./);
  await shot(page, "01-activation");
  await activate(page, "hello");                                         await expect(page.getByTestId("activate-error")).toContainText("not a valid activation code");
  await activate(page, good.code.slice(0, -4) + "AAAA");                 await expect(page.getByTestId("activate-error")).toContainText("damaged or has been altered");
  const expired = await srv.create({ expiresAt: new Date(Date.now() - 1000).toISOString() });
  await activate(page, expired.code);                                    await expect(page.getByTestId("activate-error")).toContainText("License expired. Please enter a valid activation code.");
  // a second computer (different hardware ids) cannot use a 1-computer code that is already active elsewhere
  await activate(page, good.code);
  await expect(page.getByTestId("licence-card")).toContainText("Jane Doe");
  await expect(page.getByTestId("licence-card")).toContainText("Acme Energy");
  await expect(page.getByTestId("licence-card")).toContainText("30 days left");
  await shot(page, "02-home");
  const second = await launch(tmp(), { LSR_TEST_MACHINE_SEED: "another-pc" });
  await activate(second.page, good.code);
  await expect(second.page.getByTestId("activate-error")).toContainText("already active on 1 computer");
  await second.app.close();
  // licence page
  await page.getByTestId("tab-settings").click();
  await expect(page.getByTestId("lic-id")).toHaveText(good.licenseId);
  await expect(page.getByTestId("lic-days")).toHaveText("30");
  await expect(page.getByTestId("lic-status")).toHaveText("Active");
  await expect(page.getByTestId("licence-panel")).toContainText("Last validation");
  await shot(page, "07-licence");
  await app.close();
});

test("Machine ID can be copied", async () => {
  const { app, page } = await launch(tmp());
  await app.evaluate(({ clipboard }) => clipboard.clear());
  await page.getByTestId("copy-machine-id").click();
  await expect(page.getByTestId("copy-machine-id")).toHaveText("Copied");
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(/^MID1\./);
  await app.close();
});

test("full flow: import PDF (Arabic file name) → auto-rotate → read → review/edit → export → save → reopen", async () => {
  const code = (await srv.create({ days: 60 })).code;
  const data = tmp(), out = tmp();
  const pdf = path.join(tmp(), "مركز الفاتحة.pdf");
  copyFileSync(path.join(REF, "samples", "Al-Fatiha_Center_-_________________.pdf"), pdf);
  const lsr = path.join(out, "مركز الفاتحة.lsr");
  let { app, page } = await launch(data, { LSR_E2E_OPEN: JSON.stringify([pdf]), LSR_E2E_OUT: out });
  await activate(page, code);
  await page.getByTestId("new-project").click();
  await page.getByTestId("add-files").click();
  await expect(page.locator('[data-testid^="page-"]')).toHaveCount(3);
  await expect(page.getByTestId("building")).toHaveValue("مركز الفاتحة");
  // portrait photo of a landscape form is turned upright automatically: thumbnails must be landscape
  await expect.poll(() => page.evaluate(() => { const i = document.querySelector<HTMLImageElement>(".thumbimg img"); return i ? i.naturalWidth > i.naturalHeight : null; })).toBe(true);
  await page.getByLabel("Rotate right").first().click();
  await expect.poll(() => page.evaluate(() => { const i = document.querySelector<HTMLImageElement>(".thumbimg img"); return i ? i.naturalWidth < i.naturalHeight : null; })).toBe(true);
  await page.getByLabel("Rotate left").first().click();
  await expect.poll(() => page.evaluate(() => { const i = document.querySelector<HTMLImageElement>(".thumbimg img"); return i ? i.naturalWidth > i.naturalHeight : null; })).toBe(true);
  await page.getByPlaceholder("e.g. Primary school").fill("Health centre, Arabic names");
  await shot(page, "03-project");

  await page.getByTestId("read-pages").click();
  await expect(page.getByTestId("page-done")).toHaveCount(3);
  // the page images went through OUR server to the (stub) model with the server-side key; 3 images per page
  expect(upstream.calls).toHaveLength(3);
  for (const c of upstream.calls) { expect(c.images).toBe(3); expect(c.key).toBe("sk-e2e"); expect(c.model).toBe("claude-opus-5-5"); }

  await page.getByTestId("go-review").click();
  await expect(page.getByTestId("grid-row")).toHaveCount(13);
  await expect(page.getByTestId("scan").locator("img")).toBeVisible();
  await expect(page.getByTestId("hdr-date")).toHaveValue("10-2-26");
  await shot(page, "04-review");
  await expect(page.locator("td.flag").first()).toBeVisible();
  await expect(page.getByTestId("flag-count")).not.toHaveText(/^0 /);
  await page.getByTestId("flag-only").check();
  const flaggedRows = await page.getByTestId("grid-row").count(); expect(flaggedRows).toBeGreaterThan(0); expect(flaggedRows).toBeLessThan(13);
  await page.getByTestId("flag-only").uncheck();
  const unit = page.getByTestId("cell-unit_desc");
  await unit.first().fill("HIGH BAY"); await unit.first().press("Enter");
  await expect(unit.first()).toHaveValue("HIGH BAY");
  const cls = await page.locator('[data-testid="grid-row"] td:has(input[data-col="unit_desc"])').evaluateAll((tds) => tds.map((t) => t.className.includes("ditto")));
  const vals = await unit.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  let followed = 0; for (let i = 1; i < vals.length && cls[i]; i++) { expect(vals[i]).toBe("HIGH BAY"); followed++; }
  expect(followed).toBeGreaterThan(0);
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("page-title")).toContainText("page 2 of 3");
  const est = page.locator('[data-testid="grid-row"]').nth(2).locator("td.flag").filter({ has: page.locator('input[data-col="lamp_watt"]') });
  await expect(est).toHaveAttribute("title", /^Estimated/);
  await expect(est.locator("input")).not.toHaveValue("0");
  await expect(page.getByTestId("totals")).toContainText("Rows 39");

  await page.getByTestId("tab-export").click();
  await page.getByTestId("export-new").click();
  await expect(page.getByTestId("export-msg")).toContainText("Saved 39 rows");
  const xlsx = path.join(out, "مركز الفاتحة - lighting survey.xlsx");
  expect(existsSync(xlsx)).toBe(true);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(xlsx);
  const ws = wb.getWorksheet("Lighting Survey Template")!;
  expect(ws.actualRowCount).toBe(41); expect(ws.getCell("Q2").value).toBe("Lamp Load (W)");
  expect(ws.getCell("E3").value).toBe("مركز الفاتحة"); expect(ws.getCell("L3").value).toBe("HIGH BAY");
  expect(wb.getWorksheet("Summary")).toBeTruthy(); expect(wb.getWorksheet("Review Flags")!.rowCount).toBeGreaterThan(1);
  await app.close();

  // save the project, then reopen it in a new session (licence persisted: no re-activation)
  ({ app, page } = await launch(data, { LSR_E2E_OPEN: JSON.stringify([pdf]), LSR_E2E_OUT: out }));
  await expect(page.getByTestId("licence-card")).toBeVisible();
  await page.getByTestId("new-project").click(); await page.getByTestId("add-files").click();
  await expect(page.locator('[data-testid^="page-"]')).toHaveCount(3);
  await page.getByLabel("Project name").fill("مركز الفاتحة");
  await page.getByTestId("read-pages").click(); await expect(page.getByTestId("page-done")).toHaveCount(3);
  await page.getByTestId("tab-export").click(); await page.getByTestId("save-project").click();
  await expect(page.getByTestId("export-msg")).toContainText("Project saved");
  expect(statSync(lsr).size).toBeGreaterThan(50_000);
  await shot(page, "05-export");
  await app.close();
  const calls = upstream.calls.length;
  ({ app, page } = await launch(data, { LSR_E2E_OPEN: JSON.stringify([lsr]), LSR_E2E_OUT: out }));
  await page.getByTestId("open-project").click();
  await page.getByTestId("tab-review").click();
  await expect(page.getByTestId("grid-row")).toHaveCount(13);
  await expect(page.getByTestId("totals")).toContainText("Rows 39");
  expect(upstream.calls.length).toBe(calls);                          // nothing was re-read
  await app.close();
});

test("append to an existing master workbook continues after the last filled row", async () => {
  const data = tmp(), out = tmp();
  const pdf = path.join(tmp(), "a.pdf"); copyFileSync(path.join(REF, "samples", "Al-Fatiha_Center_-_________________.pdf"), pdf);
  const master = path.join(out, "master.xlsx"); copyFileSync(path.join(REF, "MOH-JZ - Lightings - Raeds team.xlsx"), master);
  const { app, page } = await launch(data, { LSR_E2E_OPEN: JSON.stringify([pdf, master]), LSR_E2E_OUT: out });
  await activate(page, (await srv.create()).code);
  await page.getByTestId("new-project").click(); await page.getByTestId("add-files").click();
  await expect(page.locator('[data-testid^="page-"]')).toHaveCount(3);
  await page.getByTestId("read-pages").click(); await expect(page.getByTestId("page-done")).toHaveCount(3);
  await page.getByTestId("tab-export").click();
  await page.getByTestId("export-append").click();
  await expect(page.getByTestId("export-msg")).toContainText("Added 39 rows after row 554");
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(out, "master (updated).xlsx"));
  const ws = wb.getWorksheet("Lighting Survey Template")!;
  expect(ws.getCell("E554").value).toBe("AL EADABI VACCINATION CENTER");
  expect(ws.getCell("A555").value).toBe(553); expect(ws.getCell("E555").value).toBe("A"); expect(ws.getCell("E593").value).toBe("A"); expect(ws.getCell("E594").value).toBeNull();
  const orig = new ExcelJS.Workbook(); await orig.xlsx.readFile(master);
  expect(orig.getWorksheet("Lighting Survey Template")!.getCell("E555").value).toBeNull();
  await app.close();
});

test("revoking a licence locks the running app on the very next page read, and it stays locked after a restart even offline", async () => {
  const lic = await srv.create();
  const data = tmp();
  const pdf = path.join(tmp(), "b.pdf"); copyFileSync(path.join(REF, "samples", "Darb_Vccination_Centre_-_________________________________.pdf"), pdf);
  let { app, page } = await launch(data, { LSR_E2E_OPEN: JSON.stringify([pdf]) });
  await activate(page, lic.code);
  await page.getByTestId("new-project").click(); await page.getByTestId("add-files").click();
  await expect(page.locator('[data-testid^="page-"]')).toHaveCount(3);
  await srv.admin(`/licenses/${lic.licenseId}/revoke`, { reason: "chargeback" });
  await page.getByTestId("read-pages").click();
  await expect(page.getByTestId("lock-screen")).toBeVisible();
  await expect(page.getByTestId("lock-reason")).toContainText("chargeback");
  await shot(page, "06-locked");
  await expect(page.getByTestId("code-input")).toBeVisible();          // field for a new code
  await app.close();
  await srv.stop();                                                    // offline restart: still locked
  ({ app, page } = await launch(data));
  await expect(page.getByTestId("lock-screen")).toBeVisible();
  await expect(page.getByTestId("lock-reason")).toContainText("chargeback");
  await app.close();
  await srv.start();
});

test("licence check while the app is open: suspend locks without reading a page; reinstate + check restores; deactivate (confirmed) frees the activation", async () => {
  const lic = await srv.create();
  const { app, page } = await launch(tmp());
  await activate(page, lic.code);
  await page.getByTestId("tab-settings").click();
  await srv.admin(`/licenses/${lic.licenseId}/suspend`, { reason: "payment overdue" });
  await page.getByTestId("check-licence").click();
  await expect(page.getByTestId("lock-screen")).toBeVisible();
  await expect(page.getByTestId("lock-reason")).toContainText("payment overdue");
  await srv.admin(`/licenses/${lic.licenseId}/reinstate`, {});
  await activate(page, lic.code);                                      // entering the same code again re-activates this computer
  await expect(page.getByTestId("licence-card")).toBeVisible();
  await page.getByTestId("tab-settings").click(); page.once("dialog", (d) => { expect(d.message()).toContain("Deactivate this PC"); void d.accept(); });
  await page.getByTestId("deactivate").click();
  await expect(page.getByTestId("lock-screen")).toBeVisible();
  const d = await srv.admin(`/licenses/${lic.licenseId}`);
  expect(d.json.activations.every((a: any) => a.active === 0)).toBe(true);
  await app.close();
});

test("validation overdue shows the warning banner (short grace period set by the server)", async () => {
  const lic = await srv.create();
  const { app, page } = await launch(tmp());
  await activate(page, lic.code);
  await srv.admin(`/licenses/${lic.licenseId}/set-grace`, { hours: 6 });
  await page.getByTestId("tab-settings").click(); await page.getByTestId("check-licence").click();
  await expect(page.getByTestId("warning-banner")).toContainText("validation is overdue");
  await expect(page.getByTestId("lic-status")).toHaveText("Active (validation overdue)");
  await app.close();
});

test("offline licence: activates with NO server contact, then reads pages after registering with the server", async () => {
  const data = tmp();
  const pdf = path.join(tmp(), "c.pdf"); copyFileSync(path.join(REF, "samples", "Al-Fatiha_Center_-_________________.pdf"), pdf);
  let { app, page } = await launch(data, { LSR_E2E_OPEN: JSON.stringify([pdf]) });
  const mid = (await page.getByTestId("machine-id").innerText()).trim();
  const lic = await srv.create({ offline: true, machineId: mid, days: 90 });                   // owner signs a code for this exact computer
  await srv.stop();                                                                              // the server is gone: activation must work without it
  await activate(page, lic.code);
  await expect(page.getByTestId("licence-card")).toBeVisible();
  await page.getByTestId("tab-settings").click();
  await expect(page.getByTestId("licence-panel")).toContainText("Offline licence");
  await page.getByTestId("tab-home").click();
  await srv.start();
  expect((await srv.admin(`/licenses/${lic.licenseId}`)).json.activations).toHaveLength(0);   // the server never heard from this PC yet
  await page.getByTestId("new-project").click(); await page.getByTestId("add-files").click();
  await expect(page.locator('[data-testid^="page-"]')).toHaveCount(3);
  await page.getByTestId("read-pages").click(); await expect(page.getByTestId("page-done")).toHaveCount(3);
  expect((await srv.admin(`/licenses/${lic.licenseId}`)).json.activations).toHaveLength(1);    // registered on first read
  // a code made for another computer is refused locally
  await app.close();
  const other = await launch(tmp(), { LSR_TEST_MACHINE_SEED: "other-pc" });
  await activate(other.page, lic.code);
  await expect(other.page.getByTestId("activate-error")).toContainText("different computer");
  await other.app.close();
  void page; void app; ({ app, page } = { app, page });
});

test("errors from file dialogs and disk are shown to the user, not swallowed", async () => {
  const lic = await srv.create();
  const { app, page } = await launch(tmp(), { LSR_E2E_OPEN: JSON.stringify([path.join(tmp(), "does-not-exist.pdf")]) });
  await activate(page, lic.code);
  await page.getByTestId("new-project").click(); await page.getByTestId("add-files").click();
  await expect(page.getByTestId("project-note")).toContainText("Couldn’t open the selected files");
  await app.close();
});

test("Reading provider: connect a Groq API key in the License Manager, test it, and read pages through Groq in the real app", async () => {
  const groq = await startGroqUpstream(await modelPages());
  try {
    // 1. the owner uses the License Manager page in a browser
    // (Electron's own Chromium is used as the "browser": no separate browser download is needed)
    const owner = await launch(tmp());
    const winP = owner.app.waitForEvent("window");
    // a separate session partition: the app's own CSP hook must not apply to the owner's "browser"
    await owner.app.evaluate(({ BrowserWindow }, url) => { const w = new BrowserWindow({ width: 1100, height: 900, webPreferences: { partition: "owner-browser" } }); void w.loadURL(url); }, URL_ + "/manager");
    const mp = await winP; await mp.waitForLoadState("domcontentloaded");
    await mp.getByLabel("Admin token").fill(ADMIN_TOKEN); await mp.getByRole("button", { name: "Sign in" }).click();
    await expect(mp.getByText("Reading provider")).toBeVisible();
    await expect(mp.locator("input[name=prov][value=anthropic]")).toBeChecked();          // default
    await mp.locator("input[name=prov][value=groq]").check();
    await mp.locator("#key-groq").fill("gsk_E2E_KEY_1234567890");
    await mp.locator("#mb-groq").fill("e2e-vision-a"); await mp.locator("#mf-groq").fill("e2e-vision-b");
    await mp.getByRole("button", { name: "Save", exact: true }).click();
    await expect(mp.getByText("Saved.")).toBeVisible();
    await expect(mp.getByText("saved here")).toBeVisible();                                // key hint shown, the key itself never
    expect(await mp.content()).not.toContain("gsk_E2E_KEY_1234567890");
    await mp.getByRole("button", { name: "Test connection" }).nth(1).click();
    await expect(mp.getByText(/✓ Key accepted/)).toBeVisible();
    await expect(mp.locator("#models-groq option")).toHaveCount(2);
    if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await mp.screenshot({ path: path.join(SHOTS, "08-manager-provider.png") }); }
    expect(groq.calls.find((c) => c.method === "GET")).toMatchObject({ url: "/models", auth: "Bearer gsk_E2E_KEY_1234567890" });
    await owner.app.close();

    // 2. the customer's app now reads through Groq (the app itself is unchanged)
    const lic = await srv.create();
    const pdf = path.join(tmp(), "g.pdf"); copyFileSync(path.join(REF, "samples", "Al-Fatiha_Center_-_________________.pdf"), pdf);
    const { app, page } = await launch(tmp(), { LSR_E2E_OPEN: JSON.stringify([pdf]) });
    await activate(page, lic.code);
    await page.getByTestId("new-project").click(); await page.getByTestId("add-files").click();
    await expect(page.locator('[data-testid^="page-"]')).toHaveCount(3);
    await page.getByTestId("read-pages").click(); await expect(page.getByTestId("page-done")).toHaveCount(3);
    const reads = groq.calls.filter((c) => c.method === "POST");
    expect(reads).toHaveLength(3);
    for (const c of reads) { expect(c.url).toBe("/chat/completions"); expect(c.auth).toBe("Bearer gsk_E2E_KEY_1234567890"); expect(c.model).toBe("e2e-vision-a"); expect(c.images).toBe(3); }
    expect(upstream.calls).toHaveLength(0);                                                // Anthropic was not used
    await app.close();
  } finally {
    await srv.admin("/provider", { provider: "anthropic", groq: { clearKey: true } });     // leave the shared test server as we found it
    await groq.close();
  }
});
