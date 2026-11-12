# Stage 7 — Compliance verification report

**Project:** PBGC PA_AMB Analysis System
**System under test:** `pa-amb-analysis.html` (401,313 bytes, sha256
`25f3e49e4b549e68605839d029ec6b9ddd75d18cc409ba5341741b1bbb79b2cf`),
`src/` (engine + UI), `build/` (bundle.mjs, check-zero-fetch.mjs)
**Verifier:** Compliance verifier (Stage 7), read-only — no existing
source file was edited. New verification files only, under `stage7/`.
**Date:** 2026-11-12
**Governing spec:** `MASTER_PROMPT.md` §19 (security/privacy), §20
(verification/testing), §18 (UI — dark by default, wizard, theme
toggle); `stage3/03-architecture-verdict.md` §2.1/§2.2 (what Stage 6
may build on / must NOT depend on); `stage3/01-poc-results.md` §11
(Playwright live test: 9 of 10 passed, P-04 OPFS failed and is out).
**Browser:** Playwright 1.65.0 + Chromium 158, `file://`, headless,
Linux build machine. This is the Stage 3 Chromium approximation, NOT
Microsoft Edge on the restricted office workstation — the definitive
Edge confirmation still stands (unchanged caveat).

## Verdicts at a glance

| # | Check | Verdict |
|---|-------|---------|
| 1 | Single HTML file, file://, no flags | **PASS** |
| 2 | 0 fetch (static gate + live network recording) | **PASS** |
| 3 | No LLM in the calculation path; deterministic | **PASS** |
| 4 | No network/CDN/external packages in the app | **PASS** |
| 5 | Human approval gate | **PARTIAL — 1 minor defect (D3)** |
| 6 | Mandatory audit log | **PARTIAL — 1 major defect (D1)** |
| 7 | Synthetic data only | **PASS** |
| 8 | §19 security | **PARTIAL — 1 major defect (D2)** |
| 9 | Defensive loading | **PASS** |

**Checks fully passed: 6 of 9. Checks partial: 3 of 9. Checks failed
outright: 0 of 9. Defects: 0 critical, 2 major, 1 minor.**

**Overall compliance verdict: NOT YET COMPLIANT — do not release
until D1 and D2 are fixed; D3 should be fixed in the same pass
(it is a one-guard fix).** No critical defect was found: there is no
network access, no data leak, no crash, and no path by which the
system can approve a disposition on its own. The three defects are
all gaps against the spec's own requirements (audit completeness,
export warnings, determination/disposition consistency), not
bypasses of the human gate.

## Evidence files (new, Stage 7 only)

- `stage7/01-static-compliance.mjs` — 48 static checks (S1–S10).
  Run: `node stage7/01-static-compliance.mjs`. Result: 46 pass,
  2 fail (S8e, S8f — both are defect D2).
- `stage7/02-playwright-compliance.mjs` — 41 live checks (L1–L5).
  Run: `node stage7/02-playwright-compliance.mjs`. Result: 37 pass,
  4 fail (L3d = D1; L4f/L4g = D2; L5g = D3). Machine-readable
  results: `stage7/02-playwright-results.json`.
- `stage7/04-compliance.md` — this report.

Supporting runs (read-only, no source edited):
- `npx tsc --noEmit` — clean.
- `npm test` — **804 pass, 0 fail** (matches the Stage 6 report).
- `node test/ui-playwright/run.mjs` — **4/4 suites pass**
  (wizard-flow, zero-fetch, theme-rows, defensive-loading).
- `node test/ui-playwright/defensive-loading.test.mjs` — re-run,
  PASS (vm + Playwright).

## 1. Single HTML file, file://, no flags — PASS

Static checks S1a–S1j (script `01-static-compliance.mjs`):
- Exactly **1** `<script>` tag, inline, no `src`; 0 `<link>`, 0
  `<img>`, 0 `<iframe>`, no `type="module"`, no `@import`,
  no `@font-face`, no CSS `url(` outside `URL.createObjectURL`.
- The only `http://`/`https://` strings are **13 distinct XML /
  JSON-Schema namespace identifiers** (`http://www.w3.org/2000/svg`,
  `http://schemas.openxmlformats.org/…`, `http://purl.org/dc/elements/1.1/`);
  **0 `https://` URLs at all**. The two allow-listed
  `https://json-schema.org` / `https://pbgc-caseworkbench/contribution/`
  prefixes in the checker are not even present in the built file.
