import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startMock, type Mock } from "./mockService";

const APP = path.resolve(__dirname, "..");
const REF = path.resolve(APP, "../reference");
const GOOD = "AAAAA-AAAAA-AAAAA-AAAAA";
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

let mock: Mock;
test.beforeAll(async () => { mock = await startMock(await modelPages()); });
test.afterAll(async () => { await mock.close(); });
test.beforeEach(() => { mock.state.locked.clear(); mock.state.readCalls.length = 0; mock.state.failNext = null; });

test("activation: wrong, locked, expired and 'third PC' codes show clear messages; a good code opens the app", async () => {
  const { app, page } = await launch(tmp());
  await expect(page.getByTestId("lock-screen")).toBeVisible();
  await expect(page.getByText("Contact: test@example.com")).toBeVisible();
  await shot(page, "01-activation");
  await activate(page, "ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ");  await expect(page.getByTestId("activate-error")).toContainText("not valid");
  await activate(page, "DDDDD-DDDDD-DDDDD-DDDDD");   await expect(page.getByTestId("activate-error")).toContainText("already active on 1 PC");
  await activate(page, "CCCCC-CCCCC-CCCCC-CCCCC");   await expect(page.getByTestId("activate-error")).toContainText("expired");
  await activate(page, "BBBBB-BBBBB-BBBBB-BBBBB");   await expect(page.getByTestId("activate-error")).toContainText("locked");
  await page.getByTestId("code-input").fill("aaaaa aaaaa aaaaa aaaaa");                               // typing is auto-formatted
  await expect(page.getByTestId("code-input")).toHaveValue(GOOD);
  await page.getByTestId("activate").click();
  await expect(page.getByTestId("licence-card")).toContainText("Acme Test");
  await expect(page.getByTestId("licence-card")).toContainText("30 days left");
  await expect(page.getByTestId("licence-card")).toContainText("pages left this month");
  await shot(page, "02-home");
  await app.close();
});

