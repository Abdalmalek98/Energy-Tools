# Chiller Plant Analyzer

Windows desktop application (Tauri 2 · Rust · React · TypeScript) for chilled-water plant efficiency analysis:
BMS/trend import, Fluke power-logger import, plant & chiller KPIs, OLS regression (ASHRAE Guideline 14), IPLV,
findings and a native-chart Excel report. **All engineering data stays on the user's computer.** Activation and
periodic validation use a small HTTPS licensing service that only ever sees a license ID, app version and a hashed
machine fingerprint.

| Part | Path | Tech |
|---|---|---|
| Desktop app UI + engineering engine | `src/` | React, TypeScript, Vite |
| Native shell + licensing client | `src-tauri/`, `src-tauri/licensing-core/` | Rust (Tauri 2, ed25519-dalek, DPAPI) |
| Licensing service (API + DB) | `license-server/` | Node ≥ 22, SQLite (`schema.sql`) |
| License Manager (owner only) | `license-manager/` | Node, local web UI + CLI |
| Tests | `tests/`, `license-server/test`, `license-manager/test`, `src-tauri/licensing-core/tests` | Vitest, node:test, cargo test |

## Quick start (development)
```bash
npm install
npm run dev                          # Vite UI in a browser (licensing stand-in: VITE_CPA_DEV_LICENSE=1 npm run dev)
npm run tauri dev                    # full desktop app (needs Rust + platform WebView)
npm run test:all                     # typecheck + all test suites
```
Node ≥ 22.5 is required (`node:sqlite`). See **DEPLOYMENT.md** for building the Windows installer, **LICENSING.md** for
licence operations, **ARCHITECTURE.md**, **SECURITY.md**, **TESTING.md**.

## Status — read this first
Verified in this repository's CI-equivalent environment (Linux): all TypeScript/Rust/Node tests, the UI in Chromium, the
Excel workbook (recalculated in LibreOffice, no formula errors, native charts rendered), the Rust client against the real
Node licensing service, and the Rust code type-checks for the `x86_64-pc-windows-gnu` target (DPAPI, registry, SChannel).

The real Tauri binary (debug build, Linux/WebKitGTK under Xvfb) was also launched and driven: it showed the activation screen, activated against the Node licensing service with a dev-signed code, persisted the encrypted license across a restart, imported the BMS sample through the native file dialog, and exported a 6-chart `.xlsx` through the native save dialog.

**Not verifiable here, and therefore not claimed:** producing `ChillerPlantAnalyzer.exe` / `Chiller Plant Analyzer Setup.exe`
(needs a Windows runner — `.github/workflows/release-windows.yml` does it), Authenticode signing (needs your certificate),
and the original acceptance figures for `LC5_CH3__SN_62934227__260628_1539_trend.txt` — that customer file was not part of the
repository. Drop it into `sample-data/` and `tests/acceptance.test.ts` will check every figure in the specification.
A *synthetic* stand-in is used for the other tests (`tests/fixtures.ts`).
