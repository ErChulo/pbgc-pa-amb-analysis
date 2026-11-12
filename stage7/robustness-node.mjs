// Stage 7 robustness — Node engine probes (NEW file, verification only).
//
// Verifies the deterministic engine (dist/src, compiled from src/ by
// `npm test` / `tsc`) against malformed inputs, missing data at every
// level, and boundary cases. Synthetic data only; every participant key
// starts with "SYN-". No source file is edited by this harness.
//
// Usage: node stage7/robustness-node.mjs
// Exit 0 = every case passed; exit 1 = at least one case failed.
// Each case prints: ID | PASS/FAIL | expected | actual.
// Governing spec: MASTER_PROMPT.md §20, §12; stage1/03 §2.3, §4.2;
// stage2/03-validation-catalog.md (66 rules).

import assert from "node:assert/strict";
import { DEMO_CASE_PACKAGE, DEMO_TOLERANCE } from "../dist/src/ui/demo.js";
import { makeMoney } from "../dist/src/decimal.js";
import { datedValue } from "../dist/src/formulas.js";
import { calculateAccruedBenefit } from "../dist/src/pipeline.js";
import { selectProvisionsByDate } from "../dist/src/compose.js";
import {
  computeDiscrepancy,
  discrepancyFromAmounts,
} from "../dist/src/reconcile.js";
import { buildReconciliationInputs } from "../dist/src/reconciliation.js";
import {
  validateCasePackage,
  validateParticipant,
} from "../dist/src/validation.js";
import {
  ageAt,
  completedYMD,
  daysBetween,
  validateDateString,
} from "../dist/src/dates.js";
import { refuseZeroFill } from "../dist/src/missingdata.js";
import {
  buildInputs,
  buildRequest,
  clone,
  doteOf,
  recordedBenefit,
  recordedMinor,
  ruleFindings,
  ruleOutcome,
  toValidationParticipant,
  validationContext,
} from "./fixtures.mjs";

// ---------------------------------------------------------------------------
// Case runner
// ---------------------------------------------------------------------------

