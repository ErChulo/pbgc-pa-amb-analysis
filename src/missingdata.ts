/**
 * Missing-data framework — Stage 5 (Worker 3).
 *
 * Governing spec: MASTER_PROMPT §12 (missing-data analysis and
 * uncertainty); Stage 1 output 03, Part C (§4.1–§4.7); monadic spec §2.6
 * (StatisticalCalc: statistics are diagnostic evidence, never benefit
 * amounts) and §5 invariants I and K.
 *
 * What this module does:
 * - The five-way split M1–M5 (§4.1) as a pure classification function.
 * - MCAR / MAR / MNAR classification with stated criteria (§4.1).
 * - Blanks are missing, never zero (§4.2): a blank input is `null` plus
 *   a MissingDataItem, never 0, and never enters a calculation as 0.
 * - Mathematically justified bounds B_i^min ≤ B_i^possible ≤ B_i^max
 *   (§4.3, rules B-1–B-5), wired to src/bounds.ts — this module never
 *   re-derives bounds arithmetic. Bounds are NOT confidence intervals
 *   (B-2): a confidence interval passed as bounds is refused.
 * - Scenario / sensitivity analysis in decision terms (§4.4): which
 *   scenarios change the disposition, which do not.
 * - Per-input uncertainty attribution (§4.5), wired to bounds.ts
 *   attributeWidth (leave-one-out), plus a normalised allocation that
 *   sums to the total width for reporting.
 * - Data-request prioritisation by expected decision effect (§4.6).
 *
 * What this module never does:
 * - It never invents a missing value, never fills a blank with zero, and
 *   never uses multiple imputation (or any statistical fill) for an
 *   individual participant's benefit inputs (§4.1 boundary). Imputation
 *   is a population-level statistical device only; it has no function
 *   here.
 * - It never supplies a default tolerance, materiality threshold, or
 *   plan-specific value. Thresholds the spec leaves to the actuary
 *   (τ_material, ε_R) arrive as caller-supplied per-case inputs; when
 *   one is missing the affected question is refused as Indeterminate,
 *   never silently defaulted.
 *
 * Pure functions only. No clock, no storage, no network, no randomness.
 * Money is integer minor units (cents). Synthetic data only.
 */

import type {
  BoundsResult,
  DateString,
  DecimalString,
  Disposition,
  MissingDataClass,
  MissingDataItem,
  Money,
  WidthAttribution,
} from "./types";
import type { DeterminationDataRequest } from "./determination";
import {
  attributeWidth,
  boundsWidthMinor,
  checkMonotonicity,
} from "./bounds";
import { makeMoney } from "./decimal";

// ---------------------------------------------------------------------------
// M1–M5: the five-way split (Stage 1 output 03, §4.1)
// ---------------------------------------------------------------------------

/** The five classes in the methodology's own spelling. The data model
 *  spells them "a"–"e" (types.ts MissingDataClass); this module accepts
 *  and returns both spellings and converts explicitly, never silently. */
export type MissingClassLabel = "M1" | "M2" | "M3" | "M4" | "M5";

export const MISSING_CLASS_LABELS: ReadonlyArray<{
  code: MissingDataClass;
  label: MissingClassLabel;
  meaning: string;
}> = [
  { code: "a", label: "M1", meaning: "Required for exact reconstruction; no substitute exists" },
  { code: "b", label: "M2", meaning: "Recoverable from other documents" },
  { code: "c", label: "M3", meaning: "Reasonable bounds establishable" },
  { code: "d", label: "M4", meaning: "Requires an actuarial assumption" },
  { code: "e", label: "M5", meaning: "Absence makes reconstruction indeterminate" },
];

export function missingClassLabel(code: MissingDataClass): MissingClassLabel {
  switch (code) {
    case "a": return "M1";
    case "b": return "M2";
    case "c": return "M3";
    case "d": return "M4";
    case "e": return "M5";
  }
}

export function missingClassCode(label: MissingClassLabel): MissingDataClass {
  switch (label) {
    case "M1": return "a";
    case "M2": return "b";
    case "M3": return "c";
    case "M4": return "d";
    case "M5": return "e";
  }
}

