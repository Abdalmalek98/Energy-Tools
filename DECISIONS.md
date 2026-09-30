# Decisions

1. **Monorepo with npm workspaces**, TypeScript strict, Vitest, ESLint. One `shared` package so app and service can't drift on the JSON schema.
2. **Service on Cloudflare Workers + D1 + Hono** as briefed. Needs the **Workers Paid plan (~US$5/mo)**: the free plan's 10 ms CPU limit is too tight for parsing ~12 MB image payloads and verifying signatures. Same API can be ported to any host.
3. **Leases**: EdDSA-signed compact tokens (WebCrypto Ed25519 in the Worker; `node:crypto` verify in Electron main). Private key = Workers Secret `LEASE_PRIVATE_KEY`; public key + service URL injected at build time (Vite `define`).
4. **Server is authoritative**: every `/refresh`, `/read-page`, `/deactivate` checks the DB row, so a lock takes effect on the next call; the app refreshes at launch, every 30 min, and before each page read.
5. **Code format**: 20 Crockford-base32 chars (100 bits) from `crypto.getRandomValues`; stored as SHA-256 + last 5; input normalised (case, I/L→1, O→0, dashes/spaces ignored).
6. **Device ID**: SHA-256(MachineGuid + app salt); MachineGuid read with `reg.exe query` (no native module). Salt is a build constant.
7. **Rate limiting**: D1 fixed-window counters (per IP and per code) rather than the Rate Limiting binding, so behaviour is testable in Miniflare.
8. **Admin auth**: password (PBKDF2/scrypt-style hash stored as secret) + TOTP (RFC 6238, replay-protected), 8 h HttpOnly SameSite=Strict cookie, lockout after repeated failures, CSRF token on mutations. CLI uses a separate API key (hash stored as secret).
9. **Quota** counts one page per successful `/read-page`; monthly window = UTC calendar month; refunded on upstream failure.
10. **Model names** are Worker vars (`MODEL_BEST=claude-opus-5-5`, `MODEL_FAST=claude-sonnet-5-5`); the API key never reaches the client.
11. **Auto-update**: `electron-updater` with GitHub Releases (a public releases-only repo). Installers are useless without a licence code, so public hosting is acceptable; avoids R2 cost/complexity. Portable zip is manual-update.
12. **Renderer**: React + Vite; pdf.js and ExcelJS bundled; CSP `default-src 'self'; connect-src` limited to the service origin only in main process (renderer has no network; all HTTP in main via preload IPC).
13. **Arabic/RTL**: cells use `dir="auto"` + `unicode-bidi: plaintext`; file paths handled as UTF-8 throughout.
14. **Post-processing lives only in `shared`** and is pure/deterministic; raw model output is stored in the project so rules can be re-applied without spending pages.
15. **Signing**: electron-builder config reads `CSC_LINK`/`CSC_KEY_PASSWORD` if present; unsigned builds work and trigger SmartScreen (documented in USER_GUIDE).
