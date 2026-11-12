# Stage 6 build notes — single-file app (Worker E)

## Deliverable

`pa-amb-analysis.html` at the repo root — **401,313 bytes**, one file.
Open it directly via `file://`. No build step, no server, no install
needed in the office. It is the only file the office needs.

## How to build

```sh
npm run bundle        # node build/bundle.mjs
```

1. esbuild (devDependency, build machine only, `^0.28.2`) bundles
   `build/entry.ts` → one classic-script IIFE (`globalName:
   PaAmbApp`, target ES2022, minified, no sourcemap). Any unresolved
   import fails the build.
2. `src/ui/styles.css` replaces `<!--STYLES-->` and the bundle
   replaces `<!--BUNDLE-->` in `src/ui/template.html`. A missing
   placeholder fails the build. The build also refuses to inline if
   the CSS contained `</style` or the bundle contained `</script`.
3. Post-build gate: `node build/check-zero-fetch.mjs` runs
   automatically; a failure rejects the build.

`build/entry.ts` re-exports `src/ui/main.ts` plus the small set of
helpers the browser workflow needs (demo case, reconciliation-input
builder, disposition mapping, decimal/benefit constructors, theme
helpers) and auto-boots the app into `#pa-amb-app` on DOM ready,
storing the handle on `window.__paAmbHandle`. It adds no engine
logic. The UI modules themselves are untouched except for two
genuine gaps found while building (below).

## How to test

```sh
npx tsc --noEmit
npm test                                   # Node suite
node build/check-zero-fetch.mjs            # static 0-fetch check
node test/ui-playwright/run.mjs            # all four Playwright suites
```

Playwright stays a test-only dependency under
`stage3/live-test/` (required by absolute path from the suites);
it was not added to the repo-root `package.json`.

## Results (verified 2026-11-12, this machine)

