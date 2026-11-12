# Stage 7 — End-to-End Verification Report

**Project:** PA_AMB Analysis System (ErChulo/pbgc-pa-amb-analysis)
**Date:** 2026-11-12
**System verified:** `pa-amb-analysis.html` (452,219 bytes, single self-contained HTML file, 0 fetch), TypeScript engine + UI in `src/`
**Commits:** Stage 4 `375e81b`, Stage 4.5 `dc1317a`, Stage 5 `45f4c6b`, Stage 6 `b3afc3c`, Stage 7 fixes `78486a3` (local, NOT pushed)
**Environment:** Linux VM, Node v24.22.1, Chromium 158 headless (Playwright 1.65.0), `file://`, 1.5 shared CPUs, ~6 GB RAM
**Governing spec:** MASTER_PROMPT.md §19 (security), §20 (verification), §21 (performance), §23 Stage 7

## 0. Overall verdict: CONDITIONAL PASS

Every check that can be run on this machine passes after the fix pass. The system is verified in Chromium on Linux. Three items remain outstanding and are named in §9 — the definitive Edge test on the office workstation, XLSX import (Stage 8), and the UI-path run at 100,000 participants (not run, only projected). Do not claim production readiness on unit tests alone (§20); this report is the evidence, and the outstanding items are part of it.

| Area | Verdict before fixes | Verdict after fixes | Evidence |
|---|---|---|---|
| Accuracy | CONDITIONAL PASS | PASS | §1; `stage7/04-accuracy-browser.mjs` 44/44 |
| Robustness | NOT ROBUST | PASS | §2; Node 42/42, browser 9/9 |
| Reproducibility | FAIL as shipped | PASS | §3; byte-identical A/B/C |
| Compliance | NOT YET COMPLIANT | PASS | §4; static 48/48, Playwright 41/41 |
| Benchmarks (§21) | Engine-direct pass; UI path fail at 10k+ | PASS (UI-path 100k not run) | §5; `stage7/thresholds.md` |
| Stage 6 open items | 4 open | All resolved | §6 |

Final re-runs by the coordinator (2026-11-12, after the fix commit): `npx tsc --noEmit` clean; `npm test` **847 pass, 0 fail, 210 suites**; Playwright UI suite **4/4**; `build/check-zero-fetch.mjs` PASS; build gate PASS.

## 1. Accuracy — PASS

**Method:** every worked example re-run end-to-end through the single HTML file in the browser (Playwright, `file://`), not just in Node. New script `stage7/04-accuracy-browser.mjs` — **44/44 checks pass** (results in `stage7/04-accuracy-browser-results.json`). `npm test` 847/847; UI suites 4/4.

| Worked example | Expected | Browser result | Verdict |
|---|---|---|---|
| SYN-001 | $1,500.00 exact, 18-step trace, all 10 stages, Δ $0, Verified | exact, trace complete, Verified | PASS |
| SYN-002 | bounds $1,584.00–$1,683.00, recorded $1,620 inside | bounds match, $1,620 inside | PASS |
| Harborview timeline | $1,067.50 vs $1,232.50, Δ +$165.00 | match; counterfactual (3 extra years at $55) reproduces $1,232.50 exactly and stays a hypothesis, no disposition recorded | PASS |
| SYN-V-01 | $850.00 vs $849.50, Δ +$0.50, approved, PA_AMB_ACCEPT "Y" | values match, approved, "Y" | PASS on values (see D-ACC-1) |
| SYN-I-01 | scenario bounds $1,500–$1,560 and $1,250–$1,300, recorded $1,120 outside both, no Δ, 3 requests prioritised 1/2/3, approval refused | match; exhausted-search approval succeeds with PA_AMB_ACCEPT "N" | PASS |

**Population ground truth — PASS.** 1,000/1,000 browser rows match Node exactly; outliers flagged exactly **400 (150 service + 150 averaging + 100 vesting)**, identical flag sets, median Δ = 0, MAD = 24.5. Browser run 1,577 ms. (Node ground-truth dump in `stage7/population-node.json`.)

