# Architecture

## Technology choice
Tauri 2 (Rust core + system WebView2 on Windows) — small installer, low memory, capability-based permissions, native
DPAPI/registry access from Rust. Electron was not needed. The React UI is bundled with the app (fonts and the sql.js
WASM included), so the app is fully offline after activation.

## Layers (`src/`)
| Folder | Responsibility |
|---|---|
| `utils/` | CSV/TSV parsing (delimiter, quotes, BOM, UTF-16), timestamp parsing (ISO, DMY/MDY detection, Excel serial, epoch, .NET ticks), statistics |
| `calculations/` | Unit conversion, cooling load, kW/TR-COP-EER, KPIs, rating bands |
| `analysis/` | BMS parsing + auto-mapping, row filtering, plant aggregation, logger merge, chiller summary/bins, findings, pipeline |
| `regression/` | Student-t, OLS on standardised predictors with back-transform, models, selection, Guideline 14, IPLV |
| `fluke/` | Fluke text/CSV/ZIP/SQLite parsing, closed-binary detection, logger-only analysis |
| `charts/` | Chart data preparation shared by the UI and Excel |
| `excel/` | Workbook sheets (xlsx-js-style), native chart XML injected with JSZip |
| `storage/` | `.cpa` project/backup container (ZIP + SHA-256 manifest), file dialogs, recent list |
| `licensing/` | Bridge to the Rust licensing commands |
| `pages/`, `components/`, `app/` | UI |

`analysis/pipeline.ts` derives every displayed number as a pure function of *(raw table, mapping, settings, loggers)*, so
results never depend on upload order.

## Key engineering decisions
* **Period efficiency** is always `Σ kWh / Σ TR·h`; plant kW/TR = `(chiller kWh + aux kWh) / TR·h`. Interval ratios are never averaged (test-enforced).
* **Filtering** counts each exclusion reason separately; `excluded` is the number of distinct rows.
* **Regression** fits standardised predictors and back-transforms coefficients and covariance (`A·Σ·Aᵀ`), CV(RMSE)/NMBE use `n−p` (Guideline 14); t critical values come from an incomplete-beta implementation.
* **IPLV** is computed as `1/Σ(wᵢ/COPᵢ)` where COPᵢ = 3.51685/(kW/TR)ᵢ, reported also as kW/TR. A point is flagged `*` when it lies outside the chiller's measured ECWT range ±0.5 °C or PLR range ±0.05.
* **Logger timestamps**: Energy-Analyze trend rows are treated as period *starts* (midpoint = start + interval/2) — assumption, configurable in code (`timestampRefersTo`).
* **Logger starts**: a run already active at the first sample is not counted as a start; runs touching the log boundaries are not counted as "short runs".
* **Findings' savings** use documented indicative assumptions (`analysis/findings.ts › ASSUMPTIONS`); they are estimates.
* **Load** for °F inputs is computed after converting both temperatures to °C, which equals ΔT(°F)×5/9.

## Licensing components
See LICENSING.md. Database schema: `license-server/schema.sql` (licenses, activations, counters, audit).

## Known limitations
* Analysis runs on the UI thread (a few hundred thousand rows are fine; millions would want a Web Worker).
* FCA2 SQLite reading is schema-agnostic (best-effort table/column detection); the proprietary layout of real `.fca2` files could not be checked here. Closed binary `.fca` files are refused with export instructions, by design.
* No trial mode is implemented (the spec made it optional).