- `tsc --noEmit`: clean.
- Node: **804 tests pass, 0 fail** (200 suites).
- Build: `pa-amb-analysis.html`, 401,313 bytes.
- Static 0-fetch: PASS.
- Playwright, 4/4 suites pass:
  - `wizard-flow`: demo case (Harborview, 00098765, 6 SYN
    participants) end to end — Validate 405 rule evaluations / 145
    findings; Calculate exact SYN-001 $1,500.00, SYN-V-01 $849.50,
    bounds SYN-002 $1,584–$1,683 / SYN-004 $900–$960, indeterminate
    SYN-I-01; Reconcile SYN-003 Δ $1,000.00 outside tolerance;
    Statistics flags SYN-003 by modified-z; Decide recommends all
    six and a human approves SYN-001 verified; Export downloads
    `00098765-reconciliation.csv` (all six rows, SYN-003 Δ 100000),
    `00098765-reconciliation.xlsx` (ZIP magic, Reconciliation
    sheet), `00098765-amb-contribution.json` (protocol v0.1.0),
    plus the audit log (7 events). Locked steps stay disabled and
    say why ("Import a case first.", etc.); a locked navigation is
    refused and recorded without moving the wizard.
  - `zero-fetch`: 2 requests across load + reload, all `file://`,
    0 http/https.
  - `theme-rows`: dark by default (DS provisional bg #0B1B36,
    fg #F2F2F2), toggle
    to light (PBGC blue #002d72 header) and back without reload;
    1,000-row table rendered in ~37 ms (Chromium headless on this
    Linux build machine — a baseline measurement, not an office
    threshold).
  - `defensive-loading`: bundle boots in a Node vm whose
    `localStorage` getter throws, and in Playwright with storage
    made to throw — theme falls back to dark, no persistence, no
    throw; the toggle still works in-session.

## Design-system dark-theme gap (flagged, not resolved)

PBGC Design System v1.1.0 defines **no approved dark theme**. The
dark tokens in the app (bg #0B1B36, fg #F2F2F2, muted #D2D2D2,
accent #BEC6DF, header #002D72) are the design system's own
**provisional** dark theme (DS §2.5, OPEN-QUESTIONS Q6, not
COLA-approved), adopted 2026-11-12 per docs/DESIGN_SYSTEM_AUDIT.md.
The Stage 3 P-09 probe tokens (bg #000000, fg #f2f0e9, muted
#b8b5ac, accent #7fb3ff, header #0a1f44) are superseded and are not
kept alongside. The light theme uses the DS tokens (PBGC blue
#002D72, Helvetica Neue/Arial). The dark theme stays provisional
until COLA answers Q6; the app must not claim design-system
compliance for dark mode. Suggested design-system update (user
decides; the design-system repo itself is not changed): approve a
dark theme. The header stays text-only: no official logo asset
exists in-repo (DS §4: reproduce, never redraw).

## 0-fetch exceptions (documented, not silent)

The only `http://` / `https://` strings in the deliverable are XML /
JSON-Schema namespace identifiers, never fetched:

- `http://www.w3.org/2000/svg` (SVG namespace in chart output)
- `http://schemas.openxmlformats.org/...` (OOXML namespaces and
  relationship types inside the hand-built XLSX writer)
- `http://purl.org/dc/elements/1.1/` (Dublin Core namespace, XLSX
  core properties)
- `https://json-schema.org/draft/2020-12/schema` and
  `https://pbgc-caseworkbench/contribution/...` (JSON Schema
  `$schema` / `$id` identifiers in the contribution package)

`build/check-zero-fetch.mjs` allow-lists exactly those prefixes
and fails on any other URL. There is no `https://drive.google.com`
reference in the deliverable (that URL lives only in
MASTER_PROMPT.md, which is not bundled). `URL.createObjectURL` /
`revokeObjectURL` (local blob URLs for downloads) are not network
access and are not flagged.

## UI-module changes made while building (exact list)

Two genuine gaps, both in Wave 1 UI modules, fixed minimally:

1. `src/ui/state.ts` — new `AppEvent` kind `evidence-recorded`:
   the engine transition refuses every disposition event while a
   participant's `evidence` is null ("no evidence state exists —
   run a calculation or bounds computation first"), and nothing in
   the UI ever set that evidence, so the Decide step could never
   propose or approve through the app. The event attaches an
   `EntryCheckInput` to one participant. It recommends nothing and
   approves nothing. Also in `state.ts`: the Decide step is now
   marked complete when every in-scope participant has a
   disposition (recommended or approved); previously nothing ever
   completed it, so Export could never unlock.
2. `src/ui/main.ts` — `recordEvidence()` and
   `dispositionEntryInput()`: map a participant's
   `DispositionEvidence` through `mapDisposition` +
   `toEntryCheckInput` and attach it via the new event. No engine
   file was modified; no calculation, tolerance, threshold, label,
   or finding was invented.

## Open items for Stage 7

- The wizard has no in-app buttons to run Validate / Calculate /
  Reconcile / Statistics / Decide — those steps are driven here
  through the app's own JS API (`window.PaAmbApp` + the handle's
  dispatch). A human using the file in the office can load the demo
  case and export, but cannot yet run the steps from the UI alone.
  Stage 7 (or a Stage 6 follow-up) should add per-step Run
  controls wired to the same helpers, or confirm the API-driven
  flow is the intended one.
  → RESOLVED in Stage 7 (2026-11-12): per-step Run buttons added
  (Validate, Calculate, Reconcile, Statistics, Recommend all
  dispositions, Publish contribution), demo-case scoped; no Approve
  button — human approval stays human-only. Evidence:
  `stage7/run-buttons-check.mjs` passes; see
  `stage7/05-benchmarks-open-items.md` §3(a).
- Browser verification so far is Chromium headless (Playwright
  1.65.0) on this Linux build machine, `file://`. The definitive
  check — Microsoft Edge on the restricted office workstation —
  still stands (Stage 3 caveat, unchanged).
  → STILL OPEN after Stage 7: Stage 7 benchmarks also ran in
  Chromium headless on this Linux build machine. The Edge-on-office
  check carries to Stage 8.
- The 1,000-row render time (~37 ms here) is a baseline, not a
  threshold; §21 acceptance thresholds for 100 / 1,000 / 10,000 /
  100,000 participants are still to be set after measuring the
  baseline implementation.
  → RESOLVED in Stage 7 (2026-11-12): thresholds set in
  `stage7/thresholds.md` from the measured baselines; full tables
  and justifications in `stage7/05-benchmarks-open-items.md` §2.
  The 35.2 ms table render stays a baseline, not a threshold.
- The percentile outlier screen flags both extremes on a tiny
  population (with three comparable deltas it flags SYN-001 at Δ
  $0.00 as well as SYN-003). That is the engine's stated
  behaviour, not a defect, but it means the demo's outlier list
  needs the method named when it is read — the test asserts on
  the modified-z flag for that reason.
  → RESOLVED in Stage 7 (2026-11-12): confirmed correct-as-
  designed, with test evidence (see
  `stage7/05-benchmarks-open-items.md` §3(c)). No engine change.
- `npm install -D esbuild` reformatted one line of `package.json`
  (the description's em dash); cosmetic only.
  → Unchanged; cosmetic only, no action.

Two further Stage 7 findings are recorded in
`stage7/05-benchmarks-open-items.md` §4 (not Stage 6 items):
`src/index.ts` did not re-export `src/rounding.ts` or
`src/accrualTests.ts` (fixed in Stage 7 — two star exports added),
and validation rule P-16 is O(n²) (defect report with
reproduction; fix belongs to Stage 8, `src/validation.ts` is
outside the Stage 7 edit list).
