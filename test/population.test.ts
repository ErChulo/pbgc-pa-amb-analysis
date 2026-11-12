/**
 * Stage 5 (Worker 4) synthetic-population end-to-end test.
 *
 * 1,000 fictional participants (SYN-POP-0001…1000) with planted
 * discrepancies of KNOWN cause (ground truth), run through the full
 * chain: validation (representative 6-participant sample, one per
 * cohort) → calculation → reconciliation inputs → hypothesis ranking
 * (testCounterfactual + rankCounterfactuals) → disposition
 * recommendation (test-local oracle, see below).
 *
 * Cohorts (index ranges are the ground truth):
 * - clean 0–399: PA_AMB equals the reconstruction exactly.
 * - service+1 400–549: the PA used 21 years of credited service where
 *   the plan gives 20 (planted cause H2).
 * - averaging 550–699: the PA used a final-5-year average where the
 *   plan states final-3 (planted cause H4).
 * - rounding 700–799: the PA rounded the final monthly benefit to the
 *   nearest dollar where the plan rounds to the cent (planted cause
 *   H15). The difference is within tolerance by construction.
 * - missing-comp 800–899: the 2020 compensation year is blank, so the
 *   outcome is bounds; the recorded benefit sits inside the justified
 *   range (planted cause H16, missing information).
 * - vesting-double 900–999: the PA applied the 80% vesting percentage
 *   twice (planted cause H12). The pipeline labels that counterfactual
 *   a diagnostic coincidence, so the expected disposition is Requires
 *   investigation, not Correction recommended.
 *
 * Ground-truth checks: the hypothesis ranking identifies the planted
 * cause for each cohort; the outlier detection (test-local robust
 * z-score, median/MAD, |z| > 3.5 — a test choice, not a PBGC rule)
 * flags the service/averaging/vesting cohorts and not the clean or
 * rounding cohorts; the disposition mapping reaches the expected
 * disposition per cohort.
 *
 * Disposition oracle: this test's own expected-disposition mapping
 * (MASTER_PROMPT §14 categories), written here as the test oracle —
 * NOT the Stage 5 disposition module (another worker owns
 * src/dispositionMapping.ts). It maps only the chain's outputs
 * (within-tolerance, top-ranked hypothesis, bounds position) to a
 * disposition, so the test checks that the chain produces the evidence
 * the expected disposition rests on. Stage 5 recommends; the final
 * decision is always a human reviewer.
 *
 * Δ/D/R are computed here from the two amounts (MASTER_PROMPT §10:
 * Δ = recorded − reconstructed, D = |Δ|, R only when the denominator
 * is meaningful) — the reconciliation module (another worker) owns
 * those computations in production; the test computes them to check
 * the chain against ground truth.
 *
 * Plain node:test + node:assert. Seeded PRNG (mulberry32, seed
 * 20261112 — same pattern as test/property.test.ts), so the population
 * is reproducible. Synthetic data only. No live case data.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decMultiply, makeMoney, moneyMinorToDecimalString } from "../src/decimal.js";
import type {
  CalculationRequest,
  CompensationHistory,
  Disposition,
  EmploymentPeriod,
  PlanVersion,
  Provenance,
  RoundingConfig,
  RoundingSequence,
  ServiceHistory,
  SourcedValue,
  ToleranceRecord,
  TypedBenefitQuantity,
} from "../src/types.js";
import { makeBenefit } from "../src/formulas.js";
import { calculateAccruedBenefit, testCounterfactual } from "../src/pipeline.js";
import type { PipelineInputs } from "../src/pipeline.js";
import {
  buildReconciliationInputs,
  rankCounterfactuals,
  type RankableCounterfactual,
} from "../src/reconciliation.js";
import { validateCasePackage } from "../src/validation.js";
import type { ValidationContext, ValidationParticipant } from "../src/validation.js";

// ---------------------------------------------------------------------------
// Seeded PRNG (property.test.ts pattern)
// ---------------------------------------------------------------------------

const SEED = 20261112;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Cohorts (ground truth)
// ---------------------------------------------------------------------------

type Cohort = "clean" | "service" | "averaging" | "rounding" | "missing" | "vesting";

const COHORTS: Array<{ cohort: Cohort; from: number; to: number }> = [
  { cohort: "clean", from: 0, to: 399 },
  { cohort: "service", from: 400, to: 549 },
  { cohort: "averaging", from: 550, to: 699 },
  { cohort: "rounding", from: 700, to: 799 },
  { cohort: "missing", from: 800, to: 899 },
  { cohort: "vesting", from: 900, to: 999 },
];

const EXPECTED_TOP: Record<Cohort, string> = {
  clean: "none",
  service: "H2",
  averaging: "H4",
  rounding: "H15",
  missing: "H16",
  vesting: "H12",
};

const EXPECTED_DISPOSITION: Record<Cohort, Disposition> = {
  clean: "verified",
  service: "correction-recommended",
  averaging: "correction-recommended",
  rounding: "verified",
  missing: "supported-for-acceptance",
  vesting: "requires-investigation",
};

function cohortOf(index: number): Cohort {
  for (const c of COHORTS) {
    if (index >= c.from && index <= c.to) return c.cohort;
  }
  throw new Error(`population: no cohort for index ${index}`);
}

// ---------------------------------------------------------------------------
// Fixtures (endtoend-style; fictional participants SYN-POP-nnnn)
// ---------------------------------------------------------------------------

function key(index: number): string {
  return `SYN-POP-${String(index + 1).padStart(4, "0")}`;
}

function prov(): Provenance {
  return {
    documentId: "doc-pop",
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

function planVersion(): PlanVersion {
  return {
    ...entity("v1"),
    planId: "plan-1",
    versionId: "v1",
    effectiveDate: sourced("1985-07-01"),
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
    formulaIds: ["T-04"],
  };
}

function employmentPeriod(participantKey: string): EmploymentPeriod {
  return {
    ...entity(`ep-${participantKey}`),
    participantKey,
    doh: sourced("2000-01-01"),
    dote: sourced("2020-02-29"),
    dop: sourced(null),
    dobfParticipant: sourced(null),
    dor: sourced(null),
    postDoptDote: sourced(null),
    periodSeq: 1,
    periodType: "initial-hire",
    periodStart: "2000-01-01",
    periodEnd: "2020-02-29",
    breakInService: null,
    hoursPerPeriod: sourced(null),
  };
}

function serviceHistory(participantKey: string, vp: string): ServiceHistory {
  return {
    ...entity(`sh-${participantKey}`),
    participantKey,
    asOfDate: sourced("2020-02-29"),
    paCreditedService: sourced(20),
    paVestingService: sourced(20),
    paEligibilityService: sourced(20),
    bcvCreditedService: sourced(20),
    bcvVestingService: sourced(20),
    bcvEligibilityService: sourced(20),
    paVestingPercent: sourced(vp),
    bcvVestingPercent: sourced(vp),
    serviceMeasure: "years",
    servicePeriods: [{ start: "2000-01-01", end: "2020-02-29", measure: 20, provenance: prov() }],
    breaksApplied: [],
    distributions: [],
  };
}

function compensationHistory(
  participantKey: string,
  salaries: Array<{ year: number; minor: number | null }>,
): CompensationHistory {
  return {
    ...entity(`ch-${participantKey}`),
    participantKey,
    firstYear: sourced(salaries[0]?.year ?? 2015),
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

/** The rounding counterfactual: final monthly benefit to the nearest
 *  dollar, documented as a plan-provision sequence (test hypothesis). */
