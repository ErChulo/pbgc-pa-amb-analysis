/**
 * Tests for the ten-stage calculation pipeline (src/pipeline.ts).
 * Plain node:test; no framework.
 *
 * Worked examples (Stage 2 output 04 §8/§9, synthetic participants):
 * - SYN-001: the exact $1,500.00 unit-credit reconstruction with its
 *   full 10-stage trace (Plan A: α = 1.5%, final-3-year average monthly
 *   comp $4,800 / $5,000 / $5,200, S = 20, DOTE 2020-02-29).
 * - SYN-002: the bounds example $1,584.00–$1,683.00 (S = 22, 2018
 *   $4,800, 2019 $5,100, 2020 missing, class M3 bounded $4,500–$5,400;
 *   recorded PA_AMB $1,620 inside, width $99.00 > τ_material $25.00).
 *   The width is material, so the disposition is Requires investigation
 *   — that disposition belongs to the reconciliation module (Stage 5);
 *   this test asserts the bounds and the width that drive it.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeMoney } from "../src/decimal.js";
import type {
  CalculationRequest,
  CalculationStep,
  CompensationHistory,
  EmploymentPeriod,
  PlanVersion,
  Provenance,
  RoundingConfig,
  ServiceHistory,
  SourcedValue,
  ToleranceRecord,
} from "../src/types.js";
import { datedValue, makeBenefit } from "../src/formulas.js";
import {
  calculateAccruedBenefit,
  testCounterfactual,
} from "../src/pipeline.js";
import type { PipelineInputs } from "../src/pipeline.js";

function prov(): Provenance {
  return {
    documentId: "doc-1",
    location: {
      kind: "user-entered",
      enteredBy: "tester",
      enteredDate: "2026-01-01",
      entryForm: "test",
    },
    acquisition: "user-entered",
    derivation: null,
    sourceFileHash: null,
  };
}

function sourced<T>(value: T | null): SourcedValue<T> {
  return { value, provenance: prov() };
}

function entity(id: string): {
  id: string;
  version: number;
  supersedesId: string | null;
  sourceRecordIds: string[];
  createdDate: string;
  createdBy: string;
} {
  return {
    id,
    version: 1,
    supersedesId: null,
    sourceRecordIds: [],
    createdDate: "2026-01-01",
    createdBy: "tester",
  };
}

function planVersion(
  versionId: string,
  effectiveDate: string,
  formulaIds: string[],
): PlanVersion {
  return {
    ...entity(versionId),
    planId: "plan-1",
    versionId,
    effectiveDate: sourced(effectiveDate),
    adoptionDate: sourced("1985-06-01"),
    restatementDate: sourced(null),
    provisionText: sourced(""),
    provisionSection: sourced("§5.01"),
    supersedesVersionId: null,
    grandfatheredGroups: sourced([]),
    freeze: sourced(null),
    sourceDocumentId: "doc-1",
    changeSummary: "",
    statutoryLimitsInForce: [],
    formulaIds,
  };
}

function employmentPeriod(start: string, end: string | null): EmploymentPeriod {
  return {
    ...entity(`ep-${start}`),
    participantKey: "SYN",
    doh: sourced(start),
    dote: sourced(end),
    dop: sourced(null),
    dobfParticipant: sourced(null),
    dor: sourced(null),
    postDoptDote: sourced(null),
    periodSeq: 1,
    periodType: "initial-hire",
    periodStart: start,
    periodEnd: end,
    breakInService: null,
    hoursPerPeriod: sourced(null),
  };
}

function serviceHistory(
  periods: Array<{ start: string; end: string | null; measure: number }>,
  creditedService: number,
  vestingPercent: string,
): ServiceHistory {
  return {
    ...entity("sh-1"),
    participantKey: "SYN",
    asOfDate: sourced("2020-02-29"),
    paCreditedService: sourced(creditedService),
    paVestingService: sourced(creditedService),
    paEligibilityService: sourced(creditedService),
    bcvCreditedService: sourced(creditedService),
    bcvVestingService: sourced(creditedService),
    bcvEligibilityService: sourced(creditedService),
    paVestingPercent: sourced(vestingPercent),
    bcvVestingPercent: sourced(vestingPercent),
    serviceMeasure: "years",
    servicePeriods: periods.map((p) => ({
      start: p.start,
      end: p.end,
      measure: p.measure,
      provenance: prov(),
    })),
    breaksApplied: [],
    distributions: [],
  };
}

function compensationHistory(
  salaries: Array<{ year: number; minor: number | null }>,
): CompensationHistory {
  return {
    ...entity("ch-1"),
    participantKey: "SYN",
    firstYear: sourced(salaries[0]?.year ?? 2017),
    lastYear: sourced(salaries[salaries.length - 1]?.year ?? 2019),
    salaryByYear: salaries.map((s, i) => ({
      salaryYear: s.year,
      sourceField: `S00${i + 1}`,
      amount: s.minor === null ? null : makeMoney(s.minor),
      annualized: false,
      provenance: prov(),
    })),
    annualizedFlagSource: sourced(null),
    salaryDesc: sourced("W-2 wages"),
    currentMonthlyComp: sourced(null),
    paAverageComp: sourced(null),
    compensationDefinitionApplied: "plan §2.01",
    nonCensusInputs: [],
  };
}

function roundingConfig(): RoundingConfig {
  return {
    configId: "rc-1",
    version: "rounding-config v1.0.0",
    planVersionId: "v1",
    prescribedSequence: {
      sequenceId: "prescribed",
      rules: [
        {
          target: "final-monthly-benefit",
          unit: "0.01",
          mode: "half-up",
          stage: "final",
          source: { kind: "plan-provision", citation: "plan §5.01" },
        },
      ],
    },
    alternativeSequences: [],
    setBy: "tester",
    setDate: "2026-01-01",
    rationale: "test fixture",
  };
}

function tolerance(): ToleranceRecord {
  return {
    version: 1,
    absoluteMinor: 100,
    relativeDecimal: "0.001",
    application: "either",
    authority: "test fixture",
    approvedBy: "tester",
    approvedDate: "2026-01-01",
  };
}

function makeRequest(args: {
  participantKey: string;
  measurementDate: string | null;
  formulaId: string;
  formulaIdsInForce: string[];
  employmentPeriods: EmploymentPeriod[];
  serviceHistory: ServiceHistory | null;
  compensationHistory: CompensationHistory | null;
}): CalculationRequest {
  return {
    participantKey: args.participantKey,
    participantHistory: {
      participantKey: args.participantKey,
      employmentPeriods: args.employmentPeriods,
      compensationHistory: args.compensationHistory,
      serviceHistory: args.serviceHistory,
      benefitObservations: [],
    },
    provisionTimeline: {
      planId: "plan-1",
      versions: [planVersion("v1", "1985-07-01", args.formulaIdsInForce)],
    },
    measurementDate: args.measurementDate,
    measurementBasis: args.measurementDate === null ? "unresolved" : "dote",
    calculationKind: "accrued",
    formulaId: args.formulaId,
    roundingConfig: roundingConfig(),
    tolerance: tolerance(),
    runContext: {
      engineVersion: "0.1.0",
      ruleVersion: "2026-11-12",
      formulaTaxonomyVersion: "1.0",
      inputSnapshotHash: "test",
    },
  };
}

function syn001Request(): CalculationRequest {
  return makeRequest({
    participantKey: "SYN-001",
    measurementDate: "2020-02-29",
    formulaId: "T-04",
    formulaIdsInForce: ["T-04"],
    employmentPeriods: [employmentPeriod("2000-01-01", "2020-02-29")],
    serviceHistory: serviceHistory(
      [{ start: "2000-01-01", end: "2020-02-29", measure: 20 }],
      20,
      "1",
    ),
    compensationHistory: compensationHistory([
      { year: 2017, minor: 5760000 },
      { year: 2018, minor: 6000000 },
      { year: 2019, minor: 6240000 },
    ]),
  });
}

function syn001Inputs(): PipelineInputs {
  return {
    formulaCall: {
      formulaId: "T-04",
      params: {
        accrualRate: datedValue("0.015", "1985-07-01", "v1"),
        avgComp: "60000",
        service: "20",
      },
    },
    recordedPaAmb: makeBenefit(
      {
        planVersionId: "v1",
        measurementDate: "2020-02-29",
        rounding: { stage: "final-only", mode: "nearest-cent", source: "test" },
      },
      makeMoney(150000),
      "monthly",
      undefined,
      "prior-administrator",
    ),
    averagingPeriod: {
      kind: "final",
      years: 3,
      description: "final-3-year",
      ruleRef: "plan §5.01",
    },
    requiredBasis: { annuityForm: "NSF", retirementAge: 65 },
  };
}

function stepByName(trace: CalculationStep[], name: string): CalculationStep | undefined {
  return trace.find((s) => s.name === name);
}

function stepInput(step: CalculationStep | undefined, field: string): unknown {
  return step?.inputs.find((i) => i.field === field)?.value;
}

describe("SYN-001 exact reconstruction (Stage 2 output 04 §8)", () => {
  it("reconstructs $1,500.00/month with a full 10-stage trace", () => {
    const outcome = calculateAccruedBenefit(syn001Request(), syn001Inputs());
    assert.equal(outcome.kind, "exact");
    if (outcome.kind !== "exact") throw new Error("unreachable");
    assert.equal(outcome.benefit.amount?.amountMinor, 150000);
    assert.equal(outcome.benefit.periodicity, "monthly");
    assert.equal(outcome.benefit.vestingTreatment, "vested");
    assert.equal(outcome.benefit.annuityForm, "NSF");
    assert.equal(outcome.benefit.retirementAge, 65);

    const trace = outcome.trace;
    // One step per stage, in order, with sequential step numbers.
    assert.equal(trace.length, 18);
    trace.forEach((s, i) => assert.equal(s.step, i + 1));
    assert.equal(stepByName(trace, "provisions-selected") !== undefined, true);
    assert.equal(stepByName(trace, "participation") !== undefined, true);
    assert.equal(stepByName(trace, "credited-service") !== undefined, true);
    assert.equal(stepByName(trace, "average-compensation") !== undefined, true);
    assert.equal(stepByName(trace, "base-formula") !== undefined, true);
    assert.equal(stepByName(trace, "protection-evaluated-not-applied") !== undefined, true);
    assert.equal(stepByName(trace, "restrictions-evaluated-not-applied") !== undefined, true);
    assert.equal(stepByName(trace, "rounding") !== undefined, true);
    assert.equal(stepByName(trace, "normal-retirement-basis") !== undefined, true);
    assert.equal(stepByName(trace, "comparison-basis") !== undefined, true);
    assert.equal(stepByName(trace, "recorded-pa-amb") !== undefined, true);

    // Stage 3/4 measures in the trace.
    assert.equal(stepInput(stepByName(trace, "credited-service"), "creditedService"), "20");
    assert.equal(stepInput(stepByName(trace, "average-compensation"), "averageDollars"), "60000");
    // Stage 10: basis converted by the vesting conversion; recorded $1,500.
    assert.equal(stepInput(stepByName(trace, "comparison-basis"), "comparisonBasis"), "basis-converted");
    assert.equal(stepInput(stepByName(trace, "comparison-basis"), "basisConversion"), "vesting");
    assert.equal(stepInput(stepByName(trace, "recorded-pa-amb"), "recordedMinor"), 150000);
  });

  it("Stage 10 counterfactuals: service +1 gives $1,575 (residual -$75), service -1 gives $1,425 (residual +$75)", () => {
    const outcome = calculateAccruedBenefit(syn001Request(), syn001Inputs());
    assert.equal(outcome.kind, "exact");
    if (outcome.kind !== "exact") throw new Error("unreachable");
    const counterfactuals = outcome.trace.filter((s) => s.name === "counterfactual");
    assert.equal(counterfactuals.length, 2);
    const plusOne = counterfactuals[0];
    assert.equal(stepInput(plusOne, "hypothesisCode"), "H2");
    assert.equal(stepInput(plusOne, "benefitMinor"), 157500);
    assert.equal(stepInput(plusOne, "residualDeltaMinor"), -7500);
    assert.equal(stepInput(plusOne, "supportClass"), "refuted");
    const minusOne = counterfactuals[1];
    assert.equal(stepInput(minusOne, "benefitMinor"), 142500);
    assert.equal(stepInput(minusOne, "residualDeltaMinor"), 7500);
    assert.equal(stepInput(minusOne, "supportClass"), "refuted");
  });

  it("Stage 5 evaluates the formula on the Stage 3/4 measures, not on stale call parameters", () => {
    const inputs = syn001Inputs();
    inputs.formulaCall = {
      formulaId: "T-04",
      params: {
        accrualRate: datedValue("0.015", "1985-07-01", "v1"),
        avgComp: "1",
        service: "1",
      },
    };
    const outcome = calculateAccruedBenefit(syn001Request(), inputs);
    assert.equal(outcome.kind, "exact");
    if (outcome.kind !== "exact") throw new Error("unreachable");
    assert.equal(outcome.benefit.amount?.amountMinor, 150000);
  });
});

describe("SYN-002 bounds (Stage 2 output 04 §9)", () => {
  function syn002Request(): CalculationRequest {
    return makeRequest({
      participantKey: "SYN-002",
      measurementDate: "2020-02-29",
      formulaId: "T-04",
      formulaIdsInForce: ["T-04"],
      employmentPeriods: [employmentPeriod("1998-01-01", "2020-02-29")],
      serviceHistory: serviceHistory(
        [{ start: "1998-01-01", end: "2020-02-29", measure: 22 }],
        22,
        "1",
      ),
      compensationHistory: compensationHistory([
        { year: 2018, minor: 5760000 },
        { year: 2019, minor: 6120000 },
        { year: 2020, minor: null },
      ]),
    });
  }

  function syn002Inputs(): PipelineInputs {
    return {
      formulaCall: {
        formulaId: "T-04",
        params: {
          accrualRate: datedValue("0.015", "1985-07-01", "v1"),
          avgComp: "60000",
          service: "22",
        },
      },
      recordedPaAmb: makeBenefit(
        {
          planVersionId: "v1",
          measurementDate: "2020-02-29",
          rounding: { stage: "final-only", mode: "nearest-cent", source: "test" },
        },
        makeMoney(162000),
        "monthly",
        undefined,
        "prior-administrator",
      ),
      averagingPeriod: {
        kind: "final",
        years: 3,
        description: "final-3-year",
        ruleRef: "plan §5.01",
      },
      requiredBasis: { annuityForm: "NSF", retirementAge: 65 },
      boundsSpec: {
        ranges: [
          {
            field: "CompensationHistory.salaryYear 2020",
            missingClass: "c",
            low: "54000",
            high: "64800",
            unit: "annual-compensation-dollars",
            basis: "prior-year salary bounded by the plan's pay scale",
          },
        ],
        assumptions: ["formula T-04 applies to all service"],
      },
    };
  }

  it("bounds $1,584.00–$1,683.00; recorded $1,620 inside; width $99.00", () => {
    const outcome = calculateAccruedBenefit(syn002Request(), syn002Inputs());
    assert.equal(outcome.kind, "bounds");
    if (outcome.kind !== "bounds") throw new Error("unreachable");
    assert.equal(outcome.bounds.min.amountMinor, 158400);
    assert.equal(outcome.bounds.max.amountMinor, 168300);
    assert.equal(outcome.bounds.recordedPosition, "inside");
    assert.equal(
      outcome.bounds.max.amountMinor - outcome.bounds.min.amountMinor,
      9900,
    );
    // Width $99.00 > τ_material $25.00 (tolerance absoluteMinor 100 is
    // the comparison tolerance, not the materiality threshold — the
    // width itself is the finding; the disposition belongs to Stage 5).
    assert.equal(outcome.bounds.minBenefit.source, "bound");
    assert.equal(outcome.bounds.maxBenefit.source, "bound");
    // The 2020 salary drives all of the width.
    assert.equal(outcome.bounds.widthAttribution.length, 1);
    assert.equal(
      outcome.bounds.widthAttribution[0]?.widthContribution.amountMinor,
      9900,
    );
    assert.equal(outcome.bounds.widthAttribution[0]?.widthShare, "1");
    assert.equal(outcome.bounds.widthAttribution[0]?.couldChangeDisposition, true);
    // Three scenarios: low, high, midpoint (labelled assumption).
    assert.equal(outcome.bounds.scenarios.length, 3);
    assert.equal(outcome.bounds.scenarios[0]?.benefit?.amountMinor, 158400);
    assert.equal(outcome.bounds.scenarios[1]?.benefit?.amountMinor, 168300);
    assert.equal(outcome.bounds.scenarios[2]?.benefit?.amountMinor, 163350);
  });

  it("without a bounds range the same gap is indeterminate, not bounds", () => {
    const inputs = syn002Inputs();
    inputs.boundsSpec = undefined;
    const outcome = calculateAccruedBenefit(syn002Request(), inputs);
    assert.equal(outcome.kind, "indeterminate");
    if (outcome.kind !== "indeterminate") throw new Error("unreachable");
    assert.equal(
      outcome.reason.missingInputs.includes("CompensationHistory.salaryYear 2020"),
      true,
    );
  });
});

describe("unresolved-basis gate", () => {
  it("null measurement date returns indeterminate with only the gate record", () => {
    const request = syn001Request();
    request.measurementDate = null;
    request.measurementBasis = "unresolved";
    const outcome = calculateAccruedBenefit(request, syn001Inputs());
    assert.equal(outcome.kind, "indeterminate");
    if (outcome.kind !== "indeterminate") throw new Error("unreachable");
    assert.equal(outcome.reason.code, "unresolved-comparison-basis");
    assert.equal(outcome.trace.length, 1);
    assert.equal(outcome.trace[0]?.name, "comparison-basis-gate");
  });
});

describe("stage failures stop the exact path — never a guessed value", () => {
  it("missing service history is indeterminate and names the missing input", () => {
    const request = makeRequest({
      participantKey: "SYN-003",
      measurementDate: "2020-02-29",
      formulaId: "T-04",
      formulaIdsInForce: ["T-04"],
      employmentPeriods: [employmentPeriod("2000-01-01", "2020-02-29")],
      serviceHistory: null,
      compensationHistory: compensationHistory([
        { year: 2017, minor: 5760000 },
        { year: 2018, minor: 6000000 },
        { year: 2019, minor: 6240000 },
      ]),
    });
    const outcome = calculateAccruedBenefit(request, syn001Inputs());
    assert.equal(outcome.kind, "indeterminate");
    if (outcome.kind !== "indeterminate") throw new Error("unreachable");
    assert.equal(outcome.reason.code, "missing-input");
    assert.equal(
      outcome.reason.missingInputs.includes("ServiceHistory.creditedService"),
      true,
    );
    assert.equal(stepByName(outcome.trace, "base-formula"), undefined);
  });

  it("participant not yet employed at the measurement date is inapplicable", () => {
    const request = makeRequest({
      participantKey: "SYN-004",
      measurementDate: "2020-02-29",
      formulaId: "T-04",
      formulaIdsInForce: ["T-04"],
      employmentPeriods: [employmentPeriod("2021-01-01", null)],
      serviceHistory: serviceHistory(
        [{ start: "2021-01-01", end: null, measure: 0 }],
        0,
        "0",
      ),
      compensationHistory: compensationHistory([
        { year: 2019, minor: 6240000 },
      ]),
    });
    const outcome = calculateAccruedBenefit(request, syn001Inputs());
    assert.equal(outcome.kind, "indeterminate");
    if (outcome.kind !== "indeterminate") throw new Error("unreachable");
    assert.equal(outcome.reason.code, "inapplicable-rule");
    assert.equal(stepByName(outcome.trace, "credited-service"), undefined);
  });

  it("formula not in force in the version is refused, not silently applied", () => {
    const request = makeRequest({
      participantKey: "SYN-005",
      measurementDate: "2020-02-29",
      formulaId: "T-04",
      formulaIdsInForce: ["T-06"],
      employmentPeriods: [employmentPeriod("2000-01-01", "2020-02-29")],
      serviceHistory: serviceHistory(
        [{ start: "2000-01-01", end: "2020-02-29", measure: 20 }],
        20,
        "1",
      ),
      compensationHistory: compensationHistory([
        { year: 2017, minor: 5760000 },
        { year: 2018, minor: 6000000 },
        { year: 2019, minor: 6240000 },
      ]),
    });
    const outcome = calculateAccruedBenefit(request, syn001Inputs());
    assert.equal(outcome.kind, "indeterminate");
    if (outcome.kind !== "indeterminate") throw new Error("unreachable");
    assert.equal(outcome.reason.code, "rule-refused");
  });

  it("formulaCall naming a different formula than the request is refused", () => {
    const inputs = syn001Inputs();
    inputs.formulaCall = {
      formulaId: "T-06",
      params: {
        accrualRate: datedValue("0.015", "1985-07-01", "v1"),
        windowYears: 3,
        windowKind: "final",
        compByYear: [
          { year: 2017, comp: "57600" },
          { year: 2018, comp: "60000" },
          { year: 2019, comp: "62400" },
        ],
        service: "20",
      },
    };
    const outcome = calculateAccruedBenefit(syn001Request(), inputs);
    assert.equal(outcome.kind, "indeterminate");
    if (outcome.kind !== "indeterminate") throw new Error("unreachable");
    assert.equal(outcome.reason.code, "rule-refused");
  });
});

describe("counterfactual hypotheses", () => {
  it("averaging-period final-2-year gives $1,530 (residual -$30), refuted", () => {
    const result = testCounterfactual(
      syn001Request(),
      { kind: "averaging-period", period: "final-2-year" },
      syn001Inputs(),
    );
    assert.equal(result.hypothesisCode, "H4");
    assert.equal(result.benefit?.amount?.amountMinor, 153000);
    assert.equal(result.residualDelta?.amountMinor, -3000);
    assert.equal(result.supportClass, "refuted");
  });

  it("vesting not applied with VP 1.0 changes nothing: residual $0, plausible", () => {
    const result = testCounterfactual(
      syn001Request(),
      { kind: "vesting", mode: "not-applied" },
      syn001Inputs(),
    );
    assert.equal(result.hypothesisCode, "H12");
    assert.equal(result.benefit?.amount?.amountMinor, 150000);
    assert.equal(result.residualDelta?.amountMinor, 0);
    assert.equal(result.supportClass, "plausible");
  });

  it("documented rounding sequence that leaves the benefit unchanged is supported", () => {
    const result = testCounterfactual(
      syn001Request(),
      {
        kind: "rounding-sequence",
        sequence: {
          sequenceId: "nearest-dollar",
          rules: [
            {
              target: "final-monthly-benefit",
              unit: "1",
              mode: "half-up",
              stage: "final",
              source: { kind: "plan-provision", citation: "plan §5.01" },
            },
          ],
        },
      },
      syn001Inputs(),
    );
    assert.equal(result.hypothesisCode, "H15");
    assert.equal(result.benefit?.amount?.amountMinor, 150000);
    assert.equal(result.residualDelta?.amountMinor, 0);
    assert.equal(result.supportClass, "supported");
  });
});
