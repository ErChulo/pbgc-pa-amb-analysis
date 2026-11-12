# Stage 7 — Reproducibility verification (03)

**Verifier:** Reproducibility verifier, Stage 7 (verify only — no source file edited).
**Date:** 2026-11-12. **Governing spec:** `MASTER_PROMPT.md` §20 and §17;
`MONADIC_ARCHITECTURE_SPEC.md` §9.4 / §10 G12 (a test rebuild from the same
source snapshot and rule versions produces the same placements and narrative values).
**System under test:** engine `src/` (compiled to `dist/` with `npm run build`,
tsc clean) and the single-file app `pa-amb-analysis.html`.
**Method:** one shared driver (`stage7/03-repro-flow-driver.js`, extracted
verbatim from `test/ui-playwright/wizard-flow.test.mjs` `drive()` with only
replacements R1–R6: `window` → `globalThis`, fixed eventIds instead of
`Date.now()`, document guards, plus `import` / `snapshot` / `goto-export`
actions) drives the identical full flow in Node and in the browser
(Playwright 1.65.0 + Chromium 158, `file://`). Every timestamp fixed
(`2026-11-12T00:00:00.000Z`); every run compared with sha256.
Synthetic data only (Harborview demo case 00098765, 6 SYN participants;
seeded 100-participant population SYN-R7-001..100).

**Tree state during verification:** `src/` was at commit `b3afc3c` plus
uncommitted changes by sibling Stage 7 workers (`src/index.ts` re-exports;
at 18:41 a sibling added wizard Run-button code to `src/ui/main.ts` /
`src/ui/template.html` and rebuilt the html). `dist/` was rebuilt by me
with `npm run build` at the start and again at the end (tsc clean both
times); the Node artifact hashes were identical before and after the
sibling's edit. Browser runs before 18:41 used the 401,313-byte html;
runs after used the 417,665-byte html; driver-flow artifact hashes were
identical across both. The `$` build defect (D1) is present in **both**
html builds because `build/bundle.mjs` is unchanged.

## Overall verdict: NOT REPRODUCIBLE AS SHIPPED — FAIL

The **engine is fully deterministic**: every Node check and every
fixed-build browser check passes byte-identical. But the **shipped
single-file app is not byte-reproducible against the engine**, because
the build script silently corrupts the bundle (D1, critical), and the
exported audit log is incomplete (D2). G12 **fails** for the shipped
artifact and **passes** for a correctly built artifact. Both defects are
small, precisely located, and verified with a fix demonstration (D1)
or a concrete fix path (D2). No engine nondeterminism was found.

## 1. Deterministic rebuild (G12)

### 1a. Harborview demo, Node — PASS

`node stage7/03-repro-node.mjs` — full flow (import → validate → calculate
→ reconcile → statistics → decide → approve → publish → snapshot), three
runs: A and B in one process, C in a fresh child process. All 17 artifacts
byte-identical across A, B, C:

| artifact | sha256 (all three runs) |
|---|---|
| state.json | `9bb37d95e1de…` |
| steps.json | `7e93f8978862…` |
| reconciliation.csv | `fdbeed18ea7f…` |
| reconciliation.xlsx | `f51424818c30…` |
| contribution.json | `0d4a14c9e99d…` |
| audit-log.json | `fbb576ad9483…` |
| audit-log.txt | `64831279df89…` |
| plan-report.html | `d1d011910833…` |
| participant-SYN-001.html | `35a9ff359d49…` |
| participant-SYN-002.html | `b48f3ad25328…` |
| participant-SYN-003.html | `9d16bb45c442…` |
| participant-SYN-004.html | `49070d6fb4c2…` |
| participant-SYN-V-01.html | `923c655791b6…` |
| participant-SYN-I-01.html | `7db6c44f71a9…` |
| amb-memo.html | `3dd08b393dc7…` |
| event-log.json | `bd05d1e8fe7e…` |

(Full hashes in `stage7/runs/node-A/`; run the script to reproduce.)
Spot values (all as expected): validate 405 rules / 145 findings;
SYN-001 exact $1,500.00; SYN-V-01 exact $849.50; SYN-003 exact $1,500.00,
Δ $1,000.00, outside tolerance; SYN-002 bounds $1,584–$1,683, SYN-004
$900–$960, recorded inside; SYN-I-01 indeterminate (DOTE blank);
dispositions verified ×2, requires-investigation ×3, indeterminate ×1;
SYN-001 approved verified by A. Actuary.

