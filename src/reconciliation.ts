/**
 * Reconciliation inputs — Stage 10's handoff to the reconciliation module.
 *
 * Stage 2 output 04, §6 (Stage 1 output 03, Part A): Stage 10 emits the
 * comparison inputs; the reconciliation module (Stage 5 build) owns Δ/D/R,
 * the tolerance test, and the disposition recommendation. This module
 * therefore emits comparison inputs ONLY:
 *
 * - NO Δ_i / D_i / R_i computation here. A residualDelta on a
 *   CounterfactualResult is caller-supplied (computed by the engine that
 *   ran the counterfactual), never computed here.
 * - NO tolerance test here. Whether a residual is "within tolerance" is a
 *   Stage 5 question; this module carries the pinned ToleranceRecord
 *   through untouched so a tolerance change never requires re-running the
 *   calculation (04 §6.1, rule C-4).
 *
 * What this module does:
 * - Build ReconciliationInputs from a CalculationOutcome (exact value or
 *   BoundsResult) plus the recorded PA_AMB and the pinned tolerance
 *   record, enforcing the §6.1 rules C-1–C-4 structurally.
 * - Describe and construct counterfactual results for the closed
 *   CounterfactualOperation union (04 §6.2), and enforce the
 *   anti-coincidence rule (04 §4.4 A-3; 03 §2.7): a "supported" label
 *   requires a documented mechanism or cohort-wide resolution, otherwise
 *   the label is corrected to "coincidence".
 * - Carry the H1–H17 hypothesis catalogue (03 §2.5) and rank tested
 *   hypotheses by evidence and explanatory power, not numerical proximity
 *   (03 §2.6): document support first, cohort-wide resolution second,
 *   support class third, and residual size only as a tie-breaker.
 * - Detect the multiple-hypothesis conflict (03 §2.6): two supported
 *   hypotheses implying different corrected benefits bar Correction
 *   recommended.
 *
 * Pure functions only. No side effects, no network, no fetch. Money is
 * integer minor units (cents); residual comparisons use integer arithmetic,
 * never binary floats. Synthetic data only.
 */

import type {
  BoundsResult,
  CalculationOutcome,
  CounterfactualOperation,
  CounterfactualResult,
  Money,
  ReconciliationInputs,
  ToleranceRecord,
  TypedBenefitQuantity,
} from "./types";

// ---------------------------------------------------------------------------
// Hypothesis catalogue (Stage 1 output 03, §2.5 — H1–H17)
// ---------------------------------------------------------------------------

/** Support classes (03 §2.6). A Coincidence is never presented as an
 *  explanation and never moves a disposition to Verified. */
export type SupportClass = CounterfactualResult["supportClass"];

/** One catalogue entry: the explanation, what to check, and which
 *  counterfactual operations test it. */
export interface HypothesisCatalogueEntry {
  code: string;
  title: string;
  /** What to check / the evidence that would confirm or refute it. */
  whatToCheck: string;
  /** Counterfactual operation kinds that test this hypothesis. */
  counterfactualKinds: Array<CounterfactualOperation["kind"]>;
}