/**
 * Evidence the classifier reads for one missing input. Every field is
 * caller-stated evidence, never inferred by this module:
 * - `recoverableSource`: the other document the value exists in, or null.
 * - `feasibleRange`: the stated feasible range with its basis, or null.
 * - `loadBearingUnconstrained`: true when the input is load-bearing and
 *   unconstrained — e.g. the formula itself is unknown for the
 *   participant's era, or no compensation history at all and no bound
 *   can be justified (§4.1, class M5).
 * - `assumptionAvailable`: a stated actuarial assumption exists that
 *   could stand in for the value, with its basis — or null.
 *
 * Classification order (§4.1, recorded here because the methodology
 * states the five classes but not their precedence when several apply):
 * recoverable (M2) first — a value that exists elsewhere is retrieved,
 * not bounded; then boundable (M3); then load-bearing and unconstrained
 * (M5) — an assumption never rescues a load-bearing unknown, because an
 * assumed formula is not a reconstruction; then assumption (M4); then
 * M1 (required for exact reconstruction, no substitute — the exact path
 * stops here and the case goes to bounds or Indeterminate downstream).
 */
export interface ClassifyMissingInputArgs {
  field: string;
  recoverableSource: string | null;
  feasibleRange: { low: DecimalString; high: DecimalString; unit: string; basis: string } | null;
  loadBearingUnconstrained: boolean;
  assumptionAvailable: string | null;
}

export interface ClassifiedMissingInput {
  item: MissingDataItem;
  rationale: string;
}

export function classifyMissingInput(args: ClassifyMissingInputArgs): ClassifiedMissingInput {
  if (args.recoverableSource !== null && args.recoverableSource.trim() !== "") {
    return {
      item: {
        field: args.field,
        missingClass: "b",
        consequence: "Reconstruction is pending retrieval, not failed; a data request / retrieval task is created.",
        resolvesBy: args.recoverableSource,
      },
      rationale: `M2 — the value exists in another source (${args.recoverableSource}); recoverable, not bounded or assumed.`,
    };
  }
  if (args.feasibleRange !== null) {
    return {
      item: {
        field: args.field,
        missingClass: "c",
        consequence: "Exact reconstruction is impossible; justified bounds are computed under the stated feasible range.",
        resolvesBy: args.feasibleRange.basis,
      },
      rationale: `M3 — the value is unknown but constrained to [${args.feasibleRange.low}, ${args.feasibleRange.high}] ${args.feasibleRange.unit} (${args.feasibleRange.basis}).`,
    };
  }
  if (args.loadBearingUnconstrained) {
    return {
      item: {
        field: args.field,
        missingClass: "e",
        consequence: "No exact benefit and no justified bounds; disposition Indeterminate unless another line of evidence supports acceptance.",
        resolvesBy: null,
      },
      rationale: "M5 — the missing input is load-bearing and unconstrained; no bound can be justified and no assumption rescues it.",
    };
  }
  if (args.assumptionAvailable !== null && args.assumptionAvailable.trim() !== "") {
    return {
      item: {
        field: args.field,
        missingClass: "d",
        consequence: "The result is labelled assumption-dependent; the assumption is stated explicitly with its basis and its effect on the result.",
        resolvesBy: null,
      },
      rationale: `M4 — no document constrains the value; an actuarial assumption is needed (${args.assumptionAvailable}).`,
    };
  }
  return {
    item: {
      field: args.field,
      missingClass: "a",
      consequence: "The benefit cannot be computed exactly without it; go to bounds (§4.3) or Indeterminate.",
      resolvesBy: null,
    },
    rationale: "M1 — required for exact reconstruction and no substitute exists; the exact path stops here.",
  };
}

// ---------------------------------------------------------------------------
// Blanks are missing, never zero (Stage 1 output 03, §4.2)
// ---------------------------------------------------------------------------

/**
 * Record a blank input as missing data. Returns the value (`null`) and
 * the MissingDataItem together, so a caller can never hold one without
 * the other. There is deliberately no code path in this module that
 * produces a 0 for a blank: a recorded zero is a different thing — a
 * value, investigated as one — and must be recorded through the normal
 * value path, never through this function.
 */
