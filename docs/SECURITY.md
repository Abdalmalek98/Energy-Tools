# Security

## What protects what
| Threat | Protection | Where |
|---|---|---|
| Using the service without a valid licence | The server checks the licence in its database **on every page read**; revoked/suspended/expired/deactivated → refused. Your Anthropic key exists only on the server. | server |
| Forged activation codes | Ed25519 signatures; the app and server hold public keys only; the signing key is only on your PC. | app, server |
| Forged server answers | Receipts are signed by the server's key and echo a random per-request nonce, so a replayed or substituted response is rejected. | app |
| Copying the licence file to another PC | Stored with Windows DPAPI (bound to the Windows user) and bound to ≥ 60 % of hashed hardware components. | app |
| Editing the licence file | DPAPI/AES-GCM authentication fails → file discarded, user asked to activate again. | app |
| Setting the clock back | Judged against the latest time ever seen; server time repairs glitches. | app |
| Brute-forcing the admin API | Constant-time token compare, per-IP rate limits and a failed-attempt limit, audit log. | server |
| Leaked private keys | Key ids + keyring allow rotation and withdrawal (docs/LICENSING.md §4). | all |

## Honest limits
* **The licensing code in the app runs in Electron's main process (JavaScript inside an ASAR), not in a native Rust layer.** A determined person can patch the app to skip the *local* check. That only unlocks screens that need no server (review, export of data already read). **Reading handwriting always needs your server, which enforces the licence.** Client-side checks exist for a clear user experience and offline use.
* **Remote revocation cannot reach a computer that never goes online.** Offline licences keep working until they expire; online licences until the offline grace period ends. Use short expiries for customers you may need to cut off.
* The hardware fingerprint tolerates change (≥ 60 % match) so legitimate upgrades don't lock customers out; it is not tamper-proof against someone who can read the hashed values and replay them (it is a deterrent against casual sharing, not against a skilled attacker).
* Without a code-signing certificate Windows shows a SmartScreen warning (see USER_GUIDE).
* DPAPI, `reg.exe` queries and the NSIS installer are Windows-only and were **not** exercised in the Linux test environment (see TESTING.md).

## Rules the code follows
* **No secrets in the app**: only public keys. No admin credential, no signing or licence-generation code (`signCode` exists in the shared library for tests and the optional server-side issuer; it is only reachable from the server and tests, and the release gate checks the bundle).
* **Development keys** exist only in `keyring.debug.ts`, compiled behind `__DEBUG_KEYS__` (false in release builds), flagged `dev: true`, and additionally refused at run time by release builds. `scripts/release-gate.sh` fails the release if the production key list is empty or contains a dev key, or if the bundle contains the development keyring.
* **Privacy**: the server stores only the licence id, app version and *hashed* hardware components, plus the customer/company text you typed into the licence and usage counts. No file contents or page images are stored (images are forwarded to the model and discarded).
* **Transport**: HTTPS only; the server refuses to start without TLS unless it is explicitly behind a TLS proxy (`BEHIND_PROXY=1`, loopback only).
* **Renderer isolation**: `contextIsolation`, no `nodeIntegration`, sandbox, strict CSP; the window has no network; all HTTP is in the main process.
* `.gitignore` excludes `*.pem`, `private-keys/`, `.env`; `.env.example` contains no secrets.

## Reporting
Found a problem? Tell the owner privately; rotate keys per docs/LICENSING.md §4 if a secret may be exposed.
