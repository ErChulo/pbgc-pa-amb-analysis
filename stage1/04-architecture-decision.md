# Architecture Decision — PA_AMB Analysis System

**Stage 1, output 4 of 4 · 2026-11-12**
**Project:** PBGC Prior Administrator Accrued Monthly Benefit (PA_AMB) Analysis System
**Repo:** ErChulo/pbgc-pa-amb-analysis (public, `main`) — https://github.com/ErChulo/pbgc-pa-amb-analysis — created by the user 2026-11-12. Local source dir: `~/workspace/pbgc-pa-amb-analysis`.
**Governing spec:** `MASTER_PROMPT.md` (§16 architecture, §17 state-driven design, §18 UI, §19 security, §21 performance). This document is Stage 1 research only. It builds nothing and proves nothing executable; every capability marked **UNPROVEN** below must be proved in Stage 3 before the architecture may depend on it.
**Status:** Recommendation made, conditional on Stage 3 proof (see §10).

---

## 0. The requirement that governs this decision

The user stated 2026-11-12, as the most important architectural requirement:

> The application must still produce reliable actuarial calculations and documented acceptance decisions when exact historical reconstruction is impossible. That is what distinguishes this system from an ordinary pension benefit calculator.

Consequences, designed in from the start — not bolted on later:

1. **Bounds and scenarios are first-class computation.** The engine's core output for a participant is not a single number. It is a *set*: the recorded PA_AMB, the reconstructed benefit where reconstructible, and justified bounds `B_i^min ≤ B_i^possible ≤ B_i^max` (§12) plus named scenarios (§5, §12), each labelled fact / assumption / estimate / unresolved unknown. A participant whose history is incomplete must still get a computed, auditable result — a bound, a scenario set, a sensitivity ranking — never a silent failure and never a made-up exact number.
2. **Dispositions are explicit versioned state (§17).** Every participant ends in exactly one disposition — Verified / Supported for acceptance / Requires investigation / Correction recommended / Indeterminate (§14) — stored as a versioned state transition with its evidence, rule version, input snapshot, reviewer, and date. "Indeterminate" is a legitimate terminal disposition, not an error state and not a gap in the workflow.
3. **Every participant ends with a documented disposition and a human decision.** The workflow (§18 steps 7–10) cannot close a case while any participant lacks a disposition, and no disposition becomes an approved determination without a human reviewer. Unverified statistical results can never become approved participant benefits (§17 invariant).
4. **The engine must never fill a gap by inventing data.** Missing input is never replaced by zero unless a governing rule explicitly requires it (§7). Where data is missing, the engine widens the bound, adds a scenario, or moves the disposition toward Requires investigation / Indeterminate — it does not narrow the answer by assumption.

This requirement is the main reason the recommendation in §9 is **Option C (Hybrid), staged** — the deterministic core must be small, pure, and testable enough that bounds/scenario logic can be verified exactly, while the statistical layer stays strictly advisory and can never write a benefit.

---

## 1. What the system must do (architecture drivers, from the MASTER_PROMPT)

| Driver | Source | Architectural consequence |
|---|---|---|
| Offline, Windows + Microsoft Edge, no internet, no server, no install of Python/Node/dev tools, no elevated privileges, no network calls, no external processing of PII | §16, §19 | Single self-contained HTML deliverable, 0 fetch, 0 CDN; all code and data embedded or user-supplied by file upload; dev tools live only on the separate build machine |
| Deterministic, reproducible benefit engine; decimal-safe money; inspectable intermediates; selective recalculation | §8, §9 | Pure calculation core, separated from I/O, UI, persistence (§17); integer minor units or decimal-safe arithmetic; every run records rule version + input snapshot |
| Reconciliation with configurable, documented tolerances — never an arbitrary universal tolerance | §10 | Tolerance is versioned case data, not a constant; every comparison records which tolerance applied |
| Bounds, scenarios, sensitivity, missing-data analysis | §12 + user requirement (§0) | Bounds/scenario computation is a core engine mode, with the same determinism guarantees as exact calculation |
| Robust statistics, outlier detection, multivariate models — advisory only | §11 | Statistical layer is a separate module behind a hard boundary: it reads calculations, it never writes benefits or dispositions |
| Human-approved dispositions with evidence | §14, §17 | Disposition is versioned state; approval is a gated event, not a computed field |
| Guided wizard + advanced analytical interface; dark theme by default; math notation; search/filter/sort/drill-down | §18 | UI is a replaceable shell over the state store; theme is an app-level decision (see §7) |
| Populations 100 / 1,000 / 10,000 / 100,000 participants; import, validation, calculation, reconciliation, statistics, memory, report, incremental recalculation | §21 | Columnar/typed-array data layout, chunked streaming import, worker or WASM kernels only where proved, selective recalculation by dependency graph (§8) |

Prior-generator precedent (read, not copied): the R5, DEL, 436, PF, E.Adm and E.Adj generators are each a single HTML file opened via `file://`, with inlined libraries (R5 inlines PizZip/docxtemplater/FileSaver-style code; PF inlines an Excel-writing library) and 0 fetch. The PA_AMB app follows the same delivery shape. It is a much heavier computation problem than any of those generators, which is why this decision exists.

---

## 2. The three prompt options, evaluated

### Option A — TypeScript/JavaScript only

Deterministic JS calculations, locally bundled numerical libraries. Classic `<script>` (not module) code inlined in one HTML file.

**Strengths.** Simplest possible deployment: one file, no build-time binary, no WASM loading path at all, so the entire `file://` WASM question disappears. Easiest to test in the exact office environment (open the file, run). Easiest to debug and maintain for a TypeScript-first developer. Decimal-safe money is straightforward in JS (integer cents / BigInt, or a small decimal library). For the deterministic core — formula evaluation per participant — modern JS engines are fast: per-participant benefit math is a few dozen arithmetic operations, and 100,000 participants × ~50 operations is trivially within seconds on the main thread, faster still chunked or in a worker. No toolchain beyond a TypeScript compiler on the build machine.

**Weaknesses.** JS has no mature, small, auditable in-browser statistics library covering robust regression, GAMs, mixed-effects and Bayesian models (§11) without pulling in a large dependency. Hand-rolling those in JS is a large, error-prone surface and a maintenance burden. Heavy statistical work (multivariate fits over 100,000 rows, resampling, sensitivity sweeps) in JS is slower than WASM by roughly 2–5× on numeric loops — tolerable, but it is the one place speed matters. JS `number` is binary floating point; the engine must therefore be disciplined (integer minor units everywhere, no float money) and that discipline must be enforced by tests, since the language does not enforce it.

**Verdict on A alone.** Sufficient for the deterministic core, the reconciliation engine, bounds/scenarios, the wizard, and reporting. Insufficient, on its own, as a comfortable home for the full §11 statistical module — it can do descriptive statistics, robust z-scores, IQR and percentile screening well, but regularised/GAM/mixed-effects/Bayesian modelling would be either a large hand-build or a heavy dependency.

### Option B — Rust + WebAssembly (TS UI + Rust/WASM calculation engine)

All calculation (deterministic + statistical) in Rust, compiled to WASM; TypeScript only for UI/orchestration.

**Strengths.** Near-native speed on numeric loops; Rust's type system and `no_std`-friendly crates make decimal-safe money and exact, reproducible arithmetic easier to guarantee than in JS; a single Rust core can be unit-tested natively (fast, no browser) and property-tested; the same core could later be reused outside the browser. Small modules: a focused Rust WASM module is typically tens to a few hundred KB (a small Rust program compiles to ~8–25 KB compressed floor; a realistic actuarial+statistics kernel is expected in the 100–500 KB range, to be measured in Stage 3 — not asserted here).

