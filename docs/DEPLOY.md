# Deploying the licensing + proxy service (Cloudflare)

Everything below is run from `service/`. You need: a Cloudflare account, Node 20+, an Anthropic API key
(console.anthropic.com), and the **Workers Paid plan (~US$5/month)** — the free plan's 10 ms CPU limit is too small
for the ~12 MB image requests.

## 1. One-time setup
```bash
git clone https://github.com/Abdalmalek98/Energy-Tools && cd Energy-Tools
npm install
cd service
npx wrangler login                          # opens a browser
npx wrangler d1 create lighting-survey      # prints a database_id
```
Paste the printed `database_id` into `service/wrangler.toml` (`[[d1_databases]]`).

## 2. Generate all secrets
```bash
npm run setup-secrets
```
This prints (once, nothing is saved): the Ed25519 lease keys, your admin password, the TOTP secret (add it to your
authenticator app as "time based"), the admin-CLI API key, and the exact values for the next step. **Store the output in a
password manager.** Optional: `ADMIN_PASSWORD='your own long password' npm run setup-secrets`.

## 3. Set the secrets (each command asks you to paste the value)
```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put LEASE_PRIVATE_KEY
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put ADMIN_TOTP_SECRET
npx wrangler secret put ADMIN_SESSION_SECRET
npx wrangler secret put ADMIN_API_KEY_HASH
```
Put the printed **public** key in `wrangler.toml` → `LEASE_PUBLIC_KEY = "..."` (not secret). Model names are
`MODEL_BEST` / `MODEL_FAST` in the same `[vars]` block — change them there, no app update needed.

## 4. Create the tables and deploy
```bash
npx wrangler d1 migrations apply DB --remote
npx wrangler deploy
```
The output shows your URL, e.g. `https://lighting-survey-service.<you>.workers.dev`. Optionally attach your own
domain in the Cloudflare dashboard (Workers → your worker → Settings → Domains & Routes).

## 5. Check it
```bash
curl https://<your-url>/v1/ping            # {"ok":true,"serverTime":...}
```
Open `https://<your-url>/admin`, sign in with password + authenticator code, press **Create code**.
CLI equivalent:
```bash
export ADMIN_URL=https://<your-url> ADMIN_API_KEY=lsr_...
node ../admin-cli/cli.mjs create --customer "Acme Energy" --days 365 --devices 1 --quota 500
node ../admin-cli/cli.mjs list
```

## 6. Build-time constants for the app (Phase 4)
`LSR_SERVICE_URL=https://<your-url>` and `LSR_PUBLIC_KEY=<the public key>`.

## Rotating things
- **Lease key**: run `setup-secrets` again, set `LEASE_PRIVATE_KEY` + `LEASE_PUBLIC_KEY`, redeploy, ship a new app build. Old apps
  then fail signature checks and must update (also your emergency "cut off old builds" switch).
- **Admin password / TOTP / API key**: re-run `setup-secrets`, `wrangler secret put` the new values.
- **Anthropic key**: `npx wrangler secret put ANTHROPIC_API_KEY`.

## Tests
`npm test` (from repo root or `service/`) runs the Miniflare suite; no Cloudflare account needed.
