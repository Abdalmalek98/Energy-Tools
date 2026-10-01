# Acceptance checklist: fresh Windows 11 VM

Automated tests cover the logic on Linux; these steps confirm the Windows-only parts (DPAPI, registry hardware ids, installer, SmartScreen). Use the **release** artifact from GitHub Actions (`windows-release`), not a PREVIEW one.

1. [ ] Run **Lighting Survey Reader Setup.exe** as a *standard* user: no administrator prompt. Note the SmartScreen dialog if unsigned (More info → Run anyway). Also try the portable **Lighting Survey Reader.exe**.
2. [ ] The activation screen shows your contact line, **Contact Support**, and a **Machine ID** (`MID1.…`) with **Copy**.
3. [ ] Wrong text → "not a valid activation code". A code with one character changed → "damaged or altered". An expired code → "License expired. Please enter a valid activation code." A 1-computer code already active on another PC → "already active on 1 computer".
4. [ ] Create an **offline code** for this PC (`scripts/offline-license.sh … --machine-id <copied id> --days 365` in Git Bash). **Turn the network off**, paste it → **Activate** works; Settings → License shows id, customer, expiry, days remaining, status, machine.
5. [ ] Network on: add a **5-page PDF** (try an Arabic file name) → pages upright; **Read pages**; review (highlights, edit, dittos); **Export** opens in Excel with **no repair prompt**; *Add to existing workbook* appends; *Save project* and reopen.
6. [ ] In the License Manager **suspend/revoke** the licence: pressing **Read pages** locks the app immediately; otherwise **Check License** or ≤ 30 min. Restart with the network off: still locked. **Reinstate**, activate again: works.
7. [ ] Online licence: activate, disconnect the network for longer than the licence's grace period (set a short one with *Grace period*): warning bar first, then "connect to the internet".
8. [ ] **Deactivate** (confirm dialog) → activation screen; the slot is free in the Manager.
9. [ ] `%APPDATA%\LightingSurveyReader` has `license.dat` (binary, DPAPI-encrypted: it must not contain your customer name in clear text) and `settings.json`. Copy `license.dat` to another PC/user: the app there asks for a code.
10. [ ] Change the PC clock back by a month: an expired licence stays expired.
11. [ ] Publish a newer tag: the installed app downloads it and installs when closed.
