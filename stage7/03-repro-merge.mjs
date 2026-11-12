// Stage 7 reproducibility — WorkProductLog merge determinism (NEW file).
//
// Verifies src/contribution.ts mergeLogs against spec §9.3 / MONADIC
// §9.4: associative append with deterministic first-seen order, dedup
// by stable id, conflict escalation (never silent discard).
//
// Tests:
//   T1  identity: mergeLogs(emptyLog, x) == x and mergeLogs(x, emptyLog) == x
//   T2  determinism: mergeLogs(a, b) twice -> identical bytes
//   T3  order-dependence: mergeLogs(a, b) vs mergeLogs(b, a) with disjoint
//       findings -> same SET, different ORDER (first-seen wins). The merge
//       is associative, NOT commutative; this test states that explicitly.
//   T4  associativity: (a+b)+c == a+(b+c) for disjoint logs, exact
//       duplicates, conflicting findings, conflicting fragments, and a
//       mixed log with all of those at once
//   T5  conflict escalation: same findingId+version, different content ->
//       first kept, reviewState "disputed", one blocking conflict issue
//   T6  idempotence: mergeLogs(x, x) == x (exact duplicates dedup silently)
//   T7  dedup: same finding in a and b -> appears once, no issue
//   T8  supersession is NOT a conflict: same findingId, different
//       originatingVersion -> both kept, no issue
//   T9  inputs are not mutated by a merge
//   T10 trace events dedup by full content
//
// Usage: node stage7/03-repro-merge.mjs
// Exit 0 = all pass. Exit 1 = any fail (prints expected vs actual).
// Synthetic data only. No source file is edited.

import { mergeLogs, emptyLog, isEmptyLog } from "../dist/src/contribution.js";

let failures = 0;
function check(name, cond, detail = "") {
  console.log(`  ${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " — " + detail}`);
  if (!cond) failures += 1;
}

/** Canonical JSON: sorted object keys, so key insertion order never matters. */
function canon(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
}
const eq = (a, b) => canon(a) === canon(b);

