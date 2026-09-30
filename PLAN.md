# Lighting Survey Reader — Phase 1 Plan

## 0. Blocker to clear before Phase 2
`reference/` was not in the repository/container. Phase 2 (port of the prototype, golden test) and Phase 5
(accuracy run) cannot start without: the prototype HTML, the template .xlsx, the Al Raith .xlsx (golden fixture), and the
other sample PDFs. Phase 3 (service) does not depend on them and could start in parallel if you prefer.

## 1. Repo layout (npm workspaces, TypeScript everywhere)
```
/shared        pure TS, no Node/DOM deps: types, zod schemas, norm(), ditto/section/copy-note resolution,
               space-type mapping, date parsing, checks/flags, Excel writer (ExcelJS), prompt text, Vitest tests
/service       Cloudflare Worker (Hono), D1 migrations, admin page (static HTML+JS served by the Worker), Miniflare tests
/admin-cli     Node script over the admin API (API key)
/app           Electron main + preload + React renderer (Vite), electron-builder config, Playwright E2E
/reference     samples (see above)  /docs  DECISIONS.md, USER_GUIDE.md, ADMIN_GUIDE.md, DEPLOY.md
```
`shared` is consumed by app (renderer + main), service (zod schema for model output, prompt) and admin-cli (types).

## 2. Data model
### Client (shared/types)
`Project { id, name, createdAt, settings{dateFormat, quality}, files[] }`
`SourceFile { id, name, buildingName, pages[] }`  `Page { id, index, imageRef, rotation(0/90/180/270), autoRotated, status(pending|reading|done|error), raw?: ModelPage, error? }`
`ModelPage` = the JSON in brief §4.4.  `Row` (resolved) = 30 template columns + `flags[{col,kind,note}]` + `carried[]` (light-blue cols) + provenance (file, page, sheetRow).
`.lsr` = zip: `project.json`, `pages/<id>.jpg`, raw model output kept so post-processing can be re-run without re-reading.
Local secure store (DPAPI via Electron `safeStorage`): lease token, device id cache, last server time seen.

### Service (D1)
- `codes(id, code_hash UNIQUE, last5, customer, notes, status[active|locked], valid_days, fixed_end, first_activated_at, ends_at, max_devices=1, lease_hours=72, page_quota_month NULL, locked_reason, created_at)`
- `devices(id, code_id, device_hash, first_seen, last_seen, app_version, UNIQUE(code_id,device_hash))`
- `usage(id, code_id, device_id, ts, pages, model, ok)` + monthly total via `SUM` on `ts >= month start (UTC)`
- `audit(id, ts, actor[admin|cli|client], action, code_id, ip, detail_json)`  — every admin action and activation attempt
- `rate_limits(key, window_start, count)` — fixed-window counters per IP and per code
- `admin_state(totp_last_step, failed_attempts, locked_until)`

## 3. API contract (JSON, HTTPS only)
Common error body: `{ "error": "<code>", "message": "<human text>" }`.
| Endpoint | Request | Success | Errors |
|---|---|---|---|
| `POST /v1/activate` | `{code, deviceId, appVersion}` | `{lease, license:{customer,endsAt,quotaMonth,quotaLeft}, serverTime}` | `invalid` 404, `locked` 403, `expired` 403, `device_limit` 409, `rate_limited` 429 |
| `POST /v1/refresh` | `{lease}` | same as activate | `invalid`, `locked`, `expired`, `device_revoked` |
| `POST /v1/read-page` | `{lease, images[1..3 base64 JPEG ≤ ~4 MB], quality:"best"\|"fast"}` | `{page: <validated model JSON>, quotaLeft}` | `locked`, `expired`, `quota`, `upstream` (incl. schema-invalid output), `too_large`, `rate_limited` |
| `POST /v1/deactivate` | `{lease}` | `{ok:true}` | `invalid` |
Lease = compact EdDSA JWS: `{cid, did, end, exp, iat, quota_left, v}`. Verified offline in the app with the embedded public key.
Every endpoint except `/activate` re-checks the DB row (status, expiry, device still bound) — the lease only provides offline grace.
Admin (`/admin` UI, `/admin/api/*`): list/create/lock/unlock/extend/reset-devices/delete/usage-log. Auth = password + TOTP → signed HttpOnly session cookie (UI); `Authorization: Bearer <ADMIN_API_KEY>` (CLI, compared by hash).

## 4. Key flows
- **Launch**: load store → verify lease signature → if clock went back >1 h vs. last server time → force online refresh → refresh (fail closed on `locked`/`expired`; on network error allow until lease `exp`). Timer 30 min.
- **Read page**: render upright → 3 JPEGs (full, top 56 %, bottom 56 %) → `/read-page` (2 in parallel, 529/overloaded back-off, no retry on schema failure) → post-process locally.
- **Quota**: reserve 1 page before calling Claude, refund on `upstream` failure; month = UTC calendar month.
- **Export**: template workbook is bundled; ExcelJS loads it, clears data rows, writes rows cloning row-3 styles.

## 5. Phase mapping
2 shared+tests → 3 service+admin+CLI+deploy guide → 4 app+E2E → 5 accuracy run → 6 packaging/docs (details as in the brief).

## 6. What I can and cannot verify from this environment
Linux cloud container: I can run Vitest, Miniflare, and Playwright-for-Electron under xvfb, and build the NSIS installer via wine if it can be installed (otherwise CI on `windows-latest`, which I'll provide as a GitHub Actions workflow). I cannot: deploy to your Cloudflare account, run a real Windows 11 VM, open files in real Excel (I'll validate with ExcelJS re-load + LibreOffice), or run Phase 5 without your Anthropic key/service URL and the sample files. Those steps will be given to you as exact commands.
