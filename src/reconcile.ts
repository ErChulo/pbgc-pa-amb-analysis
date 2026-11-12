/**
 * Reconciliation — Stage 5 (Worker 1).
 *
 * Governing spec: MASTER_PROMPT §9 (rounding) and §10 (reconciliation);
 * Stage 1 output 03, Part A (§2.1–2.7): core definitions, preconditions,
 * zero/near-zero denominators, tolerance framework T-1–T-5, the H1–H17
 * hypothesis catalogue, counterfactual hypotheses and ranking, rounding
 * as a diagnostic with the mandatory anti-coincidence rule.
 *
 * This module builds ON src/reconciliation.ts (Stage 4), which owns the
 * hypothesis catalogue, ReconciliationInputs construction, counterfactual
 * construction, support validation, ranking, and conflict detection.
 * This module owns what Stage 2 output 04 §6 assigns to Stage 5:
 *
 * - Δ/D/R computation (in integer minor units, decimal-safe).
 * - The configurable tolerance framework (T-1–T-5) and the tolerance
 *   verdict. Tolerance is a comparison parameter, never a calculation
 *   input: changing it re-tests the comparison, it never re-runs the
 *   reconstruction (see `retestTolerance`).
 * - The per-participant reconciliation record, including the recommended
 *   disposition input. The system recommends; it never decides — the
 *   final decision is always a human reviewer (MASTER_PROMPT §14).
 * - Rounding as a diagnostic (§2.7) with the mandatory anti-coincidence
 *   rule.
 * - The hypothesis evaluation entry point: evaluated, ranked hypotheses
 *   with Supported / Plausible / Coincidence / Refuted labels, ranked by
 *   evidence and explanatory power via `rankCounterfactuals`, never by
 *   numeric proximity alone.
 *
 * What this module does NOT do:
 * - It does not build ReconciliationInputs (Stage 4, `reconciliation.ts`).
 * - It does not recompute benefits or run counterfactuals (the engine).
 *   A CounterfactualResult's recomputed benefit and residual discrepancy
 *   are caller-supplied; this module reads them, it never recomputes them.
 * - It does not decide dispositions (src/decisions.ts owns the state
 *   machine and the human approval gate). `recommendedDisposition` is an
 *   input to that process, not a decision.
 *
 * Money is integer minor units (cents); ratios use exact decimal
 * arithmetic (src/decimal.ts), never binary floats. Pure functions only.
 * No side effects, no network, no fetch. Synthetic data only.
 */

import type {
  BoundsResult,
  CounterfactualResult,
  DateString,
  DecimalString,
  Disposition,
  Money,
  MoneyMinor,
  ReconciliationInputs,
  ToleranceRecord,
  TypedBenefitQuantity,
} from "./types";
import {
  decCompare,
  decDivide,
  decMultiply,
  isCanonicalDecimalString,
  makeMoney,
  moneyMinorToDecimalString,
  parseDecimalString,
} from "./decimal";
import {
  describeRecordedPosition,
  findConflictingCorrections,
  rankCounterfactuals,
  validateCounterfactualSupport,
} from "./reconciliation";
import type { RankableCounterfactual, SupportClass } from "./reconciliation";

// ---------------------------------------------------------------------------
// Case-set reconciliation parameters (Stage 1 output 03, §2.3–2.4)
//
// The ToleranceRecord carries τ_abs, τ_rel, and the combination rule.
// Two further case parameters live here because the ToleranceRecord type
// (Stage 2 output 01, §7.1) does not carry them: ε_R (the small-
// denominator threshold, §2.3) and τ_material (the materiality threshold
// for plan-level reporting, §2.4). Both are actuary-set per case,
// recorded with their source, versioned with the calculation run —
// never hard-coded, never a universal default (rule T-1).
// ---------------------------------------------------------------------------

export interface ReconciliationConfig {
  /** ε_R in minor units: the small-denominator threshold (§2.3). A
   *  reconstructed benefit with 0 < |B̂_i| < ε_R gets its ratio flagged,
   *  never computed. Case-set by the actuary. */
  epsilonRMinor: MoneyMinor;
  /** How ε_R was set, e.g. "smallest monthly amount the plan can pay"
   *  or "$1.00/month — no plan minimum documented (03 §2.3)". */
  epsilonRSource: string;
  /** τ_material in minor units: the materiality threshold (§2.4), used
   *  for the bounds-width comparison (§4.3 B-5) and plan-level reporting.
   *  null when the actuary has not set one — the bounds-width judgement
   *  is then recorded as not decidable, never silently defaulted. */
  materialityMinor: MoneyMinor | null;
  /** How τ_material was set. null when materialityMinor is null. */
  materialitySource: string | null;
}

// ---------------------------------------------------------------------------
// Δ/D/R (Stage 1 output 03, §2.1–2.3)
// ---------------------------------------------------------------------------

/** The relative difference R_i, or why it is not a number (§2.3). */
export type RelativeDifference =
  | { kind: "defined"; value: DecimalString }
  | {
      kind: "undefined";
      /** "R_UNDEFINED_ZERO_DENOMINATOR" or "R_UNSTABLE_SMALL_DENOMINATOR". */
      flag: string;
      reason: string;
    };

/** Δ_i, D_i, and R_i for one participant — only when a comparison is
 *  permitted (§2.2). */
export interface ComparableDiscrepancy {
  comparable: true;
  /** Δ_i = B_i^PA − B̂_i, signed, integer minor units. Positive means
   *  the administrator's amount exceeds the reconstruction. */
  delta: Money;
  /** D_i = |Δ_i|, integer minor units. */
  absDelta: Money;
  /** R_i = Δ_i / B̂_i as an exact decimal proportion, or undefined with
   *  the §2.3 flag. A recorded zero B_i^PA against a positive B̂_i gives
   *  R_i = "-1" exactly, flagged PA_ZERO. */
  relative: RelativeDifference;
  /** §2.3 denominator flag, or null when R_i is defined normally. */
  denominatorFlag: string | null;
  /** |B̂_i| in minor units — the denominator the tolerance test needs
   *  for the "larger-of" combination rule. */
  reconstructedAbsMinor: number;
}

/** Why no Δ/D/R exists for this participant (§2.2, §0.1). A recorded
 *  "no comparison" outcome, never a silently missing number. */
export interface NoComparison {
  comparable: false;
  reason:
    | "unresolved-comparison-basis"
    | "indeterminate-reconstruction"
    | "recorded-missing"
    | "bounds-only"
    | "amount-missing";
  detail: string;
}

export type DiscrepancyResult = ComparableDiscrepancy | NoComparison;

