# Stage 2 — Output 4: Calculation Functions — Framework

**Project:** PBGC Prior Administrator Accrued Monthly Benefit (PA_AMB) Analysis System
**Repository:** ErChulo/pbgc-pa-amb-analysis (public, `main`)
**Governing spec:** `MASTER_PROMPT.md` (§3 typed benefit, §8 deterministic engine, §9 rounding,
§10 reconciliation, §12 missing data, §14 acceptance framework, §17 state-driven design)
**Stage:** 2 — Mathematical and data architecture (design only; no engine code, no UI, no tests)
**Date:** 2026-11-12
**Status:** Framework specification. The 34 formula signatures live in the companion file
`04-calculation-functions.md` §11 below. Nothing here
is an official PBGC classification, tolerance, or rule unless a PBGC source is cited for it.

## 0. Scope and facts taken as given

### 0.1 What this document is

This document specifies the **shape** of the calculation functions: the ten-stage pipeline
(MASTER_PROMPT §8), the numeric representation, the rounding configuration, the bounds/scenarios
path, the reconciliation hook, and the typed benefit quantity that is the output type of every
calculation function. It gives TypeScript interfaces and function signatures. It is **not**
runnable code: no function body is implemented here, and no formula is defined here — the
formula catalog (§11) supplies the 34 formula signatures that plug into Stage 5 of the pipeline.

### 0.2 Facts taken from Stage 1 — not re-derived, not contradicted

1. **PA_AMB** = "Plan Administrator Accrued Monthly Benefit at DOTE", BCV9, Input, NUMBER.
   The dictionary does **not** state annuity form, vesting treatment, NRD/age basis, rounding,
   or what a blank means — none is assumed anywhere in this document.
2. **Comparison pair:** PA_AMB (Input, BCV9) vs BCV1.AMB (Calculated), both "at DOTE"
   (termination of employment, ≠ DOPT). BCV3.PA_AMB_ACCEPT (Y/N) is the only accept-decision
   flag; it carries no criterion.
3. **No PBGC tolerance for PA_AMB reconciliation exists.** Policy 5.8-1 $1/$5 governs benefit
   corrections, a different decision. The app ships with **no built-in acceptance tolerance**;
   tolerance is a human-set, versioned, per-case parameter (Stage 1 output 03, §2.4).
4. **Architecture:** Option C (Hybrid), staged — TypeScript deterministic core first, Rust/WASM
   kernels only where proved, single HTML file, 0 fetch (Stage 1 output 04).
5. **Standing requirement (most important):** the app must still produce reliable actuarial
   calculations and documented acceptance decisions when exact historical reconstruction is
   impossible — bounds, scenarios, documented dispositions, human decision; never a silent
   failure or a made-up exact number when the evidence cannot support one.
6. **Blanks are missing data, never zero** unless a governing rule says so. An unresolved
   measurement date means `comparison_basis = UNRESOLVED` and no Δ is computed.
7. **Types reused from Stage 2 output 01** (`01-data-model.md`, canonical there, referenced
   here, not redefined): `EntityId`, `DateString`, `Money`, `MoneyMinor`, `Provenance`,
   `CalculationStep`, `Scenario`, `BenefitCalculation`, `BenefitComparison`, `ToleranceRecord`,
   `MissingDataItem`, `PlanVersion`, `Formula`, `Participant`, `EmploymentPeriod`,
   `CompensationHistory`, `ServiceHistory`, `BenefitObservation`, `DiagnosticHypothesis`,
   `CalculationRun`, `InputSnapshot`. Where this document restates an interface, output 01
   governs in case of any difference.

### 0.3 Conventions

- **Pure functions only.** Every function in this document is pure: explicit inputs in,
  explicit outputs out (including a trace). No DOM, no storage, no clock, no network, no
  randomness inside the core (MASTER_PROMPT §17; Stage 1 output 04, §7.3). Side effects live
  at the boundary and are out of scope here.
- **Every intermediate is inspectable.** Each stage emits a `CalculationStep` (output 01, §7.10):
  step number, name, inputs read, output, rule reference with source citation, evidence grade
  (`fact` | `assumption` | `estimate` | `unknown`), and the stated assumption when the grade
  is `assumption`. A stage that cannot emit its trace has not run.
- **Evidence grades travel with values.** Any value that is an assumption or estimate carries
  that label into every downstream stage and into the final result. An exact-looking number
  built on an assumption is never presented as a fact.
- **No name, code, or level is coined.** Formula types come from the Stage 1 output 01
  taxonomy (via §11); field names come from the BCV Data Dictionary; disposition names come
  from MASTER_PROMPT §14. Anything without a source is recorded as an open decision (§10).

---

## 1. Pipeline overview

### 1.1 The pipeline

The engine is a composition of the ten MASTER_PROMPT §8 stages, in order. Each stage is a
function from a typed input to a typed output plus a trace. The pipeline signature is:

```typescript
/** Everything a calculation needs, assembled by the caller from the case
 *  package. The engine never fetches data itself. */
interface CalculationRequest {
  /** Participant whose benefit is calculated. */
  participantKey: string;
  /** Participant history X_i(≤t): employment, service, compensation,
   *  distributions, prior benefit observations. */
  participantHistory: ParticipantHistory;
  /** Plan provisions P(≤t): the effective-dated provision timeline. */
  provisionTimeline: PlanVersionTimeline;
  /** The measurement date t. null = not established; the pipeline then
   *  returns an unresolved-basis outcome (§1.4) and does not calculate. */
  measurementDate: DateString | null;
  /** How the measurement date was established (output 01 §5.1). */
  measurementBasis: MeasurementBasis;
  /** Calculation kind: accrued (B1) is the only kind compared to PA_AMB.
   *  Projected and payable-at-commencement are separate kinds (output 01 §5.2). */
  calculationKind: "accrued" | "projected" | "payable-at-commencement";
  /** The formula definition to apply (from the §11 catalog). */
  formulaId: EntityId;
  /** Rounding configuration for this plan version (§4). */
  roundingConfig: RoundingConfig;
  /** Case tolerance record, pinned at run time (output 01 §7.1). */
  tolerance: ToleranceRecord;
  /** Input snapshot + rule versions, for reproducibility (§6, output 01 §4.3). */
  runContext: RunContext;
}

/** The pipeline's single return type. Exactly one of the three shapes is
 *  present; the other two are null. A function must never return a single
 *  made-up number when the evidence cannot support one (§5). */
type CalculationOutcome =
  | { kind: "exact"; benefit: TypedBenefitQuantity; trace: CalculationTrace }
  | { kind: "bounds"; bounds: BoundsResult; trace: CalculationTrace }
  | { kind: "indeterminate"; reason: IndeterminateReason; trace: CalculationTrace };

/** Compose the ten stages. Each stage receives the accumulated pipeline
 *  state and returns the next state plus its trace steps. A stage that
 *  cannot proceed returns a stage failure, not a guessed value (§1.3). */
declare function calculateAccruedBenefit(
  request: CalculationRequest
): CalculationOutcome;
```

### 1.2 Pipeline state — what flows between stages

```typescript
/** Accumulates as the pipeline runs. Each stage reads what it needs and
 *  writes its own output; it never rewrites an earlier stage's output. */
interface PipelineState {
  request: CalculationRequest;
  /** Stage 1 output: the applicable provisions at the measurement date. */
  provisions: ApplicableProvisions | null;
  /** Stage 2 output: eligibility findings. */
  eligibility: EligibilityResult | null;
  /** Stage 3 output: service measures. */
  service: ServiceMeasures | null;
  /** Stage 4 output: compensation measures. */
  compensation: CompensationMeasures | null;
  /** Stage 5 output: base benefit, before protections/restrictions. */
  baseBenefit: TypedBenefitQuantity | null;
  /** Stage 6 output: benefit after accrual/grandfathering/protection. */
  protectedBenefit: TypedBenefitQuantity | null;
  /** Stage 7 output: benefit after plan/statutory restrictions. */
  restrictedBenefit: TypedBenefitQuantity | null;
  /** Stage 8 output: benefit after prescribed rounding. */
  roundedBenefit: TypedBenefitQuantity | null;
  /** Stage 9 output: benefit on the normal-retirement basis. */
  normalRetirementBenefit: TypedBenefitQuantity | null;
  /** Stage 10 output: comparison inputs for §10 (§6). */
  reconciliation: ReconciliationInputs | null;
  /** Every stage appends its CalculationSteps here, in order. */
  trace: CalculationTrace;
  /** Missing inputs encountered, each classified M1–M5 (MASTER_PROMPT §12;
   *  Stage 1 output 03, §4.1). Drives the exact/bounds/indeterminate fork. */
  missingInputs: MissingDataItem[];
}
```

### 1.3 Stage failure — the no-silent-failure rule

```typescript
/** A stage that cannot produce its output. Returned, never thrown past the
 *  pipeline boundary, and never replaced by a guessed value. */
interface StageFailure {
  stage: StageNumber; // 1–10
  /** Why the stage could not proceed: missing input, inapplicable rule,
   *  unresolved basis, or a rule applied outside its applicability. */
  reason: "missing-input" | "inapplicable-rule" | "unresolved-basis" | "rule-refused";
  /** The missing input(s) or the rule, by id. */
  detail: string;
  /** What the pipeline does next: widen to bounds (§5) or go indeterminate. */
  next: "bounds" | "indeterminate";
}
```

Rules:

- **F-1.** A stage failure stops the exact path. The pipeline attempts the bounds path (§5)
  if every missing input is class M3 (bounds establishable) or M4 (stated assumption);
  otherwise it returns `indeterminate` with the missing inputs and the data requests that
  would resolve them (Stage 1 output 03, §4.6–4.7).
- **F-2.** A rule that does not apply to this participant, date, or employment group is
  **refused**, and the refusal is recorded in the trace — never silently skipped, never
  applied anyway (Stage 1 output 04, invariant 4).
- **F-3.** A stage failure never produces a partial exact benefit. A `TypedBenefitQuantity`
  with `status: "calculated"` exists only when all ten stages completed.

### 1.4 Unresolved basis — checked before Stage 1

```typescript
/** Gate evaluated before any calculation. If the measurement date is not
 *  established, no stage runs and no Δ is computed (Stage 1 output 03, §2.2). */
declare function resolveComparisonBasis(
  request: CalculationRequest
): { basis: "established"; measurementDate: DateString } | { basis: "unresolved"; reason: string };
```

If the basis is unresolved, `calculateAccruedBenefit` returns
`{ kind: "indeterminate", reason: { code: "unresolved-comparison-basis", ... } }` with an
empty trace except the gate record. The participant is counted separately in missing-data
reporting, never in the Δ statistics.

---

## 2. The ten stages

Each stage below specifies: purpose, inputs, outputs, the function signature, and the trace
record it emits. Formula evaluation itself lives in Stage 5 and is defined in §11; the other
stages supply what the formula needs and transform what it produces.

### Stage 1 — Identify applicable plan provisions

**Purpose.** Select, from the provision timeline `P(t)`, the provisions in effect at the
measurement date: plan version, formula version, compensation definition, service-credit
rules, vesting schedule, freeze status, grandfathering rules, and statutory limits in effect
at that date. Never apply the latest formula retroactively (MASTER_PROMPT §5).

```typescript
interface ApplicableProvisions {
  planVersionId: EntityId;
  formulaId: EntityId;
  /** Effective-dated provision set in force at the measurement date. */
  provisionsAtDate: PlanVersion;
  /** Amendments/restatements whose effective date is ≤ measurement date,
   *  in effective-date order, each with adoption and effective dates. */
  amendmentHistory: PlanVersion[];
  /** Freeze in effect at the measurement date, or null. */
  freeze: FreezeBlock | null;
  /** Statutory limits in effect at the measurement date (e.g. IRC §415,
   *  §401(a)(17)), as stated values with their source citations. */
  statutoryLimits: StatutoryLimit[];
}

declare function identifyProvisions(
  state: PipelineState
): { provisions: ApplicableProvisions; steps: CalculationStep[] } | StageFailure;
```

**Trace emitted:** one `CalculationStep` per provision selected, each with `ruleRef` citing
the plan document section (or amendment) and its effective date; plus one step recording
any provision considered and rejected (e.g. a later amendment not yet effective), so the
auditor can see what was *not* applied and why.

### Stage 2 — Determine participation and service eligibility

**Purpose.** Establish whether the participant was a participant at the measurement date,
under the eligibility rules then in effect: participation date, eligibility service, excluded
employment groups, and rehire/restoration treatment.

```typescript
interface EligibilityResult {
  isParticipant: boolean;
  participationDate: DateString | null;
  /** Eligibility rule applied, with its source citation. */
  eligibilityRuleRef: string;
  /** Exclusion that applies, if any (employment group, plan provision). */
  exclusion: string | null;
  /** Rehire/restoration finding, if the history contains a rehire. */
  rehireFinding: string | null;
}

declare function determineEligibility(
  state: PipelineState
): { eligibility: EligibilityResult; steps: CalculationStep[] } | StageFailure;
```

**Trace emitted:** one step per eligibility test applied (participation, group exclusion,
rehire), each naming the rule, the history facts read, and the finding. A participant found
not eligible yields an exact benefit of zero only if a governing rule states that treatment;
otherwise the outcome is `indeterminate` with the eligibility question recorded — a
non-participant with a recorded PA_AMB is itself a finding for investigation (hypothesis
H16/H17 territory), not a silent zero.

### Stage 3 — Determine the applicable service measures

**Purpose.** Compute the service quantities the formula needs, under the service-credit rules
in effect: eligibility service, vesting service, credited (benefit) service, breaks in
service, part-time proration, prior-service grants, and service through the measurement date
only — never projected past a freeze or termination date.

```typescript
interface ServiceMeasures {
  /** Credited service for benefit accrual, as an exact decimal (§3).
   *  null when it cannot be established. */
  creditedService: DecimalString | null;
  /** Vesting service, as an exact decimal, or null. */
  vestingService: DecimalString | null;
  /** Eligibility service, as an exact decimal, or null. */
  eligibilityService: DecimalString | null;
  /** Vesting percentage VP (exact decimal, 0–1), or null when not established. */
  vestingPercentage: DecimalString | null;
  /** Service periods used, with breaks and prorations applied, each with
   *  its source. */
  servicePeriods: ServicePeriod[];
  /** Service cap applied (e.g. maximum credited service), or null. */
  serviceCap: { capYears: DecimalString; ruleRef: string } | null;
}

declare function determineServiceMeasures(
  state: PipelineState
): { service: ServiceMeasures; steps: CalculationStep[] } | StageFailure;
```

**Trace emitted:** one step per service component (each employment period, each break
application, each proration, the cap if applied), each with the dates and rule citation.
Service is carried as an exact decimal (§3); rounding of service happens only in Stage 8
under the rounding configuration, never here.

### Stage 4 — Calculate compensation measures

**Purpose.** Compute the compensation quantities the formula needs, under the compensation
definition in effect at the measurement date: includable compensation by year, the averaging
period (final-average / highest-average, consecutive / non-consecutive, period length), and
any compensation cap. Missing years are recorded as missing inputs (M1–M5), never zero-filled.

```typescript
interface CompensationMeasures {
  /** Compensation by year used in the average, each with its source and
   *  evidence grade. A missing year is present with value null. */
  compensationYears: SalaryYearValue[];
  /** The averaging period applied (e.g. "final-3-year", "highest-5-year"),
   *  as stated in the plan provisions. */
  averagingPeriod: { description: string; ruleRef: string };
  /** Average compensation, integer minor units, or null when a required
   *  year is missing. */
  averageCompensation: Money | null;
  /** Compensation cap applied (e.g. IRC §401(a)(17) in effect), or null. */
  compensationCap: { capAnnual: Money; ruleRef: string } | null;
  /** Documented alternative averaging periods available for counterfactual
   *  testing (§6.2). */
  alternativeAveragingPeriods: string[];
}

declare function determineCompensationMeasures(
  state: PipelineState
): { compensation: CompensationMeasures; steps: CalculationStep[] } | StageFailure;
```

**Trace emitted:** one step per compensation year read (value, source, cap applied if any),
one step for the averaging computation (years included, arithmetic shown in exact decimal),
and one step per missing year naming the missing-data class and the bound or assumption
applied, if any. The averaging arithmetic is shown, not hidden: the auditor must be able to
re-add the years.

### Stage 5 — Calculate the applicable base benefit formula

**Purpose.** Evaluate the plan's benefit formula on the Stage 3 service and Stage 4
compensation measures, on the provisions selected in Stage 1. This is the only stage that
evaluates a benefit formula; the formula signatures, applicability predicates, effective-date
rules, and intermediate sequences are defined in §11 below.

```typescript
declare function calculateBaseBenefit(
  state: PipelineState
): { benefit: TypedBenefitQuantity; steps: CalculationStep[] } | StageFailure;
```

**Trace emitted:** the formula's own intermediate sequence (as defined per formula in §11),
with each intermediate component as a `CalculationStep` — formula id, inputs read, output,
rule reference, evidence grade. The output is a `TypedBenefitQuantity` with
`source: "independent-calculation"`, `status: "calculated"`, `periodicity` as the formula
states it (monthly for PA_AMB comparison), and `planVersionId` / `formulaId` pinned.
A formula whose applicability predicate fails for this participant is refused (rule F-2),
not evaluated.

### Stage 6 — Apply historical accrual, grandfathering, and protection provisions

**Purpose.** Apply, in the order the plan states them, fractional/unit-credit accrual
adjustments, greater-of / lesser-of combinations, grandfathered benefit floors, transitional
formulas, and IRC §411(d)(6) protected benefits. A reconstruction that omits a grandfathered
floor understates the benefit systematically for the affected cohort (Stage 1 output 03, H7).

```typescript
interface ProtectionApplication {
  /** Which protection applied, with its source citation. */
  protection: { kind: string; ruleRef: string } | null;
  /** The pre-protection benefit (Stage 5 output), retained for the trace. */
  preProtection: TypedBenefitQuantity;
  /** The greater-of / lesser-of comparison, when one was evaluated. */
  comparison: { candidates: Money[]; selected: Money; ruleRef: string } | null;
}

declare function applyAccrualAndProtection(
  state: PipelineState
): { benefit: TypedBenefitQuantity; protection: ProtectionApplication; steps: CalculationStep[] }
  | StageFailure;
```

