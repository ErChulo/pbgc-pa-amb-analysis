// Stage 6 — wizard end-to-end (Worker E).
//
// Opens pa-amb-analysis.html via file:// and runs the wizard on the
// synthetic Harborview demo case (case 00098765, six SYN- participants):
// Import demo -> Validate (66 rules) -> Calculate -> Reconcile ->
// Review statistics -> Decide (recommend all six, human-approve
// SYN-001) -> Export (CSV + XLSX + JSON contribution downloads).
// Asserts each step unlocks in order and a locked step says why.
//
// The driver runs inside the page against the app's own public API
// (window.PaAmbApp + window.__paAmbHandle): the pure step helpers
// (runValidation / runCalculation / runReconciliation / runStatistics /
// dispatchDisposition / publishContribution) compute each step, and the
// results are applied through the handle's dispatch, exactly as the
// app's own buttons do — so the DOM, the locks, and the rendered
// charts/reports are all exercised. Step-input builders mirror
// test/demo.test.ts (the Node end-to-end driver for the same demo
// case); nothing is invented, and no live data is used.

import { readFileSync } from "node:fs";
import {
  openApp,
  assertBooted,
  check,
  stepButton,
  wizardState,
} from "./helpers.mjs";

const ACTOR = "A. Actuary";
const TS = "2026-11-12T00:00:00.000Z";

/**
 * Self-contained in-page driver. Playwright serializes this function,
 * so every helper it uses is defined inside it; it touches only
 * window.PaAmbApp and window.__paAmbHandle.
 */
