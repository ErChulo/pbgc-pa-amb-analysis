# Stage 7 — Robustness verification (02-robustness)

**Project:** PBGC PA_AMB Analysis System
**Date:** 2026-11-12
**Verifier:** Robustness verifier, Stage 7 (verify only — no source file edited)
**Governing spec:** `MASTER_PROMPT.md` §20 (Verification and testing), §12 (missing data);
Stage 1 `stage1/03-reconciliation-statistical-methodology.md` §2.3 (zero/near-zero
denominators), §4.2 (blanks are missing, never zero); Stage 2
`stage2/03-validation-catalog.md` (66 rules).
**System under test:** `pa-amb-analysis.html` (401,313 bytes, single file, 0 fetch);
engine `src/` (804 Node tests passing at baseline, see §1).
**Synthetic data only.** Every participant key starts with `SYN-`. No live case data.

## 0. Verdict

**NOT ROBUST — do not release on robustness grounds.**

42 of 51 cases passed (Node 38/42, browser 4/9). No crash was observed anywhere
and no made-up exact number was produced — the missing-data discipline, the
denominator flags, the leap-day refusal, and the boundary handling are all
sound. But the system **fails the task's core bar ("never silently accept") in
two engine paths**, the app **cannot import a real file at all**, and a
**re-import leaves the wizard in an inconsistent state**. Four defects (D1–D4
below), two of them high severity. All four are reproducible from the
harnesses in this directory.

| Harness | File | Command | Result |
|---|---|---|---|
| Node engine probes | `stage7/robustness-node.mjs` | `node stage7/robustness-node.mjs` | **38/42 pass** |
| Browser probes | `stage7/robustness-browser.mjs` | `node stage7/robustness-browser.mjs` | **4/9 pass** |
| Shared fixtures | `stage7/fixtures.mjs` | (imported by both harnesses) | — |

## 1. Baseline and method

- Baseline first: `npm test` (tsc + `node --test dist/test/*.test.js`) →
  **804 tests, 804 pass, 0 fail** (2026-11-12). The engine's own suite is green;
  the defects below are all in behavior that suite does not cover.
- Node probes call the compiled engine (`dist/src/*.js`, rebuilt by that
  `npm test` run) through `validateParticipant`, `validateCasePackage`,
  `calculateAccruedBenefit`, `computeDiscrepancy`/`discrepancyFromAmounts`,
  `selectProvisionsByDate`, and `src/dates.ts`. Fixture builders are copied
  from `test/demo.test.ts` (the canonical Node driver for the Harborview demo
  case, case `00098765`, six `SYN-` participants).
- Browser probes drive the real app in Chromium 158 via Playwright 1.65.0
  from `stage3/live-test/`, `file://` only, using the same driver pattern as
  `test/ui-playwright/wizard-flow.test.mjs` (`window.PaAmbApp` +
  `window.__paAmbHandle`, DOM clicks for import, `page.reload()` for
  close/reopen). Zero page errors in every run.
- **Scope limit found during verification:** the app has **no file-import
  surface** (defect D3). Every malformed-file and import-interaction case
  that needs a real file could therefore only be verified at the engine layer
  (via the `FileContextInput` flags and `badDates`/`badNumbers` arrays the
  caller supplies). There is no code path from a real file to those inputs.

## 2. Defects

### D1 — HIGH: impossible calendar dates in date fields are silently accepted

**Cases:** Node A02, A03, A17 (FAIL); browser D04a, D04b (FAIL). Same defect,
confirmed in both harnesses.

**Expected:** a date field holding `2020-02-30`, `2021-02-29`, or `2020-13-01`
is rejected or quarantined with a clear finding (S-07 per the catalog:
"Date unparseable or ambiguous"). Never silently accepted.

**Actual:**
- Node A02 (`dob = "2020-02-30"`): `S-07=pass, P-02=pass`, no rule not-run,
  no finding anywhere.
- Node A03 (`dob = "2021-02-29"`): `S-07=pass, P-02=pass`.
- Node A17 (`dob = "2020-13-01"`): `S-07=pass, P-02=pass`, no rule not-run.
- Browser D04a/D04b (same mutations through the in-page engine): identical
  `S-07=pass, P-02=pass`. Worse, the impossible date then corrupts downstream
  reasoning: D04a also trips `P-03` and `P-04` (the string `"2020-02-30"`
  lexicographically sorts after DOH `2000-01-01`, so the engine reports a
  spurious "DOH before DOB" finding) — the root cause, "this is not a calendar
  date", is never named.

