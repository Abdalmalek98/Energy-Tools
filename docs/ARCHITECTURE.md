# Architecture

```
┌──────────────── customer PC (Windows) ───────────────┐          ┌──────────── your VPS ────────────┐
│ Electron app                                         │          │ Caddy (TLS) → licensing server   │
│  renderer (React): UI only, no network               │  HTTPS   │  Node 22 + SQLite (node:sqlite)  │
│  main process:                                       │ ───────► │  /v1/activate /validate          │
│   LicenseClient  ← @lsr/licensing                    │          │  /v1/heartbeat /deactivate       │
│   DPAPI store (license.dat)                          │ ◄─────── │  /v1/read-page ──► Anthropic API │
│   fingerprint (hashed components)                    │ receipts │  /admin/v1/*  /manager (UI)      │
└──────────────────────────────────────────────────────┘          └──────────────────────────────────┘
   owner's PC: scripts/offline-license.sh (bash+OpenSSL) signs codes with the private key (never leaves it)
```

## Packages
| Folder | Role |
|---|---|
| `licensing/` | Pure library shared by app, server and tests: code/receipt format, signature verification, keyring rules (kid, dev, withdrawn, validity), machine fingerprint + Machine ID, `evaluate()` (the status state machine), `LicenseClient` (activate/validate/heartbeat/deactivate/readPage), encrypted store helpers. |
| `server/` | Licensing server + proxy + License Manager page + `schema.sql`. |
| `app/` | Electron app, UI, packaging. Main-process wiring: keyring (production + debug-only), DPAPI store, fingerprint collector. |
| `shared/` | Reading logic (prompt, normalisers, ditto resolution, Excel writer). Untouched by licensing. |
| `scripts/` | Owner tools: `gen-license-key.sh`, `offline-license.sh`, `license-admin.sh`, `release-gate.sh`. |
| `deploy/` | systemd unit, Caddyfile, backup script. |

## Status state machine (`licensing/src/evaluate.ts`)
Re-run on every status query from the stored licence + current hardware + current clock:
`unlicensed → active → warning (validation overdue) → validation_required (grace over)`, and terminal-until-fixed states `expired · revoked · suspended · invalid · wrong_machine · not_yet_valid`. The UI shows the activation screen whenever the status is not usable.

## Online flow
1. Customer pastes a code → app verifies signature/product/dates/machine locally → `POST /v1/activate {code, machine.comps, nonce}`.
2. Server verifies the code again (its keyring), records the licence, enforces `maxActivations`/replacement/authorised machines, returns a **signed receipt** echoing the nonce.
3. App verifies the receipt (key, nonce, licence id) and stores it encrypted. Launch + every 30 min: heartbeat (full `validate` with components at least daily). Each receipt carries `validUntil` = the offline grace.
4. A page read sends the receipt; the server checks signature **and the database** (status, expiry, activation) before calling the model; the key and model names stay on the server.

## Offline flow
Offline code (machine-bound, `offline: true`) → local verification only → stored → active, no network call. Reading a page registers the PC with the server on first use (`/v1/activate`), after which it is revocable like any other licence.

## Server data (`server/schema.sql`)
`licenses` (signed fields + status, overrides, grace) · `activations` (hashed components, active flag) · `authorized_machines` · `usage` (pages, model, tokens) · `audit` · `rate_limits`.

## Decisions
* Node 22 `node:sqlite` (no native module to build on the VPS); Caddy for TLS; systemd for supervision.
* Receipts use a *separate* server key so a leaked licence-signing key cannot forge server statements and vice versa.
* The previous Cloudflare Worker + random-code design was **removed** (replaced by this server and signed codes); see git history.
* The reading pipeline (`shared/`) and Excel export are unchanged.
