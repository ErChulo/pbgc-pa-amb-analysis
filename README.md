# PA_AMB Analysis System

[![single HTML file](https://img.shields.io/badge/single%20HTML%20file-483%20KB-blue)](pa-amb-analysis.html)
[![0 fetch](https://img.shields.io/badge/network%20fetch-0-green)](stage7/VERIFICATION_REPORT.md)
[![tests passing](https://img.shields.io/badge/tests-928%20passing-brightgreen)](stage7/VERIFICATION_REPORT.md)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-blue)](tsconfig.json)

## What this does

This helps a case actuary decide whether to accept, reject, or modify the
PA_AMB in census data.

PA_AMB is the "Plan Administrator Accrued Monthly Benefit at DOTE". It is a
field in the BCV data dictionary (BCV9, Input, NUMBER). It is the monthly
benefit the prior plan administrator reported for a participant.

The system works in three moves:

1. It rebuilds each participant's accrued benefit from the plan documents.
2. It compares the rebuilt benefit with the reported PA_AMB.
3. It recommends one of five dispositions for each participant.

The five dispositions are: Verified, Supported for acceptance, Requires
investigation, Correction recommended, Indeterminate.

The system recommends. Only a human approves. The accept flag is
BCV3.PA_AMB_ACCEPT (Y/N). That is the only accept flag.

## What it is capable of

- **Exact rebuild, with a full trace.** When the plan documents give a
  complete answer, the system shows every step of the calculation.
- **Bounds and scenarios.** When exact rebuild is not possible, the system
  gives a range instead of a single number, and shows the scenarios that
  produce it.
- **Reconciliation.** When the rebuilt benefit and the reported PA_AMB
  differ, the system tests possible causes and ranks them by evidence.
  A cause stays a hypothesis. It is never recorded as fact.
- **Statistics and outlier detection.** The system screens the whole
  population for records that do not fit, and reports the method used.
- **Deterministic and reproducible results.** The same input gives the same
  output, byte for byte. Rebuilds are byte-identical.
- **Human approval gate.** No disposition is final until a human approves
  it, with a reason.
- **Audit log of everything.** Calculations, validation, reconciliation,
  statistics, imports, decisions, approvals, and refusals are all logged.

## What it never does

- It never makes up an exact number when the evidence cannot support one.
  It gives bounds, or it says the answer is indeterminate.
- It never silently drops a record. A record the system cannot use is
  flagged, not lost.
- It never fills a blank with zero. A blank is missing data, not zero,
  unless a written rule says otherwise.
- It never puts an LLM in the calculation path. No calculation is done by
  a language model.

## How to use it

The app is one file: `pa-amb-analysis.html` (483,250 bytes). Double-click
it. It opens in the browser from `file://`. There is no server, no install,
and no network fetch. It makes zero network requests.

The office has only the file protocol. This file fits that rule. It does
not need a server, a build step, or any outside file.

### The 7-step wizard

1. **Import** — load a case.
2. **Validate** — check the data against 66 rules.
3. **Calculate** — rebuild each benefit from the plan documents.
4. **Reconcile** — compare rebuilt benefits with reported PA_AMB.
5. **Review statistics** — screen the population and look at outliers.
6. **Decide** — review the recommended disposition for each participant
   and approve it.
7. **Export** — download the results.

Locked steps stay disabled and say why. A locked step cannot be skipped.

### Import

Import CSV, JSON, or XLSX. XLSX import reads cached values only.
It never runs macros and never reads formulas. A workbook with more
than one sheet asks which sheet to import.

Before you upload, the Import step shows the shape each file must
have: every column, the salary shape, and the rules. A blank stays
blank. It is never filled with zero.

Title rows are skipped. A leading row with one cell is a title, not
a header. The first row with two or more cells is the header.
Skipped titles are warned, never dropped. This holds for CSV and
XLSX.

Salary columns come in two forms: salary_YYYY, one column per year,
or S001–S050 with FRSTYEAR, LASTYEAR, ANNACT, and SALARYDESC.
S-values are dollars in the file. The app stores cents.
S001=60000 becomes 6000000. A file that mixes both forms is
refused. Use one form only.

### Try the demo case first

Load the Harborview demo case. It is a fictional plan, case 00098765,
with 6 SYN participants. It runs end to end through the real engine.
The demo uses synthetic data only. No live case data is in the demo or
in the tests.

### Export

Four exports: CSV, XLSX, WorkProductContribution JSON (protocol v0.1.0),
and the audit log. The audit log and contribution exports carry a
sensitive-export warning. You must confirm before the download starts.

The contribution export feeds the R1 work product. It carries the
acceptance decisions and their evidence.

### Theme

Dark by default. A toggle switches to light.

### Tolerance

There is no built-in acceptance tolerance. The actuary sets the
tolerance for each case, with a written reason. Policy 5.8-1 ($1/$5)
is a benefit-correction rule. It is not a reconciliation rule.

## Limits, stated plainly

- **Stage 7 verdict: conditional pass.** See
  [stage7/VERIFICATION_REPORT.md](stage7/VERIFICATION_REPORT.md).
  Every check that can run on the build machine passes. Two items
  are still open.
- **Edge test outstanding.** The system is verified in Chromium on
  Linux. The definitive test in Microsoft Edge, on the user's testing
  machine, has not been run yet.
- **UI path at 100,000 participants not run.** The engine path at
  100,000 runs in the browser in about 278 seconds. The UI path at
  10,000 runs in 9.0 seconds. The UI path at 100,000 has not been
  run. It is projected, not measured.
- **Synthetic data only.** The demo and the tests use invented data.
  No live case data was used in development.

## Links

- [stage7/VERIFICATION_REPORT.md](stage7/VERIFICATION_REPORT.md) —
  Stage 7 end-to-end verification, conditional pass, full evidence.
- [stage7/thresholds.md](stage7/thresholds.md) — performance
  thresholds (§21).
- [docs/STAGE6_BUILD.md](docs/STAGE6_BUILD.md) — how the single-file
  app is built, and the 0-fetch exceptions.
- [MASTER_PROMPT.md](MASTER_PROMPT.md) — the governing spec, all 8
  stages.
- [FORMULA_TAXONOMY.md](FORMULA_TAXONOMY.md) — the accrued-benefit
  formula taxonomy. A plan may combine several formula branches at
  once. The engine composes them.
- [MONADIC_ARCHITECTURE_SPEC.md](MONADIC_ARCHITECTURE_SPEC.md) —
  the monadic spec for the work-product contribution protocol.

## Build and test

```sh
npm install   # esbuild + typescript, build machine only
npm test      # tsc (strict) + node --test; 928 pass, 0 fail, 231 suites
npm run bundle  # builds pa-amb-analysis.html
```

`esbuild` and `typescript` are devDependencies. They run on the build
machine only. The shipped file needs nothing installed. It opens by
double-click.

Tests run in Node (`node:test`, no framework). The browser suite runs
in Playwright, Chromium headless, from `file://`: 8/8 pass.

## Repo

Public repo: `ErChulo/pbgc-pa-amb-analysis`.