### 1b. Harborview demo, browser vs browser — PASS

`node stage7/03-repro-browser.mjs`, runs A and B (fresh contexts, fixed TS):
all 20 artifacts identical, 0 http/https requests (1 `file://` request).
Downloaded files equal the artifacts rebuilt from snapshot rows, except
the shipped-build XLSX (see D1).

### 1c. Harborview demo, browser vs Node — FAIL on shipped html; PASS on fixed build

Shipped `pa-amb-analysis.html`: **10 of 16 compared artifacts differ**
from Node (contribution.json, event-log.json, 5 participant reports,
plan-report.html, state.json, steps.json; plus downloaded XLSX differs
from the rebuilt XLSX). **Every difference is the `$` build bug D1**
— no other difference exists. Deep diff of `state.json`:
`casePackage`, `calculations`, `reconciliations`, `statistics` — 0 diffs;
`validation` — 6 diffs, all money strings (`$2500.00` vs `2500.00`,
rules X-06/C-06, SYN-003); `lastContribution` — 1 diff (finding
statement `$1500.00` vs `1500.00`); `eventLog` — 2 diffs (validation
event, contribution-published event — same `$` strings).

Fixed build (`/tmp/r7-app-fixed.html`, same esbuild output, template
replacements done with functions — see D1): **browser A == browser B ==
Node A on every artifact**, including all four real downloads.
`steps.json` is the sole exception and is a harness artifact: the browser
script does not record the harness-only `state` action (DOM-dependent
`charts`/`reportHasCase`) or the `snapshot` action in its steps — all real artifacts match.

Rendered charts/report HTML (separate check, `/tmp/chart-check.mjs`):
`#chart-area` and `#report-area` innerHTML byte-identical across two
fixed-build browser runs (sha256 `4f05a9e7…` / `d6a578eb…`).

### 1d. Synthetic 100-participant case, Node — PASS

`node stage7/03-repro-population.mjs` — 100 fictional participants
(SYN-R7-001..100, mulberry32 seed 20261112), each through
calculate → reconcile → disposition, plus describePopulation +
detectOutliers. Canonical JSON byte-identical across A, B, C
(sha256 `274659127c322d61…`). Ground truth reproduced exactly:
70× Δ0, 10× +$1,000.00, 10× −$50.00, 10× +$0.50; dispositions 90
verified / 10 requires-investigation; modified-z flags exactly the
10 planted $1,000 gaps (score 6.420752022846264).

## 2. Nondeterminism sources — sweep

`node stage7/03-repro-sweep.mjs` (33 `.ts` files). Hits and traced verdicts:

| source | location | reaches an output? |
|---|---|---|
| `Date.now` / `performance.now` | **none** (only comment mentions in `statistics.ts:22-23`, `charts.ts:10`) | — |
| `new Date()` wall clock | `src/ui/main.ts:1436` `nowIso()` — the **only** clock read in the app | **YES — D3.** Stamps every UI dispatch → `eventLog.occurredAt` and eventIds (`ui-disp-<key>-<occurredAt>`); those flow into audit eventIds and dispositionIds. Proven by browser run C (below). |
| `new Date()` pure date math | `src/dates.ts:81` (epoch-day → date), `src/validation.ts:648` (days-in-month) | No — pure functions of their inputs. |
| `Math.random` / `randomUUID` | **none** (only comment mentions) | — |
| Seeded PRNG | `src/statistics.ts` mulberry32; every stochastic function takes an explicit seed or a constant default (`20261112`) | No — reproduces exactly (§4). |
| Mutable module global | `src/pipeline.ts:245` `let stepCounter` — **only** mutable module global in `src/` | **Contained.** Reset at `calculateAccruedBenefit` start (`pipeline.ts:2305`); saved/restored around speculative runs (`runExactPathIsolated`, 1888–1890). Proven: in-process runs A/B identical including trace step numbers. |
| Sort comparators that can tie | 32 `.sort(` calls; ties possible at `pipeline.ts:556`, `missingdata.ts:746/799`, `reconciliation.ts:564`, `statistics.ts:2303`, `exports.ts:406` | **Contained.** JS `Array.sort` is stable (ES2019+); ties keep insertion order, and insertion order is deterministic for identical inputs. Observation O1: `pipeline.ts:556` never returns 0 on tie (returns 1) — latent smell, not a defect. |
| `Object.keys/values/entries`, `Map`/`Set` iteration | 25 + 19 sites, all insertion-ordered | **Contained.** Every order fed into an output derives from a fixed array order (package participant order; first-seen merge order). `contribution.ts:580` sorts keys for stable JSON. |
| Fixed timestamps in exports | XLSX fixed DOS date 1980-01-01 (`exports.ts:134-135`); `buildAuditLog` sorts by `at`, stable (`exports.ts:406`); contribution package fixed key order + 2-space indent | No — by design, deterministic. |
| Real-click leak (browser run C) | Demo loaded via real `#demo-button` click + Export nav via real click | **YES — D3.** `state.json` differs from the fixed-TS run in exactly 4 paths: `eventLog.0.actor` (`demo`→`user`), `eventLog.0.occurredAt` (fixed TS → wall clock, e.g. `2026-11-12T18:45:09.787Z`), `eventLog.29.actor`, `eventLog.29.occurredAt`. Everything else — including the downloaded audit log, contribution, CSV — identical. |