**Root cause (read, not guessed):** `ruleS07` (`src/validation.ts:911-926`)
only maps over `p.badDates` — it never inspects the date fields themselves.
`ruleP02` and the other chronological rules compare date strings
lexicographically and never call `validateDateString` (`src/dates.ts`
already throws correctly on all three strings; nothing calls it on input).
S-07 is a *reporter* rule, not a *detector*: it can only fire if the
(nonexistent — see D3) importer pre-screens dates and populates `badDates`.

**Reproduction (Node):**
```
node stage7/robustness-node.mjs   # cases A02, A03, A17 FAIL
```
or inline: `validateParticipant({...valid SYN-001 participant, dob: "2020-02-30"}, ctx)`
→ every date rule passes.

**Proposed fix:** at the top of `validateParticipant` (or inside `ruleS07`),
run `validateDateString` over every populated date field (`dob`, `doh`,
`dote`, `dop`, `dor`, `nrd`, `rbd`, `dateOfDeath`, `measurementDate`,
`calcMeasurementDate`, `establishedMeasurementDate`, spouse/beneficiary/AP
dates) and emit an S-07 `fail` finding naming the field and raw value for each
one that throws. Do not rely on the caller to populate `badDates`; keep
`badDates` as the importer's channel for *ambiguous* (parseable-but-unclear)
dates, and make the engine itself the detector for *impossible* dates.

### D2 — HIGH: wrong-typed NUMBER values are silently accepted

**Cases:** Node A14 (FAIL); browser D04c (FAIL). Same defect, both harnesses.

**Expected:** `paAmb = "150000"` (a string in a `MoneyMinor` number field) is
rejected or quarantined with a clear finding (S-08: "Non-numeric text or wrong
sign/scale in a NUMBER field"). Never silently accepted, never coerced.

**Actual:**
- Node A14: `S-08=pass, S-02=pass`; the only trace is `C-02=not-run`.
  The C-02 not-run finding reads (verbatim): `"Rule evaluation threw: Money
  must be integer minor units; got 150000"` / `"Not run: rule evaluation
  threw (...) — input-contract violation, not a data finding."`, severity
  `Info`. `X-06` (PA arithmetic check) **passes** — it compares the string
  against the numeric check value without noticing the type.
- Browser D04c: identical — `S-08=pass, S-02=pass, C-02=not-run`,
  `fails=P-07` (the pre-existing baseline SANB finding, unrelated).

**Root cause (read, not guessed):** `ruleS08` (`src/validation.ts:928-942`)
only maps over `p.badNumbers` — it never type-checks the numeric fields.
`formatMoneyMinor` throws on a non-integer, but `validateParticipant`
(`src/validation.ts:3167-3210`) catches per-rule throws and downgrades them to
`not-run`/`Info`, so the type violation surfaces only as an unrelated rule
quietly not running. No rule anywhere names the wrong type.

**Reproduction (Node):**
```
node stage7/robustness-node.mjs   # case A14 FAILS
```
or inline: `validateParticipant({...valid SYN-001 participant, paAmb: "150000"}, ctx)`
→ S-08 passes, X-06 passes, C-02 goes not-run.

**Proposed fix:** add a structural type gate to S-08 (or a new S-rule) that
checks `typeof` / integer-ness of every numeric field (`paAmb`, `paAcomp`,
`cuComp`, `pia`, `cs`/`vs`/`es`/`cspa`/`vspa`/`espa`, `salaryByYear[].amount`,
`xrdMbTerm`, `spc*`, `mths*`) and emits an S-08 `fail` naming the field, the
received type, and the raw value. Separately, `validateParticipant`'s
throw-catcher should not be the only place a type violation is visible: a
rule that throws on an input-contract violation should produce at least an
`Error`-severity finding on the offending field, not a silent `Info` not-run
on an unrelated rule.

### D3 — HIGH (scope): the app has no file-import surface at all

**Case:** browser D05 (FAIL).

**Expected (MASTER_PROMPT §6):** the app supports at least CSV, XLSX/XLSM,
and structured JSON import. The task's malformed-input cases (unclosed
quotes, wrong column count, truncated/corrupt XLSX) and interaction cases
(cancel mid-import, corrected-version re-import with a revision log) are to be
verified through the browser.