export const HYPOTHESIS_CATALOGUE: readonly HypothesisCatalogueEntry[] = [
  {
    code: "H1",
    title: "Different measurement dates",
    whatToCheck:
      "t_i of B_i^PA vs. reconstruction date; accrual between the two dates, compensation changes, amendment effective dates in between.",
    counterfactualKinds: [],
  },
  {
    code: "H2",
    title: "Different credited service",
    whatToCheck:
      "Service history: hire/termination/rehire dates, breaks in service, part-time proration, service-credit rules, prior-service grants.",
    counterfactualKinds: ["service-delta-years"],
  },
  {
    code: "H3",
    title: "Different compensation histories",
    whatToCheck:
      "Census compensation vs. payroll/plan records; missing years; definition changes; bonuses/overtime treatment.",
    counterfactualKinds: [],
  },
  {
    code: "H4",
    title: "Alternative compensation averaging period",
    whatToCheck:
      "Final-average vs. highest-average; 3-year vs. 5-year; consecutive vs. non-consecutive; averaging period ending at a different date.",
    counterfactualKinds: ["averaging-period"],
  },
  {
    code: "H5",
    title: "Incorrect or different accrual rate",
    whatToCheck:
      "Accrual percentage, step-rate/tiered schedules, service-band rates. Check the rate actually in effect at t_i, not the current rate.",
    counterfactualKinds: [],
  },
  {
    code: "H6",
    title: "Historical plan amendments",
    whatToCheck:
      "Formula changes, restatements, amendment adoption vs. effective dates. Never apply the latest formula retroactively.",
    counterfactualKinds: ["formula-version"],
  },
  {
    code: "H7",
    title: "Grandfathered benefit floors",
    whatToCheck:
      "Greater-of old vs. new formula; protected benefits under IRC §411(d)(6); transitional formulas.",
    counterfactualKinds: ["formula-version"],
  },
  {
    code: "H8",
    title: "Service or compensation caps",
    whatToCheck:
      "Maximum credited service, compensation caps (IRC §401(a)(17)), benefit maximums (IRC §415). A cap applied by one side only produces a one-sided discrepancy above the cap.",
    counterfactualKinds: ["cap"],
  },
  {
    code: "H9",
    title: "Benefit freezes",
    whatToCheck:
      "Full or partial freeze dates; accruals after the freeze must be zero (or limited). Diagnostic only — the freeze is binding.",
    counterfactualKinds: ["freeze"],
  },
  {
    code: "H10",
    title: "Social Security integration",
    whatToCheck:
      "Permitted disparity / excess formulas; covered-compensation tables; Primary Insurance Amount offsets.",
    counterfactualKinds: [],
  },
  {
    code: "H11",
    title: "Previously paid distributions",
    whatToCheck:
      "Prior lump sums, in-service distributions, QDRO alternate-payee offsets, prior annuity payments; restoration on rehire.",
    counterfactualKinds: ["prior-distribution"],
  },
  {
    code: "H12",
    title: "Vesting applied twice or omitted",
    whatToCheck:
      "Whether B_i^PA is already vested (or not); a discrepancy approximately equal to the benefit × (1 − vesting %) is the signature of this error.",
    counterfactualKinds: ["vesting"],
  },
  {
    code: "H13",
    title: "Different annuity forms",
    whatToCheck:
      "Straight life vs. joint-and-survivor vs. certain-and-continuous; conversion factors; pop-up provisions. Not a discrepancy until both sides are on the same form.",
    counterfactualKinds: [],
  },
  {
    code: "H14",
    title: "Different retirement dates",
    whatToCheck:
      "NRD vs. early/late retirement date; early-retirement reduction factors; late-retirement actuarial increases.",
    counterfactualKinds: [],
  },
  {
    code: "H15",
    title: "Rounding at different stages",
    whatToCheck:
      "Compensation, average, service, accrual-rate, intermediate-component, factor, or final-monthly rounding. A rounding explanation counts only under the anti-coincidence rule (§2.7).",
    counterfactualKinds: ["rounding-sequence"],
  },
  {
    code: "H16",
    title: "Missing information",
    whatToCheck:
      "Any input the reconstruction lacks that the administrator had (or vice versa). Enters the §12 framework; the discrepancy is bounded, not explained away.",
    counterfactualKinds: [],
  },
  {
    code: "H17",
    title: "Prior administrator calculation errors",
    whatToCheck:
      "Arithmetic, wrong table, wrong era's factors, transposed digits, duplicated records. Diagnosis of exclusion: only after H1–H16 have been tested and fail, and only with positive evidence (recomputation from source documents), never by elimination alone.",
    counterfactualKinds: [],
  },
];

