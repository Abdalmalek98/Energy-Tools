# Licensing

How activation codes work, how you (the owner) create them, and what to do when a key changes or leaks.

## 1. The pieces

| Piece | What it is |
|---|---|
| **Activation code** | `LSR1.<payload>.<signature>`. The payload is JSON (licence id, product, customer, company, issued/not-before/expiry dates, `maxActivations`, `offline` flag, machine binding, features, `kid`). The signature is Ed25519 over the text `LSR1.<payload>`. |
| **Your signing key** | An Ed25519 key pair. The **private** key stays on your PC and signs codes. Only the **public** key (identified by a key id, `kid`, e.g. `lic-1`) is inside the app and on the server. |
| **Keyring** | The app trusts a *list* of public keys (`licensing/keys/production.json`), each with a `kid`. That is what makes rotation possible. |
| **Machine ID** | `MID1.<base64url json>` shown on the activation screen with a Copy button. It holds several *hashed* hardware components (never raw serials). |
| **Receipt** | `RCP1.<payload>.<signature>`: what the licensing server returns, signed with the **server's own** key. Contains status (active/suspended/revoked/expired), the request's random nonce, the current expiry, and how long the app may stay offline (`validUntil`). |

### Two kinds of licence

| | **Offline licence** | **Online licence** |
|---|---|---|
| Made by | `offline-license.sh` (default) | `offline-license.sh --online`, or the License Manager |
| Tied to | exactly one computer (the Machine ID you were given) | the first computers that activate (up to `maxActivations`), or one Machine ID |
| Activation | **no server contact at all** | server activation, signed receipt |
| After activation | works until it expires; never asks the network | re-validates (launch, then every 30 min; full check daily); offline grace period (default 7 days, per-licence) then locks |
| Revoke / suspend / renew / extend | reaches the PC **only when that PC next talks to the server** (reading a page) | next validation (≤ 30 min online) |
| Page reading | needs the server (your Anthropic key lives there). First read registers the PC. | same |

> **Important limit: remote revocation cannot reach a computer that stays offline.** An offline licence on a PC that never connects keeps working until its expiry date, and an online licence keeps working until its offline grace period ends. The server always refuses page reads for revoked/suspended/expired licences, so a revoked customer loses the one thing that needs your service (reading handwriting), but the rest of the app (review, export) on a never-connected PC is not affected. Use short expiry dates for high-risk customers.

## 2. Step by step in Git Bash (no Node.js needed)

You need Git Bash (comes with Git for Windows) and OpenSSL 3 (included). Open Git Bash **in the project folder** (download the repository ZIP from GitHub and unzip it, or `git clone`).

**Step 1: generate your signing key (once).**
```bash
bash scripts/gen-license-key.sh
```
It creates `private-keys/license-key.pem` and prints one line like
`{"kid":"lic-1","publicKey":"MCowBQYDK2VwAyEA…"}`.
* **Back up `private-keys/license-key.pem`** (password manager attachment or encrypted USB stick). If you lose it you cannot make new codes for this key.
* **Never** paste, e-mail or upload the `.pem` file. It is git-ignored.

**Step 2: send me ONLY the public key line** (the `{"kid":…}` line). It is safe to share. I add it to `licensing/keys/production.json` and build a release that trusts it. If you ever paste a private key by mistake, treat it as leaked and rotate it (section 4).

**Step 3: the server's receipt key** (once, on the VPS; see DEPLOYMENT.md): `bash scripts/gen-license-key.sh --role receipt`, then send me that public key line too.

**Step 4: install the app** from the release build and open it. The activation screen shows a **Machine ID**: press **Copy** and send it to yourself (or have your customer send it).

**Step 5: create an offline activation code for that computer.**
```bash
bash scripts/offline-license.sh \
  --key private-keys/license-key.pem --kid lic-1 \
  --customer "Jane Doe" --company "Acme Energy" \
  --machine-id "MID1.eyJ2IjoxLC…(paste the whole Machine ID)" \
  --days 365
```
Details are printed on screen (stderr); the **code is the last line** (stdout). Select and copy it. Variants: `--expires 2027-12-31`, `--perpetual`, `--pages-per-month 500`, `--online` (no Machine ID needed).
To save only the code to a file: `bash scripts/offline-license.sh … > code.txt` (the details still appear on screen).