**Actual:** `document.querySelectorAll('input[type="file"]')` → **0**;
`textarea` → **0**. The Import panel contains exactly one button
(`Help: Import`) and the text "Load the case file. Imported values stay as
imported; nothing is changed." The only way to load a case is the
`#demo-button` ("Try demo case"). Grep of `src/` confirms it: no `FileReader`,
no `readAsText`/`readAsArrayBuffer`, no CSV/XLSX/JSON parser anywhere in the
app (only `src/ui/demo.ts`'s built-in demo package and
`import-case-package` in `src/ui/state.ts`).

**Consequence:** the following task items are **not testable through the UI
at all** and were verified only at the engine layer, where the caller
hand-supplies the flags a real importer would have to produce:
- bad CSV (unclosed quotes → S-02, verified Node A15 PASS via `parseError`;
  wrong column count → S-03, verified Node A16 PASS via `unknownFields`;
  non-numeric amounts / wrong types → D2, see above);
- truncated/corrupt XLSX → S-01/S-11 quarantine, verified Node A09/A10/A11
  PASS via `FileContextInput` — but no code path exists from a real file to
  those flags;
- cancel mid-import, corrected-version re-import with revision-log
  preservation — **not testable, no verdict possible** (the revision
  mechanism itself exists in the model: `makeRevisionRecord` /
  `applyCorrection`, `src/model.ts:297-352` — it is simply unreachable from
  the UI).

**Reproduction:** open `pa-amb-analysis.html`, inspect the Import step;
`node stage7/robustness-browser.mjs` → D05 FAILS.

**Proposed fix:** implement the import layer (Stage 6 scope gap): CSV and JSON
parsers plus an XLSX reader that run under `file://` with 0 fetch, map rows
into `ValidationParticipant`/`CasePackage`, populate `badDates`/`badNumbers`
for unparseable cells (which is what makes S-07/S-08 fire — see D1/D2),
populate `FileContextInput` (openable/truncated/hash/macroRan) from the real
file, and record every import as a revision event so a corrected re-import
preserves the old basis. Until then, record the gap explicitly in the release
notes: the app cannot ingest a real case file.

### D4 — MEDIUM: re-import does not reset wizard completion flags

**Case:** browser D02 (FAIL).

**Expected:** re-importing a case clears the old validation (and downstream
results) *and* the wizard returns to "Validate the case first" — a new run
uses the new basis, and no step is shown complete whose output is not in state.
The wizard's own documented invariant (`src/ui/wizard.ts` header):
"completion means the engine call for that step ran and its output is stored
in state."

**Actual:** after demo import → validate → demo re-import:
`validation=null` (cleared, good), `calculations=0` (cleared, good),
`participantCount=6` (good) — but `wizard.completed.validate` stays `true`,
and the **Calculate button is enabled** (`disabled=false`, title
`"Calculate"`) with no validation result in state. `stepLock`
(`src/ui/wizard.ts:155-163`) keys only off `completed[prev]`, and
`completeStep` only ever sets a flag true, never clears one.

**Root cause (read, not guessed):** the `import-case-package` handler
(`src/ui/state.ts`, ~line 356) resets `validation`, `calculations`,
`reconciliations`, `statistics`, `statisticsOutliers`, `lastContribution`
to null/empty but only calls `completeStep(..., "import")` — it never resets
`completed.validate/calculate/reconcile/statistics/decide/export`.

**Reproduction:** `node stage7/robustness-browser.mjs` → D02 FAILS with the
exact state quoted above.

**Proposed fix:** in the `import-case-package` handler, reset the wizard
progress to fresh (`createInitialWizardProgress()` then mark import complete),
or derive each step's lock from whether its output is actually stored in
state (validation non-null, calculations present, …) instead of from the
`completed` flags. Add a regression test: validate → re-import → Calculate
button must be disabled with reason "Validate the case first."

## 3. Per-case verdicts

### 3.1 Node engine probes — 38/42 pass

