# Stage 3 — Proof-of-Concept Results (P-01–P-10)

**Project:** PBGC Prior Administrator Accrued Monthly Benefit (PA_AMB) Analysis System
**Repo:** ErChulo/pbgc-pa-amb-analysis (public, `main`). Local dir: `~/workspace/pbgc-pa-amb-analysis`.
**Date:** 2026-11-12
**Status:** PoC experiments only. No engine, no UI, no full app. Nothing pushed, nothing written to Drive, no repo created.
**Governing spec:** `MASTER_PROMPT.md` §16/§21/§23; `stage1/04-architecture-decision.md` §5 and §10 (proof list + exit criteria); `stage2/01-data-model.md` and `stage2/04-calculation-functions.md` (integer minor units, decimal-safe arithmetic, bounds/scenarios path).

## 0. Environment — what ran where

| Item | Fact |
|---|---|
| Build machine | Linux VM, Node v24.22.1 |
| Rust toolchain | **Installed during this PoC** via rustup (network allowed it): rustc **1.99.1** (58cf8f9c3 2026-10-13), cargo 1.99.1, target `wasm32-unknown-unknown` added. Before this PoC: no rustc/cargo/wasm-pack, no `~/.cargo`. |
| wasm-pack | **Not installed.** The realistic kernel was built with `rustc` directly (`--target wasm32-unknown-unknown -O --crate-type cdylib`, no wasm-bindgen glue). The Stage 1 "~10–20 KB glue" figure for wasm-pack is therefore **unmeasured here, not assumed**. |
| Live browser | **None on this machine.** No Edge, no live browser task. Every result that needs Edge under `file://` is marked **NEEDS LIVE file:// BROWSER TEST** and has a probe file built and ready. Nothing in this file claims a browser result that was not measured. |
| Data | Synthetic only. Fictional participants, fictional plan, synthetic dates. No live case data, no participant-level census rows. |

## 1. Summary table

| # | Proves | Result | Evidence basis |
|---|---|---|---|
| P-01 | Base64-embedded WASM instantiates under `file://` in Edge | **NEEDS LIVE file:// BROWSER TEST** (byte-level mechanism **PASS in Node**) | `add(2,3)=5` from raw bytes in Node; probe HTML ready |
| P-02 | Realistic-size kernel practical embedded (size + compile time) | **NEEDS LIVE file:// BROWSER TEST** (size + compile **PASS in Node**) | Real Rust kernel 17,165 B raw / 22,888 b64 / 24,785 B HTML; compile 0.170 ms, instantiate 0.541 ms in Node |
| P-03 | Blob-URL worker runs under `file://`, receives WASM bytes | **NEEDS LIVE file:// BROWSER TEST** (worker source **PASS in Node**) | Source parses; ping→pong and WASM→5 proved in Node `worker_threads` |
| P-04 | OPFS reachable under `file://` (main thread + worker) | **NEEDS LIVE file:// BROWSER TEST** | Probe built; Node cannot establish anything about OPFS |
| P-05 | localStorage / IndexedDB under `file://` | **NEEDS LIVE file:// BROWSER TEST** | Probe built with DEL defensive-loading wrapper; Node cannot establish anything |
| P-06 | fetch / ES modules / instantiateStreaming fail as expected (negative control) | **PASS at spec level; NEEDS LIVE test for environment confirmation** | W3C WebAssembly Web API §2 verified by search 2026-11-12; probe attempts all three + static module import |
| P-07 | Export by download under `file://` | **NEEDS LIVE file:// BROWSER TEST** | Probe built; pattern already proven by R5/DEL/436/PF/E.Adm/E.Adj generators |
| P-08 | Single file loads with 0 fetch | **PASS (static check); NEEDS LIVE DevTools check** | `poc-p08-check.js`: 9 HTML files, 0 unexpected external-reference patterns |
| P-09 | Dark theme + toggle + 1,000-row table | **NEEDS LIVE file:// BROWSER TEST** (static checks pass) | CSS-token toggle, dark default, math sample, 1,000-row loop verified statically |
| P-10 | 100,000-row synthetic import + calculation | **PASS in Node (§21 baseline); NEEDS LIVE Edge measurement** | 100k rows: import 83.2 ms + calc/recon 15.8 ms = 98.9 ms; peak RSS 138.5 MB |

**Plain statement:** what is proved is the *byte-level and Node-level* behaviour of P-01, P-02, P-03, P-08 (static) and P-10 (Node), plus the *spec-level* fact behind P-06. What is **not** proved is anything that only Edge under `file://` on the restricted workstation can show: P-01/P-02/P-03/P-04/P-05/P-07/P-09 rendering and behaviour, P-06's environment confirmation, P-08's live network count, and P-10's Edge timing/memory. The live test is fully prepared — see §4 for the exact run sheet.

## 2. Per-proof results

### P-01 — Base64-embedded WASM instantiates — NEEDS LIVE file:// BROWSER TEST

- **Probe:** `stage3/poc/poc-p01-wasm-embed.html` (1.6 KB, sha256 `be8cb358…`), Node verifier `stage3/poc/poc-p01-node-verify.js`.
- **Method:** minimal hand-assembled WASM module (41 bytes): `(module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))`. Hand-assembled as raw bytes on the build machine because no Rust toolchain existed when the module was first built; the bytes' provenance does not change browser behaviour — the loading path (base64 → `atob` → `Uint8Array` → `WebAssembly.instantiate(bytes, {})`, no fetch, no MIME type) is what P-01 proves. Base64 embedded in the HTML; the probe calls `add(2,3)` and logs timing.
- **Measured evidence (Node v24.22.1, this machine):**
  - WASM bytes: **41**; base64 chars: **56** (ratio 1.366).
  - Base64 round trip: exact (byte-identical after decode).
  - `add(2,3)` = **5**; `add(-1,41)` = **40**.
  - Instantiate: **1.904 ms** (first run in the verify script; 0.395 ms in a separate warm run). Compile: **0.122 ms** (0.179 ms in the warm run).
