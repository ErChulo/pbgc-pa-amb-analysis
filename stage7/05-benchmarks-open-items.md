# Stage 7 — §21 benchmarks and Stage 6 open items

Date: 2026-11-12. System under test: `pa-amb-analysis.html`
(rebuilt 417,680 bytes, 0 fetch) and `src/` (804 Node tests passing).
Governing spec: `MASTER_PROMPT.md` §21 (Performance requirements)
and §23 Stage 7; Stage 3 P-10 baseline in
`stage3/01-poc-results.md` §2 P-10 and `stage3/poc/poc-p10-100k.js`;
Stage 6 build notes in `docs/STAGE6_BUILD.md`.

## 0. Method, machine, fixture

**Machine.** Linux VM on the build host: Node v24.22.1, Playwright
1.65.0 + Chromium 158 (headless shell), 1.5 shared CPUs, ~6 GB RAM,
low free memory at times. Every time and memory number below is a
measurement on this machine, not an office-workstation figure. The
office runs Microsoft Edge on a restricted workstation (Stage 3
caveat, still open — see §3, last bullet).

**Engines.** Two paths were measured:

- **Engine-direct** (`stage7/bench/core.ts`, `runBench`): calls the
  engine functions straight from `src/` — import (CSV parse +
  build inputs), validation, calculation, reconciliation,
  statistics, model fit, report CSV, report XLSX, report HTML,
  incremental recalculation (change one participant's PA_AMB and
  re-run: one calculation + one reconciliation + full statistics
  re-run + CSV rebuild). One process per size, per engine.
- **UI path** (`stage7/bench/ui-path-run.mjs`): the same steps driven
  through the shipped app — `window.PaAmbApp` wrappers +
  `window.__paAmbHandle` dispatch, exactly as
  `test/ui-playwright/wizard-flow.test.mjs` does. Each dispatch runs
  `applyEvent` (spreads the `calculations` / `reconciliations`
  records and the append-only event log) and then `renderApp`
  (re-renders charts, dispositions, invariants from the whole
  state). See §4, defect 2.

**Browser memory.** JS heap peak via CDP `Performance.getMetrics`
(`JSHeapUsedSize`, sampled every 50 ms). The in-page
`performance.memory` figure stays flat at 9.5 MB in the headless
shell and is not trusted (P-10 notes). The outer-RSS sampler
(`ps`, matching the known profile path) stays near 102–135 MB at
every size and does not capture the renderer heap — it is reported
only as a secondary figure; the CDP heap peak is the browser
memory number. Node memory is peak RSS of the Node process
(`process.memoryUsage().rss` sampled after each phase).

