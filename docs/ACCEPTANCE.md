# Acceptance checklist — fresh Windows 11 VM

Automated tests cover the logic on Linux; these steps confirm it on Windows. Use the installer built by GitHub Actions (or `npm run dist`).

1. [ ] Install `LightingSurveyReader-Setup-x.y.z.exe` **as a standard user** (no admin prompt). Note the SmartScreen dialog if unsigned.
2. [ ] Start the app: activation screen shows your contact line.
3. [ ] Enter a **wrong code** → “not valid”. Enter an **expired** code → “expired”. Enter a code limited to 1 PC that is already on another PC → “already active on 1 PC”.
4. [ ] Enter a valid code → Home shows customer, days left, pages left.
5. [ ] Add a **5-page PDF** (try one with Arabic characters in its name) → pages appear upright; ↺ ↻ work.
6. [ ] **Read pages** → all 5 read; review screen shows highlighted cells; edit a value, dittos follow.
7. [ ] **Export → New workbook** → opens in **Excel with no repair prompt**; looks like the template; Summary and Review Flags sheets present; *Add to existing workbook* appends after the last row.
8. [ ] **Save project**, close, reopen the `.lsr`: nothing needs re-reading.
9. [ ] In the admin page **lock** the code → in the running app press *Read pages* → lock screen appears immediately; otherwise wait ≤ 30 minutes → lock screen. Restart the app offline → still locked.
10. [ ] **Unlock**, enter the code again → works. **Settings → Deactivate this PC** → activation screen; the slot is free.
11. [ ] Disconnect the network: app keeps working; reading pages shows a network message, not a crash.
12. [ ] Check `%APPDATA%\LightingSurveyReader` contains `license.bin` (encrypted) and `settings.json`.
13. [ ] Publish a newer tag → after launch the installed app downloads it and installs when closed.