/** Look up a catalogue entry by code ("H1"–"H17"), or null when unknown. */
export function hypothesisCatalogueEntry(code: string): HypothesisCatalogueEntry | null {
  const found = HYPOTHESIS_CATALOGUE.find((entry) => entry.code === code);
  return found === undefined ? null : found;
}

/** The hypothesis codes one counterfactual operation kind can test. */
export function hypothesesForOperationKind(
  kind: CounterfactualOperation["kind"],
): string[] {
  return HYPOTHESIS_CATALOGUE.filter((entry) => entry.counterfactualKinds.includes(kind)).map(
    (entry) => entry.code,
  );
}

// ---------------------------------------------------------------------------
// Building ReconciliationInputs (04 §6.1, rules C-1–C-4)
// ---------------------------------------------------------------------------

export interface BuildReconciliationInputsArgs {
  /** The pipeline's outcome: exact benefit, justified bounds, or
   *  indeterminate. Exactly one shape is present (04 §1.1). */
  outcome: CalculationOutcome;
  /** The recorded PA_AMB as a typed benefit quantity with source
   *  "prior-administrator". Null when the recorded amount is blank
   *  (missing data — never zero). */
  recorded: TypedBenefitQuantity | null;
  /** The tolerance record version applied (a copy, pinned at run time). */
  toleranceApplied: ToleranceRecord;
  /**
   * Basis statement. The pipeline (Stage 10) knows it; this builder
   * validates it against the outcome instead of deriving it by guesswork:
   * - "unresolved" requires reconstructed null (no Δ is computed);
   * - "basis-converted" requires basisConversion to be stated;
   * - "same-basis" requires no conversion to be stated.
   */
  comparisonBasis: ReconciliationInputs["comparisonBasis"];
  /** The conversion applied, when the basis was converted (e.g. annual→
   *  monthly ÷12, form conversion with factors cited, vesting conversion
   *  with VP cited). Required when comparisonBasis is "basis-converted". */
  basisConversion?: string | null;
  /** Denominator flag when B̂_i is zero or near zero (03 §2.3):
   *  "R_UNDEFINED_ZERO_DENOMINATOR", "R_UNSTABLE_SMALL_DENOMINATOR",
   *  or "PA_ZERO". A flag is recorded instead of a relative difference. */
  denominatorFlag?: string | null;
}

/**
 * Build the comparison inputs Stage 10 hands to the reconciliation module.
 * Rules enforced (04 §6.1):
 * - C-1: `reconstructed` is non-null only for an exact outcome; a bounds
 *   outcome carries `bounds` and reconstructed null; an indeterminate
 *   outcome carries neither and is routed to missing-data reporting.
 * - C-2: a recorded blank yields recorded null; a recorded zero is a value
 *   (with denominatorFlag "PA_ZERO" when B̂_i > 0), never treated as missing.
 * - C-3/C-4: no Δ/D/R and no tolerance test are computed here; the pinned
 *   tolerance record is carried through so a tolerance change never
 *   requires re-running the calculation.
 * Throws on a structurally inconsistent input (e.g. an exact outcome
 * paired with an "unresolved" basis, or a claimed conversion with no
 * conversion stated) — an inconsistent handoff is a construction error,
 * not a reconciliation result.
 */