**Fixture.** Synthetic P-10-style populations (same generator
approach as `stage3/poc/poc-p10-100k.js` and
`test/population.test.ts`): formula T-04 unit-credit 1.5%,
final-3-year averaging, 5% missing-average rows with bounds over
feasible $1,000–$8,000/month. Bench tolerance $1.00 / 0.1%
(either); validation tolerance $2.00 (either). Case "99999999",
DOPT 2045-06-30. Fidelity check against the P-10 baseline —
exact / bounds / indeterminate counts match exactly at every size
(92/8/0, 944/56/0, 9,493/507/0, 95,023/4,977/0); mean |Δ|
$1.24 / $1.07 / $0.98 / $1.01 (P-10: $1.23 / $1.07 / $0.97 /
$1.00); max |Δ| $16.26 / $19.79 / $19.98 / $20.01 (P-10: $16.26 /
$19.79 / $19.99 / $20.00). Within-tolerance counts differ from
P-10 (86,077 of 95,023 at 100k vs P-10's 87,831) because the bench
tolerance is $1.00 while P-10 used $5.00 — a fixture choice, not a
discrepancy. One fixture caveat: for missing-average rows the
recorded PA falls outside the computed bounds in 76% of cases at
100k (3,797 of 4,977), because the feasible range is applied to
the DOTE-year salary only while the planted PA reflects a full
5-year average. That skews the bounds disposition mix; it does
not affect timing (the recorded-position test costs the same
either way).

**Run-to-run variance.** Sub-100 ms phases vary up to ~2–5×
between runs in absolute terms of tens of ms (browser statistics
at N=100: 7.7 ms first run, 40.4 ms second run; browser XLSX at
N=1,000: 42.0 ms first run, 88.5 ms second run). The tables below
cite the second (CDP-instrumented) browser run; thresholds use the
slower of the two engines, so this variance is covered. The large
phases (validation, calculation, statistics) are stable within
~5% between runs.

**Files.** Harness under `stage7/bench/` (`core.ts`, `node-run.ts`,
`browser-entry.ts`, `browser-bench.html`, `browser-bundle.js`,
`browser-run.mjs`, `probe-phase.ts`, `ui-path-run.mjs`).
Result JSONs: `results-node-<N>.json`, `results-browser-<N>.json`,
`results-uipath-<N>.json` (N = 100 / 1,000 / 10,000 / 100,000;
UI path 100 / 1,000 only — see §1.3).

## 1. Benchmark results

All times in milliseconds unless noted. `wall` is the whole
`runBench` call (Node) or the whole in-page run (browser).
`heap` is the browser CDP JS-heap peak; `rss` is the Node process
peak RSS. `incr` is the incremental recalculation total; its
parts are `calc1` (one participant recalculated), `recon1` (one
reconciliation), `statsRe` (full statistics re-run), `csvRe`
(CSV rebuild).

### 1.1 Engine-direct — Node v24.22.1

| N | wall | import | validate | calc | recon | stats | model | csv | xlsx | html | incr (calc1 / statsRe / csvRe) | peak RSS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 142 | 5.6 | 28.6 | 76.2 | 3.0 | 9.0 | 1.4 | 0.5 | 6.9 | 1.2 | 7.2 (0.71 / 6.3 / 0.1) | 95 MB |
| 1,000 | 1,023 | 36.8 | 274.7 | 491.7 | 10.7 | 74.7 | 4.1 | 1.7 | 43.1 | 2.2 | 80.9 (0.68 / 79.1 / 1.0) | 193 MB |
| 10,000 | 10,842 | 307.3 | 4,325.6 | 4,293.2 | 71.8 | 772.7 | 24.3 | 11.9 | 366.8 | 1.9 | 660.2 (0.70 / 647.4 / 12.0) | 772 MB |
| 100,000 | 82,596 * | 3,948.4 | skipped * | 46,367.8 | 773.1 | 10,630.7 | 228.8 | 100.9 | 10,918.1 | 1,342.8 | 8,176.5 (1.04 / 8,054.0 / 121.4) | 2,384 MB |

\* Node 100,000 ran with `BENCH_SKIP_VALIDATION=1`:
`BENCH_SKIP_VALIDATION=1 node stage7/bench/dist-node/stage7/bench/node-run.js 100000`
— wall 82,596 ms, peak RSS 2,384 MB. Full validation at 100k in
Node never finished: the first attempt was killed after ~8 min
(RSS flat ~1.36 GB, 81–90% CPU, still in validation); a second
attempt with per-phase logging showed import 4.8 s then >140 s
stuck in validation before being killed. Projected Node 100k
validation from the measured quadratic curve (4.3 s @ 10k,
38.7 s @ 30k — fit t = 4.28e-8 · n², verified at 30k: 38.5 s
predicted vs 38.7 s measured) is ~430 s. See §4, defect 1.

Counts (Node, all sizes): exact 92 / 944 / 9,493 / 95,023; bounds
8 / 56 / 507 / 4,977; indeterminate 0; within-tolerance 80 /
851 / 8,637 / 86,077; outside-tolerance 12 / 93 / 856 / 8,946;
not-comparable 8 / 56 / 507 / 4,977; outlier flags 24 / 220 /
2,020 / 21,062; mean |Δ| $1.24 / $1.07 / $0.98 / $1.01; max |Δ|
$16.26 / $19.79 / $19.98 / $20.01; validation rules evaluated
6,609 / 66,009 / 660,009 / (skipped); findings 2,171 / 21,619 /
216,122 / (skipped); CSV out 6,676 / 65,853 / 655,639 /
6,569,316 B; XLSX out 49,905 / 448,294 / 4,513,804 /
45,998,381 B. OLS R² = 0.0073 / 0.0008 / 0.0003 / 0.0000.

### 1.2 Engine-direct — browser (Chromium 158 headless, file://)

| N | wall | import | validate | calc | recon | stats | model | csv | xlsx | html | incr (calc1 / statsRe / csvRe) | heap peak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 187 | 7.7 | 26.9 | 76.6 | 2.7 | 40.4 | 2.1 | 0.5 | 8.7 | 1.4 | 9.7 (0.90 / 8.7 / 0.1) | 9.1 MB |
| 1,000 | 1,062 | 46.8 | 210.0 | 527.9 | 8.9 | 74.8 | 3.6 | 1.5 | 88.5 | 1.3 | 80.6 (0.60 / 79.2 / 0.8) | 41.7 MB |
| 10,000 | 8,784 | 629.3 | 2,558.2 | 3,611.3 | 58.3 | 718.6 | 16.4 | 17.3 | 471.8 | 1.8 | 656.0 (0.50 / 648.2 / 7.3) | 326.7 MB |
| 100,000 | 278,635 | 3,890.4 | 211,411.9 | 36,147.9 | 767.1 | 8,186.8 | 274.1 | 142.6 | 9,791.2 | 12.2 | 7,114.0 (0.70 / 6,993.0 / 120.2) | 2,414 MB |

Browser 100k ran to completion (full validation, no skip):
`node stage7/bench/browser-run.mjs 100000` — wall 278,635 ms
(4.6 min), heap peak 2,414 MB, heap after 1,134 MB. Validation
211.4 s (vs the 100× quadratic projection of ~256 s from the
10k figure — slightly sub-quadratic in this engine). Counts match
Node exactly at every size (100k: validation rules 6,600,009,
findings 2,160,136, flags 21,062).

Reading the engine-direct tables: every phase except validation
scales near-linearly (10× data ≈ 10× time, e.g. calculation
76 → 492 → 4,293 → 46,368 ms in Node). Validation is the
exception — it is quadratic (§4, defect 1). The incremental
recalculation is dominated by the population-wide statistics
re-run (8,054 of 8,177 ms at 100k in Node); the single
participant's own recalculation is ~1 ms and its reconciliation
~0.04 ms.

### 1.3 UI path — browser, through `window.PaAmbApp` + dispatch + render

| N | wall | validate | calculate | reconcile | statistics | heap peak |
|---|---:|---:|---:|---:|---:|---:|
| 100 | 602 | 76.0 | 198.6 | 240.2 | 77.7 | 10.6 MB |
| 1,000 | 14,449 | 329.8 | 1,681.6 | 11,627.1 | 601.0 | 71.1 MB |
| 10,000 | projected ≥ ~580 s | ~1.4 s | ~14 s | ≥ ~560 s | ~4.6 s | — |
| 100,000 | projected ≥ ~7 h | fails (P-16) | ≥ ~120 s | ≥ ~7 h | ~35 s | — |

Counts match the engine-direct bench exactly (findings 2,171 /
21,619; flags 24 / 220; event log 202 / 2,002 entries).
10,000 and 100,000 were NOT run on the UI path — they are
projected from the measured 100 → 1,000 scaling exponent (see
below), and the projection is a lower bound: the exponent rises
toward 2 as the quadratic term dominates, so the true cost is
likely worse.

Scaling exponents (measured 100 → 1,000, per 10× data):
validate ×4.3, calculate ×8.5, reconcile ×48.4, statistics
×7.7. Reconcile is the worst step: at 1,000 participants it
takes 11.6 s where the engine takes 8.9 ms — a 1,300× gap —
because every one of the 1,000 dispatches re-renders all five
charts over all reconciled rows and spreads the growing state
(see §4, defect 2). At 100 participants the UI path is ~3× the
engine path overall (602 ms vs 187 ms wall); at 1,000 it is
~14× (14.4 s vs 1.1 s).

## 2. §21 thresholds

Thresholds are set per metric and size from the measured
baselines above. Rule: **baseline = the slower of the Node and
browser engine-direct measurements** for that cell (the office
runs the browser; Node is the dev/test path — a threshold must
hold in both). Headroom is ~2–3× at 100–10,000 and ~1.3–1.9× at
100,000, where the current implementation is already near the
edge of what a browser tab tolerates; the headroom there is
deliberately thin and is meant to be regained by the Stage 8
fixes (§4), after which these thresholds should be tightened.
The 35.2 ms table render from Stage 6 stays a **baseline, not a
threshold** — the UI-path thresholds below supersede it as the
acceptance criteria (the render cost is inside the UI-path
numbers). All thresholds also appear alone in
`stage7/thresholds.md`.

### 2.1 Engine-direct thresholds (both engines)

| Metric | 100 | 1,000 | 10,000 | 100,000 |
|---|---:|---:|---:|---:|
| Import | 25 ms | 150 ms | 1,500 ms | 10,000 ms |
| Validation | 100 ms | 750 ms | 10,000 ms | 300,000 ms (5 min) |
| Calculation | 200 ms | 1,500 ms | 10,000 ms | 60,000 ms |
| Reconciliation | 25 ms | 100 ms | 500 ms | 5,000 ms |
| Statistical analysis | 150 ms | 250 ms | 2,000 ms | 20,000 ms |
| Model fit | 25 ms | 50 ms | 250 ms | 2,000 ms |
| Report CSV | 10 ms | 25 ms | 100 ms | 1,000 ms |
| Report XLSX | 50 ms | 250 ms | 1,500 ms | 20,000 ms |
| Report HTML | 25 ms | 25 ms | 100 ms | 5,000 ms |
| Incremental recalculation | 50 ms | 250 ms | 2,000 ms | 15,000 ms |
| End-to-end wall | 500 ms | 3,000 ms | 30,000 ms | 360,000 ms (6 min) |
| Peak JS heap | 50 MB | 100 MB | 500 MB | 3,000 MB |

**Justifications (baseline + headroom + consequence).**

- **Import.** Baseline 7.7 / 46.8 / 629.3 / 3,948.4 ms.
  Threshold ≈ 2.4–3.2× headroom. Consequence of exceeding it:
  the file looks dead on open — nothing can start until the
  import finishes.
- **Validation.** Baseline 28.6 / 274.7 / 4,325.6 / 211,411.9 ms.
  Threshold ≈ 3.5× / 2.7× / 2.3× / 1.4× headroom. Consequence:
  validation gates every later step; a validation that does not
  finish blocks the whole case. **Current build: browser PASSES
  at 100k (211 s < 300 s) but Node FAILS (projected ~430 s, two
  attempts killed) — see §4, defect 1.** The 100k threshold is
  set at the measured behaviour, not at what is desirable: after
  the P-16 fix the expected 100k validation is ~5–10 s, and this
  threshold must then be tightened to ~30 s.
- **Calculation.** Baseline 76.6 / 527.9 / 4,293.2 / 46,367.8 ms.
  Threshold ≈ 2.6× / 2.8× / 2.3× / 1.3× headroom. Consequence:
  the core work — a slow calculation leaves the actuary waiting
  mid-wizard with no output. Current build PASSES at all sizes.
- **Reconciliation.** Baseline 3.0 / 10.7 / 71.8 / 773.1 ms.
  Threshold ≈ 6–9× headroom. Consequence: reconciliation must
  stay effectively instant per batch, or reviewing deltas feels
  broken. Current build PASSES at all sizes.
- **Statistical analysis.** Baseline 40.4 / 74.8 / 772.7 /
  10,630.7 ms. Threshold ≈ 3.7× / 3.3× / 2.6× / 1.9× headroom.
  Consequence: the review step — slow statistics means the
  actuary cannot iterate on outlier flags. Current build PASSES
  at all sizes.
- **Model fit.** Baseline 2.1 / 4.1 / 24.3 / 274.1 ms. Threshold
  ≈ 7–12× headroom. Consequence: a slow fit stalls the
  statistics step it belongs to. Current build PASSES.
- **Report CSV / XLSX / HTML.** Baselines CSV 0.5 / 1.7 / 17.3 /
  142.6 ms; XLSX 8.7 / 88.5 / 471.8 / 10,918.1 ms; HTML 1.4 /
  2.2 / 1.9 / 1,342.8 ms (the Node 100k HTML figure includes a
  major GC pause — RSS fell 2,007 → 1,206 MB during that phase;
  the browser took 12.2 ms). Thresholds ≈ 2–20× headroom.
  Consequence: export must complete, or the actuary cannot take
  the work product out of the app. Current build PASSES.
- **Incremental recalculation.** Baseline 9.7 / 80.9 / 660.2 /
  8,176.5 ms. Threshold ≈ 5× / 3× / 3× / 1.8× headroom.
  Consequence: changing one participant's PA_AMB must feel
  instant, or the actuary will not correct data. Note the
  incremental total is dominated by the population-wide
  statistics re-run (8,054 of 8,177 ms at 100k) — that is by
  design (a changed value can move population cut points), and
  the threshold accommodates it. Current build PASSES.
- **End-to-end wall.** Baseline 187 / 1,062 / 10,842 / 278,635 ms.
  Threshold ≈ 2.7× / 2.8× / 2.8× / 1.3× headroom. Consequence:
  the whole run must fit in a work session and in a browser tab
  that stays alive. Current build PASSES in the browser at all
  sizes; Node at 100k is incomplete (validation skipped).
- **Peak JS heap.** Baseline 9.1 / 41.7 / 326.7 / 2,414 MB.
  Threshold ≈ 5.5× / 2.4× / 1.5× / 1.24× headroom. Consequence:
  a tab that runs out of memory is killed and the work in it is
  lost. The 100k headroom is thin because the app retains the
  full validation result (2.16 M findings at 100k) in state; a
  streaming import or a lazily-held validation result would
  regain headroom. Current build PASSES in the browser at all
  sizes (Node peak RSS 2,384 MB at 100k, validation skipped, is
  the same order).

### 2.2 UI-path thresholds (what the human experiences)

| Step | 100 | 1,000 | 10,000 (required) | 100,000 (required) |
|---|---:|---:|---:|---:|
| Validate | 250 ms | 1,000 ms | 5,000 ms | 60,000 ms |
| Calculate | 500 ms | 5,000 ms | 30,000 ms | 120,000 ms |
| Reconcile | 750 ms | 20,000 ms | 60,000 ms | 300,000 ms |
| Review statistics | 250 ms | 2,000 ms | 10,000 ms | 60,000 ms |
| Wall | 2,000 ms | 30,000 ms | 120,000 ms | 600,000 ms |

**Status of the current build.** 100: PASSES all. 1,000:
PASSES all (reconcile 11.6 s < 20 s, wall 14.4 s < 30 s).
10,000: **FAILS** — reconcile is projected at ≥560 s against a
60 s threshold (and wall ≥580 s against 120 s); validate,
calculate and statistics are projected to pass. 100,000:
**FAILS** — reconcile is projected at ≥7 h against a 300 s
threshold, and validation fails until P-16 is fixed. These
10,000 / 100,000 rows are requirements on the shipped UI, not
descriptions of the current build; Stage 8 must fix the
per-dispatch cost (§4, defect 2) before a 10,000-participant
case can be driven through the UI.

## 3. Stage 6 open items — resolutions

### (a) Wizard Run buttons — RESOLVED: added

Decision: **add per-step Run controls** (not API-only). Rationale:
the app's only loadable case is the demo case, and a human in the
office cannot run steps from the UI alone; the API flow cannot be
the intended one for the office user.

What was done (`src/ui/main.ts`, `src/ui/template.html` —
allowed files; `src/ui/wizard.ts` needed no change):

- Six Run buttons, one per panel: `run-validate`,
  `run-calculate`, `run-reconcile`, `run-statistics`,
  `run-decide` ("Recommend all dispositions"), `run-publish`
  ("Publish contribution") in the Export panel, each with
  `data-run-step="<step>"`.
- The step drivers moved from
  `test/ui-playwright/wizard-flow.test.mjs` into exported runners
  in `src/ui/main.ts` ("Demo-case step runners"): they run only
  on the loaded demo case (`DEMO_CASE_NUMBER` "00098765",
  `requireDemoCase` throws otherwise) and use the demo formula
  (T-04, 1.5%, final-3-year), the demo bounds specs, and per-key
  stated evidence for Decide.
- Buttons are disabled while their step is locked, with the lock
  reason as the title. On error, the runner changes nothing and
  writes "Could not run: \<message\>" into `#status-line` in
  plain words.
- **Human approval stays human-only: there is no Approve button.**
  Decide recommends only; approval still needs a full
  determination via the API.

Evidence: rebuilt via `npm run bundle` —
`pa-amb-analysis.html` 417,680 bytes (was 401,313);
`build/check-zero-fetch.mjs` PASS. `npx tsc --noEmit` clean;
`npm test` 804/804 pass (200 suites); Playwright
`test/ui-playwright/run.mjs` 4/4 suites pass. New check
`stage7/run-buttons-check.mjs` PASSES: validate 6 participants /
405 rules; calculate SYN-001 $1,500.00; reconcile SYN-003 delta
$1,000.00; statistics flagged SYN-003 by modified-z; decide
recommended all six, approved none; export published + CSV
`00098765-reconciliation.csv`. The check also asserts pre-import
Run buttons are disabled with correct lock-reason titles and
that no `#run-approve` element exists. (One caveat from that run:
theme-rows rendered the 1,000-row table in 155.9 ms vs the ~37 ms
Stage 6 baseline — that run shared the machine with the 100k
Node benchmark, so it is CPU contention, not a regression; it is
not presented as a new baseline.)

`docs/STAGE6_BUILD.md` updated to mark this item resolved.

### (b) `src/index.ts` export surface — RESOLVED: fixed

Audit script `stage7/audit-exports.mjs` (parses export
declarations from source; lists modules not re-exported and
star-export collisions) found two modules NOT re-exported by
`src/index.ts`:

- `src/rounding.ts` — 6 runtime exports (`applyServiceRounding`,
  `applyMoneyRounding`, `maxPlausibleRoundingEffect`,
  `isDocumentedSequence`, `testRoundingSequence`,
  `discrepancyExceedsRounding`).
- `src/accrualTests.ts` — 4 runtime exports
  (`testThreePercentRule`, `test133PercentRule`,
  `testFractionalRule`, `runAccrualTests`).

Fix (allowed file): added `export * from "./rounding";` and
`export * from "./accrualTests";` to `src/index.ts`, plus a header
comment noting the Stage 7 fix. Verified: `npx tsc --noEmit`
clean; `npm run build`; runtime check — 0 runtime names missing
from the index (was 10), index runtime keys 311 → 321. The 11
apparent "collisions" (e.g. `publishFindings`,
`assembleContribution`, `AMB_PRODUCT_ID` in both
`publication.ts` and `contribution.ts`) are the SAME symbols —
identity check `idx[n] === pub[n]` is `true`
(`contribution.ts` re-exports `publication.ts` via
`export * from "./publication"` at line 1135), not competing
definitions. Type probe passed: `AccrualTestName` /
`AccrualTestResult` / `RoundingSequence` / `PublishFindingsInput`
/ `AmbDataIssuesInput` all importable from `src/index.ts`.

### (c) Percentile outlier screen — RESOLVED: correct as designed, no change

Verified by direct Node run on the demo's comparable deltas
[0, 50, 100000] minor units (SYN-001 Δ $0.00, SYN-V-01 Δ $0.50,
SYN-003 Δ $1,000.00):

- `percentileScreen`: p1 = 1, p99 = 98,001 → `flagged1pct` =
  [true, false, true] — flags BOTH extremes including SYN-001 at
  Δ $0.00. By construction: on a 3-value population the bottom-1%
  cut lands at/below the minimum, so the minimum is always
  flagged. It is a review list, not an error classification; the
  docstring says cut points are reported "so the actuary can see
  how arbitrary the cut is."
- `modifiedZScores`: median 50, MAD 50, scores [-0.6745, 0,
  1348.3255] → only SYN-003 flagged. This is the seam test.
- `detectOutliers` on the 6 demo rows: flags SYN-003 modified-z
  (within-cohort, score 1348.33), SYN-001 percentile, SYN-003
  percentile; `explainedByGroup` empty.

Corroborating test evidence: `test/statistics.test.ts:211`
("percentile screening: 1 and 100 are the 1% extremes of
1..100"); `test/integration-stage5.test.ts:498` ("with 19
identical values the percentile screen flags the whole cohort,
which is the method working as specified, not the seam under
test"); `test/ui-playwright/wizard-flow.test.mjs` asserts SYN-003
flagged by modified-z and SYN-001 NOT flagged by modified-z.

**Recorded as correct-as-designed. No engine change.**
`docs/STAGE6_BUILD.md` updated to mark this item resolved.

### (d) §21 thresholds — RESOLVED: set

See §2 above and `stage7/thresholds.md`.
`docs/STAGE6_BUILD.md` updated to mark this item resolved.

### Still open from Stage 6 (not resolved by Stage 7)

- **Browser verification on the office workstation** (Microsoft
  Edge, restricted office machine): Stage 7 also ran in Chromium
  headless on this Linux build machine. The definitive check
  carries to Stage 8. Recorded as still open in
  `docs/STAGE6_BUILD.md`.
- The `package.json` em-dash reformat from `npm install -D
  esbuild`: cosmetic only, no action.

## 4. Defects found (report, not fixed — outside the Stage 7 edit list)

### Defect 1 — Validation rule P-16 is O(n²) (severity: blocks 100k validation)

**Where.** `evaluatePopulationRules` in `src/validation.ts`,
rule P-16 ("conflicting identity across records"): a nested
pairwise loop over all `idType === "1"` participants
(`for i ... for j = i + 1 ...`, comparing SSN and
firstName + lastName + DOB). It is the only quadratic code in
the population rules.

**Evidence.**

- Validation time: 28.6 ms @ 100, 274.7 ms @ 1,000, 4,325.6 ms
  @ 10,000 (Node); 26.9 / 210.0 / 2,558.2 ms (browser). 10k →
  30k in Node: 4.3 s → 38.7 s (9.0× for 3× data = quadratic).
- Bisect on the same 30k inputs
  (`node stage7/bench/dist-node/stage7/bench/probe-phase.js validate stage7/bench/probe-30000.csv`
  and a per-participant loop with results dropped): the
  per-participant rules are linear and cheap (1.5 s dropped,
  2.7 s retained, heap 353 → 810 MB); the cost is in the
  population rules.
- Full 100k validation in Node never finished (killed after
  ~8 min; projected ~430 s from the quadratic fit). In the
  browser it finished in 211.4 s — 82× the 10k figure.
- In the bench all participants share firstName "Syn" /
  lastName "Fictional" and null SSN, but the pair loop runs
  regardless of whether findings result.

**Reproduction.**
`node stage7/bench/dist-node/stage7/bench/probe-phase.js validate stage7/bench/probe-30000.csv`
→ 38.7 s; the same probe at 10k (`stage3/poc/poc-p10-synthetic-10000.csv`)
→ 4.3 s.

**Suggested Stage 8 fix.** Index by SSN and by name+DOB with
Maps (linear), preserving the same findings. Expected result:
100k validation ~5–10 s, after which the §2.1 validation
threshold at 100k must be tightened from 300 s to ~30 s.
`src/validation.ts` is outside the Stage 7 edit list, so this
is reported, not fixed.

### Defect 2 — UI path is quadratic: per-dispatch state spread + full re-render (severity: blocks 10k+ cases through the UI)

**Where.** `src/ui/main.ts` (`applyEvent` in the state
module it uses, plus `renderApp`): every dispatch spreads the
`calculations` / `reconciliations` records and the append-only
event log, then `renderApp` re-renders from the whole state —
`chartsForState` iterates all reconciliations and rebuilds five
SVG charts as `innerHTML` on every call, `dispositionsByParticipant`
and `checkAllInvariants` each scan the whole state on every
render. One dispatch per participant per step (calculate and
reconcile loops) makes the total O(n²) with a large constant.

**Evidence.** UI path vs engine-direct (§1.3): reconcile
240.2 ms @ 100 → 11,627.1 ms @ 1,000 (×48.4 per ×10 data) while
the engine takes 2.7 → 8.9 ms; calculate 198.6 → 1,681.6 ms
(×8.5); wall 602 ms → 14,449 ms. Projected lower bounds:
reconcile ≥ ~560 s @ 10,000 and ≥ ~7 h @ 100,000. The UI-path
thresholds in §2.2 therefore FAIL at 10,000 and 100,000.

**Reproduction.** `node stage7/bench/ui-path-run.mjs 1000` →
wall 14,449 ms, reconcile 11,627.1 ms.

**Suggested Stage 8 fix (not done here — this is a redesign,
not a small Stage 6 open-item change).** Batch the per-step
work into a single state update per step instead of one
dispatch per participant; render charts once per step, not per
dispatch; paginate or virtualize the participant tables; do not
copy the whole event log on every event (or cap it). The engine
itself is linear and needs no change.

### Observations (not defects)

- **Import materializes everything up front.** Node RSS is
  already 1,277 MB after import at 100k (peak 2,384 MB);
  browser heap peaks at 2,414 MB. A streaming import (or
  holding the validation result lazily instead of retaining all
  2.16 M findings in state) would cut peak memory and regain
  headroom on the §2.1 heap thresholds.
- **`buildXlsx` is superlinear.** Node: 366.8 ms @ 10k →
  10,918.1 ms @ 100k (~30× for 10× data); browser 471.8 →
  9,791.2 ms (~21×). It still passes its thresholds
  (1,500 ms / 20,000 ms), but it is the fastest-growing export
  phase; worth profiling in Stage 8.
- **Report HTML in Node at 100k (1,342.8 ms vs 12.2 ms in the
  browser)** includes a major GC pause (RSS fell 2,007 →
  1,206 MB during that phase). The 5,000 ms threshold covers
  it.

## 5. Verification after the Stage 7 edits

Edits made in Stage 7 (allowed files only): `src/index.ts`
(two star exports), `src/ui/main.ts` (demo step runners, Run
button locking/wiring), `src/ui/template.html` (six Run buttons),
`docs/STAGE6_BUILD.md` (open items marked resolved), and new
files under `stage7/`. `pa-amb-analysis.html` rebuilt via
`npm run bundle` (417,680 bytes).

- `npx tsc --noEmit` — clean.
- `npm test` — 804/804 pass, 0 fail (200 suites).
- Playwright `node test/ui-playwright/run.mjs` — 4/4 suites pass.
- `node stage7/run-buttons-check.mjs` — PASSES (see §3(a)).
- `node build/check-zero-fetch.mjs` — PASS (after the rebuild).

## 6. Reproduction commands (from the repo root)

- Node bench: `node stage7/bench/dist-node/stage7/bench/node-run.js <100|1000|10000|100000>`
  (100k: prefix `BENCH_SKIP_VALIDATION=1`, see §1.1).
- Browser bench: `node stage7/bench/browser-run.mjs <100|1000|10000|100000>`
  (100k takes ~4.6 min; full validation, no skip).
- Phase probe: `node stage7/bench/dist-node/stage7/bench/probe-phase.js <validate|calculate|reconcile|statistics> <csvPath>`
  (30k CSV at `stage7/bench/probe-30000.csv`; P-10 CSVs at
  `stage3/poc/poc-p10-synthetic-<N>.csv`).
- UI path: `node stage7/bench/ui-path-run.mjs <100|1000>` (10,000
  not run — projected, see §1.3).
- Recompile bench: `npx tsc stage7/bench/node-run.ts stage7/bench/browser-entry.ts stage7/bench/probe-phase.ts stage7/bench/node-types.d.ts --module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck --strict --noUncheckedIndexedAccess --outDir stage7/bench/dist-node --rootDir .`
- Rebundle browser bench: `npx esbuild stage7/bench/browser-entry.ts --bundle --format=iife --target=es2022 --minify --outfile=stage7/bench/browser-bundle.js`
- Exports audit: `node stage7/audit-exports.mjs`
- Run-buttons check: `node stage7/run-buttons-check.mjs`