/**
 * Δ/D/R from two amounts in integer minor units (the §2.1 arithmetic).
 * Pure integer arithmetic for Δ and D; the ratio uses exact decimal
 * division at scale 10 (src/decimal.ts, never a binary float).
 *
 * Denominator rules (§2.3), in order:
 * - B̂_i = 0 exactly: R_i undefined, flag R_UNDEFINED_ZERO_DENOMINATOR.
 *   (Both zero is the same flag: Δ_i = D_i = 0, R_i undefined; whether
 *   zero is the correct benefit is a facts question, not arithmetic.)
 * - 0 < |B̂_i| < ε_R: R_i flagged, not computed, flag
 *   R_UNSTABLE_SMALL_DENOMINATOR. Δ_i and D_i are still reported.
 * - B_i^PA = 0 and B̂_i > 0: R_i = "-1" exactly, flag PA_ZERO (a
 *   recorded zero is usually a missing-data or status question, not a
 *   benefit of zero — §5.1).
 */
export function discrepancyFromAmounts(
  recordedMinor: number,
  reconstructedMinor: number,
  epsilonRMinor: number,
): DiscrepancyResult {
  if (!Number.isInteger(recordedMinor) || !Number.isInteger(reconstructedMinor)) {
    throw new Error("discrepancyFromAmounts: amounts must be integer minor units");
  }
  if (!Number.isInteger(epsilonRMinor) || epsilonRMinor < 0) {
    throw new Error("discrepancyFromAmounts: epsilonRMinor must be a non-negative integer");
  }
  const deltaMinor = recordedMinor - reconstructedMinor;
  const absDeltaMinor = deltaMinor < 0 ? -deltaMinor : deltaMinor;
  const absReconMinor = reconstructedMinor < 0 ? -reconstructedMinor : reconstructedMinor;

  if (reconstructedMinor === 0) {
    return {
      comparable: true,
      delta: makeMoney(deltaMinor),
      absDelta: makeMoney(absDeltaMinor),
      relative: {
        kind: "undefined",
        flag: "R_UNDEFINED_ZERO_DENOMINATOR",
        reason:
          "B̂_i is zero: R_i is undefined. A zero reconstructed benefit with a non-zero B_i^PA is itself a finding to investigate as a case, not a ratio.",
      },
      denominatorFlag: "R_UNDEFINED_ZERO_DENOMINATOR",
      reconstructedAbsMinor: 0,
    };
  }
  if (absReconMinor < epsilonRMinor) {
    return {
      comparable: true,
      delta: makeMoney(deltaMinor),
      absDelta: makeMoney(absDeltaMinor),
      relative: {
        kind: "undefined",
        flag: "R_UNSTABLE_SMALL_DENOMINATOR",
        reason: `|B̂_i| (${absReconMinor} minor units) is below ε_R (${epsilonRMinor} minor units): the ratio would be unstable, so R_i is flagged, not computed. Δ_i and D_i are reported.`,
      },
      denominatorFlag: "R_UNSTABLE_SMALL_DENOMINATOR",
      reconstructedAbsMinor: absReconMinor,
    };
  }
  if (recordedMinor === 0) {
    return {
      comparable: true,
      delta: makeMoney(deltaMinor),
      absDelta: makeMoney(absDeltaMinor),
      relative: { kind: "defined", value: "-1" },
      denominatorFlag: "PA_ZERO",
      reconstructedAbsMinor: absReconMinor,
    };
  }
  const relativeValue = decDivide(
    moneyMinorToDecimalString(deltaMinor),
    moneyMinorToDecimalString(reconstructedMinor),
    10,
  );
  return {
    comparable: true,
    delta: makeMoney(deltaMinor),
    absDelta: makeMoney(absDeltaMinor),
    relative: { kind: "defined", value: relativeValue },
    denominatorFlag: null,
    reconstructedAbsMinor: absReconMinor,
  };
}

/**
 * Δ/D/R for one participant's reconciliation inputs (§2.1–2.3).
 *
 * Precondition (§2.2): no comparison without an established basis.
 * When the comparison basis is unresolved, when the reconstruction is
 * indeterminate, when the outcome is bounds (no Δ — the recorded-position
 * test applies instead), or when the recorded amount is blank, this
 * returns a NoComparison outcome with the reason — never a Δ/D/R.
 *
 * The denominator flag is computed here from the amounts and ε_R. A
 * flag carried in the inputs (Stage 10) is not trusted as the verdict:
 * Stage 10 does not know ε_R, so only this module can apply the §2.3
 * small-denominator rule.
 */
export function computeDiscrepancy(
  inputs: ReconciliationInputs,
  epsilonRMinor: number,
): DiscrepancyResult {
  if (inputs.comparisonBasis === "unresolved") {
    return {
      comparable: false,
      reason: "unresolved-comparison-basis",
      detail:
        "Comparison basis unresolved: the measurement date (or another basis element) is not established, so no Δ_i is computed against a benefit on a different basis (03 §2.2).",
    };
  }
  if (inputs.bounds !== null) {
    return {
      comparable: false,
      reason: "bounds-only",
      detail:
        "Bounds outcome: no exact B̂_i exists, so no Δ_i is computed. The comparison is the recorded-position test (inside / below-min / above-max) — see recordedPosition on the participant record.",
    };
  }
  if (inputs.reconstructed === null) {
    return {
      comparable: false,
      reason: "indeterminate-reconstruction",
      detail:
        "No reconstructed benefit and no justified bounds: the reconstruction is indeterminate, so no Δ_i is computed. The participant enters the §12 missing-data framework.",
    };
  }
  if (inputs.recorded === null) {
    return {
      comparable: false,
      reason: "recorded-missing",
      detail:
        "B_i^PA is blank (missing data, never zero — §4.2), so no Δ_i is computed. The participant enters the §12 missing-data framework.",
    };
  }
  const recordedAmount = inputs.recorded.amount;
  const reconstructedAmount = inputs.reconstructed.amount;
  if (recordedAmount === null || reconstructedAmount === null) {
    return {
      comparable: false,
      reason: "amount-missing",
      detail:
        "A benefit quantity carries no amount: no Δ_i is computed. A blank is missing data, never zero.",
    };
  }
  return discrepancyFromAmounts(
    recordedAmount.amountMinor,
    reconstructedAmount.amountMinor,
    epsilonRMinor,
  );
}

// ---------------------------------------------------------------------------
// Tolerance framework T-1–T-5 (Stage 1 output 03, §1.2, §2.4)
// ---------------------------------------------------------------------------

/** The application ships with NO built-in acceptance tolerance (rule
 *  T-1; §1.2 Finding 1: no PBGC tolerance rule for PA_AMB reconciliation
 *  was found). This statement is the module's only tolerance "default":
 *  the absence of one. */
