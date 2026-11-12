/**
 * Stage 5 (Worker 4) unit tests — the three Stage 4 open items.
 *
 * (1) CalculationRequest ServiceDefinition gap: an optional
 *     caller-supplied ServiceDefinition + EmploymentPeriodInput[] on the
 *     request; Stage 3 then derives service from src/service.ts
 *     (serviceAtDate). Without them the ServiceHistory derivation is
 *     unchanged. An incomplete definition is refused (rule D-0), never
 *     completed with a default.
 * (2) Formula-level per-scenario traces: every scenario a formula
 *     function returns carries its own derivation trace; combineResults
 *     carries traces through combination; a genuinely untraced scenario
 *     stays null (reported, never fabricated).
 * (3) X-02 refusal: X-02 (IRC §401(a)(17) per-year compensation
 *     transform) is refused as a Stage 5 formula call with a typed
 *     indeterminate result — not a throw in the calculation path.
 *
 * Plain node:test + node:assert. Synthetic data only — fictional
 * participant SYN-SD-001, St. Rose §3.2(b) months rule used only as the
 * test fixture's stated conversion rule. No live case data.
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
  TypedBenefitQuantity,
} from "../src/types.js";
import {
  calcFinalOrHighestAverage,
  calcFlatDollar,
  capCompensationYear,
  datedValue,
  evaluateFormulaCall,
  makeBenefit,
  namedScenario,
} from "../src/formulas.js";
import type { CalcContext, CalcResult } from "../src/types.js";
import { combineResults } from "../src/compose.js";
import {
  allScenariosTraced,
  generateScenarios,
  untracedScenarios,
} from "../src/bounds.js";
import {
  computeCreditedService,
  employmentPeriodInputFromEmploymentPeriod,
  type EmploymentPeriodInput,
  type ServiceDefinition,
} from "../src/service.js";
import { calculateAccruedBenefit } from "../src/pipeline.js";
import type { PipelineInputs } from "../src/pipeline.js";

// ---------------------------------------------------------------------------
// Fixtures (endtoend-style; fictional participant SYN-SD-001)
// ---------------------------------------------------------------------------

function prov(): Provenance {
  return {
    documentId: "doc-sd",
    location: { kind: "user-entered", enteredBy: "tester", enteredDate: "2026-01-01", entryForm: "test" },
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
  return { id, version: 1, supersedesId: null, sourceRecordIds: [], createdDate: "2026-01-01", createdBy: "tester" };
}

function planVersion(versionId: string, effectiveDate: string, formulaIds: string[]): PlanVersion {
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
    participantKey: "SYN-SD-001",
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
    participantKey: "SYN-SD-001",
    asOfDate: sourced("2020-01-01"),
    paCreditedService: sourced(creditedService),
    paVestingService: sourced(creditedService),
    paEligibilityService: sourced(creditedService),
    bcvCreditedService: sourced(creditedService),
    bcvVestingService: sourced(creditedService),
    bcvEligibilityService: sourced(creditedService),
    paVestingPercent: sourced(vestingPercent),
    bcvVestingPercent: sourced(vestingPercent),
    serviceMeasure: "years",
    servicePeriods: periods.map((p) => ({ start: p.start, end: p.end, measure: p.measure, provenance: prov() })),
    breaksApplied: [],
    distributions: [],
  };
}

function compensationHistory(
  salaries: Array<{ year: number; minor: number | null }>,
): CompensationHistory {
  return {
    ...entity("ch-1"),
    participantKey: "SYN-SD-001",
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

/** Caller-supplied per-plan service definition (test fixture). Elapsed
 *  time, months-round-up conversion (St. Rose §3.2(b) shape), accrual
 *  from hire, cliff vesting at 5 years. Every field is stated here —
 *  none is a default. */