**Trace emitted:** one step per protection evaluated (including protections evaluated and
*not* applied, with the reason), one step for each candidate benefit in a greater-of /
lesser-of comparison, and one step naming the selected value. The pre-protection benefit is
retained in the trace so the effect of the protection is visible as a number, not a claim.

### Stage 7 — Apply relevant plan and statutory benefit restrictions

**Purpose.** Apply, in the order the governing sources state them: service/compensation caps
not already applied, IRC §415 maximum benefit limits, funding-based restrictions (IRC §436
where applicable), Social Security integration / permitted disparity / offsets, prior
distributions and QDRO alternate-payee offsets, and benefit-freeze limits. Each restriction
is applied only if its applicability conditions hold at the measurement date.

```typescript
interface RestrictionApplication {
  /** Each restriction applied, in application order, with its effect. */
  applied: Array<{
    restriction: string; // e.g. "IRC §415 limit", "Social Security offset"
    ruleRef: string;
    before: Money;
    after: Money;
  }>;
  /** Restrictions evaluated and not applied, with the reason. */
  notApplied: Array<{ restriction: string; reason: string }>;
}

declare function applyRestrictions(
  state: PipelineState
): { benefit: TypedBenefitQuantity; restrictions: RestrictionApplication; steps: CalculationStep[] }
  | StageFailure;
```

**Trace emitted:** one step per restriction applied (before/after amounts, rule citation),
one step per restriction evaluated and not applied. An accrued benefit can decrease when a
Social Security offset increases (Defined Benefit Answer Book, Ch. 9) — a decrease at this
stage is a finding to show, not an error to hide.

### Stage 8 — Apply prescribed rounding

**Purpose.** Apply the rounding rules prescribed by the plan provisions or the evidence, as
configured in `RoundingConfig` (§4), at exactly the points the configuration states. No other
stage rounds. See §4 for the configuration shape and the anti-coincidence rule.

```typescript
declare function applyPrescribedRounding(
  state: PipelineState
): { benefit: TypedBenefitQuantity; roundingApplied: RoundingRecord; steps: CalculationStep[] }
  | StageFailure;
```

**Trace emitted:** one step per rounding operation applied (value before, value after, rule,
stage at which it was applied), and the complete `RoundingRecord` (§4.3) attached to the
`BenefitCalculation` as `roundingApplied`. A benefit that reaches this stage with no
prescribed rounding rule records `roundingApplied: "none-prescribed"`, not a default.

### Stage 9 — Express the result in the required normal-retirement benefit basis

**Purpose.** Convert the Stage 8 benefit to the normal-retirement basis required for
comparison: normal retirement age/date, annuity form (straight life unless the plan states
otherwise — never assumed), and vesting treatment, with each conversion's factors cited.
A form conversion is not a discrepancy (Stage 1 output 03, H13); it is a recorded
transformation in the trace.

```typescript
interface BasisConversion {
  /** Each conversion applied, in order, with its factor and citation. */
  conversions: Array<{
    conversion: string; // e.g. "annual-to-monthly", "form conversion", "vesting"
    factor: DecimalString;
    ruleRef: string;
    before: Money;
    after: Money;
  }>;
}

declare function expressOnNormalRetirementBasis(
  state: PipelineState
): { benefit: TypedBenefitQuantity; conversions: BasisConversion; steps: CalculationStep[] }
  | StageFailure;
```

**Trace emitted:** one step per conversion (before/after, factor, citation). The output is
the reconstructed benefit B̂_i: a `TypedBenefitQuantity` on the same basis as PA_AMB
(same measurement date, retirement basis, annuity form, vesting treatment, plan version).
If any basis element cannot be established, this stage fails with
`reason: "unresolved-basis"` and the pipeline returns the unresolved-basis outcome (§1.4).

### Stage 10 — Reconcile the result with the reported administrator amount

**Purpose.** Emit the comparison inputs for MASTER_PROMPT §10 (§6). This stage computes
nothing about the benefit itself; it packages the reconstructed benefit, the recorded
PA_AMB, and the basis statement for the reconciliation module, and it runs the
counterfactual-hypothesis interface (§6.2). The Δ/D/R arithmetic and the tolerance test
belong to the reconciliation module (Stage 1 output 03, §2); this stage only supplies
their inputs, so that a change in tolerance never requires re-running the calculation.

```typescript
declare function emitReconciliationInputs(
  state: PipelineState
): { reconciliation: ReconciliationInputs; steps: CalculationStep[] } | StageFailure;
```

**Trace emitted:** one step recording the comparison basis statement (established /
converted / unresolved), one step recording the recorded PA_AMB value and its provenance,
and one step per counterfactual hypothesis evaluated (§6.2). If the basis is unresolved,
this stage returns a `StageFailure` with `reason: "unresolved-basis"` and no Δ is computed.

---

## 3. Decimal-safe arithmetic

### 3.1 Representation

```typescript
/** Exact decimal value, canonical string form (e.g. "0.015", "1234.56",
 *  "22.5"). The string is the value; it is never parsed into a binary
 *  float for arithmetic. */
type DecimalString = string;

/** Exact decimal as a scaled integer. `value` is an integer (bigint);
 *  the real value is value / 10^scale. This is the in-engine working form
 *  of a DecimalString. */
interface ScaledInt {
  value: bigint;
  scale: number; // decimal places; 2 for cents, 0 for whole units
}

/** Money in the core is always integer minor units (output 01, §1.2):
 *  `Money.amountMinor` is an integer count of cents; a blank is null,
 *  never 0. Percentages and rates are DecimalString or integer basis
 *  points, never binary floats. */
```

Rules:

- **R-1 — No binary floating point touches money, service, compensation, rates, or
  factors.** `number` (IEEE 754 double) is permitted only for non-monetary display
  quantities that cannot affect a calculation (e.g. a chart axis) and for counts.
  Any `number` that enters the core is rejected by validation.
- **R-2 — Intermediate values are carried exact.** All intermediate values are carried as
  `ScaledInt` (or `DecimalString`) with a scale large enough that no intermediate
  operation loses precision: multiplication adds scales; division is carried at a
  recorded scale of at least 10 decimal places and is never silently truncated.
  The scale used at each step is recorded in the trace step that produced the value.
- **R-3 — Rounding is applied only at prescribed points.** Rounding happens only in
  Stage 8, under `RoundingConfig` (§4), and at any point a governing rule explicitly
  prescribes (e.g. a plan provision that rounds service to completed years — that
  rounding is a Stage 3 rule application recorded in the trace, not an arithmetic
  convenience). No intermediate is rounded "to keep the numbers tidy".
- **R-4 — Division by 12 / multiplication by 12** (annual ↔ monthly) is an exact-decimal
  operation recorded in the trace with before/after values; it is a basis conversion
  (Stage 9), not a rounding event, unless the rounding configuration prescribes
  rounding at that point.
- **R-5 — Reproducibility.** The same inputs, formula version, rounding configuration,
  and engine version produce byte-identical outputs. No `Date.now()`, no randomness,
  no iteration over unordered structures inside the core (Stage 1 output 04, invariant 2).

### 3.2 Arithmetic operations (signatures only)

The engine provides, as its only arithmetic surface, exact-decimal operations on
`ScaledInt` / `DecimalString`. These are named here so Stage 4 implements exactly this
surface and nothing else:

```typescript
declare function decAdd(a: DecimalString, b: DecimalString): DecimalString;
declare function decSubtract(a: DecimalString, b: DecimalString): DecimalString;
declare function decMultiply(a: DecimalString, b: DecimalString): DecimalString;
/** Division at the recorded scale (≥ 10 places). The scale is an argument,
 *  never a hidden default. */
declare function decDivide(a: DecimalString, b: DecimalString, scale: number): DecimalString;
/** Rounding of an exact decimal to a stated unit and mode (§4.2). The only
 *  place a value loses precision, and only when a rule prescribes it. */
declare function decRound(value: DecimalString, unit: DecimalString, mode: RoundingMode): DecimalString;
/** Comparison of exact decimals, without converting to float. */
declare function decCompare(a: DecimalString, b: DecimalString): -1 | 0 | 1;
```

**Verification requirement (for Stage 4, recorded here):** the decimal surface is verified
against a trusted reference (hand-computed cases and an independent decimal implementation
run on the build machine) before any benefit is calculated with it. A decimal library is
adopted only if it is vendored, pinned, inlined as classic script, and passes those
reference tests under `file://`. A library that cannot meet that is not used, and the
engine implements `ScaledInt` arithmetic directly.

---

## 4. Configurable rounding rules (MASTER_PROMPT §9)

### 4.1 The rule

Rounding may explain differences between recorded and reconstructed benefits — and it is
the easiest explanation to fake. The rounding configuration is therefore **per-plan,
versioned, and evidence-based**: it states what the plan prescribes, or what the
administrator's workpapers / a valuation report documents. It never states what "usually"
happens, and it is never tuned until a match appears (§4.4).

### 4.2 Configuration shape

```typescript
/** How a single value is rounded. The mode list is closed; a mode not in
 *  this list is not representable until a recorded decision adds it. */
type RoundingMode =
  | "half-up"      // 0.5 rounds away from zero (nearest, ties away from zero)
  | "half-even"    // 0.5 rounds to the even neighbour (banker's rounding)
  | "down"         // toward zero (truncation)
  | "up"           // away from zero
  | "floor"        // toward negative infinity
  | "ceiling";     // toward positive infinity

/** One rounding rule, applied at one point in the calculation. */
interface RoundingRule {
  /** Which quantity this rule rounds. Closed list from MASTER_PROMPT §9. */
  target:
    | "compensation"
    | "average-compensation"
    | "credited-service"
    | "accrual-percentage"
    | "social-security-offset"
    | "intermediate-component"
    | "retirement-factor"
    | "actuarial-equivalence-factor"
    | "final-monthly-benefit";
  /** The unit to round to, as an exact decimal (e.g. "0.01" = nearest cent,
   *  "1" = nearest dollar or nearest whole year, "0.001" = three places). */
  unit: DecimalString;
  mode: RoundingMode;
  /** When it is applied: after an individual operation, after an annual
   *  accrual, after an intermediate result, or at the final calculation. */
  stage: "after-operation" | "after-annual-accrual" | "after-intermediate" | "final";
  /** Source: plan provision, administrator workpaper, valuation report, or
   *  "not-documented" (see §4.4 — an undocumented rule may be tested as a
   *  hypothesis, never applied as the prescribed sequence). */
  source: { kind: "plan-provision" | "workpaper" | "valuation-report" | "not-documented";
            citation: string | null };
}

/** A rounding sequence: the ordered list of rules applied in one calculation.
 *  The plan's prescribed sequence is one sequence; alternative plausible
 *  sequences are hypotheses (§4.4), each a different RoundingSequence. */
interface RoundingSequence {
  sequenceId: string;
  rules: RoundingRule[];
}

/** Per-plan, versioned rounding configuration. Part of the case package,
 *  pinned to the calculation run like the tolerance record. */
interface RoundingConfig {
  configId: string;
  version: string; // e.g. "rounding-config v1.0.0"
  planVersionId: EntityId;
  /** The prescribed sequence — the one the plan or the evidence states.
   *  null when no rounding rule is documented for this plan version. */
  prescribedSequence: RoundingSequence | null;
  /** Alternative plausible sequences, each labelled with its source and
   *  status. Tested as diagnostic hypotheses only (§4.4). */
  alternativeSequences: RoundingSequence[];
  /** Who set this configuration, when, and on what evidence. */
  setBy: string;
  setDate: DateString;
  rationale: string;
}
```

### 4.3 The rounding record — what Stage 8 attaches to the calculation

```typescript
/** Attached to BenefitCalculation as `roundingApplied`. */
interface RoundingRecord {
  sequenceId: string | "none-prescribed";
  /** Every rounding operation actually applied, in order. */
  operations: Array<{
    target: RoundingRule["target"];
    before: DecimalString;
    after: DecimalString;
    unit: DecimalString;
    mode: RoundingMode;
    ruleRef: string;
  }>;
  /** Maximum plausible rounding effect for this participant: the sum of the
   *  per-stage rounding units, in money (Stage 1 output 03, §2.7). A
   *  discrepancy larger than this cannot be explained by rounding alone. */
  maxPlausibleEffect: Money;
}
```

### 4.4 The anti-coincidence rule (mandatory)

- **A-1.** A rounding sequence may be tested as a diagnostic hypothesis (H15): for each
  alternative sequence, recompute B̂_i and record the residual discrepancy.
- **A-2.** A successful numerical match obtained by arbitrary changes to rounding
  conventions is **never proof** of the administrator's actual methodology
  (MASTER_PROMPT §9; Stage 1 output 03, §2.7).
- **A-3.** A rounding hypothesis is **Supported** only if (a) the sequence is documented in
  the plan, the administrator's workpapers, or a valuation report, or (b) the same
  sequence resolves discrepancies across the cohort (not just one participant) and no
  document contradicts it. Otherwise it is **Coincidence**: recorded as such, never
  presented as an explanation, and never sufficient to move a disposition to Verified.
