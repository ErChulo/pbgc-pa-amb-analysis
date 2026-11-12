# Stage 7 — Accuracy verification (01-accuracy.md)

**Project:** PBGC PA_AMB Analysis System
**Verifier role:** Accuracy (Stage 7, end-to-end verification). Verify only — no source file was edited.
**Date:** 2026-11-12
**Deliverable under test:** `pa-amb-analysis.html` (401,313 bytes, single file, 0 fetch), via `file://` Playwright 1.65.0 + Chromium 158.
**Governing spec:** `MASTER_PROMPT.md` §20 (Verification and testing), §23 Stage 7; Stage 1 `03-reconciliation-statistical-methodology.md`; Stage 2 `04-calculation-functions.md` and `01-data-model.md` §8.

## 0. Runs that produced every claim below

| Run | Command | Result |
|---|---|---|
| Node suite | `npm test` (`tsc && node --test dist/test/*.test.js`) | **804 pass, 0 fail** (200 suites, 8,651 ms) |
| Existing UI suites | `node test/ui-playwright/run.mjs` | **4/4 suites pass** (wizard-flow, zero-fetch, theme-rows, defensive-loading) |
| Node population dump | `node stage7/03-population-node.mjs` | n=1000, medianΔ=0, MAD=24.5, flagged=400 (service 150, averaging 150, vesting 100), 0 ground-truth mismatches |
| Browser accuracy script | `node stage7/04-accuracy-browser.mjs` | **44/44 checks pass** (results: `stage7/04-accuracy-browser-results.json`) |

New files written by this verification (no existing file touched):
`stage7/01-accuracy.md` (this report), `stage7/03-population-node.mjs`,
`stage7/04-accuracy-browser.mjs`, `stage7/population-node.json`,
`stage7/04-accuracy-browser-results.json`.
(Other files in `stage7/` — `01-static-compliance.mjs`, `02-playwright-compliance.mjs`,
`robustness-node.mjs`, `audit-exports.mjs` — belong to parallel Stage 7 workers, not this verification.)

All data is synthetic. All participant keys start with `SYN-`. No live case data.

## 1. Per-example verdicts (all re-run through the HTML file in the browser)

### 1.1 SYN-001 — PASS

- **Expected (Stage 2 output 04 §9; `test/pipeline.test.ts`, `test/demo.test.ts`):** exact $1,500.00 (1.5% × 20y × $60,000 avg / 12), full 10-stage trace, Δ $0, Verified.
- **Browser (`04-accuracy-browser.mjs` P1):** exact **150000 minor ($1,500.00)**; trace **18 steps, numbered 1–18 sequentially**; step names:
  `provisions-selected, participation, credited-service, vesting-percentage,
  compensation-year ×3, average-compensation, base-formula,
  protection-evaluated-not-applied, restrictions-evaluated-not-applied, rounding,
  basis-conversion, normal-retirement-basis, comparison-basis, recorded-pa-amb,
  counterfactual ×2` — all 10 stages present (Stage 10 contributes the two counterfactual steps).
  Reconciliation: Δ **$0**, within tolerance, recommended **verified**.
- **Verdict: PASS.** Every value, every trace step, disposition.

### 1.2 SYN-002 — PASS

- **Expected (`test/bounds.test.ts`, `test/demo.test.ts`):** bounds $1,584.00–$1,683.00 (2020 pay missing, bounded $54,000–$64,800), recorded $1,620.00 inside.
- **Browser (P1):** bounds **158400–168300 minor**, `recordedPosition: "inside"`, recorded $1,620.00. Reconciliation recommended **requires-investigation** (bound width $99.00 is material vs the $1.00 case tolerance) — matches the demo decide-evidence; see G-ACC-4 for the divergence from the population oracle's treatment of inside-bounds cases.
- **Verdict: PASS.**

### 1.3 Harborview 3-version timeline (Ana Ruiz, Stage 2 output 01 §8) — PASS with a reach note