const results = [];
function check(id, title, expected, fn) {
  try {
    const actual = fn();
    const pass = actual.pass;
    results.push({ id, title, pass, expected, actual: actual.actual });
    console.log(`${pass ? "PASS" : "FAIL"} ${id} ${title}`);
    console.log(`     expected: ${expected}`);
    console.log(`     actual:   ${actual.actual}`);
    if (actual.note) console.log(`     note:     ${actual.note}`);
  } catch (err) {
    results.push({ id, title, pass: false, expected, actual: `THREW: ${err.message}` });
    console.log(`FAIL ${id} ${title}`);
    console.log(`     expected: ${expected}`);
    console.log(`     actual:   THREW: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// A. Malformed inputs — validateParticipant / validateCasePackage
// ---------------------------------------------------------------------------

check(
  "A01",
  "badDates entry month 13 is flagged by S-07 (never silently accepted)",
  "S-07 fail, no throw",
  () => {
    const p = toValidationParticipant("SYN-001");
    p.badDates = [{ field: "dob", raw: "2020-13-01", ambiguous: false }];
    const evals = validateParticipant(p, validationContext());
    return {
      pass: ruleOutcome(evals, "S-07") === "fail",
      actual: `S-07=${ruleOutcome(evals, "S-07")}; finding=${JSON.stringify(ruleFindings(evals, "S-07").map((f) => f.discrepancy).slice(0, 1))}`,
    };
  },
);

check(
  "A02",
  "dob string 2020-02-30 (impossible day) is flagged, never coerced, never crashes validation",
  "S-07 fail or P-02 fail; validateParticipant returns (no throw)",
  () => {
    const p = toValidationParticipant("SYN-001");
    p.dob = "2020-02-30";
    const evals = validateParticipant(p, validationContext());
    const s07 = ruleOutcome(evals, "S-07");
    const p02 = ruleOutcome(evals, "P-02");
    return {
      pass: s07 === "fail" || p02 === "fail",
      actual: `S-07=${s07}, P-02=${p02}; any not-run=${evals.filter((e) => e.outcome === "not-run").map((e) => e.ruleId).join(",") || "none"}`,
    };
  },
);

check(
  "A03",
  "dob string 2021-02-29 (non-leap Feb 29) is flagged, never rolled to Mar 1",
  "S-07 fail or P-02 fail; no throw",
  () => {
    const p = toValidationParticipant("SYN-001");
    p.dob = "2021-02-29";
    const evals = validateParticipant(p, validationContext());
    return {
      pass: ruleOutcome(evals, "S-07") === "fail" || ruleOutcome(evals, "P-02") === "fail",
      actual: `S-07=${ruleOutcome(evals, "S-07")}, P-02=${ruleOutcome(evals, "P-02")}`,
    };
  },
);

check(
  "A04",
  "non-numeric service cs='abc' is flagged by S-08/P-06",
  "S-08 fail or P-06 fail; no throw",
  () => {
    const p = toValidationParticipant("SYN-001");
    p.cs = "abc";
    p.badNumbers = [{ field: "cs", raw: "abc", reason: "not numeric" }];
    const evals = validateParticipant(p, validationContext());
    return {
      pass: ruleOutcome(evals, "S-08") === "fail" || ruleOutcome(evals, "P-06") === "fail",
      actual: `S-08=${ruleOutcome(evals, "S-08")}, P-06=${ruleOutcome(evals, "P-06")}`,
    };
  },
);

check(
  "A05",
  "negative service cs='-5' is flagged by P-06",
  "P-06 fail; no throw",
  () => {
    const p = toValidationParticipant("SYN-001");
    p.cs = "-5";
    p.vs = "-5";
    p.es = "-5";
    p.cspa = "-5";
    p.vspa = "-5";
    p.espa = "-5";
    const evals = validateParticipant(p, validationContext());
    return {
      pass: ruleOutcome(evals, "P-06") === "fail",
      actual: `P-06=${ruleOutcome(evals, "P-06")}; finding=${JSON.stringify(ruleFindings(evals, "P-06").map((f) => f.discrepancy).slice(0, 1))}`,
    };
  },
);

check(
  "A06",
  "negative compensation salary amount is flagged by S-08",
  "S-08 fail; no throw",
  () => {
    const p = toValidationParticipant("SYN-001");
    p.salaryByYear = p.salaryByYear.map((s) =>
      s.amount === null ? s : { ...s, amount: -500000 },
    );
    p.badNumbers = [{ field: "salary", raw: "-5000.00", reason: "negative compensation" }];
    const evals = validateParticipant(p, validationContext());
    return {
      pass: ruleOutcome(evals, "S-08") === "fail",
      actual: `S-08=${ruleOutcome(evals, "S-08")}; finding=${JSON.stringify(ruleFindings(evals, "S-08").map((f) => f.discrepancy).slice(0, 1))}`,
    };
  },
);

check(
  "A07",
  "zero monthly compensation (paAcomp=0) with positive PA_AMB is flagged somewhere",
  "some rule fails or flags it (S-09/X-04/X-05); never silently passed everywhere",
  () => {
    const p = toValidationParticipant("SYN-001");
    p.paAcomp = 0;
    p.cuComp = 0;
    const evals = validateParticipant(p, validationContext());
    const fails = evals.filter((e) => e.outcome === "fail").map((e) => e.ruleId);
    return {
      pass: fails.length > 0,
      actual: `failing rules=${fails.join(",") || "NONE"}; S-09=${ruleOutcome(evals, "S-09")}, X-04=${ruleOutcome(evals, "X-04")}, X-05=${ruleOutcome(evals, "X-05")}`,
    };
  },
);

check(
  "A08",
  "duplicate participant keys quarantine both records, no double-count",
  "S-05/P-01 fail at population level; both records quarantined (non-structural rules not-run)",
  () => {
    const p1 = toValidationParticipant("SYN-001");
    const p2 = toValidationParticipant("SYN-001");
    const result = validateCasePackage([p1, p2], validationContext());
    const pop = result.populationEvaluations ?? [];
    const r1 = result.participantResults[0];
    const r2 = result.participantResults[1];
    const s05pop = pop.find((e) => e.ruleId === "S-05");
    const p01pop = pop.find((e) => e.ruleId === "P-01");
    const q1 = r1.evaluations.filter((e) => e.outcome === "not-run").length;
    const q2 = r2.evaluations.filter((e) => e.outcome === "not-run").length;
    return {
      pass:
        (s05pop?.outcome === "fail" || p01pop?.outcome === "fail") &&
        q1 > 0 &&
        q2 > 0,
      actual: `population S-05=${s05pop?.outcome ?? "absent"}, P-01=${p01pop?.outcome ?? "absent"}; not-run rules rec1=${q1}, rec2=${q2}; participantResults=${result.participantResults.length}`,
      note: "populationEvaluations field name verified against CaseValidationResult shape at runtime",
    };
  },
);

check(
  "A09",
  "truncated file quarantines the whole file (S-01), every rule not-run",
  "S-01 fail; every participant rule not-run; no participant is silently loaded",
  () => {
    const ctx = validationContext({
      file: {
        openable: true,
        truncated: true,
        hashMatches: true,
        hashBefore: "demo",
        hashAfter: "demo",
        macroRan: false,
        unknownFields: [],
      },
    });
    const result = validateCasePackage(
      ["SYN-001", "SYN-003"].map(toValidationParticipant),
      ctx,
    );
    const s01 = result.fileEvaluations.find((e) => e.ruleId === "S-01");
    const allNotRun = result.participantResults.every((r) =>
      r.evaluations.every((e) => e.outcome === "not-run"),
    );
    return {
      pass: s01?.outcome === "fail" && allNotRun,
      actual: `S-01=${s01?.outcome}; all participant rules not-run=${allNotRun}; results=${result.participantResults.length}`,
    };
  },
);

check(
  "A10",
  "unopenable file (corrupt/unreadable) quarantines via S-01",
  "S-01 fail; every participant rule not-run",
  () => {
    const ctx = validationContext({
      file: {
        openable: false,
        truncated: false,
        hashMatches: false,
        hashBefore: null,
        hashAfter: null,
        macroRan: false,
        unknownFields: [],
      },
    });
    const result = validateCasePackage(
      ["SYN-001"].map(toValidationParticipant),
      ctx,
    );
    const s01 = result.fileEvaluations.find((e) => e.ruleId === "S-01");
    const allNotRun = result.participantResults.every((r) =>
      r.evaluations.every((e) => e.outcome === "not-run"),
    );
    return {
      pass: s01?.outcome === "fail" && allNotRun,
      actual: `S-01=${s01?.outcome}; all not-run=${allNotRun}`,
    };
  },
);

check(
  "A11",
  "XLSM with a macro run / hash changed quarantines via S-11",
  "S-11 fail; every participant rule not-run",
  () => {
    const ctx = validationContext({
      file: {
        openable: true,
        truncated: false,
        hashMatches: false,
        hashBefore: "aaa",
        hashAfter: "bbb",
        macroRan: true,
        unknownFields: [],
      },
    });
    const result = validateCasePackage(
      ["SYN-001"].map(toValidationParticipant),
      ctx,
    );
    const s11 = result.fileEvaluations.find((e) => e.ruleId === "S-11");
    const allNotRun = result.participantResults.every((r) =>
      r.evaluations.every((e) => e.outcome === "not-run"),
    );
    return {
      pass: s11?.outcome === "fail" && allNotRun,
      actual: `S-11=${s11?.outcome}; all not-run=${allNotRun}`,
    };
  },
);

check(
  "A12",
  "DOTE before DOH (end before start) is flagged by P-03/P-04",
  "P-03 fail or P-04 fail; no throw",
  () => {
    const p = toValidationParticipant("SYN-001");
    p.dote = "1999-01-01"; // DOH is 2000-01-01
    p.measurementDate = "1999-01-01";
    p.establishedMeasurementDate = "1999-01-01";
    p.candidateMeasurementDates = ["1999-01-01"];
    const evals = validateParticipant(p, validationContext());
    return {
      pass: ruleOutcome(evals, "P-03") === "fail" || ruleOutcome(evals, "P-04") === "fail",
      actual: `P-03=${ruleOutcome(evals, "P-03")}, P-04=${ruleOutcome(evals, "P-04")}`,
    };
  },
);

check(
  "A13",
  "non-numeric case number is flagged by S-06",
  "S-06 fail; no throw",
  () => {
    const p = toValidationParticipant("SYN-001");
    p.caseNumber = "ABC123";
    const evals = validateParticipant(p, validationContext());
    return {
      pass: ruleOutcome(evals, "S-06") === "fail",
      actual: `S-06=${ruleOutcome(evals, "S-06")}; finding=${JSON.stringify(ruleFindings(evals, "S-06").map((f) => f.discrepancy).slice(0, 1))}`,
    };
  },
);

check(
  "A14",
  "wrong-typed paAmb (string '150000' instead of number) is flagged, never coerced silently",
  "S-08 fail (or S-02 fail); validateParticipant returns, no throw",
  () => {
    const p = toValidationParticipant("SYN-001");
    p.paAmb = "150000";
    const evals = validateParticipant(p, validationContext());
    return {
      pass: ruleOutcome(evals, "S-08") === "fail" || ruleOutcome(evals, "S-02") === "fail",
      actual: `S-08=${ruleOutcome(evals, "S-08")}, S-02=${ruleOutcome(evals, "S-02")}; not-run=${evals.filter((e) => e.outcome === "not-run").map((e) => e.ruleId).join(",") || "none"}`,
    };
  },
);

check(
  "A17",
  "dob string 2020-13-01 directly in the field (no badDates entry) is flagged by a date-validity rule",
  "S-07 fail or P-02 fail; never a silent pass",
  () => {
    const p = toValidationParticipant("SYN-001");
    p.dob = "2020-13-01";
    const evals = validateParticipant(p, validationContext());
    return {
      pass: ruleOutcome(evals, "S-07") === "fail" || ruleOutcome(evals, "P-02") === "fail",
      actual: `S-07=${ruleOutcome(evals, "S-07")}, P-02=${ruleOutcome(evals, "P-02")}; not-run=${evals.filter((e) => e.outcome === "not-run").map((e) => e.ruleId).join(",") || "none"}`,
    };
  },
);

check(
  "A15",
  "row parse error (e.g. unclosed quote) is flagged by S-02",
  "S-02 fail; no throw",
  () => {
    const p = toValidationParticipant("SYN-001");
    p.parseError = "unclosed quote at row 3";
    const evals = validateParticipant(p, validationContext());
    return {
      pass: ruleOutcome(evals, "S-02") === "fail",
      actual: `S-02=${ruleOutcome(evals, "S-02")}; finding=${JSON.stringify(ruleFindings(evals, "S-02").map((f) => f.discrepancy).slice(0, 1))}`,
    };
  },
);

check(
  "A16",
  "unknown field name is flagged by S-03",
  "S-03 fail; no throw",
  () => {
    const ctx = validationContext({
      file: {
        openable: true,
        truncated: false,
        hashMatches: true,
        hashBefore: "demo",
        hashAfter: "demo",
        macroRan: false,
        unknownFields: ["FROBNICATE"],
      },
    });
    const result = validateCasePackage(
      ["SYN-001"].map(toValidationParticipant),
      ctx,
    );
    const s03 = result.fileEvaluations.find((e) => e.ruleId === "S-03");
    return {
      pass: s03?.outcome === "fail",
      actual: `file S-03=${s03?.outcome ?? "absent"}`,
    };
  },
);

// ---------------------------------------------------------------------------
// B. Missing data at every level
// ---------------------------------------------------------------------------

check(
  "B01",
  "blank PA_AMB: P-13 fails (missing, never zero); reconciliation refuses a delta",
  "P-13 fail; computeDiscrepancy comparable=false reason recorded-missing",
  () => {
    const p = toValidationParticipant("SYN-001");
    p.paAmb = null;
    p.schedulePaAmb = null;
    p.xrdMbTerm = null;
    const evals = validateParticipant(p, validationContext());
    const outcome = calculateAccruedBenefit(buildRequest("SYN-001"), buildInputs("SYN-001"));
    const inputs = buildReconciliationInputs({
      outcome,
      recorded: null,
      toleranceApplied: DEMO_TOLERANCE,
      comparisonBasis: "basis-converted",
      basisConversion: "vesting",
    });
    const disc = computeDiscrepancy(inputs, 100);
    return {
      pass:
        ruleOutcome(evals, "P-13") === "fail" &&
        disc.comparable === false &&
        disc.reason === "recorded-missing",
      actual: `P-13=${ruleOutcome(evals, "P-13")}; discrepancy comparable=${disc.comparable}, reason=${disc.reason ?? "n/a"}; inputs.recorded=${inputs.recorded === null ? "null" : "NON-NULL"}`,
    };
  },
);

check(
  "B02",
  "blank DOTE: M-02/M-05 fail (measurement basis unresolved); pipeline is indeterminate, no delta",
  "M-02 fail and M-05 fail; outcome indeterminate / unresolved-comparison-basis (M-01 does not apply: its predicate is PA_AMB-populated-but-DOTE-blank, validation.ts:2409)",
  () => {
    const p = toValidationParticipant("SYN-I-01"); // demo's own blank-DOTE participant
    const evals = validateParticipant(p, validationContext());
    const outcome = calculateAccruedBenefit(buildRequest("SYN-I-01"), buildInputs("SYN-I-01"));
    return {
      pass:
        ruleOutcome(evals, "M-02") === "fail" &&
        ruleOutcome(evals, "M-05") === "fail" &&
        outcome.kind === "indeterminate" &&
        outcome.reason.code === "unresolved-comparison-basis",
      actual: `M-01=${ruleOutcome(evals, "M-01")} (n/a by predicate), M-02=${ruleOutcome(evals, "M-02")}, M-05=${ruleOutcome(evals, "M-05")}, P-04=${ruleOutcome(evals, "P-04")}, P-13=${ruleOutcome(evals, "P-13")}; outcome=${outcome.kind}/${outcome.kind === "indeterminate" ? outcome.reason.code : "n/a"}`,
    };
  },
);

check(
  "B03",
  "blank service: pipeline never invents an exact benefit from missing service",
  "outcome is bounds or indeterminate — never exact with a made-up service",
  () => {
    const req = buildRequest("SYN-001");
    req.participantHistory.serviceHistory = {
      ...req.participantHistory.serviceHistory,
      paCreditedService: { value: null, source: "synthetic-robustness" },
    };
    const inputs = buildInputs("SYN-001");
    inputs.formulaCall = {
      formulaId: "T-04",
      params: {
        accrualRate: datedValue("0.015", "1985-07-01", "pv-demo-1985"),
        avgComp: "60000",
        // service param deliberately omitted: no service anywhere
      },
    };
    const outcome = calculateAccruedBenefit(req, inputs);
    const exactMinor =
      outcome.kind === "exact" ? outcome.benefit.amount?.amountMinor : null;
    return {
      pass: outcome.kind !== "exact",
      actual: `outcome=${outcome.kind}${exactMinor !== null ? ` amountMinor=${exactMinor}` : ""}${outcome.kind === "indeterminate" ? ` reason=${outcome.reason.code}` : ""}`,
    };
  },
);

check(
  "B04",
  "blank compensation: pipeline never invents an exact benefit from missing pay",
  "outcome is bounds or indeterminate — never exact with a made-up average",
  () => {
    const req = buildRequest("SYN-001");
    req.participantHistory.compensationHistory = {
      ...req.participantHistory.compensationHistory,
      salaryByYear: req.participantHistory.compensationHistory.salaryByYear.map((s) => ({
        ...s,
        amount: null,
      })),
    };
    const inputs = buildInputs("SYN-001");
    inputs.formulaCall = {
      formulaId: "T-04",
      params: {
        accrualRate: datedValue("0.015", "1985-07-01", "pv-demo-1985"),
        service: "20",
        // avgComp deliberately omitted: no compensation anywhere
      },
    };
    const outcome = calculateAccruedBenefit(req, inputs);
    const exactMinor =
      outcome.kind === "exact" ? outcome.benefit.amount?.amountMinor : null;
    return {
      pass: outcome.kind !== "exact",
      actual: `outcome=${outcome.kind}${exactMinor !== null ? ` amountMinor=${exactMinor}` : ""}${outcome.kind === "indeterminate" ? ` reason=${outcome.reason.code}` : ""}`,
    };
  },
);

check(
  "B05",
  "blank/unknown vesting treatment is flagged (X-09) when participant is non-vested",
  "X-09 fail or not-applicable-with-reason; never a silent pass that applies vesting twice",
  () => {
    const p = toValidationParticipant("SYN-001");
    p.vestingTreatment = "unknown";
    p.calcVestingTreatment = null;
    p.vppa = "0"; // non-vested
    const evals = validateParticipant(p, validationContext());
    return {
      pass:
        ruleOutcome(evals, "X-09") === "fail" ||
        ruleOutcome(evals, "X-09") === "not-applicable",
      actual: `X-09=${ruleOutcome(evals, "X-09")}; finding=${JSON.stringify(ruleFindings(evals, "X-09").map((f) => f.discrepancy).slice(0, 1))}`,
    };
  },
);

check(
  "B06",
  "blank annuity form is flagged (X-10), never assumed to be the normal form",
  "X-10 fail; no throw",
  () => {
    const p = toValidationParticipant("SYN-001");
    p.annuityForm = null;
    p.formCode = null;
    p.calcAnnuityForm = null;
    const evals = validateParticipant(p, validationContext());
    return {
      pass: ruleOutcome(evals, "X-10") === "fail",
      actual: `X-10=${ruleOutcome(evals, "X-10")}; finding=${JSON.stringify(ruleFindings(evals, "X-10").map((f) => f.discrepancy).slice(0, 1))}`,
    };
  },
);

check(
  "B07",
  "blank measurement date: pipeline gate refuses (indeterminate), no delta",
  "outcome indeterminate / unresolved-comparison-basis",
  () => {
    const req = buildRequest("SYN-001", { measurementDate: null, measurementBasis: "unresolved" });
    const outcome = calculateAccruedBenefit(req, buildInputs("SYN-001"));
    return {
      pass:
        outcome.kind === "indeterminate" &&
        outcome.reason.code === "unresolved-comparison-basis",
      actual: `outcome=${outcome.kind}/${outcome.kind === "indeterminate" ? outcome.reason.code : "n/a"}`,
    };
  },
);

check(
  "B08",
  "participant with only an ID (everything else null): validation returns, pipeline indeterminate, no exact number",
  "no throw; outcome indeterminate; no exact amount anywhere",
  () => {
    const p = toValidationParticipant("SYN-001");
    for (const k of Object.keys(p)) {
      if (k === "participantKey") continue;
      if (k === "rbdDeterminable" || k === "isPreDoptRetiree" || k === "isDeferredRecord") continue;
      if (typeof p[k] === "boolean") p[k] = false;
      else if (Array.isArray(p[k])) p[k] = [];
      else p[k] = null;
    }
    p.vestingTreatment = "unknown";
    p.retstat = null;
    p.idType = null;
    const evals = validateParticipant(p, validationContext());
    const req = buildRequest("SYN-001", { measurementDate: null, measurementBasis: "unresolved" });
    req.participantHistory.employmentPeriods = [];
    const outcome = calculateAccruedBenefit(req, buildInputs("SYN-001"));
    const anyExact =
      outcome.kind === "exact" && outcome.benefit.amount?.amountMinor !== null;
    return {
      pass: outcome.kind === "indeterminate" && !anyExact,
      actual: `validation rules evaluated=${evals.length}, fails=${evals.filter((e) => e.outcome === "fail").length}; outcome=${outcome.kind}/${outcome.kind === "indeterminate" ? outcome.reason.code : "n/a"}`,
    };
  },
);

check(
  "B09",
  "entirely empty file: validateCasePackage([]) returns a summary, never crashes",
  "no throw; 0 participant results; summary counts all zero",
  () => {
    const result = validateCasePackage([], validationContext());
    return {
      pass:
        result.participantResults.length === 0 &&
        result.summary.rulesEvaluated >= 0,
      actual: `participantResults=${result.participantResults.length}; summary=${JSON.stringify(result.summary)}`,
    };
  },
);

check(
  "B10",
  "blank PA_AMB stays null through the reconciliation-input builder (never 0)",
  "buildReconciliationInputs recorded=null when recorded benefit is null",
  () => {
    const outcome = calculateAccruedBenefit(buildRequest("SYN-001"), buildInputs("SYN-001"));
    const inputs = buildReconciliationInputs({
      outcome,
      recorded: null,
      toleranceApplied: DEMO_TOLERANCE,
      comparisonBasis: "basis-converted",
      basisConversion: "vesting",
    });
    const refusal = refuseZeroFill({ field: "PA_AMB", value: null, wasBlank: true });
    const genuineZero = refuseZeroFill({ field: "PA_AMB", value: makeMoney(0), wasBlank: false });
    return {
      pass: inputs.recorded === null && refusal !== null && genuineZero === null,
      actual: `inputs.recorded=${inputs.recorded === null ? "null" : "NON-NULL"}; blank refusal=${refusal === null ? "NONE (BAD)" : "returned"}; genuine-zero refusal=${genuineZero === null ? "none (correct: a recorded zero is a value)" : "returned (BAD)"}`,
    };
  },
);

// ---------------------------------------------------------------------------
// C. Boundary cases
// ---------------------------------------------------------------------------

check(
  "C01",
  "zero denominator B̂=0: R undefined, flag R_UNDEFINED_ZERO_DENOMINATOR, Δ/D still reported",
  "relative.kind=undefined, flag R_UNDEFINED_ZERO_DENOMINATOR, delta=50000 minor",
  () => {
    const d = discrepancyFromAmounts(50000, 0, 100);
    return {
      pass:
        d.comparable === true &&
        d.relative.kind === "undefined" &&
        d.denominatorFlag === "R_UNDEFINED_ZERO_DENOMINATOR" &&
        d.delta.amountMinor === 50000,
      actual: `comparable=${d.comparable}, relative.kind=${d.relative.kind}, flag=${d.denominatorFlag}, delta=${d.delta.amountMinor}`,
    };
  },
);

check(
  "C02",
  "near-zero denominator B̂=$0.50 < ε_R=$1.00: R flagged, not computed",
  "relative.kind=undefined, flag R_UNSTABLE_SMALL_DENOMINATOR, Δ/D reported",
  () => {
    const d = discrepancyFromAmounts(150000, 50, 100);
    return {
      pass:
        d.relative.kind === "undefined" &&
        d.denominatorFlag === "R_UNSTABLE_SMALL_DENOMINATOR" &&
        d.delta.amountMinor === 149950,
      actual: `relative.kind=${d.relative.kind}, flag=${d.denominatorFlag}, delta=${d.delta.amountMinor}, absDelta=${d.absDelta.amountMinor}`,
    };
  },
);

check(
  "C03",
  "denominator exactly at ε_R (B̂=$1.00 = ε_R): R is computed (boundary inclusive)",
  "relative.kind=defined, flag null",
  () => {
    const d = discrepancyFromAmounts(150000, 100, 100);
    return {
      pass: d.relative.kind === "defined" && d.denominatorFlag === null,
      actual: `relative.kind=${d.relative.kind}, value=${d.relative.kind === "defined" ? d.relative.value : "n/a"}, flag=${d.denominatorFlag}`,
    };
  },
);

check(
  "C04",
  "denominator one minor unit below ε_R (B̂=$0.99): R flagged, not computed",
  "relative.kind=undefined, flag R_UNSTABLE_SMALL_DENOMINATOR",
  () => {
    const d = discrepancyFromAmounts(150000, 99, 100);
    return {
      pass:
        d.relative.kind === "undefined" &&
        d.denominatorFlag === "R_UNSTABLE_SMALL_DENOMINATOR",
      actual: `relative.kind=${d.relative.kind}, flag=${d.denominatorFlag}`,
    };
  },
);

check(
  "C05",
  "recorded zero with positive reconstruction: R=-1, flag PA_ZERO (a recorded zero is a value, investigated as one)",
  "relative=-1, flag PA_ZERO",
  () => {
    const d = discrepancyFromAmounts(0, 150000, 100);
    return {
      pass:
        d.relative.kind === "defined" &&
        d.relative.value === "-1" &&
        d.denominatorFlag === "PA_ZERO",
      actual: `relative=${d.relative.kind === "defined" ? d.relative.value : d.relative.kind}, flag=${d.denominatorFlag}, delta=${d.delta.amountMinor}`,
    };
  },
);

check(
  "C06",
  "both amounts zero: Δ=D=0, R undefined (facts question, not arithmetic)",
  "delta=0, relative.kind=undefined",
  () => {
    const d = discrepancyFromAmounts(0, 0, 100);
    return {
      pass: d.delta.amountMinor === 0 && d.relative.kind === "undefined",
      actual: `delta=${d.delta.amountMinor}, relative.kind=${d.relative.kind}, flag=${d.denominatorFlag}`,
    };
  },
);

check(
  "C07",
  "leap-day dates: Feb 29 rejected in non-leap years, accepted in leap years; ageAt refuses without a convention, never guesses",
  "validateDateString('2021-02-29') throws; ('2020-02-29') ok; ageAt(2000-02-29, 2023-02-28, null) throws; feb-28→23, mar-01→22; leap-year age 24",
  () => {
    const out = [];
    let threwNonLeap = false;
    try {
      validateDateString("2021-02-29");
    } catch {
      threwNonLeap = true;
    }
    let okLeap = false;
    try {
      validateDateString("2020-02-29");
      okLeap = true;
    } catch {
      okLeap = false;
    }
    let threwNoConvention = false;
    try {
      ageAt("2000-02-29", "2023-02-28", null);
    } catch {
      threwNoConvention = true;
    }
    const feb28 = ageAt("2000-02-29", "2023-02-28", "feb-28");
    const mar01 = ageAt("2000-02-29", "2023-02-28", "mar-01");
    const leapAge = ageAt("2000-02-29", "2024-02-29", null);
    const span = daysBetween("2020-02-28", "2020-03-01");
    const ymd = completedYMD("2020-02-28", "2020-03-01");
    out.push(`non-leap 2021-02-29 throws=${threwNonLeap}`);
    out.push(`leap 2020-02-29 ok=${okLeap}`);
    out.push(`ageAt null-convention throws=${threwNoConvention}`);
    out.push(`feb-28 age=${feb28} (expect 23)`);
    out.push(`mar-01 age=${mar01} (expect 22)`);
    out.push(`leap-year age=${leapAge} (expect 24)`);
    out.push(`daysBetween 2020-02-28→2020-03-01=${span} (expect 2)`);
    out.push(`completedYMD=${JSON.stringify(ymd)}`);
    return {
      pass:
        threwNonLeap && okLeap && threwNoConvention &&
        feb28 === 23 && mar01 === 22 && leapAge === 24 && span === 2,
      actual: out.join("; "),
    };
  },
);

check(
  "C08",
  "plan-version boundary: measurement exactly on an amendment effective date selects the NEW version; day before selects the OLD; before all versions selects none (never nearest)",
  "2000-01-01→v2, 1999-12-31→v1, 1980-01-01→null",
  () => {
    const v1 = clone(DEMO_CASE_PACKAGE.planVersions[0]);
    const v2 = clone(v1);
    v2.versionId = "pv-demo-2000";
    v2.effectiveDate = { value: "2000-01-01", source: "synthetic-robustness" };
    v2.adoptionDate = { value: "1999-12-01", source: "synthetic-robustness" };
    const timeline = { planId: "plan-harborview", versions: [v1, v2] };
    const at = selectProvisionsByDate(timeline, "2000-01-01");
    const before = selectProvisionsByDate(timeline, "1999-12-31");
    const gap = selectProvisionsByDate(timeline, "1980-01-01");
    return {
      pass:
        at.version?.versionId === "pv-demo-2000" &&
        before.version?.versionId === "pv-demo-1985" &&
        gap.version === null,
      actual: `on 2000-01-01=${at.version?.versionId ?? "null"}; on 1999-12-31=${before.version?.versionId ?? "null"}; on 1980-01-01=${gap.version?.versionId ?? "null"}`,
    };
  },
);

check(
  "C09",
  "freeze boundary: measurement exactly ON the freeze date is not re-run as frozen; measurement AFTER the freeze is frozen at the freeze date",
  "measurement==freeze → no freeze step, exact; measurement>freeze → freeze step present, benefit frozen",
  () => {
    const traceHas = (outcome, name) =>
      (outcome.trace ?? []).some((s) => s.name === name);
    const onFreeze = calculateAccruedBenefit(
      buildRequest("SYN-001", { measurementDate: "2020-02-29" }),
      buildInputs("SYN-001", {
        freeze: { freezeDate: "2020-02-29", scope: "full", ruleRef: "synthetic freeze" },
      }),
    );
    const afterFreeze = calculateAccruedBenefit(
      buildRequest("SYN-001", { measurementDate: "2020-03-15" }),
      buildInputs("SYN-001", {
        freeze: { freezeDate: "2020-02-29", scope: "full", ruleRef: "synthetic freeze" },
      }),
    );
    const onKind = onFreeze.kind;
    const afterKind = afterFreeze.kind;
    const afterFrozen =
      afterKind === "exact" &&
      traceHas(afterFreeze, "freeze") &&
      afterFreeze.benefit.amount?.amountMinor === 150000;
    return {
      pass: onKind === "exact" && !traceHas(onFreeze, "freeze") && afterFrozen,
      actual: `on-freeze: kind=${onKind}, freeze-step=${traceHas(onFreeze, "freeze")}; after-freeze: kind=${afterKind}, freeze-step=${traceHas(afterFreeze, "freeze")}, amount=${afterKind === "exact" ? afterFreeze.benefit.amount?.amountMinor : "n/a"}`,
    };
  },
);

check(
  "C10",
  "DOTE exactly equal to DOPT: conflict C-1 (BCV-224 vs 225) is flagged, never silently resolved",
  "P-04 not-applicable with conflict note, or fail; never a silent pass",
  () => {
    const p = toValidationParticipant("SYN-001");
    p.dote = "2024-06-30"; // == DOPT
    p.measurementDate = "2024-06-30";
    p.establishedMeasurementDate = "2024-06-30";
    p.candidateMeasurementDates = ["2024-06-30"];
    const evals = validateParticipant(p, validationContext());
    const f = ruleFindings(evals, "P-04");
    return {
      pass:
        ruleOutcome(evals, "P-04") === "not-applicable" ||
        ruleOutcome(evals, "P-04") === "fail",
      actual: `P-04=${ruleOutcome(evals, "P-04")}; finding=${JSON.stringify(f.map((x) => x.discrepancy).slice(0, 1))}`,
    };
  },
);

check(
  "C11",
  "NRD exactly equal to DOTE (terminates at normal retirement): no spurious failure",
  "P-08 does not fail for NRD==DOTE",
  () => {
    const p = toValidationParticipant("SYN-001");
    p.nrd = p.dote; // NRD == DOTE
    p.rbd = p.dote;
    const evals = validateParticipant(p, validationContext());
    return {
      pass: ruleOutcome(evals, "P-08") !== "fail",
      actual: `P-08=${ruleOutcome(evals, "P-08")}; P-04=${ruleOutcome(evals, "P-04")}`,
    };
  },
);

check(
  "C12",
  "single-day service (DOH == DOTE): service is 0, benefit computes to exact $0.00 from stated inputs (not an invented number)",
  "completedYMD 0y/0m/0d; pipeline exact $0.00 with service param 0",
  () => {
    const ymd = completedYMD("2020-02-29", "2020-02-29");
    const req = buildRequest("SYN-001");
    req.participantHistory.employmentPeriods = req.participantHistory.employmentPeriods.map((e) => ({
      ...e,
      doh: { value: "2020-02-29", source: "synthetic-robustness" },
    }));
    const inputs = buildInputs("SYN-001");
    inputs.serviceOverride = { creditedService: "0" };
    const outcome = calculateAccruedBenefit(req, inputs);
    return {
      pass:
        ymd.years === 0 && ymd.months === 0 && ymd.days === 0 &&
        outcome.kind === "exact" &&
        outcome.benefit.amount?.amountMinor === 0,
      actual: `completedYMD=${JSON.stringify(ymd)}; outcome=${outcome.kind}, amount=${outcome.kind === "exact" ? outcome.benefit.amount?.amountMinor : "n/a"}`,
    };
  },
);

check(
  "C13",
  "100-year service: service equal to elapsed time passes P-15; service exceeding elapsed time fails P-15",
  "cs=100 with 100 elapsed years → P-15 pass; cs=101 → P-15 fail",
  () => {
    const p100 = toValidationParticipant("SYN-001");
    p100.dob = "1924-01-01";
    p100.doh = "1924-01-01";
    p100.dote = "2024-01-01";
    p100.nrd = "1989-01-01";
    p100.rbd = "1989-01-01";
    p100.anb = 100;
    p100.cs = "100";
    p100.vs = "100";
    p100.es = "100";
    p100.cspa = "100";
    p100.vspa = "100";
    p100.espa = "100";
    p100.measurementDate = "2024-01-01";
    p100.establishedMeasurementDate = "2024-01-01";
    p100.candidateMeasurementDates = ["2024-01-01"];
    const e100 = validateParticipant(p100, validationContext());
    const p101 = clone(p100);
    p101.cs = "101";
    p101.cspa = "101";
    const e101 = validateParticipant(p101, validationContext());
    return {
      pass:
        ruleOutcome(e100, "P-15") !== "fail" &&
        ruleOutcome(e101, "P-15") === "fail",
      actual: `cs=100: P-15=${ruleOutcome(e100, "P-15")}; cs=101: P-15=${ruleOutcome(e101, "P-15")}`,
    };
  },
);

check(
  "C14",
  "§415 boundary: benefit exactly at the monthly limit is not capped; $1 over is capped to the limit",
  "service 100 → $7,500.00 exact at limit 750000 minor; service 101 → capped to 750000 minor",
  () => {
    const limit = {
      kind: "section-415",
      dollarLimitMonthly: "7500",
      compensationLimitMonthly: "7500",
      ruleRef: "synthetic §415",
    };
    const at = calculateAccruedBenefit(
      buildRequest("SYN-001"),
      buildInputs("SYN-001", {
        restrictions: [limit],
        serviceOverride: { creditedService: "100" },
      }),
    );
    const over = calculateAccruedBenefit(
      buildRequest("SYN-001"),
      buildInputs("SYN-001", {
        restrictions: [limit],
        serviceOverride: { creditedService: "101" },
      }),
    );
    const atAmt = at.kind === "exact" ? at.benefit.amount?.amountMinor : null;
    const overAmt = over.kind === "exact" ? over.benefit.amount?.amountMinor : null;
    return {
      pass: atAmt === 750000 && overAmt === 750000,
      actual: `at-limit: kind=${at.kind}, amount=${atAmt}; over-limit: kind=${over.kind}, amount=${overAmt}`,
    };
  },
);

check(
  "C15",
  "§401(a)(17) cap boundary (per-year cap, then average): cap exactly at the highest year changes nothing; $1 below it caps that year only",
  "cap 62400 → $1,500.00 (no year exceeds); cap 62399 → $1,499.99 (only 2019 capped, mean 59999.67)",
  () => {
    const at = calculateAccruedBenefit(
      buildRequest("SYN-001"),
      buildInputs("SYN-001", {
        compensationCap: { capAnnual: makeMoney(6240000), ruleRef: "synthetic §401(a)(17)" },
      }),
    );
    const over = calculateAccruedBenefit(
      buildRequest("SYN-001"),
      buildInputs("SYN-001", {
        compensationCap: { capAnnual: makeMoney(6239900), ruleRef: "synthetic §401(a)(17)" },
      }),
    );
    const atAmt = at.kind === "exact" ? at.benefit.amount?.amountMinor : null;
    const overAmt = over.kind === "exact" ? over.benefit.amount?.amountMinor : null;
    return {
      pass: atAmt === 150000 && overAmt === 149999,
      actual: `cap-62400: kind=${at.kind}, amount=${atAmt}; cap-62399: kind=${over.kind}, amount=${overAmt}`,
    };
  },
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass);
console.log("");
console.log(`ROBUSTNESS-NODE: ${passed}/${results.length} cases passed.`);
if (failed.length > 0) {
  console.log(`FAILING: ${failed.map((r) => r.id).join(", ")}`);
  process.exit(1);
}
console.log("ROBUSTNESS-NODE: all cases passed.");
