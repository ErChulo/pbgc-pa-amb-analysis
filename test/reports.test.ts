/**
 * Unit tests for Stage 6 reports (src/ui/reports.ts).
 *
 * Run: npm test (tsc, then node --test dist/test/).
 * Synthetic data only. Fictional participant SYN-001.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DATA_ISSUES_ITEMS,
  renderAmbMemo,
  renderParticipantReport,
  renderPlanReport,
} from "../src/ui/reports.js";
import type { AmbMemoInput, ParticipantReportInput, PlanReportInput } from "../src/ui/reports.js";
import type { EvidenceRef, NarrativeFragment, WorkProductContribution } from "../src/contribution.js";

const REPRO = {
  inputSnapshotHash: "snap-abc123",
  ruleVersion: "rules-0.1.0",
  formulaVersion: "taxonomy-0.1.0",
  toleranceVersion: 1,
  engineVersion: "0.1.0",
};

function planInput(): PlanReportInput {
  return {
    casePackage: {
      caseNumber: "12345678",
      planName: "Harborview Manufacturing Pension Plan",
      planNumber: "001",
      dopt: "2020-06-30",
      participantCount: 100,
      completenessGrade: "partial",
    },
    validationSummary: {
      totalFindings: 4,
      bySeverity: { Error: 1, Warning: 3 },
      blockingCount: 1,
      findings: [
        { ruleId: "S-01", severity: "Error", discrepancy: "Bad date in row 5.", blocksCalculation: "Yes" },
      ],
      notes: ["Validation ran on 100 of 100 participants."],
    },
    reconciliationSummary: {
      participantsCompared: 90,
      matched: 60,
      withinTolerance: 10,
      materialDifferences: 12,
      notComparable: 5,
      indeterminate: 3,
      blankPaAmb: 10,
      meanAbsDeltaMinor: 1234,
      tolerance: "Case-set tolerance v1: $5.00/month.",
      byGroup: [{ group: "Union", count: 50, population: 90, units: "participants" }],
      notes: [],
    },
    statisticsSummary: {
      outliers: [{ label: "Modified-z outliers", count: 6, population: 90, units: "participants" }],
      outlierNotes: ["Outliers are a work list, not corrections."],
      modelDiagnostics: ["Huber model fit on 90 of 90 compared participants."],
      notes: [],
    },
    dispositions: [
      { disposition: "verified", count: 60, population: 90 },
      { disposition: "requires-investigation", count: 12, population: 90 },
    ],
    findings: [
      { findingId: "amb:run1:calculation", findingStatement: "Reconstructed benefit is $850.00 per month.", claimType: "derived_result", reviewState: "draft", material: true },
    ],
    missingData: [
      { field: "CompensationHistory.salaryYear 2019", missingClass: "b", consequence: "Recoverable from payroll.", resolvesBy: "Payroll record." },
    ],
    actions: ["Investigate the 12 material differences."],
    openQuestions: ["What is the PA measurement date for SYN-001?"],
    reproducibility: REPRO,
  };
}

const PLAN_HEADINGS = [
  "Executive summary",
  "Population and data completeness",
  "Formula and provision complexity",
  "Historical administrative data quality",
  "Validation findings",
  "Reconciliation statistics",
  "Material discrepancy counts",
  "Analysis by employment group and status",
  "Outlier analysis",
  "Statistical model diagnostics",
  "Uncertainty and missing-data analysis",
  "Recommended actuarial actions",
  "Outstanding questions and data requests",
];

describe("renderPlanReport", () => {
  it("contains every §15 plan-level section heading, in order", () => {
    const html = renderPlanReport(planInput());
    let lastIndex = -1;
    for (const heading of PLAN_HEADINGS) {
      const index = html.indexOf(`<h2>${heading}</h2>`);
      assert.ok(index > lastIndex, `missing or out-of-order heading: ${heading}`);
      lastIndex = index;
    }
  });

  it("states denominators, units, and populations for counts", () => {
    const html = renderPlanReport(planInput());
    assert.ok(html.includes("60 of 90 participants"));
    assert.ok(html.includes("12 of 90 participants"));
    assert.ok(html.includes("$12.34 per month"));
    assert.ok(html.includes("population: 90 participants compared"));
  });

  it("states reproducibility pins and escapes input text", () => {
    const input = planInput();
    input.casePackage = { ...input.casePackage, planName: "<b>Bad</b> Plan" };
    const html = renderPlanReport(input);
    assert.ok(html.includes("snap-abc123"));
    assert.ok(html.includes("rules-0.1.0"));
    assert.ok(html.includes("taxonomy-0.1.0"));
    assert.ok(html.includes("0.1.0"));
    assert.ok(!html.includes("<b>Bad</b>"));
    assert.ok(html.includes("&lt;b&gt;Bad&lt;/b&gt;"));
  });

  it("states Not supplied when a summary is absent, never invents values", () => {
    const html = renderPlanReport({ casePackage: null, reproducibility: REPRO });
    assert.ok(html.includes("Not supplied"));
    assert.ok(!html.includes("60 of 90"));
  });
});

const PARTICIPANT_HEADINGS = [
  "Relevant input data and sources",
  "Applicable plan provisions",
  "Recorded benefit and its documented basis",
  "Independent calculation trace",
  "Historical events affecting the benefit",
  "Numerical comparison",
  "Diagnostic hypotheses",
  "Missing information",
  "Recommended actuarial determination",
  "Supporting evidence and reviewer annotations",
];

function participantInput(): ParticipantReportInput {
  return {
    participant: {
      participantKey: "SYN-001",
      lastName: "Synthetic",
      firstName: "Sam",
      dob: "1960-01-15",
      sex: "M",
      retstat: "3",
      completenessGrade: "complete",
    },
    inputs: [{ field: "DOH", value: "1985-07-01", source: "Census row 2." }],
    provisions: [{ section: "§3.01", text: "Unit credit 1.5% of final average pay.", effectiveDate: "1985-07-01", formulaType: "unit-credit" }],
    recordedBenefit: {
      amountMinor: 85000,
      measurementDate: "2020-06-30",
      measurementBasis: "dote",
      annuityForm: "NSF",
      vestingTreatment: "vested",
      source: "PA schedule row 2.",
      recordedDate: "2020-07-15",
    },
    calculationTrace: [
      { step: 1, name: "credited-service", output: "30 years", ruleRef: "Plan §3.01", evidenceGrade: "fact", assumption: null },
      { step: 2, name: "final-monthly", output: "$850.00", ruleRef: "Plan §3.01", evidenceGrade: "fact", assumption: null },
    ],
    events: [{ date: "2004-01-01", event: "Amendment: accrual rate 1.5%.", effect: "Applies to service after 2004-01-01." }],
    comparison: {
      deltaMinor: 50,
      absDeltaMinor: 50,
      relDelta: "0.0006",
      withinTolerance: true,
      tolerance: "Case-set tolerance v1.",
      status: "within-tolerance",
      basis: "same-basis",
    },
    hypotheses: [
      { type: "rounding", counterfactual: "Round after each annual accrual.", status: "tested-rejected", rank: 1, evidence: "Plan §3.01." },
    ],
    missingInfo: [],
    determination: {
      disposition: "verified",
      rationale: "Reconstruction agrees within tolerance.",
      reviewer: "reviewer-1",
      determinationDate: "2026-11-12",
      paAmbAccept: "Y",
      correctedBenefitMinor: null,
    },
    evidence: [{ title: "PA schedule", citation: "Image Viewer Document #123, page 5", location: "p. 5" }],
    annotations: ["Reviewer note: check amendment date."],
    reproducibility: REPRO,
  };
}

describe("renderParticipantReport", () => {
  it("contains every §15 participant-level section heading, in order", () => {
    const html = renderParticipantReport(participantInput());
    let lastIndex = -1;
    for (const heading of PARTICIPANT_HEADINGS) {
      const index = html.indexOf(`<h2>${heading}</h2>`);
      assert.ok(index > lastIndex, `missing or out-of-order heading: ${heading}`);
      lastIndex = index;
    }
  });

  it("shows money from integer minor units; blank is never 0", () => {
    const html = renderParticipantReport(participantInput());
    assert.ok(html.includes("$850.00 USD/month"));
    assert.ok(html.includes("$0.50 USD/month"));
    const blank = participantInput();
    blank.recordedBenefit = { ...blank.recordedBenefit, amountMinor: null };
    const blankHtml = renderParticipantReport(blank);
    assert.ok(blankHtml.includes("blank (missing)"));
    assert.ok(!blankHtml.includes("$0.00 USD/month"));
  });

  it("states reproducibility pins", () => {
    const html = renderParticipantReport(participantInput());
    assert.ok(html.includes("snap-abc123"));
    assert.ok(html.includes("rules-0.1.0"));
  });
});

function evidenceRef(overrides: Partial<EvidenceRef>): EvidenceRef {
  return {
    evidenceId: "ev-1",
    documentId: "doc-1",
    location: { kind: "pdf-page", fileName: "memo.pdf", page: 5, section: "§3", quote: null },
    acquisition: "imported",
    derivation: null,
    sourceFileHash: "hash-1",
    sourceKind: "work product",
    title: "Complete AMB memo",
    versionOrDate: "2026-11-12",
    imageViewerDocumentNumber: "123",
    originalExcerpt: null,
    accessStatus: "verified",
    workProductRef: null,
    ...overrides,
  };
}

function memoInput(): AmbMemoInput {
  const fragment: NarrativeFragment = {
    fragmentId: "amb:run1:fragment:data-issues",
    findingIds: ["amb:run1:calculation"],
    targetTopicKeys: ["data_issues"],
    form: "summary",
    content: [
      "AMB acceptance — run run1, case 12345678.",
      "Population: 100 participants at DOTE.",
      "Data availability and gaps: PA schedule present; 10 blank PA_AMB.",
      "Testing method: Full-population AMB testing.",
      "Differences and observed patterns: 12 material differences, service-driven.",
      "Rationale for accepting or correcting PA_AMB: Reconstruction agrees for 60 of 90 compared.",
      "Exceptions and unresolved cases: 12 exceptions, 3 indeterminate.",
      "Complete AMB memo: Image Viewer Document #123, page 5.",
      "Tested workbook: Image Viewer Document #124.",
      "Reviewer determination: Verified for 60 of 90 compared participants.",
      "The complete AMB memo, tested workbook, and appendix are referenced above; the full AMB analysis is not reproduced here.",
    ].join("\n"),
    evidenceRefs: ["ev-1"],
    inclusionState: "candidate",
    approvalState: "proposed",
    displayOrder: 0,
    conflictGroup: null,
  };
  const contribution: WorkProductContribution = {
    productId: "AMB",
    productVersion: "0.1.0",
    caseId: "12345678",
    producedAt: "2026-11-12",
    publishedBy: "system",
    sourceSnapshotId: "snap-abc123",
    calculationRunId: "run1",
    status: "draft",
    findings: [
      {
        findingId: "amb:run1:calculation",
        caseId: "12345678",
        originatingWorkProduct: "AMB",
        originatingVersion: "0.1.0 / run1",
        claimType: "derived_result",
        subjectScope: "participant",
        subjectIds: ["SYN-001"],
        effectivePeriod: { start: "2020-06-30", end: "2020-06-30" },
        valueAndUnits: { value: "850.00", units: "USD/month", basis: "measured dote 2020-06-30" },
        findingStatement: "FULL-ANALYSIS-BODY-MARKER: the full trace and every step.",
        rationale: "Run run1.",
        evidenceRefs: ["ev-1"],
        missingEvidenceException: null,
        derivedFromFindingIds: [],
        reviewState: "draft",
        materiality: { material: true, rule: null },
        intendedR1Topics: ["data_issues", "benefit_formula"],
        supersedes: null,
      },
    ],
    fragments: [fragment],
    citations: [evidenceRef({})],
    warnings: [],
    requiredFollowups: ["Resolve 3 indeterminate cases."],
    downstreamDependencies: ["R1"],
  };
  return {
    contribution,
    dataIssuesFragment: fragment,
    memoRef: evidenceRef({ evidenceId: "ev-1", title: "Complete AMB memo" }),
    workbookRef: evidenceRef({ evidenceId: "ev-2", title: "Tested workbook", imageViewerDocumentNumber: "124", location: { kind: "document-section", fileName: "workbook.xlsx", section: "Sheet1", page: null } }),
    reproducibility: REPRO,
  };
}

describe("renderAmbMemo", () => {
  it("contains all eight data_issues items", () => {
    const html = renderAmbMemo(memoInput());
    for (const item of DATA_ISSUES_ITEMS) {
      assert.ok(html.includes(item), `missing data_issues item: ${item}`);
    }
    assert.ok(html.includes("100 participants at DOTE."));
    assert.ok(html.includes("Full-population AMB testing."));
    assert.ok(html.includes("Image Viewer Document #123, page 5"));
    assert.ok(html.includes("Image Viewer Document #124"));
  });

  it("never pastes the full analysis body (findings are counted, not quoted)", () => {
    const html = renderAmbMemo(memoInput());
    assert.ok(!html.includes("FULL-ANALYSIS-BODY-MARKER"));
    assert.ok(html.includes("1 (count only; findings are not quoted here)"));
    assert.ok(html.includes("the full AMB analysis is not reproduced here"));
  });

  it("shows pending Image Viewer numbers and a blocking issue, never an invented number", () => {
    const input = memoInput();
    input.memoRef = evidenceRef({ evidenceId: "ev-1", imageViewerDocumentNumber: null });
    input.workbookRef = null;
    const html = renderAmbMemo(input);
    assert.ok(html.includes("Image Viewer document number pending"));
    assert.ok(html.includes("Tested workbook reference not supplied."));
    assert.ok(!html.includes("Image Viewer Document #999"));
  });

  it("states Not established when the fragment is absent", () => {
    const input = memoInput();
    input.dataIssuesFragment = null;
    const html = renderAmbMemo(input);
    assert.ok(html.includes("Not established in the AMB analysis."));
    assert.ok(html.includes("No reviewer determination recorded."));
  });
});
