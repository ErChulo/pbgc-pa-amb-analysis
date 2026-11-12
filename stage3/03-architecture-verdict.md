# Stage 3 — Architecture Verdict (Option C, Staged)

**Project:** PBGC Prior Administrator Accrued Monthly Benefit (PA_AMB) Analysis System
**Repo:** ErChulo/pbgc-pa-amb-analysis (public, `main`). Local dir: `~/workspace/pbgc-pa-amb-analysis`.
**Date:** 2026-11-12
**Status:** Specification only. No engine, no UI, no full app. Nothing pushed, nothing written to Drive, no repo created.
**Governing spec:** `MASTER_PROMPT.md` (§16 architecture, §17 state-driven design, §18 UI, §19 security, §21 performance, §23 Stage 3).
**Basis:** `stage1/04-architecture-decision.md` (Stage 1 recommendation); `stage3/01-poc-results.md` (PoC P-01–P-10); `stage3/02-date-calculations.md` (date calculations and roundings); Stage 2 outputs 01–05.

---

## 0. Verdict in one paragraph

**Option C (Hybrid), staged, is confirmed as the recommendation — and the architecture is NOT confirmed.** The Stage 1 recommendation survives the PoC unchanged in direction: Stage 4 builds the deterministic core as pure TypeScript in Option A shape, with no WASM, no worker, no OPFS, and no browser storage in the critical path. What the PoC proved is the byte-level and Node-level half of that plan; what it did **not** prove is anything that only Edge under `file://` on the workstation-matching machine can show. The Stage 1 §10 exit criteria are **not yet satisfied** (see §1.3). The architecture is therefore **prepared for confirmation, not confirmed**. No product code may depend on an unproved capability until its live proof is recorded. A live failure of P-01, P-02, or P-03 costs nothing already built, because Stage 4 is scoped to Option A shape regardless of the live outcome.

---

## 1. Verdict on Option C (Hybrid), staged

### 1.1 What the PoC proved

