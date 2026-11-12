/**
 * Stage 7 fix tests — one file per defect family, asserting the fixed
 * behaviour proved by the five verification workers.
 *
 * - Robustness D1: impossible calendar dates (S-07 validates real dates;
 *   P-02 parses dates, never compares strings).
 * - Robustness D2: wrong-typed NUMBER values (S-08 type-checks; C-02
 *   surfaces the type error as a finding, never a swallowed throw).
 * - Benchmarks defect 1: P-16 is Map-indexed (linear); conflicting
 *   identities are still found.
 * - Compliance D1 / Repro D2: step completions land in the exported
 *   audit log; applyBatch folds applyEvent exactly.
 * - Robustness D4: re-import resets wizard completion flags.
 * - Robustness D3: CSV + JSON import (parse, quarantine, refuse);
 *   XLSX refused with the exact gap.
 * - Accuracy D-ACC-1: demo SYN-V-01 H15 is plausible, not supported,
 *   and Verified still rests on tolerance alone.
 * - Accuracy G-ACC-5 (§20): a materially incorrect record the
 *   statistical screen misses is still caught by reconciliation.
 * - Repro D3: a pinned calculation date makes event timestamps
 *   deterministic.
 *
 * Synthetic data only. Fictional participants only. No live case data.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateCasePackage,
  validateParticipant,
  withinTolerance,
} from "../src/validation.js";
import type {
  ValidationContext,
  ValidationParticipant,
} from "../src/validation.js";
import { modifiedZScores, tukeyFences } from "../src/statistics.js";
import { discrepancyFromAmounts } from "../src/reconcile.js";
import { DEMO_CASE_PACKAGE } from "../src/ui/demo.js";
import {
  calculationTimestamp,
  demoDecideEvidence,
  importFileText,
  importReportSummary,
  loadDemoCase,
  runValidateStep,
  setCalculationDate,
} from "../src/ui/main.js";
import {
  applyBatch,
  applyEvent,
  createCaseAnalysisState,
  createInitialUiState,
} from "../src/ui/state.js";
import type { UiState } from "../src/ui/state.js";
import {
  mapImportedRow,
  parseCsv,
  parseJsonImport,
  rowsToCasePackage,
} from "../src/ui/import.js";
import { mapDisposition } from "../src/dispositionMapping.js";

// ---------------------------------------------------------------------------
// Factories (same clean baseline as test/validation.test.ts)
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

function ruleOutcome(
  evaluations: ReturnType<typeof validateParticipant>,
  ruleId: string,
): string | null {
  return evaluations.find((r) => r.ruleId === ruleId)?.outcome ?? null;
}

function ruleFindingText(
  evaluations: ReturnType<typeof validateParticipant>,
  ruleId: string,
): string {
  const evaluation = evaluations.find((r) => r.ruleId === ruleId);
  return (evaluation?.findings ?? [])
    .map((f) => `${f.actual} ${f.expected} ${f.discrepancy}`)
    .join(" ");
}

function freshUiState(): UiState {
  return createInitialUiState(
    createCaseAnalysisState({
      caseId: "00098765",
      participantKeys: DEMO_CASE_PACKAGE.participants.map((p) => p.participantKey),
      snapshotHash: "snap-test",
      sourceDocuments: [],
      planVersions: [],
      toleranceSetId: "not-set",
    }),
  );
}

const ACTOR = "A. Actuary";
const AT = "2026-11-12T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Robustness D1 — impossible calendar dates
// ---------------------------------------------------------------------------

describe("Robustness D1 — impossible calendar dates (Stage 7)", () => {
  it("dob 2020-02-30 fails S-07 (no such day)", () => {
    const result = validateParticipant(cleanParticipant({ dob: "2020-02-30" }), cleanContext());
    assert.equal(ruleOutcome(result, "S-07"), "fail");
    assert.match(ruleFindingText(result, "S-07"), /2020-02-30/);
  });

  it("dob 2021-02-29 fails S-07 (2021 is not a leap year)", () => {
    const result = validateParticipant(cleanParticipant({ dob: "2021-02-29" }), cleanContext());
    assert.equal(ruleOutcome(result, "S-07"), "fail");
  });

  it("dob 2020-13-01 fails S-07 (no 13th month)", () => {
    const result = validateParticipant(cleanParticipant({ dob: "2020-13-01" }), cleanContext());
    assert.equal(ruleOutcome(result, "S-07"), "fail");
  });

  it("a valid leap day 2020-02-29 passes S-07", () => {
    const result = validateParticipant(cleanParticipant({ dob: "2020-02-29", doh: "2021-01-01", dote: "2021-06-01", nrd: "2085-02-28", rbd: "2085-03-01", xrd: "2085-02-28", measurementDate: "2021-06-01", recordedDate: "2021-07-01", calcMeasurementDate: "2021-06-01", candidateMeasurementDates: ["2021-06-01"], establishedMeasurementDate: "2021-06-01", anb: 1, sanb: 1 }), cleanContext());
    assert.equal(ruleOutcome(result, "S-07"), "pass");
  });

  it("an impossible dob produces no P-02 finding — S-07 owns it", () => {
    const result = validateParticipant(cleanParticipant({ dob: "2020-02-30" }), cleanContext());
    assert.equal(ruleOutcome(result, "P-02"), "pass");
    assert.equal(result.find((r) => r.ruleId === "P-02")?.findings.length, 0);
  });

  it("a real date before 1900 still fails P-02 (parsed, not string-compared)", () => {
    const result = validateParticipant(cleanParticipant({ dob: "1899-12-31" }), cleanContext());
    assert.equal(ruleOutcome(result, "P-02"), "fail");
  });
});

// ---------------------------------------------------------------------------
// Robustness D2 — wrong-typed NUMBER values
// ---------------------------------------------------------------------------

describe("Robustness D2 — wrong-typed NUMBER values (Stage 7)", () => {
  it("paAmb as a string fails S-08", () => {
    const result = validateParticipant(
      cleanParticipant({ paAmb: "150000" as unknown as number }),
      cleanContext(),
    );
    assert.equal(ruleOutcome(result, "S-08"), "fail");
    assert.match(ruleFindingText(result, "S-08"), /string/);
  });

  it("paAmb as a string fails C-02 as a finding — the record still runs", () => {
    const result = validateParticipant(
      cleanParticipant({ paAmb: "150000" as unknown as number }),
      cleanContext(),
    );
    assert.equal(ruleOutcome(result, "C-02"), "fail");
    assert.notEqual(ruleOutcome(result, "C-02"), "not-run");
    assert.match(ruleFindingText(result, "C-02"), /string/);
  });

  it("a non-integer paAmb fails S-08", () => {
    const result = validateParticipant(cleanParticipant({ paAmb: 124000.5 }), cleanContext());
    assert.equal(ruleOutcome(result, "S-08"), "fail");
  });

  it("a malformed decimal-string service field fails S-08", () => {
    const result = validateParticipant(cleanParticipant({ cs: "12.x" }), cleanContext());
    assert.equal(ruleOutcome(result, "S-08"), "fail");
  });
});

// ---------------------------------------------------------------------------
// Benchmarks defect 1 — P-16 is linear and still finds conflicts
// ---------------------------------------------------------------------------

describe("Benchmarks defect 1 — P-16 Map-indexed (Stage 7)", () => {
  it("same SSN, different DOB is still a P-16 conflict", () => {
    const a = cleanParticipant({ participantKey: "SYN-P16-A", ssn: "111223333", dob: "1962-03-14" });
    const b = cleanParticipant({ participantKey: "SYN-P16-B", ssn: "111223333", dob: "1963-03-14", bcvRecId: 2, firstName: "Beth" });
    const result = validateCasePackage([a, b], cleanContext());
    const p16 = result.allFindings.filter((f) => f.ruleId === "P-16" && f.outcome === "fail");
    assert.ok(p16.length >= 1, "expected a P-16 finding");
    assert.match(p16[0]?.actual ?? "", /111223333/);
  });

  it("same name and DOB, different SSN is still a P-16 conflict", () => {
    const a = cleanParticipant({ participantKey: "SYN-P16-C", ssn: "111223333" });
    const b = cleanParticipant({ participantKey: "SYN-P16-D", ssn: "999887777", bcvRecId: 2 });
    const result = validateCasePackage([a, b], cleanContext());
    const p16 = result.allFindings.filter((f) => f.ruleId === "P-16" && f.outcome === "fail");
    assert.ok(p16.length >= 1, "expected a P-16 finding");
  });

  it("3,000 distinct participants complete with no P-16 finding (no quadratic blow-up in the test run)", () => {
    const many: ValidationParticipant[] = [];
    for (let i = 0; i < 3000; i += 1) {
      many.push(
        cleanParticipant({
          participantKey: `SYN-P16-${String(i).padStart(4, "0")}`,
          bcvRecId: i + 1,
          ssn: String(100000000 + i),
          firstName: `Alex${i}`,
          dob: `19${String(50 + (i % 40)).padStart(2, "0")}-01-15`,
        }),
      );
    }
    const started = Date.now();
    const result = validateCasePackage(many, cleanContext());
    assert.ok(Date.now() - started < 30000, "3,000 participants must validate in well under 30 s");
    assert.equal(result.allFindings.filter((f) => f.ruleId === "P-16" && f.outcome === "fail").length, 0);
  });
});

// ---------------------------------------------------------------------------
// Compliance D1 / Repro D2 — audit log completeness; applyBatch
// ---------------------------------------------------------------------------

describe("Compliance D1 / Repro D2 — audit log completeness (Stage 7)", () => {
  it("a validation step completion lands in the exported audit log", () => {
    let state = freshUiState();
    state = loadDemoCase(state, ACTOR, AT);
    const { state: next } = runValidateStep(state, ACTOR, AT);
    const runs = next.analysis.auditLog.filter((e) => e.kind === "calculation-run");
    assert.ok(runs.length >= 1, "expected at least one calculation-run audit event");
    const runSummaries = runs.map((e) => e.summary).join("\n");
    assert.match(runSummaries, /Validation completed/);
    assert.match(runSummaries, /405 rules evaluated/);
    assert.equal(next.analysis.auditLog.filter((e) => e.kind === "calculation-run").length, runs.length);
  });

  it("the import itself is an audit event, and re-import resets wizard completion (Robustness D4)", () => {
    let state = freshUiState();
    state = loadDemoCase(state, ACTOR, AT);
    const { state: validated } = runValidateStep(state, ACTOR, AT);
    assert.equal(validated.wizard.completed.validate, true);
    const reimported = loadDemoCase(validated, ACTOR, AT);
    assert.equal(reimported.wizard.completed.validate, false);
    assert.equal(reimported.wizard.completed.calculate, false);
    assert.equal(reimported.wizard.currentStep, "import");
    assert.ok(reimported.analysis.auditLog.some((e) => e.kind === "import"));
    assert.equal(reimported.validation, null);
  });

  it("applyBatch folds applyEvent exactly (same records, audit, wizard)", () => {
    let state = freshUiState();
    state = loadDemoCase(state, ACTOR, AT);
    const { state: validated } = runValidateStep(state, ACTOR, AT);
    const validation = validated.validation;
    assert.notEqual(validation, null);
    const events = [
      { kind: "validation-completed", result: validation!, actor: ACTOR, occurredAt: AT },
      { kind: "set-theme", theme: "light", actor: ACTOR, occurredAt: AT },
    ] as const;
    const batched = applyBatch(validated, events);
    let folded = validated;
    for (const e of events) folded = applyEvent(folded, e);
    assert.deepEqual(batched, folded);
  });
});

// ---------------------------------------------------------------------------
// Robustness D3 — CSV + JSON import
// ---------------------------------------------------------------------------

describe("Robustness D3 — CSV + JSON import (Stage 7)", () => {
  const csv = [
    "participantKey,caseNumber,ssn,firstName,lastName,dob,sex,doh,dote,dop,nrd,retstat,cs,vs,es,paAmbMinor,dopt",
    "SYN-IMP-001,00098765,111223333,Ana,Example,1962-03-14,F,1990-05-01,2019-06-15,1990-05-01,2027-03-14,2,12.5,12.5,12.5,124000,2024-06-30",
  ].join("\n");

  it("a well-formed CSV imports one participant with the recorded amount", () => {
    const { state, report, error } = importFileText(freshUiState(), "case.csv", csv, ACTOR, AT);
    assert.equal(error, null);
    assert.notEqual(report, null);
    assert.equal(report?.participantsImported, 1);
    assert.equal(state.casePackage?.participants.length, 1);
    assert.equal(state.casePackage?.benefitObservations[0]?.paAmb.value?.amountMinor, 124000);
    assert.equal(state.casePackage?.case.dopt.value, "2024-06-30");
    assert.match(importReportSummary(report!), /1 participant\(s\) imported/);
  });

  it("an imported case validates through the generic runner (no demo inputs needed)", () => {
    const { state, error } = importFileText(freshUiState(), "case.csv", csv, ACTOR, AT);
    assert.equal(error, null);
    const { state: next, summary } = runValidateStep(state, ACTOR, AT);
    assert.equal(summary.participantResults, 1);
    assert.ok(summary.rulesEvaluated > 0);
  });

  it("an unclosed quote refuses the CSV and changes nothing", () => {
    const bad = 'participantKey,caseNumber\n"SYN-IMP-001,00098765\n';
    const before = freshUiState();
    const { state, report, error } = importFileText(before, "bad.csv", bad, ACTOR, AT);
    assert.notEqual(error, null);
    assert.match(error ?? "", /unclosed quote/);
    assert.equal(report, null);
    assert.equal(state.casePackage, null);
  });

  it("a ragged row refuses the CSV", () => {
    const bad = "participantKey,caseNumber\na,b,c\n";
    const { error } = importFileText(freshUiState(), "bad.csv", bad, ACTOR, AT);
    assert.notEqual(error, null);
    assert.match(error ?? "", /row 2 has 3 columns, expected 2/);
  });

  it("a CSV without a dopt value is refused — no date is guessed", () => {
    const noDopt = "participantKey,caseNumber,paAmbMinor\nSYN-IMP-001,00098765,124000\n";
    const { error } = importFileText(freshUiState(), "nodopt.csv", noDopt, ACTOR, AT);
    assert.notEqual(error, null);
    assert.match(error ?? "", /dopt/);
  });

  it("a bad date cell is quarantined (null + badDates), never guessed", () => {
    const row = mapImportedRow({ participantKey: "SYN-IMP-002", dob: "2020-02-30", dopt: "2024-06-30" });
    assert.equal(row.dob, null);
    assert.ok(row.badDates.some((b) => b.field === "dob" && b.raw === "2020-02-30"));
  });

  it("a bad number cell is quarantined (null + badNumbers), never guessed", () => {
    const row = mapImportedRow({ participantKey: "SYN-IMP-003", paAmbMinor: "12x", dopt: "2024-06-30" });
    assert.equal(row.paAmbMinor, null);
    assert.ok(row.badNumbers.some((b) => b.field === "paAmbMinor"));
  });

  it("a row without a participantKey is quarantined, never keyed by row number", () => {
    const { report } = rowsToCasePackage(
      [mapImportedRow({ dob: "1962-03-14", dopt: "2024-06-30" })],
      { caseNumber: "00098765", planName: "Imported", planNumber: "x", dopt: "2024-06-30", importId: "imp-1", importedDate: "2026-11-12", importedBy: ACTOR, sourceFileName: "case.csv", sourceFileHash: "not-computed" },
      [],
    );
    assert.equal(report.participantsImported, 0);
    assert.equal(report.quarantinedRows.length, 1);
    assert.match(report.quarantinedRows[0]?.reason ?? "", /participantKey/);
  });

  it("a duplicate participantKey keeps the first row and quarantines the second", () => {
    const { headers, rows } = parseCsv(
      "participantKey,dopt,paAmbMinor\nSYN-DUP,2024-06-30,100000\nSYN-DUP,2024-06-30,200000\n",
    );
    void headers;
    const { package: pkg, report } = rowsToCasePackage(rows.map(mapImportedRow), {
      caseNumber: "00098765", planName: "Imported", planNumber: "x", dopt: "2024-06-30",
      importId: "imp-2", importedDate: "2026-11-12", importedBy: ACTOR, sourceFileName: "case.csv", sourceFileHash: "not-computed",
    }, []);
    assert.equal(report.participantsImported, 1);
    assert.equal(pkg.benefitObservations[0]?.paAmb.value?.amountMinor, 100000);
    assert.equal(report.quarantinedRows.length, 1);
  });

  it("a JSON row array imports; invalid JSON is refused", () => {
    const json = JSON.stringify([
      { participantKey: "SYN-J-001", caseNumber: "00098765", dob: "1962-03-14", dopt: "2024-06-30", paAmbMinor: 124000 },
    ]);
    const { state, error } = importFileText(freshUiState(), "case.json", json, ACTOR, AT);
    assert.equal(error, null);
    assert.equal(state.casePackage?.participants.length, 1);
    const bad = importFileText(freshUiState(), "bad.json", "{not json", ACTOR, AT);
    assert.notEqual(bad.error, null);
    assert.match(bad.error ?? "", /JSON/);
    assert.equal(bad.state.casePackage, null);
  });

  it("a JSON CasePackage imports as-is", () => {
    const { state, error } = importFileText(freshUiState(), "pkg.json", JSON.stringify(DEMO_CASE_PACKAGE), ACTOR, AT);
    assert.equal(error, null);
    assert.equal(state.casePackage?.participants.length, 6);
  });

  it("XLSX is refused with the exact gap (no DEFLATE reader), not silently dropped", () => {
    const { state, error } = importFileText(freshUiState(), "case.xlsx", "PK\u0003\u0004", ACTOR, AT);
    assert.notEqual(error, null);
    assert.match(error ?? "", /DEFLATE/);
    assert.match(error ?? "", /Stage 8/);
    assert.equal(state.casePackage, null);
  });

  it("an unknown extension is refused", () => {
    const { error } = importFileText(freshUiState(), "case.txt", "hello", ACTOR, AT);
    assert.notEqual(error, null);
    assert.match(error ?? "", /\.csv or \.json/);
  });
});

// ---------------------------------------------------------------------------
// Accuracy D-ACC-1 — H15 demoted to plausible; Verified rests on tolerance
// ---------------------------------------------------------------------------

describe("Accuracy D-ACC-1 — H15 plausible, not supported (Stage 7)", () => {
  it("demo SYN-V-01 H15 is plausible and immaterial", () => {
    const evidence = demoDecideEvidence(DEMO_CASE_PACKAGE, "SYN-V-01");
    const h15 = evidence.hypotheses.find((h) => h.code === "H15");
    assert.notEqual(h15, undefined);
    assert.equal(h15?.supportClass, "plausible");
    assert.equal(h15?.material, false);
  });

  it("SYN-V-01 still maps to verified — on tolerance alone, not on H15", () => {
    const evidence = demoDecideEvidence(DEMO_CASE_PACKAGE, "SYN-V-01");
    const outcome = mapDisposition(evidence);
    assert.equal(outcome.disposition, "verified");
  });
});

// ---------------------------------------------------------------------------
// Accuracy G-ACC-5 — statistics miss it, reconciliation catches it
// ---------------------------------------------------------------------------

describe("Accuracy G-ACC-5 — ordinary-looking but materially wrong (§20)", () => {
  it("a +$220.00 error inside a high-variance cohort is missed by the robust-z and Tukey screens but caught by reconciliation", () => {
    // Deltas in minor cents across a high-variance cohort: the +$220.00
    // record (22,000) sits inside the spread, so no screen flags it.
    const deltas = [0, 50000, -40000, 30000, -60000, 22000, 80000, -20000, 10000, -10000, 45000, -55000];
    const z = modifiedZScores(deltas);
    assert.equal(z.flagged[5], false, "robust-z must miss the +$220 record");
    const tukey = tukeyFences(deltas);
    assert.equal(tukey.flaggedInner[5], false, "Tukey must miss the +$220 record");
    // Reconciliation still catches it: $220.00 is far outside the
    // $1.00 / 0.1% case tolerance (DEMO_TOLERANCE: $1.00 either).
    const discrepancy = discrepancyFromAmounts(215000, 193000, 100);
    assert.equal(discrepancy.comparable, true);
    if (!discrepancy.comparable) return;
    assert.equal(discrepancy.absDelta.amountMinor, 22000);
    assert.equal(withinTolerance(22000, 193000, {
      version: 1,
      absoluteMinor: 100,
      relativeDecimal: "0.001",
      application: "either",
      authority: "case actuary",
      approvedBy: "case actuary",
      approvedDate: "2026-11-12",
    }), false);
  });
});

// ---------------------------------------------------------------------------
// Repro D3 — pinned calculation date
// ---------------------------------------------------------------------------

describe("Repro D3 — pinned calculation date (Stage 7)", () => {
  it("with a pinned date, event timestamps are the pinned date, not the wall clock", () => {
    let state = freshUiState();
    state = setCalculationDate(state, "2026-11-12", ACTOR, AT);
    assert.equal(calculationTimestamp(state), "2026-11-12T00:00:00.000Z");
    // Handlers pass calculationTimestamp(state) as the event time, so an
    // event created while the pin is set carries the pinned date even
    // when the call happens later.
    state = loadDemoCase(state, ACTOR, calculationTimestamp(state));
    const importEvent = state.analysis.auditLog.find((e) => e.kind === "import");
    assert.equal(importEvent?.occurredAt, "2026-11-12T00:00:00.000Z");
  });

  it("clearing the pin returns to the wall clock", () => {
    let state = freshUiState();
    state = setCalculationDate(state, "2026-11-12", ACTOR, AT);
    state = setCalculationDate(state, null, ACTOR, AT);
    assert.equal(state.calculationDate, null);
    assert.notEqual(calculationTimestamp(state), "2026-11-12T00:00:00.000Z");
  });
});