function makeFinding(overrides = {}) {
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
function makeFragment(overrides = {}) {
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
function makeEvidence(overrides = {}) {
  return {
    evidenceId: "ev-plan",
    sourceDocumentId: "doc-plan",
    imageViewerDocumentNumber: "123",
    location: { kind: "document-section", section: "§5.01", page: 5 },
    accessStatus: "verified",
    workProductRef: null,
    ...overrides,
  };
}
function makeStep(overrides = {}) {
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
function makeLog(overrides = {}) {
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

function main() {
  console.log("T1 identity");
  const x = makeLog({
    findings: [makeFinding()],
    fragments: [makeFragment()],
    evidenceRefs: [makeEvidence()],
    traceEvents: [makeStep()],
  });
  check("mergeLogs(empty, x) == x", eq(mergeLogs(emptyLog, x), x));
  check("mergeLogs(x, empty) == x", eq(mergeLogs(x, emptyLog), x));
  check("isEmptyLog(emptyLog)", isEmptyLog(emptyLog) === true);

  console.log("T2 determinism (same merge twice)");
  const a = makeLog({ findings: [makeFinding({ findingId: "f-a" })] });
  const b = makeLog({ findings: [makeFinding({ findingId: "f-b" })] });
  check("mergeLogs(a,b) twice identical", eq(mergeLogs(a, b), mergeLogs(a, b)));

  console.log("T3 order-dependence (associative, NOT commutative)");
  const ab = mergeLogs(a, b);
  const ba = mergeLogs(b, a);
  const abIds = ab.findings.map((f) => f.findingId);
  const baIds = ba.findings.map((f) => f.findingId);
  check("a+b order is [f-a, f-b]", JSON.stringify(abIds) === '["f-a","f-b"]', JSON.stringify(abIds));
  check("b+a order is [f-b, f-a]", JSON.stringify(baIds) === '["f-b","f-a"]', JSON.stringify(baIds));
  check("a+b != b+a (first-seen order is part of the result)", !eq(ab, ba));

  console.log("T4 associativity (a+b)+c == a+(b+c)");
  const c = makeLog({ findings: [makeFinding({ findingId: "f-c" })] });
  check("disjoint", eq(mergeLogs(mergeLogs(a, b), c), mergeLogs(a, mergeLogs(b, c))));
  const dup = makeLog({ findings: [makeFinding({ findingId: "f-a" })] });
  check("exact duplicates", eq(mergeLogs(mergeLogs(a, dup), c), mergeLogs(a, mergeLogs(dup, c))));
  const conflictB = makeLog({
    findings: [makeFinding({ findingId: "f-a", findingStatement: "Different statement for the same finding." })],
  });
  const leftC = mergeLogs(mergeLogs(a, conflictB), c);
  const rightC = mergeLogs(a, mergeLogs(conflictB, c));
  check(
    "conflicting finding",
    eq(leftC, rightC),
    `left=${canon(leftC).slice(0, 400)} right=${canon(rightC).slice(0, 400)}`,
  );
  const fragA = makeLog({ fragments: [makeFragment({ fragmentId: "frag-1", content: "Version one." })] });
  const fragB = makeLog({ fragments: [makeFragment({ fragmentId: "frag-1", content: "Version two." })] });
  const fragC = makeLog({ fragments: [makeFragment({ fragmentId: "frag-2", content: "Unrelated." })] });
  check("conflicting fragment", eq(mergeLogs(mergeLogs(fragA, fragB), fragC), mergeLogs(fragA, mergeLogs(fragB, fragC))));
  const mixedA = makeLog({ findings: [makeFinding({ findingId: "f-a" })], fragments: [makeFragment({ fragmentId: "frag-1", content: "One." })] });
  const mixedB = makeLog({
    findings: [makeFinding({ findingId: "f-a", findingStatement: "Changed." }), makeFinding({ findingId: "f-b" })],
    fragments: [makeFragment({ fragmentId: "frag-1", content: "Two." })],
    evidenceRefs: [makeEvidence()],
  });
  const mixedC = makeLog({ findings: [makeFinding({ findingId: "f-b" })], traceEvents: [makeStep()] });
  check("mixed (findings + fragments + evidence + trace)", eq(mergeLogs(mergeLogs(mixedA, mixedB), mixedC), mergeLogs(mixedA, mergeLogs(mixedB, mixedC))));

  console.log("T5 conflict escalation");
  const m = mergeLogs(a, conflictB);
  check("first entry kept", m.findings[0].findingStatement === "Reconstructed accrued benefit is $849.50 per month for participant SYN-001.");
  check("kept entry marked disputed", m.findings[0].reviewState === "disputed", `got ${m.findings[0].reviewState}`);
  check("exactly one open issue", m.openIssues.length === 1, `got ${m.openIssues.length}`);
  check(
    "issue is blocking conflict with deterministic id",
    m.openIssues[0].kind === "conflict" && m.openIssues[0].severity === "blocking" && m.openIssues[0].issueId === "conflict:finding:f-a@0.1.0 / run-1",
    JSON.stringify(m.openIssues[0]),
  );
  const m2 = mergeLogs(m, conflictB);
  check("re-merging the conflict does not duplicate the issue", m2.openIssues.length === 1, `got ${m2.openIssues.length}`);

  console.log("T6 idempotence mergeLogs(x, x) == x");
  check("mergeLogs(x, x) == x", eq(mergeLogs(x, x), x), canon(mergeLogs(x, x)).slice(0, 300));

  console.log("T7 dedup of exact duplicates");
  const d = mergeLogs(a, dup);
  check("finding appears once", d.findings.length === 1, `got ${d.findings.length}`);
  check("no issue raised for an exact duplicate", d.openIssues.length === 0);

  console.log("T8 supersession is not a conflict");
  const v2 = makeLog({ findings: [makeFinding({ findingId: "f-a", originatingVersion: "0.1.0 / run-2" })] });
  const sup = mergeLogs(a, v2);
  check("both versions kept", sup.findings.length === 2, `got ${sup.findings.length}`);
  check("no issue raised for a new version", sup.openIssues.length === 0);

  console.log("T9 inputs are not mutated");
  const beforeA = canon(a);
  const beforeB = canon(conflictB);
  mergeLogs(a, conflictB);
  check("a unchanged", canon(a) === beforeA);
  check("b unchanged", canon(conflictB) === beforeB);

  console.log("T10 trace events dedup by full content");
  const t1 = makeLog({ traceEvents: [makeStep(), makeStep({ step: 2, name: "rounding" })] });
  const t2 = makeLog({ traceEvents: [makeStep(), makeStep({ step: 3, name: "limits" })] });
  const tm = mergeLogs(t1, t2);
  check("identical step appears once, distinct steps kept", tm.traceEvents.length === 3, `got ${tm.traceEvents.length}`);

  if (failures > 0) {
    console.error(`FAIL: ${failures} merge check(s) failed`);
    return 1;
  }
  console.log("PASS: all merge checks passed (associative + first-seen order; order-dependent, not commutative)");
  return 0;
}

process.exit(main());
