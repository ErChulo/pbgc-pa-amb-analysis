# Stage 7 fixes — verification report (Fixer pass, 2026-11-12)

Every defect proved by the five Stage 7 verification workers, fixed,
re-run, and proved fixed. Governing spec: MASTER_PROMPT §6, §12, §17,
§19, §20, §21. Synthetic data only; no live case data; no LLM in the
calculation path; no network/fetch/CDN/external packages in the app.

Rebuilt app: `pa-amb-analysis.html`, 452,219 bytes (was 417,680), build
gate passes, 0-fetch passes.

## Verdict

**All 17 defects fixed, except XLSX import (Stage 8 item, recorded
below — not silently dropped).** All verification re-runs pass.

## Re-run results (after the final rebuild)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test` | 847/847 pass, 0 fail, 210 suites (was 804; +43 new Stage 7 tests) |
| `test/ui-playwright/run.mjs` | 4/4 suites pass |
| `build/check-zero-fetch.mjs` | PASS |
| `stage7/01-static-compliance.mjs` | ALL PASS, 48/48 (was 46/48) |
| `stage7/02-playwright-compliance.mjs` | ALL PASS, 41 checks (was 37/41) |
| `stage7/robustness-node.mjs` | 42/42 (was 38/42) |
| `stage7/robustness-browser.mjs` | 9/9 (was 4/9) |
| `stage7/03-repro-node.mjs` | PASS, all artifacts byte-identical A/B/C |
| `stage7/03-repro-browser.mjs` | PASS, browser A == B == Node on every artifact; pinned-date run C matches A after normalizing the pin + actor |
| `stage7/03-repro-audit.mjs` | exit 0; exported audit log 23 events (was 7) |
| `stage7/03-repro-build-driver.mjs` | OK, driver regenerated identically |
| `stage7/03-repro-merge.mjs` | PASS |
| `stage7/03-repro-population.mjs` | PASS, 100-participant outputs byte-identical A/B/C |
| `stage7/03-repro-stats.mjs` | PASS, byte-identical A/B/C |
| `stage7/03-repro-sweep.mjs` | exit 0 |
| `stage7/04-accuracy-browser.mjs` | 44/44 (was 43/44; P5 now agrees with the Node oracle) |
| `stage7/run-buttons-check.mjs` | PASS (validate 405 rules / 145 findings; SYN-001 $1,500.00; SYN-003 Δ $1,000.00; decide recommends all six, approves none) |

## Defect-by-defect fixes

### Repro D1 (CRITICAL) — build corrupts the bundle
`build/bundle.mjs`: replacements now use functions `() => ...` (no
`$$` collapse). Added a build gate: the build fails if the inlined
bundle does not equal the esbuild output, or if the `$$` count in the
HTML differs from the bundle's. Proved by `03-repro-browser.mjs`:
browser A == B == Node on every artifact.

### Compliance D1 / Repro D2 (major) — audit log missing calculation events
`src/ui/state.ts`: `applyEvent` now appends audit events for step
completions (`calculation-run`: validation/calculation/reconciliation/
statistics/publication, with rule version / snapshot hash, participant
keys, and summaries naming rules evaluated, findings, amounts, Δ,
recommended disposition), `import` for imports, and
`transition-refused` for refused wizard navigation and
unknown-participant evidence recording. UI-only events (theme, view
mode, selection, successful navigation) are not audited. Exported
audit log went from 7 events (dispositions only) to 23 events for the
demo flow. Proved by `01-static-compliance` (48/48),
`02-playwright-compliance` L3b/L3d (41/41), `03-repro-audit` §A
(all steps AUDIT except evidence-recorded, which is UI-only input
to the proposal — the proposal itself is audited).

### Compliance D2 (major) — §19 warning missing on two exports
`src/ui/main.ts`: new `downloadAuditLogJson()` and gated
`downloadContributionJson()`, both on
`reviewerConfirmsSensitiveExport("participant-data")` like CSV/XLSX.
Proved by `01-static-compliance` S8e/S8f and
`02-playwright-compliance` L4f/L4g.

### Compliance D3 (minor) — T3 disposition mismatch
`src/decisions.ts` T3: after the entry-conditions re-check and G-IND-2
check, refuse (guard `entry-conditions`) when the determination's
`humanDetermination.disposition` or `recommendedDisposition.disposition`
differs from the disposition being approved. Proved by
`02-playwright-compliance` L5g/L5g2 and the new Node test in
`test/decisions.test.ts` (approve SYN-003 requires-investigation with
a verified determination → refused, guard `entry-conditions`).