function drive(action) {
  const App = window.PaAmbApp;
  const handle = window.__paAmbHandle;
  const pkg = () => handle.getState().casePackage;
  const must = (v, what) => {
    if (v === undefined || v === null) throw new Error(what + " is missing");
    return v;
  };
  const keys = () =>
    pkg().participants.map((p) => p.participantKey);
  const recordedMinor = (key) => {
    const obs = must(
      pkg().benefitObservations.find((o) => o.participantKey === key),
      "observation for " + key,
    );
    return obs.paAmb.value === null ? null : obs.paAmb.value.amountMinor;
  };
  const doteOf = (key) => {
    const obs = must(
      pkg().benefitObservations.find((o) => o.participantKey === key),
      "observation for " + key,
    );
    return obs.measurementDate;
  };
  const ageAt = (dob, date) => {
    const years = Number(date.slice(0, 4)) - Number(dob.slice(0, 4));
    return date.slice(5) < dob.slice(5) ? years - 1 : years;
  };
  const nrdOf = (dob) => `${Number(dob.slice(0, 4)) + 65}${dob.slice(4)}`;

  // --- validation input, mapped from the demo package (mirrors test/demo.test.ts)
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
    const meanAnnualMinor =
      knownSalaries.length === 0
        ? null
        : Math.round(knownSalaries.reduce((s, x) => s + (x.amount?.amountMinor ?? 0), 0) / knownSalaries.length);
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

  // --- pipeline inputs (formula T-04, 1.5%, final-3-year; mirrors test/demo.test.ts)
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
      configId: "rc-demo", version: "rounding-config v1.0.0",
      planVersionId: "pv-demo-1985",
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
      calculationKind: "accrued", formulaId: "T-04", roundingConfig: roundingConfig(),
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

  // --- disposition evidence (mirrors test/demo.test.ts decideEvidence)
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
  function decideEvidence(key, outcome) {
    const base = baseEvidence(key);
    if (key === "SYN-001") {
      return { ...base, reconstructedMinor: 150000, deltaMinor: 0, withinTolerance: true, hypotheses: [{ code: "H2", supportClass: "refuted", material: true }] };
    }
    if (key === "SYN-V-01") {
      return { ...base, reconstructedMinor: 84950, deltaMinor: 50, withinTolerance: true, hypotheses: [{ code: "H15", supportClass: "supported", material: true }] };
    }
    if (key === "SYN-003") {
      return { ...base, reconstructedMinor: 150000, deltaMinor: 100000, withinTolerance: false, hypotheses: [{ code: "H2", supportClass: "proposed", material: true }], nextSteps: ["Ask the prior administrator for the workpaper behind $2,500.00."] };
    }
    if (key === "SYN-002") {
      return { ...base, completenessGrade: "partial", boundsMinor: { min: 158400, max: 168300 }, boundWidthMaterial: true, missingEvidence: [{ input: "CompensationHistory.salaryYear 2020", missingClass: "M3", decisionImpact: "Resolving it narrows the bounds by $99.00 and could move the disposition.", uncertaintyContributionMinor: 9900 }], nextSteps: ["Obtain compensation year 2020 from the prior administrator."] };
    }
    if (key === "SYN-004") {
      return { ...base, completenessGrade: "partial", boundsMinor: { min: 90000, max: 96000 }, boundWidthMaterial: true, missingEvidence: [{ input: "CompensationHistory.salaryYear 2020", missingClass: "M3", decisionImpact: "Resolving it narrows the bounds by $60.00 and could move the disposition.", uncertaintyContributionMinor: 6000 }], nextSteps: ["Obtain compensation year 2020 from the prior administrator."] };
    }
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

  const TS = "2026-11-12T00:00:00.000Z";
  const dispatch = (event) => handle.dispatch(event);
  const state = () => handle.getState();

  if (action.name === "validate") {
    const next = App.runValidation(state(), keys().map(toValidationParticipant), validationContext(), "demo", TS);
    dispatch({ kind: "validation-completed", result: next.validation, actor: "demo", occurredAt: TS });
    return {
      participantResults: next.validation.participantResults.length,
      rulesEvaluated: next.validation.summary.rulesEvaluated,
      findings: next.validation.allFindings.length,
    };
  }

  if (action.name === "calculate") {
    const outcomes = {};
    for (const key of keys()) {
      const { outcome } = App.runCalculation(state(), buildRequest(key), buildInputs(key), "demo", TS);
      dispatch({ kind: "calculation-completed", participantKey: key, outcome, actor: "demo", occurredAt: TS });
      outcomes[key] = {
        kind: outcome.kind,
        minor: outcome.kind === "exact" ? outcome.benefit.amount?.amountMinor ?? null : null,
        bounds: outcome.kind === "bounds" ? { min: outcome.bounds.min.amountMinor, max: outcome.bounds.max.amountMinor, recordedPosition: outcome.bounds.recordedPosition } : null,
        reason: outcome.kind === "indeterminate" ? outcome.reason.code : null,
      };
    }
    return outcomes;
  }

  if (action.name === "reconcile") {
    const config = {
      epsilonRMinor: 100,
      epsilonRSource: "Demo case actuary, set for this demo case only",
      materialityMinor: 100,
      materialitySource: "Demo case tolerance v1 ($1.00)",
    };
    const out = {};
    for (const key of keys()) {
      const outcome = state().calculations[key];
      const inputs = App.buildReconciliationInputs({
        outcome,
        recorded: recordedBenefit(key),
        toleranceApplied: App.DEMO_TOLERANCE,
        comparisonBasis: outcome.kind === "indeterminate" ? "unresolved" : "basis-converted",
        basisConversion: outcome.kind === "indeterminate" ? undefined : "vesting",
      });
      const next = App.runReconciliation(state(), key, inputs, config, "demo", TS);
      const rec = next.reconciliations[key];
      dispatch({ kind: "reconciliation-completed", reconciliation: rec, actor: "demo", occurredAt: TS });
      out[key] = {
        comparable: rec.comparison.comparable,
        delta: rec.comparison.comparable ? rec.comparison.delta.amountMinor : null,
        toleranceVerdict: rec.toleranceVerdict,
        recommended: rec.recommendedDisposition,
      };
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
        participantKey: key,
        // Recorded retstat code ("2") as the status string; the demo
        // package carries no status label, and none is coined here.
        status: p.retstat.value,
        employmentGroup: null, formulaType: "unit-credit", amendmentCohort: null,
        paAmbMinor: recordedMinor(key),
        reconstructedMinor: rec.reconstructed?.amount?.amountMinor ?? null,
        deltaMinor: rec.comparison.comparable ? rec.comparison.delta.amountMinor : null,
        absDeltaMinor: rec.comparison.comparable ? rec.comparison.absDelta.amountMinor : null,
        relDelta: rec.comparison.comparable && rec.comparison.relative.kind === "defined" ? rec.comparison.relative.value : null,
        denominatorFlag: rec.comparison.comparable ? rec.comparison.denominatorFlag : null,
        ageYears: dote === null ? null : ageAt(must(p.dob.value, "dob"), dote),
        serviceYears: sh.paCreditedService.value,
        compensationMinor: meanAnnual,
        retirementStatus: p.retstat.value,
        dataCompleteness: null,
        monthsSinceRecorded: dote === null ? null : 80,
        qdro: false, priorDistribution: false,
        employmentPeriods: pkg().employmentPeriods.filter((e) => e.participantKey === key).length,
      };
    });
    const thresholds = { absMinor: 100, relDecimal: "0.01", source: "case tolerance record v1" };
    const next = App.runStatistics(state(), rows, thresholds, "demo", TS);
    dispatch({ kind: "statistics-completed", population: next.statistics, outliers: next.statisticsOutliers, actor: "demo", occurredAt: TS });
    return {
      populationN: next.statistics.pooled.n,
      excluded: next.statistics.excludedFromDiscrepancy,
      flags: (next.statisticsOutliers?.flags ?? []).map((f) => ({ key: f.participantKey, method: f.method, score: f.score })),
      explainedByGroup: next.statisticsOutliers?.explainedByGroup.length ?? 0,
    };
  }

  if (action.name === "decide") {
    const out = {};
    for (const key of keys()) {
      const outcome = state().calculations[key];
      const evidence = decideEvidence(key, outcome);
      const { recommendation, entry } = App.dispositionEntryInput(evidence);
      dispatch({ kind: "evidence-recorded", participantKey: key, evidence: entry, actor: "demo", occurredAt: TS });
      const before = state().analysis.participants[key].disposition;
      dispatch({
        kind: "analysis-event",
        event: {
          kind: "user-action",
          eventId: `ui-propose-${key}-fixed`,
          actor: "system",
          occurredAt: TS,
          action: "propose-disposition",
          participantKey: key,
          dispositionEvent: { kind: "propose", actor: "system", target: recommendation.disposition, evidenceChanged: true },
        },
      });
      const after = state().analysis.participants[key].disposition;
      out[key] = {
        recommended: recommendation.disposition,
        status: after === null ? null : after.status,
        refusal: state().lastRefusal,
        wasNull: before === null,
      };
    }
    return out;
  }

  if (action.name === "approve") {
    const key = "SYN-001";
    const current = state().analysis.participants[key].disposition;
    if (current === null) throw new Error("SYN-001 has no recommended disposition to approve");
    const determination = {
      determinationId: "det-demo-1",
      dispositionId: current.dispositionId,
      participantKey: key,
      caseId: "case-demo",
      schemaVersion: "1.0.0",
      createdAt: "2026-11-12",
      createdBy: "A. Actuary",
      recordedBenefit: { amountCents: 150000, isBlank: false, sourceScheduleRef: "Demo census row 1", recordedDate: "2020-03-15" },
      calculatedBenefit: { amountCents: 150000, calculationId: "calc-demo-1", calculationStatus: "complete", boundsCents: null, noBoundsReason: null, correctedBenefitCents: null },
      comparisonBasis: { basis: "established", measurementDate: "2020-02-29", retirementBasis: "NRD 2027-03-14", annuityForm: "NSF", vestingTreatment: "vested", planVersionIds: ["pv-demo-1985"], comparisonBasisState: "basis-converted", toleranceSetId: "tol-demo", deltaCents: 0, withinTolerance: true },
      differencesAndExplanations: {
        deltaCents: 0, absDeltaCents: 0, relDelta: 0, denominatorFlag: "ok",
        hypotheses: [{ id: "hyp-demo-1", version: 1, supersedesId: null, sourceRecordIds: [], createdDate: "2026-11-12", createdBy: "system", hypothesisId: "H2-1", comparisonId: "cmp-demo-1", hypothesisType: "service", counterfactual: "service +1 year gives $1,575, service -1 year gives $1,425; neither matches the recorded $1,500", counterfactualCalculationId: "calc-demo-2", evidence: [], rank: 1, status: "tested-rejected" }],
        leadingExplanation: "Independent calculation agrees exactly with the recorded benefit; the service counterfactuals are refuted.",
      },
      missingEvidence: [],
      materialAssumptions: [],
      sensitivityAndUncertainty: { scenarios: [], dispositionSensitivity: "No missing input; no disposition sensitivity.", uncertaintyAttribution: [], statisticalNotes: null },
      supportingDocuments: [{ documentId: "doc-demo-census", citation: "Synthetic plan §5.01 (demo)", whatItSupports: "unit-credit formula, 1.5% accrual rate, final-3-year average" }],
      recommendedDisposition: { disposition: "verified", recommendedBy: "system", recommendedAt: "2026-11-12", recommendationRationale: "Independent calculation agrees exactly with the recorded benefit." },
      humanDetermination: {
        disposition: "verified",
        rationale: "Independent reconstruction $1,500.00; recorded $1,500.00; exact agreement on the same basis; no other discrepancy.",
        reviewer: "A. Actuary", reviewerRole: "case actuary",
        determinationDate: "2026-11-12", approvalId: null,
      },
      dataRequests: [],
      downstream: { usableInValuation: true, valueCents: 150000, valueKind: "recorded", paAmbAccept: "Y" },
      contentHash: "content-hash-demo-1",
    };
    const approval = {
      approvalId: "appr-demo-1",
      reviewer: "A. Actuary",
      reviewerRole: "case actuary",
      rationale: "Independent reconstruction $1,500.00; recorded $1,500.00; exact agreement on the same basis; no other discrepancy.",
      approvalDate: "2026-11-12",
      evidenceSnapshot: {
        snapshotId: "snap-demo-1",
        inputSnapshotHash: state().analysis.inputSnapshot.snapshotHash,
        calculationRunId: "run-demo-1",
        ruleVersion: state().analysis.ruleVersions.validationRules,
        toleranceSetId: "tol-demo",
        dispositionSchemaVersion: "1.0.0",
        determinationId: "det-demo-1",
        sourceDocumentIds: ["doc-demo-census"],
        calculationTraceHash: "trace-demo-1",
        boundsAssumptionsHash: null,
      },
      confirmations: { entryConditionsHold: true, determinationComplete: true, toleranceIdentified: true, noMaterialUnexplainedItem: true },
    };
    dispatch({
      kind: "analysis-event",
      event: {
        kind: "user-action",
        eventId: `ui-approve-${key}-fixed`,
        actor: "A. Actuary",
        occurredAt: TS,
        action: "approve-disposition",
        participantKey: key,
        dispositionEvent: { kind: "approve", actor: "A. Actuary", determination, approval },
      },
    });
    const after = state().analysis.participants[key].disposition;
    return { status: after === null ? null : after.status, disposition: after === null ? null : after.disposition, refusal: state().lastRefusal };
  }

  if (action.name === "publish") {
    const run = {
      id: "run-demo-1", version: 1, supersedesId: null, sourceRecordIds: [],
      createdDate: "2026-11-12", createdBy: "demo",
      runId: "run-demo-1", caseId: "case-demo", ruleVersion: "0.1.0",
      inputSnapshot: { snapshotHash: "demo-synthetic-no-file", importIds: [], entityVersions: [], planVersionIds: [{ planVersionId: "pv-demo-1985", version: 1 }] },
      inputSnapshotHash: "demo-synthetic-no-file", runDate: "2026-11-12",
      runBy: "demo", participantScope: "all demo participants",
      resultsHash: "demo", engineVersion: "0.1.0",
      participantsComputed: 6, participantsChanged: [],
    };
    const log = App.buildPublishedLog({
      run, outcome: state().calculations["SYN-001"], validations: [],
      determination: null, evidence: [], productVersion: "0.1.0",
    });
    const { contribution } = App.publishContribution(
      state(), log,
      { caseId: "case-demo", productVersion: "0.1.0", producedAt: TS, publishedBy: "demo", run },
      "demo", TS,
    );
    dispatch({ kind: "contribution-published", contribution, actor: "demo", occurredAt: TS });
    return { findings: log.findings.length, fragments: contribution.fragments.length, protocol: "0.1.0" };
  }

  if (action.name === "state") {
    const s = state();
    return {
      wizard: s.wizard,
      dispositions: Object.fromEntries(
        Object.entries(s.analysis.participants).map(([k, p]) => [
          k, p.disposition === null ? null : `${p.disposition.disposition}/${p.disposition.status}`,
        ]),
      ),
      lastRefusal: s.lastRefusal,
      charts: document.getElementById("chart-area")?.innerHTML.length ?? 0,
      reportHasCase: (document.getElementById("report-area")?.textContent ?? "").includes("00098765"),
    };
  }

  throw new Error("unknown drive action: " + action.name);
}

