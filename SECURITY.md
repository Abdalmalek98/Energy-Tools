# Security

**Goal:** a commercially reasonable licensing system. Client-side protection can always be defeated by a determined
reverse engineer with local admin rights (patching the UI/binary); this design raises the bar and, above all, keeps
the *ability to issue licenses* out of customers' hands.

| Requirement | Implementation |
|---|---|
| Signed licenses, public-key verification | Ed25519; app embeds public keys only (`keyring.rs`); signatures re-verified on every status query |
| No private key / admin credential in the client | Signing key only in the service environment; admin token only typed into the local License Manager (memory only). The app has no code path to create licenses |
| Secure local storage | `license.dat` in the user's local app-data folder, encrypted with Windows DPAPI (user-bound) + app entropy; atomic writes; tamper ⇒ decrypt failure ⇒ "invalid, activate again" |
| Encrypted cache is not the trust root | Everything inside is signed; editing it (even after decrypting) invalidates the signatures |
| Machine binding | Hashed multi-component fingerprint with tolerance; server-side activation limits |
| Replay | Per-request nonce echoed in the signed receipt |
| Clock roll-back | High-water mark of observed time; effective time = max(now, last seen, last validation) |
| HTTPS | Client refuses non-HTTPS service URLs (plain HTTP to loopback only in debug builds); Windows uses SChannel + OS trust store. The service refuses to start without TLS unless `CPA_ALLOW_PLAIN_HTTP=1` (behind a TLS proxy) |
| Server-side validation | All entitlement decisions (status, expiry, activation count, binding) are made by the service and returned as signed receipts |
| Admin API | Bearer token compared in constant time, disabled unless configured, rate-limited failures, audit table, body-size limit |
| Data privacy | The service schema has no engineering fields; the client sends only license id, version, hashed fingerprint, nonce |
| Web content | Strict CSP in `tauri.conf.json`; Tauri capabilities limited to dialog + scoped fs |
| Code signing | Supported in `release-windows.yml` via a certificate secret (you must supply it) |

Known limits: a patched binary can bypass UI gating (`license_require` is a deterrent); offline machines cannot be revoked until they reconnect;
non-Windows builds use a fixed-key AES box (development only). Do not commit `.env`, `*.pem`, `private-keys/`.
Report vulnerabilities privately to your support address.
