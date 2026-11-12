// Stage 7 compliance — live Playwright checks (Verifier, read-only).
//
// Run: node stage7/02-playwright-compliance.mjs
// Exit 0 when every check passes; exit 1 on any FAIL.
// Writes stage7/02-playwright-results.json (new file) and prints a summary.
// Never edits source. Opens pa-amb-analysis.html via file:// only,
// no server, no flags beyond headless. Synthetic demo data only.
//
// Reuses the Stage 6 wizard driver verbatim: the `drive` function is
// extracted from test/ui-playwright/wizard-flow.test.mjs (between
// "function drive(action) {" and "async function main()") and evaluated
// in-page, so the wizard run is the same run Stage 6 verified.
//
// Sections:
//  L1  load + reload: 0 http/https requests, only file://, no page errors
//  L2  full wizard run on the Harborview demo (validate/calculate/
//      reconcile/statistics/decide/approve/publish/export) with network
//      recording throughout; determinism (calculate twice, same result)
//  L3  exported audit log: the 7 disposition events (6 proposes +
//      1 approve) PLUS calculation-run/import events (Stage 7 fix:
//      step completions are audited) vs the in-memory UiState.eventLog
//  L4  §19 warning: CSV/XLSX/audit-log/contribution all show the warning
//      dialog (accept -> download, dismiss -> no download); audit-log
//      and contribution were gated by the Stage 7 Compliance D2 fix
//  L5  human-gate attacks: approve with actor system / "" / reviewer
//      system / reviewer mismatch / confirmations false / incomplete
//      determination / approve-without-recommendation / determination
//      disposition mismatch; propose-by-system stays recommendation-only

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(
  "/home/hatch/workspace/pbgc-pa-amb-analysis/stage3/live-test/package.json",
);
const { chromium } = require("playwright");

const ROOT = "/home/hatch/workspace/pbgc-pa-amb-analysis";
const APP_URL = `file://${ROOT}/pa-amb-analysis.html`;
const WIZARD_TEST = readFileSync(join(ROOT, "test/ui-playwright/wizard-flow.test.mjs"), "utf8");
const DRIVE_START = WIZARD_TEST.indexOf("function drive(action) {");
const DRIVE_END = WIZARD_TEST.indexOf("\nasync function main()");
if (DRIVE_START === -1 || DRIVE_END === -1) throw new Error("could not extract drive() from wizard-flow.test.mjs");
const DRIVE_SRC = WIZARD_TEST.slice(DRIVE_START, DRIVE_END);

const EXPECTED_WARNING =
  "Warning: this participant-data export may contain sensitive participant information " +
  "(names, dates of birth, benefit amounts). It is processed locally only and " +
  "must not be sent outside PBGC systems. Confirm you need this export before it is written.";

const results = { checks: [] };
let failures = 0;
function check(name, cond, evidence) {
  results.checks.push({ name, pass: cond, evidence });
  console.log(`${cond ? "PASS" : "FAIL"} ${name} — ${evidence}`);
  if (!cond) failures += 1;
}

async function drive(page, action) {
  return page.evaluate(`(${DRIVE_SRC})(${JSON.stringify(action)})`);
}

async function openApp() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  const failedRequests = [];
  const requests = [];
  const dialogs = [];
  let dialogMode = "accept"; // "accept" | "dismiss" | "record"
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("requestfailed", (r) => failedRequests.push(r.url()));
  page.on("request", (r) => requests.push(r.url()));
  page.on("dialog", async (d) => {
    dialogs.push({ type: d.type(), message: d.message() });
    if (dialogMode === "dismiss") await d.dismiss();
    else await d.accept();
  });
  await page.goto(APP_URL);
  await page.waitForTimeout(300);
  await page.waitForSelector("#pa-amb-app");
  return {
    browser, context, page, errors, failedRequests, requests, dialogs,
    setDialogMode: (m) => { dialogMode = m; },
  };
}

