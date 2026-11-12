# Stage 2 — Validation-Rule Catalog (Implementable Form)

## PBGC Prior Administrator Accrued Monthly Benefit (PA_AMB) Analysis System

- **Project:** PA_AMB Analysis System — help a PBGC case actuary decide, with evidence, whether to accept, reject, or modify the prior administrator's accrued monthly benefit (PA_AMB) as recorded in the census data.
- **Repo:** ErChulo/pbgc-pa-amb-analysis (public, main; user-created 2026-11-12).
- **Governing spec:** `~/workspace/pbgc-pa-amb-analysis/MASTER_PROMPT.md` (§7 comprehensive input validation, in full; §6 data architecture, §10 reconciliation, §12 missing-data framework — skimmed).
- **Stage 1 basis:** `stage1/00-source-inventory.md`; `stage1/02-data-requirements-validation.md` (read in full). This catalog is a Stage 2 restatement of Stage 1 output 02, Part B (§B.0–§B.9), in implementable form. It adds precision (predicates, parameters, evaluation order, result shape); it does not change any rule's meaning, ID, severity, or blocking.
- **This file:** `~/workspace/pbgc-pa-amb-analysis/stage2/03-validation-catalog.md` — Stage 2 deliverable: validation-rule catalog (MASTER_PROMPT §22 deliverable 6).
- **Date:** 2026-11-12.
- **Status:** Design specification only. Read-only design work. No code, no app, no tests, no repo writes, no Drive writes. Synthetic data only in examples.
- **Catalog version:** 0.1.0 (Stage 2 draft). Rule versions are tracked per CalculationRun (Stage 1 §A.2.15: `APP.ruleVersion`).

## 0. Traceability and counting

### 0.1 Rule count — verified against Stage 1 output 02, §B.8

| Layer | Rules | IDs |
|---|---|---|
| Structural | 12 | S-01–S-12 |
| Participant-level | 16 | P-01–P-16 |
| Cross-field | 14 | X-01–X-14 |
| Measurement-date | 6 | M-01–M-06 |
| Longitudinal | 8 | L-01–L-08 |
| Cross-source | 10 | C-01–C-10 |
| **Total** | **66** | — |

No rule has been renumbered, merged, split, or dropped. Stage 1 rule IDs are kept unchanged so every rule traces to Stage 1 output 02, Part B. Where a Stage 1 rule covers several BCV predicates with different severities, the sub-conditions are listed under the same rule ID (see §1.4); the rule ID is never subdivided into new rule IDs.

### 0.2 Source split — 17 official adoptions, 49 application-specific

| Source label | Count | Rules |
|---|---|---|
| OFFICIAL (adopts, in whole or part, an official BCV predicate from `BCV-DataValidation-predicates.xlsx`, 249 predicates, 235 enabled) | 17 | S-04, S-05, P-02, P-03, P-04, P-05, P-06, P-07, P-08, P-09, P-10, P-11, X-02, X-03, X-11, X-12, C-03 |
| APP (application-specific analytical test defined by this spec) | 49 | All other rules |

The split is stated on **every** rule below, in its **Source** line. Three of the 17 need a qualifier, stated on the rule itself:

- **S-05 — MIXED.** The ID-validity part adopts official BCV-1000006 (type 4/S). The `APP.participantKey` collision part is APP (this spec).
- **P-06 — MIXED.** BCV-277–281 and BCV-420 are adopted official predicates. The CS-blank check restates **disabled** BCV-276 (`ENABLE_FL = N`) as an APP rule (see §10.2, conflict C-2). It is counted in the 17 because the rule as a whole adopts official predicates; the 276 part is labelled APP on the rule.
- **C-03 — OFFICIAL (reference only).** Official predicates 228–237 and 306–319 are used as **reference data** for cross-source checks. They are **not** adopted as validation rules of this system (this system does not calculate XRD benefits). The rule itself (do not compare PA_AMB to a different-basis BCV benefit without conversion) is APP. It is counted in the 17 per Stage 1 §B.8, with this qualifier.

No other rule adopts an official predicate. In particular, **no official BCV predicate covers PA_AMB** (Stage 1 §0.5: zero predicates mention PA_AMB, AMB, CSPA, VSPA, ESPA, PA_ACOMP, PIA, or any salary-history field). Nearly all PA_AMB-specific validation is therefore APP by necessity, not by choice.

### 0.3 Key facts carried forward from Stage 1 (not re-derived, not contradicted)

- **PA_AMB** = "Plan Administrator Accrued Monthly Benefit at DOTE", BCV9, Input, NUMBER. The dictionary does **not** state annuity form, vesting treatment, NRD/age basis, rounding, or what a blank means — none is assumed anywhere in this catalog.
- **Comparison pair:** PA_AMB (Input, BCV9) vs BCV1.AMB (Calculated), both "at DOTE" (termination of employment, ≠ DOPT). **BCV3.PA_AMB_ACCEPT** (Y/N) is the only accept-decision flag; it carries no criterion.
- **Blanks are missing data, never zero**, unless a governing rule says so (Stage 1 P-13). No rule in this catalog equates a blank with zero.
- **Architecture:** Option C (Hybrid), staged — TypeScript deterministic core first, Rust/WASM kernels only where proved, single HTML file, 0 fetch (Stage 1 output 04).
- **Standing requirement (most important):** the app must still produce reliable actuarial calculations and documented acceptance decisions when exact historical reconstruction is impossible — bounds, scenarios, documented dispositions, human decision; never a silent failure or a made-up exact number when the evidence cannot support one. Every blocking outcome in this catalog routes to a documented disposition (§3.3, Stage 1 §B.7); no failure drops a participant.

### 0.4 How to read a rule entry

Every rule entry carries the eight items required by MASTER_PROMPT §7 and Stage 1 §B.0:

1. **Rule ID** — unchanged from Stage 1.
2. **Source** — OFFICIAL (with BCV predicate ID(s) and BCV type where known) or APP (with grounding source) or MIXED / OFFICIAL-reference-only (see §0.2).
3. **Fields examined** — BCV field names copied exactly from the dictionary; app fields prefixed `APP.` and never presented as BCV fields.
4. **Predicate** — the exact condition, stated in words precise enough to implement, plus a formal expression where it helps. Formal expressions use the notation of §1.5. They are predicates, not runnable code.
5. **Severity** — Critical / Error / Warning / Info (§1.3).
6. **Discrepancy** — what is recorded: actual vs expected, with values.
7. **Investigation** — recommended investigation (what to check, in which document).
8. **Blocks calculation** — Yes / Exact-only / No (§1.3), plus the **blocking scope** (§3.2), which says *what* is blocked.

Additional per-rule lines where needed: **BCV type** (preserved for adopted predicates; types 1–3 have no legend — see §12, OD-01), **Parameters** (case-level inputs the predicate needs — see §1.6), **Implementability note** (where the Stage 1 text does not support a fully precise predicate — see §1.7), **Conflict flag** (§10).

### 0.5 Scope notes

- **Dataset-item IDs are not rule IDs.** Stage 1 §0.7: dataset items use single-digit IDs with no leading zero (minimal M-1–M-8, comprehensive C-1–C-14); validation rules use two-digit IDs with a leading zero (S-01, P-01, X-01, M-01, L-01, C-01). "M-7" (the tolerance record, a dataset item) is not a rule; "M-07" does not exist. This catalog cites M-7 only as the case tolerance record (§1.6).
- **DOPT and BPD are not BCV fields.** There is no DOPT or BPD field in the 1,172-record dictionary (Stage 1 §A.2.1). They are app-level case facts (`APP.dopt`, `APP.bpd`), sourced from the case file / R5 header. They are never presented as BCV fields in any rule.
- **DOBF grain.** `DOBF` occurs exactly once in the dictionary, as BCV1.DOBF (participant-level Date of Benefit Freeze). The R5 shell header has a plan-level DOBF cell. Rules always qualify DOBF by grain (Stage 1 §1.5).

## 1. Conventions

### 1.1 Source labels

| Label | Meaning |
|---|---|
| OFFICIAL | The rule adopts an official BCV predicate from `BCV-DataValidation-predicates.xlsx`. The BCV predicate ID(s) and BCV type are given. Adoption means the predicate's condition is implemented as a rule in this catalog. Adoption does **not** mean the predicate validates PA_AMB — no predicate does. |
| APP | Application-specific analytical test defined by this spec. The grounding source (MASTER_PROMPT section, Answer Book chapter/question, policy, or Stage 1 section) is cited on the rule. |
| MIXED | Part of the rule adopts an official predicate; part is APP. The split is stated on the rule. |
| OFFICIAL (reference only) | Official predicates are used as reference data for a cross-source check, not adopted as validation rules. Only C-03 carries this label. |

### 1.2 Value domains used in predicates

| Domain | Representation |
|---|---|
| Dates | ISO-8601 calendar dates. A date field that is blank is NULL, not a default date. No date is ever defaulted (to DOPT or anything else) unless a governing rule cited on the rule requires it. |
| Money | `decimal(18,2)` monthly dollars for PA_AMB, PA_ACOMP, CUCOMP and calculated benefits, unless the PA schedule evidences a different precision (rule S-09). Arithmetic is decimal-safe; ordinary binary floating-point artifacts must not affect monetary rounding (MASTER_PROMPT §8). |
| Service | Decimal years (e.g. CSPA, CS, VSPA, VS, ESPA, ES). Months appear only as service × 12 in the BCV range checks (0–999 months = 0–83.25 years). |
| Percentages / fractions | Vesting percent as a fraction (e.g. 1, not 100), per the BCV1.VP dictionary entry. Survivor percent as a fraction 0–1. |
| Codes | RETSTAT ∈ {1,2,3,4,5}; ID ∈ {1,2,4}; PSEX ∈ {M,F,U}; ANB/SANB ∈ [0,999]. Code lists are copied from the dictionary / predicates workbook, never invented. |
| Missing | NULL / blank. "Blank" in a predicate means the field is NULL or empty in the imported record. A blank is missing data (see §0.3). |

### 1.3 Severity and blocking (Stage 1 §B.0.3, unchanged)

| Severity | Meaning | Blocks calculation |
|---|---|---|
| **Critical** | The record cannot be loaded or compared as it stands (identity, population membership, or measurement basis is indeterminate) | **Yes** — no calculation of the blocked scope for this participant; routes to a documented disposition (§3.3) |
| **Error** | The exact calculation cannot proceed for this participant | **Exact-only** — exact reconstruction blocked; bounds/scenario path may proceed if the missing input is class (b), (c), or (d) (§3.3) |
| **Warning** | The calculation proceeds, but the finding must be reviewed before any acceptance disposition | **No** |
| **Info** | Recorded for audit; no action required | **No** |

Two refinements, added by this catalog (design decisions, recorded here rather than silently assumed):

- **(a) Blocking is scoped, not blanket.** A rule's `blocksCalculation` value says *whether* something is blocked; §3.2 and the per-rule **Blocking scope** line say *what* is blocked (import, participant calculation, exact calculation, comparison, or decision). The two most important cases: M-05 is Critical but blocks the **comparison**, not the calculation itself (the independent calculation may still proceed at its own basis); C-09 is Critical but blocks the **decision record**, not the calculation. A blanket reading of "Yes" would wrongly stop work that may proceed.
- **(b) No short-circuit.** Findings are accumulated, not short-circuited: except for the quarantine cases in §3.1 (a record that cannot be reliably identified, or a file that cannot be read), all applicable rules are evaluated for a participant even after an earlier rule fires, so the reviewer sees the full evidence. Blocking is applied after evaluation, at routing (§3.3).

**BCV type vs app severity.** BCV type 4 decodes as critical error (per the predicates workbook report SQL: `DATA_VLDTN_TYPE = '4'` → `Crtcl_Err = 'Y'`). BCV types 1–3 have **no legend** in the workbook (Stage 1 §0.5). Adopted official predicates therefore keep their BCV type (recorded on the rule) and receive the app severity assigned by Stage 1 (§B.0.4 / the rule tables). Where an adopted predicate's app severity differs from a naive reading of its BCV type, the reason is stated on the rule. The app severity, not the BCV type, drives blocking.

### 1.4 Sub-conditions

Where a Stage 1 rule covers several BCV predicates with different severities (P-03, P-04, P-05, P-06, P-07, P-10, P-11, X-02, X-11), the rule entry lists each predicate-level sub-condition with its own severity and blocking. The sub-conditions share one rule ID and produce one validation record per firing sub-condition (see §2: `bcvPredicateId` distinguishes them). A rule fires if any of its sub-conditions fires.

### 1.5 Formal-expression notation

Formal expressions in rule entries use only these operators, so they read the same way in every rule:

- `IS NULL` / `IS NOT NULL` — blank vs populated.
- `∧` (and), `∨` (or), `¬` (not), `⇒` (fires when), `∈` (in set), `∉` (not in set).
- Comparisons: `=`, `≠`, `<`, `≤`, `>`, `≥`.
- `|x|` absolute value; `Δ = PA_AMB − B̂` where B̂ is the independently reconstructed benefit (MASTER_PROMPT §10); `D = |Δ|`; `R = Δ / B̂` only when B̂ is non-zero and meaningful (see Stage 1 output 03 (reconciliation and statistical methodology) for the denominator rule; this catalog does not compute Δ).
- `EXISTS(record)` / `FOR ALL(records)` for cross-record conditions.
- `param:name` for a case-level parameter from §1.6 (e.g. `param:caseTolerance`).
- Dates are written as ISO dates (e.g. `1930-01-01`); `today` means the run date.

Formal expressions are predicates for implementation, not runnable code. Where a formal expression would be longer than its English statement without adding precision, the English statement stands alone.

### 1.6 Case-level parameters the predicates need

Some predicates cannot fire without a case-level input. These parameters are **case records**, set by the case actuary and recorded in the CalculationRun — never hard-coded, never silently defaulted (except where a default is explicitly stated and labelled as a default, not as a PBGC rule).

