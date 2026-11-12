// Stage 7 (item a) — Run-buttons check.
//
// Opens pa-amb-analysis.html via file:// and drives the wizard ONLY
// through the UI: demo button -> each step's Run button, in order.
// Asserts the same outcomes as test/ui-playwright/wizard-flow.test.mjs
// (which drives the same steps through the JS API), plus the Run-button
// lock behaviour: a Run button is disabled while its step is locked and
// says why in its title, and there is no approve button anywhere —
// approval stays a human act through the API with a determination.
// Synthetic data only (Harborview demo case 00098765).

import { readFileSync } from "node:fs";
import {
  openApp,
  assertBooted,
  check,
  stepButton,
  wizardState,
} from "../test/ui-playwright/helpers.mjs";

async function main() {
  const { browser, page, errors, failedRequests } = await openApp();
  try {
    await page.waitForSelector("#pa-amb-app");
    assertBooted(errors, failedRequests);

    // No approve button exists: approval is human-only, not a Run button.
    check((await page.locator("#run-approve").count()) === 0, "there must be no run-approve button");

    // Before import every Run button is disabled with the lock reason.
    const runLocks = {
      "run-validate": "Import a case first.",
      "run-calculate": "Validate the case first.",
      "run-reconcile": "Calculate benefits first.",
      "run-statistics": "Reconcile participants first.",
      "run-decide": "Review statistics first.",
      "run-publish": "Decide dispositions first. A case with unassessed participants cannot close.",
    };
    for (const [id, reason] of Object.entries(runLocks)) {
      const disabled = await page.evaluate((buttonId) => {
        const el = document.getElementById(buttonId);
        return el === null ? null : { disabled: el.disabled, title: el.title };
      }, id);
      check(disabled !== null, `Run button ${id} should exist`);
      check(disabled.disabled === true, `${id} should be disabled before import`);
      check(disabled.title === reason, `${id} title should be "${reason}", got "${disabled.title}"`);
    }

    // 1. Import the demo case.
    await page.locator("#demo-button").click();
    let ws = await wizardState(page);
    check(ws.completed.import === true, "import should complete after demo load");
    check(ws.participantCount === 6, "demo case should have 6 participants");

    // Helper: go to a step via its nav button, then click its Run button.
    async function runStep(stepId, runButtonId) {
      await stepButton(page, stepId).click();
      ws = await wizardState(page);
      check(ws.currentStep === stepId, `wizard should be on ${stepId}, got ${ws.currentStep}`);
      const btn = page.locator(`#${runButtonId}`);
      check(await btn.isVisible(), `${runButtonId} should be visible on the ${stepId} panel`);
      check(await btn.isEnabled(), `${runButtonId} should be enabled on the ${stepId} panel`);
      await btn.click();
      ws = await wizardState(page);
      check(ws.completed[stepId] === true, `${stepId} should complete after its Run button`);
      return ws;
    }

    // 2. Validate.
    await runStep("validate", "run-validate");
    const validation = await page.evaluate(() => {
      const s = window.__paAmbHandle.getState();
      return {
        participantResults: s.validation?.participantResults.length ?? 0,
        rulesEvaluated: s.validation?.summary.rulesEvaluated ?? 0,
        findings: s.validation?.allFindings.length ?? 0,
      };
    });
    check(validation.participantResults === 6, `validate should cover 6 participants, got ${validation.participantResults}`);
    check(validation.rulesEvaluated > 0, "validate should evaluate rules");

    // 3. Calculate.
    await runStep("calculate", "run-calculate");
    const outcomes = await page.evaluate(() => {
      const s = window.__paAmbHandle.getState();
      return Object.fromEntries(
        Object.entries(s.calculations).map(([k, o]) => [
          k,
          { kind: o.kind, minor: o.kind === "exact" ? (o.benefit.amount?.amountMinor ?? null) : null },
        ]),
      );
    });
    check(outcomes["SYN-001"]?.minor === 150000, "SYN-001 should calculate to exact $1,500.00");
    check(outcomes["SYN-V-01"]?.minor === 84950, "SYN-V-01 should calculate to exact $849.50");
    check(outcomes["SYN-002"]?.kind === "bounds", "SYN-002 should be bounds");
    check(outcomes["SYN-I-01"]?.kind === "indeterminate", "SYN-I-01 should be indeterminate");

    // 4. Reconcile.
    await runStep("reconcile", "run-reconcile");
    const recon = await page.evaluate(() => {
      const s = window.__paAmbHandle.getState();
      return Object.fromEntries(
        Object.entries(s.reconciliations).map(([k, r]) => [
          k,
          { delta: r.comparison.comparable ? r.comparison.delta.amountMinor : null, recommended: r.recommendedDisposition },
        ]),
      );
    });
    check(recon["SYN-001"]?.delta === 0, "SYN-001 delta should be 0");
    check(recon["SYN-003"]?.delta === 100000, "SYN-003 delta should be $1,000.00");
    check(recon["SYN-001"]?.recommended === "verified", "SYN-001 should be recommended verified");
    check(recon["SYN-003"]?.recommended === "requires-investigation", "SYN-003 should be recommended requires-investigation");

    // 5. Statistics.
    await runStep("statistics", "run-statistics");
    const stats = await page.evaluate(() => {
      const s = window.__paAmbHandle.getState();
      return {
        populationN: s.statistics?.pooled.n ?? 0,
        flags: (s.statisticsOutliers?.flags ?? []).map((f) => ({ key: f.participantKey, method: f.method })),
      };
    });
    check(stats.populationN === 6, `statistics population should be 6, got ${stats.populationN}`);
    check(stats.flags.some((f) => f.key === "SYN-003" && f.method === "modified-z"), "statistics should flag SYN-003 by modified-z");
    check(!stats.flags.some((f) => f.key === "SYN-001" && f.method === "modified-z"), "statistics should not flag SYN-001 by modified-z");
    check((await page.locator("#chart-area svg").count()) > 0, "charts should render after statistics");

    // 6. Decide (recommend all; approves nothing).
    await runStep("decide", "run-decide");
    const decided = await page.evaluate(() => {
      const s = window.__paAmbHandle.getState();
      return Object.fromEntries(
        Object.entries(s.analysis.participants).map(([k, p]) => [
          k, p.disposition === null ? null : `${p.disposition.disposition}/${p.disposition.status}`,
        ]),
      );
    });
    check(decided["SYN-001"] === "verified/recommended", `SYN-001 should be verified/recommended, got ${decided["SYN-001"]}`);
    check(decided["SYN-003"] === "requires-investigation/recommended", `SYN-003 should be requires-investigation/recommended, got ${decided["SYN-003"]}`);
    check(decided["SYN-I-01"] === "indeterminate/recommended", `SYN-I-01 should be indeterminate/recommended, got ${decided["SYN-I-01"]}`);
    check(!Object.values(decided).some((v) => v !== null && v.endsWith("/approved")), "no disposition should be approved by the Recommend button");

    // 7. Export: publish, then download the CSV.
    await runStep("export", "run-publish");
    await page.evaluate(() => {
      window.confirm = () => true;
    });
    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 10000 }),
      page.locator("#export-reconciliation-csv").click(),
    ]);
    check(dl.suggestedFilename() === "00098765-reconciliation.csv", `CSV filename should be 00098765-reconciliation.csv, got ${dl.suggestedFilename()}`);
    const csvText = readFileSync(await dl.path(), "utf8");
    check(csvText.includes("SYN-003") && csvText.includes("100000"), "CSV should include the SYN-003 delta of 100000 minor units");

    const finalState = await page.evaluate(() => {
      const s = window.__paAmbHandle.getState();
      return { reportHasCase: (document.getElementById("report-area")?.textContent ?? "").includes("00098765") };
    });
    check(finalState.reportHasCase, "final report area should name the demo case");
    assertBooted(errors, failedRequests);
    console.log(
      "PASS run-buttons: validate 6 participants / " +
        `${validation.rulesEvaluated} rules; calculate SYN-001 $1,500.00; reconcile SYN-003 delta $1,000.00; ` +
        "statistics flagged SYN-003 by modified-z; decide recommended all six, approved none; " +
        "export published + CSV 00098765-reconciliation.csv.",
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`FAIL run-buttons: ${err.message}`);
  process.exit(1);
});
