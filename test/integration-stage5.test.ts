/**
 * Integration tests for Stage 5 — the full chain on real module outputs:
 *
 *   reconcileParticipant (src/reconcile.ts)
 *     → buildDispositionEvidence (src/dispositionEvidence.ts, the seam)
 *     → mapDisposition (src/dispositionMapping.ts)
 *     → publishStage5Findings / assembleStage5Contribution
 *       (src/reconciliationFindings.ts, via the Stage 4.5 protocol)
 *
 * with statistical flags from src/statistics.ts feeding the same chain.
 *
 * These tests exist because the four Stage 5 workers built in parallel
 * against a seam type: Worker 1's recommendation and Worker 3's mapping
 * must AGREE on every evidence state, and Worker 2's flags must flow into
 * the disposition. A disagreement here is a defect in the seam, not a
 * difference of opinion — the system cannot recommend two dispositions for
 * one participant.
 *
 * Worked examples are the fictional participants from the Stage 2 and
 * Stage 4 worked examples (SYN-001, SYN-002, SYN-V-01, SYN-I-01).
 * Synthetic data only. No live case data.
 *
 * Run with plain node + node:test:
 *   npx tsc --outDir dist-int && node --test dist-int/test/integration-stage5.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeMoney } from "../src/decimal.js";
import { ENGINE_VERSION } from "../src/index.js";
import { buildDispositionEvidence } from "../src/dispositionEvidence.js";
import { mapDisposition } from "../src/dispositionMapping.js";
import type { DispositionEvidence } from "../src/dispositionMapping.js";
import type { EvidenceRef } from "../src/contribution.js";
import {
  buildReconciliationInputs,
  describeCounterfactualOperation,
  makeCounterfactualResult,
} from "../src/reconciliation.js";
import {
  assembleStage5Contribution,
  publishStage5Findings,
} from "../src/reconciliationFindings.js";
import type {
  RankedHypothesis,
  Stage5ParticipantPublication,
  Stage5Reconciliation,
} from "../src/reconciliationFindings.js";
import {
  reconcileParticipant,
} from "../src/reconcile.js";
import type { ReconciliationConfig } from "../src/reconcile.js";
import { detectOutliers } from "../src/statistics.js";
import type { StatRow } from "../src/statistics.js";
import type {
  BoundsResult,
  CalculationOutcome,
  CalculationRun,
  ReconciliationInputs,
  ToleranceRecord,
  TypedBenefitQuantity,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixtures (mirror test/reconcile.test.ts)
// ---------------------------------------------------------------------------

const TOLERANCE: ToleranceRecord = {
  version: 1,
  absoluteMinor: 100, // $1.00/month
  relativeDecimal: "0.01", // 1%
  application: "either",
  authority:
    "Actuary-set per case; screening values borrowed from Policy 5.8-1 Benefit Corrections, labelled as such — that policy governs correction of issued benefit determinations, not acceptance of PA_AMB.",
  approvedBy: "A. Actuary",
  approvedDate: "2026-11-12",
};

const CONFIG: ReconciliationConfig = {
  epsilonRMinor: 100,
  epsilonRSource: "$1.00/month — no plan minimum documented (Stage 1 output 03, §2.3)",
  materialityMinor: 10000, // $100.00/month, actuary-set per case
  materialitySource: "Actuary-set per case; no PBGC source states a reconciliation materiality threshold.",
};

const CONFIG_LOW_MATERIALITY: ReconciliationConfig = {
  ...CONFIG,
  materialityMinor: 5000, // $50.00/month
};

function makeBenefit(
  amountMinor: number | null,
  source: TypedBenefitQuantity["source"],
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
    planVersionId: "pv-1",
    formulaId: "f-1",
    source,
    status: source === "prior-administrator" ? "recorded" : "calculated",
    ownerId: "owner-1",
    ...overrides,
  };
}

function exactInputs(recordedMinor: number | null, reconstructedMinor: number): ReconciliationInputs {
  const outcome: CalculationOutcome = {
    kind: "exact",
    benefit: makeBenefit(reconstructedMinor, "independent-calculation"),
    trace: [],
  };
  return buildReconciliationInputs({
    outcome,
    recorded: recordedMinor === null ? null : makeBenefit(recordedMinor, "prior-administrator"),
    toleranceApplied: TOLERANCE,
    comparisonBasis: "same-basis",
  });
}

function makeBounds(
  minMinor: number,
  maxMinor: number,
  recordedPosition: BoundsResult["recordedPosition"],
): BoundsResult {
  return {
    min: makeMoney(minMinor),
    max: makeMoney(maxMinor),
    assumptions: ["Missing compensation year bounded by documented facts and the §401(a)(17) cap in effect."],
    derivation: {
      method: "endpoint-evaluation",
      kinkPoints: [],
      monotonicity: [{ input: "missing compensation year", monotone: true, verifiedBy: "formula structure" }],
      feasibleRegion: "Missing year in [$4,800, $5,400] monthly.",
    },
    widthAttribution: [],
    scenarios: [],
    recordedPosition,
    minBenefit: makeBenefit(minMinor, "bound"),
    maxBenefit: makeBenefit(maxMinor, "bound"),
  };
}

function boundsInputs(recordedMinor: number | null): ReconciliationInputs {
  const outcome: CalculationOutcome = {
    kind: "bounds",
    bounds: makeBounds(158400, 168300, recordedMinor === null ? "recorded-missing" : "inside"),
    trace: [],
  };
  return buildReconciliationInputs({
    outcome,
    recorded: recordedMinor === null ? null : makeBenefit(recordedMinor, "prior-administrator"),
    toleranceApplied: TOLERANCE,
    comparisonBasis: "same-basis",
  });
}

function indeterminateInputs(): ReconciliationInputs {
  const outcome: CalculationOutcome = {
    kind: "indeterminate",
    reason: {
      code: "unresolved-comparison-basis",
      detail: "Measurement date of the recorded benefit cannot be established from available documents.",
      missingInputs: ["BenefitObservation.measurementDate"],
      wouldResolve: ["Prior administrator benefit schedule stating the measurement date."],
    },
    trace: [],
  };
  return buildReconciliationInputs({
    outcome,
    recorded: makeBenefit(112000, "prior-administrator"),
    toleranceApplied: TOLERANCE,
    comparisonBasis: "unresolved",
  });
}

// ---------------------------------------------------------------------------
// Evidence pool + run fixture (synthetic IV numbers #999001 / #999002)
// ---------------------------------------------------------------------------

const POOL: readonly EvidenceRef[] = [
  {
    evidenceId: "ev-plan",
    documentId: "doc-plan",
    location: { kind: "pdf-page", fileName: "synthetic-plan.pdf", page: 12, section: "§3.2(b)", quote: null },
    acquisition: "imported",
    derivation: null,
    sourceFileHash: null,
    sourceKind: "plan document",
    title: "Synthetic Plan Document",
    versionOrDate: "1985-07-01",
    imageViewerDocumentNumber: "999001",
    originalExcerpt: null,
    accessStatus: "verified",
    workProductRef: null,
  },
  {
    evidenceId: "ev-census",
    documentId: "doc-census",
    location: { kind: "csv-row", fileName: "synthetic-census.csv", row: 2, columnHeader: "PA_AMB", delimiter: "," },
    acquisition: "imported",
    derivation: null,
    sourceFileHash: null,
    sourceKind: "census",
    title: "Synthetic Census",
    versionOrDate: "2019-06-30",
    imageViewerDocumentNumber: "999002",
    originalExcerpt: null,
    accessStatus: "verified",
    workProductRef: null,
  },
];

const RUN: CalculationRun = {
  id: "run-stage5-int-1",
  version: 1,
  supersedesId: null,
  sourceRecordIds: [],
  createdDate: "2026-11-12",
  createdBy: "A. Actuary",
  runId: "run-stage5-int-1",
  caseId: "12345678",
  ruleVersion: "1.0.0",
  inputSnapshot: {
    snapshotHash: "sha256:test-integration",
    importIds: [],
    entityVersions: [],
    planVersionIds: [],
    formulaIds: [],
    ruleVersion: "1.0.0",
    formulaTaxonomyVersion: "1.0.0",
    engineVersion: ENGINE_VERSION,
    toleranceRecordVersion: 1,
  },
  inputSnapshotHash: "sha256:test-integration",
  runDate: "2026-11-12",
  runBy: "A. Actuary",
  participantScope: "synthetic-integration",
  resultsHash: "sha256:test-integration",
  engineVersion: ENGINE_VERSION,
  participantsComputed: 1,
  participantsChanged: [],
};

// ---------------------------------------------------------------------------
// Chain helpers: ParticipantReconciliation → Stage 5 publication inputs
// ---------------------------------------------------------------------------

type Rec = ReturnType<typeof reconcileParticipant>;

function toStage5Reconciliation(rec: Rec): Stage5Reconciliation {
  return {
    participantKey: rec.participantKey,
    recordedMinor: rec.recorded?.amount?.amountMinor ?? null,
    reconstructedMinor: rec.reconstructed?.amount?.amountMinor ?? null,
    deltaMinor: rec.comparison.comparable ? rec.comparison.delta.amountMinor : null,
    absDeltaMinor: rec.comparison.comparable ? rec.comparison.absDelta.amountMinor : null,
    relDelta:
      rec.comparison.comparable && rec.comparison.relative.kind === "defined"
        ? rec.comparison.relative.value
        : null,
    denominatorFlag: rec.comparison.comparable ? rec.comparison.denominatorFlag : null,
    withinTolerance:
      rec.toleranceVerdict === "within-tolerance"
        ? true
        : rec.toleranceVerdict === "outside-tolerance"
          ? false
          : null,
    toleranceSetId: "tolerance-v1",
    recordedPosition: rec.recordedPosition,
    boundsMinor:
      rec.bounds === null
        ? null
        : { min: rec.bounds.min.amountMinor, max: rec.bounds.max.amountMinor },
  };
}

function toRankedHypotheses(rec: Rec): RankedHypothesis[] {
  return rec.hypotheses.map((h, i) => ({
    code: h.hypothesisCode,
    rank: i + 1,
    supportClass: h.supportClass,
    counterfactual: describeCounterfactualOperation(h.operation),
    residualDeltaMinor: h.residualDelta?.amountMinor ?? null,
    evidenceFor: [...h.evidenceFor],
    evidenceAgainst: [...h.evidenceAgainst],
  }));
}

/** Full chain for one participant: reconcile → build evidence → map
 *  disposition. Returns both recommendations so the test can assert they
 *  agree. */