export function blankInput(args: {
  field: string;
  missingClass: MissingDataClass;
  consequence: string;
  resolvesBy: string | null;
}): { value: null; item: MissingDataItem } {
  return {
    value: null,
    item: {
      field: args.field,
      missingClass: args.missingClass,
      consequence: args.consequence,
      resolvesBy: args.resolvesBy,
    },
  };
}

/** The blank PA_AMB itself: `null` plus a MissingDataItem, never 0. */
export function blankPaAmb(args: {
  participantKey: string;
  resolvesBy: string | null;
}): { value: null; item: MissingDataItem } {
  void args.participantKey;
  return blankInput({
    field: "PA_AMB",
    missingClass: "a",
    consequence: "Recorded administrator benefit is missing; enters the §12 framework, not the reconciliation arithmetic. No Δ is computed.",
    resolvesBy: args.resolvesBy,
  });
}

/**
 * Guard: refuse to use a value as a benefit input when it is a blank
 * that was (or would be) filled with zero. Returns a refusal reason, or
 * null when the value is a genuine recorded value (including a genuine
 * recorded zero, which is a value and is investigated as one).
 */
export function refuseZeroFill(args: {
  field: string;
  value: Money | null;
  wasBlank: boolean;
}): string | null {
  if (args.wasBlank) {
    return `Blank ${args.field} is missing data, never zero (§4.2): it must be recorded as null plus a MissingDataItem, never entered into a calculation as 0.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Missingness mechanism — MCAR / MAR / MNAR (Stage 1 output 03, §4.1;
// Little & Rubin, 2019; Rubin, 1976)
// ---------------------------------------------------------------------------

export type MissingnessMechanism = "MCAR" | "MAR" | "MNAR" | "unassessed";

/**
 * Evidence the mechanism classifier reads. The mechanism is never
 * inferred from the observed data alone — MAR cannot be tested against
 * MNAR from observed data (§4.1) — so the caller states the evidence:
 * - `littleMcarTestPassed`: Little's MCAR test (Little, 1988) passed on
 *   the observed data, or null when the test was not run.
 * - `observedPredictorsOfMissingness`: observed variables the missingness
 *   is known to depend on (empty when none is known).
 * - `dependsOnMissingValueItself`: stated mechanism by which missingness
 *   depends on the missing value itself (e.g. "benefits missing precisely
 *   because the administrator could not compute them"), or null.
 *
 * Rules, from §4.1:
 * - MNAR wins over MAR/MCAR: a stated dependence on the missing value
 *   itself is the most dangerous case and is never downgraded by a
 *   passing MCAR test on observed data.
 * - A claimed MCAR is refused (returned as a refusal, not a mechanism)
 *   when observed predictors of missingness are named: missingness that
 *   depends on observed data is not completely at random.
 * - With no evidence either way the mechanism is "unassessed", never a
 *   default MCAR.
 */
export interface ClassifyMissingnessArgs {
  field: string;
  littleMcarTestPassed: boolean | null;
  observedPredictorsOfMissingness: string[];
  dependsOnMissingValueItself: string | null;
}

export type MissingnessClassification = {
  mechanism: MissingnessMechanism | "refused";
  /** Why this mechanism, when classified. Empty when refused. */
  rationale: string;
  /** Why the classification was refused, when refused. Null otherwise. */
  reason: string | null;
};

export function classifyMissingness(
  args: ClassifyMissingnessArgs,
): MissingnessClassification {
  if (
    args.dependsOnMissingValueItself !== null &&
    args.dependsOnMissingValueItself.trim() !== ""
  ) {
    return {
      mechanism: "MNAR",
      rationale:
        `MNAR — missingness depends on the missing value itself: ${args.dependsOnMissingValueItself}. ` +
        `Not identifiable from observed data; requires sensitivity analysis (§4.4) and documented judgment. ` +
        `Multiple imputation must never be used to fill this participant's inputs.`,
      reason: null,
    };
  }
  if (args.observedPredictorsOfMissingness.length > 0) {
    if (args.littleMcarTestPassed === true) {
      return {
        mechanism: "refused",
        rationale: "",
        reason:
          `Refused: missingness for ${args.field} is stated to depend on observed data ` +
          `(${args.observedPredictorsOfMissingness.join(", ")}), which contradicts a passing Little's MCAR test. ` +
          `MCAR requires missingness unrelated to observed or unobserved values; re-state the evidence.`,
      };
    }
    return {
      mechanism: "MAR",
      rationale:
        `MAR — missingness depends on observed data only (${args.observedPredictorsOfMissingness.join(", ")}). ` +
        `Not testable against MNAR from the observed data. Multiple imputation under a correctly specified model is the ` +
        `standard approach for statistical summaries and models only — never for an individual participant's benefit inputs.`,
      reason: null,
    };
  }
  if (args.littleMcarTestPassed === true) {
    return {
      mechanism: "MCAR",
      rationale:
        "MCAR — Little's MCAR test passed and no dependence on observed or unobserved values is stated. " +
        "Complete-case summaries are unbiased (but inefficient) under MCAR.",
      reason: null,
    };
  }
  return {
    mechanism: "unassessed",
    rationale:
      "Unassessed — no MCAR test result and no stated dependence; the mechanism is not defaulted to MCAR.",
    reason: null,
  };
}