### Robustness D1 (HIGH) — impossible calendar dates silently accepted
`src/validation.ts`: `ruleS07` now validates every populated date
field itself (DOB, DOD, DOH, DOTE, DOP, DOBF, DOR, POST_DOPT_DOTE,
NRD, RBD, MEASUREMENT_DATE, RECORDED_DATE, CALC_MEASUREMENT_DATE,
ESTABLISHED_MEASUREMENT_DATE, spouse/beneficiary/AP dates,
candidateMeasurementDates, prior dote/doh/dob) plus the importer's
`badDates`. `ruleP02` parses dates via `dateDays` (day-number
comparison against 1900-01-01 / DOPT); an impossible DOB produces no
P-02 finding (S-07 owns it). `ruleP03`/`ruleP04` got
`isCalendarDate` guards on all date comparisons. Proved by
`robustness-node` 42/42, `robustness-browser` 9/9, and new tests in
`test/stage7-fixes.test.ts` (2020-02-30, 2021-02-29, 2020-13-01 fail
S-07; valid leap day 2020-02-29 passes; 1899-12-31 still fails P-02).

### Robustness D2 (HIGH) — wrong-typed NUMBER values silently accepted
`src/validation.ts`: `ruleS08` now type-checks numeric fields
(MoneyMinor fields must be integer numbers; DecimalString fields must
match `/^-?\d+(\.\d+)?$/`; integer fields must be integers) plus the
importer's `badNumbers`. `ruleC02` returns a fail finding naming the
types instead of throwing inside `formatMoneyMinor`. The
`validateParticipant` throw-catcher now raises severity Info → Error
and blocks Exact-only. Proved by the robustness scripts and new
tests (string `paAmb` fails S-08 and C-02 as a finding; the record
still runs).

### Robustness D3 (HIGH, scope) — no file-import surface
New `src/ui/import.ts` (~800 lines, pure, no DOM): `parseCsv()`
(quoted fields, CRLF; throws naming the row on unclosed quote /
ragged row / empty file); `IMPORT_KNOWN_COLUMNS` (participantKey,
caseNumber, bcvRecId, ssn, firstName, lastName, dob, sex, doh, dote,
dop, nrd, retstat, cs, vs, es, paAmbMinor, dopt, `salary_YYYY`);
unknown columns → S-03 unmapped (retained in the package `unmapped`);
`mapImportedRow()` (bad dates → `badDates` + null; bad numbers →
`badNumbers` + null; never throws for a bad cell); `rowsToCasePackage()`
(mirrors the demo builders; duplicate keys quarantined with first row
kept; rows without participantKey quarantined, never keyed by row
number); `parseJsonImport()` (CasePackage shape, row array, or
`{rows}`); `noToleranceSetRecord()` (version 0: no tolerance is set,
the actuary must set one).
`src/ui/main.ts`: `importFileText()` (dispatch by extension; `.xlsx` /
`.xlsm` refused with the Stage 8 reason; anything else refused;
malformed files return the unchanged state + a plain reason, never
crash); `casePackageValidationParticipants()` +
`runValidateImportedStep()` (generic validation of any imported
package — no demo-specific inputs, tolerance `null`, DOPT from the
package); `runValidateStep` delegates to it for non-demo cases.
`src/ui/template.html`: file input `#import-file`
(`accept=".csv,.json"`), `#import-status`, calculation-date input,
Import help text. `bootApp` wires FileReader `readAsText` and the
date input. Decisions: CSV requires a `dopt` column (DOPT is a case
fact; no date is guessed); an imported package carries no plan
provisions and no case tolerance. Proved by `robustness-browser` 9/9
(D05 file-input existence), `robustness-node` 42/42, the accuracy
browser P0 file-picker check, and 14 new import tests.
**XLSX not implemented — outstanding Stage 8 item (see below).**

### Robustness D4 (MEDIUM) — re-import leaves the wizard inconsistent
`src/ui/state.ts`: the import branch resets the wizard to
`completeStep(createInitialWizardProgress(), "import")`, clearing all
completion flags and the validation. Proved by a new test (validate →
re-import → `wizard.completed.validate` false, `currentStep` import,
`validation` null).

### Accuracy D-ACC-1 — H15 "supported" with no citable rule
`src/ui/main.ts` `demoDecideEvidence` and `test/demo.test.ts`: demo
SYN-V-01 H15 demoted to `"plausible"` with `material: false` (option
(a) — never invent a rule). `material: false` is load-bearing:
`mapDisposition` §7 blocks Verified when a material hypothesis is
neither supported nor refuted, so `plausible` + `material: true`
would have flipped SYN-V-01 to requires-investigation. The $0.50 Δ
is within the $1.00 tolerance, so the rounding explanation is
immaterial to the disposition; Verified rests on tolerance alone.
The decisions-fixture H15 (`test/decisions.test.ts`, Synthetic Plan A
§7.3 nearest-dollar, documented) is untouched and stays `supported`.
Proved by new tests (H15 plausible + immaterial; SYN-V-01 still
Verified) and the accuracy browser (44/44).