- File size **401,313 bytes**, exactly as the Stage 6 report states;
  sha256 `25f3e49e…b2cf`.
- Template `src/ui/template.html` has no external reference; the
  bundle is one classic-script IIFE (`globalName: PaAmbApp`,
  ES2022, minified, no sourcemap) inlined into it.
- Fonts are system fonts only (`"Helvetica Neue", Helvetica, Arial,
  sans-serif`); no font loads.
- Live: every Playwright run in this verification opened the file by
  double-click equivalent (`file://…/pa-amb-analysis.html`, no
  server, no flags beyond headless) and booted with no errors.

## 2. 0 fetch — PASS

- Static gate S2: `node build/check-zero-fetch.mjs` exits 0 —
  "PASS 0-fetch check: pa-amb-analysis.html (401313 bytes) — no
  fetch/XHR/import/link/script-src/img-src/url(/module, and no
  http(s) URL outside the documented XML/JSON-Schema namespace
  identifiers."
- Live L1b/L1c/L2j/L2k (script `02-playwright-compliance.mjs`):
  requests recorded from browser launch through **load + reload +
  the full wizard run** (import → validate → calculate →
  reconcile → statistics → decide → approve → publish → all four
  exports): **2 requests total, both `file://` document loads,
  0 http/https, 0 non-file**. The existing
  `test/ui-playwright/zero-fetch.test.mjs` agrees (2 requests,
  all `file://`).

## 3. No LLM in the calculation path — PASS

- Static S3a/S10: 0 hits for `fetch(`, `XMLHttpRequest`,
  `WebSocket`, `EventSource`, `sendBeacon`, `axios`, `openai`,
  `anthropic`, `chatgpt`, LLM/API-call code in `src/` +
  `build/entry.ts`; 0 `eval(` / `new Function(` anywhere.
  (One apparent hit class was excluded with cause: the forbidden
  patterns appear as regex literals inside the 0-fetch *checker*
  itself, `build/check-zero-fetch.mjs`, which is build-time tooling
  and is never shipped.)
- Static S6a/S6b: no `Date.now`, `Math.random`, `new Date()`,
  `performance.now` in engine `src/`; the engine never touches
  `document`/`window`/`navigator`. (The `window` hits in
  `src/formulas.ts:754/760` and `src/pipeline.ts:1007` are local
  variables — `const window = sorted.slice(…)` — an averaging
  window, not the global; verified by reading the declarations.)
- Live L2d: the calculation step run twice over the demo case
  produces **byte-identical JSON** (SYN-001 exact 150000,
  SYN-V-01 exact 84950, SYN-002 bounds 158400–168300,
  SYN-I-01 indeterminate). Calculations are pure deterministic
  functions of their inputs.

## 4. No network/CDN/external packages — PASS

- Static S4a–S4f: `package.json` has **no runtime dependencies**;
  devDependencies are exactly `typescript 5.9.3` and
  `esbuild 0.28.2` (installed versions verified). Root
  `node_modules/` contains only `@esbuild`, `esbuild`,
  `typescript`. Playwright `^1.65.0` exists **only** under
  `stage3/live-test/` (test-only) and is absent from the root
  `package.json`. The built HTML contains **0** occurrences of
  `esbuild` / `playwright`.
- Static S3b: 0 telemetry / analytics / remote-error-reporting
  identifiers (`telemetry`, `sentry`, `bugsnag`, `datadog`,
  `crashlytics`, `google-analytics`, `gtag`, `mixpanel`,
  `amplitude`, `posthog`) in `src/` + `build/` + template.
- Static S5a: 0 occurrences of `WebAssembly`, `new Worker`,
  `getDirectory` (OPFS), `indexedDB`, `sessionStorage`,
  `SharedArrayBuffer` in `src/` + `build/`. The Stage 3 §2.2
  prohibitions are honoured: the app is pure TypeScript, Option A
  shape, with no WASM, no worker, no OPFS, and no browser storage
  in the critical path — as Stage 4 was scoped to be. The P-04
  OPFS failure (SecurityError under `file://`) is respected:
  OPFS is not used at all.

## 5. Human approval gate — PARTIAL (defect D3, minor)

What holds (verified live, script `02-playwright-compliance.mjs`
§L5, on a fresh demo run with all six participants recommended):

- L5a: approve with actor `"system"` → **refused**,
  `human-gate`: "only an authorized human reviewer may approve,
  reject, or re-open a disposition — the system may only
  recommend". Status stays `recommended/verified`.
- L5b: approve with empty actor `""` → refused, same guard.
- L5c: approve with reviewer `"system"` → refused (reviewer-mismatch
  fires first in T3; the approval is refused either way).
- L5c2: approve where the determination AND the approval both name
  reviewer `"system"` → refused: "§14 item 10 … incomplete:
  reviewer is missing or is the system, not a human".
- L5d: approve by `"B. Reviewer"` when the determination names
  `"A. Actuary"` → refused: "the approver must be the reviewer
  named in the determination".
- L5e: approve with a false §4.2 confirmation → refused:
  "confirmation refused: entry conditions do not hold".
- L5f: approve with an empty determination rationale → refused
  (G-INV-7): "§14 item 10 … incomplete: rationale is missing…".
- L5h: a system `propose` applies as a **recommendation only**,
  with `downstreamUse = {usableInValuation: false, valueCents: null,
  valueKind: "none", paAmbAccept: null}` — no downstream effect.
- L5i: no approved disposition was ever created by `"system"`.
- L5k: approve with no recommended disposition (no evidence state)
  → refused: "no evidence state exists … run a calculation or
  bounds computation first".
- L2h: the legitimate human approval (actor `"A. Actuary"`,
  reviewer `"A. Actuary"`, complete determination, all
  confirmations true) applies: `approved/verified`.
- Static S7a–S7h: exactly **one** construction site for an approved
  `DispositionRecord` (`src/decisions.ts:1435`, inside T3) and
  exactly **one** for an `ApprovalRecord`
  (`src/decisions.ts:1420`, inside T3); `isHuman()` gates
  T3/T4/T5/T6; `approveDetermination` (`src/determination.ts:745`)
  refuses reviewer `"system"`, reviewer mismatch, and any false
  §4.2 confirmation; `src/dispositionMapping.ts` is recommend-only
  by construction ("Always `recommended`. This module never
  produces `approved`"); `template.html` has **no approve control**
  — approval exists only via the `dispatchDisposition` API, which
  routes through the engine transition. The contribution package
  also honours G13 (`src/publication.ts:801`): a requested
  `"approved"` package status without a recorded approval is
  downgraded to `"draft"` with a blocking warning.
- No UI button approves anything (Stage 6 open item: the wizard
  has no in-app Run/Decide buttons at all; steps are driven through
  `window.PaAmbApp` + `window.__paAmbHandle`).

What fails: **D3** (minor) — see Defects.

## 6. Mandatory audit log — PARTIAL (defect D1, major)

What holds:
- L3b/L3c: the exported audit log
  (`00098765-audit-log.json`, downloaded from the Export step)
  holds **exactly the 7 events in the Stage 6 report**: 6 ×
  `disposition-proposed` (one per participant, actor `system`)
  + 1 × `disposition-approved` (SYN-001, actor `A. Actuary`,
  "Disposition verified approved by A. Actuary."). Verbatim
  dump (one-off `/tmp/audit-dump.mjs`, same run shape):

  ```
  2026-11-12T00:00:00.000Z | system | disposition-proposed | Disposition verified proposed (recommended).
  2026-11-12T00:00:00.000Z | system | disposition-proposed | Disposition requires-investigation proposed (recommended).
  2026-11-12T00:00:00.000Z | system | disposition-proposed | Disposition requires-investigation proposed (recommended).
  2026-11-12T00:00:00.000Z | system | disposition-proposed | Disposition requires-investigation proposed (recommended).
  2026-11-12T00:00:00.000Z | system | disposition-proposed | Disposition verified proposed (recommended).
  2026-11-12T00:00:00.000Z | system | disposition-proposed | Disposition indeterminate proposed (recommended).
  2026-11-12T00:00:00.000Z | A. Actuary | disposition-approved | Disposition verified approved by A. Actuary.
  ```
- Every approval is recorded (1 approval, present above).
- Refusals are recorded too: every refused attack in §L5 appended
  a `transition-refused` audit event (verified in the attack run's
  state; `lastRefusal` surfaced each refusal).
- L2l: all 9 invariants hold after the full run (rendered
  `#invariant-list`: 9 Pass, 0 Fail), including Invariant 7
  (approved determinations retain evidence).

What fails: **D1** (major) — see Defects. The exported audit log
records decisions and approvals, but not calculations (or
validation, reconciliation, statistics, or import).

## 7. Synthetic data only — PASS

- Static S9a–S9f: demo case (`src/ui/demo.ts`) is Harborview
  Manufacturing Pension Plan, case `"00098765"`, six participants
  with `firstName: "Fictional"` and last names One–Six, keys
  `SYN-001/002/003/004/V-01/I-01`; `ssn: sourced(null)` — no SSN
  is stored. **0** SSN-pattern matches (`ddd-dd-dddd`) in `src/`,
  in `test/`, and in the built HTML. The only 9-digit strings are
  decimal arithmetic literals (e.g. `0.6666666667`).
- The `St. Rose` / `Blonder-Tongue` mentions in `src/` and `test/`
  are plan-rule citations in comments (e.g. `St. Rose §3.2(b)`
  months rule), not participant or case data.
- All 804 Node tests and the Playwright runs use the same
  synthetic demo case. No real names, case numbers, SSNs, or plan
  data were found anywhere in `src/`, `test/`, or the HTML.

## 8. §19 security — PARTIAL (defect D2, major)

What holds:
- Local-only processing: no network (check 2), no telemetry /
  analytics / remote error reporting (S3b), no automatic uploads,
  no CDN (check 4). The template subtitle states "Offline only.
  Nothing is uploaded." No `fetch`/XHR/WebSocket anywhere in the
  app. The only browser storage is the theme preference
  (`pa-amb-theme`), a display preference only, never PII, never
  the source of truth (see check 9).
- Explicit control of import/export: import is by file picker /
  demo button only; every export is a user-clicked download
  (`Blob` + `URL.createObjectURL` + `<a download>`).
- S8a: **no claim** that browser storage provides encryption or
  durable protection anywhere in `src/`, `docs/`, `README.md`,
  or the template (grep for encrypt/durable-protection/secure
  storage: 0 hits).
- S8b/S8g: the §19 warning text exists
  (`src/ui/exports.ts: sensitiveExportWarningText()` — "Warning:
  this participant-data export may contain sensitive participant
  information (names, dates of birth, benefit amounts). It is
  processed locally only and must not be sent outside PBGC systems.
  Confirm you need this export before it is written.") and
  `confirmSensitiveExport()` returns `false` always — it never
  auto-approves.
- Live L4a–L4e: the CSV export shows a real `confirm` dialog
  with the **exact** warning text; accepting downloads
  `00098765-reconciliation.csv` (6 rows, SYN-003 delta 100000
  present); **dismissing blocks the download entirely** (no
  download event within 2.5 s). The XLSX export behaves the
  same (dialog shown, `00098765-reconciliation.xlsx` on accept).
  Data minimisation: the reconciliation CSV/XLSX carry participant
  keys and amounts only — no names, no DOBs, no SSNs (SSN is
  null in the demo package).

What fails: **D2** (major) — see Defects. Two of the four export
buttons download participant-level data with no warning at all.

## 9. Defensive loading — PASS

- Static S5b–S5d: `localStorage` appears in exactly one source
  file, `src/ui/theme.ts`, behind the DEL `safeStorage()` wrapper:
  every access is inside `try/catch` with a null / no-persistence
  fallback; 5 `catch` blocks in the module; no top-level
  `localStorage` access. The built HTML contains 2 `localStorage`
  occurrences (the guarded getter) and the `pa-amb-theme` key.
- Live re-run of the existing test
  (`node test/ui-playwright/defensive-loading.test.mjs`): **PASS**
  both halves — (a) Node vm: the bundle boots with a throwing
  `localStorage` getter, theme falls back to dark, `loadTheme` /
  `setTheme` never throw; (b) Playwright: with `localStorage`
  made to throw before any page script runs, the app renders and
  the theme toggle still works in-session.
- Full UI suite re-run confirms the same (`run.mjs`: 4/4).

## Defects

### D1 — MAJOR — Calculations are not recorded in the exported audit log

- **Location:** `src/ui/state.ts`, `applyEvent()` — the
  `validation-completed`, `calculation-completed`,
  `reconciliation-completed`, `statistics-completed`,
  `import-case-package`, `evidence-recorded`, and
  `contribution-published` branches update display state and append
  to the in-memory `UiState.eventLog` only; they never append to
  `analysis.auditLog`. Only `analysis-event` (via
  `applyCaseEvent` in `src/decisions.ts`) appends engine audit
  events. `src/ui/main.ts: exportAuditLogText()` exports
  `state.analysis.auditLog` only — `eventLog` is never exported
  anywhere.
- **Requirement:** check 6 / MASTER_PROMPT §17 ("Every transition
  appends an event" to the audit log) and §22 audit/provenance:
  every calculation, decision, and approval is recorded in the
  audit log.
- **Reproduction (live, `02-playwright-compliance.mjs` L3d):**
  run the demo end-to-end (import → validate 405 rules →
  calculate 6 participants → reconcile → statistics → decide →
  approve SYN-001 → publish → export audit log). Downloaded
  `00098765-audit-log.json` contains **7 events, all disposition
  events, 0 `calculation-run` events**. In the same state,
  `analysis.auditLog.length === 7` while
  `UiState.eventLog.length === 36` (30 in the one-off dump run),
  with kinds `import-case-package, validation-completed,
  calculation-completed, reconciliation-completed,
  statistics-completed, evidence-recorded, analysis-event,
  contribution-published, wizard-go-to` — i.e. the full record of
  the run exists only in memory and is lost when the page closes.
- **Effect:** an exported audit log cannot prove which calculations
  were run, with which inputs/rule versions, or in which order;
  reproducibility (Invariant 2) is asserted by the pins, not
  evidenced by the log. Decisions and approvals ARE recorded, so
  this is not a silent-approval hole.
- **Proposed fix:** route each step completion through the engine
  as a `calculation-event` family event in `applyCaseEvent`
  (which already appends a `calculation-run` audit event), or
  append an audit event in `applyEvent` for each of the seven
  step branches (actor + occurredAt already on every event),
  with the run id / rule version / participant key in the detail.
  Alternatively export `eventLog` alongside the audit log — but
  the audit log itself should carry the calculation events, since
  that is the file the actuary keeps.

### D2 — MAJOR — Two of four exports skip the §19 sensitive-data warning

- **Location:** `src/ui/main.ts` — the `#export-audit-log` click
  handler calls `downloadJson(…)` directly, and
  `downloadContributionJson()` calls `downloadJson(…)` directly;
  neither calls `reviewerConfirmsSensitiveExport()`. By contrast
  `downloadReconciliationCsv()` / `downloadReconciliationXlsx()`
  do gate on it. Static S8e/S8f; live L4f/L4g.
- **Requirement:** MASTER_PROMPT §19 — "clear warnings before
  exporting sensitive information"; `src/ui/exports.ts` states
  "Never export participant data without the reviewer seeing this
  warning first."
- **Reproduction (live, `02-playwright-compliance.mjs` L4f/L4g):**
  on the Export step, with a `dialog` listener attached and no
  `window.confirm` stub, click **Audit log (JSON)** → 0 dialogs,
  `00098765-audit-log.json` downloads immediately. Click
  **Contribution package (JSON)** → 0 dialogs,
  `00098765-amb-contribution.json` downloads immediately. (The
  CSV/XLSX buttons in the same session each showed exactly 1
  `confirm` dialog with the exact warning text.)
- **Effect:** the audit log (participant keys, dispositions,
  reviewer names) and the contribution package (participant-level
  findings, protocol v0.1.0) leave the app with no warning, while
  the less sensitive reconciliation table is gated. The files are
  still local-only downloads — no data leaves the machine — so
  this is a missing-warning gap, not a leak.
- **Proposed fix:** gate both handlers on
  `reviewerConfirmsSensitiveExport("participant-data")` exactly
  as the CSV/XLSX handlers do (return `false` / do nothing when
  the reviewer does not confirm). The audit-log handler is an
  inline listener in `bootApp()`; `downloadContributionJson()`
  needs the same one-line gate. Add a Playwright assertion that
  all four export buttons produce a dialog.

### D3 — MINOR — T3 approves a disposition while attaching a determination for a different disposition

- **Location:** `src/decisions.ts`, `transition()`, T3 branch
  (approve). The branch re-checks entry conditions for the
  *current* disposition, checks the reviewer match, and calls
  `approveDetermination()` — but nothing checks that
  `event.determination.humanDetermination.disposition` (or
  `recommendedDisposition.disposition`) equals the current
  disposition being approved.
- **Requirement:** §14 — the approved determination is the record
  of the disposition it approves; an approval must not attach a
  determination that says something else. (The human gate itself
  is intact: actor, reviewer, rationale, and confirmations are
  all still enforced.)
- **Reproduction (live, `02-playwright-compliance.mjs` L5g):**
  fresh demo run, all six recommended; dispatch an `approve`
  event for **SYN-003** (current disposition
  `requires-investigation`, status `recommended`) with actor
  `"A. Actuary"` and a complete, internally consistent
  determination whose `humanDetermination.disposition` and
  `recommendedDisposition.disposition` are both `"verified"`
  (recorded/calculated $1,500.00, downstream verified). Result:
  **applied** — `approved/requires-investigation`, `refusal:
  null`, with the "verified" determination attached
  (`determinationId: det-attack-1`).
- **Effect:** the audit trail holds a contradictory approval
  (approved `requires-investigation` + a `verified`
  determination). No valuation leak: `downstreamUse` for the
  approved record is still `{usableInValuation: false,
  valueCents: null, valueKind: "none", paAmbAccept: "N"}`
  (verified live, L5g2), because downstream use is computed from
  the record's own disposition, not the determination's. Hence
  minor, not major or critical.
- **Proposed fix:** in the T3 branch, refuse (guard
  `human-gate` or `entry-conditions`) when
  `event.determination.humanDetermination?.disposition !==
  current.disposition`, and likewise when
  `recommendedDisposition.disposition` differs. Add a unit test
  in `test/decisions.test.ts` for the mismatched-determination
  approval (mirroring L5g).

## Non-defect observations (no action required for compliance)

- **Stage 6 open item, unchanged:** the wizard has no in-app Run
  buttons for Validate / Calculate / Reconcile / Statistics /
  Decide — those steps are driven through the `window.PaAmbApp`
  API. A human using the file in the office can load the demo case
  and export, but cannot yet run the steps from the UI alone.
  This is a usability gap already recorded in
  `docs/STAGE6_BUILD.md`, not a compliance failure under the nine
  checks.
- **Percentile outlier screen flags SYN-001 as well as SYN-003**
  on the tiny 6-participant demo (L2f flags:
  `SYN-003/modified-z, SYN-001/percentile, SYN-003/percentile`).
  Stage 6 documents this as the engine's stated behaviour on a
  tiny population; the assertion is on modified-z for that reason.
  Not a defect.
- **Edge confirmation still outstanding:** all live results here
  are Chromium 158 on Linux, `file://` — the Stage 3 caveat that
  the definitive check is Microsoft Edge on the restricted office
  workstation is unchanged. Nothing in this verification depends
  on an Edge-only behaviour.
- **Reviewer-mismatch fires before the system-reviewer check in
  T3** (L5c): an approval naming reviewer `"system"` against a
  determination naming `"A. Actuary"` is refused as a reviewer
  mismatch. The approval is refused either way; the ordering is
  noted only for debuggability.

## Overall verdict

**NOT YET COMPLIANT.** 6 of 9 checks pass outright; the human gate,
the audit log's decision/approval coverage, and the §19 warning
for CSV/XLSX all work as specified — but:

1. (D1, major) the exported audit log omits every calculation,
   validation, reconciliation, statistics, and import event;
2. (D2, major) the audit-log and contribution exports download
   with no §19 warning;
3. (D3, minor) T3 accepts a determination whose disposition does
   not match the disposition being approved.

Fix D1 and D2 before release; fix D3 in the same pass. Re-run
`stage7/01-static-compliance.mjs` (expect 48/48) and
`stage7/02-playwright-compliance.mjs` (expect 41/41) after the
fixes, plus the existing `npm test` (804) and
`test/ui-playwright/run.mjs` (4/4) suites. No push to GitHub, no
Drive writes, no uploads were made during this verification.
