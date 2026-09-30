# Admin guide (for you, the licence owner)

Setup and deployment: **[DEPLOY.md](DEPLOY.md)**. Trying everything on your own PC first: **[LOCAL_LICENCE.md](LOCAL_LICENCE.md)**.

## Day to day — admin page (works on a phone)
Open `https://<your-service>/admin`, enter the password and the 6-digit authenticator code.
| Task | How |
|---|---|
| **Create a code** | *+ Create code* → customer, validity (**N days from first activation** *or* **fixed end date**), PCs allowed (default 1), offline grace in hours (default 72), optional pages per month. The full code is shown **once**: press *Copy* and send it to the customer. Only a hash and the last 5 characters are stored. |
| **Lock / unlock** | *Lock* (optionally with a reason the customer will see) / *Unlock*. Takes effect on the customer's PC **on their next page read** and **within 30 minutes** at the latest (the app re-checks every 30 min and at launch). A locked app stays locked after a restart, even offline. |
| **Extend** | *Extend* by N days (from the current end, or from today if already ended) or set a fixed date. |
| **Reset devices** | Frees all PCs of a code (customer changed PC and can't deactivate the old one). Old PCs are refused at their next check. |
| **Usage log** | *Usage log*: every page read (time, model, tokens in/out, ok/error), devices with last seen, and the event log for that code. *Audit log*: everything, including failed activations and admin logins. |
| **Delete** | Removes the code, its devices and usage (the audit log keeps a record). |

Same actions in a script (`ADMIN_API_KEY` from `npm run setup-secrets`):
```bash
export ADMIN_URL=https://<your-service> ADMIN_API_KEY=lsr_...
node admin-cli/cli.mjs create --customer "Acme" --days 365 --devices 2 --quota 500
node admin-cli/cli.mjs list | lock 7 --reason "unpaid" | unlock 7 | extend 7 --days 30 | reset-devices 7 | usage 7 | audit | delete 7
```

## Customer messages you will hear about
| They see | Meaning / what you do |
|---|---|
| “not valid” | Typo, or the code was deleted. Check the last 5 characters in the list. |
| “already active on N PCs” | Device limit. *Reset devices*, or raise the limit. |
| “locked … reason” / “expired” | You locked it / it ended. *Unlock* or *Extend*, then they press *Try again* or enter the code again. |
| “Monthly quota reached” | Page quota for the code. Edit the quota, or wait for the 1st (UTC). |
| “connect to the internet” | Offline longer than the grace period, or PC clock moved back more than 1 hour. |

## Security you rely on
Every page read passes through your service and is refused for locked/expired/revoked codes; your Anthropic key exists only as a Cloudflare secret. Client-side checks are only for a friendly experience. Leases are signed (Ed25519); the private key is a Cloudflare secret; the public key is inside the app.

## Rotating keys and secrets
See DEPLOY.md → *Rotating things*. Rotating the **lease key** also cuts off every old app build (they need the new build) — use it as an emergency switch. Admin password/TOTP/API key: run `npm run setup-secrets` again and `wrangler secret put` the new values.

## Releasing a new version (auto-update)
1. One-time: create a public repo `lighting-survey-reader-releases`; in this repo's *Settings → Secrets and variables → Actions* set **variables** `LSR_SERVICE_URL`, `LSR_PUBLIC_KEY`, `LSR_CONTACT`, and **secret** `RELEASES_TOKEN` (a token that can write to the releases repo). Optional signing secrets: `CSC_LINK` (base64 .pfx), `CSC_KEY_PASSWORD`.
2. Raise `version` in `app/package.json`, commit, then `git tag v1.0.1 && git push --tags`. GitHub Actions builds `LightingSurveyReader-Setup-1.0.1.exe` and `LightingSurveyReader-1.0.1-portable.zip` and publishes them with `latest.yml`.
3. Installed apps notice the new release shortly after launch, download it, and install it when the customer closes the app. The portable zip must be replaced by hand. The build refuses to run without a real https service URL and public key.

**Code signing.** Without a certificate Windows shows the SmartScreen warning (explained in USER_GUIDE.md). When you buy an Authenticode/OV/EV certificate (or use Azure Trusted Signing), add the two `CSC_*` secrets — no other change is needed. EV certificates remove the warning immediately; OV certificates need to build reputation first.

## What it costs
* **Cloudflare**: Workers Paid plan, about US$5/month, includes the D1 database at this scale.
* **Anthropic**: pay per token. Each page sends 3 images (a 2400 px page is roughly 5–6 thousand input tokens each) plus the instructions, and returns a JSON table of about 13 rows. **Do not estimate from this text — measure:** the usage log lists exact *tokens in / out* for every page and which model was used, so cost per page = tokens_in × input price + tokens_out × output price from the current price list at https://www.anthropic.com/pricing. Multiply by pages per customer per month to set your price or page quotas. “Faster” (Sonnet) is cheaper than “Best accuracy” (Opus): `MODEL_BEST` / `MODEL_FAST` are settings in `wrangler.toml` if you want to change them.
* Set a spending limit in the Anthropic console, and use the per-code page quota to cap any single customer.