function hireDateDef(overrides: Partial<ServiceDefinition> = {}): ServiceDefinition {
  return {
    planVersionId: "pv-test-1",
    creditedMethod: "elapsed-time",
    vestingMethod: "elapsed-time",
    eligibilityMethod: "elapsed-time",
    fullYearHours: null,
    vestingFullYearHours: null,
    eligibilityFullYearHours: null,
    breakHours: null,
    hoursBands: null,
    hoursEquivalency: null,
    computationPeriod: null,
    fractionalConversion: { kind: "months-round-up", citation: "St. Rose §3.2(b) (test fixture)" },
    proration: null,
    vestingSchedule: [
      { minWholeYears: 0, maxWholeYears: 4, percent: "0", ruleRef: "test schedule §8.02" },
      { minWholeYears: 5, maxWholeYears: null, percent: "1", ruleRef: "test schedule §8.02" },
    ],
    specialVesting: [],
    breakRule: { credited: null, vesting: null, eligibility: null },
    accrualStart: "hire-date",
    pastServiceCredit: null,
    predecessorServiceCredit: null,
    serviceCap: null,
    freeze: null,
    nrdRule: null,
    leapDayBirthday: null,
    vestingExcludesPreAge18: false,
    ...overrides,
  };
}

function periodInput(start: string, end: string | null): EmploymentPeriodInput {
  return {
    periodStart: start,
    periodEnd: end,
    hoursByComputationPeriod: [],
    leavePeriods: [],
    isCoveredClass: true,
    accrualStartDate: null,
    breakBefore: null,
  };
}

const SALARIES = [
  { year: 2017, minor: 5760000 },
  { year: 2018, minor: 6000000 },
  { year: 2019, minor: 6240000 },
];

function makeRequest(args: {
  serviceDefinition?: ServiceDefinition | null;
  employmentPeriods?: EmploymentPeriodInput[] | null;
  serviceHistory: ServiceHistory | null;
}): CalculationRequest {
  return {
    participantKey: "SYN-SD-001",
    participantHistory: {
      participantKey: "SYN-SD-001",
      employmentPeriods: [employmentPeriod("2000-01-01", "2020-01-01")],
      compensationHistory: compensationHistory(SALARIES),
      serviceHistory: args.serviceHistory,
      benefitObservations: [],
    },
    provisionTimeline: {
      planId: "plan-1",
      versions: [planVersion("v1", "1985-07-01", ["T-04", "T-06"])],
    },
    measurementDate: "2020-01-01",
    measurementBasis: "dote",
    calculationKind: "accrued",
    formulaId: "T-04",
    roundingConfig: roundingConfig(),
    tolerance: tolerance(),
    ...(args.serviceDefinition !== undefined
      ? { serviceDefinition: args.serviceDefinition }
      : {}),
    ...(args.employmentPeriods !== undefined
      ? { employmentPeriods: args.employmentPeriods }
      : {}),
    runContext: {
      engineVersion: "0.1.0",
      ruleVersion: "2026-11-12",
      formulaTaxonomyVersion: "1.0",
      inputSnapshotHash: "test",
    },
  };
}

function t04Inputs(): PipelineInputs {
  return {
    recordedPaAmb: null,
    formulaCall: {
      formulaId: "T-04",
      params: {
        accrualRate: datedValue("0.015", "1985-07-01", "v1"),
        avgComp: "60000",
        service: "20",
      },
    },
    averagingPeriod: { kind: "final", years: 3, description: "final-3-year", ruleRef: "plan §5.01" },
    requiredBasis: { annuityForm: "NSF", retirementAge: 65 },
  };
}

const ctx: CalcContext = {
  planVersionId: "v1",
  measurementDate: "2020-01-01",
  rounding: { stage: "final-only", mode: "nearest-cent", source: "test" },
};

function creditedStep(outcome: { trace: Array<{ name: string; inputs: Array<{ field: string; value: unknown }> }> }): { name: string; inputs: Array<{ field: string; value: unknown }> } | undefined {
  return outcome.trace.find((s) => s.name === "credited-service");
}

// ---------------------------------------------------------------------------
// (1) CalculationRequest ServiceDefinition gap
// ---------------------------------------------------------------------------