**§20 coverage.** The coverage table in `stage7/01-accuracy.md` §3 checks every §20 item (every formula; amendments; grandfathered/frozen; multiple employment periods; short/long service; missing compensation; unknown-date amounts; rounding conventions; service-credit errors; SS integration; cash balance; vesting errors; above/below reconstructed; unusual-but-valid; ordinary-looking incorrect records). Two gaps were found and fixed in the fix pass: G-ACC-5 (added a test with a materially incorrect record the statistical screen misses — a +$220 error missed by robust-z/Tukey but caught by reconciliation) and G-ACC-6 (Stage 1 table A-101–A-104 now reproduced by name in `test/reconcile.test.ts`; DB Answer Book question numbers for all 34 formulas in `test/formulas.test.ts`).

**Defects found and fixed:**
- **D-ACC-1:** demo SYN-V-01 labelled hypothesis H15 "supported" with no citable rule — the demo plan's prescribed rounding (nearest cent, §5.01) leaves $849.50 unchanged; the nearest-dollar rule that would explain the $0.50 lives in a different fixture. Fix: H15 demoted to `plausible`, `material: false` (never invent a rule); Verified rests on tolerance alone.
- **G-ACC-2:** `selectProvisionsByDate`, `evaluateFormulaCall`, `testCounterfactual`, `rankCounterfactuals` were not exposed on `window.PaAmbApp`. Fix: all four now exposed in `build/entry.ts`.
- **G-ACC-4 (browser vs Node recommendation divergence):** root cause ran deeper than the first reading ("browser never ran counterfactuals"). Two engine gaps found and fixed, both grounded in the methodology's own rules (Stage 1 output 03 §2.6/§2.7/§4.7): (a) `validateCounterfactualSupport` (`src/reconciliation.ts`) now promotes Plausible → Supported on cohort-wide resolution with zero residual; (b) `recommendDisposition` (`src/reconcile.ts`) now recommends correction-recommended when a Supported, undocumented, cohort-resolving counterfactual reproduces the recorded amount. The documented-mechanism requirement is load-bearing: Harborview (documented extra service) still returns requires-investigation. After the fix, browser agrees with the Node oracle on every exact cohort (clean verified 400, service/averaging correction-recommended 150 each, rounding verified 100, vesting requires-investigation 100). The bounds-inside divergence stands as determined: the oracle ignores bound width, the engine applies documented §4.7.
- **G-ACC-3:** no CSV import existed, so the population was driven via the in-page engine API. Resolved by the import surface built for robustness D3 (§2).

Full detail: `stage7/01-accuracy.md`.

## 2. Robustness — PASS (was NOT ROBUST)

**Method:** 42 Node engine probes (`stage7/robustness-node.mjs`) + 9 browser probes (`stage7/robustness-browser.mjs`), shared builders in `stage7/fixtures.mjs`. Before fixes: Node 38/42, browser 4/9. After fixes, re-run by the coordinator: **Node 42/42, browser 9/9.** Baseline `npm test` 847/847 — the defects below were all in behaviour the existing suite did not cover. **No crash anywhere, no made-up exact number anywhere** — in the pre-fix runs or the post-fix runs.