- **A-4.** When rounding is the supported explanation, the report names the stage(s) and
  the quantified effect (e.g. "final monthly benefit rounded to nearest cent; service
  rounded down to completed years per plan §X"). "Rounding" without a stage and a
  number is not an explanation.
- **A-5.** The prescribed sequence is applied in Stage 8. Alternative sequences are never
  applied in Stage 8; they are applied only by the counterfactual interface (§6.2),
  on a copy of the pipeline state, and their results are labelled hypotheses.

---

## 5. The bounds / scenarios path

### 5.1 When this path is taken

The bounds path is taken whenever the exact path cannot complete: one or more inputs are
missing (class M3 — reasonable bounds establishable — or M4 — stated assumption) and no
input is class M5 (indeterminate) and the comparison basis is established. If any input is
M5, or the basis is unresolved, the outcome is `indeterminate`, not bounds.

```typescript
/** The bounds result. The output of the pipeline when exact reconstruction
 *  is impossible but justified bounds are. */
interface BoundsResult {
  /** Lower bound B_i^min, integer minor units. */
  min: Money;
  /** Upper bound B_i^max, integer minor units. */
  max: Money;
  /** The assumption set under which the bounds are guaranteed: every bound
   *  is conditional on these assumptions holding. */
  assumptions: string[];
  /** How each bound was derived (§5.2): endpoint evaluation, kink
   *  evaluation, or grid/optimisation over the feasible region. */
  derivation: BoundsDerivation;
  /** The missing inputs that widen the interval, each with its class and
   *  its contribution to the width (§5.4). */
  widthAttribution: WidthAttribution[];
  /** Named scenarios evaluated (§5.3), each with its stated assumptions. */
  scenarios: Scenario[];
  /** Where the recorded PA_AMB falls relative to the range. */
  recordedPosition: "inside" | "below-min" | "above-max" | "recorded-missing";
  /** The reconstructed benefit as a typed quantity with source "bound"
   *  (output 01, §5.1) — for the min and the max separately, so neither
   *  is ever mistaken for an exact benefit. */
  minBenefit: TypedBenefitQuantity;
  maxBenefit: TypedBenefitQuantity;
}

interface BoundsDerivation {
  method: "endpoint-evaluation" | "endpoint-plus-kinks" | "grid" | "optimisation";
  /** Kink points evaluated (cap thresholds, freeze dates, formula-change
   *  dates) — required when the method is endpoint-plus-kinks or finer. */
  kinkPoints: Array<{ description: string; value: DecimalString }>;
  /** Monotonicity verification (§5.2): per missing input, whether the
   *  benefit is monotone in that input over its feasible range, and how
   *  that was established. */
  monotonicity: Array<{
    input: string;
    monotone: boolean;
    verifiedBy: string; // e.g. "formula structure", "endpoint+kink evaluation"
  }>;
  /** Feasible region of the missing inputs, stated explicitly. */
  feasibleRegion: string;
}
```

### 5.2 How bounds are derived — monotonicity and kinks

- **B-1 — Bounds are derived, not estimated.** Each bound is computed by evaluating the
  benefit formula at the extreme values of the missing inputs that are consistent with the
  known facts and the plan provisions (Stage 1 output 03, rule B-1).
- **B-2 — Monotonicity must be verified.** Bounds computed by plugging in extreme inputs
  are valid only if the benefit is monotone in each missing input over the relevant range.
  Most formulas are monotone in service and compensation, but grandfathered greater-of
  formulas, caps, and offsets can break monotonicity. The engine verifies monotonicity
  by evaluating the formula at the endpoints **and** at every internal kink point — cap
  thresholds, freeze dates, formula-change dates — or falls back to a grid or an
  optimisation over the feasible region. **A bound computed at endpoints only, for a
  non-monotone formula, is wrong.** The verification, and the kink points evaluated, are
  recorded in `BoundsDerivation`.
- **B-3 — Bounds widen honestly.** As more inputs go missing, bounds widen. The system
  must not narrow bounds by importing an unstated assumption. If an assumption narrows
  the bounds, it is stated as an assumption (class M4) and the assumption-free bounds are
  also reported, so the actuary can see what the assumption bought.

```typescript
/** Derives bounds for one participant. Runs the Stage 1–9 pipeline once per
 *  evaluation point (endpoints, kinks, grid points) with the missing inputs
 *  fixed at that point's values, and takes the min/max of the results. */
declare function deriveBounds(
  request: CalculationRequest,
  missingInputs: MissingDataItem[],
  feasibleRegion: FeasibleRegion
): BoundsResult;
```

### 5.3 Scenarios

For each participant with missing inputs, the system evaluates a defined set of named,
reproducible scenarios (Stage 1 output 03, §4.4): "missing year at lower bound", "missing
year at upper bound", "missing year at the average of known years (labelled assumption)",
"alternative formula version", "alternative measurement date". Each scenario is a `Scenario`
(output 01, §7.10) with its assumptions stated and its benefit (or null when the scenario
is indeterminate). Scenarios are discrete and reproducible; a scenario's benefit is never
presented as the benefit.

### 5.4 Width attribution and decision sensitivity

For each participant, the report attributes the width of [B_i^min, B_i^max] to individual
missing inputs by leave-one-out bounding: recompute the bounds with each missing input
hypothetically known at its midpoint (labelled as an assumption) and record how much the
interval narrows (Stage 1 output 03, §4.5). The key question is decision sensitivity, not
benefit movement: does resolving the input move the participant across a tolerance or
disposition boundary? Inputs are ranked by disposition-changing effect first, then by
breadth across participants, then by recoverability (Stage 1 output 03, §4.6).

```typescript
interface WidthAttribution {
  missingInput: string;
  missingClass: "a" | "b" | "c" | "d" | "e"; // output 01 §7.6 (M1–M5)
  widthContribution: Money;
  widthShare: DecimalString; // proportion of total width, exact decimal
  couldChangeDisposition: boolean;
}
```

### 5.5 What bounds are not

- **Bounds are not confidence intervals.** A 95% confidence interval from a statistical
  model is a statement about sampling uncertainty; it is not a guarantee that the true
  benefit lies inside it. Bounds in this system are guarantees *conditional on the stated
  assumptions*: if the assumptions hold, the true benefit (under the correct formula) lies
  in [B_i^min, B_i^max] (Stage 1 output 03, rule B-2). The two must never be confused or
  relabelled. Statistical missing-data methods (multiple imputation) may be used for
  population-level summaries and statistical models; they must **never** be used to fill
  in an individual participant's benefit inputs and present the result as that
  participant's reconstructed benefit.
- **A bound is not an exact benefit.** `BoundsResult.minBenefit` and `.maxBenefit` carry
  `source: "bound"` and `status: "calculated"` only in the sense of a bound calculation;
  neither may be compared to PA_AMB as if it were B̂_i. The comparison for a bounds case
  is the recorded-position test (§5.1): inside the range (consistent), outside the range
  (inconsistent under the stated assumptions — investigate), or recorded-missing.
- **Evaluating the recorded benefit against the range:** B_i^PA inside the range supports
  (does not prove) acceptance; the disposition then depends on the width of the range
  relative to materiality and on the hypotheses. B_i^PA outside the range means either an
  assumption is wrong, the formula version is wrong, or the administrator's amount is
  wrong — investigation required. If the range width is small relative to τ_material, the
  uncertainty is immaterial and the case can proceed; if large, the uncertainty itself is
  the finding (Stage 1 output 03, rule B-5).

---

## 6. The reconciliation hook

### 6.1 What Stage 10 emits

```typescript
/** The comparison inputs Stage 10 hands to the reconciliation module.
 *  The reconciliation module (Stage 5 build) owns Δ/D/R, the tolerance
 *  test, and the disposition recommendation; this interface only supplies
 *  its inputs, so a tolerance change never requires re-running the
 *  calculation. */
interface ReconciliationInputs {
  /** The reconstructed benefit B̂_i, on the same basis as PA_AMB — or null
   *  when the basis is unresolved or the outcome is bounds/indeterminate. */
  reconstructed: TypedBenefitQuantity | null;
  /** The recorded PA_AMB, as a typed benefit quantity with
   *  source "prior-administrator". null when the recorded amount is blank
   *  (missing data — never zero). */
  recorded: TypedBenefitQuantity | null;
  /** Basis statement: same-basis, basis-converted (with the conversion
   *  stated), or unresolved. Unresolved ⇒ no Δ is computed. */
  comparisonBasis: "same-basis" | "basis-converted" | "unresolved";
  /** The conversion applied, when the basis was converted (e.g. annual→
   *  monthly ÷12, form conversion with factors cited, vesting conversion
   *  with VP cited). Required when comparisonBasis is "basis-converted". */
  basisConversion: string | null;
  /** Bounds, when the outcome is bounds (§5). The reconciliation module
   *  uses the recorded-position test, not a Δ. */
  bounds: BoundsResult | null;
  /** Counterfactual results (§6.2). */
  counterfactuals: CounterfactualResult[];
  /** Denominator flag, when B̂_i is zero or near zero (Stage 1 output 03,
   *  §2.3): "R_UNDEFINED_ZERO_DENOMINATOR", "R_UNSTABLE_SMALL_DENOMINATOR",
   *  or "PA_ZERO". A flag is recorded instead of a relative difference. */
  denominatorFlag: string | null;
  /** The tolerance record version applied (a copy, pinned at run time). */
  toleranceApplied: ToleranceRecord;
}
```

**Rules:**

- **C-1.** `reconstructed` is non-null only when the pipeline returned `kind: "exact"` and
  the basis is established. In a bounds case the reconciliation module receives `bounds`
  and `reconstructed: null`; in an indeterminate case it receives neither, and the
  participant is routed to the missing-data reporting, not the Δ statistics.
- **C-2.** A recorded blank PA_AMB yields `recorded: null` and the participant enters the
  §12 framework. A recorded zero yields a `TypedBenefitQuantity` with amount zero and
  `denominatorFlag: "PA_ZERO"` when B̂_i > 0 — investigated as a value, not treated as
  missing.
- **C-3.** The reconciliation module computes Δ_i = B_i^PA − B̂_i, D_i = |Δ_i|, and
  R_i = Δ_i / B̂_i only when the denominator is meaningful (Stage 1 output 03, §2.1–2.3).
  R_i is never computed when B̂_i is zero or below the configurable threshold ε_R.
- **C-4.** The tolerance test uses the pinned `ToleranceRecord` (τ_abs, τ_rel, τ_rule,
  τ_material, ε_R — Stage 1 output 03, §2.4). The combination rule (either-leg vs.
  both-legs) is stated explicitly; the choice changes outcomes and must be visible.

### 6.2 Counterfactual-hypothesis interface

The engine must support the minimum counterfactual set from Stage 1 output 03, §2.6.
Each counterfactual is an operation on a copy of the pipeline state; the original
calculation is never modified by testing a hypothesis.

```typescript
/** One counterfactual operation. The union is closed to the Stage 1 §2.6
 *  minimum set; a new operation type enters only by a recorded decision. */
type CounterfactualOperation =
  | { kind: "service-delta-years"; years: DecimalString } // e.g. "+1", "-1"
  | { kind: "averaging-period"; period: string } // a documented alternative period
  | { kind: "formula-version"; formulaId: EntityId } // a documented historical formula
  | { kind: "vesting"; mode: "applied-once" | "not-applied" | "applied-twice-diagnostic" }
  | { kind: "rounding-sequence"; sequence: RoundingSequence } // §4.4, hypothesis only
  | { kind: "cap"; cap: "service-cap" | "compensation-cap" | "section-415-limit";
      applied: boolean }
  | { kind: "freeze"; respected: boolean } // diagnostic only; the freeze is binding
  | { kind: "prior-distribution"; deducted: boolean };

/** A tested hypothesis: the operation, the recomputed benefit, the residual
 *  discrepancy, and the support class. Ranking (by evidence and explanatory
 *  power, not numerical proximity) belongs to the reconciliation module. */
interface CounterfactualResult {
  operation: CounterfactualOperation;
  /** The explanation this tests (H1–H17, MASTER_PROMPT §10). */
  hypothesisCode: string; // e.g. "H2", "H4", "H15"
  /** Recomputed benefit under the counterfactual, or null when the
   *  counterfactual cannot be evaluated. */
  benefit: TypedBenefitQuantity | null;
  /** Residual discrepancy after the counterfactual (Δ under the
   *  counterfactual), or null when not computable. */
  residualDelta: Money | null;
  /** Support class (Stage 1 output 03, §2.6): Supported / Plausible /
   *  Coincidence / Refuted. A Coincidence is never presented as an
   *  explanation and never moves a disposition to Verified. */
  supportClass: "supported" | "plausible" | "coincidence" | "refuted";
  /** Evidence for and against, with precise citations. */
  evidenceFor: string[];
  evidenceAgainst: string[];
}

/** Tests one counterfactual: re-runs the pipeline on a copy of the request
 *  with the operation applied, and returns the result. The base calculation
 *  is untouched. */
declare function testCounterfactual(
  request: CalculationRequest,
  operation: CounterfactualOperation
): CounterfactualResult;
```

**Multiple-hypothesis rule.** When two hypotheses both resolve the discrepancy, both are
recorded and ranked; the system does not silently pick one. If they imply different
corrected benefits, the disposition cannot be Correction recommended (Stage 1 output 03,
§2.6).

---

## 7. The typed benefit quantity — output type of every calculation function

Every calculation function in this document returns a `TypedBenefitQuantity` (or a bounds /
indeterminate outcome built from them). The interface below is restated here because this
document owns the calculation-function contract; **output 01, §5 is canonical** and governs
in case of any difference.

```typescript
/** Annuity form. Values are BCV FORM_CODE values where the dictionary
 *  gives them; "unknown" is a valid stored value, never a default. */
type AnnuityForm =
  | "NSF" // Normal Single Form — value as in BCV FORM_CODE_NSF
  | "NMF" // Normal (automatic/married) form — value as in BCV FORM_CODE_NMF
  | string; // Any other BCV FORM_CODE value, copied exactly from the source.

/** Vesting treatment of a benefit amount. */
type VestingTreatment =
  | "gross"   // Before any vesting percentage is applied.
  | "vested"  // After the vesting percentage is applied (VP × gross).
  | "unknown"; // Not established. A valid stored value, never defaulted.

/** How the benefit's measurement date was established. */
type MeasurementBasis =
  | "dote"         // Measured at DOTE (the dictionary's stated basis for PA_AMB).
  | "dopt"         // Measured at DOPT.
  | "nrd"          // Measured at NRD.
  | "other-stated" // Measured at another stated date (date in `measurementDate`,
                   // description in `basisNote`).
  | "unresolved";  // No measurement date established. No Δ is computed.

/** Where a benefit quantity came from, and what state it is in. */
type BenefitSource =
  | "prior-administrator"     // Reported by the prior administrator (PA_AMB).
  | "bcv-calculated"          // A BCV Calculated field (e.g. BCV1.AMB), cross-check only.
  | "independent-calculation" // Computed by this system's engine.
  | "bound"                   // A justified bound (B_i^min or B_i^max), not an exact benefit.
  | "scenario";               // One named scenario's value, not the benefit.

type BenefitStatus =
  | "recorded"       // Reported and stored; not yet compared.
  | "calculated"     // Independently calculated; trace available.
  | "compared"       // Compared against another benefit on an equivalent basis.
  | "not-comparable" // Bases not equivalent (incl. unresolved measurement basis).
  | "indeterminate"; // No defensible value could be produced.

/** THE typed benefit quantity. Every benefit in the system is one of these.
 *  Two benefits are comparable only when their bases are equivalent
 *  (output 01, §5.3): same periodicity (or recorded conversion), same
 *  measurement date (or documented conversion), same annuity form (or
 *  documented conversion), same vesting treatment (or documented
 *  conversion), same plan version, and neither unresolved. */
interface TypedBenefitQuantity {
  /** Monetary amount, integer minor units. null when no amount exists
   *  (missing observation, or indeterminate — never 0 by default). */
  amount: Money | null;
  /** "monthly" for PA_AMB and AMB; "annual" where a source states annual. */
  periodicity: "monthly" | "annual";
  /** Date the benefit is measured through. null when unresolved. */
  measurementDate: DateString | null;
  /** How the measurement date was established. */
  measurementBasis: MeasurementBasis;
  /** Free text only when measurementBasis is "other-stated". */
  basisNote: string | null;
  /** Benefit commencement basis (e.g. "payable at NRD"). null when not established. */
  commencementBasis: string | null;
  /** Normal retirement age (years, may be fractional per plan) or null. */
  retirementAge: number | null;
  /** Normal retirement date, or null when not established. */
  retirementDate: DateString | null;
  /** Annuity form. "unknown" is valid; a form is never assumed. */
  annuityForm: AnnuityForm | "unknown";
  /** Vesting treatment. "unknown" is valid; never assumed. */
  vestingTreatment: VestingTreatment;
  /** The PlanVersion whose provisions govern this benefit. */
  planVersionId: EntityId | null;
  /** The Formula whose definition produced (or would produce) this benefit. */
  formulaId: EntityId | null;
  /** Source and status. */
  source: BenefitSource;
  status: BenefitStatus;
  /** The BenefitObservation or BenefitCalculation this quantity belongs to. */
  ownerId: EntityId;
}
```

**The six typed benefits (MASTER_PROMPT §3; output 01, §5.2).** B1 accrued benefit, B2
vested accrued benefit (`VP × B1`), B3 projected benefit, B4 benefit payable at
commencement, B5 PBGC guaranteed benefit, B6 PBGC termination benefit. They are not
interchangeable. A `BenefitObservation` holds a B1 claim only; B5 and B6 are out of scope
for this system (downstream) and are not modelled here. If a prior-administrator schedule
states a projected or payable-at-commencement amount, that is recorded as a
`DiagnosticHypothesis`, not by relabelling the observation.

**BCV cross-checks.** BCV1.AMB (Calculated, at DOTE) and the `TERM_MB_*` / `XRD_MB_TERM`
fields are stored as `TypedBenefitQuantity` values with `source: "bcv-calculated"` on the
`BenefitCalculation` as `bcvCrossChecks`. They are different bases from PA_AMB (ERD/EURD/
NRD/XRD vs DOTE) and must never be compared to PA_AMB without a basis conversion.

---

## 8. Worked synthetic example — exact reconstruction

*Fictional participant, fictional plan. No real data. All numbers synthetic.*

**Setup.** Fictional plan "Plan A (synthetic)": unit-credit formula, accrual rate
α = 1.5% of final-3-year average monthly compensation per year of credited service,
payable monthly as a straight-life annuity at normal retirement age 65. No cap, no freeze,
no offset, no grandfathering in effect for this participant. Rounding prescribed: final
monthly benefit to the nearest cent, half-up; no other rounding prescribed.

**Participant SYN-001 (fictional).** Hired 2000-03-01, terminated employment (DOTE)
2020-02-29. Credited service 20 years (documented, no breaks). Final 3 years' monthly
compensation: 2017: $4,800; 2018: $5,000; 2019: $5,200. Recorded PA_AMB: $1,500.00.
Measurement basis: DOTE, established from the administrator's benefit schedule
(synthetic source citation: "PA benefit schedule, p. 2"). Case tolerance (actuary-set):
τ_abs = $1.00/month, τ_rel = 0.1%, either-leg rule.

**Full trace (exact decimal throughout; money in integer cents):**

| Stage | Step | Computation | Result |
|---|---|---|---|
| 1 | Provisions | Plan version in effect at 2020-02-29: formula v1 (unit-credit 1.5%), final-3-year averaging, NRA 65 | Formula v1 selected |
| 2 | Eligibility | Participant from 2000-03-01; no exclusion applies | Eligible |
| 3 | Service | Credited service, 2000-03-01 to 2020-02-29, no breaks | S = 20 |
| 4 | Compensation | Average = (4800 + 5000 + 5200) / 3, exact decimal | C̄ = $5,000.00 |
| 5 | Base formula | B = α × S × C̄ = 0.015 × 20 × 5000.00 | $1,500.00/month |
| 6 | Protection | No grandfathering / greater-of applies; evaluated and not applied | $1,500.00 |
| 7 | Restrictions | No cap, no offset, no prior distribution; evaluated and not applied | $1,500.00 |
| 8 | Rounding | Final monthly benefit to nearest cent, half-up: 1500.00 → 1500.00 | $1,500.00 |
| 9 | NR basis | Already monthly, straight life, NRA 65; no conversion needed | $1,500.00 |
| 10 | Reconciliation | B̂ = $1,500.00; B^PA = $1,500.00; Δ = $0.00; D = $0.00; R = 0% | Within tolerance |

**Outcome.** `{ kind: "exact", benefit: TypedBenefitQuantity { amount: $1,500.00, periodicity:
"monthly", measurementDate: "2020-02-29", measurementBasis: "dote", annuityForm: "NSF",
vestingTreatment: "vested", source: "independent-calculation", status: "compared" } }`.
Δ_i = $0.00, within the case tolerance, basis established, no material unexplained item:
recommended disposition **Verified** (human reviewer decides).

**What the trace proves.** Every intermediate is inspectable: the service (20), the average
($5,000.00, with the three years shown), the formula inputs, the protections evaluated and
not applied, and the rounding operation (a no-op here, recorded as such). An auditor can
re-perform the calculation from the trace alone.

---

## 9. Worked synthetic example — bounds case (exact reconstruction impossible)

*Fictional participant, fictional plan. No real data. All numbers synthetic.*

**Setup.** Same fictional Plan A and formula as §8 (α = 1.5%, final-3-year average monthly
compensation, NRA 65). Case tolerance as §8; materiality threshold τ_material = $25.00/month
(actuary-set).

**Participant SYN-002 (fictional).** Hired 1998-06-01, terminated employment (DOTE)
2020-05-31. Credited service 22 years (documented). Final 3 averaging years: 2018: $4,800;
2019: $5,100; 2020: **missing** (class M3 — bounded, not recoverable from the documents
available). The missing year is bounded by documented facts: no less than $4,500 (lowest
monthly compensation in any known year for this participant) and no more than $5,400 (the
compensation cap in effect for that year, as stated in the plan's records). Recorded
PA_AMB: $1,620.00. Measurement basis: DOTE, established.

**Why exact reconstruction is impossible.** The 2020 compensation year is required for the
final-3-year average and is missing; no document recovers it. The pipeline's Stage 4
returns a `StageFailure` (`missing-input`, M3) and the pipeline takes the bounds path (§5).

**Bounds derivation.** The benefit is monotone increasing in the missing year's compensation
(verified: the formula is a positive multiple of the average; no cap, offset, or greater-of
applies in the feasible region — the cap threshold $5,400 is the upper bound itself, so
there is no internal kink to evaluate). Evaluating at the endpoints:

- Average at lower bound: (4800 + 5100 + 4500) / 3 = $4,800.00 →
  B^min = 0.015 × 22 × 4800.00 = **$1,584.00/month**.
- Average at upper bound: (4800 + 5100 + 5400) / 3 = $5,100.00 →
  B^max = 0.015 × 22 × 5100.00 = **$1,683.00/month**.

**Outcome.** `{ kind: "bounds", bounds: { min: $1,584.00, max: $1,683.00,
assumptions: ["2020 monthly compensation between $4,500 and $5,400",
"formula v1 (unit-credit 1.5%) applies to all service",
"no grandfathered floor applies to this participant"],
derivation: { method: "endpoint-evaluation", kinkPoints: [], monotonicity:
[{ input: "2020 compensation", monotone: true, verifiedBy: "formula structure" }] },
recordedPosition: "inside" } }`. Interval width $99.00, which exceeds τ_material
($25.00) — the uncertainty is material.

**Scenarios evaluated:** missing year at lower bound ($1,584.00); at upper bound
($1,683.00); at the average of known years, $4,950 (labelled assumption, $1,633.50).
None is presented as the benefit.

**Disposition.** B_i^PA ($1,620.00) lies inside the justified bounds — consistent with the
evidence — but the bounds are wide relative to materiality, so the recommended disposition
is **Requires investigation** (obtain the 2020 compensation year; class M3, recoverability
to be confirmed by a data request), not Supported for acceptance. If the 2020 year were
recovered and the reconstruction became exact, the disposition would be revisited. No
single made-up number was returned at any point.

---

## 10. Open decisions

| # | Decision | Why it is open | Owner / stage |
|---|---|---|---|
| OD-1 | **Decimal implementation.** `ScaledInt` implemented directly in the engine vs. a vendored decimal library. | Depends on Stage 3 proof: a library must be inlined as classic script, pinned, and pass reference tests under `file://`. | Stage 3–4 |
| OD-2 | **Service representation.** Credited service as exact decimal vs. rational (numerator/denominator). | Fractional service (part-time proration, partial years) needs a representation that survives exact arithmetic; the choice affects Stage 3 and the rounding rule for credited service. | Stage 4 |
| OD-3 | **Rounding mode list.** Whether the closed `RoundingMode` list (§4.2) is complete. | No PBGC source lists rounding modes; the six modes cover the documented cases, but a plan may prescribe another (e.g. round to nearest $5). Additions need a recorded decision, not a silent extension. | Stage 4 |
| OD-4 | **PA_AMB basis.** Annuity form and vesting treatment of PA_AMB are not stated in the dictionary. | Owned by Stage 1 output 02; until resolved per case, Stage 9 cannot establish the basis and the unresolved-basis rule (§1.4) governs. | Stage 2 (output 02) |
| OD-5 | **ε_R (small-denominator threshold).** Suggested starting value: the smallest monthly amount the plan can pay, or $1.00/month if none is documented. | Configurable, never hard-coded (Stage 1 output 03, §2.3); the actuary confirms the value per case. | Case configuration |
| OD-6 | **Kink-point discovery.** How the engine enumerates kink points for a formula it has not seen (caps, freezes, formula changes, greater-of switch points). | Endpoint-plus-kinks is only valid if every kink is found; an undiscovered kink makes a bound wrong. The formula catalog (§11) must state each formula's kink structure, or the engine must fall back to grid/optimisation. | §11 / Stage 4 |
| OD-7 | **Counterfactual scope.** Whether the §6.2 closed operation list is sufficient, in particular whether "alternative measurement date" (a re-basing, not a counterfactual) belongs in it or only in the scenario set. | A different measurement date changes the comparison basis; treating it as a counterfactual risks comparing amounts on different bases. | Stage 5 |
| OD-8 | **WASM kernels for bounds/sensitivity sweeps.** Bounds derivation evaluates the pipeline at many points; a 100,000-participant case makes that expensive. | Option C staging: TypeScript first; a Rust/WASM kernel only where Stage 5 profiling proves a bottleneck and Stage 3 proves the loading path, with a JS fallback. | Stage 3 / Stage 5 |
| OD-9 | **Rounding-sequence provenance.** Where an alternative rounding sequence's source is recorded when it comes from an administrator's workpaper rather than the plan. | `RoundingRule.source` carries the citation; the case package must also record which workpaper version it came from, so a later workpaper revision does not silently change the hypothesis set. | Stage 2 (data model) |

---

## 11. Formula catalog

*The 34 formula types from Stage 1 output 01, as typed functions. Merged from the companion catalog; section numbers §0–§9 below are the catalog's own numbering. Each formula plugs into Stage 5 (`calculateBaseBenefit`) and states its kink structure for the bounds derivation (§5.2, OD-6).*

### 0. How to read this file

- **Scope.** The 34 formula types from Stage 1 output 01, as typed functions. Formula IDs (T-01–T-09, I-01–I-05, C-01–C-07, S-01–S-08, X-01–X-05) are unchanged so the spec traces to output 01. Nothing was dropped or merged.
- **What a signature is.** Each entry gives the function's TypeScript signature, its inputs with units, its output, and its authority / effective period / scope / exceptions, in compact form. Signatures are design contracts, not runnable code: no function body is specified here.
- **Output type.** Every formula returns `CalcResult<TypedBenefitQuantity>`. `TypedBenefitQuantity` is defined in `01-data-model.md` §5 (amount + periodicity, measurement date, commencement basis, retirement age/date, annuity form, vesting treatment, plan-provision version, source + status) and is **not** redefined here.
- **Standing requirement (most important).** The app must still produce reliable actuarial calculations and documented acceptance decisions when exact historical reconstruction is impossible. Every entry therefore ends with an **If inexact** line: the bound or scenario set that replaces the exact value (Stage 1 item 11). A formula that cannot be evaluated returns `indeterminate`, never a made-up exact number and never a silent failure.
- **Comparison pair.** `PA_AMB` ("Plan Administrator Accrued Monthly Benefit at DOTE", BCV9, Input, NUMBER) vs `AMB` (`BCV1.AMB`, Calculated), both "at DOTE" (termination of employment, ≠ DOPT). The dictionary does **not** state PA_AMB's annuity form, vesting treatment, NRD/age basis, rounding, or what a blank means — none is assumed anywhere in this catalog. `BCV3.PA_AMB_ACCEPT` (Y/N) is the only accept-decision flag; it carries no criterion.
- **Money and arithmetic.** All money amounts are `Decimal` (decimal-safe arithmetic, integer minor units internally; MASTER_PROMPT §8). Binary floating point never affects monetary rounding. Annual benefits convert to monthly by ÷12 unless the plan states otherwise.
- **Synthetic test examples.** Each Stage 1 entry's item (10) test example is **not** repeated here; it lives in `stage1/01-formula-classification.md` under the same ID. Stage 3/4 tests must use those examples (or independently verified synthetic cases) as fixtures.
- **No invented names.** Every code, table, and level named below comes from a PBGC source cited in Stage 1. Where a value is referenced but not embedded (e.g. covered-compensation tables), the entry says so and the missing table is an open decision (§9).

### 1. Common types used by every signature

```ts
/** Decimal-safe money / rate value. Never a binary float. Amounts in USD ($/month or $/year as stated). */
type Decimal = string;

/** Years of service; may be fractional. Never rounded to whole years unless the plan says so. */
type ServiceYears = Decimal;
/** Compensation, $/year, already capped per-year at the §401(a)(17) limit for that year where X-02 applies. */
type CompensationAnnual = Decimal;
/** Monthly benefit amount, $/month. */
type MonthlyBenefit = Decimal;

type EvidenceGrade = "fact" | "assumption" | "estimate" | "unknown";

/** Shared calculation context: the plan-version in force, the measurement date, and plan-stated rounding. */
interface CalcContext {
  planVersionId: string;      // PlanVersion.versionId (01-data-model.md §7); pins P(t). Never "latest".
  measurementDate: string;    // ISO date t in B_i(t) = F(X_i(≤t), P(≤t)).
  rounding: RoundingSpec;      // Plan-stated rounding; see §2. No default rounding is assumed.
}

/** Plan-stated rounding only. No universal PBGC benefit-rounding policy was found (Stage 1 §11). */
interface RoundingSpec {
  stage: "per-operation" | "per-annual-accrual" | "per-intermediate" | "final-only";
  mode: "nearest-dollar" | "nearest-cent" | "truncate" | "none";
  source: string;               // Plan-document section, or "unknown" — never an invented default.
}

/** A named alternative outcome, for scenario results. */
interface NamedScenario<T> { name: string; value: T; basis: string; }

/**
 * First-class result of every formula function. `exact` only when the evidence supports an exact
 * number. Otherwise a bound, an explicit scenario set, or indeterminate — with the missing inputs
 * named so the system can say what would resolve it. Dispositions (Verified / Supported for
 * acceptance / Requires investigation / Correction recommended / Indeterminate) are human decisions
 * recorded on ActuarialDecision; they are NOT returned by these functions.
 */
type CalcResult<T> =
  | { kind: "exact"; value: T; evidenceGrade: EvidenceGrade }
  | { kind: "bound"; min: T; max: T; evidenceGrade: "estimate"; missingInputs: string[] }
  | { kind: "scenarios"; scenarios: NamedScenario<T>[]; evidenceGrade: "estimate"; missingInputs: string[] }
  | { kind: "indeterminate"; evidenceGrade: "unknown"; missingInputs: string[]; wouldResolve: string[] };

/** A dated plan provision in force at the measurement date: value + the PlanVersion that supplies it. */
interface DatedValue<T> { value: T; effectiveFrom: string; planVersionId: string; }
```

**Result-type conventions.** (a) `TypedBenefitQuantity.source` is `"independent-calculation"` for an exact value, `"bound"` / `"scenario"` for the other kinds. (b) A bound's `min`/`max` are `TypedBenefitQuantity` values on the same basis (same form, age, vesting, version) — a bound across bases is a scenario set, not a bound. (c) `indeterminate` carries no number at all. (d) Every function must enforce the §3.3 anti-decrease guardrails from Stage 1 (IRC §411(b)(1)(G), §411(d)(6), §411(a)(9)) as a post-condition check and report a guardrail violation as `indeterminate` with the violation named, never as a silently reduced benefit.

### 2. Traditional formulas (T-01–T-09)

#### T-01 — Flat-dollar benefit

```ts
function calcFlatDollar(ctx: CalcContext, p: {
  flatAmount: DatedValue<MonthlyBenefit>;  // D, $/month (or $/year — state which; converted by ÷12 if annual)
  service: ServiceYears;                  // S_t, years through t
  fullService: ServiceYears;              // S_full, years required for the unreduced flat benefit
}): CalcResult<TypedBenefitQuantity>;
// B_t = D × (S_t / S_full); if the plan states no service reduction, B_t = D. Output: B1, monthly, normal form at NRD.
```

- **Authority:** DBAB Q 9:3 (flat/fixed formula); Q 9:7 (accrued benefit); IRC §411(a)(7)(A)(i).
- **Period / scope / exceptions:** `D` is the amount in effect under `P(t)` at the measurement date; later amendments increasing `D` apply only as the amendment provides (see C-04/C-05). `S_t ≥ S_full` ⇒ full `D`, no extra benefit unless the plan says so. Accrual must satisfy an IRC §411(b)(1) test; the fractional rule is the usual method for flat formulas (see T-07).
- **If inexact:** if `D` at `t` is unknown, return `bound` over the known candidate `D` values in `P(t)`; if `S_full` is unknown, return `scenarios` over the plausible values (commonly 25 or 30). Never pick one `D` and present it as exact.

#### T-02 — Fixed-percentage-of-compensation benefit

```ts
function calcFixedPercentage(ctx: CalcContext, p: {
  percent: DatedValue<Decimal>;            // p, fraction (e.g. 0.75), not a percent integer
  avgComp: CompensationAnnual;            // C̄_t, $/year, over the plan's averaging period
  service: ServiceYears;                  // S_t, years
  fullService: ServiceYears;              // S_full, years
}): CalcResult<TypedBenefitQuantity>;
// B_t = p × C̄_t × (S_t / S_full), annual; ÷12 monthly. Output: B1, monthly, normal form at NRD.
```

- **Authority:** DBAB Q 9:3, Ex. 2; Q 9:37–9:45 (compensation definitions); IRC §414(s), §401(a)(17).
- **Period / scope / exceptions:** `p` and the averaging period are those in `P(t)`; a change in `p` is an amendment subject to §411(d)(6) (C-04). The §401(a)(17) cap applies per compensation year (X-02). A falling `C̄_t` may reduce `B_t` only via the DBAB Q 9:15 compensation-decrease channel.
- **If inexact:** if the averaging period is unknown, return `scenarios` over the plausible periods (final 3-year, highest 3-year, final 5-year, career — T-05/T-06); if compensation years are missing, return `bound` over bounded fills of `C̄_t` (lowest/highest plausible fill). Never fill a missing year with zero unless the plan rule requires it.

#### T-03 — Dollar-per-year-of-service benefit

```ts
function calcDollarPerYear(ctx: CalcContext, p: {
  unitRate: DatedValue<MonthlyBenefit>;    // d, $/month per year of service (or $/year per year — state which)
  service: ServiceYears;                  // S_t, years (possibly fractional, per the plan's service-crediting rule)
  periodRates?: { from: string; to: string; rate: MonthlyBenefit }[]; // if d varies by period (see C-06)
  serviceCap?: ServiceYears;              // S_max, if any (see T-09)
}): CalcResult<TypedBenefitQuantity>;
// B_t = d × S_t; with period rates, B_t = Σ_p d_p × S_{t,p}. Output: B1, monthly, normal form at NRD.
```

- **Authority:** DBAB Q 9:4, Ex. 2; Q 9:10, Ex. 2; PBGC current policies Ex. 17 (PC3 §411(d)(6) wear-away); DBAB Ch. 7 (service measurement). The most common formula in PBGC trusteed plans ("Accrued monthly benefit = YOS × benefit rate").
- **Period / scope / exceptions:** `d` is the rate in effect for each service period under `P(t)`; a rate change mid-career does not re-price earlier service unless the amendment says so. A rate decrease protects the pre-decrease accrual (C-04/C-05). Prior distributions offset the benefit (I-05).
- **If inexact:** if the historical `d` schedule is incomplete, return `bound` over `[d_min, d_max] × S_t` for the documented rates; if `S_t` is uncertain (e.g. pre-break service disputed, S-08), return `bound` over the service scenarios. A single-point estimate from an assumed `d` is not a reconstruction.

#### T-04 — Unit-credit benefit (percentage of compensation per year of service)

```ts
function calcUnitCredit(ctx: CalcContext, p: {
  accrualRate: DatedValue<Decimal>;        // α, fraction of compensation per year (e.g. 0.01, 0.02)
  avgComp: CompensationAnnual;            // C̄_t, $/year, measured as of t (current average, not projected)
  service: ServiceYears;                  // S_t, years
  serviceCap?: ServiceYears;              // S_max, if any (see T-09)
}): CalcResult<TypedBenefitQuantity>;
// B_t = α × C̄_t × S_t, annual (MASTER_PROMPT §4 canonical form B_t = α S_t C̄_t); ÷12 monthly. Output: B1.
```

- **Authority:** DBAB Q 9:4; Q 9:10; Q 10:17 (first safe harbor — unit-credit plans); IRC §411(b)(1)(A)–(B). The §411(b)(1) 3% and 133⅓% tests are the natural accrual tests for this method (DBAB Q 9:12).
- **Period / scope / exceptions:** `α` and the compensation definition are those in `P(t)`. Step rates (T-08) are a generalisation. §415 (X-01) and §401(a)(17) (X-02) cap the result. Do not import the PF 4-decimal factor convention into benefit rounding.
- **If inexact:** unknown `α` history and unknown `C̄_t` are independent failure modes — return `bound` as the product of the input bounds and name which input drives the width. Do not collapse to a midpoint and call it the benefit.

#### T-05 — Career-average compensation benefit

```ts
function calcCareerAverage(ctx: CalcContext, p: {
  accrualRate: DatedValue<Decimal>;        // α, fraction per year
  compByYear: { year: number; comp: CompensationAnnual }[]; // C_y, $/year, each already §401(a)(17)-capped (X-02)
  service: ServiceYears;                  // S_t, years
}): CalcResult<TypedBenefitQuantity>;
// B_t = α × C̄_t^career × S_t, where C̄_t^career = (1/S_t) Σ_y C_y; equivalently B_t = α × Σ_y C_y (year-by-year
// form — the safer implementation, preserving the per-year §401(a)(17) cap). Output: B1, monthly.
```

- **Authority:** DBAB Q 9:12 (fractional rule "will not be satisfied" if the average exceeds 10 years — career-average plans cannot use fractional accrual); Q 10:18; IRC §411(b)(1)(C).
- **Period / scope / exceptions:** **The fractional accrual method does not apply** to career-average plans (average period > 10 years); the accrued benefit must be determined by unit credit or another method satisfying an accrual test. Each year's compensation is capped at that year's §401(a)(17) limit. A plan may define career average over compensation *while a participant*, excluding pre-participation years.
- **If inexact:** missing compensation years are the norm in old cases — do not invent them. Return `bound`: lower bound at the lowest plausible value supported by evidence (e.g. the plan's minimum or the lowest observed year in the same era, stated as an assumption); upper bound at the highest plausible value (e.g. that year's §401(a)(17) cap, or the highest observed year). If the bound is wider than the acceptance tolerance, the result is `indeterminate` for that participant, with a data request for the missing years.

#### T-06 — Final-average / highest-average compensation benefit

```ts
function calcFinalOrHighestAverage(ctx: CalcContext, p: {
  accrualRate: DatedValue<Decimal>;        // α, fraction per year
  windowYears: number;                    // n, commonly 3 or 5
  windowKind: "highest" | "final";        // plan term — the two differ whenever pay falls late in the career
  compByYear: { year: number; comp: CompensationAnnual }[]; // C_y, each already §401(a)(17)-capped (X-02)
  service: ServiceYears;                  // S_t, years
  shortWindowRule?: string;               // plan's rule when the participant has fewer than n years, if any
}): CalcResult<TypedBenefitQuantity>;
// B_t = α × C̄_t^(n) × S_t, where C̄_t^(n) is the average of the highest (or final) n consecutive years through t.
```

- **Authority:** DBAB Q 9:4, Ex. 1; Q 9:10, Ex. 1; Q 9:50–9:52 (§401(a)(17) averaging); Q 10:32 (average annual compensation).
- **Period / scope / exceptions:** each year in the window is capped at its own year's §401(a)(17) limit. A change in `n` is an amendment (fresh-start rules may apply — C-05). A falling average can reduce `B_t` (DBAB Q 9:15 — flagged hypothesis, not a routine outcome). Short-service participants: the plan's short-window rule must be found in the document; if absent, the window is an open item.
- **If inexact:** if window years are partly missing, return `scenarios`: (i) window = the known years only (plan's short-window rule, if any); (ii) window completed with bounded fills. If "highest" vs "final" is undocumented, compute both — the difference is itself a diagnostic (if PA_AMB matches one and not the other, that identifies the administrator's convention).

#### T-07 — Fractional accrual

```ts
function calcFractionalAccrual(ctx: CalcContext, p: {
  projectedBenefit: CompensationAnnual;    // B_t^proj, $/year at NRD on current compensation (assumed to continue to NRA)
  service: ServiceYears;                  // S_t, years (benefit, participation, or participation + pre-participation, per plan)
  projectedService: ServiceYears;         // S_t^proj, total service the participant would have at NRD
  partialYearRatio?: Decimal;             // accrual ratio after a partial year of participation (DBAB Q 9:9), if applicable
}): CalcResult<TypedBenefitQuantity>;
// B_t = B_t^proj × (S_t / S_t^proj). Output: B1, monthly. This method accrues in equal portions over total service.
```

- **Authority:** DBAB Q 9:8 (fractional method); Q 9:9 (partial-year rule, Rev. Rul. 81-11); Q 9:12 (fractional rule); Q 10:18–10:19 (safe harbors); Treas. Reg. §1.411(b)-1(b)(3); IRC §411(b)(1)(C).
- **Period / scope / exceptions:** not available for career-average plans (average > 10 years — T-05). **Partial years:** the accrued benefit must be at least the "fractional rule benefit" × an "accrual ratio" that ratchets forward after a partial year (DBAB Q 9:9, Ex. 1: ratio .1125 after a half year, .1379 the next full year; Ex. 2 alternative: 5.5/39.5 = .1392). A plan that simply uses `S_t/S_t^proj` with fractional `S_t` may under-accrue after a partial year. The denominator may not exceed the plan's service cap (DBAB Q 9:21, Ex. 2: denominator capped at 30).
- **If inexact:** the fragile input is `S_t^proj` — for a terminated participant it is a counterfactual (would they have stayed to NRA?). If the plan's projected-service convention is undocumented, return `scenarios`: (i) service to NRA at the hire-date pattern; (ii) service to NRA capped at the plan maximum; (iii) service frozen at DOTE. A PA_AMB match to one scenario is evidence for the administrator's convention — recorded as a hypothesis, not a verified fact.

#### T-08 — Step-rate / tiered service formulas

```ts
function calcStepRate(ctx: CalcContext, p: {
  bands: { fromService: ServiceYears; toService: ServiceYears | null; rate: DatedValue<Decimal> }[];
  avgComp: CompensationAnnual;            // C̄_t, $/year (percentage form); omit for the dollar form
  service: ServiceYears;                  // S_t, years, split into bands by the function
  dollarRates?: { fromService: ServiceYears; toService: ServiceYears | null; rate: MonthlyBenefit }[];
}): CalcResult<TypedBenefitQuantity>;
// Percentage form: B_t = C̄_t × Σ_k α_k × S_{t,k}. Dollar form: B_t = Σ_k d_k × S_{t,k}. Output: B1, monthly.
```

- **Authority:** DBAB Q 9:12, Ex. 1 (1% / 1.4% / 1.65% tiers, 3% rule test); Q 10:17 (first safe harbor example: 2% / 1.5% / 2% tiers); IRC §411(b)(1)(B) (133⅓% rule — a later band's rate may not exceed 133⅓% of any earlier band's rate).
- **Period / scope / exceptions:** bands are defined by service (an age-banded rate is a different predicate and must not be confused with a service band). An amendment changing a band rate protects accruals already earned in that band (§411(d)(6)). The **133⅓% rule** is binding: e.g. 1% then 1.5% fails (150% > 133⅓%) — DBAB Q 9:12, Ex. 2. A tiered formula that violates it is not a valid qualified formula. Bands defined by compensation level are integration (I-01), not this entry.
- **If inexact:** if band boundaries are undocumented, the service split is unknown — return `bound` between the all-lowest-rate and all-highest-rate extremes (usually too wide to accept). Fallback is the *pattern* test: if PA_AMB is consistent with only one band split among the plausible ones, that split becomes a documented hypothesis (ranked by evidence), and the disposition stays **Requires investigation** until the plan document confirms it.

#### T-09 — Maximum credited-service limits

```ts
function calcServiceCapped<T extends CalcResult<TypedBenefitQuantity>>(
  ctx: CalcContext,
  p: {
    serviceCap: DatedValue<ServiceYears>;  // S_max, years — a plan term, not a statutory limit (X-01/X-02 are statutory)
    service: ServiceYears;                // S_t, years
    whichYears: "last-n" | "first-n" | "plan-rule"; // which years the cap selects (Blonder-Tongue: last 30 before termination)
    underlying: (cappedService: ServiceYears) => T; // any of T-01–T-08 evaluated with service capped
  }
): T;
// B_t = F(C̄_t, min(S_t, S_max)) — the underlying formula F evaluated with service capped. The cap applies to
// service counted, not to the benefit directly.
```

- **Authority:** DBAB Q 9:21 (service limits; flat-formula denominator cap); Blonder-Tongue plan §5.01 (30-year cap, "30 years immediately preceding termination of employment").
- **Period / scope / exceptions:** the cap in effect at `t` under `P(t)`; a cap introduced by amendment protects prior accruals (C-04). In a final-average plan the benefit can still grow after the cap through `C̄_t` increases (DBAB Q 9:21, Ex. 1). A cap on service is not a cap on compensation. For flat formulas the *denominator* of the fractional accrual is capped, not the numerator alone (DBAB Q 9:21, Ex. 2).
- **If inexact:** if `S_max` is unknown, return `bound` between `F(S_t uncapped)` (max) and `F(min plausible cap)` (min). If the *which-years* rule is unknown (last-N vs first-N), return `scenarios` for both: in a period-rated plan (C-06) they differ materially, and the difference is a diagnostic, not a rounding error.

### 3. Integrated formulas (I-01–I-05)

General note (Stage 1 §6): integration is where PA_AMB verification most often fails on *inputs* rather than arithmetic. Covered compensation, PIA, and offset levels are non-census inputs (MASTER_PROMPT §6) sourced from SSA tables, the plan document, or the administrator's schedule — and their absence is the commonest reason for an **Indeterminate** disposition on an integrated formula.

#### I-01 — Excess benefit formula

```ts
function calcExcessBenefit(ctx: CalcContext, p: {
  baseRate: DatedValue<Decimal>;           // β_b, fraction per year below the integration level
  excessRate: DatedValue<Decimal>;         // β_e, fraction per year above the integration level
  integrationLevel: DatedValue<CompensationAnnual>; // L, $/year (fixed dollar level, or covered comp — see I-02)
  avgComp: CompensationAnnual;            // C̄_t, $/year
  service: ServiceYears;                  // S_t, years
  fullService?: ServiceYears;             // S_full, years — flat form only
  form: "unit-credit" | "flat";
}): CalcResult<TypedBenefitQuantity>;
// Unit-credit: B_t = [β_b × min(C̄_t, L) + β_e × max(C̄_t − L, 0)] × S_t.
// Flat: B_t = [β_b × min(C̄_t, L) + β_e × max(C̄_t − L, 0)] × (S_t / S_full). Output: B1, monthly.
```

- **Authority:** DBAB Q 9:5 (excess fixed and excess unit-credit examples); Q 10:26–10:30 (permitted disparity); Treas. Reg. §1.401(l)-3.
- **Period / scope / exceptions:** plan is an excess plan under IRC §401(l); the excess rate must satisfy the permitted-disparity limits (I-03). `L` and the rates are those in `P(t)`; if `L` is covered compensation it changes annually by birth year (I-02). If `C̄_t ≤ L`, the formula collapses to the base rate — an administrator's number consistent with the base rate alone may mean the participant was below the integration level, not that integration was ignored.
- **If inexact:** if `L` is unknown, return `bound` between the all-base-rate value (`β_b × C̄_t × S_t`) and the all-excess-rate value (`β_e × C̄_t × S_t`). If `C̄_t` is near the plausible range of `L`, the bound is wide and the case is indeterminate on this formula alone — the data request is for the plan's integration level, a single document fact that collapses the range.

#### I-02 — Covered-compensation integration

```ts
function calcCoveredCompIntegration(ctx: CalcContext, p: {
  baseRate: DatedValue<Decimal>;           // β_b, fraction per year
  excessRate: DatedValue<Decimal>;         // β_e, fraction per year
  birthYear: number;                      // participant's birth year — required; never estimated from age bands
  calculationDate: string;                // date the covered-compensation table is determined as of
  coveredCompTable: CoveredCompTable;     // IRS-published table for the calculation year (loaded, versioned — §5)
  avgComp: CompensationAnnual;            // C̄_t, $/year
  service: ServiceYears;                  // S_t, years
}): CalcResult<TypedBenefitQuantity>;
// Same structure as I-01 with L = CC_i(t): the average of the Social Security taxable wage bases over the
// participant's working lifetime (or 35 years if less), determined by birth year and calculation date.
```

- **Authority:** DBAB Q 9:5 ("The average of the taxable wage bases is known as covered compensation"); Q 10:31–10:35 (covered compensation); IRC §401(l).
- **Period / scope / exceptions:** plan uses covered compensation as its integration level (the common case) rather than a fixed dollar level. Covered compensation is determined as of the benefit calculation date and changes when the table is updated; a later table must not be applied to an earlier calculation date. **IRC §401(a)(15) prohibits reducing an accrued benefit because covered compensation or the taxable wage base increased, for anyone separated after 1974-09-02** (DBAB Q 9:16–9:17). If a reconstruction shows `B_t` falling as `CC` rises for a separated participant, the reconstruction is wrong — or the administrator's number is. Rev. Rul. 84-45 limits offsets when estimated (not actual) wage history is used.
- **If inexact:** if birth year is missing, `CC` is unknown — return `indeterminate` (the bound over the plausible birth years is the widest in the system). **Do not estimate a birth year from age bands.** The data request is a single field. If the table for the calculation year is not loaded, the function fails loudly (`indeterminate`, missing input = the table) — never substitute a neighbouring year.

#### I-03 — Social Security permitted disparity (IRC §401(l))

```ts
function calcPermittedDisparity(ctx: CalcContext, p: {
  method: "excess" | "offset";             // plan's disparity method, per the plan document
  baseRate: DatedValue<Decimal>;           // β_base (excess) or γ_gross (offset), fraction per year
  excessOrOffsetRate: DatedValue<Decimal>; // β_excess or γ_offset, fraction per year
  level: DatedValue<CompensationAnnual>;   // L, $/year (integration or offset level)
  avgComp: CompensationAnnual;            // C̄_t, $/year
  service: ServiceYears;                  // S_t, years — max 35 years counted for disparity purposes
}): CalcResult<TypedBenefitQuantity>;
// Excess: B_t = [β_base × C̄_t + β_excess × max(C̄_t − L, 0)] × S_t, β_excess ≤ min(0.75%, β_base)
//   (allowance adjusted when the integration level exceeds covered compensation).
// Offset: B_t = [γ_gross × C̄_t − γ_offset × min(C̄_t, L)] × S_t,
//   γ_offset ≤ min(0.75%, ½ γ_gross × C̄_t / min(C̄_t, L)). Output: B1, monthly.
```

- **Authority:** DBAB Q 10:25 (two-step unit-credit formula); Q 10:26 (permitted disparity); Q 10:27–10:30 (integration level, offset level, maximum excess/offset allowances); IRC §401(l); Treas. Reg. §1.401(l)-3; DBAB Ch. 11.
- **Period / scope / exceptions:** plan is a §401(l) plan; disparity provided on a uniform basis (Treas. Reg. §1.401(l)-3(f)). If `β_base < 0.75%`, the maximum excess allowance is `β_base`, not 0.75% (DBAB Q 10:29 example: base 0.5% ⇒ excess allowance 0.5%). Service beyond 35 years earns no additional disparity. Uniformity: a benefit, right, or feature provided on excess compensation must also be provided below the level (DBAB Q 10:26, Wacky Widgets example). The 0.75% allowances are exact percentages — do not round `0.75%` to `0.8%`.
- **If inexact:** if the plan's integration level is a fixed dollar amount that is undocumented, the bound is the same as I-01. If the plan's disparity *method* (excess vs offset) is undocumented, return `scenarios` for both — they are algebraically close by construction (DBAB Q 9:5: excess and offset examples give `$16,429` identically in the fixed form), so a match to either does not identify the method; record the method as unresolved and the amount as supported-only-if-both-agree.

#### I-04 — Primary Insurance Amount (PIA) offsets

```ts
function calcPiaOffset(ctx: CalcContext, p: {
  grossBenefit: MonthlyBenefit;            // B_t^gross, $/month, before offset (computed by a T-/C- formula)
  pia: DatedValue<MonthlyBenefit>;         // PIA_t, $/month — units must match the gross benefit
  offsetFraction: DatedValue<Decimal>;     // γ, fraction of PIA offset
  service: ServiceYears;                  // S_t, years
  prorateDenominator?: ServiceYears;      // S_ref, years, if the plan prorates the offset by service
  piaBasis: "actual-wage-history" | "estimated-per-plan"; // plan's PIA determination method, documented
  socialSecurityActVersion: string;       // BCV IACT — which Social Security Act version applies
}): CalcResult<TypedBenefitQuantity>;
// B_t = B_t^gross − γ × PIA_t × (S_t / S_ref), floored at zero unless the plan provides otherwise.
// Some plans offset a flat percentage of PIA with no proration; the plan term governs.
```

- **Authority:** DBAB Q 9:6 (PIA offset formula); Q 9:16 (Rev. Rul. 84-45; IRC §401(a)(15)); BCV `IACT`, `PIASSNRA` (PIA-related add-in inputs).
- **Period / scope / exceptions:** plan contains a PIA-offset formula; PIA is the participant's Social Security benefit, estimated or actual per the plan. **Never offset with an estimated PIA in a way that forfeits accrued benefits:** Rev. Rul. 84-45. **Never reduce a separated participant's accrued benefit because the offset grew** (IRC §401(a)(15), DBAB Q 9:16). The offset applies to the accrued benefit, not to the projected benefit, unless the plan says otherwise. PIA is a whole-dollar monthly amount under SSA rules; do not round the offset before subtracting unless the plan says so.
- **If inexact:** PIA is very often unreconstructable from census data alone (it needs the full SSA wage history). Return `bound`: lower bound uses the maximum plausible PIA (largest offset ⇒ smallest benefit), upper bound the minimum plausible PIA — with the plan's PIA estimation method as the documented middle scenario if the plan states one. If no PIA evidence exists at all, return `indeterminate`; the data request is the administrator's PIA worksheet, not a re-estimate by the system.

#### I-05 — Other plan-specific offsets (floor-offset, prior distributions, other-plan offsets)

```ts
function calcPlanOffset(ctx: CalcContext, p: {
  grossBenefit: MonthlyBenefit;            // B_t^gross, $/month — must satisfy §411(b)(1) on its own (Rev. Rul. 76-259)
  offsetKind: "floor-offset-dc" | "prior-distribution" | "other-plan";
  // Floor-offset inputs:
  dcBalance?: Decimal;                     // DC account balance, $ (vested portion only — Rev. Rul. 76-259)
  projectionRate?: Decimal;                // interest rate projecting the DC balance to NRA (interest only)
  aprAtNra?: Decimal;                      // APR at NRA, $ of present value per $1/month
  // Prior-distribution inputs:
  priorDistributions?: { amount: Decimal; date: string }[];
  // Other-plan inputs:
  otherPlanOffset?: MonthlyBenefit;        // as the plan defines
  freezeDate?: string;                     // DOBF (participant-level) — in a frozen DB plan the offset is frozen too
}): CalcResult<TypedBenefitQuantity>;
// B_t^net = max(B_t^gross − Offset_t, 0). Floor-offset: Offset_t = ProjDC_t / APR, with ProjDC_t the DC account
// projected to NRA at the DB plan's interest rate assuming no future contributions.
// Prior-distribution offset: Offset_t = actuarial equivalent of prior distributions (see X-04, Option 3).
```

- **Authority:** DBAB Q 4:16 (accrual rules for floor-offset); Q 4:27 (accrued benefit determination, worked example); Q 4:28 (current-accrual offset is **not** acceptable); Q 4:29 (frozen-plan offset); Q 4:31 (cash-balance floor-offset); Rev. Rul. 76-259.
- **Period / scope / exceptions:** plan is a floor-offset arrangement (DBAB Q 4:15–4:31) or otherwise states an offset; only the **vested** portion of a DC account may offset. In a frozen DB plan subject to a floor-offset, the offset is frozen too — future DC contributions after the freeze may **not** reduce the accrued benefit (DBAB Q 4:29, 2005 ASPPA Q&A 5, informal IRS position; §411(d)(6)). **It is not acceptable** to determine the net benefit as the current accrual offset by the current DC contribution (DBAB Q 4:28) — the offset is on an accumulated basis. A participant whose entire benefit is offset is still treated as benefiting for §410(b)/§401(a)(4) (DBAB Q 4:18). For §401(a)(26) meaningful-benefit testing, a concurrent offset arrangement is tested on the gross benefit (DBAB Q 4:19–4:20).
- **If inexact:** the DC account history is usually absent from the census. Without it, the gross benefit can still be reconstructed exactly, and the *net* benefit is a `bound`: `[max(B^gross − Offset_max, 0), B^gross]`, where `Offset_max` is the largest offset consistent with any evidence (e.g. the administrator's own offset figure, if recorded). Report the gross and the bound separately — never present the gross as the net.

### 4. Combination formulas (C-01–C-07)

#### C-01 — Greater-of formulas

```ts
function calcGreaterOf(ctx: CalcContext, p: {
  components: { name: string; result: CalcResult<TypedBenefitQuantity> }[]; // each B_t^(k) on its own formula/basis
}): CalcResult<TypedBenefitQuantity>;
// B_t = max(B_t^(1), B_t^(2), …, B_t^(n)). Output: B1, monthly. The result must record which component won, and by how much.
```

- **Authority:** DBAB Q 9:13 (multiple formulas; Rev. Rul. 2008-7 relief; Prop. Treas. Reg. §1.411(b)-1(b)(2)(ii)(G) separate-bases rule and anti-abuse rule); Q 10:18–10:19.
- **Period / scope / exceptions:** plan states a greater-of benefit for a specified group; each component uses the provisions in effect for its own period; a later amendment may add a component without removing an earlier one (§411(d)(6)). Accrual testing: components are generally aggregated, except that a greater-of plan may test each formula separately if each uses a **different basis** and each satisfies an accrual rule (separate-bases requirement). If two formulas share a basis they must be aggregated. An anti-abuse rule denies separate testing if the different bases are structured to evade aggregation.
- **If inexact:** if one component cannot be computed, return `bound`: lower bound = the best computable component; upper bound = that plus the maximum plausible value of the uncomputable one. If PA_AMB exceeds every computable component, the uncomputable component is implicated — that is evidence, and the disposition is **Requires investigation** with the missing component named.

#### C-02 — Lesser-of formulas

```ts
function calcLesserOf(ctx: CalcContext, p: {
  components: { name: string; result: CalcResult<TypedBenefitQuantity> }[]; // each B_t^(k) on its own formula/basis
}): CalcResult<TypedBenefitQuantity>;
// B_t = min(B_t^(1), B_t^(2), …, B_t^(n)). Output: B1, monthly. The result must record which component bound, and by how much.
```

- **Authority:** DBAB Q 9:13 (aggregation of multiple formulas); Q 12:4–12:5 (§415 lesser-of); IRC §415(b).
- **Period / scope / exceptions:** plan states a lesser-of benefit; the commonest instance is statutory — the §415 limit is a lesser-of (X-01) — but a plan may also state one (e.g. lesser of the formula benefit and a collectively-bargained cap). A lesser-of with a §415 component can only bind downward; if the administrator's number exceeds the §415 component, the administrator's number is wrong (or the §415 inputs are).
- **If inexact:** if the binding component is uncomputable, only an upper bound exists (`B_t ≤` the smallest computable component). Return `bound` with the missing component named; do not assume the uncomputable component does not bind.

#### C-03 — Minimum benefit guarantees (including top-heavy minimum)

```ts
function calcMinimumBenefit(ctx: CalcContext, p: {
  formulaBenefit: CalcResult<TypedBenefitQuantity>; // B_t^formula
  minimumBenefit: CalcResult<TypedBenefitQuantity>; // B_t^min — plan minimum, or top-heavy minimum below
  topHeavy?: {
    fiveYearAvgComp: CompensationAnnual;   // C̄_t^(5yr-highest), $/year
    topHeavyService: ServiceYears;         // S_t^TH, years in which the plan was top-heavy
  };
}): CalcResult<TypedBenefitQuantity>;
// B_t = max(B_t^formula, B_t^min).
// Top-heavy minimum (IRC §416(c)(1)(B)): B_t^TH = 2% × C̄_t^(5yr-highest) × S_t^TH, capped at 20% of average compensation.
```

- **Authority:** DBAB Q 9:29–9:36 (top-heavy); IRC §416(c); Treas. Reg. §1.416-1 Q&A M-2–M-12; Q 9:36 (DB+DC top-heavy options, including the floor-offset approach under Rev. Rul. 76-259).
- **Period / scope / exceptions:** top-heavy minimum applies to each non-key employee with ≥1,000 hours in an accrual period in a top-heavy plan year — even if otherwise excluded from participation (DBAB Q 9:35). Only years in which the plan was top-heavy count (and, after 2001, only years a key employee benefited); pre-1984 years may be disregarded (DBAB Q 9:32). Top-heavy minimum is 2% per year **to 20% maximum**. Benefits already accrued can satisfy the minimum. If the employer has both a top-heavy DB and DC plan, four options exist (DB minimum alone; floor-offset; comparability; 5% DC contribution) — the plan's election must be found. Output basis: monthly, single life annuity at NRA for the top-heavy minimum (DBAB Q 9:34); the plan minimum in the normal form.
- **If inexact:** top-heavy years are often undocumented in old cases. Return `bound` over the plausible top-heavy-year counts (0 to all years). If the formula benefit exceeds even the maximum plausible minimum, the minimum is moot and the case can proceed — record that reasoning. If it does not, the disposition depends on the top-heavy history and is **Requires investigation** until that history is found.

#### C-04 — Grandfathered benefit protections (IRC §411(d)(6))

```ts
function calcGrandfathered(ctx: CalcContext, p: {
  currentBenefit: CalcResult<TypedBenefitQuantity>;   // B_t^current-formula, under the new provisions
  protectedBenefit: CalcResult<TypedBenefitQuantity>; // B_t^protected, accrued under the pre-amendment provisions
  amendment: { adoptionDate: string; effectiveDate: string }; // adoption date ≠ effective date — both tracked
  wearAwayMethod?: "frozen-plus-post" | "greater-of" | "extended"; // plan's method, if stated (see C-05)
}): CalcResult<TypedBenefitQuantity>;
// B_t = max(B_t^current-formula, B_t^protected), subject to the plan's wear-away method. Output: B1, monthly.
```

- **Authority:** IRC §411(d)(6); DBAB Q 9:14; Q 9:27 (optional-form protection on assumption changes, Treas. Reg. §1.411(d)-4); PBGC current policies Ex. 17 (PC3 recognition of §411(d)(6)-protected decreases); DBAB Q 26:1 (freeze amendments must comply with §411(d)(6)).
- **Period / scope / exceptions:** protection attaches at the amendment's applicable date when an amendment reduced the rate of future accrual or an early-retirement benefit/retirement-type subsidy. The protected benefit is frozen in its own terms (it may still grow through compensation increases only if the plan's protection method allows — C-05). Adding a suspension-of-benefits clause for benefits already earned is a §411(d)(6) cutback (Central Laborers' Pension Fund v. Heinz, 124 S. Ct. 2230 (2004) — DBAB Q 9:60). Changing actuarial equivalence assumptions may not reduce any optional form below its pre-amendment value (DBAB Q 9:27, Kelly example). Protection is participant-specific: a participant with no pre-amendment accrual has nothing protected.
- **If inexact:** if the pre-amendment benefit cannot be computed (old formula or old compensation missing), return `bound`: lower bound = the earliest documented accrued benefit; upper bound = the current-formula benefit recomputed on the most generous plausible old terms. If PA_AMB exceeds the current-formula benefit, grandfathering is the leading hypothesis — test it before assuming administrator error.

#### C-05 — Transitional formulas following plan amendments (fresh-start formulas)

```ts
function calcFreshStart(ctx: CalcContext, p: {
  method: "without-wear-away" | "with-wear-away" | "extended-wear-away"; // plan's elected method (Treas. Reg. §1.401(a)(4)-13(c)(4))
  frozenBenefit: CalcResult<TypedBenefitQuantity>; // B^frozen at the fresh-start date (computed as if the plan had been frozen the day before)
  postFreshStartAccrual: CalcResult<TypedBenefitQuantity>; // B^post-fresh-start, accruals on post-fresh-start service only
  totalServiceBenefit: CalcResult<TypedBenefitQuantity>;   // B^current-formula-on-total-service
  freshStartDate: string;               // day after the frozen-benefit date; OBRA '93 date differs from the statutory effective date
}): CalcResult<TypedBenefitQuantity>;
// Method 1 — without wear-away: B_t = B^frozen + B^post-fresh-start.
// Method 2 — with wear-away: B_t = max(B^frozen, B^current-formula-on-total-service).
// Method 3 — extended wear-away: B_t = max(Method 1, Method 2). Output: B1, monthly.
```

- **Authority:** DBAB Q 9:50–9:52 (compensation-limit fresh starts; frozen-benefit increase fraction); Treas. Reg. §1.401(a)(17)-1(e)(5); PBGC current policies Ex. 17 (wear-away protection in a rate decrease — same structure, different trigger). Applies to the §401(a)(17) and OBRA '93 fresh-start dates (X-02).
- **Period / scope / exceptions:** the frozen benefit is computed as if the plan had been frozen the day before the fresh-start date, using the compensation, formula, and limit then in effect. A frozen benefit **can** be increased after the fresh-start date if the plan provides: multiply by `current average compensation ÷ compensation used for the frozen benefit` (DBAB Q 9:52). The EGTRRA retroactivity election must be in the plan document. The frozen benefit is a fixed anchor — do not re-round it when combining.
- **If inexact:** the frozen benefit is the anchor: if it cannot be computed (pre-fresh-start compensation missing), return `indeterminate` unless some earlier administrator schedule states the frozen amount. If the plan's elected method is unknown, return `scenarios` for all three methods; if PA_AMB matches exactly one, that method becomes a ranked hypothesis.

#### C-06 — Multiple accrual formulas by period

```ts
function calcMultiplePeriods(ctx: CalcContext, p: {
  periods: {
    from: string; to: string | null;     // period boundaries at each formula-change *effective* date (adoption ≠ effective)
    formula: (periodCtx: CalcContext, periodService: ServiceYears, periodComp: CompensationAnnual) => CalcResult<TypedBenefitQuantity>;
    service: ServiceYears;               // S_{t,p}, service in this period
    comp: CompensationAnnual;            // C̄_t^(p), the compensation measure applicable to this period
  }[];
  serviceCap?: { cap: ServiceYears; whichYears: "last-n" | "first-n" }; // e.g. Blonder-Tongue: last 30 years before termination
}): CalcResult<TypedBenefitQuantity>;
// B_t = Σ_p F_p(C̄_t^(p), S_{t,p}). Caps and minima apply to the total as the plan provides. Output: B1, monthly.
```

- **Authority:** DBAB Ch. 9 generally; Blonder-Tongue Laboratories plan §5.01 (real plan in the local review set, `~/workspace/pbgc_review/plan_docs/Blond-2006-plan.txt`): period unit-benefit table `$42.00` (hire–2/5/82) rising by amendment to `$222.00` (2/6/04 and after), 30-year cap, "30 years immediately preceding termination of employment," benefit "rounded to the nearest whole dollar."
- **Period / scope / exceptions:** each period's formula applies to service in that period; a new formula does not re-price earlier periods except through a stated fresh-start or grandfathering rule (C-04/C-05). The 30-years-immediately-preceding-termination rule means the *cap* selects which periods count — a participant with 35 years uses only the last 30 years' rates. Service before the plan's effective date is excluded unless past-service credit was granted (S-07). Overlapping periods (e.g. a restatement with a retroactive effective date) must be resolved by the amendment's own terms, never by assumption.
- **If inexact:** if a period's formula is missing, that period's accrual is bounded by `[0, max plausible period rate × S_{t,p}]` — return `bound` for the total. If period boundaries are uncertain (adoption vs effective date), return `scenarios` for both splits. The most useful output in this situation is often the *period attribution table* (service and rate per period, with unknowns marked) rather than any total.

#### C-07 — Union / nonunion / group-specific formulas

```ts
function calcGroupSpecific(ctx: CalcContext, p: {
  groupHistory: { from: string; to: string | null; groupId: string }[]; // participant's group at each service date
  groupFormulas: Record<string, (groupCtx: CalcContext, groupService: ServiceYears, groupComp: CompensationAnnual) => CalcResult<TypedBenefitQuantity>>;
  combine: "sum" | "greater-of";        // as the plan provides (usually summed; sometimes greater-of)
}): CalcResult<TypedBenefitQuantity>;
// B_t = F_{g(i)}(X_i(≤t), P(≤t)), where g(i) is the participant's employment group (union local, nonunion,
// salaried/hourly, division, location) and F_g that group's formula. Output: B1, monthly.
```

- **Authority:** DBAB Q 9:13 (separate accrual testing by classification of employees, Treas. Reg. §1.411(b)-1(a)(1)); Q 10:16 (features that do not disqualify safe harbors); Ch. 7 (service by group); the R5 plan-summary provisions A–S include group/coverage provisions (local `~/workspace/pbgc_review/r5/`).
- **Period / scope / exceptions:** group formulas change by CBA effective dates as well as plan amendments; a group transfer moves the participant to the new group's formula prospectively (prior service stays under the old group's formula unless the plan says otherwise). Separate accrual testing by classification is allowed only if the classifications are not structured to evade §411(b)/§401(a)(4). A participant with service in two groups may have two different benefit rates for different periods — the same structure as C-06 with group boundaries instead of date boundaries.
- **If inexact:** if group membership is unknown for some service, return `bound` over the groups the participant could have belonged to, and use any corroborating field (e.g. CBA coverage dates, job title, location) to narrow it. If the group cannot be narrowed, the disposition is **Requires investigation** — the group is a single document fact that resolves the range.

### 5. Special plan designs (S-01–S-08)

#### S-01 — Cash balance plans

```ts
function calcCashBalance(ctx: CalcContext, p: {
  openingBalance?: Decimal;              // H at conversion, $ — the protected prior accrued benefit as an opening balance (if converted)
  payCredits: { year: number; credit: Decimal }[]; // PC_y, $ per year (pay/principal credits)
  interestRates: { year: number; rate: Decimal }[]; // i_k, interest-crediting rate(s) and their history
  ageAtMeasurement: Decimal;             // age_t, years
  normalRetirementAge: Decimal;          // NRA, years
  aprAtNra: Decimal;                     // APR_NRA, $ of present value per $1/month (plan interest + mortality)
  terminationDate?: string;              // DOPT — at termination, pay credits cease; variable rate ⇒ 5-year average (below)
}): CalcResult<TypedBenefitQuantity>;
// Hypothetical account: H_t = Σ_y [PC_y × Π_{k>y} (1 + i_k)].
// Accrued benefit (annual, at NRA): B_t = H_t × (1 + i)^(NRA − age_t) / APR_NRA,
// projecting with interest credits only, not future pay credits. Output: B1, monthly.
```

- **Authority:** DBAB Ch. 18 (esp. Q 18:1–18:6, Q 18:24–18:26); DBAB Q 27:6 (terminating cash balance, variable rate); IRC §411(a)(13), §411(b)(5); Treas. Reg. §1.411(b)(5)-1; DBAB Ch. 4 (cash balance as floor-offset, Q 4:31).
- **Period / scope / exceptions:** plan is an applicable defined benefit plan (statutory hybrid) under IRC §411(a)(13); pay credits are principal credits (Treas. Reg. §1.411(b)(5)-1(d)(1)(ii)(D)); anything conditioned on current service is a principal credit, not an interest credit (DBAB Q 18:4 — e.g. 6% for actives vs 4% for terminated: the plan rate is 4%, the extra 2% is principal). Interest credits continue after plan termination until benefit commencement; pay credits cease at termination (DBAB Q 27:6). For a variable crediting rate at termination, PBGC uses the **average of the rates during the 5-year period ending on the termination date** (PPA §411(b)(5)(B); PBGC regulations — DBAB Q 27:6). The accrued benefit must be expressible as an annual benefit at NRA (IRC §411(a)(7)); the account balance itself is the accrued benefit only for lump-sum payment and age-discrimination purposes (IRC §411(a)(13)(A)). **Conversion protection:** on conversion from a traditional formula, the prior accrued benefit is protected — it becomes the opening balance (DBAB Q 18:2, Q 18:43); the greater-of (old annuity vs new account) applies. **Wear-away** on conversion is the classic failure: if the opening balance is set below the protected annuity's value, the participant accrues nothing until the account catches up. The subsidised portion of any early-retirement benefit is disregarded in determining the accrued benefit (DBAB Q 18:24). Interest credits must satisfy the market-rate-of-return and §411(b)(1)(H) age-discrimination rules.
- **If inexact:** the common gaps are the interest-crediting history (variable rates) and the opening balance on conversion. Return `bound` over the documented rate range; for a variable rate at termination, the 5-year-average rule gives a *determinate* PBGC number even when the plan's own rate path is unknown — use it as the PBGC-basis scenario and label it as such. If the opening balance is unknown, the account is unbounded below by zero and above by the protected-annuity value — return `indeterminate` until the conversion amendment is found.

#### S-02 — Pension equity plans (PEP)

```ts
function calcPensionEquity(ctx: CalcContext, p: {
  percentageCredits: { year: number; points: Decimal }[]; // κ_y, percentage points credited per year (often age/service-graded)
  finalAvgComp: CompensationAnnual;     // C̄_t^FAC, $/year
  aprAtNra: Decimal;                     // APR_NRA, plan conversion factor (or factor table — see §6 open decision)
}): CalcResult<TypedBenefitQuantity>;
// Accumulated percentage: κ_t = Σ_y κ_y. Lump-sum value: L_t = κ_t × C̄_t^FAC.
// Annuity: B_t = L_t / APR_NRA (monthly, using the plan's conversion factors). Output: B1, monthly.
```

- **Authority:** IRC §411(a)(13)(C); DBAB Q 9:15 (PEP accrued benefit may decline with final average compensation — 2015 Gray Book Q&A 35); DBAB Ch. 4 (hybrid plans); DBAB Ch. 18 (PEP as a statutory hybrid alongside cash balance).
- **Period / scope / exceptions:** plan is a statutory hybrid (IRC §411(a)(13)(C)); the benefit is defined as a percentage of final average compensation, not as an account. **The accumulated PEP benefit may decline when final average compensation declines** — the IRS's stated position for PEPs (DBAB Q 9:15). This is the one design where a falling accrued benefit is *expected* behaviour, and it must not be misread as an administrator error. Vesting for applicable DB plans is 3-year cliff (DBAB Ch. 8, Q 8:10–8:11). Percentage points are typically whole or half points; do not round the accumulated percentage before multiplying.
- **If inexact:** if the annuity conversion factors are unknown, report the lump-sum value `L_t` exactly (it needs only the percentage and FAC) and return `bound` on the annuity over the plausible APR range — and compare PA_AMB against the *lump-sum-implied* range, not against a single assumed conversion. The lump-sum value `L_t` is a separate typed quantity and must not be compared to a monthly PA_AMB. If FAC is unknown, the same missing-year bounds as T-06 apply.

#### S-03 — Other statutory hybrid arrangements (including target benefit and floor-offset hybrids)

```ts
function calcOtherHybrid(ctx: CalcContext, p: {
  hybridKind: "target-benefit" | "floor-offset-hybrid" | "cash-balance-as-floor";
  // Target-benefit inputs:
  targetBenefit?: CompensationAnnual;    // B^target, $/year at NRA (usually α × C̄ × S^proj)
  service?: ServiceYears;                // S_t, years
  projectedService?: ServiceYears;        // S_t^proj, years
  accrualMethod?: "fractional" | "unit-credit"; // plan's stated accrual method for the target benefit
  // Floor-offset inputs: as I-05 (DC account, APR); cash-balance-as-floor: the offset is the annuitised
  // cash-balance account, not the account itself (DBAB Q 4:31).
  floorOffset?: Parameters<typeof calcPlanOffset>[1];
}): CalcResult<TypedBenefitQuantity>;
// Target benefit: B_t = B^target × (S_t / S_t^proj) (fractional) or as the plan defines.
// Floor-offset hybrid: as I-05.
```

- **Authority:** DBAB Ch. 4 (target benefit Q 4:8–4:14; floor-offset Q 4:15–4:31; cash balance Q 4:32+); IRC §411(a)(13); Treas. Reg. §1.411(a)(13)-1(d)(3) (statutory hybrid definition).
- **Period / scope / exceptions:** plan is an applicable defined benefit plan or a stated hybrid design; the document must define the accrued benefit (IRC §411(a)(7)). Target-benefit plans in effect before 1991-09-19 have special rules (DBAB Ch. 4, Q 4:12). In a target benefit plan, **contributions do not define the benefit** — a low contribution year does not reduce the accrued benefit. In a cash-balance floor-offset, an invalid offset is one that defines principal credits as a net of the DC contribution (DBAB Q 4:31) — if the plan's offset looks like that, the design itself is suspect and the case needs a legal read, not a recalculation.
- **If inexact:** target-benefit accruals depend on the plan's stated accrual method; if unstated, return `scenarios` (fractional vs unit-credit). Never infer the accrued benefit from the contribution history — that reverses the design.

#### S-04 — Contributory defined-benefit plans

```ts
function calcContributory(ctx: CalcContext, p: {
  totalBenefit: CalcResult<TypedBenefitQuantity>; // B_t^total under the plan formula
  employeePortion: CalcResult<TypedBenefitQuantity>; // B_t^ee, from S-05
}): CalcResult<TypedBenefitQuantity>;
// B_t^total split into B_t^ee (from mandatory employee contributions, S-05) and B_t^er = max(B_t^total − B_t^ee, 0).
// Output: B1, monthly, split into employee and employer portions. Only the employer portion is subject to vesting.
```

- **Authority:** DBAB Q 9:53–9:56; IRC §411(c)(1)–(2); Treas. Reg. §1.417(e)-1(d)(1).
- **Period / scope / exceptions:** plan requires mandatory employee contributions as a condition of employment, participation, or benefits (IRC §411(c)(2)(C)). Voluntary contributions do not create this split. Contribution rates and the plan's interest-crediting rules for contributions are those in `P(t)`; the statutory accumulation rates changed in 1988 (5% → 120% of the federal midterm rate) and again with §417(e) (DBAB Q 9:54). Mandatory contributions are always fully vested in themselves (the employee portion is never forfeitable). A participant who withdraws mandatory contributions may forfeit the employer benefit attributable to them per plan terms — check the withdrawal provisions before treating a low PA_AMB as an error.
- **If inexact:** if the contribution history is missing, the employee portion is bounded by `[0, B_t^total]` and the split is indeterminate — but the *total* may still be verifiable. Return the total and the split separately (the split as a `bound`); a PA_AMB that matches the total is not evidence about the split, and a PA_AMB that matches only the employer portion suggests the administrator reported a vested/employer-only figure (see §2 of Stage 1, B2).

#### S-05 — Employee-contribution accounts / offsets (IRC §411(c))

```ts
function calcEmployeeContributionBenefit(ctx: CalcContext, p: {
  contributions: { year: number; amount: Decimal }[]; // c_y, mandatory contributions, $
  federalMidtermRates: { year: number; rate: Decimal }[]; // federal midterm rate by year (loaded table — §6)
  section417eRate: Decimal;              // §417(e) applicable rate, for projection from the determination date to NRA
  apr417e: Decimal;                       // APR at NRA under §417(e) (monthly factor)
  totalBenefit: MonthlyBenefit;           // B_t^total, $/month
}): CalcResult<TypedBenefitQuantity>;
// Accumulated contributions at NRA: AC_NRA = Σ_y c_y × Π (1 + r_k), with r = 5% compounded annually before the
// first plan year beginning after 1987-12-31; r = 120% of the federal midterm rate from then to distribution;
// r = §417(e) applicable rate from the determination date to NRA.
// Employee benefit: B_t^ee = AC_NRA / APR_417(e) (monthly). Employer benefit: B_t^er = max(B_t^total − B_t^ee, 0).
```

- **Authority:** DBAB Q 9:53–9:56 (worked Diane example); IRC §411(c)(2)(B)–(C); Treas. Reg. §1.417(e)-1(d)(1) (converted benefit never less than the §417(e) computation).
- **Period / scope / exceptions:** mandatory contributions as defined in IRC §411(c)(2)(C). The three interest regimes are date-bound as above; the plan's RPA '94 amendment determines whether the applicable interest rate applies. The converted benefit using plan factors can never be less than the benefit using §417(e) rates — the §417(e) figure is a floor. Interest after termination to NRA uses the §417(e) rate even if the plan's rate differs. The §417(e) APR is a plan/document figure — use the documented value, do not recompute it from first principles unless the plan requires it.
- **If inexact:** contribution histories are rarely in the census. Without them, return `bound` for `B_t^ee` over `[0, B_t^total]`; the useful test is the *ratio*: if PA_AMB ≈ `B_t^total − B_t^ee` for a plausible `B_t^ee`, the administrator may have reported the employer portion only. Record that hypothesis; do not assert it without the contribution record.

#### S-06 — Frozen and partially frozen plans

```ts
function calcFrozen(ctx: CalcContext, p: {
  freezeType: "hard" | "closed-to-new-entrants" | "rate-zero-comp-grows"; // stated in the freeze amendment
  freezeDate: string;                 // DOBF, participant-level (qualify the grain — Stage 1 §1.5)
  benefitAtFreeze: CalcResult<TypedBenefitQuantity>; // F(X_i(≤ t_freeze), P(≤ t_freeze))
  currentAvgComp?: CompensationAnnual; // C̄_t, $/year — live only for the "rate-zero-comp-grows" soft freeze
  frozenService?: ServiceYears;       // S_{t_freeze}, years — service frozen for the "rate-zero-comp-grows" variant
  postFreezeComp?: { year: number; comp: CompensationAnnual }[]; // for soft freezes, post-freeze compensation history
}): CalcResult<TypedBenefitQuantity>;
// Hard freeze (DBAB Q 26:4): B_t = F(X_i(≤ t_freeze), P(≤ t_freeze)) for all t ≥ t_freeze — no new accruals, no comp growth.
// Soft freeze, closed to new entrants (Q 26:3): existing participants continue accruing normally; B_t under the live formula.
// Soft freeze, accrual rate zero but compensation grows (Q 26:3): B_t = α × C̄_t × S_{t_freeze}.
```

- **Authority:** DBAB Ch. 26 (Q 26:1–26:4 freeze types; Q 26:7 amendment mechanics; Q 26:9–26:10 §204(h) notice); DBAB Q 4:29 (frozen floor-offset); IRC §411(d)(6); ERISA §204(h).
- **Period / scope / exceptions:** a plan amendment freezing benefits, with ERISA §204(h) notice; the freeze type is stated in the amendment. The freeze amendment's effective date is the cutoff. A freeze is not a termination (Q 26:1) — the plan continues. A freeze may not take away benefits already accrued (§411(d)(6)). In a frozen DB plan with a floor-offset, the offset is also frozen (Q 4:29). Top-heavy and §415 rules continue to apply. A freeze amendment that eliminates an early-retirement subsidy needs §204(h) notice and may be a §411(d)(6) issue. For `t > t_freeze`, verify no post-freeze service or compensation leaked into a hard-frozen benefit — the commonest administrator error in frozen plans.
- **If inexact:** if the freeze type is undocumented, return `scenarios` for all three variants (hard / closed-to-new-entrants / rate-zero-comp-grows). If PA_AMB exceeds the hard-freeze value but matches a soft-freeze value, that identifies the freeze type — as a hypothesis, pending the amendment. If the freeze *date* is unknown, return `bound` between the earliest and latest plausible freeze dates' values.

#### S-07 — Special past-service credits

```ts
function calcPastServiceCredit(ctx: CalcContext, p: {
  pastService: ServiceYears;             // S^past, years before the plan's effective date (or a stated date) credited by the plan
  currentService: ServiceYears;          // S_t^current, years
  creditingRule: string;                 // which pre-effective-date service counts (plan term)
  avgComp: CompensationAnnual;           // C̄_t, $/year
  accrualRate: DatedValue<Decimal>;       // α, fraction per year (or the underlying formula's inputs — generalise per plan)
  planEffectiveDate: string;
}): CalcResult<TypedBenefitQuantity>;
// B_t = F(C̄_t, S_t^current + S^past). Output: B1, monthly.
```

- **Authority:** DBAB Q 9:19 (past-service credit); Q 9:20 (§415); Q 9:22 (excluding service before a date — the mirror image); Treas. Reg. §1.401(a)(4)-5(a)(3).
- **Period / scope / exceptions:** plan grants past-service credit (by adoption or by amendment); a grant over 5 years must be shown not to discriminate in favour of HCEs (Treas. Reg. §1.401(a)(4)-5(a)(3)); a pattern of discriminatory amendments defeats the 5-year safe harbor. Past-service credit is granted as of the plan's effective date or the amendment date; it is not retroactive service for §415 participation purposes beyond the regulatory floor. **§415:** the dollar limit's participation numerator is never less than 1, so a participant can receive a past-service benefit at inception (≥ 1/10 of the dollar limit); but the 100%-of-compensation limit can still be zero if there is no past salary history (DBAB Q 9:20). A plan may also *exclude* service before a date (Q 9:22) — the administrator's service figure must be checked against the plan's exclusion date, not just the hire date.
- **If inexact:** past service is usually the least-documented service in a case. If the credit is undocumented, return `bound` over `[F(S^current), F(S^current + S^past_max)]`, where `S^past_max` is the maximum creditable pre-effective service (hire date to effective date). A PA_AMB at the top of that range with no credit documentation is a **Requires investigation** finding, not a verification.

#### S-08 — Rehire and restoration provisions

```ts
function calcRehireRestoration(ctx: CalcContext, p: {
  employmentPeriods: { from: string; to: string | null; hoursPerYear?: number }[]; // hire/termination/rehire/transfer dates
  priorDistributions?: { amount: Decimal; date: string }[];
  repayments?: { amount: Decimal; date: string }[]; // restoration repayments (+ interest per the plan)
  vestingStatusAtEachBreak: { breakDate: string; vested: boolean; vestingService: ServiceYears }[];
  underlying: (restoredService: ServiceYears) => CalcResult<TypedBenefitQuantity>; // any T-/C- formula on the resulting service
}): CalcResult<TypedBenefitQuantity>;
// Service after rehire: S_t = S^pre-break (if restored) + S^post-rehire.
// Restoration of a prior distribution: B_t = B_t^gross-before-distribution if the participant repaid the distribution
// plus interest per the plan; otherwise B_t = B_t^gross − AE(prior distributions) (see X-04, Option 3).
```

- **Authority:** DBAB Ch. 7 (measuring service; breaks in service Q 7:25+; rehire Q 7:28+); DBAB Q 9:58–9:68 (post-NRA and suspension); DOL Reg. §2530.203-3 (suspension, 25%-per-month offset cap — Q 9:63); ERISA §203 / IRC §411(a)(6) (5-year break rule, rule of parity).
- **Period / scope / exceptions:** plan's break-in-service, rehire, and restoration provisions (DBAB Ch. 7). A 1-year break (≤500 hours) suspends credit; pre-break service is restored after the participant completes 1 year of service after rehire (with the 5-year rule / rule of parity governing forfeiture of pre-break service for nonvested participants). Each employment period is governed by the provisions in effect during it; a restoration repayment reinstates the benefit as of the repayment date, not retroactively to the distribution date. A plan requiring 2 years of service may disregard pre-break service under specified conditions (DBAB Ch. 7). A retiree in pay who returns to work may have benefits suspended (≥40 hours/month) with notice; on resumption, withheld amounts are repaid (less offsets capped at 25% of the monthly benefit — Q 9:63). A suspension clause added for already-earned benefits is a §411(d)(6) cutback (Q 9:60).
- **If inexact:** employment gaps are the characteristic census gap. Return `bound` (or `scenarios`) over the restoration scenarios (restored / forfeited) and report both benefits. If the census shows a gap with no rehire record, do not assume continuous employment and do not assume a break — mark the period unknown and bound it.

### 6. Cross-cutting caps and conversions (X-01–X-05)

These apply **on top of** any formula above, in the classification order of Stage 1 §12 step 10: §415 (X-01), §401(a)(17) (X-02, applied per compensation year inside the formula — see below), service cap (T-09), then vesting (X-05), then form/age conversion (X-03) only when the comparison basis requires B4.

#### X-01 — IRC §415 maximum benefit limit

```ts
function applySection415Limit(ctx: CalcContext, p: {
  formulaBenefit: MonthlyBenefit;         // B_t^formula, $/month, as a straight life annuity at NRA
  dollarLimitTable: Section415Table;      // L$_t, indexed dollar limit by limitation year (loaded, versioned — §7)
  high3AvgComp: CompensationAnnual;       // C̄_t^(high-3), $/year (highest 3 consecutive years)
  yearsOfParticipation: ServiceYears;     // YOP, years
  yearsOfService: ServiceYears;           // YOS, years
  commencementAge: Decimal;               // for the before-62 / after-65 adjustments (DBAB Q 12:22)
}): CalcResult<TypedBenefitQuantity>;
// B_t ≤ min( L$_t × max(YOP_t, 1)/10 , 100% × C̄_t^(high-3) × max(YOS_t, 1)/10 ).
// The dollar limit is reduced 1/10 per year of participation under 10; the compensation limit 1/10 per year of
// service under 10; neither denominator is ever below 1. Output: B1 (capped), monthly, straight-life annuity at NRA.
```

- **Authority:** DBAB Q 12:4 (limit table 1987–2023); Q 12:5 (participation/service reductions); Q 12:13–12:22 (form and age adjustments); IRC §415(b), (d); Treas. Reg. §1.415(b)-1.
- **Period / scope / exceptions:** applies to every defined benefit plan; all DB plans of the employer (and predecessor) are aggregated as one plan (Treas. Reg. §1.415(f)-1(a)(1)), except multiemployer plans. The limit in effect for the limitation year; adjustments apply if benefits begin before 62 or after 65 (Q 12:22). A benefit is tested in the straight-life-annuity form; other forms are converted to that basis first. Employee-contribution and rollover benefits are excluded from the limit. A post-65 actuarial increase limited by §401(a)(17) must be handled by starting or suspending benefits to avoid forfeiture (DBAB Q 9:18). Pre-change accruals are insulated from a later limit reduction. The dollar limit increases in `$5,000` multiples, rounded down (IRC §415(d)(1)).
- **If inexact:** if YOP is unknown, return `bound` over the dollar limit range `[$265,000 × 1/10, $265,000]` (for the 2023 table) — usually too wide to be useful; the data request is the participation history. If the limitation year is a non-calendar year, the limit in effect at the benefit's start date governs (Treas. Reg. §1.415(d)-1(a)(3)).

#### X-02 — IRC §401(a)(17) compensation limit (and its fresh-start machinery)

```ts
function capCompensationYear(ctx: CalcContext, p: {
  compByYear: { year: number; comp: CompensationAnnual }[]; // C_y, $/year, uncapped
  compLimitTable: Section401a17Table;     // L^comp_y by year (loaded, versioned — §7)
  egtrraRetroactivityElected?: boolean;   // plan's EGTRRA election (Notice 2001-56) — if unknown, see "If inexact"
}): { cappedByYear: { year: number; comp: CompensationAnnual }[] };
// C_y^used = min(C_y, L^comp_y), where L^comp_y is the limit for the plan year beginning in calendar year y
// ($200,000 base; $235,840 in 1993; $150,000 in 1994–2001; $200,000 from 2002, indexed — full table DBAB Q 9:47,
// through $330,000 in 2023). This is a per-year input transform, not a formula in its own right: it feeds
// T-02, T-04–T-06, I-01–I-04, and X-01's high-3 average. It returns capped compensation, not a benefit.
```

- **Authority:** DBAB Q 9:46–9:52; IRC §401(a)(17); Treas. Reg. §1.401(a)(17)-1; Notice 2001-56; Rev. Rul. 2003-11.
- **Period / scope / exceptions:** applies to all qualified DB plans from plan years beginning on or after 1989-01-01. **Per-year application:** a cost-of-living increase applies only to compensation for the year it takes effect; prior years keep their own year's limit (DBAB Q 9:50). **Law changes differ:** OBRA '93 ($150,000) applies to prior years too; EGTRRA ($200,000) applies to prior years only if the plan elects retroactivity (Notice 2001-56). Frozen benefits and fresh-start methods: see C-05. The cap is applied to *years*, not to the *average* (DBAB Q 9:50, Ex. 1: three years capped individually give an average of `$145,000`, not `$150,000`). The limit is indexed in `$5,000` multiples, rounded down (Treas. Reg. §1.401(a)(17)-1(a)(3)(ii)–(iii)). Before 1989 the limit is deemed `$200,000`. A plan that retroactively applies the EGTRRA increase must satisfy §401(a)(26) (lesser of 40% or 50 former employees with an actual increase — Rev. Rul. 2003-11). Self-employed earned income is determined under §401(c)(2) (DBAB Q 9:48).
- **If inexact:** if the plan's EGTRRA retroactivity election is undocumented, the caller returns `scenarios` for both options (DBAB Q 9:50, Ex. 3: `$190,000` vs `$180,000` average). The election is a single plan-document fact; until found, the case is **Requires investigation** for affected high earners only — not for the whole population.

#### X-03 — Form-of-payment and commencement-age conversion (actuarial equivalence)

```ts
function convertFormAndAge(ctx: CalcContext, p: {
  normalBenefit: MonthlyBenefit;          // B1, $/month, normal form at NRA
  aprNormal: Decimal;                     // APR^normal at the payment age
  aprAlternate: Decimal;                  // APR^alt at the payment age
  aprAtNra?: Decimal;                     // APR^NRA, for the age conversion
  aprAtEarlyAge?: Decimal;                // APR^early, for the age conversion
  interestRate: Decimal;                  // plan interest rate i (for v^n); PBGC optional forms use PBGC factors (6%, unisex 1983 GAM)
  yearsEarly?: Decimal;                   // n, years early (mortality ignored pre-retirement, per plan)
  toForm: BenefitFormCode;                // target form code (e.g. "SLA", "JSC", "CTN" — see below)
  toSurvivorPct?: Decimal;                // survivor percentage, if a joint-and-survivor form
  monthsCertain?: number;                 // certain period, months (certain-and-continues: SLA with months-certain = n×12)
  deferralMortality: "Y" | "N";           // mortality counts during deferral or not — Y or N only, never assumed
  mortalityTable: string;                 // unisex table (sex-distinct tables are prohibited — Arizona v. Norris, 463 U.S. 1073 (1983))
}): CalcResult<TypedBenefitQuantity>;
// Alternate form: B^alt = B^normal × APR^normal / APR^alt (APR at the payment age).
// Alternate retirement age (mortality ignored pre-retirement, per plan): B^early = B^NRA × APR^NRA × v^n / APR^early,
// where v^n = (1+i)^(−n), n = years early. Both steps in sequence if both apply (DBAB Q 9:24).
// Output: B4 (benefit payable at commencement) in the elected form. This entry converts B1 to B4; it does not
// create an accrued benefit.
```

- **Authority:** DBAB Q 9:23–9:28 (normal form, equivalence, subsidised forms); BCV ATPBGC Add-ins (Jul 2024): `ERFAEQ` / `LRFAEQ` / `BFCFAEQ` — see §7 open decision on confirming the add-in signatures before Stage 4. PBGC optional forms convert with PBGC factors (6%, unisex 1983 GAM), not plan factors (Book of Job, Annuity Benefit Forms §G.1).
- **Period / scope / exceptions:** plan must specify its actuarial equivalence assumptions (IRC §401(a)(25)); a plan amendment may not reduce any optional form below its pre-amendment value (Treas. Reg. §1.411(d)-4, DBAB Q 9:27). The assumptions in effect at the commencement (or measurement) date govern; the plan must state whether mortality applies pre-retirement, post-retirement, or both. Apply any plan early/late retirement factors (ERF/LRF) — which may be *subsidised* rather than actuarially equivalent. **Subsidised optional forms** (DBAB Q 9:28) are worth more than the actuarially equivalent benefit — the excess is an employer subsidy, and it is *excluded* from the accrued benefit for §411 purposes. A PA_AMB that matches a subsidised early-retirement amount is not the accrued benefit; it is B4 with a subsidy. Certain-and-continuous forms: `n` years certain-and-continues writes as code SLA with months-certain `= n×12` (36 months certain-and-continues = SLA, 0, 36); pure certain (no life) is code CTN (PF v0.4.2 finding, verified in the add-in doc and BCV dictionary).
- **If inexact:** if the plan's equivalence assumptions are undocumented, return `bound` over the plausible assumption set (e.g. PBGC factors vs plan factors) — and a PA_AMB that matches B1 under one set and B4 under another is evidence about the administrator's basis, not an error. The conversion layer is the system's main tool for testing "wrong basis" hypotheses; it must never be used to force a match.

#### X-04 — Benefit accruals after normal retirement age

```ts
function calcPostNra(ctx: CalcContext, p: {
  option: "suspension" | "greater-of" | "offset-by-payments"; // plan's elected option (DBAB Q 9:58)
  nraBenefit: MonthlyBenefit;             // B_NRA, $/month
  currentFormulaBenefit: MonthlyBenefit;  // F(S_t, C̄_t), $/month, on post-NRA service and compensation
  actuarialEquivalentOfNraBenefit?: MonthlyBenefit; // AE(B_NRA to t), $/month — Option 2
  paymentsSinceNra?: { amount: MonthlyBenefit; months: number }[]; // payments made since NRA — Option 3
  aeBasis: string;                        // actuarial equivalence basis used for the AE paths
}): CalcResult<TypedBenefitQuantity>;
// Option 1 — additional accruals with suspension: B = F(S_t, C̄_t) with payments suspended (ERISA §203(a)(3)(B)).
// Option 2 — greater of: B = max(F(S_t, C̄_t), AE(B_NRA to t)).
// Option 3 — additional accruals offset by benefits paid: B = F(S_t, C̄_t) − AE(payments made since NRA),
//   floored at the benefit already in pay.
// Output: monthly benefit in the normal form at the actual retirement date (B4, not B1 — the accrued benefit
// at NRA is the input, the post-NRA amount is a commencement amount).
```

- **Authority:** DBAB Q 9:57–9:68; Prop. Treas. Reg. §1.411(b)-2(b)(4)(iv) (worked Brenden examples); ERISA §203(a)(3)(B); DOL Reg. §2530.203-3.
- **Period / scope / exceptions:** participant works beyond NRA; the plan elects one of the three options. The §411(b)(1)(H) rule forbids reducing accrual rates by age, but a service cap is allowed (DBAB Q 9:57). §415 limits can still bind post-NRA increases (Q 9:57 note). Suspension requires timely notice (first calendar month/payroll period — Q 9:61) and a plan provision; resumption no later than the first day of the third month after employment ceases (Q 9:62); offsets capped at 25% of the monthly benefit (Q 9:63). A suspension clause added for already-earned benefits is a §411(d)(6) cutback (Q 9:60).
- **If inexact:** if the plan's elected option is unknown, return `scenarios` for all three — they diverge materially (Brenden example: `$640` vs `$672` vs `$600`). If PA_AMB matches one, that is evidence for the option. If the post-NRA work history is missing, return `bound` over `[B_NRA, max(Option 2 path)]` and the case needs the employment record.

#### X-05 — Vesting application (accrued → vested accrued)

```ts
function applyVesting(ctx: CalcContext, p: {
  accruedBenefit: MonthlyBenefit;         // B_t, $/month (unvested accrued benefit, B1)
  vestingService: ServiceYears;           // VS_t, years of vesting service
  vestingSchedule: { serviceYears: ServiceYears; percent: Decimal }[]; // plan's schedule (cliff or graded)
  employerPortionOnly: boolean;           // true: apply VP only to the employer-contribution portion (S-04)
  employeePortion?: MonthlyBenefit;       // B_t^ee, $/month, if employerPortionOnly is true
}): CalcResult<TypedBenefitQuantity>;
// B_t^vested = VP_t × B_t, where VP_t is the vesting percent from the plan's schedule at t.
// Only the employer-contribution portion is subject to vesting (S-04).
// Output: B2 (vested accrued benefit), monthly, in the normal single form (VB) or automatic form (VBNF).
```

- **Authority:** DBAB Ch. 8 (vesting); IRC §411(a); BCV `VP`, `VB`, `VBNF`, `VSPA`/`VS`.
- **Period / scope / exceptions:** the schedule in effect at `t`; a schedule change protects the vested percentage already earned (§411(a)(10) election rules — DBAB Ch. 8). Applicable DB plans (cash balance, pension equity) use 3-year cliff (IRC §411(a)(13)(B)); top-heavy plans use the top-heavy vesting schedule (see §7 open decision — verify in Ch. 8, not assumed here). `VP` is entered as a fraction (e.g. 1, not 100) per the BCV dictionary; vesting percents are schedule values, not rounded computations. `VP` may be 0 even when the participant receives a benefit in Priority Category 2 or 6 (BCV dictionary note on `VP`). A participant 100% vested has `B^vested = B_t` — the distinction vanishes and cannot explain a discrepancy. Different schedules may apply to different groups or to benefits accrued at different times (DBAB Ch. 8, Q 8:47+). Compare the result with BCV `VB`/`VBNF` (vested, before PBGC limitations).
- **If inexact:** if the schedule is unknown, `VP` is bounded by `[0, 1]` — useless alone. The testable content is the *ratio* `PA_AMB / B̂_t`: if it equals a plausible schedule value (e.g. 0.60, 0.80) for the participant's service, the hypothesis "administrator reported the vested benefit" is supported and the disposition can be **Supported for acceptance** on the vested basis — with the hypothesis documented, not hidden.

### 7. Shared inputs, composition, and rounding

**Compensation measures** (Stage 1 §10 — shared inputs to T-02, T-04–T-06, I-01–I-04). Each formula takes `C̄_t` as an input; the measure is a plan term, not a free choice: final `n`-year average (plan says "final"); highest `n`-year average (plan says "highest" — commonest); career average (T-05); 5-year highest, disregarding years without a year of service (C-03 minimum); high-3 (X-01 compensation limit); §415(c)(3) compensation (statutory — §415, HCE/key-employee status); §414(s) compensation (safe-harbour or reasonable nondiscriminatory definition — nondiscrimination, safe-harbour designs). Rules: the plan's definition governs the benefit; §414(s) must be used for safe-harbour and §401(a)(4) testing (DBAB Q 9:38–9:39); §415(c)(3) must be used for §415 limits, HCE/key status, top-heavy contributions, and deductions (Q 9:41); a non-safe-harbour definition is allowed only if reasonable, non-discriminatory, and passing the annual test (Q 9:42–9:45); a definition as a percentage of another definition, or as one month's pay, is per se unreasonable (Q 9:44). Each compensation year is capped at its year's §401(a)(17) limit (X-02). Self-employed earned income follows §401(c)(2) (Q 9:48).

**Composition order** (Stage 1 §12, step 10). A per-participant classification is `{formula_id, period_structure, accrual_method, integration, offsets, caps, vesting, basis}` — each element sourced to a document page/section or marked unknown. Evaluation order: base formula (T-/S-) → period/group combination (C-06/C-07) → integration/offsets (I-) → greater-of/lesser-of/minimum/grandfather (C-01–C-05) → §415 (X-01) → §401(a)(17) is applied per-year inside the compensation inputs (X-02) → service cap (T-09) → vesting (X-05) → form/age conversion (X-03) only when the comparison basis requires B4. A combination that cannot be evaluated at any step returns the `bound`/`scenarios`/`indeterminate` of that step, propagated, never a partial point value presented as complete.

**Rounding** (Stage 1 §11; MASTER_PROMPT §9). No universal PBGC rounding policy for benefit amounts was found. Rounding is plan-specific and stage-specific: the engine must support configurable rounding for compensation, average compensation, credited service, accrual percentages, Social Security offsets, intermediate benefit components, retirement factors, actuarial equivalence factors, and final monthly benefits — applied after individual operations, annual accruals, intermediate results, or final calculation, as the plan or the evidence requires (carried per function as `CalcContext.rounding`). Rounding as a diagnostic hypothesis: when `|PA_AMB − B̂|` is small, test the plausible rounding sequences (round the average vs round the final benefit; round service vs keep fractional; round the factor to 4 decimals vs keep full precision). A match under one sequence is a hypothesis with a stated prior, not proof — and a match obtained by *arbitrarily* changing rounding conventions must not be treated as proof of the administrator's methodology. The PF file practice of rounding factors to 4 decimals is a *factor* convention, not a benefit-rounding policy, and must not be imported.

### 8. Formula count and traceability

**34 formula types specified:** 9 traditional (T-01–T-09), 5 integrated (I-01–I-05), 7 combination (C-01–C-07), 8 special designs (S-01–S-08), 5 cross-cutting caps/conversions (X-01–X-05). Every entry carries its Stage 1 items 1–9 (definition, inputs, predicates, effective-date rules, sequence, rounding, output basis, sources, boundaries/exceptions) in compact form and item 11 (bounds/scenarios when exact reconstruction is impossible) as its **If inexact** line. Item 10 (synthetic test example) is referenced, not repeated — see §0.

| Stage 1 section | IDs in this file | Trace |
|---|---|---|
| §5 Traditional | T-01–T-09 | §2 above |
| §6 Integrated | I-01–I-05 | §3 above |
| §7 Combination | C-01–C-07 | §4 above |
| §8 Special designs | S-01–S-08 | §5 above |
| §9 Cross-cutting | X-01–X-05 | §6 above |
| §10 Compensation measures | (shared inputs) | §7 above |
| §11 Rounding | (shared rule) | §7 above |
| §12 Classification key | (composition order) | §7 above |

**Design decisions recorded in this file (not in Stage 1):**
1. `CalcResult<T>` as the single return type for all 34 functions — `exact` / `bound` / `scenarios` / `indeterminate` — so impossibility is a first-class result, not an exception or a null. This is the direct implementation of the standing requirement.
2. `DatedValue<T>` for every plan parameter (`D`, `α`, `β`, `L`, `S_max`, rates): a parameter is meaningless without the PlanVersion that supplies it, and a later amendment must never silently re-price an earlier calculation.
3. X-02 is specified as a per-year input transform returning capped compensation, not as a benefit function — because the cap applies to compensation *years*, not to the average or the benefit.
4. T-09 is specified as a higher-order wrapper over any of T-01–T-08 (the underlying formula is a parameter), because the cap applies to service counted, not to the benefit directly.
5. `CalcContext.rounding` is a required parameter on every function with no default: no rounding is assumed, and a function called without a plan-stated rounding source must record `rounding.source = "unknown"` and treat rounding-sensitive matches as hypotheses only.
6. The §411(b)(1)(G) / §411(d)(6) / §411(a)(9) anti-decrease guardrails are post-condition checks on every function (§1), reported as `indeterminate` with the violation named.

### 9. Open decisions (formula catalog)

1. **Covered-compensation tables (I-02) and post-2023 §415 / §401(a)(17) tables (X-01, X-02) are referenced but not embedded.** Stage 1 §13.4 records that the covered-compensation tables (IRS, by year) and the §415 / §401(a)(17) tables after 2023 are referenced but not embedded. This catalog takes them as loaded, versioned table parameters (`CoveredCompTable`, `Section415Table`, `Section401a17Table`). Stage 2/3 must decide: the table source (IRS publication), the loading/verification procedure, the versioning scheme, and the values through the current year. Until a table is loaded, any function depending on it returns `indeterminate` — never a neighbouring year's value.
2. **BCV add-in function signatures to confirm (X-03).** Stage 1 §13.2 cites `ERFAEQ` / `LRFAEQ` / `BFCFAEQ` from BCV ATPBGC Add-ins (Jul 2024) with argument order and examples (e.g. `ERFAEQ(.06,"M",65,120,0,"GM83","GF83","MP","Y") = 0.4073`; `BFCFAEQ("SLA",0,0,0,"JSC",0.5,0,0,65,61,"M","F",0.06,"LS00SU2015","LS00SU2015","MP","N") = 0.9112`). Two items need confirmation before Stage 4: (a) the full argument lists (the add-in doc's examples show the leading arguments; the trailing arguments were not re-verified in Stage 1 — see Stage 1 output 00, source #11); (b) the open BFCF sex-args item from prior work — the doc example uses `"M","F"`, while the PF example file and app use `"M","M"` (recorded in the project memory, OPEN_ITEMS.md item 2). X-03 must not be implemented against either until this is resolved.
3. **Top-heavy vesting schedule (X-05).** Stage 1 states the top-heavy vesting schedule as "2-year cliff or 6-year graded is the statutory minimum — verify in Ch. 8, not assumed here." Confirm against DBAB Ch. 8 before Stage 4.
4. **Pension equity conversion factors (S-02).** Stage 1 gives the annuity conversion as `APR_NRA` / the plan's factor table without specifying the table's form. Stage 2/3 must decide whether the PEP conversion uses the same APR machinery as S-01/X-03 or a plan-specific factor table, and what the parameter type is.
5. **Federal midterm rates table (S-05).** The §411(c) accumulation needs the federal midterm rate by year as a loaded table; its source and versioning are undecided (same treatment as decision 1).
6. **Acceptance tolerance framework.** Not decided here and not a formula matter: Stage 1 output 03 owns it. The $1.00/$5.00 Policy 5.8-1 tolerances govern correction of PBGC benefit determinations/payments and pre-termination liabilities — they are **not** adopted as PA_AMB acceptance tolerances. No source states any tolerance for the PA_AMB accept/reject decision; the reconciliation tolerance is a documented human-set per-case parameter.
7. **DOBF grain (S-06, I-05).** `DOBF` must always be qualified plan-level vs participant-level (Stage 1 §1.5). The data model must enforce the qualifier; this catalog uses the participant-level field.
8. **Accrued-benefit decreases on falling compensation (T-02, T-04, T-06, S-02).** Flagged conflict in Stage 1 §13.3.1: the 2003 Gray Book (Q&A 33) said an accrued benefit cannot fall when the average falls; the 2015 Gray Book (Q&A 35) says it can for pension equity plans, and DBAB Q 9:15 treats this as a general change of IRS position. The engine must treat a falling-average decrease as a hypothesis to be tested against the plan's design (PEP vs traditional), not as a settled rule either way.
9. **Offset in a frozen floor-offset plan (I-05, S-06).** Flagged in Stage 1 §13.3.2: the IRS position (2005 ASPPA Q&A 5, informal) is that the offset freezes with the DB plan; DBAB Q 4:29 notes it is "not entirely clear" whether interest-only growth of the DC account may still reduce the benefit. Both readings are scenarios until the plan document or a PBGC source settles it.

---

*End of §11 — formula catalog. Companion: `stage2/01-data-model.md` (§5 `TypedBenefitQuantity`). Stage 1 basis: `stage1/01-formula-classification.md` (34 types, items 1–11), `stage1/00-source-inventory.md`.*

---

## Sources

| Source | What was taken from it |
|---|---|
| `MASTER_PROMPT.md` §3, §8, §9, §10, §12, §14, §17 | Typed benefit; ten stages; rounding; reconciliation; missing data; dispositions; state-driven design |
| Stage 1 output 03 (`03-reconciliation-statistical-methodology.md`) §0–§2, §4 | Δ/D/R definitions; tolerance framework (T-1–T-5); denominator flags; counterfactual minimum set and ranking; rounding anti-coincidence rule; bounds rules B-1–B-5; five-way missing-data classes; scenario/sensitivity; disposition mapping |
| Stage 1 output 04 (`04-architecture-decision.md`) §0, §6–§7 | Option C (Hybrid), staged; pure core; invariants (reproducibility, no silent failure, no invented exactness); single HTML file, 0 fetch |
| Stage 2 output 01 (`01-data-model.md`) §1.2, §5, §7 | `Money` / `MoneyMinor` (integer minor units); `TypedBenefitQuantity`; `CalculationStep`; `Scenario`; `BenefitCalculation`; `BenefitComparison`; `ToleranceRecord`; missing-data classes |
| Defined Benefit Answer Book, Ch. 9 | Accrued benefit can decrease when a Social Security offset increases (Stage 7 note) |
| Defined Benefit Answer Book, Ch. 16, Q 16:6 | Census data used "to calculate accrued benefits and to determine the reasonableness of assumptions" |
| PBGC Operating Policy 5.8-1, Benefit Corrections, 3rd Ed., 10/02/2014 | $1.00 / $5.00 correction tolerances and "reasonable certainty" standard — cited only as the nearest PBGC authority and as labelled borrowed screening values, never as a reconciliation rule |

*No live case data, no participant-level census rows, no golden case were used. All worked
examples are synthetic and fictional.*
