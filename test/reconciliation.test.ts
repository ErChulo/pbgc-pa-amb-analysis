/**
 * Unit tests for src/reconciliation.ts — the reconciliation-inputs module
 * (Stage 10's handoff: build ReconciliationInputs from a CalculationOutcome,
 * counterfactual application, the H1–H17 catalogue, ranking by evidence).
 *
 * Run with plain node + node:test (no test framework dependency):
 *   npm test            (builds with tsc, then runs node --test dist/test/)
 *
 * This module emits comparison inputs ONLY: it computes no Δ/D/R and runs
 * no tolerance test (those belong to the Stage 5 reconciliation module).
 * Synthetic data only. No live case data. Worked examples are the fictional
 * participants SYN-V-01 (Verified) and SYN-I-01 (Indeterminate) from
 * Stage 2 output 05, §8.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildReconciliationInputs,
  describeCounterfactualOperation,
  describeRecordedPosition,
  findConflictingCorrections,
  hypothesesForOperationKind,
  hypothesisCatalogueEntry,
  makeCounterfactualResult,
  rankCounterfactuals,
  validateCounterfactualSupport,
  HYPOTHESIS_CATALOGUE,
} from "../src/reconciliation.js";
import type { RankableCounterfactual } from "../src/reconciliation.js";
import { makeMoney } from "../src/decimal.js";
import type {
  BoundsResult,
  CalculationOutcome,
  CounterfactualResult,
  ToleranceRecord,
  TypedBenefitQuantity,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TOLERANCE: ToleranceRecord = {
  version: 1,
  absoluteMinor: 500,
  relativeDecimal: "0.01",
  application: "either",
  authority:
    "Actuary-set per case; screening values borrowed from Policy 5.8-1 Benefit Corrections, labelled as such — that policy governs correction of issued benefit determinations, not acceptance of PA_AMB.",
  approvedBy: "A. Actuary",
  approvedDate: "2026-11-12",
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

function makeBoundsResult(
  recordedPosition: BoundsResult["recordedPosition"],
): BoundsResult {
  const minBenefit = makeBenefit(165000, "bound");
  const maxBenefit = makeBenefit(171600, "bound");
  return {
    min: makeMoney(165000),
    max: makeMoney(171600),
    assumptions: [
      "Missing compensation year bounded by the lowest known monthly compensation and the §401(a)(17) cap in effect, expressed monthly.",
    ],
    derivation: {
      method: "endpoint-plus-kinks",
      kinkPoints: [{ description: "§401(a)(17) cap in effect", value: "5400" }],
      monotonicity: [
        { input: "missing compensation year", monotone: true, verifiedBy: "formula structure" },
      ],
      feasibleRegion: "Missing year in [$4,800, $5,400] monthly.",
    },
    widthAttribution: [
      {
        missingInput: "compensation year",
        missingClass: "c",
        widthContribution: makeMoney(6600),
        widthShare: "1",
        couldChangeDisposition: false,
      },
    ],
    scenarios: [
      { name: "missing year at lower bound", assumptions: "missing year $4,800", benefit: makeMoney(165000), planVersionId: null, formulaId: null },
      { name: "missing year at upper bound", assumptions: "missing year $5,400", benefit: makeMoney(171600), planVersionId: null, formulaId: null },
    ],
    recordedPosition,
    minBenefit,
    maxBenefit,
  };
}

function makeCounterfactual(
  overrides: Partial<RankableCounterfactual> = {},
): RankableCounterfactual {
  const base: RankableCounterfactual = {
    operation: { kind: "service-delta-years", years: "+1" },
    hypothesisCode: "H2",
    benefit: makeBenefit(86000, "independent-calculation"),
    residualDelta: makeMoney(1000),
    supportClass: "supported",
    evidenceFor: ["Plan §3.2: credited service includes the disputed year."],
    evidenceAgainst: [],
    documentedMechanism: true,
    resolvesCohort: true,
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// buildReconciliationInputs (04 §6.1, rules C-1–C-4)
// ---------------------------------------------------------------------------

describe("buildReconciliationInputs (04 §6.1)", () => {
  it("exact outcome: reconstructed is set, bounds null, recorded carried through", () => {
    const outcome: CalculationOutcome = {
      kind: "exact",
      benefit: makeBenefit(84950, "independent-calculation"),
      trace: [],
    };
    const inputs = buildReconciliationInputs({
      outcome,
      recorded: makeBenefit(85000, "prior-administrator"),
      toleranceApplied: TOLERANCE,
      comparisonBasis: "same-basis",
    });
    assert.equal(inputs.reconstructed?.amount?.amountMinor, 84950);
    assert.equal(inputs.recorded?.amount?.amountMinor, 85000);
    assert.equal(inputs.bounds, null);
    assert.equal(inputs.comparisonBasis, "same-basis");
    assert.equal(inputs.basisConversion, null);
    assert.deepEqual(inputs.counterfactuals, []);
    assert.equal(inputs.toleranceApplied, TOLERANCE);
    // No Δ/D/R is computed here: the inputs carry no delta field at all.
    assert.equal("delta" in inputs, false);
    assert.equal("absDelta" in inputs, false);
    assert.equal("relDelta" in inputs, false);
  });

  it("bounds outcome: reconstructed null, bounds set, recorded-position test applies", () => {
    const outcome: CalculationOutcome = {
      kind: "bounds",
      bounds: makeBoundsResult("inside"),
      trace: [],
    };
    const inputs = buildReconciliationInputs({
      outcome,
      recorded: makeBenefit(168000, "prior-administrator"),
      toleranceApplied: TOLERANCE,
      comparisonBasis: "same-basis",
    });
    assert.equal(inputs.reconstructed, null);
    assert.equal(inputs.bounds?.min.amountMinor, 165000);
    assert.equal(inputs.bounds?.max.amountMinor, 171600);
    assert.equal(inputs.bounds?.recordedPosition, "inside");
    assert.equal(inputs.recorded?.amount?.amountMinor, 168000);
  });

  it("indeterminate outcome: neither reconstructed nor bounds; routed to missing-data reporting", () => {
    const outcome: CalculationOutcome = {
      kind: "indeterminate",
      reason: {
        code: "unresolved-comparison-basis",
        detail: "DOTE is blank; no measurement date can be established.",
        missingInputs: ["DOTE"],
        wouldResolve: ["PA benefit schedule stating the measurement date"],
      },
      trace: [],
    };
    const inputs = buildReconciliationInputs({
      outcome,
      recorded: makeBenefit(112000, "prior-administrator"),
      toleranceApplied: TOLERANCE,
      comparisonBasis: "unresolved",
    });
    assert.equal(inputs.reconstructed, null);
    assert.equal(inputs.bounds, null);
    assert.equal(inputs.comparisonBasis, "unresolved");
    assert.equal(inputs.recorded?.amount?.amountMinor, 112000);
  });

  it("a recorded blank yields recorded null — blank is missing, never zero (C-2)", () => {
    const outcome: CalculationOutcome = {
      kind: "exact",
      benefit: makeBenefit(84950, "independent-calculation"),
      trace: [],
    };
    const inputs = buildReconciliationInputs({
      outcome,
      recorded: null,
      toleranceApplied: TOLERANCE,
      comparisonBasis: "same-basis",
    });
    assert.equal(inputs.recorded, null);
  });

  it("a recorded zero is a value, flagged PA_ZERO — not treated as missing (C-2, 03 §2.3)", () => {
    const outcome: CalculationOutcome = {
      kind: "exact",
      benefit: makeBenefit(41275, "independent-calculation"),
      trace: [],
    };
    const inputs = buildReconciliationInputs({
      outcome,
      recorded: makeBenefit(0, "prior-administrator"),
      toleranceApplied: TOLERANCE,
      comparisonBasis: "same-basis",
      denominatorFlag: "PA_ZERO",
    });
    assert.equal(inputs.recorded?.amount?.amountMinor, 0);
    assert.equal(inputs.denominatorFlag, "PA_ZERO");
  });

  it("basis-converted requires the conversion to be stated; same-basis forbids one", () => {
    const outcome: CalculationOutcome = {
      kind: "exact",
      benefit: makeBenefit(84950, "independent-calculation"),
      trace: [],
    };
    const converted = buildReconciliationInputs({
      outcome,
      recorded: makeBenefit(85000, "prior-administrator"),
      toleranceApplied: TOLERANCE,
      comparisonBasis: "basis-converted",
      basisConversion: "annual-to-monthly ÷12",
    });
    assert.equal(converted.basisConversion, "annual-to-monthly ÷12");
    assert.throws(
      () =>
        buildReconciliationInputs({
          outcome,
          recorded: makeBenefit(85000, "prior-administrator"),
          toleranceApplied: TOLERANCE,
          comparisonBasis: "basis-converted",
        }),
      /no basisConversion is stated/,
    );
    assert.throws(
      () =>
        buildReconciliationInputs({
          outcome,
          recorded: makeBenefit(85000, "prior-administrator"),
          toleranceApplied: TOLERANCE,
          comparisonBasis: "same-basis",
          basisConversion: "annual-to-monthly ÷12",
        }),
      /a basisConversion is stated/,
    );
  });

  it("an exact or bounds outcome cannot rest on an unresolved basis", () => {
    const exact: CalculationOutcome = {
      kind: "exact",
      benefit: makeBenefit(84950, "independent-calculation"),
      trace: [],
    };
    assert.throws(
      () =>
        buildReconciliationInputs({
          outcome: exact,
          recorded: makeBenefit(85000, "prior-administrator"),
          toleranceApplied: TOLERANCE,
          comparisonBasis: "unresolved",
        }),
      /unresolved comparison basis/,
    );
    const bounds: CalculationOutcome = {
      kind: "bounds",
      bounds: makeBoundsResult("inside"),
      trace: [],
    };
    assert.throws(
      () =>
        buildReconciliationInputs({
          outcome: bounds,
          recorded: makeBenefit(168000, "prior-administrator"),
          toleranceApplied: TOLERANCE,
          comparisonBasis: "unresolved",
        }),
      /unresolved comparison basis/,
    );
  });

  it("describeRecordedPosition states the meaning of each position (03 §4.3 B-5)", () => {
    assert.equal(describeRecordedPosition(makeBoundsResult("inside")).position, "inside");
    assert.equal(/supports \(does not prove\) acceptance/.test(describeRecordedPosition(makeBoundsResult("inside")).meaning), true);
    assert.equal(/investigation required/.test(describeRecordedPosition(makeBoundsResult("below-min")).meaning), true);
    assert.equal(/investigation required/.test(describeRecordedPosition(makeBoundsResult("above-max")).meaning), true);
    assert.equal(/missing data, never zero/.test(describeRecordedPosition(makeBoundsResult("recorded-missing")).meaning), true);
  });
});

// ---------------------------------------------------------------------------
// Counterfactual results (04 §6.2)
// ---------------------------------------------------------------------------

describe("counterfactual results (04 §6.2)", () => {
  it("makeCounterfactualResult constructs a tested hypothesis", () => {
    const result = makeCounterfactualResult({
      operation: { kind: "service-delta-years", years: "+1" },
      hypothesisCode: "H2",
      benefit: makeBenefit(86000, "independent-calculation"),
      residualDelta: makeMoney(1000),
      supportClass: "supported",
      evidenceFor: ["Plan §3.2."],
      evidenceAgainst: [],
    });
    assert.equal(result.hypothesisCode, "H2");
    assert.equal(result.benefit?.amount?.amountMinor, 86000);
    assert.equal(result.residualDelta?.amountMinor, 1000);
    assert.equal(result.supportClass, "supported");
  });

  it("an unknown hypothesis code and an unevaluated counterfactual with a residual are refused", () => {
    assert.throws(
      () =>
        makeCounterfactualResult({
          operation: { kind: "service-delta-years", years: "+1" },
          hypothesisCode: "H99",
          benefit: null,
          residualDelta: null,
          supportClass: "refuted",
          evidenceFor: [],
          evidenceAgainst: [],
        }),
      /unknown hypothesis code/,
    );
    assert.throws(
      () =>
        makeCounterfactualResult({
          operation: { kind: "service-delta-years", years: "+1" },
          hypothesisCode: "H2",
          benefit: null,
          residualDelta: makeMoney(1000),
          supportClass: "refuted",
          evidenceFor: [],
          evidenceAgainst: [],
        }),
      /cannot carry a residual discrepancy/,
    );
  });

  it("describeCounterfactualOperation names exactly what changes, for every operation kind", () => {
    assert.equal(
      describeCounterfactualOperation({ kind: "service-delta-years", years: "-1" }),
      "credited service -1 years",
    );
    assert.equal(
      describeCounterfactualOperation({ kind: "averaging-period", period: "highest-5-year" }),
      'averaging period "highest-5-year"',
    );
    assert.equal(
      describeCounterfactualOperation({ kind: "formula-version", formulaId: "f-1989" }),
      'formula version "f-1989"',
    );
    assert.equal(
      describeCounterfactualOperation({ kind: "vesting", mode: "applied-twice-diagnostic" }),
      "vesting applied-twice-diagnostic",
    );
    assert.equal(
      describeCounterfactualOperation({
        kind: "rounding-sequence",
        sequence: { sequenceId: "round-1", rules: [] },
      }),
      'rounding sequence "round-1" (hypothesis only)',
    );
    assert.equal(
      describeCounterfactualOperation({ kind: "cap", cap: "service-cap", applied: false }),
      'cap "service-cap" not applied',
    );
    assert.equal(
      /diagnostic only; the freeze is binding/.test(
        describeCounterfactualOperation({ kind: "freeze", respected: false }),
      ),
      true,
    );
    assert.equal(
      describeCounterfactualOperation({ kind: "prior-distribution", deducted: true }),
      "prior distribution deducted",
    );
  });

  it("anti-coincidence rule: supported needs a document or cohort-wide resolution, else coincidence", () => {
    const supported = makeCounterfactualResult({
      operation: {
        kind: "rounding-sequence",
        sequence: { sequenceId: "round-1", rules: [] },
      },
      hypothesisCode: "H15",
      benefit: makeBenefit(85000, "independent-calculation"),
      residualDelta: makeMoney(0),
      supportClass: "supported",
      evidenceFor: [],
      evidenceAgainst: [],
    });
    // Documented in the plan: admissible.
    const documented = validateCounterfactualSupport(supported, {
      documentedMechanism: true,
      resolvesCohort: false,
    });
    assert.equal(documented.admissible, true);
    assert.equal(documented.correctedSupportClass, "supported");
    // Same sequence resolves the cohort: admissible.
    const cohort = validateCounterfactualSupport(supported, {
      documentedMechanism: false,
      resolvesCohort: true,
    });
    assert.equal(cohort.admissible, true);
    assert.equal(cohort.correctedSupportClass, "supported");
    // Neither: corrected to coincidence, never presented as an explanation.
    const coincidence = validateCounterfactualSupport(supported, {
      documentedMechanism: false,
      resolvesCohort: false,
    });
    assert.equal(coincidence.admissible, false);
    assert.equal(coincidence.correctedSupportClass, "coincidence");
    assert.equal(/never proof/.test(coincidence.reason), true);
    // Other classes stand as labelled.
    const plausible = makeCounterfactualResult({
      operation: { kind: "service-delta-years", years: "+1" },
      hypothesisCode: "H2",
      benefit: makeBenefit(86000, "independent-calculation"),
      residualDelta: makeMoney(1000),
      supportClass: "plausible",
      evidenceFor: [],
      evidenceAgainst: [],
    });
    const checked = validateCounterfactualSupport(plausible, {
      documentedMechanism: false,
      resolvesCohort: false,
    });
    assert.equal(checked.admissible, true);
    assert.equal(checked.correctedSupportClass, "plausible");
  });

  it("cohort-wide resolution promotes Plausible to Supported (Stage 7 G-ACC-4)", () => {
    // testCounterfactual labels an undocumented mechanism Plausible at
    // best; cohort resolution is the evidence the anti-coincidence rule
    // accepts (§2.6), so the promotion happens here, where the cohort
    // fact is known — the rounding diagnostic already promotes on the
    // same facts (evaluateRoundingHypothesis).
    const reproduced = makeCounterfactualResult({
      operation: { kind: "service-delta-years", years: "+1" },
      hypothesisCode: "H2",
      benefit: makeBenefit(100000, "independent-calculation"),
      residualDelta: makeMoney(0),
      supportClass: "plausible",
      evidenceFor: ["the counterfactual benefit equals the recorded PA_AMB"],
      evidenceAgainst: [],
    });
    const promoted = validateCounterfactualSupport(reproduced, {
      documentedMechanism: false,
      resolvesCohort: true,
    });
    assert.equal(promoted.admissible, true);
    assert.equal(promoted.correctedSupportClass, "supported");
    assert.match(promoted.reason, /resolves discrepancies across the cohort/);
    // Same numbers, no cohort resolution: stays Plausible.
    const notPromoted = validateCounterfactualSupport(reproduced, {
      documentedMechanism: false,
      resolvesCohort: false,
    });
    assert.equal(notPromoted.correctedSupportClass, "plausible");
    // Non-zero residual, cohort resolution or not: never promoted —
    // the counterfactual does not reproduce the recorded amount.
    const residual = makeCounterfactualResult({
      operation: { kind: "service-delta-years", years: "+1" },
      hypothesisCode: "H2",
      benefit: makeBenefit(99000, "independent-calculation"),
      residualDelta: makeMoney(1000),
      supportClass: "plausible",
      evidenceFor: [],
      evidenceAgainst: [],
    });
    const stillPlausible = validateCounterfactualSupport(residual, {
      documentedMechanism: false,
      resolvesCohort: true,
    });
    assert.equal(stillPlausible.correctedSupportClass, "plausible");
  });
});

// ---------------------------------------------------------------------------
// Hypothesis catalogue and ranking (03 §2.5–§2.6)
// ---------------------------------------------------------------------------

describe("hypothesis catalogue and ranking (03 §2.5–§2.6)", () => {
  it("the catalogue carries H1–H17, each with its check and its counterfactual kinds", () => {
    assert.equal(HYPOTHESIS_CATALOGUE.length, 17);
    for (let n = 1; n <= 17; n += 1) {
      const entry = hypothesisCatalogueEntry(`H${n}`);
      assert.equal(entry === null, false);
      assert.equal(entry?.code, `H${n}`);
      assert.equal((entry?.title.length ?? 0) > 0, true);
      assert.equal((entry?.whatToCheck.length ?? 0) > 0, true);
    }
    assert.equal(hypothesisCatalogueEntry("H99"), null);
    assert.equal(hypothesisCatalogueEntry("H15")?.title, "Rounding at different stages");
    assert.deepEqual(hypothesesForOperationKind("service-delta-years"), ["H2"]);
    assert.deepEqual(hypothesesForOperationKind("rounding-sequence"), ["H15"]);
    assert.deepEqual(hypothesesForOperationKind("averaging-period"), ["H4"]);
    assert.deepEqual(hypothesesForOperationKind("vesting"), ["H12"]);
  });

  it("ranking is by evidence, not numerical proximity: a coincidence with a tiny residual ranks below a supported hypothesis with a large one", () => {
    const coincidenceTinyResidual = makeCounterfactual({
      operation: { kind: "rounding-sequence", sequence: { sequenceId: "round-x", rules: [] } },
      hypothesisCode: "H15",
      benefit: makeBenefit(85010, "independent-calculation"),
      residualDelta: makeMoney(10),
      supportClass: "coincidence",
      evidenceFor: [],
      documentedMechanism: false,
      resolvesCohort: false,
    });
    const supportedLargeResidual = makeCounterfactual({
      operation: { kind: "service-delta-years", years: "+1" },
      hypothesisCode: "H2",
      benefit: makeBenefit(90000, "independent-calculation"),
      residualDelta: makeMoney(5000),
      supportClass: "supported",
      evidenceFor: ["Plan §3.2."],
      documentedMechanism: true,
      resolvesCohort: true,
    });
    const ranked = rankCounterfactuals([coincidenceTinyResidual, supportedLargeResidual]);
    assert.equal(ranked[0]?.hypothesisCode, "H2");
    assert.equal(ranked[1]?.hypothesisCode, "H15");
  });

  it("ranking order: documented first, cohort-wide second, support class third, residual only as tie-breaker", () => {
    const plausibleDocumented = makeCounterfactual({
      hypothesisCode: "H4",
      operation: { kind: "averaging-period", period: "highest-5-year" },
      supportClass: "plausible",
      residualDelta: makeMoney(2000),
      documentedMechanism: true,
      resolvesCohort: false,
    });
    const supportedUndocumented = makeCounterfactual({
      hypothesisCode: "H2",
      supportClass: "supported",
      residualDelta: makeMoney(100),
      documentedMechanism: false,
      resolvesCohort: true,
    });
    const refuted = makeCounterfactual({
      hypothesisCode: "H12",
      operation: { kind: "vesting", mode: "not-applied" },
      supportClass: "refuted",
      residualDelta: makeMoney(0),
      documentedMechanism: false,
      resolvesCohort: false,
    });
    const ranked = rankCounterfactuals([refuted, supportedUndocumented, plausibleDocumented]);
    // Document support outranks support class: the documented plausible
    // hypothesis ranks above the undocumented supported one.
    assert.deepEqual(
      ranked.map((result) => result.hypothesisCode),
      ["H4", "H2", "H12"],
    );
  });

  it("a refuted hypothesis never outranks a live one by documentation alone (Stage 5 decision)", () => {
    // The dangerous case: the true cause is Supported but its mechanism
    // is undocumented (admitted via cohort resolution alone), while a
    // ruled-out alternative is documented and cohort-resolving on the
    // numbers. Document support (factor 1) would rank the refuted one
    // first — so refuted sorts last before any other factor.
    const refutedDocumented = makeCounterfactual({
      hypothesisCode: "H12",
      operation: { kind: "vesting", mode: "not-applied" },
      supportClass: "refuted",
      residualDelta: makeMoney(0),
      documentedMechanism: true,
      resolvesCohort: true,
    });
    const supportedUndocumented = makeCounterfactual({
      hypothesisCode: "H2",
      supportClass: "supported",
      residualDelta: makeMoney(100),
      documentedMechanism: false,
      resolvesCohort: true,
    });
    const plausibleDocumented = makeCounterfactual({
      hypothesisCode: "H4",
      operation: { kind: "averaging-period", period: "highest-5-year" },
      supportClass: "plausible",
      residualDelta: makeMoney(2000),
      documentedMechanism: true,
      resolvesCohort: false,
    });
    const ranked = rankCounterfactuals([refutedDocumented, supportedUndocumented, plausibleDocumented]);
    assert.deepEqual(
      ranked.map((result) => result.hypothesisCode),
      ["H4", "H2", "H12"],
    );
  });

  it("ranking does not mutate its input and breaks ties deterministically", () => {
    const a = makeCounterfactual({ hypothesisCode: "H2", residualDelta: makeMoney(100) });
    const b = makeCounterfactual({
      hypothesisCode: "H4",
      operation: { kind: "averaging-period", period: "highest-5-year" },
      residualDelta: makeMoney(100),
    });
    const input = [b, a];
    const ranked = rankCounterfactuals(input);
    assert.deepEqual(
      ranked.map((result) => result.hypothesisCode),
      ["H2", "H4"],
    );
    assert.deepEqual(
      input.map((result) => result.hypothesisCode),
      ["H4", "H2"],
    );
  });

  it("multiple-hypothesis rule: two supported hypotheses implying different corrected benefits conflict", () => {
    const h2 = makeCounterfactualResult({
      operation: { kind: "service-delta-years", years: "+1" },
      hypothesisCode: "H2",
      benefit: makeBenefit(86000, "independent-calculation"),
      residualDelta: makeMoney(0),
      supportClass: "supported",
      evidenceFor: ["Plan §3.2."],
      evidenceAgainst: [],
    });
    const h4 = makeCounterfactualResult({
      operation: { kind: "averaging-period", period: "highest-5-year" },
      hypothesisCode: "H4",
      benefit: makeBenefit(87500, "independent-calculation"),
      residualDelta: makeMoney(0),
      supportClass: "supported",
      evidenceFor: ["Valuation report p. 9."],
      evidenceAgainst: [],
    });
    const conflict = findConflictingCorrections([h2, h4]);
    assert.equal(conflict.conflict, true);
    if (conflict.conflict !== true) throw new Error("expected conflict");
    assert.deepEqual(conflict.correctedBenefitsCents, [86000, 87500]);
    assert.deepEqual(conflict.hypothesisCodes, ["H2", "H4"]);

    // Same corrected benefit: no conflict — the hypotheses agree.
    const h4Same = makeCounterfactualResult({
      operation: { kind: "averaging-period", period: "highest-5-year" },
      hypothesisCode: "H4",
      benefit: makeBenefit(86000, "independent-calculation"),
      residualDelta: makeMoney(0),
      supportClass: "supported",
      evidenceFor: ["Valuation report p. 9."],
      evidenceAgainst: [],
    });
    assert.deepEqual(findConflictingCorrections([h2, h4Same]), { conflict: false });
    // A merely plausible second hypothesis does not conflict.
    const h4Plausible = makeCounterfactualResult({
      operation: { kind: "averaging-period", period: "highest-5-year" },
      hypothesisCode: "H4",
      benefit: makeBenefit(87500, "independent-calculation"),
      residualDelta: makeMoney(0),
      supportClass: "plausible",
      evidenceFor: [],
      evidenceAgainst: [],
    });
    assert.deepEqual(findConflictingCorrections([h2, h4Plausible]), { conflict: false });
  });
});

// ---------------------------------------------------------------------------
// Worked examples (05 §8) — comparison inputs only
// ---------------------------------------------------------------------------

describe("worked examples (05 §8) — comparison inputs", () => {
  it("SYN-V-01: exact inputs carry reconstructed $849.50 and recorded $850.00 (Δ itself is Stage 5)", () => {
    const outcome: CalculationOutcome = {
      kind: "exact",
      benefit: makeBenefit(84950, "independent-calculation"),
      trace: [],
    };
    const inputs = buildReconciliationInputs({
      outcome,
      recorded: makeBenefit(85000, "prior-administrator"),
      toleranceApplied: TOLERANCE,
      comparisonBasis: "same-basis",
    });
    assert.equal(inputs.reconstructed?.amount?.amountMinor, 84950);
    assert.equal(inputs.recorded?.amount?.amountMinor, 85000);
    // The $0.50 difference is explained by the documented rounding
    // sequence (H15, supported): the rounding counterfactual carries the
    // recomputed benefit and its support label into the inputs.
    const rounding = makeCounterfactualResult({
      operation: {
        kind: "rounding-sequence",
        sequence: { sequenceId: "plan-7.3-final-dollar", rules: [] },
      },
      hypothesisCode: "H15",
      benefit: makeBenefit(85000, "independent-calculation"),
      residualDelta: makeMoney(0),
      supportClass: "supported",
      evidenceFor: ["Synthetic Plan A §7.3: final monthly benefit rounded to the nearest dollar."],
      evidenceAgainst: [],
    });
    const support = validateCounterfactualSupport(rounding, {
      documentedMechanism: true,
      resolvesCohort: true,
    });
    assert.equal(support.admissible, true);
    assert.equal(support.correctedSupportClass, "supported");
    const withCounterfactuals = { ...inputs, counterfactuals: [rounding] };
    assert.equal(withCounterfactuals.counterfactuals[0]?.hypothesisCode, "H15");
  });

  it("SYN-I-01: indeterminate inputs carry neither a benefit nor bounds; the basis is unresolved", () => {
    const outcome: CalculationOutcome = {
      kind: "indeterminate",
      reason: {
        code: "unresolved-comparison-basis",
        detail: "DOTE is blank; the PA extract states no date its amounts were calculated through.",
        missingInputs: ["DOTE", "PA benefit schedule", "plan document for the era"],
        wouldResolve: ["PA benefit schedule", "plan document / amendment with effective date"],
      },
      trace: [],
    };
    const inputs = buildReconciliationInputs({
      outcome,
      recorded: makeBenefit(112000, "prior-administrator"),
      toleranceApplied: TOLERANCE,
      comparisonBasis: "unresolved",
    });
    assert.equal(inputs.reconstructed, null);
    assert.equal(inputs.bounds, null);
    assert.equal(inputs.comparisonBasis, "unresolved");
    // The recorded $1,120.00 is carried as the recorded amount; whether
    // it sits outside the per-scenario ranges is a Stage 5 reading of
    // the scenario bounds, not a Δ — no Δ exists on an unresolved basis.
    assert.equal(inputs.recorded?.amount?.amountMinor, 112000);
  });
});