| Defect | Severity | What was wrong | Fix |
|---|---|---|---|
| D1 — impossible calendar dates | HIGH | `dob` = `2020-02-30`, `2021-02-29`, `2020-13-01` passed S-07 and P-02 with no finding. `ruleS07` only read the caller-supplied `badDates` array and never inspected date fields; P-02 compared strings lexicographically. | `src/validation.ts`: S-07 now validates real calendar dates in every date field; P-02 parses dates (day numbers); P-03/P-04 guarded. |
| D2 — wrong-typed NUMBER values | HIGH | `paAmb = "150000"` (string) passed S-08; C-02 threw inside `formatMoneyMinor` and was swallowed to `not-run`/`Info`. `ruleS08` only read `badNumbers`; no rule type-checked numeric fields. | `src/validation.ts`: S-08 type-checks numeric fields; C-02 returns a fail finding naming the types instead of throwing; throw-catcher severity Info → Error. |
| D3 — no file-import surface | HIGH (scope) | 0 file inputs, 0 `FileReader`, no CSV/XLSX/JSON parser; the Import step was demo-button only, despite MASTER_PROMPT §6 requiring CSV/XLSX/XLSM/JSON. Malformed-file and import-interaction cases were untestable through the UI. | New `src/ui/import.ts` (~800 lines): CSV + JSON import (parse, quarantine, refuse — never crash); `importFileText()` in `src/ui/main.ts`; file picker + status + help in `template.html`. XLSX **not implemented** — exact gap is a missing DEFLATE/inflate decoder; refused with that reason (Stage 8 item, §9). |
| D4 — re-import leaves wizard inconsistent | MEDIUM | After import → validate → re-import, `validation` was cleared but `wizard.completed.validate` stayed `true`, so Calculate was enabled with no validation in state. | `src/ui/state.ts`: import resets all wizard completion flags. |

What was already sound (verified, not changed): missing-data discipline (blanks stay null, never zero), denominator flags, leap-day refusal, boundary handling (plan-version boundaries, freeze dates, DOTE = DOPT, NRD = DOTE, single-day and 100-year service, §415/§401(a)(17) boundaries).

Full detail: `stage7/02-robustness.md`.

## 3. Reproducibility — PASS (was FAIL as shipped)

**Method:** deterministic rebuild (G12) — same input snapshot + same rule versions + same calculation date, run twice/thrice, every output compared byte-for-byte (sha256). Scripts under `stage7/03-repro-*.mjs` (+ `03-repro-flow-driver.js`), evidence in `stage7/runs/`.

| Check | Result |
|---|---|
| Harborview demo, Node (3 runs: 2 in-process + 1 fresh process) | All 17 artifacts identical |
| Browser vs browser (fixed timestamps) | All 20 artifacts identical, 0 http requests |
| Browser vs Node | Identical on the fixed build (see D1) |
| Synthetic 100-participant case, Node ×3 | Identical; ground truth exact (70× Δ0, 10× +$1,000, 10× −$50, 10× +$0.50) |
| Statistics (isolation forest, Bayesian, GAM, k-fold CV, decision tree) | Identical across 3 runs, explicit and default seeds; forest flags exactly 5/100 at 5% contamination |
| `mergeLogs` | 25 checks pass — associative, first-seen order, dedup, conflict escalation — but **not commutative** (order must be pinned for G12) |
| Charts / report HTML | Byte-identical across browser runs |
| Contribution package determinism | PASS (with the order note above) |

**Nondeterminism hunt:** no `Math.random` / `Date.now` in the engine; the only mutable global is the pipeline step counter, contained (reset per run, proven by identical in-process repeats); tie-able sorts are stable and deterministic. One latent smell noted and fixed: `pipeline.ts:556` comparator never returned 0 — now returns 0 on tie.

