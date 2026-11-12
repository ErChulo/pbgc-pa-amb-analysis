// Stage 7 — Accuracy verification through the shipped HTML file (Verifier).
//
// Re-runs EVERY worked example end-to-end through pa-amb-analysis.html
// via file:// Playwright (no server, no edits to source):
//   A. Demo case (Harborview, case 00098765, 6 SYN participants):
//      SYN-001 exact $1,500.00 + full 10-stage trace (18 steps);
//      SYN-002 bounds $1,584–$1,683, recorded $1,620 inside;
//      SYN-003 exact $1,500 vs $2,500 recorded, Δ +$1,000;
//      SYN-004 bounds $900–$960, recorded $930 inside;
//      SYN-V-01 exact $849.50 vs $850 recorded, Δ +$0.50, approval,
//      PA_AMB_ACCEPT "Y";
//      SYN-I-01 (demo variant) indeterminate, DOTE blank, no Δ.
//   B. Harborview 3-version timeline (Stage 2 output 01 §8, Ana Ruiz):
//      $1,067.50 vs $1,232.50, Δ +$165.00; era components $710.00 +
//      $357.50; counterfactual 3 extra years at $55 reproduces
//      $1,232.50; loose reading refuted ($1,498.75); the match stays a
//      hypothesis, never a disposition.
//   C. SYN-I-01 decisions variant (Stage 2 output 05 §8): recorded
//      $1,120.00, per-scenario bounds $1,500–$1,560 and $1,250–$1,300,
//      $1,120 outside both, no Δ, 3 prioritised data requests,
//      approval refused (G-IND-2); exhausted-search approval succeeds
//      (paAmbAccept "N").
//   D. 1,000-participant ground-truth population through the in-page
//      engine (App.runCalculation / buildReconciliationInputs /
//      runReconciliation), compared participant-by-participant against
//      stage7/population-node.json (Node ground truth). The population
//      is driven through the app's own public engine API; the file
//      picker (added by the Stage 7 Robustness D3 fix) is checked in
//      P0 instead, and the population reconcile runs the same four
//      counterfactuals the Node oracle runs (Stage 7 G-ACC-4 fix).
//   E. Trace/rounding detail for SYN-V-01: the demo plan's prescribed
//      rounding (nearest cent, §5.01) cannot explain $849.50 → $850.00.
//      The nearest-dollar rule that would explain it lives in a
//      different fixture (decisions.test.ts, Synthetic Plan A §7.3) —
//      so H15 is Plausible, not Supported (Stage 7 D-ACC-1 fix), and
//      Verified rests on tolerance alone.
//
// Usage: node stage7/04-accuracy-browser.mjs
// Exit 0 when every check passes; exit 1 on any FAIL. Writes
// stage7/04-accuracy-browser-results.json. Synthetic data only.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openApp, assertBooted, check, stepButton, wizardState } from "../test/ui-playwright/helpers.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = "/home/hatch/workspace/pbgc-pa-amb-analysis";
const TS = "2026-11-12T00:00:00.000Z";
const ACTOR = "A. Actuary";

const NODE_POP = JSON.parse(readFileSync(join(DIR, "population-node.json"), "utf8"));