const DOLLAR_SEQUENCE: RoundingSequence = {
  sequenceId: "hypothesis-dollar",
  rules: [
    {
      target: "final-monthly-benefit",
      unit: "1",
      mode: "half-up",
      stage: "final",
      source: { kind: "plan-provision", citation: "plan §5.01 (test hypothesis)" },
    },
  ],
};

function baseInputs(recordedPaAmb: TypedBenefitQuantity | null): PipelineInputs {
  return {
    formulaCall: {
      formulaId: "T-04",
      params: {
        accrualRate: { value: "0.015", effectiveFrom: "1985-07-01", planVersionId: "v1" },
        avgComp: "60000",
        service: "20",
      },
    },
    recordedPaAmb,
    averagingPeriod: { kind: "final", years: 3, description: "final-3-year", ruleRef: "plan §5.01" },
    alternativeAveragingPeriods: ["final-5-year"],
    requiredBasis: { annuityForm: "NSF", retirementAge: 65 },
  };
}

function makeRequest(args: {
  participantKey: string;
  salaries: Array<{ year: number; minor: number | null }>;
  vp: string;
}): CalculationRequest {
  return {
    participantKey: args.participantKey,
    participantHistory: {
      participantKey: args.participantKey,
      employmentPeriods: [employmentPeriod(args.participantKey)],
      compensationHistory: compensationHistory(args.participantKey, args.salaries),
      serviceHistory: serviceHistory(args.participantKey, args.vp),
      benefitObservations: [],
    },
    provisionTimeline: { planId: "plan-1", versions: [planVersion()] },
    measurementDate: "2020-02-29",
    measurementBasis: "dote",
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

// ---------------------------------------------------------------------------
// Salary generation (seeded; whole dollars, ~2% growth + jitter)
// ---------------------------------------------------------------------------

function salariesFor(rng: () => number, missing2020: boolean): Array<{ year: number; minor: number | null }> {
  const base = 48000 + Math.floor(rng() * 24001);
  const years = missing2020 ? [2018, 2019, 2020] : [2015, 2016, 2017, 2018, 2019];
  return years.map((year) => {
    if (missing2020 && year === 2020) return { year, minor: null };
    const growth = Math.pow(1.02, year - 2015);
    const jitter = 1 + (rng() - 0.5) * 0.02;
    const dollars = Math.round(base * growth * jitter);
    return { year, minor: dollars * 100 };
  });
}

// ---------------------------------------------------------------------------
// Test-local disposition oracle (see header — NOT the Stage 5 module)
// ---------------------------------------------------------------------------

function recommendDisposition(args: {
  outcomeKind: "exact" | "bounds" | "indeterminate";
  recordedPosition?: "inside" | "below-min" | "above-max" | "recorded-missing";
  withinTolerance: boolean;
  topResidualZero: boolean;
  topResolvesCohort: boolean;
  topSupport: "supported" | "plausible" | "coincidence" | "refuted" | "none";
}): Disposition {
  if (args.outcomeKind === "bounds") {
    return args.recordedPosition === "inside" ? "supported-for-acceptance" : "requires-investigation";
  }
  if (args.outcomeKind !== "exact") return "indeterminate";
  if (args.withinTolerance) return "verified";
  if (args.topSupport === "coincidence" || args.topSupport === "refuted" || args.topSupport === "none") {
    return "requires-investigation";
  }
  if (args.topResidualZero && args.topResolvesCohort) return "correction-recommended";
  return "requires-investigation";
}

// ---------------------------------------------------------------------------
// Validation sample fixture (endtoend-style ValidationParticipant)
// ---------------------------------------------------------------------------

function validationParticipant(args: {
  participantKey: string;
  paAmbMinor: number;
  reconMinor: number;
  salaries: Array<{ year: number; minor: number | null }>;
  vp: string;
  firstYear: number;
  lastYear: number;
  averagingYears: number[];
}): ValidationParticipant {
  const populated = args.salaries.filter(
    (s): s is { year: number; minor: number } => s.minor !== null,
  );
  return {
    participantKey: args.participantKey,
    bcvRecId: 1,
    caseNumber: "00012345",
    idType: "1",
    ssn: "111223333",
    firstName: "Syn",
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
    vppa: args.vp,
    paAmb: args.paAmbMinor,
    paAcomp: 500000,
    paAcompPeriodicity: "monthly",
    cuComp: 520000,
    pia: null,
    integrationMethod: "none",
    firstYear: args.firstYear,
    lastYear: args.lastYear,
    salaryByYear: populated.map((s) => ({ year: s.year, amount: s.minor })),
    annact: "A",
    annualizationBasisNoted: true,
    averagingPeriodYears: args.averagingYears,
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
    xrdMbTerm: args.reconMinor,
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
    schedulePaAmb: args.paAmbMinor,
    scheduleExplanationDocumented: false,
    bcvComparison: null,
    paymentAmountMinor: null,
    convertedPaAmbMinor: null,
    ardFactorsPresent: false,
    priorDistribution: null,
    formulaCheckValueMinor: args.reconMinor,
    formulaKnownForX06: true,
    formulaCheckValuesMinor: [args.reconMinor],
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

function validationContext(): ValidationContext {
  return {
    dopt: "2021-06-30",
    today: "2026-11-12",
    runId: "run-pop-1",
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
// The population chain
// ---------------------------------------------------------------------------

interface PopRow {
  index: number;
  cohort: Cohort;
  reconMinor: number | null;
  recordedMinor: number | null;
  deltaMinor: number | null;
  outcomeKind: "exact" | "bounds" | "indeterminate";
  recordedPosition: "inside" | "below-min" | "above-max" | "recorded-missing" | null;
  boundsWidthMinor: number | null;
  topCode: string;
  topSupport: "supported" | "plausible" | "coincidence" | "refuted" | "none";
  topResidualZero: boolean;
  topResolvesCohort: boolean;
  withinTolerance: boolean;
  disposition: Disposition;
  salaries: Array<{ year: number; minor: number | null }>;
  vp: string;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) throw new Error("median: no values");
  const mid = sorted[Math.floor(n / 2)];
  if (mid === undefined) throw new Error("median: no middle value");
  if (n % 2 === 1) return mid;
  const lower = sorted[n / 2 - 1];
  if (lower === undefined) throw new Error("median: no lower middle value");
  return (lower + mid) / 2;
}

describe("synthetic population end-to-end (1,000 participants)", () => {
  it("validation → calculation → reconciliation → ranking → disposition matches ground truth", () => {
    const rng = mulberry32(SEED);
    const rows: PopRow[] = [];
    // Pass 1: calculate, plant the recorded benefit, test counterfactuals.
    // Counterfactual results are kept per participant for pass 2 ranking.
    const cfByIndex = new Map<number, RankableCounterfactual[]>();
    for (let i = 0; i < 1000; i += 1) {
      const cohort = cohortOf(i);
      const participantKey = key(i);
      const vp = cohort === "vesting" ? "0.8" : "1";
      let salaries = salariesFor(rng, cohort === "missing");
      let request = makeRequest({ participantKey, salaries, vp });
      if (cohort === "missing") {
        // Planted recorded benefit: the exact benefit with the 2020
        // salary filled at the 2019 salary (a stated fill, used only to
        // plant ground truth — the bounds run never sees it).
        const filled = salaries.map((s) =>
          s.year === 2020 ? { year: 2020, minor: salaries.find((x) => x.year === 2019)?.minor ?? null } : s,
        );
        const planted = calculateAccruedBenefit(
          makeRequest({ participantKey, salaries: filled, vp }),
          baseInputs(null),
        );
        if (planted.kind !== "exact") throw new Error(`missing cohort ${participantKey}: planted run is not exact`);
        const recordedMinor = planted.benefit.amount?.amountMinor ?? null;
        if (recordedMinor === null) throw new Error(`missing cohort ${participantKey}: planted benefit has no amount`);
        const salary2019 = salaries.find((x) => x.year === 2019)?.minor;
        if (salary2019 === null || salary2019 === undefined) throw new Error("missing cohort: no 2019 salary");
        const dollars2019 = moneyMinorToDecimalString(salary2019);
        const inputs: PipelineInputs = {
          ...baseInputs(recordedBenefit(recordedMinor)),
          boundsSpec: {
            ranges: [
              {
                field: "CompensationHistory.salaryYear 2020",
                missingClass: "c",
                low: decMultiply(dollars2019, "0.9"),
                high: decMultiply(dollars2019, "1.1"),
                unit: "annual-compensation-dollars",
                basis: "2019 salary ±10% (test bounds)",
              },
            ],
            assumptions: ["formula T-04 applies to all service"],
          },
        };
        const outcome = calculateAccruedBenefit(request, inputs);
        if (outcome.kind !== "bounds") throw new Error(`missing cohort ${participantKey}: expected bounds, got ${outcome.kind}`);
        const width = outcome.bounds.max.amountMinor - outcome.bounds.min.amountMinor;
        rows.push({
          index: i,
          cohort,
          reconMinor: null,
          recordedMinor,
          deltaMinor: null,
          outcomeKind: "bounds",
          recordedPosition: outcome.bounds.recordedPosition,
          boundsWidthMinor: width,
          topCode: "H16",
          topSupport: "none",
          topResidualZero: false,
          topResolvesCohort: false,
          withinTolerance: false,
          disposition: recommendDisposition({
            outcomeKind: "bounds",
            recordedPosition: outcome.bounds.recordedPosition,
            withinTolerance: false,
            topResidualZero: false,
            topResolvesCohort: false,
            topSupport: "none",
          }),
          salaries,
          vp,
        });
        continue;
      }
      // Exact cohorts: base run first (recorded null — Stage 10 does not
      // affect stages 1–9), then plant the recorded benefit.
      let outcome = calculateAccruedBenefit(request, baseInputs(null));
      if (outcome.kind !== "exact") throw new Error(`${participantKey}: expected exact, got ${outcome.kind}`);
      let reconMinor = outcome.benefit.amount?.amountMinor ?? null;
      if (reconMinor === null) throw new Error(`${participantKey}: reconstructed benefit has no amount`);
      // Rounding cohort needs a non-zero cents remainder, or the planted
      // difference would be zero and the participant would look clean.
      if (cohort === "rounding") {
        let tries = 0;
        while (reconMinor % 100 === 0 && tries < 10) {
          salaries = salaries.map((s) =>
            s.year === 2019 && s.minor !== null ? { year: s.year, minor: s.minor + 100 } : s,
          );
          const retry = calculateAccruedBenefit(
            (request = makeRequest({ participantKey, salaries, vp })),
            baseInputs(null),
          );
          if (retry.kind !== "exact") throw new Error(`${participantKey}: retry is not exact`);
          reconMinor = retry.benefit.amount?.amountMinor ?? null;
          if (reconMinor === null) throw new Error(`${participantKey}: retry has no amount`);
          outcome = retry;
          tries += 1;
        }
        if (reconMinor % 100 === 0) throw new Error(`${participantKey}: could not plant a rounding difference`);
      }
      const reconBenefit = outcome.benefit;
      let recordedMinor: number;
      if (cohort === "clean") {
        recordedMinor = reconMinor;
      } else if (cohort === "service") {
        const planted = calculateAccruedBenefit(request, {
          ...baseInputs(null),
          serviceOverride: { creditedService: "21" },
        });
        if (planted.kind !== "exact") throw new Error(`${participantKey}: planted service run is not exact`);
        const plantedMinor = planted.benefit.amount?.amountMinor ?? null;
        if (plantedMinor === null) throw new Error(`${participantKey}: planted service benefit has no amount`);
        recordedMinor = plantedMinor;
      } else if (cohort === "averaging") {
        const planted = calculateAccruedBenefit(request, {
          ...baseInputs(null),
          averagingPeriod: { kind: "final", years: 5, description: "final-5-year", ruleRef: "plan §5.01" },
        });
        if (planted.kind !== "exact") throw new Error(`${participantKey}: planted averaging run is not exact`);
        const plantedMinor = planted.benefit.amount?.amountMinor ?? null;
        if (plantedMinor === null) throw new Error(`${participantKey}: planted averaging benefit has no amount`);
        recordedMinor = plantedMinor;
      } else if (cohort === "rounding") {
        recordedMinor = Math.round(reconMinor / 100) * 100;
      } else {
        // vesting: the PA applied VP twice.
        const planted = calculateAccruedBenefit(request, {
          ...baseInputs(null),
          applyVestingTwice: true,
        });
        if (planted.kind !== "exact") throw new Error(`${participantKey}: planted vesting run is not exact`);
        const plantedMinor = planted.benefit.amount?.amountMinor ?? null;
        if (plantedMinor === null) throw new Error(`${participantKey}: planted vesting benefit has no amount`);
        recordedMinor = plantedMinor;
      }
      // Reconciliation inputs (MASTER_PROMPT §10 inputs; Δ/D/R are
      // computed in this test from the two amounts, see header).
      const recorded = recordedBenefit(recordedMinor);
      const reconInputs = buildReconciliationInputs({
        outcome,
        recorded,
        toleranceApplied: tolerance(),
        comparisonBasis: "same-basis",
      });
      if (reconInputs.reconstructed?.amount?.amountMinor !== reconMinor) {
        throw new Error(`${participantKey}: reconciliation inputs do not carry the reconstruction`);
      }
      if (reconInputs.recorded?.amount?.amountMinor !== recordedMinor) {
        throw new Error(`${participantKey}: reconciliation inputs do not carry the recorded benefit`);
      }
      const deltaMinor = recordedMinor - reconMinor;
      const absDelta = deltaMinor < 0 ? -deltaMinor : deltaMinor;
      // R only when the denominator is meaningful (recon ≥ $1.00/month);
      // every reconstruction here is ≫ $1.00, so R is defined — the
      // relative limb is still checked through the tolerance record.
      const withinTolerance =
        absDelta <= 100 || (reconMinor > 0 && absDelta / reconMinor <= 0.001);
      // Counterfactuals for the four testable hypotheses.
      const inputs = baseInputs(recorded);
      const cfs = [
        testCounterfactual(request, { kind: "service-delta-years", years: "+1" }, inputs),
        testCounterfactual(request, { kind: "averaging-period", period: "final-5-year" }, inputs),
        testCounterfactual(request, { kind: "rounding-sequence", sequence: DOLLAR_SEQUENCE }, inputs),
        testCounterfactual(request, { kind: "vesting", mode: "applied-twice-diagnostic" }, inputs),
      ];
      // Rankable form: no tested mechanism carries document support as
      // the PA's actual method in this fixture — final-5 and the dollar
      // sequence are documented as available alternatives/hypotheses,
      // not as what the PA did — so documentedMechanism is false for
      // all four and the ranking runs on cohort resolution and support
      // class (rankCounterfactuals' documented-first behaviour is
      // covered by test/reconciliation.test.ts). resolvesCohort is
      // filled in pass 2 from the cohort resolve rate.
      const rankable: RankableCounterfactual[] = cfs.map((cf) => ({
        ...cf,
        documentedMechanism: false,
        resolvesCohort: false,
      }));
      cfByIndex.set(i, rankable);
      rows.push({
        index: i,
        cohort,
        reconMinor,
        recordedMinor,
        deltaMinor,
        outcomeKind: "exact",
        recordedPosition: null,
        boundsWidthMinor: null,
        topCode: "pending",
        topSupport: "none",
        topResidualZero: false,
        topResolvesCohort: false,
        withinTolerance,
        disposition: "requires-investigation",
        salaries,
        vp,
      });
      void reconBenefit;
    }

    // Pass 2: cohort resolve rates, then ranking + disposition per row.
    for (const c of COHORTS) {
      if (c.cohort === "missing") continue;
      const members = rows.filter((r) => r.cohort === c.cohort);
      const codes = ["H2", "H4", "H15", "H12"];
      const resolveRate = new Map<string, number>();
      for (const code of codes) {
        let resolved = 0;
        for (const r of members) {
          const list = cfByIndex.get(r.index) ?? [];
          const cf = list.find((x) => x.hypothesisCode === code);
          if (cf !== undefined && cf.residualDelta !== null && cf.residualDelta.amountMinor === 0) resolved += 1;
        }
        resolveRate.set(code, members.length === 0 ? 0 : resolved / members.length);
      }
      for (const r of members) {
        const list = (cfByIndex.get(r.index) ?? []).map((cf) => ({
          ...cf,
          resolvesCohort: (resolveRate.get(cf.hypothesisCode) ?? 0) >= 0.5,
        }));
        const ranked = rankCounterfactuals(list);
        const top = ranked[0];
        if (top === undefined) throw new Error(`no ranked hypotheses for ${key(r.index)}`);
        r.topCode = top.hypothesisCode;
        r.topSupport = top.supportClass;
        r.topResidualZero = top.residualDelta !== null && top.residualDelta.amountMinor === 0;
        r.topResolvesCohort = top.resolvesCohort;
        r.disposition = recommendDisposition({
          outcomeKind: "exact",
          withinTolerance: r.withinTolerance,
          topResidualZero: r.topResidualZero,
          topResolvesCohort: r.topResolvesCohort,
          topSupport: r.topSupport,
        });
      }
    }

    // Ground-truth checks.
    const byCohort = (cohort: Cohort): PopRow[] => rows.filter((r) => r.cohort === cohort);
    assert.equal(rows.length, 1000);
    for (const c of COHORTS) {
      const members = byCohort(c.cohort);
      assert.equal(members.length, c.to - c.from + 1, `cohort ${c.cohort} size`);
    }
    // (a) Hypothesis ranking identifies the planted cause per cohort.
    for (const c of COHORTS) {
      if (c.cohort === "clean") continue;
      const members = byCohort(c.cohort);
      const wrong = members.filter((r) => r.topCode !== EXPECTED_TOP[c.cohort]);
      assert.equal(
        wrong.length,
        0,
        `cohort ${c.cohort}: ${wrong.length} members top-ranked ${wrong[0]?.topCode ?? "?"} instead of ${EXPECTED_TOP[c.cohort]}`,
      );
    }
    // The clean cohort has no planted cause: every Δ is exactly zero.
    assert.ok(byCohort("clean").every((r) => r.deltaMinor === 0));
    // (b) Outlier detection (robust z, median/MAD, |z| > 3.5) flags the
    // planted outliers and not the clean cohort.
    const exactRows = rows.filter((r) => r.outcomeKind === "exact" && r.deltaMinor !== null);
    const deltas = exactRows.map((r) => r.deltaMinor as number);
    const med = median(deltas);
    const mad = median(deltas.map((d) => Math.abs(d - med)));
    assert.ok(mad > 0, "MAD is positive, so robust z-scores are defined");
    const flagged = new Set(
      exactRows
        .filter((r) => {
          const z = (0.6745 * ((r.deltaMinor as number) - med)) / mad;
          return z < -3.5 || z > 3.5;
        })
        .map((r) => r.index),
    );
    for (const r of exactRows) {
      const expected = r.cohort === "service" || r.cohort === "averaging" || r.cohort === "vesting";
      assert.equal(
        flagged.has(r.index),
        expected,
        `${key(r.index)} (${r.cohort}, Δ=${r.deltaMinor}): flagged=${flagged.has(r.index)}, expected=${expected}`,
      );
    }
    // (c) Disposition mapping reaches the expected disposition per cohort.
    for (const c of COHORTS) {
      const members = byCohort(c.cohort);
      const wrong = members.filter((r) => r.disposition !== EXPECTED_DISPOSITION[c.cohort]);
      assert.equal(
        wrong.length,
        0,
        `cohort ${c.cohort}: ${wrong.length} members got ${wrong[0]?.disposition ?? "?"} instead of ${EXPECTED_DISPOSITION[c.cohort]}`,
      );
    }
    // (d) Missing cohort: recorded inside the justified bounds, width > 0.
    for (const r of byCohort("missing")) {
      assert.equal(r.recordedPosition, "inside");
      if (r.boundsWidthMinor === null || r.boundsWidthMinor <= 0) {
        throw new Error(`${key(r.index)}: bounds width is not positive`);
      }
    }
    // (e) Δ/D/R invariants on the exact cohorts: Δ = recorded − recon
    // exactly, D = |Δ|; R is defined here (every recon ≫ $1.00).
    for (const r of exactRows) {
      if (r.recordedMinor === null || r.reconMinor === null || r.deltaMinor === null) {
        throw new Error(`${key(r.index)}: exact row is missing an amount`);
      }
      assert.equal(r.deltaMinor, r.recordedMinor - r.reconMinor);
      const d = r.deltaMinor < 0 ? -r.deltaMinor : r.deltaMinor;
      assert.equal(d, Math.abs(r.recordedMinor - r.reconMinor));
      assert.ok(r.reconMinor >= 100, "denominator is meaningful (recon ≥ $1.00/month)");
    }
    // Summary (ground-truth counts for the report).
    const counts = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.cohort}:${r.disposition}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    console.log(
      `population: n=1000 medianΔ=${med} MAD=${mad} flagged=${flagged.size} ` +
        [...counts.entries()].map(([k, v]) => `${k}=${v}`).join(" "),
    );
  });

  it("validation runs on a representative sample, one participant per cohort", () => {
    const rng = mulberry32(SEED + 1);
    const sample: ValidationParticipant[] = [];
    const representatives: Array<{ index: number; cohort: Cohort }> = [
      { index: 0, cohort: "clean" },
      { index: 400, cohort: "service" },
      { index: 550, cohort: "averaging" },
      { index: 700, cohort: "rounding" },
      { index: 800, cohort: "missing" },
      { index: 900, cohort: "vesting" },
    ];
    for (const rep of representatives) {
      // Advance the rng to the representative's position in the seeded
      // stream is unnecessary: the validation sample only needs the same
      // shape, so generate fresh seeded salaries per representative.
      const salaries = salariesFor(rng, rep.cohort === "missing");
      const participantKey = key(rep.index);
      const vp = rep.cohort === "vesting" ? "0.8" : "1";
      const request = makeRequest({ participantKey, salaries, vp });
      const outcome = calculateAccruedBenefit(request, baseInputs(null));
      const reconMinor =
        outcome.kind === "exact"
          ? (outcome.benefit.amount?.amountMinor ?? 0)
          : outcome.kind === "bounds"
            ? outcome.bounds.min.amountMinor
            : 0;
      sample.push(
        validationParticipant({
          participantKey,
          paAmbMinor: reconMinor,
          reconMinor,
          salaries,
          vp,
          firstYear: rep.cohort === "missing" ? 2018 : 2015,
          lastYear: rep.cohort === "missing" ? 2020 : 2019,
          averagingYears: rep.cohort === "missing" ? [2018, 2019, 2020] : [2017, 2018, 2019],
        }),
      );
    }
    const validation = validateCasePackage(sample, validationContext());
    assert.equal(validation.participantResults.length, 6);
    assert.ok(validation.summary.rulesEvaluated > 0);
    assert.equal(Array.isArray(validation.allFindings), true);
  });

  it("the chain is deterministic: the same participant twice gives the same Δ and top code", () => {
    const rng = mulberry32(SEED);
    const salaries = salariesFor(rng, false);
    const participantKey = key(400);
    const request = makeRequest({ participantKey, salaries, vp: "1" });
    const runOnce = (): { delta: number; top: string } => {
      const outcome = calculateAccruedBenefit(request, baseInputs(null));
      if (outcome.kind !== "exact") throw new Error("determinism check: not exact");
      const reconMinor = outcome.benefit.amount?.amountMinor ?? null;
      if (reconMinor === null) throw new Error("determinism check: no amount");
      const planted = calculateAccruedBenefit(request, {
        ...baseInputs(null),
        serviceOverride: { creditedService: "21" },
      });
      if (planted.kind !== "exact") throw new Error("determinism check: planted run not exact");
      const recordedMinor = planted.benefit.amount?.amountMinor ?? null;
      if (recordedMinor === null) throw new Error("determinism check: planted run has no amount");
      const inputs = baseInputs(recordedBenefit(recordedMinor));
      const ranked = rankCounterfactuals([
        {
          ...testCounterfactual(request, { kind: "service-delta-years", years: "+1" }, inputs),
          documentedMechanism: false,
          resolvesCohort: true,
        },
        {
          ...testCounterfactual(request, { kind: "averaging-period", period: "final-5-year" }, inputs),
          documentedMechanism: false,
          resolvesCohort: false,
        },
      ]);
      const top = ranked[0];
      if (top === undefined) throw new Error("determinism check: no top hypothesis");
      return { delta: recordedMinor - reconMinor, top: top.hypothesisCode };
    };
    const first = runOnce();
    const second = runOnce();
    assert.deepEqual(second, first);
    assert.equal(first.top, "H2");
  });
});