export const NO_BUILT_IN_TOLERANCE_STATEMENT =
  "The application ships with no built-in acceptance tolerance (Stage 1 output 03, §1.2 Finding 1; §2.4 rule T-1). Tolerances are case-level configuration set by the actuary, recorded with rationale, and versioned with the calculation run.";

/**
 * Policy 5.8-1 reference figures — reference data ONLY (rule T-4).
 * The only PBGC dollar thresholds found are the benefit-correction
 * tolerances of PBGC Operating Policy 5.8-1, Benefit Corrections, 3rd
 * Ed., 10/02/2014: $1.00/month and $5.00/month. That policy governs
 * correction of issued benefit determinations, NOT acceptance of PA_AMB.
 * These figures are never applied silently and never presented as a
 * reconciliation rule; an actuary who adopts them as case screening
 * values must record the adoption statement (see
 * `borrowedToleranceAdoptionStatement`).
 */
export interface BorrowedReferenceTolerance {
  /** The mandatory label, carried with the figures wherever shown. */
  label: string;
  /** $1.00/month (5.8-1 D.1 decreases at determination issuance;
   *  D.3 increases after effectiveness). */
  monthlyIncreaseMinor: MoneyMinor;
  /** $5.00/month (5.8-1 D.3 decreases after effectiveness). */
  monthlyDecreaseMinor: MoneyMinor;
  source: string;
  scopeNote: string;
}

export const POLICY_5_8_1_BORROWED_REFERENCE: BorrowedReferenceTolerance = {
  label: "borrowed from the benefit-correction policy, not a reconciliation rule",
  monthlyIncreaseMinor: 100,
  monthlyDecreaseMinor: 500,
  source:
    "PBGC Operating Policy 5.8-1, Benefit Corrections, 3rd Ed., 10/02/2014, Transmittal 2015-01",
  scopeNote:
    "These figures govern whether PBGC corrects a benefit or payment error once a benefit determination has been issued or become effective — not whether a case actuary accepts PA_AMB during casework. Applying them as reconciliation acceptance tolerances would be a category error (03 §1.2 Finding 2).",
};

export function borrowedReferenceTolerances(): BorrowedReferenceTolerance {
  return { ...POLICY_5_8_1_BORROWED_REFERENCE };
}

/**
 * The rule T-4 adoption statement. When the actuary adopts the 5.8-1
 * figures as case screening values, the record must state this, with
 * the adopter, the date, and the rationale. A percentage leg, if used,
 * has no PBGC source and must be labelled as actuary judgment (T-4).
 */
export function borrowedToleranceAdoptionStatement(args: {
  author: string;
  date: DateString;
  rationale: string;
}): string {
  return (
    "Screening values borrowed from Policy 5.8-1 Benefit Corrections; " +
    "that policy governs correction of issued benefit determinations, not acceptance of PA_AMB. " +
    `Adopted as case screening values by ${args.author}, ${args.date}. Rationale: ${args.rationale}`
  );
}

/** Validate a tolerance record before it is applied (rules T-2, T-5).
 *  A tolerance is case configuration: it must carry a version, a
 *  recorded authority (who set it, on what basis — never "PBGC policy",
 *  because no such policy exists for this decision), and an approver.
 *  Returns every problem found; an empty list means the record is
 *  applicable. This validates the record's shape and provenance — it
 *  does not judge whether the values are wise. */
