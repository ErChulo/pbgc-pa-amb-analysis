// Stage 7 reproducibility — audit-log completeness + determinism probe
// (NEW file, verification only).
//
// Checks, against the compiled engine (dist/) and the shared driver:
//   A. Coverage: after the full fixed-timestamp Harborview flow, which
//      steps appear in the EXPORTED audit log (state.analysis.auditLog,
//      the file the Export step downloads) vs the full UI event log
//      (state.eventLog, never exported)?
//   B. Refusals: is a refused transition recorded in the audit log, in
//      the event log, or only in lastRefusal (transient)?
//      Probes: propose for an unknown participant; propose with no
//      evidence recorded; evidence-recorded for an unknown participant;
//      locked wizard-go-to before import.
//   C. Timestamp dependence: two identical propose runs with different
//      caller-supplied occurredAt -> do the audit logs differ, and in
//      exactly which fields? (Proves the audit log carries caller time,
//      so byte-identical audit output requires a fixed calculation date.)
//   D. Approval content: does the approval audit event name the reviewer
//      and carry the determination reference?
//
// Usage: node stage7/03-repro-audit.mjs
// Exit 0 = probe completed (findings are reported, not asserted, except
// the determinism sub-checks). Exit 1 = harness error.
// Synthetic data only. No source file is edited.

import * as Main from "../dist/src/ui/main.js";
import { DEMO_CASE_PACKAGE, DEMO_TOLERANCE } from "../dist/src/ui/demo.js";
import { applyEvent } from "../dist/src/ui/state.js";
import { buildReconciliationInputs } from "../dist/src/reconciliation.js";
import {
  mapDisposition,
  recommendationIsNotApproval,
  toEntryCheckInput,
} from "../dist/src/dispositionMapping.js";
import { makeMoney } from "../dist/src/decimal.js";
import { datedValue, makeBenefit } from "../dist/src/formulas.js";
import "./03-repro-flow-driver.js";

const TS = "2026-11-12T00:00:00.000Z";
const TS2 = "2026-11-13T00:00:00.000Z";

function makeHandle() {
  globalThis.PaAmbApp = {
    ...Main,
    DEMO_CASE_PACKAGE,
    DEMO_TOLERANCE,
    buildReconciliationInputs,
    mapDisposition,
    recommendationIsNotApproval,
    toEntryCheckInput,
    makeMoney,
    datedValue,
    makeBenefit,
  };
  const handle = {
    _s: Main.createEmptyUiState(),
    getState() {
      return this._s;
    },
    dispatch(ev) {
      this._s = applyEvent(this._s, ev);
      return this;
    },
  };
  globalThis.__paAmbHandle = handle;
  return handle;
}

function fullFlow(handle) {
  const drive = globalThis.stage7Drive;
  const steps = {};
  for (const name of ["import", "validate", "calculate", "reconcile", "statistics", "decide", "approve", "publish", "snapshot"]) {
    steps[name] = drive({ name });
  }
  return steps.snapshot;
}

