/**
 * Unit tests for the Stage 5 publication wiring
 * (src/reconciliationFindings.ts): Stage 5 results (reconciliation
 * outcomes, hypothesis rankings, statistical flags, missing-data
 * classifications, disposition recommendations) published as Findings
 * through the Stage 4.5 contribution protocol (publishFindings /
 * assembleContribution), with the rules that every finding carries
 * evidence or an explicit missing-evidence exception, statistical flags
 * publish as diagnostic evidence only, and a close numeric match
 * publishes as an investigation signal, never as proof of correctness.
 *
 * Run with plain node + node:test (no test framework dependency).
 * Synthetic data only. Fictional participants only. No live case data.
 * Money is integer minor units (cents).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assembleStage5Contribution,
  buildCloseMatchFinding,
  buildDispositionRecommendationFinding,
  buildHypothesisFinding,
  buildMissingDataFinding,
  buildReconciliationFinding,
  buildStatisticalFlagFinding,
  findingHasEvidenceOrException,
  publishStage5Findings,
  type FindingEvidence,
  type Stage5ParticipantPublication,
} from "../src/reconciliationFindings.js";
import { mapDisposition, workedExampleSyn001 } from "../src/dispositionMapping.js";
import type { EvidenceRef } from "../src/contribution.js";
import type {
  CalculationOutcome,
  CalculationRun,
  CalculationStep,
  TypedBenefitQuantity,
} from "../src/types.js";
import { makeMoney } from "../src/decimal.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEvidence(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return {
    evidenceId: "ev-plan",
    documentId: "doc-plan",
    location: {
      kind: "pdf-page",
      fileName: "Synthetic Plan A.pdf",
      page: 5,
      section: "§7.3",
      quote: null,
    },
    acquisition: "imported",
    derivation: null,
    sourceFileHash: null,
    sourceKind: "plan document",
    title: "Synthetic Plan A",
    versionOrDate: null,
    imageViewerDocumentNumber: "999001",
    originalExcerpt: null,
    accessStatus: "verified",
    workProductRef: null,
    ...overrides,
  };
}

function makeRun(overrides: Partial<CalculationRun> = {}): CalculationRun {
  return {
    id: "run-entity-1",
    version: 1,
    supersedesId: null,
    sourceRecordIds: [],
    createdDate: "2026-11-12",
    createdBy: "system",
    runId: "run-1",
    caseId: "00000001",
    ruleVersion: "validation-rules v1.0.0",
    inputSnapshot: {
      snapshotHash: "hash-1",
      importIds: [],
      entityVersions: [],
      planVersionIds: [],
      formulaIds: [],
      ruleVersion: "validation-rules v1.0.0",
      formulaTaxonomyVersion: "1.0.0",
      engineVersion: "0.1.0",
      toleranceRecordVersion: 1,
    },
    inputSnapshotHash: "hash-1",
    runDate: "2026-11-12",
    runBy: "system",
    participantScope: "SYN-001",
    resultsHash: "results-1",
    engineVersion: "0.1.0",
    participantsComputed: 1,
    participantsChanged: ["SYN-001"],
    ...overrides,
  };
}

function makeStep(overrides: Partial<CalculationStep> = {}): CalculationStep {
  return {
    step: 1,
    name: "base-formula",
    inputs: [{ field: "service", value: 20 }],
    output: 150000,
    ruleRef: "Synthetic Plan A §7.3",
    evidenceGrade: "fact",
    assumption: null,
    ...overrides,
  };
}

function makeBenefit(amountMinor: number): TypedBenefitQuantity {
  return {
    amount: makeMoney(amountMinor),
    periodicity: "monthly",
    measurementDate: "2019-06-30",
    measurementBasis: "dote",
    basisNote: null,
    commencementBasis: "payable at NRD",
    retirementAge: 65,
    retirementDate: "2025-04-15",
    annuityForm: "NSF",
    vestingTreatment: "vested",
    planVersionId: null,
    formulaId: null,
    source: "independent-calculation",
    status: "calculated",
    ownerId: "SYN-001",
  };
}

function makeExactOutcome(): CalculationOutcome {
  return { kind: "exact", benefit: makeBenefit(150000), trace: [makeStep()] };
}

const EVIDENCED: FindingEvidence = { evidenceIds: ["ev-plan"], missingEvidenceException: null };
const NO_EVIDENCE: FindingEvidence = { evidenceIds: [], missingEvidenceException: null };
const EXCEPTED: FindingEvidence = {
  evidenceIds: [],
  missingEvidenceException: "No EvidenceRef supplied; the PA schedule row showing the blank is the record of the gap.",
};

function makeParticipant(
  overrides: Partial<Stage5ParticipantPublication> = {},
): Stage5ParticipantPublication {
  return {
    participantKey: "SYN-001",
    reconciliation: {
      participantKey: "SYN-001",
      recordedMinor: 150000,
      reconstructedMinor: 150000,
      deltaMinor: 0,
      absDeltaMinor: 0,
      relDelta: "0",
      denominatorFlag: null,
      withinTolerance: true,
      toleranceSetId: "tol-1",
      recordedPosition: null,
      boundsMinor: null,
    },
    hypotheses: [],
    statisticalFlags: [],
    missingData: [],
    dispositionRecommendation: null,
    closeMatch: null,
    evidenceByKind: { reconciliation: EVIDENCED },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. A reconciliation outcome publishes a Finding with evidence
// ---------------------------------------------------------------------------

describe("reconciliation outcome publishes a Finding with evidence", () => {
  it("builds a derived_result finding carrying Δ, the tolerance verdict, and cited evidence", () => {
    const built = buildReconciliationFinding({
      caseId: "00000001",
      runId: "run-1",
      productVersion: "0.1.0",
      reconciliation: makeParticipant().reconciliation as NonNullable<Stage5ParticipantPublication["reconciliation"]>,
      evidence: EVIDENCED,
      pool: [makeEvidence()],
    });
    assert.ok(!("refused" in built), "expected a published finding, not a refusal");
    if ("refused" in built) return;
    assert.equal(built.finding.claimType, "derived_result");
    assert.deepEqual(built.finding.evidenceRefs, ["ev-plan"]);
    assert.equal(built.finding.missingEvidenceException, null);
    assert.equal(built.finding.reviewState, "draft");
    assert.equal(built.finding.valueAndUnits.value, "0");
    assert.match(built.finding.findingStatement, /Δ \$0\.00/);
    assert.match(built.finding.findingStatement, /within tolerance: true/);
    assert.match(built.finding.rationale, /no universal PBGC tolerance exists/);
    assert.ok(findingHasEvidenceOrException(built.finding));
  });

  it("publishStage5Findings merges the pipeline outcome finding with the Stage 5 reconciliation finding", () => {
    const log = publishStage5Findings({
      run: makeRun(),
      outcome: makeExactOutcome(),
      evidence: [makeEvidence()],
      productVersion: "0.1.0",
      calculationEvidenceIds: ["ev-plan"],
      participants: [makeParticipant()],
    });
    const ids = log.findings.map((f) => f.findingId);
    assert.ok(ids.includes("amb:run-1:calculation"));
    assert.ok(ids.includes("amb:run-1:stage5:reconciliation:SYN-001"));
    assert.equal(log.evidenceRefs.length, 1);
  });

  it("a bounds reconciliation records the recorded position against the justified bounds", () => {
    const built = buildReconciliationFinding({
      caseId: "00000001",
      runId: "run-1",
      productVersion: "0.1.0",
      reconciliation: {
        participantKey: "SYN-002",
        recordedMinor: 162000,
        reconstructedMinor: null,
        deltaMinor: null,
        absDeltaMinor: null,
        relDelta: null,
        denominatorFlag: null,
        withinTolerance: null,
        toleranceSetId: "tol-1",
        recordedPosition: "inside",
        boundsMinor: { min: 158400, max: 168300 },
      },
      evidence: EVIDENCED,
      pool: [makeEvidence()],
    });
    assert.ok(!("refused" in built));
    if ("refused" in built) return;
    assert.match(built.finding.findingStatement, /No comparison computed/);
    assert.match(built.finding.rationale, /recorded position inside/);
    assert.match(built.finding.rationale, /\$1584\.00.*\$1683\.00/);
  });

  it("a hypothesis ranking publishes with support classes, and a coincidence is labelled as such", () => {
    const built = buildHypothesisFinding({
      caseId: "00000001",
      runId: "run-1",
      productVersion: "0.1.0",
      participantKey: "SYN-001",
      hypotheses: [
        { code: "H15", rank: 1, supportClass: "coincidence", counterfactual: "final-monthly rounding to the nearest dollar", residualDeltaMinor: 0, evidenceFor: [], evidenceAgainst: ["No document states this rounding sequence."] },
        { code: "H2", rank: 2, supportClass: "refuted", counterfactual: "credited service +1 year", residualDeltaMinor: 5000, evidenceFor: [], evidenceAgainst: ["Service history is documented."] },
      ],
      evidence: EVIDENCED,
      pool: [makeEvidence()],
    });
    assert.ok(!("refused" in built));
    if ("refused" in built) return;
    assert.match(built.finding.findingStatement, /H15 \(rank 1, coincidence/);
    assert.match(built.finding.findingStatement, /never presented as an explanation/);
    assert.equal(built.finding.claimType, "risk");
  });
});

// ---------------------------------------------------------------------------
// 2. A statistical flag publishes as diagnostic evidence only
// ---------------------------------------------------------------------------

describe("statistical flag publishes as diagnostic evidence only", () => {
  it("claimType is risk, and the statement says it is an investigation signal, not an established fact", () => {
    const built = buildStatisticalFlagFinding({
      caseId: "00000001",
      runId: "run-1",
      productVersion: "0.1.0",
      flag: {
        flagId: "flag-1",
        participantKey: "SYN-001",
        method: "robust z-score (MAD)",
        score: "4.2",
        description: "Δ is 4.2 robust standard deviations from the cohort median",
        cohortContext: "unit-credit formula, amendment cohort 1994",
        investigated: false,
      },
      evidence: EVIDENCED,
      pool: [makeEvidence()],
    });
    assert.ok(!("refused" in built));
    if ("refused" in built) return;
    assert.equal(built.finding.claimType, "risk");
    assert.notEqual(built.finding.claimType, "fact");
    assert.notEqual(built.finding.claimType, "derived_result");
    assert.match(built.finding.findingStatement, /diagnostic investigation signal/);
    assert.match(built.finding.findingStatement, /not an established fact about the benefit/);
    assert.match(built.finding.findingStatement, /work-list entry, not a correction/);
    assert.match(built.finding.rationale, /never auto-corrected/);
  });

  it("an exception claimType is allowed; a flag never becomes a benefit amount", () => {
    const built = buildStatisticalFlagFinding({
      caseId: "00000001",
      runId: "run-1",
      productVersion: "0.1.0",
      flag: {
        flagId: "flag-2",
        participantKey: "SYN-001",
        method: "IQR fence",
        score: "outside [Q1 − 1.5×IQR, Q3 + 1.5×IQR]",
        description: "Δ outside the Tukey fences for its cohort",
        cohortContext: "unit-credit formula, amendment cohort 1994",
        investigated: true,
      },
      claimType: "exception",
      evidence: EVIDENCED,
      pool: [makeEvidence()],
    });
    assert.ok(!("refused" in built));
    if ("refused" in built) return;
    assert.equal(built.finding.claimType, "exception");
    assert.doesNotMatch(built.finding.findingStatement, /correct benefit is/);
  });
});

// ---------------------------------------------------------------------------
// 3. An unsupported assertion is not published
// ---------------------------------------------------------------------------

describe("an unsupported assertion is not published", () => {
  it("a finding with neither evidence nor an explicit exception is refused, with a blocking warning and issue", () => {
    const log = publishStage5Findings({
      run: makeRun(),
      outcome: null,
      evidence: [makeEvidence()],
      productVersion: "0.1.0",
      participants: [makeParticipant({ evidenceByKind: { reconciliation: NO_EVIDENCE } })],
    });
    assert.equal(log.findings.length, 0);
    const warning = log.warnings.find((w) => w.warningId === "refused-unsupported:amb:run-1:stage5:reconciliation:SYN-001");
    assert.ok(warning, "expected a refusal warning");
    assert.equal(warning?.severity, "blocking");
    assert.match(warning?.message ?? "", /neither cited evidence nor an explicit missing-evidence exception/);
    const issue = log.openIssues.find((i) => i.issueId === "refused-unsupported:amb:run-1:stage5:reconciliation:SYN-001");
    assert.ok(issue, "expected a refusal open issue");
    assert.equal(issue?.severity, "blocking");
    assert.equal(issue?.kind, "missing-evidence");
  });

  it("the same assertion WITH an explicit missing-evidence exception IS published, carrying the exception", () => {
    const built = buildReconciliationFinding({
      caseId: "00000001",
      runId: "run-1",
      productVersion: "0.1.0",
      reconciliation: makeParticipant().reconciliation as NonNullable<Stage5ParticipantPublication["reconciliation"]>,
      evidence: EXCEPTED,
      pool: [makeEvidence()],
    });
    assert.ok(!("refused" in built));
    if ("refused" in built) return;
    assert.deepEqual(built.finding.evidenceRefs, []);
    assert.ok(built.finding.missingEvidenceException !== null);
    assert.ok(built.issues.some((i) => i.kind === "missing-evidence"));
  });

  it("evidence ids not in the pool are dropped, never cited", () => {
    const built = buildReconciliationFinding({
      caseId: "00000001",
      runId: "run-1",
      productVersion: "0.1.0",
      reconciliation: makeParticipant().reconciliation as NonNullable<Stage5ParticipantPublication["reconciliation"]>,
      evidence: { evidenceIds: ["ev-plan", "ev-ghost"], missingEvidenceException: null },
      pool: [makeEvidence()],
    });
    assert.ok(!("refused" in built));
    if ("refused" in built) return;
    assert.deepEqual(built.finding.evidenceRefs, ["ev-plan"]);
    assert.ok(built.warnings.some((w) => w.warningId.startsWith("dropped-evidence:")));
  });

  it("findingHasEvidenceOrException is false only for an uncited finding with no exception", () => {
    const built = buildReconciliationFinding({
      caseId: "00000001",
      runId: "run-1",
      productVersion: "0.1.0",
      reconciliation: makeParticipant().reconciliation as NonNullable<Stage5ParticipantPublication["reconciliation"]>,
      evidence: EVIDENCED,
      pool: [makeEvidence()],
    });
    assert.ok(!("refused" in built));
    if ("refused" in built) return;
    assert.equal(findingHasEvidenceOrException(built.finding), true);
    assert.equal(
      findingHasEvidenceOrException({ ...built.finding, evidenceRefs: [], missingEvidenceException: null }),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. A close match publishes as an investigation signal
// ---------------------------------------------------------------------------

describe("a close match publishes as an investigation signal", () => {
  it("states the match is an investigation signal, never proof of correctness", () => {
    const built = buildCloseMatchFinding({
      caseId: "00000001",
      runId: "run-1",
      productVersion: "0.1.0",
      participantKey: "SYN-V-01",
      deltaMinor: 50,
      toleranceSetId: "tol-1",
      hypothesisSupportClass: "supported",
      hypothesisCode: "H15",
      evidence: EVIDENCED,
      pool: [makeEvidence()],
    });
    assert.ok(!("refused" in built));
    if ("refused" in built) return;
    assert.equal(built.finding.claimType, "risk");
    assert.match(built.finding.findingStatement, /Close numeric match/);
    assert.match(built.finding.findingStatement, /investigation signal, never proof of correctness/);
    assert.match(built.finding.findingStatement, /not sufficient proof/);
    assert.match(built.finding.rationale, /anti-coincidence rule/);
  });

  it("a coincidence match says so explicitly and must never move a disposition to Verified", () => {
    const built = buildCloseMatchFinding({
      caseId: "00000001",
      runId: "run-1",
      productVersion: "0.1.0",
      participantKey: "SYN-001",
      deltaMinor: 0,
      toleranceSetId: "tol-1",
      hypothesisSupportClass: "coincidence",
      hypothesisCode: "H15",
      evidence: EVIDENCED,
      pool: [makeEvidence()],
    });
    assert.ok(!("refused" in built));
    if ("refused" in built) return;
    assert.match(built.finding.findingStatement, /support class coincidence/);
    assert.match(built.finding.findingStatement, /never move a disposition to Verified/);
  });

  it("publishStage5Findings publishes the close-match finding alongside the reconciliation finding", () => {
    const log = publishStage5Findings({
      run: makeRun(),
      outcome: null,
      evidence: [makeEvidence()],
      productVersion: "0.1.0",
      participants: [
        makeParticipant({
          closeMatch: { deltaMinor: 50, toleranceSetId: "tol-1", hypothesisSupportClass: "supported", hypothesisCode: "H15" },
          evidenceByKind: { reconciliation: EVIDENCED, closeMatch: EVIDENCED },
        }),
      ],
    });
    assert.equal(log.findings.length, 2);
    assert.ok(log.findings.some((f) => f.findingId === "amb:run-1:stage5:close-match:SYN-001"));
  });
});

// ---------------------------------------------------------------------------
// 5. Missing-data and disposition-recommendation findings; the package
// ---------------------------------------------------------------------------

describe("missing-data and disposition findings; the Stage 5 package", () => {
  it("an M5 missing-data finding publishes as an exception with its class and consequence", () => {
    const built = buildMissingDataFinding({
      caseId: "00000001",
      runId: "run-1",
      productVersion: "0.1.0",
      participantKey: "SYN-I-01",
      missing: {
        item: {
          field: "Formula.governingFormula",
          missingClass: "e",
          consequence: "No exact benefit and no justified bounds; disposition Indeterminate unless another line of evidence supports acceptance.",
          resolvesBy: null,
        },
        rationale: "M5 — the missing input is load-bearing and unconstrained.",
      },
      evidence: EVIDENCED,
      pool: [makeEvidence()],
    });
    assert.ok(!("refused" in built));
    if ("refused" in built) return;
    assert.equal(built.finding.claimType, "exception");
    assert.match(built.finding.findingStatement, /class M5/);
    assert.match(built.finding.findingStatement, /never zero/);
    assert.match(built.finding.findingStatement, /No source identified that would resolve it/);
  });

  it("an M4 missing-data finding publishes as an assumption; an M3 as a risk", () => {
    const m4 = buildMissingDataFinding({
      caseId: "00000001",
      runId: "run-1",
      productVersion: "0.1.0",
      participantKey: "SYN-001",
      missing: {
        item: { field: "CompensationHistory.salaryYear 2019", missingClass: "d", consequence: "The result is labelled assumption-dependent.", resolvesBy: null },
        rationale: "M4 — no document constrains the value; an actuarial assumption is needed.",
      },
      evidence: EVIDENCED,
      pool: [makeEvidence()],
    });
    assert.ok(!("refused" in m4));
    if ("refused" in m4) return;
    assert.equal(m4.finding.claimType, "assumption");

    const m3 = buildMissingDataFinding({
      caseId: "00000001",
      runId: "run-1",
      productVersion: "0.1.0",
      participantKey: "SYN-001",
      missing: {
        item: { field: "CompensationHistory.salaryYear 2019", missingClass: "c", consequence: "Exact reconstruction is impossible; justified bounds are computed.", resolvesBy: "Payroll file" },
        rationale: "M3 — the value is unknown but constrained.",
      },
      evidence: EVIDENCED,
      pool: [makeEvidence()],
    });
    assert.ok(!("refused" in m3));
    if ("refused" in m3) return;
    assert.equal(m3.finding.claimType, "risk");
  });

  it("a disposition recommendation publishes as a draft decision finding, never approved", () => {
    const recommendation = mapDisposition(workedExampleSyn001());
    const built = buildDispositionRecommendationFinding({
      caseId: "00000001",
      runId: "run-1",
      productVersion: "0.1.0",
      recommendation,
      evidence: EVIDENCED,
      pool: [makeEvidence()],
    });
    assert.ok(!("refused" in built));
    if ("refused" in built) return;
    assert.equal(built.finding.claimType, "decision");
    assert.equal(built.finding.reviewState, "draft");
    assert.notEqual(built.finding.reviewState, "approved");
    assert.match(built.finding.findingStatement, /Recommended disposition.*verified/);
    assert.match(built.finding.findingStatement, /not an approval/);
    assert.match(built.finding.findingStatement, /no downstream effect/);
  });

  it("assembleStage5Contribution builds a draft package; approved without a recorded approval is recorded as draft (G13)", () => {
    const log = publishStage5Findings({
      run: makeRun(),
      outcome: makeExactOutcome(),
      evidence: [makeEvidence()],
      productVersion: "0.1.0",
      calculationEvidenceIds: ["ev-plan"],
      participants: [makeParticipant()],
    });
    const pkg = assembleStage5Contribution({
      caseId: "00000001",
      productVersion: "0.1.0",
      producedAt: "2026-11-12",
      publishedBy: "system",
      run: makeRun(),
      log,
    });
    assert.equal(pkg.productId, "AMB");
    assert.equal(pkg.status, "draft");
    assert.equal(pkg.sourceSnapshotId, "hash-1");
    assert.equal(pkg.calculationRunId, "run-1");
    assert.ok(pkg.findings.length >= 2);

    const claimed = assembleStage5Contribution({
      caseId: "00000001",
      productVersion: "0.1.0",
      producedAt: "2026-11-12",
      publishedBy: "system",
      run: makeRun(),
      log,
      status: "approved",
    });
    assert.equal(claimed.status, "draft");
    assert.ok(claimed.warnings.some((w) => w.warningId === "contribution-approval-missing"));
  });

  it("a full participant publication carries every Stage 5 finding kind in one log", () => {
    const log = publishStage5Findings({
      run: makeRun(),
      outcome: null,
      evidence: [makeEvidence()],
      productVersion: "0.1.0",
      participants: [
        makeParticipant({
          hypotheses: [
            { code: "H15", rank: 1, supportClass: "supported", counterfactual: "final-monthly rounding to the nearest dollar", residualDeltaMinor: 0, evidenceFor: ["Synthetic Plan A §7.3"], evidenceAgainst: [] },
          ],
          statisticalFlags: [
            { flagId: "flag-1", participantKey: "SYN-001", method: "robust z-score (MAD)", score: "0.1", description: "Δ near the cohort median", cohortContext: "unit-credit formula", investigated: true },
          ],
          missingData: [
            {
              item: { field: "CompensationHistory.salaryYear 2019", missingClass: "c", consequence: "Exact reconstruction is impossible; justified bounds are computed.", resolvesBy: "Payroll file" },
              rationale: "M3 — the value is unknown but constrained.",
            },
          ],
          dispositionRecommendation: mapDisposition(workedExampleSyn001()),
          evidenceByKind: {
            reconciliation: EVIDENCED,
            hypotheses: EVIDENCED,
            statisticalFlag: EVIDENCED,
            missingData: EVIDENCED,
            disposition: EVIDENCED,
          },
        }),
      ],
    });
    const ids = log.findings.map((f) => f.findingId);
    assert.equal(log.findings.length, 5);
    assert.ok(ids.includes("amb:run-1:stage5:reconciliation:SYN-001"));
    assert.ok(ids.includes("amb:run-1:stage5:hypotheses:SYN-001"));
    assert.ok(ids.includes("amb:run-1:stage5:statistical-flag:flag-1"));
    assert.ok(ids.some((id) => id.startsWith("amb:run-1:stage5:missing-data:SYN-001:")));
    assert.ok(ids.includes("amb:run-1:stage5:disposition:SYN-001"));
    for (const finding of log.findings) {
      assert.ok(findingHasEvidenceOrException(finding), `finding ${finding.findingId} has neither evidence nor exception`);
      assert.equal(finding.reviewState, "draft");
    }
  });
});
