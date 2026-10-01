# Testing

```bash
npm run test:all      # typecheck + vitest + cargo test + license-server tests
node --test license-manager/test/*.test.js
```
| Suite | Covers |
|---|---|
| `tests/calculations.test.ts` | cooling load, flow/ΔT/load conversions, kW/TR-COP-EER, rating bands (all four tables), filtering (each reason counted separately), aggregation, energy weighting vs mean-of-ratios, KPIs |
| `tests/regression.test.ts` | Student-t values, OLS vs closed-form, back-transform, Guideline 14 (hourly vs coarser), model selection rules, LCHWT drop, IPLV formula and `*` rule |
| `tests/parsing.test.ts` | comma/semicolon/tab/decimal-comma/BOM/quoted CSV, timestamps (ISO, DMY/MDY, Excel serial, epoch, ticks), Fluke TXT/CSV/UTF-16/ZIP-FCA2/SQLite-FCA2/closed binary, logger statistics, flags, negative phase = Priority |
| `tests/merge.test.ts` | logger↔BMS merge window/nearest fallback, both upload orders, logged-period-only, logger removal |
| `tests/excel.test.ts` | sheets, native chart parts, cached formula values, **LibreOffice recalculation of a cache-free copy: every formula value matches, no errors** |
| `tests/cdd.test.ts` | CDD/temperature file import (units, hourly aggregation, errors), daily roll-up, exact regression recovery (kWh = 2880 + 576·CDD), normalised kW/TR, typical-year annual figures, partial/off/missing days, base-temperature recompute, weather finding and drift, LibreOffice recalculation of the CDD sheet |
| `tests/dlog.test.ts` | data-logger CSV quirks (blank time column, US dates, RTD probes, GPM, single-chiller logger attach), load-column auto-detection |
| `tests/project.test.ts` | `.cpa` round trip, backup, tamper detection |
| `tests/acceptance.test.ts` | original Fluke acceptance figures — runs only when `sample-data/LC5_CH3__SN_62934227__260628_1539_trend.txt` exists (skipped otherwise; reported as skipped) |
| `license-server/test` | valid, tampered/forged/unknown-key tokens, expired, future, revoked, suspended, wrong product, wrong machine, max activations, tolerance, renewal/extension/perpetual, replacement, reset, authorise, key rotation, admin auth, rate limit, audit |
| `src-tauri/licensing-core/tests/licensing.rs` | client policy: valid, invalid signature, unknown key, dev-key rejection, wrong product, future, expired, revoked (only after online check), wrong machine/copied cache, hardware tolerance, max activations, offline grace warning→lock, server unavailable, renewal, deactivation, clock roll-back, key rotation, encrypted cache, replayed response |
| `…/tests/e2e_node_server.rs` | real Rust client ↔ real Node service over HTTP (activation, max activations, extension, revoke/reinstate, owner deactivation, client deactivation, server outage) |
| `license-manager/test` | manager sign-in + admin operations through to the service |