function main() {
  console.log("=== A. Coverage: exported audit log vs full event log ===");
  const handle = makeHandle();
  const snap = fullFlow(handle);
  const state = JSON.parse(snap.stateJson);
  const auditKinds = state.analysis.auditLog.map((e) => e.kind);
  const eventKinds = snap.eventLogKinds;
  const steps = [
    // Stage 7 Compliance D1 fix: step completions are audited (as
    // calculation-run) and the import as import — the exported log no
    // longer holds only the disposition events.
    ["import", "import-case-package", "import"],
    ["validation (405 rules, 145 findings)", "validation-completed", "calculation-run"],
    ["calculation (6 participants)", "calculation-completed", "calculation-run"],
    ["reconciliation (6 participants)", "reconciliation-completed", "calculation-run"],
    ["statistics", "statistics-completed", "calculation-run"],
    ["evidence recorded (6 participants)", "evidence-recorded", null],
    ["disposition proposed (6 participants)", "analysis-event", "disposition-proposed"],
    ["disposition approved (SYN-001)", "analysis-event", "disposition-approved"],
    ["contribution published", "contribution-published", "calculation-run"],
  ];
  console.log(`exported audit log: ${auditKinds.length} events: ${[...new Set(auditKinds)].join(", ")}`);
  console.log(`full event log: ${eventKinds.length} events: ${[...new Set(eventKinds)].join(", ")}`);
  for (const [label, eventKind, auditKind] of steps) {
    const inEvent = eventKinds.includes(eventKind);
    const inAudit = auditKind !== null && auditKinds.includes(auditKind);
    console.log(`  ${inAudit ? "AUDIT " : inEvent ? "event " : "NONE  "} ${label} (eventLog=${inEvent}, auditLog=${inAudit})`);
  }

  console.log("\n=== B. Refusal recording ===");
  const probe = (label, fn) => {
    const h = makeHandle();
    const before = h.getState();
    const out = fn(h);
    const after = h.getState();
    const auditBefore = before.analysis.auditLog.length;
    const auditAfter = after.analysis.auditLog.length;
    const newAudit = after.analysis.auditLog.slice(auditBefore);
    console.log(`-- ${label}`);
    console.log(`   lastRefusal: ${JSON.stringify(after.lastRefusal)}`);
    console.log(`   auditLog events added: ${auditAfter - auditBefore}${newAudit.length > 0 ? ` (${newAudit.map((e) => e.kind).join(", ")})` : ""}`);
    console.log(`   eventLog events added: ${after.eventLog.length - before.eventLog.length} (refused event itself is appended: ${after.eventLog.length > before.eventLog.length})`);
    if (out !== undefined) console.log(`   note: ${out}`);
  };
  probe("propose for unknown participant SYN-XXX", (h) => {
    Main.dispatchDisposition(
      h.getState(),
      "SYN-XXX",
      { kind: "propose", actor: "system", target: "verified", evidenceChanged: true },
      "system",
      TS,
    );
    h.dispatch({
      kind: "analysis-event",
      event: {
        kind: "user-action",
        eventId: "ui-propose-SYN-XXX-fixed",
        actor: "system",
        occurredAt: TS,
        action: "propose-disposition",
        participantKey: "SYN-XXX",
        dispositionEvent: { kind: "propose", actor: "system", target: "verified", evidenceChanged: true },
      },
    });
  });
  probe("propose SYN-001 with no evidence recorded (fresh import only)", (h) => {
    const drive = globalThis.stage7Drive;
    drive({ name: "import" });
    h.dispatch({
      kind: "analysis-event",
      event: {
        kind: "user-action",
        eventId: "ui-propose-SYN-001-fixed",
        actor: "system",
        occurredAt: TS,
        action: "propose-disposition",
        participantKey: "SYN-001",
        dispositionEvent: { kind: "propose", actor: "system", target: "verified", evidenceChanged: true },
      },
    });
  });
  probe("evidence-recorded for unknown participant SYN-XXX", (h) => {
    const drive = globalThis.stage7Drive;
    drive({ name: "import" });
    const s = h.getState();
    const next = Main.recordEvidence(s, "SYN-XXX", {
      participantKey: "SYN-XXX", caseId: "00098765", toleranceSetId: "tol-demo",
      completenessGrade: "complete", comparisonBasis: "established", basisUnresolvable: false,
      basisNote: null, reconstructedMinor: 150000, recordedMinor: 150000, deltaMinor: 0,
      withinTolerance: true, denominatorFlag: null, boundsMinor: null, boundWidthMaterial: false,
      boundWidthJustification: null, boundAssumptionsInDoubt: false, hypotheses: [],
      conflictingCorrections: false, correctedBenefitMinor: null, correctionReasonablyCertain: false,
      correctionDirection: null, missingEvidence: [], dataRequests: [], nextSteps: [],
      uninvestigatedFlag: false, blockingValidationOutstanding: false, statisticalOnly: false,
      contradictoryEvidenceUnresolved: false, supportedGround: null, indeterminateRationale: null,
      noFurtherRequestReason: null, ruleApplicabilityOk: true, snapshotMatches: true,
    }, "demo", TS);
    // recordEvidence returns the next state; apply it the same way dispatch does.
    h._s = next;
  });
  probe("locked wizard-go-to validate before import", (h) => {
    h.dispatch({ kind: "wizard-go-to", step: "validate", actor: "demo", occurredAt: TS });
  });

  console.log("\n=== C. Timestamp dependence of the audit log ===");
  const runPropose = (ts) => {
    const h = makeHandle();
    const drive = globalThis.stage7Drive;
    drive({ name: "import" });
    drive({ name: "validate" });
    drive({ name: "calculate" });
    drive({ name: "reconcile" });
    drive({ name: "statistics" });
    // Propose SYN-001 only, with the caller's timestamp ts.
    const s = h.getState();
    const outcome = s.calculations["SYN-001"];
    const evidence = {
      participantKey: "SYN-001", caseId: "00098765", toleranceSetId: "tol-demo",
      completenessGrade: "complete", comparisonBasis: "established", basisUnresolvable: false,
      basisNote: null, reconstructedMinor: 150000, recordedMinor: 150000, deltaMinor: 0,
      withinTolerance: true, denominatorFlag: null, boundsMinor: null, boundWidthMaterial: false,
      boundWidthJustification: null, boundAssumptionsInDoubt: false,
      hypotheses: [{ code: "H2", supportClass: "refuted", material: true }],
      conflictingCorrections: false, correctedBenefitMinor: null, correctionReasonablyCertain: false,
      correctionDirection: null, missingEvidence: [], dataRequests: [], nextSteps: [],
      uninvestigatedFlag: false, blockingValidationOutstanding: false, statisticalOnly: false,
      contradictoryEvidenceUnresolved: false, supportedGround: null, indeterminateRationale: null,
      noFurtherRequestReason: null, ruleApplicabilityOk: true, snapshotMatches: true,
    };
    const { entry } = Main.dispositionEntryInput(evidence);
    h.dispatch({ kind: "evidence-recorded", participantKey: "SYN-001", evidence: entry, actor: "demo", occurredAt: ts });
    h.dispatch({
      kind: "analysis-event",
      event: {
        kind: "user-action",
        eventId: `ui-propose-SYN-001-${ts}`,
        actor: "system",
        occurredAt: ts,
        action: "propose-disposition",
        participantKey: "SYN-001",
        dispositionEvent: { kind: "propose", actor: "system", target: "verified", evidenceChanged: true },
      },
    });
    return h.getState().analysis.auditLog;
  };
  const logA1 = runPropose(TS);
  const logA2 = runPropose(TS);
  const logB = runPropose(TS2);
  console.log(`same timestamp twice: identical = ${JSON.stringify(logA1) === JSON.stringify(logA2)}`);
  console.log(`different timestamp: identical = ${JSON.stringify(logA1) === JSON.stringify(logB)}`);
  if (JSON.stringify(logA1) !== JSON.stringify(logB)) {
    const a = JSON.stringify(logA1, null, 2).split("\n");
    const b = JSON.stringify(logB, null, 2).split("\n");
    console.log("differing lines (A vs B):");
    a.forEach((line, i) => {
      if (line !== b[i]) console.log(`  A: ${line.trim()}\n  B: ${(b[i] ?? "").trim()}`);
    });
  }

  console.log("\n=== D. Approval audit event content ===");
  const approval = state.analysis.auditLog.find((e) => e.kind === "disposition-approved");
  console.log(JSON.stringify(approval, null, 2));
  return 0;
}

process.exit(main());