The script refuses to run (and prints nothing) if your private key does not match the public key built into the app for that `kid`, and it verifies its own signature before printing.

**Step 6: activate.** Paste the code into the app's activation box and press **Activate**. The Settings → License page shows the licence id, customer, dates, days remaining, status, machine and last validation.

**Step 7 (optional): import it into the server** so you can revoke/suspend/renew it later: License Manager → *Import*, or `bash scripts/license-admin.sh import "<code>"`.

## 3. Day-to-day on the server

* **License Manager**: `https://<your-server>/manager` (sign in with the admin token): list, import, (optionally create), revoke, suspend, reinstate, renew, extend, allow replacement, reset activations, authorise a machine, set the offline grace period, usage, audit log.
* **Command line, no Node**: `scripts/license-admin.sh` (bash + curl). Set `LSR_SERVER_URL` and `LSR_ADMIN_TOKEN` first.
* **Moving to a new PC**: the customer uses *Settings → Deactivate* on the old PC, then activates on the new one. If the old PC is dead: *Allow replacement* (the next new computer replaces the old one(s)) or *Authorise machine* with the new Machine ID. Offline licences are tied to one Machine ID: make a new code for the new PC.
* **Renew / extend**: *Renew* sets a new expiry date, *Extend* adds days. For online licences the server's date wins at the next validation; for an offline licence on a PC that never connects, issue a new code.

## 4. Keys: rotation and leaks

### Planned rotation (add a second key, retire the first)
1. `bash scripts/gen-license-key.sh --kid lic-2 --out private-keys/license-key-2.pem` → send me the public key line.
2. It is **added next to** `lic-1` in `licensing/keys/production.json` (both listed) and the server's `LICENSE_KEYS_FILE`. Ship the new app version. Old codes (signed by `lic-1`) keep working; new codes are signed with `--kid lic-2`.
3. When every customer is on the new version and old codes have been re-issued or have expired, mark `lic-1` as withdrawn: `{"kid":"lic-1","publicKey":"…","revoked":true}` (or set `"notAfter"`), and release again. An app that lacks a key reports "unknown key" and asks to update.
The server's **receipt** key rotates the same way (`--role receipt --kid srv-2`, add to `receipt`, switch `RECEIPT_KID`).

### If a private key leaks
**Signing (licence) key leaked.** Anyone holding it can mint codes.
1. Stop using it. Generate a new key (`lic-2`) and send me the public key.
2. On the server, set `LICENSE_KEYS_FILE` to the new list with `lic-1` marked `"revoked": true` and restart. From that moment the **server refuses every code signed by `lic-1`**: activation fails and page reads stop (the server verifies the stored licence against its own keyring). This is what makes a leak survivable: forged codes unlock only the app's local screens on already-installed old builds, not the reading service.
3. Release a new app version without `lic-1` (and ask customers to update; the auto-updater helps). Re-issue codes to legitimate customers with `lic-2` (`--kid lic-2`).
4. Review the audit log for unknown licence ids; revoke them.

**Receipt (server) key leaked.** An attacker could forge "active" receipts for the local UI. Page reads are still authorised by your database. Generate a new receipt key on the server, update `RECEIPT_KEY_FILE`/`RECEIPT_KID`, release a new app that trusts it, and drop the old one.

**Admin token leaked.** Change `ADMIN_TOKEN` in `/etc/lsr/server.env` and restart; read the audit log.

**Anthropic key leaked.** Create a new key in the Anthropic console, update `ANTHROPIC_API_KEY`, restart, delete the old key.

## 5. What the app checks (on every status query)
Signature and key id · product · key not withdrawn/expired · development key refused in release builds · `notBefore`/expiry (the server's renewed date wins) · machine binding (≥ 60 % of the hashed components must still match; a copied licence file fails) · server status (revoked/suspended) · offline grace period · clock rollback (the licence is judged against the latest time ever seen, so setting the clock back never extends it; a successful server contact repairs a one-off clock glitch).