| ID | Case | Verdict | What happened |
|---|---|---|---|
| A01 | `badDates` month 13 | PASS | S-07 fail: `dob: unparseable or ambiguous date "2020-13-01" — quarantined, never guessed.` |
| A02 | `dob` = 2020-02-30 in field | **FAIL (D1)** | S-07=pass, P-02=pass; silently accepted |
| A03 | `dob` = 2021-02-29 in field | **FAIL (D1)** | S-07=pass, P-02=pass; never rolled to Mar 1, never flagged |
| A04 | `cs` = "abc" (+ badNumbers) | PASS | S-08 fail (P-06 not-run: the rule threw on the bad value and was caught — see note below) |
| A05 | negative service −5 | PASS | P-06 fail: `CS × 12 = -60 months, outside [0, 999].` |
| A06 | negative compensation | PASS | S-08 fail: `salary: negative compensation (raw "-5000.00").` |
| A07 | zero comp, positive PA_AMB | PASS | Flagged (P-07 fail; X-04 not-applicable by design — no case-set ratio range) |
| A08 | duplicate participant keys | PASS | Population S-05 fail, P-01 fail; both records quarantined (54 rules not-run each); 2 results, no double-count |
| A09 | truncated file | PASS | S-01 fail; every participant rule not-run; nothing loaded |
| A10 | unopenable file | PASS | S-01 fail; every participant rule not-run |
| A11 | XLSM macro ran / hash changed | PASS | S-11 fail; every participant rule not-run |
| A12 | DOTE before DOH | PASS | P-03 fail (BCV-217); P-04 not-applicable (conflict C-1) |
| A13 | non-numeric case number | PASS | S-06 fail: `CASE length 6, expected 8.` (length rule catches this instance; a same-length alpha case number was not probed) |
| A14 | `paAmb` string "150000" | **FAIL (D2)** | S-08=pass, S-02=pass, X-06 pass; C-02 not-run (throw swallowed) |
| A15 | row parse error (unclosed quote) | PASS | S-02 fail: `Row parse failure: unclosed quote at row 3` |
| A16 | unknown field name | PASS | File S-03 fail |
| A17 | `dob` = 2020-13-01 in field | **FAIL (D1)** | S-07=pass, P-02=pass, no not-run; invisible |
| B01 | blank PA_AMB | PASS | P-13 fail; `computeDiscrepancy` comparable=false, reason `recorded-missing`; recorded stays null |
| B02 | blank DOTE (SYN-I-01) | PASS | M-02 fail, M-05 fail, P-04/P-13 fail; pipeline indeterminate `unresolved-comparison-basis`. (M-01 correctly does not apply: its predicate is PA_AMB-populated-but-DOTE-blank, `validation.ts:2409`.) |
| B03 | blank service | PASS | Pipeline indeterminate, reason `missing-input`; never exact |
| B04 | blank compensation | PASS | Pipeline indeterminate, reason `missing-input`; never exact |
| B05 | blank/unknown vesting, non-vested | PASS | X-09 fail: `PA_AMB > 0 for a nonvested participant with unknown vesting treatment.` |
| B06 | blank annuity form | PASS | X-10 fail: `Annuity form of PA_AMB unknown.` |
| B07 | blank measurement date | PASS | Pipeline indeterminate `unresolved-comparison-basis` |
| B08 | participant with only an ID | PASS | No throw; 66 rules evaluated, 15 fail; pipeline indeterminate; no exact amount |
| B09 | entirely empty file | PASS | No throw; 0 participant results; summary `{rulesEvaluated: 9, pass: 7, fail: 0, notApplicable: 2, notRun: 0}` |
| B10 | blank PA_AMB through reconciliation builder | PASS | `inputs.recorded=null`; `refuseZeroFill` refuses a blank, accepts a genuine recorded zero |
| C01 | B̂ = 0 | PASS | R undefined, flag `R_UNDEFINED_ZERO_DENOMINATOR`, Δ = 50000 minor |
| C02 | B̂ = $0.50 < ε_R | PASS | R undefined, flag `R_UNSTABLE_SMALL_DENOMINATOR`, Δ/D reported |
| C03 | B̂ exactly = ε_R ($1.00) | PASS | R defined (value 1499), flag null — boundary inclusive |
| C04 | B̂ = $0.99 (ε_R − 1 minor) | PASS | R undefined, flag `R_UNSTABLE_SMALL_DENOMINATOR` |
| C05 | recorded 0, B̂ > 0 | PASS | R = −1, flag `PA_ZERO`, Δ = −150000 |
| C06 | both amounts zero | PASS | Δ = D = 0, R undefined |
| C07 | leap-day dates | PASS | `validateDateString("2021-02-29")` throws; `("2020-02-29")` ok; `ageAt("2000-02-29","2023-02-28",null)` throws (refuses, never guesses); feb-28 → 23, mar-01 → 22, leap-year age 24; `daysBetween(2020-02-28, 2020-03-01)` = 2 |
| C08 | plan-version boundary | PASS | 2000-01-01 → new version; 1999-12-31 → old version; 1980-01-01 → null (never nearest) |
| C09 | freeze boundary | PASS | Measurement == freeze date: exact, no `freeze` step; measurement > freeze: `freeze` step present, benefit frozen at $1,500.00 |
| C10 | DOTE == DOPT | PASS | P-04 not-applicable: `Conflict C-1 unresolved (BCV-224 vs BCV-225).` — flagged, never silently resolved |
| C11 | NRD == DOTE | PASS | P-08 pass — no spurious failure for terminating at NRD |
| C12 | single-day service (DOH == DOTE) | PASS | `completedYMD` 0y/0m/0d; pipeline exact $0.00 from stated service 0 |
| C13 | 100-year service | PASS | cs=100 with 100 elapsed years → P-15 pass; cs=101 → P-15 fail |
| C14 | §415 boundary | PASS | Service 100 → $7,500.00 exact at limit; service 101 → capped to $7,500.00 |
| C15 | §401(a)(17) boundary | PASS | Per-year cap, then average: cap 62400 → $1,500.00 unchanged; cap 62399 → $1,499.99 (only 2019 capped; mean 59999.67) |