export function validateToleranceRecord(tolerance: ToleranceRecord): {
  valid: boolean;
  problems: string[];
} {
  const problems: string[] = [];
  if (!Number.isInteger(tolerance.version) || tolerance.version < 1) {
    problems.push("Tolerance record version must be an integer of at least 1.");
  }
  if (
    tolerance.absoluteMinor !== null &&
    (!Number.isInteger(tolerance.absoluteMinor) || tolerance.absoluteMinor < 0)
  ) {
    problems.push("Absolute tolerance must be null or a non-negative integer number of minor units.");
  }
  if (tolerance.relativeDecimal !== null) {
    try {
      const parsed = parseDecimalString(tolerance.relativeDecimal);
      if (!isCanonicalDecimalString(tolerance.relativeDecimal)) {
        problems.push(
          `Relative tolerance ${JSON.stringify(tolerance.relativeDecimal)} is not in canonical decimal form.`,
        );
      }
      if (parsed.value < 0n) {
        problems.push("Relative tolerance must not be negative.");
      }
      if (decCompare(tolerance.relativeDecimal, "1") === 1) {
        problems.push("Relative tolerance exceeds 1 (100%): a tolerance larger than the benefit itself is not a screening value.");
      }
    } catch {
      problems.push(
        `Relative tolerance ${JSON.stringify(tolerance.relativeDecimal)} is not an exact decimal string.`,
      );
    }
  }
  if (tolerance.absoluteMinor === null && tolerance.relativeDecimal === null) {
    problems.push(
      "No tolerance leg is configured (both absolute and relative are null). " +
        "No silent default is applied (T-1), but no tolerance verdict can be produced until the actuary sets and records a tolerance (T-2).",
    );
  }
  if (tolerance.authority.trim().length === 0) {
    problems.push("Tolerance authority is empty: who set it, and on what basis, must be recorded (T-2).");
  }
  if (tolerance.approvedBy.trim().length === 0) {
    problems.push("Tolerance approver is empty: the tolerance must name who approved it (T-2).");
  }
  if (tolerance.approvedDate.trim().length === 0) {
    problems.push("Tolerance approval date is empty (T-2).");
  }
  return { valid: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Tolerance verdict (rules T-2, T-3)
// ---------------------------------------------------------------------------

export type ToleranceVerdict = "within-tolerance" | "outside-tolerance" | "not-applicable";

export interface ToleranceTestResult {
  verdict: ToleranceVerdict;
  /** What was tested and why the verdict came out as it did. */
  detail: string;
  /** Absolute leg (D_i ≤ τ_abs): true / false / null when not configured
   *  or not evaluable. */
  absoluteLeg: boolean | null;
  /** Relative leg (|R_i| ≤ τ_rel): true / false / null when not
   *  configured or not evaluable (R_i undefined). */
  relativeLeg: boolean | null;
}

/** Absolute value of an exact decimal string, without a binary float. */
function absDecimalString(value: DecimalString): DecimalString {
  return value.startsWith("-") ? value.slice(1) : value;
}

/**
 * Apply the case tolerance set to a computed discrepancy (rule T-3: a
 * tolerance is a screening device, not a proof). The combination rule
 * (ToleranceRecord.application) must be stated explicitly — the choice
 * changes outcomes:
 * - "either": within if any configured leg is met.
 * - "both": within only if every configured leg is met.
 * - "larger-of": within if D_i is at most the larger of τ_abs and
 *   τ_rel × |B̂_i| (the relative leg converted to dollars at this
 *   participant's benefit size).
 *
 * A leg that is not configured cannot be met. An undefined R_i (zero or
 * near-zero denominator) leaves the relative leg unevaluable: for
 * "either" the absolute leg alone decides; for "both" the verdict is
 * outside (within cannot be claimed on a leg that cannot be computed);
 * for "larger-of" the absolute leg alone is the effective tolerance.
 * When no comparison exists, or no tolerance leg is configured, the
 * verdict is "not-applicable" — never a silent default.
 */
export function applyTolerance(
  discrepancy: DiscrepancyResult,
  tolerance: ToleranceRecord,
): ToleranceTestResult {
  if (!discrepancy.comparable) {
    return {
      verdict: "not-applicable",
      detail: `No tolerance test: ${discrepancy.detail}`,
      absoluteLeg: null,
      relativeLeg: null,
    };
  }
  if (tolerance.absoluteMinor === null && tolerance.relativeDecimal === null) {
    return {
      verdict: "not-applicable",
      detail:
        "No tolerance leg is configured. The application ships with no built-in acceptance tolerance (T-1); no verdict is produced until the actuary sets and records a tolerance (T-2).",
      absoluteLeg: null,
      relativeLeg: null,
    };
  }

  const absDeltaDollars = moneyMinorToDecimalString(discrepancy.absDelta.amountMinor);
  let absoluteLeg: boolean | null = null;
  if (tolerance.absoluteMinor !== null) {
    absoluteLeg =
      decCompare(absDeltaDollars, moneyMinorToDecimalString(tolerance.absoluteMinor)) <= 0;
  }

  let relativeLeg: boolean | null = null;
  if (tolerance.relativeDecimal !== null) {
    if (discrepancy.relative.kind === "defined") {
      relativeLeg =
        decCompare(absDecimalString(discrepancy.relative.value), tolerance.relativeDecimal) <= 0;
    } else {
      relativeLeg = null; // R_i undefined: the leg cannot be evaluated.
    }
  }

  switch (tolerance.application) {
    case "either": {
      const met = absoluteLeg === true || relativeLeg === true;
      return {
        verdict: met ? "within-tolerance" : "outside-tolerance",
        detail: met
          ? `Within tolerance (either leg): absolute leg ${absoluteLeg === null ? "not configured" : absoluteLeg ? "met" : "not met"}, relative leg ${relativeLeg === null ? "not configured or not evaluable" : relativeLeg ? "met" : "not met"}.`
          : `Outside tolerance (either leg): neither configured leg is met (absolute ${absoluteLeg === null ? "not configured" : "not met"}, relative ${relativeLeg === null ? "not configured or not evaluable" : "not met"}).`,
        absoluteLeg,
        relativeLeg,
      };
    }
    case "both": {
      const configured = [absoluteLeg, relativeLeg].filter((leg) => leg !== null);
      const met = configured.length > 0 && configured.every((leg) => leg === true);
      return {
        verdict: met ? "within-tolerance" : "outside-tolerance",
        detail: met
          ? "Within tolerance (both legs): every configured leg is met."
          : "Outside tolerance (both legs): a configured leg is not met, or the relative leg cannot be evaluated because R_i is undefined.",
        absoluteLeg,
        relativeLeg,
      };
    }
    case "larger-of": {
      // Effective absolute tolerance in dollars: the larger of τ_abs
      // and τ_rel × |B̂_i|. A null leg drops out; the surviving leg is
      // the effective tolerance.
      let effectiveDollars: DecimalString | null = null;
      if (tolerance.absoluteMinor !== null) {
        effectiveDollars = moneyMinorToDecimalString(tolerance.absoluteMinor);
      }
      if (tolerance.relativeDecimal !== null) {
        const relativeDollars = decMultiply(
          tolerance.relativeDecimal,
          moneyMinorToDecimalString(discrepancy.reconstructedAbsMinor),
        );
        if (
          effectiveDollars === null ||
          decCompare(relativeDollars, effectiveDollars) === 1
        ) {
          effectiveDollars = relativeDollars;
        }
      }
      if (effectiveDollars === null) {
        return {
          verdict: "not-applicable",
          detail: "No tolerance leg is configured (larger-of rule).",
          absoluteLeg,
          relativeLeg,
        };
      }
      const within = decCompare(absDeltaDollars, effectiveDollars) <= 0;
      return {
        verdict: within ? "within-tolerance" : "outside-tolerance",
        detail: within
          ? `Within tolerance (larger-of): D_i $${absDeltaDollars} is at most the larger leg ($${effectiveDollars}).`
          : `Outside tolerance (larger-of): D_i $${absDeltaDollars} exceeds the larger leg ($${effectiveDollars}).`,
        absoluteLeg,
        relativeLeg,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Rounding as a diagnostic (§2.7) with the mandatory anti-coincidence rule
// ---------------------------------------------------------------------------

export interface RoundingDiagnosticEvidence {
  /** True when the tested sequence is the plan's documented rounding
   *  rule — documented in the plan, the administrator's workpapers, or
   *  a valuation report. A sequence with no document behind it is never
   *  "documented", whatever it matches numerically. */
  sequenceDocumented: boolean;
  /** Citation for the documented rule (plan section / workpaper /
   *  valuation report), or "not-documented". A documented claim with no
   *  citation is treated as undocumented. */
  sequenceSource: string;
  /** Maximum plausible rounding effect for this participant: the sum of
   *  the per-stage rounding units, in minor units (§2.7). null when the
   *  effect was not quantified — the size check is then skipped and the
   *  gap is recorded in the reason. */
  maxPlausibleEffectMinor: number | null;
}

/**
 * Evaluate one rounding hypothesis (H15) under the §2.7 anti-coincidence
 * rule: *a successful numerical match obtained by arbitrary changes to
 * rounding conventions must not be treated as proof of the
 * administrator's actual methodology.*
 *
 * - The residual exceeds the maximum plausible rounding effect → Refuted:
 *   rounding cannot explain a discrepancy larger than the sum of the
 *   per-stage rounding units.
 * - The sequence is documented (or resolves the cohort) and the residual
 *   is within tolerance → Supported.
 * - The sequence is undocumented, does not resolve the cohort, and the
 *   claim is Supported → Coincidence: recorded as such, never presented
 *   as an explanation, never sufficient to move a disposition to Verified.
 * - The sequence is documented but the residual is outside tolerance →
 *   Refuted: the documented sequence was tested and does not resolve it.
 * - An unevaluated counterfactual (no residual) cannot be Supported: a
 *   Supported claim on it is corrected to Coincidence.
 *
 * `resolvesParticipant` is whether the counterfactual's residual is
 * within the case tolerance (null when unevaluable); `resolvesCohort` is
 * whether the same sequence resolves discrepancies across the cohort.
 * `claimedSupportClass` is the label after the general anti-coincidence
 * validation (`validateCounterfactualSupport`) — the rounding diagnostic
 * refines it, it does not re-decide the general rule.
 */
export function evaluateRoundingHypothesis(args: {
  result: CounterfactualResult;
  claimedSupportClass: SupportClass;
  evidence: RoundingDiagnosticEvidence;
  resolvesCohort: boolean;
  resolvesParticipant: boolean | null;
}): { supportClass: SupportClass; reason: string } {
  const { result, claimedSupportClass, evidence, resolvesCohort, resolvesParticipant } = args;
  if (result.operation.kind !== "rounding-sequence") {
    return {
      supportClass: claimedSupportClass,
      reason: "Not a rounding hypothesis: the rounding diagnostic does not apply; the label stands as validated.",
    };
  }
  const documented =
    evidence.sequenceDocumented &&
    evidence.sequenceSource.trim().length > 0 &&
    evidence.sequenceSource !== "not-documented";
  const residualAbsMinor =
    result.residualDelta === null
      ? null
      : result.residualDelta.amountMinor < 0
        ? -result.residualDelta.amountMinor
        : result.residualDelta.amountMinor;

  if (residualAbsMinor === null || resolvesParticipant === null) {
    if (claimedSupportClass === "supported") {
      return {
        supportClass: "coincidence",
        reason:
          "The rounding counterfactual could not be evaluated (no residual): a numerical match cannot be claimed, so a Supported label is corrected to Coincidence under the anti-coincidence rule (§2.7).",
      };
    }
    return {
      supportClass: claimedSupportClass,
      reason:
        "The rounding counterfactual could not be evaluated (no residual); the label stands as claimed, and the hypothesis explains nothing.",
    };
  }

  if (
    evidence.maxPlausibleEffectMinor !== null &&
    residualAbsMinor > evidence.maxPlausibleEffectMinor
  ) {
    return {
      supportClass: "refuted",
      reason: `Refuted: the residual after the rounding counterfactual (${residualAbsMinor} minor units) exceeds the maximum plausible rounding effect (${evidence.maxPlausibleEffectMinor} minor units, the sum of the per-stage rounding units). Rounding cannot explain this discrepancy (§2.7).`,
    };
  }

  if (resolvesParticipant && (documented || resolvesCohort)) {
    return {
      supportClass: "supported",
      reason: documented
        ? `Supported: the rounding sequence is the plan's documented rule (${evidence.sequenceSource}) and the counterfactual residual is within tolerance.`
        : "Supported: the same rounding sequence resolves discrepancies across the cohort and no document contradicts it (§2.7).",
    };
  }
  if (resolvesParticipant && !documented && !resolvesCohort) {
    if (claimedSupportClass === "supported") {
      return {
        supportClass: "coincidence",
        reason:
          "Anti-coincidence rule (§2.7): the rounding sequence is not the plan's documented rule and does not resolve the cohort, so the numerical match is Coincidence — an arbitrary rounding change is not proof of the administrator's methodology.",
      };
    }
    return {
      supportClass: claimedSupportClass,
      reason:
        "Anti-coincidence rule (§2.7): the rounding counterfactual matches numerically, but the sequence is undocumented and does not resolve the cohort, so it is recorded as claimed — never as a supported explanation.",
    };
  }
  // Residual outside tolerance.
  if (documented) {
    return {
      supportClass: "refuted",
      reason: `Refuted: the documented rounding sequence (${evidence.sequenceSource}) was tested and its residual is outside tolerance — rounding at those stages does not explain the discrepancy.`,
    };
  }
  return {
    supportClass: "refuted",
    reason:
      "Refuted: the rounding counterfactual's residual is outside tolerance, so this rounding sequence does not explain the discrepancy.",
  };
}

// ---------------------------------------------------------------------------
// Hypothesis evaluation entry point (§2.6)
// ---------------------------------------------------------------------------

export interface HypothesisEvaluationInput {
  /** The tested counterfactual result (recomputed benefit and residual
   *  supplied by the engine — this module never recomputes them). */
  result: CounterfactualResult;
  /** Whether the mechanism is stated in, or follows directly from, a
   *  governing plan document, amendment, valuation report, or
   *  administrator workpaper, cited precisely. FALSE when the mechanism
   *  is merely a known alternative, appears in plan history without
   *  operating here, is consistent with the documents but not directly
   *  confirmed for this participant/cohort, or was only tested as a
   *  counterfactual (see RankableCounterfactual). */
  documentedMechanism: boolean;
  /** Whether the counterfactual eliminates (or reduces below tolerance)
   *  the discrepancy for the whole affected cohort, not just one
   *  participant. */
  resolvesCohort: boolean;
  /** Whether the hypothesis is material to the amount (caller-stated).
   *  A material hypothesis that is neither supported nor refuted blocks
   *  a Verified recommendation. */
  material: boolean;
  /** Rounding diagnostic evidence — required when the operation is a
   *  rounding sequence (H15); ignored otherwise. */
  roundingEvidence?: RoundingDiagnosticEvidence;
}

/** A tested hypothesis after evaluation: the corrected label, the
 *  evidence that decided it, and whether its residual is within the
 *  case tolerance. `supportClass` is the corrected label;
 *  `claimedSupportClass` is the label the test arrived with. */
export interface EvaluatedHypothesis extends RankableCounterfactual {
  claimedSupportClass: SupportClass;
  evaluationNote: string;
  material: boolean;
  /** Residual within the case tolerance: true / false / null when the
   *  counterfactual could not be evaluated. */
  resolvesParticipant: boolean | null;
}

/**
 * Whether a counterfactual's residual is within the case tolerance.
 * The residual Δ under the counterfactual is compared against the
 * tolerance with the counterfactual benefit as the denominator
 * (Δ_cf = B_i^PA − B̂_cf, so B_i^PA = B̂_cf + Δ_cf). Returns null when
 * the counterfactual could not be evaluated.
 */
export function residualWithinTolerance(
  result: CounterfactualResult,
  tolerance: ToleranceRecord,
  epsilonRMinor: number,
): boolean | null {
  if (result.benefit === null || result.benefit.amount === null || result.residualDelta === null) {
    return null;
  }
  const benefitMinor = result.benefit.amount.amountMinor;
  const recordedMinor = benefitMinor + result.residualDelta.amountMinor;
  const discrepancy = discrepancyFromAmounts(recordedMinor, benefitMinor, epsilonRMinor);
  return applyTolerance(discrepancy, tolerance).verdict === "within-tolerance";
}

/**
 * Evaluate and rank a set of tested counterfactual hypotheses for one
 * participant (§2.6). For each candidate:
 * 1. The general anti-coincidence rule (`validateCounterfactualSupport`)
 *    is applied: a Supported claim stands only with a documented
 *    mechanism or cohort-wide resolution, otherwise it is corrected to
 *    Coincidence.
 * 2. Rounding-sequence hypotheses (H15) additionally pass through the
 *    §2.7 rounding diagnostic, which may refute them on size or correct
 *    an arbitrary-match Supported claim to Coincidence.
 * 3. The corrected results are ranked by `rankCounterfactuals` — document
 *    support first, cohort-wide resolution second, support class third,
 *    amount of cited evidence fourth, and numerical closeness only as a
 *    tie-breaker. Evidence beats proximity: a closer-but-unsupported
 *    hypothesis ranks below a farther-but-supported one.
 *
 * Returns a new array; the inputs are untouched. A hypothesis whose
 * counterfactual could not be evaluated ranks last within its class
 * (its residual is null).
 */
export function evaluateAndRankHypotheses(args: {
  inputs: ReconciliationInputs;
  candidates: readonly HypothesisEvaluationInput[];
  config: ReconciliationConfig;
}): EvaluatedHypothesis[] {
  const tolerance = args.inputs.toleranceApplied;
  const evaluated: EvaluatedHypothesis[] = args.candidates.map((candidate) => {
    const { result } = candidate;
    const resolvesParticipant = residualWithinTolerance(
      result,
      tolerance,
      args.config.epsilonRMinor,
    );
    const validation = validateCounterfactualSupport(result, {
      documentedMechanism: candidate.documentedMechanism,
      resolvesCohort: candidate.resolvesCohort,
    });
    let supportClass: SupportClass = validation.correctedSupportClass;
    let note = validation.reason;
    if (result.operation.kind === "rounding-sequence") {
      if (candidate.roundingEvidence === undefined) {
        // No rounding evidence was supplied: the sequence cannot be
        // shown to be the plan's documented rule, so a Supported claim
        // cannot stand. Recorded, not silently assumed.
        if (supportClass === "supported") {
          supportClass = "coincidence";
          note +=
            " No rounding diagnostic evidence was supplied, so the sequence cannot be shown to be the plan's documented rule: the Supported label is corrected to Coincidence (§2.7).";
        } else {
          note += " No rounding diagnostic evidence was supplied.";
        }
      } else {
        const rounding = evaluateRoundingHypothesis({
          result,
          claimedSupportClass: supportClass,
          evidence: candidate.roundingEvidence,
          resolvesCohort: candidate.resolvesCohort,
          resolvesParticipant,
        });
        supportClass = rounding.supportClass;
        note += ` ${rounding.reason}`;
      }
    }
    return {
      operation: result.operation,
      hypothesisCode: result.hypothesisCode,
      benefit: result.benefit,
      residualDelta: result.residualDelta,
      supportClass,
      evidenceFor: [...result.evidenceFor],
      evidenceAgainst: [...result.evidenceAgainst],
      documentedMechanism: candidate.documentedMechanism,
      resolvesCohort: candidate.resolvesCohort,
      claimedSupportClass: result.supportClass,
      evaluationNote: note,
      material: candidate.material,
      resolvesParticipant,
    };
  });
  // rankCounterfactuals sorts in place and returns the same objects; the
  // cast restores the EvaluatedHypothesis type the sort's signature drops.
  // No property is added, removed, or reordered here — the ranking is
  // entirely rankCounterfactuals' (§2.6).
  return rankCounterfactuals(evaluated) as EvaluatedHypothesis[];
}

// ---------------------------------------------------------------------------
// Per-participant reconciliation record (§10) + recommended disposition
// ---------------------------------------------------------------------------

export interface ParticipantReconciliation {
  participantKey: string;
  /** B_i^PA as recorded, or null when blank (missing, never zero). */
  recorded: TypedBenefitQuantity | null;
  /** B̂_i on the same basis, or null when the outcome is bounds or
   *  indeterminate. */
  reconstructed: TypedBenefitQuantity | null;
  /** Justified bounds, or null when the outcome is exact or
   *  indeterminate. */
  bounds: BoundsResult | null;
  /** Δ/D/R, or the recorded no-comparison reason. */
  comparison: DiscrepancyResult;
  /** Where B_i^PA falls relative to justified bounds (bounds cases
   *  only), or null otherwise. */
  recordedPosition: BoundsResult["recordedPosition"] | null;
  /** What the recorded position means (bounds cases only). */
  recordedPositionMeaning: string | null;
  /** Tolerance verdict on the comparison. */
  toleranceVerdict: ToleranceVerdict;
  /** What was tested and why the verdict came out as it did. */
  toleranceDetail: string;
  /** The tolerance record version applied (a pinned copy — a tolerance
   *  change re-tests the comparison, it never re-runs the calculation). */
  toleranceApplied: ToleranceRecord;
  /** Evaluated, ranked hypotheses (empty when none were tested). */
  hypotheses: EvaluatedHypothesis[];
  /** True when two supported hypotheses imply different corrected
   *  benefits (§2.6 multiple-hypothesis rule): the disposition cannot
   *  then be Correction recommended. */
  conflictingCorrections: boolean;
  /** The system's RECOMMENDED disposition — an input to the disposition
   *  process (src/decisions.ts), never a decision. The final decision is
   *  always a human reviewer (MASTER_PROMPT §14). */
  recommendedDisposition: Disposition;
  /** The evidence that produced the recommendation, in one paragraph. */
  dispositionBasis: string;
}

/**
 * Recommend a disposition from a finished reconciliation (03 §4.7
 * mapping, cross-checked against the entry conditions in
 * src/decisions.ts). This is a recommendation only: it has no downstream
 * effect, it does not authorise valuation use, and it does not set
 * BCV3.PA_AMB_ACCEPT. In particular, Correction recommended here means
 * "a supported hypothesis identifies the error and a single corrected
 * value" — the human reviewer must still confirm reasonable certainty
 * about both the error and the amount (Policy 5.8-1 §D) before any
 * correction is approved.
 */
export function recommendDisposition(args: {
  comparison: DiscrepancyResult;
  recordedPosition: BoundsResult["recordedPosition"] | null;
  boundsWidthMinor: number | null;
  toleranceVerdict: ToleranceVerdict;
  hypotheses: EvaluatedHypothesis[];
  conflictingCorrections: boolean;
  recordedMinor: number | null;
  materialityMinor: number | null;
  /** Independent reconstruction in minor units, when an exact one
   *  exists (Stage 7 G-ACC-4: the corrected value for a counterfactual
   *  that reproduces the recorded amount). */
  reconstructedMinor?: number | null;
}): { disposition: Disposition; basis: string } {
  const { comparison, recordedPosition, toleranceVerdict, hypotheses } = args;

  if (!comparison.comparable) {
    if (comparison.reason === "bounds-only") {
      // Bounds branch (§4.7).
      if (recordedPosition === "recorded-missing") {
        return {
          disposition: "indeterminate",
          basis:
            "B_i^PA is blank and only justified bounds exist: the recorded amount must be obtained (or the benefit established independently) before any acceptance conclusion. Indeterminate.",
        };
      }
      if (recordedPosition === "below-min" || recordedPosition === "above-max") {
        const supported = hypotheses.filter(
          (h) => h.supportClass === "supported" && h.benefit !== null && h.benefit.amount !== null,
        );
        if (
          supported.length > 0 &&
          !args.conflictingCorrections &&
          args.recordedMinor !== null &&
          supported.every((h) => h.benefit?.amount?.amountMinor !== args.recordedMinor)
        ) {
          return {
            disposition: "correction-recommended",
            basis: `B_i^PA lies ${recordedPosition === "below-min" ? "below" : "above"} the justified range, and a supported hypothesis identifies the error and a single corrected value. The human reviewer must still confirm reasonable certainty about both the error and the amount (Policy 5.8-1 §D) before approval.`,
          };
        }
        return {
          disposition: "requires-investigation",
          basis: `B_i^PA lies ${recordedPosition === "below-min" ? "below" : "above"} the justified range: either an assumption is wrong, the formula version is wrong, or the administrator's amount is wrong — investigation required.`,
        };
      }
      // Inside the range.
      const materialCoincidence = hypotheses.some((h) => h.material && h.supportClass === "coincidence");
      if (materialCoincidence) {
        return {
          disposition: "requires-investigation",
          basis:
            "B_i^PA lies inside the justified bounds, but a material hypothesis is labelled Coincidence: a numerical match with no document support never supports acceptance. Investigation required.",
        };
      }
      if (args.materialityMinor !== null && args.boundsWidthMinor !== null) {
        if (args.boundsWidthMinor <= args.materialityMinor) {
          return {
            disposition: "supported-for-acceptance",
            basis: `B_i^PA lies inside the justified bounds and the range width (${args.boundsWidthMinor} minor units) is at most the case materiality threshold (${args.materialityMinor} minor units); no better competing hypothesis. The residual uncertainty is documented with the record.`,
          };
        }
        return {
          disposition: "requires-investigation",
          basis: `B_i^PA lies inside the justified bounds, but the range width (${args.boundsWidthMinor} minor units) exceeds the case materiality threshold (${args.materialityMinor} minor units): the uncertainty itself is the finding.`,
        };
      }
      return {
        disposition: "requires-investigation",
        basis:
          "B_i^PA lies inside the justified bounds, but no case materiality threshold (τ_material) is set, so the bounds width cannot be judged immaterial. Set τ_material and re-test; until then the participant requires investigation.",
      };
    }
    // Blank recorded amount with an exact reconstruction. computeDiscrepancy
    // returns "recorded-missing" only in this case (bounds carry
    // "bounds-only"; no reconstruction carries "indeterminate-reconstruction").
    // Agrees with src/dispositionMapping.ts step 2 (§4.7 row 7, interpreted):
    // no disposition's entry conditions are met by a blank recorded amount
    // (Verified needs a Δ; Supported for acceptance needs the recorded amount
    // inside bounds; Correction recommended needs a corrected value different
    // from the recorded amount), so this is Requires investigation — obtain
    // the recorded amount or confirm the transfer failure — not
    // Indeterminate: the exact reconstruction exists and is carried as
    // evidence.
    if (comparison.reason === "recorded-missing") {
      return {
        disposition: "requires-investigation",
        basis:
          "B_i^PA is blank (missing data, never zero) but an exact independent reconstruction exists. No disposition's entry conditions are met by a blank recorded amount. The reconstruction is carried as evidence; the next step is to obtain the recorded amount or confirm the data-transfer failure.",
      };
    }
    return {
      disposition: "indeterminate",
      basis: `No comparison exists (${comparison.reason}): ${comparison.detail} Indeterminate — with the missing evidence named in the record.`,
    };
  }

  // Exact branch (§4.7).
  if (toleranceVerdict === "not-applicable") {
    return {
      disposition: "requires-investigation",
      basis:
        "An exact reconstruction exists, but no tolerance verdict could be produced (no tolerance leg configured). The application applies no built-in tolerance (T-1): a tolerance must be set and recorded before a Verified recommendation is possible.",
    };
  }
  if (toleranceVerdict === "within-tolerance") {
    const unresolvedMaterial = hypotheses.filter(
      (h) => h.material && h.supportClass !== "supported" && h.supportClass !== "refuted",
    );
    if (unresolvedMaterial.length > 0) {
      return {
        disposition: "requires-investigation",
        basis: `Δ_i is within tolerance, but material hypotheses remain unresolved (${unresolvedMaterial.map((h) => h.hypothesisCode).join(", ")}): a Verified recommendation requires no material unexplained item.`,
      };
    }
    return {
      disposition: "verified",
      basis:
        "Independent calculation agrees with the reported amount within the applicable documented tolerance, the basis is established, and no material unexplained item remains. Recommended: Verified (human approval still required).",
    };
  }
  // Outside tolerance.
  if (args.conflictingCorrections) {
    return {
      disposition: "requires-investigation",
      basis:
        "Δ_i is outside tolerance and two supported hypotheses imply different corrected benefits: the system does not silently pick one (§2.6). Requires investigation.",
    };
  }
  const supported = hypotheses.filter(
    (h) => h.supportClass === "supported" && h.benefit !== null && h.benefit.amount !== null,
  );
  if (
    supported.length > 0 &&
    args.recordedMinor !== null &&
    supported.every((h) => h.benefit?.amount?.amountMinor !== args.recordedMinor)
  ) {
    const first = supported[0];
    const correctedMinor = first?.benefit?.amount?.amountMinor;
    const singleValue = supported.every(
      (h) => h.benefit?.amount?.amountMinor === correctedMinor,
    );
    if (singleValue) {
      return {
        disposition: "correction-recommended",
        basis: `Δ_i is outside tolerance and a supported hypothesis (${first?.hypothesisCode}) identifies the error and a single corrected value. The human reviewer must still confirm reasonable certainty about both the error and the amount (Policy 5.8-1 §D) before approval.`,
      };
    }
  }
  if (
    supported.length > 0 &&
    args.recordedMinor !== null &&
    supported.every((h) => h.benefit?.amount?.amountMinor === args.recordedMinor)
  ) {
    // A supported hypothesis that reproduces the recorded amount
    // exactly and resolves the discrepancy across the cohort identifies
    // the administrator's basis as the error: the counterfactual
    // benefit IS the recorded amount (it is the value under the
    // administrator's basis, by construction), so the single corrected
    // value is the independent reconstruction. Stage 7 G-ACC-4: without
    // this branch the engine could never reach Correction recommended
    // for a planted service/averaging error, and the browser could
    // never agree with the Node oracle. The branch requires the
    // mechanism to be UNDOCUMENTED: when the mechanism is documented
    // (the Harborview case — Plan §3.2 documents the extra service),
    // an exact match vindicates the recorded amount and the
    // reconstruction is the wrong one, so the next branch still
    // applies. Likewise when the hypothesis does NOT resolve the
    // cohort, a single participant's exact match does not by itself say
    // which basis is right, and the reconstruction must be re-run.
    const reproducedRecorded = supported.filter(
      (h) =>
        h.documentedMechanism === false &&
        h.residualDelta !== null &&
        h.residualDelta.amountMinor === 0 &&
        h.resolvesCohort,
    );
    if (
      reproducedRecorded.length > 0 &&
      args.reconstructedMinor !== undefined &&
      args.reconstructedMinor !== null &&
      args.reconstructedMinor !== args.recordedMinor
    ) {
      const first = reproducedRecorded[0];
      return {
        disposition: "correction-recommended",
        basis: `Δ_i is outside tolerance and a supported hypothesis (${first?.hypothesisCode}) reproduces the recorded amount exactly and resolves the discrepancy across the cohort: the administrator's basis is identified as the error, and the single corrected value is the independent reconstruction (${args.reconstructedMinor} minor units). The human reviewer must still confirm reasonable certainty about both the error and the amount (Policy 5.8-1 §D) before approval.`,
      };
    }
    return {
      disposition: "requires-investigation",
      basis:
        "A supported hypothesis explains the discrepancy as a reconstruction error: the corrected benefit equals B_i^PA, so the recorded amount is not the error. The reconstruction must be re-run on the corrected basis; this record cannot be Verified.",
    };
  }
  return {
    disposition: "requires-investigation",
    basis:
      "Δ_i is outside tolerance with no supported explanation identifying a single corrected value. Investigation required.",
  };
}

/**
 * Build one participant's reconciliation record from Stage 10's inputs.
 * Carries the recorded benefit, the reconstruction (exact or bounds),
 * Δ/D/R (or the no-comparison reason), the tolerance verdict, the ranked
 * hypotheses, and the recommended disposition input.
 *
 * `hypothesisCandidates` are the tested counterfactuals for this
 * participant (with their evidence flags); they are evaluated and ranked
 * here. Pass an empty array (or omit) when none were tested.
 */
export function reconcileParticipant(args: {
  participantKey: string;
  inputs: ReconciliationInputs;
  config: ReconciliationConfig;
  hypothesisCandidates?: readonly HypothesisEvaluationInput[];
}): ParticipantReconciliation {
  const comparison = computeDiscrepancy(args.inputs, args.config.epsilonRMinor);
  const toleranceTest = applyTolerance(comparison, args.inputs.toleranceApplied);
  const hypotheses = evaluateAndRankHypotheses({
    inputs: args.inputs,
    candidates: args.hypothesisCandidates ?? [],
    config: args.config,
  });
  const conflicting = findConflictingCorrections(hypotheses);
  const recordedPosition =
    args.inputs.bounds === null ? null : args.inputs.bounds.recordedPosition;
  const recordedPositionMeaning =
    args.inputs.bounds === null
      ? null
      : describeRecordedPosition(args.inputs.bounds).meaning;
  const boundsWidthMinor =
    args.inputs.bounds === null
      ? null
      : args.inputs.bounds.max.amountMinor - args.inputs.bounds.min.amountMinor;
  const recordedMinor =
    args.inputs.recorded === null || args.inputs.recorded.amount === null
      ? null
      : args.inputs.recorded.amount.amountMinor;
  const recommendation = recommendDisposition({
    comparison,
    recordedPosition,
    boundsWidthMinor,
    toleranceVerdict: toleranceTest.verdict,
    hypotheses,
    conflictingCorrections: conflicting.conflict,
    recordedMinor,
    materialityMinor: args.config.materialityMinor,
    reconstructedMinor:
      args.inputs.reconstructed === null || args.inputs.reconstructed.amount === null
        ? null
        : args.inputs.reconstructed.amount.amountMinor,
  });
  return {
    participantKey: args.participantKey,
    recorded: args.inputs.recorded,
    reconstructed: args.inputs.reconstructed,
    bounds: args.inputs.bounds,
    comparison,
    recordedPosition,
    recordedPositionMeaning,
    toleranceVerdict: toleranceTest.verdict,
    toleranceDetail: toleranceTest.detail,
    toleranceApplied: args.inputs.toleranceApplied,
    hypotheses,
    conflictingCorrections: conflicting.conflict,
    recommendedDisposition: recommendation.disposition,
    dispositionBasis: recommendation.basis,
  };
}

/**
 * Re-test a finished reconciliation record under a new tolerance set
 * (rule T-5 review, or any actuary-set change). Tolerance is a
 * comparison parameter, not a calculation input: the reconstruction,
 * Δ/D/R, bounds, and hypotheses are carried through untouched — only
 * the tolerance verdict and the disposition recommendation are
 * re-derived. The new tolerance record must carry a new version (the
 * caller increments it); the old record is never edited in place.
 */
export function retestTolerance(
  record: ParticipantReconciliation,
  newTolerance: ToleranceRecord,
  config: ReconciliationConfig,
): ParticipantReconciliation {
  if (newTolerance.version === record.toleranceApplied.version) {
    throw new Error(
      "retestTolerance: the new tolerance record must carry a new version — a tolerance change is a versioned change (T-2), never an in-place edit.",
    );
  }
  const toleranceTest = applyTolerance(record.comparison, newTolerance);
  const boundsWidthMinor =
    record.bounds === null
      ? null
      : record.bounds.max.amountMinor - record.bounds.min.amountMinor;
  const recordedMinor =
    record.recorded === null || record.recorded.amount === null
      ? null
      : record.recorded.amount.amountMinor;
  const recommendation = recommendDisposition({
    comparison: record.comparison,
    recordedPosition: record.recordedPosition,
    boundsWidthMinor,
    toleranceVerdict: toleranceTest.verdict,
    hypotheses: record.hypotheses,
    conflictingCorrections: record.conflictingCorrections,
    recordedMinor,
    materialityMinor: config.materialityMinor,
    reconstructedMinor:
      record.reconstructed === null || record.reconstructed.amount === null
        ? null
        : record.reconstructed.amount.amountMinor,
  });
  return {
    ...record,
    toleranceVerdict: toleranceTest.verdict,
    toleranceDetail: toleranceTest.detail,
    toleranceApplied: newTolerance,
    recommendedDisposition: recommendation.disposition,
    dispositionBasis: recommendation.basis,
  };
}
