/**
 * Unit tests for src/validation.ts — the 66-rule validation catalog.
 *
 * Run with plain node + node:test (no test framework dependency):
 *   npm test            (builds with tsc, then runs node --test dist/test/)
 *
 * Synthetic data only. Fictional participants only. No live case data.
 * The three worked examples are catalog §11 (SYN-001, SYN-002, SYN-003).
 * Case tolerance is $2.00/month (case record M-7, authority: case actuary,
 * recorded for illustration only — not a PBGC rule); DOPT is 2021-06-30.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG_VERSION,
  POLICY_5_8_1_REFERENCE,
  RULE_ORDER,
  validateCasePackage,
  validateParticipant,
} from "../src/validation.js";
import type {
  Finding,
  PriorExtractParticipantInput,
  RuleEvaluation,
  RuleId,
  ValidationContext,
  ValidationParticipant,
} from "../src/validation.js";

// ---------------------------------------------------------------------------
// Factories — one clean baseline participant and context that pass every
// rule that can pass (the known not-applicable outcomes on the baseline
// are asserted in their own tests, not hidden).
// ---------------------------------------------------------------------------

function salaryYears(
  firstYear: number,
  lastYear: number,
  amountFor: (year: number) => number | null,
): Array<{ year: number; amount: number | null }> {
  const out: Array<{ year: number; amount: number | null }> = [];
  for (let y = firstYear; y <= lastYear; y += 1) out.push({ year: y, amount: amountFor(y) });
  return out;
}

function cleanParticipant(
  overrides: Partial<ValidationParticipant> = {},
): ValidationParticipant {
  return {
    participantKey: "SYN-BASE-001",
    bcvRecId: 1,
    caseNumber: "00012345",
    idType: "1",
    ssn: "111223333",
    firstName: "Alex",
    lastName: "Fictional",
    dob: "1962-03-14",
    sex: "M",
    dateOfDeath: null,
    retstat: "2",
    rettyp: null,
    doh: "1990-05-01",
    dote: "2019-06-15",
    dop: "1990-05-01",
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
    cspa: "12.5",
    vspa: "12.5",
    espa: "12.5",
    cs: "12.5",
    vs: "12.5",
    es: "12.5",
    csUnit: "years",
    vsUnit: "years",
    vppa: "1",
    paAmb: 124000,
    paAcomp: 410000,
    paAcompPeriodicity: "monthly",
    cuComp: 450000,
    pia: null,
    integrationMethod: "none",
    firstYear: 2010,
    lastYear: 2019,
    salaryByYear: salaryYears(2010, 2019, (y) => 4000000 + (y - 2010) * 10000),
    annact: "A",
    annualizationBasisNoted: true,
    averagingPeriodYears: [2015, 2016, 2017, 2018, 2019],
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
    xrdMbTerm: 124000,
    pvReteec: null,
    measurementDate: "2019-06-15",
    recordedDate: "2019-07-01",
    measurementDisagreementExplained: false,
    assertedBasisNrd: false,
    nrdBasisEvidence: false,
    explicitNoBenefitStatement: false,
    vestingTreatment: "gross",
    annuityForm: "NSF",
    annuityFormConversionDocumented: false,
    calcMeasurementDate: "2019-06-15",
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
    schedulePaAmb: 124000,
    scheduleExplanationDocumented: false,
    bcvComparison: null,
    paymentAmountMinor: null,
    convertedPaAmbMinor: null,
    ardFactorsPresent: false,
    priorDistribution: null,
    formulaCheckValueMinor: 124000,
    formulaKnownForX06: true,
    formulaCheckValuesMinor: [124000],
    documentedHypothesis: false,
    pfFactors: null,
    proposedDisposition: null,
    evidenceCount: 0,
    paAmbAccept: null,
    disposition: null,
    decisionExists: false,
    rejectionRationaleStated: false,
    sourcesUsed: [],
    candidateMeasurementDates: ["2019-06-15"],
    establishedMeasurementDate: "2019-06-15",
    prior: null,
    ...overrides,
  };
}

function cleanContext(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    dopt: "2021-06-30",
    today: "2026-11-12",
    runId: "run-test-1",
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
    ...overrides,
  };
}

function priorParticipant(
  overrides: Partial<PriorExtractParticipantInput> = {},
): PriorExtractParticipantInput {
  return {
    asOfDate: "2020-06-30",
    present: true,
    crossExtractDuplicateKey: false,
    retstat: "2",
    dote: "2019-06-15",
    doh: "1990-05-01",
    dob: "1962-03-14",
    salaryByYear: salaryYears(2010, 2019, (y) => 4000000 + (y - 2010) * 10000),
    paAmb: 124000,
    cspa: "12.5",
    vs: "12.5",
    revisionEventForDates: false,
    revisionEventForSalary: false,
    statusChangeExplained: false,
    paAmbChangeExplained: false,
    ...overrides,
  };
}

function contextWithPrior(
  overrides: Partial<ValidationContext> = {},
): ValidationContext {
  return cleanContext({
    priorExtract: {
      asOfDate: "2020-06-30",
      participantKeys: ["SYN-BASE-001"],
      missingMovementKeys: [],
      duplicateKeys: [],
      statusCounts: { "3": 1 },
      movements: {
        newParticipants: 0,
        terminations: 0,
        deaths: 0,
        disabilities: 0,
        retirees: 0,
      },
      movementsExplained: true,
    },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

function evaluationFor(
  evaluations: RuleEvaluation[],
  ruleId: RuleId,
): RuleEvaluation {
  const found = evaluations.find((e) => e.ruleId === ruleId);
  assert.equal(found !== undefined, true, `expected an evaluation for ${ruleId}`);
  return found as RuleEvaluation;
}

function runRule(
  p: ValidationParticipant,
  ctx: ValidationContext,
  ruleId: RuleId,
): RuleEvaluation {
  return evaluationFor(validateParticipant(p, ctx), ruleId);
}

function failFindings(e: RuleEvaluation): Finding[] {
  return e.findings.filter((f) => f.outcome === "fail");
}

function hasBcv(e: RuleEvaluation, bcvPredicateId: string): boolean {
  return e.findings.some((f) => f.bcvPredicateId === bcvPredicateId);
}

// ---------------------------------------------------------------------------
// Baseline: the clean participant passes every rule that can pass.
// The rules that are not-applicable on the baseline are asserted in their
// own tests (S-01/S-03/S-11 file scope; P-01/P-16/L-01 cross-record;
// P-04 BCV-224/225 conflict C-1; X-04 unset range; C-03 no comparison;
// C-07 no PF output; L-02–L-08 no prior extract).
// ---------------------------------------------------------------------------

describe("baseline", () => {
  it("implements catalog 0.1.0 with 66 rules in order", () => {
    assert.equal(CATALOG_VERSION, "0.1.0");
    assert.equal(RULE_ORDER.length, 66);
  });

  it("clean participant passes every firable rule", () => {
    const evaluations = validateParticipant(cleanParticipant(), cleanContext());
    assert.equal(evaluations.length, 66);
    const passRules: RuleId[] = [
      "S-02", "S-04", "S-05", "S-06", "S-07", "S-08", "S-09", "S-10", "S-12",
      "P-02", "P-03", "P-05", "P-06", "P-07", "P-08", "P-09", "P-10", "P-11",
      "P-12", "P-13", "P-14", "P-15",
      "X-01", "X-02", "X-03", "X-05", "X-06", "X-07", "X-08", "X-09", "X-10",
      "X-11", "X-12", "X-13", "X-14",
      "M-01", "M-02", "M-03", "M-04", "M-05", "M-06",
      "C-01", "C-02", "C-04", "C-05", "C-06", "C-08", "C-09", "C-10",
    ];
    for (const ruleId of passRules) {
      assert.equal(
        evaluationFor(evaluations, ruleId).outcome,
        "pass",
        `expected ${ruleId} to pass on the clean baseline`,
      );
    }
    const naRules: RuleId[] = [
      "S-01", "S-03", "S-11", "P-01", "P-04", "P-16", "X-04",
      "L-01", "L-02", "L-03", "L-04", "L-05", "L-06", "L-07", "L-08",
      "C-03", "C-07",
    ];
    for (const ruleId of naRules) {
      assert.equal(
        evaluationFor(evaluations, ruleId).outcome,
        "not-applicable",
        `expected ${ruleId} to be not-applicable on the clean baseline`,
      );
    }
  });

  it("RETSTAT = 5 records are out of scope for the in-scope participant rules", () => {
    const evaluations = validateParticipant(
      cleanParticipant({ retstat: "5", paAmb: null }),
      cleanContext(),
    );
    // X-01 still applies (it tests RETSTAT = 5 itself); S rules still apply.
    assert.equal(evaluationFor(evaluations, "S-04").outcome, "pass");
    assert.equal(evaluationFor(evaluations, "X-01").outcome, "pass");
    assert.equal(evaluationFor(evaluations, "C-09").outcome, "pass");
    for (const ruleId of ["P-02", "P-06", "P-13", "X-05", "M-01", "L-02", "C-01"] as RuleId[]) {
      assert.equal(
        evaluationFor(evaluations, ruleId).outcome,
        "not-applicable",
        `expected ${ruleId} not-applicable for RETSTAT = 5`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 1 — Structural (S-01–S-12)
// ---------------------------------------------------------------------------

describe("structural rules", () => {
  it("S-01 passes when the file opens and the hash matches; fails Critical on unreadable file", () => {
    const ok = validateCasePackage([cleanParticipant()], cleanContext());
    assert.equal(evaluationFor(ok.fileEvaluations, "S-01").outcome, "pass");
    const bad = validateCasePackage(
      [cleanParticipant()],
      cleanContext({ file: { ...cleanContext().file, openable: false } }),
    );
    const e = evaluationFor(bad.fileEvaluations, "S-01");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Critical");
    assert.equal(failFindings(e)[0]?.blocksCalculation, "Yes");
    assert.equal(failFindings(e)[0]?.blocksScope, "import");
  });

  it("S-02 fails on a row that fails to parse", () => {
    const e = runRule(cleanParticipant({ parseError: "unexpected quote at column 4" }), cleanContext(), "S-02");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Error");
    assert.equal(failFindings(e)[0]?.blocksScope, "exact-calculation");
  });

  it("S-03 fails Warning on an unknown field name; passes when all names resolve", () => {
    const bad = validateCasePackage(
      [cleanParticipant()],
      cleanContext({ file: { ...cleanContext().file, unknownFields: ["PA_AMB2"] } }),
    );
    const e = evaluationFor(bad.fileEvaluations, "S-03");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Warning");
    assert.equal(failFindings(e)[0]?.blocksCalculation, "No");
    const ok = validateCasePackage([cleanParticipant()], cleanContext());
    assert.equal(evaluationFor(ok.fileEvaluations, "S-03").outcome, "pass");
  });

  it("S-04 fails Critical when RETSTAT is blank or invalid", () => {
    const blank = runRule(cleanParticipant({ retstat: null }), cleanContext(), "S-04");
    assert.equal(blank.outcome, "fail");
    assert.equal(failFindings(blank)[0]?.bcvPredicateId, "BCV-1000007");
    assert.equal(failFindings(blank)[0]?.bcvPredicateType, "4");
    const invalid = runRule(cleanParticipant({ retstat: "9" }), cleanContext(), "S-04");
    assert.equal(invalid.outcome, "fail");
  });

  it("S-05 fails Critical when ID is blank or not in {1,2,4}", () => {
    const e = runRule(cleanParticipant({ idType: "3" }), cleanContext(), "S-05");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.bcvPredicateId, "BCV-1000006");
    assert.equal(failFindings(e)[0]?.ruleSource, "MIXED");
  });

  it("S-06 fails when CASE is blank or the wrong length", () => {
    assert.equal(runRule(cleanParticipant({ caseNumber: "123" }), cleanContext(), "S-06").outcome, "fail");
    assert.equal(runRule(cleanParticipant({ caseNumber: null }), cleanContext(), "S-06").outcome, "fail");
  });

  it("S-06 fails at case level when CASE differs within one file", () => {
    const result = validateCasePackage(
      [cleanParticipant(), cleanParticipant({ participantKey: "SYN-BASE-002", bcvRecId: 2, caseNumber: "00099999" })],
      cleanContext(),
    );
    const e = result.populationEvaluations.find((x) => x.ruleId === "S-06");
    assert.equal(e?.outcome, "fail");
  });

  it("S-07 fails per unparseable or ambiguous date", () => {
    const e = runRule(
      cleanParticipant({ badDates: [{ field: "DOB", raw: "03/04/2019", ambiguous: true }] }),
      cleanContext(),
      "S-07",
    );
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e).length, 1);
  });

  it("S-08 fails per non-numeric or wrong-scale NUMBER value", () => {
    const e = runRule(
      cleanParticipant({ badNumbers: [{ field: "PA_AMB", raw: "12.40?", reason: "non-numeric text" }] }),
      cleanContext(),
      "S-08",
    );
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Error");
  });

  it("S-09 fails Warning when a monthly amount exceeds the $25,000 screening bound", () => {
    const e = runRule(cleanParticipant({ paAmb: 3000000, supportingEvidenceForScale: false }), cleanContext(), "S-09");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Warning");
    assert.equal(failFindings(e)[0]?.blocksCalculation, "No");
  });

  it("S-10 fails on a salary-year span mismatch", () => {
    const p = cleanParticipant({
      salaryByYear: salaryYears(2010, 2019, (y) => (y === 2019 ? null : 4000000)),
    });
    // 9 populated years over a 10-year span: span mismatch (a gap inside a
    // matching span would be P-14, not S-10).
    assert.equal(runRule(p, cleanContext(), "S-10").outcome, "fail");
  });

  it("S-11 fails Critical when a macro ran or the XLSM hash changed", () => {
    const bad = validateCasePackage(
      [cleanParticipant()],
      cleanContext({ file: { ...cleanContext().file, macroRan: true } }),
    );
    const e = evaluationFor(bad.fileEvaluations, "S-11");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Critical");
    assert.equal(failFindings(e)[0]?.blocksScope, "import");
    const ok = validateCasePackage([cleanParticipant()], cleanContext());
    assert.equal(evaluationFor(ok.fileEvaluations, "S-11").outcome, "pass");
  });

  it("S-12 fails per field imported without provenance", () => {
    const e = runRule(cleanParticipant({ fieldsWithoutProvenance: ["PA_AMB"] }), cleanContext(), "S-12");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e).length, 1);
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — Participant-level (P-01–P-16)
// ---------------------------------------------------------------------------

describe("participant-level rules", () => {
  it("P-01 fails on a duplicate BCV_REC_ID within one load (case level)", () => {
    const result = validateCasePackage(
      [cleanParticipant(), cleanParticipant({ participantKey: "SYN-BASE-002", ssn: "222334444" })],
      cleanContext(),
    );
    const e = result.populationEvaluations.find((x) => x.ruleId === "P-01");
    assert.equal(e?.outcome, "fail");
    const ok = validateCasePackage(
      [cleanParticipant(), cleanParticipant({ participantKey: "SYN-BASE-002", bcvRecId: 2, ssn: "222334444" })],
      cleanContext(),
    );
    assert.equal(ok.populationEvaluations.find((x) => x.ruleId === "P-01")?.outcome, "pass");
  });

  it("P-02 fails BCV-360 on blank DOB, BCV-361 before 1900, BCV-362 on/after DOPT", () => {
    assert.equal(hasBcv(runRule(cleanParticipant({ dob: null }), cleanContext(), "P-02"), "BCV-360"), true);
    assert.equal(hasBcv(runRule(cleanParticipant({ dob: "1899-12-31" }), cleanContext(), "P-02"), "BCV-361"), true);
    assert.equal(hasBcv(runRule(cleanParticipant({ dob: "2022-01-01" }), cleanContext(), "P-02"), "BCV-362"), true);
  });

  it("P-03 fails BCV-214 on blank DOH and BCV-216 when DOH precedes DOB", () => {
    assert.equal(hasBcv(runRule(cleanParticipant({ doh: null }), cleanContext(), "P-03"), "BCV-214"), true);
    const e = runRule(cleanParticipant({ doh: "1960-01-01" }), cleanContext(), "P-03");
    assert.equal(hasBcv(e, "BCV-216"), true);
    assert.equal(failFindings(e)[0]?.severity, "Error");
  });

  it("P-03 records BCV-215 as Warning when DOH is before 1930", () => {
    const e = runRule(cleanParticipant({ doh: "1929-06-01", dob: "1910-01-01", dote: "2019-06-15" }), cleanContext(), "P-03");
    assert.equal(hasBcv(e, "BCV-215"), true);
    const f = e.findings.find((x) => x.bcvPredicateId === "BCV-215");
    assert.equal(f?.severity, "Warning");
    assert.equal(f?.blocksCalculation, "No");
  });

  it("P-04 fails BCV-221 on blank DOTE and records BCV-224/225 not-applicable (conflict C-1)", () => {
    const e = runRule(cleanParticipant({ dote: null }), cleanContext(), "P-04");
    assert.equal(e.outcome, "fail");
    assert.equal(hasBcv(e, "BCV-221"), true);
    const na224 = e.findings.find((x) => x.bcvPredicateId === "BCV-224");
    const na225 = e.findings.find((x) => x.bcvPredicateId === "BCV-225");
    assert.equal(na224?.outcome, "not-applicable");
    assert.equal(na225?.outcome, "not-applicable");
    assert.equal(na224?.discrepancy.includes("C-1 unresolved"), true);
    // Even with a populated DOTE, neither 224 nor 225 is implemented.
    const populated = runRule(cleanParticipant(), cleanContext(), "P-04");
    assert.equal(populated.findings.filter((x) => x.outcome === "fail").length, 0);
    assert.equal(populated.findings.filter((x) => x.outcome === "not-applicable").length, 2);
  });

  it("P-05 fails BCV-249 when a pre-DOPT retiree has no DOR", () => {
    const e = runRule(cleanParticipant({ isPreDoptRetiree: true }), cleanContext(), "P-05");
    assert.equal(hasBcv(e, "BCV-249"), true);
    assert.equal(failFindings(e)[0]?.severity, "Error");
  });

  it("P-06 fails BCV-276 (APP restatement of disabled predicate) on blank CS", () => {
    const e = runRule(cleanParticipant({ cs: null }), cleanContext(), "P-06");
    assert.equal(e.outcome, "fail");
    const f = e.findings.find((x) => x.bcvPredicateId === "BCV-276");
    assert.equal(f !== undefined, true);
    assert.equal(f?.ruleSource, "APP");
    assert.equal(f?.severity, "Error");
    assert.equal(f?.blocksScope, "exact-calculation");
  });

  it("P-06 fails BCV-278 when CS exceeds 83.25 years and BCV-420 when VS is 0", () => {
    assert.equal(hasBcv(runRule(cleanParticipant({ cs: "90" }), cleanContext(), "P-06"), "BCV-278"), true);
    assert.equal(hasBcv(runRule(cleanParticipant({ vs: "0" }), cleanContext(), "P-06"), "BCV-420"), true);
  });

  it("P-07 fails BCV-283 on blank ANB and BCV-284 out of range", () => {
    assert.equal(hasBcv(runRule(cleanParticipant({ anb: null }), cleanContext(), "P-07"), "BCV-283"), true);
    assert.equal(hasBcv(runRule(cleanParticipant({ anb: 1000 }), cleanContext(), "P-07"), "BCV-284"), true);
  });

  it("P-08 fails BCV-305 on blank NRD", () => {
    const e = runRule(cleanParticipant({ nrd: null }), cleanContext(), "P-08");
    assert.equal(hasBcv(e, "BCV-305"), true);
  });

  it("P-09 fails BCV-308 when RBD cannot be determined", () => {
    const e = runRule(
      cleanParticipant({ rbdDeterminable: false, rbdMissingFields: ["DOB", "DOTE"] }),
      cleanContext(),
      "P-09",
    );
    assert.equal(hasBcv(e, "BCV-308"), true);
    assert.equal(failFindings(e)[0]?.actual.includes("DOB"), true);
  });

  it("P-10 fails when a beneficiary record lacks identity fields", () => {
    const e = runRule(cleanParticipant({ idType: "2", benSsn: null, benLastName: null, benDob: null }), cleanContext(), "P-10");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Error");
  });

  it("P-10 fails when beneficiary death precedes birth, warns on unknown sex", () => {
    const death = runRule(
      cleanParticipant({ idType: "2", benSsn: "999887777", benLastName: "Fictional", benDob: "1965-01-01", benDateOfDeath: "1960-01-01" }),
      cleanContext(),
      "P-10",
    );
    assert.equal(death.outcome, "fail");
    const sex = runRule(
      cleanParticipant({ idType: "2", benSsn: "999887777", benLastName: "Fictional", benDob: "1965-01-01", benSex: "U" }),
      cleanContext(),
      "P-10",
    );
    const warning = sex.findings.find((x) => x.severity === "Warning");
    assert.equal(warning !== undefined, true);
    assert.equal(warning?.blocksCalculation, "No");
  });

  it("P-11 fails Error on blank PSEX and Warning on U", () => {
    const blank = runRule(cleanParticipant({ sex: null }), cleanContext(), "P-11");
    assert.equal(hasBcv(blank, "BCV-389"), true);
    const unknown = runRule(cleanParticipant({ sex: "U" }), cleanContext(), "P-11");
    assert.equal(hasBcv(unknown, "BCV-388"), true);
    assert.equal(failFindings(unknown)[0]?.severity, "Warning");
    assert.equal(failFindings(unknown)[0]?.blocksCalculation, "No");
  });

  it("P-12 fails Warning when DOP precedes DOH", () => {
    const e = runRule(cleanParticipant({ dop: "1989-01-01" }), cleanContext(), "P-12");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Warning");
    assert.equal(failFindings(e)[0]?.blocksCalculation, "No");
  });

  it("P-13 fails Error on blank PA_AMB with no explicit statement; passes with one", () => {
    assert.equal(runRule(cleanParticipant({ paAmb: null }), cleanContext(), "P-13").outcome, "fail");
    assert.equal(
      runRule(cleanParticipant({ paAmb: null, explicitNoBenefitStatement: true }), cleanContext(), "P-13").outcome,
      "pass",
    );
  });

  it("P-14 fails Error on an averaging-period salary gap, Warning outside it", () => {
    const inPeriod = cleanParticipant({
      salaryByYear: salaryYears(2010, 2019, (y) => (y === 2017 ? null : 4000000)),
    });
    const e = runRule(inPeriod, cleanContext(), "P-14");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e).some((f) => f.severity === "Error"), true);
    const outside = cleanParticipant({
      salaryByYear: salaryYears(2010, 2019, (y) => (y === 2011 ? null : 4000000)),
    });
    const e2 = runRule(outside, cleanContext(), "P-14");
    assert.equal(e2.outcome, "fail");
    assert.equal(failFindings(e2).every((f) => f.severity === "Warning"), true);
  });

  it("P-15 fails Warning when credited service exceeds elapsed time", () => {
    const e = runRule(cleanParticipant({ cspa: "40" }), cleanContext(), "P-15");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Warning");
    assert.equal(failFindings(e)[0]?.blocksCalculation, "No");
  });

  it("P-15 is not-applicable on the VSPA-vs-CSPA leg until the plan rule is set", () => {
    // VSPA 13.5 vs CSPA 12.5: excess exists, allowed excess unknown.
    const e = runRule(cleanParticipant({ vspa: "13.5" }), cleanContext(), "P-15");
    assert.equal(e.outcome, "not-applicable");
    assert.equal(e.findings[0]?.discrepancy.includes("allowed excess is not established"), true);
    // With the plan rule set (allowed excess 2 years), the same record passes.
    const withRule = runRule(
      cleanParticipant({ vspa: "13.5" }),
      cleanContext({ planServiceCreditRule: { creditsAllowedYears: null, maxVestingExcessYears: "2" } }),
      "P-15",
    );
    assert.equal(withRule.outcome, "pass");
  });

  it("P-16 fails on conflicting identity across records (case level)", () => {
    const result = validateCasePackage(
      [
        cleanParticipant(),
        cleanParticipant({ participantKey: "SYN-BASE-002", bcvRecId: 2, dob: "1970-05-05" }),
      ],
      cleanContext(),
    );
    const e = result.populationEvaluations.find((x) => x.ruleId === "P-16");
    assert.equal(e?.outcome, "fail");
    assert.equal(failFindings(e as RuleEvaluation)[0]?.severity, "Error");
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — Cross-field (X-01–X-14)
// ---------------------------------------------------------------------------

describe("cross-field rules", () => {
  it("X-01 fails Error for RETSTAT = 5 with a populated PA_AMB, and for blank PA_AMB in population", () => {
    assert.equal(runRule(cleanParticipant({ retstat: "5" }), cleanContext(), "X-01").outcome, "fail");
    assert.equal(
      runRule(cleanParticipant({ paAmb: null }), cleanContext(), "X-01").outcome,
      "fail",
    );
  });

  it("X-02 fails BCV-350 Warning when RETSTAT = 2 but DOTE is on/after DOPT", () => {
    const e = runRule(cleanParticipant({ dote: "2022-01-01" }), cleanContext(), "X-02");
    assert.equal(hasBcv(e, "BCV-350"), true);
    assert.equal(failFindings(e).find((f) => f.bcvPredicateId === "BCV-350")?.severity, "Warning");
    assert.equal(failFindings(e).find((f) => f.bcvPredicateId === "BCV-350")?.blocksCalculation, "No");
  });

  it("X-02 fails BCV-351 Error when RBD is on/before DOPT and RETSTAT is not 1", () => {
    const e = runRule(cleanParticipant({ rbd: "2020-01-01" }), cleanContext(), "X-02");
    assert.equal(hasBcv(e, "BCV-351"), true);
    assert.equal(failFindings(e).find((f) => f.bcvPredicateId === "BCV-351")?.bcvPredicateType, "4");
  });

  it("X-03 fails Error (blocks nothing) when not fully vested in employee contributions", () => {
    const e = runRule(cleanParticipant({ mandcwi: 50000, vppa: "0.5" }), cleanContext(), "X-03");
    assert.equal(e.outcome, "fail");
    const f = failFindings(e).find((x) => x.bcvPredicateId === "BCV-333/BCV-416");
    assert.equal(f !== undefined, true);
    assert.equal(f?.severity, "Error");
    assert.equal(f?.blocksCalculation, "No");
    assert.equal(f?.bcvPredicateType, "4/7");
  });

  it("X-04 is not-applicable without the range, passes inside it, fails outside it", () => {
    const na = runRule(cleanParticipant(), cleanContext(), "X-04");
    assert.equal(na.outcome, "not-applicable");
    assert.equal(na.findings[0]?.discrepancy.includes("never a pass"), true);
    const pass = runRule(
      cleanParticipant(),
      cleanContext({ plausibleBenefitCompRatioRange: { min: "0.1", max: "0.5" } }),
      "X-04",
    );
    assert.equal(pass.outcome, "pass");
    const fail = runRule(
      cleanParticipant(),
      cleanContext({ plausibleBenefitCompRatioRange: { min: "0.1", max: "0.2" } }),
      "X-04",
    );
    assert.equal(fail.outcome, "fail");
    assert.equal(failFindings(fail)[0]?.severity, "Warning");
  });

  it("X-05 fails Error on zero credited service with a positive PA_AMB", () => {
    assert.equal(runRule(cleanParticipant({ cspa: "0" }), cleanContext(), "X-05").outcome, "fail");
    assert.equal(
      runRule(
        cleanParticipant({ cspa: "0", documentedMinimumOrGrandfatherOrPastServiceCredit: true }),
        cleanContext(),
        "X-05",
      ).outcome,
      "pass",
    );
  });

  it("X-06 fails Warning when PA_AMB differs from the PA's own arithmetic beyond tolerance", () => {
    const e = runRule(cleanParticipant({ formulaCheckValueMinor: 100000 }), cleanContext(), "X-06");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Warning");
    assert.equal(failFindings(e)[0]?.blocksCalculation, "No");
  });

  it("X-06 is not-applicable without a case tolerance (engine refuses to compare)", () => {
    const e = runRule(cleanParticipant(), cleanContext({ tolerance: null }), "X-06");
    assert.equal(e.outcome, "not-applicable");
    // Policy 5.8-1 figures exist as reference data only and are never the tolerance.
    assert.equal(POLICY_5_8_1_REFERENCE.oneDollarMinor, 100);
    assert.equal(POLICY_5_8_1_REFERENCE.fiveDollarMinor, 500);
  });

  it("X-07 fails Warning when PA service differs from BCV service beyond tolerance", () => {
    const e = runRule(cleanParticipant({ cs: "10" }), cleanContext(), "X-07");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Warning");
  });

  it("X-07 records not-applicable for a pair with a missing side", () => {
    const e = runRule(cleanParticipant({ cs: null }), cleanContext(), "X-07");
    assert.equal(e.outcome, "not-applicable");
    assert.equal(e.findings.length, 1);
    assert.equal(e.findings[0]?.discrepancy.includes("CSPA/CS"), true);
  });

  it("X-08 fails Error when PIA is missing for an integrated formula", () => {
    const e = runRule(cleanParticipant({ integrationMethod: "offset" }), cleanContext(), "X-08");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Error");
    assert.equal(
      runRule(cleanParticipant({ integrationMethod: "offset", pia: 150000 }), cleanContext(), "X-08").outcome,
      "pass",
    );
  });

  it("X-09 fails Error when PA_AMB is positive, participant nonvested, treatment unknown", () => {
    const e = runRule(
      cleanParticipant({ retstat: "4", vppa: "0", vestingTreatment: "unknown" }),
      cleanContext(),
      "X-09",
    );
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Error");
  });

  it("X-10 fails Error when the annuity form of PA_AMB is unknown", () => {
    assert.equal(runRule(cleanParticipant({ annuityForm: null }), cleanContext(), "X-10").outcome, "fail");
  });

  it("X-11 fails Error on an invalid form code and on survivor % outside [0,1]", () => {
    assert.equal(runRule(cleanParticipant({ formCode: null }), cleanContext(), "X-11").outcome, "fail");
    assert.equal(runRule(cleanParticipant({ formCode: "BOGUS" }), cleanContext(), "X-11").outcome, "fail");
    const spc = runRule(cleanParticipant({ spcVal: "1.5" }), cleanContext(), "X-11");
    assert.equal(spc.outcome, "fail");
    assert.equal(failFindings(spc).some((f) => f.severity === "Error"), true);
    const mths = runRule(cleanParticipant({ mths: 240 }), cleanContext(), "X-11");
    assert.equal(mths.outcome, "fail");
  });

  it("X-11 warns on an ARD form outside the valid list and on joint-life code on a single-life record", () => {
    const ard = runRule(cleanParticipant({ formCodeArd: "BOGUS" }), cleanContext(), "X-11");
    assert.equal(ard.outcome, "fail");
    assert.equal(failFindings(ard)[0]?.severity, "Warning");
    const joint = runRule(cleanParticipant({ formCodeIsJointLife: true }), cleanContext(), "X-11");
    assert.equal(joint.outcome, "fail");
    assert.equal(failFindings(joint)[0]?.severity, "Warning");
  });

  it("X-12 fails Error (blocks nothing) when a critical valuation field is blank", () => {
    const e = runRule(cleanParticipant({ lsTerm: null }), cleanContext(), "X-12");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.bcvPredicateId, "BCV-434");
    assert.equal(failFindings(e)[0]?.blocksCalculation, "No");
  });

  it("X-13 fails Warning when a contribution balance has no documented treatment", () => {
    const e = runRule(
      cleanParticipant({ mandcwi: 50000, contributionTreatmentDocumented: false }),
      cleanContext(),
      "X-13",
    );
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Warning");
  });

  it("X-14 fails Error on accrual after the benefit freeze date", () => {
    const e = runRule(
      cleanParticipant({ planFreezeDate: "2015-01-01", accrualAfterFreeze: true }),
      cleanContext(),
      "X-14",
    );
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Error");
    assert.equal(failFindings(e)[0]?.blocksScope, "exact-calculation");
  });
});

// ---------------------------------------------------------------------------
// Layer 4 — Measurement-date resolution (M-01–M-06)
// ---------------------------------------------------------------------------

describe("measurement-date rules", () => {
  it("M-01 fails Error for RETSTAT 2 with PA_AMB populated and DOTE blank; Warning for RETSTAT 3", () => {
    const e = runRule(cleanParticipant({ dote: null }), cleanContext(), "M-01");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Error");
    const active = runRule(cleanParticipant({ dote: null, retstat: "3" }), cleanContext(), "M-01");
    assert.equal(failFindings(active)[0]?.severity, "Warning");
    assert.equal(failFindings(active)[0]?.blocksCalculation, "No");
  });

  it("M-02 fails Error when only a recorded/filed date is known", () => {
    const e = runRule(cleanParticipant({ measurementDate: null }), cleanContext(), "M-02");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Error");
  });

  it("M-03 fails Warning when the established date disagrees with DOTE unexplained", () => {
    const e = runRule(cleanParticipant({ measurementDate: "2019-01-01" }), cleanContext(), "M-03");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Warning");
    assert.equal(
      runRule(
        cleanParticipant({ measurementDate: "2019-01-01", measurementDisagreementExplained: true }),
        cleanContext(),
        "M-03",
      ).outcome,
      "pass",
    );
  });

  it("M-04 fails Error on an unevidenced NRD-basis claim", () => {
    assert.equal(runRule(cleanParticipant({ assertedBasisNrd: true }), cleanContext(), "M-04").outcome, "fail");
    assert.equal(
      runRule(cleanParticipant({ assertedBasisNrd: true, nrdBasisEvidence: true }), cleanContext(), "M-04").outcome,
      "pass",
    );
  });

  it("M-05 fails Critical and blocks the comparison when bases differ", () => {
    const e = runRule(cleanParticipant({ calcMeasurementDate: "2020-01-01" }), cleanContext(), "M-05");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Critical");
    assert.equal(failFindings(e)[0]?.blocksCalculation, "Yes");
    assert.equal(failFindings(e)[0]?.blocksScope, "comparison");
    // Unknown on either side also fails the equivalence.
    const unknown = runRule(cleanParticipant({ measurementDate: null }), cleanContext(), "M-05");
    assert.equal(unknown.outcome, "fail");
  });

  it("M-06 fails Warning when more than one candidate date exists and none is established", () => {
    const e = runRule(
      cleanParticipant({
        candidateMeasurementDates: ["2019-06-15", "2020-01-01"],
        establishedMeasurementDate: null,
      }),
      cleanContext(),
      "M-06",
    );
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Warning");
  });
});

// ---------------------------------------------------------------------------
// Layer 5 — Longitudinal (L-01–L-08)
// ---------------------------------------------------------------------------

describe("longitudinal rules", () => {
  it("L-01 passes when the population reconciles; fails when it does not (case level)", () => {
    const ok = validateCasePackage(
      [cleanParticipant({ retstat: "3", dote: null, measurementDate: "2021-06-30", calcMeasurementDate: "2021-06-30" })],
      contextWithPrior(),
    );
    assert.equal(ok.populationEvaluations.find((x) => x.ruleId === "L-01")?.outcome, "pass");
    const bad = validateCasePackage(
      [cleanParticipant({ retstat: "3", dote: null, measurementDate: "2021-06-30", calcMeasurementDate: "2021-06-30" })],
      contextWithPrior({
        priorExtract: {
          asOfDate: "2020-06-30",
          participantKeys: ["SYN-BASE-001"],
          missingMovementKeys: [],
          duplicateKeys: [],
          statusCounts: { "3": 1 },
          movements: { newParticipants: 0, terminations: 0, deaths: 0, disabilities: 0, retirees: 1 },
          movementsExplained: false,
        },
      }),
    );
    const e = bad.populationEvaluations.find((x) => x.ruleId === "L-01");
    assert.equal(e?.outcome, "fail");
    assert.equal(failFindings(e as RuleEvaluation)[0]?.severity, "Error");
  });

  it("L-02 fails Warning on a cross-extract duplicate key; is not-applicable with no prior extract", () => {
    const p = cleanParticipant({ prior: priorParticipant({ crossExtractDuplicateKey: true }) });
    assert.equal(runRule(p, contextWithPrior(), "L-02").outcome, "fail");
    assert.equal(runRule(cleanParticipant(), cleanContext(), "L-02").outcome, "not-applicable");
  });

  it("L-02 fails at case level for a disappearance with no movement record", () => {
    const result = validateCasePackage(
      [cleanParticipant()],
      contextWithPrior({
        priorExtract: {
          asOfDate: "2020-06-30",
          participantKeys: ["SYN-BASE-001", "SYN-GONE-001"],
          missingMovementKeys: ["SYN-GONE-001"],
          duplicateKeys: [],
          statusCounts: { "3": 1 },
          movements: { newParticipants: 0, terminations: 0, deaths: 0, disabilities: 0, retirees: 0 },
          movementsExplained: true,
        },
      }),
    );
    const e = result.populationEvaluations.find((x) => x.ruleId === "L-02");
    assert.equal(e?.outcome, "fail");
    assert.equal(failFindings(e as RuleEvaluation)[0]?.participantKey, "SYN-GONE-001");
  });

  it("L-03 fails Warning on a backwards status move without explanation", () => {
    const p = cleanParticipant({
      retstat: "3",
      dote: null,
      measurementDate: "2021-06-30",
      calcMeasurementDate: "2021-06-30",
      prior: priorParticipant({ retstat: "1" }),
    });
    assert.equal(runRule(p, contextWithPrior(), "L-03").outcome, "fail");
    const explained = cleanParticipant({
      retstat: "3",
      dote: null,
      measurementDate: "2021-06-30",
      calcMeasurementDate: "2021-06-30",
      prior: priorParticipant({ retstat: "1", statusChangeExplained: true }),
    });
    assert.equal(runRule(explained, contextWithPrior(), "L-03").outcome, "pass");
  });

  it("L-04 fails Warning when DOTE changes between extracts without a revision event", () => {
    const p = cleanParticipant({ dote: "2019-07-01", prior: priorParticipant() });
    assert.equal(runRule(p, contextWithPrior(), "L-04").outcome, "fail");
    const revised = cleanParticipant({
      dote: "2019-07-01",
      prior: priorParticipant({ revisionEventForDates: true }),
    });
    assert.equal(runRule(revised, contextWithPrior(), "L-04").outcome, "pass");
  });

  it("L-05 fails Warning on restated pay without a revision event", () => {
    const p = cleanParticipant({
      salaryByYear: salaryYears(2010, 2019, (y) => (y === 2015 ? 4100000 : 4000000 + (y - 2010) * 10000)),
      prior: priorParticipant(),
    });
    assert.equal(runRule(p, contextWithPrior(), "L-05").outcome, "fail");
  });

  it("L-06 fails Warning when PA_AMB changes without an explaining event", () => {
    const p = cleanParticipant({ prior: priorParticipant({ paAmb: 100000 }) });
    assert.equal(runRule(p, contextWithPrior(), "L-06").outcome, "fail");
    const explained = cleanParticipant({ prior: priorParticipant({ paAmb: 100000, paAmbChangeExplained: true }) });
    assert.equal(runRule(explained, contextWithPrior(), "L-06").outcome, "pass");
  });

  it("L-07 fails Warning when service decreases between extracts", () => {
    const p = cleanParticipant({ cspa: "10", prior: priorParticipant() });
    assert.equal(runRule(p, contextWithPrior(), "L-07").outcome, "fail");
  });

  it("L-08 fails Error when a high-impact date differs, even with a revision event", () => {
    const p = cleanParticipant({ dob: "1963-03-14", prior: priorParticipant({ revisionEventForDates: true }) });
    const e = runRule(p, contextWithPrior(), "L-08");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Error");
    assert.equal(failFindings(e)[0]?.blocksScope, "exact-calculation");
  });
});

// ---------------------------------------------------------------------------
// Layer 6 — Cross-source (C-01–C-10)
// ---------------------------------------------------------------------------

describe("cross-source rules", () => {
  it("C-01 fails Warning with no schedule at all, Error when the schedule lacks the participant", () => {
    const noSchedule = runRule(cleanParticipant({ scheduleProvided: false, scheduleRowExists: false }), cleanContext(), "C-01");
    assert.equal(noSchedule.outcome, "fail");
    assert.equal(failFindings(noSchedule)[0]?.severity, "Warning");
    assert.equal(failFindings(noSchedule)[0]?.blocksCalculation, "No");
    const missingRow = runRule(cleanParticipant({ scheduleRowExists: false }), cleanContext(), "C-01");
    assert.equal(missingRow.outcome, "fail");
    assert.equal(failFindings(missingRow)[0]?.severity, "Error");
    assert.equal(failFindings(missingRow)[0]?.blocksScope, "exact-calculation");
  });

  it("C-02 fails Error on census vs schedule mismatch (exact equality, no tolerance)", () => {
    const e = runRule(cleanParticipant({ schedulePaAmb: 124001 }), cleanContext(), "C-02");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Error");
  });

  it("C-03 fails Warning on an unconverted different-basis comparison; passes on same-basis or converted", () => {
    const bad = runRule(
      cleanParticipant({ bcvComparison: { basis: "nrd", conversionApplied: false } }),
      cleanContext(),
      "C-03",
    );
    assert.equal(bad.outcome, "fail");
    assert.equal(failFindings(bad)[0]?.ruleSource, "OFFICIAL_REFERENCE_ONLY");
    assert.equal(
      runRule(cleanParticipant({ bcvComparison: { basis: "nrd", conversionApplied: true } }), cleanContext(), "C-03").outcome,
      "pass",
    );
    assert.equal(
      runRule(cleanParticipant({ bcvComparison: { basis: "dote", conversionApplied: false } }), cleanContext(), "C-03").outcome,
      "pass",
    );
  });

  it("C-04 fails Warning when the payment differs from converted PA_AMB beyond tolerance", () => {
    const p = cleanParticipant({
      retstat: "1",
      dote: "2018-04-30",
      dor: "2018-05-01",
      measurementDate: "2018-04-30",
      calcMeasurementDate: "2018-04-30",
      isPreDoptRetiree: true,
      isDeferredRecord: false,
      inPayAtDopt: true,
      ardFactorsPresent: true,
      paymentAmountMinor: 100000,
      convertedPaAmbMinor: 124000,
    });
    const e = runRule(p, cleanContext(), "C-04");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Warning");
  });

  it("C-04 is not-applicable without a case tolerance", () => {
    const p = cleanParticipant({
      retstat: "1",
      dote: "2018-04-30",
      dor: "2018-05-01",
      measurementDate: "2018-04-30",
      calcMeasurementDate: "2018-04-30",
      isPreDoptRetiree: true,
      isDeferredRecord: false,
      inPayAtDopt: true,
      ardFactorsPresent: true,
      paymentAmountMinor: 100000,
      convertedPaAmbMinor: 124000,
    });
    assert.equal(runRule(p, cleanContext({ tolerance: null }), "C-04").outcome, "not-applicable");
  });

  it("C-05 fails Warning on an unreflected prior distribution", () => {
    const p = cleanParticipant({
      priorDistribution: {
        exists: true,
        reflectedInPaAmb: false,
        documentedAsNotAffecting: false,
        inCensus: true,
        inSchedule: true,
      },
    });
    assert.equal(runRule(p, cleanContext(), "C-05").outcome, "fail");
    const documented = cleanParticipant({
      priorDistribution: {
        exists: true,
        reflectedInPaAmb: false,
        documentedAsNotAffecting: true,
        inCensus: true,
        inSchedule: true,
      },
    });
    assert.equal(runRule(documented, cleanContext(), "C-05").outcome, "pass");
  });

  it("C-06 fails Warning when no formula version produces PA_AMB within tolerance", () => {
    const e = runRule(cleanParticipant({ formulaCheckValuesMinor: [500000] }), cleanContext(), "C-06");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Warning");
  });

  it("C-06 is not-applicable without a tolerance, and without an identified formula", () => {
    assert.equal(
      runRule(cleanParticipant(), cleanContext({ tolerance: null }), "C-06").outcome,
      "not-applicable",
    );
    assert.equal(
      runRule(cleanParticipant({ formulaCheckValuesMinor: null }), cleanContext(), "C-06").outcome,
      "not-applicable",
    );
  });

  it("C-07 fails Warning on an unexplained PF factor disagreement; not-applicable without PF output", () => {
    assert.equal(runRule(cleanParticipant(), cleanContext(), "C-07").outcome, "not-applicable");
    const bad = runRule(
      cleanParticipant({
        pfFactors: { paFactor: "0.015", pfFactor: "0.016", era: "2019", form: "NSF", differenceDocumented: false },
      }),
      cleanContext(),
      "C-07",
    );
    assert.equal(bad.outcome, "fail");
    const agree = runRule(
      cleanParticipant({
        pfFactors: { paFactor: "0.015", pfFactor: "0.015", era: "2019", form: "NSF", differenceDocumented: false },
      }),
      cleanContext(),
      "C-07",
    );
    assert.equal(agree.outcome, "pass");
  });

  it("C-08 fails Error (decision scope) on a correction proposed with no evidence", () => {
    const e = runRule(
      cleanParticipant({ proposedDisposition: "correction-recommended", evidenceCount: 0 }),
      cleanContext(),
      "C-08",
    );
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Error");
    assert.equal(failFindings(e)[0]?.blocksScope, "decision");
    assert.equal(
      runRule(
        cleanParticipant({ proposedDisposition: "correction-recommended", evidenceCount: 2 }),
        cleanContext(),
        "C-08",
      ).outcome,
      "pass",
    );
  });

  it("C-09 fails Critical when PA_AMB_ACCEPT is set without or against a decision", () => {
    const noDecision = runRule(cleanParticipant({ paAmbAccept: "Y" }), cleanContext(), "C-09");
    assert.equal(noDecision.outcome, "fail");
    assert.equal(failFindings(noDecision)[0]?.severity, "Critical");
    assert.equal(failFindings(noDecision)[0]?.blocksScope, "decision");
    const against = runRule(
      cleanParticipant({ paAmbAccept: "Y", decisionExists: true, disposition: "requires-investigation" }),
      cleanContext(),
      "C-09",
    );
    assert.equal(against.outcome, "fail");
    const consistent = runRule(
      cleanParticipant({ paAmbAccept: "Y", decisionExists: true, disposition: "verified" }),
      cleanContext(),
      "C-09",
    );
    assert.equal(consistent.outcome, "pass");
    const nVerified = runRule(
      cleanParticipant({ paAmbAccept: "N", decisionExists: true, disposition: "verified" }),
      cleanContext(),
      "C-09",
    );
    assert.equal(nVerified.outcome, "fail");
  });

  it("C-10 fails Warning when a low/unassessed source is used with no limitation noted", () => {
    const e = runRule(
      cleanParticipant({
        sourcesUsed: [{ documentId: "doc-1", reliabilityGrade: "low", limitationNoted: false }],
      }),
      cleanContext(),
      "C-10",
    );
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.severity, "Warning");
    const noted = runRule(
      cleanParticipant({
        sourcesUsed: [{ documentId: "doc-1", reliabilityGrade: "low", limitationNoted: true }],
      }),
      cleanContext(),
      "C-10",
    );
    assert.equal(noted.outcome, "pass");
  });
});

// ---------------------------------------------------------------------------
// Worked synthetic examples — catalog §11 (all participants fictional)
// ---------------------------------------------------------------------------

describe("worked examples (catalog §11)", () => {
  it("Example 1 — SYN-001: zero credited service, CS blank", () => {
    const p = cleanParticipant({
      participantKey: "SYN-001",
      dob: "1962-03-14",
      doh: "1990-05-01",
      dote: "2019-06-15",
      retstat: "2",
      paAmb: 124000,
      paAcomp: 410000,
      cspa: "0",
      cs: null,
      vspa: "12.5",
      vs: "12.5",
      schedulePaAmb: 124000,
      vestingTreatment: "gross",
    });
    const evaluations = validateParticipant(p, cleanContext());
    // P-06 BCV-276 (APP restatement) — Error, Exact-only.
    const p06 = evaluationFor(evaluations, "P-06");
    assert.equal(p06.outcome, "fail");
    const f276 = p06.findings.find((f) => f.bcvPredicateId === "BCV-276");
    assert.equal(f276?.severity, "Error");
    assert.equal(f276?.blocksCalculation, "Exact-only");
    assert.equal(f276?.blocksScope, "exact-calculation");
    assert.equal(f276?.ruleSource, "APP");
    assert.equal(f276?.actual, "CS blank.");
    // X-05 — Error, Exact-only.
    const x05 = evaluationFor(evaluations, "X-05");
    assert.equal(x05.outcome, "fail");
    assert.equal(failFindings(x05)[0]?.severity, "Error");
    // X-07: CSPA/CS pair not-applicable (CS blank); VSPA/VS passes.
    const x07 = evaluationFor(evaluations, "X-07");
    assert.equal(x07.outcome, "not-applicable");
    assert.equal(x07.findings.length, 1);
    // Decisive passes.
    assert.equal(evaluationFor(evaluations, "P-13").outcome, "pass");
    assert.equal(evaluationFor(evaluations, "X-09").outcome, "pass");
    assert.equal(evaluationFor(evaluations, "M-01").outcome, "pass");
    assert.equal(evaluationFor(evaluations, "C-01").outcome, "pass");
    assert.equal(evaluationFor(evaluations, "C-02").outcome, "pass");
  });

  it("Example 2 — SYN-002: PA_AMB populated, DOTE blank — unresolved basis, no Δ", () => {
    const p = cleanParticipant({
      participantKey: "SYN-002",
      dob: "1958-11-02",
      doh: "1985-09-08",
      dote: null,
      retstat: "2",
      paAmb: 86050,
      cspa: "18.25",
      cs: "18.25",
      measurementDate: null,
      recordedDate: "2021-03-15",
      calcMeasurementDate: "2021-06-30",
      scheduleProvided: false,
      scheduleRowExists: false,
      schedulePaAmb: null,
      candidateMeasurementDates: [],
      establishedMeasurementDate: null,
    });
    const evaluations = validateParticipant(p, cleanContext());
    // P-04 BCV-221 — Error; 224/225 not-applicable (conflict C-1).
    const p04 = evaluationFor(evaluations, "P-04");
    assert.equal(hasBcv(p04, "BCV-221"), true);
    assert.equal(p04.findings.find((f) => f.bcvPredicateId === "BCV-224")?.outcome, "not-applicable");
    assert.equal(p04.findings.find((f) => f.bcvPredicateId === "BCV-225")?.outcome, "not-applicable");
    // M-01 — Error, Exact-only.
    const m01 = evaluationFor(evaluations, "M-01");
    assert.equal(m01.outcome, "fail");
    assert.equal(failFindings(m01)[0]?.severity, "Error");
    assert.equal(failFindings(m01)[0]?.blocksScope, "exact-calculation");
    // M-02 — Error, Exact-only.
    assert.equal(evaluationFor(evaluations, "M-02").outcome, "fail");
    // M-05 — Critical, blocks the comparison only.
    const m05 = evaluationFor(evaluations, "M-05");
    assert.equal(m05.outcome, "fail");
    assert.equal(failFindings(m05)[0]?.severity, "Critical");
    assert.equal(failFindings(m05)[0]?.blocksCalculation, "Yes");
    assert.equal(failFindings(m05)[0]?.blocksScope, "comparison");
    // C-01 — Warning (no schedule at all).
    const c01 = evaluationFor(evaluations, "C-01");
    assert.equal(c01.outcome, "fail");
    assert.equal(failFindings(c01)[0]?.severity, "Warning");
    // Decisive passes.
    assert.equal(evaluationFor(evaluations, "X-07").outcome, "pass");
    assert.equal(evaluationFor(evaluations, "P-06").outcome, "pass");
    assert.equal(evaluationFor(evaluations, "P-13").outcome, "pass");
    // No Δ is computed: M-05 blocks the comparison, so no comparison
    // finding may present a delta. (The engine never computes Δ here.)
    assert.equal(failFindings(m05)[0]?.discrepancy.includes("no Δ is computed"), true);
  });

  it("Example 3 — SYN-003: census vs schedule mismatch", () => {
    const p = cleanParticipant({
      participantKey: "SYN-003",
      dob: "1955-01-01",
      doh: "1980-01-01",
      dote: "2018-04-30",
      dor: "2018-05-01",
      retstat: "1",
      nrd: "2020-01-01",
      anb: 66,
      sanb: 64,
      rbd: "2020-01-01",
      inPayAtDopt: true,
      isPreDoptRetiree: true,
      isDeferredRecord: false,
      cspa: "38.25",
      cs: "38.25",
      vspa: "38.25",
      vs: "38.25",
      espa: "38.25",
      es: "38.25",
      paAmb: 201575,
      schedulePaAmb: 215075,
      measurementDate: "2018-04-30",
      calcMeasurementDate: "2018-04-30",
      firstYear: 2009,
      lastYear: 2018,
      salaryByYear: salaryYears(2009, 2018, (y) => 4000000 + (y - 2009) * 10000),
      averagingPeriodYears: [2014, 2015, 2016, 2017, 2018],
    });
    const evaluations = validateParticipant(p, cleanContext());
    // C-01 passes (schedule row exists); C-02 fails Error on $135.00.
    assert.equal(evaluationFor(evaluations, "C-01").outcome, "pass");
    const c02 = evaluationFor(evaluations, "C-02");
    assert.equal(c02.outcome, "fail");
    assert.equal(failFindings(c02)[0]?.severity, "Error");
    assert.equal(failFindings(c02)[0]?.blocksScope, "exact-calculation");
    assert.equal(failFindings(c02)[0]?.actual.includes("$135.00"), true);
    // C-04 not-applicable (no payment amounts in the case file).
    assert.equal(evaluationFor(evaluations, "C-04").outcome, "not-applicable");
    // Measurement basis established.
    assert.equal(evaluationFor(evaluations, "M-01").outcome, "pass");
    assert.equal(evaluationFor(evaluations, "M-05").outcome, "pass");
    assert.equal(evaluationFor(evaluations, "P-04").outcome, "not-applicable"); // 224/225 only
    assert.equal(evaluationFor(evaluations, "P-05").outcome, "pass");
  });
});

// ---------------------------------------------------------------------------
// Evaluation order, accumulation, quarantine, summary
// ---------------------------------------------------------------------------

describe("evaluation order and accumulation", () => {
  it("evaluates in layer order S → P → X → M → L → C, ID order within a layer", () => {
    const p = cleanParticipant({
      parseError: "bad row",
      dob: null,
      cspa: "0",
      measurementDate: null,
      scheduleProvided: false,
      scheduleRowExists: false,
    });
    const evaluations = validateParticipant(p, cleanContext());
    assert.deepEqual(
      evaluations.map((e) => e.ruleId),
      [...RULE_ORDER],
    );
    const failing = evaluations.filter((e) => e.outcome === "fail").map((e) => e.ruleId);
    const layers = failing.map((r) => r.slice(0, 1));
    const order = ["S", "P", "X", "M", "L", "C"];
    let last = -1;
    for (const layer of layers) {
      const idx = order.indexOf(layer);
      assert.equal(idx >= last, true, `layer ${layer} out of order in ${failing.join(", ")}`);
      last = idx;
    }
    assert.equal(failing.includes("S-02"), true);
    assert.equal(failing.includes("P-02"), true);
    assert.equal(failing.includes("X-05"), true);
    assert.equal(failing.includes("M-02"), true);
    assert.equal(failing.includes("C-01"), true);
  });

  it("accumulates findings without short-circuiting: one bad record yields many findings", () => {
    const p = cleanParticipant({
      parseError: "bad row",
      dob: null,
      dote: null,
      cs: null,
      cspa: "0",
      measurementDate: null,
      scheduleProvided: false,
      scheduleRowExists: false,
    });
    const evaluations = validateParticipant(p, cleanContext());
    const fails = evaluations.flatMap((e) => failFindings(e));
    const ruleIds = new Set(fails.map((f) => f.ruleId));
    // Structural, participant, cross-field, measurement, and cross-source
    // findings all present — no layer stopped the next.
    assert.equal(ruleIds.has("S-02"), true);
    assert.equal(ruleIds.has("P-02"), true);
    assert.equal(ruleIds.has("P-04"), true);
    assert.equal(ruleIds.has("P-06"), true);
    assert.equal(ruleIds.has("X-05"), true);
    assert.equal(ruleIds.has("M-01"), true);
    assert.equal(ruleIds.has("M-02"), true);
    assert.equal(ruleIds.has("M-05"), true);
    assert.equal(ruleIds.has("C-01"), true);
    assert.equal(fails.length >= 9, true);
  });

  it("S-04 quarantines a record: P/X/M/L/C rules are not-run, S rules still run", () => {
    const result = validateCasePackage(
      [cleanParticipant({ retstat: null })],
      cleanContext(),
    );
    const evals = result.participantResults[0]?.evaluations as RuleEvaluation[];
    assert.equal(evaluationFor(evals, "S-04").outcome, "fail");
    assert.equal(evaluationFor(evals, "S-06").outcome, "pass");
    for (const ruleId of ["P-02", "X-01", "M-01", "L-02", "C-01"] as RuleId[]) {
      const e = evaluationFor(evals, ruleId);
      assert.equal(e.outcome, "not-run", `expected ${ruleId} not-run`);
      assert.equal(e.findings[0]?.discrepancy.includes("S-04"), true);
    }
    // The record is still counted.
    assert.equal(result.summary.rulesEvaluated, 3 + 66 + 6);
  });

  it("S-05 participantKey collision quarantines both records", () => {
    const result = validateCasePackage(
      [
        cleanParticipant(),
        cleanParticipant({ bcvRecId: 2, ssn: "222334444" }),
      ],
      cleanContext(),
    );
    const s05 = result.populationEvaluations.find((x) => x.ruleId === "S-05");
    assert.equal(s05?.outcome, "fail");
    for (const r of result.participantResults) {
      assert.equal(evaluationFor(r.evaluations, "P-02").outcome, "not-run");
    }
  });

  it("S-01 quarantines the whole file: every rule for every record is not-run", () => {
    const result = validateCasePackage(
      [cleanParticipant()],
      cleanContext({ file: { ...cleanContext().file, openable: false } }),
    );
    assert.equal(evaluationFor(result.fileEvaluations, "S-01").outcome, "fail");
    const evals = result.participantResults[0]?.evaluations as RuleEvaluation[];
    assert.equal(evals.every((e) => e.outcome === "not-run"), true);
    assert.equal(evals[0]?.findings[0]?.discrepancy.includes("S-01"), true);
  });

  it("validateCasePackage summary counts pass/fail/not-applicable/not-run", () => {
    const result = validateCasePackage([cleanParticipant()], cleanContext());
    // 3 file + 66 participant + 6 population evaluations.
    assert.equal(result.summary.rulesEvaluated, 3 + 66 + 6);
    assert.equal(
      result.summary.pass +
        result.summary.fail +
        result.summary.notApplicable +
        result.summary.notRun,
      result.summary.rulesEvaluated,
    );
    assert.equal(result.summary.fail, 0);
    // Every recorded finding carries the run id and the recorded date.
    assert.equal(result.allFindings.every((f) => f.runId === "run-test-1"), true);
    assert.equal(result.allFindings.every((f) => f.recordedDate === "2026-11-12"), true);
    // A finding is never deleted and blocksScope is always present.
    assert.equal(
      result.allFindings.every((f) => f.blocksScope !== undefined && f.dispositionRoute !== ""),
      true,
    );
  });

  it("clean package passes the population-level rules S-05(b), S-06, P-01, P-16", () => {
    const result = validateCasePackage(
      [
        cleanParticipant(),
        cleanParticipant({ participantKey: "SYN-BASE-002", bcvRecId: 2, ssn: "222334444", dob: "1970-05-05" }),
      ],
      cleanContext(),
    );
    for (const ruleId of ["S-06", "S-05", "P-01", "P-16"] as RuleId[]) {
      const e = result.populationEvaluations.find((x) => x.ruleId === ruleId);
      assert.equal(e?.outcome, "pass", `expected population ${ruleId} to pass`);
    }
    // With no prior extract, L-01/L-02 record not-applicable (never a pass).
    assert.equal(result.populationEvaluations.find((x) => x.ruleId === "L-01")?.outcome, "not-applicable");
    assert.equal(result.populationEvaluations.find((x) => x.ruleId === "L-02")?.outcome, "not-applicable");
  });

  it("blanks are null, never zero: a blank PA_AMB is missing data, not $0", () => {
    const e = runRule(cleanParticipant({ paAmb: null }), cleanContext(), "P-13");
    assert.equal(e.outcome, "fail");
    assert.equal(failFindings(e)[0]?.discrepancy.includes("never zero"), true);
    // And a stated zero is a real zero, not a blank.
    const zero = runRule(cleanParticipant({ paAmb: 0 }), cleanContext(), "P-13");
    assert.equal(zero.outcome, "pass");
  });
});

