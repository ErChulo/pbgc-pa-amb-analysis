/**
 * End-to-end flow test (Wave 3): one synthetic CasePackage through the
 * full path — validateCasePackage → calculateAccruedBenefit →
 * buildReconciliationInputs → decision transition (recommend) →
 * approveDetermination — plus a bounds path (missing input →
 * BoundsResult → Requires investigation) and an Indeterminate path
 * (DOTE blank → no Δ → Indeterminate).
 *
 * The final decision is a HUMAN approval, never a system output: the
 * system only recommends; approval requires a named human reviewer,
 * and a system approve attempt is refused.
 *
 * Synthetic data only. Fictional participant SYN-E2E-001. No live data.
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
import { validateCasePackage } from "../src/validation.js";
import type { ValidationContext, ValidationParticipant } from "../src/validation.js";
import { datedValue, makeBenefit } from "../src/formulas.js";
import { calculateAccruedBenefit } from "../src/pipeline.js";
import type { PipelineInputs } from "../src/pipeline.js";
import { buildReconciliationInputs } from "../src/reconciliation.js";
import { downstreamUseFor, transition } from "../src/decisions.js";
import type {
  DispositionRecord,
  EntryCheckInput,
  IndeterminateContent,
  TransitionContext,
} from "../src/decisions.js";
import { approveDetermination } from "../src/determination.js";
import type {
  DeterminationApprovalInput,
  DeterminationRecord,
} from "../src/determination.js";
import type { DiagnosticHypothesis } from "../src/types.js";

// ---------------------------------------------------------------------------
// Pipeline fixtures (SYN-001 exact case; SYN-002 bounds case)
// ---------------------------------------------------------------------------

function prov(): Provenance {
  return {
    documentId: "doc-e2e",
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
    participantKey: "SYN-E2E-001",
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
    participantKey: "SYN-E2E-001",
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
    participantKey: "SYN-E2E-001",
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
  measurementDate: string | null;
  serviceHistory: ServiceHistory | null;
  compensationHistory: CompensationHistory | null;
}): CalculationRequest {
  return {
    participantKey: "SYN-E2E-001",
    participantHistory: {
      participantKey: "SYN-E2E-001",
      employmentPeriods: [employmentPeriod("2000-01-01", "2020-02-29")],
      compensationHistory: args.compensationHistory,
      serviceHistory: args.serviceHistory,
      benefitObservations: [],
    },
    provisionTimeline: {
      planId: "plan-1",
      versions: [planVersion("v1", "1985-07-01", ["T-04"])],
    },
    measurementDate: args.measurementDate,
    measurementBasis: args.measurementDate === null ? "unresolved" : "dote",
    calculationKind: "accrued",
    formulaId: "T-04",
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
    measurementDate: "2020-02-29",
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

function recordedBenefit(minor: number): TypedBenefitQuantity {
  return makeBenefit(
    {
      planVersionId: "v1",
      measurementDate: "2020-02-29",
      rounding: { stage: "final-only", mode: "nearest-cent", source: "test" },
    },
    makeMoney(minor),
    "monthly",
    undefined,
    "prior-administrator",
  );
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
    recordedPaAmb: recordedBenefit(150000),
    averagingPeriod: { kind: "final", years: 3, description: "final-3-year", ruleRef: "plan §5.01" },
    requiredBasis: { annuityForm: "NSF", retirementAge: 65 },
  };
}

function syn002Request(): CalculationRequest {
  return makeRequest({
    measurementDate: "2020-02-29",
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
    recordedPaAmb: recordedBenefit(162000),
    averagingPeriod: { kind: "final", years: 3, description: "final-3-year", ruleRef: "plan §5.01" },
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

// ---------------------------------------------------------------------------
// Validation fixture: the same fictional participant as a case-package row
// ---------------------------------------------------------------------------

function e2eParticipant(): ValidationParticipant {
  return {
    participantKey: "SYN-E2E-001",
    bcvRecId: 1,
    caseNumber: "00012345",
    idType: "1",
    ssn: "111223333",
    firstName: "End",
    lastName: "Fictional",
    dob: "1962-03-14",
    sex: "M",
    dateOfDeath: null,
    retstat: "2",
    rettyp: null,
    doh: "2000-01-01",
    dote: "2020-02-29",
    dop: "2000-01-01",
    dobfParticipant: null,
    dor: null,
    postDoptDote: null,
    nrd: "2027-03-14",
    anb: 59,
    sanb: 58,
    rbd: "2027-04-01",
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
    cspa: "20",
    vspa: "20",
    espa: "20",
    cs: "20",
    vs: "20",
    es: "20",
    csUnit: "years",
    vsUnit: "years",
    vppa: "1",
    paAmb: 150000,
    paAcomp: 500000,
    paAcompPeriodicity: "monthly",
    cuComp: 520000,
    pia: null,
    integrationMethod: "none",
    firstYear: 2017,
    lastYear: 2019,
    salaryByYear: [
      { year: 2017, amount: 5760000 },
      { year: 2018, amount: 6000000 },
      { year: 2019, amount: 6240000 },
    ],
    annact: "A",
    annualizationBasisNoted: true,
    averagingPeriodYears: [2017, 2018, 2019],
    formCode: "NSF",
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
    xrd: "2027-03-14",
    xrdMbTerm: 150000,
    pvReteec: null,
    measurementDate: "2020-02-29",
    recordedDate: "2020-03-15",
    measurementDisagreementExplained: false,
    assertedBasisNrd: false,
    nrdBasisEvidence: false,
    explicitNoBenefitStatement: false,
    vestingTreatment: "gross",
    annuityForm: "NSF",
    annuityFormConversionDocumented: false,
    calcMeasurementDate: "2020-02-29",
    calcAnnuityForm: "NSF",
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
    schedulePaAmb: 150000,
    scheduleExplanationDocumented: false,
    bcvComparison: null,
    paymentAmountMinor: null,
    convertedPaAmbMinor: null,
    ardFactorsPresent: false,
    priorDistribution: null,
    formulaCheckValueMinor: 150000,
    formulaKnownForX06: true,
    formulaCheckValuesMinor: [150000],
    documentedHypothesis: false,
    pfFactors: null,
    proposedDisposition: null,
    evidenceCount: 0,
    paAmbAccept: null,
    disposition: null,
    decisionExists: false,
    rejectionRationaleStated: false,
    sourcesUsed: [],
    candidateMeasurementDates: ["2020-02-29"],
    establishedMeasurementDate: "2020-02-29",
    prior: null,
  };
}

function e2eContext(): ValidationContext {
  return {
    dopt: "2021-06-30",
    today: "2026-11-12",
    runId: "run-e2e-1",
    recordedDate: "2026-11-12",
    tolerance: {
      version: 1,
      absoluteMinor: 200,
      relativeDecimal: null,
      application: "either",
      authority: "case actuary — case record M-7 (illustration only, not a PBGC rule)",
      approvedBy: "case actuary",
      approvedDate: "2026-11-12",
    },
    serviceTolerance: "0",
    monthlyBenefitPlausibilityCap: 2500000,
    plausibleBenefitCompRatioRange: null,
    planServiceCreditRule: null,
    validFormCodes: ["NSF", "NMF", "QPSA", "J&S50", "J&S75", "J&S100"],
    file: {
      openable: true,
      truncated: false,
      hashMatches: true,
      hashBefore: "aaaa",
      hashAfter: "aaaa",
      macroRan: false,
      unknownFields: [],
    },
    priorExtract: null,
  };
}

// ---------------------------------------------------------------------------
// Decision fixtures (adapted from test/decisions.test.ts SYN-V-01)
// ---------------------------------------------------------------------------

function makeCtx(
  evidence: EntryCheckInput,
  overrides: Partial<TransitionContext> = {},
): TransitionContext {
  return {
    participantKey: "SYN-E2E-001",
    caseId: "00000001",
    evidence,
    inputSnapshotHash: "hash-1",
    ruleVersion: "validation-rules v1.0.0",
    occurredAt: "2026-11-12",
    newDispositionId: "disp-e2e-2",
    auditEventId: "audit-e2e-2",
    calculationRunId: "run-1",
    ...overrides,
  };
}

function verifiedEvidence(overrides: Partial<EntryCheckInput> = {}): EntryCheckInput {
  return {
    completenessGrade: "complete",
    comparisonBasis: "established",
    reconstructedBenefitCents: 150000,
    boundsCents: null,
    deltaCents: 0,
    withinTolerance: true,
    toleranceSetId: "tol-1",
    hypotheses: [{ code: "H2", supportClass: "refuted", material: true }],
    blockingValidationOutstanding: false,
    boundWidthMaterial: false,
    boundWidthJustification: null,
    missingEvidence: [],
    nextSteps: [],
    correctedBenefitCents: null,
    correctionReasonablyCertain: false,
    correctionDirection: null,
    recordedBenefitCents: 150000,
    statisticalOnly: false,
    ruleApplicabilityOk: true,
    snapshotMatches: true,
    exactSupported: true,
    hasEvidenceState: true,
    supportedGround: null,
    boundAssumptionsInDoubt: false,
    conflictingCorrections: false,
    uninvestigatedFlag: false,
    basisUnresolvable: false,
    contradictoryEvidenceUnresolved: false,
    indeterminateContent: null,
    ...overrides,
  };
}

function serviceHypothesis(): DiagnosticHypothesis {
  return {
    id: "hyp-e2e-1",
    version: 1,
    supersedesId: null,
    sourceRecordIds: [],
    createdDate: "2026-11-12",
    createdBy: "system",
    hypothesisId: "H2-1",
    comparisonId: "cmp-e2e-1",
    hypothesisType: "service",
    counterfactual: "service +1 year gives $1,575, service -1 year gives $1,425; neither matches the recorded $1,500",
    counterfactualCalculationId: "calc-e2e-2",
    evidence: [],
    rank: 1,
    status: "tested-rejected",
  };
}

function makeVerifiedDetermination(): DeterminationRecord {
  return {
    determinationId: "det-e2e-1",
    dispositionId: "disp-e2e-1",
    participantKey: "SYN-E2E-001",
    caseId: "00000001",
    schemaVersion: "1.0.0",
    createdAt: "2026-11-12",
    createdBy: "A. Actuary",
    recordedBenefit: {
      amountCents: 150000,
      isBlank: false,
      sourceScheduleRef: "PA schedule p. 4",
      recordedDate: "2020-03-15",
    },
    calculatedBenefit: {
      amountCents: 150000,
      calculationId: "calc-e2e-1",
      calculationStatus: "complete",
      boundsCents: null,
      noBoundsReason: null,
      correctedBenefitCents: null,
    },
    comparisonBasis: {
      basis: "established",
      measurementDate: "2020-02-29",
      retirementBasis: "NRD 2027-03-14",
      annuityForm: "NSF",
      vestingTreatment: "vested",
      planVersionIds: ["v1"],
      comparisonBasisState: "basis-converted",
      toleranceSetId: "tol-1",
      deltaCents: 0,
      withinTolerance: true,
    },
    differencesAndExplanations: {
      deltaCents: 0,
      absDeltaCents: 0,
      relDelta: 0,
      denominatorFlag: "ok",
      hypotheses: [serviceHypothesis()],
      leadingExplanation:
        "Independent calculation agrees exactly with the recorded benefit; the service counterfactuals are refuted.",
    },
    missingEvidence: [],
    materialAssumptions: [],
    sensitivityAndUncertainty: {
      scenarios: [],
      dispositionSensitivity: "No missing input; no disposition sensitivity.",
      uncertaintyAttribution: [],
      statisticalNotes: null,
    },
    supportingDocuments: [
      {
        documentId: "doc-plan",
        citation: "Synthetic Plan A §5.01",
        whatItSupports: "unit-credit formula, 1.5% accrual rate, final-3-year average",
      },
    ],
    recommendedDisposition: {
      disposition: "verified",
      recommendedBy: "system",
      recommendedAt: "2026-11-12",
      recommendationRationale: "Independent calculation agrees exactly with the recorded benefit.",
    },
    humanDetermination: {
      disposition: "verified",
      rationale:
        "Independent reconstruction $1,500.00; recorded $1,500.00; exact agreement on the same basis; no other discrepancy.",
      reviewer: "A. Actuary",
      reviewerRole: "case actuary",
      determinationDate: "2026-11-12",
      approvalId: null,
    },
    dataRequests: [],
    downstream: { usableInValuation: true, valueCents: 150000, valueKind: "recorded", paAmbAccept: "Y" },
    contentHash: "content-hash-e2e-1",
  };
}

function makeApproval(
  overrides: Partial<DeterminationApprovalInput> = {},
): DeterminationApprovalInput {
  return {
    approvalId: "appr-e2e-1",
    reviewer: "A. Actuary",
    reviewerRole: "case actuary",
    rationale:
      "Independent reconstruction $1,500.00; recorded $1,500.00; exact agreement on the same basis; no other discrepancy.",
    approvalDate: "2026-11-12",
    evidenceSnapshot: {
      snapshotId: "snap-e2e-1",
      inputSnapshotHash: "hash-1",
      calculationRunId: "run-1",
      ruleVersion: "validation-rules v1.0.0",
      toleranceSetId: "tol-1",
      dispositionSchemaVersion: "1.0.0",
      determinationId: "det-e2e-1",
      sourceDocumentIds: ["doc-plan"],
      calculationTraceHash: "trace-1",
      boundsAssumptionsHash: null,
    },
    confirmations: {
      entryConditionsHold: true,
      determinationComplete: true,
      toleranceIdentified: true,
      noMaterialUnexplainedItem: true,
    },
    ...overrides,
  };
}

function indeterminateContent(): IndeterminateContent {
  return {
    justifiedBoundsCents: null,
    noBoundsReason:
      "The measurement date is unresolved (DOTE blank); no single bound is justifiable.",
    scenarioBounds: [],
    missingEvidence: [
      {
        input: "DOTE (date of termination of employment)",
        missingClass: "M5",
        decisionImpact: "Establishes the measurement basis; without it no Δ is computed.",
        uncertaintyContributionCents: null,
      },
    ],
    dataRequests: [
      {
        requestId: "req-e2e-1",
        input: "DOTE and the PA benefit schedule for this participant",
        participantKeys: ["SYN-E2E-001"],
        sourceToAsk: "Prior plan administrator (holder of the schedule)",
        expectedDecisionEffect: "Disposition-changing: establishes the basis.",
        priority: 1,
        status: "issued",
        statusReason: "Issued 2026-11-12; awaiting response.",
        requestedDate: "2026-11-12",
        answeredDate: null,
      },
    ],
    indeterminateRationale:
      "No further step is currently available beyond the issued request; the participant cannot be decided on the evidence as it stands.",
    noFurtherRequestReason: null,
  };
}

function indeterminateEvidence(): EntryCheckInput {
  const content = indeterminateContent();
  return {
    completenessGrade: "insufficient",
    comparisonBasis: "unresolved",
    reconstructedBenefitCents: null,
    boundsCents: null,
    deltaCents: null,
    withinTolerance: null,
    toleranceSetId: "tol-1",
    hypotheses: [{ code: "H1", supportClass: "indeterminate", material: true }],
    blockingValidationOutstanding: false,
    boundWidthMaterial: false,
    boundWidthJustification: null,
    missingEvidence: content.missingEvidence,
    nextSteps: ["PA benefit schedule and DOTE requested"],
    correctedBenefitCents: null,
    correctionReasonablyCertain: false,
    correctionDirection: null,
    recordedBenefitCents: 112000,
    statisticalOnly: false,
    ruleApplicabilityOk: true,
    snapshotMatches: true,
    exactSupported: false,
    hasEvidenceState: true,
    supportedGround: null,
    boundAssumptionsInDoubt: false,
    conflictingCorrections: false,
    uninvestigatedFlag: false,
    basisUnresolvable: true,
    contradictoryEvidenceUnresolved: false,
    indeterminateContent: content,
  };
}

// ---------------------------------------------------------------------------
// Main path: exact reconstruction → Verified, human-approved
// ---------------------------------------------------------------------------

describe("end-to-end: exact case → Verified (human approval)", () => {
  it("validate → calculate → reconcile → recommend → approve; the approval is human, not system", () => {
    // 1. Validation: the case package loads and the participant is present.
    const validation = validateCasePackage([e2eParticipant()], e2eContext());
    assert.equal(validation.participantResults.length, 1);
    assert.equal(validation.summary.rulesEvaluated > 0, true);
    assert.equal(Array.isArray(validation.allFindings), true);

    // 2. Calculation: exact $1,500.00 with a full 10-stage trace.
    const outcome = calculateAccruedBenefit(syn001Request(), syn001Inputs());
    assert.equal(outcome.kind, "exact");
    if (outcome.kind !== "exact") throw new Error("unreachable");
    assert.equal(outcome.benefit.amount?.amountMinor, 150000);
    assert.equal(outcome.trace.length, 18);

    // 3. Reconciliation inputs: reconstructed and recorded on a converted
    //    basis (vesting), Δ = $0.00 — computed here from the two amounts,
    //    not asserted by the engine.
    const inputs = buildReconciliationInputs({
      outcome,
      recorded: recordedBenefit(150000),
      toleranceApplied: tolerance(),
      comparisonBasis: "basis-converted",
      basisConversion: "vesting",
    });
    assert.equal(inputs.reconstructed?.amount?.amountMinor, 150000);
    assert.equal(inputs.recorded?.amount?.amountMinor, 150000);
    assert.equal(inputs.bounds, null);
    const deltaMinor = (inputs.recorded?.amount?.amountMinor ?? 0)
      - (inputs.reconstructed?.amount?.amountMinor ?? 0);
    assert.equal(deltaMinor, 0);

    // 4. Recommendation (T1): the system proposes Verified; it is only
    //    "recommended", created by the system — not an approval.
    const evidence = verifiedEvidence();
    const proposed = transition(
      null,
      { kind: "propose", actor: "system", target: "verified", evidenceChanged: true },
      makeCtx(evidence),
    );
    assert.equal(proposed.outcome, "applied");
    if (proposed.outcome !== "applied" || proposed.record === null) throw new Error("propose failed");
    const recommended: DispositionRecord = proposed.record;
    assert.equal(recommended.disposition, "verified");
    assert.equal(recommended.status, "recommended");
    assert.equal(recommended.createdBy, "system");
    assert.equal(recommended.determinationId, null);

    // A system approve attempt is refused: approval is a human gate.
    const sysApprove = transition(
      recommended,
      { kind: "approve", actor: "system", determination: makeVerifiedDetermination(), approval: makeApproval() },
      makeCtx(evidence),
    );
    assert.equal(sysApprove.outcome, "refused");
    assert.equal(recommended.status, "recommended");

    // 5. Human approval (T3): the named reviewer approves with a
    //    determination; the record becomes approved and carries the
    //    approval record, not a system output.
    const approved = transition(
      recommended,
      { kind: "approve", actor: "A. Actuary", determination: makeVerifiedDetermination(), approval: makeApproval() },
      makeCtx(evidence, { newDispositionId: "disp-e2e-3", auditEventId: "audit-e2e-3" }),
    );
    assert.equal(approved.outcome, "applied");
    if (approved.outcome !== "applied" || approved.record === null) throw new Error("approve failed");
    assert.equal(approved.record.disposition, "verified");
    assert.equal(approved.record.status, "approved");
    assert.equal(approved.approvalRecord === null, false);
    assert.equal(approved.approvalRecord?.reviewer, "A. Actuary");
    assert.equal(approved.determination === null, false);
    assert.equal(approved.determination?.humanDetermination.approvalId, "appr-e2e-1");
    // Downstream: the recorded benefit is usable in the valuation.
    assert.deepEqual(downstreamUseFor("verified", "approved", 150000, null), {
      usableInValuation: true,
      valueCents: 150000,
      valueKind: "recorded",
      paAmbAccept: "Y",
    });

    // The standalone approval gate agrees: a named human approves.
    const gate = approveDetermination(makeVerifiedDetermination(), makeApproval());
    assert.equal(gate.approved, true);
  });
});

// ---------------------------------------------------------------------------
// Bounds path: missing input → BoundsResult → Requires investigation
// ---------------------------------------------------------------------------

describe("end-to-end: bounds case → Requires investigation", () => {
  it("missing 2020 compensation → bounds $1,584–$1,683 → recommended Requires investigation, not approved", () => {
    const outcome = calculateAccruedBenefit(syn002Request(), syn002Inputs());
    assert.equal(outcome.kind, "bounds");
    if (outcome.kind !== "bounds") throw new Error("unreachable");
    assert.equal(outcome.bounds.min.amountMinor, 158400);
    assert.equal(outcome.bounds.max.amountMinor, 168300);
    assert.equal(outcome.bounds.recordedPosition, "inside");

    const inputs = buildReconciliationInputs({
      outcome,
      recorded: recordedBenefit(162000),
      toleranceApplied: tolerance(),
      comparisonBasis: "basis-converted",
      basisConversion: "vesting",
    });
    assert.equal(inputs.reconstructed, null);
    assert.equal(inputs.bounds === null, false);
    assert.equal(inputs.bounds?.min.amountMinor, 158400);
    assert.equal(inputs.bounds?.max.amountMinor, 168300);

    const evidence = verifiedEvidence({
      completenessGrade: "partial",
      reconstructedBenefitCents: null,
      boundsCents: { min: 158400, max: 168300 },
      deltaCents: null,
      withinTolerance: null,
      hypotheses: [{ code: "H4", supportClass: "proposed", material: true }],
      missingEvidence: [
        {
          input: "CompensationHistory.salaryYear 2020",
          missingClass: "M3",
          decisionImpact: "Widens the bound by $99.00; resolving it could move the disposition.",
          uncertaintyContributionCents: 9900,
        },
      ],
      nextSteps: ["Request the 2020 compensation year from the prior administrator."],
      recordedBenefitCents: 162000,
      exactSupported: false,
    });
    const proposed = transition(
      null,
      { kind: "propose", actor: "system", target: "requires-investigation", evidenceChanged: true },
      makeCtx(evidence, { newDispositionId: "disp-e2e-ri1", auditEventId: "audit-e2e-ri1" }),
    );
    assert.equal(proposed.outcome, "applied");
    if (proposed.outcome !== "applied" || proposed.record === null) throw new Error("propose failed");
    assert.equal(proposed.record.disposition, "requires-investigation");
    assert.equal(proposed.record.status, "recommended");
    assert.equal(proposed.record.createdBy, "system");
    // Recommended, not approved: the investigation is still outstanding,
    // so no human approval exists yet for this participant.
    assert.equal(proposed.record.status === "approved", false);
    assert.equal(proposed.approvalRecord, null);
  });
});

// ---------------------------------------------------------------------------
// Indeterminate path: DOTE blank → no Δ → Indeterminate
// ---------------------------------------------------------------------------

describe("end-to-end: DOTE blank → Indeterminate", () => {
  it("null measurement date → indeterminate, no Δ, recommended Indeterminate", () => {
    const request = makeRequest({
      measurementDate: null,
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
    assert.equal(outcome.reason.code, "unresolved-comparison-basis");
    assert.equal(outcome.trace.length, 1);
    assert.equal(outcome.trace[0]?.name, "comparison-basis-gate");

    // The recorded amount exists but its basis is unresolved, so no Δ
    // is computed: reconciliation carries neither a reconstruction nor
    // bounds.
    const recordedUnresolved: TypedBenefitQuantity = {
      amount: makeMoney(112000),
      periodicity: "monthly",
      measurementDate: null,
      measurementBasis: "unresolved",
      basisNote: null,
      commencementBasis: null,
      retirementAge: null,
      retirementDate: null,
      annuityForm: "unknown",
      vestingTreatment: "unknown",
      planVersionId: null,
      formulaId: null,
      source: "prior-administrator",
      status: "recorded",
      ownerId: "obs-e2e-i01",
    };
    const inputs = buildReconciliationInputs({
      outcome,
      recorded: recordedUnresolved,
      toleranceApplied: tolerance(),
      comparisonBasis: "unresolved",
    });
    assert.equal(inputs.reconstructed, null);
    assert.equal(inputs.bounds, null);
    assert.equal(inputs.recorded?.amount?.amountMinor, 112000);
    // No Δ: there is no reconstructed benefit to subtract from.
    assert.equal(inputs.reconstructed === null, true);

    const evidence = indeterminateEvidence();
    const proposed = transition(
      null,
      { kind: "propose", actor: "system", target: "indeterminate", evidenceChanged: true },
      makeCtx(evidence, { participantKey: "SYN-E2E-001", newDispositionId: "disp-e2e-i1", auditEventId: "audit-e2e-i1" }),
    );
    assert.equal(proposed.outcome, "applied");
    if (proposed.outcome !== "applied" || proposed.record === null) throw new Error("propose failed");
    assert.equal(proposed.record.disposition, "indeterminate");
    assert.equal(proposed.record.status, "recommended");
    assert.equal(evidence.deltaCents, null);
  });
});