function chain(
  participantKey: string,
  inputs: ReconciliationInputs,
  config: ReconciliationConfig,
  opts: {
    comparisonBasis: "same-basis" | "basis-converted" | "unresolved";
    completenessGrade: "complete" | "partial" | "insufficient" | "excluded";
    basisUnresolvable?: boolean;
    outlierFlags?: Parameters<typeof buildDispositionEvidence>[0]["outlierFlags"];
    investigatedParticipantKeys?: string[];
    correctionReasonablyCertain?: boolean;
    hypothesisCandidates?: Parameters<typeof reconcileParticipant>[0]["hypothesisCandidates"];
  },
): { rec: Rec; evidence: DispositionEvidence; mapped: ReturnType<typeof mapDisposition> } {
  const rec = reconcileParticipant({
    participantKey,
    inputs,
    config,
    hypothesisCandidates: opts.hypothesisCandidates ?? [],
  });
  const evidence = buildDispositionEvidence({
    reconciliation: rec,
    caseId: "12345678",
    toleranceSetId: "tolerance-v1",
    comparisonBasis: opts.comparisonBasis,
    completenessGrade: opts.completenessGrade,
    materialityMinor: config.materialityMinor,
    outlierFlags: opts.outlierFlags ?? [],
    investigatedParticipantKeys: opts.investigatedParticipantKeys ?? [],
    correctionReasonablyCertain: opts.correctionReasonablyCertain ?? false,
    boundAssumptionsInDoubt: false,
    boundWidthJustification: null,
    missingEvidence: [],
    dataRequests: [],
    nextSteps: [],
    basisUnresolvable: opts.basisUnresolvable ?? false,
    blockingValidationOutstanding: false,
  });
  return { rec, evidence, mapped: mapDisposition(evidence) };
}

