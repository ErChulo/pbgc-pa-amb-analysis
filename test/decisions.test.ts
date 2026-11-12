/**
 * Unit tests for src/decisions.ts and src/determination.ts — the decision
 * state machine (T1–T12), the human approval gate, invalidation on
 * source/rule change, Indeterminate as a terminal outcome, valuation
 * permission, DeterminationRecord completeness, and the §17 case state.
 *
 * Run with plain node + node:test (no test framework dependency):
 *   npm test            (builds with tsc, then runs node --test dist/test/)
 *
 * Synthetic data only. No live case data. The worked examples are the
 * fictional participants SYN-V-01 (Verified) and SYN-I-01 (Indeterminate)
 * from Stage 2 output 05, §8.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyCaseEvent,
  checkEntryConditions,
  checkRunCompleteness,
  computeAffectedSet,
  downstreamUseFor,
  identifyTransition,
  indeterminateApprovable,
  transition,
  GUARD_CATALOGUE,
} from "../src/decisions.js";
import type {
  AnalysisEvent,
  CaseAnalysisState,
  DispositionRecord,
  EntryCheckInput,
  IndeterminateContent,
  ParticipantAnalysis,
  TransitionContext,
} from "../src/decisions.js";
import {
  approveDetermination,
  checkDeterminationCompleteness,
  checkDownstreamConsistency,
} from "../src/determination.js";
import type {
  DeterminationApprovalInput,
  DeterminationRecord,
} from "../src/determination.js";
import { decMultiply, decRound, makeMoney } from "../src/decimal.js";
import type { DiagnosticHypothesis } from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixtures — SYN-V-01 (Verified) evidence and determination
// ---------------------------------------------------------------------------

function verifiedEvidence(overrides: Partial<EntryCheckInput> = {}): EntryCheckInput {
  return {
    completenessGrade: "complete",
    comparisonBasis: "established",
    reconstructedBenefitCents: 84950,
    boundsCents: null,
    deltaCents: 50,
    withinTolerance: true,
    toleranceSetId: "tol-1",
    hypotheses: [
      { code: "H15", supportClass: "supported", material: true },
      { code: "H12", supportClass: "refuted", material: true },
    ],
    blockingValidationOutstanding: false,
    boundWidthMaterial: false,
    boundWidthJustification: null,
    missingEvidence: [],
    nextSteps: [],
    correctedBenefitCents: null,
    correctionReasonablyCertain: false,
    correctionDirection: null,
    recordedBenefitCents: 85000,
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

function makeCtx(
  evidence: EntryCheckInput,
  overrides: Partial<TransitionContext> = {},
): TransitionContext {
  return {
    participantKey: "SYN-V-01",
    caseId: "00000001",
    evidence,
    inputSnapshotHash: "hash-1",
    ruleVersion: "validation-rules v1.0.0",
    occurredAt: "2026-11-12",
    newDispositionId: "disp-2",
    auditEventId: "audit-2",
    calculationRunId: "run-1",
    ...overrides,
  };
}

function makeHypothesis(): DiagnosticHypothesis {
  return {
    id: "hyp-1",
    version: 1,
    supersedesId: null,
    sourceRecordIds: [],
    createdDate: "2026-11-12",
    createdBy: "system",
    hypothesisId: "H15-1",
    comparisonId: "cmp-1",
    hypothesisType: "rounding",
    counterfactual: "final monthly benefit rounded to nearest dollar per plan §7.3",
    counterfactualCalculationId: "calc-2",
    evidence: [],
    rank: 1,
    status: "tested-supported",
  };
}

function makeVerifiedDetermination(): DeterminationRecord {
  return {
    determinationId: "det-1",
    dispositionId: "disp-1",
    participantKey: "SYN-V-01",
    caseId: "00000001",
    schemaVersion: "1.0.0",
    createdAt: "2026-11-12",
    createdBy: "A. Actuary",
    recordedBenefit: {
      amountCents: 85000,
      isBlank: false,
      sourceScheduleRef: "PA schedule p. 4",
      recordedDate: "2019-07-12",
    },
    calculatedBenefit: {
      amountCents: 84950,
      calculationId: "calc-1",
      calculationStatus: "complete",
      boundsCents: null,
      noBoundsReason: null,
      correctedBenefitCents: null,
    },
    comparisonBasis: {
      basis: "established",
      measurementDate: "2019-06-30",
      retirementBasis: "NRD 2025-04-15",
      annuityForm: "NSF",
      vestingTreatment: "vested",
      planVersionIds: ["pv-1"],
      comparisonBasisState: "same-basis",
      toleranceSetId: "tol-1",
      deltaCents: 50,
      withinTolerance: true,
    },
    differencesAndExplanations: {
      deltaCents: 50,
      absDeltaCents: 50,
      relDelta: 0.0005886,
      denominatorFlag: "ok",
      hypotheses: [makeHypothesis()],
      leadingExplanation:
        "H15 rounding: plan §7.3 final-monthly rounding to the nearest dollar explains the $0.50 exactly.",
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
        citation: "Synthetic Plan A §7.3",
        whatItSupports: "final-monthly rounding to the nearest dollar",
      },
    ],
    recommendedDisposition: {
      disposition: "verified",
      recommendedBy: "system",
      recommendedAt: "2026-11-12",
      recommendationRationale:
        "Independent calculation agrees within tolerance; rounding explains the $0.50.",
    },
    humanDetermination: {
      disposition: "verified",
      rationale:
        "Independent reconstruction $849.50; recorded $850.00; $0.50 difference is the plan's documented final-monthly rounding to the nearest dollar; no other discrepancy.",
      reviewer: "A. Actuary",
      reviewerRole: "case actuary",
      determinationDate: "2026-11-12",
      approvalId: null,
    },
    dataRequests: [],
    downstream: { usableInValuation: true, valueCents: 85000, valueKind: "recorded", paAmbAccept: "Y" },
    contentHash: "content-hash-1",
  };
}

function makeApproval(
  overrides: Partial<DeterminationApprovalInput> = {},
): DeterminationApprovalInput {
  return {
    approvalId: "appr-1",
    reviewer: "A. Actuary",
    reviewerRole: "case actuary",
    rationale:
      "Independent reconstruction $849.50; recorded $850.00; $0.50 difference is the plan's documented final-monthly rounding to the nearest dollar; no other discrepancy.",
    approvalDate: "2026-11-12",
    evidenceSnapshot: {
      snapshotId: "snap-1",
      inputSnapshotHash: "hash-1",
      calculationRunId: "run-1",
      ruleVersion: "validation-rules v1.0.0",
      toleranceSetId: "tol-1",
      dispositionSchemaVersion: "1.0.0",
      determinationId: "det-1",
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

/** Propose verified (T1) and return the recommended record. */
function proposeVerified(
  evidence: EntryCheckInput = verifiedEvidence(),
  ctxOverrides: Partial<TransitionContext> = {},
): DispositionRecord {
  const outcome = transition(
    null,
    { kind: "propose", actor: "system", target: "verified", evidenceChanged: true },
    makeCtx(evidence, ctxOverrides),
  );
  assert.equal(outcome.outcome, "applied");
  if (outcome.outcome !== "applied" || outcome.record === null) {
    throw new Error("proposeVerified fixture failed");
  }
  return outcome.record;
}

// ---------------------------------------------------------------------------
// Fixtures — SYN-I-01 (Indeterminate) evidence and determination
// ---------------------------------------------------------------------------

