/**
 * Unit tests for the Stage 5 missing-data framework (src/missingdata.ts):
 * the five-way split M1–M5 (§4.1), MCAR/MAR/MNAR classification,
 * blanks-never-zero (§4.2), mathematically justified bounds (§4.3,
 * rules B-1–B-5) wired to src/bounds.ts, bounds-are-not-confidence-
 * intervals (B-2), scenario / sensitivity analysis in decision terms
 * (§4.4), per-input uncertainty attribution (§4.5), and data-request
 * prioritisation by expected decision effect (§4.6).
 *
 * Run with plain node + node:test (no test framework dependency).
 * Synthetic data only. Fictional participants only. No live case data.
 * Money is integer minor units (cents).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attributeUncertainty,
  blankInput,
  blankPaAmb,
  boundWidthIsImmaterial,
  classifyMissingInput,
  classifyMissingness,
  detectConfidenceIntervalRelabel,
  evaluateScenarioSensitivity,
  missingClassCode,
  missingClassLabel,
  normalisedWidthAllocation,
  allocationSumsToTotal,
  prioritiseDataRequests,
  recordedBoundsPosition,
  refuseConfidenceIntervalAsBounds,
  refuseZeroFill,
  rankSensitivity,
  validateBoundsJustification,
  verifyBoundsMonotonicity,
  type CandidateBounds,
  type DataRequestCandidate,
} from "../src/missingdata.js";
import type { MissingDataClass } from "../src/types.js";

// ---------------------------------------------------------------------------
// 1. The five-way split M1–M5 (§4.1)
// ---------------------------------------------------------------------------

describe("five-way split M1–M5", () => {
  it("each class is reachable with a synthetic case", () => {
    const m1 = classifyMissingInput({
      field: "CompensationHistory.salaryYear 2019",
      recoverableSource: null,
      feasibleRange: null,
      loadBearingUnconstrained: false,
      assumptionAvailable: null,
    });
    assert.equal(m1.item.missingClass, "a");
    assert.equal(missingClassLabel(m1.item.missingClass), "M1");

    const m2 = classifyMissingInput({
      field: "CompensationHistory.salaryYear 2019",
      recoverableSource: "Prior valuation report, Appendix B, p. 12",
      feasibleRange: null,
      loadBearingUnconstrained: false,
      assumptionAvailable: null,
    });
    assert.equal(m2.item.missingClass, "b");
    assert.equal(missingClassLabel(m2.item.missingClass), "M2");
    assert.equal(m2.item.resolvesBy, "Prior valuation report, Appendix B, p. 12");

    const m3 = classifyMissingInput({
      field: "CompensationHistory.salaryYear 2019",
      recoverableSource: null,
      feasibleRange: { low: "4800", high: "5400", unit: "USD/month", basis: "adjacent known years and the §401(a)(17) cap in effect" },
      loadBearingUnconstrained: false,
      assumptionAvailable: null,
    });
    assert.equal(m3.item.missingClass, "c");
    assert.equal(missingClassLabel(m3.item.missingClass), "M3");

    const m4 = classifyMissingInput({
      field: "CompensationHistory.salaryYear 2019",
      recoverableSource: null,
      feasibleRange: null,
      loadBearingUnconstrained: false,
      assumptionAvailable: "salary growth 3% per year (reviewer judgment, stated)",
    });
    assert.equal(m4.item.missingClass, "d");
    assert.equal(missingClassLabel(m4.item.missingClass), "M4");

    const m5 = classifyMissingInput({
      field: "Formula.governingFormula",
      recoverableSource: null,
      feasibleRange: null,
      loadBearingUnconstrained: true,
      assumptionAvailable: "assume the 1994 formula applies (unstated guess)",
    });
    assert.equal(m5.item.missingClass, "e");
    assert.equal(missingClassLabel(m5.item.missingClass), "M5");
  });

  it("precedence: recoverable beats boundable; boundable beats load-bearing; an assumption never rescues a load-bearing unknown", () => {
    const recoverableAndBoundable = classifyMissingInput({
      field: "CompensationHistory.salaryYear 2019",
      recoverableSource: "Payroll file",
      feasibleRange: { low: "4800", high: "5400", unit: "USD/month", basis: "adjacent years" },
      loadBearingUnconstrained: false,
      assumptionAvailable: null,
    });
    assert.equal(recoverableAndBoundable.item.missingClass, "b");

    const boundableAndLoadBearing = classifyMissingInput({
      field: "CompensationHistory.salaryYear 2019",
      recoverableSource: null,
      feasibleRange: { low: "4800", high: "5400", unit: "USD/month", basis: "adjacent years" },
      loadBearingUnconstrained: true,
      assumptionAvailable: null,
    });
    assert.equal(boundableAndLoadBearing.item.missingClass, "c");
  });

  it("label/code conversion is exact in both directions", () => {
    const codes: MissingDataClass[] = ["a", "b", "c", "d", "e"];
    const labels = ["M1", "M2", "M3", "M4", "M5"] as const;
    codes.forEach((code, i) => {
      assert.equal(missingClassLabel(code), labels[i]);
      assert.equal(missingClassCode(labels[i] as "M1" | "M2" | "M3" | "M4" | "M5"), code);
    });
  });

  it("every classified item carries a consequence and a rationale", () => {
    for (const args of [
      { field: "F1", recoverableSource: null, feasibleRange: null, loadBearingUnconstrained: false, assumptionAvailable: null },
      { field: "F2", recoverableSource: "Doc", feasibleRange: null, loadBearingUnconstrained: false, assumptionAvailable: null },
    ]) {
      const classified = classifyMissingInput(args);
      assert.ok(classified.item.consequence.length > 0);
      assert.ok(classified.rationale.length > 0);
      assert.equal(classified.item.field, args.field);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. MCAR / MAR / MNAR (§4.1)
// ---------------------------------------------------------------------------

describe("missingness mechanism MCAR / MAR / MNAR", () => {
  it("MCAR: Little's test passed and no dependence stated", () => {
    const result = classifyMissingness({
      field: "CompensationHistory.salaryYear 2019",
      littleMcarTestPassed: true,
      observedPredictorsOfMissingness: [],
      dependsOnMissingValueItself: null,
    });
    assert.equal(result.mechanism, "MCAR");
  });

  it("MAR: missingness depends on observed data only", () => {
    const result = classifyMissingness({
      field: "CompensationHistory.salaryYear 2019",
      littleMcarTestPassed: null,
      observedPredictorsOfMissingness: ["employment group", "amendment cohort"],
      dependsOnMissingValueItself: null,
    });
    assert.equal(result.mechanism, "MAR");
    assert.match(result.rationale, /never for an individual participant's benefit inputs/);
  });

  it("MNAR: missingness depends on the missing value itself — the most dangerous case", () => {
    const result = classifyMissingness({
      field: "PA_AMB",
      littleMcarTestPassed: true,
      observedPredictorsOfMissingness: [],
      dependsOnMissingValueItself: "benefits missing precisely because the administrator could not compute them",
    });
    assert.equal(result.mechanism, "MNAR");
    assert.match(result.rationale, /sensitivity analysis/);
  });

  it("a claimed MCAR is refused when observed predictors of missingness are named", () => {
    const result = classifyMissingness({
      field: "CompensationHistory.salaryYear 2019",
      littleMcarTestPassed: true,
      observedPredictorsOfMissingness: ["employment group"],
      dependsOnMissingValueItself: null,
    });
    assert.equal(result.mechanism, "refused");
    assert.match(result.reason ?? "", /contradicts a passing Little's MCAR test/);
  });

  it("no evidence either way is unassessed, never a default MCAR", () => {
    const result = classifyMissingness({
      field: "CompensationHistory.salaryYear 2019",
      littleMcarTestPassed: null,
      observedPredictorsOfMissingness: [],
      dependsOnMissingValueItself: null,
    });
    assert.equal(result.mechanism, "unassessed");
    assert.match(result.rationale, /not defaulted to MCAR/);
  });
});

// ---------------------------------------------------------------------------
// 3. Blanks are missing, never zero (§4.2)
// ---------------------------------------------------------------------------

describe("blanks are missing, never zero", () => {
  it("a blank input produces null plus a MissingDataItem, never 0", () => {
    const blank = blankInput({
      field: "CompensationHistory.salaryYear 2019",
      missingClass: "c",
      consequence: "Exact reconstruction is impossible; justified bounds are computed.",
      resolvesBy: "Payroll file",
    });
    assert.equal(blank.value, null);
    assert.notEqual(blank.value as unknown, 0);
    assert.equal(blank.item.field, "CompensationHistory.salaryYear 2019");
    assert.equal(blank.item.missingClass, "c");
  });

  it("a blank PA_AMB is null plus a MissingDataItem, never 0", () => {
    const blank = blankPaAmb({ participantKey: "SYN-001", resolvesBy: "PA benefit schedule" });
    assert.equal(blank.value, null);
    assert.equal(blank.item.field, "PA_AMB");
    assert.notEqual(blank.value as unknown, 0);
  });

  it("refuseZeroFill refuses a blank that would enter a calculation as 0", () => {
    const refusal = refuseZeroFill({ field: "PA_AMB", value: null, wasBlank: true });
    assert.ok(refusal !== null);
    assert.match(refusal as string, /never zero/);
  });

  it("refuseZeroFill allows a genuine recorded zero (a value, investigated as one)", () => {
    const refusal = refuseZeroFill({
      field: "PA_AMB",
      value: { amountMinor: 0, minorUnitsPerMajor: 100, currency: "USD", sourceDecimalPlaces: 2 },
      wasBlank: false,
    });
    assert.equal(refusal, null);
  });
});

// ---------------------------------------------------------------------------
// 4. Mathematically justified bounds (§4.3, B-1–B-5)
// ---------------------------------------------------------------------------

function validBounds(overrides: Partial<CandidateBounds> = {}): CandidateBounds {
  return {
    participantKey: "SYN-002",
    minMinor: 158400,
    maxMinor: 168300,
    justifications: [
      { kind: "fact", statement: "Missing compensation year bounded by adjacent known years $4,800–$5,400/month and the §401(a)(17) cap in effect." },
    ],
    derivationMethod: "endpoint-plus-kinks",
    monotonicity: [
      { input: "CompensationHistory.salaryYear 2019", monotone: true, verifiedBy: "endpoint+kink evaluation" },
    ],
    feasibleRegion: "CompensationHistory.salaryYear 2019 in [4800, 5400] USD/month",
    assumptionFreeBounds: null,
    ...overrides,
  };
}

describe("bounds justification (B-1–B-5)", () => {
  it("a bound with a stated factual basis passes", () => {
    assert.deepEqual(validateBoundsJustification(validBounds()), { ok: true, failures: [] });
  });

  it("a bound without a stated assumption or factual basis is refused (B-1)", () => {
    const result = validateBoundsJustification(validBounds({ justifications: [] }));
    assert.equal(result.ok, false);
    assert.match(result.failures.join(" "), /no justification/);
  });

  it("reversed bounds (min > max) are refused", () => {
    const result = validateBoundsJustification(validBounds({ minMinor: 168300, maxMinor: 158400 }));
    assert.equal(result.ok, false);
    assert.match(result.failures.join(" "), /reversed/);
  });

  it("monotonicity/kink verification catches a non-monotone bound (B-3)", () => {
    // Benefit at the endpoints: $1,650.00 at the low input, $1,716.00 at
    // the high input — but $1,750.00 at an interior kink point (a
    // grandfathered greater-of floor). Endpoint-only bounds are wrong.
    const check = verifyBoundsMonotonicity({
      input: "CompensationHistory.salaryYear 2019",
      points: [
        { inputValue: "4800", benefitMinor: 165000 },
        { inputValue: "5000", benefitMinor: 175000 },
        { inputValue: "5400", benefitMinor: 171600 },
      ],
    });
    assert.equal(check.monotone, false);
    assert.match(check.verifiedBy, /interior point outside the endpoint range/);

    const result = validateBoundsJustification(
      validBounds({
        monotonicity: [check],
      }),
    );
    assert.equal(result.ok, false);
    assert.match(result.failures.join(" "), /non-monotone/);
    assert.match(result.failures.join(" "), /grid \/ optimisation/);
  });

  it("a monotone formula passes monotonicity verification", () => {
    const check = verifyBoundsMonotonicity({
      input: "CompensationHistory.salaryYear 2019",
      points: [
        { inputValue: "4800", benefitMinor: 165000 },
        { inputValue: "5000", benefitMinor: 168300 },
        { inputValue: "5400", benefitMinor: 171600 },
      ],
    });
    assert.equal(check.monotone, true);
    assert.equal(check.verifiedBy, "endpoint+kink evaluation");
  });

  it("an assumption that narrows the bounds without assumption-free bounds reported is refused (B-4)", () => {
    const result = validateBoundsJustification(
      validBounds({
        justifications: [
          { kind: "assumption", statement: "Missing year at the average of known years (labelled assumption)." },
        ],
        assumptionFreeBounds: null,
      }),
    );
    assert.equal(result.ok, false);
    assert.match(result.failures.join(" "), /assumption-free bounds/);
  });

  it("an assumption-narrowed range inside the assumption-free range passes (B-4)", () => {
    const result = validateBoundsJustification(
      validBounds({
        justifications: [
          { kind: "fact", statement: "Missing year bounded by adjacent known years." },
          { kind: "assumption", statement: "Missing year at the average of known years (labelled assumption)." },
        ],
        minMinor: 160000,
        maxMinor: 166000,
        assumptionFreeBounds: { minMinor: 158400, maxMinor: 168300 },
      }),
    );
    assert.equal(result.ok, true);
  });

  it("a narrowed range wider than the assumption-free range is refused (B-4)", () => {
    const result = validateBoundsJustification(
      validBounds({
        justifications: [{ kind: "assumption", statement: "Missing year at the average of known years." }],
        assumptionFreeBounds: { minMinor: 160000, maxMinor: 166000 },
      }),
    );
    assert.equal(result.ok, false);
    assert.match(result.failures.join(" "), /not contained in the assumption-free range/);
  });

  it("recorded position: inside, below-min, above-max, recorded-missing (B-5)", () => {
    assert.equal(recordedBoundsPosition({ recordedMinor: 162000, minMinor: 158400, maxMinor: 168300 }), "inside");
    assert.equal(recordedBoundsPosition({ recordedMinor: 150000, minMinor: 158400, maxMinor: 168300 }), "below-min");
    assert.equal(recordedBoundsPosition({ recordedMinor: 190000, minMinor: 158400, maxMinor: 168300 }), "above-max");
    assert.equal(recordedBoundsPosition({ recordedMinor: null, minMinor: 158400, maxMinor: 168300 }), "recorded-missing");
  });

  it("bound width vs materiality: small width is immaterial, large width is the finding (B-5)", () => {
    assert.equal(boundWidthIsImmaterial({ minMinor: 162000, maxMinor: 162500, materialityThresholdMinor: 1000 }), true);
    assert.equal(boundWidthIsImmaterial({ minMinor: 158400, maxMinor: 168300, materialityThresholdMinor: 1000 }), false);
  });
});

describe("bounds are NOT confidence intervals (B-2)", () => {
  it("a confidence interval passed as bounds is refused, always", () => {
    const refusal = refuseConfidenceIntervalAsBounds({
      level: "95%",
      lowerMinor: 158400,
      upperMinor: 168300,
      method: "bootstrap percentile interval",
    });
    assert.equal(refusal.ok, false);
    assert.match(refusal.reason, /sampling uncertainty/);
    assert.match(refusal.reason, /not a guaranteed bound/);
  });

  it("a confidence-interval relabel in the derivation text is detected and refused", () => {
    const detected = detectConfidenceIntervalRelabel({
      derivationMethodText: "endpoint evaluation",
      justifications: [
        { kind: "fact", statement: "95% confidence interval from the regression model, used as the bound." },
      ],
    });
    assert.ok(detected !== null);
    assert.match(detected as string, /confidence interval/);
    assert.match(detected as string, /never accepted/);
  });

  it("a derivation with no confidence-interval language is not flagged", () => {
    const detected = detectConfidenceIntervalRelabel({
      derivationMethodText: "endpoint-plus-kinks evaluation",
      justifications: [
        { kind: "fact", statement: "Missing year bounded by adjacent known years and the §401(a)(17) cap." },
      ],
    });
    assert.equal(detected, null);
  });
});

// ---------------------------------------------------------------------------
// 5. Scenario / sensitivity analysis in decision terms (§4.4)
// ---------------------------------------------------------------------------

describe("scenario / sensitivity analysis (§4.4)", () => {
  it("a scenario that changes the disposition is flagged decision-relevant; one that does not is flagged as not", () => {
    const evaluated = evaluateScenarioSensitivity({
      baselineDisposition: "supported-for-acceptance",
      scenarios: [
        { scenarioName: "missing-year-low", assumptions: "missing year at $4,800", benefitMinor: 165000, disposition: "supported-for-acceptance" },
        { scenarioName: "missing-year-high", assumptions: "missing year at $5,400", benefitMinor: 171600, disposition: "requires-investigation" },
        { scenarioName: "alternative-formula", assumptions: "1989 restatement formula", benefitMinor: 150000, disposition: "correction-recommended" },
      ],
    });
    assert.equal(evaluated.length, 3);
    assert.equal(evaluated[0]?.decisionRelevant, false);
    assert.equal(evaluated[0]?.dispositionChange, null);
    assert.equal(evaluated[1]?.decisionRelevant, true);
    assert.deepEqual(evaluated[1]?.dispositionChange, { from: "supported-for-acceptance", to: "requires-investigation" });
    assert.equal(evaluated[2]?.decisionRelevant, true);
    assert.deepEqual(evaluated[2]?.dispositionChange, { from: "supported-for-acceptance", to: "correction-recommended" });
  });

  it("tornado ranking: a disposition-changing input outranks a larger dollar movement that changes nothing", () => {
    const ranked = rankSensitivity([
      { missingInput: "CompensationHistory.salaryYear 2019", missingClass: "c", benefitMovementMinor: 20000, changesDisposition: false, dispositionsAtEnds: null },
      { missingInput: "ServiceHistory.creditedService", missingClass: "c", benefitMovementMinor: 300, changesDisposition: true, dispositionsAtEnds: { low: "supported-for-acceptance", high: "requires-investigation" } },
      { missingInput: "CompensationHistory.salaryYear 2018", missingClass: "c", benefitMovementMinor: 5000, changesDisposition: false, dispositionsAtEnds: null },
    ]);
    assert.deepEqual(
      ranked.map((r) => r.missingInput),
      ["ServiceHistory.creditedService", "CompensationHistory.salaryYear 2019", "CompensationHistory.salaryYear 2018"],
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Per-input uncertainty attribution (§4.5)
// ---------------------------------------------------------------------------

describe("uncertainty attribution (§4.5)", () => {
  it("leave-one-out attribution via bounds.ts records each input's narrowing and disposition effect", () => {
    const attributions = attributeUncertainty({
      totalMinMinor: 158400,
      totalMaxMinor: 168300,
      inputs: [
        { missingInput: "CompensationHistory.salaryYear 2019", missingClass: "c", narrowedWidthMinor: 4900, couldChangeDisposition: true },
        { missingInput: "ServiceHistory.creditedService", missingClass: "c", narrowedWidthMinor: 8900, couldChangeDisposition: false },
      ],
    });
    assert.equal(attributions.length, 2);
    assert.equal(attributions[0]?.widthContribution.amountMinor, 5000);
    assert.equal(attributions[0]?.couldChangeDisposition, true);
    assert.equal(attributions[1]?.widthContribution.amountMinor, 1000);
    assert.equal(attributions[1]?.couldChangeDisposition, false);
  });

  it("the normalised allocation sums exactly to the total width", () => {
    const attributions = attributeUncertainty({
      totalMinMinor: 158400,
      totalMaxMinor: 168300,
      inputs: [
        { missingInput: "CompensationHistory.salaryYear 2019", missingClass: "c", narrowedWidthMinor: 4900, couldChangeDisposition: true },
        { missingInput: "ServiceHistory.creditedService", missingClass: "c", narrowedWidthMinor: 8900, couldChangeDisposition: false },
      ],
    });
    const allocation = normalisedWidthAllocation({
      totalMinMinor: 158400,
      totalMaxMinor: 168300,
      attributions,
    });
    assert.equal(allocationSumsToTotal({ totalMinMinor: 158400, totalMaxMinor: 168300, allocation }), true);
    const sum = allocation.reduce((s, a) => s + a.widthContribution.amountMinor, 0);
    assert.equal(sum, 9900);
    // Proportional to the leave-one-out contributions (5000:1000).
    assert.equal(allocation[0]?.widthContribution.amountMinor, 8250);
    assert.equal(allocation[1]?.widthContribution.amountMinor, 1650);
  });

  it("a zero-width interval allocates zero to every input", () => {
    const attributions = attributeUncertainty({
      totalMinMinor: 150000,
      totalMaxMinor: 150000,
      inputs: [
        { missingInput: "CompensationHistory.salaryYear 2019", missingClass: "c", narrowedWidthMinor: 0, couldChangeDisposition: false },
      ],
    });
    const allocation = normalisedWidthAllocation({
      totalMinMinor: 150000,
      totalMaxMinor: 150000,
      attributions,
    });
    assert.equal(allocation[0]?.widthContribution.amountMinor, 0);
    assert.equal(allocationSumsToTotal({ totalMinMinor: 150000, totalMaxMinor: 150000, allocation }), true);
  });
});

// ---------------------------------------------------------------------------
// 7. Data-request prioritisation (§4.6)
// ---------------------------------------------------------------------------

describe("data-request prioritisation (§4.6)", () => {
  it("the request with the largest expected decision effect ranks first", () => {
    const candidates: DataRequestCandidate[] = [
      {
        requestId: "req-a",
        input: "CompensationHistory.salaryYear 2018",
        participantKeys: ["SYN-003"],
        sourceToAsk: "Payroll file",
        expectedDecisionEffect: "Narrows one participant's bounds; does not change any disposition.",
        missingClass: "M4",
        couldChangeDisposition: false,
        effort: "low",
      },
      {
        requestId: "req-b",
        input: "Plan document for era 1994–1998",
        participantKeys: ["SYN-004"],
        sourceToAsk: "Plan document repository",
        expectedDecisionEffect: "Could move one participant out of Indeterminate.",
        missingClass: "M2",
        couldChangeDisposition: true,
        effort: "high",
      },
      {
        requestId: "req-c",
        input: "CompensationHistory.salaryYear 2019",
        participantKeys: ["SYN-001", "SYN-002", "SYN-005", "SYN-006", "SYN-007"],
        sourceToAsk: "Payroll file",
        expectedDecisionEffect: "Could move five participants out of Requires investigation.",
        missingClass: "M2",
        couldChangeDisposition: true,
        effort: "low",
      },
      {
        requestId: "req-d",
        input: "CompensationHistory.salaryYear 2019",
        participantKeys: ["SYN-001", "SYN-002", "SYN-005", "SYN-006", "SYN-007"],
        sourceToAsk: "Prior valuation report",
        expectedDecisionEffect: "Could move five participants out of Requires investigation.",
        missingClass: "M3",
        couldChangeDisposition: true,
        effort: "low",
      },
    ];
    const ranked = prioritiseDataRequests(candidates);
    // Disposition-changing first; breadth second; M2 recoverability
    // third; effort last.
    assert.deepEqual(
      ranked.map((r) => r.requestId),
      ["req-c", "req-d", "req-b", "req-a"],
    );
    assert.deepEqual(
      ranked.map((r) => r.priority),
      [1, 2, 3, 4],
    );
    for (const request of ranked) {
      assert.equal(request.status, "not-issued");
      assert.match(request.statusReason, /expected decision effect/);
    }
    assert.match(ranked[0]?.statusReason ?? "", /could change the disposition/);
    assert.match(ranked[0]?.statusReason ?? "", /5 participant\(s\) affected/);
    assert.match(ranked[0]?.statusReason ?? "", /recoverable from a known source/);
  });

  it("an unrecorded retrieval effort never outranks a recorded one on effort alone", () => {
    const ranked = prioritiseDataRequests([
      {
        requestId: "req-low",
        input: "X",
        participantKeys: ["SYN-001"],
        sourceToAsk: "S",
        expectedDecisionEffect: "E",
        missingClass: "M3",
        couldChangeDisposition: true,
        effort: "low",
      },
      {
        requestId: "req-unrecorded",
        input: "Y",
        participantKeys: ["SYN-001"],
        sourceToAsk: "S",
        expectedDecisionEffect: "E",
        missingClass: "M3",
        couldChangeDisposition: true,
        effort: null,
      },
    ]);
    assert.deepEqual(
      ranked.map((r) => r.requestId),
      ["req-low", "req-unrecorded"],
    );
    assert.match(ranked[1]?.statusReason ?? "", /effort not recorded/);
  });
});