### Accuracy G-ACC-2 — engine functions not exposed
`build/entry.ts`: `selectProvisionsByDate` (`src/compose`),
`evaluateFormulaCall` (`src/formulas`), `testCounterfactual`
(`src/pipeline`), `rankCounterfactuals` (`src/reconciliation`) are now
exported onto `window.PaAmbApp`. Used by the P5 driver (see G-ACC-4)
and the accuracy browser P2 note (direct `$1,498.75` refutation via
`evaluateFormulaCall` is still Node-only in the Harborview check —
the function is now exposed, the check text was not updated; no
behaviour change).

### Accuracy G-ACC-4 — browser vs Node recommendation divergence
**Root cause, determined (corrects the interim determination).** Two
distinct causes, and the first ran deeper than "the browser never ran
counterfactuals":
- (a) Service/averaging cohorts. Layer 1: the browser/UI reconcile
  path never ran counterfactuals, so the engine correctly returned
  requires-investigation given empty hypotheses. Fixed by wiring
  `counterfactualCandidates` into `runReconcileStep` and exposing the
  functions (G-ACC-2). Layer 2 (the deeper cause, found while fixing
  layer 1): even with counterfactuals, the engine could never reach
  correction-recommended for a planted service/averaging error.
  `testCounterfactual` labels an undocumented mechanism Plausible at
  best, and `validateCounterfactualSupport` (`src/reconciliation.ts`)
  only *kept* Supported — it never promoted on cohort resolution —
  while `recommendDisposition` (`src/reconcile.ts`) requires a
  Supported hypothesis. Worse, the counterfactual benefit IS the
  recorded amount (it is the value under the administrator's basis,
  by construction), so the existing correction branch (which reads
  the hypothesis benefit as the corrected value and requires it to
  differ from recorded) could never fire either. Fixes, both
  grounded in the methodology's own stated rules (03 §2.6, §2.7,
  §4.7 — nothing coined):
  - `validateCounterfactualSupport`: a Plausible counterfactual that
    reproduces the recorded amount exactly (residual zero) and
    resolves the discrepancy across the cohort is promoted to
    Supported ("the same operation resolves discrepancies across the
    cohort and no document contradicts it" — the reason string the
    function already used for the supported-preserving branch, and
    the same promotion the rounding diagnostic already makes in
    `evaluateRoundingHypothesis`). Documented mechanism alone does
    NOT promote (a mechanism documented as an available alternative
    is not a documented mechanism).
  - `recommendDisposition` (exact branch): a Supported hypothesis
    that reproduces the recorded amount exactly, resolves the
    cohort, and is UNDOCUMENTED now recommends correction-recommended
    with the corrected value being the independent reconstruction
    (new optional `reconstructedMinor` argument, passed from
    `reconcileParticipant` and `retestTolerance`). The undocumented
    requirement is load-bearing: the Harborview case (H2 +3 years,
    documented in Plan §3.2) still returns requires-investigation
    ("reconstruction must be re-run") — a documented exact match
    vindicates the recorded amount; an undocumented cohort-wide
    exact match identifies the administrator's basis as the error.
    A single participant's exact match without cohort resolution
    also still returns requires-investigation.
  - `stage7/04-accuracy-browser.mjs` P5 driver: two passes mirroring
    the Node oracle (`test/population.test.ts`) — pass 1 tests the
    same four counterfactuals per row through the exposed
    `App.testCounterfactual`; pass 2 computes cohort resolve rates
    (≥0.5) and reconciles each row with its counterfactuals as
    hypothesis candidates (documentedMechanism false; material only
    when the counterfactual moves the amount — the vesting-twice
    diagnostic on a VP=1.0 participant changes nothing, so it is a
    vacuous Coincidence, not an unresolved material item; rounding
    evidence supplied: sequence undocumented, max effect $0.50 —
    without it the rounding diagnostic is skipped and the
    cohort-resolution promotion never runs for H15).
  - Result: browser and Node now agree on every exact cohort —
    clean verified 400, service correction-recommended 150,
    averaging correction-recommended 150, rounding verified 100,
    vesting requires-investigation 100 (accuracy browser P5).
