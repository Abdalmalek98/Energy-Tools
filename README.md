# Lighting Survey Reader

Windows desktop app that turns photographed/scanned handwritten lighting-survey sheets into your Excel template, protected by a licensing + proxy service (Cloudflare Workers) so it only works with a valid activation code.

```
Windows app (Electron) ──HTTPS──► service (Cloudflare Worker + D1) ──► Claude API (your key, server-side only)
                                   checks the code on EVERY request · counts pages · admin page
```

| Folder | What |
|---|---|
| `app/` | Electron + React app, electron-builder config, Playwright E2E |
| `service/` | Licensing/proxy Worker, D1 migrations, admin page, Miniflare tests |
| `shared/` | Prompt, normalisers, ditto/section/"same as" resolution, space types, Excel writer, accuracy scoring (+ golden test) |
| `admin-cli/` | Admin script (same actions as the admin page) |
| `reference/` | Template workbook, prototype, sample scans |
| `docs/` | DEPLOY, LOCAL_LICENCE, USER_GUIDE, ADMIN_GUIDE, ACCEPTANCE |
| `DECISIONS.md`, `PLAN.md` | Design decisions and original plan |

## Commands
| | |
|---|---|
| `npm install` | install everything |
| `npm test` / `npm run typecheck` | unit + service tests / types (shared, service, app) |
| `npm run e2e -w app` | Electron end-to-end tests against a mock service (needs xvfb on Linux) |
| `npm run local` | **your own local licence**: real service on your PC + a code for you ([docs/LOCAL_LICENCE.md](docs/LOCAL_LICENCE.md)) |
| `npm run app:local` | run the app against it |
| `npm run accuracy` | accuracy report over the sample PDFs (needs your Anthropic key via `npm run local`) |
| `npm run dist -w app` | Windows installer + portable zip (needs `LSR_SERVICE_URL`, `LSR_PUBLIC_KEY`) |

Start with [docs/DEPLOY.md](docs/DEPLOY.md) (deploy the service), then [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md); customers get [docs/USER_GUIDE.md](docs/USER_GUIDE.md).
