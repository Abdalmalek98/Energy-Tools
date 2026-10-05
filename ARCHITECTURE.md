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

## Weather (cooling degree days)
`analysis/cdd.ts` reads the customer's daily weather file (CDD column, or daily mean / Tmax+Tmin temperature with a base temperature; °F converted). `analysis/cddAnalysis.ts` rolls the plant results up per day, joins CDD by date and fits `daily kWh = b0 + b1·CDD` and `daily TR·h = c0 + c1·CDD` (`regression/cdd.ts`, daily Guideline 14 limits: CV ≤ 15 %, |NMBE| ≤ 5 %). Outputs: weather-normalised energy and kW/TR at a reference CDD (mean of the analysed days, or typical annual CDD ÷ 365), weather-driven vs base-load share, actual vs expected energy, and a "Weather (CDD) baseline" finding. Notes:
* A day enters the regression when ≥ 90 % of it is logged (setting). Logged time is counted from all timestamps, so hours with the plant off still count as covered; energy is that of the rows that passed the filters.
* The baseline is fitted over the whole analysed period, so a late change in consumption is partly absorbed by the fit (drift is understated).
* Temperature files keep the daily mean temperature, so changing the base temperature recomputes CDD.

## Hourly weather (temperature, optional humidity / enthalpy)
`analysis/weather.ts` reads an hourly weather file: temperature is required; relative humidity and enthalpy are optional. °F, Btu/lb and 0–1 humidity fractions are converted; sub-hourly rows are averaged per hour; with humidity but no enthalpy column the enthalpy is computed (`h = 1.006·T + W·(2501 + 1.86·T)`, Magnus saturation pressure, pressure from Plant Settings). `analysis/weatherAnalysis.ts` joins the hours with the plant results and fits hourly plant kW and TR against **temperature**, **enthalpy** and **temperature + humidity** (`regression/weather.ts`, hourly Guideline 14 limits: CV ≤ 30 %, |NMBE| ≤ 10 %). Selection mirrors the plant regression: start with temperature, move on only if CV(RMSE) < 95 % of the best AND adjusted R² is higher. Also: correlations, weather-normalised kW/TR at the mean weather, and 2 °C / 5 kJ/kg bin tables (hours, kW, TR, Σ kW/Σ TR). One hourly file also yields daily CDD (days with ≥ 18 hourly values) so the daily CDD analysis runs without a separate CDD file; an explicit CDD file takes precedence.
* Only hours in which the plant ran (≥ 30 min of rows) are used by default; "include off hours" adds logged off hours as zero-energy hours.
* Weather stamps are read as hour-starting unless Plant Settings says hour-ending. A time-zone or convention mismatch shows up as a weak or negative temperature slope (the tool says so).

## Annual projection (typical-year weather)
`analysis/annualize.ts` projects annual consumption from a typical-year hourly weather file (`Plant Settings → Annual projection`, `Data Import → typical year`). The weather driver is the **wet-bulb temperature** (Stull formula from dry-bulb + humidity, `analysis/psychro.ts`), dry-bulb temperature or enthalpy; *Automatic* picks wet-bulb when both the logged-period weather and the typical year carry humidity. Two regression chains, each in two steps (energy vs weather, then cooling load vs energy):
* **Hourly:** `kWh_h = a·x_h + b`, `TR·h_h = c·kWh_h + d` fitted on the logged running hours, evaluated for every typical hour and summed (negative predictions clamped to 0).
* **Daily:** `kWh_d = a·Σx_d + b`, `TR·h_d = c·kWh_d + d` fitted on complete logged days (24 hourly values), evaluated for every complete typical day.
A typical year with other than 8,760 usable hours is scaled to 8,760 (with a note). The annual kW/TR is Σ kWh ÷ Σ TR·h. Optional scenario: proposed kW/TR × (1 + safety %) × annual TR·h versus the hourly-method baseline. The Excel *Annual Projection* sheet recomputes the hourly method with live formulas (including the wet-bulb formula) from editable coefficients. The method follows the "KAIA LC2" chiller-analysis workbook (same regressions, same Stull formula); unlike that workbook, which sums only the weather rows present, the totals here always cover a full year. Aux/pump/tower baselines and chiller-count staging from that workbook are not modelled.

**Air-cooled plants** (Plant Settings → Plant type; method from the "AFH Main Building Plant 2" workbook): the driver is dry-bulb temperature, and energy and cooling load are each regressed *directly* on it (`kW = a·T + b`, `TR = c·T + d`, each on its own valid hours) instead of chaining load through energy. Annual kWh and TR·h are the sums over the typical year; kW/TR = Σ kWh ÷ Σ TR·h; **EFLH** = annual kWh ÷ installed electrical capacity (Σ rated TR × rated kW/TR). The optional outlier filter (Plant Settings, σ, default off) drops points beyond that many residual standard deviations and refits once, reporting the share removed (the workbook's "excluding outliers" variants did this by hand).

## Licensing components
See LICENSING.md. Database schema: `license-server/schema.sql` (licenses, activations, counters, audit).

## Known limitations
* Analysis runs on the UI thread (a few hundred thousand rows are fine; millions would want a Web Worker).
* FCA2 SQLite reading is schema-agnostic (best-effort table/column detection); the proprietary layout of real `.fca2` files could not be checked here. Closed binary `.fca` files are refused with export instructions, by design.
* No trial mode is implemented (the spec made it optional).