## 3. Contribution package determinism — PASS (with an order note)

`node stage7/03-repro-merge.mjs`: 25 checks, all PASS.

- T1 identity: `mergeLogs(emptyLog, x) == x`, `mergeLogs(x, emptyLog) == x`.
- T2 determinism: same merge twice → identical.
- T3 **order-dependence (stated, by design): the merge is associative but
  NOT commutative.** `mergeLogs(a,b)` yields findings `[f-a, f-b]`;
  `mergeLogs(b,a)` yields `[f-b, f-a]` (first-seen order is part of the
  result). Any R1 rebuild must therefore pin merge *order*, not just the
  set of logs — the ledger must record it.
- T4 associativity: `(a+b)+c == a+(b+c)` for disjoint logs, exact
  duplicates, conflicting findings, conflicting fragments, and a mixed
  log — all PASS.
- T5 conflict escalation: same `findingId`+version, different content →
  first kept, `reviewState: "disputed"`, exactly one blocking conflict
  issue with deterministic id
  `conflict:finding:f-a@0.1.0 / run-1`; re-merging does not duplicate it.
- T6 idempotence `mergeLogs(x,x) == x`; T7 exact duplicates dedup silently
  with no issue; T8 a new version of a finding is kept alongside the old
  one with no conflict; T9 inputs are not mutated; T10 trace events dedup
  by full content.

## 4. Statistical determinism — PASS

`node stage7/03-repro-stats.mjs` on the §1d population: isolation forest,
multivariate outliers, OLS, Huber, ridge, lasso, mixed-effects, Bayesian,
GAM, k-fold CV, decision tree, `kFoldIndices`, `mulberry32` stream,
`seededShuffle` — each run twice in-process and once in a fresh process,
explicit seeds **and** default seeds. All byte-identical across A, B, C
(sha256 `d4ccd0f347cb42d6…`). Sanity values: isolation forest flags
exactly 5/100 at contamination 0.05; CV RMSE 314.42; OLS R² 0.0204;
GAM R² 0.1626. (An early print of `flagged.length === 100` was the
boolean-array length, not the flagged count — no defect.)

## 5. Audit-log completeness and determinism

`node stage7/03-repro-audit.mjs` + the §1a run.

- **Determinism: PASS with a fixed timestamp.** Same `occurredAt` twice →
  identical audit log. Different `occurredAt` → audit logs differ in
  exactly two fields per event: `auditEventId` (embeds the caller eventId,
  which embeds `occurredAt`) and `occurredAt`. Byte-identical audit
  output therefore requires a fixed calculation date (D3).
- **Completeness: FAIL — D2.** After the full flow the exported audit log
  (`state.analysis.auditLog`, the file the Export step downloads) has
  **7 events, all disposition-related**: 6× `disposition-proposed` +
  1× `disposition-approved`. It contains **no** record of import,
  validation (405 rules / 145 findings), the 6 calculations, the 6
  reconciliations, statistics, evidence-recording, or contribution
  publication. The full UI event log (30 events) records all of those,
  but it is never exported. Refusals: analysis-event refusals (unknown
  participant; propose with no evidence) **do** append a
  `transition-refused` audit event; UI-level refusals (locked
  wizard-go-to, `evidence-recorded` for an unknown participant) do **not**
  reach the audit log — only `lastRefusal` (transient) + the event log.
- Approval content (good): the approval event names the reviewer
  (`A. Actuary`), carries `participantKeys`, `inputSnapshotHash` and
  `ruleVersion` in `detail`. Observations O2/O3: the human-readable
  `summary` does not name the participant (the structured field does),
  and `detail` carries no `determinationId`.