**Weaknesses.** Everything now depends on the WASM loading path under `file://`, which is the single riskiest part of this project (§5). The Rust toolchain (cargo, wasm-pack, wasm-bindgen) is a second language and second build pipeline to maintain, and the developer's stated shipping language is TypeScript. The JS↔WASM boundary is a real cost: every participant record, formula definition and result must cross it, and a chatty boundary can erase the speed gain. Debugging WASM in the office browser is harder than debugging JS. Most importantly, **B puts the deterministic core — the part that must be most transparent and most auditable — behind a compiled binary**, which is the opposite of what an actuarial reviewer wants to inspect.

**Verdict on B alone.** Technically strong, but it maximises exposure to the one unproven area (`file://` WASM) and maximises maintenance cost, for a speed gain the deterministic core does not need.

### Option C — Hybrid (recommended, staged)

TypeScript UI/orchestration + deterministic core in TypeScript; Rust/WASM kernels only for selected, proved, performance-critical work; embedded analytical storage only if a candidate survives Stage 3.

**Strengths.** Keeps the deterministic core — formulas, rounding, reconciliation, bounds, scenarios, dispositions — in plain, inspectable TypeScript, where the actuary and the reviewer can read it. Adds WASM only where it earns its place (statistical kernels, bulk numeric sweeps), behind a narrow, versioned interface, with a pure-TypeScript fallback for every kernel so the app still works if WASM fails to load. Storage stays in the simplest form that meets the need (see §4). This is the only option that lets Stage 3 *de-risk incrementally*: ship value with A, then promote individual kernels to WASM one at a time, each with a measured speedup and a fallback.

**Weaknesses.** Two languages and two build pipelines once the first kernel lands; the fallback doubles the test surface (every kernel needs a JS implementation and a cross-check against the WASM one). Boundary discipline is required so the WASM side never owns state or dispositions.

**Verdict.** **C is the recommendation** (§9), with the staging in §9.1: Stage 4 builds the deterministic core as pure TypeScript (Option A shape); WASM kernels are added only after Stage 3 proves the loading path and Stage 5 measures a real bottleneck (§21: "optimise only after profiling demonstrates a significant bottleneck").

### C++/WebAssembly — evaluated, not adopted

**Does C++ offer a demonstrable advantage over A/B/C here? No.**

Reasons:

1. **No existing C/C++ code to port.** The reason to choose Emscripten/C++ in the browser is an existing C/C++ library (SQLite, DuckDB, FFmpeg are the canonical examples — and they arrive as prebuilt WASM, not as code this project would write). This project has no existing C++ actuarial or statistical library to reuse. Every line would be new code, so the "porting" advantage is zero.
2. **Larger glue, weaker interop.** Emscripten generates ~30–100+ KB of JS glue by default (plus an optional ~50 KB filesystem layer) versus wasm-bindgen's ~10–20 KB of tree-shakeable glue for Rust; wasm-bindgen also generates typed `.d.ts` bindings, while Emscripten interop is via Embind/`ccall`/`EM_JS`. For a narrow kernel interface, Rust's boundary is cleaner.
3. **Safety.** Rust's ownership model gives memory safety without a garbage collector; C++ in WASM gives the same class of memory bugs it gives natively, with worse debugging in the browser. For money arithmetic that must be exactly reproducible, that matters.
4. **Size floor is comparable, not better.** Small-program compressed floors are in the same order of magnitude for Rust and C++ (roughly 8–30 KB); nothing in this workload (numeric loops over typed arrays) favours C++ codegen over Rust codegen in a measurable way. No benchmark was run — and none is needed, because there is no C++ asset to benchmark against.
5. **Team fit.** The developer ships TypeScript; Rust is the MASTER_PROMPT's own named WASM language (§16) and the language of the `wasm-pack` toolchain. Adding C++ would add a third language for no gain.

**Decision:** Do not evaluate C++ further. If a future Stage 5 need turns out to be an existing C/C++ library (e.g. a specific statistical routine only available in C), that is a new decision with that library as the justification — not a reason to write this project's kernels in C++.

Sources for the toolchain comparison: wasm-pack/wasm-bindgen vs Emscripten glue and interop (webassembly-wasm.com, "Choosing Between Emscripten, wasm-pack, and TinyGo"; "Other Languages in the Browser"); Rust small-module size floor 8–25 KB compressed (same source). These are secondary summaries; Stage 3 measures the real module.

---

## 3. The 13 criteria (§16), scored

Scale: ● strong / ◐ adequate / ○ weak. Scores are judgements for *this* workload (100k-participant actuarial analysis under `file://`), not generic language rankings. "C (staged)" means: TypeScript core now, WASM kernels only where proved.

| # | Criterion | A — TS/JS only | B — Rust/WASM engine | C — Hybrid, staged (recommended) |
|---|---|---|---|---|
| 1 | Numerical accuracy | ◐ — exact if integer-minor-unit discipline is enforced by tests; language does not enforce it | ● — Rust types + integer/decimal crates; reproducible arithmetic easiest to guarantee | ● — deterministic core in TS with integer money + tests; kernels in Rust where float64 numerics benefit |
| 2 | Computational speed | ◐ — ample for deterministic core and descriptive stats; 2–5× slower than WASM on heavy statistical loops | ● — near-native on numeric loops | ● — JS where it is fast enough, WASM kernels where profiling shows a bottleneck |
| 3 | Memory requirements | ● — smallest runtime; typed arrays; no WASM linear-memory copy | ◐ — WASM linear memory is one contiguous block (4 GB cap, practically less); data crossing the boundary is copied unless shared | ● — JS owns the data; WASM kernels operate on slices passed in, no whole-population copy into WASM heap |
| 4 | Offline compatibility | ● — nothing to fetch after the file is opened | ◐ — works offline *if* the WASM bytes are embedded; fails if any step needs a fetch | ● — core works with zero WASM; kernels degrade to JS fallback offline |
| 5 | Support under `file://` | ● — classic `<script>` in one file is the proven pattern (R5/DEL/436/PF/E.Adm/E.Adj) | ○ — **UNPROVEN**; the whole engine depends on §5 items that must be proved in Stage 3 | ◐ — core is ●; kernels are ○ until Stage 3 proves them, and the app must work without them |
| 6 | Dependency size | ● — core + small decimal/stats helpers, well under 1 MB total | ◐ — Rust module 100–500 KB (to measure) + glue; still small | ◐ — same as A at first; grows only by proved kernels |
| 7 | Reproducibility | ● — deterministic JS, versioned rules, snapshot inputs; easiest to re-run identically | ● — deterministic Rust; but reproducibility now also depends on the exact WASM binary version | ● — same as A for the core; each kernel version is pinned and cross-checked against its JS fallback |
| 8 | Ease of testing | ● — unit tests run in Node and in the browser; no compilation step to test the core | ◐ — Rust tests run natively (fast) but browser integration tests need the built WASM | ● — core tested as A; each kernel gets a JS↔WASM differential test |
| 9 | Maintainability | ● — one language, the developer's shipping language | ○ — two languages; Rust expertise required for the core, the most-audited part | ◐ — one language for the core; Rust confined to small, well-bounded kernels with JS fallbacks |
| 10 | Statistical functionality | ○ — descriptive + robust screening are fine; GAM / mixed-effects / Bayesian would be a large hand-build or a heavy dependency | ● — Rust crates exist, but each must be audited; no turnkey actuarial stats stack in Rust either | ◐ — JS for descriptive/robust methods; Rust kernels (or embedded routines, §4) only for the specific models Stage 5 selects, each justified individually |
| 11 | Data persistence | ◐ — explicit save/load of a versioned case package file (see §4); no durable in-browser store is assumed | ◐ — same as A; a WASM database does not change the `file://` persistence problem (§5) | ◐ — same as A; storage is chosen in §4, not by the compute option |
| 12 | Security | ● — no network, no eval of remote code, no WASM binary to audit | ◐ — WASM runs sandboxed, but the binary is opaque; supply-chain (crates) must be audited and pinned | ● — core as A; each WASM module is pinned, built on the build machine, and its hash recorded in the release |
| 13 | Deployment complexity | ● — one HTML file, double-click | ○ — one HTML file *containing a base64 WASM blob* (see §5.4) or a fragile multi-file layout; build pipeline required | ◐ — one HTML file at first; WASM embedded as base64 only after Stage 3 proves it, with a JS fallback if it fails |

