/**
 * Unit tests for src/reconcile.ts — the Stage 5 reconciliation module:
 * Δ/D/R, the configurable tolerance framework (T-1–T-5), the
 * per-participant reconciliation record, rounding as a diagnostic with
 * the anti-coincidence rule, and the hypothesis evaluation entry point.
 *
 * Run with plain node + node:test (no test framework dependency), only
 * this module's tests (do not run `npm test` — it writes the shared
 * dist/ and races with parallel workers):
 *   npx tsc --outDir dist-w1 && node --test dist-w1/test/reconcile.test.js
 *
 * Synthetic data only. No live case data. Worked examples are the
 * fictional participants SYN-001 (exact $1,500.00), SYN-002 (bounds
 * $1,584.00–$1,683.00), Harborview ($1,067.50 vs $1,232.50), SYN-V-01
 * ($850.00 vs $849.50), and SYN-I-01 (Indeterminate) from the Stage 2
 * and Stage 4 worked examples.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NO_BUILT_IN_TOLERANCE_STATEMENT,
  POLICY_5_8_1_BORROWED_REFERENCE,
  applyTolerance,
  borrowedReferenceTolerances,
  borrowedToleranceAdoptionStatement,
  computeDiscrepancy,
  discrepancyFromAmounts,
  evaluateAndRankHypotheses,
  evaluateRoundingHypothesis,
  reconcileParticipant,
  residualWithinTolerance,
  retestTolerance,
  validateToleranceRecord,
} from "../src/reconcile.js";
import type {
  HypothesisEvaluationInput,
  ReconciliationConfig,
} from "../src/reconcile.js";
import { decCompare } from "../src/decimal.js";
import { makeMoney } from "../src/decimal.js";
import {
  buildReconciliationInputs,
  makeCounterfactualResult,
} from "../src/reconciliation.js";
import type {
  BoundsResult,
  CalculationOutcome,
  CounterfactualOperation,
  CounterfactualResult,
  ReconciliationInputs,
  ToleranceRecord,
  TypedBenefitQuantity,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TOLERANCE: ToleranceRecord = {
  version: 1,
  absoluteMinor: 100, // $1.00/month
  relativeDecimal: "0.01", // 1%
  application: "either",
  authority:
    "Actuary-set per case; screening values borrowed from Policy 5.8-1 Benefit Corrections, labelled as such — that policy governs correction of issued benefit determinations, not acceptance of PA_AMB.",
  approvedBy: "A. Actuary",
  approvedDate: "2026-11-12",
};

const CONFIG: ReconciliationConfig = {
  epsilonRMinor: 100, // $1.00/month — no plan minimum documented (03 §2.3)
  epsilonRSource: "$1.00/month — no plan minimum documented (Stage 1 output 03, §2.3)",
  materialityMinor: 10000, // $100.00/month, actuary-set per case
  materialitySource: "Actuary-set per case; no PBGC source states a reconciliation materiality threshold.",
};

const CONFIG_LOW_MATERIALITY: ReconciliationConfig = {
  ...CONFIG,
  materialityMinor: 5000, // $50.00/month
};

function makeBenefit(
  amountMinor: number | null,
  source: TypedBenefitQuantity["source"],
  overrides: Partial<TypedBenefitQuantity> = {},
): TypedBenefitQuantity {
  return {
    amount: amountMinor === null ? null : makeMoney(amountMinor),
    periodicity: "monthly",
    measurementDate: "2019-06-30",
    measurementBasis: "dote",
    basisNote: null,
    commencementBasis: "payable at NRD",
    retirementAge: 65,
    retirementDate: "2025-04-15",
    annuityForm: "NSF",
    vestingTreatment: "vested",
    planVersionId: "pv-1",
    formulaId: "f-1",
    source,
    status: source === "prior-administrator" ? "recorded" : "calculated",
    ownerId: "owner-1",
    ...overrides,
  };
}

/** Stage 10 inputs for an exact reconstruction (via Stage 4's builder). */
function exactInputs(recordedMinor: number | null, reconstructedMinor: number): ReconciliationInputs {
  const outcome: CalculationOutcome = {
    kind: "exact",
    benefit: makeBenefit(reconstructedMinor, "independent-calculation"),
    trace: [],
  };
  return buildReconciliationInputs({
    outcome,
    recorded: recordedMinor === null ? null : makeBenefit(recordedMinor, "prior-administrator"),
    toleranceApplied: TOLERANCE,
    comparisonBasis: "same-basis",
  });
}

function makeBounds(
  minMinor: number,
  maxMinor: number,
  recordedPosition: BoundsResult["recordedPosition"],
): BoundsResult {
  return {
    min: makeMoney(minMinor),
    max: makeMoney(maxMinor),
    assumptions: ["Missing compensation year bounded by documented facts and the §401(a)(17) cap in effect."],
    derivation: {
      method: "endpoint-evaluation",
      kinkPoints: [],
      monotonicity: [{ input: "missing compensation year", monotone: true, verifiedBy: "formula structure" }],
      feasibleRegion: "Missing year in [$4,800, $5,400] monthly.",
    },
    widthAttribution: [],
    scenarios: [],
    recordedPosition,
    minBenefit: makeBenefit(minMinor, "bound"),
    maxBenefit: makeBenefit(maxMinor, "bound"),
  };
}

/** Stage 10 inputs for a bounds outcome (SYN-002 shape). */
function boundsInputs(recordedMinor: number | null): ReconciliationInputs {
  const outcome: CalculationOutcome = {
    kind: "bounds",
    bounds: makeBounds(158400, 168300, recordedMinor === null ? "recorded-missing" : "inside"),
    trace: [],
  };
  return buildReconciliationInputs({
    outcome,
    recorded: recordedMinor === null ? null : makeBenefit(recordedMinor, "prior-administrator"),
    toleranceApplied: TOLERANCE,
    comparisonBasis: "same-basis",
  });
}