Notes on passed cases with something worth recording:
- **A04:** S-08 fails, but P-06 goes `not-run` — the rule threw on the
  non-numeric service value and `validateParticipant`'s per-rule catcher
  downgraded it. The finding exists (S-08), so the case passes, but it is the
  same swallow mechanism as D2; a P-06 finding would be more informative.
- **A07:** the flag that fires is P-07 (SANB blank), which also fires on the
  unmutated baseline participant — it is not a zero-compensation finding.
  X-04 is `not-applicable` by design until the case actuary sets a plausible
  ratio range. Zero monthly compensation with a positive benefit therefore has
  no *dedicated* finding; it passes only because something (unrelated) fails.
  Worth a follow-up rule, not counted as a defect here.
- **A13:** S-06 catches the tested value on *length* (6 vs 8), not on
  numeric-ness. An 8-character alphabetic case number was not probed; the
  catalog text for S-06 ("blank, wrong length, or inconsistent") does not
  mention a numeric check, so this is a catalog gap to confirm, not a
  demonstrated failure.
- **C09/C12/C14/C15 (harness corrections, recorded honestly):** the first
  versions of these cases failed because of my own probe errors, not engine
  errors — C09 matched the substring "freeze" in a Stage 3 ruleRef; C12/C14
  varied `formulaCall.params.service`, which Stage 5 overwrites with the Stage
  3 service measures (`injectStageMeasures`, `pipeline.ts`); C15 assumed the
  §401(a)(17) cap applies to the average, while the engine correctly caps
  each salary year and then averages. All four were corrected to the real
  levers (`serviceOverride`, step-name matching, per-year cap) and now pass
  with the exact numbers above. The engine was right in all four; the
  corrections are documented in the harness comments.

### 3.2 Browser probes — 4/9 pass

| ID | Case | Verdict | What happened |
|---|---|---|---|
| D01 | Import same file twice | PASS | 6 participants, 6 unique keys after both imports; status `Case case-demo \| 6 participants \| snapshot demo-synthetic-no-file \| step import`; no duplicates, no double-counting |
| D02 | Re-import after validate | **FAIL (D4)** | Validation cleared (null) and calculations cleared (0), but `wizard.validate` stays `true` and the **Calculate button is enabled** (`disabled=false`, title `"Calculate"`) with no validation in state |
| D03 | Reload mid-wizard | PASS | Clean reboot, 0 participants, step import, 0 page errors, no stale state. Status line reads `Case no-case-loaded \| 0 participants \| snapshot no-case-loaded \| step import`. (State is in-memory only — see §4 observation.) |
| D04a | In-page dob 2020-02-30 | **FAIL (D1)** | S-07=pass, P-02=pass; spurious P-03/P-04 findings instead |
| D04b | In-page dob 2020-13-01 | **FAIL (D1)** | S-07=pass, P-02=pass |
| D04c | In-page string paAmb | **FAIL (D2)** | S-08=pass, S-02=pass, C-02=not-run; X-06 pass |
| D04d | In-page blank PA_AMB | PASS | P-13 fail |
| D04e | In-page negative service | PASS | P-06 fail |
| D05 | File-import surface exists | **FAIL (D3)** | 0 file inputs, 0 textareas; Import panel has only a Help button |