test("full flow: import PDF (Arabic file name) → auto-rotate → read → review/edit → export → save → reopen", async () => {
  const data = tmp(), out = tmp();
  const pdf = path.join(tmp(), "مركز الفاتحة.pdf");
  copyFileSync(path.join(REF, "samples", "Al-Fatiha_Center_-_________________.pdf"), pdf);
  const lsr = path.join(out, "مركز الفاتحة.lsr");
  let { app, page } = await launch(data, { LSR_E2E_OPEN: JSON.stringify([pdf]), LSR_E2E_OUT: out });
  await activate(page, GOOD);
  await page.getByTestId("new-project").click();
  await page.getByTestId("add-files").click();
  await expect(page.locator('[data-testid^="page-"]')).toHaveCount(3);
  await expect(page.getByTestId("building")).toHaveValue("مركز الفاتحة");
  // portrait photo of a landscape form is turned upright automatically: thumbnails must be landscape
  await expect.poll(() => page.evaluate(() => { const i = document.querySelector<HTMLImageElement>(".thumbimg img"); return i ? i.naturalWidth > i.naturalHeight : null; })).toBe(true);
  // manual rotate flips it
  await page.getByLabel("Rotate right").first().click();
  await expect.poll(() => page.evaluate(() => { const i = document.querySelector<HTMLImageElement>(".thumbimg img"); return i ? i.naturalWidth < i.naturalHeight : null; })).toBe(true);
  await page.getByLabel("Rotate left").first().click();
  await expect.poll(() => page.evaluate(() => { const i = document.querySelector<HTMLImageElement>(".thumbimg img"); return i ? i.naturalWidth > i.naturalHeight : null; })).toBe(true);
  await page.getByPlaceholder("e.g. Primary school").fill("Health centre, Arabic names");
  await shot(page, "03-project");

  await page.getByTestId("read-pages").click();
  await expect(page.getByTestId("page-done")).toHaveCount(3);
  // each page = whole page + top 56 % + bottom 56 %, real JPEGs under 4 MB, quality forwarded, hint forwarded
  expect(mock.state.readCalls).toHaveLength(3);
  for (const c of mock.state.readCalls) { expect(c.images).toBe(3); expect(c.magic.every(Boolean)).toBe(true); expect(Math.max(...c.sizes)).toBeLessThan(4 * 1024 * 1024); expect(c.quality).toBe("best"); expect(c.hint).toBe("Health centre, Arabic names"); }

  await page.getByTestId("go-review").click();
  await expect(page.getByTestId("grid-row")).toHaveCount(13);
  await expect(page.getByTestId("scan").locator("img")).toBeVisible();
  await expect(page.getByTestId("hdr-date")).toHaveValue("10-2-26");
  await shot(page, "04-review");
  // flagged cells are highlighted: model-uncertain (page 1) …
  await expect(page.locator("td.flag").first()).toBeVisible();
  await expect(page.getByTestId("flag-count")).not.toHaveText(/^0 /);
  // filter to rows with flags
  await page.getByTestId("flag-only").check();
  const flaggedRows = await page.getByTestId("grid-row").count(); expect(flaggedRows).toBeGreaterThan(0); expect(flaggedRows).toBeLessThan(13);
  await page.getByTestId("flag-only").uncheck();
  // change a value and every ditto below follows
  const unit = page.getByTestId("cell-unit_desc");
  await unit.first().fill("HIGH BAY"); await unit.first().press("Enter");
  await expect(unit.first()).toHaveValue("HIGH BAY");
  const cls = await page.locator('[data-testid="grid-row"] td:has(input[data-col="unit_desc"])').evaluateAll((tds) => tds.map((t) => t.className.includes("ditto")));
  const vals = await unit.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  let followed = 0; for (let i = 1; i < vals.length && cls[i]; i++) { expect(vals[i]).toBe("HIGH BAY"); followed++; }
  expect(followed).toBeGreaterThan(0);
  // keyboard: Alt+→ moves to the next page
  await page.keyboard.press("Alt+ArrowRight");
  await expect(page.getByTestId("page-title")).toContainText("page 2 of 3");
  // unreadable watts (0 + uncertain) were estimated from the same fixture type and highlighted
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

  // save the project, then reopen it in a new session
  ({ app, page } = await launch(data, { LSR_E2E_OPEN: JSON.stringify([pdf]), LSR_E2E_OUT: out }));
  await expect(page.getByTestId("licence-card")).toBeVisible();      // licence persisted (encrypted store): no re-activation
  await page.getByTestId("new-project").click(); await page.getByTestId("add-files").click();
  await expect(page.locator('[data-testid^="page-"]')).toHaveCount(3);
  await page.getByLabel("Project name").fill("مركز الفاتحة");
  await page.getByTestId("read-pages").click(); await expect(page.getByTestId("page-done")).toHaveCount(3);
  await page.getByTestId("tab-export").click(); await page.getByTestId("save-project").click();
  await expect(page.getByTestId("export-msg")).toContainText("Project saved");
  expect(statSync(lsr).size).toBeGreaterThan(50_000);
  await shot(page, "05-export");
  await app.close();
  const calls = mock.state.readCalls.length;
  ({ app, page } = await launch(data, { LSR_E2E_OPEN: JSON.stringify([lsr]), LSR_E2E_OUT: out }));
  await page.getByTestId("open-project").click();
  await page.getByTestId("tab-review").click();
  await expect(page.getByTestId("grid-row")).toHaveCount(13);
  await expect(page.getByTestId("totals")).toContainText("Rows 39");
  expect(mock.state.readCalls.length).toBe(calls);                    // nothing was re-read
  await app.close();
});

