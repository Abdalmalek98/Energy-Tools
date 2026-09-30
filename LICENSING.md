# Licensing

## Model
```
Owner ── License Manager (local UI/CLI) ──HTTPS admin API (bearer token)──► License service ── SQLite
                                                                                  │ signs with Ed25519 PRIVATE key (env / file, never in Git)
Customer PC: Chiller Plant Analyzer ──HTTPS /v1/activate /validate /deactivate /heartbeat──► License service
             holds only PUBLIC keys (src-tauri/licensing-core/keys/public-keys.json)
```
The desktop app contains **no** signing key, **no** admin credential and **no** ability to create licenses.

## Formats
* **Activation code** `CPA1.<base64url(payload)>.<base64url(Ed25519 signature)>`; the signature covers `"CPA1.<payload>"`. Payload: `v, kid, lid, product, customer, company, iat, nbf, exp|null, maxAct, bind{mode,fp,parts}, features{}`. It carries no secret and **no status** (status is server-side).
* **Server receipt** `CPR1.…` (same construction) returned by activate/validate: `lid, status (active|suspended|revoked|expired), exp, fp, parts, validatedAt, checkIntervalDays, graceDays, features, nonce`. The nonce echoes the client's request, so a captured response cannot be replayed for a new request. The receipt is the authoritative state, so **renewals/extensions/revocations reach the client without a new code or a rebuild.**
* `kid` selects the public key ⇒ key rotation.

## Client validation (all in Rust, re-run on every status query)
signature · product · licence id · start date · expiry (server-authoritative) · machine binding · status · validation freshness.
Policy from the server (defaults 7-day check interval + 14-day grace): overdue ⇒ warning (still works) ⇒ after grace ⇒ locked until an online check succeeds.
Expired ⇒ locked ("License expired. Please enter a valid activation code."). Clock roll-back cannot extend a license (a high-water mark is stored).

> **Remote revocation cannot reach a computer that never goes online.** Revoke/suspend take effect at that computer's next successful online validation; an air-gapped machine keeps working until the offline grace period ends. This is inherent to any offline-capable licensing scheme.

## Offline licenses (no server contact)
An offline license is a normal signed code with `off: 1`. The app verifies it on the PC alone: signature, product, dates and machine binding — no activation, no validation, no grace period. Use it for your own PCs, air-gapped sites or demos.
* Always machine-bound (`specific`): the customer sends the **Machine ID** from the License screen, you create the license with it (`cpa-admin create --customer "Me" --offline --machine MID1.… --perpetual`, or the "Offline license" choice in the License Manager). An unbound offline code could be copied to any PC, so the server refuses it (`allowUnboundOffline` overrides at your own risk).
* **It cannot be revoked or suspended remotely** — the computer never talks to the server. Its only limits are its expiry date and its machine. Use a short expiry and issue a new code to renew (the Manager re-signs from the record; renewing the record alone does not change codes already handed out).
* A large hardware change makes the code stop matching; issue a new code for the new Machine ID (Generate replacement license).
* Recorded in the database (`offline = 1`) for your own bookkeeping; activation counts do not apply.

## Machine fingerprint
Five hashed components (Windows: MachineGuid, computer name, CPU, BIOS, baseboard). Only SHA-256 hashes leave the PC. Two identities are the same machine if the combined hash matches or ≥ 60 % of the components match, so a single hardware swap does not break a licence. Machine ID string for specific-machine licences: `MID1.<base64url(json)>`, shown on the License page.
Binding modes: `none` (activation count still enforced), `first` (first activating machine), `specific` (machine ID embedded in the signed code).

## Operations (License Manager or `cpa-admin`)
| Task | UI button / CLI |
|---|---|
| Generate | Generate License · `cpa-admin create --customer "ABC" --days 365 --max 1 --binding first` |
| Perpetual | leave duration empty · `--perpetual` |
| Copy / export code | Copy Activation Code / Export License · `cpa-admin token <id>` |
| Revoke / suspend / reinstate | Revoke License… · `cpa-admin revoke <id>` |
| Renew (absolute date or +N days from max(now, expiry)) | Renew License · `cpa-admin renew <id> --days 365` |
| Extend (+N days from current expiry) | Extend License · `cpa-admin extend <id> --days 30` |
| Replacement (new id, old revoked) | Generate replacement license · `cpa-admin replace <id>` |
| Free a machine / reset count / authorise replacement PC | Deactivate machine / Reset activation count / Authorize replacement machine |
Independent control per customer (30-day, 365-day, revoked, perpetual) needs **no rebuild** — state lives in the database.

## Key management and rotation
1. `cd license-server && npm run keygen -- k1 ../private-keys` (private PEM, mode 0600; keep out of Git — `*.pem` and `private-keys/` are ignored).
2. Add the printed public entry to `src-tauri/licensing-core/keys/public-keys.json`, remove the `dev-1` entry, rebuild the app.
3. Give the service the key: `CPA_SIGNING_KEY_FILE_k1=/secure/path/k1.private.pem`, `CPA_ACTIVE_KEY_ID=k1`.
4. **Rotate**: generate `k2`, ship an app update containing both public keys, then set `CPA_ACTIVE_KEY_ID=k2` (keep `k1` loaded so existing codes/receipts still verify; mark `"retired": true` in the app keyring later). Apps that lack `k2` show "unknown key … please update".
The committed `license-server/dev/dev-private-key.pem` (`dev-1`) is a throw-away test key: release builds ignore dev keys and `scripts/check-release-keys.mjs` blocks a release without a production key.

## Service API
Public: `POST /v1/activate {token, machine{fp,parts}, appVersion, nonce}`, `/v1/validate`, `/v1/deactivate`, `/v1/heartbeat`.
Admin (Bearer `CPA_ADMIN_TOKEN`): `GET|POST /v1/admin/licenses`, `GET|PATCH /v1/admin/licenses/:id`, `GET …/token`, `POST …/(revoke|suspend|reinstate|renew|extend|replacement|reset-activations|authorize-replacement)`, `POST /v1/admin/activations/:id/deactivate`, `GET /v1/admin/audit`. Errors: `{error, message}` with codes such as `max_activations, wrong_machine, revoked, expired, not_yet_valid, wrong_product, not_activated`.
Data sent by the app: license id, app version, hashed fingerprint + component hashes, nonce. Nothing else.