/** Stage 10 inputs for an indeterminate outcome (SYN-I-01 shape). */
function indeterminateInputs(): ReconciliationInputs {
  const outcome: CalculationOutcome = {
    kind: "indeterminate",
    reason: {
      code: "unresolved-comparison-basis",
      detail: "Measurement date of the recorded benefit cannot be established from available documents.",
      missingInputs: ["BenefitObservation.measurementDate"],
      wouldResolve: ["Prior administrator benefit schedule stating the measurement date."],
    },
    trace: [],
  };
  return buildReconciliationInputs({
    outcome,
    recorded: makeBenefit(112000, "prior-administrator"),
    toleranceApplied: TOLERANCE,
    comparisonBasis: "unresolved",
  });
}

function makeResult(overrides: Partial<CounterfactualResult>): CounterfactualResult {
  return makeCounterfactualResult({
    operation: { kind: "service-delta-years", years: "+1" },
    hypothesisCode: "H2",
    benefit: makeBenefit(86000, "independent-calculation"),
    residualDelta: makeMoney(1000),
    supportClass: "supported",
    evidenceFor: ["Plan §3.2: credited service includes the disputed year."],
    evidenceAgainst: [],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Δ/D/R on the worked examples (§2.1)
// ---------------------------------------------------------------------------

describe("computeDiscrepancy — worked examples (§2.1)", () => {
  it("SYN-001 exact: $1,500.00 vs $1,500.00 → Δ $0, D $0, R 0", () => {
    const discrepancy = computeDiscrepancy(exactInputs(150000, 150000), CONFIG.epsilonRMinor);
    assert.equal(discrepancy.comparable, true);
    if (!discrepancy.comparable) return;
    assert.equal(discrepancy.delta.amountMinor, 0);
    assert.equal(discrepancy.absDelta.amountMinor, 0);
    assert.deepEqual(discrepancy.relative, { kind: "defined", value: "0" });
    assert.equal(discrepancy.denominatorFlag, null);
  });

  it("SYN-V-01: $850.00 vs $849.50 → Δ +$0.50, D $0.50, R small and positive", () => {
    const discrepancy = computeDiscrepancy(exactInputs(85000, 84950), CONFIG.epsilonRMinor);
    assert.equal(discrepancy.comparable, true);
    if (!discrepancy.comparable) return;
    assert.equal(discrepancy.delta.amountMinor, 50);
    assert.equal(discrepancy.absDelta.amountMinor, 50);
    assert.equal(discrepancy.relative.kind, "defined");
    if (discrepancy.relative.kind !== "defined") return;
    // 50 / 84950 ≈ 0.0005886 — positive and well under 1%.
    assert.equal(decCompare(discrepancy.relative.value, "0"), 1);
    assert.equal(decCompare(discrepancy.relative.value, "0.01"), -1);
    assert.equal(discrepancy.denominatorFlag, null);
  });

  it("Harborview: $1,232.50 vs $1,067.50 → Δ +$165.00, D $165.00, R between 15% and 16%", () => {
    const discrepancy = computeDiscrepancy(exactInputs(123250, 106750), CONFIG.epsilonRMinor);
    assert.equal(discrepancy.comparable, true);
    if (!discrepancy.comparable) return;
    assert.equal(discrepancy.delta.amountMinor, 16500);
    assert.equal(discrepancy.absDelta.amountMinor, 16500);
    assert.equal(discrepancy.relative.kind, "defined");
    if (discrepancy.relative.kind !== "defined") return;
    // 16500 / 106750 ≈ 0.15457.
    assert.equal(decCompare(discrepancy.relative.value, "0.15"), 1);
    assert.equal(decCompare(discrepancy.relative.value, "0.16"), -1);
    assert.equal(discrepancy.denominatorFlag, null);
  });

  it("SYN-002 bounds: $1,584.00–$1,683.00 with PA_AMB $1,620 inside → no Δ, bounds-only", () => {
    const discrepancy = computeDiscrepancy(boundsInputs(162000), CONFIG.epsilonRMinor);
    assert.equal(discrepancy.comparable, false);
    if (discrepancy.comparable) return;
    assert.equal(discrepancy.reason, "bounds-only");
    assert.match(discrepancy.detail, /recorded-position/);
  });

  it("SYN-I-01 Indeterminate → no Δ, unresolved comparison basis", () => {
    const discrepancy = computeDiscrepancy(indeterminateInputs(), CONFIG.epsilonRMinor);
    assert.equal(discrepancy.comparable, false);
    if (discrepancy.comparable) return;
    assert.equal(discrepancy.reason, "unresolved-comparison-basis");
  });

  it("indeterminate reconstruction on an established basis → no Δ", () => {
    const outcome: CalculationOutcome = {
      kind: "indeterminate",
      reason: {
        code: "missing-inputs",
        detail: "Formula for the participant's era is unknown.",
        missingInputs: ["Formula.formulaId"],
        wouldResolve: ["Plan document for the participant's era."],
      },
      trace: [],
    };
    const inputs = buildReconciliationInputs({
      outcome,
      recorded: makeBenefit(112000, "prior-administrator"),
      toleranceApplied: TOLERANCE,
      comparisonBasis: "same-basis",
    });
    const discrepancy = computeDiscrepancy(inputs, CONFIG.epsilonRMinor);
    assert.equal(discrepancy.comparable, false);
    if (discrepancy.comparable) return;
    assert.equal(discrepancy.reason, "indeterminate-reconstruction");
  });

  it("no comparison without an established basis, even when both amounts exist", () => {
    const inputs: ReconciliationInputs = {
      reconstructed: makeBenefit(84950, "independent-calculation"),
      recorded: makeBenefit(85000, "prior-administrator"),
      comparisonBasis: "unresolved",
      basisConversion: null,
      bounds: null,
      counterfactuals: [],
      denominatorFlag: null,
      toleranceApplied: TOLERANCE,
    };
    const discrepancy = computeDiscrepancy(inputs, CONFIG.epsilonRMinor);
    assert.equal(discrepancy.comparable, false);
    if (discrepancy.comparable) return;
    assert.equal(discrepancy.reason, "unresolved-comparison-basis");
  });

  it("blank PA_AMB → no Δ, recorded-missing (a blank is never zero)", () => {
    const discrepancy = computeDiscrepancy(exactInputs(null, 84950), CONFIG.epsilonRMinor);
    assert.equal(discrepancy.comparable, false);
    if (discrepancy.comparable) return;
    assert.equal(discrepancy.reason, "recorded-missing");
  });

  it("Δ is signed: a lower recorded amount gives a negative Δ", () => {
    const discrepancy = computeDiscrepancy(exactInputs(80000, 84950), CONFIG.epsilonRMinor);
    assert.equal(discrepancy.comparable, true);
    if (!discrepancy.comparable) return;
    assert.equal(discrepancy.delta.amountMinor, -4950);
    assert.equal(discrepancy.absDelta.amountMinor, 4950);
  });
});

// ---------------------------------------------------------------------------
// Zero and near-zero denominators (§2.3)
// ---------------------------------------------------------------------------

describe("zero and near-zero denominators (§2.3)", () => {
  it("B̂_i = 0 exactly: R undefined, flag R_UNDEFINED_ZERO_DENOMINATOR; Δ and D still reported", () => {
    const discrepancy = discrepancyFromAmounts(41275, 0, CONFIG.epsilonRMinor);
    assert.equal(discrepancy.comparable, true);
    if (!discrepancy.comparable) return;
    assert.equal(discrepancy.delta.amountMinor, 41275);
    assert.equal(discrepancy.absDelta.amountMinor, 41275);
    assert.equal(discrepancy.relative.kind, "undefined");
    if (discrepancy.relative.kind !== "undefined") return;
    assert.equal(discrepancy.relative.flag, "R_UNDEFINED_ZERO_DENOMINATOR");
    assert.match(discrepancy.relative.reason, /zero reconstructed benefit/);
    assert.equal(discrepancy.denominatorFlag, "R_UNDEFINED_ZERO_DENOMINATOR");
  });

  it("0 < |B̂_i| < ε_R: R flagged, not computed (A-105: $975.40 vs $4.10)", () => {
    // A-105's flag depends on the case-set ε_R: with the plan's smallest
    // payable monthly amount at $5.00 (ε_R = 500), $4.10 is below it.
    const discrepancy = discrepancyFromAmounts(97540, 410, 500);
    assert.equal(discrepancy.comparable, true);
    if (!discrepancy.comparable) return;
    assert.equal(discrepancy.delta.amountMinor, 97130);
    assert.equal(discrepancy.absDelta.amountMinor, 97130);
    assert.equal(discrepancy.relative.kind, "undefined");
    if (discrepancy.relative.kind !== "undefined") return;
    assert.equal(discrepancy.relative.flag, "R_UNSTABLE_SMALL_DENOMINATOR");
    assert.equal(discrepancy.denominatorFlag, "R_UNSTABLE_SMALL_DENOMINATOR");
  });

  it("B̂_i exactly at ε_R is computable (the flag applies only below ε_R)", () => {
    const discrepancy = discrepancyFromAmounts(200, 100, CONFIG.epsilonRMinor);
    assert.equal(discrepancy.comparable, true);
    if (!discrepancy.comparable) return;
    assert.equal(discrepancy.relative.kind, "defined");
    assert.equal(discrepancy.denominatorFlag, null);
  });

  it("recorded zero against a positive reconstruction: Δ = −B̂_i, R = −1 exactly, flag PA_ZERO", () => {
    const discrepancy = discrepancyFromAmounts(0, 41275, CONFIG.epsilonRMinor);
    assert.equal(discrepancy.comparable, true);
    if (!discrepancy.comparable) return;
    assert.equal(discrepancy.delta.amountMinor, -41275);
    assert.equal(discrepancy.absDelta.amountMinor, 41275);
    assert.deepEqual(discrepancy.relative, { kind: "defined", value: "-1" });
    assert.equal(discrepancy.denominatorFlag, "PA_ZERO");
  });

  it("both zero: Δ = D = 0, R undefined, flag R_UNDEFINED_ZERO_DENOMINATOR", () => {
    const discrepancy = discrepancyFromAmounts(0, 0, CONFIG.epsilonRMinor);
    assert.equal(discrepancy.comparable, true);
    if (!discrepancy.comparable) return;
    assert.equal(discrepancy.delta.amountMinor, 0);
    assert.equal(discrepancy.absDelta.amountMinor, 0);
    assert.equal(discrepancy.relative.kind, "undefined");
    assert.equal(discrepancy.denominatorFlag, "R_UNDEFINED_ZERO_DENOMINATOR");
  });
});

// ---------------------------------------------------------------------------
// Tolerance framework T-1–T-5 (§2.4)
// ---------------------------------------------------------------------------

describe("tolerance framework (T-1–T-5)", () => {
  it("no built-in tolerance: no configured leg → verdict not-applicable, never a silent default", () => {
    assert.match(NO_BUILT_IN_TOLERANCE_STATEMENT, /no built-in acceptance tolerance/);
    const noTolerance: ToleranceRecord = {
      ...TOLERANCE,
      absoluteMinor: null,
      relativeDecimal: null,
    };
    const discrepancy = computeDiscrepancy(exactInputs(85000, 84950), CONFIG.epsilonRMinor);
    const test = applyTolerance(discrepancy, noTolerance);
    assert.equal(test.verdict, "not-applicable");
    assert.match(test.detail, /no built-in acceptance tolerance/);
    assert.equal(test.absoluteLeg, null);
    assert.equal(test.relativeLeg, null);
  });

  it("Policy 5.8-1 figures are labelled borrowed reference only, never a reconciliation rule", () => {
    const borrowed = borrowedReferenceTolerances();
    assert.equal(
      borrowed.label,
      "borrowed from the benefit-correction policy, not a reconciliation rule",
    );
    assert.equal(borrowed.monthlyIncreaseMinor, 100); // $1.00
    assert.equal(borrowed.monthlyDecreaseMinor, 500); // $5.00
    assert.match(borrowed.source, /Policy 5\.8-1/);
    assert.match(borrowed.scopeNote, /not whether a case actuary accepts PA_AMB/);
    assert.deepEqual(borrowed, POLICY_5_8_1_BORROWED_REFERENCE);
  });

  it("the T-4 adoption statement names the policy, the limit, the adopter, and the rationale", () => {
    const statement = borrowedToleranceAdoptionStatement({
      author: "A. Actuary",
      date: "2026-11-12",
      rationale: "Screening only, pending a case-specific tolerance review.",
    });
    assert.match(
      statement,
      /Screening values borrowed from Policy 5\.8-1 Benefit Corrections; that policy governs correction of issued benefit determinations, not acceptance of PA_AMB\./,
    );
    assert.match(statement, /Adopted as case screening values by A\. Actuary, 2026-11-12\./);
    assert.match(statement, /Screening only, pending a case-specific tolerance review\./);
  });

  it("tolerance change does not force recalculation: reconstruction and Δ are untouched", () => {
    const record = reconcileParticipant({
      participantKey: "SYN-V-01",
      inputs: exactInputs(85000, 84950),
      config: CONFIG,
    });
    assert.equal(record.toleranceVerdict, "within-tolerance");
    assert.equal(record.recommendedDisposition, "verified");

    const tighter: ToleranceRecord = {
      ...TOLERANCE,
      version: 2,
      absoluteMinor: 25, // $0.25/month — the $0.50 difference now fails
      relativeDecimal: "0.0001",
      authority: borrowedToleranceAdoptionStatement({
        author: "A. Actuary",
        date: "2026-11-12",
        rationale: "Tightened after review: the case tolerance is $0.25/month.",
      }),
    };
    const retested = retestTolerance(record, tighter, CONFIG);

    // The verdict and the recommendation change; the calculation does not.
    assert.equal(retested.toleranceVerdict, "outside-tolerance");
    assert.equal(retested.recommendedDisposition, "requires-investigation");
    assert.equal(retested.toleranceApplied.version, 2);
    assert.deepEqual(retested.comparison, record.comparison);
    assert.deepEqual(retested.reconstructed, record.reconstructed);
    assert.deepEqual(retested.recorded, record.recorded);
    assert.deepEqual(retested.hypotheses, record.hypotheses);
    assert.deepEqual(retested.bounds, record.bounds);
    // The original record is untouched.
    assert.equal(record.toleranceVerdict, "within-tolerance");
    assert.equal(record.toleranceApplied.version, 1);
  });

  it("retestTolerance refuses a new record with the same version (a change is versioned, never in place)", () => {
    const record = reconcileParticipant({
      participantKey: "SYN-V-01",
      inputs: exactInputs(85000, 84950),
      config: CONFIG,
    });
    assert.throws(
      () => retestTolerance(record, { ...TOLERANCE }, CONFIG),
      /new version/,
    );
  });

  it("tolerance is recorded with rationale and run version on the participant record", () => {
    const record = reconcileParticipant({
      participantKey: "SYN-V-01",
      inputs: exactInputs(85000, 84950),
      config: CONFIG,
    });
    assert.equal(record.toleranceApplied.version, 1);
    assert.match(record.toleranceApplied.authority, /borrowed from Policy 5\.8-1/);
    assert.equal(record.toleranceApplied.approvedBy, "A. Actuary");
    assert.equal(record.toleranceApplied.approvedDate, "2026-11-12");
    assert.equal(validateToleranceRecord(record.toleranceApplied).valid, true);
  });

  it("validateToleranceRecord flags an empty authority, a missing approver, and a relative tolerance over 100%", () => {
    const bad: ToleranceRecord = {
      version: 1,
      absoluteMinor: 100,
      relativeDecimal: "1.5",
      application: "either",
      authority: "  ",
      approvedBy: "",
      approvedDate: "2026-11-12",
    };
    const check = validateToleranceRecord(bad);
    assert.equal(check.valid, false);
    assert.match(check.problems.join(" "), /authority is empty/);
    assert.match(check.problems.join(" "), /approver is empty/);
    assert.match(check.problems.join(" "), /exceeds 1/);
  });

  it("combination rule 'both': absolute met but relative not met → outside; 'either' → within", () => {
    // SYN-V-01: D $0.50 meets τ_abs $1.00, but R ≈ 0.059% exceeds τ_rel 0.01%.
    const discrepancy = computeDiscrepancy(exactInputs(85000, 84950), CONFIG.epsilonRMinor);
    const both: ToleranceRecord = { ...TOLERANCE, application: "both", relativeDecimal: "0.0001" };
    assert.equal(applyTolerance(discrepancy, both).verdict, "outside-tolerance");
    const either: ToleranceRecord = { ...TOLERANCE, application: "either", relativeDecimal: "0.0001" };
    assert.equal(applyTolerance(discrepancy, either).verdict, "within-tolerance");
  });

  it("combination rule 'larger-of': the relative leg converts to dollars at the participant's benefit size", () => {
    // SYN-V-01: larger of $1.00 and 1% × $849.50 = $8.495 is $8.495; D $0.50 is within.
    const discrepancy = computeDiscrepancy(exactInputs(85000, 84950), CONFIG.epsilonRMinor);
    const larger: ToleranceRecord = { ...TOLERANCE, application: "larger-of" };
    const test = applyTolerance(discrepancy, larger);
    assert.equal(test.verdict, "within-tolerance");
    assert.match(test.detail, /8\.495/);
  });

  it("an undefined R_i leaves the relative leg unevaluable: 'either' falls back to the absolute leg", () => {
    const discrepancy = discrepancyFromAmounts(41275, 0, CONFIG.epsilonRMinor);
    const test = applyTolerance(discrepancy, TOLERANCE);
    assert.equal(test.verdict, "outside-tolerance"); // D $412.75 exceeds $1.00
    assert.equal(test.relativeLeg, null);
    assert.equal(test.absoluteLeg, false);
    const small: ToleranceRecord = { ...TOLERANCE, absoluteMinor: 50000 };
    const within = applyTolerance(discrepancy, small);
    assert.equal(within.verdict, "within-tolerance");
    assert.equal(within.relativeLeg, null);
  });
});

// ---------------------------------------------------------------------------
// Per-participant reconciliation record (§10)
// ---------------------------------------------------------------------------

describe("reconcileParticipant — the per-participant record", () => {
  it("SYN-001: exact match, within tolerance, no hypotheses → Verified", () => {
    const record = reconcileParticipant({
      participantKey: "SYN-001",
      inputs: exactInputs(150000, 150000),
      config: CONFIG,
    });
    assert.equal(record.participantKey, "SYN-001");
    assert.equal(record.comparison.comparable, true);
    assert.equal(record.toleranceVerdict, "within-tolerance");
    assert.equal(record.recommendedDisposition, "verified");
    assert.deepEqual(record.hypotheses, []);
    assert.equal(record.conflictingCorrections, false);
    assert.equal(record.recordedPosition, null);
    assert.equal(record.bounds, null);
  });

  it("Harborview: Δ +$165.00 outside tolerance, no supported hypothesis → Requires investigation", () => {
    const record = reconcileParticipant({
      participantKey: "Harborview",
      inputs: exactInputs(123250, 106750),
      config: CONFIG,
    });
    assert.equal(record.toleranceVerdict, "outside-tolerance");
    assert.equal(record.recommendedDisposition, "requires-investigation");
    assert.match(record.dispositionBasis, /outside tolerance/);
  });

  it("SYN-002 bounds, PA_AMB inside, width $99.00 within τ_material $100 → Supported for acceptance", () => {
    const record = reconcileParticipant({
      participantKey: "SYN-002",
      inputs: boundsInputs(162000),
      config: CONFIG,
    });
    assert.equal(record.comparison.comparable, false);
    assert.equal(record.recordedPosition, "inside");
    assert.match(record.recordedPositionMeaning ?? "", /consistent with the evidence/);
    assert.equal(record.toleranceVerdict, "not-applicable");
    assert.equal(record.recommendedDisposition, "supported-for-acceptance");
  });

  it("SYN-002 bounds with τ_material $50: the same $99.00 width is material → Requires investigation", () => {
    const record = reconcileParticipant({
      participantKey: "SYN-002",
      inputs: boundsInputs(162000),
      config: CONFIG_LOW_MATERIALITY,
    });
    assert.equal(record.recommendedDisposition, "requires-investigation");
    assert.match(record.dispositionBasis, /exceeds the case materiality threshold/);
  });

  it("SYN-I-01 Indeterminate: no comparison, recommendation Indeterminate", () => {
    const record = reconcileParticipant({
      participantKey: "SYN-I-01",
      inputs: indeterminateInputs(),
      config: CONFIG,
    });
    assert.equal(record.comparison.comparable, false);
    assert.equal(record.recommendedDisposition, "indeterminate");
    assert.match(record.dispositionBasis, /No comparison exists/);
  });

  it("blank PA_AMB with an exact reconstruction → Requires investigation, not Indeterminate (agrees with dispositionMapping step 2)", () => {
    const record = reconcileParticipant({
      participantKey: "SYN-BLANK",
      inputs: exactInputs(null, 150000),
      config: CONFIG,
    });
    const comparison = record.comparison;
    assert.equal(comparison.comparable, false);
    if (comparison.comparable) throw new Error("expected no comparison");
    assert.equal(comparison.reason, "recorded-missing");
    assert.equal(record.recommendedDisposition, "requires-investigation");
    assert.match(record.dispositionBasis, /exact independent reconstruction exists/);
  });

  it("within tolerance but a material hypothesis is only Plausible → Requires investigation, not Verified", () => {
    const plausible = makeResult({
      hypothesisCode: "H4",
      operation: { kind: "averaging-period", period: "5-year highest" },
      benefit: makeBenefit(84950, "independent-calculation"),
      residualDelta: makeMoney(50),
      supportClass: "plausible",
      evidenceFor: ["The 5-year averaging period is consistent with the plan's history."],
    });
    const record = reconcileParticipant({
      participantKey: "SYN-V-01",
      inputs: exactInputs(85000, 84950),
      config: CONFIG,
      hypothesisCandidates: [
        { result: plausible, documentedMechanism: false, resolvesCohort: false, material: true },
      ],
    });
    assert.equal(record.toleranceVerdict, "within-tolerance");
    assert.equal(record.recommendedDisposition, "requires-investigation");
    assert.match(record.dispositionBasis, /material hypotheses remain unresolved/);
  });

  it("outside tolerance with one supported hypothesis and a single corrected value → Correction recommended", () => {
    const supported = makeResult({
      hypothesisCode: "H2",
      operation: { kind: "service-delta-years", years: "+1" },
      benefit: makeBenefit(99950, "independent-calculation"),
      residualDelta: makeMoney(50),
      supportClass: "supported",
      evidenceFor: ["Plan §3.2: credited service includes the disputed year."],
    });
    const record = reconcileParticipant({
      participantKey: "SYN-C-01",
      inputs: exactInputs(100000, 90000),
      config: CONFIG,
      hypothesisCandidates: [
        { result: supported, documentedMechanism: true, resolvesCohort: true, material: true },
      ],
    });
    assert.equal(record.toleranceVerdict, "outside-tolerance");
    assert.equal(record.recommendedDisposition, "correction-recommended");
    assert.match(record.dispositionBasis, /reasonable certainty/);
  });

  it("a counterfactual that reproduces the recorded amount and resolves the cohort → Correction recommended, corrected value is the reconstruction (Stage 7 G-ACC-4)", () => {
    // The planted service error: the PA's amount is exactly what 21
    // years gives; the reconstruction (20 years, the documented basis)
    // is the single corrected value. The counterfactual benefit IS the
    // recorded amount (value under the administrator's basis), so the
    // corrected value comes from the reconstruction, not the hypothesis
    // benefit — and the Plausible label is promoted to Supported by
    // cohort-wide resolution (validateCounterfactualSupport).
    const reproduced = makeResult({
      hypothesisCode: "H2",
      operation: { kind: "service-delta-years", years: "+1" },
      benefit: makeBenefit(100000, "independent-calculation"),
      residualDelta: makeMoney(0),
      supportClass: "plausible",
      evidenceFor: ["the counterfactual benefit equals the recorded PA_AMB"],
    });
    const record = reconcileParticipant({
      participantKey: "SYN-C-02",
      inputs: exactInputs(100000, 90000),
      config: CONFIG,
      hypothesisCandidates: [
        { result: reproduced, documentedMechanism: false, resolvesCohort: true, material: true },
      ],
    });
    assert.equal(record.toleranceVerdict, "outside-tolerance");
    assert.equal(record.hypotheses[0]?.supportClass, "supported");
    assert.equal(record.recommendedDisposition, "correction-recommended");
    assert.match(record.dispositionBasis, /independent reconstruction \(90000 minor units\)/);
  });

  it("the same exact match WITHOUT cohort resolution stays Requires investigation", () => {
    const reproduced = makeResult({
      hypothesisCode: "H2",
      operation: { kind: "service-delta-years", years: "+1" },
      benefit: makeBenefit(100000, "independent-calculation"),
      residualDelta: makeMoney(0),
      supportClass: "plausible",
      evidenceFor: ["the counterfactual benefit equals the recorded PA_AMB"],
    });
    const record = reconcileParticipant({
      participantKey: "SYN-C-03",
      inputs: exactInputs(100000, 90000),
      config: CONFIG,
      hypothesisCandidates: [
        { result: reproduced, documentedMechanism: false, resolvesCohort: false, material: true },
      ],
    });
    assert.equal(record.toleranceVerdict, "outside-tolerance");
    assert.equal(record.recommendedDisposition, "requires-investigation");
  });

  it("two supported hypotheses implying different corrected benefits → conflict, Requires investigation", () => {
    const first = makeResult({
      hypothesisCode: "H2",
      operation: { kind: "service-delta-years", years: "+1" },
      benefit: makeBenefit(99950, "independent-calculation"),
      residualDelta: makeMoney(50),
      supportClass: "supported",
      evidenceFor: ["Plan §3.2: credited service includes the disputed year."],
    });
    const second = makeResult({
      hypothesisCode: "H6",
      operation: { kind: "formula-version", formulaId: "f-1989" },
      benefit: makeBenefit(99900, "independent-calculation"),
      residualDelta: makeMoney(100),
      supportClass: "supported",
      evidenceFor: ["1989 restatement formula applies to this service period."],
    });
    const record = reconcileParticipant({
      participantKey: "SYN-C-02",
      inputs: exactInputs(100000, 90000),
      config: CONFIG,
      hypothesisCandidates: [
        { result: first, documentedMechanism: true, resolvesCohort: true, material: true },
        { result: second, documentedMechanism: true, resolvesCohort: true, material: true },
      ],
    });
    assert.equal(record.conflictingCorrections, true);
    assert.equal(record.recommendedDisposition, "requires-investigation");
    assert.match(record.dispositionBasis, /different corrected benefits/);
  });

  it("a supported hypothesis whose corrected benefit equals B_i^PA is a reconstruction error, not a correction", () => {
    const explains = makeResult({
      hypothesisCode: "H2",
      operation: { kind: "service-delta-years", years: "+3" },
      benefit: makeBenefit(123250, "independent-calculation"),
      residualDelta: makeMoney(0),
      supportClass: "supported",
      evidenceFor: ["Plan §3.2: three further years of credited service are documented."],
    });
    const record = reconcileParticipant({
      participantKey: "Harborview",
      inputs: exactInputs(123250, 106750),
      config: CONFIG,
      hypothesisCandidates: [
        { result: explains, documentedMechanism: true, resolvesCohort: true, material: true },
      ],
    });
    assert.equal(record.recommendedDisposition, "requires-investigation");
    assert.match(record.dispositionBasis, /reconstruction must be re-run/);
  });
});

// ---------------------------------------------------------------------------
// Hypothesis evaluation entry point (§2.6): evidence beats proximity
// ---------------------------------------------------------------------------

describe("evaluateAndRankHypotheses — evidence beats proximity (§2.6)", () => {
  it("a closer-but-unsupported hypothesis ranks below a farther-but-supported one", () => {
    const closerUnproved = makeResult({
      hypothesisCode: "H2",
      operation: { kind: "service-delta-years", years: "+1" },
      benefit: makeBenefit(85000, "independent-calculation"),
      residualDelta: makeMoney(0), // exact numerical match — no document behind it
      supportClass: "supported",
      evidenceFor: [],
    });
    const fartherSupported = makeResult({
      hypothesisCode: "H12",
      operation: { kind: "vesting", mode: "applied-once" },
      benefit: makeBenefit(84500, "independent-calculation"),
      residualDelta: makeMoney(500), // $5.00 residual — documented in the plan
      supportClass: "supported",
      evidenceFor: ["Plan §7.1: the vesting percentage was already applied by the administrator."],
    });
    const candidates: HypothesisEvaluationInput[] = [
      { result: closerUnproved, documentedMechanism: false, resolvesCohort: false, material: true },
      { result: fartherSupported, documentedMechanism: true, resolvesCohort: true, material: true },
    ];
    const ranked = evaluateAndRankHypotheses({
      inputs: exactInputs(85000, 84950),
      candidates,
      config: CONFIG,
    });
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0]?.hypothesisCode, "H12");
    assert.equal(ranked[0]?.supportClass, "supported");
    assert.equal(ranked[1]?.hypothesisCode, "H2");
    // The exact match with no document support is corrected to Coincidence.
    assert.equal(ranked[1]?.supportClass, "coincidence");
    assert.equal(ranked[1]?.claimedSupportClass, "supported");
    assert.match(ranked[1]?.evaluationNote ?? "", /coincidence/i);
  });

  it("residualWithinTolerance: a residual inside tolerance resolves the participant; an unevaluated counterfactual returns null", () => {
    const resolves = makeResult({
      benefit: makeBenefit(99950, "independent-calculation"),
      residualDelta: makeMoney(50),
    });
    assert.equal(residualWithinTolerance(resolves, TOLERANCE, CONFIG.epsilonRMinor), true);
    const doesNot = makeResult({
      benefit: makeBenefit(90000, "independent-calculation"),
      residualDelta: makeMoney(10000),
    });
    assert.equal(residualWithinTolerance(doesNot, TOLERANCE, CONFIG.epsilonRMinor), false);
    const unevaluated = makeResult({ benefit: null, residualDelta: null });
    assert.equal(residualWithinTolerance(unevaluated, TOLERANCE, CONFIG.epsilonRMinor), null);
  });

  it("the input candidates are not mutated by evaluation and ranking", () => {
    const candidate: HypothesisEvaluationInput = {
      result: makeResult({ supportClass: "supported" }),
      documentedMechanism: false,
      resolvesCohort: false,
      material: true,
    };
    const before = JSON.stringify(candidate);
    evaluateAndRankHypotheses({ inputs: exactInputs(85000, 84950), candidates: [candidate], config: CONFIG });
    assert.equal(JSON.stringify(candidate), before);
    assert.equal(candidate.result.supportClass, "supported");
  });
});

// ---------------------------------------------------------------------------
// Rounding as a diagnostic (§2.7): the mandatory anti-coincidence rule
// ---------------------------------------------------------------------------

describe("rounding diagnostic — anti-coincidence rule (§2.7)", () => {
  const roundingOp: CounterfactualOperation = {
    kind: "rounding-sequence",
    sequence: { sequenceId: "seq-dollar", rules: [] },
  };

  function roundingCandidate(overrides: Partial<CounterfactualResult> = {}): CounterfactualResult {
    return makeCounterfactualResult({
      operation: roundingOp,
      hypothesisCode: "H15",
      benefit: makeBenefit(85000, "independent-calculation"),
      residualDelta: makeMoney(0),
      supportClass: "supported",
      evidenceFor: [],
      evidenceAgainst: [],
      ...overrides,
    });
  }

  it("an arbitrary rounding match is Coincidence, never Supported", () => {
    const ranked = evaluateAndRankHypotheses({
      inputs: exactInputs(85000, 84950),
      candidates: [
        {
          result: roundingCandidate(),
          documentedMechanism: false,
          resolvesCohort: false,
          material: true,
          roundingEvidence: {
            sequenceDocumented: false,
            sequenceSource: "not-documented",
            maxPlausibleEffectMinor: 100,
          },
        },
      ],
      config: CONFIG,
    });
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0]?.supportClass, "coincidence");
    assert.match(ranked[0]?.evaluationNote ?? "", /anti-coincidence/i);
  });

  it("the plan's documented rounding rule, matching within tolerance, is Supported", () => {
    const ranked = evaluateAndRankHypotheses({
      inputs: exactInputs(85000, 84950),
      candidates: [
        {
          result: roundingCandidate(),
          documentedMechanism: true,
          resolvesCohort: false,
          material: true,
          roundingEvidence: {
            sequenceDocumented: true,
            sequenceSource: "Plan §5.03: final monthly benefit rounded to the nearest dollar.",
            maxPlausibleEffectMinor: 100,
          },
        },
      ],
      config: CONFIG,
    });
    assert.equal(ranked[0]?.supportClass, "supported");
    assert.match(ranked[0]?.evaluationNote ?? "", /documented rule/);
  });

  it("a residual larger than the maximum plausible rounding effect is Refuted", () => {
    const result = evaluateRoundingHypothesis({
      result: roundingCandidate({
        benefit: makeBenefit(80000, "independent-calculation"),
        residualDelta: makeMoney(5000),
      }),
      claimedSupportClass: "supported",
      evidence: {
        sequenceDocumented: true,
        sequenceSource: "Plan §5.03: final monthly benefit rounded to the nearest dollar.",
        maxPlausibleEffectMinor: 100,
      },
      resolvesCohort: false,
      resolvesParticipant: false,
    });
    assert.equal(result.supportClass, "refuted");
    assert.match(result.reason, /exceeds the maximum plausible rounding effect/);
  });

  it("a documented rounding sequence that does not resolve the discrepancy is Refuted", () => {
    const result = evaluateRoundingHypothesis({
      result: roundingCandidate({
        benefit: makeBenefit(80000, "independent-calculation"),
        residualDelta: makeMoney(5000),
      }),
      claimedSupportClass: "supported",
      evidence: {
        sequenceDocumented: true,
        sequenceSource: "Plan §5.03: final monthly benefit rounded to the nearest dollar.",
        maxPlausibleEffectMinor: 10000,
      },
      resolvesCohort: false,
      resolvesParticipant: false,
    });
    assert.equal(result.supportClass, "refuted");
    assert.match(result.reason, /does not explain the discrepancy/);
  });

  it("no rounding evidence supplied: a Supported claim cannot stand", () => {
    const ranked = evaluateAndRankHypotheses({
      inputs: exactInputs(85000, 84950),
      candidates: [
        {
          result: roundingCandidate(),
          documentedMechanism: false,
          resolvesCohort: false,
          material: true,
          // No roundingEvidence at all.
        },
      ],
      config: CONFIG,
    });
    assert.equal(ranked[0]?.supportClass, "coincidence");
    assert.match(ranked[0]?.evaluationNote ?? "", /No rounding diagnostic evidence was supplied/);
  });
});