describe("ServiceDefinition on CalculationRequest (Stage 4 open item 1)", () => {
  it("with a supplied definition, service comes from service.ts", () => {
    const def = hireDateDef();
    const periods = [periodInput("2000-01-01", "2020-01-01")];
    // Direct cross-check: the service module itself derives 20 years.
    assert.equal(computeCreditedService(periods, "2020-01-01", def).value, "20");
    const request = makeRequest({
      serviceDefinition: def,
      employmentPeriods: periods,
      serviceHistory: null,
    });
    const outcome = calculateAccruedBenefit(request, t04Inputs());
    assert.equal(outcome.kind, "exact", `expected exact, got ${outcome.kind}`);
    if (outcome.kind !== "exact") throw new Error("unreachable");
    // T-04: 0.015 × $60,000 × 20 / 12 = $1,500.00/month.
    assert.equal(outcome.benefit.amount?.amountMinor, 150000);
    const step = creditedStep(outcome);
    if (step === undefined) throw new Error("credited-service step is missing");
    const source = step.inputs.find((i) => i.field === "source")?.value;
    assert.equal(typeof source, "string");
    assert.ok(
      (source as string).includes("ServiceDefinition"),
      `expected the step to name the ServiceDefinition source, got ${String(source)}`,
    );
    assert.equal(step.inputs.find((i) => i.field === "creditedService")?.value, "20");
    assert.equal(step.inputs.find((i) => i.field === "vestingService")?.value, "20");
    assert.equal(step.inputs.find((i) => i.field === "eligibilityService")?.value, "20");
  });

  it("without a definition, the ServiceHistory derivation is unchanged", () => {
    const request = makeRequest({
      serviceHistory: serviceHistory(
        [{ start: "2000-01-01", end: "2020-01-01", measure: 20 }],
        20,
        "1",
      ),
    });
    const outcome = calculateAccruedBenefit(request, t04Inputs());
    assert.equal(outcome.kind, "exact");
    if (outcome.kind !== "exact") throw new Error("unreachable");
    assert.equal(outcome.benefit.amount?.amountMinor, 150000);
    const step = creditedStep(outcome);
    if (step === undefined) throw new Error("credited-service step is missing");
    const source = step.inputs.find((i) => i.field === "source")?.value;
    assert.equal(typeof source, "string");
    assert.ok(
      (source as string).includes("ServiceHistory"),
      `expected the old ServiceHistory source, got ${String(source)}`,
    );
    assert.equal(step.inputs.find((i) => i.field === "creditedService")?.value, "20");
  });

  it("an incomplete definition refuses rather than inventing service", () => {
    // (c1) No credited method stated: no rule exists to derive service.
    const noMethod = makeRequest({
      serviceDefinition: hireDateDef({ creditedMethod: null }),
      employmentPeriods: [periodInput("2000-01-01", "2020-01-01")],
      serviceHistory: null,
    });
    const out1 = calculateAccruedBenefit(noMethod, t04Inputs());
    assert.equal(out1.kind, "indeterminate");
    if (out1.kind !== "indeterminate") throw new Error("unreachable");
    assert.ok(out1.reason.detail.includes("ServiceDefinition"), out1.reason.detail);
    assert.ok(out1.reason.detail.includes("creditedMethod"), out1.reason.detail);

    // (c2) Definition without periods: a definition alone cannot derive
    // service, and periods are never guessed.
    const noPeriods = makeRequest({
      serviceDefinition: hireDateDef(),
      employmentPeriods: [],
      serviceHistory: null,
    });
    const out2 = calculateAccruedBenefit(noPeriods, t04Inputs());
    assert.equal(out2.kind, "indeterminate");
    if (out2.kind !== "indeterminate") throw new Error("unreachable");
    assert.ok(out2.reason.detail.includes("EmploymentPeriodInput"), out2.reason.detail);

    // (c3) Participation-date accrual start with no participation date
    // on the period: the accrual start is unknown, not the hire date.
    const noPartDate = makeRequest({
      serviceDefinition: hireDateDef({ accrualStart: "participation-date" }),
      employmentPeriods: [periodInput("2000-01-01", "2020-01-01")],
      serviceHistory: null,
    });
    const out3 = calculateAccruedBenefit(noPartDate, t04Inputs());
    assert.equal(out3.kind, "indeterminate");
    if (out3.kind !== "indeterminate") throw new Error("unreachable");
    assert.ok(out3.reason.detail.includes("participationDate"), out3.reason.detail);
  });

  it("the definition path honours the plan's own service cap", () => {
    const def = hireDateDef({
      serviceCap: { maxYears: "10", whichYears: "last-n", ruleRef: "test cap §5.01" },
    });
    const request = makeRequest({
      serviceDefinition: def,
      employmentPeriods: [periodInput("2000-01-01", "2020-01-01")],
      serviceHistory: null,
    });
    const outcome = calculateAccruedBenefit(request, t04Inputs());
    assert.equal(outcome.kind, "exact");
    if (outcome.kind !== "exact") throw new Error("unreachable");
    // Service capped at 10 years: 0.015 × $60,000 × 10 / 12 = $750.00.
    assert.equal(outcome.benefit.amount?.amountMinor, 75000);
    const step = creditedStep(outcome);
    if (step === undefined) throw new Error("credited-service step is missing");
    assert.equal(step.inputs.find((i) => i.field === "creditedService")?.value, "10");
  });

  it("employmentPeriodInputFromEmploymentPeriod maps only what is stored", () => {
    const converted = employmentPeriodInputFromEmploymentPeriod(
      employmentPeriod("2000-01-01", "2020-01-01"),
      null,
    );
    assert.equal(converted.periodStart, "2000-01-01");
    assert.equal(converted.periodEnd, "2020-01-01");
    assert.deepEqual(converted.hoursByComputationPeriod, []);
    assert.equal(converted.accrualStartDate, null);
    assert.equal(converted.breakBefore, null);
    // An hours-based definition over a converted period computes from
    // zero computation periods (value "0", no period traces): the
    // converter carries no hours, so it cannot represent hours-based
    // service at all. That is why the definition path needs
    // caller-supplied EmploymentPeriodInput[] with hours for hours-based
    // plans — the converter is elapsed-time only in effect, and must
    // not be used to stand in for hours data.
    const hoursDef = hireDateDef({ creditedMethod: "hours-based", fractionalConversion: null });
    const result = computeCreditedService([converted], "2020-01-01", hoursDef);
    assert.equal(result.value, "0");
    assert.equal(result.periods.length, 0);
  });
});