- **Expected (`test/harborview.test.ts`):** pv-1985-orig $40/mo/y (1985-07-01) → pv-2004-amend $55/mo/y (2004-01-01) → pv-2019-freeze accrual-only (2019-01-01). Reconstruction at DOTE 2010-06-30: 17.75y × $40 = **$710.00** + 6.50y × $55 = **$357.50** = **$1,067.50**/mo, gross, NSF, NRD 65. PA reported $1,232.50. **Δ +$165.00**. Counterfactual (3 extra post-2003 years at $55) reproduces $1,232.50 exactly and stays a *proposed* hypothesis; loose reading (27.25y all at $55) is $1,498.75, refuted.
- **Browser (P2, driven through `App.runCalculation` / `App.buildReconciliationInputs` / `App.runReconciliation`):**
  exact **106750 minor ($1,067.50)**, monthly, vested, NSF, age 65; Δ **+16500 minor (+$165.00)**; reconciliation outside tolerance, recommended **requires-investigation**; outcome carries **no `disposition` and no `determination` key** — the match stays a hypothesis. Counterfactual run (post-2003 service 9.5y, total 27.25y) reproduces **123250 minor ($1,232.50)** exactly. The total plus the counterfactual jointly pin the era split (17.75 × $40 + 6.50 × $55 = $1,067.50; +3 × $55 = $165.00).
  - The **per-component** $710.00 / $357.50 pricing was verified in **Node only** (`harborview.test.ts` "the two era components price separately") — `evaluateFormulaCall` is not exposed on `window.PaAmbApp` (see G-ACC-2).
  - The **per-date version selection** (1990 → pv-1985-orig; 2010 → pv-2004-amend; 2024 → pv-2019-freeze) was verified in **Node only** (`harborview.test.ts` §8.1) — `selectProvisionsByDate` is not exposed on `window.PaAmbApp` (see G-ACC-2). In-browser, the reconstruction value itself proves the timeline was honoured: $55 on all 24.25y would be $1,333.75 and $40 on all would be $970.00; the engine returned $1,067.50, so the latest formula was not applied retroactively.
  - The **loose-reading refutation** ($1,498.75) is Node-only for a subtler reason: through the pipeline, a call parameter of service 27.25y is *correctly overridden* by the Stage 3 measured service 24.25y (Stage 5 guard: "formula runs on Stage 3/4 measures, not on stale call parameters", `test/pipeline.test.ts`), so the in-browser loose run returns **$1,333.75 (= 55 × 24.25)**, not $1,498.75. That is the engine behaving correctly, not a defect — the first draft of this script asserted $1,498.75 through the pipeline and failed; the check was corrected to assert $1,333.75 with this explanation (P2-hv-loose-pipeline).
- **Verdict: PASS** (browser totals/counterfactual/disposition; per-date selection and per-component pricing Node-only — G-ACC-2).

### 1.4 SYN-V-01 — PASS on values, FAIL on the evidence label (defect D-ACC-1)

- **Expected (`test/decisions.test.ts` "worked examples (05 §8)"; `test/demo.test.ts`):** reconstructed $849.50, recorded $850.00, **Δ +$0.50**, explained by a documented rounding rule, approved, **PA_AMB_ACCEPT "Y"**, downstream value $850.00 (recorded).
- **Browser (P1, P1b):** exact **84950 minor ($849.50)**; reconciliation Δ **+50 minor (+$0.50)**, within tolerance, recommended **verified**; propose → `verified/recommended`; approve (human reviewer "A. Actuary") → `verified/approved`, refusal `null`; downstreamUse **`{usableInValuation: true, valueCents: 85000, valueKind: "recorded", paAmbAccept: "Y"}`**. All values, disposition, approval, and PA_AMB_ACCEPT check out.
- **But the rounding explanation does not check out in the demo case — defect D-ACC-1 (see §3).** The demo plan's prescribed rounding is *nearest cent, half-up, plan §5.01*; the browser trace's rounding step for SYN-V-01 has output `849.5` (unchanged) with `ruleRef: "plan §5.01"` — nearest-cent rounding cannot move $849.50 to $850.00. The nearest-dollar rule that would explain the $0.50 lives in a different fixture (`test/decisions.test.ts`, Synthetic Plan A §7.3), not in the Harborview demo plan. The Verified disposition itself is still correct on tolerance grounds (Δ $0.50 ≤ $1.00 absolute, either-leg) — the defect is the `H15: "supported"` label in the demo decide-evidence, which is asserted without any citable rule.
- **Verdict: PASS on values/disposition/approval; FAIL on the H15 "supported" evidence label (D-ACC-1).**