**Reading the table.** A wins on simplicity, `file://` support, testing and deployment, and is sufficient for everything except the heaviest statistics. B wins on raw speed and numeric rigour but bets the whole product on the least-proven loading path. C takes A's deployment shape and buys B's speed only where it is measured to matter, with a fallback each time. That is why C, staged, is the recommendation.

---

## 4. Candidate components — adopt, prototype, or reject

Each candidate is judged on: what it would do here, size, `file://` behaviour, and verdict. Sizes are approximate, from vendor/secondary sources cited; Stage 3 measures the exact pinned versions.

### 4.1 SQLite-WASM (official `@sqlite.org/sqlite-wasm`)

- **What it would do here:** a relational store for participants, employment/compensation/service histories, observations, calculations, hypotheses, decisions and audit events (§6 entities) — SQL querying, indexes, transactions — inside the browser.
- **Size:** ~0.87 MB raw WASM binary (v3.53.4-build2 measured 868,907 bytes); ~400–457 KB gzipped; plus ~65 KB JS glue. Small by database standards.
- **file:// behaviour:** **UNPROVEN and doubtful as a persistence layer.** The official build's OPFS-backed VFS needs a Web Worker (synchronous access handles exist only in workers) and, for the default `opfs` VFS, SharedArrayBuffer — which needs COOP/COEP headers a `file://` page cannot send (§5). The `opfs-sahpool` VFS avoids the headers but takes an exclusive lock (one connection; a second tab fails). The `kvvfs` (localStorage) backend works without headers but inherits localStorage's `file://` fragility (§5.5). SQLite's own deployment guidance states the WASM binary "cannot be loaded using the `file://` protocol" and that apps "must be served through an HTTP or HTTPS server" (cited in §5) — that claim is about the stock loader (which fetches), not necessarily about an embedded base64 load, but it is a warning, not a green light. OPFS itself is origin-scoped and invisible to the user: it cannot be the case file the actuary hands over, and §19 forbids claiming browser storage is durable/encrypted without verification.
- **Verdict: REJECT as a required component. PROTOTYPE only as an optional, non-essential query accelerator** — and only if Stage 3 proves (a) embedded-base64 load under `file://` in Edge, (b) a worker-based OPFS or in-memory VFS that actually works there, and (c) a clean fallback to the primary store when it does not. The primary store (below) must not depend on it.
- **Primary store instead (adopt):** explicit, versioned **case-package files** owned by the user — import CSV/XLSX/JSON by file picker, export a single versioned JSON case package (plus CSV/XLSX/PDF/HTML reports, §15) by download. State lives in memory as typed arrays + plain versioned objects while the app runs; durability is the saved file, which the actuary controls, can copy, and can hand over. This matches the prior generators (which produce a `.docx`/`.xlsx` file, not a browser database), matches §19 (explicit control of import/export, no hidden store of PII), and has zero `file://` risk. IndexedDB/localStorage may be used only as a *best-effort, explicitly labelled* session cache (never the source of truth, never silently trusted), guarded by the defensive-loading pattern the DEL app already uses (try/catch, no-persistence fallback — the DEL `delSafeStorage()` precedent), and only after Stage 3 measures it in Edge under `file://`.

### 4.2 DuckDB-WASM