// ---------------------------------------------------------------------------
// Stage 1 table A-101–A-104 (Stage 7 Accuracy G-ACC-6) — the Stage 1
// reconciliation worked examples, reproduced by name alongside A-105.
// Source: stage1/03-reconciliation-statistical-methodology.md:260-266.
// ---------------------------------------------------------------------------

describe("Stage 1 table A-101–A-104 (Stage 7 G-ACC-6)", () => {
  it("A-101: $1,240.00 recorded vs $1,238.50 reconstructed — Δ +$1.50, R +0.12%", () => {
    const discrepancy = discrepancyFromAmounts(124000, 123850, CONFIG.epsilonRMinor);
    assert.equal(discrepancy.comparable, true);
    if (!discrepancy.comparable) return;
    assert.equal(discrepancy.delta.amountMinor, 150);
    assert.equal(discrepancy.absDelta.amountMinor, 150);
    assert.equal(discrepancy.relative.kind, "defined");
    if (discrepancy.relative.kind !== "defined") return;
    assert.equal(decCompare(discrepancy.relative.value, "0.0012"), 1);
    assert.equal(decCompare(discrepancy.relative.value, "0.0013"), -1);
    assert.equal(discrepancy.denominatorFlag, null);
  });

  it("A-102: $860.00 vs $860.00 — Δ $0.00, R 0", () => {
    const discrepancy = discrepancyFromAmounts(86000, 86000, CONFIG.epsilonRMinor);
    assert.equal(discrepancy.comparable, true);
    if (!discrepancy.comparable) return;
    assert.equal(discrepancy.delta.amountMinor, 0);
    assert.equal(discrepancy.absDelta.amountMinor, 0);
    assert.deepEqual(discrepancy.relative, { kind: "defined", value: "0" });
    assert.equal(discrepancy.denominatorFlag, null);
  });

  it("A-103: $2,150.00 vs $1,930.00 — Δ +$220.00, R +11.40%", () => {
    const discrepancy = discrepancyFromAmounts(215000, 193000, CONFIG.epsilonRMinor);
    assert.equal(discrepancy.comparable, true);
    if (!discrepancy.comparable) return;
    assert.equal(discrepancy.delta.amountMinor, 22000);
    assert.equal(discrepancy.absDelta.amountMinor, 22000);
    assert.equal(discrepancy.relative.kind, "defined");
    if (discrepancy.relative.kind !== "defined") return;
    assert.equal(decCompare(discrepancy.relative.value, "0.1139"), 1);
    assert.equal(decCompare(discrepancy.relative.value, "0.1141"), -1);
    assert.equal(discrepancy.denominatorFlag, null);
  });

  it("A-104: $0.00 recorded vs $412.75 reconstructed — Δ −$412.75, R −100%, flag PA_ZERO", () => {
    const discrepancy = discrepancyFromAmounts(0, 41275, CONFIG.epsilonRMinor);
    assert.equal(discrepancy.comparable, true);
    if (!discrepancy.comparable) return;
    assert.equal(discrepancy.delta.amountMinor, -41275);
    assert.equal(discrepancy.absDelta.amountMinor, 41275);
    assert.deepEqual(discrepancy.relative, { kind: "defined", value: "-1" });
    assert.equal(discrepancy.denominatorFlag, "PA_ZERO");
  });
});