export function buildReconciliationInputs(
  args: BuildReconciliationInputsArgs,
): ReconciliationInputs {
  const basisConversion = args.basisConversion ?? null;
  const denominatorFlag = args.denominatorFlag ?? null;

  if (args.comparisonBasis === "basis-converted" && basisConversion === null) {
    throw new Error(
      "buildReconciliationInputs: comparisonBasis is \"basis-converted\" but no basisConversion is stated",
    );
  }
  if (args.comparisonBasis === "same-basis" && basisConversion !== null) {
    throw new Error(
      "buildReconciliationInputs: comparisonBasis is \"same-basis\" but a basisConversion is stated",
    );
  }

  if (args.outcome.kind === "exact") {
    if (args.comparisonBasis === "unresolved") {
      throw new Error(
        "buildReconciliationInputs: an exact outcome cannot rest on an unresolved comparison basis",
      );
    }
    return {
      reconstructed: args.outcome.benefit,
      recorded: args.recorded,
      comparisonBasis: args.comparisonBasis,
      basisConversion,
      bounds: null,
      counterfactuals: [],
      denominatorFlag,
      toleranceApplied: args.toleranceApplied,
    };
  }

  if (args.outcome.kind === "bounds") {
    if (args.comparisonBasis === "unresolved") {
      throw new Error(
        "buildReconciliationInputs: a bounds outcome cannot rest on an unresolved comparison basis",
      );
    }
    return {
      reconstructed: null,
      recorded: args.recorded,
      comparisonBasis: args.comparisonBasis,
      basisConversion,
      bounds: args.outcome.bounds,
      counterfactuals: [],
      denominatorFlag,
      toleranceApplied: args.toleranceApplied,
    };
  }

  // Indeterminate: neither a reconstructed benefit nor bounds. The
  // participant is routed to the missing-data reporting, not the Δ
  // statistics (04 §6.1 C-1). The basis is unresolved whenever the
  // indeterminate reason is the unresolved basis; any other indeterminate
  // reason keeps the caller's basis statement.
  return {
    reconstructed: null,
    recorded: args.recorded,
    comparisonBasis: args.comparisonBasis,
    basisConversion,
    bounds: null,
    counterfactuals: [],
    denominatorFlag,
    toleranceApplied: args.toleranceApplied,
  };
}

/**
 * The recorded-position test for a bounds outcome (04 §5.5; 03 §4.3 B-5),
 * read off the BoundsResult the engine already computed — not recomputed
 * here. "inside" supports (does not prove) acceptance; "below-min" /
 * "above-max" means an assumption, the formula version, or the
 * administrator's amount is wrong; "recorded-missing" means the recorded
 * amount is blank. This function only restates the engine's recorded
 * position with its meaning, so callers do not re-derive it.
 */
export function describeRecordedPosition(bounds: BoundsResult): {
  position: BoundsResult["recordedPosition"];
  meaning: string;
} {
  switch (bounds.recordedPosition) {
    case "inside":
      return {
        position: "inside",
        meaning:
          "Recorded benefit is consistent with the evidence under the stated assumptions; supports (does not prove) acceptance.",
      };
    case "below-min":
      return {
        position: "below-min",
        meaning:
          "Recorded benefit is below the justified range: an assumption is wrong, the formula version is wrong, or the administrator's amount is wrong — investigation required.",
      };
    case "above-max":
      return {
        position: "above-max",
        meaning:
          "Recorded benefit is above the justified range: an assumption is wrong, the formula version is wrong, or the administrator's amount is wrong — investigation required.",
      };
    case "recorded-missing":
      return {
        position: "recorded-missing",
        meaning:
          "Recorded benefit is blank (missing data, never zero); the participant enters the §12 missing-data framework.",
      };
  }
}

// ---------------------------------------------------------------------------
// Counterfactual results (04 §6.2)
// ---------------------------------------------------------------------------

/** Human-readable description of one counterfactual operation, for
 *  traces and reports. The description names exactly what changes; the
 *  operation itself is applied by the engine on a copy of the pipeline
 *  state — the original calculation is never modified by testing a
 *  hypothesis (04 §6.2). */
