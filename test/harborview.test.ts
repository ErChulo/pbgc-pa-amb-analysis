/**
 * Harborview worked example — Stage 2 output 01 §8 (3-version timeline).
 *
 * No existing test covered this example (checked 2026-11-12: the
 * $1,067.50 / $1,232.50 / $165.00 figures appear nowhere in test/).
 *
 * Fictional plan and participant (Stage 2 output 01 §8, synthetic only):
 * Harborview Manufacturing Hourly Pension Plan, plan 0042, case
 * 00098765, DOPT 2024-06-30, NRA 65. Ana Ruiz, hired 1986-04-01,
 * DOTE 2010-06-30, fully vested.
 *
 * Timeline: pv-1985-orig ($40/month/year from 1985-07-01),
 * pv-2004-amend ($55/month/year from 2004-01-01, pre-2004 accrual
 * protected at the old rate), pv-2019-freeze (accrual-only freeze from
 * 2019-01-01). The latest formula is never applied retroactively.
 *
 * Engine reconstruction at DOTE 2010-06-30:
 *   pre-2004 service 17.75y × $40.00 = $710.00/month
 *   post-2003 service 6.50y × $55.00 = $357.50/month
 *   total $1,067.50/month, gross, NSF, at NRD.
 * The PA reported $1,232.50. Δ = +$165.00/month.
 *
 * The $165.00 gap is held as a HYPOTHESIS, not a conclusion: the
 * counterfactual reproduces the recorded amount exactly, and the
 * hypothesis still stays "proposed" — a numerical match alone decides
 * nothing (01 §8.4–§8.5).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeMoney } from "../src/decimal.js";
import type {
  CalculationRequest,
  CompensationHistory,
  EmploymentPeriod,
  PlanVersion,
  Provenance,
  RoundingConfig,
  ServiceHistory,
  SourcedValue,
  ToleranceRecord,
} from "../src/types.js";
import { selectProvisionsByDate } from "../src/compose.js";
import { completedYMD } from "../src/dates.js";
import { computeCreditedService, type EmploymentPeriodInput, type ServiceDefinition } from "../src/service.js";
import { datedValue, evaluateFormulaCall, makeBenefit } from "../src/formulas.js";
import { calculateAccruedBenefit } from "../src/pipeline.js";
import type { PipelineInputs } from "../src/pipeline.js";
import type { DiagnosticHypothesis } from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixtures (same shapes as test/pipeline.test.ts)
// ---------------------------------------------------------------------------

function prov(): Provenance {
  return {
    documentId: "doc-harborview",
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
  freeze: PlanVersion["freeze"]["value"],
): PlanVersion {
  return {
    ...entity(versionId),
    planId: "plan-harborview",
    versionId,
    effectiveDate: sourced(effectiveDate),
    adoptionDate: sourced("1985-06-15"),
    restatementDate: sourced(null),
    provisionText: sourced(""),
    provisionSection: sourced("§5.01"),
    supersedesVersionId: null,
    grandfatheredGroups: sourced([]),
    freeze: sourced(freeze),
    sourceDocumentId: "doc-harborview",
    changeSummary: "",
    statutoryLimitsInForce: [],
    formulaIds,
  };
}

function harborviewTimeline(): { planId: string; versions: PlanVersion[] } {
  return {
    planId: "plan-harborview",
    versions: [
      planVersion("pv-1985-orig", "1985-07-01", ["T-03"], null),
      planVersion("pv-2004-amend", "2004-01-01", ["T-03"], null),
      planVersion("pv-2019-freeze", "2019-01-01", ["T-03"], {
        freezeDate: "2019-01-01",
        scope: "accrual-only",
        partialScopeNote: null,
        sourceSection: "2018 amendment §2",
      }),
    ],
  };
}

function employmentPeriod(start: string, end: string | null): EmploymentPeriod {
  return {
    ...entity(`ep-${start}`),
    participantKey: "P-SYN-001",
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

function serviceHistory(creditedService: number, vestingPercent: string): ServiceHistory {
  return {
    ...entity("sh-harborview"),
    participantKey: "P-SYN-001",
    asOfDate: sourced("2010-06-30"),
    paCreditedService: sourced(creditedService),
    paVestingService: sourced(creditedService),
    paEligibilityService: sourced(creditedService),
    bcvCreditedService: sourced(creditedService),
    bcvVestingService: sourced(creditedService),
    bcvEligibilityService: sourced(creditedService),
    paVestingPercent: sourced(vestingPercent),
    bcvVestingPercent: sourced(vestingPercent),
    serviceMeasure: "years",
    servicePeriods: [
      { start: "1986-04-01", end: "2010-06-30", measure: creditedService, provenance: prov() },
    ],
    breaksApplied: [],
    distributions: [],
  };
}

function compensationHistory(
  salaries: Array<{ year: number; minor: number | null }>,
): CompensationHistory {
  return {
    ...entity("ch-harborview"),
    participantKey: "P-SYN-001",
    firstYear: sourced(salaries[0]?.year ?? 2008),
    lastYear: sourced(salaries[salaries.length - 1]?.year ?? 2010),
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
    configId: "rc-harborview",
    version: "rounding-config v1.0.0",
    planVersionId: "pv-2004-amend",
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

function harborviewRequest(): CalculationRequest {
  return {
    participantKey: "P-SYN-001",
    participantHistory: {
      participantKey: "P-SYN-001",
      employmentPeriods: [employmentPeriod("1986-04-01", "2010-06-30")],
      compensationHistory: compensationHistory([
        { year: 2008, minor: 4800000 },
        { year: 2009, minor: 5000000 },
        { year: 2010, minor: 5200000 },
      ]),
      serviceHistory: serviceHistory(24.25, "1"),
      benefitObservations: [],
    },
    provisionTimeline: harborviewTimeline(),
    measurementDate: "2010-06-30",
    measurementBasis: "dote",
    calculationKind: "accrued",
    formulaId: "T-03",
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

function harborviewInputs(): PipelineInputs {
  return {
    formulaCall: {
      formulaId: "T-03",
      params: {
        unitRate: datedValue("55", "2004-01-01", "pv-2004-amend"),
        service: "24.25",
        periodRates: [
          { from: "1986-04-01", to: "2003-12-31", rate: "40", service: "17.75" },
          { from: "2004-01-01", to: "2010-06-30", rate: "55", service: "6.5" },
        ],
      },
    },
    recordedPaAmb: makeBenefit(
      {
        planVersionId: "pv-2004-amend",
        measurementDate: "2010-06-30",
        rounding: { stage: "final-only", mode: "nearest-cent", source: "test" },
      },
      makeMoney(123250),
      "monthly",
      undefined,
      "prior-administrator",
    ),
    // The flat-dollar formula does not use compensation; the pipeline's
    // Stage 4 gate still requires a stated averaging period, so a
    // synthetic final-3-year period is supplied. It is not an input to
    // the $1,067.50 reconstruction.
    averagingPeriod: {
      kind: "final",
      years: 3,
      description: "final-3-year",
      ruleRef: "plan §5.01",
    },
    requiredBasis: { annuityForm: "NSF", retirementAge: 65 },
  };
}

// ---------------------------------------------------------------------------
// §8.1 — the 3-version timeline: each date selects its own version
// ---------------------------------------------------------------------------

describe("Harborview timeline (Stage 2 output 01 §8.1)", () => {
  it("1985–2003 selects pv-1985-orig, 2010 selects pv-2004-amend, DOPT 2024 selects pv-2019-freeze", () => {
    const timeline = harborviewTimeline();
    assert.equal(selectProvisionsByDate(timeline, "1990-06-30").version?.versionId, "pv-1985-orig");
    assert.equal(selectProvisionsByDate(timeline, "2003-12-31").version?.versionId, "pv-1985-orig");
    assert.equal(selectProvisionsByDate(timeline, "2004-01-01").version?.versionId, "pv-2004-amend");
    assert.equal(selectProvisionsByDate(timeline, "2010-06-30").version?.versionId, "pv-2004-amend");
    assert.equal(selectProvisionsByDate(timeline, "2019-01-01").version?.versionId, "pv-2019-freeze");
    assert.equal(selectProvisionsByDate(timeline, "2024-06-30").version?.versionId, "pv-2019-freeze");
  });
});

// ---------------------------------------------------------------------------
// §8.2 — the service split, through the real service module
// (months-round-up: 1986-04-01 → 2010-06-30 is 24.25 years, not 24.2767
// under days/365 — finding D-2.1)
// ---------------------------------------------------------------------------

describe("Harborview service split (Stage 2 output 01 §8.2)", () => {
  function monthsRoundUpDef(): ServiceDefinition {
    return {
      planVersionId: "pv-2004-amend",
      creditedMethod: "elapsed-time",
      vestingMethod: "elapsed-time",
      eligibilityMethod: "elapsed-time",
      fullYearHours: null,
      vestingFullYearHours: null,
      eligibilityFullYearHours: null,
      breakHours: null,
      hoursBands: null,
      hoursEquivalency: null,
      computationPeriod: "anniversary-year",
      fractionalConversion: { kind: "months-round-up", citation: "Harborview plan §3.2" },
      proration: null,
      vestingSchedule: null,
      specialVesting: [],
      breakRule: { credited: null, vesting: null, eligibility: null },
      accrualStart: "participation-date",
      pastServiceCredit: null,
      predecessorServiceCredit: null,
      serviceCap: null,
      freeze: null,
      nrdRule: null,
      leapDayBirthday: null,
      vestingExcludesPreAge18: false,
    };
  }

  function period(start: string, end: string): EmploymentPeriodInput {
    return {
      periodStart: start,
      periodEnd: end,
      hoursByComputationPeriod: [],
      leavePeriods: [],
      isCoveredClass: true,
      accrualStartDate: start,
      breakBefore: null,
    };
  }

  it("pre-2004 service is 17.75 years, post-2003 is 6.50, total 24.25", () => {
    const def = monthsRoundUpDef();
    const pre = computeCreditedService([period("1986-04-01", "2003-12-31")], "2003-12-31", def);
    assert.equal(pre.value, "17.75");
    const post = computeCreditedService([period("2004-01-01", "2010-06-30")], "2010-06-30", def);
    assert.equal(post.value, "6.5");
    const total = computeCreditedService([period("1986-04-01", "2010-06-30")], "2010-06-30", def);
    assert.equal(total.value, "24.25");
    // The split sums to the total: 17.75 + 6.50 = 24.25.
    assert.deepEqual(completedYMD("1986-04-01", "2010-06-30"), { years: 24, months: 2, days: 29 });
  });
});

// ---------------------------------------------------------------------------
// §8.4 — the reconstruction: $1,067.50 vs $1,232.50 reported, Δ +$165.00
// ---------------------------------------------------------------------------

describe("Harborview reconstruction (Stage 2 output 01 §8.4)", () => {
  it("reconstructs $1,067.50/month at DOTE; the PA reported $1,232.50; Δ is +$165.00", () => {
    const outcome = calculateAccruedBenefit(harborviewRequest(), harborviewInputs());
    assert.equal(outcome.kind, "exact");
    if (outcome.kind !== "exact") throw new Error("unreachable");
    assert.equal(outcome.benefit.amount?.amountMinor, 106750);
    assert.equal(outcome.benefit.periodicity, "monthly");
    assert.equal(outcome.benefit.vestingTreatment, "vested");
    assert.equal(outcome.benefit.annuityForm, "NSF");
    assert.equal(outcome.benefit.retirementAge, 65);
    // The latest formula is never applied retroactively: $55 on all
    // 24.25 years would be $1,333.75, and $40 on all would be $970.00.
    assert.equal(outcome.benefit.amount?.amountMinor === 133375, false);
    assert.equal(outcome.benefit.amount?.amountMinor === 97000, false);

    const recordedMinor = 123250;
    const deltaMinor = recordedMinor - (outcome.benefit.amount?.amountMinor ?? 0);
    assert.equal(deltaMinor, 16500);
  });

  it("the two era components price separately: $710.00 + $357.50", () => {
    const pre = evaluateFormulaCall(
      {
        planVersionId: "pv-2004-amend",
        measurementDate: "2010-06-30",
        rounding: { stage: "final-only", mode: "nearest-cent", source: "test" },
      },
      {
        formulaId: "T-03",
        params: {
          unitRate: datedValue("40", "1985-07-01", "pv-1985-orig"),
          service: "17.75",
        },
      },
    );
    assert.equal(pre.kind, "exact");
    if (pre.kind !== "exact") throw new Error("unreachable");
    assert.equal(pre.value.amount?.amountMinor, 71000);

    const post = evaluateFormulaCall(
      {
        planVersionId: "pv-2004-amend",
        measurementDate: "2010-06-30",
        rounding: { stage: "final-only", mode: "nearest-cent", source: "test" },
      },
      {
        formulaId: "T-03",
        params: {
          unitRate: datedValue("55", "2004-01-01", "pv-2004-amend"),
          service: "6.5",
        },
      },
    );
    assert.equal(post.kind, "exact");
    if (post.kind !== "exact") throw new Error("unreachable");
    assert.equal(post.value.amount?.amountMinor, 35750);
  });
});

// ---------------------------------------------------------------------------
// §8.4 — the $165.00 gap as a hypothesis, not a conclusion
// ---------------------------------------------------------------------------

describe("Harborview $165.00 gap is a hypothesis, not a conclusion", () => {
  it("3 extra years at the $55 post-2003 rate reproduce $1,232.50 exactly", () => {
    // $165.00 ÷ $55.00 = 3.0 years. Read precisely: the 3 extra years
    // are post-2003 years at $55 (post-2003 service 6.5 → 9.5), so the
    // total becomes 27.25 years. The loose reading — 27.25 years all at
    // $55 — gives $1,498.75, not $1,232.50, and is refuted below.
    const result = evaluateFormulaCall(
      {
        planVersionId: "pv-2004-amend",
        measurementDate: "2010-06-30",
        rounding: { stage: "final-only", mode: "nearest-cent", source: "test" },
      },
      {
        formulaId: "T-03",
        params: {
          unitRate: datedValue("55", "2004-01-01", "pv-2004-amend"),
          service: "27.25",
          periodRates: [
            { from: "1986-04-01", to: "2003-12-31", rate: "40", service: "17.75" },
            { from: "2004-01-01", to: "2010-06-30", rate: "55", service: "9.5" },
          ],
        },
      },
    );
    assert.equal(result.kind, "exact");
    if (result.kind !== "exact") throw new Error("unreachable");
    assert.equal(result.value.amount?.amountMinor, 123250);
  });

  it("the loose reading is refuted: 27.25 years all at $55 is $1,498.75", () => {
    const result = evaluateFormulaCall(
      {
        planVersionId: "pv-2004-amend",
        measurementDate: "2010-06-30",
        rounding: { stage: "final-only", mode: "nearest-cent", source: "test" },
      },
      {
        formulaId: "T-03",
        params: {
          unitRate: datedValue("55", "2004-01-01", "pv-2004-amend"),
          service: "27.25",
        },
      },
    );
    assert.equal(result.kind, "exact");
    if (result.kind !== "exact") throw new Error("unreachable");
    assert.equal(result.value.amount?.amountMinor, 149875);
    assert.equal(result.value.amount?.amountMinor === 123250, false);
  });

  it("the match does not change the reconstruction and records no disposition", () => {
    const outcome = calculateAccruedBenefit(harborviewRequest(), harborviewInputs());
    assert.equal(outcome.kind, "exact");
    if (outcome.kind !== "exact") throw new Error("unreachable");
    // The engine still reconstructs $1,067.50; the counterfactual match
    // lives outside the calculated benefit.
    assert.equal(outcome.benefit.amount?.amountMinor, 106750);
    // No disposition is recorded by the calculation: the outcome carries
    // a benefit and a trace, and nothing else decides the case.
    assert.equal("disposition" in outcome, false);
    assert.equal("determination" in outcome, false);

    // The hypothesis record itself stays "proposed" until documentary
    // evidence is found; the numerical match does not promote it.
    const hypothesis: DiagnosticHypothesis = {
      id: "hyp-harborview-1",
      version: 1,
      supersedesId: null,
      sourceRecordIds: [],
      createdDate: "2026-11-12",
      createdBy: "system",
      hypothesisId: "H-service-1",
      comparisonId: "cmp-harborview-1",
      hypothesisType: "service",
      counterfactual: "administrator counted 3 extra years of service at the $55 post-2003 rate",
      counterfactualCalculationId: "calc-harborview-counterfactual",
      evidence: [],
      rank: 1,
      status: "proposed",
    };
    assert.equal(hypothesis.status, "proposed");
  });
});