- **What it would do here:** columnar analytical SQL over the participant population — fast aggregations, cohort cuts, grouping for §11 descriptive statistics and §15 reporting.
- **Size:** **~17–40 MB raw per bundle** (eh ~17–34 MB, mvp ~20–39 MB depending on version; coi similar), ~6–8 MB compressed over the wire; plus ~0.3–0.9 MB worker JS. That is 20–40× the size of SQLite-WASM and larger than the rest of the application combined. Embedding it base64 in a single HTML file would make a ~25–55 MB HTML file (base64 adds ~33%).
- **file:// behaviour:** **UNPROVEN and structurally hostile.** DuckDB-WASM runs in a Web Worker by design; its threaded (`coi`) bundle needs SharedArrayBuffer → COOP/COEP headers → impossible under `file://` (falls back to single-threaded `mvp`/`eh`, per DuckDB's own troubleshooting docs). Its loader fetches the WASM and worker files; under `file://` the worker cannot be loaded from a relative path in Chromium (origin `null`, §5.3) and a blob-URL worker is the usual workaround — which itself is unproven for DuckDB's loader in Edge under `file://`. It also needs its data registered as buffers (whole-file `arrayBuffer()`), which fights the streaming/chunked import the 100,000-participant target needs.
- **Verdict: REJECT.** The size alone disqualifies it from a single self-contained HTML deliverable; the worker + header requirements disqualify it under `file://`. What DuckDB would provide — fast grouped aggregation over 100k rows — is achievable in plain JS over typed arrays with pre-computed indexes (a grouped aggregation over 100,000 rows is milliseconds in JS; the expensive part is the statistical modelling, not the grouping). Revisit only if Stage 5 profiling shows aggregation itself is the bottleneck *and* the deployment constraint changes to allow a served (http://localhost) layout — neither is expected.

### 4.3 Embedded statistical routines (small, audited, in-app)

- **What it would do here:** the §11 methods, implemented as small, named, tested routines inside the app: descriptive statistics, quantiles, robust z-scores (median/MAD), IQR, percentile screening, RMSE/MAE, OLS/robust regression, and later regularised regression — each with a cited reference implementation and a test against a trusted reference calculation (§20: "test statistical procedures against trusted reference calculations").
- **Size:** kilobytes to tens of kilobytes per routine; no runtime, no binary.
- **file:// behaviour:** plain JS in the single file — the proven pattern. No loading risk at all.
- **Verdict: ADOPT as the statistical baseline.** This is the default home for §11 in Stage 5. A routine is adopted only with (a) its mathematical definition and source citation, (b) a reference test (known-answer test against a published example or a trusted implementation run on the build machine), and (c) a stated scope ("estimates patterns / suggests hypotheses; does not establish the legally correct benefit", §11). GAMs, mixed-effects and Bayesian models are **not** adopted by default — each needs its own Stage 5 justification, because each is a large implementation or a large dependency, and the prompt requires them only to be "explored" where "appropriately justified".

### 4.4 WebR (R in WebAssembly)

- **What it would do here:** run real R in the browser for §11 modelling (regression, GAMs via mgcv, mixed models, Bayesian models) — the only candidate that brings an established statistical ecosystem rather than a hand-build.
- **Size:** base runtime ~9.5–18 MB (R.wasm ~18 MB in one measured 46.4 MiB self-hosted bundle; the base library alone ~12 MB; tidyverse ~92 MB total, ggplot2+dplyr+ggrepel ~39 MB). Even the minimal useful set is an order of magnitude larger than the whole rest of the app. Embedding it base64 in one HTML file would produce a ~15–25 MB HTML file at minimum, before any R packages.
- **file:// behaviour:** **UNPROVEN and unlikely.** WebR's loader is an ES module (`webr.mjs`) with static imports — ES modules are blocked under `file://` in Chromium (§5.2). Its lazy virtual filesystem fetches files on demand from a package repo (default `https://repo.r-wasm.org`) — a network fetch the office has no access to, and which would have to be replaced by vendoring the whole package set. At least one documented project notes webR cells are "disabled for documents opened directly from disk (`file://`)" and must be served over a local web server. Reproducibility is also weaker: R package versions are pinned only with extra work (the repo index alone is ~4.7 MB).
- **Verdict: REJECT for the office deliverable.** The size, the ES-module loader, and the network-dependent package repo are each individually disqualifying under §16/§19; together they are decisive. WebR remains useful *off the office path*: on the build machine, R (native, not webR) is an excellent way to generate trusted reference calculations for §20 tests and to validate the in-app routines. That is a development-time use, not a runtime dependency.

### 4.5 What is NOT needed

No charting library needs a decision here beyond "inlined, dependency-free SVG/canvas charts, hand-built for the §15 visualisations" — the prior generators prove a single file can carry its own rendering, and a charting dependency would add size and `file://` risk for no actuarial benefit. No framework (React/Vue) is adopted: the app is a single file, and a framework's build output is a liability under `file://` (module splitting, chunked assets). KaTeX/MathJax for §18 math notation is a **prototype** item: evaluate its size (~250–300 KB for KaTeX fonts+JS) and whether its font loading works when inlined; the fallback is plain, carefully typeset HTML (`B_t = α·S_t·C̄_t` with `<sub>`/`<sup>`), which is always available.

---

## 5. The file:// constraints — investigated explicitly

Target environment: Windows, Microsoft Edge (Chromium), double-clicked HTML file, no server, no flags, no admin rights. Every item below states what is **known** (with a cited source), what is **uncertain**, and what Stage 3 must prove. Nothing in this section is claimed as fact without a source or a proof requirement.

### 5.1 Ground facts about file:// in Chromium/Edge

- **Origin is `null` / opaque.** A `file://` page has no real origin; `location.origin` is `"null"` (Chromium) and module/fetch CORS checks fail against it. This is the root cause of most `file://` failures.
- **`file://` IS a secure context.** MDN's Secure Contexts page states "Locally delivered files such as `http://localhost` and `file://` paths are considered to have been delivered securely", so `isSecureContext === true` under `file://` (independently measured in Chromium 149). The origin is nevertheless opaque/`null` (see the bullet above) — the secure-context gate is therefore **not** the blocker; the gate is the opaque origin and the absence of HTTP response headers. Any design that assumes "secure context ⇒ this API works" is wrong; each API must be checked on its own terms.
- **No HTTP response headers exist under `file://`.** There is no server to send `Content-Type: application/wasm`, COOP, COEP, CORP, or caching headers. Any capability that depends on a response header is unavailable by construction.

### 5.2 ES modules from file:// — KNOWN: blocked in Chromium/Edge

Module scripts are always fetched in CORS mode. A page opened from disk has origin `null`, and `null` can never satisfy a CORS check, so `import` of a relative `.js` file fails with "Access to script at 'file://…' from origin 'null' has been blocked by CORS policy" (ESModules.com error reference; multiple corroborating sources). Workarounds (`--allow-file-access-from-files`, `--disable-web-security`) require launching the browser with flags — **not available** on the restricted workstation (no control over how Edge is launched, no admin rights). **Consequence, already adopted by the prior generators: the deliverable must be a single classic `<script>` (no `type="module"`), with all code inlined.** Any candidate component whose loader is an ES module (WebR's `webr.mjs`, DuckDB's ESM bundles, most modern npm packages' browser builds) is unusable in the deliverable unless its loader is rewritten/inlined as classic script — a cost that must be counted, not assumed away.

### 5.3 Web Workers from file:// — KNOWN: file-path workers blocked in Chromium; blob-URL workers are the workaround, UNPROVEN in Edge under file://

- **Known:** `new Worker('./worker.js')` from a `file://` page fails in Chrome/Edge with `SecurityError: Failed to construct 'Worker': Script at '…' cannot be accessed from origin 'null'` (long-standing Chromium behaviour; Firefox historically allowed it). The documented workaround is a blob-URL worker: build the worker source as a string, `URL.createObjectURL(new Blob([source]))`, `new Worker(url)` — widely reported to work in Chrome/Edge, including for WASM database loaders.
- **Uncertain:** whether a blob-URL worker works in the *specific* Edge version on the restricted workstation, with its group policy, and whether a blob-URL worker can itself load WASM (it must receive the bytes via `postMessage` or an embedded base64 string, since it cannot fetch); whether `importScripts()` inside a blob-URL worker works under `file://`; whether the workstation's policy blocks blob URLs. Secondary sources disagree on details and versions, and none tested the restricted workstation.
- **Stage 3 must prove:** P-03 (§10). **Design rule until proved:** the app must work with no worker at all. Workers are an optimisation (keep the UI responsive during a 100k-participant run), never a requirement. All heavy work is chunked with `setTimeout`/`requestIdleCallback`-style yielding on the main thread as the baseline, so a missing worker degrades responsiveness, not correctness.

### 5.4 Dynamically loaded / embedded WASM modules — KNOWN: the mechanism exists; UNPROVEN under file:// in Edge

- **Known (spec):** `WebAssembly.instantiateStreaming` *requires* a `Response` with `Content-Type: application/wasm` exactly, CORS-same-origin, and ok status — otherwise it rejects with `TypeError` (W3C WebAssembly Web API, §2). Under `file://` there is no `Response` with headers at all, and `fetch()` of a local `.wasm` file is itself blocked by CORS — so **instantiateStreaming and any fetch-based loader cannot work under `file://`**. This is a spec-level fact, not a browser quirk.
- **Known (mechanism):** `WebAssembly.instantiate(bytes, importObject)` and `WebAssembly.compile(bytes)` take raw bytes and ignore MIME types entirely. If the WASM bytes are embedded in the HTML file itself — as a base64 string (or a base64 `.b64` sidecar, as the R5 generator already does for its rates workbook) — decoded with `atob`/`Uint8Array`, and passed to `WebAssembly.instantiate`, no fetch and no MIME type is involved. This is the only WASM loading path compatible with `file://`, and it is the path the MASTER_PROMPT's "Rust/WASM embedded in a single HTML file is possible" note refers to.
- **Uncertain:** whether Edge on the restricted workstation actually instantiates a base64-embedded module under `file://` (no cited source tested exactly this); the practical size ceiling (base64 inflates bytes by ~33%, so a 300 KB module becomes ~400 KB of HTML text — acceptable; a multi-MB module becomes a multi-MB HTML file that is slow to parse); compile time for a large module on the office hardware; whether the workstation's policy or Edge's site settings block WASM compilation from a `file://` page at all.
- **Stage 3 must prove:** P-01 and P-02 (§10). **Design rule until proved:** no WASM in the critical path. The deterministic core is TypeScript; WASM kernels are optional accelerators with JS fallbacks.

### 5.5 OPFS persistence — KNOWN: needs a worker + (usually) SharedArrayBuffer; UNPROVEN under file://

- **Known:** OPFS is a per-origin, user-invisible filesystem reached via `navigator.storage.getDirectory()`; it is a secure-context API, and `file://` is a secure context (§5.1), so the secure-context gate is not the blocker. The synchronous access handle (`createSyncAccessHandle`) that a WASM database needs exists **only inside a Web Worker**. The default SQLite OPFS VFS uses SharedArrayBuffer and therefore needs COOP/COEP headers (§5.6); the `opfs-sahpool` VFS avoids the headers but takes an exclusive lock. OPFS data is evictable by default (subject to the origin quota and browser eviction) unless persistence is requested, and it is invisible to the user — it cannot be the case file.
- **Uncertain:** whether `navigator.storage.getDirectory()` succeeds at all from a `file://` page in Edge (origin `null` vs the origin-scoping OPFS assumes); which origin key Chromium assigns to `file://` OPFS data (per-file-path? shared across all local files? — the analogous localStorage/IndexedDB behaviour under `file://` is documented as varying by browser and, in Chromium, measured as shared across local files in one 2026 probe and per-file-path in Microsoft's WebView2 docs; the two disagree, and neither is Edge-under-`file://` on the restricted workstation); whether OPFS data survives a browser restart and a file move/rename on that machine.
- **Stage 3 must prove:** P-04 (§10). **Design rule regardless of outcome:** OPFS is never the source of truth (§4.1). Even a passing proof only licenses OPFS as a session cache.

### 5.6 Multithreaded execution (SharedArrayBuffer) — KNOWN: unavailable under file://

SharedArrayBuffer is only exposed to **cross-origin isolated** pages: the document must be served with `Cross-Origin-Opener-Policy: same-origin` **and** `Cross-Origin-Embedder-Policy: require-corp`, in a secure context (`https://` or `http://localhost`). A `file://` page has no server and no headers, so `crossOriginIsolated` is `false` and `SharedArrayBuffer` is `undefined` (MDN; DuckDB troubleshooting docs: the threaded `coi` bundle "falls back to the single-threaded `mvp` or `eh` bundle" without the headers; multiple corroborating sources, including the Godot/MuJoCo cases where `file://` "will not work"). **This is settled: do not design for multithreading.** No threaded WASM build, no `SharedArrayBuffer` data sharing, no Atomics-based worker pool. Parallelism, if ever needed, is multiple single-threaded workers with `postMessage` — and workers themselves are unproven (§5.3). The performance plan (§8) therefore assumes a single thread.

### 5.7 External browser packages (CDN / npm) — KNOWN: unavailable

No internet, no CDN, no fetch (§16, §19). Every dependency must be vendored at build time, pinned by exact version, inlined into the single HTML file (or, for a proved WASM kernel, embedded as base64). A package that cannot be inlined as classic script (ES-module-only, fetch-based loader, dynamic `import()`) cannot be used without adaptation, and the adaptation cost belongs in the Stage 3/5 estimate. **No package is adopted on the strength of its README alone; adoption requires the pinned file in the repo and a 0-fetch test.**

### 5.8 localStorage / IndexedDB under file:// — KNOWN: works in Chromium, fragile, and not to be trusted

- **Known:** In Chromium/Edge, `localStorage` and IndexedDB *do* work under `file://` in current versions (measured in Chromium 149: both persist across a browser restart, ~10.7 GB quota reported; Microsoft's WebView2 docs state a `file://` document "has an origin that is unique to its file path" and that `localStorage`/`IndexedDB` "will work"). In Firefox, `file://` storage historically threw `SecurityError` (Bugzilla #643318, #1240349) — not the target browser, but evidence the behaviour is not guaranteed by any standard. MDN documents `localStorage` throwing `SecurityError` on opaque origins. Whether the storage is keyed per file path or shared across all local files is **disputed between sources** (per-path in Microsoft's docs; shared in a 2026 Chromium probe) — and either behaviour is bad: per-path orphans the data when the file is renamed or moved; shared lets any other local HTML file read the case's PII.
- **Uncertain:** the exact Edge behaviour on the restricted workstation, the quota/eviction policy there, and whether group policy disables it.
- **Design rule:** browser storage is never the source of truth and never holds PII by default (§4.1). The DEL precedent (defensive `try/catch` storage wrapper, no-persistence fallback after the iPhone opaque-origin `SecurityError` killed the whole script) is mandatory for any storage touch. Stage 3 proves P-05 (§10) only to decide whether a session cache is safe to offer, not whether the app needs it.

### 5.9 What file:// DOES reliably give us (the safe foundation)

Classic `<script>` inlined in one HTML file; DOM, CSS, `<input type="file">` (user-picked files are readable via the File API — the *only* sanctioned way data enters the app); `Blob` + `URL.createObjectURL` + `<a download>` for export (the prior generators' proven export path); `WebAssembly.instantiate` from embedded bytes (**to be proved**, §5.4); `isSecureContext === true`; canvas/SVG for charts; `crypto.getRandomValues`/`crypto.randomUUID`. The architecture in §6 is built only on these, plus items that Stage 3 proves.

---

## 6. Recommended architecture (Option C, staged)

```
┌─────────────────────────────────────────────────────────────────┐
│  pa-amb-analysis.html  (single file, file://, 0 fetch)          │
│                                                                 │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │ UI shell │  │ State store  │  │ Pure calculation core     │  │
│  │ wizard + │◄─┤ S_t, events  │◄─┤ (TypeScript, no I/O)      │  │
│  │ advanced │  │ E_t, T,      │  │ formulas · rounding ·     │  │
│  │ UI, dark │  │ invariants,  │  │ reconciliation · bounds · │  │
│  │ theme    │  │ audit log    │  │ scenarios · sensitivity   │  │
│  └──────────┘  └──────────────┘  └───────────────────────────┘  │
│        ▲              ▲                     ▲                   │
│        │              │                     │ optional, proved  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │ Import / │  │ Case package │  │ Statistics module (JS     │  │
│  │ export   │  │ file (JSON)  │  │ routines; Rust/WASM       │  │
│  │ CSV/XLSX │  │ save / load  │  │ kernels behind fallback)  │  │
│  │ /JSON    │  │ (user file)  │  │ advisory only ── never    │  │
│  └──────────┘  └──────────────┘  │ writes benefits/dispos.   │  │
│                                 └───────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Reporting: plan + participant reports, charts (SVG),      │  │
│  │ CSV / XLSX / PDF-or-HTML export, audit package            │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
  Build machine only: TypeScript compiler, Rust + wasm-pack,
  pinned vendored libraries, test suite, reference checks (R).
  Office machine: nothing installed. Double-click the HTML file.
```

### 6.1 Module map (§16 separation of responsibilities)

Ten modules, each with one owner and one interface; the pure core never imports the UI, the filesystem, or storage.

| # | Module (§16) | Home | Notes |
|---|---|---|---|
| 1 | Source ingestion | UI shell | File picker only; CSV/XLSX/JSON parsers (inlined, pinned); XLSM macros never executed; streaming/chunked parse (§8) |
| 2 | Schema and validation | Core | Layered predicates (§7); every result carries rule id, source, fields, severity, blocking-or-not |
| 3 | Plan provision modelling | Core | `P(t)` — effective-dated provisions, amendments, freezes, grandfathering; applicability predicates on every rule |
| 4 | Temporal benefit calculation | Core | `B_i(t) = F(X_i(≤t), P(≤t))`; staged (§8), inspectable intermediates, integer minor units |
| 5 | Numerical reconciliation | Core | Δ, D, R (§10); configurable documented tolerances; counterfactual hypotheses, ranked by evidence not proximity |
| 6 | Statistical analysis | Separate module | §11; reads core outputs; **never writes benefits or dispositions**; each routine cited + reference-tested |
| 7 | Actuarial decision support | State store | Dispositions (§14) as versioned transitions; human approval gate; evidence links |
| 8 | Visualisation and reporting | UI shell | §15; SVG charts; plan + participant reports; reproducible from snapshot + rule version |
| 9 | Local persistence and export | UI shell | Case-package file save/load; CSV/XLSX/HTML export; no hidden store (§4.1) |
| 10 | Audit and provenance | State store | Append-only event log; every event records actor, time, rule version, input hash |

### 6.2 Staging (what is built when)

- **Stage 3 (feasibility):** prove §10; no product code depends on an unproved item.
- **Stage 4 (deterministic engine):** pure-TypeScript core (modules 2–5, 7, 10) + import + wizard; **Option A shape**. Bounds/scenarios are in the core from the first cut (§0), not added later.
- **Stage 5 (reconciliation + statistics):** module 6, JS routines first; a Rust/WASM kernel only for a specific routine where profiling shows a bottleneck *and* Stage 3 proved the loading path — each kernel ships with its JS fallback and a differential test.
- **Stage 6 (UI + reporting):** module 8 and the advanced analytical interface; dark theme (§7).
- **Stage 7–8:** end-to-end verification (§21 benchmarks) and release; the release checklist includes the Stage 3 proof results and the exact pinned dependency list with hashes.

### 6.3 Why this shape satisfies the governing constraints

- **Single HTML file:** everything the core needs is inlined classic script; WASM, if any, is embedded base64 *inside the same file* (no sidecar files the user could lose, no relative-path loads). If Stage 3 shows the base64 WASM path fails, the file still ships — the kernels simply stay JS.
- **No dev tools in the office:** compilation (TS → JS, Rust → WASM, inlining, base64 embedding) happens on the build machine; the office file is a finished artefact.
- **No network:** 0 fetch by construction; the test suite asserts it (the prior generators already test this).
- **PII:** data enters only by explicit file pick, lives in memory and in the user's own saved case file, and is never sent anywhere; export carries a warning before sensitive data leaves (§19).

---

## 7. State-driven design (§17) — at Stage 1 level

### 7.1 The model

```
S_{t+1} = T(S_t, E_t)
```

- **S_t** — the complete case-analysis state: the immutable input snapshot (imported source values + their provenance), the normalised working data, plan provisions `P(t)`, rule/tolerance versions, per-participant calculation results (including bounds and scenarios), per-participant disposition + evidence, the audit log, and UI/workflow position. State is a plain versioned value, not a scattering of mutable globals.
- **E_t** — an event: user action (import, map, edit a provision, run, approve), source update (re-import, correction), rule revision (new tolerance, amended formula), or calculation event (run completed, kernel fallback used).
- **T** — a defined, total transition function: for each event type, exactly what changes, what is recomputed, and what is recorded. `T` is pure where it touches calculations and explicit where it touches side effects (see §7.3). Every transition appends an audit event; no transition silently rewrites history.

### 7.2 Invariants (enforced, not aspirational)

Each invariant is a property the test suite checks (§20 property-based tests), not a comment.

1. **Original source observations remain unchanged.** Imported values are stored immutably, separately from normalised/corrected values (§6). A correction creates a new version that references the original; it never overwrites it. Provenance (file, row/cell, page/section) is retained.
2. **A calculation is reproducible from its inputs and rules.** Every `BenefitCalculation`/`CalculationRun` records the input snapshot hash, the rule/formula version, the tolerance version, and the engine version. Re-running with the same snapshot and versions yields byte-identical results (deterministic: no `Date.now()`, no randomness, no iteration over unordered structures inside the core).
3. **Benefit quantities retain their units and measurement bases.** Every benefit is a typed quantity (§3): amount + periodicity + measurement date + commencement basis + retirement age/date + annuity form + vesting treatment + plan-version + source/status. A comparison is only valid after bases are established equivalent; a recorded amount without an established measurement date is flagged "unresolved comparison basis" and cannot be Verified.
4. **A rule cannot apply outside its applicability conditions.** Every formula and tolerance carries its applicability predicate (dates, employment group, formula type, status); the engine refuses to apply it outside, and the refusal is recorded — not silently skipped.
5. **Unverified statistical results cannot become approved participant benefits.** The statistics module has no write path to benefits or dispositions. A disposition of Verified / Supported / Correction recommended must cite a deterministic calculation or documented evidence, never a model output alone. Model outputs are labelled as such wherever shown.
6. **Updating one participant must not silently change others.** Recalculation is dependency-driven: an event names the affected participants (or the affected plan-level input, in which case the affected set is computed explicitly and logged). A run reports exactly which participants changed and why; an unchanged participant's results are untouched.
7. **Every approved determination retains its supporting evidence.** A disposition cannot transition to approved without its evidence set (recorded benefit, reconstructed benefit or bounds, comparison basis, hypotheses considered, missing evidence, assumptions, reviewer, date — §14 items 1–10). The transition is rejected if any required item is missing.
8. **(From §0) No silent failure, no invented exactness.** If exact reconstruction is impossible, the engine produces bounds/scenarios and the disposition moves toward Requires investigation / Indeterminate — it never emits an exact number the evidence cannot support, and never leaves a participant without a disposition.

### 7.3 Separation of pure calculations from side effects

- **Pure:** formula evaluation, rounding, reconciliation, bounds/scenario computation, sensitivity, statistical routines, validation predicates. Pure functions take explicit inputs and return explicit outputs (including a trace); they read no DOM, no storage, no clock, no network.
- **Effects (isolated at the boundary):** file picking/reading, file download, browser storage (cache only), UI rendering, WASM instantiation, worker messaging. Effects are thin adapters that call pure functions and record the event. The core can therefore be tested entirely in Node without a browser, and the same core can be re-run by an auditor from the saved case package.
- **Explicit, versioned transformations instead of hidden mutable state:** every change to working data is a named migration/transformation with a version number (`v1 → v2: <what changed, why>`), recorded in the audit log. There is no in-place mutation of the input snapshot, and no "current values" object that drifts without a record. This is what makes the case package reproducible and the audit log meaningful.

### 7.4 Dispositions as versioned state (the §0 requirement, made concrete)

A participant's disposition is a state machine, not a field:

```
Unassessed ──► Verified / Supported for acceptance /
              Requires investigation / Correction recommended /
              Indeterminate ──► (human review) ──► Approved
                                  ▲                       │
                                  └── re-open on new ─────┘
                                      evidence / rule change
```

- Each transition records: from-state, to-state, event, evidence references, rule/input versions, actor, timestamp.
- **Indeterminate is terminal for the analysis, not an error:** it means "the evidence cannot support a conclusion", and it is a complete, reportable outcome with its missing-evidence list and data requests (§12 prioritisation). The case can close with Indeterminate participants; it cannot close with *undispositioned* participants.
- Re-opening is explicit: new evidence or a rule change creates a new transition; the previous disposition and its evidence remain in the log.

---

## 8. UI requirements the architecture must support (§18)

- **Two interfaces over one state store:** a guided wizard (Create/open case → Import → Map/validate → Provisions → Historical periods → Run → Review reconciliations → Investigate → Document determinations → Report/export) and an advanced analytical interface (full tables, filters, drill-down, model diagnostics). Both read and write the same `S_t`; the wizard is a constrained path through the same transitions, not a separate implementation. Locked steps say why they are locked (the R5/DEL onboarding precedent).
- **Dark theme by default, with a toggle.** True dark theme: black background, soft off-white text, restrained accents, high readability, compact consistent navigation (§18). The theme is implemented as CSS custom properties on the app root so the toggle is a one-attribute switch, and so charts/SVG use the same tokens.
- **Open point — PBGC Design System vs dark theme.** The PBGC Design System (used by the R5/DEL/436/PF/E.Adm/E.Adj generators; v1.1.0 draft, #002D72, WCAG 2.2 AA) **has no dark theme of its own**. The MASTER_PROMPT requires dark by default; the DEL precedent already uses a dark page (#000) as an app-level decision. This document therefore treats the dark theme as an **app-level decision carried by the architecture** (tokens, toggle, chart colours), and records the design-system question as **for the user to decide, not settled here unilaterally**: whether to (a) keep the design system's light tokens for the light theme and add a dark theme alongside, (b) ask for a dark variant to be added to the design system, or (c) diverge. The architecture must not hard-code either answer: theme tokens live in one place, and the light theme must remain a faithful use of the design system so either decision stays cheap.
- **Readable mathematical notation:** formulas shown as typeset math where useful. KaTeX is a prototype item (§4.5); the guaranteed baseline is semantic HTML (`<sub>`, `<sup>`, italic variables, explicit units). Notation must never be an image without alt text (accessibility, §18/§19 context: WCAG 2.2 AA).
- **Search / filter / sort / drill-down:** over participants, discrepancies, outliers, hypotheses and audit events. This is a data-architecture requirement, not a widget: the store must support indexed/filtered views over 100,000 rows without re-rendering the whole table (virtualised/paged tables, pre-computed sort keys, typed-array backing). Filtering never mutates state; it is a view over `S_t`.
- **Accessibility:** keyboard navigable, screen-reader labels, sufficient contrast in both themes, no colour-only encoding of a disposition (each disposition also has a text label and, where relevant, an icon/shape).

---

## 9. Performance (§21) — what the architecture must do for 100,000 participants

Targets are fictional populations of 100 / 1,000 / 10,000 / 100,000 participants, measuring import, validation, initial calculation, reconciliation, statistical analysis, memory, report generation and incremental recalculation. §21 says thresholds are defined *after* measuring the baseline — so this section states the **design obligations** that make the targets achievable, not invented timings.

### 9.1 What makes 100,000 feasible in a browser

1. **Streaming/chunked import.** Never `file.arrayBuffer()` the whole census and never hold two copies (JS + WASM heap). Parse CSV/JSON in chunks (streaming reader / chunked `File.slice`), validate and normalise row-by-row into pre-allocated typed arrays, and report progress. XLSX parsing is the exception (the format requires random access); cap its in-memory footprint and document the limit.
2. **Columnar, typed-array data layout.** Participant data lives in typed arrays (`Float64Array` for money as integer minor units where possible — or `BigInt64Array` where exactness demands it; `Int32Array` for dates as days, codes as enums), not one object per participant. This is what makes 100k rows small (tens of MB at most, and mostly a few MB) and what makes vectorised passes fast in both JS and WASM.
3. **Single-threaded by design (§5.6).** No SharedArrayBuffer, no thread pool. Responsiveness comes from chunking: process N participants per macrotask, yield, update progress, continue. A worker (§5.3) is an optimisation for responsiveness only, if proved.
4. **Selective recalculation by dependency graph.** A provision change, tolerance change or single-participant correction recomputes only the affected participants (§7.2 invariant 6). Full re-runs are the exception, not the default. Each run logs its affected set and its timing, so §21's "incremental recalculation performance" is measured, not assumed.
5. **Lazy statistics.** Descriptive statistics and screening run over the typed arrays in one or two passes; expensive models (Stage 5) run on demand, on a filtered cohort, with progress and cancellation — never as a blocking part of the initial calculation. Model results are cached against (input hash + model version) and invalidated explicitly.
6. **Bounded reporting.** Report generation streams rows (participant reports are generated per participant on demand, not all 100,000 at once); the plan-level report aggregates from pre-computed summaries. Export writes via `Blob` parts, not one giant string.
7. **Memory discipline.** No whole-population copy into a WASM heap (§3, memory row); WASM kernels, if any, operate on slices. No retaining of parsed source text after normalisation. `WebAssembly.Memory` growth is bounded and logged if a kernel is used.

### 9.2 Benchmark obligations (Stage 7)

Benchmarks run on the build machine *and* (for the `file://` path) in Edge on a machine matching the office as closely as possible, with the four fictional population sizes, and record all eight §21 measures. Thresholds are set after the baseline is measured; a threshold is never set before a measurement exists. If the baseline misses a threshold, profiling decides whether the fix is a JS optimisation, a WASM kernel, or a scope decision — in that order.

---

## 10. Recommendation

### 10.1 — Recommendation: Option C (Hybrid), staged — TypeScript core, Rust/WASM kernels only where proved and measured

**Adopt Option C, staged as in §6.2, under these conditions:**

1. **Stage 4 builds the deterministic core as pure TypeScript (Option A shape).** No WASM in the critical path. Bounds/scenarios and dispositions are in the core from the first cut.
2. **No WASM kernel is added until Stage 3 proves the loading path (P-01, P-02) and Stage 5 profiling shows a real bottleneck.** Each kernel ships with a JS fallback and a differential test; if the WASM load fails at runtime, the app logs it and continues on the fallback.
3. **No database component is required.** SQLite-WASM and DuckDB-WASM are rejected as required components (§4.1, §4.2); WebR is rejected (§4.4). The primary store is the versioned case-package file; browser storage is a guarded cache at most.
4. **Single self-contained HTML file, 0 fetch, is the deliverable** — and it stays shippable even if every WASM proof fails, because the core never needed WASM.
5. **The dark theme is carried as an app-level token system** (§8); the design-system question goes to the user.

**What would change this recommendation:** if Stage 3 proves the base64 WASM path *and* Stage 5 profiling shows the deterministic core itself (not just statistics) is too slow in JS at 100,000 participants, the core's hottest loop could be promoted to a Rust kernel — still behind a JS fallback. If Stage 3 fails the WASM path entirely, the recommendation collapses cleanly to Option A with JS statistical routines, and nothing already built is wasted, because the core was TypeScript throughout.

### Stage 3 proof-of-concept checklist (exact)

Environment: a Windows machine running the same Microsoft Edge version as the restricted workstation, opening the proof file by double-click (file://), with no server, no flags, no admin rights, no internet. Each item states what it proves, how it is tested, and its pass/fail criterion. A proof item that fails is a result, not a delay: the architecture adapts as §9 states.

| # | Proves | How it is tested | Pass criterion | If it fails |
|---|---|---|---|---|
| P-01 | A base64-embedded WASM module instantiates under `file://` in Edge | Minimal HTML file with a tiny Rust (wasm-pack) module embedded as a base64 string, decoded and passed to `WebAssembly.instantiate(bytes, {})`; call an exported `add(2,3)`; log success/failure and timing; repeat after a browser restart | `add(2,3) === 5`, no console error, in Edge under `file://`, with no flags | No WASM in the product; Option A. All kernels stay JS |
| P-02 | A realistic-size WASM kernel is practical embedded (size + compile time) | Same harness with a module of the size of a real statistical kernel (build a representative Rust kernel; measure raw bytes, base64 size, HTML file size, `instantiate` compile time on the office-class machine) | HTML file remains openable and interactive (time-to-interactive recorded, not assumed) and compile time is acceptable for a one-off load; exact threshold set after measurement | Kernel stays JS, or is split/smaller, or dropped |
| P-03 | A blob-URL Web Worker runs under `file://` in Edge and can receive WASM bytes | Minimal HTML file that creates a worker from a blob URL, posts a message, receives a reply; then posts WASM bytes and has the worker instantiate and call them; log errors | Worker replies correctly and instantiates the module, in Edge under `file://`, no flags | No workers; chunked main-thread execution is the only concurrency model |
| P-04 | OPFS is reachable under `file://` in Edge (worker + main thread) | Probe: `navigator.storage.getDirectory()` from the main thread and from a blob-URL worker; write, read back, restart the browser, read again; record which origin key is used (rename/move the file and re-probe) | OPFS read/write/read-after-restart all succeed, and the origin-keying behaviour is documented | OPFS is not used at all, even as a cache |
| P-05 | localStorage / IndexedDB behaviour under `file://` in Edge | Probe: write a marker to both, restart the browser, read back; rename/move the HTML file, read again; record quota via `navigator.storage.estimate()` | Behaviour is documented (per-path vs shared, survives restart or not); any use is gated on the result | Storage is not used, even as a cache; the DEL defensive-loading pattern stays regardless |
| P-06 | `fetch` / ES modules / `instantiateStreaming` fail as expected under `file://` (negative control) | The same probe file attempts `fetch('./x.json')`, a `type="module"` import, and `instantiateStreaming(fetch(...))`; each must fail with the documented error | All three fail with CORS/MIME errors (confirming the environment matches the documented model, so a later "it worked" is not a fluke of a different setup) | If any succeeds, the environment is not the restricted one — re-check the setup before trusting any other result |
| P-07 | Export by download works under `file://` in Edge | Probe downloads a generated `.json` and a generated `.csv` via `Blob` + `<a download>`; user confirms the files arrive intact | Files download with correct names and contents, no error | Export path must be redesigned before any product work (this would contradict the prior generators' proven pattern, so it is expected to pass) |
| P-08 | The single-file deliverable loads with 0 fetch in Edge under `file://` | Open the probe/product file with DevTools network recording (or an equivalent check); assert zero network requests, including for fonts, workers, and WASM | 0 requests of any kind | Remove the offending reference; the release gate fails until it is 0 |
| P-09 | Dark-theme rendering and the theme toggle work in Edge under `file://` (no external font/CSS dependency) | Probe page with the token system (§8), both themes, math-notation sample, and a 1,000-row virtualised table; check contrast and toggle behaviour | Both themes render, toggle switches without reload, no external resource requested | Theme implementation is fixed; it does not block the core |
| P-10 | A 100,000-row synthetic import + calculation runs in the probe harness | Generate a fictional 100,000-participant CSV on the build machine; import chunked into typed arrays in Edge under `file://`; run a representative deterministic calculation + reconciliation; record time and peak memory (via `performance.memory` where available, else task-manager observation) | Completes without freezing the tab or exhausting memory; timings recorded as the §21 baseline | Chunk size / data layout is revised before Stage 4 proceeds |

**Stage 3 exit criteria.** The architecture in §6 is confirmed if P-01 (or its documented failure, with the Option A fallback) + P-06 + P-07 + P-08 + P-10 are recorded. P-02/P-03/P-04/P-05 decide *optional* capabilities only. No product code may depend on an item marked UNPROVEN above until its proof is recorded.

---

## 11. Risks and open points

| Risk / open point | Status | Owner |
|---|---|---|
| WASM under `file://` in the real Edge build on the restricted workstation is unproven | Open → P-01/P-02 | Stage 3 |
| Worker + OPFS + storage behaviour under `file://` in that Edge build is unproven and sources disagree | Open → P-03/P-04/P-05 | Stage 3 |
| No threaded execution is possible under `file://` (settled, §5.6); single-threaded performance at 100k must be measured, not assumed | Open → P-10, §21 baseline | Stage 3 / Stage 7 |
| Statistical scope (§11): which models are "appropriately justified" is a Stage 5 decision per model, not settled here | Open | Stage 5 |
| PBGC Design System has no dark theme; the dark/light decision is the user's (§8) | Open — **for the user** | User |
| KaTeX/MathJax for math notation: size and inlined-font loading unproven | Prototype (§4.5) | Stage 6 |
| XLSX import memory footprint for large censuses | Open — cap and document in Stage 4 | Stage 4 |
| PA_AMB definition itself (units, basis, vesting) is a Stage 1 actuarial question for the companion outputs, not a technology question — the architecture must not assume it | Open (companion output) | Stage 1 (formula/data outputs) |
| The "reliable decisions when exact reconstruction is impossible" requirement (§0) is the hardest to test: it needs synthetic cases that are *genuinely* indeterminate, not just missing a field | Test design, Stage 4/7 | Stage 4 |

---

## 12. Sources

Technology facts only; the §2.3 source hierarchy governs actuarial rules, not technology. Vendor/authoritative documentation is preferred over secondary summaries; secondary sources are labelled as such.

- W3C, WebAssembly Web API (Candidate Recommendation Draft) §2 — `instantiateStreaming` requires `application/wasm` MIME, CORS-same-origin, ok status; `TypeError` otherwise. https://www.w3.org/TR/2025/CRD-wasm-web-api-2-20251114/
- MDN, Secure Contexts — "`file://` paths are considered to have been delivered securely"; `isSecureContext` feature detection. https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts (via MDN; also cited in search results)
- MDN, Origin Private File System — OPFS is per-origin, private, not user-visible; sync access handles are worker-only. https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- MDN, `SharedArrayBuffer` / cross-origin isolation — requires COOP `same-origin` + COEP `require-corp` + secure context. https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
- DuckDB docs, Troubleshooting (WASM) — single-threaded by default; `coi` bundle needs SharedArrayBuffer/COOP+COEP and falls back to `mvp`/`eh`; 4 GB WASM memory limit. https://duckdb.org/docs/1.5/clients/wasm/troubleshoot.html ; DuckDB WASM overview. https://duckdb.org/docs/1.3/clients/wasm/overview
- SQLite WASM deployment guidance (via secondary summary of `sqlite-wasm/README.txt`) — "the `sqlite3.wasm` binary cannot be loaded using the `file://` protocol… must be served through an HTTP or HTTPS server"; OPFS needs COOP/COEP. Secondary: treat as a warning, not a proof — P-01/P-04 decide.
- OpenReplay, "Running SQLite in the Browser With OPFS" — default `opfs` VFS needs COOP/COEP (SharedArrayBuffer); `opfs-sahpool` needs no headers, single connection; OPFS sync handles are worker-only. https://blog.openreplay.com/sqlite-browser-opfs/
- SQLite-WASM size: official build ~0.87 MB raw (868,907 bytes, v3.53.4-build2, measured 2026-10-05), ~400–457 KB gzipped (secondary measurements: KanopyLabs; MinnowDB comparison). https://kanopylabs.com/blog/pglite-vs-sqlite-wasm-vs-duckdb-wasm ; https://www.minnowdb.com/docs/comparison/
- DuckDB-WASM size: eh/mvp/coi bundles ~17–40 MB raw depending on version (jsDelivr listings for @duckdb/duckdb-wasm 1.24.0–1.33.1-dev; ~5.9 MB brotli for the eh bundle in one measured 2026-07-04 spike). https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm/dist/
- WebR size: base library ~12 MB; tidyverse ~92 MB total; ggplot2+dplyr+ggrepel ~39 MB (Quesma, 2025-08-07); self-hosted bundle 46.4 MiB total, largest file 18 MiB `R.wasm` (webr 0.6.0); webR 0.2.0 total 9.5 MB. https://quesma.com/blog/sandboxing-ai-generated-code-why-we-moved-from-webr-to-aws-lambda/
- ES modules under `file://`: module scripts are fetched in CORS mode; origin `null` can never satisfy the check (ESModules.com error reference). https://ESModules.com/errors/
- Workers under `file://`: Chromium `SecurityError` for file-path workers, blob-URL worker as workaround (Stack Overflow / Chromium issues, corroborated across sources); DuckDB sample notes "Do not use an `about:blank` page or a `file://` page. These pages have an opaque origin, and the Web Worker does not start."
- `file://` storage: Chromium 149 probe (2026) — IndexedDB/localStorage work under `file://` and persist across restart, ~10.7 GB quota, shared across local files; Microsoft WebView2 docs — `file://` origin is unique to its file path, storage works per path. The two disagree on keying; both are cited and neither is the restricted workstation — P-05 decides.
- Rust vs C++/Emscripten: wasm-pack glue ~10–20 KB tree-shakeable with typed `.d.ts` vs Emscripten ~30–100+ KB glue (+~50 KB filesystem layer); Rust small-module compressed floor 8–25 KB; "use Emscripten when porting existing C/C++; for new code, Rust" (secondary summaries: webassembly-wasm.com; devtoolsguide.com). No C++ asset exists in this project, so no benchmark was run.
- Prior-generator precedent (local files, read 2026-11-12): `~/workspace/pbgc-r5-generator/r5-generator.html` (768 KB, single file), `~/workspace/pbgc-del-generator/del-generator.html` (136 KB, single file); R5 embeds its rates workbook as base64 (`.b64` sidecar precedent); DEL `delSafeStorage()` defensive-loading precedent for opaque-origin storage failures.
- MASTER_PROMPT.md (governing spec) — §§ 3, 6–21, esp. §16 (options A/B/C, 13 criteria, `file://` warning), §17 (state model, invariants), §18 (wizard, dark theme), §19 (security), §21 (populations, measures).

---

*Stage 1 output 4 of 4. Read-only research; nothing in this document was built or executed. Every capability marked UNPROVEN requires its Stage 3 proof ( §10) before the product may depend on it.*