function indeterminateContent(
  overrides: Partial<IndeterminateContent> = {},
): IndeterminateContent {
  return {
    justifiedBoundsCents: null,
    noBoundsReason:
      "Governing formula version for the participant's era cannot be identified and the measurement date is unresolved; no single bound is justifiable.",
    scenarioBounds: [
      {
        scenarioName: "1.50% formula",
        assumptions: ["pre-amendment formula 1.50% applies"],
        minCents: 150000,
        maxCents: 156000,
      },
      {
        scenarioName: "1.25% formula",
        assumptions: ["post-amendment formula 1.25% applies"],
        minCents: 125000,
        maxCents: 130000,
      },
    ],
    missingEvidence: [
      {
        input: "PA benefit schedule for this participant",
        missingClass: "M2",
        decisionImpact: "Establishes the basis; could move the participant from Indeterminate to a decidable state.",
        uncertaintyContributionCents: null,
      },
      {
        input: "plan document / amendment for the era, with adoption and effective dates",
        missingClass: "M5",
        decisionImpact: "Identifies the governing formula; collapses the two scenario ranges to one.",
        uncertaintyContributionCents: null,
      },
      {
        input: "missing compensation year",
        missingClass: "M3",
        decisionImpact: "Narrows the per-scenario bound width by up to $60.00; does not by itself change the disposition.",
        uncertaintyContributionCents: 6000,
      },
      {
        input: "annuity form and vesting treatment of B_i^PA",
        missingClass: "M1",
        decisionImpact: "Required for exact reconstruction; no source states them.",
        uncertaintyContributionCents: null,
      },
    ],
    dataRequests: [
      {
        requestId: "req-1",
        input: "PA benefit schedule (measurement date, annuity form, vesting treatment, schedule row for $1,120.00)",
        participantKeys: ["SYN-I-01"],
        sourceToAsk: "Prior plan administrator (holder of the schedule)",
        expectedDecisionEffect: "Disposition-changing: establishes the basis.",
        priority: 1,
        status: "issued",
        statusReason: "Issued 2026-11-12; awaiting response.",
        requestedDate: "2026-11-12",
        answeredDate: null,
      },
      {
        requestId: "req-2",
        input: "Plan document / amendment for the era (formula version, effective date)",
        participantKeys: ["SYN-I-01"],
        sourceToAsk: "Plan sponsor records / prior administrator",
        expectedDecisionEffect: "Disposition-changing: identifies the governing formula.",
        priority: 2,
        status: "issued",
        statusReason: "Issued 2026-11-12; awaiting response.",
        requestedDate: "2026-11-12",
        answeredDate: null,
      },
      {
        requestId: "req-3",
        input: "Missing compensation year",
        participantKeys: ["SYN-I-01"],
        sourceToAsk: "Payroll records via the prior administrator",
        expectedDecisionEffect: "Narrows the per-scenario bound width by up to $60.00; does not by itself change the disposition.",
        priority: 3,
        status: "not-issued",
        statusReason: "Held until requests 1–2 are answered, because its decision effect depends on which formula governs.",
        requestedDate: null,
        answeredDate: null,
      },
    ],
    indeterminateRationale:
      "No further step is currently available beyond the two issued requests; the participant cannot be decided on the evidence as it stands.",
    noFurtherRequestReason: null,
    ...overrides,
  };
}

