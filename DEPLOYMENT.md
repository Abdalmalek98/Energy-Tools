# Deployment

## 1. Licensing service
```bash
cd license-server
cp ../.env.example .env            # fill in; never commit
npm run keygen -- k1 ../private-keys
set -a; . ./.env; set +a
CPA_SIGNING_KEY_FILE_k1=../private-keys/k1.private.pem CPA_ACTIVE_KEY_ID=k1 npm start
```
Run behind HTTPS (built-in TLS via `CPA_TLS_CERT`/`CPA_TLS_KEY`, or a reverse proxy + `CPA_ALLOW_PLAIN_HTTP=1` + `CPA_TRUST_PROXY=1`). Back up `CPA_DB_PATH` (SQLite, WAL). For PostgreSQL port `schema.sql` and `src/db.js`/queries (plain SQL).

## 2. License Manager (owner)
```bash
cd license-manager
CPA_SERVER_URL=https://licensing.yourcompany.com npm start    # http://127.0.0.1:5177, sign in with CPA_ADMIN_TOKEN
# or CLI: CPA_ADMIN_TOKEN=… node src/cli.js create --customer "ABC" --days 365
```
`LicenseManager.exe`: wrap with a single-file packager on the owner's Windows PC (e.g. `npx @yao-pkg/pkg license-manager/src/server.js`) or ship it as a Tauri shell; it is deliberately a separate program and is never distributed to customers.

## 3. Desktop application (Windows)
Prerequisites on the build machine: Node 22, Rust stable, WebView2 (Win10/11), NSIS (fetched by Tauri).
```powershell
node scripts/check-release-keys.mjs --strict     # production public key present, dev key removed
$env:CPA_LICENSE_URL = "https://licensing.yourcompany.com"
npm ci ; npm run tauri:build
```
Outputs: `src-tauri\target\release\ChillerPlantAnalyzer.exe` and `…\bundle\nsis\Chiller Plant Analyzer_1.0.0_x64-setup.exe` (rename to `Chiller Plant Analyzer Setup.exe`). The installer creates the Start-menu entry, supports uninstall, keeps user data (licence/projects) unless the user ticks "delete application data", and embeds the WebView2 bootstrapper. Desktop-shortcut creation follows Tauri's NSIS behaviour; a custom NSIS template can make it an explicit checkbox.
Code signing: set `bundle.windows.certificateThumbprint` (or use the workflow's certificate secret). CI: `.github/workflows/release-windows.yml`.
Version: change in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src/settings/defaults.ts` (shown in Settings → About and sent with each validation).

## 4. Day-to-day
See LICENSING.md (generate / renew / extend / revoke / rotate keys) and TESTING.md.