async function download(page, buttonId, timeout = 10000) {
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout }),
    page.locator(buttonId).click(),
  ]);
  return { filename: dl.suggestedFilename(), path: await dl.path() };
}

async function tryDownload(page, buttonId, timeout = 2500) {
  try {
    return await download(page, buttonId, timeout);
  } catch {
    return null;
  }
}

// In-page approval-attempt helper (built from the same determination /
// approval shape the Stage 6 driver uses for the legitimate approval).
const ATTEMPT_APPROVE_SRC = `
(key, opts) => {
  const handle = window.__paAmbHandle;
  const state = handle.getState();
  const current = state.analysis.participants[key].disposition;
  const determination = {
    determinationId: "det-attack-1",
    dispositionId: current === null ? "none" : current.dispositionId,
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
    supportingDocuments: [{ documentId: "doc-demo-census", citation: "Synthetic plan \\u00a75.01 (demo)", whatItSupports: "unit-credit formula, 1.5% accrual rate, final-3-year average" }],
    recommendedDisposition: { disposition: opts.detDisposition || "verified", recommendedBy: "system", recommendedAt: "2026-11-12", recommendationRationale: "Independent calculation agrees exactly with the recorded benefit." },
    humanDetermination: {
      disposition: opts.detDisposition || "verified",
      rationale: opts.detRationale === undefined ? "Independent reconstruction $1,500.00; recorded $1,500.00; exact agreement on the same basis; no other discrepancy." : opts.detRationale,
      reviewer: opts.detReviewer || "A. Actuary", reviewerRole: "case actuary",
      determinationDate: "2026-11-12", approvalId: null,
    },
    dataRequests: [],
    downstream: { usableInValuation: true, valueCents: 150000, valueKind: "recorded", paAmbAccept: "Y" },
    contentHash: "content-hash-demo-1",
  };
  const approval = {
    approvalId: "appr-attack-1",
    reviewer: opts.reviewer === undefined ? "A. Actuary" : opts.reviewer,
    reviewerRole: "case actuary",
    rationale: "Independent reconstruction $1,500.00; recorded $1,500.00; exact agreement on the same basis; no other discrepancy.",
    approvalDate: "2026-11-12",
    evidenceSnapshot: {
      snapshotId: "snap-attack-1",
      inputSnapshotHash: state.analysis.inputSnapshot.snapshotHash,
      calculationRunId: "run-demo-1",
      ruleVersion: state.analysis.ruleVersions.validationRules,
      toleranceSetId: "tol-demo",
      dispositionSchemaVersion: "1.0.0",
      determinationId: "det-attack-1",
      sourceDocumentIds: ["doc-demo-census"],
      calculationTraceHash: "trace-demo-1",
      boundsAssumptionsHash: null,
    },
    confirmations: opts.confirmations || { entryConditionsHold: true, determinationComplete: true, toleranceIdentified: true, noMaterialUnexplainedItem: true },
  };
  const before = current === null ? null : current.status + "/" + current.disposition;
  try {
    handle.dispatch({
      kind: "analysis-event",
      event: {
        kind: "user-action",
        eventId: "ui-attack-" + key + "-" + Date.now(),
        actor: opts.actor,
        occurredAt: "2026-11-12T00:00:00.000Z",
        action: "approve-disposition",
        participantKey: key,
        dispositionEvent: { kind: "approve", actor: opts.actor, determination, approval },
      },
    });
  } catch (e) {
    return { threw: String(e), before, after: null, refusal: null };
  }
  const afterRec = handle.getState().analysis.participants[key].disposition;
  return {
    threw: null,
    before,
    after: afterRec === null ? null : afterRec.status + "/" + afterRec.disposition,
    refusal: handle.getState().lastRefusal,
    auditKinds: handle.getState().analysis.auditLog.map((e) => e.kind),
  };
}
`;