| Parameter | Source | Default | Used by |
|---|---|---|---|
| `caseTolerance` — the $ and/or % reconciliation tolerance for this case, its authority, and who approved it | Stage 1 minimal dataset item M-7; MASTER_PROMPT §10 ("configurable, documented tolerances; do not impose an arbitrary universal dollar or percentage tolerance") | **None.** The engine must refuse to compare without a recorded tolerance (Stage 1 handoff note 4). | X-06, C-03 (via comparison), C-06, and any Δ comparison in the reconciliation engine |
| `serviceTolerance` — tolerance for \|PA service − BCV service\| | Stage 1 X-07: "documented; default 0 unless the case record states otherwise — service is a fact, not an estimate" | 0 (labelled as this spec's default, not a PBGC rule) | X-07 |
| `monthlyBenefitPlausibilityCap` — the monthly-benefit scale bound that triggers a units check | Stage 1 S-09: $25,000/month, borrowed from the plausibility bound official predicates 231/310/314/318 use for monthly benefits | $25,000/month (a screening bound, not a validity limit; see S-09 note) | S-09 |
| `plausibleBenefitCompRatioRange` — the plausible range for PA_AMB ÷ PA_ACOMP (monthly benefit vs monthly average compensation) for the plan's formula | Stage 1 X-04 gives no numeric range | **Unset.** Until the case actuary sets it from the plan's formula (accrual rate × service), X-04 is **not-applicable**, never a pass and never a fire (see §1.7, X-04) | X-04 |
| `planServiceCreditRule` — the plan's service-credit rule (past-service credits, special credits, hours vs elapsed time) | Plan document §; Answer Book Ch. 7 | None; required before P-15 can distinguish a legitimate excess from an error | P-15, X-07 (explanation leg) |
| `planRoundingRule` — the plan's rounding rule and sequence | Plan document §, or "not stated" (Stage 1 gap G-6) | None; see §12, OD-04 | Referenced by rules that compare computed values (X-06); no rule in this catalog fires on rounding alone |

**Policy 5.8-1 figures are not parameters of this catalog.** PBGC Operating Policy 5.8-1 Benefit Corrections ($1.00 / $5.00, issue date 10/02/2014) governs correcting PBGC benefit determinations and payments. It does **not** govern whether PA_AMB is accepted, and its figures must **not** be silently repurposed as `caseTolerance` (Stage 1 §B.0.1). If a case actuary explicitly adopts the 5.8-1 figures as the case tolerance, that adoption is recorded as the authority of `caseTolerance` — the system records the 5.8-1 figures as reference data in a separate field, never conflated with the reconciliation tolerance. The "reasonably certain" standard from 5.8-1 **does** carry over as a decision principle (rule C-08).

### 1.7 Implementability — rules that cannot be made fully precise from the Stage 1 text

Four rules are **parameterized or conditional**: their predicate is precise, but it cannot fire until a case-level input exists or a source document is present. This catalog states that on each such rule rather than inventing the missing input. The affected rules are X-04, X-06, C-04, C-06, C-07, L-01–L-08 (prior-extract dependency), and P-15. One rule, **X-04, is not implementable as a standalone precise predicate at all** until the case sets `plausibleBenefitCompRatioRange`: Stage 1 gives no numeric range, no formula for the range, and no threshold. The catalog therefore specifies X-04 as a parameterized rule with an explicit **not-applicable** outcome while the parameter is unset (§1.8). No other rule is in this position: every other rule's predicate is stated exactly below, using only values present in the record or in §1.6 parameters.

### 1.8 Rule outcomes (every rule evaluation ends in exactly one outcome)

| Outcome | Meaning |
|---|---|
| `pass` | The predicate's expected condition holds. No finding is recorded (a pass may still be counted in run statistics). |
| `fail` | The predicate's failure condition holds. A validation record (§2) is created with the severity and blocking of the rule (or sub-condition). |
| `not-applicable` | The rule cannot be evaluated for this record/run because a required input is absent (no prior extract for L-01–L-08; no PA schedule for C-01's schedule leg; no `caseTolerance` for X-06; no `plausibleBenefitCompRatioRange` for X-04; RETSTAT = 5 for in-scope participant rules). A `not-applicable` outcome is **recorded** (rule ID, reason, scope) — it is never a silent skip and never a pass. |
| `not-run` | The rule was not evaluated because an earlier quarantine removed its scope (§3.1: file unreadable, record unidentifiable). Recorded at the scope level, with the quarantining finding referenced. |

## 2. Validation result shape

### 2.1 Result record — TypeScript interface (specification, not runnable code)

Every finding is one record of this shape. It carries all eight items from §0.4 plus linkage and audit fields from Stage 1 §B.0.2. Field names are `camelCase` app names; BCV field names inside `fieldsExamined` are copied exactly from the dictionary.

```typescript
interface ValidationResult {
  // Identity and linkage
  resultId: string;               // app-generated, stable within the run
  ruleId: string;                 // e.g. "S-01", "P-13", "M-02" — unchanged Stage 1 IDs
  bcvPredicateId: string | null;  // e.g. "BCV-214"; null for APP rules and for
                                  // OFFICIAL rules whose finding is at rule level
  bcvPredicateType: string | null;// BCV DATA_VLDTN_TYPE as written in the workbook
                                  // ("1" | "2" | "3" | "4" | "S" | "I" | null).
                                  // Preserved verbatim; types 1-3 have no legend (OD-01).
  ruleSource: "OFFICIAL" | "APP" | "MIXED" | "OFFICIAL_REFERENCE_ONLY";
  participantKey: string | null;  // APP.participantKey; null for file/case-scope findings
  runId: string;                  // CalculationRun APP.runId
  recordedDate: string;           // ISO date of the run

  // What was examined, and what was found
  fieldsExamined: string[];       // BCV field names exactly as in the dictionary,
                                  // or APP.* names for app fields
  actual: string;                 // observed value(s), recorded verbatim (values, dates, counts)
  expected: string;               // the condition the rule requires
  discrepancy: string;            // the observed discrepancy, recorded verbatim
  severity: "Critical" | "Error" | "Warning" | "Info";
  investigation: string;          // recommended investigation (what to check, in which document)
  blocksCalculation: "Yes" | "Exact-only" | "No";
  blocksScope: "import" | "participant-calculation" | "exact-calculation"
    | "comparison" | "decision" | "none";
                                  // what is actually blocked (§3.2). "Yes" without a scope
                                  // is not a complete record.

  // Routing and resolution (audit)
  dispositionRoute: string;       // where the participant goes if blocked (§3.3);
                                  // never blank when blocksCalculation is not "No"
  outcome: "pass" | "fail" | "not-applicable" | "not-run"; // §1.8 (fail = this record)
  status: "open" | "resolved";    // a finding is never deleted; a resolved finding
                                  // keeps the original record and links the resolution evidence
  resolutionEvidence: string | null; // SourceDocument ref + location, when resolved
}
```

### 2.2 Rules the interface enforces

1. **A finding is never deleted.** A finding resolved by a correction or a recovery is marked `status: "resolved"` with `resolutionEvidence` linked; the original finding remains in the audit log (Stage 1 §B.0.2).
2. **`dispositionRoute` is never blank when `blocksCalculation` ≠ "No".** The route is one of the §3.3 routes (bounds/scenario path, or documented disposition `requires-investigation` / `indeterminate`).
3. **`blocksScope` is mandatory.** It is the catalog's addition to the Stage 1 record: it prevents the "Yes" of M-05 (comparison) and C-09 (decision) from being misread as a blanket calculation block.
4. **Run-level record.** Each CalculationRun also records, per layer and per severity, the counts of `pass` / `fail` / `not-applicable` / `not-run`, the count of in-scope participants with no disposition at run end (which must be zero for a complete run — Stage 1 §B.7 item 6), and the catalog version. The run record is specified here; its exact shape is a Stage 3/Stage 4 matter and is not defined in this catalog beyond these counts.
5. **No severity is invented for BCV types 1–3.** `bcvPredicateType` preserves the workbook value; the app `severity` is the Stage 1 assignment. The two are never conflated.

## 3. Evaluation order and blocking

### 3.1 Evaluation order

Rules are evaluated in layer order. Within a layer, rules are evaluated in ID order. The order is **structural first, then the rest** (MASTER_PROMPT §7; Stage 1 Part B order):

1. **Structural (S-01–S-12)** — at import, before any participant-level rule. File-scope rules (S-01, S-11) run first; row/record-scope rules follow.
2. **Participant-level (P-01–P-16)** — per participant record, after the record has loaded.
3. **Cross-field (X-01–X-14)** — per participant record, after P rules.
4. **Measurement-date (M-01–M-06)** — per participant record, after X rules. (M findings gate the comparison regardless of order — see §3.2. X-09 and X-10 overlap the measurement-basis question from the vesting/form side; the overlap is intentional and both findings are recorded.)
5. **Longitudinal (L-01–L-08)** — per participant (L-02–L-08) and per population (L-01), across extracts. Requires at least one prior extract; with no prior extract every L rule records `not-applicable` with the reason (see §1.8), except L-01, which additionally requires the prior extract's status counts.
6. **Cross-source (C-01–C-10)** — per participant (C-01–C-08) and per case/decision (C-09, C-10), against prior valuation reports, PA schedules, payment records, and the other generators' outputs for the same case.

**Quarantine (the only short-circuit).** Two failures stop evaluation of their scope, and only their scope:

- **S-01 (file unreadable / hash mismatch) or S-11 (XLSM hash changed / macro ran):** the file is not loaded. All rules for records in that file record `not-run`, referencing the quarantining finding. Other files still load.
- **S-04 (RETSTAT invalid/blank) or S-05 (ID invalid/blank, or participantKey collision):** the affected record is quarantined. No P/X/M/L/C rule is evaluated for that record (`not-run`), because findings cannot be reliably attributed to a participant or placed in/out of the valuation population. The record still appears in every report, with its reason — it is never omitted from counts or denominators (Stage 1 §B.7 item 5).

Every other failure accumulates findings without stopping evaluation (§1.3(b)).

### 3.2 Blocking scope — what each `blocksCalculation` value blocks

| blocksCalculation | blocksScope | What is skipped for that participant/record |
|---|---|---|
| Yes | `import` | The file (S-01, S-11) or the record (S-04, S-05) is not loaded. No downstream stage runs for that scope. |
| Yes | `comparison` | The BenefitComparison is not computed: no Δ, no D, no R, and `comparisonBasis = unresolved` where the basis is the cause (M-05). The independent BenefitCalculation itself may still proceed at its own basis. |
| Yes | `decision` | The ActuarialDecision record is refused (C-09): PA_AMB_ACCEPT cannot be set or relied on until a consistent decision exists. Calculation and comparison may proceed. |
| Exact-only | `exact-calculation` | Exact reconstruction is blocked. The bounds/scenario path may proceed (§3.3 step 2). The comparison against an exact B̂ is not computed; a comparison against justified bounds may be recorded as a range evaluation, labelled as such (never as an exact Δ). |
| No | `none` | Nothing is skipped. The finding must still be reviewed before any acceptance disposition (§3.3 step 3). |

Per-rule `blocksScope` values are given on each rule entry in §§4–9. The mapping above is exhaustive: no rule in this catalog uses a scope outside this table.

### 3.3 Validation-to-disposition routing (Stage 1 §B.7, unchanged, with scopes added)

A validation failure never silently drops a participant and never produces a made-up exact benefit.

1. **Critical failure (`blocksCalculation = Yes`).** No calculation of the blocked scope for this participant. The participant is routed to a documented disposition: `requires-investigation` if a concrete next step exists (a document to obtain, an identity to resolve), otherwise `indeterminate`. The finding, the missing evidence, and the data request are recorded in the ActuarialDecision record. (Exception: M-05 blocks only the comparison; C-09 blocks only the decision record — see §3.2.)
2. **Error failure (`blocksCalculation = Exact-only`).** Exact reconstruction is blocked. The system attempts the bounds/scenario path: if the missing input is class (b) (recoverable from other documents), recover it and re-run; if class (c) (reasonable bounds establishable), compute justified bounds Bᵢ^min ≤ Bᵢ^possible ≤ Bᵢ^max; if class (d) (requires assumptions), apply a documented, reviewer-approved assumption and label the result an estimate; if class (e) (makes reconstruction indeterminate), route as in step 1. Reachable dispositions follow the Stage 1 §A.7 matrix (see §3.4).
3. **Warning.** Calculation proceeds; the finding must be reviewed before any acceptance disposition. An acceptance disposition (`verified` / `supported-for-acceptance`) with an unreviewed Warning is refused at entry.
4. **Info.** Recorded; no routing effect.
5. **Unresolved measurement basis (rules M-01–M-06; see §7).** The comparison is not computed. The participant is routed to `requires-investigation` (if the basis can be established by obtaining a document) or `indeterminate` (if it cannot). The record still appears in every report, with its reason — it is never omitted from counts or denominators.
6. **Every participant in scope ends with a disposition.** The plan-level report (MASTER_PROMPT §15) shows the count of participants by disposition, including `indeterminate`. A run that leaves any in-scope participant without a disposition is incomplete and is reported as such.

### 3.4 Disposition reachability (Stage 1 §A.7 — enforced at ActuarialDecision entry)

| Completeness grade | Measurement basis | Reachable dispositions | What the system produces |
|---|---|---|---|
| Complete | Established (DOTE, or other stated basis with evidence) | Verified · Supported for acceptance · Requires investigation · Correction recommended | Exact reconstructed benefit B̂ᵢ + comparison Δᵢ against the case tolerance |
| Partial (classes b/c/d only) | Established | Supported for acceptance · Requires investigation · Correction recommended | Justified bounds Bᵢ^min / Bᵢ^max and/or assumption-based estimate, labelled as such; PA_AMB evaluated against the feasible range; sensitivity shown |
| Partial (classes b/c/d only) | Unresolved | Requires investigation · Indeterminate | Bounds only if the basis uncertainty itself can be bounded (e.g. benefit recomputed at each candidate date as scenarios); otherwise no calculated benefit, only the documented gap |
| Insufficient (any class-e gap) | Established or unresolved | Requires investigation · Indeterminate | No calculated benefit. Documented evidence list, missing-evidence list, prioritised data request |
| Complete or Partial | Unresolved **and** PA_AMB is the only benefit evidence | Requires investigation · Indeterminate | No comparison is valid — a comparison requires equivalent bases (MASTER_PROMPT §3). The record is held, not compared. |
| Any grade | RETSTAT = 5 (not in valuation population) | (Out of scope — no disposition) | Excluded from the population; graded separately as `excluded`, with the reason recorded |

Notes (Stage 1 §A.7, unchanged): `Verified` requires Complete + established basis + agreement within the documented case tolerance. `Supported for acceptance` is the Partial-grade acceptance path (evidence supports accepting PA_AMB even though exact reconstruction is impossible). `Correction recommended` requires sufficient evidence for a specific corrected benefit (on a Partial record, the bounds must collapse to a single defensible value under stated assumptions; on an Insufficient record it is unreachable). `Requires investigation` means a concrete next step exists; `indeterminate` means the evidence as it stands cannot support a conclusion and no further step is currently identified. A disposition outside the reachable set **must not be recorded**, and the app must refuse it with the reason shown.

## 4. Layer 1 — Structural validation (S-01–S-12)

Structural rules run at import, before any participant-level rule. A structural Critical failure quarantines the affected records; the rest of the file still loads (§3.1).

### S-01 — File unreadable, truncated, or hash mismatch

- **Source:** APP (MASTER_PROMPT §7 structural).
- **Fields examined:** (file).
- **Predicate:** The imported file cannot be opened, is truncated, or its SHA-256 hash does not match the hash recorded in the import record. Formal: `¬openable(file) ∨ truncated(file) ∨ hash(file) ≠ hash(importRecord) ⇒ fail`.
- **Severity:** Critical. **Blocks:** Yes. **Blocking scope:** `import` (file).
- **Discrepancy (actual vs expected):** Actual: file unreadable, truncated, or hash mismatch (file name, error, byte count if known). Expected: file opens; hash matches the import record.
- **Investigation:** Re-obtain the file from the source; check transfer / storage.
- **Disposition route:** File not loaded; all rules for its records `not-run`; re-import required before any disposition for those participants.

### S-02 — Row fails to parse

- **Source:** APP (MASTER_PROMPT §7 structural; Stage 1 §A.1.1).
- **Fields examined:** (row).
- **Predicate:** A row fails to parse under the format's rules (CSV RFC 4180 quoting / delimiter; XLSX/XLSM cell read; JSON schema parse). Formal: `parse(row) = error ⇒ fail` (that row only).
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation` (that row).
- **Discrepancy (actual vs expected):** Actual: row fails to parse (raw row text, line number, parse error). Expected: every row parses or is quarantined with its raw text.
- **Investigation:** Inspect the source row; fix the extract, never hand-edit the quarantined row into the data.
- **Disposition route:** Quarantined row → bounds/scenario path only if the row's data is recoverable from another source (class b); otherwise `requires-investigation` / `indeterminate` for that participant.

### S-03 — Unknown field name

- **Source:** APP (MASTER_PROMPT §7 structural).
- **Fields examined:** Field names (header / JSON keys).
- **Predicate:** A header/field name does not resolve to a dictionary field (for census fields) or to a declared app field (for JSON). Formal: `fieldName ∉ dictionaryFields ∪ declaredAppFields ⇒ fail`.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: unknown name (name, file, location). Expected: every field name resolves to a dictionary field or a declared app field.
- **Investigation:** Confirm whether it is a PA-specific column (map it as `_unmapped` with provenance, retained verbatim, never dropped — Stage 1 §A.1) or a typo (confirm with the source).

### S-04 — RETSTAT invalid or blank

- **Source:** OFFICIAL — BCV-1000007 (type 4/S). BCV type 4 = critical error per the report SQL.
- **Fields examined:** RETSTAT.
- **Predicate:** RETSTAT is blank or not in {1,2,3,4,5}. Formal: `RETSTAT IS NULL ∨ RETSTAT ∉ {1,2,3,4,5} ⇒ fail`.
- **Severity:** Critical. **Blocks:** Yes. **Blocking scope:** `import` (record — quarantine).
- **Discrepancy (actual vs expected):** Actual: value found (or blank), participantKey. Expected: one of 1–5.
- **Investigation:** Check the census extract; a record with no status cannot be placed in or out of the valuation population.
- **Disposition route:** Record quarantined (§3.1); no P/X/M/L/C rule runs for it; disposition `requires-investigation` (status to be established) — the record is never silently excluded.

### S-05 — ID invalid or blank; participantKey collision

- **Source:** MIXED — OFFICIAL BCV-1000006 (type 4/S) for the ID-validity part; APP for the participantKey-collision part.
- **Fields examined:** ID; APP.participantKey.
- **Predicate:** (a) ID is blank or not in {1,2,4}; OR (b) two records share one APP.participantKey. Formal: `ID IS NULL ∨ ID ∉ {1,2,4} ∨ (∃ record₂ ≠ record₁ : participantKey₂ = participantKey₁) ⇒ fail`. Note: `APP.participantKey` is app-generated from (CASE + SSN + DOB) at first import; linkage across extracts is by this key, never by BCV_REC_ID (which is load-specific).
- **Severity:** Critical. **Blocks:** Yes. **Blocking scope:** `import` (record — quarantine).
- **Discrepancy (actual vs expected):** Actual: value(s) found, colliding keys. Expected: ID ∈ {1,2,4}; participantKey unique.
- **Investigation:** Verify record type against the DOPT-death rule in the dictionary (ID=2 vs 1); resolve key collisions by identity review, never by deleting a record.
- **Disposition route:** Record(s) quarantined (§3.1); disposition `requires-investigation` until identity is resolved.

### S-06 — CASE blank, wrong length, or inconsistent within one file

- **Source:** APP (MASTER_PROMPT §7 structural).
- **Fields examined:** CASE.
- **Predicate:** CASE is blank, is not 8 characters, or differs between records within one file (one file = one case). Formal: `CASE IS NULL ∨ length(CASE) ≠ 8 ∨ (∃ record₂ in file : CASE₂ ≠ CASE₁) ⇒ fail`. CASE is text; leading zeros must survive import (never numeric).
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: value found, file. Expected: 8 characters, leading zeros kept, text type.
- **Investigation:** Re-import with CASE forced to text; confirm the case number against the case file.
- **Disposition route:** Bounds/scenario path if the case identity can be established from the case file (class b); otherwise the affected records route to `requires-investigation`.

### S-07 — Date unparseable or ambiguous

- **Source:** APP (MASTER_PROMPT §7 structural).
- **Fields examined:** (all DATE fields).
- **Predicate:** A DATE field's raw value is unparseable as a calendar date, or is in a non-ISO format with ambiguous day/month (e.g. 03/04/2019 with no evidence whether it is March 4 or April 3). Formal: `¬parseableAsCalendarDate(raw) ∨ ambiguousDayMonth(raw) ⇒ fail` (per field, per record).
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: raw value, field, participantKey. Expected: valid calendar date, stored ISO-8601.
- **Investigation:** Confirm the source format (US MM/DD/YYYY vs ISO) from the file's own evidence; ambiguous dates are quarantined, never guessed.
- **Disposition route:** Bounds/scenario path if the date can be recovered from another source (class b) or bounded (class c); otherwise `requires-investigation` / `indeterminate`. An ambiguous date is never guessed into a calculation.

### S-08 — Non-numeric text or wrong sign/scale in a NUMBER field

- **Source:** APP (MASTER_PROMPT §7 structural).
- **Fields examined:** (all NUMBER fields).
- **Predicate:** A NUMBER field contains non-numeric text, or a number with the wrong sign/scale (e.g. PA_AMB in cents; service in months where years are required). Formal: `¬numeric(raw) ∨ sign(raw) ≠ signPermitted(field) ∨ scale(raw) ≠ scaleExpected(field) ⇒ fail` (per field, per record). Scale expectations come from the dictionary (PA_AMB monthly dollars; CS/VS years; S001–S050 annual dollars).
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: raw value, field, participantKey. Expected: numeric, in the dictionary's units.
- **Investigation:** Check the source's units (dollars vs cents, years vs months — notably CS/VS are years; S001–S050 are annual dollars); confirm against the PA schedule.
- **Disposition route:** Bounds/scenario path if the value can be recovered in the right units with evidence (class b); otherwise `requires-investigation`. Never rescale on assumption.

### S-09 — Value scale inconsistent with monthly dollars

- **Source:** APP (Stage 1 §0.4 units assumption).
- **Fields examined:** PA_AMB, PA_ACOMP, CUCOMP.
- **Predicate:** The value's scale is inconsistent with monthly dollars — operationalised as: the value exceeds `param:monthlyBenefitPlausibilityCap` ($25,000/month; see §1.6) with no supporting evidence. Formal: `value > param:monthlyBenefitPlausibilityCap ∧ ¬supportingEvidence ⇒ fail`. The $25,000 bound is borrowed from the plausibility bound official predicates 231/310/314/318 use for monthly benefits; it is a **screening bound, not a validity limit** — a value above it is not automatically wrong.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: value, field, participantKey. Expected: monthly dollars, 2 decimal places.
- **Investigation:** Confirm units and decimals against the PA schedule; do not rescale on assumption.
- **Disposition route:** None (calculation proceeds); finding must be reviewed before any acceptance disposition (§3.3 step 3).

### S-10 — Salary-year span mismatch (S001 year derivation)

- **Source:** APP (Stage 1 §A.2.7: S001 year derivation).
- **Fields examined:** FRSTYEAR, LASTYEAR, S001–S050.
- **Predicate:** The populated S-year count does not match the FRSTYEAR–LASTYEAR span, or the year of S001 cannot be derived. S00n maps to year LASTYEAR − (n−1). Formal: `(LASTYEAR − FRSTYEAR + 1) ≠ count(populated S-years) ∨ ¬derivable(year(S001)) ⇒ fail`. Note: a **gap inside** a matching span is missing data (rule P-14), not a structural error; a **span mismatch** is a structural error.
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: FRSTYEAR, LASTYEAR, populated S-years. Expected: S00n maps to year LASTYEAR − (n−1), and the populated span matches FRSTYEAR–LASTYEAR.
- **Investigation:** Reconcile against the census extract; a gap inside the span is missing data (P-14), a span mismatch is a structural error.
- **Disposition route:** Bounds/scenario path if the averaging-period years can be established from another source (class b/c); otherwise `requires-investigation`.

### S-11 — XLSM hash changed or macro ran

- **Source:** APP (Stage 1 §A.1.1 XLSM rule).
- **Fields examined:** (file).
- **Predicate:** For an XLSM import, the SHA-256 hash differs before vs after import, or a macro ran during import. Formal: `hashBefore ≠ hashAfter ∨ macroRan ⇒ fail`.
- **Severity:** Critical. **Blocks:** Yes. **Blocking scope:** `import` (file).
- **Discrepancy (actual vs expected):** Actual: hashes, file name. Expected: hash identical; macros neither executed nor modified.
- **Investigation:** Abort the import; investigate how the file was opened; re-import read-only.
- **Disposition route:** File not loaded; all rules for its records `not-run`; re-import required.

### S-12 — Imported value without provenance

- **Source:** APP (MASTER_PROMPT §6 immutable sources).
- **Fields examined:** (all fields).
- **Predicate:** An imported value carries no provenance (no file/row/cell, or document/page, or JSON path). Formal: `provenance(value) IS NULL ⇒ fail` (per field, per record).
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: field, participantKey, import batch. Expected: every value carries provenance.
- **Investigation:** Reject the batch or attach provenance from the import record; a value without provenance is not loadable into a calculation.
- **Disposition route:** Bounds/scenario path only for values whose provenance can be attached from the import record (class b); otherwise the affected participant routes to `requires-investigation`.

## 5. Layer 2 — Participant-level validation (P-01–P-16)

### P-01 — Duplicate participant record / unstable identity

- **Source:** APP (MASTER_PROMPT §7 participant-level; Answer Book Ch. 16 Q 16:2).
- **Fields examined:** BCV_REC_ID, APP.participantKey.
- **Predicate:** Duplicate BCV_REC_ID within one load, or one participantKey with two different SSN/DOB pairs. Formal: `(∃ record₂ ≠ record₁ in load : BCV_REC_ID₂ = BCV_REC_ID₁) ∨ (∃ record₂ ≠ record₁ : participantKey₂ = participantKey₁ ∧ (SSN₂ ≠ SSN₁ ∨ DOB₂ ≠ DOB₁)) ⇒ fail`.
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: duplicated IDs/keys, values. Expected: one record per participant per load; identity stable.
- **Investigation:** Possible duplicate participants (see also L-02): compare names, DOB, DOH, DOTE across the duplicates; merge only on documented identity evidence, never on name alone.
- **Disposition route:** Bounds/scenario path only after identity is resolved; otherwise `requires-investigation`.

### P-02 — DOB blank, too early, or on/after DOPT

- **Source:** OFFICIAL — BCV-360–362 (type 3).
- **Fields examined:** DOB.
- **Predicate (sub-conditions):**
  - BCV-360: `DOB IS NULL ⇒ fail` — Error.
  - BCV-361: `DOB < 1900-01-01 ⇒ fail` — Error.
  - BCV-362: `DOB ≥ APP.dopt ⇒ fail` — Error.
- **Severity:** Error (all sub-conditions). **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: DOB value, DOPT. Expected: populated, ≥ 1/1/1900, < DOPT.
- **Investigation:** Answer Book Ch. 16 Q 16:2 / Q 16:5 — DOB errors are the highest-impact census errors (e.g. transposed year digits 1937→1973). Verify against the plan's enrollment/employment records.
- **Disposition route:** Bounds/scenario path if DOB can be recovered (class b) or bounded (class c — e.g. age band from DOH/service); otherwise `requires-investigation` / `indeterminate`.

### P-03 — DOH missing, invalid, or chronologically impossible

- **Source:** OFFICIAL — BCV-214–220, 246, 259 (types 1/2/3; no legend for types 1–3 — see OD-01).
- **Fields examined:** DOH, DOB, DOTE, DOD, DOR.
- **Predicate (sub-conditions):**
  - BCV-214: `DOH IS NULL ⇒ fail` — Error.
  - BCV-215: `DOH < 1930-01-01 ⇒ fail` — Warning.
  - BCV-216: `DOH < DOB ⇒ fail` — Error.
  - BCV-217: `DOH > DOTE ⇒ fail` (where DOTE is populated) — Error.
  - BCV-218: `DOH ≥ APP.dopt ⇒ fail` — Error.
  - BCV-219: `DOH > DOD ⇒ fail` (where DOD is populated) — Error.
  - BCV-220: `DOH > DOR ⇒ fail` (where DOR is populated) — Error.
  - BCV-246: `DOH < 1800-01-01 ⇒ fail` — Warning. (Overlaps BCV-215's earlier-date bound; preserved as written in the workbook.)
  - BCV-259: `DOH > today ⇒ fail` — Warning.
- **Severity:** Error (214, 216–220); Warning (215, 246, 259). **Blocks:** Exact-only (Error sub-conditions); No (Warning sub-conditions). **Blocking scope:** `exact-calculation` / `none` respectively.
- **Discrepancy (actual vs expected):** Actual: values of all dates involved. Expected: DOB ≤ DOH ≤ min(DOTE, DOR, DOD, DOPT) where those dates are populated.
- **Investigation:** Verify against employment records; a DOH after DOTE usually means a rehire was recorded as the hire date (see EmploymentPeriod).
- **Disposition route:** Error sub-conditions → bounds/scenario path if DOH can be recovered/bounded; otherwise `requires-investigation`. Warning sub-conditions → calculation proceeds; review before acceptance.

### P-04 — DOTE missing, invalid, or chronologically impossible (CONFLICT FLAGGED — see §10.1)

- **Source:** OFFICIAL — BCV-221–227, 363 (types 2/3; no legend for types 2–3 — see OD-01).
- **Fields examined:** DOTE, DOB, DOD, DOR.
- **Predicate (sub-conditions, as written in the workbook):**
  - BCV-221: `DOTE IS NULL ⇒ fail` — Error. (For the measurement-date consequence, see M-01: a blank DOTE for RETSTAT 1/2/4 leaves the basis unresolved; for RETSTAT 3 it is legitimate.)
  - BCV-222: `DOTE < 1930-01-01 ⇒ fail` — Warning.
  - BCV-223: `DOTE < DOB ⇒ fail` — Error.
  - BCV-224: `DOTE ≥ APP.dopt ⇒ fail` — Error. (See conflict note below.)
  - BCV-225: `DOTE < APP.dopt ⇒ fail` — Error. (See conflict note below.)
  - BCV-226: `DOTE > DOD ⇒ fail` (where DOD is populated) — Error.
  - BCV-227: `DOTE > DOR ⇒ fail` (where DOR is populated) — Warning.
  - BCV-363: `DOTE > today ⇒ fail` — Warning.
- **Severity:** Error (221, 223–226); Warning (222, 227, 363). **Blocks:** Exact-only (Error); No (Warning). **Blocking scope:** `exact-calculation` / `none`.
- **Discrepancy (actual vs expected):** Actual: DOTE value, related dates. Expected: DOB ≤ DOTE, DOTE ≤ DOD, DOTE ≤ DOR where applicable.
- **Investigation:** See conflict note. For actives (RETSTAT=3) DOTE is legitimately blank or after DOPT.
- **Disposition route:** Error sub-conditions → bounds/scenario path; otherwise `requires-investigation`.
- **CONFLICT — BCV-224 vs BCV-225 (§10.1):** Predicates 224 and 225 appear contradictory: 224 fires when DOTE is on/after DOPT; 225 fires when DOTE is before DOPT. Both are type 3 and both are recorded here as written in the workbook. The two cannot both be errors for the same record. **This catalog preserves both with the conflict flagged and does not silently pick one.** Stage 2 must determine which applies by RETSTAT/population before implementation (see §12, OD-02). Until that determination is made, an implementation must record both sub-conditions as `not-applicable` with reason "conflict C-1 unresolved" when they would otherwise both fire — it must not implement one and drop the other, and it must not fire both on the same record.

### P-05 — DOR missing, invalid, or inconsistent with retirement status

- **Source:** OFFICIAL — BCV-247–252, 261 (types 2/3).
- **Fields examined:** DOR, SBCD, FORM_CODE_ARD.
- **Predicate (sub-conditions):**
  - BCV-247: `DOR < 1930-01-01 ⇒ fail` — Warning.
  - BCV-248: `DOR > today + 4 months ⇒ fail` — Warning.
  - BCV-249: `DOR IS NULL ∧ participant is a pre-DOPT retiree ⇒ fail` — Error.
  - BCV-250: `DOR ≥ APP.dopt ∧ participant is a pre-DOPT retiree ⇒ fail` — Error.
  - BCV-251: `DOR < APP.dopt ∧ record is a deferred record ⇒ fail` — Error.
  - BCV-252: `FORM_CODE_ARD IS NOT NULL ∧ DOR IS NULL ∧ record is a deferred record ⇒ fail` — Error.
  - BCV-261: `SBCD IS NOT NULL ∧ DOR IS NULL ⇒ fail` — Warning.
- **Severity:** Error (249–252); Warning (247–248, 261). **Blocks:** Exact-only (Error); No (Warning). **Blocking scope:** `exact-calculation` / `none`.
- **Discrepancy (actual vs expected):** Actual: DOR, RETSTAT, related fields. Expected: DOR consistent with RETSTAT and pay status.
- **Investigation:** Verify retirement date against payment records and the PA schedule; a DOR before DOPT for a deferred record usually means the record is a retiree misclassified.
- **Disposition route:** Error sub-conditions → bounds/scenario path; otherwise review before acceptance.

### P-06 — Credited / vesting service blank, not in years, or out of range (BCV-276 DISABLED — restated as APP; see §10.2)

- **Source:** MIXED — OFFICIAL BCV-277–281, 420 (types 2/3) for the range/unit checks; APP restatement of disabled BCV-276 (`ENABLE_FL = N`) for the CS-blank check.
- **Fields examined:** CS, VS.
- **Predicate (sub-conditions):**
  - BCV-276 (APP restatement): `CS IS NULL ⇒ fail` — Error. BCV-276 is disabled in the predicates workbook (`ENABLE_FL = N`); it is **not** adopted as an official predicate. It is re-stated here as an APP rule because credited service is required for reconstruction. The BCV ID is preserved for traceability; the source label on this sub-condition is APP.
  - BCV-277: `CS not in years ⇒ fail` — Error. (Unit check: the stored value must be interpretable as years, not months or another unit.)
  - BCV-278: `CS × 12 ∉ [0, 999] ⇒ fail` — Error. (Equivalent: CS ∉ [0, 83.25] years.)
  - BCV-279: `VS IS NULL ⇒ fail` — Error.
  - BCV-280: `VS not in years ⇒ fail` — Error.
  - BCV-281: `VS × 12 ∉ [0, 999] ⇒ fail` — Error.
  - BCV-420: `VS = 0 ⇒ fail` — Error. (A finding, not a conclusion: VS = 0 with a positive PA_AMB is a vesting question — rule X-09 — not automatically an error in the benefit.)
- **Severity:** Error (all sub-conditions). **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: CS/VS values. Expected: populated, in years, 0 ≤ service ≤ 83.25 years (999 months).
- **Investigation:** Compare with CSPA/VSPA (rule X-07); verify service against EmploymentPeriod and plan records; VS = 0 with a positive PA_AMB is a vesting question (X-09), not automatically an error.
- **Disposition route:** Bounds/scenario path if service can be recovered from CSPA/VSPA or plan records (class b) or bounded (class c); otherwise `requires-investigation`.

### P-07 — Age nearest birthday (ANB / SANB) blank or out of range

- **Source:** OFFICIAL — BCV-283–286 (type 3).
- **Fields examined:** ANB, SANB.
- **Predicate (sub-conditions):**
  - BCV-283: `ANB IS NULL ⇒ fail` — Error.
  - BCV-284: `ANB ∉ [0, 999] ⇒ fail` — Error.
  - BCV-285: `SANB IS NULL ⇒ fail` — Error.
  - BCV-286: `SANB ∉ [0, 999] ⇒ fail` — Error.
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: ANB/SANB values. Expected: populated, 0–999.
- **Investigation:** Recompute age nearest birthday at DOPT from DOB; a mismatch points to a DOB error (rule P-02).
- **Disposition route:** Bounds/scenario path if age can be recomputed from DOB (class b); otherwise `requires-investigation`.

### P-08 — NRD missing or invalid

- **Source:** OFFICIAL — BCV-304–305 (type 3).
- **Fields examined:** NRD.
- **Predicate (sub-conditions):**
  - BCV-304: `NRD ≤ 1800-01-01 ⇒ fail` — Error.
  - BCV-305: `NRD IS NULL ⇒ fail` — Error.
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: NRD value. Expected: populated, > 1/1/1800.
- **Investigation:** NRD is Calculated (add-in RETDATE) — a blank NRD means the BCV calculation did not run or lacked inputs; check DOB and the plan normal-retirement definition.
- **Disposition route:** Bounds/scenario path if NRD can be derived from DOB + the plan's normal-retirement definition (class b); otherwise `requires-investigation`. Note: a missing NRD does not by itself make the PA_AMB measurement basis unresolved — PA_AMB's stated basis is DOTE (see §7) — but it blocks any NRD-based comparison or conversion.

### P-09 — Required begin date (RBD) cannot be determined

- **Source:** OFFICIAL — BCV-308 (type 3).
- **Fields examined:** DOB, DOD, DOPT, DOTE, ID, NON_SPOUSE_BENF, RETSTAT. (DOPT here is `APP.dopt`, the case fact — see §0.5.)
- **Predicate:** RBD cannot be determined because one of the listed fields is missing or bad. Formal: `¬determinable(RBD | DOB, DOD, APP.dopt, DOTE, ID, NON_SPOUSE_BENF, RETSTAT) ⇒ fail`.
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: which field(s) missing/bad. Expected: RBD determinable.
- **Investigation:** Fix the underlying field(s) via their own rules; RBD failure is a symptom, not a root cause — never "fix" it by inventing a date.
- **Disposition route:** Bounds/scenario path once the underlying field is recovered; otherwise `requires-investigation`. RBD failure alone never justifies inventing a date.

### P-10 — Beneficiary / alternate-payee identity fields missing or invalid

- **Source:** OFFICIAL — BCV-353, 355, 369–374, 391–396, 425–431 (types 2/3).
- **Fields examined:** BSSN, SSSN, BLNAME, SLNAME, BDOB, SDOB, APDOB, BSEX, SSEX, APSEX, BDOD, SDOD, APDOD.
- **Predicate (sub-conditions, by group):** For ID=2 (beneficiary) / ID=4 (alternate payee) records: (a) a required beneficiary/AP identity field is missing or invalid ⇒ fail — Error; (b) beneficiary/AP DOB before 1/1/1900 or after DOPT ⇒ fail — Error; (c) death on/before birth (BDOD ≤ BDOB, SDOD ≤ SDOB, APDOD ≤ APDOB) ⇒ fail — Error; (d) death populated but birth blank ⇒ fail — Error; (e) beneficiary/AP sex unknown ⇒ fail — Warning.
- **Severity:** Error (missing/invalid); Warning (unknown sex). **Blocks:** Exact-only (Error); No (Warning). **Blocking scope:** `exact-calculation` / `none`.
- **Discrepancy (actual vs expected):** Actual: fields and values. Expected: complete, chronologically consistent beneficiary/AP identity.
- **Investigation:** Verify against the QDRO / beneficiary designation / death records; an ID=2 record without a beneficiary DOB cannot produce a survivor benefit.
- **Disposition route:** Error sub-conditions → bounds/scenario path if identity can be recovered (class b); otherwise `requires-investigation`.

### P-11 — Sex (PSEX) unknown, blank, or invalid

- **Source:** OFFICIAL — BCV-388–390 (types 2/3).
- **Fields examined:** PSEX.
- **Predicate (sub-conditions):**
  - BCV-388: `PSEX = 'U' (Unknown) ⇒ fail` — Warning.
  - BCV-389: `PSEX IS NULL ⇒ fail` — Error.
  - BCV-390: `PSEX ∉ {M, F, U} ⇒ fail` — Error.
- **Severity:** Warning (U); Error (blank/invalid). **Blocks:** No (U); Exact-only (blank/invalid). **Blocking scope:** `none` / `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: PSEX value. Expected: M or F (U is permitted by the dictionary but is a Warning — see note).
- **Investigation:** NOTE: the dictionary permits U (Unknown) and the add-in mortality for equivalence is unisex per Answer Book Ch. 16 Q 16:11 (Arizona v. Norris), so U does not block a calculation — but it blocks any sex-dependent PA factor check and must be resolved from plan records.
- **Disposition route:** U → calculation proceeds; review before acceptance. Blank/invalid → bounds/scenario path if resolvable (class b); otherwise `requires-investigation`.

### P-12 — Participation before eligibility; service accrues before participation

- **Source:** APP (MASTER_PROMPT §7 participant-level: eligibility).
- **Fields examined:** DOP, DOH, APP.serviceMeasure.
- **Predicate:** DOP is before DOH; or participation begins before eligibility is met under the plan's rules; or credited service accrues before DOP. Formal: `DOP < DOH ∨ participationBeforeEligibility ∨ serviceAccruesBefore(DOP) ⇒ fail`.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: DOP, DOH, service values. Expected: DOH ≤ DOP ≤ accrual start; service consistent with the plan's eligibility rule.
- **Investigation:** Check the plan's eligibility provision (R5) and Answer Book Ch. 7 (eligibility / participation); pre-participation service is usually a plan-records question.
- **Disposition route:** None; review before acceptance.

### P-13 — PA_AMB blank (blank = missing, never zero)

- **Source:** APP (MASTER_PROMPT §7 "Do not replace missing input data with zero"; Stage 1 §0.4).
- **Fields examined:** PA_AMB.
- **Predicate:** PA_AMB is blank AND there is no explicit documented statement that the PA reported no benefit for this participant. Formal: `PA_AMB IS NULL ∧ ¬explicitNoBenefitStatement(participant) ⇒ fail`. A blank **with** an explicit statement is a pass of this rule (the statement itself is then evidence, reviewed under X-09 for nonvested participants).
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: participantKey, RETSTAT, CSPA. Expected: a populated amount, OR an explicit documented statement that the PA reported no benefit for this participant. A blank with no statement is missing data.
- **Investigation:** **Blank = missing, never zero.** Classify per Stage 1 §A.6: (a) if the PA should have reported one (RETSTAT 1–3, CSPA > 0); (b) recoverable if the PA schedule states the amount; (e) if no source states any benefit and none can be reconstructed. A blank PA_AMB for a RETSTAT=4 (nonvested) participant with VSPA below the vesting threshold may be a legitimate zero benefit — but that is a documented determination (rule X-09), not a default.
- **Disposition route:** Bounds/scenario path if the amount is recoverable (class b) or the benefit is bounded (class c); otherwise `requires-investigation` / `indeterminate`. The participant is never zero-filled into a comparison.

### P-14 — Salary year missing inside the span; averaging-period gap

- **Source:** APP (MASTER_PROMPT §7 participant-level: missing compensation; Answer Book Ch. 16 Q 16:7 salary history).
- **Fields examined:** S001–S050, FRSTYEAR, LASTYEAR, PA_ACOMP.
- **Predicate:** (a) A salary year inside FRSTYEAR–LASTYEAR is blank and that year falls in the plan's averaging period ⇒ fail — Error; (b) a salary year inside the span is blank but outside the averaging period ⇒ fail — Warning; (c) all salary years are blank while the formula needs average pay ⇒ fail — Error; (d) ANNACT = 'B' (annualized) with no note of the annualization basis ⇒ fail — Warning. Formal (a): `∃ year y ∈ averagingPeriod : S(year(y)) IS NULL ⇒ fail`.
- **Severity:** Error (averaging-period gap, all-blank); Warning (gap outside the averaging period, undocumented annualization). **Blocks:** Exact-only (Error); No (Warning). **Blocking scope:** `exact-calculation` / `none`.
- **Discrepancy (actual vs expected):** Actual: missing years, averaging period, PA_ACOMP presence. Expected: every year in the averaging period populated, or its absence classified per Stage 1 §A.6.
- **Investigation:** Recover from payroll/W-2 records (class b) or bound it (class c — adjacent years and the §401(a)(17) cap for that year); PA_ACOMP may substitute only if its own provenance and averaging period are documented.
- **Disposition route:** Error → bounds/scenario path (class c bounds or class d assumption with sensitivity); otherwise `requires-investigation`.

### P-15 — Service exceeds elapsed time (CONDITIONAL on the plan's service-credit rule)

- **Source:** APP (MASTER_PROMPT §7 participant-level: service limits; Answer Book Ch. 7/8).
- **Fields examined:** CSPA, VSPA, ESPA, DOH, DOTE.
- **Predicate:** CSPA exceeds elapsed time DOH→DOTE, allowing the plan's service-credit rule (`param:planServiceCreditRule` — e.g. past-service credit); or VSPA exceeds CSPA by more than the plan's rules allow; or ESPA exceeds elapsed time. Formal: `CSPA > elapsed(DOH, DOTE) + creditsAllowed(planRule) ∨ VSPA − CSPA > allowedExcess(planRule) ∨ ESPA > elapsed(DOH, DOTE) + creditsAllowed(planRule) ⇒ fail`. **Conditional:** until `param:planServiceCreditRule` is established for the case, the credits term is unknown and the rule can only fire on the gross comparison (service > elapsed time with zero documented credits); that limited firing is recorded as such. See §1.7.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: service values, elapsed time, credits. Expected: each service measure ≤ elapsed time + documented credits.
- **Investigation:** Verify against plan records; past-service credits and special credits must be documented (plan document §), not assumed — an undocumented excess is a diagnostic hypothesis (service), not a correction.
- **Disposition route:** None; review before acceptance.

### P-16 — Conflicting identity across records (possible duplicate person)

- **Source:** APP (MASTER_PROMPT §7 participant-level: duplicates; Answer Book Ch. 16 Q 16:2 reconciliation).
- **Fields examined:** SSN, DOB, FNAME, LNAME, DOH.
- **Predicate:** Two records share SSN but differ in DOB/name, or share (name + DOB) but differ in SSN. Formal: `(∃ record₂ ≠ record₁ : SSN₂ = SSN₁ ∧ (DOB₂ ≠ DOB₁ ∨ name₂ ≠ name₁)) ∨ (∃ record₂ ≠ record₁ : name₂ = name₁ ∧ DOB₂ = DOB₁ ∧ SSN₂ ≠ SSN₁) ⇒ fail`. (ID=2/4 records linked by family are not duplicates under this rule; see P-01.)
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: the conflicting records and fields. Expected: one person, one record (plus separate ID=2/4 records linked by family, not duplicated as participants).
- **Investigation:** Identity review against employment records; possible causes: SSN typo, remarriage name change, or a genuine duplicate. Merge only on documented identity evidence.
- **Disposition route:** Bounds/scenario path only after identity is resolved; otherwise `requires-investigation`.

## 6. Layer 3 — Cross-field validation (X-01–X-14)

Cross-field rules test whether the combination of age, service, compensation, status, benefit amount, and dates is plausible under the applicable plan provisions (MASTER_PROMPT §7).

### X-01 — RETSTAT vs PA_AMB (status vs benefit)

- **Source:** APP (MASTER_PROMPT §7 cross-field: status vs benefit).
- **Fields examined:** RETSTAT, PA_AMB.
- **Predicate:** RETSTAT = 5 (not in valuation population) with a populated PA_AMB; OR RETSTAT ∈ {1,2,3,4} with PA_AMB blank and no explicit statement (see P-13). Formal: `(RETSTAT = 5 ∧ PA_AMB IS NOT NULL) ∨ (RETSTAT ∈ {1,2,3,4} ∧ PA_AMB IS NULL ∧ ¬explicitNoBenefitStatement) ⇒ fail`.
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: RETSTAT, PA_AMB. Expected: RETSTAT = 5 → no PA_AMB in the valuation population; RETSTAT 1–4 → PA_AMB present or explicitly stated absent.
- **Investigation:** RETSTAT = 5 with a benefit usually means the record belongs in the population (status error) or the benefit belongs to a different record; check the census extract and the PA schedule.
- **Disposition route:** Bounds/scenario path once status is resolved; otherwise `requires-investigation`. (RETSTAT = 5 records are otherwise out of scope — see §3.4.)

### X-02 — RETSTAT inconsistent with DOTE / RBD

- **Source:** OFFICIAL — BCV-350 (type 2), BCV-351 (type 4).
- **Fields examined:** DOTE, RETSTAT, DOB, DOD.
- **Predicate (sub-conditions):**
  - BCV-350: `RETSTAT inconsistent with DOTE` (i.e. the status/date combination contradicts the expected pattern below) ⇒ fail — Warning.
  - BCV-351: `RBD ≤ APP.dopt ∧ RETSTAT ≠ 1 ⇒ fail` — Error. (BCV type 4 = critical error in the workbook; Stage 1 assigns app severity Error, not Critical — the reason: the finding blocks the exact calculation for this participant but does not make the record unloadable or its identity indeterminate. The BCV type is preserved in the record.)
- **Expected pattern (for BCV-350):** RETSTAT = 1 → in pay at DOPT; RETSTAT = 2 → separated, DOTE < DOPT; RETSTAT = 3 → active, DOTE blank or ≥ DOPT; RETSTAT = 4 → nonvested.
- **Severity:** Warning (350); Error (351). **Blocks:** No (350); Exact-only (351). **Blocking scope:** `none` / `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: RETSTAT, DOTE, RBD. Expected: per the pattern above.
- **Investigation:** Verify employment status against plan records; status errors cascade into every benefit comparison, so fix status before calculating.
- **Disposition route:** 351 → bounds/scenario path once status is resolved; otherwise `requires-investigation`. 350 → review before acceptance.

### X-03 — RETSTAT vs mandatory-contribution balance

- **Source:** OFFICIAL — BCV-282 (type 3), BCV-333/416 (type 4/7 as written in Stage 1 — see implementability note).
- **Fields examined:** MANDCWI, RETSTAT, PVRETEEC.
- **Predicate (sub-conditions):**
  - BCV-282: `record status inconsistent with mandatory-contribution balance at DOPT ⇒ fail` — Warning.
  - BCV-333 / BCV-416: `participant not fully vested in employee contributions ⇒ fail` — Error (as written in Stage 1).
- **Severity:** Warning (282); Error (333/416). **Blocks:** No (both, per Stage 1 §B.3 — the Error sub-conditions block nothing because the finding concerns the contributions floor, not the PA_AMB calculation). **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: MANDCWI, RETSTAT. Expected: participants are always fully vested in their own contributions; RETSTAT consistent with MANDCWI > 0.
- **Investigation:** Check the contributions record; a nonvested participant with MANDCWI > 0 still owns the contributions — this affects the benefit floor, not the PA_AMB itself.
- **Disposition route:** None; review before acceptance.
- **Implementability note:** Stage 1 §B.3 writes the BCV type for 333/416 as "4/7". The predicates workbook type counts in Stage 1 §0.5 cover only types 1–4; a type "7" is not explained anywhere in the Stage 1 text. This catalog preserves "4/7" as written and applies the Stage 1 severity (Error) and blocking (No). See §12, OD-03: the workbook must be re-read for predicates 333 and 416 before implementation.

### X-04 — Benefit-to-compensation ratio outside the plausible range (PARAMETERIZED — not implementable until the case sets the range)

- **Source:** APP (MASTER_PROMPT §7 cross-field: age/service/comp/status/benefit plausibility).
- **Fields examined:** DOB, CSPA, PA_ACOMP, PA_AMB, RETSTAT.
- **Predicate:** PA_AMB implies a benefit-to-compensation ratio outside the plausible range for the plan's formula. With monthly average compensation `PA_ACOMP_monthly` (PA_ACOMP is a monthly-average figure per the dictionary; if the case establishes it is annual, the ratio uses PA_ACOMP ÷ 12 — the unit must be established at import, rule S-09): `PA_AMB ÷ PA_ACOMP_monthly ∉ param:plausibleBenefitCompRatioRange ⇒ fail`. The canonical illustration in Stage 1: monthly benefit exceeding monthly average compensation with no documented cause. **Parameter required:** `param:plausibleBenefitCompRatioRange` (§1.6) is derived from the plan's formula (accrual rate × service, plus any grandfathered floor). **Until the case actuary sets it, this rule records `not-applicable` for every participant — it never passes and never fires.** See §1.7.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: ratio, inputs, formula. Expected: ratio consistent with accrual rate × service for the plan's formula.
- **Investigation:** **HEURISTIC ONLY** (MASTER_PROMPT §11: a heuristic never overrides the governing formula). Investigate; do not auto-correct. Plausible causes: high accrual rate, grandfathered floor, or a data error in PA_ACOMP/CSPA.
- **Disposition route:** None; review before acceptance. A firing of X-04 is never, by itself, evidence that PA_AMB is wrong.

### X-05 — Zero credited service with a positive PA_AMB

- **Source:** APP (MASTER_PROMPT §7 cross-field).
- **Fields examined:** PA_AMB, CSPA.
- **Predicate:** CSPA = 0 (or blank) with PA_AMB > 0, and no documented minimum benefit, grandfathered benefit, or past-service credit applies. Formal: `(CSPA = 0 ∨ CSPA IS NULL) ∧ PA_AMB > 0 ∧ ¬documentedMinimumOrGrandfatherOrPastServiceCredit ⇒ fail`.
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: CSPA, PA_AMB. Expected: zero credited service → zero formula benefit, unless a documented minimum benefit, grandfathered benefit, or past-service credit applies.
- **Investigation:** Check for a minimum-benefit provision, grandfathered floor, or past-service credit in the plan document; if none exists, the PA_AMB is unsupported on its face — a diagnostic hypothesis (service), and the record routes per §3.3.
- **Disposition route:** Bounds/scenario path if a documented floor/credit is found (class b) — the comparison then runs against the floor; otherwise `requires-investigation`.

### X-06 — PA_AMB inconsistent with the PA's own inputs (PA arithmetic check)

- **Source:** APP (MASTER_PROMPT §7 cross-field).
- **Fields examined:** PA_AMB, PA_ACOMP, CSPA, APP.formulaId.
- **Predicate:** All three PA inputs are present (PA_ACOMP, CSPA, and the governing formula), and PA_AMB differs from the plan's formula applied to the PA's own inputs by more than the case tolerance. Formal: `PA_ACOMP IS NOT NULL ∧ CSPA IS NOT NULL ∧ formulaKnown ∧ |PA_AMB − formula(PA_ACOMP, CSPA)| > param:caseTolerance ⇒ fail`. **Conditional:** without `param:caseTolerance` (M-7) the rule is `not-applicable` (the engine refuses to compare without a recorded tolerance); without the formula or any one PA input it is `not-applicable` for that participant.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: PA_AMB, PA_ACOMP, CSPA, computed check value. Expected: the PA's own arithmetic reconciles within tolerance.
- **Investigation:** Recompute from the PA's own inputs; a mismatch here means the PA's schedule used different inputs than the census carries — the schedule is the next document to read (rule C-01).
- **Disposition route:** None; review before acceptance. Note the severity is Warning (not Error) because the mismatch may be explained by inputs the census does not carry — the schedule, not the census, is the authority.

### X-07 — PA-reported service vs BCV-calculated service

- **Source:** APP (Stage 1 §A.2.8: PA vs BCV service).
- **Fields examined:** CSPA, CS, VSPA, VS, ESPA, ES.
- **Predicate:** |CSPA − CS|, |VSPA − VS|, or |ESPA − ES| exceeds the case's service tolerance. Formal: `|CSPA − CS| > param:serviceTolerance ∨ |VSPA − VS| > param:serviceTolerance ∨ |ESPA − ES| > param:serviceTolerance ⇒ fail` (each pair evaluated only where both values are populated; a missing side is that field's own rule — P-06 — not this rule). `param:serviceTolerance` defaults to 0 (§1.6).
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: both values, difference, measurement dates. Expected: PA-reported and BCV-calculated service agree, or the difference is explained (different service-credit rule, different measurement date).
- **Investigation:** Determine which service-credit rule each side used (plan document §, Answer Book Ch. 7); the difference is itself a diagnostic hypothesis (service) for the reconciliation.
- **Disposition route:** None; review before acceptance.

### X-08 — PIA missing for an integrated formula; PIA present for a non-integrated formula

- **Source:** APP (MASTER_PROMPT §7 cross-field: PIA/integration).
- **Fields examined:** PIA, PA_AMB, APP.integrationMethod.
- **Predicate (sub-conditions):**
  - (a) The governing formula is integrated (offset / covered-comp) AND PIA is blank ⇒ fail — Error.
  - (b) PIA is populated AND the governing formula is not integrated ⇒ fail — Warning.
- **Severity:** Error (missing PIA for integrated formula); Warning (PIA present, formula not integrated). **Blocks:** Exact-only (missing PIA); No (PIA present). **Blocking scope:** `exact-calculation` / `none`.
- **Discrepancy (actual vs expected):** Actual: PIA, formula type. Expected: PIA present iff the governing formula uses a Social Security offset; PIA consistent with the PA schedule.
- **Investigation:** Obtain the PIA from the PA schedule or SSA records (class b); if unrecoverable, class (d) assumption with sensitivity — an integrated formula cannot be reconstructed without it.
- **Disposition route:** Missing PIA → bounds/scenario path (class d assumption, labelled as an estimate, with sensitivity shown); otherwise `requires-investigation`.

### X-09 — Vesting treatment of PA_AMB unknown and participant nonvested (OPEN — G-1)

- **Source:** APP (Stage 1 §0.4 open question; Answer Book Ch. 8 vesting).
- **Fields examined:** PA_AMB, VPPA, VS, VSPA, RETSTAT.
- **Predicate:** PA_AMB > 0 for a participant whose vesting percentage (VPPA) or vesting service (VS/VSPA) shows nonvested, AND the vesting treatment of PA_AMB is unknown (APP.vestingTreatment = `unknown`). Formal: `PA_AMB > 0 ∧ nonvested(VPPA, VS, VSPA) ∧ vestingTreatment(PA_AMB) = unknown ⇒ fail`. The rule fires on the **unknown treatment**, not on the benefit: a nonvested participant's vested benefit is zero, but the gross accrued benefit may be positive.
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: PA_AMB, VPPA, VS, RETSTAT. Expected: the vesting treatment of PA_AMB is established (gross / vested / unknown) before any comparison; a nonvested participant's vested benefit is zero, but the gross accrued benefit may be positive.
- **Investigation:** Establish from the PA schedule whether PA_AMB is gross or vested. **Never assume:** applying VPPA twice (once by the PA, once by the app) is a known error mode (MASTER_PROMPT §10). Until established, the record is Partial at best and `Verified` is unreachable (§3.4).
- **Disposition route:** Bounds/scenario path — the benefit may be evaluated under both treatments as scenarios (gross and vested), each labelled; otherwise `requires-investigation`. The dictionary does not state the treatment (Stage 1 gap G-1); see §12, OD-05.

### X-10 — Annuity form of PA_AMB unknown, or non-normal form with no conversion (OPEN — G-2)

- **Source:** APP (Stage 1 §0.4 open question; MASTER_PROMPT §3 typed benefit).
- **Fields examined:** PA_AMB, FORM_CODE_NSF, FORM_CODE_NMF, APP.annuityForm.
- **Predicate:** The annuity form of PA_AMB is unknown (APP.annuityForm is NULL); OR the PA schedule states a form that is not the plan's normal form with no conversion documented. Formal: `annuityForm(PA_AMB) IS NULL ∨ (statedForm ≠ normalForm ∧ ¬conversionDocumented) ⇒ fail`.
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: PA_AMB, stated form (if any), normal forms. Expected: the annuity form of PA_AMB is recorded; if it differs from the normal form, the conversion factor and its source are recorded.
- **Investigation:** Obtain the form from the PA schedule; a comparison between different annuity forms without conversion is invalid (rule M-05).
- **Disposition route:** Bounds/scenario path — the benefit may be evaluated under each candidate form as scenarios, each labelled; otherwise `requires-investigation`. The dictionary does not state the form (Stage 1 gap G-2); see §12, OD-05.

### X-11 — Form code / survivor % / months-certain invalid or inconsistent

- **Source:** OFFICIAL — BCV-200–203, 209–213, 264–274, 320–331, 375–380, 385–387 (types 2/3).
- **Fields examined:** FORM_CODE, FORM_CODE_NSF, FORM_CODE_NMF, FORM_CODE_QPSA, FORM_CODE_ARD, SPC_VAL, SPCNSF, SPC_ARD, MTHS, MTHSNSF, MTHS_ARD.
- **Predicate (sub-conditions, by group):**
  - BCV-200, 266, 274: form code (FORM_CODE / FORM_CODE_NSF) not in the valid list, or a required form code not populated ⇒ fail — Error.
  - BCV-201–203, 267–269: ARD form / expected form inconsistent with the plan normal forms or PBGC optional forms ⇒ fail — Warning.
  - BCV-209–213, 264–265, 270–273, 320–331, 375–380, 385–387: survivor % outside 0–1; months-certain > 180 or not in the permitted set for the form; joint-life code on a single-life record ⇒ fail — Error for an invalid code or out-of-range value; Warning for a consistency mismatch.
- **Severity:** Error (invalid code/range); Warning (consistency). **Blocks:** Exact-only (invalid); No (consistency). **Blocking scope:** `exact-calculation` / `none`.
- **Discrepancy (actual vs expected):** Actual: codes and values found. Expected: codes, survivor %, and months-certain mutually consistent and within the dictionary's permitted values.
- **Investigation:** Verify the form against the plan document and the PA schedule; form errors usually indicate the wrong normal form was loaded, which affects every benefit on that form.
- **Disposition route:** Invalid code/range → bounds/scenario path once the form is established (class b); otherwise `requires-investigation`. Consistency → review before acceptance.

### X-12 — Critical valuation fields not populated (cross-source scope only)

- **Source:** OFFICIAL — BCV-434 (type 4).
- **Fields examined:** FORM_CODE, LS_TERM, XRD, XRD_MB_TERM.
- **Predicate:** A critical valuation field is not populated for a record in the valuation population. Formal: `(FORM_CODE IS NULL ∨ LS_TERM IS NULL ∨ XRD IS NULL ∨ XRD_MB_TERM IS NULL) ∧ RETSTAT ∈ {1,2,3,4} ⇒ fail`.
- **Severity:** Error. **Blocks:** No (for the PA_AMB calculation). **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: which fields blank. Expected: populated for records in the valuation population.
- **Investigation:** NOTE: adopted for cross-source scope only (rule C-03) — this system does not calculate XRD benefits. A blank here blocks a cross-source check, not the PA_AMB calculation itself.
- **Disposition route:** None for the PA_AMB calculation; the affected cross-source check (C-03) records `not-applicable` for that participant, with this finding referenced. (BCV type 4 would naively suggest Critical; Stage 1 assigns app severity Error with blocking No, because the finding does not touch the PA_AMB verification itself. The BCV type is preserved in the record.)

### X-13 — Contributions / cash balance not reflected in the benefit

- **Source:** APP (MASTER_PROMPT §7 cross-field: contributions vs benefit).
- **Fields examined:** MANDCWI, VOLCWI, PA_AMB, CASH_BAL_DOPT.
- **Predicate:** MANDCWI/VOLCWI > 0 with no corresponding benefit floor or return-of-contributions treatment in the calculation; OR CASH_BAL_DOPT > 0 for a non-cash-balance formula with no explanation. Formal: `(MANDCWI > 0 ∨ VOLCWI > 0) ∧ ¬contributionTreatmentDocumented ∨ (CASH_BAL_DOPT > 0 ∧ formulaType ≠ cash-balance ∧ ¬explanationDocumented) ⇒ fail`.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: contribution/balance values. Expected: contributions and cash-balance amounts are either reflected in the benefit or explicitly documented as not applicable.
- **Investigation:** Check the plan's contribution provisions (Answer Book Ch. 9 questions on mandatory contributions) and whether the formula is cash-balance (Answer Book Ch. 18).
- **Disposition route:** None; review before acceptance.

### X-14 — Accrual after the benefit freeze date

- **Source:** APP (MASTER_PROMPT §7 cross-field: freeze).
- **Fields examined:** DOBF, DOTE, PA_AMB, APP.freezeDate. (DOBF here is the participant-level BCV1.DOBF; the plan-level freeze date is `APP.freezeDate` — see §0.5.)
- **Predicate:** The benefit freeze date (participant DOBF, or plan `APP.freezeDate`) is after DOTE but service/benefit accrues past it; OR PA_AMB reflects accrual after the freeze date. Formal: `(DOBF IS NOT NULL ∧ DOBF < DOTE ∧ accrualAfter(DOBF)) ∨ (APP.freezeDate IS NOT NULL ∧ accrualAfter(APP.freezeDate)) ∨ benefitReflectsPostFreezeAccrual(PA_AMB) ⇒ fail`. Expected: no accrual after the benefit freeze date; DOBF ≤ DOTE for frozen participants.
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: DOBF, freeze date, DOTE, PA_AMB. Expected: no accrual after the benefit freeze date.
- **Investigation:** Verify the freeze provision (plan document / amendment) and the freeze date; post-freeze accrual is a diagnostic hypothesis (freeze) — see also Answer Book Ch. 26 (frozen plans).
- **Disposition route:** Bounds/scenario path — the benefit may be recomputed with accrual stopped at the freeze date as a scenario; otherwise `requires-investigation`.

## 7. Layer 4 — Measurement-date resolution (M-01–M-06)

These rules implement MASTER_PROMPT §5 ("A recorded amount without an established benefit measurement date must be marked as having an unresolved comparison basis") and Stage 1 §0.3. They are the most consequential layer in the catalog: they decide whether a comparison may be computed at all.

### 7.1 The unresolved-basis flag rule and its consequences

The unresolved-basis flag is not a single rule: it is the **state** produced by M-01, M-02, M-03, M-04, and M-06, and enforced by M-05. Precisely:

- **`APP.measurementBasis` (on BenefitObservation) = `unresolved`** when any of the following holds and no evidence resolves it: DOTE is blank for a separated/retired/nonvested participant (M-01); only a recorded/filed date is known, with no statement of the date through which the benefit was calculated (M-02); the established measurement date disagrees with census DOTE and the disagreement is unexplained (M-03, Warning — the basis is flagged as disputed, not unresolved, until the PA's date is established); an NRD-basis claim is asserted without evidence (M-04); or more than one candidate date exists and none is established with evidence (M-06).
- **`APP.comparisonBasis` (on BenefitComparison) = `unresolved`** whenever the observation and the calculation do not have equivalent bases (M-05). A comparison with `comparisonBasis = unresolved` is stored but marked **not-comparable**.
- **Consequences (mandatory, not discretionary):**
  1. **No Δ is computed.** Δᵢ = Bᵢ^PA − B̂ᵢ, Dᵢ = |Δᵢ|, and Rᵢ = Δᵢ / B̂ᵢ are not computed for that participant. A stored comparison record carries `comparisonBasis = unresolved` and no delta fields (or delta fields explicitly NULL with the reason). A Δ computed across unequal bases is a category error, not a result.
  2. **Disposition `Verified` is unreachable** (§3.4: the "Complete or Partial / Unresolved" rows allow only `Requires investigation` or `Indeterminate`). `Supported for acceptance` is likewise unreachable while the basis is unresolved.
  3. **The record is held, not compared, and never dropped.** It appears in every report with its reason, and is counted in denominators.
  4. **Bounds may still be produced** only if the basis uncertainty itself can be bounded — e.g. the benefit recomputed at each candidate date as explicit scenarios, each labelled with its date (§3.4). Otherwise no calculated benefit is produced.
  5. **Recovery path:** the basis is resolved only by evidence — the PA schedule's as-of statement, or a documented DOTE basis — recorded with its SourceDocument location. The measurement date is never inferred from the file date, the valuation date, or DOPT.

### M-01 — PA_AMB populated but DOTE blank

- **Source:** APP (MASTER_PROMPT §5; dictionary DOTE note).
- **Fields examined:** DOTE, PA_AMB, RETSTAT.
- **Predicate:** PA_AMB is populated and DOTE is blank. Severity and consequence depend on RETSTAT: RETSTAT ∈ {1,2,4} ⇒ fail — Error (the measurement basis is unresolved); RETSTAT = 3 (active) ⇒ fail — Warning (a blank DOTE is legitimate for an active; the measurement date must be established another way — schedule statement, or DOPT as the as-of date, documented, not assumed). Formal: `PA_AMB IS NOT NULL ∧ DOTE IS NULL ⇒ fail` (severity by RETSTAT as above).
- **Severity:** Error (RETSTAT 1/2/4); Warning (RETSTAT 3). **Blocks:** Exact-only (Error); No (Warning). **Blocking scope:** `exact-calculation` / `none`.
- **Discrepancy (actual vs expected):** Actual: DOTE blank, RETSTAT, PA_AMB. Expected: DOTE populated for RETSTAT 1, 2, 4 (separated/retired); for RETSTAT 3 (active) DOTE blank is legitimate and the measurement date must be established another way.
- **Investigation:** Obtain DOTE from employment records (class b) or the PA schedule's as-of statement. Until then the measurement basis is unresolved (§7.1: `Verified` unreachable).
- **Disposition route:** Error → bounds/scenario path only if the basis can be bounded by candidate dates (scenarios); otherwise `requires-investigation` / `indeterminate`. Note: the DOPT-default note in the BCV1.DOTE dictionary entry applies to the **required begin date (RBD) calculation**, not to PA_AMB. Do **not** treat "DOPT used when DOTE is NULL" as establishing that a blank-DOTE PA_AMB is measured at DOPT. That inference is not in the dictionary.

### M-02 — Only a recorded/filed date is known; measurement date unstated

- **Source:** APP (MASTER_PROMPT §5: recorded date vs measurement date).
- **Fields examined:** APP.recordedDate, APP.measurementDate, PA_AMB.
- **Predicate:** The PA schedule or census gives only a recorded/filed date, with no statement of the date through which the benefit was calculated. Formal: `APP.measurementDate IS NULL ∧ APP.recordedDate IS NOT NULL ⇒ fail`. (If both are NULL, M-02 fires as well — the measurement date is unknown — and M-01/P-04 may also fire; all findings are recorded.)
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: dates as stated in the source, source location. Expected: measurement date and recorded date stored as separate fields; a recorded date is never used as a measurement date.
- **Investigation:** Read the schedule's heading / as-of language; if the schedule states no as-of date, the basis is unresolved — do not infer it from the file date or the valuation date.
- **Disposition route:** `requires-investigation` (obtain the as-of statement) or `indeterminate`; no Δ is computed (§7.1).

### M-03 — Established measurement date disagrees with census DOTE

- **Source:** APP (MASTER_PROMPT §5).
- **Fields examined:** APP.measurementDate, DOTE, APP.dopt.
- **Predicate:** The established measurement date disagrees with census DOTE (e.g. schedule says "as of 12/31/2019" but DOTE is 06/15/2019), and the disagreement is not documented with a reason. Formal: `APP.measurementDate IS NOT NULL ∧ APP.measurementDate ≠ DOTE ∧ ¬disagreementExplained ⇒ fail`. A documented reason (e.g. benefit calculated through a later payroll date) is a pass, with the reason recorded on the observation.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: both dates, source locations. Expected: measurement date = DOTE, or the disagreement is documented with the reason.
- **Investigation:** Determine which date the PA actually used (schedule arithmetic, salary-through date); the comparison must use the PA's date, not the census date, and the independent calculation must be run at the same date (rule M-05).
- **Disposition route:** None; the comparison is computed at the PA's date once established. If the PA's date cannot be established, the basis becomes unresolved (M-02) and §7.1 applies.

### M-04 — PA_AMB asserted to be "as of NRD" without evidence

- **Source:** APP (Stage 1 §0.3; dictionary PA_AMB definition).
- **Fields examined:** PA_AMB, NRD, DOTE, APP.measurementBasis.
- **Predicate:** A source (or a user) asserts PA_AMB is "as of NRD" or "at NRD", and no documentary evidence supports the claim. Formal: `assertedBasis(PA_AMB) = nrd ∧ ¬documentaryEvidence ⇒ fail`. If evidence exists (schedule statement or PA letter) and is accepted, the basis is recorded as `other-stated` with the evidence linked — never silently re-based — and this rule passes.
- **Severity:** Error. **Blocks:** Exact-only (until resolved). **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: the NRD-basis claim, its source. Expected: PA_AMB basis is DOTE per the dictionary; an NRD-basis claim requires documentary evidence and, if accepted, the basis is recorded as `other-stated` with the evidence linked.
- **Investigation:** Obtain the evidence; without it the claim is rejected and the basis stays DOTE (or unresolved if DOTE is blank). Note the related confusion: NRD is the date the *termination* benefit is often expressed at (TERM_MB_NRD_NSF), which is a different quantity from PA_AMB.
- **Disposition route:** `requires-investigation` until the claim is evidenced or rejected; no Δ is computed on an NRD basis without the evidence and a basis conversion (M-05).

### M-05 — Observation and calculation bases are not equivalent (comparison gate)

- **Source:** APP (MASTER_PROMPT §3 typed benefit; §10 comparison validity).
- **Fields examined:** APP.measurementDate (observation), APP.measurementDate (calculation), APP.annuityForm, APP.vestingTreatment.
- **Predicate:** The BenefitObservation and the BenefitCalculation have different measurement dates, annuity forms, or vesting treatments. Formal: `(measDate(obs) ≠ measDate(calc)) ∨ (form(obs) ≠ form(calc)) ∨ (vestingTreatment(obs) ≠ vestingTreatment(calc)) ⇒ fail`. Either side NULL/unknown also fails the equivalence (unknown ≠ known).
- **Severity:** Critical. **Blocks:** Yes. **Blocking scope:** `comparison` (the comparison only; the calculation itself may proceed).
- **Discrepancy (actual vs expected):** Actual: both bases, side by side. Expected: bases equivalent before any comparison; otherwise the comparison is stored with `comparisonBasis = unresolved` and is not comparable.
- **Investigation:** Convert (re-run the calculation at the observation's date/form) or hold the comparison. **A comparison across unequal bases is never computed as if it were valid.**
- **Disposition route:** No Δ is computed (§7.1). The participant is routed to `requires-investigation` (if a conversion can be run) or `indeterminate`. The independent calculation at its own basis is retained and reported as such.

### M-06 — More than one candidate measurement date exists

- **Source:** APP (MASTER_PROMPT §5: multiple candidate dates).
- **Fields examined:** DOTE, POST_DOPT_DOTE, DOBF, APP.dopt.
- **Predicate:** More than one candidate measurement date exists (e.g. DOTE and POST_DOPT_DOTE for an ongoing plan; DOBF before DOTE for a frozen plan) and no single date is established with evidence. Formal: `count(candidateDates) > 1 ∧ ¬establishedDate ⇒ fail`. Once one date is established with evidence, this rule passes and the rejected candidates are recorded with the reason they were rejected.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: all candidate dates, evidence for each. Expected: one measurement date is established with evidence, and the rejected candidates are recorded with the reason they were rejected.
- **Investigation:** Working-retirement / post-DOPT employment cases need the plan's rule on post-DOPT accrual; frozen plans need the freeze-date rule. Record the decision; do not average candidate dates.
- **Disposition route:** None by itself; but if no date can be established, the basis is unresolved and §7.1 applies (no Δ; `Verified` unreachable). Bounds may be produced as one scenario per candidate date, each labelled.

## 8. Layer 5 — Longitudinal validation (L-01–L-08)

Longitudinal rules reconcile records across valuation dates and participant statuses, distinguishing legitimate changes from inconsistencies (MASTER_PROMPT §7; Answer Book Ch. 16 Q 16:2 — each year the data should be reconciled: new participants, terminations, deaths, disabilities, retirees, end-of-period actives; terminated-vested, disabled, and retired counts also reconciled).

**Applicability condition for the whole layer:** every L rule requires at least one prior extract (a prior census snapshot or prior valuation population, each a separate CalculationRun snapshot with its own as-of date and source — Stage 1 §A.1). With no prior extract, every L rule records `not-applicable` with the reason "no prior extract in the case file". A `not-applicable` here is not a pass: the population reconciliation has not been performed, and the plan-level report must say so.

### L-01 — Population does not reconcile between extracts

- **Source:** APP (Answer Book Ch. 16 Q 16:2 population reconciliation).
- **Fields examined:** (counts by RETSTAT, current extract vs prior extract).
- **Predicate:** Current census counts do not reconcile to the prior extract: opening actives + new participants − terminations − deaths − disabilities − retirees ≠ closing actives, and the difference is unexplained. Formal: `closingActives ≠ openingActives + new − terminations − deaths − disabilities − retirees ∧ ¬movementsExplained ⇒ fail`. Scope is the population, not one participant (`participantKey` is NULL on this finding).
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation` (affected participants — those in the unexplained difference, once identified; the population as a whole is flagged).
- **Discrepancy (actual vs expected):** Actual: counts by status, both extracts, the unexplained difference. Expected: full reconciliation with every movement accounted for.
- **Investigation:** Obtain the missing movement records (new hires, deaths, retirements) from plan records; an unreconciled population means participants may be missing from the PA_AMB analysis entirely.
- **Disposition route:** Affected participants → `requires-investigation` until the movement is accounted for; the population reconciliation gap is reported at plan level.

### L-02 — Participant disappears or duplicates across extracts

- **Source:** APP (Answer Book Ch. 16 Q 16:2; Stage 1 §B.2 P-01/P-16).
- **Fields examined:** SSN, DOB, APP.participantKey.
- **Predicate:** A participant appears in one extract but not the next with no movement record; OR appears twice across extracts with different keys. Formal: `(present(extractₙ) ∧ ¬present(extractₙ₊₁) ∧ ¬movementRecord) ∨ (∃ key₂ ≠ key₁ across extracts : samePerson) ⇒ fail`.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: participantKey, extracts involved. Expected: every disappearance has a movement (termination, death, retirement, exclusion with reason); identity is stable across extracts.
- **Investigation:** Trace the participant through plan records; a disappearance without a movement is usually a data error, not a real exit.
- **Disposition route:** None; review before acceptance. (If the disappearance means the participant is missing from the current population, L-01 also fires at population level.)

### L-03 — Status moves backwards without explanation

- **Source:** APP (MASTER_PROMPT §7 longitudinal).
- **Fields examined:** RETSTAT (across extracts).
- **Predicate:** Status moves backwards without explanation (e.g. Retired → Active Vested; Separated Vested → Active). Formal: `transition ∈ {retired→active, retired→separated, separated→active} ∧ ¬explanationDocumented ⇒ fail`. Permitted transitions (active → separated/retired/deceased; separated → retired/deceased) are passes.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: statuses by extract, dates. Expected: status transitions follow the plan's rules.
- **Investigation:** Verify against employment/payment records; a backwards move is usually a status-correction (record it as a correction with evidence) or a misclassification.
- **Disposition route:** None; review before acceptance.

### L-04 — DOTE or DOH changes between extracts without a documented correction

- **Source:** APP (MASTER_PROMPT §7 longitudinal).
- **Fields examined:** DOTE, DOH (across extracts).
- **Predicate:** DOTE or DOH changes between extracts for the same participant with no documented correction. Formal: `value(extractₙ₊₁) ≠ value(extractₙ) ∧ ¬revisionEvent ⇒ fail`. A change recorded as a revision event with evidence is a pass (the revision is auditable, not silent).
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: old and new values, extracts. Expected: historical dates are stable; a change is a revision event with evidence, never a silent edit.
- **Investigation:** Check for a rehire (new period — see EmploymentPeriod) vs a data correction; a changed DOTE changes the measurement date and therefore the comparison basis (rule M-03).
- **Disposition route:** None; but the comparison basis must be re-established under M-03 before any comparison that depends on the changed date.

### L-05 — Salary history changes between extracts (restated pay)

- **Source:** APP (MASTER_PROMPT §7 longitudinal).
- **Fields examined:** S001–S050, LASTYEAR (across extracts).
- **Predicate:** Salary history changes between extracts for the same year (restated pay), or the salary span shifts without a new year passing. Formal: `∃ year y : S(y, extractₙ₊₁) ≠ S(y, extractₙ) ∧ ¬revisionEvent ∨ spanShiftWithoutNewYear ⇒ fail`.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: year, old/new values, extracts. Expected: historical salary years are stable; restatements are revision events with the reason recorded.
- **Investigation:** Determine whether the restatement is a payroll correction (accept with evidence) or an error; restated pay changes PA_ACOMP and the reconstructed benefit.
- **Disposition route:** None; the affected calculation must be re-run on the corrected history before any acceptance disposition.

### L-06 — PA_AMB changes between extracts without an explaining event

- **Source:** APP (MASTER_PROMPT §7 longitudinal).
- **Fields examined:** PA_AMB (across extracts).
- **Predicate:** PA_AMB for the same participant changes between extracts with no amendment, correction, or measurement-date change. Formal: `PA_AMB(extractₙ₊₁) ≠ PA_AMB(extractₙ) ∧ ¬(amendment ∨ correction ∨ measurementDateChange) ⇒ fail`.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: old/new PA_AMB, extracts, events between them. Expected: PA_AMB is stable across extracts unless a documented event explains the change.
- **Investigation:** Check for a plan amendment, a PA correction letter, or a measurement-date change; an unexplained change is itself a diagnostic hypothesis (administrator-error).
- **Disposition route:** None; review before acceptance. The newer value is not automatically the right one — the PA's standing behind each version must be established (cf. C-02).

### L-07 — Service decreases, or grows faster than elapsed time

- **Source:** APP (MASTER_PROMPT §7 longitudinal).
- **Fields examined:** CSPA, VS (across extracts).
- **Predicate:** Credited or vesting service decreases between extracts, or increases by more than the elapsed time between extracts (plus documented credits). Formal: `service(extractₙ₊₁) < service(extractₙ) ∨ service(extractₙ₊₁) − service(extractₙ) > elapsed(extractₙ, extractₙ₊₁) + creditsAllowed ⇒ fail`.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: service values by extract, elapsed time. Expected: service is non-decreasing and grows by at most the elapsed time (plus documented credits).
- **Investigation:** Verify against EmploymentPeriod; a service decrease usually means a break-in-service rule was applied (Answer Book Ch. 7) or a prior error was corrected — either way it must be documented.
- **Disposition route:** None; review before acceptance.

### L-08 — High-impact date (DOB, DOH, DOTE) differs between extracts

- **Source:** APP (MASTER_PROMPT §7 longitudinal; Answer Book Ch. 16 Q 16:2 materiality).
- **Fields examined:** DOB, DOH, DOTE (across extracts).
- **Predicate:** A high-impact date (DOB, DOH, or DOTE) differs between extracts. Formal: `∃ field ∈ {DOB, DOH, DOTE} : value(extractₙ₊₁) ≠ value(extractₙ) ⇒ fail`. (Unlike L-04, this rule fires even when a revision event exists — the change itself is the finding, because of its impact; the revision event is the investigation, not a pass. L-04 and L-08 may both fire on the same change; both findings are recorded.)
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: old/new values, extracts. Expected: stable; any change is a revision event. (Ch. 16 Q 16:5: dates of birth, dates of employment, and compensation histories matter most and are reviewed in greatest detail.)
- **Investigation:** Verify against the earliest source (enrollment/employment records); a changed DOB changes age, NRD, service, and the benefit — it is the single most consequential longitudinal finding.
- **Disposition route:** Bounds/scenario path — the benefit may be computed under each date value as scenarios until the correct date is established; otherwise `requires-investigation`.

## 9. Layer 6 — Cross-source validation (C-01–C-10)

Cross-source rules reconcile census data with prior valuation reports, historical benefit schedules, payment records, and the other generators' outputs for the same case. For each rule, **what counts as a match vs a discrepancy** is stated explicitly — a match is never assumed from a missing counterpart.

### C-01 — Census PA_AMB has no matching PA schedule row

- **Source:** APP (Stage 1 §A.2.9; MASTER_PROMPT §7 cross-source).
- **Fields examined:** PA_AMB, APP.sourceScheduleRow.
- **Predicate:** PA_AMB in the census has no matching row in the PA benefit schedule, or no schedule was provided. Formal: `PA_AMB IS NOT NULL ∧ ¬matchingScheduleRow(participant) ⇒ fail`.
- **Match vs discrepancy:** **Match** = a schedule row exists for the participant and its amount is the census amount (equality is checked by C-02, not here). **Discrepancy** = no row exists. Two cases, different severities: (a) **no schedule was provided at all** ⇒ Warning (the census is still evidence, but weaker); (b) **a schedule exists but lacks the participant** ⇒ Error (the census value is unsupported).
- **Severity:** Error (schedule exists, participant missing); Warning (no schedule at all). **Blocks:** Exact-only (Error case); No (Warning case). **Blocking scope:** `exact-calculation` / `none`.
- **Discrepancy (actual vs expected):** Actual: participantKey, PA_AMB, schedule searched. Expected: every census PA_AMB traces to a schedule row/cell/page.
- **Investigation:** Obtain the schedule; without it the measurement basis can only be DOTE-by-definition, never evidenced.
- **Disposition route:** Error case → bounds/scenario path if the amount can be evidenced another way (class b); otherwise `requires-investigation`. Warning case → calculation proceeds; review before acceptance; `Verified` requires the basis to be evidenced, so a no-schedule record can at best be `Supported for acceptance` on other evidence.

### C-02 — Census PA_AMB ≠ schedule PA_AMB

- **Source:** APP (MASTER_PROMPT §7 cross-source).
- **Fields examined:** PA_AMB (census) vs PA_AMB (schedule).
- **Predicate:** Census PA_AMB ≠ schedule PA_AMB for the same participant, and the difference is not explained (different as-of date, different schedule version). Formal: `PA_AMB(census) ≠ PA_AMB(schedule) ∧ ¬explanationDocumented ⇒ fail`.
- **Match vs discrepancy:** **Match** = the two values are equal (exact decimal equality; no tolerance is applied to a transcription comparison — a difference of one cent is a discrepancy to be explained, though its materiality is judged at the comparison stage). **Discrepancy** = any inequality without a documented explanation. A documented explanation (later schedule version, different as-of date) is a pass, with the explanation and the governing value recorded.
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `exact-calculation`.
- **Discrepancy (actual vs expected):** Actual: both values, both sources, dates. Expected: equal, or the difference is explained.
- **Investigation:** Determine which is later / which the PA stands behind; the schedule usually governs (it is the PA's own arithmetic) — record the decision and the reason.
- **Disposition route:** Bounds/scenario path — the benefit may be evaluated against each value as scenarios until the governing value is established; otherwise `requires-investigation`.

### C-03 — PA_AMB compared to a different-basis BCV benefit without conversion

- **Source:** APP rule; OFFICIAL (reference only) — official predicates 228–237, 306–319 as reference data (see §0.2).
- **Fields examined:** PA_AMB vs XRD_MB_TERM, TERM_MB_ERD_NSF, TERM_MB_EURD_NSF, TERM_MB_NRD_NSF, AMB.
- **Predicate:** PA_AMB is compared directly to a BCV-calculated benefit at a different date/form (XRD, ERD, EURD, NRD) with no basis conversion. Formal: `compared(PA_AMB, bcvBenefit) ∧ basis(bcvBenefit) ≠ basis(PA_AMB) ∧ ¬conversionApplied ⇒ fail`. This rule fires on the **comparison**, not on the data: the underlying values may be entirely correct.
- **Match vs discrepancy:** **Match** = a BCV-calculated benefit is used as a cross-check only after conversion to the PA_AMB basis (DOTE, same form, same vesting treatment), and the converted values are then compared under the case tolerance. **Discrepancy** = a raw comparison with no conversion. AMB (at DOTE, Calculated) is the closest comparator and still differs by construction (BCV's calculation vs the PA's) — agreement or disagreement with AMB is evidence, not a verdict. **A raw PA_AMB-vs-TERM_MB_NRD_NSF difference is not a discrepancy — it is a category error.**
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: values compared, bases of each. Expected: BCV-calculated benefits are used only as cross-checks after conversion to the PA_AMB basis.
- **Investigation:** Convert bases first (rule M-05) or do not compare.
- **Disposition route:** None; the invalid comparison is discarded (not stored as a BenefitComparison), and a valid one is produced if conversion is possible.

### C-04 — Payment amount inconsistent with PA_AMB after ARD conversion

- **Source:** APP (MASTER_PROMPT §7 cross-source: payment records).
- **Fields examined:** PA_AMB, PAY_AMT1, PAY_AMT2, DOR, LEV_MB_ARD.
- **Predicate:** Participant in pay (RETSTAT = 1, DOR populated) whose payment amount (PAY_AMT1/2 or LEV_MB_ARD) is inconsistent with PA_AMB after applying the ARD factors (ERF_ARD, BFCF_ARD, ME_ARD, FORM_CODE_ARD) — i.e. the difference exceeds the case tolerance. Formal: `RETSTAT = 1 ∧ DOR IS NOT NULL ∧ |payment − convert(PA_AMB, ARD factors)| > param:caseTolerance ⇒ fail`. **Conditional:** without the ARD factors or without `param:caseTolerance`, the rule is `not-applicable` for that participant.
- **Match vs discrepancy:** **Match** = payment = PA_AMB converted to the ARD form/date within the case tolerance. **Discrepancy** = the converted payment differs by more than the tolerance, with no documented explanation.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: PA_AMB, payment amounts, ARD factors. Expected: payment = PA_AMB converted to the ARD form/date within tolerance, or the difference is explained.
- **Investigation:** Reconstruct the ARD conversion from the PA's own factors (BCV3 fields); a mismatch points to a different commencement date or form than the one recorded.
- **Disposition route:** None; review before acceptance.

### C-05 — Prior distribution not reflected in PA_AMB

- **Source:** APP (MASTER_PROMPT §7 cross-source: prior distributions).
- **Fields examined:** PA_AMB, LS_EST_AMT, PARTIAL_DIST_AMT, MANDCWI.
- **Predicate:** A prior lump-sum or partial distribution exists but PA_AMB shows no offset/reduction for it; OR a distribution is recorded in one source but not the other. Formal: `(distributionExists ∧ ¬reflectedIn(PA_AMB) ∧ ¬documentedAsNotAffecting) ∨ (distributionIn(source₁) ∧ ¬distributionIn(source₂)) ⇒ fail`.
- **Match vs discrepancy:** **Match** = distributions are reflected in the accrued benefit, or explicitly documented as not affecting it (e.g. distribution of employee contributions only). **Discrepancy** = an unreflected distribution, or a distribution present in one source and absent in another, with no explanation.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: distribution amounts/dates, PA_AMB. Expected: distributions are reflected in the accrued benefit or explicitly documented as not affecting it.
- **Investigation:** Answer Book Ch. 16 Q 16:7 — past distributions are essential takeover data, especially for rehires. Obtain the distribution record; an unreflected distribution is a diagnostic hypothesis (distribution).
- **Disposition route:** None; review before acceptance.

### C-06 — PA_AMB cannot be produced by any governing formula version

- **Source:** APP (MASTER_PROMPT §7 cross-source: plan provisions).
- **Fields examined:** PA_AMB, APP.formulaId, APP.planVersionId.
- **Predicate:** PA_AMB cannot be produced by any governing formula version for the participant's group and era — i.e. no applicable formula version produces a benefit in the neighbourhood of PA_AMB (within the case tolerance), and no documented hypothesis explains the difference. Formal: `¬∃ formulaVersion ∈ applicable(group, era) : |formulaVersion(inputs) − PA_AMB| ≤ param:caseTolerance ∧ ¬documentedHypothesis ⇒ fail`. **Conditional:** without `param:caseTolerance` or without an identified governing formula version, the rule is `not-applicable` (an unidentified formula is a completeness failure — grade Insufficient — not a C-06 firing).
- **Match vs discrepancy:** **Match** = at least one applicable formula version produces a benefit within the case tolerance of PA_AMB, or the difference is explained by a documented hypothesis. **Discrepancy** = no applicable version comes within tolerance and no hypothesis explains the gap.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: PA_AMB, applicable formulas, computed values. Expected: at least one applicable formula version produces a benefit in the neighbourhood of PA_AMB (within the case tolerance, or explainable by a documented hypothesis).
- **Investigation:** Check whether the wrong PlanVersion was applied (a later formula applied retroactively — MASTER_PROMPT §5 forbids this), whether the participant belongs to a different employment group, or whether a grandfathered floor applies.
- **Disposition route:** None; review before acceptance. A C-06 firing is a prompt to investigate the formula assignment, not evidence that PA_AMB is wrong.

### C-07 — PA's ARD conversion factors disagree with the PF generator's factors

- **Source:** APP (MASTER_PROMPT §7 cross-source: PF factors).
- **Fields examined:** PA_AMB, ERF_ARD, BFCF_ARD, APP.factorSets.
- **Predicate:** The PA's ARD conversion factors (ERF_ARD, BFCF_ARD) disagree with the PF generator's factors for the same era/form. Formal: `factor(PA, era, form) ≠ factor(PF, era, form) ∧ ¬differenceDocumented ⇒ fail`. **Conditional:** without PF output for the case, the rule is `not-applicable`.
- **Match vs discrepancy:** **Match** = agreement, or a documented difference (different mortality/interest basis, different era). **Discrepancy** = an unexplained factor disagreement for the same era/form.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: factors from each source, era, form. Expected: agreement, or the difference is documented.
- **Investigation:** Compare against the PF output for the case; factor disagreements are usually era mismatches (factors from the wrong historical regime).
- **Disposition route:** None; review before acceptance.

### C-08 — Correction proposed on a numerical difference alone (no evidence)

- **Source:** APP (Stage 1 §B.0.1: "reasonably certain" standard from Policy 5.8-1).
- **Fields examined:** PA_AMB, APP.calculatedMonthlyBenefit, APP.evidence.
- **Predicate:** A correction is proposed (disposition `correction-recommended` is being entered) on a numerical difference alone, with no documentary evidence of an error. Formal: `proposedDisposition = correction-recommended ∧ evidenceList = ∅ ⇒ fail`. Evidence means a documented cause: wrong service, wrong averaging period, wrong formula version, schedule arithmetic, plan provision, or service record — not the difference itself.
- **Severity:** Error. **Blocks:** Exact-only. **Blocking scope:** `decision` (the correction disposition is blocked, not the data or the calculation).
- **Discrepancy (actual vs expected):** Actual: proposed correction, evidence list. Expected: `correction-recommended` requires the reviewer to be reasonably certain an error occurred — a difference plus a documented cause, not a difference alone.
- **Investigation:** Gather the evidence (schedule arithmetic, plan provision, service record). Without it the disposition is `requires-investigation`, never `correction-recommended`. Numerical agreement is likewise not proof of correctness if the provisions used were wrong (MASTER_PROMPT §14).
- **Disposition route:** The correction disposition is refused at entry; the participant routes to `requires-investigation` until evidence exists. (This is a disposition-scope Error: `blocksCalculation = Exact-only` is the Stage 1 value, preserved; the scope line clarifies that what is blocked is the correction disposition. See §3.2.)

### C-09 — PA_AMB_ACCEPT set without, or inconsistent with, a decision

- **Source:** APP (Stage 1 §A.2.14: PA_AMB_ACCEPT).
- **Fields examined:** PA_AMB_ACCEPT, APP.disposition.
- **Predicate:** PA_AMB_ACCEPT = Y with no ActuarialDecision on file; OR PA_AMB_ACCEPT = Y while the participant's disposition is `requires-investigation` / `indeterminate`; OR PA_AMB_ACCEPT = N with disposition `verified`. Formal: `(PA_AMB_ACCEPT = 'Y' ∧ ¬∃ decision) ∨ (PA_AMB_ACCEPT = 'Y' ∧ disposition ∈ {requires-investigation, indeterminate}) ∨ (PA_AMB_ACCEPT = 'N' ∧ disposition = verified) ⇒ fail`. Consistency rule: Y ⟺ `verified` / `supported-for-acceptance`; N ⟺ `correction-recommended` / `indeterminate`-with-rejection — per the reviewer's rationale (the N leg for `indeterminate` requires the rationale to state a rejection; an `indeterminate` without a rejection rationale leaves PA_AMB_ACCEPT blank, not N).
- **Severity:** Critical. **Blocks:** Yes. **Blocking scope:** `decision` (the decision record is blocked/refused; calculation and comparison may proceed).
- **Discrepancy (actual vs expected):** Actual: PA_AMB_ACCEPT value, disposition, decision record. Expected: PA_AMB_ACCEPT is set only by a recorded human decision, and is consistent with it.
- **Investigation:** The accept flag is an outcome, not an input. Remove or correct it through a decision record; never edit the flag directly.
- **Disposition route:** The decision record is refused until a consistent human decision exists. This rule is evaluated at decision-entry time (not only at import): a flag set upstream in the census is checked when the record is first loaded and again whenever a disposition is entered.

### C-10 — Source used in a decision while its reliability grade is unassessed or low

- **Source:** APP (CASE_PROCESSING.txt: internal-controls review).
- **Fields examined:** APP.reliabilityGrade (SourceDocument).
- **Predicate:** A source document is used in a calculation or a decision while its reliability grade is `unassessed` or `low`, with no note of the limitation. Formal: `usedIn(document, calculation ∨ decision) ∧ grade(document) ∈ {unassessed, low} ∧ ¬limitationNoted ⇒ fail`.
- **Severity:** Warning. **Blocks:** No. **Blocking scope:** `none`.
- **Discrepancy (actual vs expected):** Actual: document, grade, where it was used. Expected: every source used in a decision carries a reliability grade; `low` sources are corroborated by a second source or the limitation is stated in the decision.
- **Investigation:** Assess internal controls per CASE_PROCESSING.txt (review the PA's and service providers' controls to judge the reliability of electronic and hard-copy records). A low-reliability source does not invalidate the analysis — it caps the disposition (Stage 1 §A.7: an uncorroborated low-reliability PA_AMB cannot be `verified`).
- **Disposition route:** None; the disposition cap applies at decision entry (a `verified` disposition on an uncorroborated low-reliability source is refused, with this finding cited).

## 10. Known conflicts (flagged, not silently resolved)

### 10.1 Conflict C-1 — BCV predicates 224 vs 225 (DOTE vs DOPT)

- **What each side says (as written in `BCV-DataValidation-predicates.xlsx`):**
  - **BCV-224:** fires when DOTE is on/after DOPT. (Rule P-04 sub-condition; Error; type 3.)
  - **BCV-225:** fires when DOTE is before DOPT. (Rule P-04 sub-condition; Error; type 3.)
- **Why they conflict:** the two predicates cannot both be errors for the same record — every DOTE is either before DOPT or on/after it (or NULL, which is BCV-221). Taken literally together, every populated DOTE fails one of them.
- **What this catalog does:** preserves both, verbatim, under rule P-04, with the conflict flagged on the rule and here. It does **not** silently pick one, drop one, or reinterpret either.
- **What must happen before implementation:** Stage 2 must determine which predicate applies by RETSTAT/population (Stage 1 §B.9 C-1): e.g. whether 224 applies to one population (separated participants whose DOTE should precede DOPT) and 225 to another, or whether one predicate's SQL in the workbook in fact tests something narrower than its description suggests (the predicate SQL was not individually reviewed in Stage 1 — only sampled rows were read in full). The workbook SQL for 224 and 225 must be read before either is implemented. Until that determination is made, an implementation must record both sub-conditions as `not-applicable` with reason "conflict C-1 unresolved" when they would otherwise both fire (see P-04). Recorded as open decision OD-02 (§11).

### 10.2 Conflict C-2 — BCV-276 disabled, but credited service is required

- **What each side says:**
  - **BCV-276** ("credited service not populated") is `ENABLE_FL = N` — disabled in the predicates workbook. The workbook therefore does not enforce it.
  - **Reconstruction requires credited service:** an exact reconstruction cannot proceed without CS (or its PA counterpart CSPA). Stage 1 §0.5: where a disabled predicate covers a real check, the spec re-states it as an APP rule with the reason noted.
- **What this catalog does:** re-states the CS-blank check as an APP sub-condition of rule P-06 (labelled APP, BCV ID preserved for traceability), with severity Error and blocking Exact-only. It is **not** presented as an official predicate, and P-06's source label is MIXED for exactly this reason (§0.2).
- **What must happen before implementation:** nothing further is needed to implement the APP restatement. What remains open is *why* BCV disabled 276 — whether the BCV load tolerates a blank CS in some population (e.g. records where service is derived elsewhere) — and whether that reason narrows the APP restatement. Recorded as open decision OD-06 (§11). The APP restatement stands until evidence narrows it; a disabled official predicate is never silently re-enabled as official.

### 10.3 Tension (not a conflict) — Policy 5.8-1 tolerances vs the reconciliation tolerance

Recorded here so it is not mistaken for a conflict: Policy 5.8-1 ($1.00/$5.00) governs correcting PBGC benefit determinations and payments; the PA_AMB reconciliation tolerance is a case-level, documented, human-set parameter (M-7). They govern different decisions. The catalog treats them as separate fields and never conflates them (§1.6). No resolution is needed; the distinction is enforced by the parameter table.

## 11. Worked synthetic examples

All participants below are **fictional**. Names, SSNs, dates, and amounts are invented for illustration. No live case data, no participant-level census rows. Each example shows the rules firing and the resulting validation records (one record per firing sub-condition; `pass` outcomes are summarised, not listed as records).

Conventions for the examples: case tolerance `param:caseTolerance` = $2.00/month (case record M-7, authority: case actuary, recorded for illustration only — not a PBGC rule); `param:serviceTolerance` = 0; DOPT (`APP.dopt`) = 2021-06-30 for both examples. Dispositions follow §3.4.

### Example 1 — SYN-001: zero credited service with a positive PA_AMB; CS blank

**Fictional participant SYN-001.** RETSTAT = 2 (Separated Vested). DOB 1962-03-14. DOH 1990-05-01. DOTE 2019-06-15. PA_AMB = $1,240.00 (census, traced to PA schedule row 14). CSPA = 0. CS blank (BCV calculation did not populate it). VSPA = 12.5, VS = 12.5. PA_ACOMP = $4,100.00. DOTE is populated, so the measurement basis is DOTE (established by definition; the PA schedule states "amounts calculated through date of termination").

**Rules evaluated (abridged — only firings and the decisive passes are shown):**

| Rule | Outcome | Why |
|---|---|---|
| S-04, S-05, S-06 | pass | RETSTAT, ID, CASE valid |
| P-02, P-03, P-04 | pass | DOB, DOH, DOTE chronologically consistent; DOTE < DOPT |
| P-06 (BCV-276, APP restatement) | **fail — Error, Exact-only** | CS blank. Expected: populated, in years. |
| P-06 (BCV-279–281, 420) | pass | VS = 12.5, in range, non-zero |
| P-13 | pass | PA_AMB populated |
| X-05 | **fail — Error, Exact-only** | CSPA = 0 with PA_AMB = $1,240.00 > 0, and no minimum-benefit, grandfathered-benefit, or past-service-credit provision is documented |
| X-07 | **fail — Warning** | \|CSPA − CS\| cannot be evaluated (CS blank) — recorded as `not-applicable` for the CSPA/CS pair, not as a pass; \|VSPA − VS\| = 0, pass |
| X-09 | pass | Vesting treatment established from the schedule (PA_AMB is gross); participant is vested (VSPA 12.5) |
| M-01–M-06 | pass | Measurement basis established (DOTE, evidenced by the schedule) |
| C-01, C-02 | pass | Schedule row 14 exists; census and schedule amounts are equal |

**Resulting validation records (the two Error findings):**

| Field | Record 1 | Record 2 |
|---|---|---|
| `ruleId` | P-06 | X-05 |
| `bcvPredicateId` | BCV-276 | null |
| `ruleSource` | MIXED (this sub-condition: APP — disabled-predicate restatement) | APP |
| `fieldsExamined` | CS | PA_AMB, CSPA |
| `actual` | CS blank | CSPA = 0; PA_AMB = $1,240.00 |
| `expected` | CS populated, in years, 0–83.25 | Zero credited service → zero formula benefit, unless a documented minimum benefit, grandfathered benefit, or past-service credit applies |
| `severity` | Error | Error |
| `discrepancy` | Credited service not populated; reconstruction cannot proceed without it | Positive administrator benefit with zero credited service and no documented floor/credit |
| `investigation` | Compare with CSPA/VSPA (X-07); verify service against EmploymentPeriod and plan records | Check for a minimum-benefit provision, grandfathered floor, or past-service credit in the plan document |
| `blocksCalculation` | Exact-only | Exact-only |
| `blocksScope` | exact-calculation | exact-calculation |
| `dispositionRoute` | Bounds/scenario path if service recoverable (class b) or bounded (class c); otherwise requires-investigation | Bounds/scenario path if a documented floor/credit is found; otherwise requires-investigation |

**Routing:** exact reconstruction is blocked (two Error findings). The participant is Partial at best. The system attempts the bounds/scenario path: if CSPA = 0 is confirmed and no floor/credit exists, the justified bound is Bᵢ^min = Bᵢ^max = $0 under the plan formula — which would make PA_AMB = $1,240.00 unsupported on its face (a diagnostic hypothesis of type "service" for the reconciliation engine; the correction itself would still need documentary evidence under C-08). If instead a minimum-benefit provision is found, the comparison runs against the floor. Reachable dispositions while the errors stand: `Supported for acceptance` / `Requires investigation` / `Correction recommended` (only with evidence) — `Verified` is unreachable because the record is not Complete. No Δ is computed until an exact or bounded B̂ exists.

### Example 2 — SYN-002: PA_AMB populated, DOTE blank — unresolved basis, no Δ

**Fictional participant SYN-002.** RETSTAT = 2 (Separated Vested). DOB 1958-11-02. DOH 1985-09-08. DOTE blank in the census. PA_AMB = $860.50 (census; no PA schedule was provided for this case). CSPA = 18.25, CS = 18.25. The census gives only a file date (2021-03-15) for the PA extract, with no as-of statement.

**Rules evaluated:**

| Rule | Outcome | Why |
|---|---|---|
| S-04, S-05 | pass | RETSTAT, ID valid |
| P-04 (BCV-221) | **fail — Error, Exact-only** | DOTE blank |
| P-04 (BCV-224/225) | not-applicable | Conflict C-1 unresolved; DOTE is blank so neither predicate's condition can be evaluated in any case |
| M-01 | **fail — Error, Exact-only** | PA_AMB populated, DOTE blank, RETSTAT = 2 → measurement basis unresolved |
| M-02 | **fail — Error, Exact-only** | Only a recorded/filed date (2021-03-15) is known; no statement of the date through which the benefit was calculated |
| M-05 | **fail — Critical, blocks comparison** | The observation has no measurement date; the calculation cannot be shown to share its basis. `comparisonBasis = unresolved`; no Δ is computed |
| C-01 | **fail — Warning** | No PA schedule was provided at all (the census is still evidence, but weaker) |
| X-07 | pass | \|CSPA − CS\| = 0 |
| P-06, P-13 | pass | CS populated; PA_AMB populated |

**Resulting validation records (abridged — the three decisive findings):**

| Field | Record 1 (M-01) | Record 2 (M-02) | Record 3 (M-05) |
|---|---|---|---|
| `ruleId` | M-01 | M-02 | M-05 |
| `ruleSource` | APP | APP | APP |
| `fieldsExamined` | DOTE, PA_AMB, RETSTAT | APP.recordedDate, APP.measurementDate, PA_AMB | APP.measurementDate (observation), APP.measurementDate (calculation), APP.annuityForm, APP.vestingTreatment |
| `actual` | DOTE blank; RETSTAT = 2; PA_AMB = $860.50 | Recorded/filed date 2021-03-15 only; no as-of statement | Observation basis: unresolved (no measurement date); calculation basis: DOTE (assumed for the independent run) |
| `expected` | DOTE populated for RETSTAT 1, 2, 4 | Measurement date and recorded date stored as separate fields; a recorded date is never used as a measurement date | Bases equivalent before any comparison |
| `severity` | Error | Error | Critical |
| `discrepancy` | PA_AMB with no measurement date anchor | Benefit amount with no established date through which it was calculated | Bases not equivalent; comparison not comparable |
| `investigation` | Obtain DOTE from employment records (class b) or the PA schedule's as-of statement | Read the schedule's heading / as-of language; do not infer the basis from the file date or the valuation date | Convert (re-run the calculation at the observation's date) or hold the comparison |
| `blocksCalculation` | Exact-only | Exact-only | Yes |
| `blocksScope` | exact-calculation | exact-calculation | comparison |
| `dispositionRoute` | Requires-investigation (obtain DOTE / as-of statement) or indeterminate | Requires-investigation or indeterminate | No Δ computed; requires-investigation or indeterminate |

**Routing:** the measurement basis is unresolved (§7.1). **No Δ is computed** — not $860.50 minus anything. The independent calculation may still be run at DOTE as a scenario, but it is not compared to PA_AMB. Disposition `Verified` is unreachable; reachable dispositions are `Requires investigation` (obtain DOTE from employment records or the as-of statement from the PA) or `Indeterminate`. The record appears in every report with its reason and is counted in denominators. The DOPT-default note in the DOTE dictionary entry is **not** used to assign DOPT as the measurement date.

### Example 3 — SYN-003: census vs schedule mismatch (cross-source match vs discrepancy)

**Fictional participant SYN-003.** RETSTAT = 1 (Retired). DOTE 2018-04-30, DOR 2018-05-01. Census PA_AMB = $2,015.75. PA schedule (provided) row 22 states $2,150.75 for the same participant, as of the same date, with no version note and no explanation.

**Rules evaluated:**

| Rule | Outcome | Why |
|---|---|---|
| C-01 | pass | Schedule row 22 exists for the participant — the census value traces to a schedule row (equality is C-02's job) |
| C-02 | **fail — Error, Exact-only** | Census $2,015.75 ≠ schedule $2,150.75; difference $135.00, unexplained. **Match** would have been exact decimal equality; this is a **discrepancy** |
| C-04 | not-applicable | PAY_AMT1/2 not in the case file for this participant; ARD factors present but no payment amount to compare — recorded, not passed |
| M-01–M-06 | pass | Basis established (DOTE, schedule as-of statement agrees) |
| P-04, P-05 | pass | DOTE/DOR consistent |

**Routing:** exact reconstruction is blocked for this participant until the governing value is established (the schedule usually governs — it is the PA's own arithmetic — but the decision and its reason must be recorded; the newer value is not automatically right). Bounds/scenario path: the benefit may be evaluated against each value ($2,015.75 and $2,150.75) as scenarios. Reachable dispositions: `Requires investigation` until the governing value is established; thereafter the comparison proceeds against the governing value.

## 12. Open decisions

Anything unresolved is recorded here as an open decision, not a silent default. Items OD-01–OD-08 carry forward Stage 1 gaps G-1–G-8 and conflicts C-1–C-2; items OD-09–OD-11 are new in this catalog.

| # | Open decision | What is unknown | What the catalog does meanwhile | Who decides / what is needed |
|---|---|---|---|---|
| OD-01 | BCV predicate type 1–3 meanings and VLDTN_CAT_ID 1–9 legend | The predicates workbook gives no legend for DATA_VLDTN_TYPE values 1–3 or VLDTN_CAT_ID values 1–9. Only type 4 is interpretable (critical error). Type counts: 1 → 11, 2 → 66, 3 → 154, 4 → 18. (Stage 1 gap G-5.) | Adopted predicates keep their BCV type verbatim in `bcvPredicateType` and receive the app severity assigned by Stage 1. The BCV type never drives blocking. | Workbook owner / BCV documentation. The legend must be found or the type column must be treated as opaque. |
| OD-02 | BCV predicates 224 vs 225 — which applies | Both fire on complementary DOTE/DOPT relations (see §10.1). Whether applicability turns on RETSTAT/population, or one predicate's SQL tests something narrower than its description, is unknown — the predicate SQL was not individually reviewed in Stage 1. | Both preserved under P-04 with the conflict flagged; both recorded `not-applicable` ("conflict C-1 unresolved") when they would both fire. Neither is implemented. | Case actuary + workbook SQL read for 224 and 225 before implementation. This is the one conflict that blocks implementation of its rule. |
| OD-03 | BCV type "4/7" on predicates 333/416 (rule X-03) | Stage 1 §B.3 writes the type for 333/416 as "4/7", but the workbook type counts cover only 1–4. A type "7" is unexplained. | Preserved as written; Stage 1 severity (Error) and blocking (No) applied. | Workbook re-read for predicates 333 and 416 before implementation. |
| OD-04 | Per-plan rounding policy | No written PBGC rounding policy was found; the PF file's practice (4 dp) is a file practice, not a policy. Per-plan rounding must be established from the plan document or the PA schedule. (Stage 1 gap G-6.) | No rule in this catalog fires on rounding alone. Rounding is a parameter of the calculation engine (Stage 4), and rounding-sequence differences are diagnostic hypotheses in the reconciliation engine (Stage 1 output 03). | Case actuary, per plan, from the plan document or PA schedule. |
| OD-05 | Vesting treatment and annuity form of PA_AMB | The dictionary states neither (Stage 1 gaps G-1, G-2). Whether PA_AMB is gross or vested, and in which annuity form, must be established per case from the PA schedule or plan provisions. | Rules X-09 and X-10 fire (Error, Exact-only) while the treatment/form is unknown for the affected participants; `APP.vestingTreatment = unknown` and an unknown form are valid stored values, never defaulted. Bounds may be computed under each candidate treatment/form as scenarios. | Case actuary, per case, from the PA schedule. |
| OD-06 | Why BCV disabled predicate 276 | BCV-276 (credited service not populated) is `ENABLE_FL = N`. Whether the BCV load tolerates a blank CS in some population is unknown. | The CS-blank check is re-stated as APP in P-06 (see §10.2). The restatement stands until evidence narrows it. | BCV documentation / load-specification review. |
| OD-07 | Current edition of Policy 5.8-1 | The 2014 edition is the latest seen; whether a newer edition exists was not verified in Stage 1. (Stage 1 gap G-7.) | The 2014 figures are cited as reference data only, never as the reconciliation tolerance. | Case actuary must confirm the current edition before relying on the figures. |
| OD-08 | Covered-compensation tables, SSA bend-point tables, historical statutory limits (§401(a)(17), §415(b)) by year | No covered-compensation table, bend-point table, or limits table was found in the Book of Job material reviewed. (Stage 1 gaps G-3, G-4.) | Rules that need these inputs (X-08 for PIA; P-14 class-(c) bounds citing the §401(a)(17) cap) record `not-applicable` or use a documented substitute only when the table is sourced. Values must come from IRS/SSA publications, never invented. | IRS/SSA publications, sourced per case. |
| OD-09 | X-04 numeric range | Stage 1 gives no numeric range for the benefit-to-compensation plausibility ratio. The rule cannot fire without it. | X-04 is specified as a parameterized rule; it records `not-applicable` until the case actuary sets `plausibleBenefitCompRatioRange` from the plan's formula. It never passes or fires while unset. | Case actuary, per plan, from the formula (accrual rate × service). |
| OD-10 | Unread sources that may contain validation predicates | `processing-manual.pdf` and `bcv-manual-combined.pdf` text layers are unreadable (not reviewed); predicates below ID 200 are absent from the predicates file (it starts at 200) and whether a fuller list exists is not established; the second copies of the dictionary, Benefit Corrections, and ERISAfication were not byte-compared. (Stage 1 §5, §B.9.) | This catalog claims nothing about those sources. If OCR or a re-encoded copy later reveals a validation predicate for PA_AMB, the catalog must be revised (new rule or adoption) with a version note — not silently patched. | OCR / re-encoded copies; alternate-copy hash comparison. Stage 2 follow-up. |
| OD-11 | Per-case tolerance authority (M-7) | The reconciliation tolerance is a case-level, documented, human-set parameter. Its value, authority, and approver differ per case and are not set by this catalog. | The engine must refuse to compare without a recorded tolerance (X-06, C-04, C-06 record `not-applicable` without it). No default tolerance is imposed. | Case actuary, per case, recorded in dataset item M-7. |

## 13. Handoff notes for Stage 3 and Stage 4

1. **The validation engine must implement all 66 rules** with the §2 result record and the §3.3 routing. Rule P-04's flagged conflict (predicates 224 vs 225) must be resolved before implementation (OD-02) — it is the only conflict that blocks implementation of its rule.
2. **The disposition-reachability matrix (§3.4) must be enforced at ActuarialDecision entry**, not as a reporting afterthought — including the C-08 evidence gate, the C-09 flag-consistency gate, and the C-10 reliability cap on `verified`.
3. **The tolerance record (M-7) is a case-level input; the engine must refuse to compare without one.** X-06, C-04, and C-06 record `not-applicable` without it; a Δ comparison without a recorded tolerance is incomplete.
4. **Nothing in this document authorises a live-case import.** All Stage 3/Stage 4 testing uses synthetic data only (cf. Stage 1 handoff note 5).
5. **Catalog versioning:** this catalog is version 0.1.0. Any later change — a resolved open decision, a newly sourced predicate from OD-10, a narrowed P-06 restatement — requires a version increment and a change note, and golden tests re-run (per the Phase 0 versioning rule: additive v1.1.0-style, breaking v2.0.0-style, always with a change note).
6. **What this catalog does not define:** the canonical input schema (Stage 2 companion deliverable — it must cover every field in Stage 1 §A.2, with R/C/O requirements enforced at import and the §A.6 class recorded for every missing input); the reconciliation engine's Δ computation and hypothesis ranking (Stage 1 output 03); and the calculation engine itself (Stage 4). Where this catalog touches those (tolerance, bounds, dispositions), it states the interface, not the implementation.

## Sources for this document

- `~/workspace/pbgc-pa-amb-analysis/MASTER_PROMPT.md` (§2 source hierarchy, §3 typed benefit, §5 temporal reconstruction, §6 data architecture, §7 validation, §10 reconciliation, §12 missing-data framework, §14 acceptance framework, §15 reporting)
- `~/workspace/pbgc-pa-amb-analysis/stage1/00-source-inventory.md` (PA_AMB definition §1, tolerance rules §2, conflicts §4, not-accessible §5)
- `~/workspace/pbgc-pa-amb-analysis/stage1/02-data-requirements-validation.md` (Part A datasets, grades, missing-data split, disposition reachability §A.7; Part B rule catalog §B.0–§B.9 — the sole basis for all 66 rules)
- `~/workspace/pbgc_review/BCV_Data_Dictionary.csv` (2026-10-30 index: 1,172 field records) — field names, types, and classifications cited in rules
- `~/workspace/pbgc_review/pa-amb/BCV-DataValidation-predicates.xlsx` (249 predicates; Drive `1CCBAMkMVVS7G1axzegkIqCjS3TrE4Qkr`) — official predicate IDs, types, and enablement flags cited in rules
- `~/workspace/pbgc_review/pa-amb/DBAB-Ch16.pdf` (Answer Book Ch. 16, 2024 ed.), `DBAB-Ch07.pdf`, `DBAB-Ch08.pdf`, `DBAB-Ch09.pdf` — grounding cited on APP rules
- `~/workspace/pbgc_review/pa-amb/Benefit_Corrections.pdf` (Policy 5.8-1, 10/02/2014); `~/workspace/pbgc_review/eadj/current-policies.txt` §5.8-1; `~/workspace/pbgc_review/eadj/CASE_PROCESSING.txt`