## Defects

### D1 — CRITICAL: `build/bundle.mjs` corrupts the bundle — every `$` before `${` is stripped

**Location:** `build/bundle.mjs:72-73` (unchanged, mtime 2026-11-12 18:26).
```js
.replace(STYLE_PLACEHOLDER, `<style>\n${css}\n</style>`)
.replace(BUNDLE_PLACEHOLDER, `\n${bundleJs}\n`);
```
`String.prototype.replace` with a **string** replacement interprets `$`
patterns in the replacement text: `$$` → literal `$`. The esbuild bundle
contains 12 `$$` sequences (template literals of the form `` `$${x}` ``);
each loses one `$` in the shipped html.

**Proof:**
- Minimal: `'BUNDLE'.replace('BUNDLE', 'const s = `!$A$1:$${x}$${y}`')`
  yields `` `!$A$1:${x}${y}` `` — the `$` is eaten.
- Byte-exact: fresh CLI esbuild output (`/tmp/full-min.js`, 407,049 bytes)
  with every `$$`→`$` applied equals the shipped bundle byte-for-byte
  (`sim[:-1] == ship`, 407,036 bytes; the 1 byte is the trailing newline).
  esbuild itself is exonerated (isolated tests preserve `$$`).
- The CSS replacement is safe (styles.css contains no `$`).

**Observed damage (12 sites in the shipped bundle):**
`formatMoneyMinor` (`validation.ts:620`) and the reports money formatter
(`reports.ts:267`) — **every `$X.XX` money string in the app loses its
`$`** (validation findings X-06/C-06, contribution finding statements,
report amounts); XLSX print area (`exports.ts:292`)
`$A$1:$H$7` → `$A$1:H7`; tolerance detail (`reconcile.ts:564-565`,
4 sites); anti-decrease violation (`compose.ts:666`, 2 sites);
negative-benefit guardrail (`formulas.ts:296`); PA_AMB observation display
(`main.ts:1071`). `$1`/`$2,500.00`/`$99.00` literals survive (no such
capture group → left literal), which is why only the `$$` sites corrupt.

**Reproduction:** `node stage7/03-repro-browser.mjs` (shipped html) —
browser vs Node: 10 artifact diffs, all `$` strings; downloaded XLSX
differs from the rebuilt XLSX by the print-area bytes only.
**Proposed fix:** use replacement *functions* in `build/bundle.mjs`:
`.replace(BUNDLE_PLACEHOLDER, () => `\n${bundleJs}\n`)` (same for styles);
add a build gate asserting the inlined bundle equals the esbuild output
(or at least that the html contains `$$` where the bundle does); rebuild
`pa-amb-analysis.html` and re-run this verification. **Fix demonstrated:**
`/tmp/r7-app-fixed.html` (function replacements only) → browser A == B ==
Node on every artifact (§1c).

### D2 — Exported audit log records dispositions only; calculations are not recorded

**Location:** `src/ui/state.ts` `applyEvent` + `src/ui/main.ts`
export-audit-log handler (`JSON.stringify(state.analysis.auditLog)`).
`applyCaseEvent` (`src/decisions.ts`) appends audit events only for
`analysis-event`s; the UI's `calculation-completed`,
`validation-completed`, `reconciliation-completed`,
`statistics-completed`, `contribution-published`, and `import-case-package`
events never go through it. The `calculation-event` AnalysisEvent kind
exists (`decisions.ts:1914,2205`, incl. a `calculation-run` audit kind)
but **no production code dispatches it** (only `test/decisions.test.ts`
does); likewise `finish-run`/`close-case` are never dispatched by the UI.

