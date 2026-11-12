/**
 * Unit tests for the Stage 5 disposition mapping
 * (src/dispositionMapping.ts): the complete mapping from evidence states
 * to the five §14 dispositions (Stage 1 output 03, §4.7; Stage 2 output
 * 05, §1.2), the four worked examples, and the wiring into
 * src/decisions.ts — the system recommends; only a human approves.
 *
 * Run with plain node + node:test (no test framework dependency).
 * Synthetic data only. Fictional participants only. No live case data.
 * Money is integer minor units (cents).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAPPING_ROWS,
  checkRecommendation,
  mapDisposition,
  recommendationIsNotApproval,
  toEntryCheckInput,
  workedExampleSyn001,
  workedExampleSyn002,
  workedExampleSynI01,
  workedExampleSynV01,
  workedExamples,
  type DispositionEvidence,
} from "../src/dispositionMapping.js";
import { checkEntryConditions } from "../src/decisions.js";
import type { Disposition } from "../src/types.js";

function evidence(overrides: Partial<DispositionEvidence>): DispositionEvidence {
  return {
    participantKey: "SYN-001",
    caseId: "00000001",
    toleranceSetId: "tol-1",
    completenessGrade: "complete",
    comparisonBasis: "established",
    basisUnresolvable: false,
    basisNote: null,
    reconstructedMinor: null,
    recordedMinor: null,
    deltaMinor: null,
    withinTolerance: null,
    denominatorFlag: null,
    boundsMinor: null,
    boundWidthMaterial: false,
    boundWidthJustification: null,
    boundAssumptionsInDoubt: false,
    hypotheses: [],
    conflictingCorrections: false,
    correctedBenefitMinor: null,
    correctionReasonablyCertain: false,
    correctionDirection: null,
    missingEvidence: [],
    dataRequests: [],
    nextSteps: [],
    uninvestigatedFlag: false,
    blockingValidationOutstanding: false,
    statisticalOnly: false,
    contradictoryEvidenceUnresolved: false,
    supportedGround: null,
    indeterminateRationale: null,
    noFurtherRequestReason: null,
    ruleApplicabilityOk: true,
    snapshotMatches: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Every §4.7 evidence state reaches exactly one disposition
// ---------------------------------------------------------------------------

describe("§4.7 mapping: every evidence state reaches exactly one disposition", () => {
  it("all seven mapping rows are present and each names a valid disposition", () => {
    assert.equal(MAPPING_ROWS.length, 7);
    const dispositions = new Set<Disposition>([
      "verified",
      "supported-for-acceptance",
      "requires-investigation",
      "correction-recommended",
      "indeterminate",
    ]);
    for (const row of MAPPING_ROWS) {
      assert.ok(dispositions.has(row.disposition), `row ${row.row} names an invalid disposition`);
    }
    // Every disposition is reachable from at least one row.
    for (const disposition of dispositions) {
      assert.ok(
        MAPPING_ROWS.some((row) => row.disposition === disposition),
        `${disposition} has no mapping row`,
      );
    }
  });

  it("row 1 — exact, within tolerance, basis established → Verified", () => {
    const rec = mapDisposition(
      evidence({ reconstructedMinor: 150000, recordedMinor: 150000, deltaMinor: 0, withinTolerance: true }),
    );
    assert.equal(rec.disposition, "verified");
    assert.equal(rec.status, "recommended");
  });

  it("row 2 — inside justified bounds, narrow relative to materiality → Supported for acceptance", () => {
    const rec = mapDisposition(
      evidence({
        completenessGrade: "partial",
        recordedMinor: 162000,
        boundsMinor: { min: 158400, max: 162500 },
        boundWidthMaterial: false,
        missingEvidence: [
          { input: "CompensationHistory.salaryYear 2019", missingClass: "M3", decisionImpact: "Narrows the bounds; cannot change the disposition.", uncertaintyContributionMinor: 4100 },
        ],
      }),
    );
    assert.equal(rec.disposition, "supported-for-acceptance");
  });

  it("row 3 — inside bounds but bounds wide relative to materiality → Requires investigation", () => {
    const rec = mapDisposition(
      evidence({
        completenessGrade: "partial",
        recordedMinor: 162000,
        boundsMinor: { min: 158400, max: 168300 },
        boundWidthMaterial: true,
        missingEvidence: [
          { input: "CompensationHistory.salaryYear 2019", missingClass: "M3", decisionImpact: "Resolving it narrows the bounds by $99.00/month.", uncertaintyContributionMinor: 9900 },
        ],
        nextSteps: ["Obtain compensation year 2019 from the payroll records."],
      }),
    );
    assert.equal(rec.disposition, "requires-investigation");
    assert.ok(rec.nextSteps.length > 0);
  });

  it("row 4 — supported hypothesis identifies a specific error and the corrected value, reasonably certain → Correction recommended", () => {
    const rec = mapDisposition(
      evidence({
        reconstructedMinor: 150000,
        recordedMinor: 170000,
        deltaMinor: 20000,
        withinTolerance: false,
        hypotheses: [
          { code: "H12", supportClass: "supported", material: true, correctedBenefitMinor: 150000 },
        ],
        correctionReasonablyCertain: true,
        correctionDirection: "decrease",
      }),
    );
    assert.equal(rec.disposition, "correction-recommended");
    assert.equal(rec.correctedBenefitMinor, 150000);
  });

  it("row 4 (not met) — supported correction without the reviewer's certainty statement → Requires investigation", () => {
    const rec = mapDisposition(
      evidence({
        reconstructedMinor: 150000,
        recordedMinor: 170000,
        deltaMinor: 20000,
        withinTolerance: false,
        hypotheses: [
          { code: "H12", supportClass: "supported", material: true, correctedBenefitMinor: 150000 },
        ],
        correctionReasonablyCertain: false,
        correctionDirection: "decrease",
      }),
    );
    assert.equal(rec.disposition, "requires-investigation");
    assert.match(rec.rationale, /reasonable certainty/);
  });

  it("row 5 — outside bounds but the bound assumptions are in doubt → Requires investigation", () => {
    const rec = mapDisposition(
      evidence({
        recordedMinor: 190000,
        boundsMinor: { min: 158400, max: 168300 },
        boundAssumptionsInDoubt: true,
      }),
    );
    assert.equal(rec.disposition, "requires-investigation");
    assert.match(rec.rationale, /assumptions behind the bounds are themselves in doubt/);
  });

  it("row 5 (not in doubt) — outside bounds with no certain corrected value → Requires investigation, never a correction without a value", () => {
    const rec = mapDisposition(
      evidence({
        recordedMinor: 190000,
        boundsMinor: { min: 158400, max: 168300 },
        boundAssumptionsInDoubt: false,
      }),
    );
    assert.equal(rec.disposition, "requires-investigation");
    assert.notEqual(rec.disposition, "correction-recommended");
  });

  it("row 6 — no B̂_i and no justifiable bounds (class M5) → Indeterminate", () => {
    const rec = mapDisposition(
      evidence({
        completenessGrade: "insufficient",
        missingEvidence: [
          { input: "Formula.governingFormula", missingClass: "M5", decisionImpact: "Without the governing formula no benefit and no bounds can be established.", uncertaintyContributionMinor: null },
        ],
        dataRequests: [
          {
            requestId: "req-1",
            input: "Plan document for era 1994–1998",
            participantKeys: ["SYN-001"],
            sourceToAsk: "Plan document repository",
            expectedDecisionEffect: "Could establish the governing formula and move the participant out of Indeterminate.",
            priority: 1,
            status: "issued",
            statusReason: "Issued; awaiting response.",
            requestedDate: "2026-11-12",
            answeredDate: null,
          },
        ],
        indeterminateRationale: "The governing formula for the participant's era cannot be identified; no benefit and no justified bounds can be established.",
      }),
    );
    assert.equal(rec.disposition, "indeterminate");
  });

  it("row 6 — unresolved comparison basis that cannot be resolved → Indeterminate", () => {
    const rec = mapDisposition(
      evidence({
        completenessGrade: "insufficient",
        comparisonBasis: "unresolved",
        basisUnresolvable: true,
        basisNote: "No PA schedule or plan document establishes the measurement date.",
        missingEvidence: [
          { input: "DOTE (measurement date)", missingClass: "M5", decisionImpact: "Without a measurement date no comparison basis exists.", uncertaintyContributionMinor: null },
        ],
        indeterminateRationale: "Measurement date cannot be established from available documents.",
      }),
    );
    assert.equal(rec.disposition, "indeterminate");
  });

  it("row 7 — B_i^PA blank with no independent reconstruction → Indeterminate", () => {
    const rec = mapDisposition(
      evidence({
        completenessGrade: "insufficient",
        recordedMinor: null,
        reconstructedMinor: null,
        missingEvidence: [
          { input: "PA_AMB", missingClass: "M1", decisionImpact: "Without the recorded amount there is nothing to compare.", uncertaintyContributionMinor: null },
        ],
        indeterminateRationale: "Recorded amount blank and no independent reconstruction exists.",
      }),
    );
    assert.equal(rec.disposition, "indeterminate");
  });

  it("totality: a spread of evidence states each reaches exactly one of the five dispositions", () => {
    const states: DispositionEvidence[] = [
      evidence({ reconstructedMinor: 100000, recordedMinor: 100000, deltaMinor: 0, withinTolerance: true }),
      evidence({
        completenessGrade: "partial",
        recordedMinor: 100000,
        boundsMinor: { min: 99000, max: 101000 },
        missingEvidence: [{ input: "X", missingClass: "M3", decisionImpact: "d", uncertaintyContributionMinor: 2000 }],
      }),
      evidence({ reconstructedMinor: 100000, recordedMinor: 120000, deltaMinor: 20000, withinTolerance: false }),
      evidence({
        reconstructedMinor: 100000,
        recordedMinor: 120000,
        deltaMinor: 20000,
        withinTolerance: false,
        hypotheses: [{ code: "H2", supportClass: "supported", material: true, correctedBenefitMinor: 100000 }],
        correctionReasonablyCertain: true,
        correctionDirection: "decrease",
      }),
      evidence({ completenessGrade: "insufficient" }),
      evidence({ comparisonBasis: "unresolved", basisUnresolvable: false }),
      evidence({ recordedMinor: null, reconstructedMinor: 100000 }),
      evidence({
        reconstructedMinor: 100000,
        recordedMinor: 120000,
        deltaMinor: 20000,
        withinTolerance: false,
        conflictingCorrections: true,
        hypotheses: [
          { code: "H2", supportClass: "supported", material: true, correctedBenefitMinor: 100000 },
          { code: "H4", supportClass: "supported", material: true, correctedBenefitMinor: 110000 },
        ],
      }),
      evidence({
        reconstructedMinor: 100000,
        recordedMinor: 100000,
        deltaMinor: 0,
        withinTolerance: true,
        uninvestigatedFlag: true,
      }),
    ];
    const valid: Disposition[] = ["verified", "supported-for-acceptance", "requires-investigation", "correction-recommended", "indeterminate"];
    for (const state of states) {
      const rec = mapDisposition(state);
      assert.ok(valid.includes(rec.disposition), `unexpected disposition ${rec.disposition}`);
      assert.equal(rec.status, "recommended");
      assert.ok(rec.rationale.length > 0);
      assert.ok(rec.mappingRow.length > 0);
    }
  });

  it("a statistical flag alone never decides a benefit: uninvestigated flag → Requires investigation, never Verified", () => {
    const rec = mapDisposition(
      evidence({
        reconstructedMinor: 100000,
        recordedMinor: 100000,
        deltaMinor: 0,
        withinTolerance: true,
        uninvestigatedFlag: true,
      }),
    );
    assert.equal(rec.disposition, "requires-investigation");
  });

  it("a coincidence never supports Verified or Supported for acceptance", () => {
    const rec = mapDisposition(
      evidence({
        reconstructedMinor: 100000,
        recordedMinor: 100000,
        deltaMinor: 0,
        withinTolerance: true,
        hypotheses: [{ code: "H15", supportClass: "coincidence", material: true, correctedBenefitMinor: null }],
      }),
    );
    assert.notEqual(rec.disposition, "verified");
    assert.equal(rec.disposition, "requires-investigation");
  });

  it("a disposition resting on a statistical output alone is never Verified (G-INV-5)", () => {
    const rec = mapDisposition(
      evidence({
        reconstructedMinor: 100000,
        recordedMinor: 100000,
        deltaMinor: 0,
        withinTolerance: true,
        statisticalOnly: true,
      }),
    );
    assert.notEqual(rec.disposition, "verified");
  });
});

// ---------------------------------------------------------------------------
// 2. Indeterminate is reachable
// ---------------------------------------------------------------------------

describe("Indeterminate is reachable", () => {
  it("SYN-I-01 (DOTE blank) maps to Indeterminate", () => {
    const rec = mapDisposition(workedExampleSynI01());
    assert.equal(rec.disposition, "indeterminate");
    assert.equal(rec.status, "recommended");
    assert.ok(rec.missingEvidence.length > 0);
    assert.ok(rec.dataRequests.length > 0);
  });

  it("Indeterminate carries the missing evidence and the data requests that would change the outcome", () => {
    const rec = mapDisposition(workedExampleSynI01());
    assert.ok(rec.missingEvidence.some((m) => m.missingClass === "M5"));
    assert.ok(rec.rationale.length > 0);
  });
});

// ---------------------------------------------------------------------------
// 3. The four worked examples map as specified
// ---------------------------------------------------------------------------

describe("worked examples", () => {
  it("SYN-001 $1,500.00 exact (Δ $0) → Verified", () => {
    const rec = mapDisposition(workedExampleSyn001());
    assert.equal(rec.disposition, "verified");
    assert.match(rec.rationale, /within the applicable documented tolerance/);
  });

  it("SYN-002 bounds $1,584–$1,683 with PA_AMB $1,620 inside but width material → Requires investigation", () => {
    const rec = mapDisposition(workedExampleSyn002());
    assert.equal(rec.disposition, "requires-investigation");
    assert.ok(rec.nextSteps.length > 0);
  });

  it("SYN-V-01 $850.00 vs $849.50 (Δ $0.50 explained by a documented rounding rule) → Verified", () => {
    const rec = mapDisposition(workedExampleSynV01());
    assert.equal(rec.disposition, "verified");
  });

  it("SYN-I-01 Indeterminate (DOTE blank) → Indeterminate", () => {
    const rec = mapDisposition(workedExampleSynI01());
    assert.equal(rec.disposition, "indeterminate");
  });

  it("workedExamples returns all four in order", () => {
    const examples = workedExamples();
    assert.equal(examples.length, 4);
    assert.deepEqual(
      examples.map((e) => e.participantKey),
      ["SYN-001", "SYN-002", "SYN-V-01", "SYN-I-01"],
    );
    assert.deepEqual(
      examples.map((e) => mapDisposition(e).disposition),
      ["verified", "requires-investigation", "verified", "indeterminate"],
    );
  });
});

// ---------------------------------------------------------------------------
// 4. A recommendation never becomes an approval
// ---------------------------------------------------------------------------

describe("recommendation is not approval (invariant K)", () => {
  it("every recommendation has status recommended and blocked downstream use", () => {
    for (const example of workedExamples()) {
      const rec = mapDisposition(example);
      assert.equal(rec.status, "recommended");
      assert.equal(recommendationIsNotApproval(rec), true);
      assert.equal(rec.downstreamUse.usableInValuation, false);
      assert.equal(rec.downstreamUse.valueCents, null);
      assert.equal(rec.downstreamUse.valueKind, "none");
      assert.equal(rec.downstreamUse.paAmbAccept, null);
    }
  });

  it("a Correction recommended recommendation still authorises nothing downstream", () => {
    const rec = mapDisposition(
      evidence({
        reconstructedMinor: 100000,
        recordedMinor: 120000,
        deltaMinor: 20000,
        withinTolerance: false,
        hypotheses: [{ code: "H2", supportClass: "supported", material: true, correctedBenefitMinor: 100000 }],
        correctionReasonablyCertain: true,
        correctionDirection: "decrease",
      }),
    );
    assert.equal(rec.disposition, "correction-recommended");
    assert.equal(rec.status, "recommended");
    assert.equal(rec.downstreamUse.usableInValuation, false);
    assert.equal(rec.downstreamUse.paAmbAccept, null);
  });

  it("toEntryCheckInput wires the recommendation into decisions.ts without approving anything", () => {
    const example = workedExampleSyn001();
    const rec = mapDisposition(example);
    const entry = toEntryCheckInput(example, rec);
    assert.equal(entry.reconstructedBenefitCents, 150000);
    assert.equal(entry.recordedBenefitCents, 150000);
    assert.equal(entry.deltaCents, 0);
    assert.equal(entry.withinTolerance, true);
    assert.equal(entry.indeterminateContent, null);
    // The guard agrees: the recommended disposition's entry conditions hold.
    const check = checkEntryConditions("verified", entry);
    assert.equal(check.holds, true);
    assert.deepEqual(check.failures, []);
  });

  it("checkRecommendation agrees with the mapping on all four worked examples", () => {
    for (const example of workedExamples()) {
      const rec = mapDisposition(example);
      const check = checkRecommendation(example, rec);
      assert.equal(check.holds, true, `${example.participantKey} → ${rec.disposition}: ${check.failures.join("; ")}`);
    }
  });

  it("checkRecommendation agrees on Supported for acceptance and Correction recommended cases", () => {
    const supported = evidence({
      completenessGrade: "partial",
      recordedMinor: 162000,
      boundsMinor: { min: 158400, max: 162500 },
      boundWidthMaterial: false,
      missingEvidence: [
        { input: "CompensationHistory.salaryYear 2019", missingClass: "M3", decisionImpact: "Narrows the bounds; cannot change the disposition.", uncertaintyContributionMinor: 4100 },
      ],
    });
    assert.equal(checkRecommendation(supported, mapDisposition(supported)).holds, true);

    const correction = evidence({
      reconstructedMinor: 150000,
      recordedMinor: 170000,
      deltaMinor: 20000,
      withinTolerance: false,
      hypotheses: [{ code: "H12", supportClass: "supported", material: true, correctedBenefitMinor: 150000 }],
      correctionReasonablyCertain: true,
      correctionDirection: "decrease",
    });
    assert.equal(checkRecommendation(correction, mapDisposition(correction)).holds, true);
  });

  it("an Indeterminate recommendation carries §5.3 content into the entry check input", () => {
    const example = workedExampleSynI01();
    const rec = mapDisposition(example);
    const entry = toEntryCheckInput(example, rec);
    assert.ok(entry.indeterminateContent !== null);
    assert.equal(entry.indeterminateContent?.justifiedBoundsCents, null);
    assert.ok((entry.indeterminateContent?.noBoundsReason ?? "").length > 0);
    assert.ok((entry.indeterminateContent?.missingEvidence.length ?? 0) > 0);
    assert.ok((entry.indeterminateContent?.dataRequests.length ?? 0) > 0);
    assert.ok((entry.indeterminateContent?.indeterminateRationale ?? "").length > 0);
  });

  it("a blank recorded amount with an exact reconstruction is Requires investigation, with the reconstruction carried as evidence", () => {
    const rec = mapDisposition(evidence({ recordedMinor: null, reconstructedMinor: 100000 }));
    assert.equal(rec.disposition, "requires-investigation");
    assert.match(rec.rationale, /blank/);
    assert.match(rec.supportingEvidence.join(" "), /100000/);
  });
});
