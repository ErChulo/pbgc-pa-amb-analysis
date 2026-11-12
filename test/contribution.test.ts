/**
 * Unit tests for Stage 4.5 — the contribution protocol
 * (src/contribution.ts + src/publication.ts): the monoidal WorkProductLog,
 * §7.2 record types, the Image Viewer citation builder, FindingPublicationCalc
 * (publishFindings), WorkProductContributionCalc (assembleContribution), the
 * AMB data_issues placement (buildAmbDataIssuesFragment), the applicable
 * quality gates (G1, G2, G3, G5, G6, G7, G8, G9, G12, G13), and
 * publishableDetermination.
 *
 * Run with plain node + node:test (no test framework dependency):
 *   npm test            (builds with tsc, then runs node --test dist/test/)
 *
 * Synthetic data only. No live case data. The fictional participants are
 * SYN-001 (exact reconstruction) and SYN-002 (bounds / indeterminate).
 * Image Viewer numbers used here are synthetic and labelled as such, except
 * "#123", which is the confirmed format example from the R1 sample language
 * (assessment §4.4) and is used only to check the exact rendering.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AMB_PRODUCT_ID,
  CONTRIBUTION_JSON_SCHEMAS,
  CONTRIBUTION_PROTOCOL_VERSION,
  EVIDENCE_REF_JSON_SCHEMA,
  FINDING_JSON_SCHEMA,
  IMAGE_VIEWER_NUMBER_PENDING,
  NARRATIVE_FRAGMENT_JSON_SCHEMA,
  WORK_PRODUCT_CONTRIBUTION_JSON_SCHEMA,
  appendMissingImageViewerIssue,
  assembleContribution,
  buildAmbDataIssuesFragment,
  citeEvidence,
  createEmptyLog,
  dedupeCitations,
  emptyLog,
  isEmptyLog,
  isStaleContribution,
  mergeLogs,
  publishFindings,
  publishableDetermination,
  renderCitation,
  renderCitations,
} from "../src/contribution.js";
import type {
  EvidenceRef,
  Finding,
  LogWarning,
  NarrativeFragment,
  OpenIssue,
  PublishFindingsInput,
  WorkProductLog,
} from "../src/contribution.js";
import type {
  BoundsResult,
  CalculationOutcome,
  CalculationRun,
  CalculationStep,
  TypedBenefitQuantity,
} from "../src/types.js";
import type { Finding as ValidationFinding } from "../src/validation.js";
import type {
  ApprovalEvidenceSnapshot,
  DeterminationRecord,
} from "../src/determination.js";
import { makeMoney } from "../src/decimal.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Synthetic Image Viewer number, used only where a test needs a distinct
 *  known number. Labelled synthetic; never a real document number. */
const SYNTHETIC_IV_NUMBER = "999001";
const SYNTHETIC_IV_NUMBER_2 = "999002";

/** The confirmed format example from the R1 sample language: "#123". */
const FORMAT_EXAMPLE_IV_NUMBER = "123";

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
    imageViewerDocumentNumber: SYNTHETIC_IV_NUMBER,
    originalExcerpt: null,
    accessStatus: "verified",
    workProductRef: null,
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    findingId: "amb:run-1:calculation",
    caseId: "00000001",
    originatingWorkProduct: "AMB",
    originatingVersion: "0.1.0 / run-1",
    claimType: "derived_result",
    subjectScope: "participant",
    subjectIds: ["SYN-001"],
    effectivePeriod: { start: "2019-06-30", end: "2019-06-30" },
    valueAndUnits: { value: "849.50", units: "USD/month", basis: "measured dote 2019-06-30" },
    findingStatement: "Reconstructed accrued benefit is $849.50 per month for participant SYN-001.",
    rationale: "Calculation run run-1; 2 trace steps.",
    evidenceRefs: ["ev-plan"],
    missingEvidenceException: null,
    derivedFromFindingIds: [],
    reviewState: "draft",
    materiality: { material: true, rule: null },
    intendedR1Topics: ["data_issues", "benefit_formula"],
    supersedes: null,
    ...overrides,
  };
}

function makeFragment(overrides: Partial<NarrativeFragment> = {}): NarrativeFragment {
  return {
    fragmentId: "amb:run-1:fragment:data-issues",
    findingIds: ["amb:run-1:calculation"],
    targetTopicKeys: ["data_issues"],
    form: "summary",
    content: "AMB acceptance summary for SYN-001.",
    evidenceRefs: ["ev-plan"],
    inclusionState: "candidate",
    approvalState: "proposed",
    displayOrder: 0,
    conflictGroup: null,
    ...overrides,
  };
}

function makeWarning(overrides: Partial<LogWarning> = {}): LogWarning {
  return {
    warningId: "warn-1",
    message: "Synthetic warning.",
    severity: "warning",
    relatedFindingIds: [],
    relatedEvidenceIds: [],
    ...overrides,
  };
}

function makeIssue(overrides: Partial<OpenIssue> = {}): OpenIssue {
  return {
    issueId: "issue-1",
    kind: "other",
    severity: "non-blocking",
    status: "open",
    message: "Synthetic open issue.",
    relatedFindingIds: [],
    relatedEvidenceIds: [],
    relatedFragmentIds: [],
    ...overrides,
  };
}

function makeLog(overrides: Partial<WorkProductLog> = {}): WorkProductLog {
  return {
    traceEvents: [],
    findings: [],
    fragments: [],
    evidenceRefs: [],
    warnings: [],
    decisions: [],
    openIssues: [],
    ...overrides,
  };
}

function makeStep(overrides: Partial<CalculationStep> = {}): CalculationStep {
  return {
    step: 1,
    name: "base-formula",
    inputs: [{ field: "service", value: 20 }],
    output: 84950,
    ruleRef: "Synthetic Plan A §7.3",
    evidenceGrade: "fact",
    assumption: null,
    ...overrides,
  };
}

