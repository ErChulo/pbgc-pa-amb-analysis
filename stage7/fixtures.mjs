import assert from "node:assert/strict";
import { DEMO_CASE_PACKAGE, DEMO_TOLERANCE } from "../dist/src/ui/demo.js";
import { makeMoney } from "../dist/src/decimal.js";
import { datedValue, makeBenefit } from "../dist/src/formulas.js";

// ---------------------------------------------------------------------------
// Fixture builders — copied from test/demo.test.ts (the canonical Node
// driver for the same demo case); mutations are applied per case.
// ---------------------------------------------------------------------------

function must(v, what) {
  assert.notEqual(v, undefined, `${what} is missing`);
  return v;
}
function mustString(v, what) {
  assert.notEqual(v, null, `${what} is missing`);
  assert.notEqual(v, undefined, `${what} is missing`);
  return v;
}
function participantKeyList() {
  return DEMO_CASE_PACKAGE.participants.map((p) => p.participantKey);
}
function recordedMinor(key) {
  const obs = must(
    DEMO_CASE_PACKAGE.benefitObservations.find((o) => o.participantKey === key),
    `observation for ${key}`,
  );
  return obs.paAmb.value?.amountMinor ?? null;
}
function doteOf(key) {
  const obs = must(
    DEMO_CASE_PACKAGE.benefitObservations.find((o) => o.participantKey === key),
    `observation for ${key}`,
  );
  return obs.measurementDate;
}
function ageAtYMD(dob, date) {
  const years = Number(date.slice(0, 4)) - Number(dob.slice(0, 4));
  return date.slice(5) < dob.slice(5) ? years - 1 : years;
}
function nrdOf(dob) {
  return `${Number(dob.slice(0, 4)) + 65}${dob.slice(4)}`;
}

const FORMULA_PARAMS = {
  "SYN-001": { avgComp: "60000", service: "20" },
  "SYN-002": { avgComp: "60000", service: "22" },
  "SYN-003": { avgComp: "60000", service: "20" },
  "SYN-004": { avgComp: "49600", service: "15" },
  "SYN-V-01": { avgComp: "33980", service: "20" },
  "SYN-I-01": { avgComp: "60000", service: "20" },
};

function roundingConfig() {
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

function recordedBenefit(key) {
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

function buildRequest(key, overrides = {}) {
  const employmentPeriods = DEMO_CASE_PACKAGE.employmentPeriods.filter(
    (e) => e.participantKey === key,
  );
  const compensationHistory = must(
    DEMO_CASE_PACKAGE.compensationHistories.find((c) => c.participantKey === key),
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
    tolerance: DEMO_TOLERANCE,
    runContext: {
      engineVersion: "0.1.0",
      ruleVersion: "2026-11-12",
      formulaTaxonomyVersion: "1.0",
      inputSnapshotHash: "demo",
    },
    ...overrides,
  };
}

function buildInputs(key, overrides = {}) {
  const params = must(FORMULA_PARAMS[key], `formula params for ${key}`);
  const inputs = {
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
    ...overrides,
  };
  return inputs;
}

function toValidationParticipant(key) {
  const p = must(
    DEMO_CASE_PACKAGE.participants.find((x) => x.participantKey === key),
    `participant ${key}`,
  );
  const ep = must(
    DEMO_CASE_PACKAGE.employmentPeriods.find((x) => x.participantKey === key),
    `employment period for ${key}`,
  );
  const ch = must(
    DEMO_CASE_PACKAGE.compensationHistories.find((x) => x.participantKey === key),
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
          knownSalaries.reduce((s, x) => s + (x.amount?.amountMinor ?? 0), 0) /
            knownSalaries.length,
        );
  const lastSalary = knownSalaries[knownSalaries.length - 1];
  const formulaCheck = { "SYN-001": 150000, "SYN-003": 150000, "SYN-V-01": 84950 };
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
    anb: dote === null ? null : ageAtYMD(dob, dote),
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

function validationContext(overrides = {}) {
  return {
    dopt: "2024-06-30",
    today: "2026-11-12",
    runId: "run-robustness-1",
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
    ...overrides,
  };
}

/** Outcome of one rule for one participant: "pass" | "fail" | "not-applicable" | "not-run". */
function ruleOutcome(evals, ruleId) {
  const e = evals.find((x) => x.ruleId === ruleId);
  return e ? e.outcome : "MISSING-RULE";
}
function ruleFindings(evals, ruleId) {
  const e = evals.find((x) => x.ruleId === ruleId);
  return e ? e.findings : [];
}
function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

export {
  must,
  mustString,
  participantKeyList,
  recordedMinor,
  doteOf,
  ageAtYMD,
  nrdOf,
  roundingConfig,
  recordedBenefit,
  buildRequest,
  buildInputs,
  toValidationParticipant,
  validationContext,
  ruleOutcome,
  ruleFindings,
  clone,
};
