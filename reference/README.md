# reference/

Place here (not yet committed — missing at Phase 1):

- `lighting-survey-reader.html`          (browser prototype: prompt, norm(), ditto logic, Excel writer)
- `MOH-JZ - Lightings - Raeds team.xlsx` (template, sheet "Lighting Survey Template")
- `AL RAITH GENERAL HOSPITAL - lighting survey.xlsx` + `Al Raith general hospital.pdf` (golden pair)
- other scan PDFs used for the Phase 5 accuracy run

## Received so far
`reference/samples/` — 5 scan PDFs (A4 portrait, one embedded ~2000×3000 px photo per page, form sideways → rotate 90° CCW):
Al-Fatiha Center (3 pp), Al-Haqou Center (5), Al-Jahu PHC (5), Almalha Health Centre (5), Darb Vaccination Centre (3).
No ground-truth workbooks for these yet, so the Phase 5 accuracy run needs the matching answer rows.

## Template workbook (received)
`MOH-JZ - Lightings - Raeds team.xlsx`: sheets `Lighting Survey Template` (A1:AD2640, freeze A2, 13 validation groups, merges in rows 1–2) and empty `Sheet1`.
It also contains 552 already-filled rows = ground truth for the samples (Excel rows, column E):
| Sample PDF | Rows |
|---|---|
| Al-Fatiha | 3–41 (AL FATHIA HEALTH CENTER) |
| Darb Vaccination | 167–203 (AL DARB VACCINATION CENTER) |
| Almalha | 204–257 (ALMALHA PRIMARY CLINIC) |
| Al-Haqou | 381–438 (ALHAQOU HEALTH) |
| Al-Jahu | 439–500 (AL JAHU PRIMARY HEALTH CARE) |
Other buildings in the file (no scans supplied): Vaccination, Moqzaa, Abu Sadad, Aldarb Health Care, Al Eadabi ×2.
