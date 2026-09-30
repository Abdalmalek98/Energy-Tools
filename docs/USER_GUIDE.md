# Lighting Survey Reader — quick guide

Turns photographed or scanned lighting-survey sheets into your Excel template.

## 1. Install (once)
Run **LightingSurveyReader-Setup-x.y.z.exe**. It installs just for you (no administrator rights). Or unzip the *portable* zip anywhere and start **Lighting Survey Reader.exe**.

> **Windows may show “Windows protected your PC” (SmartScreen).** This happens for new programs that are not yet signed with a paid publisher certificate. Click **More info → Run anyway**. Only do this for a file you received directly from your supplier.

## 2. Activate (once)
Type the activation code you were given (`XXXXX-XXXXX-XXXXX-XXXXX`) and press **Activate**. The app needs internet for this.
![Activation](screenshots/01-activation.png)
The app then works until the code ends or your supplier locks it. It re-checks the licence when you open it and every 30 minutes; without internet it keeps working for a few days.

## 3. Read a survey
1. **New project** → **Add files…** (or drag PDFs / photos onto the window). Arabic file names are fine. Sideways scans are turned upright automatically; use ↺ ↻ if a page is still wrong.
2. Check the **Building name** (it goes in column E). Choose **Best accuracy** (slower) or **Faster**. An optional note such as “Primary school, Arabic room names” helps the reader.
3. Press **Read pages**. You can **Stop** at any time; a page that fails has its own **Try again**.
![Project](screenshots/03-project.png)

## 4. Review
Every page is shown beside its table. Colours:
| Colour | Meaning |
|---|---|
| **Yellow** | Please check: the reader was unsure, or it **estimated** an unreadable value (hover for the reason) |
| **Light blue** | Blank on the sheet, copied from the row above |
| **Grey** | Copied from a ditto mark |

Click any cell to correct it; change a value and every ditto below it follows. Type `/` in a cell to make it a ditto again. Click a line in **cells to check** to jump to it. **Rows with flags only** hides the rest. Keys: ↑ ↓ / Enter move between rows, **Alt + ← →** change page.
![Review](screenshots/04-review.png)

## 5. Export and save
**Export** → **New workbook** (your template layout + *Summary* and *Review Flags* sheets), or **Add to an existing workbook** to append under the last filled row of your master file (saved as “… (updated).xlsx”; the original is untouched; keep a backup of masters with charts or pivot tables). **Save project** lets you stop a long job and continue later.
![Export](screenshots/05-export.png)

## If the app locks
![Locked](screenshots/06-locked.png)
The screen tells you why: **locked** or **expired** (contact your supplier), **already active on N PCs** (use *Settings → Deactivate this PC* on the old PC first), or **connect to the internet** (the offline period ended). Your exported Excel files are never affected. **Moving to a new PC:** Settings → *Deactivate this PC*, then activate on the new one.

Support: the contact line shown on the activation screen.
