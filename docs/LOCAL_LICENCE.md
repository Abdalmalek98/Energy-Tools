# Your own local licence + the accuracy run (Phase 5)

No Cloudflare account and no deployment needed. This runs **the real service** (same code as production) on your PC with a local
database and **your** Anthropic key, and creates an activation code for you. Requires Node 20+.

## 1. Start your local service and get your code
```bash
git clone https://github.com/Abdalmalek98/Energy-Tools && cd Energy-Tools && npm install
ANTHROPIC_API_KEY=sk-ant-...your-key... npm run local          # Windows PowerShell:  $env:ANTHROPIC_API_KEY="sk-ant-..."; npm run local
```
It prints your **activation code**, the admin page address/password and the admin-CLI command. Keep that window open (Ctrl+C stops it).
Your code (valid ~10 years, up to 5 PCs, no page limit) is remembered in `.local-licence.json`; the database is kept in `service/.wrangler`.
Both, and `service/.dev.vars` (your key), are git-ignored. Delete them to start over.

> No key yet? `npm run local:stub` starts everything with a fake Anthropic (no cost, nothing is really read) to test the plumbing.

## 2. Use the app with it
```bash
npm run app:local        # builds the app against your local service and opens it; paste your code on the first screen
```
Open `http://127.0.0.1:8788/admin` to lock/unlock/extend your own code and watch the app react.

## 3. Accuracy run (5 sample PDFs vs the typed answers in the template)
In a second terminal (service still running):
```bash
npm run accuracy                                   # all five samples, "Best accuracy" (claude-opus-5-5)
LSR_QUALITY=fast npm run accuracy                  # compare with "Faster" (claude-sonnet-5-5)
LSR_SAMPLES=fatiha,darb npm run accuracy           # only some: fatiha, darb, malha, haqou, jahu
```
It drives the real app (import → read → export) for each PDF, compares the exported rows with the answer rows in
`reference/MOH-JZ - Lightings - Raeds team.xlsx`, and writes **`docs/ACCURACY_REPORT.md`** (per-sample and per-column accuracy, weak columns
under 90 %, the mismatching cells). On Linux without a display it uses `xvfb-run`. Cost: 21 pages per run, 3 images each.

Send me the report (or commit it) and I'll tune the prompt for whichever columns are weak.

**Reading the numbers.** The typed answers contain typos and blank cells that the tool deliberately fills (light blue / yellow), so 100 % is not expected.
Typos are normalised before comparing and day/month-swapped dates count as equal; the mismatch list shows what is left, and many will be errors in the typed answers rather than in the reading.