### 3.3 Not testable (blocked by D3)

- Cancel mid-import: no import UI exists; nothing to cancel. No verdict.
- Import a file, then a corrected version (old basis preserved in the revision
  log, new run uses the new basis): no import UI exists; the revision
  mechanism (`makeRevisionRecord`/`applyCorrection`) exists in the model but is
  unreachable from the UI. No verdict. (Partial evidence: D02 shows a
  re-import of the *demo* package does clear downstream results — but leaves
  the wizard flags stale, D4.)
- Truncated/corrupt XLSX *through the browser*: no verdict through the UI;
  engine-level quarantine verified (Node A09/A10/A11 PASS).

## 4. What is sound (for the record)

- **No crash anywhere.** 51 cases, zero uncaught throws, zero page errors.
  `validateParticipant`'s per-rule try/catch held in every adversarial case.
- **No silent zero-fill, no made-up exact numbers.** Blanks stay `null`
  through validation, pipeline, and reconciliation (B01, B08, B10); missing
  service/compensation go indeterminate with a named reason (B03, B04);
  `refuseZeroFill` refuses blanks and accepts genuine recorded zeros (B10).
- **Denominator discipline** is exactly per Stage 1 §2.3, including both
  boundaries (C01–C06).
- **Leap-day refusal** is exactly per Stage 3 rule D-1.5 (C07).
- **Temporal boundaries** are correct: version selection is inclusive of the
  effective date and refuses pre-first-version gaps (C08); the freeze applies
  only strictly after the freeze date (C09); DOTE==DOPT surfaces the known
  C-1 conflict instead of resolving it (C10); NRD==DOTE is not a spurious
  failure (C11); §415 is a strict `>` cap (C14); §401(a)(17) caps per year
  before averaging (C15).
- **File quarantine** at the engine layer is correct (A09–A11) and duplicate
  keys quarantine both records without double-counting (A08).
- **Double import** does not duplicate participants (D01); **reload**
  mid-wizard reboots cleanly with no corruption (D03).

**Observation (not a defect):** case state lives only in memory — only the
theme persists to `localStorage`. Reloading mid-wizard loses all work with no
warning and no recovery. That is consistent with the current design (no
persistence is specified for the demo-stage app), but a real caseworker
mid-case would lose the whole case on an accidental reload; persistence or an
explicit "unsaved work" warning belongs on the Stage 8 list.

## 5. Overall robustness verdict

**NOT ROBUST.** The engine's calculation core, missing-data framework, and
boundary handling are in good shape, and the app never crashes — but:

1. Two silent-acceptance holes (D1 impossible dates, D2 wrong types) mean
   malformed data can flow through validation with no finding naming the
   problem. Both share one root cause: S-07/S-08 are reporters for the
   importer's `badDates`/`badNumbers`, and no detector exists anywhere in the
   delivered system.
2. The app cannot import a real file (D3), so the import-dependent half of
   this verification could not be exercised through the UI at all.
3. Re-import leaves the wizard claiming a step is complete whose output was
   just discarded (D4), and unlocks the next step on nothing.

**Recommended order of fixes:** D1 + D2 together (one validation hardening
pass: detect impossible dates and wrong types in the engine itself); D4
(reset wizard progress on import); D3 (build the import layer, which is also
what makes S-07/S-08 fire from real files). Re-run
`stage7/robustness-node.mjs` and `stage7/robustness-browser.mjs` after the
fixes; all 51 cases should pass before release.

## 6. Files and reproduction

- `stage7/robustness-node.mjs` — 42 Node cases (A01–A17, B01–B10, C01–C15).
- `stage7/robustness-browser.mjs` — 9 browser cases (D01–D05, D04a–D04e).
- `stage7/fixtures.mjs` — shared fixture builders (copied from
  `test/demo.test.ts`).
- `stage7/02-robustness.md` — this report.
- Commands (from `~/workspace/pbgc-pa-amb-analysis`):
  - `npm test` → 804 pass, 0 fail (baseline, before verification).
  - `node stage7/robustness-node.mjs` → 38/42 pass; failing: A02, A03, A14, A17.
  - `node stage7/robustness-browser.mjs` → 4/9 pass; failing: D05, D02, D04a, D04b, D04c.
- No existing source file was edited. No push, no Drive write, no upload.