function makeBenefit(
  amountMinor: number | null,
  overrides: Partial<TypedBenefitQuantity> = {},
): TypedBenefitQuantity {
  return {
    amount: amountMinor === null ? null : makeMoney(amountMinor),
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

function makeExactOutcome(): CalculationOutcome {
  return {
    kind: "exact",
    benefit: makeBenefit(84950),
    trace: [makeStep(), makeStep({ step: 2, name: "final-monthly", output: 84950, ruleRef: "Synthetic Plan A §7.3" })],
  };
}

function makeBoundsOutcome(): CalculationOutcome {
  const minBenefit = makeBenefit(84000, { source: "bound" });
  const maxBenefit = makeBenefit(86000, { source: "bound" });
  const bounds: BoundsResult = {
    min: makeMoney(84000),
    max: makeMoney(86000),
    assumptions: ["missing compensation year at its feasible bounds"],
    derivation: {
      method: "endpoint-evaluation",
      kinkPoints: [],
      monotonicity: [{ input: "compensation year 2019", monotone: true, verifiedBy: "formula structure" }],
      feasibleRegion: "compensation year 2019 between $40,000 and $44,000",
    },
    widthAttribution: [
      {
        missingInput: "compensation year 2019",
        missingClass: "c",
        widthContribution: makeMoney(2000),
        widthShare: "1",
        couldChangeDisposition: false,
      },
    ],
    scenarios: [
      {
        name: "low-year",
        assumptions: "compensation year 2019 at $40,000",
        benefit: makeMoney(84000),
        planVersionId: null,
        formulaId: null,
        trace: [makeStep({ name: "scenario-low-year" })],
      },
      {
        name: "high-year",
        assumptions: "compensation year 2019 at $44,000",
        benefit: makeMoney(86000),
        planVersionId: null,
        formulaId: null,
        trace: null,
      },
    ],
    recordedPosition: "inside",
    minBenefit,
    maxBenefit,
  };
  return { kind: "bounds", bounds, trace: [makeStep({ name: "bounds" })] };
}

function makeIndeterminateOutcome(): CalculationOutcome {
  return {
    kind: "indeterminate",
    reason: {
      code: "unresolved-comparison-basis",
      detail: "Measurement date unresolved and governing formula version unidentified.",
      missingInputs: ["measurement date", "plan document for the era"],
      wouldResolve: ["PA benefit schedule", "plan document / amendment for the era"],
    },
    trace: [makeStep({ name: "basis-check", evidenceGrade: "unknown" })],
  };
}

function makeValidationFinding(
  overrides: Partial<ValidationFinding> = {},
): ValidationFinding {
  return {
    resultId: "val-1",
    ruleId: "S-01",
    bcvPredicateId: null,
    bcvPredicateType: null,
    ruleSource: "APP",
    participantKey: "SYN-001",
    runId: "run-1",
    recordedDate: "2026-11-12",
    fieldsExamined: ["PA_AMB"],
    actual: "PA_AMB blank",
    expected: "PA_AMB present or blank explained",
    discrepancy: "PA_AMB is blank with no explanation on file",
    severity: "Error",
    investigation: "Checked census and schedule; no schedule row traces to this participant.",
    blocksCalculation: "No",
    blocksScope: "none",
    dispositionRoute: "requires-investigation",
    outcome: "fail",
    ...overrides,
  };
}

function makeVerifiedDetermination(
  overrides: Partial<DeterminationRecord> = {},
): DeterminationRecord {
  return {
    determinationId: "det-1",
    dispositionId: "disp-1",
    participantKey: "SYN-001",
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
      hypotheses: [],
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
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<ApprovalEvidenceSnapshot> = {},
): ApprovalEvidenceSnapshot {
  return {
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
    ...overrides,
  };
}

/** Base publishFindings input: exact outcome, one verified evidence ref. */
function makePublishInput(overrides: Partial<PublishFindingsInput> = {}): PublishFindingsInput {
  return {
    run: makeRun(),
    outcome: makeExactOutcome(),
    validations: [],
    determination: null,
    evidence: [makeEvidence()],
    productVersion: "0.1.0",
    calculationEvidenceIds: ["ev-plan"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. WorkProductLog merge (spec §9.3)
// ---------------------------------------------------------------------------

describe("mergeLogs: monoid laws", () => {
  it("identity: merge(empty, x) = x and merge(x, empty) = x", () => {
    const x = makeLog({
      findings: [makeFinding()],
      fragments: [makeFragment()],
      evidenceRefs: [makeEvidence()],
      warnings: [makeWarning()],
      openIssues: [makeIssue()],
      traceEvents: [makeStep()],
    });
    assert.deepEqual(mergeLogs(emptyLog, x), x);
    assert.deepEqual(mergeLogs(x, emptyLog), x);
    assert.equal(isEmptyLog(emptyLog), true);
    assert.equal(isEmptyLog(createEmptyLog()), true);
    assert.equal(isEmptyLog(x), false);
  });

  it("associativity: merge(merge(a,b),c) = merge(a,merge(b,c))", () => {
    const a = makeLog({ findings: [makeFinding({ findingId: "f-a" })] });
    const b = makeLog({
      findings: [makeFinding({ findingId: "f-b" })],
      evidenceRefs: [makeEvidence()],
    });
    const c = makeLog({ fragments: [makeFragment()], warnings: [makeWarning()] });
    assert.deepEqual(mergeLogs(mergeLogs(a, b), c), mergeLogs(a, mergeLogs(b, c)));
  });

  it("associativity still holds across a three-way conflict", () => {
    const a = makeLog({ findings: [makeFinding({ findingStatement: "Version A." })] });
    const b = makeLog({ findings: [makeFinding({ findingStatement: "Version B." })] });
    const c = makeLog({ findings: [makeFinding({ findingStatement: "Version C." })] });
    const left = mergeLogs(mergeLogs(a, b), c);
    const right = mergeLogs(a, mergeLogs(b, c));
    assert.deepEqual(left, right);
    assert.equal(left.findings.length, 1);
    assert.equal(left.findings[0]?.reviewState, "disputed");
  });

  it("deterministic ordering: first-seen order, and merge(b,a) reverses it", () => {
    const a = makeLog({ findings: [makeFinding({ findingId: "f-a" })] });
    const b = makeLog({ findings: [makeFinding({ findingId: "f-b" })] });
    assert.deepEqual(
      mergeLogs(a, b).findings.map((f) => f.findingId),
      ["f-a", "f-b"],
    );
    assert.deepEqual(
      mergeLogs(b, a).findings.map((f) => f.findingId),
      ["f-b", "f-a"],
    );
  });

  it("deduplication: an exact duplicate (same id + version, same content) appears once", () => {
    const a = makeLog({ findings: [makeFinding()], evidenceRefs: [makeEvidence()] });
    const b = makeLog({ findings: [makeFinding()], evidenceRefs: [makeEvidence()] });
    const merged = mergeLogs(a, b);
    assert.equal(merged.findings.length, 1);
    assert.equal(merged.evidenceRefs.length, 1);
    assert.equal(merged.openIssues.length, 0);
  });

  it("deduplication: identical trace steps appear once; distinct steps are both kept", () => {
    const a = makeLog({ traceEvents: [makeStep()] });
    const b = makeLog({ traceEvents: [makeStep(), makeStep({ step: 2, name: "final-monthly" })] });
    const merged = mergeLogs(a, b);
    assert.equal(merged.traceEvents.length, 2);
  });

  it("conflict: same finding id + version, different content keeps the first, marks it disputed, adds a blocking conflict issue", () => {
    const a = makeLog({ findings: [makeFinding({ findingStatement: "First statement." })] });
    const b = makeLog({ findings: [makeFinding({ findingStatement: "Conflicting statement." })] });
    const merged = mergeLogs(a, b);
    assert.equal(merged.findings.length, 1);
    assert.equal(merged.findings[0]?.findingStatement, "First statement.");
    assert.equal(merged.findings[0]?.reviewState, "disputed");
    const conflict = merged.openIssues.find((i) => i.kind === "conflict");
    assert.ok(conflict, "expected a conflict open issue");
    assert.equal(conflict?.severity, "blocking");
    assert.equal(conflict?.status, "open");
    assert.equal(conflict?.issueId, "conflict:finding:amb:run-1:calculation@0.1.0 / run-1");
    assert.deepEqual(conflict?.relatedFindingIds, ["amb:run-1:calculation"]);
    assert.match(conflict?.message ?? "", /neither was silently discarded/);
  });

  it("conflict: a conflicting fragment returns to candidate and raises a blocking issue", () => {
    const a = makeLog({ fragments: [makeFragment({ inclusionState: "selected", content: "First." })] });
    const b = makeLog({ fragments: [makeFragment({ content: "Conflicting." })] });
    const merged = mergeLogs(a, b);
    assert.equal(merged.fragments.length, 1);
    assert.equal(merged.fragments[0]?.content, "First.");
    assert.equal(merged.fragments[0]?.inclusionState, "candidate");
    const conflict = merged.openIssues.find((i) => i.kind === "conflict");
    assert.equal(conflict?.severity, "blocking");
    assert.equal(conflict?.issueId, "conflict:fragment:amb:run-1:fragment:data-issues");
  });

  it("conflict: a conflicting evidence record keeps the first and raises a blocking issue", () => {
    const a = makeLog({ evidenceRefs: [makeEvidence({ title: "Synthetic Plan A" })] });
    const b = makeLog({ evidenceRefs: [makeEvidence({ title: "Different title" })] });
    const merged = mergeLogs(a, b);
    assert.equal(merged.evidenceRefs.length, 1);
    assert.equal(merged.evidenceRefs[0]?.title, "Synthetic Plan A");
    assert.equal(merged.openIssues.filter((i) => i.kind === "conflict").length, 1);
  });

  it("no silent discard: a repeated merge never duplicates the conflict issue", () => {
    const a = makeLog({ findings: [makeFinding({ findingStatement: "First." })] });
    const b = makeLog({ findings: [makeFinding({ findingStatement: "Second." })] });
    const once = mergeLogs(a, b);
    const twice = mergeLogs(once, b);
    assert.equal(twice.openIssues.filter((i) => i.kind === "conflict").length, 1);
    assert.equal(twice.findings.length, 1);
  });

  it("supersession is not a conflict: different versions of one finding are both kept", () => {
    const v1 = makeFinding({ originatingVersion: "0.1.0 / run-1", reviewState: "approved" });
    const v2 = makeFinding({
      originatingVersion: "0.1.0 / run-2",
      findingStatement: "Revised statement.",
      supersedes: "amb:run-1:calculation",
    });
    const merged = mergeLogs(makeLog({ findings: [v1] }), makeLog({ findings: [v2] }));
    assert.equal(merged.findings.length, 2);
    assert.equal(merged.openIssues.filter((i) => i.kind === "conflict").length, 0);
    const keptV1 = merged.findings.find((f) => f.originatingVersion === "0.1.0 / run-1");
    assert.equal(keptV1?.reviewState, "approved");
    assert.equal(merged.findings.find((f) => f.originatingVersion === "0.1.0 / run-2")?.supersedes, "amb:run-1:calculation");
  });

  it("mergeLogs does not mutate either input", () => {
    const a = makeLog({ findings: [makeFinding({ findingStatement: "First." })] });
    const b = makeLog({ findings: [makeFinding({ findingStatement: "Second." })] });
    const beforeA = JSON.stringify(a);
    const beforeB = JSON.stringify(b);
    mergeLogs(a, b);
    assert.equal(JSON.stringify(a), beforeA);
    assert.equal(JSON.stringify(b), beforeB);
  });
});

// ---------------------------------------------------------------------------
// 2. Record types: validation, review lifecycle, supersedes links
// ---------------------------------------------------------------------------

describe("record types (§7.2)", () => {
  it("protocol version is 0.1.0 and AMB product id is AMB", () => {
    assert.equal(CONTRIBUTION_PROTOCOL_VERSION, "0.1.0");
    assert.equal(AMB_PRODUCT_ID, "AMB");
  });

  it("JSON Schemas list the required fields for every record type", () => {
    assert.deepEqual(Object.keys(CONTRIBUTION_JSON_SCHEMAS).sort(), [
      "EvidenceRef",
      "Finding",
      "NarrativeFragment",
      "WorkProductContribution",
    ]);
    for (const required of [
      "findingId",
      "caseId",
      "originatingWorkProduct",
      "originatingVersion",
      "claimType",
      "subjectScope",
      "findingStatement",
      "rationale",
      "evidenceRefs",
      "reviewState",
      "materiality",
      "intendedR1Topics",
    ]) {
      assert.ok(FINDING_JSON_SCHEMA.required.includes(required), `Finding schema missing ${required}`);
    }
    for (const required of ["evidenceId", "documentId", "location", "sourceKind", "title", "imageViewerDocumentNumber", "accessStatus"]) {
      assert.ok(EVIDENCE_REF_JSON_SCHEMA.required.includes(required), `EvidenceRef schema missing ${required}`);
    }
    for (const required of ["fragmentId", "findingIds", "targetTopicKeys", "form", "content", "inclusionState", "approvalState", "displayOrder"]) {
      assert.ok(NARRATIVE_FRAGMENT_JSON_SCHEMA.required.includes(required), `NarrativeFragment schema missing ${required}`);
    }
    for (const required of ["productId", "productVersion", "caseId", "producedAt", "publishedBy", "sourceSnapshotId", "status", "findings", "fragments", "citations", "warnings", "requiredFollowups", "downstreamDependencies"]) {
      assert.ok(WORK_PRODUCT_CONTRIBUTION_JSON_SCHEMA.required.includes(required), `Contribution schema missing ${required}`);
    }
  });

  it("an uncited finding without an explicit missing-evidence exception is never published as fact", () => {
    // publishFindings is the only publisher: every finding it emits carries
    // either evidence or an explicit exception — never neither.
    const log = publishFindings(makePublishInput({ calculationEvidenceIds: [] }));
    for (const finding of log.findings) {
      const cited = finding.evidenceRefs.length > 0;
      const excepted = finding.missingEvidenceException !== null;
      assert.ok(cited || excepted, `finding ${finding.findingId} has neither evidence nor exception`);
      if (!cited) {
        assert.match(finding.missingEvidenceException ?? "", /No EvidenceRef supplied/);
        // And it is never presented as an established fact: it stays draft.
        assert.equal(finding.reviewState, "draft");
      }
    }
  });

  it("reviewState lifecycle: publication starts draft; a merge conflict moves a finding to disputed, never to approved", () => {
    const published = publishFindings(makePublishInput());
    assert.equal(published.findings[0]?.reviewState, "draft");
    const conflicting = makeLog({
      findings: [makeFinding({ findingStatement: "A different statement." })],
    });
    const merged = mergeLogs(published, conflicting);
    assert.equal(merged.findings[0]?.reviewState, "disputed");
    assert.notEqual(merged.findings[0]?.reviewState, "approved");
  });

  it("supersedes links are preserved through a merge", () => {
    const v2 = makeFinding({
      findingId: "amb:run-1:calculation:v2",
      originatingVersion: "0.1.0 / run-2",
      supersedes: "amb:run-1:calculation",
    });
    const merged = mergeLogs(
      makeLog({ findings: [makeFinding({ reviewState: "superseded" })] }),
      makeLog({ findings: [v2] }),
    );
    assert.equal(merged.findings.find((f) => f.findingId === "amb:run-1:calculation:v2")?.supersedes, "amb:run-1:calculation");
    assert.equal(merged.findings.find((f) => f.findingId === "amb:run-1:calculation")?.reviewState, "superseded");
  });
});

// ---------------------------------------------------------------------------
// 3. Citation builder (§7.4)
// ---------------------------------------------------------------------------

describe("citation builder", () => {
  it('renders the confirmed format exactly: "Image Viewer Document #123"', () => {
    const ref = makeEvidence({
      imageViewerDocumentNumber: FORMAT_EXAMPLE_IV_NUMBER,
      location: { kind: "json-path", fileName: "synthetic.json", path: "$.plan" },
    });
    assert.equal(renderCitation(ref), "Image Viewer Document #123");
  });

  it('renders ", page 5" when a page number is known', () => {
    assert.equal(renderCitation(makeEvidence()), "Image Viewer Document #999001, page 5");
  });

  it("renders the page from a document-section location when its page is known", () => {
    const ref = makeEvidence({
      location: { kind: "document-section", fileName: "Synthetic Plan A.pdf", section: "§7.3", page: 12 },
    });
    assert.equal(renderCitation(ref), "Image Viewer Document #999001, page 12");
  });

  it("renders no page for a spreadsheet-cell location", () => {
    const ref = makeEvidence({
      location: { kind: "spreadsheet-cell", fileName: "census.xlsx", sheet: "Census", row: 3, cell: "C3", columnHeader: "PA_AMB" },
    });
    assert.equal(renderCitation(ref), "Image Viewer Document #999001");
  });

  it("unknown number renders as pending and citeEvidence records a blocking open issue", () => {
    const ref = makeEvidence({ imageViewerDocumentNumber: null });
    assert.equal(renderCitation(ref), IMAGE_VIEWER_NUMBER_PENDING);
    assert.equal(renderCitation(ref), "Image Viewer document number pending");
    const { citation, log } = citeEvidence(createEmptyLog(), ref);
    assert.equal(citation, "Image Viewer document number pending");
    assert.equal(log.openIssues.length, 1);
    const issue = log.openIssues[0];
    assert.equal(issue?.issueId, "missing-image-viewer-number:ev-plan");
    assert.equal(issue?.kind, "missing-image-viewer-number");
    assert.equal(issue?.severity, "blocking");
    assert.equal(issue?.status, "open");
    assert.deepEqual(issue?.relatedEvidenceIds, ["ev-plan"]);
  });

  it("an empty-string number is treated as unknown, never rendered as '#'", () => {
    assert.equal(renderCitation(makeEvidence({ imageViewerDocumentNumber: "" })), "Image Viewer document number pending");
  });

  it("a non-material citation with an unknown number records no issue", () => {
    const ref = makeEvidence({ imageViewerDocumentNumber: null });
    const { log } = citeEvidence(createEmptyLog(), ref, { material: false });
    assert.equal(log.openIssues.length, 0);
    const untouched = appendMissingImageViewerIssue(createEmptyLog(), ref, { material: false });
    assert.equal(untouched.openIssues.length, 0);
  });

  it("appendMissingImageViewerIssue is a no-op when the number is known, and never duplicates an issue", () => {
    assert.deepEqual(appendMissingImageViewerIssue(createEmptyLog(), makeEvidence()), createEmptyLog());
    const ref = makeEvidence({ imageViewerDocumentNumber: null });
    const once = appendMissingImageViewerIssue(createEmptyLog(), ref);
    const twice = appendMissingImageViewerIssue(once, ref);
    assert.equal(twice.openIssues.length, 1);
    // Distinct citations get distinct issues.
    const other = makeEvidence({ evidenceId: "ev-other", imageViewerDocumentNumber: null });
    assert.equal(appendMissingImageViewerIssue(once, other).openIssues.length, 2);
  });

  it("no invented numbers: every generated citation contains only a number present in the input evidence", () => {
    const knownNumbers = [FORMAT_EXAMPLE_IV_NUMBER, SYNTHETIC_IV_NUMBER, SYNTHETIC_IV_NUMBER_2, "007"];
    const refs = [
      ...knownNumbers.map((n, i) =>
        makeEvidence({ evidenceId: `ev-${i}`, imageViewerDocumentNumber: n, location: { kind: "json-path" as const, fileName: "s.json", path: "$" } }),
      ),
      makeEvidence({ evidenceId: "ev-unknown", imageViewerDocumentNumber: null }),
    ];
    for (const ref of refs) {
      const rendered = renderCitation(ref);
      if (ref.imageViewerDocumentNumber === null) {
        assert.equal(rendered, IMAGE_VIEWER_NUMBER_PENDING);
        assert.doesNotMatch(rendered, /#\d/);
      } else {
        assert.equal(rendered, `Image Viewer Document #${ref.imageViewerDocumentNumber}`);
        assert.ok(knownNumbers.includes(ref.imageViewerDocumentNumber));
      }
    }
  });

  it("the document number is rendered exactly as recorded, including a leading zero", () => {
    const ref = makeEvidence({
      imageViewerDocumentNumber: "007",
      location: { kind: "json-path", fileName: "s.json", path: "$" },
    });
    assert.equal(renderCitation(ref), "Image Viewer Document #007");
  });

  it("dedupeCitations collapses identical references but preserves distinct page citations for the same document", () => {
    const samePassageTwice = [
      makeEvidence({ evidenceId: "ev-a" }),
      makeEvidence({ evidenceId: "ev-b" }),
    ];
    assert.equal(dedupeCitations(samePassageTwice).length, 1);
    assert.equal(dedupeCitations(samePassageTwice)[0]?.evidenceId, "ev-a");
    const twoPages = [
      makeEvidence({ evidenceId: "ev-p5" }),
      makeEvidence({
        evidenceId: "ev-p9",
        location: { kind: "pdf-page", fileName: "Synthetic Plan A.pdf", page: 9, section: "§8.1", quote: null },
      }),
    ];
    assert.equal(dedupeCitations(twoPages).length, 2);
    const twoCells = [
      makeEvidence({
        evidenceId: "ev-c3",
        location: { kind: "spreadsheet-cell", fileName: "census.xlsx", sheet: "Census", row: 3, cell: "C3", columnHeader: "PA_AMB" },
      }),
      makeEvidence({
        evidenceId: "ev-c4",
        location: { kind: "spreadsheet-cell", fileName: "census.xlsx", sheet: "Census", row: 4, cell: "C4", columnHeader: "PA_AMB" },
      }),
    ];
    assert.equal(dedupeCitations(twoCells).length, 2);
  });

  it("renderCitations deduplicates identical references in first-seen order", () => {
    const refs = [
      makeEvidence({ evidenceId: "ev-a" }),
      makeEvidence({ evidenceId: "ev-b" }),
      makeEvidence({
        evidenceId: "ev-c",
        imageViewerDocumentNumber: SYNTHETIC_IV_NUMBER_2,
        location: { kind: "json-path", fileName: "s.json", path: "$" },
      }),
    ];
    assert.deepEqual(renderCitations(refs), [
      "Image Viewer Document #999001, page 5",
      "Image Viewer Document #999002",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4. publishFindings — FindingPublicationCalc (§2.9)
// ---------------------------------------------------------------------------

describe("publishFindings: exact outcome", () => {
  it("exact outcome publishes exactly one derived_result finding with evidence", () => {
    const log = publishFindings(makePublishInput());
    assert.equal(log.findings.length, 1);
    const finding = log.findings[0];
    assert.equal(finding?.findingId, "amb:run-1:calculation");
    assert.equal(finding?.claimType, "derived_result");
    assert.equal(finding?.originatingWorkProduct, "AMB");
    assert.equal(finding?.originatingVersion, "0.1.0 / run-1");
    assert.deepEqual(finding?.evidenceRefs, ["ev-plan"]);
    assert.equal(finding?.missingEvidenceException, null);
    assert.equal(finding?.valueAndUnits.value, "849.5");
    assert.equal(finding?.valueAndUnits.units, "USD/month");
    assert.equal(finding?.reviewState, "draft");
    assert.deepEqual(finding?.subjectIds, ["SYN-001"]);
    assert.deepEqual(finding?.intendedR1Topics, ["data_issues", "benefit_formula"]);
    assert.match(finding?.findingStatement ?? "", /\$849\.50/);
    assert.match(finding?.findingStatement ?? "", /SYN-001/);
    // The trace is carried on the log.
    assert.equal(log.traceEvents.length, 2);
    // The evidence pool is carried on the log.
    assert.deepEqual(log.evidenceRefs.map((e) => e.evidenceId), ["ev-plan"]);
  });

  it("exact outcome with no evidence carries a missing-evidence exception and a blocking missing-evidence issue", () => {
    const log = publishFindings(makePublishInput({ calculationEvidenceIds: [] }));
    const finding = log.findings[0];
    assert.deepEqual(finding?.evidenceRefs, []);
    assert.ok(finding?.missingEvidenceException !== null);
    assert.match(finding?.missingEvidenceException ?? "", /calculation trace/);
    const issue = log.openIssues.find((i) => i.kind === "missing-evidence");
    assert.equal(issue?.severity, "blocking");
    assert.equal(issue?.issueId, "missing-evidence:amb:run-1:calculation");
  });

  it("exact outcome with a blank amount states 'no amount recorded', never zero", () => {
    const outcome: CalculationOutcome = {
      kind: "exact",
      benefit: makeBenefit(null),
      trace: [makeStep()],
    };
    const log = publishFindings(makePublishInput({ outcome }));
    assert.match(log.findings[0]?.findingStatement ?? "", /has no amount for participant SYN-001/);
    assert.equal(log.findings[0]?.valueAndUnits.value, "no amount recorded");
  });
});

describe("publishFindings: bounds outcome", () => {
  it("bounds outcome publishes one range finding plus one assumption finding per named scenario", () => {
    const log = publishFindings(makePublishInput({ outcome: makeBoundsOutcome() }));
    assert.equal(log.findings.length, 3);
    const [range, low, high] = log.findings;
    assert.equal(range?.claimType, "derived_result");
    assert.equal(range?.valueAndUnits.value, "840 to 860");
    assert.match(range?.findingStatement ?? "", /between \$840\.00 and \$860\.00/);
    assert.match(range?.findingStatement ?? "", /recorded PA_AMB is inside/);
    assert.equal(low?.claimType, "assumption");
    assert.equal(low?.findingId, "amb:run-1:scenario:low-year");
    assert.deepEqual(low?.derivedFromFindingIds, ["amb:run-1:calculation"]);
    assert.match(low?.findingStatement ?? "", /Under scenario "low-year"/);
    assert.equal(high?.claimType, "assumption");
    assert.equal(high?.findingId, "amb:run-1:scenario:high-year");
    assert.deepEqual(high?.derivedFromFindingIds, ["amb:run-1:calculation"]);
  });

  it("a scenario with no per-scenario trace gets a trace-missing warning; a traced scenario does not", () => {
    const log = publishFindings(makePublishInput({ outcome: makeBoundsOutcome() }));
    const missing = log.warnings.find((w) => w.warningId === "scenario-trace-missing:amb:run-1:scenario:high-year");
    assert.ok(missing, "expected a trace-missing warning for the high-year scenario");
    assert.equal(missing?.severity, "warning");
    assert.match(missing?.message ?? "", /no per-scenario derivation trace/);
    assert.equal(
      log.warnings.find((w) => w.warningId === "scenario-trace-missing:amb:run-1:scenario:low-year"),
      undefined,
    );
  });
});

describe("publishFindings: indeterminate outcome", () => {
  it("indeterminate outcome publishes exactly one exception finding", () => {
    const log = publishFindings(makePublishInput({ outcome: makeIndeterminateOutcome() }));
    assert.equal(log.findings.length, 1);
    const finding = log.findings[0];
    assert.equal(finding?.claimType, "exception");
    assert.equal(finding?.valueAndUnits.value, "indeterminate");
    assert.match(finding?.findingStatement ?? "", /could not be reconstructed/);
    assert.match(finding?.rationale ?? "", /unresolved-comparison-basis/);
    assert.match(finding?.rationale ?? "", /PA benefit schedule/);
    assert.deepEqual(finding?.intendedR1Topics, ["data_issues"]);
  });
});

describe("publishFindings: validation findings", () => {
  it("each fail / not-applicable / not-run validation becomes one exception finding carrying rule, outcome and discrepancy", () => {
    const validations = [
      makeValidationFinding({ resultId: "val-1", outcome: "fail" }),
      makeValidationFinding({ resultId: "val-2", ruleId: "P-03", outcome: "not-applicable", participantKey: null }),
      makeValidationFinding({ resultId: "val-3", ruleId: "S-05", outcome: "not-run" }),
    ];
    const log = publishFindings(makePublishInput({ validations }));
    // 1 calculation finding + 3 validation findings.
    assert.equal(log.findings.length, 4);
    const byId = new Map(log.findings.map((f) => [f.findingId, f]));
    const v1 = byId.get("amb:run-1:validation:val-1");
    assert.equal(v1?.claimType, "exception");
    assert.match(v1?.findingStatement ?? "", /S-01 fail/);
    assert.match(v1?.findingStatement ?? "", /PA_AMB is blank/);
    assert.equal(v1?.valueAndUnits.basis, "rule S-01");
    assert.equal(v1?.subjectScope, "participant");
    const v2 = byId.get("amb:run-1:validation:val-2");
    assert.equal(v2?.subjectScope, "plan");
    assert.deepEqual(v2?.subjectIds, []);
    assert.equal(byId.get("amb:run-1:validation:val-3")?.claimType, "exception");
    // Validation findings carry a missing-evidence exception naming the rule-check record.
    for (const id of ["val-1", "val-2", "val-3"]) {
      const f = byId.get(`amb:run-1:validation:${id}`);
      assert.deepEqual(f?.evidenceRefs, []);
      assert.match(f?.missingEvidenceException ?? "", new RegExp(`validation record ${id}`));
      assert.match(f?.missingEvidenceException ?? "", /rule-check record is the evidence of the check/);
    }
  });

  it("a validation finding with supplied evidence cites it and carries no exception", () => {
    const log = publishFindings(
      makePublishInput({
        validations: [makeValidationFinding()],
        validationEvidenceIds: { "val-1": ["ev-plan"] },
      })
    );
    const v = log.findings.find((f) => f.findingId === "amb:run-1:validation:val-1");
    assert.deepEqual(v?.evidenceRefs, ["ev-plan"]);
    assert.equal(v?.missingEvidenceException, null);
  });
});

describe("publishFindings: determination finding and dropped evidence", () => {
  it("determination without a recorded approval publishes a draft decision finding deriving from the calculation", () => {
    const log = publishFindings(makePublishInput({ determination: makeVerifiedDetermination() }));
    assert.equal(log.findings.length, 2);
    const det = log.findings.find((f) => f.findingId === "amb:run-1:determination:det-1");
    assert.equal(det?.claimType, "decision");
    assert.equal(det?.reviewState, "draft");
    assert.deepEqual(det?.derivedFromFindingIds, ["amb:run-1:calculation"]);
    assert.match(det?.findingStatement ?? "", /"verified"/);
    assert.match(det?.findingStatement ?? "", /PA_AMB_ACCEPT Y/);
    assert.match(det?.rationale ?? "", /no approval recorded/);
    // Supporting document matched by documentId against the pool.
    assert.deepEqual(det?.evidenceRefs, ["ev-plan"]);
    assert.equal(det?.missingEvidenceException, null);
    // The decision is recorded on the log.
    assert.equal(log.decisions.length, 1);
    assert.equal(log.decisions[0]?.decisionId, "amb:run-1:decision:det-1");
    assert.equal(log.decisions[0]?.decidedBy, "A. Actuary");
  });

  it("determination with a recorded approvalId publishes an approved decision finding (G13)", () => {
    const det = makeVerifiedDetermination({
      humanDetermination: {
        disposition: "verified",
        rationale:
          "Independent reconstruction $849.50; recorded $850.00; $0.50 difference is the plan's documented final-monthly rounding to the nearest dollar; no other discrepancy.",
        reviewer: "A. Actuary",
        reviewerRole: "case actuary",
        determinationDate: "2026-11-12",
        approvalId: "appr-1",
      },
    });
    const log = publishFindings(makePublishInput({ determination: det }));
    const finding = log.findings.find((f) => f.findingId === "amb:run-1:determination:det-1");
    assert.equal(finding?.reviewState, "approved");
    assert.match(finding?.rationale ?? "", /approval appr-1 recorded/);
  });

  it("a frozen determination snapshot is cited in the determination finding rationale", () => {
    const log = publishFindings(
      makePublishInput({ determination: makeVerifiedDetermination(), determinationSnapshot: makeSnapshot() })
    );
    const finding = log.findings.find((f) => f.findingId === "amb:run-1:determination:det-1");
    assert.match(finding?.rationale ?? "", /frozen evidence snapshot snap-1/);
    assert.match(finding?.rationale ?? "", /input snapshot hash-1/);
  });

  it("evidence ids not in the supplied pool are dropped (never cited) with a blocking warning and a missing-evidence issue", () => {
    const log = publishFindings(
      makePublishInput({ calculationEvidenceIds: ["ev-plan", "ev-ghost", "ev-also-ghost"] }),
    );
    const finding = log.findings[0];
    assert.deepEqual(finding?.evidenceRefs, ["ev-plan"]);
    const warning = log.warnings.find((w) => w.warningId === "dropped-evidence:amb:run-1:calculation");
    assert.ok(warning, "expected a dropped-evidence warning");
    assert.equal(warning?.severity, "blocking");
    assert.match(warning?.message ?? "", /ev-ghost/);
    assert.match(warning?.message ?? "", /ev-also-ghost/);
    assert.match(warning?.message ?? "", /not in the supplied evidence pool/);
  });

  it("when every requested evidence id is dropped, the finding still carries a missing-evidence exception, never an uncited fact", () => {
    const log = publishFindings(makePublishInput({ calculationEvidenceIds: ["ev-ghost"] }));
    const finding = log.findings[0];
    assert.deepEqual(finding?.evidenceRefs, []);
    assert.ok(finding?.missingEvidenceException !== null);
    assert.equal(log.warnings.filter((w) => w.severity === "blocking").length, 1);
    assert.ok(log.openIssues.some((i) => i.kind === "missing-evidence" && i.severity === "blocking"));
  });

  it("a material cited reference with an unknown Image Viewer number adds a blocking missing-number issue", () => {
    const pending = makeEvidence({ imageViewerDocumentNumber: null });
    const log = publishFindings(
      makePublishInput({ evidence: [pending], calculationEvidenceIds: ["ev-plan"] }),
    );
    const issue = log.openIssues.find((i) => i.kind === "missing-image-viewer-number");
    assert.equal(issue?.severity, "blocking");
    assert.equal(issue?.issueId, "missing-image-viewer-number:ev-plan");
  });

  it("a non-material finding with an unknown Image Viewer number adds no missing-number issue", () => {
    const pending = makeEvidence({ imageViewerDocumentNumber: null });
    const log = publishFindings(
      makePublishInput({ evidence: [pending], calculationEvidenceIds: ["ev-plan"], material: false })
    );
    assert.equal(log.openIssues.filter((i) => i.kind === "missing-image-viewer-number").length, 0);
  });
});

// ---------------------------------------------------------------------------
// 5. assembleContribution — WorkProductContributionCalc (§2.10)
// ---------------------------------------------------------------------------

describe("assembleContribution", () => {
  function assembled(overrides: Record<string, unknown> = {}) {
    const run = makeRun();
    const log = publishFindings(makePublishInput());
    return {
      run,
      log,
      pkg: assembleContribution({
        caseId: "00000001",
        productVersion: "0.1.0",
        producedAt: "2026-11-12",
        publishedBy: "A. Actuary",
        run,
        log,
        ...overrides,
      }),
    };
  }

  it("builds a versioned package with the right product, snapshot, run, status and downstream", () => {
    const { pkg } = assembled();
    assert.equal(pkg.productId, "AMB");
    assert.equal(pkg.productVersion, "0.1.0");
    assert.equal(pkg.caseId, "00000001");
    assert.equal(pkg.producedAt, "2026-11-12");
    assert.equal(pkg.publishedBy, "A. Actuary");
    assert.equal(pkg.sourceSnapshotId, "hash-1");
    assert.equal(pkg.calculationRunId, "run-1");
    assert.equal(pkg.status, "draft");
    assert.deepEqual(pkg.downstreamDependencies, ["R1"]);
    assert.equal(pkg.findings.length, 1);
    assert.equal(pkg.citations.length, 1);
    assert.equal(pkg.citations[0]?.evidenceId, "ev-plan");
    assert.deepEqual(pkg.requiredFollowups, []);
  });

  it("determinism (G12): same inputs give the same package", () => {
    const first = assembled().pkg;
    const second = assembled().pkg;
    assert.deepEqual(second, first);
    assert.equal(JSON.stringify(second), JSON.stringify(first));
  });

  it("citations carry only evidence actually cited by findings or fragments (G7)", () => {
    const run = makeRun();
    const uncited = makeEvidence({ evidenceId: "ev-uncited", documentId: "doc-other" });
    const log = publishFindings(makePublishInput({ evidence: [makeEvidence(), uncited] }));
    const pkg = assembleContribution({
      caseId: "00000001",
      productVersion: "0.1.0",
      producedAt: "2026-11-12",
      publishedBy: "system",
      run,
      log,
    });
    assert.deepEqual(pkg.citations.map((c) => c.evidenceId), ["ev-plan"]);
  });

  it("requested status 'approved' without a recorded approval is recorded as 'draft' with a blocking warning (G13)", () => {
    const { pkg } = assembled({ status: "approved" });
    assert.equal(pkg.status, "draft");
    const warning = pkg.warnings.find((w) => w.warningId === "contribution-approval-missing");
    assert.ok(warning, "expected an approval-missing warning");
    assert.equal(warning?.severity, "blocking");
    assert.match(warning?.message ?? "", /without a recorded approval/);
    assert.match(warning?.message ?? "", /No approval is claimed/);
  });

  it("requested status 'approved' with a recorded approval is honoured", () => {
    const { pkg } = assembled({
      status: "approved",
      approval: { approvalId: "appr-1", reviewer: "A. Actuary" },
    });
    assert.equal(pkg.status, "approved");
    assert.equal(pkg.warnings.find((w) => w.warningId === "contribution-approval-missing"), undefined);
  });

  it("requiredFollowups default to the messages of the log's open blocking issues", () => {
    const run = makeRun();
    const log = publishFindings(makePublishInput({ calculationEvidenceIds: [] }));
    assert.ok(log.openIssues.some((i) => i.severity === "blocking"));
    const pkg = assembleContribution({
      caseId: "00000001",
      productVersion: "0.1.0",
      producedAt: "2026-11-12",
      publishedBy: "system",
      run,
      log,
    });
    assert.ok(pkg.requiredFollowups.length > 0);
    for (const followup of pkg.requiredFollowups) {
      assert.ok(log.openIssues.some((i) => i.severity === "blocking" && i.message === followup));
    }
  });

  it("isStaleContribution (G9): same snapshot + run is fresh; a changed snapshot or run is stale", () => {
    const { pkg, run } = assembled();
    assert.equal(isStaleContribution(pkg, run), false);
    assert.equal(isStaleContribution(pkg, makeRun({ inputSnapshotHash: "hash-2" })), true);
    assert.equal(isStaleContribution(pkg, makeRun({ runId: "run-2" })), true);
    // A product-version bump alone does not make the package stale.
    const bumped = { ...pkg, productVersion: "0.2.0" };
    assert.equal(isStaleContribution(bumped, run), false);
  });
});

// ---------------------------------------------------------------------------
// 6. buildAmbDataIssuesFragment — the AMB acceptance placement (§8.3)
// ---------------------------------------------------------------------------

describe("buildAmbDataIssuesFragment", () => {
  function makeFragmentInput(overrides: Record<string, unknown> = {}) {
    const run = makeRun();
    const log = publishFindings(makePublishInput());
    return {
      run,
      findings: log.findings,
      evidence: [makeEvidence()],
      population: "All 42 participants with a recorded PA_AMB at DOTE.",
      dataAvailability: "Census and PA schedule available; one compensation year missing for SYN-001.",
      testingMethod: "Full-population independent reconstruction against the PA schedule.",
      differencesAndPatterns: "$0.50 difference on SYN-001, explained by final-monthly rounding; no other differences.",
      acceptanceRationale: "Independent reconstruction agrees within the documented tolerance; rounding explains the difference.",
      exceptionCounts: "0 exceptions; 0 unresolved cases.",
      reviewerDetermination: "Verified — accept PA_AMB as recorded.",
      memoRef: makeEvidence({ evidenceId: "ev-memo", documentId: "doc-memo", title: "AMB memo" }),
      workbookRef: makeEvidence({ evidenceId: "ev-workbook", documentId: "doc-workbook", title: "Tested workbook" }),
      appendixRef: makeEvidence({ evidenceId: "ev-appendix", documentId: "doc-appendix", title: "Appendix A" }),
      ...overrides,
    } as Parameters<typeof buildAmbDataIssuesFragment>[0];
  }

  it("contains all eight recommended contents", () => {
    const { fragment } = buildAmbDataIssuesFragment(makeFragmentInput());
    assert.deepEqual(fragment.targetTopicKeys, ["data_issues"]);
    assert.equal(fragment.form, "summary");
    assert.equal(fragment.inclusionState, "candidate");
    assert.equal(fragment.approvalState, "proposed");
    for (const expected of [
      "Population: All 42 participants",
      "Data availability and gaps: Census and PA schedule available",
      "Testing method: Full-population independent reconstruction",
      "Differences and observed patterns: $0.50 difference",
      "Rationale for accepting or correcting PA_AMB: Independent reconstruction agrees",
      "Exceptions and unresolved cases: 0 exceptions",
      "Reviewer determination: Verified",
      "Complete AMB memo: Image Viewer Document #999001, page 5.",
      "Tested workbook: Image Viewer Document #999001, page 5.",
      "Appendix: Image Viewer Document #999001, page 5.",
    ]) {
      assert.match(fragment.content, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing: ${expected}`);
    }
  });

  it("references the complete memo, workbook and appendix, and does not reproduce the full analysis", () => {
    const { fragment, citations } = buildAmbDataIssuesFragment(makeFragmentInput());
    assert.deepEqual(citations, [
      "Image Viewer Document #999001, page 5",
      "Image Viewer Document #999001, page 5",
      "Image Viewer Document #999001, page 5",
    ]);
    assert.match(fragment.content, /The complete AMB memo, tested workbook, and appendix are referenced above; the full AMB analysis is not reproduced here\./);
    // Structural bound: one header line + six content lines + three
    // reference lines + reviewer determination + the not-reproduced
    // sentence — the full analysis text has nowhere to go.
    assert.equal(fragment.content.split("\n").length, 12);
  });

  it("a null content is stated as not established, never invented", () => {
    const { fragment } = buildAmbDataIssuesFragment(
      makeFragmentInput({ population: null, reviewerDetermination: null }),
    );
    assert.match(fragment.content, /Population: Not established in the AMB analysis\./);
    assert.match(fragment.content, /Reviewer determination: No reviewer determination recorded\./);
  });

  it("companion benefit_formula + interpretations fragments appear only when a formula interpretation is supplied", () => {
    const without = buildAmbDataIssuesFragment(makeFragmentInput());
    assert.deepEqual(without.companionFragments, []);
    const empty = buildAmbDataIssuesFragment(makeFragmentInput({ formulaInterpretation: "   " }));
    assert.deepEqual(empty.companionFragments, []);
    const withInterpretation = buildAmbDataIssuesFragment(
      makeFragmentInput({
        formulaInterpretation: "The plan's 1.50% formula governs all service before the 2004 amendment.",
        interpretationEvidenceIds: ["ev-plan"],
      }),
    );
    assert.equal(withInterpretation.companionFragments.length, 2);
    assert.deepEqual(
      withInterpretation.companionFragments.map((f) => f.targetTopicKeys),
      [["benefit_formula"], ["interpretations"]],
    );
    for (const companion of withInterpretation.companionFragments) {
      assert.match(companion.content, /1\.50% formula governs all service/);
      assert.ok(companion.evidenceRefs.includes("ev-plan"));
    }
  });

  it("a missing memo or workbook reference is a blocking open issue; a missing appendix is non-blocking", () => {
    const { log } = buildAmbDataIssuesFragment(
      makeFragmentInput({ memoRef: null, workbookRef: null, appendixRef: null }),
    );
    const memoIssue = log.openIssues.find((i) => i.issueId.startsWith("missing-amb-reference:complete-amb-memo"));
    assert.equal(memoIssue?.severity, "blocking");
    const workbookIssue = log.openIssues.find((i) => i.issueId.startsWith("missing-amb-reference:tested-workbook"));
    assert.equal(workbookIssue?.severity, "blocking");
    const appendixIssue = log.openIssues.find((i) => i.issueId.startsWith("missing-amb-reference:appendix"));
    assert.equal(appendixIssue?.severity, "non-blocking");
  });

  it("a memo reference with an unknown Image Viewer number renders as pending and adds a blocking issue", () => {
    const pendingMemo = makeEvidence({
      evidenceId: "ev-memo",
      documentId: "doc-memo",
      title: "AMB memo",
      imageViewerDocumentNumber: null,
    });
    const { fragment, citations, log } = buildAmbDataIssuesFragment(
      makeFragmentInput({ memoRef: pendingMemo }),
    );
    assert.deepEqual(citations[0], "Image Viewer document number pending");
    assert.match(fragment.content, /Complete AMB memo: Image Viewer document number pending\./);
    assert.ok(log.openIssues.some((i) => i.kind === "missing-image-viewer-number" && i.severity === "blocking"));
  });
});

// ---------------------------------------------------------------------------
// 7. Quality gates as they apply to the AMB module (spec §10)
// ---------------------------------------------------------------------------

describe("gates (AMB-applicable only: G1, G2, G3, G5, G6, G7, G8, G9, G12, G13)", () => {
  it("G1: every material claim links to evidence or carries an explicit missing-evidence exception", () => {
    for (const outcome of [makeExactOutcome(), makeBoundsOutcome(), makeIndeterminateOutcome()]) {
      const log = publishFindings(makePublishInput({ outcome, calculationEvidenceIds: [] }));
      for (const finding of log.findings) {
        if (!finding.materiality.material) continue;
        const linked = finding.evidenceRefs.length > 0;
        const excepted = finding.missingEvidenceException !== null;
        assert.ok(linked || excepted, `G1: material finding ${finding.findingId} is uncited with no exception`);
        if (!linked) {
          assert.ok(
            log.openIssues.some((i) => i.kind === "missing-evidence" && i.relatedFindingIds.includes(finding.findingId)),
            `G1: uncited material finding ${finding.findingId} has no missing-evidence issue`,
          );
        }
      }
    }
    // And with evidence supplied, the claim is linked and no exception is needed.
    const linked = publishFindings(makePublishInput());
    assert.deepEqual(linked.findings[0]?.evidenceRefs, ["ev-plan"]);
    assert.equal(linked.findings[0]?.missingEvidenceException, null);
  });

  it("G2: cited Image Viewer numbers are verified and exactly preserved", () => {
    const ref = makeEvidence({ imageViewerDocumentNumber: SYNTHETIC_IV_NUMBER });
    const log = publishFindings(makePublishInput({ evidence: [ref] }));
    const cited = log.evidenceRefs.find((e) => e.evidenceId === "ev-plan");
    assert.equal(cited?.imageViewerDocumentNumber, SYNTHETIC_IV_NUMBER);
    assert.equal(renderCitation(cited as EvidenceRef), "Image Viewer Document #999001, page 5");
    // A number with a leading zero survives exactly.
    const zeroRef = makeEvidence({ evidenceId: "ev-zero", imageViewerDocumentNumber: "007" });
    assert.equal(renderCitation(zeroRef), "Image Viewer Document #007, page 5");
  });

  it("G3: missing numbers are explicit unresolved issues, never silent gaps", () => {
    const pending = makeEvidence({ imageViewerDocumentNumber: null });
    const { log } = citeEvidence(createEmptyLog(), pending);
    const issue = log.openIssues.find((i) => i.kind === "missing-image-viewer-number");
    assert.ok(issue);
    assert.equal(issue?.status, "open");
    assert.equal(issue?.severity, "blocking");
    assert.match(issue?.message ?? "", /never invent one/);
  });

  it("G5: no superseded finding silently replaces an approved one", () => {
    const approved = makeFinding({ reviewState: "approved" });
    const successor = makeFinding({
      findingId: "amb:run-2:calculation",
      originatingVersion: "0.1.0 / run-2",
      supersedes: "amb:run-1:calculation",
      findingStatement: "Revised reconstruction.",
    });
    const merged = mergeLogs(makeLog({ findings: [approved] }), makeLog({ findings: [successor] }));
    assert.equal(merged.findings.length, 2);
    const keptApproved = merged.findings.find((f) => f.findingId === "amb:run-1:calculation");
    assert.equal(keptApproved?.reviewState, "approved");
    assert.equal(keptApproved?.findingStatement, "Reconstructed accrued benefit is $849.50 per month for participant SYN-001.");
    assert.equal(
      merged.findings.find((f) => f.findingId === "amb:run-2:calculation")?.supersedes,
      "amb:run-1:calculation",
    );
  });

  it("G6: conflicting contributions stop silent publication and identify sources + runs", () => {
    const a = makeLog({ findings: [makeFinding({ findingStatement: "Run run-1 value: $849.50." })] });
    const b = makeLog({ findings: [makeFinding({ findingStatement: "Run run-1 value: $851.00." })] });
    const merged = mergeLogs(a, b);
    const conflict = merged.openIssues.find((i) => i.kind === "conflict");
    assert.ok(conflict);
    assert.equal(conflict?.severity, "blocking");
    assert.match(conflict?.message ?? "", /amb:run-1:calculation@0\.1\.0 \/ run-1/);
    assert.match(conflict?.message ?? "", /first entry was kept/);
    assert.equal(merged.findings[0]?.reviewState, "disputed");
    // The disputed finding is not publishable as established: it is not approved.
    assert.notEqual(merged.findings[0]?.reviewState, "approved");
  });

  it("G7: repeated facts are deduplicated without losing citations", () => {
    const a = makeLog({ findings: [makeFinding()], evidenceRefs: [makeEvidence()] });
    const b = makeLog({ findings: [makeFinding()], evidenceRefs: [makeEvidence()] });
    const merged = mergeLogs(a, b);
    assert.equal(merged.findings.length, 1);
    assert.equal(merged.evidenceRefs.length, 1);
    // Distinct page citations for the same document survive the merge.
    const page5 = makeEvidence({ evidenceId: "ev-p5" });
    const page9 = makeEvidence({
      evidenceId: "ev-p9",
      location: { kind: "pdf-page", fileName: "Synthetic Plan A.pdf", page: 9, section: "§8.1", quote: null },
    });
    const mergedPages = mergeLogs(makeLog({ evidenceRefs: [page5] }), makeLog({ evidenceRefs: [page9] }));
    assert.equal(mergedPages.evidenceRefs.length, 2);
    assert.deepEqual(renderCitations(mergedPages.evidenceRefs), [
      "Image Viewer Document #999001, page 5",
      "Image Viewer Document #999001, page 9",
    ]);
  });

  it("G8: final text distinguishes verified results, assumptions, unresolved issues and approved interpretations", () => {
    const log = publishFindings(
      makePublishInput({
        outcome: makeBoundsOutcome(),
        determination: makeVerifiedDetermination(),
      }),
    );
    const kinds = new Map(log.findings.map((f) => [f.findingId, f.claimType]));
    assert.equal(kinds.get("amb:run-1:calculation"), "derived_result");
    assert.equal(kinds.get("amb:run-1:scenario:low-year"), "assumption");
    assert.equal(kinds.get("amb:run-1:determination:det-1"), "decision");
    const indeterminate = publishFindings(makePublishInput({ outcome: makeIndeterminateOutcome() }));
    assert.equal(indeterminate.findings[0]?.claimType, "exception");
    // The fragment text marks what is not established instead of filling it in.
    const { fragment } = buildAmbDataIssuesFragment({
      run: makeRun(),
      findings: log.findings,
      evidence: [makeEvidence()],
      population: null,
      dataAvailability: null,
      testingMethod: null,
      differencesAndPatterns: null,
      acceptanceRationale: null,
      exceptionCounts: null,
      reviewerDetermination: null,
    });
    assert.match(fragment.content, /Not established in the AMB analysis\./);
    assert.match(fragment.content, /No reviewer determination recorded\./);
  });

  it("G9: a source change invalidates downstream — the old package is stale, never carried forward", () => {
    const run = makeRun();
    const log = publishFindings(makePublishInput());
    const pkg = assembleContribution({
      caseId: "00000001",
      productVersion: "0.1.0",
      producedAt: "2026-11-12",
      publishedBy: "system",
      run,
      log,
    });
    assert.equal(isStaleContribution(pkg, run), false);
    assert.equal(isStaleContribution(pkg, makeRun({ inputSnapshotHash: "hash-2", inputSnapshot: { ...run.inputSnapshot, snapshotHash: "hash-2" } })), true);
  });

  it("G12: deterministic rebuild — publishFindings and assembleContribution rebuild identically", () => {
    const firstLog = publishFindings(makePublishInput({ outcome: makeBoundsOutcome() }));
    const secondLog = publishFindings(makePublishInput({ outcome: makeBoundsOutcome() }));
    assert.deepEqual(secondLog, firstLog);
    const run = makeRun();
    const firstPkg = assembleContribution({
      caseId: "00000001",
      productVersion: "0.1.0",
      producedAt: "2026-11-12",
      publishedBy: "system",
      run,
      log: firstLog,
    });
    const secondPkg = assembleContribution({
      caseId: "00000001",
      productVersion: "0.1.0",
      producedAt: "2026-11-12",
      publishedBy: "system",
      run,
      log: secondLog,
    });
    assert.equal(JSON.stringify(secondPkg), JSON.stringify(firstPkg));
  });

  it("G13: no draft claims an unrecorded approval — determination finding and package agree", () => {
    const draftLog = publishFindings(makePublishInput({ determination: makeVerifiedDetermination() }));
    assert.equal(
      draftLog.findings.find((f) => f.claimType === "decision")?.reviewState,
      "draft",
    );
    const draftPkg = assembleContribution({
      caseId: "00000001",
      productVersion: "0.1.0",
      producedAt: "2026-11-12",
      publishedBy: "system",
      run: makeRun(),
      log: draftLog,
      status: "approved",
    });
    assert.equal(draftPkg.status, "draft");
    const approvedDet = makeVerifiedDetermination({
      humanDetermination: {
        disposition: "verified",
        rationale:
          "Independent reconstruction $849.50; recorded $850.00; $0.50 difference is the plan's documented final-monthly rounding to the nearest dollar; no other discrepancy.",
        reviewer: "A. Actuary",
        reviewerRole: "case actuary",
        determinationDate: "2026-11-12",
        approvalId: "appr-1",
      },
    });
    const approvedLog = publishFindings(makePublishInput({ determination: approvedDet }));
    assert.equal(
      approvedLog.findings.find((f) => f.claimType === "decision")?.reviewState,
      "approved",
    );
    const approvedPkg = assembleContribution({
      caseId: "00000001",
      productVersion: "0.1.0",
      producedAt: "2026-11-12",
      publishedBy: "system",
      run: makeRun(),
      log: approvedLog,
      status: "approved",
      approval: { approvalId: "appr-1", reviewer: "A. Actuary" },
    });
    assert.equal(approvedPkg.status, "approved");
  });
});

// ---------------------------------------------------------------------------
// 8. publishableDetermination — the approval hook
// ---------------------------------------------------------------------------

describe("publishableDetermination", () => {
  function approvedRecord(): DeterminationRecord {
    return makeVerifiedDetermination({
      humanDetermination: {
        disposition: "verified",
        rationale:
          "Independent reconstruction $849.50; recorded $850.00; $0.50 difference is the plan's documented final-monthly rounding to the nearest dollar; no other discrepancy.",
        reviewer: "A. Actuary",
        reviewerRole: "case actuary",
        determinationDate: "2026-11-12",
        approvalId: "appr-1",
      },
    });
  }

  it("publishable only with a complete determination, a recorded approvalId, and a frozen snapshot naming it", () => {
    const check = publishableDetermination(approvedRecord(), makeSnapshot());
    assert.equal(check.publishable, true);
    assert.deepEqual(check.reasons, []);
  });

  it("refuses without a recorded approval, with the reason naming G13", () => {
    const check = publishableDetermination(makeVerifiedDetermination(), makeSnapshot());
    assert.equal(check.publishable, false);
    assert.ok(check.reasons.some((r) => /no recorded approval/.test(r)));
    assert.ok(check.reasons.some((r) => /G13/.test(r)));
  });

  it("refuses without a frozen evidence snapshot", () => {
    const check = publishableDetermination(approvedRecord(), null);
    assert.equal(check.publishable, false);
    assert.ok(check.reasons.some((r) => /no frozen evidence snapshot/.test(r)));
  });

  it("refuses when the snapshot names a different determination", () => {
    const check = publishableDetermination(approvedRecord(), makeSnapshot({ determinationId: "det-OTHER" }));
    assert.equal(check.publishable, false);
    assert.ok(check.reasons.some((r) => /names determination det-OTHER, not det-1/.test(r)));
  });

  it("refuses an incomplete record, with full §14 reasons", () => {
    const incomplete = makeVerifiedDetermination({
      humanDetermination: {
        disposition: "verified",
        rationale: "agreed",
        reviewer: "A. Actuary",
        reviewerRole: "case actuary",
        determinationDate: "2026-11-12",
        approvalId: "appr-1",
      },
    });
    const check = publishableDetermination(incomplete, makeSnapshot());
    assert.equal(check.publishable, false);
    assert.ok(check.reasons.length > 0);
    assert.ok(check.reasons.some((r) => /§14 item/.test(r)));
  });

  it("refusal carries every applicable reason at once", () => {
    const check = publishableDetermination(makeVerifiedDetermination(), null);
    assert.equal(check.publishable, false);
    assert.ok(check.reasons.some((r) => /no recorded approval/.test(r)));
    assert.ok(check.reasons.some((r) => /no frozen evidence snapshot/.test(r)));
    assert.equal(check.reasons.length, 2);
  });
});