- **Verdict:** byte-level mechanism PASS in Node. The Stage 1 pass criterion (`add(2,3) === 5`, no console error, Edge, `file://`, no flags, repeat after restart) is **not yet established** — it needs the live test.
- **If it fails live:** no WASM in the product; Option A. All kernels stay JS (Stage 1 §10).

### P-02 — Realistic-size WASM kernel practical embedded — NEEDS LIVE file:// BROWSER TEST

- **Probe:** `stage3/poc/poc-p02-wasm-kernel.html` (24,785 B, sha256 `d436d311…`), kernel source `stage3/poc/kernel.rs`, binary `stage3/poc/kernel.wasm`, Node verifier `stage3/poc/poc-p02-node-verify.js`.
- **Method:** real Rust kernel built on the build machine with rustc 1.99.1 (`--target wasm32-unknown-unknown -O --crate-type cdylib`, `#![no_std]`). Exports: `add`, `accrual_monthly_cents` (unit-credit `B = α·S·C̄`, integer minor units, i128 intermediate), `delta_cents`, `sum_i64`, `count_outside` (slice operations over WASM linear memory). No wasm-bindgen glue in this build.
- **Measured evidence (Node):**
  - Kernel raw bytes: **17,165**; base64 chars: **22,888** (ratio 1.333).
  - Probe HTML file: **24,785 B**; the base64 kernel is **92.3%** of it.
  - Instantiate: **0.541 ms**; compile: **0.170 ms**.
  - `accrual_monthly_cents(150, 20000, 500000)` = **150000n** — the Stage 2 §8 worked example (α = 1.5%, S = 20.000 y, C̄ = $5,000/mo → $1,500.00/mo). Correct.
  - `delta_cents(150000, 149500)` = **500n**. `sum_i64([100,200,300])` = **600n**. `count_outside(150..250)` = **2n**.
- **Limitation, stated:** this kernel is 17 KB because it is five small functions. A full §11 statistical kernel (robust regression, GAM, mixed-effects) would be larger; Stage 1's "100–500 KB" expectation for a realistic kernel is **not** confirmed or refuted by this measurement — only the size arithmetic (raw → base64 ×1.333 → HTML) and the sub-millisecond compile at this scale are measured. A larger kernel's compile time on office hardware is still unmeasured.
- **Verdict:** size + compile + behaviour PASS in Node. "HTML remains openable and interactive" in Edge is **not yet established** — needs the live test.

### P-03 — Blob-URL Web Worker — NEEDS LIVE file:// BROWSER TEST

- **Probe:** `stage3/poc/poc-p03-blob-worker.html` (sha256 `74919278…`), worker source `stage3/poc/poc-p03-worker-source.js`, Node verifier `stage3/poc/poc-p03-node-verify.js`.
- **Method:** worker source is a JS string in the HTML (in a `<script type="text/plain">` block, read via `textContent` — no string-escaping risk); blob URL → `new Worker(url)`; `ping` → `pong`; then the 41-byte WASM module is posted as bytes and the worker instantiates it and calls `add(2,3)`.
- **Measured evidence (Node):**
  - Worker source: **738 chars**; parses as valid JS (`vm.Script`).
  - In Node `worker_threads` (eval mode, `parentPort` shim): ping reply `{"type":"pong","echo":"hello"}`; WASM reply `{"type":"wasm-result","value":5}`.
- **Verdict:** worker source valid and its logic proved in Node. Whether a blob-URL worker **starts at all** in Edge under `file://` on the restricted workstation is **not established** — needs the live test.
- **If it fails live:** no workers; chunked main-thread execution is the only concurrency model (Stage 1 §10).

### P-04 — OPFS — NEEDS LIVE file:// BROWSER TEST

- **Probe:** `stage3/poc/poc-p04-opfs.html` (sha256 `b253047e…`).
- **Method:** `navigator.storage.getDirectory()` on the main thread; write marker file `pa-amb-p04-marker.txt`, read it back, report `navigator.storage.estimate()`; manual steps recorded in the probe: close Edge, reopen (restart survival), rename/move the file, reopen (origin-keying behaviour).
- **Measured evidence:** **none.** Node has no `navigator.storage`; nothing about OPFS can be established on this machine, and no result is claimed.
- **Verdict:** NEEDS LIVE file:// BROWSER TEST (including the manual restart + rename steps).
- **Design rule regardless of outcome:** OPFS is never the source of truth (Stage 1 §4.1/§5.5). A pass licenses it only as a session cache. **If it fails live:** OPFS is not used at all, even as a cache.

### P-05 — localStorage / IndexedDB — NEEDS LIVE file:// BROWSER TEST

- **Probe:** `stage3/poc/poc-p05-storage.html` (sha256 `93d315f7…`).
- **Method:** write a marker to localStorage and to IndexedDB (`pa-amb-p05` DB), read back; manual steps in the probe: restart survival, rename/move survival, and whether another local HTML file can see the marker (shared vs per-path keying). The probe implements the DEL defensive-loading precedent first: a `safeStorage()` try/catch wrapper — a `SecurityError` on an opaque origin must never kill the script; no-persistence fallback.
- **Measured evidence:** **none** from Node (no `localStorage`/`indexedDB` there). Nothing claimed.
- **Verdict:** NEEDS LIVE file:// BROWSER TEST.
- **Design rule regardless:** browser storage is never the source of truth and never holds PII by default; the DEL defensive-loading pattern stays regardless of the outcome.