| Item | Proved | Evidence |
|---|---|---|
| P-01 — base64-embedded WASM instantiates | **Mechanism PASS in Node only.** `add(2,3) = 5`, `add(-1,41) = 40`, from raw bytes via `WebAssembly.instantiate(bytes, {})`, no fetch, no MIME type. 41-byte module, 56 base64 chars. Instantiate 1.904 ms (first run; 0.395 ms warm), compile 0.122 ms. | `stage3/01-poc-results.md` §2, P-01; probe `stage3/poc/poc-p01-wasm-embed.html` (sha256 `be8cb358…`) |
| P-02 — realistic-size kernel practical embedded | **Size + compile PASS in Node only, at small scale.** Real Rust kernel (rustc 1.99.1, `--target wasm32-unknown-unknown -O --crate-type cdylib`, `#![no_std]`, no wasm-bindgen glue): 17,165 B raw / 22,888 base64 chars / 24,785 B HTML (base64 = 92.3% of the file). Compile 0.170 ms, instantiate 0.541 ms. `accrual_monthly_cents(150, 20000, 500000) = 150000n` — the Stage 2 §8 worked example (1.5% × 20.000 y × $5,000/mo = $1,500.00/mo) — correct; `delta_cents`, `sum_i64`, `count_outside` correct. | `stage3/01-poc-results.md` §2, P-02; `stage3/poc/kernel.rs`, `kernel.wasm` (sha256 `297c6e5d…`) |
| P-03 — blob-URL worker | **Source valid and logic proved in Node only.** Worker source 738 chars, parses as valid JS; ping→pong and WASM→5 proved in Node `worker_threads` (eval mode, `parentPort` shim). | `stage3/01-poc-results.md` §2, P-03; `stage3/poc/poc-p03-blob-worker.html` (sha256 `74919278…`) |
| P-06 — negative control | **PASS at spec level.** W3C WebAssembly Web API §2 (2025-11-14): `instantiateStreaming` rejects with `TypeError` unless the `Response` is CORS-same-origin, ok, and `application/wasm`; under `file://` there is no `Response` with headers and the page origin is `null`, so `fetch` of a local file is itself CORS-blocked and module scripts (always fetched in CORS mode) cannot import a relative file. | `stage3/01-poc-results.md` §2, P-06 |
| P-08 — 0 fetch | **PASS (static check only).** `poc-p08-check.js` (exit 0): 8 of 9 probe HTML files contain no external-reference pattern; `poc-p06-negative-control.html` contains only its expected forbidden attempts (the control is live). All 9 inline classic `<script>` blocks parse in Node's `vm`. | `stage3/01-poc-results.md` §2, P-08 |
| P-10 — 100,000-row import + calculation | **PASS in Node (§21 baseline).** 100,000 synthetic rows (6,305,426 B CSV): import 83.2 ms (10 × 10,000-row chunks) + calc/recon 15.8 ms = **98.9 ms**; peak RSS 138.5 MB. 95,023 exact / 4,977 bounds (5% missing average, as planted); 87,831 within the $5.00 PoC test tolerance / 7,192 outside; mean \|Δ\| $1.00, max \|Δ\| $20.00 — matching the planted ±$20 uniform discrepancy on ~10% of rows exactly. Same shape at 100 / 1,000 / 10,000 rows. | `stage3/01-poc-results.md` §2, P-10; `stage3/poc/poc-p10-100k.js` |
| Candidate stores | **Stage 1 REJECT verdicts confirmed by inspection.** SQLite-WASM 3.54.1-build1: `sqlite3.wasm` 868,907 B (identical to Stage 1's 3.53.4-build2 figure), gzip 402,022 B; stock loader is an ES module using `fetch` + `instantiateStreaming` — REJECT as a required component. DuckDB-WASM 1.29.0: `duckdb-mvp.wasm` 40,621,595 B (base64 54,162,127 chars → ~54 MB HTML), `duckdb-eh.wasm` 35,659,694 B — at/above Stage 1's ~17–40 MB range — REJECT. WebR 0.6.1: `R.wasm` 18,653,928 B, ES-module loader, default package repo `repo.r-wasm.org` — REJECT for the office deliverable. | `stage3/01-poc-results.md` §3 |
| SharedArrayBuffer / multithreading | **SETTLED: unavailable under `file://`.** No experiment needed. Cross-origin isolation requires COOP `same-origin` + COEP `require-corp`/`credentialless` HTTP headers; a `file://` page has no server and no headers, so `crossOriginIsolated` is `false` and `SharedArrayBuffer` is not exposed (MDN, `WorkerGlobalScope.crossOriginIsolated`). No threaded WASM build, no `SharedArrayBuffer` sharing, no Atomics-based worker pool. Single-threaded by design. | `stage3/01-poc-results.md` §4 |
| Date primitives and service | **58/58 Node checks pass.** Days-since-epoch (Int32, UTC, no local-time conversion), days-between (exclusive start / inclusive end), completed-years age, month-end clamping (non-sticky), Gregorian leap rule, `completedYMD` calendar decomposition, month/year-boundary primitives — all verified in `stage3/date-primitives-harness.js` (Node v24.22.1), day counts cross-checked against GNU `date`. The Stage 2 worked example re-derives exactly under the St. Rose §3.2(b) months rule (24.25 / 17.75 / 6.5), and not under days/365 (24.2767 / 17.7479 / 6.4986). OD-2 resolved: canonical service form is `DecimalString`, rational retained alongside (decision D-5.1). | `stage3/02-date-calculations.md` §§1, 2.5, 5.5, App. A |

### 1.2 What the PoC did NOT prove — and what depends on the live Edge `file://` test

Nothing below is a failure. Each item is unmeasured in the only environment that can measure it. Stage 4 must not depend on any of them.

| Item | Not proved | Depends on live test |
|---|---|---|
| P-01 | Whether Edge under `file://` instantiates a base64-embedded module (the Stage 1 pass criterion: `add(2,3) === 5`, no console error, no flags, repeat after restart). Node proves the bytes and the mechanism, not the browser. | Live P-01 (§3, step 1) |
| P-02 | Whether the 24,785 B probe HTML stays openable and interactive in Edge, and what compile time is on office hardware. The kernel measured is five small functions; a full §11 statistical kernel is larger and unmeasured (see §1.4). | Live P-02 (§3, step 2) |
| P-03 | Whether a blob-URL worker starts at all in Edge under `file://` on the restricted workstation, with its group policy. | Live P-03 (§3, step 3) |
| P-04 | Anything about OPFS. Node has no `navigator.storage`; no result is claimed. Includes restart survival and per-path vs shared origin keying. | Live P-04 (§3, step 4) |
| P-05 | Anything about localStorage / IndexedDB under `file://` in Edge. Node has neither. Includes restart survival, rename/move survival, and whether another local HTML file can read the marker. | Live P-05 (§3, step 5) |
| P-06 | Environment confirmation only — the spec fact is confirmed, but the live test must confirm the environment matches the documented model (all four attempts fail with CORS/MIME errors). **If any succeeds live, stop and re-check the setup before trusting any other result.** | Live P-06 (§3, step 6) |
| P-07 | Whether export-by-download works in Edge under `file://`. The pattern is the prior generators' proven one (R5/DEL/436/PF/E.Adm/E.Adj), and the probe's script parses cleanly, but no download was executed on this machine. A failure here would contradict that precedent and would force an export redesign before any product work. | Live P-07 (§3, step 7) |
| P-08 | Live network count. A static grep cannot prove zero runtime requests (a script could construct a URL dynamically). DevTools Network must read 0 on reload. | Live P-08 (§3, step 8) |
| P-09 | Both-themes render, toggle behaviour, contrast, and the 1,000-row render in Edge. Static checks pass (dark default, toggle code, 1,000-row loop, math sample, no external references); no render timing was measured. A failure here fixes the theme implementation; it does not block the core. | Live P-09 (§3, step 9) |
| P-10 | Edge timing and memory. The Node baseline (98.9 ms, 138.5 MB peak RSS at 100k) is a build-machine measurement, not an Edge `file://` measurement on office hardware. The harness also reads the whole CSV with `readFileSync` and chunks only the parse loop — a true streaming reader was not used, so the import time is a parse-time baseline, not a streaming-I/O baseline. The calculation is one representative formula (unit-credit); the full 34-formula catalog, validation, statistics, and report generation are not timed. | Live P-10 (§3, step 10) |

### 1.3 Exit criteria — satisfied in Chromium, not yet in Edge

Stage 1 §10: the architecture is confirmed if **P-01 (or its documented failure, with the Option A fallback) + P-06 + P-07 + P-08 + P-10 are recorded**.

| Exit item | Recorded? |
|---|---|
| P-01 | **Recorded (Chromium live, 2026-11-12)** — `add(2,3)=5`, 6.20 ms first launch, 9.70 ms after restart, no errors. Edge outcome not yet recorded. |
| P-06 | **Recorded (Chromium live, 2026-11-12)** — all four attempts failed with CORS/fetch errors; no stop condition. Edge confirmation not yet recorded. |
| P-07 | **Recorded (Chromium live, 2026-11-12)** — both downloads arrived intact with correct names and contents. Edge confirmation not yet recorded. |
| P-08 | **Recorded (Chromium live, 2026-11-12)** — 0 http/https requests on both pages, load + reload. Edge confirmation not yet recorded. |
| P-10 | **Recorded (Chromium live, 2026-11-12)** — import 117.7 ms, calc 18.2 ms, total 135.9 ms; counts identical to Node; browser RSS peak 103.9 MB. Edge baseline not yet recorded. |
| P-04 (not an exit item) | **Recorded as FAIL (Chromium live, 2026-11-12)** — OPFS `getDirectory()` throws SecurityError under `file://`; OPFS is not used at all, not even as a session cache. |

**Assessment: the exit criteria are satisfied in a live Chromium `file://` browser (Playwright 1.65.0, Chromium 158.0.8127.18, Linux — full record in `01-poc-results.md` §11). They are NOT yet satisfied as written (Edge on the restricted workstation).** The architecture (Option C, staged) is confirmed for Chromium; the definitive Edge-on-Windows confirmation still stands as the final step. Stage 4 is scoped to build the deterministic core in the Option A shape (pure TypeScript, no WASM, no workers) regardless, so Stage 4 may proceed on the confirmed foundations; the WASM/worker path remains gated on the Edge confirmation. P-04's failure removes OPFS from the architecture entirely (it was only ever a candidate session cache).

### 1.4 Did any PoC result force a change to the Stage 1 recommendation?

**No change in direction. Three corrections and one tightening, all recorded here so Stage 4/5 do not build on the Stage 1 figures as stated.**

1. **wasm-bindgen glue size is unmeasured — do not use the Stage 1 figure in any estimate.** Stage 1 cited "~10–20 KB" of wasm-bindgen glue from secondary sources. The PoC kernel was built with `rustc` directly (`--target wasm32-unknown-unknown -O --crate-type cdylib`), with **no wasm-bindgen glue at all**, and wasm-pack was not installed. The glue figure is therefore unmeasured here, not assumed. Any future kernel size estimate must measure the glue for the pinned wasm-pack version, or state that it excludes glue.
2. **The "100–500 KB realistic kernel" expectation is neither confirmed nor refuted.** The PoC kernel is 17,165 B because it is five small functions. Only the size arithmetic (raw → base64 ×1.333 → HTML) and the sub-millisecond compile *at this scale* are measured. A full §11 statistical kernel (robust regression, GAM, mixed-effects) is larger; its size and its compile time on office hardware are unmeasured. Stage 5 must measure a real kernel before citing a size.
3. **DuckDB sizes sit at/above the Stage 1 range — the REJECT is stronger, not weaker.** Measured `duckdb-mvp.wasm` 40,621,595 B exceeds the top of Stage 1's ~17–40 MB range; embedding it base64 alone would make a ~54 MB HTML file. The REJECT stands on size alone, before the worker/header objections.
4. **SharedArrayBuffer moves from "unproven" to "settled unavailable".** Stage 1 §5.6 already called it settled on cited sources; the PoC re-verified the citation (MDN cross-origin isolation) and records it as settled. No design work may assume multithreading. Parallelism, if ever needed, is multiple single-threaded workers with `postMessage` — and workers themselves are unproven (P-03).
5. **P-10's Node baseline is a parse-time baseline, not a streaming baseline (tightening, not a change).** Stage 4 must implement chunked streaming import (`File.slice` / streaming reader), not `readFileSync`-style whole-file reads, and must re-measure import time in Edge. The Node numbers (83.2 ms import / 15.8 ms calc at 100k) are the baseline to beat or match in Edge, not a promise.

**Fallbacks, unchanged from Stage 1 §10 and now cost-free because Stage 4 is Option A shape:**

- P-01/P-02 live failure → **no WASM in the product; Option A.** All kernels stay JS. Nothing built is wasted.
- P-03 live failure → **no workers; chunked main-thread execution** (`setTimeout`-style yielding) is the only concurrency model.
- P-04 live failure → **OPFS not used at all, even as a cache.**
- P-05 live failure → **browser storage not used, even as a cache; the DEL defensive-loading pattern (`try/catch`, no-persistence fallback) stays regardless.**
- P-06 live success (any of fetch / module import / `instantiateStreaming` succeeds) → **the environment is not the restricted one; stop and re-check the setup before trusting any other result.**

### 1.5 The 13 criteria (§16), re-scored after the PoC

Scale: ● strong / ◐ adequate / ○ weak. No criterion changes its Stage 1 score for Option C (staged), because no live result exists to move one. Two rows are annotated with what the PoC added.

| # | Criterion | C — Hybrid, staged (re-scored) |
|---|---|---|
| 1 | Numerical accuracy | ● — unchanged. Integer minor units in TS core; `DecimalString` + rational for service (D-5.1, Stage 3 date work). |
| 2 | Computational speed | ● — unchanged in expectation; **annotated:** P-10 Node baseline is 98.9 ms at 100k for one formula. Edge measurement still required; no speed claim rests on it. |
| 3 | Memory requirements | ● — unchanged. JS owns the data; WASM kernels (if any) operate on slices, no whole-population copy. P-10 Node peak RSS 138.5 MB at 100k includes ~61 MB Node baseline; incremental cost ~77 MB over 100 rows. |
| 4 | Offline compatibility | ● — unchanged. Core works with zero WASM; kernels degrade to JS fallback offline. |
| 5 | Support under `file://` | ◐ — unchanged. Core is ● (proven pattern); kernels are ○ until live P-01/P-02 prove them. |
| 6 | Dependency size | ◐ — unchanged, **annotated:** wasm-bindgen glue unmeasured (§1.4.1); full §11 kernel size unmeasured (§1.4.2). No size estimate may cite either figure. |
| 7 | Reproducibility | ● — unchanged. Deterministic JS core, versioned rules, snapshot inputs; each kernel version pinned and cross-checked against its JS fallback. |
| 8 | Ease of testing | ● — unchanged. Core tested in Node and in the browser; each kernel gets a JS↔WASM differential test. |
| 9 | Maintainability | ◐ — unchanged. One language for the core; Rust confined to small, well-bounded kernels with JS fallbacks. |
| 10 | Statistical functionality | ◐ — unchanged. JS routines for descriptive/robust methods; Rust kernels (or embedded routines) only for specific models Stage 5 selects, each justified individually. |
| 11 | Data persistence | ◐ — unchanged. Versioned case-package file is the primary store; browser storage is a guarded cache at most. **Annotated:** OPFS/storage behaviour entirely unmeasured until live P-04/P-05. |
| 12 | Security | ● — unchanged. Core as A; each WASM module pinned, built on the build machine, hash recorded in the release. |
| 13 | Deployment complexity | ◐ — unchanged. One HTML file at first; WASM embedded as base64 only after live P-01/P-02 prove it, with a JS fallback if it fails. |

**Options A and B, re-confirmed:** A alone remains sufficient for the deterministic core, reconciliation, bounds/scenarios, wizard, and reporting, and insufficient on its own as a comfortable home for the full §11 statistical module. B alone remains technically strong but maximises exposure to the least-proven loading path and maximises maintenance cost, for a speed gain the deterministic core does not need. C++/WebAssembly remains not adopted (Stage 1 §2): no existing C++ code to port, larger glue, weaker interop, no safety advantage over Rust, no demonstrable benefit. No new evidence in the PoC reopens that decision.

---

## 2. What Stage 4 may build on — and what it must NOT depend on yet

### 2.1 Confirmed foundations Stage 4 may build on

These are the only foundations. Each traces to a cited spec, a Stage 1/2 output, or a PoC/date measurement — never to an assumption.

**Delivery shape and loading (Stage 1 §6, §5.9; PoC P-08 static):**
- Single self-contained HTML file, opened via `file://`, **0 fetch**, 0 CDN. Classic `<script>` (not `type="module"`), all code inlined. ES modules are blocked under `file://` in Chromium/Edge (origin `null`, CORS mode) — this is a known fact, confirmed at spec level by P-06, not a preference.
- File entry only by user-picked files (`<input type="file">` / File API); export only by `Blob` + `URL.createObjectURL` + `<a download>` (live proof pending, P-07, but the pattern is the prior generators' proven one).
- `isSecureContext === true` under `file://` is **not** treated as proof that any API works; each API is checked on its own terms (Stage 1 §5.1).

**Deterministic core — TypeScript, Option A shape (Stage 1 §6.2, §10.1):**
- Pure calculation core, separated from I/O, UI, and persistence (§17). Pure functions take explicit inputs and return explicit outputs including a trace; they read no DOM, no storage, no clock, no network. The core is testable entirely in Node.
- **Integer minor units for money, always** (Stage 2 01 §1.2; Stage 2 04 §3). Binary floating point never touches a monetary rounding. P-10 demonstrated the shape: `BigInt64Array` for money in cents, `Int32Array` for dates as days, exact `BigInt` arithmetic.
- **Bounds and scenarios are in the core from the first cut** (Stage 1 §0; MASTER_PROMPT §12). The core output for a participant is a set — recorded PA_AMB, reconstructed benefit where reconstructible, justified bounds `B_i^min ≤ B_i^possible ≤ B_i^max`, named scenarios — each labelled fact / assumption / estimate / unresolved unknown. A participant whose history is incomplete gets a bound, a scenario set, and a sensitivity ranking — never a silent failure and never a made-up exact number. `CalcResult<T>` (`exact` / `bound` / `scenarios` / `indeterminate`) is the single return type for all 34 formula functions.
- **The ten-stage pipeline** (Stage 2 04 §2): (1) identify applicable provisions, (2) participation/service eligibility, (3) service measures, (4) compensation measures, (5) base benefit formula, (6) historical accrual/grandfathering/protection, (7) plan and statutory restrictions, (8) prescribed rounding, (9) express in required normal-retirement basis, (10) reconcile with the reported administrator amount. A stage failure stops the exact path and attempts the bounds path; a stage failure never produces a partial exact benefit.
- **Versioned case-package file as the primary store** (Stage 1 §4.1; Stage 2 01 §4.4): explicit, versioned JSON case package owned by the user — import CSV/XLSX/JSON by file picker, export the package plus CSV/XLSX/PDF/HTML reports by download. State lives in memory as typed arrays + plain versioned objects while the app runs; durability is the saved file. **This is the only persistence Stage 4 may assume.**

**Data model, schema, validation, calculation, decisions (Stage 2, all five outputs):**
- **15-entity data model** (Stage 2 01 §7): Case, Plan, PlanVersion, Formula, Participant, EmploymentPeriod, CompensationHistory, ServiceHistory, BenefitObservation, BenefitCalculation, BenefitComparison, DiagnosticHypothesis, SourceDocument, ActuarialDecision, CalculationRun — with immutable source records stored separately from normalised/corrected values, provenance on every source record (file, row/cell, page/section), and an append-only event/revision mechanism.
- **Typed benefit quantity** (Stage 2 01 §5): amount + periodicity + measurement date + commencement basis + retirement age/date + annuity form + vesting treatment + plan-provision version + source/status. A comparison is valid only after bases are established equivalent; a recorded amount without an established measurement date is flagged `comparison_basis = UNRESOLVED` and cannot be Verified. PA_AMB vs AMB comparison pair: PA_AMB (BCV9, Input, at DOTE) vs AMB (BCV1.AMB, Calculated, at DOTE); DOTE ≠ DOPT, always.
- **Canonical input schema** (Stage 2 02): CSV / XLSX / XLSM (macros neither executed nor modified) / structured JSON; minimal vs comprehensive datasets; completeness grades; blank = missing (`null`), never 0 unless a governing rule explicitly requires it; unresolved measurement date represented, never silently completed.
- **66 validation rules** (Stage 2 03): S-01–S-12 structural, P-01–P-16 participant-level, X-01–X-14 cross-field, M-01–M-06 measurement-date resolution, L-01–L-08 longitudinal, C-01–C-10 cross-source. Evaluation order structural → P → X → M → L → C; findings accumulate; each result carries rule id, source, fields, severity, blocking-or-not. X-04 is honestly marked not implementable until the case sets a plausible range. Policy 5.8-1 $1/$5 figures are reference data only, never the reconciliation tolerance.
- **34 calculation functions** (Stage 2 04 §11): 9 traditional (T-01–T-09), 5 integrated (I-01–I-05), 7 combination (C-01–C-07), 8 special designs (S-01–S-08), 5 cross-cutting caps/conversions (X-01–X-05). Each plugs into Stage 5 of the pipeline (`calculateBaseBenefit`), states its kink structure for bounds derivation, and ends with an **If inexact** line (the bound or scenario set replacing the exact value). Decimal-safe arithmetic (§3), configurable rounding (§4: `RoundingConfig`, closed target/mode lists, prescribed sequence only — no default rounding), bounds/scenarios path (§5, endpoint-plus-kinks), reconciliation hook (§6: Δ, D, R; relative difference only when the denominator is meaningful).
- **Decision state machine** (Stage 2 05): five dispositions — Verified / Supported for acceptance / Requires investigation / Correction recommended / Indeterminate — as versioned state with a 12-row transition table (T1–T12). Only Verified and Supported allow `B_i^PA` into the valuation. Human approval is a gate (actuary only, T3); the system may only propose (`recommended`), never approve. Source/rule changes invalidate an approved disposition (re-propose, re-approve, no silent carry-forward). Indeterminate is a legitimate terminal outcome. The ten §14 determination items are required for approval.

**Date primitives and service functions (Stage 3 02):**
- **Nine date primitives** (F-D-01–F-D-09): `daysBetween` (exclusive start / inclusive end), `daysSinceEpoch` / `dateFromDays` (Int32, UTC midnight, no local-time conversion), `isLeapYear` / `daysInMonth` (Gregorian), `addMonths` (month-end clamping, non-sticky), `addYears`, `ageAt` (completed years, calendar method), `completedYMD` (calendar decomposition), month/year-boundary functions (per-plan, per-purpose only), `validateDateString` (rejects invalid calendar dates, never coerces). All pure. Regression tests T-D-01–T-D-09 (58/58 Node checks pass).
- **Ten service functions** (F-S-01–F-S-10) and three rounding functions (F-R-01–F-R-03), signatures only, with per-plan inputs, rounding carried, and tests T-S-01–T-S-17, T-R-01–T-R-03, T-I-01–T-I-06. **Rule D-0 governs all of them: no date convention, service definition, or rounding rule is a default.** Every service quantity is computed from the plan document's own definition, taken as a per-plan input (`ServiceDefinition`, all fields nullable; null drives the indeterminacy path, never a fallback).
- **Credited vs vesting vs eligibility service are three different quantities** (Stage 3 02 §2.1), computed independently from their own start dates, methods, and rules, and compared only as a diagnostic (X-07, default service tolerance 0). Credited service is frequently fractional; vesting/eligibility service are whole years. The cap `S_max` applies to credited service only, at formula-evaluation time. The BCV add-in values `CS`/`VS`/`ES` are cross-checks, not inputs — the engine computes service from the employment-period timeline.
- **Service representation (OD-2 resolved, D-5.1):** canonical stored form `DecimalString`; rational retained alongside where the plan defines the credit as a fraction (Blond quarters, hours fractions, fractional-accrual fractions); non-terminating rationals convert to decimal only at a prescribed rounding point, at scale ≥ 10, recorded in the trace. No `number` (IEEE 754 double) ever holds a service value.
- **Indeterminacy rules I-1–I-6** (Stage 3 02 §5.8): a missing definition is a missing input, never a default; missing hours are never replaced by elapsed time (or vice versa); a missing conversion rule is reported as a `{years, months, days}` decomposition plus bounds, never a single decimal; a missing era boundary bounds the service over candidate boundaries; a missing vesting schedule makes the vested benefit unknown, not zero; indeterminacy is per-quantity, not per-participant.
- **Anti-coincidence rule** (Stage 3 02 §3.5; Stage 2 04 §4.4): a match obtained by arbitrarily changing a rounding convention, a service definition, or a measurement date is never proof of the administrator's methodology. A rounding hypothesis is Supported only if documented or if the same sequence resolves discrepancies across the cohort with no contradicting document; otherwise it is Coincidence, recorded as such, never sufficient to move a disposition to Verified.

**State-driven design and invariants (Stage 1 §7; Stage 2 01 §9, 05 §6):**
- `S_{t+1} = T(S_t, E_t)`; state is a plain versioned value. Eight invariants (Stage 1 §7.2), including: original source observations remain unchanged; a calculation is reproducible from its inputs and rules (input snapshot hash + rule/formula version + tolerance version + engine version; byte-identical re-runs); benefit quantities retain units and bases; a rule cannot apply outside its applicability conditions; unverified statistical results cannot become approved benefits; updating one participant must not silently change others (dependency-driven recalculation, affected set logged); every approved determination retains its supporting evidence; no silent failure, no invented exactness.
- **The standing requirement** (Stage 1 §0, user-stated 2026-11-12, most important architectural requirement): the app must still produce reliable actuarial calculations and documented acceptance decisions when exact historical reconstruction is impossible. Bounds/scenarios and dispositions are in the core from the first cut, not added later.

**Performance shape (Stage 1 §9; P-10 Node baseline):**
- Streaming/chunked import; columnar typed-array layout (`Float64Array`/`BigInt64Array`/`Int32Array`, not one object per participant); single-threaded by design with chunked yielding; selective recalculation by dependency graph; lazy statistics; bounded (streamed) reporting; memory discipline (no whole-population copy into a WASM heap; no retaining parsed source text after normalisation). §21 benchmarks (100 / 1,000 / 10,000 / 100,000 participants; import, validation, calculation, reconciliation, statistics, memory, report, incremental recalculation) run in Stage 7; thresholds are set *after* the baseline is measured, never before.

### 2.2 What Stage 4 must NOT depend on yet

| Forbidden dependency | Why | Until when |
|---|---|---|
| Any WASM kernel | P-01/P-02 live proof not recorded. The 17 KB PoC kernel proves the mechanism in Node at small scale only; glue size and full-kernel size are unmeasured. | Live P-01 + P-02 pass (§3) **and** Stage 5 profiling showing a real bottleneck (§4.3). Every kernel ships with a JS fallback and a differential test. |
| Any Web Worker | P-03 live proof not recorded. Blob-URL workers are unproven in Edge under `file://` on the restricted workstation. | Live P-03 pass. Workers are an optimisation for responsiveness only, never a requirement; chunked main-thread execution is the baseline. |
| OPFS | P-04 live proof not recorded; Node cannot establish anything about it. | Live P-04 pass — and even then only as a session cache, never the source of truth. |
| Browser storage (localStorage / IndexedDB) as a source of truth, or as a holder of PII by default | P-05 live proof not recorded; per-path vs shared keying is disputed between sources; storage is evictable and, if shared, readable by any other local HTML file. | Live P-05 pass — and even then only as a best-effort, explicitly labelled session cache, guarded by the DEL defensive-loading pattern (`try/catch`, no-persistence fallback). The DEL pattern stays regardless of outcome. |
| Any candidate store (SQLite-WASM, DuckDB-WASM, WebR) | All three REJECTED as required components, confirmed by inspection (§1.1). SQLite's stock loader is fetch-based + ES-module + `instantiateStreaming`; DuckDB is ~54 MB as base64 HTML; WebR is 18.7 MB before any R package, ES-module loader, network-dependent package repo. | Never as a required component. SQLite-WASM only as an optional, non-essential query accelerator if live P-01 + P-04 are proved **and** a rewritten embedded-base64 loader is built — a new decision, not a Stage 4 dependency. WebR remains build-machine-only (native R for trusted reference calculations for §20 tests). |
| Multithreading / SharedArrayBuffer / Atomics | **Settled unavailable** under `file://` (§1.1). No threaded WASM build, no shared-memory data sharing, no worker pool. | Never under this deployment constraint. |
| `fetch`, ES modules, `instantiateStreaming`, dynamic `import()` | Blocked under `file://` (P-06, spec level). Any component whose loader needs them is unusable in the deliverable unless its loader is rewritten/inlined as classic script — a cost to be counted, not assumed away. | Never in the office deliverable. |
| A CDN, an external package, or any network access | §16/§19: no internet, no CDN, no fetch. Every dependency must be vendored at build time, pinned by exact version, inlined into the single HTML file. No package is adopted on its README alone; adoption requires the pinned file in the repo and a 0-fetch test. | Never. |
| KaTeX / MathJax | Size (~250–300 KB) and inlined-font loading unproven. | Prototype item in Stage 6 only. Guaranteed baseline is semantic HTML (`<sub>`/`<sup>`, italic variables, explicit units). |
| Any service definition, rounding rule, or date convention not sourced from the plan documents | Rule D-0 (Stage 3 02 §0.1): no defaults. A null `ServiceDefinition` field drives the indeterminacy path. | Only when the plan document (or documented administrator evidence) establishes it, with citation, per plan version and era. |
| Any tolerance as a universal constant | §10: tolerances are versioned case data, not constants; Policy 5.8-1 $1/$5 figures are reference data only. The $5.00 figure in P-10 was the PoC's stated test tolerance only. | A tolerance is set per case, versioned, and recorded with every comparison. |
| The Node P-10 timings as Edge timings | Node v24.22.1 on the build machine is not Edge on office hardware; the harness used whole-file reads, not streaming I/O; one formula only. | Live P-10 Edge measurement (§3, step 10), then Stage 7 benchmarks. |

---

## 3. The live Edge run sheet

Carried over from `stage3/01-poc-results.md` §6, so the test can be run without re-reading the PoC file. Probe files live under `~/workspace/pbgc-pa-amb-analysis/stage3/poc/`.

**Environment (all steps):** a Windows machine running the same Microsoft Edge version as the restricted workstation. Open each probe by double-click (`file://`), no server, no flags, no admin rights, no internet. Record the outcome of each item — value, timing, console error text, Edge version — in `stage3/01-poc-results.md` (or a dated addendum) before Stage 4 depends on it. Record the Edge version and the machine identity once, at the top of the run record.

| Step | Probe file | What to do | What to record | Pass criterion |
|---|---|---|---|---|
| 1. P-01 | `poc-p01-wasm-embed.html` (sha256 `be8cb358…`) | Open. Read the page's reported result. | `add(2,3)` value, instantiate ms, any console error, Edge version. Repeat after a browser restart. | `add(2,3) === 5`, no error. |
| 2. P-02 | `poc-p02-wasm-kernel.html` (sha256 `d436d311…`, 24,785 B) | Open. Read the page's reported values. | All five exported values (`add`, `accrual_monthly_cents`, `delta_cents`, `sum_i64`, `count_outside`), instantiate/compile ms, time-to-interactive (does the page stay responsive while loading the 24.8 KB file). Expected: `accrual_monthly_cents(150, 20000, 500000) = 150000n`; `delta_cents(150000, 149500) = 500n`; `sum_i64([100,200,300]) = 600n`; `count_outside(150..250) = 2n`. | Values correct, page interactive. |
| 3. P-03 | `poc-p03-blob-worker.html` (sha256 `74919278…`) | Open. Read the page's reported replies. | Pong reply, wasm-result value, any worker error. | Worker replies and `add(2,3) === 5` inside the worker. |
| 4. P-04 | `poc-p04-opfs.html` (sha256 `b253047e…`) | Open. Then close Edge, reopen, re-check. Then rename/move the file, reopen, re-check. | Main-thread `getDirectory()` / write / read result, `navigator.storage.estimate()` quota/usage. After restart: whether the marker `pa-amb-p04-marker.txt` survived. After rename/move: whether the marker survived and whether the origin key looks per-path or shared. | OPFS read/write/read-after-restart all succeed, and the origin-keying behaviour is documented. (A pass licenses OPFS only as a session cache; a fail means OPFS is not used at all.) |
| 5. P-05 | `poc-p05-storage.html` (sha256 `93d315f7…`) | Open. Then close Edge, reopen, re-check. Then rename/move the file, reopen, re-check. Then open a *different* local HTML file and check whether it can read the marker. | localStorage and IndexedDB (`pa-amb-p05` DB) marker write/read results, quota. After restart: survival. After rename/move: survival and whether another local HTML file can read the marker (shared vs per-path keying). | Behaviour is documented (per-path vs shared, survives restart or not); any use is gated on the result. (The DEL defensive-loading wrapper must not throw even on failure.) |
| 6. P-06 | `poc-p06-negative-control.html` (sha256 `d605d8ba…`) + companion `poc-p06-module.js` (sha256 `d6649481…`) | Open with DevTools console open. | The exact error text for (a) `fetch("./poc-p06-negative-control.html")`, (b) `WebAssembly.instantiateStreaming(fetch("./add.wasm"))`, (c) dynamic `import("./poc-p06-module.js")`, and (d) the static import in the `<script type="module">` block. | All four fail with CORS/MIME errors. **If any succeeds, stop and re-check the setup before trusting any other result — the environment is not the restricted one.** |
| 7. P-07 | `poc-p07-export-download.html` (sha256 `74830cba…`) | Open, click both buttons. | File names, sizes, contents — open the JSON (`pa-amb-p07-case.json`) and the CSV (`pa-amb-p07-reconciliation.csv`) and confirm they match the probe's data. | Both arrive intact, correct names and contents. |
| 8. P-08 | `poc-p08-zero-fetch.html` (sha256 `5470c95f…`) | Open with DevTools Network recording, reload. Repeat for `poc-p02-wasm-kernel.html`. | Total request count (must be 0, including fonts/workers/WASM). | **0 requests of any kind.** |
| 9. P-09 | `poc-p09-dark-theme.html` (sha256 `73a00a44…`) | Open. Toggle the theme. | Dark theme renders (black background `#000000`, off-white text `#f2f0e9`, accent `#7fb3ff`); toggle switches to light (`#002d72` header) and back without reload; 1,000 rows render (record the in-page render ms); math sample (`B_t = α·S_t·C̄_t`, `Δ_i = B_i^PA − B̂_i`) legible; no external resource requested (Network tab). | Both themes render, toggle switches without reload, no external resource requested. |
| 10. P-10 | `poc-p10-synthetic-100000.csv` (6,305,426 B; also `poc-p10-synthetic-{100,1000,10000}.csv`) + harness `poc-p10-100k.js` | In Edge under `file://`, import the 100,000-row CSV through a file picker into typed arrays, run the same unit-credit calculation + reconciliation (1.5% × S × C̄, exact `BigInt`, $5.00 PoC test tolerance, bounds path for the planted 5% missing-average rows). | Import time, calculation time, and peak memory (`performance.memory` where available, else Task Manager observation). Compare with the Node baseline: import 83.2 ms, calc/recon 15.8 ms, total 98.9 ms, peak RSS 138.5 MB. | Completes without freezing the tab or exhausting memory; timings recorded as the §21 baseline. |

**After the run:** update the exit-criteria table in §1.3 of this document (and the assessment in `stage3/01-poc-results.md` §5) with the recorded live outcomes. Only then is the architecture confirmed (or confirmed-failed-to-Option-A, if P-01 fails live with its documented fallback). No product code may depend on a live item before its outcome is recorded.

---

## 4. Staging update (Stage 4–8)

Restated from Stage 1 §6.2, with the changes the PoC forces. No stage's scope changes; the changes are constraints on what each stage may assume.

### 4.1 Stage 3 (feasibility) — this stage

Prove §10 (P-01–P-10); no product code depends on an unproved item. **Status after this document: prepared for confirmation, not confirmed.** The remaining Stage 3 work is the single live Edge session (§3). The date work (Stage 3 02) is complete as a specification: 9 date primitives, 10 service functions, 3 rounding functions, OD-2 resolved (D-5.1), 58/58 Node checks pass.

### 4.2 Stage 4 (deterministic actuarial engine) — Option A shape, regardless of the live outcome

- Pure-TypeScript core: modules 2–5, 7, 10 of the Stage 1 §6.1 module map (schema/validation; plan provision modelling `P(t)`; temporal benefit calculation; numerical reconciliation; actuarial decision support; audit/provenance) + import + wizard shell.
- **Bounds/scenarios are in the core from the first cut** (Stage 1 §0), not added later. The 34 formula functions, the 66 validation rules, the 15-entity model, the decision state machine, and the date/service functions (§2.1) are the build inputs.
- **No WASM, no worker, no OPFS, no browser storage in the critical path** — even if live P-01/P-02/P-03 pass, Stage 4 does not use them. The core must ship and work with none of them.
- Import is streaming/chunked (`File.slice` / streaming reader), not whole-file reads — the P-10 harness's `readFileSync` shape must not be copied into the product. XLSX import memory footprint is capped and the limit documented (Stage 1 §11 open point; Stage 4 owns it).
- Tests: the Stage 2 worked examples (exact reconstruction and bounds case), the Stage 1 formula test examples (item 10 per formula), the date/service tests T-D-01–T-D-09 / T-S-01–T-S-17 / T-R-01–T-R-03 / T-I-01–T-I-06, and synthetic cases that are *genuinely* indeterminate, not just missing a field (Stage 1 §11: the hardest test to design — the standing requirement needs it).

### 4.3 Stage 5 (reconciliation and statistical engine)

- Module 6 (statistical analysis, §11) and the reconciliation/diagnostic engine: counterfactual hypotheses ranked by evidence not proximity, missing-data/sensitivity analysis, robust statistics, outlier detection, multivariate models.
- **JS routines first.** Embedded statistical routines (small, audited, in-app) are the statistical baseline (Stage 1 §4.3): descriptive statistics, quantiles, robust z-scores (median/MAD), IQR, percentile screening, RMSE/MAE, OLS/robust regression — each with its mathematical definition, source citation, and a reference test against a trusted calculation (§20). GAMs, mixed-effects, and Bayesian models are **not** adopted by default; each needs its own Stage 5 justification, because the prompt requires them only to be "explored" where "appropriately justified".
- **Conditions under which a WASM kernel may later be added (all four must hold):**
  1. **Live proof:** Stage 3 live P-01 **and** P-02 have passed in Edge under `file://` (recorded in §1.3 / §3), so the loading path is proved — not merely Node-proved.
  2. **Real bottleneck:** Stage 5 profiling (§21: "optimise only after profiling demonstrates a significant bottleneck") shows a specific routine is the bottleneck at a real population size, in Edge, with numbers — not a predicted slowness and not a Node-only measurement.
  3. **JS fallback:** the kernel ships with a pure-TypeScript implementation of the same routine, and the app logs the WASM-load failure and continues on the fallback. The fallback is the default; WASM is the accelerator.
  4. **Differential test:** a JS↔WASM differential test runs the same inputs through both implementations and requires identical results (within the documented tolerance for float64 numerics; exact for integer minor units). The kernel version is pinned, its hash recorded in the release, and its size — **including the wasm-bindgen glue for the pinned wasm-pack version, measured, not the unmeasured Stage 1 "~10–20 KB" figure** — is recorded.
- The statistics module reads core outputs; it **never writes benefits or dispositions** (Stage 1 §7.2 invariant 5). A disposition of Verified / Supported / Correction recommended must cite a deterministic calculation or documented evidence, never a model output alone.
- If live P-01 fails, Stage 5 proceeds entirely in JS and the recommendation collapses cleanly to Option A with JS statistical routines; nothing built in Stage 4 is wasted.

### 4.4 Stage 6 (UI and reporting)

- Module 8 (visualisation and reporting) and the advanced analytical interface; the guided wizard (Create/open case → Import → Map/validate → Provisions → Historical periods → Run → Review reconciliations → Investigate → Document determinations → Report/export) and the advanced interface both read and write the same state store `S_t`; locked steps say why they are locked.
- Dark theme by default with a toggle, as CSS custom properties on the app root (one-attribute switch; charts/SVG use the same tokens). The PBGC Design System question goes to the user (§5, open item O-V-5) — the architecture must not hard-code either answer; theme tokens live in one place and the light theme must remain a faithful use of the design system so either decision stays cheap.
- Math notation: semantic HTML baseline (guaranteed); KaTeX is a prototype item only after its size and inlined-font loading are measured.
- Search / filter / sort / drill-down over participants, discrepancies, outliers, hypotheses, and audit events, over 100,000 rows without re-rendering the whole table (virtualised/paged tables, pre-computed sort keys, typed-array backing). Filtering never mutates state.
- Accessibility: keyboard navigable, screen-reader labels, sufficient contrast in both themes, no colour-only encoding of a disposition (text label and, where relevant, icon/shape alongside).

### 4.5 Stage 7–8 (end-to-end verification and release)

- Stage 7: synthetic numerical benchmarks, browser compatibility checks, full offline acceptance tests. §21 benchmarks on the build machine **and** in Edge on a machine matching the office, at 100 / 1,000 / 10,000 / 100,000 participants, recording all eight §21 measures (import, validation, initial calculation, reconciliation, statistical analysis, memory, report generation, incremental recalculation). Thresholds are set after the baseline is measured. If the baseline misses a threshold, profiling decides whether the fix is a JS optimisation, a WASM kernel, or a scope decision — in that order.
- Stage 8: release. The release checklist includes the Stage 3 proof results (live outcomes from §3), the exact pinned dependency list with hashes, and the unresolved limitations (§5). The deliverable is a functioning application, not a prototype design.

---

## 5. Open items

Items the PoC or the date work left open. Nothing here is decided by this document; each names its owner and the condition that would close it.

| # | Item | Status / what would close it |
|---|---|---|
| O-V-1 | **wasm-bindgen glue size unmeasured.** Stage 1's "~10–20 KB" is a secondary-source figure; the PoC built with `rustc` directly and installed no wasm-pack. | Measure the glue for the pinned wasm-pack version when the first kernel is proposed (Stage 5, condition 4 in §4.3). No kernel estimate may cite the "~10–20 KB" figure until then. |
| O-V-2 | **Full §11 statistics kernel size unmeasured.** The PoC kernel (17,165 B) is five small functions; Stage 1's "100–500 KB" expectation for a realistic kernel is neither confirmed nor refuted. A larger kernel's compile time on office hardware is also unmeasured. | Measure a real statistical kernel (robust regression / GAM / mixed-effects, as Stage 5 selects) — raw bytes, base64 size, HTML size, compile time in Edge under `file://` — before any kernel is adopted. |
| O-V-3 | **Leap-day birthday convention (O-D-1).** No source states a general rule for whether a 02-29 birthday falls on 02-28 or 03-01 in a non-leap year. `ServiceDefinition.leapDayBirthday` is null until the plan document or the administrator's convention establishes it. Until then, an age or NRD depending on a leap-day birthday in a non-leap year is unresolved for that participant (widen / Indeterminate). | Per case, from the plan document or documented administrator convention, with citation. |
| O-V-4 | **BCV add-in service algorithms unsourced (O-D-5).** The add-in doc (`BCV_ATPBGC_Add-ins.pdf`, Jul 2024) confirms the function names (SERVYCA etc.); the per-function algorithm behind Calculated `CS`/`VS`/`ES` is not sourced. | Stage 4 work, only if the engine needs to reproduce BCV-calculated service rather than only compare against it. Until then, `CS`/`VS`/`ES` are treated as reported Calculated values with their own provenance, not re-derived. |
| O-V-5 | **Dark theme vs PBGC Design System (Stage 1 §8, §11).** The MASTER_PROMPT requires dark by default; the Design System (v1.1.0 draft, #002D72, WCAG 2.2 AA) has no dark theme of its own. The DEL precedent already uses a dark page (#000) as an app-level decision. | **For the user to decide:** (a) keep the design system's light tokens for the light theme and add a dark theme alongside, (b) ask for a dark variant to be added to the design system, or (c) diverge. The architecture carries the dark theme as an app-level token system either way. |
| O-V-6 | **OPFS / storage origin keying unknown until live P-04/P-05.** Per-path vs shared is disputed between sources (Microsoft WebView2 docs vs a 2026 Chromium probe); restart survival, quota, and eviction on the restricted workstation are unmeasured. | Live P-04/P-05 (§3, steps 4–5). Even a pass licenses only a session cache, never the source of truth. |
| O-V-7 | **XLSX import memory footprint for large censuses.** The format requires random access; the cap is undocumented. | Stage 4: cap and document the limit. |
| O-V-8 | **KaTeX/MathJax for math notation.** Size (~250–300 KB) and inlined-font loading unproven. | Prototype item in Stage 6 only; semantic HTML is the guaranteed baseline. |
| O-V-9 | **Rounding-mode list completeness (OD-3, Stage 2 04 §10).** The six modes cover the documented cases; a plan may prescribe another (e.g. round to nearest $5). | Additions need a recorded decision, not a silent extension. |
| O-V-10 | **Short-window rule for averaging when service < `n` years (O-D-2); partial computation-period rule, hours-based (O-D-3); freeze-date inclusivity where the plan is silent (O-D-4).** Each is open per plan. | Per plan, from the plan document; if the plan states none, the quantity is bounded over plausible treatments, never assumed. |
| O-V-11 | **Covered-compensation / SSA bend-point tables and §401(a)(17) / §415(b) limit tables still unsourced** (Stage 2 01 OD-1/OD-2; Stage 2 04 §10). Integrated formulas (I-01–I-05) need them. | Source the tables (PBGC/SSA/IRC) and pin versions before Stage 4 implements the affected formulas; until then the formulas' **If inexact** lines govern. |
| O-V-12 | **Plan-merger handling (OD-3, Stage 2 01); BCV 224 vs 225 conflict blocks P-04 (Stage 2 03 §10); per-plan rounding policy not found (Stage 2 02 gap G-6: the PF 4-decimal factor convention is a file practice, not a policy, and must not be imported into benefit rounding).** | Carried from Stage 2; each needs a sourced decision before the affected Stage 4 work. Conflicts are flagged, not silently resolved. |
| O-V-13 | **Kink-point discovery for bounds over service inputs (O-D-6).** Service kinks: band thresholds (999/1,000 hours), vesting cliffs (5/10 years), cap thresholds (30 years), freeze dates, amendment effective dates. | Stage 4/5: the formula catalog must state each formula's kink structure (Stage 2 04 §11 does), or the engine falls back to grid/optimisation. |
| O-V-14 | **Statistical scope (§11).** Which models are "appropriately justified" is a Stage 5 decision per model, not settled here. | Stage 5, per model, with justification, citation, and reference test. |
| O-V-15 | **PA_AMB definition itself** (units, basis, vesting treatment, what a blank means) — the dictionary does not state them; none is assumed anywhere in Stage 2. | Actuarial question for the companion Stage 1 outputs; the architecture must not assume it. Stage 4 must carry the `comparison_basis = UNRESOLVED` path for it. |

---

## 6. Traceability

| Claim in this document | Source |
|---|---|
| Option C (Hybrid), staged, recommended; Stage 4 in Option A shape; staging Stage 4–8 | Stage 1 04 §§6.2, 9, 10 |
| 13 criteria scores; C++/WASM not adopted | Stage 1 04 §§2, 3 |
| Candidate-store REJECTs (SQLite / DuckDB / WebR) and primary store = versioned case-package file | Stage 1 04 §4; PoC §3 (measured versions/sizes) |
| `file://` constraints: ES modules blocked, file-path workers blocked, `instantiateStreaming` requires `application/wasm` + CORS-same-origin, SharedArrayBuffer settled unavailable, storage fragile | Stage 1 04 §5; PoC §4 (MDN cross-origin isolation), §2 P-06 (W3C WebAssembly Web API §2) |
| Exit criteria (P-01 + P-06 + P-07 + P-08 + P-10) and their NOT-yet-satisfied assessment | Stage 1 04 §10; PoC §5 |
| PoC measurements (P-01–P-10 Node/static results, probe sha256 prefixes, kernel sizes/timings, 100k baseline) | `stage3/01-poc-results.md` §§1–3, 7 |
| Live run sheet (steps 1–10) | `stage3/01-poc-results.md` §6, carried over verbatim in substance |
| Date primitives, service functions, D-0, D-5.1 (OD-2), indeterminacy rules I-1–I-6, anti-coincidence rule, 58/58 harness | `stage3/02-date-calculations.md` §§1, 2, 3.5, 5.1–5.8, App. A |
| 15 entities, typed benefit quantity, case package, invariants | Stage 2 01 §§4–7, 9 |
| Canonical input schema; blank = `null`, never 0 | Stage 2 02 |
| 66 validation rules (S/P/X/M/L/C), evaluation order, X-04 honestly not implementable | Stage 2 03 |
| 34 calculation functions, ten-stage pipeline, decimal-safe arithmetic, rounding config, bounds path | Stage 2 04 §§2–6, 11 |
| Decision state machine, 12-row transition table, human approval gate, Indeterminate terminal | Stage 2 05 §§1–5 |
| Standing requirement (reliable decisions when exact reconstruction is impossible) | Stage 1 04 §0 (user-stated 2026-11-12); MASTER_PROMPT §§12, 14 |
| Dark theme by default; design-system question for the user | MASTER_PROMPT §18; Stage 1 04 §§8, 11 |

---

## 7. Files referenced

| File | Role |
|---|---|
| `stage3/03-architecture-verdict.md` | This file. |
| `stage3/01-poc-results.md` | PoC results P-01–P-10; live run sheet source (§6); exit-criteria assessment (§5). |
| `stage3/02-date-calculations.md` | Date calculations and roundings; 58/58 Node harness. |
| `stage3/date-primitives-harness.js` | Date-primitives Node verification harness. |
| `stage3/poc/` | All probe files and Node verifiers (see `01-poc-results.md` §7 for the sha256 list). |
| `stage1/04-architecture-decision.md` | Stage 1 recommendation being confirmed (in direction) by this verdict. |
| `stage2/01-data-model.md`, `02-input-schema.md`, `03-validation-catalog.md`, `04-calculation-functions.md`, `05-decision-states.md` | What Stage 4 may build on. |

---

*Stage 3 output 3 of 3. Specification only — no engine, no UI, no full app. Synthetic data only. Nothing pushed, nothing written to Drive, nothing uploaded.*
