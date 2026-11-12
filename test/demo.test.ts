/**
 * Demo case end-to-end test (Stage 6, Worker D).
 *
 * The fictional Harborview demo case runs through the real engine:
 * import (validateCasePackage) -> calculate (calculateAccruedBenefit)
 * -> reconcile (buildReconciliationInputs) -> decide (mapDisposition).
 * The decide step only recommends: a recommendation is never an
 * approval, and the test asserts that too.
 *
 * Synthetic data only. All participant keys start with "SYN-".
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEMO_CASE_PACKAGE, DEMO_TOLERANCE } from "../src/ui/demo.js";
import {
  renderContextHelp,
  renderHelpCentre,
  runOnboarding,
} from "../src/ui/onboarding.js";
import { makeMoney } from "../src/decimal.js";
import { datedValue, makeBenefit } from "../src/formulas.js";
import { calculateAccruedBenefit } from "../src/pipeline.js";
import type { PipelineInputs } from "../src/pipeline.js";
import { buildReconciliationInputs } from "../src/reconciliation.js";
import { validateCasePackage } from "../src/validation.js";
import type {
  ValidationContext,
  ValidationParticipant,
} from "../src/validation.js";
import {
  mapDisposition,
  recommendationIsNotApproval,
} from "../src/dispositionMapping.js";
import type { DispositionEvidence } from "../src/dispositionMapping.js";
import type {
  CalculationOutcome,
  CalculationRequest,
  RoundingConfig,
  ToleranceRecord,
  TypedBenefitQuantity,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers: read the demo package
// ---------------------------------------------------------------------------

function must<T>(value: T | undefined, what: string): T {
  assert.notEqual(value, undefined, `${what} is missing from the demo case`);
  return value as T;
}

function mustString(value: string | null | undefined, what: string): string {
  assert.notEqual(value, null, `${what} is missing from the demo case`);
  assert.notEqual(value, undefined, `${what} is missing from the demo case`);
  return value as string;
}

function participantKeyList(): string[] {
  return DEMO_CASE_PACKAGE.participants.map((p) => p.participantKey);
}

function recordedMinor(key: string): number | null {
  const obs = must(
    DEMO_CASE_PACKAGE.benefitObservations.find((o) => o.participantKey === key),
    `observation for ${key}`,
  );
  return obs.paAmb.value?.amountMinor ?? null;
}

function doteOf(key: string): string | null {
  const obs = must(
    DEMO_CASE_PACKAGE.benefitObservations.find((o) => o.participantKey === key),
    `observation for ${key}`,
  );
  return obs.measurementDate;
}

// ---------------------------------------------------------------------------
// Pipeline inputs per participant (formula T-04, 1.5%, final-3-year)
// ---------------------------------------------------------------------------

const FORMULA_PARAMS: Record<
  string,
  { avgComp: string; service: string }
> = {
  "SYN-001": { avgComp: "60000", service: "20" },
  "SYN-002": { avgComp: "60000", service: "22" },
  "SYN-003": { avgComp: "60000", service: "20" },
  "SYN-004": { avgComp: "49600", service: "15" },
  "SYN-V-01": { avgComp: "33980", service: "20" },
  "SYN-I-01": { avgComp: "60000", service: "20" },
};

function roundingConfig(): RoundingConfig {
  return {
    configId: "rc-demo",
    version: "rounding-config v1.0.0",
    planVersionId: "pv-demo-1985",
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
    setBy: "demo",
    setDate: "2026-11-12",
    rationale: "demo fixture",
  };
}

function tolerance(): ToleranceRecord {
  return DEMO_TOLERANCE;
}

function recordedBenefit(key: string): TypedBenefitQuantity | null {
  const minor = recordedMinor(key);
  const dote = doteOf(key);
  if (minor === null || dote === null) return null;
  return makeBenefit(
    {
      planVersionId: "pv-demo-1985",
      measurementDate: dote,
      rounding: { stage: "final-only", mode: "nearest-cent", source: "demo" },
    },
    makeMoney(minor),
    "monthly",
    undefined,
    "prior-administrator",
  );
}

function buildRequest(key: string): CalculationRequest {
  const participant = must(
    DEMO_CASE_PACKAGE.participants.find((p) => p.participantKey === key),
    `participant ${key}`,
  );
  const employmentPeriods = DEMO_CASE_PACKAGE.employmentPeriods.filter(
    (e) => e.participantKey === key,
  );
  const compensationHistory = must(
    DEMO_CASE_PACKAGE.compensationHistories.find(
      (c) => c.participantKey === key,
    ),
    `compensation history for ${key}`,
  );
  const serviceHistory = must(
    DEMO_CASE_PACKAGE.serviceHistories.find((s) => s.participantKey === key),
    `service history for ${key}`,
  );
  const dote = doteOf(key);
  return {
    participantKey: key,
    participantHistory: {
      participantKey: key,
      employmentPeriods,
      compensationHistory,
      serviceHistory,
      benefitObservations: [],
    },
    provisionTimeline: {
      planId: "plan-harborview",
      versions: DEMO_CASE_PACKAGE.planVersions,
    },
    measurementDate: dote,
    measurementBasis: dote === null ? "unresolved" : "dote",
    calculationKind: "accrued",
    formulaId: "T-04",
    roundingConfig: roundingConfig(),
    tolerance: tolerance(),
    runContext: {
      engineVersion: "0.1.0",
      ruleVersion: "2026-11-12",
      formulaTaxonomyVersion: "1.0",
      inputSnapshotHash: "demo",
    },
  };
}

function buildInputs(key: string): PipelineInputs {
  const params = must(FORMULA_PARAMS[key], `formula params for ${key}`);
  const inputs: PipelineInputs = {
    formulaCall: {
      formulaId: "T-04",
      params: {
        accrualRate: datedValue("0.015", "1985-07-01", "pv-demo-1985"),
        avgComp: params.avgComp,
        service: params.service,
      },
    },
    recordedPaAmb: recordedBenefit(key),
    averagingPeriod: {
      kind: "final",
      years: 3,
      description: "final-3-year",
      ruleRef: "plan §5.01",
    },
    requiredBasis: { annuityForm: "NSF", retirementAge: 65 },
  };
  if (key === "SYN-002") {
    inputs.boundsSpec = {
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
    };
  }
  if (key === "SYN-004") {
    inputs.boundsSpec = {
      ranges: [
        {
          field: "CompensationHistory.salaryYear 2020",
          missingClass: "c",
          low: "45600",
          high: "55200",
          unit: "annual-compensation-dollars",
          basis: "prior-year salary bounded by the plan's pay scale",
        },
      ],
      assumptions: ["formula T-04 applies to all service"],
    };
  }
  return inputs;
}

function runEngine(key: string): CalculationOutcome {
  return calculateAccruedBenefit(buildRequest(key), buildInputs(key));
}

// ---------------------------------------------------------------------------
// Validation input per participant, mapped from the demo package
// ---------------------------------------------------------------------------

function ageAt(dob: string, date: string): number {
  const years = Number(date.slice(0, 4)) - Number(dob.slice(0, 4));
  return date.slice(5) < dob.slice(5) ? years - 1 : years;
}

function nrdOf(dob: string): string {
  return `${Number(dob.slice(0, 4)) + 65}${dob.slice(4)}`;
}

function toValidationParticipant(key: string): ValidationParticipant {
  const p = must(
    DEMO_CASE_PACKAGE.participants.find((x) => x.participantKey === key),
    `participant ${key}`,
  );
  const ep = must(
    DEMO_CASE_PACKAGE.employmentPeriods.find((x) => x.participantKey === key),
    `employment period for ${key}`,
  );
  const ch = must(
    DEMO_CASE_PACKAGE.compensationHistories.find(
      (x) => x.participantKey === key,
    ),
    `compensation history for ${key}`,
  );
  const sh = must(
    DEMO_CASE_PACKAGE.serviceHistories.find((x) => x.participantKey === key),
    `service history for ${key}`,
  );
  const dob = mustString(p.dob.value, `dob for ${key}`);
  const dote = ep.dote.value;
  const service = sh.paCreditedService.value;
  const serviceStr = service === null ? null : String(service);
  const knownSalaries = ch.salaryByYear.filter((s) => s.amount !== null);
  const meanAnnualMinor =
    knownSalaries.length === 0
      ? null
      : Math.round(
          knownSalaries.reduce((sum, s) => sum + (s.amount?.amountMinor ?? 0), 0) /
            knownSalaries.length,
        );
  const lastSalary = knownSalaries[knownSalaries.length - 1];
  const formulaCheck: Record<string, number> = {
    "SYN-001": 150000,
    "SYN-003": 150000,
    "SYN-V-01": 84950,
  };
  const checkValue = formulaCheck[key] ?? null;
  return {
    participantKey: key,
    bcvRecId: p.bcvRecId.value,
    caseNumber: "00098765",
    idType: "1",
    ssn: null,
    firstName: p.firstName.value,
    lastName: p.lastName.value,
    dob,
    sex: p.sex.value,
    dateOfDeath: null,
    retstat: "2",
    rettyp: null,
    doh: ep.doh.value,
    dote,
    dop: ep.dop.value,
    dobfParticipant: null,
    dor: null,
    postDoptDote: null,
    nrd: nrdOf(dob),
    anb: dote === null ? null : ageAt(dob, dote),
    sanb: null,
    rbd: nrdOf(dob),
    rbdDeterminable: true,
    rbdMissingFields: [],
    inPayAtDopt: null,
    isPreDoptRetiree: false,
    isDeferredRecord: true,
    sbcd: null,
    spouseSsn: null,
    spouseLastName: null,
    spouseDob: null,
    spouseSex: null,
    spouseDateOfDeath: null,
    benSsn: null,
    benLastName: null,
    benDob: null,
    benSex: null,
    benDateOfDeath: null,
    apDob: null,
    apSex: null,
    apDateOfDeath: null,
    cspa: serviceStr,
    vspa: serviceStr,
    espa: serviceStr,
    cs: serviceStr,
    vs: serviceStr,
    es: serviceStr,
    csUnit: "years",
    vsUnit: "years",
    vppa: "1",
    paAmb: recordedMinor(key),
    paAcomp: meanAnnualMinor === null ? null : Math.round(meanAnnualMinor / 12),
    paAcompPeriodicity: "monthly",
    cuComp:
      lastSalary?.amount === null || lastSalary?.amount === undefined
        ? null
        : Math.round((lastSalary.amount.amountMinor ?? 0) / 12),
    pia: null,
    integrationMethod: "none",
    firstYear: ch.firstYear.value,
    lastYear: ch.lastYear.value,
    salaryByYear: ch.salaryByYear.map((s) => ({
      year: s.salaryYear,
      amount: s.amount?.amountMinor ?? null,
    })),
    annact: "A",
    annualizationBasisNoted: true,
    averagingPeriodYears: knownSalaries.map((s) => s.salaryYear),
    formCode: dote === null ? null : "NSF",
    formCodeNsf: "NSF",
    formCodeNmf: "NMF",
    formCodeQpsa: null,
    formCodeArd: null,
    spcVal: "0",
    spcNsf: "0",
    spcArd: "0",
    mths: 0,
    mthsNsf: 0,
    mthsArd: 0,
    formCodeIsJointLife: false,
    recordIsSingleLife: true,
    lsTerm: "N",
    xrd: nrdOf(dob),
    xrdMbTerm: recordedMinor(key),
    pvReteec: null,
    measurementDate: dote,
    recordedDate: dote === null ? null : "2020-03-15",
    measurementDisagreementExplained: false,
    assertedBasisNrd: false,
    nrdBasisEvidence: false,
    explicitNoBenefitStatement: false,
    vestingTreatment: "gross",
    annuityForm: dote === null ? null : "NSF",
    annuityFormConversionDocumented: false,
    calcMeasurementDate: dote,
    calcAnnuityForm: dote === null ? null : "NSF",
    calcVestingTreatment: "gross",
    planFreezeDate: null,
    accrualAfterFreeze: false,
    benefitReflectsPostFreezeAccrual: false,
    mandcwi: null,
    volcwi: null,
    cashBalDopt: null,
    formulaType: "unit-credit",
    contributionTreatmentDocumented: true,
    cashBalanceExplanationDocumented: true,
    documentedMinimumOrGrandfatherOrPastServiceCredit: false,
    participationBeforeEligibility: false,
    serviceAccruesBeforeDop: false,
    parseError: null,
    badDates: [],
    badNumbers: [],
    fieldsWithoutProvenance: [],
    supportingEvidenceForScale: true,
    s001Derivable: true,
    scheduleProvided: true,
    scheduleRowExists: true,
    schedulePaAmb: recordedMinor(key),
    scheduleExplanationDocumented: false,
    bcvComparison: null,
    paymentAmountMinor: null,
    convertedPaAmbMinor: null,
    ardFactorsPresent: false,
    priorDistribution: null,
    formulaCheckValueMinor: checkValue,
    formulaKnownForX06: true,
    formulaCheckValuesMinor: checkValue === null ? null : [checkValue],
    documentedHypothesis: false,
    pfFactors: null,
    proposedDisposition: null,
    evidenceCount: 0,
    paAmbAccept: null,
    disposition: null,
    decisionExists: false,
    rejectionRationaleStated: false,
    sourcesUsed: [],
    candidateMeasurementDates: dote === null ? [] : [dote],
    establishedMeasurementDate: dote,
    prior: null,
  };
}

function validationContext(): ValidationContext {
  return {
    dopt: "2024-06-30",
    today: "2026-11-12",
    runId: "run-demo-1",
    recordedDate: "2026-11-12",
    tolerance: DEMO_TOLERANCE,
    serviceTolerance: "0",
    monthlyBenefitPlausibilityCap: 2500000,
    plausibleBenefitCompRatioRange: null,
    planServiceCreditRule: null,
    validFormCodes: ["NSF", "NMF", "QPSA", "J&S50", "J&S75", "J&S100"],
    file: {
      openable: true,
      truncated: false,
      hashMatches: true,
      hashBefore: "demo",
      hashAfter: "demo",
      macroRan: false,
      unknownFields: [],
    },
    priorExtract: null,
  };
}

// ---------------------------------------------------------------------------
// Decide step: evidence per participant, from the engine outcomes
// ---------------------------------------------------------------------------

function baseEvidence(key: string): DispositionEvidence {
  return {
    participantKey: key,
    caseId: "00098765",
    toleranceSetId: "tol-demo",
    completenessGrade: "complete",
    comparisonBasis: "established",
    basisUnresolvable: false,
    basisNote: null,
    reconstructedMinor: null,
    recordedMinor: recordedMinor(key),
    deltaMinor: null,
    withinTolerance: null,
    denominatorFlag: null,
    boundsMinor: null,
    boundWidthMaterial: false,
    boundWidthJustification: null,
    boundAssumptionsInDoubt: false,
    hypotheses: [],
    conflictingCorrections: false,
    correctedBenefitMinor: null,
    correctionReasonablyCertain: false,
    correctionDirection: null,
    missingEvidence: [],
    dataRequests: [],
    nextSteps: [],
    uninvestigatedFlag: false,
    blockingValidationOutstanding: false,
    statisticalOnly: false,
    contradictoryEvidenceUnresolved: false,
    supportedGround: null,
    indeterminateRationale: null,
    noFurtherRequestReason: null,
    ruleApplicabilityOk: true,
    snapshotMatches: true,
  };
}

function decideEvidence(key: string, outcome: CalculationOutcome): DispositionEvidence {
  const base = baseEvidence(key);
  if (key === "SYN-001") {
    assert.equal(outcome.kind, "exact");
    return {
      ...base,
      reconstructedMinor: 150000,
      deltaMinor: 0,
      withinTolerance: true,
      hypotheses: [{ code: "H2", supportClass: "refuted", material: true }],
    };
  }
  if (key === "SYN-V-01") {
    assert.equal(outcome.kind, "exact");
    // Stage 7 Accuracy D-ACC-1: the demo plan prescribes nearest-cent
    // rounding (plan §5.01), which leaves $849.50 unchanged, so no
    // citable rule in this plan explains the $0.50. H15 is "plausible",
    // not "supported", and immaterial to the disposition (Δ is within
    // tolerance); Verified rests on tolerance alone.
    return {
      ...base,
      reconstructedMinor: 84950,
      deltaMinor: 50,
      withinTolerance: true,
      hypotheses: [{ code: "H15", supportClass: "plausible", material: false }],
    };
  }
  if (key === "SYN-003") {
    assert.equal(outcome.kind, "exact");
    return {
      ...base,
      reconstructedMinor: 150000,
      deltaMinor: 100000,
      withinTolerance: false,
      hypotheses: [{ code: "H2", supportClass: "proposed", material: true }],
      nextSteps: ["Ask the prior administrator for the workpaper behind $2,500.00."],
    };
  }
  if (key === "SYN-002") {
    assert.equal(outcome.kind, "bounds");
    return {
      ...base,
      completenessGrade: "partial",
      boundsMinor: { min: 158400, max: 168300 },
      boundWidthMaterial: true,
      missingEvidence: [
        {
          input: "CompensationHistory.salaryYear 2020",
          missingClass: "M3",
          decisionImpact: "Resolving it narrows the bounds by $99.00 and could move the disposition.",
          uncertaintyContributionMinor: 9900,
        },
      ],
      nextSteps: ["Obtain compensation year 2020 from the prior administrator."],
    };
  }
  if (key === "SYN-004") {
    assert.equal(outcome.kind, "bounds");
    return {
      ...base,
      completenessGrade: "partial",
      boundsMinor: { min: 90000, max: 96000 },
      boundWidthMaterial: true,
      missingEvidence: [
        {
          input: "CompensationHistory.salaryYear 2020",
          missingClass: "M3",
          decisionImpact: "Resolving it narrows the bounds by $60.00 and could move the disposition.",
          uncertaintyContributionMinor: 6000,
        },
      ],
      nextSteps: ["Obtain compensation year 2020 from the prior administrator."],
    };
  }
  // SYN-I-01
  assert.equal(outcome.kind, "indeterminate");
  return {
    ...base,
    completenessGrade: "insufficient",
    comparisonBasis: "unresolved",
    basisUnresolvable: true,
    basisNote: "DOTE is blank; no PA benefit schedule or plan document establishes the measurement date.",
    recordedMinor: null,
    missingEvidence: [
      {
        input: "DOTE (measurement date)",
        missingClass: "M5",
        decisionImpact: "Without a measurement date no comparison basis exists and no delta can be computed.",
        uncertaintyContributionMinor: null,
      },
      {
        input: "PA_AMB",
        missingClass: "M1",
        decisionImpact: "Without the recorded amount there is nothing to compare.",
        uncertaintyContributionMinor: null,
      },
    ],
    dataRequests: [
      {
        requestId: "req-demo-i-01-1",
        input: "DOTE (measurement date)",
        participantKeys: ["SYN-I-01"],
        sourceToAsk: "PA benefit schedule",
        expectedDecisionEffect: "Establishing the measurement date would resolve the comparison basis.",
        priority: 1,
        status: "issued",
        statusReason: "Issued; awaiting response.",
        requestedDate: "2026-11-12",
        answeredDate: null,
      },
    ],
    indeterminateRationale:
      "The measurement date (DOTE) is blank and cannot be established from available documents, so no comparison basis exists and no delta can be computed.",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("demo case package", () => {
  it("is the fictional Harborview plan, case 00098765 as text, six SYN- participants", () => {
    assert.equal(DEMO_CASE_PACKAGE.case.caseNumber.value, "00098765");
    assert.equal(DEMO_CASE_PACKAGE.case.planName.value, "Harborview Manufacturing Pension Plan");
    assert.equal(DEMO_CASE_PACKAGE.case.planNumber.value, "0042");
    assert.equal(DEMO_CASE_PACKAGE.case.dopt.value, "2024-06-30");
    assert.equal(DEMO_CASE_PACKAGE.participants.length, 6);
    for (const key of participantKeyList()) {
      assert.ok(key.startsWith("SYN-"), `${key} is not fictional`);
    }
    // No live data: no SSN anywhere in the demo case.
    for (const p of DEMO_CASE_PACKAGE.participants) {
      assert.equal(p.ssn.value, null);
    }
    // Blanks are null, never zero.
    const i01 = must(
      DEMO_CASE_PACKAGE.benefitObservations.find((o) => o.participantKey === "SYN-I-01"),
      "SYN-I-01 observation",
    );
    assert.equal(i01.paAmb.value, null);
    assert.equal(i01.measurementDate, null);
  });

  it("tolerance is case-set, never built-in", () => {
    assert.equal(DEMO_TOLERANCE.absoluteMinor, 100);
    assert.equal(DEMO_TOLERANCE.relativeDecimal, "0.01");
    assert.match(DEMO_TOLERANCE.authority, /No PBGC tolerance exists/);
    assert.equal(DEMO_CASE_PACKAGE.case.toleranceRecord, DEMO_TOLERANCE);
  });
});

describe("demo end-to-end: validate -> calculate -> reconcile -> decide", () => {
  it("validates through the real engine: one result per participant, rules evaluated", () => {
    const result = validateCasePackage(
      participantKeyList().map(toValidationParticipant),
      validationContext(),
    );
    assert.equal(result.participantResults.length, 6);
    assert.equal(result.summary.rulesEvaluated > 0, true);
    assert.deepEqual(
      result.participantResults.map((r) => r.participantKey).sort(),
      participantKeyList().sort(),
    );
  });

  it("calculates: SYN-001 $1,500.00 exact, SYN-V-01 $849.50 exact, SYN-003 $1,500.00 exact", () => {
    const syn001 = runEngine("SYN-001");
    assert.equal(syn001.kind, "exact");
    if (syn001.kind !== "exact") throw new Error("unreachable");
    assert.equal(syn001.benefit.amount?.amountMinor, 150000);

    const synV01 = runEngine("SYN-V-01");
    assert.equal(synV01.kind, "exact");
    if (synV01.kind !== "exact") throw new Error("unreachable");
    assert.equal(synV01.benefit.amount?.amountMinor, 84950);

    const syn003 = runEngine("SYN-003");
    assert.equal(syn003.kind, "exact");
    if (syn003.kind !== "exact") throw new Error("unreachable");
    assert.equal(syn003.benefit.amount?.amountMinor, 150000);
  });

  it("calculates bounds: SYN-002 $1,584-$1,683, SYN-004 $900-$960, recorded inside", () => {
    const syn002 = runEngine("SYN-002");
    assert.equal(syn002.kind, "bounds");
    if (syn002.kind !== "bounds") throw new Error("unreachable");
    assert.equal(syn002.bounds.min.amountMinor, 158400);
    assert.equal(syn002.bounds.max.amountMinor, 168300);
    assert.equal(syn002.bounds.recordedPosition, "inside");

    const syn004 = runEngine("SYN-004");
    assert.equal(syn004.kind, "bounds");
    if (syn004.kind !== "bounds") throw new Error("unreachable");
    assert.equal(syn004.bounds.min.amountMinor, 90000);
    assert.equal(syn004.bounds.max.amountMinor, 96000);
    assert.equal(syn004.bounds.recordedPosition, "inside");
  });

  it("is indeterminate for SYN-I-01: DOTE blank, no delta", () => {
    const outcome = runEngine("SYN-I-01");
    assert.equal(outcome.kind, "indeterminate");
    if (outcome.kind !== "indeterminate") throw new Error("unreachable");
    assert.equal(outcome.reason.code, "unresolved-comparison-basis");
  });

  it("reconciles: exact and bounds inputs carry the recorded amount; indeterminate carries no reconstruction", () => {
    const expectedRecon: Record<string, number> = {
      "SYN-001": 150000,
      "SYN-V-01": 84950,
      "SYN-003": 150000,
    };
    for (const key of ["SYN-001", "SYN-V-01", "SYN-003"]) {
      const outcome = runEngine(key);
      const inputs = buildReconciliationInputs({
        outcome,
        recorded: recordedBenefit(key),
        toleranceApplied: tolerance(),
        comparisonBasis: "basis-converted",
        basisConversion: "vesting",
      });
      assert.equal(inputs.reconstructed?.amount?.amountMinor, expectedRecon[key]);
      assert.equal(inputs.recorded?.amount?.amountMinor, recordedMinor(key));
      assert.equal(inputs.bounds, null);
    }
    for (const key of ["SYN-002", "SYN-004"]) {
      const outcome = runEngine(key);
      const inputs = buildReconciliationInputs({
        outcome,
        recorded: recordedBenefit(key),
        toleranceApplied: tolerance(),
        comparisonBasis: "basis-converted",
        basisConversion: "vesting",
      });
      assert.equal(inputs.reconstructed, null);
      assert.equal(inputs.bounds !== null, true);
      assert.equal(inputs.recorded?.amount?.amountMinor, recordedMinor(key));
    }
    const outcome = runEngine("SYN-I-01");
    const inputs = buildReconciliationInputs({
      outcome,
      recorded: recordedBenefit("SYN-I-01"),
      toleranceApplied: tolerance(),
      comparisonBasis: "unresolved",
    });
    assert.equal(inputs.reconstructed, null);
    assert.equal(inputs.bounds, null);
    assert.equal(inputs.recorded, null);
  });

  it("decides: every participant gets one disposition; Verified, Requires investigation, Indeterminate all present", () => {
    const dispositions: Record<string, string> = {};
    for (const key of participantKeyList()) {
      const outcome = runEngine(key);
      const recommendation = mapDisposition(decideEvidence(key, outcome));
      dispositions[key] = recommendation.disposition;
      // A recommendation is never an approval: no downstream use.
      assert.equal(recommendationIsNotApproval(recommendation), true);
      assert.equal(recommendation.status, "recommended");
    }
    assert.equal(dispositions["SYN-001"], "verified");
    assert.equal(dispositions["SYN-V-01"], "verified");
    assert.equal(dispositions["SYN-002"], "requires-investigation");
    assert.equal(dispositions["SYN-004"], "requires-investigation");
    assert.equal(dispositions["SYN-003"], "requires-investigation");
    assert.equal(dispositions["SYN-I-01"], "indeterminate");
    const values = Object.values(dispositions);
    assert.ok(values.includes("verified"));
    assert.ok(values.includes("requires-investigation"));
    assert.ok(values.includes("indeterminate"));
    assert.equal(values.length, 6);
  });

  it("flags SYN-003 as the outlier: largest gap, far outside tolerance", () => {
    const deltas: Record<string, number> = {};
    for (const key of participantKeyList()) {
      const outcome = runEngine(key);
      if (outcome.kind === "exact") {
        const recon = outcome.benefit.amount?.amountMinor ?? 0;
        deltas[key] = Math.abs((recordedMinor(key) ?? 0) - recon);
      }
    }
    assert.equal(deltas["SYN-003"], 100000);
    assert.equal(deltas["SYN-001"], 0);
    assert.equal(deltas["SYN-V-01"], 50);
    // The outlier gap is 1,000 times the $1.00 case tolerance.
    assert.equal((deltas["SYN-003"] as number) / 100, 1000);
  });
});

describe("onboarding helpers", () => {
  it("Help centre is non-empty and covers tolerances, dispositions, export, keys, access", () => {
    const html = renderHelpCentre();
    assert.equal(typeof html, "string");
    assert.ok(html.length > 500);
    assert.match(html, /Tolerance/);
    assert.match(html, /Verified/);
    assert.match(html, /Indeterminate/);
    assert.match(html, /Export/);
    assert.match(html, /Escape/);
  });

  it("context help covers every topic in one short paragraph", () => {
    const topics = [
      "import",
      "validate",
      "calculate",
      "reconcile",
      "statistics",
      "decide",
      "export",
      "tolerance",
      "disposition",
      "bounds",
      "missing-data",
    ];
    for (const topic of topics) {
      const html = renderContextHelp(topic);
      assert.ok(html.length > 20, `empty help for ${topic}`);
      assert.match(html, /<p/);
    }
    assert.match(renderContextHelp("tolerance"), /no PBGC tolerance/);
    assert.match(renderContextHelp("disposition"), /Verified/);
  });

  it("unknown topic returns generic help, never an error", () => {
    const html = renderContextHelp("no-such-topic");
    assert.ok(html.length > 20);
    assert.match(html, /Help centre/);
  });

  it("runOnboarding does nothing without a document (Node) and never throws", () => {
    runOnboarding({
      onStep: () => {
        throw new Error("onStep must not run without a document");
      },
      skip: () => {
        throw new Error("skip must not run without a document");
      },
    });
  });
});
