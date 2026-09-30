// Accuracy run: reads the sample PDFs through the REAL app + your local service, exports, and compares with the typed answers.
//   npm run accuracy            (best accuracy)     LSR_QUALITY=fast npm run accuracy     LSR_SAMPLES=fatiha,darb npm run accuracy
import { _electron as electron, expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { compareSheets, reportMarkdown, sheetRow, type SampleResult, type SheetRow } from "@lsr/shared";

const ROOT = path.resolve(__dirname, "../..");
const REF = path.join(ROOT, "reference");
const cfg = JSON.parse(readFileSync(path.join(ROOT, ".local-licence.json"), "utf8")) as { code: string };
const SAMPLES = [
  { id: "fatiha", pages: 3, name: "Al-Fatiha Center", pdf: "Al-Fatiha_Center_-_________________.pdf", rows: [3, 41] },
  { id: "darb", pages: 3, name: "Darb Vaccination Centre", pdf: "Darb_Vccination_Centre_-_________________________________.pdf", rows: [167, 203] },
  { id: "malha", pages: 5, name: "Almalha Health Centre", pdf: "Almalha_Heath_Centre_-__________________.pdf", rows: [204, 257] },
  { id: "haqou", pages: 5, name: "Al-Haqou Center", pdf: "_Al-Haqou_Center_-_______________.pdf", rows: [381, 438] },
  { id: "jahu", pages: 5, name: "Al-Jahu Primary Health Care", pdf: "Al-Jahu_primary_health_care_-_______________.pdf", rows: [439, 500] },
].filter((s) => !process.env.LSR_SAMPLES || process.env.LSR_SAMPLES.split(",").includes(s.id));
const quality = (process.env.LSR_QUALITY ?? "best") as "best" | "fast";

async function rows(file: string, r0: number, r1: number): Promise<SheetRow[]> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet("Lighting Survey Template")!;
  const out: SheetRow[] = [];
  for (let r = r0; r <= r1; r++) out.push(sheetRow((c) => ws.getCell(c + r).value));
  return out;
}

test("accuracy run", async () => {
  const results: SampleResult[] = [];
  for (const s of SAMPLES) {
    const out = mkdtempSync(path.join(tmpdir(), "lsr-acc-")), data = mkdtempSync(path.join(tmpdir(), "lsr-acc-data-"));
    const app = await electron.launch({ args: ["--no-sandbox", "--disable-gpu", path.join(ROOT, "app")], env: { ...process.env, LSR_E2E: "1", LSR_USER_DATA: data, LSR_E2E_OUT: out, LSR_E2E_OPEN: JSON.stringify([path.join(REF, "samples", s.pdf)]) } as Record<string, string> });
    const page = await app.firstWindow(); await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId("code-input").fill(cfg.code); await page.getByTestId("activate").click();
    await page.getByTestId("new-project").click(); await page.getByTestId("add-files").click();
    await expect(page.locator('[data-testid^="page-"]')).toHaveCount(s.pages, { timeout: 120_000 });   // wait until the whole PDF is open
    await page.getByTestId("building").fill(s.name.toUpperCase());
    await page.getByTestId("quality").selectOption(quality);
    await page.getByTestId("read-pages").click();
    await expect(page.locator('[data-testid="page-done"],[data-testid="page-error"]')).toHaveCount(await page.locator('[data-testid^="page-"]').count(), { timeout: 20 * 60_000 });
    const failed = await page.getByTestId("page-error").count();
    if (failed) console.warn(`${s.name}: ${failed} page(s) failed to read`);
    await page.getByTestId("tab-export").click(); await page.getByTestId("export-new").click();
    await expect(page.getByTestId("export-msg")).toContainText("Saved");
    await app.close();
    const got = await rows(path.join(out, `${s.name.toUpperCase()} - lighting survey.xlsx`), 3, 900);
    const gotRows = got.filter((g) => g.room !== "");
    const want = await rows(path.join(REF, "MOH-JZ - Lightings - Raeds team.xlsx"), s.rows[0], s.rows[1]);
    results.push(compareSheets(s.name, gotRows, want));
    console.log(`${s.name}: ${gotRows.length} rows read, ${want.length} expected${failed ? `, ${failed} pages failed` : ""}`);
  }
  const md = reportMarkdown(results, { date: new Date().toISOString().slice(0, 10), quality });
  mkdirSync(path.join(ROOT, "docs"), { recursive: true });
  writeFileSync(path.join(ROOT, "docs/ACCURACY_REPORT.md"), md);
  writeFileSync(path.join(ROOT, "docs/accuracy-results.json"), JSON.stringify(results, null, 1));
  console.log("\nReport written to docs/ACCURACY_REPORT.md");
});