async function main() {
  const { browser, page, errors, failedRequests } = await openApp();
  try {
    await page.waitForSelector("#pa-amb-app");
    assertBooted(errors, failedRequests);

    // --- Before import: only Import is open; every later step is locked and says why.
    let ws = await wizardState(page);
    check(ws.currentStep === "import", `expected step import, got ${ws.currentStep}`);
    check(ws.participantCount === 0, "expected no participants before import");
    const lockedReasons = {
      validate: "Import a case first.",
      calculate: "Validate the case first.",
      reconcile: "Calculate benefits first.",
      statistics: "Reconcile participants first.",
      decide: "Review statistics first.",
      export: "Decide dispositions first. A case with unassessed participants cannot close.",
    };
    for (const [step, reason] of Object.entries(lockedReasons)) {
      const btn = stepButton(page, step);
      check(await btn.isDisabled(), `${step} button should be disabled before import`);
      check((await btn.getAttribute("title")) === reason, `${step} lock reason should be "${reason}"`);
    }
    check(!(await stepButton(page, "import").isDisabled()), "import button should be enabled");
    // A locked navigation is refused and recorded, and the step does not move.
    const refusal = await page.evaluate(() => {
      const handle = window.__paAmbHandle;
      handle.dispatch({ kind: "wizard-go-to", step: "validate", actor: "demo", occurredAt: "2026-11-12T00:00:00.000Z" });
      const s = handle.getState();
      return { step: s.wizard.currentStep, refusal: s.lastRefusal };
    });
    check(refusal.step === "import", "locked go-to must not move the wizard");
    check(refusal.refusal === "Import a case first.", `locked go-to refusal should name the missing input, got ${refusal.refusal}`);

    // --- 1. Import: the demo button loads the Harborview demo case.
    await page.locator("#demo-button").click();
    ws = await wizardState(page);
    check(ws.completed.import === true, "import step should complete after demo load");
    check(ws.participantCount === 6, `expected 6 demo participants, got ${ws.participantCount}`);
    check(ws.statusLine.includes("6 participants"), "status line should show 6 participants");
    check(!(await stepButton(page, "validate").isDisabled()), "validate should unlock after import");
    check(await stepButton(page, "calculate").isDisabled(), "calculate should still be locked after import");

    // --- 2. Validate: 66 rules over the demo case.
    const validation = await page.evaluate(drive, { name: "validate" });
    check(validation.participantResults === 6, `expected 6 validation results, got ${validation.participantResults}`);
    check(validation.rulesEvaluated > 0, "validation should evaluate rules");
    ws = await wizardState(page);
    check(ws.completed.validate === true, "validate step should complete");
    check(!(await stepButton(page, "calculate").isDisabled()), "calculate should unlock after validate");

    // --- 3. Calculate: exact / bounds / indeterminate outcomes.
    const outcomes = await page.evaluate(drive, { name: "calculate" });
    check(outcomes["SYN-001"].kind === "exact" && outcomes["SYN-001"].minor === 150000, "SYN-001 should calculate to exact $1,500.00");
    check(outcomes["SYN-V-01"].kind === "exact" && outcomes["SYN-V-01"].minor === 84950, "SYN-V-01 should calculate to exact $849.50");
    check(outcomes["SYN-003"].kind === "exact" && outcomes["SYN-003"].minor === 150000, "SYN-003 should reconstruct to $1,500.00");
    check(outcomes["SYN-002"].kind === "bounds" && outcomes["SYN-002"].bounds.min === 158400 && outcomes["SYN-002"].bounds.max === 168300, "SYN-002 bounds should be $1,584-$1,683");
    check(outcomes["SYN-004"].kind === "bounds" && outcomes["SYN-004"].bounds.min === 90000 && outcomes["SYN-004"].bounds.max === 96000, "SYN-004 bounds should be $900-$960");
    check(outcomes["SYN-I-01"].kind === "indeterminate" && outcomes["SYN-I-01"].reason === "unresolved-comparison-basis", "SYN-I-01 should be indeterminate (DOTE blank)");
    ws = await wizardState(page);
    check(ws.completed.calculate === true, "calculate step should complete");

    // --- 4. Reconcile: deltas and tolerance verdicts.
    const recon = await page.evaluate(drive, { name: "reconcile" });
    check(recon["SYN-001"].delta === 0 && recon["SYN-001"].toleranceVerdict === "within-tolerance", "SYN-001 delta should be 0, within tolerance");
    check(recon["SYN-003"].delta === 100000 && recon["SYN-003"].toleranceVerdict === "outside-tolerance", "SYN-003 delta should be $1,000.00, outside tolerance");
    check(recon["SYN-V-01"].delta === 50, "SYN-V-01 delta should be $0.50");
    check(recon["SYN-I-01"].comparable === false, "SYN-I-01 should not be comparable (no basis)");
    check(recon["SYN-001"].recommended === "verified", "SYN-001 recommended disposition should be verified");
    check(recon["SYN-003"].recommended === "requires-investigation", "SYN-003 recommended disposition should be requires-investigation");
    check(recon["SYN-I-01"].recommended === "indeterminate", "SYN-I-01 recommended disposition should be indeterminate");
    ws = await wizardState(page);
    check(ws.completed.reconcile === true, "reconcile step should complete");

    // --- 5. Review statistics: outlier screen flags SYN-003; charts + report render.
    const stats = await page.evaluate(drive, { name: "statistics" });
    check(stats.populationN === 6, `statistics population should be 6, got ${stats.populationN}`);
    // SYN-003 is the modified-z outlier (score ~1348 vs threshold 3.5).
    // With only three comparable deltas the percentile screen also flags
    // the extremes (SYN-001 at 0 and SYN-003 at the top) — that is the
    // engine's stated behaviour on a tiny population, not an error, so
    // the assertion is on the modified-z method, not on "flagged at all".
    check(stats.flags.some((f) => f.key === "SYN-003" && f.method === "modified-z"), `outlier screen should flag SYN-003 by modified-z, got ${JSON.stringify(stats.flags)}`);
    check(!stats.flags.some((f) => f.key === "SYN-001" && f.method === "modified-z"), "outlier screen should not flag SYN-001 by modified-z");
    ws = await wizardState(page);
    check(ws.completed.statistics === true, "statistics step should complete");
    check((await page.locator("#chart-area svg").count()) > 0, "charts should render after statistics");
    const reportText = await page.locator("#report-area").textContent();
    check(reportText.includes("00098765"), "plan report should name the demo case");

    // --- 6. Decide: recommend all six; a human approves SYN-001.
    const decided = await page.evaluate(drive, { name: "decide" });
    check(decided["SYN-001"].recommended === "verified" && decided["SYN-001"].status === "recommended", "SYN-001 should be recommended verified");
    check(decided["SYN-002"].recommended === "requires-investigation" && decided["SYN-002"].status === "recommended", "SYN-002 should be recommended requires-investigation");
    check(decided["SYN-004"].recommended === "requires-investigation", "SYN-004 should be recommended requires-investigation");
    check(decided["SYN-003"].recommended === "requires-investigation", "SYN-003 should be recommended requires-investigation");
    check(decided["SYN-V-01"].recommended === "verified", "SYN-V-01 should be recommended verified");
    check(decided["SYN-I-01"].recommended === "indeterminate" && decided["SYN-I-01"].status === "recommended", "SYN-I-01 should be recommended indeterminate");
    for (const [key, d] of Object.entries(decided)) {
      check(d.refusal === null, `${key} propose should not be refused, got: ${d.refusal}`);
    }
    const approved = await page.evaluate(drive, { name: "approve" });
    check(approved.status === "approved" && approved.disposition === "verified", `SYN-001 should be approved verified by the human reviewer, got ${approved.status}/${approved.disposition}: ${approved.refusal}`);
    ws = await wizardState(page);
    check(ws.completed.decide === true, "decide step should complete once every participant has a disposition");
    check(!(await stepButton(page, "export").isDisabled()), "export should unlock after decide");

    // --- 7. Export: publish the contribution, then download CSV + XLSX + JSON.
    const published = await page.evaluate(drive, { name: "publish" });
    check(published.findings > 0, "published log should carry findings");
    ws = await wizardState(page);
    check(ws.completed.export === true, "export step should complete after publishing");
    // Navigate to the Export step so its panel (and download buttons) show.
    await stepButton(page, "export").click();
    ws = await wizardState(page);
    check(ws.currentStep === "export", `wizard should be on export, got ${ws.currentStep}`);
    check(await page.locator("#export-reconciliation-csv").isVisible(), "CSV download button should be visible on the Export step");
    await page.evaluate(() => {
      window.confirm = () => true;
    });
    async function download(buttonId) {
      const [dl] = await Promise.all([
        page.waitForEvent("download", { timeout: 10000 }),
        page.locator(buttonId).click(),
      ]);
      return { filename: dl.suggestedFilename(), path: await dl.path() };
    }
    const csv = await download("#export-reconciliation-csv");
    check(csv.filename === "00098765-reconciliation.csv", `CSV filename should be 00098765-reconciliation.csv, got ${csv.filename}`);
    const csvText = readFileSync(csv.path, "utf8");
    check(csvText.includes("participantKey,recordedMinor"), "CSV should carry the reconciliation header");
    for (const key of ["SYN-001", "SYN-002", "SYN-003", "SYN-004", "SYN-V-01", "SYN-I-01"]) {
      check(csvText.includes(key), `CSV should include ${key}`);
    }
    check(csvText.includes("100000"), "CSV should include the SYN-003 delta of 100000 minor units");
    const xlsx = await download("#export-reconciliation-xlsx");
    check(xlsx.filename === "00098765-reconciliation.xlsx", `XLSX filename should be 00098765-reconciliation.xlsx, got ${xlsx.filename}`);
    const xlsxBytes = readFileSync(xlsx.path);
    check(xlsxBytes.subarray(0, 4).toString("latin1") === "PK\u0003\u0004", "XLSX should start with the ZIP magic PK");
    check(xlsxBytes.includes(Buffer.from("Reconciliation")), "XLSX should contain the Reconciliation sheet");
    check(xlsxBytes.includes(Buffer.from("SYN-003")), "XLSX should contain SYN-003");
    const json = await download("#export-contribution");
    check(json.filename === "00098765-amb-contribution.json", `contribution filename should be 00098765-amb-contribution.json, got ${json.filename}`);
    const contribution = JSON.parse(readFileSync(json.path, "utf8"));
    check(contribution.contributionProtocolVersion === "0.1.0", "contribution package should carry protocol v0.1.0");
    check(Array.isArray(contribution.findings) && contribution.findings.length > 0, "contribution package should carry findings");
    check(contribution.caseId === "case-demo", "contribution package should name the demo case");
    const audit = await download("#export-audit-log");
    const auditText = readFileSync(audit.path, "utf8");
    const auditLog = JSON.parse(auditText);
    check(Array.isArray(auditLog) && auditLog.length > 0, "audit log download should carry events");

    const finalState = await page.evaluate(drive, { name: "state" });
    check(finalState.dispositions["SYN-001"] === "verified/approved", `final SYN-001 should be verified/approved, got ${finalState.dispositions["SYN-001"]}`);
    check(finalState.reportHasCase, "final report area should still name the demo case");
    assertBooted(errors, failedRequests);
    console.log(
      `PASS wizard-flow: validate ${validation.rulesEvaluated} rules / ${validation.findings} findings; ` +
        `calculate exact SYN-001 $1,500.00, SYN-V-01 $849.50; reconcile SYN-003 delta $1,000.00; ` +
        `statistics flagged ${stats.flags.map((f) => f.key).join(",") || "none"}; ` +
        `decide verified/approved SYN-001; export CSV ${csv.filename}, XLSX ${xlsx.filename}, JSON ${json.filename}, audit ${auditLog.length} events.`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`FAIL wizard-flow: ${err.message}`);
  process.exit(1);
});