// ---------------------------------------------------------------------------
// Justified bounds (Stage 1 output 03, §4.3, rules B-1–B-5)
// ---------------------------------------------------------------------------

/**
 * One stated justification for a bound. A bound is justified either by
 * a documented fact (e.g. a §401(a)(17) cap in effect, adjacent known
 * years) or by a stated assumption. Rule B-1 requires every bound to
 * state the assumptions that produce it; rule B-4 requires an
 * assumption that narrows the bounds to be stated as an assumption, with
 * the assumption-free bounds also reported. A bound with neither a fact
 * nor an assumption is refused — see `validateBoundsJustification`.
 */
export interface BoundJustification {
  kind: "fact" | "assumption";
  statement: string;
}

/** A candidate bound pair submitted for justification checking. */
export interface CandidateBounds {
  participantKey: string;
  minMinor: number;
  maxMinor: number;
  justifications: BoundJustification[];
  /** The derivation method actually used (bounds.ts BoundsDerivation). */
  derivationMethod: BoundsResult["derivation"]["method"];
  /** Monotonicity verification per missing input, from bounds.ts
   *  checkMonotonicity (endpoint + kink evaluation). */
  monotonicity: Array<{ input: string; monotone: boolean; verifiedBy: string }>;
  feasibleRegion: string;
  /** Assumption-free bounds, when an assumption narrowed the range
   *  (B-4). Null when no assumption narrowed the bounds. */
  assumptionFreeBounds: { minMinor: number; maxMinor: number } | null;
}

export interface BoundsValidation {
  ok: boolean;
  failures: string[];
}

/**
 * Validate a candidate bound pair against B-1–B-5. Refusals, as values:
 * - no justification at all (B-1);
 * - min > max;
 * - any input non-monotone (B-3): endpoint-only bounds for a
 *   non-monotone formula are wrong — the caller must fall back to a
 *   grid / optimisation over the feasible region, not proceed;
 * - an assumption narrowed the bounds but no assumption-free bounds
 *   were also reported (B-4).
 * A bound that passes here is justified; it is still not an exact
 * benefit and must never be compared to PA_AMB as if it were one.
 */