const results = [];
function record(id, pass, detail) {
  results.push({ id, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}: ${detail}`);
}
function expect(id, cond, detail) {
  record(id, !!cond, detail);
  return !!cond;
}

// ---------------------------------------------------------------------------
// In-page driver. Self-contained (Playwright serializes it). Mirrors the
// Stage 6 wizard driver (test/ui-playwright/wizard-flow.test.mjs) for the
// demo case, plus Harborview fixtures (test/harborview.test.ts), the
// decisions fixtures (test/decisions.test.ts), and the population chain
// (test/population.test.ts). Nothing is invented; no live data.
// ---------------------------------------------------------------------------
function drive(action) {
  const App = window.PaAmbApp;
  const handle = window.__paAmbHandle;
  const pkg = () => handle.getState().casePackage;
  const must = (v, what) => {
    if (v === undefined || v === null) throw new Error(what + " is missing");
    return v;
  };
  const keys = () => pkg().participants.map((p) => p.participantKey);
  const recordedMinor = (key) => {
    const obs = must(pkg().benefitObservations.find((o) => o.participantKey === key), "observation for " + key);
    return obs.paAmb.value === null ? null : obs.paAmb.value.amountMinor;
  };
  const doteOf = (key) => {
    const obs = must(pkg().benefitObservations.find((o) => o.participantKey === key), "observation for " + key);
    return obs.measurementDate;
  };
  const ageAt = (dob, date) => {
    const years = Number(date.slice(0, 4)) - Number(dob.slice(0, 4));
    return date.slice(5) < dob.slice(5) ? years - 1 : years;
  };
  const nrdOf = (dob) => `${Number(dob.slice(0, 4)) + 65}${dob.slice(4)}`;
  const dispatch = (event) => handle.dispatch(event);
  const state = () => handle.getState();
  const TS = "2026-11-12T00:00:00.000Z";

  function toValidationParticipant(key) {
    const p = must(pkg().participants.find((x) => x.participantKey === key), "participant " + key);
    const ep = must(pkg().employmentPeriods.find((x) => x.participantKey === key), "employment period for " + key);
    const ch = must(pkg().compensationHistories.find((x) => x.participantKey === key), "compensation history for " + key);
    const sh = must(pkg().serviceHistories.find((x) => x.participantKey === key), "service history for " + key);
    const dob = must(p.dob.value, "dob for " + key);
    const dote = ep.dote.value;
    const service = sh.paCreditedService.value;
    const serviceStr = service === null ? null : String(service);
    const knownSalaries = ch.salaryByYear.filter((s) => s.amount !== null);
    const meanAnnualMinor = knownSalaries.length === 0 ? null : Math.round(knownSalaries.reduce((s, x) => s + (x.amount?.amountMinor ?? 0), 0) / knownSalaries.length);
    const lastSalary = knownSalaries[knownSalaries.length - 1];
    const formulaCheck = { "SYN-001": 150000, "SYN-003": 150000, "SYN-V-01": 84950 };
    const checkValue = formulaCheck[key] ?? null;
    return {
      participantKey: key, bcvRecId: p.bcvRecId.value, caseNumber: "00098765",
      idType: "1", ssn: null, firstName: p.firstName.value, lastName: p.lastName.value,
      dob, sex: p.sex.value, dateOfDeath: null, retstat: "2", rettyp: null,
      doh: ep.doh.value, dote, dop: ep.dop.value, dobfParticipant: null, dor: null,
      postDoptDote: null, nrd: nrdOf(dob), anb: dote === null ? null : ageAt(dob, dote),
      sanb: null, rbd: nrdOf(dob), rbdDeterminable: true, rbdMissingFields: [],
      inPayAtDopt: null, isPreDoptRetiree: false, isDeferredRecord: true, sbcd: null,
      spouseSsn: null, spouseLastName: null, spouseDob: null, spouseSex: null,
      spouseDateOfDeath: null, benSsn: null, benLastName: null, benDob: null,
      benSex: null, benDateOfDeath: null, apDob: null, apSex: null, apDateOfDeath: null,
      cspa: serviceStr, vspa: serviceStr, espa: serviceStr, cs: serviceStr,
      vs: serviceStr, es: serviceStr, csUnit: "years", vsUnit: "years", vppa: "1",
      paAmb: recordedMinor(key),
      paAcomp: meanAnnualMinor === null ? null : Math.round(meanAnnualMinor / 12),
      paAcompPeriodicity: "monthly",
      cuComp: lastSalary?.amount === null || lastSalary?.amount === undefined ? null : Math.round((lastSalary.amount.amountMinor ?? 0) / 12),
      pia: null, integrationMethod: "none", firstYear: ch.firstYear.value,
      lastYear: ch.lastYear.value,
      salaryByYear: ch.salaryByYear.map((s) => ({ year: s.salaryYear, amount: s.amount?.amountMinor ?? null })),
      annact: "A", annualizationBasisNoted: true,
      averagingPeriodYears: knownSalaries.map((s) => s.salaryYear),
      formCode: dote === null ? null : "NSF", formCodeNsf: "NSF", formCodeNmf: "NMF",
      formCodeQpsa: null, formCodeArd: null, spcVal: "0", spcNsf: "0", spcArd: "0",
      mths: 0, mthsNsf: 0, mthsArd: 0, formCodeIsJointLife: false,
      recordIsSingleLife: true, lsTerm: "N", xrd: nrdOf(dob), xrdMbTerm: recordedMinor(key),
      pvReteec: null, measurementDate: dote, recordedDate: dote === null ? null : "2020-03-15",
      measurementDisagreementExplained: false, assertedBasisNrd: false,
      nrdBasisEvidence: false, explicitNoBenefitStatement: false,
      vestingTreatment: "gross", annuityForm: dote === null ? null : "NSF",
      annuityFormConversionDocumented: false, calcMeasurementDate: dote,
      calcAnnuityForm: dote === null ? null : "NSF", calcVestingTreatment: "gross",
      planFreezeDate: null, accrualAfterFreeze: false,
      benefitReflectsPostFreezeAccrual: false, mandcwi: null, volcwi: null,
      cashBalDopt: null, formulaType: "unit-credit",
      contributionTreatmentDocumented: true, cashBalanceExplanationDocumented: true,
      documentedMinimumOrGrandfatherOrPastServiceCredit: false,
      participationBeforeEligibility: false, serviceAccruesBeforeDop: false,
      parseError: null, badDates: [], badNumbers: [], fieldsWithoutProvenance: [],
      supportingEvidenceForScale: true, s001Derivable: true, scheduleProvided: true,
      scheduleRowExists: true, schedulePaAmb: recordedMinor(key),
      scheduleExplanationDocumented: false, bcvComparison: null,
      paymentAmountMinor: null, convertedPaAmbMinor: null, ardFactorsPresent: false,
      priorDistribution: null, formulaCheckValueMinor: checkValue,
      formulaKnownForX06: true,
      formulaCheckValuesMinor: checkValue === null ? null : [checkValue],
      documentedHypothesis: false, pfFactors: null, proposedDisposition: null,
      evidenceCount: 0, paAmbAccept: null, disposition: null, decisionExists: false,
      rejectionRationaleStated: false, sourcesUsed: [],
      candidateMeasurementDates: dote === null ? [] : [dote],
      establishedMeasurementDate: dote, prior: null,
    };
  }
  function validationContext() {
    return {
      dopt: "2024-06-30", today: "2026-11-12", runId: "run-demo-1",
      recordedDate: "2026-11-12", tolerance: App.DEMO_TOLERANCE,
      serviceTolerance: "0", monthlyBenefitPlausibilityCap: 2500000,
      plausibleBenefitCompRatioRange: null, planServiceCreditRule: null,
      validFormCodes: ["NSF", "NMF", "QPSA", "J&S50", "J&S75", "J&S100"],
      file: { openable: true, truncated: false, hashMatches: true, hashBefore: "demo", hashAfter: "demo", macroRan: false, unknownFields: [] },
      priorExtract: null,
    };
  }
  const FORMULA_PARAMS = {
    "SYN-001": { avgComp: "60000", service: "20" },
    "SYN-002": { avgComp: "60000", service: "22" },
    "SYN-003": { avgComp: "60000", service: "20" },
    "SYN-004": { avgComp: "49600", service: "15" },
    "SYN-V-01": { avgComp: "33980", service: "20" },
    "SYN-I-01": { avgComp: "60000", service: "20" },
  };
  function roundingConfig(planVersionId) {
    return {
      configId: "rc-demo", version: "rounding-config v1.0.0",
      planVersionId,
      prescribedSequence: { sequenceId: "prescribed", rules: [{ target: "final-monthly-benefit", unit: "0.01", mode: "half-up", stage: "final", source: { kind: "plan-provision", citation: "plan §5.01" } }] },
      alternativeSequences: [], setBy: "demo", setDate: "2026-11-12", rationale: "demo fixture",
    };
  }
  function recordedBenefit(key) {
    const minor = recordedMinor(key);
    const dote = doteOf(key);
    if (minor === null || dote === null) return null;
    return App.makeBenefit(
      { planVersionId: "pv-demo-1985", measurementDate: dote, rounding: { stage: "final-only", mode: "nearest-cent", source: "demo" } },
      App.makeMoney(minor), "monthly", undefined, "prior-administrator",
    );
  }
  function buildRequest(key) {
    const employmentPeriods = pkg().employmentPeriods.filter((e) => e.participantKey === key);
    const compensationHistory = must(pkg().compensationHistories.find((c) => c.participantKey === key), "compensation history for " + key);
    const serviceHistory = must(pkg().serviceHistories.find((s) => s.participantKey === key), "service history for " + key);
    const dote = doteOf(key);
    return {
      participantKey: key,
      participantHistory: { participantKey: key, employmentPeriods, compensationHistory, serviceHistory, benefitObservations: [] },
      provisionTimeline: { planId: "plan-harborview", versions: pkg().planVersions },
      measurementDate: dote, measurementBasis: dote === null ? "unresolved" : "dote",
      calculationKind: "accrued", formulaId: "T-04", roundingConfig: roundingConfig("pv-demo-1985"),
      tolerance: App.DEMO_TOLERANCE,
      runContext: { engineVersion: "0.1.0", ruleVersion: "2026-11-12", formulaTaxonomyVersion: "1.0", inputSnapshotHash: "demo" },
    };
  }
  function buildInputs(key) {
    const params = must(FORMULA_PARAMS[key], "formula params for " + key);
    const inputs = {
      formulaCall: { formulaId: "T-04", params: { accrualRate: App.datedValue("0.015", "1985-07-01", "pv-demo-1985"), avgComp: params.avgComp, service: params.service } },
      recordedPaAmb: recordedBenefit(key),
      averagingPeriod: { kind: "final", years: 3, description: "final-3-year", ruleRef: "plan §5.01" },
      requiredBasis: { annuityForm: "NSF", retirementAge: 65 },
    };
    if (key === "SYN-002") {
      inputs.boundsSpec = { ranges: [{ field: "CompensationHistory.salaryYear 2020", missingClass: "c", low: "54000", high: "64800", unit: "annual-compensation-dollars", basis: "prior-year salary bounded by the plan's pay scale" }], assumptions: ["formula T-04 applies to all service"] };
    }
    if (key === "SYN-004") {
      inputs.boundsSpec = { ranges: [{ field: "CompensationHistory.salaryYear 2020", missingClass: "c", low: "45600", high: "55200", unit: "annual-compensation-dollars", basis: "prior-year salary bounded by the plan's pay scale" }], assumptions: ["formula T-04 applies to all service"] };
    }
    return inputs;
  }
  function baseEvidence(key) {
    return {
      participantKey: key, caseId: "00098765", toleranceSetId: "tol-demo",
      completenessGrade: "complete", comparisonBasis: "established",
      basisUnresolvable: false, basisNote: null, reconstructedMinor: null,
      recordedMinor: recordedMinor(key), deltaMinor: null, withinTolerance: null,
      denominatorFlag: null, boundsMinor: null, boundWidthMaterial: false,
      boundWidthJustification: null, boundAssumptionsInDoubt: false,
      hypotheses: [], conflictingCorrections: false, correctedBenefitMinor: null,
      correctionReasonablyCertain: false, correctionDirection: null,
      missingEvidence: [], dataRequests: [], nextSteps: [],
      uninvestigatedFlag: false, blockingValidationOutstanding: false,
      statisticalOnly: false, contradictoryEvidenceUnresolved: false,
      supportedGround: null, indeterminateRationale: null,
      noFurtherRequestReason: null, ruleApplicabilityOk: true, snapshotMatches: true,
    };
  }
  function demoDecideEvidence(key, outcome) {
    const base = baseEvidence(key);
    if (key === "SYN-001") return { ...base, reconstructedMinor: 150000, deltaMinor: 0, withinTolerance: true, hypotheses: [{ code: "H2", supportClass: "refuted", material: true }] };
    if (key === "SYN-V-01") return { ...base, reconstructedMinor: 84950, deltaMinor: 50, withinTolerance: true, hypotheses: [{ code: "H15", supportClass: "supported", material: true }] };
    if (key === "SYN-003") return { ...base, reconstructedMinor: 150000, deltaMinor: 100000, withinTolerance: false, hypotheses: [{ code: "H2", supportClass: "proposed", material: true }], nextSteps: ["Ask the prior administrator for the workpaper behind $2,500.00."] };
    if (key === "SYN-002") return { ...base, completenessGrade: "partial", boundsMinor: { min: 158400, max: 168300 }, boundWidthMaterial: true, missingEvidence: [{ input: "CompensationHistory.salaryYear 2020", missingClass: "M3", decisionImpact: "Resolving it narrows the bounds by $99.00 and could move the disposition.", uncertaintyContributionMinor: 9900 }], nextSteps: ["Obtain compensation year 2020 from the prior administrator."] };
    if (key === "SYN-004") return { ...base, completenessGrade: "partial", boundsMinor: { min: 90000, max: 96000 }, boundWidthMaterial: true, missingEvidence: [{ input: "CompensationHistory.salaryYear 2020", missingClass: "M3", decisionImpact: "Resolving it narrows the bounds by $60.00 and could move the disposition.", uncertaintyContributionMinor: 6000 }], nextSteps: ["Obtain compensation year 2020 from the prior administrator."] };
    return {
      ...base, completenessGrade: "insufficient", comparisonBasis: "unresolved",
      basisUnresolvable: true,
      basisNote: "DOTE is blank; no PA benefit schedule or plan document establishes the measurement date.",
      recordedMinor: null,
      missingEvidence: [
        { input: "DOTE (measurement date)", missingClass: "M5", decisionImpact: "Without a measurement date no comparison basis exists and no delta can be computed.", uncertaintyContributionMinor: null },
        { input: "PA_AMB", missingClass: "M1", decisionImpact: "Without the recorded amount there is nothing to compare.", uncertaintyContributionMinor: null },
      ],
      dataRequests: [{ requestId: "req-demo-i-01-1", input: "DOTE (measurement date)", participantKeys: ["SYN-I-01"], sourceToAsk: "PA benefit schedule", expectedDecisionEffect: "Establishing the measurement date would resolve the comparison basis.", priority: 1, status: "issued", statusReason: "Issued; awaiting response.", requestedDate: "2026-11-12", answeredDate: null }],
      indeterminateRationale: "The measurement date (DOTE) is blank and cannot be established from available documents, so no comparison basis exists and no delta can be computed.",
    };
  }
  function propose(key, evidence) {
    const { recommendation, entry } = App.dispositionEntryInput(evidence);
    dispatch({ kind: "evidence-recorded", participantKey: key, evidence: entry, actor: "demo", occurredAt: TS });
    dispatch({
      kind: "analysis-event",
      event: { kind: "user-action", eventId: `ui-propose-${key}-${Date.now()}`, actor: "system", occurredAt: TS, action: "propose-disposition", participantKey: key, dispositionEvent: { kind: "propose", actor: "system", target: recommendation.disposition, evidenceChanged: true } },
    });
    const after = state().analysis.participants[key].disposition;
    return { recommended: recommendation.disposition, status: after === null ? null : after.status, disposition: after === null ? null : after.disposition, downstreamUse: after === null ? null : after.downstreamUse, refusal: state().lastRefusal };
  }
  function approve(key, determination, approval) {
    dispatch({
      kind: "analysis-event",
      event: { kind: "user-action", eventId: `ui-approve-${key}-${Date.now()}`, actor: "A. Actuary", occurredAt: TS, action: "approve-disposition", participantKey: key, dispositionEvent: { kind: "approve", actor: "A. Actuary", determination, approval } },
    });
    const after = state().analysis.participants[key].disposition;
    return { status: after === null ? null : after.status, disposition: after === null ? null : after.disposition, downstreamUse: after === null ? null : after.downstreamUse, refusal: state().lastRefusal };
  }
  function approvalFor(determinationId) {
    const s = state();
    return {
      approvalId: `appr-${determinationId}`,
      reviewer: "A. Actuary", reviewerRole: "case actuary",
      rationale: "See determination.",
      approvalDate: "2026-11-12",
      evidenceSnapshot: {
        snapshotId: `snap-${determinationId}`,
        inputSnapshotHash: s.analysis.inputSnapshot.snapshotHash,
        calculationRunId: "run-demo-1",
        ruleVersion: s.analysis.ruleVersions.validationRules,
        toleranceSetId: "tol-demo",
        dispositionSchemaVersion: "1.0.0",
        determinationId,
        sourceDocumentIds: ["doc-demo-census"],
        calculationTraceHash: `trace-${determinationId}`,
        boundsAssumptionsHash: null,
      },
      confirmations: { entryConditionsHold: true, determinationComplete: true, toleranceIdentified: true, noMaterialUnexplainedItem: true },
    };
  }

  // --- demo actions ---------------------------------------------------------
  if (action.name === "validate") {
    const next = App.runValidation(state(), keys().map(toValidationParticipant), validationContext(), "demo", TS);
    dispatch({ kind: "validation-completed", result: next.validation, actor: "demo", occurredAt: TS });
    return { participantResults: next.validation.participantResults.length, rulesEvaluated: next.validation.summary.rulesEvaluated, findings: next.validation.allFindings.length };
  }
  if (action.name === "calculate") {
    const out = {};
    for (const key of keys()) {
      const { outcome } = App.runCalculation(state(), buildRequest(key), buildInputs(key), "demo", TS);
      dispatch({ kind: "calculation-completed", participantKey: key, outcome, actor: "demo", occurredAt: TS });
      const trace = (outcome.trace ?? []).map((s) => ({ step: s.step, name: s.name, output: typeof s.output === "object" ? JSON.stringify(s.output) : String(s.output ?? ""), ruleRef: s.ruleRef, evidenceGrade: s.evidenceGrade }));
      out[key] = {
        kind: outcome.kind,
        minor: outcome.kind === "exact" ? (outcome.benefit.amount?.amountMinor ?? null) : null,
        bounds: outcome.kind === "bounds" ? { min: outcome.bounds.min.amountMinor, max: outcome.bounds.max.amountMinor, recordedPosition: outcome.bounds.recordedPosition, scenarios: (outcome.bounds.scenarios ?? []).map((sc) => ({ name: sc.name, benefitMinor: sc.benefit?.amountMinor ?? null })) } : null,
        reason: outcome.kind === "indeterminate" ? outcome.reason.code : null,
        traceLength: trace.length,
        traceSteps: trace.map((s) => s.step),
        traceNames: trace.map((s) => s.name),
        roundingSteps: trace.filter((s) => s.name === "rounding"),
      };
    }
    return out;
  }
  if (action.name === "reconcile") {
    const config = { epsilonRMinor: 100, epsilonRSource: "Demo case actuary, set for this demo case only", materialityMinor: 100, materialitySource: "Demo case tolerance v1 ($1.00)" };
    const out = {};
    for (const key of keys()) {
      const outcome = state().calculations[key];
      const inputs = App.buildReconciliationInputs({
        outcome, recorded: recordedBenefit(key), toleranceApplied: App.DEMO_TOLERANCE,
        comparisonBasis: outcome.kind === "indeterminate" ? "unresolved" : "basis-converted",
        basisConversion: outcome.kind === "indeterminate" ? undefined : "vesting",
      });
      const next = App.runReconciliation(state(), key, inputs, config, "demo", TS);
      const rec = next.reconciliations[key];
      dispatch({ kind: "reconciliation-completed", reconciliation: rec, actor: "demo", occurredAt: TS });
      out[key] = { comparable: rec.comparison.comparable, delta: rec.comparison.comparable ? rec.comparison.delta.amountMinor : null, toleranceVerdict: rec.toleranceVerdict, recommended: rec.recommendedDisposition };
    }
    return out;
  }
  if (action.name === "statistics") {
    const rows = keys().map((key) => {
      const rec = state().reconciliations[key];
      const p = must(pkg().participants.find((x) => x.participantKey === key), "participant " + key);
      const ch = must(pkg().compensationHistories.find((x) => x.participantKey === key), "compensation history for " + key);
      const sh = must(pkg().serviceHistories.find((x) => x.participantKey === key), "service history for " + key);
      const known = ch.salaryByYear.filter((s) => s.amount !== null);
      const meanAnnual = known.length === 0 ? null : Math.round(known.reduce((s, x) => s + (x.amount?.amountMinor ?? 0), 0) / known.length);
      const dote = doteOf(key);
      return {
        participantKey: key, status: p.retstat.value, employmentGroup: null, formulaType: "unit-credit", amendmentCohort: null,
        paAmbMinor: recordedMinor(key),
        reconstructedMinor: rec.reconstructed?.amount?.amountMinor ?? null,
        deltaMinor: rec.comparison.comparable ? rec.comparison.delta.amountMinor : null,
        absDeltaMinor: rec.comparison.comparable ? rec.comparison.absDelta.amountMinor : null,
        relDelta: rec.comparison.comparable && rec.comparison.relative.kind === "defined" ? rec.comparison.relative.value : null,
        denominatorFlag: rec.comparison.comparable ? rec.comparison.denominatorFlag : null,
        ageYears: dote === null ? null : ageAt(must(p.dob.value, "dob"), dote),
        serviceYears: sh.paCreditedService.value,
        compensationMinor: meanAnnual,
        retirementStatus: p.retstat.value, dataCompleteness: null,
        monthsSinceRecorded: dote === null ? null : 80,
        qdro: false, priorDistribution: false,
        employmentPeriods: pkg().employmentPeriods.filter((e) => e.participantKey === key).length,
      };
    });
    const next = App.runStatistics(state(), rows, { absMinor: 100, relDecimal: "0.01", source: "case tolerance record v1" }, "demo", TS);
    dispatch({ kind: "statistics-completed", population: next.statistics, outliers: next.statisticsOutliers, actor: "demo", occurredAt: TS });
    return { populationN: next.statistics.pooled.n, excluded: next.statistics.excludedFromDiscrepancy, flags: (next.statisticsOutliers?.flags ?? []).map((f) => ({ key: f.participantKey, method: f.method, score: f.score })) };
  }
  if (action.name === "propose-v01") {
    return propose("SYN-V-01", demoDecideEvidence("SYN-V-01", state().calculations["SYN-V-01"]));
  }
  if (action.name === "approve-v01") {
    const current = state().analysis.participants["SYN-V-01"].disposition;
    if (current === null) throw new Error("SYN-V-01 has no recommended disposition to approve");
    const determination = {
      determinationId: "det-demo-v01", dispositionId: current.dispositionId,
      participantKey: "SYN-V-01", caseId: "case-demo", schemaVersion: "1.0.0",
      createdAt: "2026-11-12", createdBy: "A. Actuary",
      recordedBenefit: { amountCents: 85000, isBlank: false, sourceScheduleRef: "Demo census row 5", recordedDate: "2020-03-15" },
      calculatedBenefit: { amountCents: 84950, calculationId: "calc-demo-v01", calculationStatus: "complete", boundsCents: null, noBoundsReason: null, correctedBenefitCents: null },
      comparisonBasis: { basis: "established", measurementDate: "2020-02-29", retirementBasis: "NRD 2029-04-30", annuityForm: "NSF", vestingTreatment: "vested", planVersionIds: ["pv-demo-1985"], comparisonBasisState: "basis-converted", toleranceSetId: "tol-demo", deltaCents: 50, withinTolerance: true },
      differencesAndExplanations: {
        deltaCents: 50, absDeltaCents: 50, relDelta: 0.0005886, denominatorFlag: "ok",
        hypotheses: [{ id: "hyp-demo-v01", version: 1, supersedesId: null, sourceRecordIds: [], createdDate: "2026-11-12", createdBy: "system", hypothesisId: "H15-1", comparisonId: "cmp-demo-v01", hypothesisType: "rounding", counterfactual: "final monthly benefit rounded to the nearest dollar gives $850.00", counterfactualCalculationId: "calc-demo-v01-cf", evidence: [], rank: 1, status: "tested-supported" }],
        leadingExplanation: "Independent calculation $849.50; recorded $850.00; $0.50 within the $1.00 case tolerance.",
      },
      missingEvidence: [], materialAssumptions: [],
      sensitivityAndUncertainty: { scenarios: [], dispositionSensitivity: "No missing input; no disposition sensitivity.", uncertaintyAttribution: [], statisticalNotes: null },
      supportingDocuments: [{ documentId: "doc-demo-census", citation: "Synthetic plan §5.01 (demo)", whatItSupports: "unit-credit formula, 1.5% accrual rate, final-3-year average" }],
      recommendedDisposition: { disposition: "verified", recommendedBy: "system", recommendedAt: "2026-11-12", recommendationRationale: "Independent calculation agrees within tolerance." },
      humanDetermination: { disposition: "verified", rationale: "Independent reconstruction $849.50; recorded $850.00; $0.50 difference within the $1.00 case tolerance; no other discrepancy.", reviewer: "A. Actuary", reviewerRole: "case actuary", determinationDate: "2026-11-12", approvalId: null },
      dataRequests: [],
      downstream: { usableInValuation: true, valueCents: 85000, valueKind: "recorded", paAmbAccept: "Y" },
      contentHash: "content-hash-demo-v01",
    };
    const approval = approvalFor("det-demo-v01");
    approval.rationale = "Independent reconstruction $849.50; recorded $850.00; $0.50 difference within the $1.00 case tolerance; no other discrepancy.";
    return approve("SYN-V-01", determination, approval);
  }

  // --- Harborview 3-version timeline (Stage 2 output 01 §8) ----------------
  if (action.name === "harborview") {
    const prov = () => ({ documentId: "doc-harborview", location: { kind: "user-entered", enteredBy: "tester", enteredDate: "2026-01-01", entryForm: "test" }, acquisition: "user-entered", derivation: null, sourceFileHash: null });
    const sourced = (value) => ({ value, provenance: prov() });
    const ent = (id) => ({ id, version: 1, supersedesId: null, sourceRecordIds: [], createdDate: "2026-01-01", createdBy: "tester" });
    const planVersion = (versionId, effectiveDate, formulaIds, freeze) => ({
      ...ent(versionId), planId: "plan-harborview", versionId,
      effectiveDate: sourced(effectiveDate), adoptionDate: sourced("1985-06-15"),
      restatementDate: sourced(null), provisionText: sourced(""), provisionSection: sourced("§5.01"),
      supersedesVersionId: null, grandfatheredGroups: sourced([]), freeze: sourced(freeze),
      sourceDocumentId: "doc-harborview", changeSummary: "", statutoryLimitsInForce: [], formulaIds,
    });
    const timeline = {
      planId: "plan-harborview",
      versions: [
        planVersion("pv-1985-orig", "1985-07-01", ["T-03"], null),
        planVersion("pv-2004-amend", "2004-01-01", ["T-03"], null),
        planVersion("pv-2019-freeze", "2019-01-01", ["T-03"], { freezeDate: "2019-01-01", scope: "accrual-only", partialScopeNote: null, sourceSection: "2018 amendment §2" }),
      ],
    };
    const employmentPeriod = (start, end) => ({
      ...ent(`ep-${start}`), participantKey: "P-SYN-001",
      doh: sourced(start), dote: sourced(end), dop: sourced(null),
      dobfParticipant: sourced(null), dor: sourced(null), postDoptDote: sourced(null),
      periodSeq: 1, periodType: "initial-hire", periodStart: start, periodEnd: end,
      breakInService: null, hoursPerPeriod: sourced(null),
    });
    const serviceHistory = {
      ...ent("sh-harborview"), participantKey: "P-SYN-001",
      asOfDate: sourced("2010-06-30"),
      paCreditedService: sourced(24.25), paVestingService: sourced(24.25), paEligibilityService: sourced(24.25),
      bcvCreditedService: sourced(24.25), bcvVestingService: sourced(24.25), bcvEligibilityService: sourced(24.25),
      paVestingPercent: sourced("1"), bcvVestingPercent: sourced("1"),
      serviceMeasure: "years",
      servicePeriods: [{ start: "1986-04-01", end: "2010-06-30", measure: 24.25, provenance: prov() }],
      breaksApplied: [], distributions: [],
    };
    const compHist = {
      ...ent("ch-harborview"), participantKey: "P-SYN-001",
      firstYear: sourced(2008), lastYear: sourced(2010),
      salaryByYear: [{ year: 2008, minor: 4800000 }, { year: 2009, minor: 5000000 }, { year: 2010, minor: 5200000 }].map((s, i) => ({ salaryYear: s.year, sourceField: `S00${i + 1}`, amount: App.makeMoney(s.minor), annualized: false, provenance: prov() })),
      annualizedFlagSource: sourced(null), salaryDesc: sourced("W-2 wages"),
      currentMonthlyComp: sourced(null), paAverageComp: sourced(null),
      compensationDefinitionApplied: "plan §2.01", nonCensusInputs: [],
    };
    const rc = roundingConfig("pv-2004-amend");
    const request = {
      participantKey: "P-SYN-001",
      participantHistory: { participantKey: "P-SYN-001", employmentPeriods: [employmentPeriod("1986-04-01", "2010-06-30")], compensationHistory: compHist, serviceHistory, benefitObservations: [] },
      provisionTimeline: timeline,
      measurementDate: "2010-06-30", measurementBasis: "dote",
      calculationKind: "accrued", formulaId: "T-03", roundingConfig: rc,
      tolerance: { version: 1, absoluteMinor: 100, relativeDecimal: "0.001", application: "either", authority: "test fixture", approvedBy: "tester", approvedDate: "2026-01-01" },
      runContext: { engineVersion: "0.1.0", ruleVersion: "2026-11-12", formulaTaxonomyVersion: "1.0", inputSnapshotHash: "test" },
    };
    const recorded = App.makeBenefit(
      { planVersionId: "pv-2004-amend", measurementDate: "2010-06-30", rounding: { stage: "final-only", mode: "nearest-cent", source: "test" } },
      App.makeMoney(123250), "monthly", undefined, "prior-administrator",
    );
    const baseInputs = {
      formulaCall: {
        formulaId: "T-03",
        params: {
          unitRate: App.datedValue("55", "2004-01-01", "pv-2004-amend"),
          service: "24.25",
          periodRates: [
            { from: "1986-04-01", to: "2003-12-31", rate: "40", service: "17.75" },
            { from: "2004-01-01", to: "2010-06-30", rate: "55", service: "6.5" },
          ],
        },
      },
      recordedPaAmb: recorded,
      averagingPeriod: { kind: "final", years: 3, description: "final-3-year", ruleRef: "plan §5.01" },
      requiredBasis: { annuityForm: "NSF", retirementAge: 65 },
    };
    const run = (inputs) => {
      const { outcome } = App.runCalculation(state(), request, inputs, "demo", TS);
      return outcome;
    };
    const outcome = run(baseInputs);
    // Counterfactual: 3 extra post-2003 years at $55 (9.5 post years, 27.25 total).
    const cfInputs = JSON.parse(JSON.stringify(baseInputs));
    cfInputs.formulaCall.params.service = "27.25";
    cfInputs.formulaCall.params.periodRates[1].service = "9.5";
    const cfOutcome = run(cfInputs);
    // Loose reading refuted: 27.25 years all at $55 (no period split).
    const looseInputs = JSON.parse(JSON.stringify(baseInputs));
    looseInputs.formulaCall.params.service = "27.25";
    delete looseInputs.formulaCall.params.periodRates;
    const looseOutcome = run(looseInputs);
    // Reconcile the base reconstruction against the recorded $1,232.50.
    const recInputs = App.buildReconciliationInputs({
      outcome, recorded,
      toleranceApplied: { version: 1, absoluteMinor: 100, relativeDecimal: "0.001", application: "either", authority: "test fixture", approvedBy: "tester", approvedDate: "2026-01-01" },
      comparisonBasis: "same-basis",
    });
    const recState = App.runReconciliation(state(), "P-SYN-001", recInputs, { epsilonRMinor: 100, epsilonRSource: "test fixture", materialityMinor: 100, materialitySource: "test fixture" }, "demo", TS);
    const rec = recState.reconciliations["P-SYN-001"];
    const trace = (outcome.trace ?? []).map((s) => ({ step: s.step, name: s.name, output: typeof s.output === "object" ? JSON.stringify(s.output) : String(s.output ?? ""), ruleRef: s.ruleRef }));
    return {
      kind: outcome.kind,
      minor: outcome.kind === "exact" ? (outcome.benefit.amount?.amountMinor ?? null) : null,
      periodicity: outcome.kind === "exact" ? outcome.benefit.periodicity : null,
      vestingTreatment: outcome.kind === "exact" ? outcome.benefit.vestingTreatment : null,
      annuityForm: outcome.kind === "exact" ? outcome.benefit.annuityForm : null,
      retirementAge: outcome.kind === "exact" ? outcome.benefit.retirementAge : null,
      delta: 123250 - (outcome.benefit.amount?.amountMinor ?? 0),
      hasDisposition: "disposition" in outcome,
      hasDetermination: "determination" in outcome,
      traceLength: trace.length,
      traceNames: trace.map((s) => s.name),
      counterfactualMinor: cfOutcome.kind === "exact" ? (cfOutcome.benefit.amount?.amountMinor ?? null) : null,
      looseMinor: looseOutcome.kind === "exact" ? (looseOutcome.benefit.amount?.amountMinor ?? null) : null,
      reconDelta: rec.comparison.comparable ? rec.comparison.delta.amountMinor : null,
      reconRecommended: rec.recommendedDisposition,
      reconVerdict: rec.toleranceVerdict,
    };
  }

  // --- SYN-I-01 decisions variant (Stage 2 output 05 §8) -------------------
  if (action.name === "i01-variant") {
    const exhausted = action.exhausted === true;
    const content = {
      justifiedBoundsCents: null,
      noBoundsReason: "Governing formula version for the participant's era cannot be identified and the measurement date is unresolved; no single bound is justifiable.",
      scenarioBounds: [
        { scenarioName: "1.50% formula", assumptions: ["pre-amendment formula 1.50% applies"], minCents: 150000, maxCents: 156000 },
        { scenarioName: "1.25% formula", assumptions: ["post-amendment formula 1.25% applies"], minCents: 125000, maxCents: 130000 },
      ],
      missingEvidence: [
        { input: "PA benefit schedule for this participant", missingClass: "M2", decisionImpact: "Establishes the basis; could move the participant from Indeterminate to a decidable state.", uncertaintyContributionCents: null },
        { input: "plan document / amendment for the era, with adoption and effective dates", missingClass: "M5", decisionImpact: "Identifies the governing formula; collapses the two scenario ranges to one.", uncertaintyContributionCents: null },
        { input: "missing compensation year", missingClass: "M3", decisionImpact: "Narrows the per-scenario bound width by up to $60.00; does not by itself change the disposition.", uncertaintyContributionCents: 6000 },
        { input: "annuity form and vesting treatment of B_i^PA", missingClass: "M1", decisionImpact: "Required for exact reconstruction; no source states them.", uncertaintyContributionCents: null },
      ],
      dataRequests: [
        { requestId: "req-1", input: "PA benefit schedule (measurement date, annuity form, vesting treatment, schedule row for $1,120.00)", participantKeys: ["SYN-I-01"], sourceToAsk: "Prior plan administrator (holder of the schedule)", expectedDecisionEffect: "Disposition-changing: establishes the basis.", priority: 1, status: exhausted ? "answered-no-data" : "issued", statusReason: exhausted ? "Asked; the source has no data." : "Issued 2026-11-12; awaiting response.", requestedDate: "2026-11-12", answeredDate: exhausted ? "2026-11-12" : null },
        { requestId: "req-2", input: "Plan document / amendment for the era (formula version, effective date)", participantKeys: ["SYN-I-01"], sourceToAsk: "Plan sponsor records / prior administrator", expectedDecisionEffect: "Disposition-changing: identifies the governing formula.", priority: 2, status: exhausted ? "answered-no-data" : "issued", statusReason: exhausted ? "Asked; the source has no data." : "Issued 2026-11-12; awaiting response.", requestedDate: "2026-11-12", answeredDate: exhausted ? "2026-11-12" : null },
        { requestId: "req-3", input: "Missing compensation year", participantKeys: ["SYN-I-01"], sourceToAsk: "Payroll records via the prior administrator", expectedDecisionEffect: "Narrows the per-scenario bound width by up to $60.00; does not by itself change the disposition.", priority: 3, status: "not-issued", statusReason: "Held until requests 1–2 are answered, because its decision effect depends on which formula governs.", requestedDate: null, answeredDate: null },
      ],
      indeterminateRationale: "No further step is currently available beyond the two issued requests; the participant cannot be decided on the evidence as it stands.",
      noFurtherRequestReason: exhausted ? "Requests 1–2 answered with no data. The remaining request (missing compensation year) narrows per-scenario bounds only and cannot change the disposition while the formula and basis are unresolved." : null,
    };
    const evidence = {
      participantKey: "SYN-I-01", caseId: "00098765", toleranceSetId: "tol-demo",
      completenessGrade: "insufficient", comparisonBasis: "unresolved",
      basisUnresolvable: true,
      basisNote: "DOTE is blank; no PA benefit schedule or plan document establishes the measurement date.",
      reconstructedMinor: null, recordedMinor: 112000, deltaMinor: null, withinTolerance: null,
      denominatorFlag: null, boundsMinor: null, boundWidthMaterial: false,
      boundWidthJustification: null, boundAssumptionsInDoubt: false,
      hypotheses: [
        { code: "H1", supportClass: "indeterminate", material: true },
        { code: "H6", supportClass: "indeterminate", material: true },
        { code: "H16", supportClass: "supported", material: false },
      ],
      conflictingCorrections: false, correctedBenefitMinor: null,
      correctionReasonablyCertain: false, correctionDirection: null,
      missingEvidence: content.missingEvidence, dataRequests: content.dataRequests,
      nextSteps: ["PA benefit schedule requested", "plan document/amendment requested"],
      uninvestigatedFlag: false, blockingValidationOutstanding: false,
      statisticalOnly: false, contradictoryEvidenceUnresolved: false,
      supportedGround: null, indeterminateRationale: content.indeterminateRationale,
      noFurtherRequestReason: content.noFurtherRequestReason,
      ruleApplicabilityOk: true, snapshotMatches: true,
    };
    const proposed = propose("SYN-I-01", evidence);
    // Approval attempt with the decisions-fixture determination.
    const current = state().analysis.participants["SYN-I-01"].disposition;
    let approved = null;
    if (current !== null) {
      const determination = {
        determinationId: "det-demo-i01", dispositionId: current.dispositionId,
        participantKey: "SYN-I-01", caseId: "case-demo", schemaVersion: "1.0.0",
        createdAt: "2026-11-12", createdBy: "A. Actuary",
        recordedBenefit: { amountCents: 112000, isBlank: false, sourceScheduleRef: "census row (no schedule row traces to it)", recordedDate: null },
        calculatedBenefit: { amountCents: null, calculationId: null, calculationStatus: "indeterminate", boundsCents: null, noBoundsReason: content.noBoundsReason, correctedBenefitCents: null },
        comparisonBasis: { basis: "unresolved", measurementDate: null, retirementBasis: null, annuityForm: null, vestingTreatment: "unknown", planVersionIds: [], comparisonBasisState: "unresolved", toleranceSetId: "tol-demo", deltaCents: null, withinTolerance: null },
        differencesAndExplanations: { deltaCents: null, absDeltaCents: null, relDelta: null, denominatorFlag: null, hypotheses: [], leadingExplanation: "none supported — H1 and H6 indeterminate without a measurement date or the amendment document; H16 supported as a description of the state." },
        missingEvidence: content.missingEvidence,
        materialAssumptions: [],
        sensitivityAndUncertainty: { scenarios: content.scenarioBounds.map((s) => ({ name: s.scenarioName, assumptions: s.assumptions.join("; "), benefit: null, planVersionId: null, formulaId: null })), dispositionSensitivity: "Resolving the formula collapses the two scenario ranges to one.", uncertaintyAttribution: [], statisticalNotes: null },
        supportingDocuments: [],
        recommendedDisposition: { disposition: "indeterminate", recommendedBy: "system", recommendedAt: "2026-11-12", recommendationRationale: "No comparison basis exists; no delta can be computed." },
        humanDetermination: { disposition: "indeterminate", rationale: "Measurement date blank and formula era unidentified; recorded $1,120.00 lies outside both per-scenario ranges but the basis is unresolved, so no conclusion follows.", reviewer: "A. Actuary", reviewerRole: "case actuary", determinationDate: "2026-11-12", approvalId: null },
        dataRequests: content.dataRequests,
        downstream: { usableInValuation: false, valueCents: null, valueKind: "none", paAmbAccept: "N" },
        contentHash: "content-hash-demo-i01",
      };
      const approval = approvalFor("det-demo-i01");
      approval.rationale = "Measurement date blank and formula era unidentified; recorded $1,120.00 lies outside both per-scenario ranges but the basis is unresolved, so no conclusion follows.";
      approval.evidenceSnapshot.calculationRunId = null;
      approval.evidenceSnapshot.calculationTraceHash = null;
      approval.evidenceSnapshot.sourceDocumentIds = [];
      approved = approve("SYN-I-01", determination, approval);
    }
    return {
      exhausted,
      scenarioBounds: content.scenarioBounds,
      recordedCents: 112000,
      outsideBoth: content.scenarioBounds.every((s) => 112000 < s.minCents),
      priorities: content.dataRequests.map((r) => r.priority),
      statuses: content.dataRequests.map((r) => r.status),
      proposed,
      approved,
    };
  }

  // --- population (1,000 participants, seeded, ground-truth cohorts) --------
  if (action.name === "population") {
    const t0 = Date.now();
    const mulberry32 = (seed) => {
      let a = seed >>> 0;
      return () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    const COHORTS = [
      { cohort: "clean", from: 0, to: 399 },
      { cohort: "service", from: 400, to: 549 },
      { cohort: "averaging", from: 550, to: 699 },
      { cohort: "rounding", from: 700, to: 799 },
      { cohort: "missing", from: 800, to: 899 },
      { cohort: "vesting", from: 900, to: 999 },
    ];
    const cohortOf = (i) => { for (const c of COHORTS) if (i >= c.from && i <= c.to) return c.cohort; throw new Error("no cohort"); };
    const pkey = (i) => `SYN-POP-${String(i + 1).padStart(4, "0")}`;
    const prov = () => ({ documentId: "doc-pop", location: { kind: "user-entered", enteredBy: "tester", enteredDate: "2026-01-01", entryForm: "test" }, acquisition: "user-entered", derivation: null, sourceFileHash: null });
    const sourced = (v) => ({ value: v, provenance: prov() });
    const ent = (id) => ({ id, version: 1, supersedesId: null, sourceRecordIds: [], createdDate: "2026-01-01", createdBy: "tester" });
    const planVersion = () => ({ ...ent("v1"), planId: "plan-1", versionId: "v1", effectiveDate: sourced("1985-07-01"), adoptionDate: sourced("1985-06-01"), restatementDate: sourced(null), provisionText: sourced(""), provisionSection: sourced("§5.01"), supersedesVersionId: null, grandfatheredGroups: sourced([]), freeze: sourced(null), sourceDocumentId: "doc-1", changeSummary: "", statutoryLimitsInForce: [], formulaIds: ["T-04"] });
    const salariesFor = (rng, missing2020) => {
      const base = 48000 + Math.floor(rng() * 24001);
      const years = missing2020 ? [2018, 2019, 2020] : [2015, 2016, 2017, 2018, 2019];
      return years.map((year) => {
        if (missing2020 && year === 2020) return { year, minor: null };
        const growth = Math.pow(1.02, year - 2015);
        const jitter = 1 + (rng() - 0.5) * 0.02;
        return { year, minor: Math.round(base * growth * jitter) * 100 };
      });
    };
    const rc = () => ({ configId: "rc-1", version: "rounding-config v1.0.0", planVersionId: "v1", prescribedSequence: { sequenceId: "prescribed", rules: [{ target: "final-monthly-benefit", unit: "0.01", mode: "half-up", stage: "final", source: { kind: "plan-provision", citation: "plan §5.01" } }] }, alternativeSequences: [], setBy: "tester", setDate: "2026-01-01", rationale: "test fixture" });
    const tol = () => ({ version: 1, absoluteMinor: 100, relativeDecimal: "0.001", application: "either", authority: "test fixture", approvedBy: "tester", approvedDate: "2026-01-01" });
    // Exact decimal ×0.9 / ×1.1 on whole-dollar strings (salaries are whole dollars).
    const decMul10 = (dollars, num) => {
      const tenths = dollars * num;
      const whole = Math.trunc(tenths / 10);
      const frac = tenths % 10;
      return frac === 0 ? String(whole) : `${whole}.${frac}`;
    };
    const makeReq = (key, salaries, vp) => ({
      participantKey: key,
      participantHistory: {
        participantKey: key,
        employmentPeriods: [{ ...ent(`ep-${key}`), participantKey: key, doh: sourced("2000-01-01"), dote: sourced("2020-02-29"), dop: sourced(null), dobfParticipant: sourced(null), dor: sourced(null), postDoptDote: sourced(null), periodSeq: 1, periodType: "initial-hire", periodStart: "2000-01-01", periodEnd: "2020-02-29", breakInService: null, hoursPerPeriod: sourced(null) }],
        compensationHistory: { ...ent(`ch-${key}`), participantKey: key, firstYear: sourced(salaries[0]?.year ?? 2015), lastYear: sourced(salaries[salaries.length - 1]?.year ?? 2019), salaryByYear: salaries.map((s, i) => ({ salaryYear: s.year, sourceField: `S00${i + 1}`, amount: s.minor === null ? null : App.makeMoney(s.minor), annualized: false, provenance: prov() })), annualizedFlagSource: sourced(null), salaryDesc: sourced("W-2 wages"), currentMonthlyComp: sourced(null), paAverageComp: sourced(null), compensationDefinitionApplied: "plan §2.01", nonCensusInputs: [] },
        serviceHistory: { ...ent(`sh-${key}`), participantKey: key, asOfDate: sourced("2020-02-29"), paCreditedService: sourced(20), paVestingService: sourced(20), paEligibilityService: sourced(20), bcvCreditedService: sourced(20), bcvVestingService: sourced(20), bcvEligibilityService: sourced(20), paVestingPercent: sourced(vp), bcvVestingPercent: sourced(vp), serviceMeasure: "years", servicePeriods: [{ start: "2000-01-01", end: "2020-02-29", measure: 20, provenance: prov() }], breaksApplied: [], distributions: [] },
        benefitObservations: [],
      },
      provisionTimeline: { planId: "plan-1", versions: [planVersion()] },
      measurementDate: "2020-02-29", measurementBasis: "dote", calculationKind: "accrued", formulaId: "T-04",
      roundingConfig: rc(), tolerance: tol(),
      runContext: { engineVersion: "0.1.0", ruleVersion: "2026-11-12", formulaTaxonomyVersion: "1.0", inputSnapshotHash: "test" },
    });
    const baseInputs = (recorded) => ({
      formulaCall: { formulaId: "T-04", params: { accrualRate: App.datedValue("0.015", "1985-07-01", "v1"), avgComp: "60000", service: "20" } },
      recordedPaAmb: recorded,
      averagingPeriod: { kind: "final", years: 3, description: "final-3-year", ruleRef: "plan §5.01" },
      alternativeAveragingPeriods: ["final-5-year"],
      requiredBasis: { annuityForm: "NSF", retirementAge: 65 },
    });
    const recordedBenefit = (minor) => App.makeBenefit({ planVersionId: "v1", measurementDate: "2020-02-29", rounding: { stage: "final-only", mode: "nearest-cent", source: "test" } }, App.makeMoney(minor), "monthly", undefined, "prior-administrator");
    const rng = mulberry32(20261112);
    let local = state();
    const rows = [];
    const exactRows = [];
    // The rounding counterfactual (population.test.ts): final monthly
    // benefit to the nearest dollar.
    const DOLLAR_SEQUENCE = { sequenceId: "hypothesis-dollar", rules: [{ target: "final-monthly-benefit", unit: "1", mode: "half-up", stage: "final", source: { kind: "plan-provision", citation: "plan §5.01 (test hypothesis)" } }] };
    const recConfig = { epsilonRMinor: 100, epsilonRSource: "test fixture", materialityMinor: 100, materialitySource: "test fixture" };
    for (let i = 0; i < 1000; i += 1) {
      const cohort = cohortOf(i);
      const key = pkey(i);
      const vp = cohort === "vesting" ? "0.8" : "1";
      let salaries = salariesFor(rng, cohort === "missing");
      let request = makeReq(key, salaries, vp);
      if (cohort === "missing") {
        const filled = salaries.map((s) => s.year === 2020 ? { year: 2020, minor: salaries.find((x) => x.year === 2019)?.minor ?? null } : s);
        const planted = App.runCalculation(local, makeReq(key, filled, vp), baseInputs(null), "demo", TS).outcome;
        if (planted.kind !== "exact") throw new Error(`missing ${key}: planted not exact`);
        const recordedMinor = planted.benefit.amount?.amountMinor ?? null;
        if (recordedMinor === null) throw new Error(`missing ${key}: no amount`);
        const salary2019 = salaries.find((x) => x.year === 2019)?.minor;
        const dollars2019 = Math.round(salary2019 / 100);
        const inputs = { ...baseInputs(recordedBenefit(recordedMinor)), boundsSpec: { ranges: [{ field: "CompensationHistory.salaryYear 2020", missingClass: "c", low: decMul10(dollars2019, 9), high: decMul10(dollars2019, 11), unit: "annual-compensation-dollars", basis: "2019 salary ±10% (test bounds)" }], assumptions: ["formula T-04 applies to all service"] } };
        const r = App.runCalculation(local, request, inputs, "demo", TS);
        local = r.state;
        const outcome = r.outcome;
        if (outcome.kind !== "bounds") throw new Error(`missing ${key}: expected bounds, got ${outcome.kind}`);
        rows.push({ index: i, key, cohort, reconMinor: null, recordedMinor, deltaMinor: null, outcomeKind: "bounds", recordedPosition: outcome.bounds.recordedPosition, boundsMin: outcome.bounds.min.amountMinor, boundsMax: outcome.bounds.max.amountMinor, recommended: null });
        continue;
      }
      let r = App.runCalculation(local, request, baseInputs(null), "demo", TS);
      local = r.state;
      let outcome = r.outcome;
      if (outcome.kind !== "exact") throw new Error(`${key}: expected exact, got ${outcome.kind}`);
      let reconMinor = outcome.benefit.amount?.amountMinor ?? null;
      if (reconMinor === null) throw new Error(`${key}: no amount`);
      if (cohort === "rounding") {
        let tries = 0;
        while (reconMinor % 100 === 0 && tries < 10) {
          salaries = salaries.map((s) => s.year === 2019 && s.minor !== null ? { year: s.year, minor: s.minor + 100 } : s);
          request = makeReq(key, salaries, vp);
          r = App.runCalculation(local, request, baseInputs(null), "demo", TS);
          local = r.state;
          outcome = r.outcome;
          if (outcome.kind !== "exact") throw new Error(`${key}: retry not exact`);
          reconMinor = outcome.benefit.amount?.amountMinor ?? null;
          tries += 1;
        }
        if (reconMinor % 100 === 0) throw new Error(`${key}: could not plant rounding difference`);
      }
      let recordedMinor;
      if (cohort === "clean") recordedMinor = reconMinor;
      else if (cohort === "service") {
        const planted = App.runCalculation(local, request, { ...baseInputs(null), serviceOverride: { creditedService: "21" } }, "demo", TS).outcome;
        if (planted.kind !== "exact") throw new Error(`${key}: planted service not exact`);
        recordedMinor = planted.benefit.amount?.amountMinor ?? null;
      } else if (cohort === "averaging") {
        const planted = App.runCalculation(local, request, { ...baseInputs(null), averagingPeriod: { kind: "final", years: 5, description: "final-5-year", ruleRef: "plan §5.01" } }, "demo", TS).outcome;
        if (planted.kind !== "exact") throw new Error(`${key}: planted averaging not exact`);
        recordedMinor = planted.benefit.amount?.amountMinor ?? null;
      } else if (cohort === "rounding") recordedMinor = Math.round(reconMinor / 100) * 100;
      else {
        const planted = App.runCalculation(local, request, { ...baseInputs(null), applyVestingTwice: true }, "demo", TS).outcome;
        if (planted.kind !== "exact") throw new Error(`${key}: planted vesting not exact`);
        recordedMinor = planted.benefit.amount?.amountMinor ?? null;
      }
      if (recordedMinor === null) throw new Error(`${key}: planted no amount`);
      const recInputs = App.buildReconciliationInputs({ outcome, recorded: recordedBenefit(recordedMinor), toleranceApplied: tol(), comparisonBasis: "same-basis" });
      // Pass 1: test the four counterfactuals the Node oracle tests
      // (population.test.ts) through the newly exposed App.testCounterfactual.
      // Reconciliation itself runs in pass 2, after cohort resolve rates
      // are known — a counterfactual's resolvesCohort flag is a cohort
      // fact, not a per-participant one.
      const cfInputs = baseInputs(recordedBenefit(recordedMinor));
      const cfs = [
        App.testCounterfactual(request, { kind: "service-delta-years", years: "+1" }, cfInputs),
        App.testCounterfactual(request, { kind: "averaging-period", period: "final-5-year" }, cfInputs),
        App.testCounterfactual(request, { kind: "rounding-sequence", sequence: DOLLAR_SEQUENCE }, cfInputs),
        App.testCounterfactual(request, { kind: "vesting", mode: "applied-twice-diagnostic" }, cfInputs),
      ];
      exactRows.push({ index: i, key, cohort, reconMinor, recordedMinor, deltaMinor: recordedMinor - reconMinor, outcomeKind: "exact", recordedPosition: null, boundsMin: null, boundsMax: null, recommended: null, toleranceVerdict: null, recInputs, cfs });
    }
    // Pass 2: cohort resolve rates (fraction of members whose
    // counterfactual residual is exactly zero), then reconcile each
    // exact row with its counterfactuals as hypothesis candidates.
    // Stage 7 G-ACC-4: the engine promotes a Plausible counterfactual
    // to Supported on cohort-wide resolution, and a supported
    // counterfactual that reproduces the recorded amount identifies the
    // administrator's basis as the error with the reconstruction as the
    // corrected value — so the browser now agrees with the Node oracle.
    const resolveRate = {};
    for (const code of ["H2", "H4", "H15", "H12"]) {
      for (const c of ["clean", "service", "averaging", "rounding", "vesting"]) {
        const members = exactRows.filter((r) => r.cohort === c);
        const resolved = members.filter((r) => {
          const cf = r.cfs.find((x) => x.hypothesisCode === code);
          return cf !== undefined && cf.residualDelta !== null && cf.residualDelta.amountMinor === 0;
        }).length;
        resolveRate[`${c}:${code}`] = members.length === 0 ? 0 : resolved / members.length;
      }
    }
    for (const row of exactRows) {
      const candidates = row.cfs.map((cf) => ({
        result: cf,
        documentedMechanism: false,
        resolvesCohort: (resolveRate[`${row.cohort}:${cf.hypothesisCode}`] ?? 0) >= 0.5,
        // Material only when the counterfactual moves the amount: the
        // vesting-twice diagnostic on a VP=1.0 participant changes
        // nothing (benefit == reconstruction), so it is a vacuous
        // Coincidence, not an unresolved material item — it must not
        // block a Verified recommendation for the clean/rounding
        // cohorts (within tolerance, nothing to explain).
        material: cf.benefit?.amount?.amountMinor !== undefined && cf.benefit.amount.amountMinor !== row.reconMinor,
        // The rounding diagnostic needs its evidence to run at all:
        // without it, evaluateAndRankHypotheses skips the diagnostic
        // and a cohort-resolving rounding sequence can never be
        // promoted. The sequence here is NOT documented (a test
        // hypothesis, like the demo's H15 — D-ACC-1); its maximum
        // plausible effect is $0.50 (nearest dollar, one stage).
        ...(cf.operation.kind === "rounding-sequence"
          ? { roundingEvidence: { sequenceDocumented: false, sequenceSource: "not-documented", maxPlausibleEffectMinor: 50 } }
          : {}),
      }));
      const rs = App.runReconciliation(local, row.key, row.recInputs, recConfig, "demo", TS, candidates);
      local = rs;
      const rec = rs.reconciliations[row.key];
      row.recommended = rec.recommendedDisposition;
      row.toleranceVerdict = rec.toleranceVerdict;
      rows.push({ index: row.index, key: row.key, cohort: row.cohort, reconMinor: row.reconMinor, recordedMinor: row.recordedMinor, deltaMinor: row.deltaMinor, outcomeKind: "exact", recordedPosition: null, boundsMin: null, boundsMax: null, recommended: row.recommended, toleranceVerdict: row.toleranceVerdict });
    }
    return { ms: Date.now() - t0, rows };
  }

  if (action.name === "state") {
    const s = state();
    return {
      dispositions: Object.fromEntries(Object.entries(s.analysis.participants).map(([k, p]) => [k, p.disposition === null ? null : `${p.disposition.disposition}/${p.disposition.status}`])),
      lastRefusal: s.lastRefusal,
      fileInputs: document.querySelectorAll("input[type=file]").length,
    };
  }
  if (action.name === "filepicker") {
    return { fileInputs: document.querySelectorAll("input[type=file]").length, htmlHasFileInput: document.documentElement.outerHTML.includes('type="file"') };
  }
  throw new Error("unknown drive action: " + action.name);
}

async function main() {
  const failures = [];
  const ok = (id, cond, detail) => {
    if (!expect(id, cond, detail)) failures.push(id);
  };

  // --- P0: boot, 0 http, file picker present ------------------------------
  let ctx = await openApp();
  let { browser, page, errors, failedRequests } = ctx;
  try {
    await page.waitForSelector("#pa-amb-app");
    assertBooted(errors, failedRequests);
    const fp = await page.evaluate(drive, { name: "filepicker" });
    ok("P0-boot", true, "app booted via file://, no page errors, no failed requests");
    ok("P0-file-picker", fp.fileInputs === 1 && fp.htmlHasFileInput === true, `input[type=file] count = ${fp.fileInputs}; file picker present (Stage 7 Robustness D3 fix — was gap G-ACC-3)`);

    // --- P1: demo wizard ---------------------------------------------------
    await page.locator("#demo-button").click();
    let ws = await wizardState(page);
    ok("P1-demo-load", ws.participantCount === 6, `6 demo participants loaded (got ${ws.participantCount})`);
    const validation = await page.evaluate(drive, { name: "validate" });
    ok("P1-validate", validation.participantResults === 6 && validation.rulesEvaluated > 0, `${validation.rulesEvaluated} rules, ${validation.findings} findings, 6 results`);
    const calc = await page.evaluate(drive, { name: "calculate" });
    const syn001 = calc["SYN-001"];
    ok("P1-SYN-001-exact", syn001.kind === "exact" && syn001.minor === 150000, `exact $${(syn001.minor ?? 0) / 100} (expected $1,500.00)`);
    const expectedSteps = ["provisions-selected", "participation", "credited-service", "average-compensation", "base-formula", "protection-evaluated-not-applied", "restrictions-evaluated-not-applied", "rounding", "normal-retirement-basis", "comparison-basis", "recorded-pa-amb"];
    const stepsOk = syn001.traceLength === 18 && syn001.traceSteps.every((s, i) => s === i + 1) && expectedSteps.every((n) => syn001.traceNames.includes(n));
    ok("P1-SYN-001-trace", stepsOk, `trace ${syn001.traceLength} steps, sequential 1..18, all 10 stages present: ${syn001.traceNames.join(",")}`);
    const syn002 = calc["SYN-002"];
    ok("P1-SYN-002-bounds", syn002.kind === "bounds" && syn002.bounds.min === 158400 && syn002.bounds.max === 168300 && syn002.bounds.recordedPosition === "inside", `bounds $${(syn002.bounds?.min ?? 0) / 100}–$${(syn002.bounds?.max ?? 0) / 100}, recorded $1,620 ${syn002.bounds?.recordedPosition}`);
    const syn003 = calc["SYN-003"];
    ok("P1-SYN-003-exact", syn003.kind === "exact" && syn003.minor === 150000, `exact $${(syn003.minor ?? 0) / 100} (recorded $2,500.00)`);
    const syn004 = calc["SYN-004"];
    ok("P1-SYN-004-bounds", syn004.kind === "bounds" && syn004.bounds.min === 90000 && syn004.bounds.max === 96000 && syn004.bounds.recordedPosition === "inside", `bounds $${(syn004.bounds?.min ?? 0) / 100}–$${(syn004.bounds?.max ?? 0) / 100}, recorded $930 inside`);
    const synV = calc["SYN-V-01"];
    ok("P1-SYN-V-01-exact", synV.kind === "exact" && synV.minor === 84950, `exact $${(synV.minor ?? 0) / 100} (expected $849.50)`);
    const roundingStep = (synV.roundingSteps ?? [])[0] ?? null;
    ok("P1-SYN-V-01-rounding-trace", roundingStep !== null, roundingStep === null ? "no rounding step in trace" : `rounding step: output=${roundingStep.output}, ruleRef=${roundingStep.ruleRef}, grade=${roundingStep.evidenceGrade}`);
    const synI = calc["SYN-I-01"];
    ok("P1-SYN-I-01-indeterminate", synI.kind === "indeterminate" && synI.reason === "unresolved-comparison-basis", `indeterminate, reason ${synI.reason} (DOTE blank; demo PA_AMB also blank)`);
    const recon = await page.evaluate(drive, { name: "reconcile" });
    ok("P1-recon-SYN-001", recon["SYN-001"].delta === 0 && recon["SYN-001"].toleranceVerdict === "within-tolerance" && recon["SYN-001"].recommended === "verified", `Δ $0, within tolerance, recommended verified`);
    ok("P1-recon-SYN-V-01", recon["SYN-V-01"].delta === 50 && recon["SYN-V-01"].toleranceVerdict === "within-tolerance" && recon["SYN-V-01"].recommended === "verified", `Δ +$0.50, within tolerance, recommended verified`);
    ok("P1-recon-SYN-003", recon["SYN-003"].delta === 100000 && recon["SYN-003"].toleranceVerdict === "outside-tolerance" && recon["SYN-003"].recommended === "requires-investigation", `Δ +$1,000.00, outside tolerance, requires-investigation`);
    ok("P1-recon-SYN-002-bounds", recon["SYN-002"].recommended === "requires-investigation", `bounds-inside SYN-002 recommended ${recon["SYN-002"].recommended} (material bound width; Node population oracle would say supported-for-acceptance for inside bounds — same divergence class as G-ACC-4)`);
    ok("P1-recon-SYN-004-bounds", recon["SYN-004"].recommended === "requires-investigation", `bounds-inside SYN-004 recommended ${recon["SYN-004"].recommended}`);
    ok("P1-recon-SYN-I-01", recon["SYN-I-01"].comparable === false && recon["SYN-I-01"].recommended === "indeterminate", `not comparable, no Δ, recommended indeterminate`);
    const stats = await page.evaluate(drive, { name: "statistics" });
    ok("P1-stats", stats.populationN === 6 && stats.flags.some((f) => f.key === "SYN-003" && f.method === "modified-z"), `population n=${stats.populationN}, modified-z flags SYN-003 (flags: ${stats.flags.map((f) => `${f.key}/${f.method}`).join(",")})`);

    // --- P1b: SYN-V-01 propose + approve in the demo case -------------------
    const proposedV = await page.evaluate(drive, { name: "propose-v01" });
    ok("P1b-V-01-propose", proposedV.recommended === "verified" && proposedV.status === "recommended", `recommended verified (refusal: ${proposedV.refusal})`);
    const approvedV = await page.evaluate(drive, { name: "approve-v01" });
    ok("P1b-V-01-approve", approvedV.status === "approved" && approvedV.disposition === "verified", `approved verified (refusal: ${approvedV.refusal})`);
    ok("P1b-V-01-paambaccept", approvedV.downstreamUse !== null && approvedV.downstreamUse.paAmbAccept === "Y" && approvedV.downstreamUse.valueCents === 85000 && approvedV.downstreamUse.usableInValuation === true, `downstreamUse=${JSON.stringify(approvedV.downstreamUse)}`);

    // --- P2: Harborview timeline example ------------------------------------
    const hv = await page.evaluate(drive, { name: "harborview" });
    ok("P2-hv-exact", hv.kind === "exact" && hv.minor === 106750, `exact $${(hv.minor ?? 0) / 100} (expected $1,067.50)`);
    ok("P2-hv-basis", hv.periodicity === "monthly" && hv.vestingTreatment === "vested" && hv.annuityForm === "NSF" && hv.retirementAge === 65, `monthly, vested, NSF, age 65`);
    ok("P2-hv-delta", hv.delta === 16500 && hv.reconDelta === 16500, `Δ +$165.00 (recorded $1,232.50 − reconstructed $1,067.50)`);
    ok("P2-hv-no-retroactive", hv.minor !== 133375 && hv.minor !== 97000, `$55 on all 24.25y would be $1,333.75; $40 on all would be $970.00; got $1,067.50 — latest formula not applied retroactively`);
    ok("P2-hv-counterfactual", hv.counterfactualMinor === 123250, `3 extra post-2003 years at $55 reproduces recorded $1,232.50 exactly (got $${(hv.counterfactualMinor ?? 0) / 100})`);
    ok("P2-hv-loose-pipeline", hv.looseMinor === 133375, `loose inputs through the pipeline price measured service 24.25y, not the stale call parameter 27.25y: 27.25y all at $55 would be $1,498.75, the pipeline returns $1,333.75 = 55 x 24.25 (Stage 5 guard: formula runs on Stage 3/4 measures, pipeline.test.ts). The direct $1,498.75 refutation via evaluateFormulaCall is Node-only (harborview.test.ts) — that function is not exposed on window.PaAmbApp.`);
    void hv;
    ok("P2-hv-no-decision", hv.hasDisposition === false && hv.hasDetermination === false, `calculation carries no disposition/determination — the match stays a hypothesis`);
    ok("P2-hv-recon", hv.reconVerdict === "outside-tolerance" && hv.reconRecommended === "requires-investigation", `outside tolerance, recommended requires-investigation`);
    assertBooted(errors, failedRequests);
  } finally {
    await browser.close();
  }

  // --- P3: SYN-I-01 decisions variant — approval refused --------------------
  ctx = await openApp();
  browser = ctx.browser; page = ctx.page; errors = ctx.errors; failedRequests = ctx.failedRequests;
  try {
    await page.waitForSelector("#pa-amb-app");
    assertBooted(errors, failedRequests);
    await page.locator("#demo-button").click();
    const i01 = await page.evaluate(drive, { name: "i01-variant", exhausted: false });
    ok("P3-I-01-scenarios", i01.scenarioBounds[0].minCents === 150000 && i01.scenarioBounds[0].maxCents === 156000 && i01.scenarioBounds[1].minCents === 125000 && i01.scenarioBounds[1].maxCents === 130000, `1.50% [$1,500–$1,560], 1.25% [$1,250–$1,300]`);
    ok("P3-I-01-outside", i01.outsideBoth === true && i01.recordedCents === 112000, `recorded $1,120.00 below both scenario minima — a lead, not a conclusion`);
    ok("P3-I-01-requests", JSON.stringify(i01.priorities) === "[1,2,3]" && JSON.stringify(i01.statuses) === '["issued","issued","not-issued"]', `3 data requests, priorities ${i01.priorities}, statuses ${i01.statuses}`);
    ok("P3-I-01-propose", i01.proposed.recommended === "indeterminate" && i01.proposed.status === "recommended", `proposed indeterminate/recommended (refusal: ${i01.proposed.refusal})`);
    ok("P3-I-01-propose-downstream", i01.proposed.downstreamUse !== null && i01.proposed.downstreamUse.usableInValuation === false && i01.proposed.downstreamUse.paAmbAccept === null, `recommended downstreamUse=${JSON.stringify(i01.proposed.downstreamUse)}`);
    const ap = i01.approved;
    ok("P3-I-01-approve-refused", ap !== null && ap.status === "recommended" && ap.disposition === "indeterminate" && typeof ap.refusal === "string" && ap.refusal.length > 0, `approval refused, status stays recommended/indeterminate, refusal: ${ap?.refusal}`);
    assertBooted(errors, failedRequests);
  } finally {
    await browser.close();
  }

  // --- P4: SYN-I-01 exhausted search — approval succeeds --------------------
  ctx = await openApp();
  browser = ctx.browser; page = ctx.page; errors = ctx.errors; failedRequests = ctx.failedRequests;
  try {
    await page.waitForSelector("#pa-amb-app");
    assertBooted(errors, failedRequests);
    await page.locator("#demo-button").click();
    const i01x = await page.evaluate(drive, { name: "i01-variant", exhausted: true });
    ok("P4-I-01-exhausted-propose", i01x.proposed.recommended === "indeterminate" && i01x.proposed.status === "recommended", `proposed indeterminate/recommended on exhausted search`);
    const apx = i01x.approved;
    ok("P4-I-01-exhausted-approve", apx !== null && apx.status === "approved" && apx.disposition === "indeterminate", `approved indeterminate (refusal: ${apx?.refusal})`);
    ok("P4-I-01-exhausted-downstream", apx?.downstreamUse !== null && apx.downstreamUse.usableInValuation === false && apx.downstreamUse.paAmbAccept === "N" && apx.downstreamUse.valueCents === null, `approved downstreamUse=${JSON.stringify(apx?.downstreamUse)}`);
    assertBooted(errors, failedRequests);
  } finally {
    await browser.close();
  }

  // --- P5: population through the in-page engine ----------------------------
  ctx = await openApp();
  browser = ctx.browser; page = ctx.page; errors = ctx.errors; failedRequests = ctx.failedRequests;
  let pop = null;
  try {
    await page.waitForSelector("#pa-amb-app");
    assertBooted(errors, failedRequests);
    await page.locator("#demo-button").click();
    pop = await page.evaluate(drive, { name: "population" });
    assertBooted(errors, failedRequests);
  } finally {
    await browser.close();
  }
  const browserRows = pop.rows;
  const nodeByKey = new Map(NODE_POP.rows.map((r) => [r.key, r]));
  let mismatchCount = 0;
  const mismatchSample = [];
  for (const b of browserRows) {
    const n = nodeByKey.get(b.key);
    if (!n) { mismatchCount += 1; mismatchSample.push(`${b.key}: missing in Node dump`); continue; }
    const diffs = [];
    if (b.reconMinor !== n.reconMinor) diffs.push(`recon ${b.reconMinor}!=${n.reconMinor}`);
    if (b.recordedMinor !== n.recordedMinor) diffs.push(`recorded ${b.recordedMinor}!=${n.recordedMinor}`);
    if (b.deltaMinor !== n.deltaMinor) diffs.push(`delta ${b.deltaMinor}!=${n.deltaMinor}`);
    if (b.outcomeKind !== n.outcomeKind) diffs.push(`kind ${b.outcomeKind}!=${n.outcomeKind}`);
    if (b.recordedPosition !== n.recordedPosition) diffs.push(`pos ${b.recordedPosition}!=${n.recordedPosition}`);
    if (b.boundsMin !== n.boundsMin) diffs.push(`min ${b.boundsMin}!=${n.boundsMin}`);
    if (b.boundsMax !== n.boundsMax) diffs.push(`max ${b.boundsMax}!=${n.boundsMax}`);
    if (diffs.length > 0) {
      mismatchCount += 1;
      if (mismatchSample.length < 10) mismatchSample.push(`${b.key} (${b.cohort}): ${diffs.join("; ")}`);
    }
  }
  ok("P5-pop-n", browserRows.length === 1000, `browser computed ${browserRows.length} participants in ${pop.ms} ms`);
  ok("P5-pop-agrees-node", mismatchCount === 0, mismatchCount === 0 ? "all 1,000 browser rows match Node exactly (recon/recorded/Δ/kind/bounds)" : `${mismatchCount} mismatches; e.g. ${mismatchSample.join(" | ")}`);
  // Robust-z screen (population.test.ts method) on the browser deltas.
  const median = (vals) => {
    const s = [...vals].sort((a, b) => a - b);
    const n = s.length, mid = s[Math.floor(n / 2)];
    return n % 2 === 1 ? mid : (s[n / 2 - 1] + mid) / 2;
  };
  const exactRows = browserRows.filter((r) => r.outcomeKind === "exact" && r.deltaMinor !== null);
  const deltas = exactRows.map((r) => r.deltaMinor);
  const med = median(deltas);
  const mad = median(deltas.map((d) => Math.abs(d - med)));
  const flagged = exactRows.filter((r) => { const z = (0.6745 * (r.deltaMinor - med)) / mad; return z < -3.5 || z > 3.5; });
  const flaggedByCohort = {};
  for (const r of flagged) flaggedByCohort[r.cohort] = (flaggedByCohort[r.cohort] ?? 0) + 1;
  ok("P5-pop-outliers-400", flagged.length === 400 && flaggedByCohort.service === 150 && flaggedByCohort.averaging === 150 && flaggedByCohort.vesting === 100, `flagged=${flagged.length} (service ${flaggedByCohort.service}, averaging ${flaggedByCohort.averaging}, vesting ${flaggedByCohort.vesting}); medianΔ=${med}, MAD=${mad}; clean/rounding/missing cohorts: 0 flagged`);
  const nodeFlagged = new Set(NODE_POP.flaggedKeys);
  const browserFlagged = new Set(flagged.map((r) => r.key));
  const flagDiff = [...browserFlagged].filter((k) => !nodeFlagged.has(k)).concat([...nodeFlagged].filter((k) => !browserFlagged.has(k)));
  ok("P5-pop-flags-agree-node", flagDiff.length === 0, flagDiff.length === 0 ? "browser flag set identical to Node flag set (400 keys)" : `${flagDiff.length} flag differences: ${flagDiff.slice(0, 5).join(",")}`);
  // Browser recommended dispositions vs the Node oracle (which runs the
  // same four counterfactuals per row and ranks them with cohort
  // resolve rates — population.test.ts). Stage 7 G-ACC-4: the driver
  // now does the same through the exposed App.testCounterfactual, and
  // the engine promotes a Plausible counterfactual to Supported on
  // cohort-wide resolution and reads the reconstruction as the corrected
  // value when the counterfactual reproduces the recorded amount — so
  // browser and Node must agree on every exact cohort. (The
  // bounds-inside divergence is separate and stays: the oracle is a
  // test-local simplification that ignores bound width; the engine
  // applies the documented §4.7 width-vs-materiality rule.)
  const recByCohort = {};
  for (const b of browserRows) {
    if (b.outcomeKind !== "exact") continue;
    recByCohort[b.cohort] = recByCohort[b.cohort] ?? {};
    recByCohort[b.cohort][b.recommended] = (recByCohort[b.cohort][b.recommended] ?? 0) + 1;
  }
  const oracle = { clean: "verified", service: "correction-recommended", averaging: "correction-recommended", rounding: "verified", vesting: "requires-investigation" };
  const recLines = Object.entries(recByCohort).map(([c, m]) => `${c}: ${JSON.stringify(m)} (Node oracle: ${oracle[c]})`).join("; ");
  const oracleCounts = { clean: 400, service: 150, averaging: 150, rounding: 100, vesting: 100 };
  const recMatchesOracle = Object.entries(oracle).every(([c, d]) => Object.keys(recByCohort[c] ?? {}).length === 1 && recByCohort[c][d] === oracleCounts[c]);
  ok("P5-pop-recommended-vs-oracle", recMatchesOracle, `browser reconcile recommendations agree with the Node oracle — ${recLines}`);

  writeFileSync(join(DIR, "04-accuracy-browser-results.json"), JSON.stringify({ results, population: { ms: pop.ms, medianDelta: med, mad, flaggedTotal: flagged.length, flaggedByCohort, recommendedByCohort: recByCohort } }, null, 2));
  console.log(`\nACCURACY BROWSER: ${results.filter((r) => r.pass).length}/${results.length} checks passed.`);
  if (failures.length > 0) {
    console.error(`FAILURES: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`FAIL accuracy-browser: ${err.message}`);
  process.exit(1);
});
