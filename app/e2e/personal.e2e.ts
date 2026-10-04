// PERSONAL build (no licence, own Groq key). Builds the personal bundle itself, so it must run AFTER app.e2e.ts (alphabetical order does that; `npm run e2e` rebuilds first).
import { _electron as electron, expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startGroqUpstream } from "./realServer";

const APP = path.resolve(__dirname, "..");
const REF = path.resolve(APP, "../reference");

const page1 = {
  header: { building_name: "TEST CENTER", section: null, floor: "GF", collected_by: "X", date: "10-2-26", page_label: "1/1", upright: true },
  section_changes: [], copy_notes: [],
  rows: [{ row: 1, floor: "GF", room_name: "OFFICE", unit_desc: "2FT", lamp_desc: "T8", lamps_per_fixture: 2, lamp_watt: 18, fixture_qty: 3, uncertain: [], note: null }],
};

test("personal build: no activation screen, the Groq key is saved encrypted and never shown, pages are read directly through Groq", async () => {
  execSync("npx electron-vite build", { cwd: APP, stdio: "inherit", env: { ...process.env, LSR_E2E: "1", LSR_PERSONAL: "1" } });
  const groq = await startGroqUpstream([page1, page1, page1]);
  const data = mkdtempSync(path.join(tmpdir(), "lsr-pers-"));
  const pdf = path.join(data, "g.pdf"); copyFileSync(path.join(REF, "samples", "Al-Fatiha_Center_-_________________.pdf"), pdf);
  const app = await electron.launch({ args: ["--no-sandbox", "--disable-gpu", APP], env: { ...process.env, LSR_USER_DATA: data, LSR_E2E: "1", LSR_GROQ_BASE: "http://127.0.0.1:8791", LSR_E2E_OPEN: JSON.stringify([pdf]) } as Record<string, string> });
  try {
    const page = await app.firstWindow(); await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId("personal-banner")).toBeVisible();          // straight into the app, no activation
    await expect(page.getByTestId("lock-screen")).toHaveCount(0);
    // reading without a key explains what to do
    await page.getByTestId("new-project").click(); await page.getByTestId("add-files").click();
    await expect(page.locator('[data-testid^="page-"]')).toHaveCount(3);
    await page.getByTestId("read-pages").click();
    await expect(page.getByText(/No Groq API key yet/).first()).toBeVisible();
    // connect the key in Settings
    await page.getByTestId("tab-settings").click();
    await page.locator("#pg-key").fill("gsk_PERSONAL_KEY_1234567890"); await page.locator("#pg-model").fill("e2e-vision-a");
    await page.getByTestId("personal-save").click();
    await expect(page.getByTestId("personal-state")).toContainText("…7890");
    await expect(page.locator("#pg-key")).toHaveValue("");                    // the key box is write-only
    await page.getByTestId("personal-test").click();
    await expect(page.getByTestId("personal-msg")).toHaveText("Key accepted.");
    expect(groq.calls.find((c) => c.method === "GET")).toMatchObject({ url: "/models", auth: "Bearer gsk_PERSONAL_KEY_1234567890" });
    // not stored in clear text
    for (const f of readdirSync(data)) if (statSafe(path.join(data, f))) expect(readFileSync(path.join(data, f)).toString("latin1")).not.toContain("gsk_PERSONAL_KEY");
    // read the pages
    await page.getByTestId("tab-project").click();
    await page.getByTestId("read-pages").click(); await expect(page.getByTestId("page-done")).toHaveCount(3);
    const reads = groq.calls.filter((c) => c.method === "POST");
    expect(reads).toHaveLength(3);
    for (const c of reads) { expect(c.auth).toBe("Bearer gsk_PERSONAL_KEY_1234567890"); expect(c.model).toBe("e2e-vision-a"); expect(c.images).toBe(3); }
  } finally { await app.close(); await groq.close(); }
});
const statSafe = (p: string) => { try { return existsSync(p) && readFileSync(p).length > 0; } catch { return false; } };