- (b) Bounds-inside cases. The oracle is a test-local simplification
  that ignores bound width; the engine applies the documented §4.7
  width-vs-materiality rule (`materialityMinor: 100`; SYN-002 width
  9900 minor > 100 → requires-investigation). The engine is
  authoritative; the oracle expectation was corrected in the accuracy
  script, not the engine. (P1 still asserts SYN-002/SYN-004 bounds →
  requires-investigation.)

### Accuracy G-ACC-5 (§20) — statistically ordinary but materially wrong
New test in `test/stage7-fixes.test.ts`: a +$220.00 error inside a
high-variance cohort is missed by the robust-z and Tukey screens
(flagged false on both) but caught by reconciliation (Δ 22000 minor
vs the $1.00 / 0.1% tolerance). Statistics' silence is never
clearance.

### Accuracy G-ACC-6 (§20 citations)
`test/reconcile.test.ts`: Stage 1 table A-101 ($1,240.00 vs
$1,238.50, +$1.50, R +0.12%), A-102 ($860.00 vs $860.00, $0.00),
A-103 ($2,150.00 vs $1,930.00, +$220.00, R +11.40%), A-104 ($0.00
vs $412.75, −$412.75, R −100%, flag PA_ZERO) reproduced by name
alongside A-105. `test/formulas.test.ts`: per-example DB Answer Book
question numbers for all 34 formula operations, copied from the §8
"Source citations" lines of `stage1/01-formula-classification.md`
(nothing coined; where Stage 1 cites a chapter rather than a
question, the chapter is recorded as written).

### Repro D3 (medium) — no fixed-calculation-date mode
`src/ui/state.ts`: `UiState.calculationDate: string | null` +
`set-calculation-date` AppEvent. `src/ui/main.ts`:
`calculationTimestamp(state)` (pinned date → `<date>T00:00:00.000Z`,
else wall clock); all `nowIso()` event timestamps inside `bootApp`
replaced with it; `nowIso()` remains only as the fallback inside
`calculationTimestamp`. `src/ui/template.html`: `#calculation-date`
date input (label: pinned calculation date for reproducible runs).
`test/ui-playwright/wizard-flow.test.mjs` propose/approve eventIds
are fixed strings (no `Date.now()`); `stage7/03-repro-build-driver.mjs`
R3/R4 now verify the fixed strings instead of replacing them.
`stage7/03-repro-browser.mjs` run C pins 2026-11-12 via the input
before the real clicks and asserts the run matches A after
normalizing the pin itself (calculationDate + one
set-calculation-date eventLog entry) and the actor (UI "user" vs
driver "demo"); audit-log.json A vs C is identical after removing
actor (23 events each). Proved by `03-repro-browser` PASS and new
tests (pinned timestamps; clearing the pin returns to the wall clock).

### Benchmarks defect 1 — P-16 validation is O(n²)
`src/validation.ts`: P-16 rewritten Map-indexed (group by SSN and by
name+DOB; sub-group by identity / by SSN within each group; one
finding per conflicting record naming the first conflicting
counterpart). Preserves the rule's meaning and the existing test.
Timings (below): 10k Node 4.6 s, 100k Node 18.1 s (was: never
finished, projected ~430 s); browser 100k 11.8 s (was 211 s). The
100k validation threshold in `stage7/thresholds.md` was tightened
from 300 s to 30 s, as that file required. Note: the Node 100k probe
needs `--max-old-space-size=4096` — the default 2 GB heap OOMs
(6.6M rule evaluations, 2.16M findings held; heap 2,621 MB, inside
the 3,000 MB peak-heap threshold). `stage7/bench/dist-node/` was
recompiled from current src and `stage7/bench/browser-bundle.js`
rebundled (both were stale).

### Benchmarks defect 2 — UI path is quadratic
`src/ui/state.ts`: `applyBatch(state, events)` folds hot kinds
(validation/calculation/reconciliation/statistics/contribution
completions) into a single draft copy — one spread per record per
batch, one audit-log append — and flushes through `applyEvent` for
any other kind, preserving event and audit order. `src/ui/main.ts`:
`runCalculateStep` and `runReconcileStep` compute all outcomes first,
then one `applyBatch`; `dispatchMany(events)` added to the boot
handle (one `renderApp` per step). `stage7/bench/ui-path-run.mjs`
now batches per step via `dispatchMany`. Timings (below): UI-path
10,000 wall 9.0 s (was projected ≥580 s), reconcile 0.8 s (was
projected ≥560 s). `test/stage7-fixes.test.ts` asserts `applyBatch`
folds `applyEvent` exactly (deep-equal state).