Note on the two parameterisations of the same $849.50 (not a discrepancy): the decisions fixture computes 1.25% × 20 × $3,398.00/month = $849.50; the demo computes 1.5% × 20 × $33,980/year ÷ 12 = $849.50. Same result, different rate/base pair, different plans — both are internally consistent.

### 1.5 SYN-I-01 — PASS (decisions variant; demo variant distinguished)

Two different SYN-I-01 states exist; both were verified and must not be confused:

**(a) Decisions variant (the task's spec: Stage 2 output 05 §8, `test/decisions.test.ts`).**
- **Expected:** recorded **$1,120.00**; per-scenario bounds **1.50% formula $1,500–$1,560** and **1.25% formula $1,250–$1,300**; $1,120.00 outside both ranges (below both minima) — a lead, not a conclusion; **no Δ** (basis unresolved); **3 data requests, priorities 1/2/3, statuses issued/issued/not-issued**; propose → indeterminate/recommended; **approval refused (guard G-IND-2)** while live requests are unanswered; on an exhausted search (requests 1–2 answered-no-data + recorded no-further-request reason) approval succeeds with **paAmbAccept "N"**, not usable in valuation.
- **Browser (P3, P4, fresh pages, evidence built from the decisions fixture and driven through `App.dispositionEntryInput` + handle dispatch):** scenario bounds exactly as expected; `outsideBoth: true`; priorities `[1,2,3]`; statuses `["issued","issued","not-issued"]`; propose → `indeterminate/recommended`, downstreamUse `{usableInValuation: false, valueCents: null, valueKind: "none", paAmbAccept: null}`; approval attempt → **refused**, status stays `recommended/indeterminate`, refusal verbatim: *"SYN-I-01: §5.2: the missing evidence must have been sought — every data request answered without resolving the gap, or the reviewer records why no further request can currently be made; a live request is still awaiting a response"* (guard G-IND-2). Exhausted-search variant: propose applied, approve applied → `indeterminate/approved`, downstreamUse `{usableInValuation: false, valueCents: null, valueKind: "none", paAmbAccept: "N"}`.
- **Verdict: PASS** — every value, every request, both approval outcomes.

**(b) Demo variant (`test/demo.test.ts`, `src/ui/demo.ts`).**
- **Expected:** DOTE blank **and** PA_AMB blank (null, never zero); indeterminate, reason `unresolved-comparison-basis`; no Δ; 1 data request (DOTE from the PA benefit schedule).
- **Browser (P1):** indeterminate, reason `unresolved-comparison-basis`; reconciliation `comparable: false`, recommended **indeterminate**. (The demo variant cannot carry the $1,120.00 scenario-bounds story because its recorded amount is blank.)
- **Verdict: PASS** — as the demo variant. The task's SYN-I-01 spec ($1,120.00, scenario bounds, 3 requests) is the decisions fixture, not the demo case; the report distinguishes them so the demo is not misread as covering that spec.

### 1.6 Demo extras verified in passing (P1)

- SYN-003: exact $1,500.00 vs recorded $2,500.00, Δ +$1,000.00, outside tolerance, requires-investigation — **PASS**.
- SYN-004: bounds $900.00–$960.00, recorded $930.00 inside — **PASS**.
- Validation: 405 rules, 145 findings, 6 participant results — **PASS** (matches the Stage 6 wizard run).
- Statistics on the 6-person demo: population n=6; modified-z flags SYN-003 (percentile screen also flags SYN-001/SYN-003 — the engine's stated behaviour on a tiny population, already noted in `wizard-flow.test.mjs`, not an error) — **PASS**.

## 2. Population ground-truth verdict — PASS

**Ground truth (`test/population.test.ts`, reproduced by `stage7/03-population-node.mjs`):**
1,000 fictional participants, seeded (`mulberry32`, seed 20261112), cohorts clean 400 / service+1 (H2) 150 / averaging (H4) 150 / rounding (H15) 100 / missing-comp (H16, bounds) 100 / vesting-double (H12) 100. Hypothesis ranking identifies the planted cause per cohort; robust-z (median/MAD, |z| > 3.5) flags exactly the service/averaging/vesting cohorts; dispositions match the test-local oracle per cohort.

**Node dump (`stage7/population-node.json`):** medianΔ=0, MAD=24.5, **flagged=400 (service 150, averaging 150, vesting 100)**, 0 ground-truth mismatches (top hypothesis and oracle disposition correct for all 1,000).

**Browser (`04-accuracy-browser.mjs` P5, 1,000 participants through the in-page engine — `App.runCalculation`, `App.buildReconciliationInputs`, `App.runReconciliation`, threaded local state, no DOM dispatch per participant; 1,577 ms):**
- **1,000/1,000 browser rows match Node exactly** — reconstructed, recorded, Δ, outcome kind, bounds min/max, recorded position. Zero mismatches.
- **Outliers: exactly 400** (service 150, averaging 150, vesting 100); medianΔ=0, MAD=24.5 — identical to Node. **Flag set identical to Node's 400 keys.** Clean, rounding, and missing cohorts: 0 flagged.
- **Verdict: PASS.** The browser engine and the Node engine agree participant-by-participant, including the ground-truth outlier count.

**One divergence (not a value error — G-ACC-4, §3):** the browser's reconcile recommendations differ from the Node oracle for the service and averaging cohorts (browser: `requires-investigation` ×150 each; oracle: `correction-recommended` ×150 each) and for bounds-inside cases (browser: `requires-investigation`; oracle: `supported-for-acceptance`). Cause: the app's reconcile path never runs counterfactual ranking, so it cannot reach `correction-recommended`. Clean (verified ×400), rounding (verified ×100), and vesting (requires-investigation ×100) agree with the oracle.

**CSV import:** the task asked for the population to be run "through the browser (import the synthetic CSV via the file picker)". **That step is impossible as shipped: there is no file picker.** `document.querySelectorAll("input[type=file]")` returns 0 and the HTML contains no `type="file"` (check P0-no-file-picker). The only import in the app is the demo-case button (plus programmatic `import-case-package` dispatch). The population was therefore driven through the app's own public engine API, which exercises the same bundled engine code. Recorded as gap G-ACC-3 (§3).

## 3. §20 coverage table

§20 list (MASTER_PROMPT.md §20) vs the existing suite (804 Node tests + 4 Playwright suites). "Covered" means a test asserts the behaviour; file + test name cited.

| # | §20 item | Verdict | Evidence (test file + test name) |
|---|---|---|---|
| 1 | Every supported benefit formula | **Covered** | `test/formulas.test.ts` — all 34 formulas with a named worked example: T-01 flat-dollar ("Dane: $1,000 x 10/25 = $400/month"), T-02 fixed-percentage, T-03 dollar-per-year, T-04 unit-credit, T-05 career-average, T-06 final/highest-average, T-07 fractional accrual, T-08 step-rate, T-09 service-capped, I-01 excess, I-02 covered-compensation, I-03 permitted disparity, I-04 PIA offset, I-05 plan offset, C-01 greater-of, C-02 lesser-of, C-03 minimum, C-04 grandfathered, C-05 fresh-start, C-06 multiple periods, C-07 group-specific, S-01 cash balance, S-02 pension equity, S-03 other hybrid, S-04 contributory, S-05 employee contributions, S-06 frozen, S-07 past-service credit, S-08 rehire/restoration, X-01 §415 limit, X-02 §401(a)(17) cap, X-03 form/age conversion, X-04 post-NRA accruals, X-05 vesting; plus accrual tests (3%, 133⅓%, fractional). |
| 2 | Historical plan amendments | **Covered** | `test/harborview.test.ts` — "1985–2003 selects pv-1985-orig, 2010 selects pv-2004-amend, DOPT 2024 selects pv-2019-freeze"; `test/formulas.test.ts` C-04/C-05 (amendment adoption vs effective dates). |
| 3 | Grandfathered and frozen benefits | **Covered** | `test/formulas.test.ts` — "C-04 grandfathered: Hannah: max($1,800 new, $2,000 protected) = $2,000/month"; "S-06 frozen: Maria: hard freeze at 2015-12-31 keeps $1,125/month"; harborview pv-2019-freeze version. |
| 4 | Multiple employment periods | **Covered** | `test/formulas.test.ts` — "C-06 multiple periods: Ivan: 10 x $90 + 10 x $150 = $2,400/month"; "S-08 rehire and restoration: Olga restored: 3-year break, 6 + 1 = 7 years = $320.83/month"; `test/service.test.ts` break/rehire cases. |
| 5 | Short-service and long-service participants | **Covered (unnamed)** | Short: `test/formulas.test.ts` — "X-05 vesting: Priya: $1,000 x VP 0.60 (3 years graded) = $600/month" (3 years). Long: "T-09 service-capped: Carla: 1% x $80,000 x 25 (capped from 35)"; `test/service.test.ts` — "35 years caps to 30". No test is *named* short-service/long-service. |
| 6 | Missing historical compensation | **Covered** | `test/bounds.test.ts` — "SYN-002 bounds: $1,584.00–$1,683.00, recorded $1,620 inside"; `test/missingdata.test.ts` (33 tests: M1–M5 classes, bounds rules B-1–B-5, MCAR/MAR/MNAR); `test/population.test.ts` missing cohort (100). |
| 7 | Historical benefit amounts with unknown dates | **Covered** | `test/validation.test.ts` — "Example 2 — SYN-002: PA_AMB populated, DOTE blank — unresolved basis, no Δ" and "M-01 fails Error for RETSTAT 2 with PA_AMB populated and DOTE blank"; `test/demo.test.ts` — "is indeterminate for SYN-I-01: DOTE blank, no delta"; `test/decisions.test.ts` SYN-I-01; `test/endtoend.test.ts` — "DOTE blank → Indeterminate". |
| 8 | Different rounding conventions | **Covered** | `test/rounding.test.ts` (16 tests: prescribed sequence, per-period vs final-only rounding, cent vs whole-year effect bounds, "documented sequence + match -> supported", "undocumented sequence + match -> coincidence, never an explanation", cohort-wide rule A-3(b)); `test/decisions.test.ts` V-01 nearest-dollar; demo nearest-cent §5.01. |
| 9 | Service-credit errors | **Covered** | `test/population.test.ts` service cohort (PA used 21y vs plan 20y, H2, 150 participants); `test/reconcile.test.ts` H2 ranking tests; `test/reconciliationFindings.test.ts` H2 counterfactual ("credited service +1 year"). |
| 10 | Social Security integration and offsets | **Covered** | `test/formulas.test.ts` — I-01 excess, I-02 covered-compensation integration, I-03 permitted disparity ("Dana Kim: [0.75% x $60,000 + 0.65% x $50,000] x 20 = $1,291.67/month"), I-04 PIA offset ("Eli: $2,400 gross - 50% x $1,500 PIA = $1,650/month"), I-05 plan offset. |
| 11 | Cash balance conversions | **Covered** | `test/formulas.test.ts` — "S-01 cash balance: Neff: $50,000 x 1.05^20 / 151.458 = $875.92/month" (conversion to monthly annuity via APR 151.458); S-02 pension equity likewise converts via APR. Note: only one cash-balance conversion example exists. |
| 12 | Incorrect or duplicated vesting adjustments | **Covered** | `test/formulas.test.ts` X-05 vesting; `test/population.test.ts` vesting-double cohort (PA applied 80% VP twice, H12, 100 participants → requires-investigation); `test/reconcile.test.ts` vesting "applied-twice-diagnostic" counterfactual. |
| 13 | Reported benefits above or below independently reconstructed values | **Covered** | Above: demo SYN-003 (+$1,000.00), Harborview (+$165.00), population service/averaging cohorts. Below: population vesting cohort (recorded below reconstruction); `test/reconcile.test.ts` negative-Δ cases. |
| 14 | Statistically unusual but valid benefits | **Covered** | `test/statistics.test.ts` — "a planted outlier is flagged within-cohort; a legitimate formula-group difference is not" (Group B flat-dollar deltas ~$500 explained by group, never flagged as errors); population rounding cohort (small Δ, within tolerance, not flagged). |
| 15 | Incorrect records that appear statistically ordinary | **PARTIAL — gap G-ACC-5** | Nearest coverage: `test/population.test.ts` rounding cohort — a real (small) deviation (nearest-dollar vs nearest-cent) that the robust-z screen does not flag. But it is immaterial by construction (Δ ≤ $0.50, within tolerance). No test plants a *materially* incorrect record that the statistical screen misses (e.g. a large Δ hidden inside a high-variance cohort). |

## 4. Citations — reproduced examples vs independently derived cases (§20)

- **Reproduced documented examples, cited:**
  - DBAB worked examples in `test/formulas.test.ts` — file header cites "Stage 1 §10 of 01-formula-classification.md; DBAB worked examples use fictional companies and people" and documents **two deliberate divergences** from the book's printed numbers (I-01 Frank: engine $2,140.63/mo vs book $2,142; I-05 Employee A: engine $180.35/mo vs book $180) with the reason (engine rounds only at prescribed points, MASTER_PROMPT §9). Inline per-example DBAB question citations are sparse: Q 9:9 (`test/decimal.test.ts:183`), Q 9:15 (`test/formulas.test.ts:1447`), Q 7:21 (`test/service.test.ts:144`), Q 7:35 / Q 7:38 (`test/dates.test.ts:171/175`). See G-ACC-6.
  - Harborview timeline — `test/harborview.test.ts` header cites "Stage 2 output 01 §8 (3-version timeline)".
  - SYN-V-01 / SYN-I-01 decision examples — `test/decisions.test.ts` header section "worked examples (05 §8)" cites Stage 2 output 05 §8.
  - Stage 1 §3.1 worked table A-105 ($975.40 vs $4.10, `R_UNSTABLE_SMALL_DENOMINATOR`) — reproduced by name in `test/reconcile.test.ts:326`. A-104's PA_ZERO behaviour is tested (`test/reconcile.test.ts:348`, `test/reconciliation.test.ts:222`) but not labelled A-104; A-101/A-102/A-103 values are not reproduced as named cases. See G-ACC-6.
- **Independently derived cases, distinguished as such:**
  - Demo case: `test/demo.test.ts` / `src/ui/demo.ts` headers state the Harborview demo is fictional/synthetic (six SYN- participants, no SSNs, blanks null).
  - Population: `test/population.test.ts` header states the cohorts are planted ground truth with a seeded PRNG, and that its disposition oracle is the test's own mapping, "NOT the Stage 5 disposition module".
  - All SYN- fixtures are labelled fictional in their file headers; no reproduced example is presented as independently derived, and no derived case is presented as a documented example.

## 5. Gaps and defects

### D-ACC-1 — DEFECT: demo SYN-V-01 labels H15 "supported" with no citable rule (evidence label, not a value error)

- **Expected:** per the anti-coincidence rule (Stage 1 output 03 §2.7; Stage 2 output 04 §4.4, rule A-3), a rounding hypothesis is Supported only if (a) the sequence is documented in the plan, workpapers, or a valuation report, or (b) the same sequence resolves discrepancies across the cohort. Otherwise it is Coincidence.
- **Actual:** the demo decide-evidence (`test/demo.test.ts` `decideEvidence`, also driven in-browser by `stage7/04-accuracy-browser.mjs`) asserts SYN-V-01 hypotheses `[{code: "H15", supportClass: "supported", material: true}]` with **no citation anywhere** — `MappingHypothesis` (`src/dispositionMapping.ts:65-70`) has no citation field at all (only `code`, `supportClass`, `material`, `correctedBenefitMinor`). And the demo plan's own prescribed rounding (nearest cent, half-up, plan §5.01) **cannot** produce the $0.50: the browser trace's rounding step for SYN-V-01 reads `output=849.5, ruleRef="plan §5.01"` — the value is unchanged by rounding. The rule that would explain it (nearest dollar, Synthetic Plan A §7.3) belongs to a different fixture (`test/decisions.test.ts`), a different plan, a different case (00000001 vs demo 00098765). The in-browser approval I drove therefore records a determination whose H15 counterfactual says "nearest dollar" while its supporting document cites "Synthetic plan §5.01 (demo)" — internally inconsistent.
- **Impact:** the Verified disposition and the approval are still correct on tolerance grounds (Δ $0.50 ≤ $1.00 absolute, either-leg; approval succeeded, `paAmbAccept: "Y"`). The defect is evidential: an approval record in the demo flow claims a supported rounding explanation that no cited rule supports. If the demo is used to show how a rounding explanation is documented, it teaches the wrong thing.
- **Reproduction:** `node stage7/04-accuracy-browser.mjs` — checks P1-SYN-V-01-rounding-trace and P1b-V-01-approve; or Node: `test/demo.test.ts` `decideEvidence("SYN-V-01")` + `src/ui/demo.ts` rounding config.
- **Proposed fix (coordinator's choice, do not silently pick one):** (a) demote the demo H15 for SYN-V-01 from `"supported"` to `"plausible"` (or `"coincidence"` if no document supports nearest-dollar for this plan) and let Verified rest on tolerance alone; or (b) add a documented nearest-dollar rounding provision to the demo plan with a proper citation and re-derive the evidence; and (c) consider adding a citation field to `MappingHypothesis` so a `"supported"` label cannot be recorded without one.

### G-ACC-2 — GAP: engine functions needed for full verification are not exposed on `window.PaAmbApp`

- **What:** `selectProvisionsByDate` (per-date timeline selection), `evaluateFormulaCall` (direct formula evaluation, incl. the Harborview loose-reading refutation $1,498.75), `testCounterfactual` and `rankCounterfactuals` (hypothesis ranking) are implemented and Node-tested but **not exported** from `build/entry.ts`. The shipped HTML exposes only the UI entry point plus demo/theme/`buildReconciliationInputs`/`mapDisposition`/`makeMoney`/`datedValue`/`makeBenefit`.
- **Consequence:** those checks are Node-only; the browser verification had to prove the same facts indirectly (reconstruction total + counterfactual runs). Nothing is wrong with the values — this is a reach/coverage gap.
- **Proposed fix:** export the read-only engine functions from `build/entry.ts` onto `window.PaAmbApp` (no behaviour change), so Stage 7 and office verification can drive them through the shipped file.

### G-ACC-3 — GAP: no CSV import; no file picker exists in the app

- **What:** `pa-amb-analysis.html` contains no `input[type=file]` (verified in the DOM: count 0; no `type="file"` in the markup). The only import is the demo-case button (plus programmatic `import-case-package` dispatch). The import step's own spec (`src/ui/wizard.ts`) mentions "Case file list, import record, quarantined rows" but no picker was built.
- **Consequence:** the task's "import the synthetic CSV via the file picker" step cannot be executed. The 1,000-participant population was instead driven through the app's public engine API in-page (same bundled engine code; 1,577 ms for 1,000 participants).
- **Proposed fix:** either build a file-picker CSV import (a Stage 6 scope decision — needs a format spec and quarantine handling), or record the API-driven route as the supported verification path and amend the task wording.

### G-ACC-4 — DIVERGENCE (needs a product decision): browser reconcile recommendations vs the Node population oracle

- **What:** for the service cohort (150) and averaging cohort (150), the browser's reconcile step recommends `requires-investigation` while the Node oracle (which uses ranked counterfactuals) says `correction-recommended`. For bounds-inside cases (population missing cohort; demo SYN-002/SYN-004), the browser recommends `requires-investigation` (material bound width) while the oracle says `supported-for-acceptance`. All underlying values agree exactly (1,000/1,000 rows); only the recommended disposition differs.
- **Cause:** the app's reconcile path (`src/ui/main.ts` `runReconciliation` → `reconcileParticipant`) never runs counterfactual ranking — `buildReconciliationInputs` carries no counterfactuals and `hypothesisCandidates` is always empty from the UI — so it cannot reach `correction-recommended`, and it treats material bound width as investigation-worthy.
- **Proposed fix:** decide which is authoritative. If the oracle is right, wire counterfactual ranking into `runReconciliation` (blocked on G-ACC-2 exports). If the app is right (conservative: a correction needs a ranked, supported counterfactual the UI does not run; inside-bounds with material width is not yet acceptance), update the population oracle/expectations and document that `correction-recommended` and `supported-for-acceptance` require evidence the current UI does not produce. This is a product decision, not a calculation error.

### G-ACC-5 — §20 GAP: "incorrect records that appear statistically ordinary" only partially covered

- **What:** the only coverage is the population rounding cohort — a real but immaterial deviation (Δ ≤ $0.50, within tolerance) that the robust-z screen does not flag. No test plants a *materially* incorrect record that the statistical screen misses (e.g. a large Δ hidden inside a high-variance cohort, or a systematic error inside a noisy group), which is the case §20 is really asking for: proof that statistics alone do not clear a record.
- **Reproduction:** n/a (absence). `test/population.test.ts` (b) asserts the rounding cohort is *not* flagged; nothing asserts a material error escaping the screen.
- **Proposed fix:** add a test with a planted material error inside a high-variance cohort that the robust-z / Tukey screens do not flag, asserting that reconciliation (Δ/tolerance) still catches it — i.e. the statistical screen's silence is never treated as clearance.

### G-ACC-6 — §20 CITATION GAP: two reproduced-example sets are incompletely cited

- **What:** (a) Stage 1 §3.1 worked table A-101–A-105 is reproduced by name only for A-105 (`test/reconcile.test.ts:326`); A-101/A-102/A-103 values appear nowhere as named cases (A-104's PA_ZERO behaviour is tested but not labelled A-104). (b) `test/formulas.test.ts` cites DBAB at file level (header) but per-example DBAB question numbers are mostly absent — only Q 9:9, Q 9:15, Q 7:21, Q 7:35, Q 7:38 appear inline.
- **Proposed fix:** add the four missing named cases (A-101, A-102, A-103, A-104) or record them as intentionally not reproduced; add per-example DBAB question citations where the example is a DBAB reproduction.

## 6. Overall accuracy verdict — CONDITIONAL PASS

**The numbers are verified.** Every worked example re-run through the shipped HTML file reproduces its expected values exactly: SYN-001 $1,500.00 with its full 18-step / 10-stage trace; SYN-002 bounds $1,584–$1,683 with $1,620 inside; Harborview $1,067.50 vs $1,232.50, Δ +$165.00, with the counterfactual reproducing $1,232.50 and the match correctly held as a hypothesis, not a decision; SYN-V-01 $849.50 vs $850.00, Δ +$0.50, approved, PA_AMB_ACCEPT "Y"; SYN-I-01 per-scenario bounds with $1,120.00 outside both, no Δ, 3 prioritised data requests, approval refused (G-IND-2), and approval succeeding only on an exhausted search (PA_AMB_ACCEPT "N"). The 1,000-participant ground truth agrees participant-by-participant between browser and Node (1,000/1,000 rows), with outliers flagged exactly 400 (150 service + 150 averaging + 100 vesting) and identical flag sets. No value mismatch was found anywhere: 44/44 browser checks, 804/804 Node tests, 4/4 existing UI suites.

**Conditional on:**
1. **D-ACC-1 must be fixed** before the demo evidence is relied on or shown: the SYN-V-01 H15 "supported" label has no citable rule in the demo plan. (Fix (a) or (b) in §5; the disposition itself is unaffected.)
2. **G-ACC-4 needs a product decision** (which disposition the app should recommend for ranked-correction and inside-bounds cases) — the values agree; the recommendation logic does not.
3. G-ACC-2, G-ACC-3, G-ACC-5, G-ACC-6 are coverage/reach gaps to schedule, not accuracy failures: they limit what can be verified through the shipped file, but nothing they cover was found wrong.