export function describeCounterfactualOperation(
  operation: CounterfactualOperation,
): string {
  switch (operation.kind) {
    case "service-delta-years":
      return `credited service ${operation.years} years`;
    case "averaging-period":
      return `averaging period "${operation.period}"`;
    case "formula-version":
      return `formula version "${operation.formulaId}"`;
    case "vesting":
      return `vesting ${operation.mode}`;
    case "rounding-sequence":
      return `rounding sequence "${operation.sequence.sequenceId}" (hypothesis only)`;
    case "cap":
      return `cap "${operation.cap}" ${operation.applied ? "applied" : "not applied"}`;
    case "freeze":
      return `freeze ${operation.respected ? "respected" : "ignored (diagnostic only; the freeze is binding)"}`;
    case "prior-distribution":
      return `prior distribution ${operation.deducted ? "deducted" : "not deducted"}`;
  }
}

export interface MakeCounterfactualResultArgs {
  operation: CounterfactualOperation;
  /** The explanation this tests (H1–H17). */
  hypothesisCode: string;
  /** Recomputed benefit under the counterfactual, or null when the
   *  counterfactual cannot be evaluated. Supplied by the engine. */
  benefit: TypedBenefitQuantity | null;
  /** Residual discrepancy after the counterfactual (Δ under the
   *  counterfactual), or null when not computable. Supplied by the
   *  reconciliation module (Stage 5); this module never computes it. */
  residualDelta: Money | null;
  /** Support class (03 §2.6). A Coincidence is never presented as an
   *  explanation and never moves a disposition to Verified. */
  supportClass: SupportClass;
  /** Evidence for and against, with precise citations. */
  evidenceFor: string[];
  evidenceAgainst: string[];
}

/**
 * Construct a tested counterfactual result. Validates structure only:
 * the hypothesis code must be in the H1–H17 catalogue, and a null
 * recomputed benefit cannot carry a residual discrepancy. The benefit and
 * the residual are caller-supplied — this module does not recompute the
 * benefit (that is the engine) and does not compute Δ (that is Stage 5).
 * Throws on a structurally invalid result.
 */
export function makeCounterfactualResult(
  args: MakeCounterfactualResultArgs,
): CounterfactualResult {
  if (hypothesisCatalogueEntry(args.hypothesisCode) === null) {
    throw new Error(
      `makeCounterfactualResult: unknown hypothesis code ${JSON.stringify(args.hypothesisCode)} (expected H1–H17)`,
    );
  }
  if (args.benefit === null && args.residualDelta !== null) {
    throw new Error(
      "makeCounterfactualResult: a counterfactual that cannot be evaluated cannot carry a residual discrepancy",
    );
  }
  return {
    operation: args.operation,
    hypothesisCode: args.hypothesisCode,
    benefit: args.benefit,
    residualDelta: args.residualDelta,
    supportClass: args.supportClass,
    evidenceFor: [...args.evidenceFor],
    evidenceAgainst: [...args.evidenceAgainst],
  };
}

export interface SupportValidation {
  /** Whether the claimed support class may stand as labelled. */
  admissible: boolean;
  /** The support class after the anti-coincidence rule is applied. */
  correctedSupportClass: SupportClass;
  reason: string;
}

/**
 * Enforce the anti-coincidence rule (04 §4.4 A-3; 03 §2.7) on a tested
 * counterfactual result. A "supported" label is admissible only if (a)
 * the mechanism is documented in the plan, the administrator's
 * workpapers, or a valuation report, or (b) the same operation resolves
 * discrepancies across the cohort and no document contradicts it.
 * Otherwise the label is corrected to "coincidence": recorded as such,
 * never presented as an explanation, and never sufficient to move a
 * disposition to Verified. Other support classes stand as labelled —
 * "plausible" already concedes the absence of direct confirmation.
 */