async function main() {
  // ---- L1 + L2: open, reload, full wizard run, network recorded throughout
  const app = await openApp();
  const { browser, page, errors, failedRequests, requests, dialogs } = app;
  try {
    await page.reload();
    await page.waitForSelector("#pa-amb-app");
    await page.waitForTimeout(500);
    check("L1a booted with no page/console errors (load + reload)",
      errors.length === 0 && failedRequests.length === 0,
      `errors: ${errors.join(" | ") || "none"}; failed requests: ${failedRequests.join(", ") || "none"}`);
    const http = requests.filter((u) => u.startsWith("http://") || u.startsWith("https://"));
    const nonFile = requests.filter((u) => !u.startsWith("file://"));
    check("L1b 0 http/https requests across load + reload", http.length === 0,
      `${http.length} http/https; ${requests.length} total request(s), all file://: ${requests.length === 0 ? "none recorded" : "yes"}`);
    check("L1c every recorded request is a file:// document load", nonFile.length === 0,
      `non-file requests: ${nonFile.join(", ") || "none"}`);

    // Demo import.
    await page.locator("#demo-button").click();
    const imported = await page.evaluate(() => ({
      n: Object.keys(window.__paAmbHandle.getState().analysis.participants).length,
      step: window.__paAmbHandle.getState().wizard.currentStep,
    }));
    check("L2a demo case loads (Harborview, 6 SYN participants)", imported.n === 6,
      `${imported.n} participants`);

    // Validate / calculate / reconcile / statistics.
    const validation = await drive(page, { name: "validate" });
    check("L2b validate: 6 results, rules evaluated",
      validation.participantResults === 6 && validation.rulesEvaluated > 0,
      `${validation.participantResults} results, ${validation.rulesEvaluated} rules, ${validation.findings} findings`);
    const calc1 = await drive(page, { name: "calculate" });
    const calc2 = await drive(page, { name: "calculate" });
    check("L2c calculate: SYN-001 exact $1,500.00, SYN-V-01 $849.50, bounds + indeterminate",
      calc1["SYN-001"].kind === "exact" && calc1["SYN-001"].minor === 150000
        && calc1["SYN-V-01"].minor === 84950
        && calc1["SYN-002"].kind === "bounds" && calc1["SYN-002"].bounds.min === 158400
        && calc1["SYN-I-01"].kind === "indeterminate",
      `SYN-001 ${calc1["SYN-001"].kind}/${calc1["SYN-001"].minor}; SYN-002 bounds ${calc1["SYN-002"].bounds?.min}-${calc1["SYN-002"].bounds?.max}; SYN-I-01 ${calc1["SYN-I-01"].kind}`);
    check("L2d determinism: second calculation run is byte-identical to the first",
      JSON.stringify(calc1) === JSON.stringify(calc2),
      "calc run 1 === calc run 2 (JSON)");
    const recon = await drive(page, { name: "reconcile" });
    check("L2e reconcile: SYN-003 delta $1,000.00 outside tolerance",
      recon["SYN-003"].delta === 100000 && recon["SYN-003"].toleranceVerdict === "outside-tolerance"
        && recon["SYN-001"].delta === 0,
      `SYN-003 delta ${recon["SYN-003"].delta}; SYN-001 delta ${recon["SYN-001"].delta}`);
    const stats = await drive(page, { name: "statistics" });
    check("L2f statistics: SYN-003 flagged by modified-z, population 6",
      stats.populationN === 6 && stats.flags.some((f) => f.key === "SYN-003" && f.method === "modified-z"),
      `n=${stats.populationN}; flags: ${stats.flags.map((f) => `${f.key}/${f.method}`).join(",")}`);

    // Decide + legitimate human approval + publish.
    const decided = await drive(page, { name: "decide" });
    check("L2g decide: all six recommended, none refused",
      Object.values(decided).every((d) => d.refusal === null)
        && decided["SYN-001"].recommended === "verified" && decided["SYN-001"].status === "recommended",
      Object.entries(decided).map(([k, d]) => `${k}:${d.recommended}/${d.status}`).join(" "));
    const approved = await drive(page, { name: "approve" });
    check("L2h legitimate human approval applies (A. Actuary, verified)",
      approved.status === "approved" && approved.disposition === "verified",
      `${approved.status}/${approved.disposition}; refusal: ${approved.refusal}`);
    const published = await drive(page, { name: "publish" });
    check("L2i publish contribution (protocol v0.1.0, findings present)",
      published.findings > 0 && published.protocol === "0.1.0",
      `${published.findings} findings, ${published.fragments} fragments`);

    // Network across the whole wizard run (load + reload + all steps).
    const httpAll = requests.filter((u) => u.startsWith("http://") || u.startsWith("https://"));
    const nonFileAll = requests.filter((u) => !u.startsWith("file://"));
    check("L2j 0 http/https requests across the FULL wizard run",
      httpAll.length === 0, `${httpAll.length} http/https; ${requests.length} total requests recorded`);
    check("L2k every request in the full run is file://", nonFileAll.length === 0,
      `non-file: ${nonFileAll.join(", ") || "none"}`);

    // Invariants rendered in the DOM.
    const invText = await page.locator("#invariant-list").textContent();
    const invFails = (invText.match(/Fail —/g) ?? []).length;
    check("L2l all 9 invariants hold after the full run", invFails === 0 && (invText.match(/Pass —/g) ?? []).length === 9,
      `Pass: ${(invText.match(/Pass —/g) ?? []).length}, Fail: ${invFails}`);

    // ---- L3: exported audit log
    await page.locator('[data-wizard-step="export"]').click();
    const audit = await download(page, "#export-audit-log");
    check("L3a audit-log download filename", audit.filename === "00098765-audit-log.json",
      audit.filename);
    const auditLog = JSON.parse(readFileSync(audit.path, "utf8"));
    const kinds = auditLog.map((e) => e.kind);
    const kindCounts = {};
    for (const k of kinds) kindCounts[k] = (kindCounts[k] ?? 0) + 1;
    check("L3b audit log holds the 7 disposition events AND the calculation-run/import events (Stage 7 fix: step completions are audited)",
      kindCounts["disposition-proposed"] === 6 && kindCounts["disposition-approved"] === 1
        && (kindCounts["calculation-run"] ?? 0) > 0 && (kindCounts["import"] ?? 0) > 0,
      `${auditLog.length} events: ${JSON.stringify(kindCounts)}`);
    check("L3c every approval is in the audit log (1 approval, SYN-001, reviewer A. Actuary)",
      auditLog.filter((e) => e.kind === "disposition-approved").length === 1
        && auditLog.some((e) => e.kind === "disposition-approved" && e.summary.includes("A. Actuary")),
      auditLog.filter((e) => e.kind === "disposition-approved").map((e) => e.summary).join(" | "));
    const stateAudit = await page.evaluate(() => {
      const s = window.__paAmbHandle.getState();
      return {
        auditLogLen: s.analysis.auditLog.length,
        eventLogLen: s.eventLog.length,
        eventLogKinds: [...new Set(s.eventLog.map((e) => e.kind))],
        calcEventsInAudit: s.analysis.auditLog.filter((e) => e.kind === "calculation-run").length,
      };
    });
    check("L3d calculations ARE in the exported audit log (Stage 7 fix: calculation-run events are audited)",
      stateAudit.calcEventsInAudit > 0,
      `auditLog=${stateAudit.auditLogLen} events, eventLog=${stateAudit.eventLogLen} events (${stateAudit.eventLogKinds.join(", ")}); calculation-run events in audit log: ${stateAudit.calcEventsInAudit}`);
    check("L3e validation/calculation/reconciliation/statistics/import are in the in-memory eventLog (and, Stage 7 fix, also audited as calculation-run/import)",
      stateAudit.eventLogKinds.includes("validation-completed")
        && stateAudit.eventLogKinds.includes("calculation-completed")
        && stateAudit.eventLogKinds.includes("reconciliation-completed")
        && stateAudit.eventLogKinds.includes("statistics-completed")
        && stateAudit.eventLogKinds.includes("import-case-package"),
      `eventLog kinds: ${stateAudit.eventLogKinds.join(", ")}`);

    // ---- L4: §19 warning dialogs
    const dialogsBefore = dialogs.length;
    app.setDialogMode("accept");
    const csv = await download(page, "#export-reconciliation-csv");
    const csvDialogs = dialogs.slice(dialogsBefore);
    check("L4a CSV export shows the §19 warning dialog with the exact warning text",
      csvDialogs.length === 1 && csvDialogs[0].type === "confirm" && csvDialogs[0].message === EXPECTED_WARNING,
      csvDialogs.length === 1 ? `type=${csvDialogs[0].type}, text matches: ${csvDialogs[0].message === EXPECTED_WARNING}` : `${csvDialogs.length} dialog(s)`);
    check("L4b CSV downloads after accepting the warning", csv.filename === "00098765-reconciliation.csv",
      csv.filename);
    const csvText = readFileSync(csv.path, "utf8");
    check("L4c CSV content is the reconciliation (6 rows, SYN-003 delta 100000)",
      csvText.includes("participantKey,recordedMinor") && ["SYN-001", "SYN-003"].every((k) => csvText.includes(k)) && csvText.includes("100000"),
      `${csvText.split("\r\n").length - 1} data rows`);
    // Dismiss -> no download.
    const dialogsBeforeDismiss = dialogs.length;
    app.setDialogMode("dismiss");
    const noCsv = await tryDownload(page, "#export-reconciliation-csv");
    const dismissDialogs = dialogs.slice(dialogsBeforeDismiss);
    check("L4d dismissing the warning blocks the CSV export (no download)",
      noCsv === null && dismissDialogs.length === 1 && dismissDialogs[0].message === EXPECTED_WARNING,
      `download: ${noCsv === null ? "none (blocked)" : noCsv.filename}; dialogs: ${dismissDialogs.length}`);
    // XLSX: warning shown, accept -> download.
    const dialogsBeforeXlsx = dialogs.length;
    app.setDialogMode("accept");
    const xlsx = await download(page, "#export-reconciliation-xlsx");
    const xlsxDialogs = dialogs.slice(dialogsBeforeXlsx);
    check("L4e XLSX export shows the §19 warning dialog and downloads on accept",
      xlsxDialogs.length === 1 && xlsxDialogs[0].message === EXPECTED_WARNING && xlsx.filename === "00098765-reconciliation.xlsx",
      `dialogs: ${xlsxDialogs.length}; file: ${xlsx.filename}`);
    // Audit-log export: §19 warning is now shown (Stage 7 Compliance D2 fix).
    const dialogsBeforeAudit2 = dialogs.length;
    app.setDialogMode("accept");
    const audit2 = await download(page, "#export-audit-log");
    const auditDialogs = dialogs.slice(dialogsBeforeAudit2);
    check("L4f audit-log export shows a §19 warning dialog (Stage 7 fix)",
      auditDialogs.length === 1,
      `dialogs on audit-log export: ${auditDialogs.length}; file downloaded anyway: ${audit2.filename}`);
    // Contribution export: §19 warning is now shown (Stage 7 Compliance D2 fix).
    const dialogsBeforeContrib = dialogs.length;
    const contrib = await download(page, "#export-contribution");
    const contribDialogs = dialogs.slice(dialogsBeforeContrib);
    check("L4g contribution-package export shows a §19 warning dialog (Stage 7 fix)",
      contribDialogs.length === 1,
      `dialogs on contribution export: ${contribDialogs.length}; file downloaded anyway: ${contrib.filename}`);

    check("L2m no page/console errors by end of run",
      errors.length === 0 && failedRequests.length === 0,
      `errors: ${errors.join(" | ") || "none"}; failed requests: ${failedRequests.join(", ") || "none"}`);
  } finally {
    await browser.close();
  }

  // ---- L5: human-gate attacks (fresh page: demo + decide, then attack)
  const app2 = await openApp();
  try {
    const { browser, page } = app2;
    await page.locator("#demo-button").click();
    await drive(page, { name: "validate" });
    await drive(page, { name: "calculate" });
    await drive(page, { name: "reconcile" });
    await drive(page, { name: "statistics" });
    await drive(page, { name: "decide" });

    const attempt = async (key, opts) =>
      page.evaluate(`(${ATTEMPT_APPROVE_SRC})(${JSON.stringify(key)}, ${JSON.stringify(opts)})`);

    const a1 = await attempt("SYN-001", { actor: "system" });
    check("L5a approve with actor 'system' is refused (human-gate), stays recommended",
      a1.threw === null && a1.after === "recommended/verified" && (a1.refusal ?? "").includes("only an authorized human reviewer"),
      `after=${a1.after}; refusal=${a1.refusal}`);
    const a2 = await attempt("SYN-001", { actor: "" });
    check("L5b approve with empty actor is refused (human-gate)",
      a2.threw === null && a2.after === "recommended/verified" && (a2.refusal ?? "").includes("only an authorized human reviewer"),
      `after=${a2.after}; refusal=${a2.refusal}`);
    const a3 = await attempt("SYN-001", { actor: "A. Actuary", reviewer: "system" });
    check("L5c approve with reviewer 'system' is refused",
      a3.threw === null && a3.after === "recommended/verified"
        && ((a3.refusal ?? "").includes("not the system") || (a3.refusal ?? "").includes("must be the reviewer named")),
      `after=${a3.after}; refusal=${a3.refusal} (reviewer-mismatch fires before the system-reviewer check in T3; the approval is refused either way)`);
    const a3b = await attempt("SYN-001", { actor: "A. Actuary", reviewer: "system", detReviewer: "system" });
    check("L5c2 approve where determination AND approval both name reviewer 'system' is refused by approveDetermination",
      a3b.threw === null && a3b.after === "recommended/verified" && (a3b.refusal ?? "").includes("is the system"),
      `after=${a3b.after}; refusal=${a3b.refusal} (§14 item 10 completeness refuses a 'system' reviewer before the approval gate is reached)`);
    const a4 = await attempt("SYN-001", { actor: "A. Actuary", reviewer: "B. Reviewer" });
    check("L5d approve by someone other than the named reviewer is refused",
      a4.threw === null && a4.after === "recommended/verified" && (a4.refusal ?? "").includes("must be the reviewer named"),
      `after=${a4.after}; refusal=${a4.refusal}`);
    const a5 = await attempt("SYN-001", {
      actor: "A. Actuary",
      confirmations: { entryConditionsHold: false, determinationComplete: true, toleranceIdentified: true, noMaterialUnexplainedItem: true },
    });
    check("L5e approve with a false §4.2 confirmation is refused",
      a5.threw === null && a5.after === "recommended/verified" && (a5.refusal ?? "").includes("entry conditions do not hold"),
      `after=${a5.after}; refusal=${a5.refusal}`);
    const a6 = await attempt("SYN-001", { actor: "A. Actuary", detRationale: "" });
    check("L5f approve with an empty determination rationale is refused (G-INV-7)",
      a6.threw === null && a6.after === "recommended/verified",
      `after=${a6.after}; refusal=${a6.refusal}`);
    const a7 = await attempt("SYN-003", { actor: "A. Actuary", detDisposition: "verified" });
    check("L5g T3 refuses an approval whose determination says 'verified' while the current disposition is requires-investigation (Stage 7 fix)",
      a7.threw === null && a7.after === "recommended/requires-investigation"
        && (a7.refusal ?? "").toLowerCase().includes("disposition"),
      `after=${a7.after}; refusal=${a7.refusal}`);
    if (a7.after === "approved/requires-investigation") {
      const downstream = await page.evaluate(() => {
        const d = window.__paAmbHandle.getState().analysis.participants["SYN-003"].disposition;
        return d === null ? null : d.downstreamUse;
      });
      check("L5g2 mismatched-determination approval (as applied) still blocks valuation use",
        downstream !== null && downstream.usableInValuation === false && downstream.paAmbAccept === "N",
        `downstreamUse: ${JSON.stringify(downstream)}`);
    } else {
      check("L5g2 the mismatched approval was refused, so no valuation use was ever attached",
        (a7.refusal ?? "").length > 0,
        `refusal=${a7.refusal}`);
    }
    // Propose by the system: allowed by design, recommendation only.
    const propose = await page.evaluate(() => {
      const handle = window.__paAmbHandle;
      const before = handle.getState().analysis.participants["SYN-V-01"].disposition;
      handle.dispatch({
        kind: "analysis-event",
        event: {
          kind: "user-action",
          eventId: "ui-propose-sys-fixed",
          actor: "system",
          occurredAt: "2026-11-12T00:00:00.000Z",
          action: "propose-disposition",
          participantKey: "SYN-V-01",
          dispositionEvent: { kind: "propose", actor: "system", target: "verified", evidenceChanged: true },
        },
      });
      const after = handle.getState().analysis.participants["SYN-V-01"].disposition;
      return {
        before: before === null ? null : before.status,
        after: after === null ? null : after.status + "/" + after.disposition,
        downstream: after === null ? null : after.downstreamUse,
        refusal: handle.getState().lastRefusal,
      };
    });
    check("L5h system propose stays a recommendation with NO downstream effect (by design)",
      propose.after === "recommended/verified" && propose.downstream !== null
        && propose.downstream.usableInValuation === false && propose.downstream.paAmbAccept === null,
      `after=${propose.after}; downstreamUse=${JSON.stringify(propose.downstream)}`);
    // No approved disposition created by the system anywhere.
    const sysApproved = await page.evaluate(() =>
      Object.entries(window.__paAmbHandle.getState().analysis.participants)
        .filter(([, p]) => p.disposition !== null && p.disposition.status === "approved")
        .map(([k, p]) => `${k}:${p.disposition.createdBy}`));
    check("L5i no approved disposition was created by the system (createdBy is a human in every case)",
      sysApproved.every((s) => !s.endsWith(":system")),
      `approved: ${sysApproved.join(", ") || "none"}`);
    check("L5j no page errors during the attack run",
      app2.errors.length === 0, `errors: ${app2.errors.join(" | ") || "none"}`);
  } finally {
    await app2.browser.close();
  }

  // ---- L5k: approve with no recommendation at all (fresh demo, no decide)
  const app3 = await openApp();
  try {
    const { page } = app3;
    await page.locator("#demo-button").click();
    const a8 = await page.evaluate(`(${ATTEMPT_APPROVE_SRC})("SYN-001", ${JSON.stringify({ actor: "A. Actuary" })})`);
    check("L5k approve with no recommended disposition is refused (no transition row)",
      a8.threw === null && a8.after === null && (a8.refusal ?? "").includes("no evidence state exists"),
      `after=${a8.after}; refusal=${a8.refusal}`);
  } finally {
    await app3.browser.close();
  }

  results.failures = failures;
  writeFileSync(join(ROOT, "stage7", "02-playwright-results.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(`\nPLAYWRIGHT: ${failures === 0 ? "ALL PASS" : `${failures} FAILING CHECK(S)`} (${results.checks.length} checks)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`FAIL playwright-compliance: ${err.message}`);
  process.exit(1);
});
