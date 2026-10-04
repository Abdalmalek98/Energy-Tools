# Testing

```bash
npm install
npm run typecheck
npm test                                   # all unit/integration suites
node app/e2e/prepare.mjs && cd app && xvfb-run -a npx playwright test     # real Electron app + real server
```

| Suite | What it proves |
|---|---|
| `licensing` (30) | valid · tampered · forged · unknown key · wrong product · dev key refused in release · key rotation/withdrawal/validity · expired · future · revoked · suspended · wrong machine · copied file · hardware drift (60 %) · grace warning then lock · renewal/extension · clock rollback · replayed receipt · offline licence needs no network · tampered receipt |
| `server` (64) | **HTTP tests** of every endpoint (activation limit, replacement, authorise machine, validate/heartbeat/deactivate, revoke/suspend/reinstate, renew/extend, admin auth + rate limit + audit, privacy, quota, read-page gating, TLS refusal at start-up) · **real client vs real server** (full online lifecycle, server unavailable, replayed server response, tampered/foreign cache, clock rollback, key rotation, dev key in release/debug) · **reading provider** (Anthropic ↔ Groq: key never returned, stored encrypted, OpenAI-style request, error mapping, test connection, revoked licences refused before any provider call) · **`offline-license.sh`/`gen-license-key.sh`** (code accepted by the real client with no network call; key-mismatch refusal; self-verification; input validation; Arabic names) |
| `shared` (153) | reading logic, golden export vs the team's typed rows, LibreOffice recalculation |
| `app` (unit) | `.lsr` project files |
| `app` E2E (10, Playwright + Electron under Xvfb) | activation messages (bad/tampered/expired/second PC), Machine ID copy, licence page, full read→review→export→save→reopen against the real built server, append to master, revoke locks the running app and survives an offline restart, suspend/check/deactivate, grace warning banner, **offline activation with the server stopped**, visible errors for dialog/disk failures, **License Manager in a real browser: connect a Groq key, test it, then read pages through Groq in the app** |

## Not verified in the Linux test environment
* Windows-only behaviour: DPAPI (`safeStorage`) storage, `reg.exe` hardware queries, the NSIS installer and portable exe, Authenticode signing, SmartScreen. Use `docs/ACCEPTANCE.md` on a Windows 11 VM.
* Real reading accuracy and the live Groq/Anthropic APIs (need your keys; the build environment cannot reach them). Groq is tested against a stub of its OpenAI-compatible API only; see `npm run accuracy`.
* The GitHub Actions Windows workflow is checked by running it (see the project README for the latest result).

## Windows CI
`.github/workflows/build-windows.yml` runs licensing/shared/server/app tests on `windows-latest`. Tests that need bash/OpenSSL (`offline-license.sh`), LibreOffice, or xvfb skip themselves on Windows and run on Linux in `ci.yml`.