export function validateCounterfactualSupport(
  result: CounterfactualResult,
  evidence: { documentedMechanism: boolean; resolvesCohort: boolean },
): SupportValidation {
  // A Plausible counterfactual that reproduces the recorded amount
  // exactly and resolves the discrepancy across the cohort is
  // Supported: cohort-wide resolution is the evidence the
  // anti-coincidence rule accepts (§2.6 — the same promotion the
  // rounding diagnostic already makes, see evaluateRoundingHypothesis).
  // Stage 7 G-ACC-4: testCounterfactual labels an undocumented
  // mechanism Plausible at best, so without this promotion the engine
  // could never reach Correction recommended through the counterfactual
  // path and the browser could never agree with the Node oracle on the
  // service/averaging cohorts. Documented mechanism alone does NOT
  // promote: a mechanism documented as an available alternative is not
  // a documented mechanism (see RankableCounterfactual above).
  if (
    result.supportClass === "plausible" &&
    evidence.resolvesCohort &&
    result.residualDelta !== null &&
    result.residualDelta.amountMinor === 0
  ) {
    return {
      admissible: true,
      correctedSupportClass: "supported",
      reason:
        "Supported: the same operation resolves discrepancies across the cohort and no document contradicts it.",
    };
  }
  if (result.supportClass !== "supported") {
    return {
      admissible: true,
      correctedSupportClass: result.supportClass,
      reason: `Support class "${result.supportClass}" stands as labelled.`,
    };
  }
  if (evidence.documentedMechanism || evidence.resolvesCohort) {
    return {
      admissible: true,
      correctedSupportClass: "supported",
      reason: evidence.documentedMechanism
        ? "Supported: the mechanism is documented in a governing source."
        : "Supported: the same operation resolves discrepancies across the cohort and no document contradicts it.",
    };
  }
  return {
    admissible: false,
    correctedSupportClass: "coincidence",
    reason:
      "A successful numerical match obtained by an arbitrary change is never proof of the administrator's actual methodology: no document states the mechanism and it does not resolve the cohort, so the label is corrected to coincidence.",
  };
}

// ---------------------------------------------------------------------------
// Ranking (03 §2.6) — by evidence and explanatory power, not proximity
// ---------------------------------------------------------------------------

/** A tested counterfactual plus the two ranking facts the reconciliation
 *  module supplies.
 *
 *  `documentedMechanism` — DECISION (Stage 5 integration, methodology
 *  03 §2.6 factor 1): true only when a cited governing source — a plan
 *  document, amendment, valuation report, or administrator workpaper —
 *  states or entails that this mechanism operated for this participant
 *  or their cohort, cited precisely. FALSE when the mechanism is merely
 *  a known alternative, appears somewhere in the plan's history without
 *  operating here, is consistent with the documents but not directly
 *  confirmed for this participant/cohort, or was only tested as a
 *  counterfactual. A mechanism documented as an available alternative is
 *  NOT a documented mechanism. (A Supported hypothesis is documented by
 *  definition — methodology §2.6: "a cited source document states or
 *  entails the mechanism" — so a correctly labelled Supported hypothesis
 *  always carries documentedMechanism true.)
 *
 *  `resolvesCohort`: whether the counterfactual eliminates (or reduces
 *  below tolerance) the discrepancy for the whole affected cohort, not
 *  just for one participant. */
export interface RankableCounterfactual extends CounterfactualResult {
  documentedMechanism: boolean;
  resolvesCohort: boolean;
}

const SUPPORT_RANK: Record<SupportClass, number> = {
  supported: 0,
  plausible: 1,
  coincidence: 2,
  refuted: 3,
};

/** Absolute residual in integer cents, or null when not computable.
 *  Nulls rank last: an unevaluated counterfactual explains nothing. */
function absResidualCents(result: CounterfactualResult): number | null {
  if (result.residualDelta === null) return null;
  const minor = result.residualDelta.amountMinor;
  return minor < 0 ? -minor : minor;
}