// ---------------------------------------------------------------------------
// (2) Formula-level per-scenario traces
// ---------------------------------------------------------------------------

describe("formula-level per-scenario traces (Stage 4 open item 2)", () => {
  it("T-06 highest-vs-final scenarios each carry their own trace", () => {
    const result = calcFinalOrHighestAverage(ctx, {
      accrualRate: datedValue("0.015", "1985-07-01", "v1"),
      windowYears: 3,
      windowKind: "final",
      compByYear: [
        { year: 2016, comp: "66000" },
        { year: 2017, comp: "57600" },
        { year: 2018, comp: "60000" },
        { year: 2019, comp: "62400" },
      ],
      service: "20",
      windowKindUnknown: true,
    });
    assert.equal(result.kind, "scenarios");
    if (result.kind !== "scenarios") throw new Error("unreachable");
    assert.equal(result.scenarios.length, 2);
    for (const s of result.scenarios) {
      const trace = s.trace;
      if (trace === null || trace === undefined) throw new Error(`scenario ${s.name} has no trace`);
      assert.equal(trace.length, 1);
      const step = trace[0];
      assert.equal(step?.name, "scenario-T-06");
      assert.equal(step?.evidenceGrade, "estimate");
      assert.equal(step?.output, s.value.amount?.amountMinor ?? null);
      assert.ok(
        (step?.inputs.find((i) => i.field === "windowKind")?.value ?? null) !== null,
        "the trace names the distinguishing window kind",
      );
    }
    // The two traces differ: they record different averaging windows.
    const kinds = result.scenarios.map(
      (s) => s.trace?.[0]?.inputs.find((i) => i.field === "windowKind")?.value,
    );
    assert.deepEqual(kinds, ["highest", "final"]);
  });

  it("T-01 candidate-full-service scenarios each carry a trace", () => {
    const result = calcFlatDollar(ctx, {
      flatAmount: datedValue("2000", "1985-07-01", "v1"),
      service: "20",
      fullService: "30",
      fullServiceCandidates: ["25", "30"],
    });
    assert.equal(result.kind, "scenarios");
    if (result.kind !== "scenarios") throw new Error("unreachable");
    for (const s of result.scenarios) {
      const trace = s.trace;
      if (trace === undefined || trace === null) throw new Error(`scenario ${s.name} has no trace`);
      assert.equal(trace[0]?.name, "scenario-T-01");
      assert.equal(
        trace[0]?.inputs.find((i) => i.field === "fullService")?.value,
        s.name.replace("full service ", "").replace(" years", ""),
      );
    }
  });

  it("combineResults carries traces through combination, renumbered", () => {
    const scenarios = calcFinalOrHighestAverage(ctx, {
      accrualRate: datedValue("0.015", "1985-07-01", "v1"),
      windowYears: 3,
      windowKind: "final",
      compByYear: [
        { year: 2016, comp: "66000" },
        { year: 2017, comp: "57600" },
        { year: 2018, comp: "60000" },
        { year: 2019, comp: "62400" },
      ],
      service: "20",
      windowKindUnknown: true,
    });
    const exact: CalcResult<TypedBenefitQuantity> = {
      kind: "exact",
      value: makeBenefit(ctx, makeMoney(10000), "monthly"),
      evidenceGrade: "fact",
    };
    const combined = combineResults([scenarios, exact], "sum");
    assert.equal(combined.kind, "scenarios");
    if (combined.kind !== "scenarios") throw new Error("unreachable");
    assert.equal(combined.scenarios.length, 2);
    for (const s of combined.scenarios) {
      const trace = s.trace;
      if (trace === undefined || trace === null) throw new Error(`combined scenario ${s.name} lost its trace`);
      assert.equal(trace.length, 1);
      assert.equal(trace[0]?.step, 1);
      assert.equal(trace[0]?.name, "scenario-T-06");
    }
    // Combined amounts: T-06 scenario + $100.00.
    // Highest-3 average is $61,200 (2016–2018) → $1,530.00; final-3 is
    // $60,000 → $1,500.00; each plus the $100.00 exact component.
    assert.deepEqual(
      combined.scenarios.map((s) => s.value.amount?.amountMinor ?? -1),
      [163000, 160000],
    );
  });

  it("a scenario without a trace stays untraced — reported, not fabricated", () => {
    const untraced = generateScenarios({
      endpoints: [
        { name: "missing input at lower bound", assumptions: "low fill", benefit: makeMoney(158400) },
        { name: "missing input at upper bound", assumptions: "high fill", benefit: makeMoney(168300) },
      ],
      planVersionId: "v1",
      formulaId: "T-04",
    });
    assert.ok(untraced.every((s) => s.trace === null || s.trace === undefined));
    assert.deepEqual(
      untracedScenarios(untraced).map((s) => s.name),
      ["missing input at lower bound", "missing input at upper bound"],
    );
    assert.equal(allScenariosTraced(untraced), false);
    // Combining untraced scenarios does not invent a trace.
    const combined = combineResults(
      [
        {
          kind: "scenarios",
          scenarios: untraced.map((s) => ({
            name: s.name,
            value: makeBenefit(ctx, s.benefit ?? makeMoney(0), "monthly"),
            basis: s.assumptions,
            trace: s.trace,
          })),
          evidenceGrade: "estimate",
          missingInputs: ["test"],
        },
        {
          kind: "exact",
          value: makeBenefit(ctx, makeMoney(0), "monthly"),
          evidenceGrade: "fact",
        },
      ],
      "sum",
    );
    assert.equal(combined.kind, "scenarios");
    if (combined.kind !== "scenarios") throw new Error("unreachable");
    assert.ok(combined.scenarios.every((s) => s.trace === null));
  });

  it("the pipeline bounds path forwards formula-level scenario traces", () => {
    const request = makeRequest({
      serviceHistory: serviceHistory(
        [{ start: "2000-01-01", end: "2020-01-01", measure: 20 }],
        20,
        "1",
      ),
    });
    const inputs: PipelineInputs = {
      recordedPaAmb: null,
      formulaCall: {
        formulaId: "T-06",
        params: {
          accrualRate: datedValue("0.015", "1985-07-01", "v1"),
          windowYears: 3,
          windowKind: "final",
          compByYear: [
            { year: 2016, comp: "66000" },
            { year: 2017, comp: "57600" },
            { year: 2018, comp: "60000" },
            { year: 2019, comp: "62400" },
          ],
          service: "20",
          windowKindUnknown: true,
        },
      },
      averagingPeriod: { kind: "final", years: 3, description: "final-3-year", ruleRef: "plan §5.01" },
      requiredBasis: { annuityForm: "NSF", retirementAge: 65 },
    };
    const outcome = calculateAccruedBenefit({ ...request, formulaId: "T-06" }, inputs);
    assert.equal(outcome.kind, "bounds");
    if (outcome.kind !== "bounds") throw new Error("unreachable");
    assert.equal(outcome.bounds.scenarios.length, 2);
    assert.equal(allScenariosTraced(outcome.bounds.scenarios), true);
    for (const s of outcome.bounds.scenarios) {
      const trace = s.trace;
      if (trace === null || trace === undefined) throw new Error(`scenario ${s.name} has no trace`);
      assert.equal(trace[0]?.name, "scenario-T-06");
    }
  });

  it("namedScenario records the scenario amount as the trace output", () => {
    const s = namedScenario({
      name: "test scenario",
      value: makeBenefit(ctx, makeMoney(123456), "monthly"),
      basis: "test",
      formulaId: "T-04",
      inputs: [{ field: "service", value: "20" }],
      ruleRef: "test rule",
    });
    assert.equal(s.trace?.length, 1);
    assert.equal(s.trace?.[0]?.output, 123456);
    assert.equal(s.trace?.[0]?.evidenceGrade, "estimate");
  });
});