**Reproduction:** `node stage7/03-repro-node.mjs`, then inspect
`stage7/runs/node-A/audit-log.json` (7 events, all `disposition-*`) vs
`stage7/runs/node-A/event-log.json` (30 events, full flow). Or run
`node stage7/03-repro-audit.mjs` §A.
**Expected:** per the task and MASTER_PROMPT §17 ("every approved
determination retains its supporting evidence" / auditable transitions),
every calculation, decision, and approval is recorded in the exported log.
**Proposed fix (coordinator's call on scope):** either (a) route
calculation / reconciliation / statistics / validation / publication
completions through `applyCaseEvent` as audit events (dispatching the
existing `calculation-event` kind for calculations), or (b) export the
UI `eventLog` alongside the audit log and document that the audit log is
disposition-only by design. Either way, document the intended scope; do
not leave the gap silent. UI-level refusals (locked navigation,
bad `evidence-recorded`) should likewise be decided: audit event or
documented as event-log-only.

### D3 — No fixed-calculation-date mode: hand-driven runs are not byte-reproducible

**Location:** `src/ui/main.ts:1436` `nowIso()` (only clock read in the app);
`src/decisions.ts` (timestamps/ids are caller-supplied by design);
`test/ui-playwright/wizard-flow.test.mjs` (Stage 6 driver uses
`` `ui-propose-${key}-${Date.now()}` `` and `` `ui-approve-${key}-${Date.now()}` ``).

**Reproduction:** browser run C in `03-repro-browser.mjs` (real clicks on
`#demo-button` and the Export nav button): `state.json` differs from the
fixed-TS run in exactly 4 paths, all wall-clock `occurredAt` values
(§2). Separately, `03-repro-audit.mjs` §C proves audit logs differ only in
`auditEventId`/`occurredAt` when the caller timestamp changes.
**Expected:** G12 rebuilds from the same snapshot + rule versions must
produce the same outputs; that is only achievable if the app pins the
calculation/run timestamp instead of reading the wall clock per dispatch.
**Proposed fix:** add an explicit calculation-date (or run-timestamp)
input, pinned on the CalculationRun/InputSnapshot, and use it for all
event timestamps; fix the Stage 6 driver to use fixed eventIds (this
verification's driver already does — `…-fixed`). Note the engine itself
is blameless here (it never reads a clock); the gap is the missing
app-level control. Severity: medium — it blocks byte-level G12 for any
hand-driven run, but the fixed-timestamp path already works.

## Observations (not defects)

- **O1** `src/pipeline.ts:556` — sort comparator `(a.periodStart < b.periodStart ? -1 : 1)` never returns 0 on tie. Contained by stable sort; suggest returning 0 for equal starts.
- **O2** Audit `summary` text omits the participant key (the structured `participantKeys` field carries it). Consider naming the participant in the summary.
- **O3** Approval audit `detail` carries no `determinationId` (has `fromDisposition`, `toDisposition`, `inputSnapshotHash`, `ruleVersion`).
- **O4** `mergeLogs` is associative but **not** commutative (first-seen order, §3/T3). R1 rebuilds must pin merge order in the ledger, not just the log set.

## Coverage and limits

- Covered: Harborview demo end-to-end (Node ×3, browser ×2, browser-vs-Node, fixed-build parity, real-click leak demo); 100-participant synthetic case (Node ×3); all stochastic statistics modules (explicit + default seeds, ×3); mergeLogs (25 checks); audit completeness + refusal recording + timestamp dependence; full nondeterminism sweep of `src/`; rendered charts/report HTML bytes.
- Not covered: the 804-test Node suite was not re-run (out of scope; `tsc` clean only); the sibling's new wizard Run buttons (added 18:41, after most runs) were not exercised — the driver flow was unaffected (artifact hashes unchanged); office Edge/Windows behaviour was not tested (Linux Chromium only).
- Harness notes: an early version of `03-repro-node.mjs` wrote `audit-log.json` with a spurious trailing newline (1-byte false diff vs the download); fixed during verification — the download handler writes no trailing newline, and both sides now match. `steps.json` differs between Node and browser only by the harness-only `state` action (DOM fields), not by any app output.

## Scripts and evidence (all NEW files under `stage7/`)

- `03-repro-build-driver.mjs` + `03-repro-flow-driver.js` — shared driver (see header).
- `03-repro-node.mjs` — Harborview rebuild, Node ×3 (runs in `stage7/runs/node-A|B|C/`).
- `03-repro-browser.mjs` — Harborview rebuild, browser ×2 + real-click run + fixed-build mode (`R7_APP_URL`, `R7_LABEL`) (runs in `stage7/runs/browser-A|B/`, `browser-C-clicks/`, `fixed-browser-A|B/`).
- `03-repro-population.mjs` — 100-participant case (`stage7/runs/population100-A|B|C`).
- `03-repro-stats.mjs` — stochastic modules (`stage7/runs/stats-A|B|C`).
- `03-repro-merge.mjs` — mergeLogs T1–T10.
- `03-repro-audit.mjs` — audit coverage / refusals / timestamp dependence.
- `03-repro-sweep.mjs` — nondeterminism source sweep.
- Evidence artifacts: `stage7/runs/` (per-run files + sha256 comparisons printed by each script). No source file was edited; no push, no Drive write, no upload.