export function validateBoundsJustification(bounds: CandidateBounds): BoundsValidation {
  const failures: string[] = [];
  if (bounds.minMinor > bounds.maxMinor) {
    failures.push(
      `Bounds for ${bounds.participantKey} are reversed: min ${bounds.minMinor} exceeds max ${bounds.maxMinor} minor units.`,
    );
  }
  if (bounds.justifications.length === 0) {
    failures.push(
      `Bounds for ${bounds.participantKey} state no justification: every bound must state the facts and assumptions that produce it (B-1). A bound without a stated assumption or a stated factual basis is refused.`,
    );
  }
  for (const entry of bounds.monotonicity) {
    if (!entry.monotone) {
      failures.push(
        `Bounds for ${bounds.participantKey} are not justified for input ${entry.input}: the benefit is non-monotone in that input (${entry.verifiedBy}). Endpoint-only bounds for a non-monotone formula are wrong (B-3); fall back to a grid / optimisation over the feasible region.`,
      );
    }
  }
  const hasNarrowingAssumption = bounds.justifications.some((j) => j.kind === "assumption");
  if (hasNarrowingAssumption && bounds.assumptionFreeBounds === null) {
    failures.push(
      `Bounds for ${bounds.participantKey} use an assumption that narrows the range but no assumption-free bounds were reported (B-4): the actuary must see what the assumption bought.`,
    );
  }
  if (
    bounds.assumptionFreeBounds !== null &&
    (bounds.assumptionFreeBounds.minMinor > bounds.minMinor ||
      bounds.assumptionFreeBounds.maxMinor < bounds.maxMinor)
  ) {
    failures.push(
      `Bounds for ${bounds.participantKey} are inconsistent: the assumption-narrowed range [${bounds.minMinor}, ${bounds.maxMinor}] is not contained in the assumption-free range [${bounds.assumptionFreeBounds.minMinor}, ${bounds.assumptionFreeBounds.maxMinor}] (B-4).`,
    );
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Monotonicity / kink verification for one missing input, wired to
 * bounds.ts checkMonotonicity: the benefit is evaluated at the
 * endpoints AND at any internal kink points (cap thresholds, freeze
 * dates, formula-change dates). Returns the bounds.ts result
 * unchanged — this module adds the refusal interpretation, not new
 * arithmetic.
 */
export function verifyBoundsMonotonicity(args: {
  input: string;
  points: Array<{ inputValue: DecimalString; benefitMinor: number }>;
}): { input: string; monotone: boolean; verifiedBy: string } {
  return checkMonotonicity(args.input, args.points);
}

/** Where the recorded PA_AMB falls against justified bounds (B-5). */
export type RecordedBoundsPosition = "inside" | "below-min" | "above-max" | "recorded-missing";

export function recordedBoundsPosition(args: {
  recordedMinor: number | null;
  minMinor: number;
  maxMinor: number;
}): RecordedBoundsPosition {
  if (args.recordedMinor === null) return "recorded-missing";
  if (args.recordedMinor < args.minMinor) return "below-min";
  if (args.recordedMinor > args.maxMinor) return "above-max";
  return "inside";
}

// ---------------------------------------------------------------------------
// Bounds are NOT confidence intervals (rule B-2)
// ---------------------------------------------------------------------------

/**
 * A statistical interval submitted where justified bounds are required.
 * `level` is the confidence level (e.g. "95%"); `method` names the
 * statistical procedure. Bounds in this system are guarantees
 * conditional on stated assumptions; a confidence interval is a
 * statement about sampling uncertainty. The two must never be confused
 * or relabelled.
 */
export interface ConfidenceIntervalSubmission {
  level: string;
  lowerMinor: number;
  upperMinor: number;
  method: string;
}

/**
 * Refuse a confidence interval as bounds, always. This function has no
 * success path: a confidence interval is never acceptable as justified
 * bounds, whatever its level or width. The refusal names the rule (B-2)
 * and what to do instead (derive bounds by evaluating the formula at
 * the extreme values of the missing inputs consistent with the known
 * facts and the plan provisions).
 */
export function refuseConfidenceIntervalAsBounds(
  interval: ConfidenceIntervalSubmission,
): { ok: false; reason: string } {
  return {
    ok: false,
    reason:
      `Refused: a ${interval.level} confidence interval (${interval.method}, [${interval.lowerMinor}, ${interval.upperMinor}] minor units) ` +
      `is a statement about sampling uncertainty, not a guaranteed bound (B-2). Bounds must be derived by evaluating the benefit ` +
      `formula at the extreme values of the missing inputs consistent with the known facts and the plan provisions, under explicit stated assumptions.`,
  };
}

/**
 * Detect a confidence-interval relabel in a candidate bound's stated
 * derivation: any derivation method or justification that describes the
 * interval as a confidence interval (or by a confidence level) is
 * refused. Case-insensitive; matches "confidence interval", "CI",
 * "95%"-style levels in the method text.
 */
export function detectConfidenceIntervalRelabel(args: {
  derivationMethodText: string;
  justifications: BoundJustification[];
}): string | null {
  const haystack = [
    args.derivationMethodText,
    ...args.justifications.map((j) => j.statement),
  ].join(" ").toLowerCase();
  if (
    haystack.includes("confidence interval") ||
    haystack.includes("confidence-interval") ||
    /\b\d{2,3}%\s*(confidence|ci)\b/.test(haystack) ||
    /\bci\b/.test(haystack)
  ) {
    return "Refused (B-2): the bound's derivation describes a confidence interval, not mathematically justified bounds. A confidence interval relabelled as bounds is never accepted.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scenario / sensitivity analysis in decision terms (§4.4)
// ---------------------------------------------------------------------------

/** One evaluated scenario: a named, reproducible alternative with its
 *  stated assumptions, the benefit under it, and the disposition it
 *  would produce. A scenario's benefit is never presented as the
 *  benefit. */
export interface ScenarioEvaluation {
  scenarioName: string;
  assumptions: string;
  benefitMinor: number | null;
  /** The disposition the participant would receive under this scenario. */
  disposition: Disposition;
}

export interface ScenarioSensitivity {
  scenarioName: string;
  assumptions: string;
  benefitMinor: number | null;
  disposition: Disposition;
  /** True when this scenario's disposition differs from the baseline
   *  disposition: the scenario is decision-relevant (§4.4). */
  decisionRelevant: boolean;
  /** The disposition change, when decision-relevant. */
  dispositionChange: { from: Disposition; to: Disposition } | null;
}

/**
 * Evaluate scenarios in decision terms (§4.4). The key question is not
 * "how much does the benefit move?" but "does the decision change?" A
 * scenario that moves the benefit by $200/month but never moves the
 * participant out of tolerance is less important than one that moves it
 * by $3/month across a disposition boundary.
 */
export function evaluateScenarioSensitivity(args: {
  baselineDisposition: Disposition;
  scenarios: ScenarioEvaluation[];
}): ScenarioSensitivity[] {
  return args.scenarios.map((scenario) => {
    const decisionRelevant = scenario.disposition !== args.baselineDisposition;
    return {
      scenarioName: scenario.scenarioName,
      assumptions: scenario.assumptions,
      benefitMinor: scenario.benefitMinor,
      disposition: scenario.disposition,
      decisionRelevant,
      dispositionChange: decisionRelevant
        ? { from: args.baselineDisposition, to: scenario.disposition }
        : null,
    };
  });
}

/** One-input-at-a-time sensitivity for one missing input (§4.4). */
export interface InputSensitivity {
  missingInput: string;
  missingClass: MissingDataClass;
  /** Benefit movement across the input's plausible range, minor units. */
  benefitMovementMinor: number;
  /** True when varying this input across its range changes the disposition. */
  changesDisposition: boolean;
  /** The dispositions reached at the range ends, when they differ. */
  dispositionsAtEnds: { low: Disposition; high: Disposition } | null;
}

/**
 * Tornado ranking (§4.4): disposition-changing inputs first (largest
 * disposition-changing effect first is the primary output — here
 * "largest" is the benefit movement among the disposition-changing
 * inputs), then the rest by benefit movement. Inputs that never change
 * the disposition rank below every input that can, whatever their
 * dollar movement.
 */
export function rankSensitivity(inputs: InputSensitivity[]): InputSensitivity[] {
  return [...inputs].sort((a, b) => {
    if (a.changesDisposition !== b.changesDisposition) {
      return a.changesDisposition ? -1 : 1;
    }
    return b.benefitMovementMinor - a.benefitMovementMinor;
  });
}

// ---------------------------------------------------------------------------
// Per-input uncertainty attribution (§4.5)
// ---------------------------------------------------------------------------

/**
 * Leave-one-out width attribution, wired to bounds.ts attributeWidth:
 * recompute the bounds with each missing input hypothetically known at
 * its midpoint (labelled as an assumption) and record how much the
 * interval narrows. `couldChangeDisposition` is caller-stated (does
 * resolving the input move the participant across a tolerance or
 * disposition boundary?).
 */
export function attributeUncertainty(args: {
  totalMinMinor: number;
  totalMaxMinor: number;
  inputs: Array<{
    missingInput: string;
    missingClass: MissingDataClass;
    narrowedWidthMinor: number;
    couldChangeDisposition: boolean;
  }>;
}): WidthAttribution[] {
  return attributeWidth({
    totalMinMinor: args.totalMinMinor,
    totalMaxMinor: args.totalMaxMinor,
    inputs: args.inputs,
  });
}

/**
 * The reporting allocation: leave-one-out contributions are NOT
 * additive (inputs overlap — fixing two inputs at once narrows more
 * than the sum of fixing each alone, or less), so the raw contributions
 * generally do not sum to the total width. This function allocates the
 * total width across the inputs in proportion to their leave-one-out
 * contributions, so the reported contributions sum exactly to the total
 * width and the shares sum to 1. The raw leave-one-out values are
 * retained on the input attributions; this is the reporting form only,
 * and it is labelled as such. Integer-minor rounding: the last input
 * absorbs the remainder so the sum is exact.
 */
export function normalisedWidthAllocation(args: {
  totalMinMinor: number;
  totalMaxMinor: number;
  attributions: WidthAttribution[];
}): Array<{
  missingInput: string;
  missingClass: MissingDataClass;
  widthContribution: Money;
  widthShare: DecimalString;
  couldChangeDisposition: boolean;
}> {
  const totalWidth = args.totalMaxMinor - args.totalMinMinor;
  const rawTotal = args.attributions.reduce(
    (sum, a) => sum + a.widthContribution.amountMinor,
    0,
  );
  if (args.attributions.length === 0 || totalWidth === 0) {
    return args.attributions.map((a) => ({
      missingInput: a.missingInput,
      missingClass: a.missingClass,
      widthContribution: makeMoney(0),
      widthShare: "0",
      couldChangeDisposition: a.couldChangeDisposition,
    }));
  }
  if (rawTotal === 0) {
    // No input narrows the interval alone: split the width evenly so the
    // allocation still sums to the total; the equal split is labelled by
    // the zero raw contributions, not hidden.
    const each = Math.floor(totalWidth / args.attributions.length);
    const remainder = totalWidth - each * args.attributions.length;
    return args.attributions.map((a, i) => ({
      missingInput: a.missingInput,
      missingClass: a.missingClass,
      widthContribution: makeMoney(each + (i === args.attributions.length - 1 ? remainder : 0)),
      widthShare: String(
        (each + (i === args.attributions.length - 1 ? remainder : 0)) / totalWidth,
      ),
      couldChangeDisposition: a.couldChangeDisposition,
    }));
  }
  let allocated = 0;
  return args.attributions.map((a, i) => {
    const isLast = i === args.attributions.length - 1;
    const share = a.widthContribution.amountMinor / rawTotal;
    const contribution = isLast
      ? totalWidth - allocated
      : Math.round(share * totalWidth);
    allocated += contribution;
    return {
      missingInput: a.missingInput,
      missingClass: a.missingClass,
      widthContribution: makeMoney(contribution),
      widthShare: String(contribution / totalWidth),
      couldChangeDisposition: a.couldChangeDisposition,
    };
  });
}

/** True when the normalised allocation sums exactly to the total width. */
export function allocationSumsToTotal(args: {
  totalMinMinor: number;
  totalMaxMinor: number;
  allocation: Array<{ widthContribution: Money }>;
}): boolean {
  const totalWidth = args.totalMaxMinor - args.totalMinMinor;
  const sum = args.allocation.reduce((s, a) => s + a.widthContribution.amountMinor, 0);
  return sum === totalWidth;
}

/** Plan-level aggregation (§4.5): sum of interval widths by
 *  missing-input type, showing which data gap matters most across the
 *  case. Inputs are grouped by field (the missing-input type). */
export function aggregateWidthByInputType(args: {
  participants: Array<{ participantKey: string; bounds: BoundsResult | null }>;
}): Array<{ missingInput: string; totalWidthMinor: number; participantCount: number }> {
  const byInput = new Map<string, { totalWidthMinor: number; participantCount: number }>();
  for (const participant of args.participants) {
    if (participant.bounds === null) continue;
    const width = boundsWidthMinor(participant.bounds);
    for (const attribution of participant.bounds.widthAttribution) {
      const entry = byInput.get(attribution.missingInput) ?? {
        totalWidthMinor: 0,
        participantCount: 0,
      };
      entry.totalWidthMinor += width;
      entry.participantCount += 1;
      byInput.set(attribution.missingInput, entry);
    }
  }
  return [...byInput.entries()]
    .map(([missingInput, entry]) => ({ missingInput, ...entry }))
    .sort((a, b) => b.totalWidthMinor - a.totalWidthMinor);
}

// ---------------------------------------------------------------------------
// Data-request prioritisation (§4.6)
// ---------------------------------------------------------------------------

/**
 * One candidate data request. Prioritisation factors, in order (§4.6):
 * 1. disposition-changing potential first;
 * 2. breadth (participants affected) second;
 * 3. recoverability (class M2 first — a known source and a high success
 *    probability) third;
 * 4. retrieval effort last, where recorded (high effort needs
 *    proportionally higher decision impact).
 * `effort` is caller-recorded; null means not recorded, and an
 * unrecorded effort never outranks a recorded one on this factor alone
 * — it is treated as medium for ordering, and the ordering rationale
 * says so.
 */
export interface DataRequestCandidate {
  requestId: string;
  input: string;
  participantKeys: string[];
  sourceToAsk: string;
  expectedDecisionEffect: string;
  missingClass: MissingClassLabel;
  couldChangeDisposition: boolean;
  effort: "low" | "medium" | "high" | null;
}

/**
 * Prioritise data requests by expected effect on the decision (§4.6).
 * Returns DeterminationDataRequest records (Stage 2 output 05, §5.3)
 * with priority 1 = highest, status "not-issued", and a statusReason
 * recording the ranking basis for each request. A request that returns
 * no data is recorded as such by the caller (status
 * "answered-no-data" / "exhausted") — the Indeterminate disposition
 * then stands on a documented exhausted search.
 */
export function prioritiseDataRequests(
  candidates: DataRequestCandidate[],
): DeterminationDataRequest[] {
  const effortRank = (effort: DataRequestCandidate["effort"]): number => {
    switch (effort) {
      case "low": return 0;
      case "medium": return 1;
      case null: return 1;
      case "high": return 2;
    }
  };
  const recoverabilityRank = (missingClass: MissingClassLabel): number =>
    missingClass === "M2" ? 0 : 1;
  const ranked = [...candidates].sort((a, b) => {
    if (a.couldChangeDisposition !== b.couldChangeDisposition) {
      return a.couldChangeDisposition ? -1 : 1;
    }
    if (a.participantKeys.length !== b.participantKeys.length) {
      return b.participantKeys.length - a.participantKeys.length;
    }
    if (recoverabilityRank(a.missingClass) !== recoverabilityRank(b.missingClass)) {
      return recoverabilityRank(a.missingClass) - recoverabilityRank(b.missingClass);
    }
    return effortRank(a.effort) - effortRank(b.effort);
  });
  return ranked.map((candidate, index) => {
    const priority = index + 1;
    const rankingBasis = [
      candidate.couldChangeDisposition
        ? "could change the disposition"
        : "does not change the disposition on current evidence",
      `${candidate.participantKeys.length} participant(s) affected`,
      candidate.missingClass === "M2"
        ? "recoverable from a known source"
        : `class ${candidate.missingClass}`,
      candidate.effort === null
        ? "retrieval effort not recorded (treated as medium for ordering)"
        : `retrieval effort ${candidate.effort}`,
    ].join("; ");
    return {
      requestId: candidate.requestId,
      input: candidate.input,
      participantKeys: [...candidate.participantKeys],
      sourceToAsk: candidate.sourceToAsk,
      expectedDecisionEffect: candidate.expectedDecisionEffect,
      priority,
      status: "not-issued",
      statusReason: `Priority ${priority} by expected decision effect (§4.6): ${rankingBasis}.`,
      requestedDate: null,
      answeredDate: null,
    } satisfies DeterminationDataRequest;
  });
}

/** Helper for tests / callers: the materiality comparison (B-5). True
 *  when the bound width is small relative to the caller-supplied
 *  materiality threshold τ_material (minor units). The threshold is a
 *  per-case actuary-set input; there is no default here. */
export function boundWidthIsImmaterial(args: {
  minMinor: number;
  maxMinor: number;
  materialityThresholdMinor: number;
}): boolean {
  return args.maxMinor - args.minMinor <= args.materialityThresholdMinor;
}

/** ISO date passthrough type re-export for callers that build
 *  DeterminationDataRequest records by hand. */
export type { DateString };