function indeterminateEvidence(
  content: IndeterminateContent = indeterminateContent(),
): EntryCheckInput {
  return {
    completenessGrade: "insufficient",
    comparisonBasis: "unresolved",
    reconstructedBenefitCents: null,
    boundsCents: null,
    deltaCents: null,
    withinTolerance: null,
    toleranceSetId: "tol-1",
    hypotheses: [
      { code: "H1", supportClass: "indeterminate", material: true },
      { code: "H6", supportClass: "indeterminate", material: true },
      { code: "H16", supportClass: "supported", material: false },
    ],
    blockingValidationOutstanding: false,
    boundWidthMaterial: false,
    boundWidthJustification: null,
    missingEvidence: content.missingEvidence,
    nextSteps: ["PA benefit schedule requested", "plan document/amendment requested"],
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

function makeIndeterminateDetermination(): DeterminationRecord {
  return {
    determinationId: "det-2",
    dispositionId: "disp-i1",
    participantKey: "SYN-I-01",
    caseId: "00000001",
    schemaVersion: "1.0.0",
    createdAt: "2026-11-12",
    createdBy: "A. Actuary",
    recordedBenefit: {
      amountCents: 112000,
      isBlank: false,
      sourceScheduleRef: "census row (no schedule row traces to it)",
      recordedDate: null,
    },
    calculatedBenefit: {
      amountCents: null,
      calculationId: null,
      calculationStatus: "indeterminate",
      boundsCents: null,
      noBoundsReason:
        "Governing formula version for the participant's era cannot be identified and the measurement date is unresolved; no single bound is justifiable.",
      correctedBenefitCents: null,
    },
    comparisonBasis: {
      basis: "unresolved",
      measurementDate: null,
      retirementBasis: null,
      annuityForm: null,
      vestingTreatment: "unknown",
      planVersionIds: [],
      comparisonBasisState: "unresolved",
      toleranceSetId: "tol-1",
      deltaCents: null,
      withinTolerance: null,
    },
    differencesAndExplanations: {
      deltaCents: null,
      absDeltaCents: null,
      relDelta: null,
      denominatorFlag: null,
      hypotheses: [],
      leadingExplanation:
        "none supported — H1 and H6 indeterminate without a measurement date or the amendment document; H16 supported as a description of the state.",
    },
    missingEvidence: indeterminateContent().missingEvidence.map((entry) => ({
      input: entry.input,
      missingClass: entry.missingClass,
      decisionImpact: entry.decisionImpact,
    })),
    materialAssumptions: [],
    sensitivityAndUncertainty: {
      scenarios: [
        { scenarioName: "1.50% formula, missing year at lower bound", assumptions: ["pre-amendment formula 1.50% applies"], benefitCents: 150000 },
        { scenarioName: "1.50% formula, missing year at upper bound", assumptions: ["pre-amendment formula 1.50% applies"], benefitCents: 156000 },
        { scenarioName: "1.25% formula, missing year at lower bound", assumptions: ["post-amendment formula 1.25% applies"], benefitCents: 125000 },
        { scenarioName: "1.25% formula, missing year at upper bound", assumptions: ["post-amendment formula 1.25% applies"], benefitCents: 130000 },
      ],
      dispositionSensitivity:
        "Resolving the measurement date or the formula version could move the participant out of Indeterminate; the missing compensation year alone cannot.",
      uncertaintyAttribution: [
        { input: "missing compensation year", contributionCents: 6000, share: null },
      ],
      statisticalNotes: null,
    },
    supportingDocuments: [],
    recommendedDisposition: {
      disposition: "indeterminate",
      recommendedBy: "system",
      recommendedAt: "2026-11-12",
      recommendationRationale: "No B̂_i, no single justified bound, unresolved basis.",
    },
    humanDetermination: {
      disposition: "indeterminate",
      rationale:
        "No further step is currently available beyond the two issued requests; the participant cannot be decided on the evidence as it stands.",
      reviewer: "A. Actuary",
      reviewerRole: "case actuary",
      determinationDate: "2026-11-12",
      approvalId: null,
    },
    dataRequests: indeterminateContent().dataRequests,
    downstream: { usableInValuation: false, valueCents: null, valueKind: "none", paAmbAccept: "N" },
    contentHash: "content-hash-2",
  };
}

// ---------------------------------------------------------------------------
// Transition table T1–T12
// ---------------------------------------------------------------------------

describe("transition table T1–T12 (05 §3.1)", () => {
  it("T1: unassessed + propose verified (system) -> recommended, version 1, no downstream effect", () => {
    const outcome = transition(
      null,
      { kind: "propose", actor: "system", target: "verified", evidenceChanged: true },
      makeCtx(verifiedEvidence(), { newDispositionId: "disp-1", auditEventId: "audit-1" }),
    );
    assert.equal(outcome.outcome, "applied");
    if (outcome.outcome !== "applied") throw new Error("expected applied");
    assert.equal(outcome.transitionId, "T1");
    assert.equal(outcome.record?.disposition, "verified");
    assert.equal(outcome.record?.status, "recommended");
    assert.equal(outcome.record?.version, 1);
    assert.equal(outcome.record?.supersedesId, null);
    assert.equal(outcome.record?.determinationId, null);
    // A recommendation has no downstream effect (§4.1).
    assert.equal(outcome.record?.downstreamUse.usableInValuation, false);
    assert.equal(outcome.record?.downstreamUse.valueCents, null);
    assert.equal(outcome.record?.downstreamUse.paAmbAccept, null);
    assert.equal(outcome.auditEvent.kind, "disposition-proposed");
    assert.equal(outcome.superseded, null);
  });

  it("T1 refused: propose verified while the basis is unresolved (G-INV-3)", () => {
    const outcome = transition(
      null,
      { kind: "propose", actor: "system", target: "verified", evidenceChanged: true },
      makeCtx(verifiedEvidence({ comparisonBasis: "unresolved" })),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "G-INV-3");
    assert.equal(outcome.transitionId, "T1");
    assert.equal(outcome.auditEvent.kind, "transition-refused");
  });

  it("T1 refused: propose verified with a material hypothesis still proposed (entry conditions)", () => {
    const evidence = verifiedEvidence({
      hypotheses: [{ code: "H2", supportClass: "proposed", material: true }],
    });
    const outcome = transition(
      null,
      { kind: "propose", actor: "system", target: "verified", evidenceChanged: true },
      makeCtx(evidence),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "entry-conditions");
  });

  it("T1 refused: propose verified on a statistical output alone (G-INV-5)", () => {
    const outcome = transition(
      null,
      { kind: "propose", actor: "system", target: "verified", evidenceChanged: true },
      makeCtx(verifiedEvidence({ statisticalOnly: true })),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "G-INV-5");
  });

  it("T1 refused: propose with a missing input filled with zero (G-INV-8)", () => {
    const outcome = transition(
      null,
      { kind: "propose", actor: "system", target: "verified", evidenceChanged: true, fillsMissingWithZero: true },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "G-INV-8");
  });

  it("T2: recommended + re-propose on changed evidence -> version 2, previous superseded", () => {
    const first = proposeVerified();
    const outcome = transition(
      first,
      { kind: "propose", actor: "system", target: "verified", evidenceChanged: true },
      makeCtx(verifiedEvidence(), { newDispositionId: "disp-2", auditEventId: "audit-2" }),
    );
    assert.equal(outcome.outcome, "applied");
    if (outcome.outcome !== "applied") throw new Error("expected applied");
    assert.equal(outcome.transitionId, "T2");
    assert.equal(outcome.record?.version, 2);
    assert.equal(outcome.record?.supersedesId, first.dispositionId);
    assert.equal(outcome.superseded?.status, "superseded");
    assert.equal(outcome.superseded?.dispositionId, first.dispositionId);
  });

  it("T2 refused: re-proposal with no change in evidence is refused as a no-op", () => {
    const first = proposeVerified();
    const outcome = transition(
      first,
      { kind: "propose", actor: "system", target: "verified", evidenceChanged: false },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "transition-not-allowed");
    assert.equal(/no-op/.test(outcome.reason), true);
  });

  it("T2 refused: propose directly onto an approved disposition (no row covers it)", () => {
    const approved = approveVerified();
    const outcome = transition(
      approved,
      { kind: "propose", actor: "system", target: "verified", evidenceChanged: true },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "transition-not-allowed");
    assert.equal(outcome.transitionId, null);
  });

  it("T3: recommended + human approval -> approved, downstream usable, approval record kept", () => {
    const first = proposeVerified();
    const outcome = transition(
      first,
      {
        kind: "approve",
        actor: "A. Actuary",
        determination: makeVerifiedDetermination(),
        approval: makeApproval(),
      },
      makeCtx(verifiedEvidence(), { newDispositionId: "disp-2", auditEventId: "audit-2" }),
    );
    assert.equal(outcome.outcome, "applied");
    if (outcome.outcome !== "applied") throw new Error("expected applied");
    assert.equal(outcome.transitionId, "T3");
    assert.equal(outcome.record?.status, "approved");
    assert.equal(outcome.record?.version, 2);
    assert.equal(outcome.record?.downstreamUse.usableInValuation, true);
    assert.equal(outcome.record?.downstreamUse.valueCents, 85000);
    assert.equal(outcome.record?.downstreamUse.valueKind, "recorded");
    assert.equal(outcome.record?.downstreamUse.paAmbAccept, "Y");
    assert.equal(outcome.record?.determinationId, "det-1");
    assert.equal(outcome.approvalRecord?.reviewer, "A. Actuary");
    assert.equal(outcome.approvalRecord?.evidenceSnapshot.inputSnapshotHash, "hash-1");
    assert.equal(outcome.determination?.humanDetermination.approvalId, "appr-1");
    assert.equal(outcome.auditEvent.kind, "disposition-approved");
  });

  it("T3 refused: the system may not approve (human gate)", () => {
    const first = proposeVerified();
    const outcome = transition(
      first,
      {
        kind: "approve",
        actor: "system",
        determination: makeVerifiedDetermination(),
        approval: makeApproval(),
      },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "human-gate");
  });

  it("T3 refused: incomplete determination record (G-INV-7)", () => {
    const first = proposeVerified();
    const incomplete = makeVerifiedDetermination();
    const partial = { ...incomplete, humanDetermination: { ...incomplete.humanDetermination, rationale: "agreed" } };
    const outcome = transition(
      first,
      { kind: "approve", actor: "A. Actuary", determination: partial, approval: makeApproval() },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "G-INV-7");
  });

  it("T3 refused: approval snapshot no longer matches the current state (G-INV-2)", () => {
    const first = proposeVerified();
    const stale = makeApproval({
      evidenceSnapshot: {
        snapshotId: "snap-1",
        inputSnapshotHash: "hash-OLD",
        calculationRunId: "run-1",
        ruleVersion: "validation-rules v1.0.0",
        toleranceSetId: "tol-1",
        dispositionSchemaVersion: "1.0.0",
        determinationId: "det-1",
        sourceDocumentIds: ["doc-plan"],
        calculationTraceHash: "trace-1",
        boundsAssumptionsHash: null,
      },
    });
    const outcome = transition(
      first,
      { kind: "approve", actor: "A. Actuary", determination: makeVerifiedDetermination(), approval: stale },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "G-INV-2");
  });

  it("T3 refused: approve from unassessed (no row covers it)", () => {
    const outcome = transition(
      null,
      { kind: "approve", actor: "A. Actuary", determination: makeVerifiedDetermination(), approval: makeApproval() },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "transition-not-allowed");
  });

  it("T3 refused: entry conditions no longer hold at approval time (re-checked, not assumed)", () => {
    const first = proposeVerified();
    const changed = verifiedEvidence({ withinTolerance: false });
    const outcome = transition(
      first,
      { kind: "approve", actor: "A. Actuary", determination: makeVerifiedDetermination(), approval: makeApproval() },
      makeCtx(changed),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "entry-conditions");
  });

  it("T4: recommended + human rejection with a replacement -> recommended replacement", () => {
    const first = proposeVerified();
    const evidence = verifiedEvidence({
      withinTolerance: false,
      hypotheses: [{ code: "H2", supportClass: "proposed", material: true }],
      nextSteps: ["Request the service history from the prior administrator."],
    });
    const outcome = transition(
      first,
      {
        kind: "reject",
        actor: "A. Actuary",
        rationale: "The $0.50 is not rounding: the plan rounds to cents, not dollars. Investigate service.",
        replacement: "requires-investigation",
      },
      makeCtx(evidence, { newDispositionId: "disp-2", auditEventId: "audit-2" }),
    );
    assert.equal(outcome.outcome, "applied");
    if (outcome.outcome !== "applied") throw new Error("expected applied");
    assert.equal(outcome.transitionId, "T4");
    assert.equal(outcome.record?.disposition, "requires-investigation");
    assert.equal(outcome.record?.status, "recommended");
    assert.equal(outcome.superseded?.status, "superseded");
  });

  it("T4: rejection without a replacement returns to unassessed only with no evidence state", () => {
    const first = proposeVerified();
    const outcome = transition(
      first,
      { kind: "reject", actor: "A. Actuary", rationale: "Proposed before any calculation ran; withdraw it." },
      makeCtx(verifiedEvidence({ hasEvidenceState: false })),
    );
    assert.equal(outcome.outcome, "applied");
    if (outcome.outcome !== "applied") throw new Error("expected applied");
    assert.equal(outcome.transitionId, "T4");
    assert.equal(outcome.record, null);
    assert.equal(outcome.superseded?.disposition, "verified");
  });

  it("T4 refused: rejection without a replacement while an evidence state exists", () => {
    const first = proposeVerified();
    const outcome = transition(
      first,
      { kind: "reject", actor: "A. Actuary", rationale: "I disagree with the recommendation." },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "transition-not-allowed");
  });

  it("T4 refused: the system may not reject a recommendation", () => {
    const first = proposeVerified();
    const outcome = transition(
      first,
      { kind: "reject", actor: "system", rationale: "System rejection.", replacement: "requires-investigation" },
      makeCtx(verifiedEvidence({ withinTolerance: false, nextSteps: ["Check service."] })),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "human-gate");
  });

  it("T5: approved + human re-opening -> recommended, same disposition, approval retained in history", () => {
    const approved = approveVerified();
    const outcome = transition(
      approved,
      { kind: "reopen", actor: "A. Actuary", reason: "The plan document was corrected; the rounding section changed." },
      makeCtx(verifiedEvidence(), { newDispositionId: "disp-3", auditEventId: "audit-3" }),
    );
    assert.equal(outcome.outcome, "applied");
    if (outcome.outcome !== "applied") throw new Error("expected applied");
    assert.equal(outcome.transitionId, "T5");
    assert.equal(outcome.record?.disposition, "verified");
    assert.equal(outcome.record?.status, "recommended");
    assert.equal(outcome.record?.version, 3);
    assert.equal(outcome.superseded?.status, "superseded");
    assert.equal(outcome.superseded?.version, 2);
    assert.equal(outcome.auditEvent.kind, "disposition-reopened");
  });

  it("T5 refused: the system may not re-open an approved disposition", () => {
    const approved = approveVerified();
    const outcome = transition(
      approved,
      { kind: "reopen", actor: "system", reason: "System re-opening." },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "human-gate");
  });

  it("T6: approved + human re-opening with a replacement -> recommended different disposition", () => {
    const approved = approveVerified();
    const evidence = verifiedEvidence({
      withinTolerance: false,
      hypotheses: [{ code: "H2", supportClass: "proposed", material: true }],
      nextSteps: ["Request the service history from the prior administrator."],
    });
    const outcome = transition(
      approved,
      {
        kind: "reopen",
        actor: "A. Actuary",
        reason: "A service error was found in the census; the verified amount no longer holds.",
        replacement: "requires-investigation",
      },
      makeCtx(evidence, { newDispositionId: "disp-3", auditEventId: "audit-3" }),
    );
    assert.equal(outcome.outcome, "applied");
    if (outcome.outcome !== "applied") throw new Error("expected applied");
    assert.equal(outcome.transitionId, "T6");
    assert.equal(outcome.record?.disposition, "requires-investigation");
    assert.equal(outcome.record?.status, "recommended");
  });

  it("T7: approved + source update -> re-proposed recommended on the new snapshot; re-approval required", () => {
    const approved = approveVerified();
    const outcome = transition(
      approved,
      {
        kind: "source-update",
        actor: "system",
        updateKind: "source-corrected",
        newSnapshotHash: "hash-2",
        affectedParticipantKeys: ["SYN-V-01"],
      },
      makeCtx(verifiedEvidence(), { newDispositionId: "disp-3", auditEventId: "audit-3" }),
    );
    assert.equal(outcome.outcome, "applied");
    if (outcome.outcome !== "applied") throw new Error("expected applied");
    assert.equal(outcome.transitionId, "T7");
    assert.equal(outcome.record?.disposition, "verified");
    assert.equal(outcome.record?.status, "recommended");
    assert.equal(outcome.record?.inputSnapshotHash, "hash-2");
    // No silent carry-forward: the re-proposed record authorises nothing.
    assert.equal(outcome.record?.downstreamUse.usableInValuation, false);
    assert.equal(outcome.record?.downstreamUse.paAmbAccept, null);
    assert.equal(outcome.superseded?.status, "superseded");
  });

  it("T7 refused: source update that does not affect this participant (G-INV-6)", () => {
    const approved = approveVerified();
    const outcome = transition(
      approved,
      {
        kind: "source-update",
        actor: "system",
        updateKind: "source-reimported",
        newSnapshotHash: "hash-2",
        affectedParticipantKeys: ["SYN-OTHER"],
      },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "G-INV-6");
  });

  it("T7 refused: source update naming no new snapshot (G-INV-2)", () => {
    const approved = approveVerified();
    const outcome = transition(
      approved,
      {
        kind: "source-update",
        actor: "system",
        updateKind: "source-reimported",
        newSnapshotHash: "hash-1",
        affectedParticipantKeys: ["SYN-V-01"],
      },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "G-INV-2");
  });

  it("T7 refused: correction presented without its original (G-INV-1)", () => {
    const approved = approveVerified();
    const outcome = transition(
      approved,
      {
        kind: "source-update",
        actor: "system",
        updateKind: "source-corrected",
        newSnapshotHash: "hash-2",
        affectedParticipantKeys: ["SYN-V-01"],
        correctionWithoutOriginal: true,
      },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "G-INV-1");
  });

  it("T8: approved + rule revision -> re-proposed recommended under the new rule version", () => {
    const approved = approveVerified();
    const outcome = transition(
      approved,
      {
        kind: "rule-revision",
        actor: "system",
        revisionKind: "tolerance-revised",
        newRuleVersion: "validation-rules v1.1.0",
        changeNote: "Tolerance set revised by the actuary.",
        affectedParticipantKeys: ["SYN-V-01"],
      },
      makeCtx(verifiedEvidence(), { newDispositionId: "disp-3", auditEventId: "audit-3" }),
    );
    assert.equal(outcome.outcome, "applied");
    if (outcome.outcome !== "applied") throw new Error("expected applied");
    assert.equal(outcome.transitionId, "T8");
    assert.equal(outcome.record?.status, "recommended");
    assert.equal(outcome.record?.ruleVersion, "validation-rules v1.1.0");
  });

  it("T9: requires-investigation + investigation step completed -> new recommendation", () => {
    const investigated = proposeRequiresInvestigation();
    const outcome = transition(
      investigated,
      {
        kind: "investigation-completed",
        actor: "system",
        target: "verified",
        outcome: "Service history received; credited service confirmed at 20.0 years.",
      },
      makeCtx(verifiedEvidence(), { newDispositionId: "disp-3", auditEventId: "audit-3" }),
    );
    assert.equal(outcome.outcome, "applied");
    if (outcome.outcome !== "applied") throw new Error("expected applied");
    assert.equal(outcome.transitionId, "T9");
    assert.equal(outcome.record?.disposition, "verified");
    assert.equal(outcome.record?.status, "recommended");
  });

  it("T9 refused: investigation-completed from a disposition that is not requires-investigation", () => {
    const first = proposeVerified();
    const outcome = transition(
      first,
      { kind: "investigation-completed", actor: "system", target: "verified", outcome: "Nothing to investigate." },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "transition-not-allowed");
    assert.equal(outcome.transitionId, null);
  });

  it("T10: indeterminate + new evidence -> new recommendation", () => {
    const ind = proposeIndeterminate();
    const supported = supportedEvidence();
    const outcome = transition(
      ind,
      {
        kind: "new-evidence",
        actor: "system",
        target: "supported-for-acceptance",
        evidenceIsNew: true,
        description: "PA benefit schedule received; basis established; benefit inside justified bounds.",
      },
      makeCtx(supported, { participantKey: "SYN-I-01", newDispositionId: "disp-i2", auditEventId: "audit-i2" }),
    );
    assert.equal(outcome.outcome, "applied");
    if (outcome.outcome !== "applied") throw new Error("expected applied");
    assert.equal(outcome.transitionId, "T10");
    assert.equal(outcome.record?.disposition, "supported-for-acceptance");
    assert.equal(outcome.record?.status, "recommended");
  });

  it("T10 refused: re-arguing the same evidence is not a transition out of Indeterminate", () => {
    const ind = proposeIndeterminate();
    const outcome = transition(
      ind,
      {
        kind: "new-evidence",
        actor: "A. Actuary",
        target: "requires-investigation",
        evidenceIsNew: false,
        description: "Re-reading the same census extract.",
      },
      makeCtx(indeterminateEvidence(), { participantKey: "SYN-I-01" }),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "indeterminate-terminal");
  });

  it("T10 refused: new-evidence from a disposition that is not indeterminate", () => {
    const first = proposeVerified();
    const outcome = transition(
      first,
      { kind: "new-evidence", actor: "system", target: "verified", evidenceIsNew: true, description: "New document." },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "transition-not-allowed");
  });

  it("T11: approved verified + valuation use recorded -> no disposition change, audit event only", () => {
    const approved = approveVerified();
    const outcome = transition(
      approved,
      { kind: "record-valuation-use", actor: "A. Actuary", useReference: "valuation run VAL-2026-11" },
      makeCtx(verifiedEvidence(), { auditEventId: "audit-3" }),
    );
    assert.equal(outcome.outcome, "applied");
    if (outcome.outcome !== "applied") throw new Error("expected applied");
    assert.equal(outcome.transitionId, "T11");
    assert.equal(outcome.dispositionChanged, false);
    assert.equal(outcome.record?.dispositionId, approved.dispositionId);
    assert.equal(outcome.record?.status, "approved");
    assert.equal(outcome.auditEvent.kind, "valuation-use-recorded");
  });

  it("T11 refused: valuation use cannot be recorded on a recommendation", () => {
    const first = proposeVerified();
    const outcome = transition(
      first,
      { kind: "record-valuation-use", actor: "A. Actuary", useReference: "valuation run VAL-2026-11" },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "transition-not-allowed");
  });

  it("T12: every refusal is itself an audit event and leaves the analytic state unchanged", () => {
    const first = proposeVerified();
    const outcome = transition(
      first,
      { kind: "approve", actor: "system", determination: makeVerifiedDetermination(), approval: makeApproval() },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.auditEvent.kind, "transition-refused");
    assert.equal(/human-gate/.test(outcome.auditEvent.detail.refusalReason ?? ""), true);
    // The prior record is untouched: the caller still holds it, unchanged.
    assert.equal(first.status, "recommended");
    assert.equal(first.version, 1);
  });

  it("identifyTransition maps (from, event) to the table rows", () => {
    assert.equal(identifyTransition(null, { kind: "propose", actor: "system", target: "verified", evidenceChanged: true }), "T1");
    const rec = proposeVerified();
    assert.equal(identifyTransition(rec, { kind: "propose", actor: "system", target: "verified", evidenceChanged: true }), "T2");
    assert.equal(identifyTransition(rec, { kind: "approve", actor: "A. Actuary", determination: makeVerifiedDetermination(), approval: makeApproval() }), "T3");
    assert.equal(identifyTransition(null, { kind: "approve", actor: "A. Actuary", determination: makeVerifiedDetermination(), approval: makeApproval() }), null);
  });
});

/** Approve a verified recommendation and return the approved record. */
function approveVerified(): DispositionRecord {
  const first = proposeVerified();
  const outcome = transition(
    first,
    { kind: "approve", actor: "A. Actuary", determination: makeVerifiedDetermination(), approval: makeApproval() },
    makeCtx(verifiedEvidence(), { newDispositionId: "disp-2", auditEventId: "audit-2" }),
  );
  assert.equal(outcome.outcome, "applied");
  if (outcome.outcome !== "applied" || outcome.record === null) throw new Error("approveVerified fixture failed");
  return outcome.record;
}

/** Propose requires-investigation (T1) and return the recommended record. */
function proposeRequiresInvestigation(): DispositionRecord {
  const evidence = verifiedEvidence({
    withinTolerance: false,
    hypotheses: [{ code: "H2", supportClass: "proposed", material: true }],
    nextSteps: ["Request the service history from the prior administrator."],
  });
  const outcome = transition(
    null,
    { kind: "propose", actor: "system", target: "requires-investigation", evidenceChanged: true },
    makeCtx(evidence, { newDispositionId: "disp-ri1", auditEventId: "audit-ri1" }),
  );
  assert.equal(outcome.outcome, "applied");
  if (outcome.outcome !== "applied" || outcome.record === null) throw new Error("proposeRequiresInvestigation fixture failed");
  return outcome.record;
}

/** Propose indeterminate for SYN-I-01 (T1) and return the recommended record. */
function proposeIndeterminate(): DispositionRecord {
  const outcome = transition(
    null,
    { kind: "propose", actor: "system", target: "indeterminate", evidenceChanged: true },
    makeCtx(indeterminateEvidence(), { participantKey: "SYN-I-01", newDispositionId: "disp-i1", auditEventId: "audit-i1" }),
  );
  assert.equal(outcome.outcome, "applied");
  if (outcome.outcome !== "applied" || outcome.record === null) throw new Error("proposeIndeterminate fixture failed");
  return outcome.record;
}

/** Evidence for supported-for-acceptance: partial, inside justified bounds. */
function supportedEvidence(overrides: Partial<EntryCheckInput> = {}): EntryCheckInput {
  return verifiedEvidence({
    completenessGrade: "partial",
    reconstructedBenefitCents: null,
    boundsCents: { min: 84000, max: 86000 },
    deltaCents: null,
    withinTolerance: null,
    hypotheses: [{ code: "H16", supportClass: "supported", material: false }],
    missingEvidence: [
      {
        input: "compensation year 2019",
        missingClass: "M3",
        decisionImpact: "Widens the bound by $20.00; cannot move the disposition.",
        uncertaintyContributionCents: 2000,
      },
    ],
    boundWidthMaterial: false,
    exactSupported: false,
    ...overrides,
  });
}

describe("human approval gate (§4.1)", () => {
  it("a system recommendation never becomes an approval without a human", () => {
    const first = proposeVerified();
    assert.equal(first.status, "recommended");
    // No event the system can send approves: propose, re-propose, and
    // source-update all leave the record recommended at best.
    const reProposed = transition(
      first,
      { kind: "propose", actor: "system", target: "verified", evidenceChanged: true },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(reProposed.outcome, "applied");
    if (reProposed.outcome === "applied") assert.equal(reProposed.record?.status, "recommended");
    const sysApprove = transition(
      first,
      { kind: "approve", actor: "system", determination: makeVerifiedDetermination(), approval: makeApproval() },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(sysApprove.outcome, "refused");
  });

  it("approval by a different reviewer than the determination names is refused", () => {
    const first = proposeVerified();
    const outcome = transition(
      first,
      {
        kind: "approve",
        actor: "B. Reviewer",
        determination: makeVerifiedDetermination(),
        approval: makeApproval({ reviewer: "B. Reviewer" }),
      },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "human-gate");
  });

  it("approval whose determination says a different disposition than the record is refused (Stage 7 Compliance D3)", () => {
    // Compliance worker's T3: SYN-003 is requires-investigation, but the
    // determination carried into the approval says verified. The record
    // and the determination must agree, or the approval cannot proceed.
    const record = proposeRequiresInvestigation();
    assert.equal(record.status, "recommended");
    const outcome = transition(
      record,
      {
        kind: "approve",
        actor: "A. Actuary",
        determination: makeVerifiedDetermination(),
        approval: makeApproval(),
      },
      makeCtx(
        verifiedEvidence({
          withinTolerance: false,
          hypotheses: [{ code: "H2", supportClass: "proposed", material: true }],
          nextSteps: ["Request the service history from the prior administrator."],
        }),
        { participantKey: "SYN-V-01", newDispositionId: "disp-ri2", auditEventId: "audit-ri2" },
      ),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "entry-conditions");
  });

  it("approval with a false §4.2 confirmation is refused", () => {
    const first = proposeVerified();
    const outcome = transition(
      first,
      {
        kind: "approve",
        actor: "A. Actuary",
        determination: makeVerifiedDetermination(),
        approval: makeApproval({
          confirmations: {
            entryConditionsHold: true,
            determinationComplete: true,
            toleranceIdentified: false,
            noMaterialUnexplainedItem: true,
          },
        }),
      },
      makeCtx(verifiedEvidence()),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "G-INV-7");
  });
});

describe("invalidation on source / rule change (§3.2)", () => {
  it("a source change forces re-proposal; no silent carry-forward, no auto-re-approval", () => {
    const approved = approveVerified();
    assert.equal(approved.status, "approved");
    const reProposed = transition(
      approved,
      {
        kind: "source-update",
        actor: "system",
        updateKind: "source-corrected",
        newSnapshotHash: "hash-2",
        affectedParticipantKeys: ["SYN-V-01"],
      },
      makeCtx(verifiedEvidence(), { newDispositionId: "disp-3", auditEventId: "audit-3" }),
    );
    assert.equal(reProposed.outcome, "applied");
    if (reProposed.outcome !== "applied" || reProposed.record === null) throw new Error("expected applied");
    // The re-proposed record is recommended, not approved — even though
    // the disposition is identical and the change may be trivial.
    assert.equal(reProposed.record.status, "recommended");
    assert.equal(reProposed.record.disposition, "verified");
    assert.equal(reProposed.record.downstreamUse.usableInValuation, false);
    // Re-approval by a human restores the approved state.
    const reApproved = transition(
      reProposed.record,
      { kind: "approve", actor: "A. Actuary", determination: makeVerifiedDetermination(), approval: makeApproval() },
      makeCtx(verifiedEvidence(), { inputSnapshotHash: "hash-2", newDispositionId: "disp-4", auditEventId: "audit-4" }),
    );
    // The approval snapshot in makeApproval names hash-1, so this
    // re-approval must be refused until the snapshot is re-frozen: the
    // old approval does not carry forward onto new evidence.
    assert.equal(reApproved.outcome, "refused");
    if (reApproved.outcome !== "refused") throw new Error("expected refused");
    assert.equal(reApproved.guard, "G-INV-2");
  });
});

describe("Indeterminate as a legitimate terminal outcome (§5)", () => {
  it("entry conditions hold for SYN-I-01: no B̂_i, no justified bounds, unresolved basis", () => {
    const entry = checkEntryConditions("indeterminate", indeterminateEvidence());
    assert.equal(entry.holds, true);
    assert.deepEqual(entry.failures, []);
  });

  it("T1 proposes indeterminate (recommended) with its §5.3 content", () => {
    const record = proposeIndeterminate();
    assert.equal(record.disposition, "indeterminate");
    assert.equal(record.status, "recommended");
    assert.equal(record.downstreamUse.usableInValuation, false);
    assert.equal(record.downstreamUse.valueCents, null);
    assert.equal(record.downstreamUse.paAmbAccept, null);
  });

  it("G-IND-1: an Indeterminate transition without §5.3 content is refused", () => {
    const evidence = indeterminateEvidence();
    const noContent: EntryCheckInput = { ...evidence, indeterminateContent: null };
    const outcome = transition(
      null,
      { kind: "propose", actor: "system", target: "indeterminate", evidenceChanged: true },
      makeCtx(noContent, { participantKey: "SYN-I-01" }),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "G-IND-1");
  });

  it("G-IND-2: all data requests still not-issued is Requires investigation, not Indeterminate", () => {
    const content = indeterminateContent({
      dataRequests: indeterminateContent().dataRequests.map((request) => ({
        ...request,
        status: "not-issued" as const,
        statusReason: "Not yet issued.",
        requestedDate: null,
      })),
    });
    const outcome = transition(
      null,
      { kind: "propose", actor: "system", target: "indeterminate", evidenceChanged: true },
      makeCtx(indeterminateEvidence(content), { participantKey: "SYN-I-01" }),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "G-IND-2");
  });

  it("no transition out of Indeterminate on the same evidence (terminal)", () => {
    const ind = proposeIndeterminate();
    const outcome = transition(
      ind,
      { kind: "propose", actor: "system", target: "verified", evidenceChanged: true },
      makeCtx(indeterminateEvidence(), { participantKey: "SYN-I-01" }),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "transition-not-allowed");
  });

  it("approval is refused while live data requests could still resolve the case (§5.2, §8.2 step 3)", () => {
    const ind = proposeIndeterminate();
    const approval = makeApproval({
      evidenceSnapshot: {
        snapshotId: "snap-i1",
        inputSnapshotHash: "hash-1",
        calculationRunId: null,
        ruleVersion: "validation-rules v1.0.0",
        toleranceSetId: "tol-1",
        dispositionSchemaVersion: "1.0.0",
        determinationId: "det-2",
        sourceDocumentIds: [],
        calculationTraceHash: null,
        boundsAssumptionsHash: null,
      },
    });
    const outcome = transition(
      ind,
      { kind: "approve", actor: "A. Actuary", determination: makeIndeterminateDetermination(), approval },
      makeCtx(indeterminateEvidence(), { participantKey: "SYN-I-01", newDispositionId: "disp-i2", auditEventId: "audit-i2" }),
    );
    assert.equal(outcome.outcome, "refused");
    if (outcome.outcome !== "refused") throw new Error("expected refused");
    assert.equal(outcome.guard, "G-IND-2");
    assert.equal(indeterminateApprovable(indeterminateEvidence()).approvable, false);
  });

  it("approval succeeds on a documented exhausted search (requests answered, no further request possible)", () => {
    const content = indeterminateContent({
      dataRequests: indeterminateContent().dataRequests.map((request) =>
        request.requestId === "req-3"
          ? request
          : {
              ...request,
              status: "answered-no-data" as const,
              statusReason: "Asked; the source has no data.",
              answeredDate: "2026-11-12",
            },
      ),
      noFurtherRequestReason:
        "Requests 1–2 answered with no data. The remaining request (missing compensation year) narrows per-scenario bounds only and cannot change the disposition while the formula and basis are unresolved.",
    });
    const evidence = indeterminateEvidence(content);
    const proposed = transition(
      null,
      { kind: "propose", actor: "system", target: "indeterminate", evidenceChanged: true },
      makeCtx(evidence, { participantKey: "SYN-I-01", newDispositionId: "disp-i1", auditEventId: "audit-i1" }),
    );
    assert.equal(proposed.outcome, "applied");
    if (proposed.outcome !== "applied" || proposed.record === null) throw new Error("expected applied");
    assert.equal(indeterminateApprovable(evidence).approvable, true);
    const approval = makeApproval({
      evidenceSnapshot: {
        snapshotId: "snap-i1",
        inputSnapshotHash: "hash-1",
        calculationRunId: null,
        ruleVersion: "validation-rules v1.0.0",
        toleranceSetId: "tol-1",
        dispositionSchemaVersion: "1.0.0",
        determinationId: "det-2",
        sourceDocumentIds: [],
        calculationTraceHash: null,
        boundsAssumptionsHash: null,
      },
    });
    const outcome = transition(
      proposed.record,
      { kind: "approve", actor: "A. Actuary", determination: makeIndeterminateDetermination(), approval },
      makeCtx(evidence, { participantKey: "SYN-I-01", newDispositionId: "disp-i2", auditEventId: "audit-i2" }),
    );
    assert.equal(outcome.outcome, "applied");
    if (outcome.outcome !== "applied") throw new Error("expected applied");
    assert.equal(outcome.record?.status, "approved");
    assert.equal(outcome.record?.disposition, "indeterminate");
    assert.equal(outcome.record?.downstreamUse.usableInValuation, false);
    assert.equal(outcome.record?.downstreamUse.paAmbAccept, "N");
  });
});

describe("valuation permission per disposition (§1.2, §1.3)", () => {
  it("approved Verified and Supported carry B_i^PA into the valuation", () => {
    assert.deepEqual(downstreamUseFor("verified", "approved", 85000, null), {
      usableInValuation: true,
      valueCents: 85000,
      valueKind: "recorded",
      paAmbAccept: "Y",
    });
    assert.deepEqual(downstreamUseFor("supported-for-acceptance", "approved", 85000, null), {
      usableInValuation: true,
      valueCents: 85000,
      valueKind: "recorded",
      paAmbAccept: "Y",
    });
  });

  it("approved Correction recommended carries only the corrected value, never B_i^PA", () => {
    assert.deepEqual(downstreamUseFor("correction-recommended", "approved", 85000, 82000), {
      usableInValuation: true,
      valueCents: 82000,
      valueKind: "corrected",
      paAmbAccept: "N",
    });
  });

  it("approved Requires investigation and Indeterminate block use", () => {
    assert.deepEqual(downstreamUseFor("requires-investigation", "approved", 85000, null), {
      usableInValuation: false,
      valueCents: null,
      valueKind: "none",
      paAmbAccept: "N",
    });
    assert.deepEqual(downstreamUseFor("indeterminate", "approved", 112000, null), {
      usableInValuation: false,
      valueCents: null,
      valueKind: "none",
      paAmbAccept: "N",
    });
  });

  it("a recommendation authorises nothing, whatever the disposition", () => {
    for (const disposition of [
      "verified",
      "supported-for-acceptance",
      "requires-investigation",
      "correction-recommended",
      "indeterminate",
    ] as const) {
      assert.deepEqual(downstreamUseFor(disposition, "recommended", 85000, 82000), {
        usableInValuation: false,
        valueCents: null,
        valueKind: "none",
        paAmbAccept: null,
      });
    }
  });
});

describe("entry conditions (§1.2)", () => {
  it("Verified holds only with a complete evidence state and no material unexplained item", () => {
    assert.equal(checkEntryConditions("verified", verifiedEvidence()).holds, true);
    assert.equal(checkEntryConditions("verified", verifiedEvidence({ completenessGrade: "partial" })).holds, false);
    assert.equal(checkEntryConditions("verified", verifiedEvidence({ reconstructedBenefitCents: null })).holds, false);
    assert.equal(checkEntryConditions("verified", verifiedEvidence({ withinTolerance: false })).holds, false);
    assert.equal(checkEntryConditions("verified", verifiedEvidence({ blockingValidationOutstanding: true })).holds, false);
  });

  it("Supported for acceptance holds inside justified bounds with no M5 gap", () => {
    assert.equal(checkEntryConditions("supported-for-acceptance", supportedEvidence()).holds, true);
    assert.equal(
      checkEntryConditions(
        "supported-for-acceptance",
        supportedEvidence({
          missingEvidence: [
            {
              input: "plan document for the era",
              missingClass: "M5",
              decisionImpact: "Formula unidentifiable.",
              uncertaintyContributionCents: null,
            },
          ],
        }),
      ).holds,
      false,
    );
    assert.equal(
      checkEntryConditions("supported-for-acceptance", supportedEvidence({ recordedBenefitCents: 90000 })).holds,
      false,
    );
    assert.equal(
      checkEntryConditions(
        "supported-for-acceptance",
        supportedEvidence({ hypotheses: [{ code: "H15", supportClass: "coincidence", material: true }] }),
      ).holds,
      false,
    );
  });

  it("Requires investigation needs an entry condition and a named next step", () => {
    const base = verifiedEvidence({
      withinTolerance: false,
      hypotheses: [{ code: "H2", supportClass: "proposed", material: true }],
      nextSteps: ["Request the service history."],
    });
    assert.equal(checkEntryConditions("requires-investigation", base).holds, true);
    assert.equal(checkEntryConditions("requires-investigation", { ...base, nextSteps: [] }).holds, false);
    assert.equal(checkEntryConditions("requires-investigation", verifiedEvidence()).holds, false);
  });

  it("Correction recommended needs a supported hypothesis, a single certain corrected value, and a direction", () => {
    const base = verifiedEvidence({
      hypotheses: [{ code: "H2", supportClass: "supported", material: true, correctedBenefitCents: 82000 }],
      correctedBenefitCents: 82000,
      correctionReasonablyCertain: true,
      correctionDirection: "decrease",
    });
    assert.equal(checkEntryConditions("correction-recommended", base).holds, true);
    assert.equal(
      checkEntryConditions("correction-recommended", { ...base, correctionReasonablyCertain: false }).holds,
      false,
    );
    assert.equal(
      checkEntryConditions("correction-recommended", { ...base, conflictingCorrections: true }).holds,
      false,
    );
    assert.equal(
      checkEntryConditions("correction-recommended", { ...base, correctedBenefitCents: null }).holds,
      false,
    );
    assert.equal(
      checkEntryConditions("correction-recommended", { ...base, comparisonBasis: "unresolved" }).holds,
      false,
    );
  });

  it("the guard catalogue lists G-INV-1–9 and G-IND-1–2", () => {
    assert.equal(GUARD_CATALOGUE.length, 11);
    for (const guard of ["G-INV-1", "G-INV-2", "G-INV-3", "G-INV-4", "G-INV-5", "G-INV-6", "G-INV-7", "G-INV-8", "G-INV-9", "G-IND-1", "G-IND-2"] as const) {
      assert.equal(GUARD_CATALOGUE.some((entry) => entry.guard === guard), true);
    }
  });
});

describe("DeterminationRecord completeness (§7) and approval", () => {
  it("a complete record lists all ten items present", () => {
    const result = checkDeterminationCompleteness(makeVerifiedDetermination());
    assert.equal(result.complete, true);
    assert.deepEqual(result.missingItems, []);
    assert.deepEqual(result.presentItems, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("a missing item blocks approval", () => {
    const partial = { ...makeVerifiedDetermination(), humanDetermination: undefined };
    const result = checkDeterminationCompleteness(partial);
    assert.equal(result.complete, false);
    assert.equal(result.missingItems.some((item) => item.item === 10), true);
    const approved = approveDetermination(partial, makeApproval());
    assert.equal(approved.approved, false);
    if (approved.approved !== false) throw new Error("expected refusal");
    assert.equal(approved.reasons.some((reason) => reason.includes("item 10")), true);
  });

  it("a stated none passes: empty lists mean none, an absent list blocks", () => {
    const record = makeVerifiedDetermination();
    // Empty lists are the stated "none" (§7, item 6 spelled out).
    assert.equal(checkDeterminationCompleteness(record).complete, true);
    const absent = { ...record, missingEvidence: undefined, materialAssumptions: undefined };
    const result = checkDeterminationCompleteness(absent);
    assert.equal(result.complete, false);
    assert.equal(result.missingItems.some((item) => item.item === 5), true);
    assert.equal(result.missingItems.some((item) => item.item === 6), true);
  });

  it("a blank recorded benefit is present when isBlank agrees; a mismatch blocks", () => {
    const blank = makeVerifiedDetermination();
    blank.recordedBenefit = { amountCents: null, isBlank: true, sourceScheduleRef: "census (blank)", recordedDate: null };
    blank.downstream = { usableInValuation: false, valueCents: null, valueKind: "none", paAmbAccept: "N" };
    blank.humanDetermination = { ...blank.humanDetermination, disposition: "indeterminate" };
    blank.recommendedDisposition = { ...blank.recommendedDisposition, disposition: "indeterminate" };
    assert.equal(
      checkDeterminationCompleteness(blank).missingItems.some((item) => item.item === 1),
      false,
    );
    const mismatch = makeVerifiedDetermination();
    mismatch.recordedBenefit = { amountCents: null, isBlank: false, sourceScheduleRef: "PA schedule p. 4", recordedDate: null };
    assert.equal(
      checkDeterminationCompleteness(mismatch).missingItems.some((item) => item.item === 1),
      true,
    );
  });

  it("a bare agreed rationale is not a rationale (item 10)", () => {
    const record = makeVerifiedDetermination();
    record.humanDetermination = { ...record.humanDetermination, rationale: "agreed" };
    const result = checkDeterminationCompleteness(record);
    assert.equal(result.complete, false);
    assert.equal(result.missingItems.some((item) => item.item === 10), true);
  });

  it("item 2 with no amount needs bounds or a no-bounds reason", () => {
    const record = makeIndeterminateDetermination();
    assert.equal(checkDeterminationCompleteness(record).complete, true);
    const unstated = makeIndeterminateDetermination();
    unstated.calculatedBenefit = { ...unstated.calculatedBenefit, noBoundsReason: null };
    assert.equal(
      checkDeterminationCompleteness(unstated).missingItems.some((item) => item.item === 2),
      true,
    );
  });

  it("item 3 with an unresolved basis and a recorded Δ is refused (G-INV-3)", () => {
    const record = makeIndeterminateDetermination();
    record.comparisonBasis = { ...record.comparisonBasis, deltaCents: 5000 };
    assert.equal(
      checkDeterminationCompleteness(record).missingItems.some((item) => item.item === 3),
      true,
    );
  });

  it("approval sets approvalId; the system, a different reviewer, and a false confirmation are refused", () => {
    const approved = approveDetermination(makeVerifiedDetermination(), makeApproval());
    assert.equal(approved.approved, true);
    if (approved.approved !== true) throw new Error("expected approval");
    assert.equal(approved.record.humanDetermination.approvalId, "appr-1");
    assert.equal(approved.record.humanDetermination.rationale, makeVerifiedDetermination().humanDetermination.rationale);

    assert.equal(approveDetermination(makeVerifiedDetermination(), makeApproval({ reviewer: "system" })).approved, false);
    assert.equal(approveDetermination(makeVerifiedDetermination(), makeApproval({ reviewer: "B. Reviewer" })).approved, false);
    assert.equal(
      approveDetermination(
        makeVerifiedDetermination(),
        makeApproval({
          confirmations: { entryConditionsHold: true, determinationComplete: true, toleranceIdentified: true, noMaterialUnexplainedItem: false },
        }),
      ).approved,
      false,
    );
  });

  it("downstream consistency follows the §1.4 mapping", () => {
    assert.equal(checkDownstreamConsistency(makeVerifiedDetermination()).consistent, true);
    const wrong = makeVerifiedDetermination();
    wrong.downstream = { usableInValuation: true, valueCents: 85000, valueKind: "recorded", paAmbAccept: "N" };
    assert.equal(checkDownstreamConsistency(wrong).consistent, false);
    const correction = makeVerifiedDetermination();
    correction.humanDetermination = { ...correction.humanDetermination, disposition: "correction-recommended" };
    correction.calculatedBenefit = { ...correction.calculatedBenefit, correctedBenefitCents: 82000 };
    correction.downstream = { usableInValuation: true, valueCents: 82000, valueKind: "corrected", paAmbAccept: "N" };
    assert.equal(checkDownstreamConsistency(correction).consistent, true);
  });
});

describe("worked examples (05 §8)", () => {
  it("SYN-V-01 Verified: 1.25% x 20 x $3,398.00 = $849.50; rounding to the nearest dollar -> $850.00; Δ +$0.50", () => {
    // Exact-decimal arithmetic (src/decimal.ts): 0.0125 x 20 = 0.25; 0.25 x 3398 = 849.5.
    assert.equal(decMultiply(decMultiply("0.0125", "20"), "3398"), "849.5");
    assert.equal(decRound("849.5", "1", "half-up"), "850");
    // In integer cents: recorded 85000, reconstructed 84950, Δ +50.
    const record = proposeVerified();
    assert.equal(record.evidenceState.reconstructedBenefitCents, 84950);
    assert.equal(record.evidenceState.deltaCents, 50);
    assert.equal(record.evidenceState.withinTolerance, true);
    const approved = approveVerified();
    assert.equal(approved.status, "approved");
    assert.equal(approved.downstreamUse.valueCents, 85000);
    assert.equal(approved.downstreamUse.paAmbAccept, "Y");
    assert.equal(makeMoney(85000).amountMinor, 85000);
  });

  it("SYN-I-01 Indeterminate: per-scenario bounds; $1,120.00 outside both ranges is a lead, not a conclusion", () => {
    // 1.50% scenario: [0.015 x 20 x 5000, 0.015 x 20 x 5200] = [1500, 1560].
    assert.equal(decMultiply(decMultiply("0.015", "20"), "5000"), "1500");
    assert.equal(decMultiply(decMultiply("0.015", "20"), "5200"), "1560");
    // 1.25% scenario: [0.0125 x 20 x 5000, 0.0125 x 20 x 5200] = [1250, 1300].
    assert.equal(decMultiply(decMultiply("0.0125", "20"), "5000"), "1250");
    assert.equal(decMultiply(decMultiply("0.0125", "20"), "5200"), "1300");
    // Missing-year width contribution: average width $200 x 0.30 = $60.00 (1.50%); x 0.25 = $50.00 (1.25%).
    assert.equal(decMultiply("200", "0.3"), "60");
    assert.equal(decMultiply("200", "0.25"), "50");
    // Recorded $1,120.00 lies outside both scenario ranges — but the
    // basis is unresolved, so no Δ is computed and no correction follows.
    const evidence = indeterminateEvidence();
    assert.equal(evidence.recordedBenefitCents, 112000);
    assert.equal(evidence.deltaCents, null);
    assert.equal(evidence.comparisonBasis, "unresolved");
    const content = evidence.indeterminateContent;
    assert.equal(content !== null, true);
    if (content === null) throw new Error("expected Indeterminate content");
    for (const scenario of content.scenarioBounds) {
      assert.equal(112000 < scenario.minCents, true);
    }
    // Data requests are prioritised 1, 2, 3 by expected decision effect.
    assert.deepEqual(
      content.dataRequests.map((request) => request.priority),
      [1, 2, 3],
    );
    assert.deepEqual(
      content.dataRequests.map((request) => request.status),
      ["issued", "issued", "not-issued"],
    );
    const record = proposeIndeterminate();
    assert.equal(record.disposition, "indeterminate");
    assert.equal(record.downstreamUse.usableInValuation, false);
  });
});

// ---------------------------------------------------------------------------
// §17 case-analysis state
// ---------------------------------------------------------------------------

function makeParticipant(
  key: string,
  evidence: EntryCheckInput | null,
  disposition: DispositionRecord | null,
  completenessGrade: "complete" | "partial" | "insufficient" | "excluded" = "complete",
): ParticipantAnalysis {
  return {
    participantKey: key,
    benefitObservation: null,
    benefitCalculation: null,
    bounds: { minCents: 84000, maxCents: 86000 },
    benefitComparison: null,
    hypotheses: [],
    completenessGrade,
    disposition,
    dataRequests: [],
    evidence,
  };
}

function makeCaseState(participants: Record<string, ParticipantAnalysis>): CaseAnalysisState {
  return {
    stateVersion: "1.0.0",
    caseId: "00000001",
    inputSnapshot: { snapshotHash: "hash-1", sourceDocuments: [], importedValues: null },
    planProvisions: [],
    ruleVersions: {
      validationRules: "validation-rules v1.0.0",
      formulaTaxonomy: "formula-taxonomy v1.0.0",
      dispositionSchema: "1.0.0",
      toleranceSetId: "tol-1",
    },
    participants,
    auditLog: [],
    advisoryWorkList: [],
    workflow: { currentStep: "review", selectedParticipantKey: null },
  };
}

describe("§17 case-analysis state S_t and T", () => {
  it("a user-action propose updates one participant and appends an audit event; the input state is untouched", () => {
    const state = makeCaseState({ "SYN-V-01": makeParticipant("SYN-V-01", verifiedEvidence(), null) });
    const event: AnalysisEvent = {
      kind: "user-action",
      eventId: "ev-1",
      actor: "system",
      occurredAt: "2026-11-12",
      action: "propose-disposition",
      participantKey: "SYN-V-01",
      dispositionEvent: { kind: "propose", actor: "system", target: "verified", evidenceChanged: true },
    };
    const result = applyCaseEvent(state, event, {
      newDispositionId: (key) => `disp-${key}`,
      auditEventId: (index) => `audit-${index}`,
    });
    assert.equal(result.caseRefusal, null);
    assert.deepEqual(result.applied, ["SYN-V-01"]);
    assert.equal(result.state.participants["SYN-V-01"]?.disposition?.disposition, "verified");
    assert.equal(result.state.auditLog.length, 1);
    // Immutability: the input state still has no disposition and no audit event.
    assert.equal(state.participants["SYN-V-01"]?.disposition, null);
    assert.equal(state.auditLog.length, 0);
  });

  it("a source update recomputes exactly the affected set; an unaffected participant is untouched", () => {
    const a = proposeVerified();
    const b = proposeVerified();
    const state = makeCaseState({
      "SYN-V-01": makeParticipant("SYN-V-01", verifiedEvidence(), a),
      "SYN-V-02": makeParticipant("SYN-V-02", verifiedEvidence(), b),
    });
    const beforeB = state.participants["SYN-V-02"]?.disposition;
    const event: AnalysisEvent = {
      kind: "source-update",
      eventId: "ev-2",
      actor: "system",
      occurredAt: "2026-11-12",
      update: "source-corrected",
      affectedParticipantKeys: ["SYN-V-01"],
      affectedSetBasis: "single-participant correction to the SYN-V-01 census row",
      newSnapshotHash: "hash-2",
    };
    const result = applyCaseEvent(state, event, {
      newDispositionId: (key) => `disp-new-${key}`,
      auditEventId: (index) => `audit-${index}`,
    });
    assert.equal(result.caseRefusal, null);
    // A is re-proposed as recommended on the new snapshot.
    assert.equal(result.state.participants["SYN-V-01"]?.disposition?.status, "recommended");
    assert.equal(result.state.participants["SYN-V-01"]?.disposition?.inputSnapshotHash, "hash-2");
    // B is byte-identical: the same record object, untouched.
    assert.equal(result.state.participants["SYN-V-02"]?.disposition, beforeB);
    const { affected, unaffected, unknownKeys } = computeAffectedSet(state, ["SYN-V-01"]);
    assert.deepEqual(affected, ["SYN-V-01"]);
    assert.deepEqual(unaffected, ["SYN-V-02"]);
    assert.deepEqual(unknownKeys, []);
  });

  it("a source update naming a participant outside the case is refused (G-INV-6)", () => {
    const state = makeCaseState({ "SYN-V-01": makeParticipant("SYN-V-01", verifiedEvidence(), proposeVerified()) });
    const event: AnalysisEvent = {
      kind: "source-update",
      eventId: "ev-3",
      actor: "system",
      occurredAt: "2026-11-12",
      update: "source-reimported",
      affectedParticipantKeys: ["SYN-V-01", "SYN-GHOST"],
      affectedSetBasis: "re-import of the census file",
      newSnapshotHash: "hash-2",
    };
    const result = applyCaseEvent(state, event, {
      newDispositionId: (key) => `disp-new-${key}`,
      auditEventId: (index) => `audit-${index}`,
    });
    assert.equal(result.caseRefusal === null, false);
    assert.equal(result.caseRefusal?.guard, "G-INV-6");
    // Analytic content unchanged; only the refusal audit event was added.
    assert.equal(result.state.participants["SYN-V-01"]?.disposition?.status, "recommended");
    assert.equal(result.state.inputSnapshot.snapshotHash, "hash-1");
    assert.equal(result.state.auditLog.length, 1);
    assert.equal(result.state.auditLog[0]?.kind, "transition-refused");
  });

  it("a statistical screen writes only to the advisory work-list, never to a disposition (Invariant 5)", () => {
    const state = makeCaseState({ "SYN-V-01": makeParticipant("SYN-V-01", verifiedEvidence(), proposeVerified()) });
    const event: AnalysisEvent = {
      kind: "calculation-event",
      eventId: "ev-4",
      actor: "system",
      occurredAt: "2026-11-12",
      calculationEvent: "statistical-screen-completed",
      participantKey: "SYN-V-01",
      payload: { advisoryNote: "Robust z-score 4.1 on Δ_i — investigate." },
    };
    const result = applyCaseEvent(state, event, {
      newDispositionId: (key) => `disp-new-${key}`,
      auditEventId: (index) => `audit-${index}`,
    });
    assert.equal(result.caseRefusal, null);
    assert.equal(result.state.advisoryWorkList.length, 1);
    assert.equal(result.state.participants["SYN-V-01"]?.disposition?.status, "recommended");
    assert.equal(result.state.participants["SYN-V-01"]?.benefitCalculation, null);
  });

  it("finish-run is refused while a participant lacks output and a disposition (G-INV-9)", () => {
    const incomplete = makeParticipant("SYN-V-01", verifiedEvidence(), null);
    incomplete.bounds = null;
    const state = makeCaseState({ "SYN-V-01": incomplete });
    const result = applyCaseEvent(
      state,
      { kind: "finish-run", eventId: "ev-5", actor: "A. Actuary", occurredAt: "2026-11-12" },
      { newDispositionId: (key) => `disp-${key}`, auditEventId: (index) => `audit-${index}` },
    );
    assert.equal(result.caseRefusal === null, false);
    assert.equal(result.caseRefusal?.guard, "G-INV-9");
  });

  it("checkRunCompleteness ignores excluded participants and flags unapproved recommendations", () => {
    const result = checkRunCompleteness([
      { participantKey: "P1", completenessGrade: "complete", hasCalculationOrBoundsOrNoBoundsStatement: true, disposition: proposeVerified() },
      { participantKey: "P2", completenessGrade: "excluded", hasCalculationOrBoundsOrNoBoundsStatement: false, disposition: null },
      { participantKey: "P3", completenessGrade: "insufficient", hasCalculationOrBoundsOrNoBoundsStatement: false, disposition: null },
    ]);
    assert.equal(result.complete, false);
    assert.equal(result.missing.length, 1);
    assert.equal(result.missing[0]?.participantKey, "P3");
    // P1 is recommended (unapproved): unfinished business, not a blocker.
    assert.deepEqual(result.unapprovedRecommended, ["P1"]);
  });
});