function statRow(participantKey: string, paAmbMinor: number): StatRow {
  return {
    participantKey,
    status: "terminated-vested",
    employmentGroup: "hourly",
    formulaType: "unit-credit",
    amendmentCohort: "2019",
    paAmbMinor,
    reconstructedMinor: 150000,
    deltaMinor: paAmbMinor - 150000,
    absDeltaMinor: Math.abs(paAmbMinor - 150000),
    relDelta: null,
    denominatorFlag: null,
    ageYears: 60,
    serviceYears: 20,
    compensationMinor: 6000000,
    retirementStatus: "terminated-vested",
    dataCompleteness: 1,
    monthsSinceRecorded: 12,
    qdro: false,
    priorDistribution: false,
    employmentPeriods: 1,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Stage 5 integration — reconcile → map disposition → publish", () => {
  it("SYN-001 exact $1,500.00: both modules recommend Verified, and the contribution publishes", () => {
    const { rec, mapped } = chain("SYN-001", exactInputs(150000, 150000), CONFIG, {
      comparisonBasis: "same-basis",
      completenessGrade: "complete",
    });
    assert.equal(rec.comparison.comparable, true);
    assert.equal(rec.recommendedDisposition, "verified");
    assert.equal(mapped.disposition, "verified");
    assert.equal(mapped.status, "recommended");

    const publication: Stage5ParticipantPublication = {
      participantKey: "SYN-001",
      reconciliation: toStage5Reconciliation(rec),
      hypotheses: toRankedHypotheses(rec),
      statisticalFlags: [],
      missingData: [],
      dispositionRecommendation: mapped,
      closeMatch: null,
      evidenceByKind: {
        reconciliation: { evidenceIds: ["ev-plan"], missingEvidenceException: null },
        disposition: { evidenceIds: ["ev-plan"], missingEvidenceException: null },
      },
    };
    const log = publishStage5Findings({
      run: RUN,
      outcome: null,
      evidence: POOL,
      productVersion: ENGINE_VERSION,
      participants: [publication],
    });
    assert.ok(log.findings.length >= 2, "reconciliation + disposition findings published");
    assert.ok(
      log.findings.some((f) => f.findingId.includes("reconciliation")),
      "reconciliation finding present",
    );
    assert.ok(
      log.findings.some((f) => f.findingId.includes("disposition")),
      "disposition finding present",
    );
    const contribution = assembleStage5Contribution({
      caseId: "12345678",
      productVersion: ENGINE_VERSION,
      producedAt: "2026-11-12",
      publishedBy: "A. Actuary",
      run: RUN,
      log,
      status: "draft",
    });
    assert.equal(contribution.productId, "AMB");
    assert.equal(contribution.status, "draft");
    assert.ok(contribution.findings.length >= 2);
  });

  it("SYN-002 bounds $1,584–$1,683, PA $1,620: τ_material decides — $50 → Requires investigation, $100 → Supported for acceptance (both modules agree)", () => {
    const low = chain("SYN-002", boundsInputs(162000), CONFIG_LOW_MATERIALITY, {
      comparisonBasis: "same-basis",
      completenessGrade: "partial",
    });
    assert.equal(low.rec.recommendedDisposition, "requires-investigation");
    assert.equal(low.mapped.disposition, "requires-investigation");

    const high = chain("SYN-002", boundsInputs(162000), CONFIG, {
      comparisonBasis: "same-basis",
      completenessGrade: "partial",
    });
    assert.equal(high.rec.recommendedDisposition, "supported-for-acceptance");
    assert.equal(high.mapped.disposition, "supported-for-acceptance");
  });

  it("SYN-V-01 $850.00 vs $849.50: both modules recommend Verified", () => {
    const { rec, mapped } = chain("SYN-V-01", exactInputs(85000, 84950), CONFIG, {
      comparisonBasis: "same-basis",
      completenessGrade: "complete",
    });
    assert.equal(rec.recommendedDisposition, "verified");
    assert.equal(mapped.disposition, "verified");
  });

  it("SYN-I-01 Indeterminate (DOTE blank): both modules recommend Indeterminate", () => {
    const { rec, mapped } = chain("SYN-I-01", indeterminateInputs(), CONFIG, {
      comparisonBasis: "unresolved",
      completenessGrade: "insufficient",
      basisUnresolvable: true,
    });
    assert.equal(rec.comparison.comparable, false);
    assert.equal(rec.recommendedDisposition, "indeterminate");
    assert.equal(mapped.disposition, "indeterminate");
  });

  it("blank PA_AMB with an exact reconstruction: both modules recommend Requires investigation (not Indeterminate)", () => {
    const { rec, mapped } = chain("SYN-BLANK", exactInputs(null, 150000), CONFIG, {
      comparisonBasis: "same-basis",
      completenessGrade: "partial",
    });
    assert.equal(rec.comparison.comparable, false);
    assert.equal(rec.recommendedDisposition, "requires-investigation");
    assert.equal(mapped.disposition, "requires-investigation");
  });

  it("reconstruction error (supported H2, corrected benefit equals recorded): both modules recommend Requires investigation", () => {
    const h2 = makeCounterfactualResult({
      operation: { kind: "service-delta-years", years: "+1" },
      hypothesisCode: "H2",
      benefit: makeBenefit(150000, "independent-calculation"),
      residualDelta: makeMoney(0),
      supportClass: "supported",
      evidenceFor: ["Plan §3.2(b) states 24.25 years of credited service; the reconstruction used 23.25."],
      evidenceAgainst: [],
    });
    const { rec, mapped } = chain("SYN-RE", exactInputs(150000, 145000), CONFIG, {
      comparisonBasis: "same-basis",
      completenessGrade: "complete",
      hypothesisCandidates: [
        { result: h2, documentedMechanism: true, resolvesCohort: false, material: true },
      ],
    });
    assert.equal(rec.toleranceVerdict, "outside-tolerance");
    assert.equal(rec.recommendedDisposition, "requires-investigation");
    assert.match(rec.dispositionBasis, /reconstruction error/);
    assert.equal(mapped.disposition, "requires-investigation");
  });

  it("statistical flag seam: an uninvestigated flag blocks Verified; once investigated, the same participant verifies", () => {
    const rows: StatRow[] = [];
    // Realistic spread ($1,400–$1,580) so the cohort is not degenerate:
    // with 19 identical values the percentile screen flags the whole cohort,
    // which is the method working as specified, not the seam under test.
    // Percentile screening is excluded here (W2's tests cover it); the seam
    // is exercised with modified-z and Tukey.
    for (let i = 0; i < 19; i++) {
      rows.push(statRow(`SYN-F${String(i).padStart(2, "0")}`, 140000 + i * 1000));
    }
    rows.push(statRow("SYN-FLAG", 900000));
    const detected = detectOutliers(rows, { valueField: "paAmbMinor", methods: ["modified-z", "tukey"] });
    const flag = detected.flags.find((f) => f.participantKey === "SYN-FLAG");
    assert.ok(flag, "the $9,000 participant is flagged");
    assert.ok(!detected.flags.some((f) => f.participantKey !== "SYN-FLAG"), "no clean participant flagged");

    const uninvestigated = chain("SYN-FLAG", exactInputs(900000, 900000), CONFIG, {
      comparisonBasis: "same-basis",
      completenessGrade: "complete",
      outlierFlags: flag === undefined ? [] : [flag],
      investigatedParticipantKeys: [],
    });
    assert.equal(uninvestigated.rec.recommendedDisposition, "verified", "reconciliation alone verifies");
    assert.equal(
      uninvestigated.mapped.disposition,
      "requires-investigation",
      "the uninvestigated flag blocks Verified in the mapping",
    );

    const investigated = chain("SYN-FLAG", exactInputs(900000, 900000), CONFIG, {
      comparisonBasis: "same-basis",
      completenessGrade: "complete",
      outlierFlags: flag === undefined ? [] : [flag],
      investigatedParticipantKeys: ["SYN-FLAG"],
    });
    assert.equal(investigated.mapped.disposition, "verified");
  });

  it("close match (Δ $0.50, H15 coincidence): publishes as a risk investigation signal, and both modules require investigation", () => {
    const h15 = makeCounterfactualResult({
      operation: { kind: "rounding-sequence", sequence: { sequenceId: "seq-dollar", rules: [] } },
      hypothesisCode: "H15",
      benefit: makeBenefit(85000, "independent-calculation"),
      residualDelta: makeMoney(0),
      supportClass: "coincidence",
      evidenceFor: [],
      evidenceAgainst: ["No plan document states this rounding sequence."],
    });
    const { rec, mapped } = chain("SYN-CM", exactInputs(85000, 84950), CONFIG, {
      comparisonBasis: "same-basis",
      completenessGrade: "complete",
      hypothesisCandidates: [
        { result: h15, documentedMechanism: false, resolvesCohort: false, material: true },
      ],
    });
    assert.equal(rec.recommendedDisposition, "requires-investigation");
    assert.equal(mapped.disposition, "requires-investigation");

    const publication: Stage5ParticipantPublication = {
      participantKey: "SYN-CM",
      reconciliation: toStage5Reconciliation(rec),
      hypotheses: toRankedHypotheses(rec),
      statisticalFlags: [],
      missingData: [],
      dispositionRecommendation: mapped,
      closeMatch: {
        deltaMinor: 50,
        toleranceSetId: "tolerance-v1",
        hypothesisSupportClass: "coincidence",
        hypothesisCode: "H15",
      },
      evidenceByKind: {
        reconciliation: { evidenceIds: ["ev-plan"], missingEvidenceException: null },
        closeMatch: { evidenceIds: ["ev-plan"], missingEvidenceException: null },
        disposition: { evidenceIds: ["ev-plan"], missingEvidenceException: null },
      },
    };
    const log = publishStage5Findings({
      run: RUN,
      outcome: null,
      evidence: POOL,
      productVersion: ENGINE_VERSION,
      participants: [publication],
    });
    const closeMatchFinding = log.findings.find((f) => f.findingId.includes("close-match"));
    if (closeMatchFinding === undefined) throw new Error("close-match finding not published");
    assert.equal(closeMatchFinding.claimType, "risk");
    assert.match(closeMatchFinding.findingStatement, /investigation signal/i);
  });
});