test("append to an existing master workbook continues after the last filled row", async () => {
  const data = tmp(), out = tmp();
  const pdf = path.join(tmp(), "a.pdf"); copyFileSync(path.join(REF, "samples", "Al-Fatiha_Center_-_________________.pdf"), pdf);
  const master = path.join(out, "master.xlsx"); copyFileSync(path.join(REF, "MOH-JZ - Lightings - Raeds team.xlsx"), master);
  const { app, page } = await launch(data, { LSR_E2E_OPEN: JSON.stringify([pdf, master]), LSR_E2E_OUT: out });
  await activate(page, GOOD);
  await page.getByTestId("new-project").click(); await page.getByTestId("add-files").click();
  await expect(page.locator('[data-testid^="page-"]')).toHaveCount(3);
  await page.getByTestId("read-pages").click(); await expect(page.getByTestId("page-done")).toHaveCount(3);
  await page.getByTestId("tab-export").click();
  await page.getByTestId("export-append").click();                    // 2nd scripted dialog = the master workbook
  await expect(page.getByTestId("export-msg")).toContainText("Added 39 rows after row 554");
  const updated = path.join(out, "master (updated).xlsx");
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(updated);
  const ws = wb.getWorksheet("Lighting Survey Template")!;
  expect(ws.getCell("E554").value).toBe("AL EADABI VACCINATION CENTER");          // old rows untouched
  expect(ws.getCell("A555").value).toBe(553); expect(ws.getCell("L555").value).toBeTruthy();   // continues numbering
  expect(ws.getCell("E555").value).toBe("A"); expect(ws.getCell("E593").value).toBe("A"); expect(ws.getCell("E594").value).toBeNull();   // 39 rows, no more
  expect(wb.getWorksheet("Summary")).toBeTruthy();
  const orig = new ExcelJS.Workbook(); await orig.xlsx.readFile(master);           // the original file is not modified
  expect(orig.getWorksheet("Lighting Survey Template")!.getCell("E555").value).toBeNull();
  await app.close();
});

test("locking a code takes effect immediately on the next page read, and on licence check; stays locked after restart", async () => {
  const data = tmp();
  const pdf = path.join(tmp(), "b.pdf"); copyFileSync(path.join(REF, "samples", "Darb_Vccination_Centre_-_________________________________.pdf"), pdf);
  let { app, page } = await launch(data, { LSR_E2E_OPEN: JSON.stringify([pdf]) });
  await activate(page, GOOD);
  await page.getByTestId("new-project").click(); await page.getByTestId("add-files").click();
  await expect(page.locator('[data-testid^="page-"]')).toHaveCount(3);
  mock.state.locked.add("AAAAAAAAAAAAAAAAAAAA");                      // admin locks the code in the admin page
  await page.getByTestId("read-pages").click();                       // → the very next read is refused and the app locks
  await expect(page.getByTestId("lock-screen")).toBeVisible();
  await expect(page.getByTestId("lock-reason")).toContainText("locked");
  await shot(page, "06-locked");
  await expect(page.getByTestId("code-input")).toBeVisible();          // field for a new code
  await app.close();
  // offline restart: still locked (service isn't even asked to agree)
  const closed = mock; await closed.close();
  ({ app, page } = await launch(data));
  await expect(page.getByTestId("lock-screen")).toBeVisible();
  await app.close();
  mock = await startMock(await modelPages());
});

test("licence check while the app is open: lock is applied without reading a page; unlock + re-activate restores", async () => {
  const { app, page } = await launch(tmp());
  await activate(page, GOOD);
  await page.getByTestId("tab-settings").click();
  mock.state.locked.add("AAAAAAAAAAAAAAAAAAAA");
  await page.getByTestId("check-licence").click();
  await expect(page.getByTestId("lock-screen")).toBeVisible();
  mock.state.locked.clear();
  await activate(page, GOOD);
  await expect(page.getByTestId("licence-card")).toBeVisible();
  // deactivate frees the slot and returns to the activation screen
  await page.getByTestId("tab-settings").click(); page.once("dialog", (d) => void d.accept());
  await page.getByTestId("deactivate").click();
  await expect(page.getByTestId("lock-screen")).toBeVisible();
  await app.close();
});