| Defect | Severity | What was wrong | Fix |
|---|---|---|---|
| D1 — build corrupts the bundle | CRITICAL | `build/bundle.mjs:72-73` used `String.replace` with string replacements, so `$$` collapsed to `$`. Proven byte-exact (fresh esbuild output with `$$`→`$` applied equals the shipped bundle). 12 sites: every `$X.XX` money string lost its `$` (validation findings, contribution statements, reports), and the XLSX print area `$A$1:$H$7` → `$A$1:H7`. This was the sole cause of all 10 browser-vs-Node diffs. | Replacements now use functions `() => ...`; new build gate fails the build if the inlined bundle ≠ esbuild output or `$$` counts differ. Rebuilt app: 452,219 bytes. Coordinator verified: `$$` survives in the shipped HTML (12 occurrences); browser==Node parity confirmed by the repro scripts. |
| D2 — audit completeness | (same as compliance D1) | Exported audit log held only the 7 disposition events; calculations, validation (405 rules), reconciliations, statistics, import, and publication lived only in the never-exported event log (30 events). No production code dispatched the existing `calculation-event` audit kind; UI-level refusals never reached the audit log. | `src/ui/state.ts`: `applyEvent` now audits step completions (`calculation-run`), imports, and refusals (`transition-refused`). Exported log: 7 → 23 events (verified in the coordinator's Playwright re-run). |
| D3 — no fixed-calculation-date mode | MEDIUM | The only clock read was UI `nowIso()`; hand-driven runs differed in event-log timestamps; the Stage 6 test driver embedded `Date.now()` in propose/approve eventIds, which flow into audit event IDs. | `src/ui/state.ts` + `main.ts` + `template.html`: pinned `#calculation-date` input; `calculationTimestamp()`; deterministic propose/approve eventIds (fixed strings, no `Date.now()`). |

Full detail: `stage7/03-reproducibility.md`.

## 4. Compliance — PASS (was NOT YET COMPLIANT)

**Method:** 48 static checks (`stage7/01-static-compliance.mjs`) + 41 live Playwright checks (`stage7/02-playwright-compliance.mjs`, results in `stage7/02-playwright-results.json`). Before fixes: static 46/48, Playwright 37/41. After fixes, re-run by the coordinator: **static 48/48, Playwright 41/41.** `tsc` clean; `npm test` 847/847; UI suite 4/4.

| Check | Verdict | Evidence |
|---|---|---|
| Single self-contained HTML via `file://` | PASS | 1 inline script, 0 external refs, 0 `https://` |
| 0 fetch | PASS | Static gate passes; live: 2 requests total across load/reload/full wizard run, both `file://`, 0 http/https |
| No LLM in the calculation path | PASS | No network/LLM code; calculation run twice byte-identical; no clock/random in engine |
| No network/CDN/external packages | PASS | devDeps only typescript 5.9.3 + esbuild 0.28.2 (build-machine only), Playwright test-only; no telemetry, no WASM/worker/OPFS/IndexedDB — Stage 3 §2.2 honoured |
| Human approval gate | PASS (after D3 fix) | Gate held against every attack (actor `system`/empty, reviewer `system`/mismatch, false confirmations, empty rationale, approve-without-recommendation — all refused) |
| Mandatory audit log | PASS (after D1/D2 fix) | Exported log now holds calculation, validation, reconciliation, statistics, import, publication, decision, approval, and refusal events (23 events on the demo case) |
| Synthetic data only | PASS | Fictional One–Six, SYN keys, SSN null, 0 SSN patterns |
| §19 security | PASS (after D2 fix) | Local-only, no telemetry/analytics/remote reporting/auto-uploads/CDN; explicit import/export control; sensitive-export warning on all four exports |
| Defensive loading | PASS | Only `localStorage` use is guarded `safeStorage()` in `theme.ts`; re-run passes in vm + Playwright with throwing `localStorage` |

| Defect | Severity | What was wrong | Fix |
|---|---|---|---|
| D1 — audit log missing calculation events | MAJOR | Exported audit log held exactly the 7 Stage 6 events (6 proposes + 1 approval), 0 calculation events. | See §3 D2 — `applyEvent` audits step completions, imports, refusals. |
| D2 — §19 warning missing on two exports | MAJOR | CSV/XLSX exports showed the exact warning dialog (verified live; dismissing blocks the download), but audit-log and contribution exports downloaded with no warning at all. | `src/ui/main.ts`: new `downloadAuditLogJson()` + gated `downloadContributionJson()`, both on `reviewerConfirmsSensitiveExport()` like CSV/XLSX. |
| D3 — T3 disposition mismatch | MINOR | The gate held, but T3 applied an approval for SYN-003 (`requires-investigation`) carrying a determination that says `verified` — no check that the determination's disposition matches the current disposition. No valuation leak (downstream use stays blocked). | `src/decisions.ts`: T3 refuses when the determination's disposition differs from the one being approved (guard `entry-conditions`). |

Full detail: `stage7/04-compliance.md`.

## 5. Benchmarks (§21) — PASS, thresholds set

**Method:** representative fictional populations of 100 / 1,000 / 10,000 / 100,000 participants, engine-direct in Node and in the browser (Chromium 158 headless, `file://`), plus the UI path through `window.PaAmbApp` + dispatch + render. Machine: this Linux VM (1.5 shared CPUs, ~6 GB RAM). Scripts and raw results in `stage7/bench/`. Thresholds in `stage7/thresholds.md` (baseline = slower of Node/browser, headroom ~2–3× at 100–10k, ~1.3–1.9× at 100k).

**Engine-direct (Node / browser), before the fix pass:** 100 → 142 / 187 ms; 1,000 → 1,023 / 1,062 ms; 10,000 → 10,842 / 8,784 ms; 100,000 → Node 82,596 ms with validation skipped (never finished), browser 278,635 ms (4.6 min, full run). Counts match the P-10 baseline exactly at every size (exact 95,023 / bounds 4,977 at 100k).

**UI path (before the fix pass):** 100 → 602 ms; 1,000 → 14,449 ms (reconcile alone 11.6 s vs 9 ms engine-direct); 10,000/100,000 projected, not run (reconcile ≥560 s / ≥7 h).

**Defects found and fixed:**
- **P-16 validation is O(n²)** (`src/validation.ts`): 4.3 s @10k → 38.7 s @30k → 211 s browser / ~430 s projected Node @100k. Fix: Map-indexed by SSN and name+DOB. After fix: Node validate 10k 4.6 s / **100k 18.1 s** (rules 6,600,009; findings 2,160,136; heap 2,621 MB), browser validate 10k 1.5 s / **100k 11.8 s** (wall 71.3 s). 100k validation threshold tightened 300 s → 30 s in `stage7/thresholds.md`. Note: the Node 100k probe needs `--max-old-space-size=4096` — the default 2 GB heap OOMs (heap 2,621 MB, inside the 3,000 MB threshold).
- **UI path is quadratic:** per-dispatch state spread + full re-render (`renderApp` rebuilt all 5 charts from all reconciliations on every dispatch). Fix: `applyBatch()` + `dispatchMany()` (one render per step). After fix: UI-path 1,000 wall 1.1 s; **10,000 wall 9.0 s** (validate 1.1 s, calculate 3.8 s, reconcile 0.8 s, statistics 2.7 s) — all inside the §21 thresholds.

**Current build status (from `stage7/thresholds.md`):** passes every engine-direct cell in both engines at all sizes; UI path passes at 100 / 1,000 / 10,000. UI path at 100,000 **not run** (projected, not measured — see §9).

Full detail: `stage7/05-benchmarks-open-items.md`, `stage7/thresholds.md`.

## 6. Stage 6 open items — all resolved

| Item | Resolution |
|---|---|
| (a) Wizard Run buttons | **Added.** Six per-step buttons in `src/ui/template.html` + `src/ui/main.ts`, demo-case scoped. No Approve button — approval stays human-only. Verified by `stage7/run-buttons-check.mjs` (405 rules / 145 findings; SYN-001 $1,500.00; SYN-003 Δ $1,000.00). |
| (b) `src/index.ts` export surface | **Fixed.** `rounding.ts` (6 exports) and `accrualTests.ts` (4 exports) were missing; both star exports added. 0 runtime names missing now (was 10). The 11 "collisions" are identity-equal re-exports, not competing definitions. |
| (c) Percentile outlier screen | **Correct as designed, no change.** On 3 deltas it flags both extremes (SYN-001 at Δ $0.00 included) by construction; modified-z is the seam test (only SYN-003). Test evidence cited in `stage7/05-benchmarks-open-items.md`. |
| (d) §21 thresholds | **Set** (§5; `stage7/thresholds.md`). |

## 7. Defects fixed — full list (17)

| # | Defect | Severity | Fix (file) |
|---|---|---|---|
| 1 | Build corrupts bundle (`$$` → `$`) | CRITICAL | `build/bundle.mjs` — replacement functions + build gate |
| 2 | Audit log missing calculation events | MAJOR | `src/ui/state.ts` — `applyEvent` audits step completions, imports, refusals |
| 3 | §19 warning missing on 2 exports | MAJOR | `src/ui/main.ts` — gated `downloadAuditLogJson()` / `downloadContributionJson()` |
| 4 | T3 disposition mismatch | MINOR | `src/decisions.ts` — T3 refuses on mismatch |
| 5 | Impossible calendar dates accepted | HIGH | `src/validation.ts` — S-07 validates real dates; P-02 parses dates |
| 6 | Wrong-typed NUMBER values accepted | HIGH | `src/validation.ts` — S-08 type-checks numerics; C-02 fails naming types |
| 7 | No file-import surface | HIGH (scope) | New `src/ui/import.ts` — CSV + JSON import; XLSX outstanding (§9) |
| 8 | Re-import leaves wizard inconsistent | MEDIUM | `src/ui/state.ts` — import resets completion flags |
| 9 | H15 "supported" with no citable rule | — | Demo SYN-V-01 H15 demoted to `plausible`, `material: false` |
| 10 | 4 engine functions unexposed | — | `build/entry.ts` — exposed on `window.PaAmbApp` |
| 11 | Browser vs Node recommendation divergence | — | `src/reconciliation.ts` + `src/reconcile.ts` — cohort-resolution promotion; correction-recommended on Supported reproducing counterfactual |
| 12 | §20 "ordinary-looking incorrect record" untested | — | New test: +$220 error missed by robust-z/Tukey, caught by reconciliation |
| 13 | §20 citations (A-101–A-104, DBAB numbers) | — | `test/reconcile.test.ts`, `test/formulas.test.ts` |
| 14 | No fixed-calculation-date mode | MEDIUM | Pinned `#calculation-date` input; deterministic eventIds |
| 15 | P-16 validation O(n²) | — | `src/validation.ts` — Map-indexed |
| 16 | UI path quadratic | — | `src/ui/state.ts` `applyBatch()` + `dispatchMany()` |
| 17 | `pipeline.ts:556` comparator never returns 0 | latent | Returns 0 on tie |

Fix pass detail: `stage7/06-stage7-fixes.md`. Fix commit: `78486a3` ("Stage 7: fix all verification defects…"), working tree clean, NOT pushed.

## 8. Final verification runs (coordinator, after the fix commit)

- `npx tsc --noEmit`: clean, exit 0.
- `npm test`: **847 pass, 0 fail, 210 suites** (was 804; +43 new tests, incl. `test/stage7-fixes.test.ts` with 34).
- Playwright UI suite (`test/ui-playwright/run.mjs`): **4/4** — wizard-flow (SYN-001 $1,500.00 exact, SYN-003 Δ $1,000.00, SYN-001 verified/approved, exports intact, audit log 23 events), zero-fetch (2 requests, all `file://`), theme-rows (dark default, toggle, 1,000-row table 36.3 ms), defensive-loading (boots with throwing `localStorage`, no throw).
- `build/check-zero-fetch.mjs`: PASS (452,219 bytes).
- Static compliance (`stage7/01-static-compliance.mjs`): **ALL PASS (48/48)**.
- Playwright compliance (`stage7/02-playwright-compliance.mjs`): **ALL PASS (41 checks)**.
- Robustness Node (`stage7/robustness-node.mjs`): **42/42**. Robustness browser (`stage7/robustness-browser.mjs`): **9/9**.
- Accuracy browser (`stage7/04-accuracy-browser.mjs`): **44/44** — browser agrees with the Node oracle on every exact cohort.
- Reproducibility (`stage7/03-repro-node.mjs`, build driver): all artifacts byte-identical across runs A/B/C; build-driver regenerates identically; no `Date.now()` / `new Date()` / `performance.now` remains in the relevant paths.
- Benchmarks: browser 100k validation 11.8 s (was 211 s); UI-path 10,000 wall 9.0 s (was projected ≥580 s); Node 100k validation 18.1 s with `--max-old-space-size=4096` (documented in `stage7/06-stage7-fixes.md` §5).

## 9. Outstanding items (not closed by Stage 7)

1. **XLSX import (Stage 8).** Not implemented — the exact gap is a missing DEFLATE/inflate decoder. CSV + JSON import work; CSV is the interchange format. Recorded in `stage7/06-stage7-fixes.md` and the app's template help text. This is a §6 requirement (CSV/XLSX/XLSM/JSON) only partly met.
2. **Definitive Edge test on the office workstation.** All runs in this report were Linux Chromium 158 / Node v24.22.1. The Stage 3 exit criteria were satisfied in Chromium via Playwright, not yet in Edge. The user runs Edge at testing time (his testing machine), not at the office — the definitive test is Edge on his testing machine, using the Stage 3 run sheet (`stage3/01-poc-results.md` §6, carried over in `stage3/03-architecture-verdict.md` §3) plus a run of the shipped `pa-amb-analysis.html` (demo case end-to-end, 0 http/https requests, dark theme + toggle).
3. **UI path at 100,000 participants: not run.** Projected, not measured. Validation no longer blocks it, but the run itself has not been done.
4. **Node 100k full-pipeline validation needs `--max-old-space-size=4096`.** Default 2 GB heap OOMs (heap 2,621 MB, inside the 3,000 MB threshold). Recorded in `stage7/thresholds.md`.
5. **P2 Harborview note (check text only, no behaviour gap).** `evaluateFormulaCall` is now exposed, but the accuracy script still describes the direct $1,498.75 refutation as Node-only — the script text should be updated; the behaviour is verified.

## 10. Evidence index

| Evidence | Location |
|---|---|
| Accuracy report + browser script + results | `stage7/01-accuracy.md`, `stage7/04-accuracy-browser.mjs`, `stage7/04-accuracy-browser-results.json`, `stage7/population-node.json` |
| Robustness report + scripts | `stage7/02-robustness.md`, `stage7/robustness-node.mjs`, `stage7/robustness-browser.mjs`, `stage7/fixtures.mjs` |
| Reproducibility report + scripts + runs | `stage7/03-reproducibility.md`, `stage7/03-repro-*.mjs`, `stage7/03-repro-flow-driver.js`, `stage7/runs/` |
| Compliance report + scripts | `stage7/04-compliance.md`, `stage7/01-static-compliance.mjs`, `stage7/02-playwright-compliance.mjs`, `stage7/02-playwright-results.json` |
| Benchmarks report + thresholds + raw results | `stage7/05-benchmarks-open-items.md`, `stage7/thresholds.md`, `stage7/bench/` |
| Fix-pass report | `stage7/06-stage7-fixes.md` |
| Run-buttons check | `stage7/run-buttons-check.mjs`, `stage7/audit-exports.mjs` |

## 11. Conclusion

Stage 7 verified the complete PA_AMB system against the master prompt (§19–§21) and the Stage 1–6 requirements. Five verification workers found 17 defects across accuracy, robustness, reproducibility, compliance, and performance — including one critical build defect that stripped every `$` from money strings in the shipped file and one scope gap (no file import at all). All 17 were fixed, and every verification was re-run by the coordinator and passes: 847 Node tests, Playwright UI 4/4, static compliance 48/48, Playwright compliance 41/41, robustness 42/42 + 9/9, accuracy browser 44/44, byte-identical reproducible rebuilds, and §21 benchmarks inside thresholds at every measured size.

The system is verified in Chromium on Linux. What remains is the definitive Edge test on the user's testing machine, XLSX import (Stage 8), and the UI-path run at 100,000 participants. Stage 8 (Release) is not started.