/**
 * Rank tested hypotheses by evidence and explanatory power, not numerical
 * proximity (03 §2.6), in this order:
 * 0. Refuted hypotheses sort last, before any other factor. A refuted
 *    hypothesis is a ruled-out candidate, not an explanation: document
 *    support (factor 1) ranks explanations, and a refuted candidate must
 *    never outrank a live one by documentation alone. Without this rule
 *    a refuted-but-documented hypothesis would rank above a supported
 *    but undocumented one — the true cause demoted by a ruled-out
 *    alternative. (A correctly labelled Supported hypothesis is
 *    documented by definition, so this rule only bites on mislabelled
 *    or contradictory inputs — exactly the case that must not mislead.)
 * 1. Document support (documented mechanism first).
 * 2. Explanatory power (resolves the discrepancy for the whole affected
 *    cohort first).
 * 3. Support class (Supported, then Plausible, then Coincidence, then
 *    Refuted).
 * 4. Amount of cited evidence for (more first).
 * 5. Numerical closeness — tie-breaker only: smaller residual first.
 * 6. Hypothesis code, for a deterministic order.
 * Returns a new array; the input is untouched.
 */
export function rankCounterfactuals(
  results: readonly RankableCounterfactual[],
): RankableCounterfactual[] {
  return [...results].sort((a, b) => {
    const aRefuted = a.supportClass === "refuted";
    const bRefuted = b.supportClass === "refuted";
    if (aRefuted !== bRefuted) {
      return aRefuted ? 1 : -1;
    }
    if (a.documentedMechanism !== b.documentedMechanism) {
      return a.documentedMechanism ? -1 : 1;
    }
    if (a.resolvesCohort !== b.resolvesCohort) {
      return a.resolvesCohort ? -1 : 1;
    }
    const supportDiff = SUPPORT_RANK[a.supportClass] - SUPPORT_RANK[b.supportClass];
    if (supportDiff !== 0) return supportDiff;
    const evidenceDiff = b.evidenceFor.length - a.evidenceFor.length;
    if (evidenceDiff !== 0) return evidenceDiff;
    const aResidual = absResidualCents(a);
    const bResidual = absResidualCents(b);
    if (aResidual !== null && bResidual !== null && aResidual !== bResidual) {
      return aResidual - bResidual;
    }
    if (aResidual === null && bResidual !== null) return 1;
    if (aResidual !== null && bResidual === null) return -1;
    if (a.hypothesisCode !== b.hypothesisCode) {
      return a.hypothesisCode < b.hypothesisCode ? -1 : 1;
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Multiple-hypothesis rule (03 §2.6)
// ---------------------------------------------------------------------------

export type ConflictingCorrections =
  | {
      conflict: true;
      /** The distinct corrected benefits the supported hypotheses imply. */
      correctedBenefitsCents: number[];
      hypothesisCodes: string[];
    }
  | { conflict: false };

/**
 * When two supported hypotheses both resolve the discrepancy, both are
 * recorded and ranked; the system does not silently pick one. If they
 * imply different corrected benefits, the disposition cannot be
 * Correction recommended — it is Requires investigation (or Indeterminate
 * if the evidence cannot distinguish them). This function detects that
 * case from the supported results' recomputed benefits.
 */
export function findConflictingCorrections(
  results: readonly CounterfactualResult[],
): ConflictingCorrections {
  const supported = results.filter(
    (result) => result.supportClass === "supported" && result.benefit !== null,
  );
  const byAmount = new Map<number, string[]>();
  for (const result of supported) {
    const benefit = result.benefit;
    if (benefit === null || benefit.amount === null) continue;
    const cents = benefit.amount.amountMinor;
    const codes = byAmount.get(cents);
    if (codes === undefined) byAmount.set(cents, [result.hypothesisCode]);
    else codes.push(result.hypothesisCode);
  }
  if (byAmount.size <= 1) return { conflict: false };
  const correctedBenefitsCents = [...byAmount.keys()].sort((a, b) => a - b);
  const hypothesisCodes: string[] = [];
  for (const cents of correctedBenefitsCents) {
    const codes = byAmount.get(cents);
    if (codes !== undefined) hypothesisCodes.push(...codes);
  }
  return { conflict: true, correctedBenefitsCents, hypothesisCodes };
}
