# XLSX import performance (Stage 8)

Measured 2026-11-12 on the build machine (Linux VM, Node v24.22.1, 1.5 shared CPUs).
Fixtures are census-shaped .xlsx files built with the app's own `buildXlsx`
(participantKey, dopt, paAmbMinor, salary_2020, dob, dote). Times are the
median of 3 runs after a warm-up. `parse+map` is `parseXlsx` plus
`mapImportedRow` over the rows — the §21 Import threshold. `Full import`
adds `rowsToCasePackage` (package build) and is context only.

| Rows | Fixture bytes | Parse+map (ms) | §21 threshold (ms) | Verdict | Full import (ms) |
|---:|---:|---:|---:|:---:|---:|
| 1000 | 398828 | 58.6 | 150 | PASS | 68.1 |
| 10000 | 3998844 | 509.1 | 1500 | PASS | 543.3 |

## Browser (Chromium headless, file://)

Same fixtures, timed in-page with `performance.now()` around `parseXlsx` + `mapImportedRow`.

| Rows | Fixture bytes | Parse+map (ms) | §21 threshold (ms) | Verdict |
|---:|---:|---:|---:|:---:|
| 1000 | 398828 | 64.1 | 150 | PASS |
| 10000 | 3998844 | 492.9 | 1500 | PASS |
