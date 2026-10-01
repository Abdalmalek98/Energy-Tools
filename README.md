# Lighting Survey Reader

Windows desktop app that turns photographed/scanned handwritten lighting-survey sheets into your Excel template, with signed-code licensing and a licensing server that gates every page read.

```
Windows app (Electron) ──HTTPS──► licensing server (Node + SQLite, behind Caddy) ──► Claude API (your key, server-side only)
   signed activation codes (Ed25519)        checks the licence on EVERY page read · receipts · admin API · License Manager
```

| Folder | What |
|---|---|
| `app/` | Electron + React app, packaging, Playwright E2E |
| `licensing/` | Code/receipt format, verification, machine fingerprint, status state machine, `LicenseClient` |
| `server/` | Licensing server + page-reading proxy + License Manager page + `schema.sql` |
| `shared/` | Reading logic (prompt, normalisers, ditto resolution, Excel writer) |
| `scripts/` | Owner tools: `gen-license-key.sh`, `offline-license.sh`, `license-admin.sh`, `release-gate.sh` (bash + OpenSSL/curl only) |
| `deploy/` | systemd unit, Caddyfile, backup script |
| `docs/` | LICENSING, ARCHITECTURE, SECURITY, TESTING, DEPLOYMENT, USER_GUIDE, ADMIN_GUIDE, ACCEPTANCE |
| `reference/` | Template workbook, prototype, sample scans |

## Start here
* **You (owner), no Node needed** → [docs/LICENSING.md](docs/LICENSING.md) §2: generate your key and create an offline code in Git Bash.
* Deploy the server → [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Day-to-day → [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md).
* Customers → [docs/USER_GUIDE.md](docs/USER_GUIDE.md). Design → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SECURITY.md](docs/SECURITY.md).

## Developer commands
| | |
|---|---|
| `npm install` · `npm run typecheck` · `npm test` | install · types · all unit/integration tests |
| `node app/e2e/prepare.mjs && cd app && xvfb-run -a npx playwright test` | real Electron app + real server end-to-end |
| `npm run local` / `npm run local:stub` | your own local licence: real server + a code for you (your Anthropic key, or a fake model) |
| `npm run app:local` · `npm run accuracy` | run the app against it · accuracy report over the sample PDFs |
| `npm run dist -w app` | **release** build (runs the release gate; needs production keys + `LSR_SERVICE_URL`) |
| `npm run dist:preview -w app` | preview build with the development keyring (never ship it) |

Windows builds: `.github/workflows/build-windows.yml` produces **Lighting Survey Reader Setup.exe** and **Lighting Survey Reader.exe** (portable). Preview builds run on every push to the working branch; release builds on tags / manual runs with *Release build* ticked.
