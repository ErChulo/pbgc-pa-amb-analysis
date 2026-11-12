/**
 * Synthetic demo case for the PA_AMB Analysis System (Stage 6).
 *
 * Fictional plan and participants only. No live case data. Every
 * participant key starts with "SYN-". A blank is null, never 0.
 *
 * Plan: Harborview Manufacturing Pension Plan, plan 0042, case
 * 00098765 (case number kept as text, leading zeros kept),
 * DOPT 2024-06-30. Formula T-04, unit-credit: 1.5% of final-3-year
 * average pay per year of service, monthly benefit = annual / 12.
 * Rounding: final monthly benefit to the nearest cent, half-up,
 * per plan section 5.01.
 *
 * Participants (6):
 * - SYN-001: exact $1,500.00, PA_AMB $1,500.00, delta $0.
 * - SYN-002: 2020 pay missing; bounds $1,584.00-$1,683.00,
 *   PA_AMB $1,620.00 inside the bounds.
 * - SYN-003: outlier. Exact $1,500.00, PA_AMB $2,500.00,
 *   delta $1,000.00.
 * - SYN-004: 2020 pay missing; bounds $900.00-$960.00,
 *   PA_AMB $930.00 inside the bounds.
 * - SYN-V-01: exact $849.50, PA_AMB $850.00, delta $0.50.
 * - SYN-I-01: DOTE blank, PA_AMB blank. No basis, no delta.
 */

import { makeMoney } from "../decimal.js";
import type {
  BenefitObservation,
  CasePackage,
  CompensationHistory,
  EmploymentPeriod,
  Formula,
  MissingDataItem,
  Money,
  Participant,
  PlanVersion,
  Provenance,
  ServiceHistory,
  SourcedValue,
  SourceDocument,
  ToleranceRecord,
  TypedBenefitQuantity,
} from "../types.js";

/** Case number, as text. Leading zeros are part of the number. */
const CASE_NUMBER = "00098765";

/** The demo tolerance. Set by the demo case actuary for this case
 *  only. No PBGC tolerance exists for PA_AMB reconciliation, so
 *  no tolerance is built in: this record IS the tolerance. */
export const DEMO_TOLERANCE: ToleranceRecord = {
  version: 1,
  absoluteMinor: 100,
  relativeDecimal: "0.01",
  application: "either",
  authority:
    "Demo case actuary, set for this demo case only. No PBGC tolerance exists for PA_AMB reconciliation.",
  approvedBy: "Demo case actuary",
  approvedDate: "2026-11-12",
};