### P-06 — Negative control (fetch / ES modules / instantiateStreaming) — PASS at spec level; NEEDS LIVE environment confirmation

- **Probe:** `stage3/poc/poc-p06-negative-control.html` (sha256 `d605d8ba…`) + companion module `stage3/poc/poc-p06-module.js`.
- **Method:** the probe attempts (a) `fetch("./poc-p06-negative-control.html")`, (b) `WebAssembly.instantiateStreaming(fetch("./add.wasm"))`, (c) dynamic `import("./poc-p06-module.js")`, and (d) a static import in a `<script type="module">` block importing `p06` from the companion module. Each must fail with a CORS/MIME error.
- **Measured evidence (spec, verified by web search 2026-11-12):** W3C WebAssembly Web API, §2 "Streaming Module Compilation and Instantiation" (Candidate Recommendation Draft, 2025-11-14, https://www.w3.org/TR/wasm-web-api/): "`instantiateStreaming` … If the `Response` is not CORS-same-origin, does not represent an ok status, or does not match the `application/wasm` MIME type, the returned promise will be rejected with a `TypeError`." The algorithm's steps reject with `TypeError` when the MIME type is null or is not a byte-case-insensitive match for `application/wasm`, and when the response is not CORS-same-origin. Under `file://` there is no `Response` with headers at all and the page origin is `null`, so `fetch` of a local file is itself CORS-blocked and no `application/wasm` response can exist. Module scripts are always fetched in CORS mode, so a relative import from origin `null` cannot satisfy the check.
- **Verdict:** the spec fact is the evidence and it is **confirmed**. The live test still has to confirm the environment matches the documented model (all three fail with the documented errors in Edge under `file://`). **If any succeeds live, the environment is not the restricted one — re-check the setup before trusting any other result.**

### P-07 — Export by download — NEEDS LIVE file:// BROWSER TEST

- **Probe:** `stage3/poc/poc-p07-export-download.html` (sha256 `74830cba…`).
- **Method:** two buttons download a generated JSON case package (`pa-amb-p07-case.json`) and a reconciliation CSV (`pa-amb-p07-reconciliation.csv`) via `Blob` + `URL.createObjectURL` + `<a download>`. The user confirms the files arrive with correct names and contents.
- **Measured evidence (local):** the download code path is the prior generators' proven export pattern (R5/DEL/436/PF/E.Adm/E.Adj all export this way); the probe's inline script parses cleanly in Node's `vm`. No download was executed on this machine (no browser).
- **Verdict:** NEEDS LIVE file:// BROWSER TEST (user confirmation step). Expected to pass — a failure here would contradict the prior generators' proven pattern and would force an export redesign before any product work.

### P-08 — 0 fetch — PASS (static check); NEEDS LIVE DevTools check

- **Probe:** `stage3/poc/poc-p08-zero-fetch.html` (sha256 `5470c95f…`); checker `stage3/poc/poc-p08-check.js`.
- **Method:** static grep of all 9 probe HTML files for external-reference patterns: `http(s)://`, external `src`/`href`, `fetch(`, `XMLHttpRequest`, dynamic/static `import`, `<script type="module">`, `<link href>`, `<img src>`, CSS `url(http)`, `WebSocket`, `sendBeacon`.
- **Measured evidence (run 2026-11-12, exit 0):**
  - 8 files: **no external-reference pattern found**.
  - `poc-p06-negative-control.html`: only the expected patterns (`fetch(`, dynamic import, static ES import, module script tag) — it is the negative control and must contain them; the checker verifies it contains all three forbidden attempts (control is live).
  - All 9 inline classic `<script>` blocks parse cleanly in Node's `vm`; `poc-p06-module.js` passes `node --check`.
- **Limitation, stated:** a static grep cannot prove zero network requests at runtime (a script could construct a URL dynamically). The live check is DevTools Network = 0 on reload in Edge under `file://`.
- **Verdict:** static PASS. Live DevTools check still needed.

### P-09 — Dark theme + toggle + 1,000-row table — NEEDS LIVE file:// BROWSER TEST

- **Probe:** `stage3/poc/poc-p09-dark-theme.html` (sha256 `73a00a44…`).
- **Method:** theme as CSS custom properties on the app root (`--bg`, `--fg`, `--muted`, `--accent`, `--row-alt`, `--border`, `--header-bg`); dark is the default (`data-theme="dark"` on `<body>`; dark: `#000000` background, `#f2f0e9` text, `#7fb3ff` accent; light: design-system blue `#002d72` header), toggle is a one-attribute switch with no reload. Math-notation sample in semantic HTML (`B_t = α·S_t·C̄_t`, `Δ_i = B_i^PA − B̂_i`, no KaTeX dependency). A 1,000-row table is generated in-page deterministically (PA_AMB cycles $1,000–$1,990; Δ = (i mod 7)·$1.00; disposition from a documented $5.00 test tolerance).
- **Measured evidence (static, Node):** dark default present; toggle code present; 1,000-row loop present; math sample present; **no** `http`/`fetch`/`<link>`/`<img>` in the file. No render timing was measured (no browser; the in-page `performance.now()` render timing is recorded only when the probe runs live).
- **Verdict:** static checks pass. Both-themes render, toggle behaviour, contrast, and the 1,000-row render in Edge are **not established** — needs the live test. A failure here fixes the theme implementation; it does not block the core.

### P-10 — 100,000-row synthetic import + calculation — PASS in Node; NEEDS LIVE Edge measurement

- **Script:** `stage3/poc/poc-p10-100k.js` (sha256 `83b280d7…`); outputs `stage3/poc/poc-p10-synthetic-{100,1000,10000,100000}.csv` (6.3 MB at 100k).
- **Method (§21 baseline):** deterministic fictional CSV (seeded PRNG, seed 20261112); chunked import (10,000-row chunks) into typed arrays (`Int32Array` service in milli-years, `BigInt64Array` avg monthly comp in cents with `-1n` = missing, `BigInt64Array` PA_AMB in cents); representative deterministic calculation per Stage 2 — unit-credit `B = 1.5% × S × C̄`, exact `BigInt` arithmetic `B = 150 × serviceMilli × avgCents / 10_000_000`, no binary float touches money (the PoC's stated rounding rule is integer-division truncation; a real plan's prescribed rounding per Stage 2 §4 would replace that line only); reconciliation `Δ = PA − recon` against a documented PoC test tolerance of $5.00 absolute (the Policy 5.8-1 $5 figure used here **only** as the PoC's stated test tolerance — Stage 1/2 are explicit that no PBGC tolerance governs the PA_AMB accept decision); bounds path for the planted 5% missing-avg rows (feasible avg range $1,000–$8,000/mo, recorded-position test, no exact number invented).
- **Measured evidence (Node v24.22.1, build machine — NOT Edge):**

| N | CSV bytes | Generate | Import (chunked) | Calc + recon | Import + calc | Exact | Bounds (missing avg) | Within $5 | Outside $5 | PA in bounds | PA out of bounds | Mean \|Δ\| | Max \|Δ\| | RSS | Peak RSS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | 6,372 | 1.0 ms | 0.2 ms | 0.1 ms | 0.3 ms | 92 | 8 | 82 | 10 | 6 | 2 | $1.23 | $16.26 | 61.2 MB | 61.2 MB |
| 1,000 | 63,111 | 4.8 ms | 1.9 ms | 0.7 ms | 2.5 ms | 944 | 56 | 869 | 75 | 39 | 17 | $1.07 | $19.79 | 70.2 MB | 70.2 MB |
| 10,000 | 630,583 | 24.5 ms | 13.7 ms | 2.1 ms | 15.8 ms | 9,493 | 507 | 8,812 | 681 | 314 | 193 | $0.97 | $19.99 | 84.4 MB | 85.5 MB |
| **100,000** | **6,305,426** | **137.1 ms** | **83.2 ms (10 chunks)** | **15.8 ms** | **98.9 ms** | **95,023** | **4,977** | **87,831** | **7,192** | **3,010** | **1,967** | **$1.00** | **$20.00** | **128.2 MB** | **138.5 MB** |

- **Internal-consistency check:** the planted discrepancy is ±$20 uniform on ~10% of exact rows, so mean \|Δ\| ≈ 0.1 × $10 = $1.00 and max \|Δ\| ≈ $20.00 — the measured $1.00 / $20.00 match the construction exactly. Bounds rows are ~5% at every N, as planted.
- **Limitations, stated:** (1) This is a **Node** measurement, not an Edge `file://` measurement — Edge timing/memory on office hardware is still unmeasured. (2) The PoC harness reads the whole CSV with `readFileSync` and chunks only the *parse* loop; a true streaming reader (`fs.createReadStream` / `File.slice`) was not used, so the import time is a parse-time baseline, not a streaming-I/O baseline. (3) RSS includes the Node runtime baseline (~61 MB at N=100); the incremental cost of 100k rows over 100 rows is ~77 MB peak. (4) The calculation is one representative formula (unit-credit); the full 34-formula catalog, validation, statistics, and report generation are Stage 4/5/7 work and are not timed here.
- **Verdict:** PASS in Node — all four populations completed without freezing or exhausting memory. The §21 baseline for Edge under `file://` still needs the live measurement.

## 3. Candidate-store verdicts — inspected on the build machine (2026-11-12)

Build-machine downloads for inspection only; the product stays 0-fetch. All three Stage 1 verdicts are **confirmed**, with two corrections (newer versions, larger DuckDB).

### 3.1 SQLite-WASM — REJECT as a required component (confirmed)

- **Version inspected:** `@sqlite.org/sqlite-wasm` **3.54.1-build1** (latest; Stage 1 cited 3.53.4-build2). Tarball `sqlite-wasm-3.54.1-build1.tgz`.
- **Measured:** `sqlite3.wasm` **868,907 bytes** (sha256 `2ee8f3dab694532afc8840e07703127287662d08b74e6ff50491ce63f00d5752`) — identical byte size to Stage 1's 3.53.4-build2 figure; gzip **402,022 bytes**. JS glue `index.mjs` 628 KB, worker `sqlite3-worker1.mjs` 622 KB.
- **Loader (inspected `dist/index.mjs`):** ES module (`main: ./dist/index.mjs`); loads the WASM with `fetch(url, { credentials: "same-origin" })` (line 63) and `WebAssembly.instantiateStreaming(response, imports)` (lines 163–164). OPFS support is present (`opfs`, `opfs-sahpool` VFS references) and the loader references `SharedArrayBuffer` gating.
- **Verdict:** REJECT as a required component stands — the stock loader is fetch-based + ES-module + `instantiateStreaming`, all three of which are incompatible with `file://` (P-06). Usable only via a rewritten embedded-base64 loader **and** a proved OPFS/worker path (P-01/P-04), as an optional non-essential query accelerator at most. The primary store remains the versioned case-package file.

### 3.2 DuckDB-WASM — REJECT (confirmed; sizes at/above the Stage 1 range)

- **Version inspected:** **1.29.0** (latest tag is a dev build, `1.33.1-dev57.0`; 1.29.0 is the last stable inspected). Tarball 28 MB; unpacked size **147,227,490 bytes**.
- **Measured:** `duckdb-mvp.wasm` **40,621,595 bytes** (gzip 7,958,264; base64 **54,162,127** chars); `duckdb-eh.wasm` **35,659,694 bytes** (gzip 7,033,686; base64 47,546,259 chars). Stage 1's range was ~17–40 MB raw — the measured bundles sit at the top of / just above that range.
- **Loader (inspected `dist/duckdb-browser.mjs`, ESM):** worker-based (separate `duckdb-browser-*.worker.js` files, including a `coi.pthread` threaded bundle), `instantiateStreaming` used 3 times, `SharedArrayBuffer` referenced. Embedding the mvp bundle base64 alone would make a **~54 MB HTML file**.
- **Verdict:** REJECT stands — size alone disqualifies it from a single self-contained HTML deliverable; the worker + header requirements disqualify it under `file://`. Grouped aggregation over 100k rows is milliseconds in plain JS over typed arrays (P-10: the whole calc+recon pass over 100k rows took 15.8 ms in Node).

### 3.3 WebR — REJECT (confirmed)

- **Version inspected:** `webr` **0.6.1** (latest).
- **Measured:** `R.wasm` **18,653,928 bytes** (downloaded from the jsDelivr CDN copy of the package, 200 OK). Loader `webr.mjs` 66 KB is an **ES module** (`main: dist/webr.mjs`); the loader references the default package repo `repo.r-wasm.org` (network fetch for R packages on demand).
- **Verdict:** REJECT stands for the office deliverable — 18.7 MB base runtime before any R package, ES-module loader, network-dependent package repo. Each disqualifying on its own; together decisive. WebR (and native R) remain useful **off the office path** on the build machine for trusted reference calculations for §20 tests.

## 4. SharedArrayBuffer / multithreading — SETTLED (no experiment needed)

**Settled: unavailable under `file://`. Do not design for multithreading.**

- **Citation (verified by search 2026-11-12):** MDN, "Agent communication and coordination" and `WorkerGlobalScope.crossOriginIsolated` — shared memory is restricted to **cross-origin isolated** websites only; a document is cross-origin isolated only if it is returned with an HTTP response carrying `Cross-Origin-Opener-Policy: same-origin` **and** `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`). A `file://` page has no server and no HTTP response headers, so `crossOriginIsolated` is `false` and `SharedArrayBuffer` is not exposed. (MDN: https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/crossOriginIsolated)
- **Consequence:** no threaded WASM build, no `SharedArrayBuffer` data sharing, no Atomics-based worker pool. Parallelism, if ever needed, is multiple single-threaded workers with `postMessage` — and workers themselves are unproven (P-03). The performance plan assumes a single thread, as P-10 measured.

## 5. Stage 3 exit-criteria assessment (Stage 1 §10)

Stage 1 §10: *"The architecture in §6 is confirmed if P-01 (or its documented failure, with the Option A fallback) + P-06 + P-07 + P-08 + P-10 are recorded."*

| Exit item | Recorded? | What is recorded |
|---|---|---|
| P-01 | **Recorded (Chromium live)** — Edge outcome not yet | Playwright/Chromium `file://`: `add(2,3)=5`, instantiate 6.20 ms first launch, 9.70 ms after restart, no errors (§11). |
| P-06 | **Recorded (Chromium live)** — Edge confirmation not yet | All four attempts failed with CORS/fetch errors; no stop condition (§11). |
| P-07 | **Recorded (Chromium live)** — Edge confirmation not yet | Both downloads arrived intact with correct names and contents (§11). |
| P-08 | **Recorded (Chromium live)** — Edge confirmation not yet | 0 http/https requests on both pages, load + reload (§11). |
| P-10 | **Recorded (Chromium live)** — Edge baseline not yet | Import 117.7 ms, calc 18.2 ms, total 135.9 ms; counts identical to Node; browser RSS peak 103.9 MB (§11). |
| P-04 (not an exit item) | **Recorded as FAIL (Chromium live)** | OPFS `getDirectory()` throws SecurityError under `file://`; OPFS not used at all (§11). |

**Assessment: the exit criteria are satisfied in a live Chromium `file://` browser (Playwright, §11) — all five exit items are recorded. They are NOT yet satisfied as written (Edge on the restricted workstation).** The architecture (Option C, staged) is confirmed for Chromium; the definitive Edge-on-Windows confirmation still stands as the final step. Stage 4 is scoped to build the deterministic core in the Option A shape (pure TypeScript, no WASM, no workers) regardless, so Stage 4 may proceed on the confirmed foundations; the WASM/worker path remains gated on the Edge confirmation. P-04's failure removes OPFS from the architecture entirely.

## 6. Live browser test — run sheet (what must still be done)

Environment: a Windows machine running the same Microsoft Edge version as the restricted workstation. Open each probe by double-click (`file://`), no server, no flags, no admin rights, no internet. Record the outcome of each item in this file (or a dated addendum) before Stage 4 depends on it.

1. **P-01** — open `poc-p01-wasm-embed.html`. Record: `add(2,3)` value, instantiate ms, any console error, Edge version. Repeat after a browser restart. Pass = `add(2,3) === 5`, no error.
2. **P-02** — open `poc-p02-wasm-kernel.html`. Record: all five exported values, instantiate/compile ms, time-to-interactive (does the page stay responsive while loading the 24.8 KB file). Pass = values correct, page interactive.
3. **P-03** — open `poc-p03-blob-worker.html`. Record: pong reply, wasm-result value, any worker error. Pass = worker replies and `add(2,3) === 5` inside the worker.
4. **P-04** — open `poc-p04-opfs.html`. Record: main-thread getDirectory/write/read result, `storage.estimate()` quota/usage. Close Edge, reopen, record whether the marker survived. Rename/move the file, reopen, record whether the marker survived and whether the origin key looks per-path or shared.
5. **P-05** — open `poc-p05-storage.html`. Record: localStorage and IndexedDB marker write/read results, quota. Close Edge, reopen, record survival. Rename/move the file, reopen, record survival and whether another local HTML file can read the marker.
6. **P-06** — open `poc-p06-negative-control.html` with DevTools console open. Record the exact error text for fetch, instantiateStreaming, dynamic import, and the static module import. Pass = all four fail with CORS/MIME errors. If any succeeds, stop and re-check the setup.
7. **P-07** — open `poc-p07-export-download.html`, click both buttons. Record: file names, sizes, contents (open the JSON and CSV and confirm they match the probe's data). Pass = both arrive intact.
8. **P-08** — open `poc-p08-zero-fetch.html` with DevTools Network recording, reload. Record: total request count (must be 0, including fonts/workers/WASM). Repeat for `poc-p02-wasm-kernel.html` (WASM must not fetch).
9. **P-09** — open `poc-p09-dark-theme.html`. Record: dark theme renders (black background, off-white text), toggle switches to light and back without reload, 1,000 rows render (record the in-page render ms), math sample legible, no external resource requested (Network tab).
10. **P-10** — in Edge under `file://`, import the generated `poc-p10-synthetic-100000.csv` (6.3 MB) through a file picker into typed arrays, run the same unit-credit calculation + reconciliation, and record import time, calculation time, and peak memory (`performance.memory` where available, else Task Manager observation). Compare with the Node baseline (§2, P-10 table).

## 7. Files produced (all under `~/workspace/pbgc-pa-amb-analysis/stage3/`)

| File | sha256 (first 8) | What it is |
|---|---|---|
| `01-poc-results.md` | — | This file |
| `poc/poc-p01-wasm-embed.html` | `be8cb358…` | P-01 probe (41-byte hand-assembled WASM, base64) |
| `poc/poc-p01-node-verify.js` | `6c3537ef…` | P-01 Node verifier |
| `poc/poc-p02-wasm-kernel.html` | `d436d311…` | P-02 probe (real Rust kernel, base64) |
| `poc/poc-p02-node-verify.js` | `f2ef2f99…` | P-02 Node verifier |
| `poc/poc-p03-blob-worker.html` | `74919278…` | P-03 probe (blob-URL worker) |
| `poc/poc-p03-worker-source.js` | `c417f029…` | P-03 worker source (also embedded in the HTML) |
| `poc/poc-p03-node-verify.js` | `d71fb264…` | P-03 Node verifier |
| `poc/poc-p04-opfs.html` | `b253047e…` | P-04 probe |
| `poc/poc-p05-storage.html` | `93d315f7…` | P-05 probe (DEL defensive-loading wrapper) |
| `poc/poc-p06-negative-control.html` | `d605d8ba…` | P-06 probe (fetch / instantiateStreaming / module import) |
| `poc/poc-p06-module.js` | `d6649481…` | P-06 companion ES module |
| `poc/poc-p07-export-download.html` | `74830cba…` | P-07 probe |
| `poc/poc-p08-zero-fetch.html` | `5470c95f…` | P-08 probe |
| `poc/poc-p08-check.js` | `473ad792…` | P-08 static checker (exit 0) |
| `poc/poc-p09-dark-theme.html` | `73a00a44…` | P-09 probe |
| `poc/poc-p10-100k.js` | `83b280d7…` | P-10 §21 baseline harness (Node) |
| `poc/poc-p10-synthetic-100.csv` | — | P-10 synthetic input, 100 rows |
| `poc/poc-p10-synthetic-1000.csv` | — | P-10 synthetic input, 1,000 rows |
| `poc/poc-p10-synthetic-10000.csv` | — | P-10 synthetic input, 10,000 rows |
| `poc/poc-p10-synthetic-100000.csv` | — | P-10 synthetic input, 100,000 rows (6,305,426 B) |
| `poc/kernel.rs` | `4e2598d4…` | P-02 Rust kernel source |
| `poc/kernel.wasm` | `297c6e5d…` | P-02 Rust kernel binary (17,165 B) |
| `poc/add.wasm` | `f61fd62f…` | P-01 hand-assembled module (41 B) |

Note: `stage3/date-primitives-harness.js` is a sibling worker's file (date primitives), not part of this PoC; it was left untouched.

## 8. What this PoC did not do

- No engine, no UI, no full app was built. No code was pushed to GitHub, no repository created, nothing written to Drive, nothing uploaded.
- No live case data was used anywhere. All participants are fictional (`SYN-000001`…), all dates synthetic, the plan is fictional ("Plan A" unit-credit 1.5%).
- No capability claim in this file rests on an assumption: every claim cites either a measurement above, a cited spec (W3C WebAssembly Web API §2; MDN cross-origin isolation), or an inspected package file (with version and byte counts). Where a local harness could not establish an item, the item is recorded as needs-live-test, not as a pass.
- The Rust toolchain now installed on the build machine (`~/.cargo`, rustc 1.99.1) is build-machine state only; the office deliverable needs no toolchain, and no product file depends on Rust until Stage 3's live P-01/P-02 results and Stage 5 profiling say otherwise.

## 9. Sources

## 10. Addendum — independent verification by Muse, 2026-11-12

The Stage 3 outputs were verified by the parent agent before reporting to the user.

- Date-primitives harness re-run in Node: **58/58 checks passed** (Node v24.22.1).
- P-01 Node verifier re-run: **PASS** — `add(-1,41) = 40`, instantiate 0.450 ms, compile 0.063 ms.
- P-02 Node verifier re-run: **PASS** — `accrual_monthly_cents(150,20000,500000) = 150000n` ($1,500.00, matches the Stage 2 worked example), `sum_i64([100,200,300]) = 600`, `count_outside(150..250) = 2`, instantiate 0.629 ms, compile 0.167 ms, probe HTML 24,785 B.
- P-03 Node verifier re-run: **PASS** — ping→pong, wasm-result 5.
- P-10 Node harness re-run: **PASS** — N=100,000, CSV 6,305,426 B, import chunked 87.1 ms, calc+recon 16.5 ms, total 103.5 ms, peak RSS 139.3 MB, 95,023 exact / 4,977 bounds, mean |Δ| $1.00, max |Δ| $20.00.
- **Live file:// browser test could NOT be run from this machine.** Two attempts failed: (1) `browser.browse` accepts HTTP/HTTPS URLs only and rejects `file://` URLs; (2) the VM's Chromium binary (`/opt/meta-chromium/chrome`, Muse Browser 157.0.8103.77) will not start headless — it exits with "Hatch WebGL domain policy is required for browser startup" even with `--no-sandbox --disable-gpu --disable-webgl` and a fresh profile. Serving the probes over HTTP was not used as a substitute: it would change the origin and would not test `file://` behaviour.
- Consequence: the §6 live Edge run sheet still needs to be run on a Windows machine running the same Microsoft Edge version as the restricted workstation, by double-clicking each probe under `file://`. Until those outcomes are recorded, the exit criteria in §5 remain unsatisfied and the architecture is prepared for confirmation, not confirmed. Stage 4 may build on the confirmed foundations listed in `03-architecture-verdict.md` §2.1 and must not depend on any live item listed in §2.2.

## 11. Addendum — live browser test via Playwright, 2026-11-12

The user asked whether Playwright could run the live test. It could. Playwright 1.65.0 was installed in `stage3/live-test/` (`npm install playwright`; `npx playwright install chromium`) and the run sheet (§6) was executed by a Playwright script (`live-test/run-live-test.js`, with follow-ups `rerun-followup.js` and `rerun-p10-rss.js`; full machine-readable record in `live-test/results.json`). No probe file was modified.

**Environment (recorded once, applies to every result below):** Chromium 158.0.8127.18 (Playwright 1.65.0, headless shell), Node v24.22.1, Linux x86_64, `file://`, no server, no flags beyond headless, no internet. User-Agent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/158.0.8127.18 Safari/537.36`.

**This is NOT Microsoft Edge on Windows and NOT the restricted office workstation.** Edge is Chromium-based, so this is a strong approximation, not the definitive workstation test. Every result below is labelled "Chromium (Playwright) on Linux, file://". The definitive test — Edge on the user's Windows machine, same version as the restricted workstation — still stands as the final confirmation.

### Results

- **P-01 — PASS.** `add(2,3) = 5`, instantiate 6.20 ms (first launch), 9.70 ms (after a full browser restart and reopen), no console errors, no page errors.
- **P-02 — PASS.** Probe log: `add(2,3) = 5`, `accrual(150,20000,500000) = 150000` ($1,500.00, the Stage 2 worked example), `delta(150000,149500) = 500`, instantiate 6.50 ms; navigation-to-PASS 77 ms; main-thread round trip 2 ms (page stayed responsive). All five exports verified by re-instantiating the same kernel bytes in-page (Node verifier calls): add 5, accrual 150000, delta 500, `sum_i64([100,200,300]) = 600`, `count_outside(0,3,150,250) = 2`.
- **P-03 — PASS.** Pong reply `{"type":"pong","echo":"hello"}`, wasm-result value 5, no worker error. A blob-URL worker starts and runs WASM under `file://`.
- **P-04 — FAIL.** `navigator.storage.getDirectory()` throws `SecurityError: "It was determined that certain files are unsafe for access within a Web application, or that too many calls are being made on file resources."` under `file://` in Chromium. `isSecureContext: true`, `navigator.storage` present, `location.origin: "file://"`. No marker was ever written, so the restart/move checks could not proceed. **Consequence: OPFS is not available under `file://` and is not used at all — not even as a session cache.** The versioned case-package file remains the primary store (already the Stage 1/2 design); nothing in the architecture depended on OPFS. This is a Chromium-wide restriction for `file://` origins (OPFS requires a safe origin), so it is expected to hold in Edge as well, but the Edge test is the final word.
- **P-05 — PASS.** localStorage usable; marker survived a browser restart (previous marker read back on reopen); survived the probe file being renamed/moved; readable from a different local HTML file (shared origin, not per-path). IndexedDB: opened OK, marker read back, survived restart, readable from a different local HTML file. (Method note: the first run captured the probe log before the async IndexedDB callbacks fired, so IndexedDB was re-run in a follow-up with a proper wait for the IndexedDB lines; the follow-up is the recorded result. localStorage and IndexedDB under `file://` are shared across all local files — a consequence for the design: browser storage must never hold PII by default and is never the source of truth.)
- **P-06 — PASS (environment gate, run first).** All four attempts failed as expected: fetch `TypeError: Failed to fetch`; `instantiateStreaming` `TypeError: Failed to fetch`; dynamic import `TypeError: Failed to fetch dynamically imported module: file:///.../poc-p06-module.js`; static module import failed with a CORS policy error in the console (`Access to script at 'file://...' from origin 'null' has been blocked by CORS policy: Cross origin requests are only supported for protocol schemes: chrome, chrome-untrusted, data, http, https.`). **No stop condition triggered** — the environment is the restricted one. Note: `location.origin` reports `"file://"` in page JS, but the CORS error cites origin `'null'` (opaque origin); the restriction holds either way.
- **P-07 — PASS.** Both downloads arrived intact. JSON `pa-amb-p07-case.json`, 78 bytes, contents exactly `{"formatVersion": "1.0.0", "case": "SYNTHETIC-P07", "participants": 3}`. CSV `pa-amb-p07-reconciliation.csv`, 98 bytes, contents exactly the probe's three lines. Export by download works under `file://`.
- **P-08 — PASS.** 0 http/https/ws/data/blob requests on `poc-p08-zero-fetch.html` and on `poc-p02-wasm-kernel.html` (load + reload each). Total request events were 2 per page — both are the `file://` document loads themselves, not network fetches.
- **P-09 — PASS.** Dark theme renders: body background `rgb(0, 0, 0)`, text `rgb(242, 240, 233)`, header `rgb(10, 31, 68)`. Toggle switches to light (body `rgb(255, 255, 255)`, header `rgb(0, 45, 114)` = `#002d72`) and back to dark without reload. 1,000 rows rendered in 11.0 ms. Math sample present. 0 external requests.
- **P-10 — PASS.** 100,000 rows imported through a file picker into typed arrays; three runs: import 117.7 / 116.5 / 127.3 ms, calc+recon 18.2 / 12.8 / 12.7 ms, total 135.9 / 129.3 / 140.0 ms. Counts identical to the Node baseline in every run: exact 95,023, bounds 4,977, within $5: 87,831, outside: 7,192, PA inside bounds: 3,010, outside: 1,967, mean |Δ| $1.00, max |Δ| $20.00. Peak memory: the test browser's process RSS rose from 96.5 MB to a peak of 103.9 MB (+7.4 MB) during the run (sum of RSS of the Chromium processes belonging to the test browser, sampled every 50 ms). The in-page `performance.memory` figure stayed flat at 9.5 MB throughout and is not trusted as a peak measure (coarse in the headless shell). The Node baseline (import 83–101 ms, calc 16–20 ms, total ~99–121 ms, peak RSS ~139–144 MB) is a whole-process measure and is not directly comparable to the browser's incremental RSS; the comparison that matters is that the browser run is in the same time range and completes without freezing.

### Exit-criteria status after the Playwright run

All five exit items (P-01, P-06, P-07, P-08, P-10) are now recorded in a live Chromium `file://` browser. **The exit criteria as written (Edge on the restricted workstation) are not yet satisfied** — the Chromium results are a strong approximation that de-risks the architecture, and the definitive Edge test still stands. P-04's failure is recorded and removes OPFS from the architecture entirely (it was only ever a candidate session cache). Stage 4 is scoped to build the deterministic core in the Option A shape (pure TypeScript, no WASM, no workers) regardless, so Stage 4 may proceed on the confirmed foundations; the WASM/worker path remains gated on the Edge confirmation.

### Methodology notes (for the record)

- The P-01 summary in the first run printed FAIL because the results object had no top-level `.pass` field for P-01; both P-01 runs actually passed. Fixed in `results.json` (top-level `pass: true`).
- The P-05 first run captured the log before the async IndexedDB callbacks fired; the follow-up re-run with a proper wait is the recorded IndexedDB result.
- The first P-10 RSS attempt summed ALL Chromium processes on the machine (387 → 442 MB, 1 sample) and was discarded as contaminated; the recorded figure comes from a clean re-run that sampled only the test browser's processes.

- W3C, WebAssembly Web API (Candidate Recommendation Draft, 2025-11-14), §2 — `instantiateStreaming` TypeError conditions. https://www.w3.org/TR/wasm-web-api/
- MDN, `WorkerGlobalScope.crossOriginIsolated` — cross-origin isolation requires COOP `same-origin` + COEP `require-corp`/`credentialless` HTTP headers. https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/crossOriginIsolated
- MDN, "Agent communication and coordination" — shared memory restricted to cross-origin isolated websites. https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Agent_communication_and_coordination
- npm registry, `@sqlite.org/sqlite-wasm` 3.54.1-build1 (tarball inspected; `dist/index.mjs` lines 63, 163–164 fetch + `instantiateStreaming`).
- npm registry, `@duckdb/duckdb-wasm` 1.29.0 (tarball inspected; `duckdb-mvp.wasm` 40,621,595 B, `duckdb-eh.wasm` 35,659,694 B).
- npm registry / jsDelivr, `webr` 0.6.1 (`R.wasm` 18,653,928 B; `dist/webr.mjs` ES-module loader; default repo `repo.r-wasm.org`).
- `stage1/04-architecture-decision.md` §5, §10, §12 (proof list, exit criteria, prior-generator precedent, size figures checked against).
- `stage2/04-calculation-functions.md` §8 (unit-credit worked example: 1.5% × 20 y × $5,000/mo = $1,500.00/mo) and §3 (integer minor units, decimal-safe arithmetic).
- `stage2/01-data-model.md` §1.2 (money as integer minor units; blank is `null`, never 0).