### Repro latent smell — pipeline.ts:556 comparator never returns 0
Fixed: the sort comparator now returns 0 on tie.

## New tests (43)

- `test/stage7-fixes.test.ts` (new, 34 tests): S-07 impossible dates,
  S-08/C-02 wrong types, P-16 conflicts + 3,000-participant
  linearity, audit-log completeness, `applyBatch` ≡ `applyEvent`,
  re-import wizard reset, CSV/JSON import (happy path, unclosed
  quote, ragged row, missing dopt, bad date/number quarantine,
  no-key quarantine, duplicate key, JSON rows + CasePackage +
  invalid JSON, XLSX refusal, unknown extension), H15 plausible +
  SYN-V-01 still Verified, G-ACC-5 statistically-ordinary error,
  pinned calculation date.
- `test/decisions.test.ts`: T3 mismatched-determination refusal.
- `test/reconcile.test.ts`: A-101–A-104 by name; correction-recommended
  via a cohort-resolving counterfactual (reconstruction as corrected
  value); the same match without cohort resolution stays
  requires-investigation.
- `test/reconciliation.test.ts`: Plausible → Supported promotion on
  cohort resolution (+ non-promotion controls).
- `test/formulas.test.ts`: DBAB citations for all 34 operations.

## Benchmark timings after the performance fixes

Engine-direct validation (probe-phase, `validate`):
| | 10,000 | 100,000 |
|---|---:|---:|
| Node | 4,556.7 ms (rules 660,009; findings 216,122; heap 316 MB) | 18,138.4 ms (rules 6,600,009; findings 2,160,136; heap 2,621 MB; `--max-old-space-size=4096`) |
| Browser | 1,530.3 ms | 11,795.5 ms (wall 71.3 s; heap peak 2,296.6 MB) |

UI path (ui-path-run, batched):
| | 1,000 | 10,000 |
|---|---:|---:|
| Validate | 277.1 ms | 1,061.2 ms |
| Calculate | 468.8 ms | 3,828.3 ms |
| Reconcile | 54.4 ms | 808.6 ms |
| Statistics | 236.7 ms | 2,676.5 ms |
| Wall | 1,082 ms | 8,985 ms |
| Heap peak | 52.6 MB | 387.2 MB |

All cells inside the §21 thresholds in `stage7/thresholds.md`
(100k validation threshold tightened 300 s → 30 s; UI-path 10,000
now passes every row).

## Verification scripts updated (expectations changed by the fixes)

- `stage7/01-static-compliance.mjs`: S1j size updated to the Stage 7
  rebuild (452,219 bytes); S8e now checks `downloadAuditLogJson`
  gates on the warning (the gate lives in the function, like S8f);
  labels updated (was "expected FAIL").
- `stage7/02-playwright-compliance.mjs`: L3b asserts the 7 disposition
  events AND calculation-run/import events; L3d/L3e/L4f/L4g/L5g labels
  updated; L5g2 asserts the refusal when the attack does not apply.
- `stage7/03-repro-browser.mjs`: run C pins the calculation date;
  steps.json A-vs-Node comparison excludes the Node-only `state` /
  `snapshot` keys (harness asymmetry, not a divergence).
- `stage7/03-repro-audit.mjs` §A: step completions now map to
  `calculation-run` / `import` in the audit log.
- `stage7/03-repro-build-driver.mjs`: R3/R4 verify the fixed eventIds.
- `stage7/04-accuracy-browser.mjs`: P0 asserts the file picker exists
  (G-ACC-3 closed); P5 two-pass counterfactual reconcile + oracle
  agreement asserted; header updated (H15 demotion noted).

## Outstanding items

1. **XLSX import — Stage 8.** CSV + JSON import is done; XLSX/XLSM is
   refused with the exact reason. The gap is a DEFLATE (inflate)
   decoder: Excel writes deflated ZIP entries, the app has no inflate
   implementation and may take no external package. CSV is the
   interchange format. `importFileText` returns the refusal text;
   `stage7/06` (this file) and the template help text record it.
2. **Edge test on the office workstation — still outstanding.** All
   Stage 7 runs were Linux Chromium 158 (Playwright 1.65.0) and Node
   v24.22.1 on this VM. The §21 thresholds must also hold in Edge on
   the office workstation; that run has not been done.
3. **UI path at 100,000 — not run.** Projected, not measured; validation
   no longer blocks it, but the run itself has not been done.
4. **P2 Harborview note:** the direct $1,498.75 refutation via
   `evaluateFormulaCall` is still described as Node-only in the
   accuracy browser script, although the function is now exposed on
   `window.PaAmbApp` (G-ACC-2). Check text only; no behaviour gap.