// ---------------------------------------------------------------------------
// (3) X-02 refusal
// ---------------------------------------------------------------------------

describe("X-02 refusal (Stage 4 open item 3)", () => {
  it("evaluateFormulaCall refuses X-02 as a typed indeterminate, not a throw", () => {
    const result = evaluateFormulaCall(ctx, {
      formulaId: "X-02",
      params: {
        compByYear: [{ year: 2020, comp: "300000" }],
        compLimitTable: null,
      },
    });
    assert.equal(result.kind, "indeterminate");
    if (result.kind !== "indeterminate") throw new Error("unreachable");
    assert.ok(
      result.missingInputs.some((m) => m.includes("X-02 is a per-year compensation transform")),
      result.missingInputs.join("; "),
    );
    assert.ok(
      result.wouldResolve.some((w) => w.includes("capCompensationYear")),
      result.wouldResolve.join("; "),
    );
  });

  it("the pipeline refuses an X-02 Stage 5 call as indeterminate, not a throw", () => {
    const request = makeRequest({
      serviceHistory: serviceHistory(
        [{ start: "2000-01-01", end: "2020-01-01", measure: 20 }],
        20,
        "1",
      ),
    });
    const inputs: PipelineInputs = {
      recordedPaAmb: null,
      formulaCall: {
        formulaId: "X-02",
        params: {
          compByYear: [{ year: 2020, comp: "300000" }],
          compLimitTable: null,
        },
      },
      averagingPeriod: { kind: "final", years: 3, description: "final-3-year", ruleRef: "plan §5.01" },
      requiredBasis: { annuityForm: "NSF", retirementAge: 65 },
    };
    const outcome = calculateAccruedBenefit({ ...request, formulaId: "X-02" }, inputs);
    assert.equal(outcome.kind, "indeterminate");
    if (outcome.kind !== "indeterminate") throw new Error("unreachable");
    assert.ok(outcome.reason.detail.includes("X-02"), outcome.reason.detail);
  });

  it("capCompensationYear itself still works as the per-year transform", () => {
    const capped = capCompensationYear(ctx, {
      compByYear: [
        { year: 2019, comp: "300000" },
        { year: 2020, comp: "200000" },
      ],
      compLimitTable: {
        limitsByYear: { 2019: "280000", 2020: "285000" },
        source: "test table (IRC §401(a)(17) limits, test values)",
      },
    });
    assert.deepEqual(capped.cappedByYear, [
      { year: 2019, comp: "280000" },
      { year: 2020, comp: "200000" },
    ]);
  });
});