function prov(): Provenance {
  return {
    documentId: "doc-demo-census",
    location: {
      kind: "user-entered",
      enteredBy: "demo",
      enteredDate: "2026-11-12",
      entryForm: "demo-case",
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
    createdDate: "2026-11-12",
    createdBy: "demo",
  };
}

function money(minor: number | null): Money | null {
  return minor === null ? null : makeMoney(minor);
}

interface DemoParticipantSpec {
  key: string;
  bcvRecId: number;
  firstName: string;
  lastName: string;
  dob: string;
  sex: "M" | "F";
  doh: string;
  dote: string | null;
  service: number | null;
  salaries: Array<{ year: number; minor: number | null }>;
  paAmbMinor: number | null;
  missing: MissingDataItem[];
}

const SPECS: DemoParticipantSpec[] = [
  {
    key: "SYN-001",
    bcvRecId: 1,
    firstName: "Fictional",
    lastName: "One",
    dob: "1962-03-14",
    sex: "M",
    doh: "2000-01-01",
    dote: "2020-02-29",
    service: 20,
    salaries: [
      { year: 2017, minor: 5760000 },
      { year: 2018, minor: 6000000 },
      { year: 2019, minor: 6240000 },
    ],
    paAmbMinor: 150000,
    missing: [],
  },
  {
    key: "SYN-002",
    bcvRecId: 2,
    firstName: "Fictional",
    lastName: "Two",
    dob: "1960-05-20",
    sex: "F",
    doh: "1998-01-01",
    dote: "2020-02-29",
    service: 22,
    salaries: [
      { year: 2018, minor: 5760000 },
      { year: 2019, minor: 6120000 },
      { year: 2020, minor: null },
    ],
    paAmbMinor: 162000,
    missing: [
      {
        field: "CompensationHistory.salaryYear 2020",
        missingClass: "c",
        consequence: "Bounds only; no exact benefit until the year is found.",
        resolvesBy: "2020 pay record from the prior administrator.",
      },
    ],
  },
  {
    key: "SYN-003",
    bcvRecId: 3,
    firstName: "Fictional",
    lastName: "Three",
    dob: "1963-08-02",
    sex: "M",
    doh: "2000-01-01",
    dote: "2020-02-29",
    service: 20,
    salaries: [
      { year: 2017, minor: 5760000 },
      { year: 2018, minor: 6000000 },
      { year: 2019, minor: 6240000 },
    ],
    paAmbMinor: 250000,
    missing: [],
  },
  {
    key: "SYN-004",
    bcvRecId: 4,
    firstName: "Fictional",
    lastName: "Four",
    dob: "1965-11-11",
    sex: "F",
    doh: "2005-01-01",
    dote: "2020-02-29",
    service: 15,
    salaries: [
      { year: 2018, minor: 4800000 },
      { year: 2019, minor: 5040000 },
      { year: 2020, minor: null },
    ],
    paAmbMinor: 93000,
    missing: [
      {
        field: "CompensationHistory.salaryYear 2020",
        missingClass: "c",
        consequence: "Bounds only; no exact benefit until the year is found.",
        resolvesBy: "2020 pay record from the prior administrator.",
      },
    ],
  },
  {
    key: "SYN-V-01",
    bcvRecId: 5,
    firstName: "Fictional",
    lastName: "Five",
    dob: "1964-04-30",
    sex: "M",
    doh: "2000-01-01",
    dote: "2020-02-29",
    service: 20,
    salaries: [
      { year: 2017, minor: 3240000 },
      { year: 2018, minor: 3398000 },
      { year: 2019, minor: 3556000 },
    ],
    paAmbMinor: 85000,
    missing: [],
  },
  {
    key: "SYN-I-01",
    bcvRecId: 6,
    firstName: "Fictional",
    lastName: "Six",
    dob: "1961-02-28",
    sex: "F",
    doh: "2001-06-01",
    dote: null,
    service: null,
    salaries: [
      { year: 2017, minor: 5760000 },
      { year: 2018, minor: 6000000 },
      { year: 2019, minor: 6240000 },
    ],
    paAmbMinor: null,
    missing: [
      {
        field: "EmploymentPeriod.dote",
        missingClass: "e",
        consequence: "No measurement date, so no comparison basis and no delta.",
        resolvesBy: "DOTE from the PA benefit schedule.",
      },
      {
        field: "BenefitObservation.paAmb",
        missingClass: "a",
        consequence: "No recorded amount, so nothing to compare.",
        resolvesBy: "PA_AMB from the PA benefit schedule.",
      },
    ],
  },
];

function buildParticipant(spec: DemoParticipantSpec): Participant {
  return {
    ...entity(`participant-${spec.key}`),
    bcvRecId: sourced(spec.bcvRecId),
    caseNumber: sourced(CASE_NUMBER),
    idType: sourced<"1" | "2" | "4">("1"),
    ssn: sourced<string | null>(null),
    firstName: sourced<string | null>(spec.firstName),
    middleName: sourced<string | null>(null),
    lastName: sourced(spec.lastName),
    nameSuffix: sourced<string | null>(null),
    dob: sourced(spec.dob),
    sex: sourced<"M" | "F" | "U">(spec.sex),
    maritalStatus: sourced<"M" | "S" | "D" | "W" | "U" | null>(null),
    healthStatus: sourced<"0" | "1" | "2" | null>(null),
    survivorOwner: sourced<string | null>(null),
    survivorMonths: sourced<number | null>(null),
    dateOfMarriage: sourced<string | null>(null),
    dateOfDeath: sourced<string | null>(null),
    spouse: sourced(null),
    beneficiary: sourced(null),
    alternatePayee: sourced(null),
    retstat: sourced<"1" | "2" | "3" | "4" | "5">("2"),
    rettyp: sourced<string | null>(null),
    participantKey: spec.key,
    recordRole: "participant",
    completenessGrade: spec.missing.length === 0 ? "complete" : "partial",
    missingData: spec.missing,
  };
}

function buildEmploymentPeriod(spec: DemoParticipantSpec): EmploymentPeriod {
  return {
    ...entity(`ep-${spec.key}`),
    participantKey: spec.key,
    doh: sourced(spec.doh),
    dote: sourced(spec.dote),
    dop: sourced(spec.doh),
    dobfParticipant: sourced<string | null>(null),
    dor: sourced<string | null>(null),
    postDoptDote: sourced<string | null>(null),
    periodSeq: 1,
    periodType: "initial-hire",
    periodStart: spec.doh,
    periodEnd: spec.dote,
    breakInService: null,
    hoursPerPeriod: sourced<number | null>(null),
  };
}

function buildCompensationHistory(spec: DemoParticipantSpec): CompensationHistory {
  const first = spec.salaries[0];
  const last = spec.salaries[spec.salaries.length - 1];
  return {
    ...entity(`ch-${spec.key}`),
    participantKey: spec.key,
    firstYear: sourced(first === undefined ? 2017 : first.year),
    lastYear: sourced(last === undefined ? 2019 : last.year),
    salaryByYear: spec.salaries.map((s, i) => ({
      salaryYear: s.year,
      sourceField: `S00${i + 1}`,
      amount: money(s.minor),
      annualized: false,
      provenance: prov(),
    })),
    annualizedFlagSource: sourced(null),
    salaryDesc: sourced("W-2 wages"),
    currentMonthlyComp: sourced<Money | null>(null),
    paAverageComp: sourced<Money | null>(null),
    compensationDefinitionApplied: "plan §2.01",
    nonCensusInputs: [],
  };
}

function buildServiceHistory(spec: DemoParticipantSpec): ServiceHistory {
  return {
    ...entity(`sh-${spec.key}`),
    participantKey: spec.key,
    asOfDate: sourced(spec.dote ?? "2020-02-29"),
    paCreditedService: sourced(spec.service),
    paVestingService: sourced(spec.service),
    paEligibilityService: sourced(spec.service),
    bcvCreditedService: sourced(spec.service),
    bcvVestingService: sourced(spec.service),
    bcvEligibilityService: sourced(spec.service),
    paVestingPercent: sourced("1"),
    bcvVestingPercent: sourced("1"),
    serviceMeasure: "years",
    servicePeriods:
      spec.service === null || spec.dote === null
        ? []
        : [
            {
              start: spec.doh,
              end: spec.dote,
              measure: spec.service,
              provenance: prov(),
            },
          ],
    breaksApplied: [],
    distributions: [],
  };
}

function buildObservation(spec: DemoParticipantSpec): BenefitObservation {
  const benefit: TypedBenefitQuantity = {
    amount: money(spec.paAmbMinor),
    periodicity: "monthly",
    measurementDate: spec.dote,
    measurementBasis: spec.dote === null ? "unresolved" : "dote",
    basisNote: null,
    commencementBasis: spec.dote === null ? null : "payable at NRD",
    retirementAge: 65,
    retirementDate: null,
    annuityForm: spec.dote === null ? "unknown" : "NSF",
    vestingTreatment: spec.dote === null ? "unknown" : "vested",
    planVersionId: "pv-demo-1985",
    formulaId: "formula-t04",
    source: "prior-administrator",
    status: "recorded",
    ownerId: `obs-${spec.key}`,
  };
  return {
    ...entity(`obs-${spec.key}`),
    participantKey: spec.key,
    paAmb: sourced<Money | null>(money(spec.paAmbMinor)),
    benefit,
    measurementDate: spec.dote,
    measurementBasis: spec.dote === null ? "unresolved" : "dote",
    annuityForm: spec.dote === null ? "unknown" : "NSF",
    vestingTreatment: spec.dote === null ? "unknown" : "vested",
    recordedDate: sourced<string | null>(spec.dote === null ? null : "2020-03-15"),
    sourceScheduleRow: `Demo census row ${spec.bcvRecId}`,
    observationType: "census",
    paAmbAccept: null,
    qdroSplitDate: sourced<string | null>(null),
    sourceDocumentId: "doc-demo-census",
  };
}

function buildPlanVersion(): PlanVersion {
  return {
    ...entity("pv-demo-1985"),
    planId: "plan-harborview",
    versionId: "pv-demo-1985",
    effectiveDate: sourced("1985-07-01"),
    adoptionDate: sourced("1985-06-15"),
    restatementDate: sourced<string | null>(null),
    provisionText: sourced("Unit-credit formula: 1.5% of final-3-year average pay per year of service."),
    provisionSection: sourced("§5.01"),
    supersedesVersionId: null,
    grandfatheredGroups: sourced([]),
    freeze: sourced(null),
    sourceDocumentId: "doc-demo-census",
    changeSummary: "Demo plan version.",
    statutoryLimitsInForce: [],
    formulaIds: ["T-04"],
  };
}

function buildFormula(): Formula {
  return {
    ...entity("formula-t04"),
    formulaId: "T-04",
    formulaType: sourced("unit-credit"),
    planVersionId: "pv-demo-1985",
    appliesToGroup: sourced("all participants"),
    accrualRate: sourced<string | null>("0.015"),
    formulaConstants: sourced<Record<string, string> | null>(null),
    averagingPeriodYears: sourced<number | null>(3),
    averagingMethod: sourced<"final" | "highest" | "career" | null>("final"),
    maxServiceYears: sourced<number | null>(null),
    serviceCap: sourced<string | null>(null),
    integrationLevel: sourced<string | null>(null),
    roundingRule: sourced("Final monthly benefit to the nearest cent, half-up."),
    grandfatherFloor: sourced<string | null>(null),
    sourceCitation: sourced("Synthetic plan §5.01 (demo)."),
    applicabilityPredicate: "Applies to all service before DOTE.",
  };
}

function buildSourceDocument(): SourceDocument {
  return {
    ...entity("doc-demo-census"),
    documentId: "doc-demo-census",
    documentType: "census-file",
    title: "Synthetic demo census file",
    fileHash: "demo-synthetic-no-file",
    location: "Built into the demo case.",
    versionDate: "2026-11-12",
    effectiveDate: null,
    reliabilityGrade: "unassessed",
    otherTypeDescription: null,
  };
}

/** The complete demo case package. Six fictional participants. */
export const DEMO_CASE_PACKAGE: CasePackage = {
  formatVersion: "1.0.0",
  case: {
    ...entity("case-demo"),
    caseNumber: sourced(CASE_NUMBER),
    dopt: sourced("2024-06-30"),
    bpd: sourced<string | null>(null),
    planName: sourced("Harborview Manufacturing Pension Plan"),
    planNumber: sourced("0042"),
    caseActuary: sourced<string | null>("Demo case actuary"),
    auditor: sourced<string | null>(null),
    employerStatus: sourced<string | null>(null),
    successorPlan: sourced<string | null>(null),
    trusteeshipDate: sourced<string | null>(null),
    valuationAsOfDate: sourced<string | null>(null),
    currencyConvention: "USD",
    toleranceRecord: DEMO_TOLERANCE,
    completenessGrade: "partial",
    planId: "plan-harborview",
  },
  plan: {
    ...entity("plan-harborview"),
    caseId: "case-demo",
    planId: "0042",
    normalRetirementAge: sourced<number | null>(65),
    normalRetirementDefinition: sourced("Age 65."),
    earlyRetirementRule: sourced<string | null>(null),
    normalFormSingle: sourced("NSF"),
    normalFormMarried: sourced("NMF"),
    compensationDefinition: sourced("W-2 wages."),
    serviceDefinitions: sourced("Elapsed time, in years."),
    vestingSchedule: sourced({
      scheduleType: "cliff",
      steps: [{ yearsOfService: 5, percentDecimal: "1" }],
      sourceSection: "Synthetic plan §6.01 (demo).",
    }),
    freezeDatePlanLevel: sourced<string | null>(null),
    integrationMethod: sourced(null),
    employeeContributionRule: sourced<string | null>(null),
    planVersionIds: ["pv-demo-1985"],
  },
  planVersions: [buildPlanVersion()],
  formulas: [buildFormula()],
  participants: SPECS.map(buildParticipant),
  employmentPeriods: SPECS.map(buildEmploymentPeriod),
  compensationHistories: SPECS.map(buildCompensationHistory),
  serviceHistories: SPECS.map(buildServiceHistory),
  benefitObservations: SPECS.map(buildObservation),
  benefitCalculations: [],
  benefitComparisons: [],
  diagnosticHypotheses: [],
  sourceDocuments: [buildSourceDocument()],
  actuarialDecisions: [],
  calculationRuns: [],
  sourceRecords: [],
  events: [
    {
      id: "case-demo-event-1",
      sequence: 1,
      eventDate: "2026-11-12",
      actor: "demo",
      kind: "case-created",
      summary: `Demo case ${CASE_NUMBER} created.`,
      affectedEntityIds: ["case-demo", "plan-harborview"],
      affectedParticipantKeys: [],
      revision: null,
      snapshotHashAfter: "demo-synthetic-no-file",
    },
  ],
  unmapped: [],
};
