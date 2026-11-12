// Stage 7 — UI-state-path probe.
//
// Measures the SHIPPED app path: the same engine steps driven through
// window.PaAmbApp's wrappers + the handle's dispatch, exactly as
// test/ui-playwright/wizard-flow.test.mjs does. Stage 7 Benchmarks
// defect 2 fix: dispatches are batched per step (handle.dispatchMany,
// one render per step) instead of one dispatch + full re-render per
// participant — the per-participant dispatch path was O(n²) and is
// what the pre-fix numbers in stage7/05-benchmarks-open-items.md §4
// measured. This probe measures the batched path.
// Sizes 100 / 1,000 / 10,000 only — 100,000 is projected from the
// quadratic fit, not run (see the findings file).
// Usage: node stage7/bench/ui-path-run.mjs <100|1000|10000>

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(
  "/home/hatch/workspace/pbgc-pa-amb-analysis/stage3/live-test/package.json",
);
const { chromium } = require("playwright");

const ROOT = "/home/hatch/workspace/pbgc-pa-amb-analysis";
const TS = "2026-11-12T00:00:00.000Z";

/**
 * In-page driver. Everything it uses is defined inside it (Playwright
 * serializes the function): window.PaAmbApp, window.__paAmbHandle and
 * window.Bench (bench bundle, injected by the driver script).
 */
function driveUi(csvText) {
  const TS = "2026-11-12T00:00:00.000Z";
  // Bench tolerances, identical to stage7/bench/core.ts: the
  // reconciliation tolerance ($1.00 / 0.1%, either) and the separate
  // validation-context tolerance ($2.00, either). The app's demo
  // tolerance (App.DEMO_TOLERANCE, $1.00 / 1%) is NOT used here, so
  // the UI-path counts match the engine-direct bench exactly.
  const tolerance = {
    version: 1, absoluteMinor: 100, relativeDecimal: "0.001",
    application: "either", authority: "bench fixture",
    approvedBy: "bench", approvedDate: "2026-01-01",
  };
  const validationTolerance = {
    version: 1, absoluteMinor: 200, relativeDecimal: null,
    application: "either", authority: "bench fixture",
    approvedBy: "bench", approvedDate: "2026-11-12",
  };
  const App = window.PaAmbApp;
  const handle = window.__paAmbHandle;
  const built = window.Bench.buildInputs(csvText);
  const rows = built.rows;
  const fixtures = built.fixtures;
  const ctx = {
    dopt: "2045-06-30", today: "2026-11-12", runId: "run-bench-ui-1",
    recordedDate: "2026-11-12",
    tolerance: validationTolerance,
    serviceTolerance: "0", monthlyBenefitPlausibilityCap: 2500000,
    plausibleBenefitCompRatioRange: null, planServiceCreditRule: null,
    validFormCodes: ["NSF", "NMF", "QPSA", "J&S50", "J&S75", "J&S100"],
    file: { openable: true, truncated: false, hashMatches: true, hashBefore: "bench", hashAfter: "bench", macroRan: false, unknownFields: [] },
    priorExtract: null,
  };
  const config = {
    epsilonRMinor: 100,
    epsilonRSource: "bench: $1.00/month smallest amount",
    materialityMinor: 100,
    materialitySource: "bench tolerance v1 ($1.00)",
  };
  const ageAt = (dob, date) => {
    const years = Number(date.slice(0, 4)) - Number(dob.slice(0, 4));
    return date.slice(5) < dob.slice(5) ? years - 1 : years;
  };
  const timed = (fn) => {
    const t0 = performance.now();
    const out = fn();
    return { ms: performance.now() - t0, out };
  };
  const stateSizes = () => {
    const s = handle.getState();
    return {
      eventLog: s.eventLog.length,
      calculations: Object.keys(s.calculations).length,
      reconciliations: Object.keys(s.reconciliations).length,
    };
  };

  // Validate (one dispatch for the whole population).
  const v = timed(() => {
    const next = App.runValidation(handle.getState(), built.validationInputs, ctx, "bench", TS);
    handle.dispatch({ kind: "validation-completed", result: next.validation, actor: "bench", occurredAt: TS });
    return {
      participantResults: next.validation.participantResults.length,
      rulesEvaluated: next.validation.summary.rulesEvaluated,
      findings: next.validation.allFindings.length,
    };
  });

  // Calculate (one runCalculation per participant, ONE batched dispatch
  // for the whole step — Stage 7 Benchmarks defect 2 fix).
  const c = timed(() => {
    const events = [];
    for (let i = 0; i < built.requests.length; i += 1) {
      const key = rows[i].key;
      const { outcome } = App.runCalculation(handle.getState(), built.requests[i], built.inputs[i], "bench", TS);
      events.push({ kind: "calculation-completed", participantKey: key, outcome, actor: "bench", occurredAt: TS });
    }
    handle.dispatchMany(events);
    return { calculated: Object.keys(handle.getState().calculations).length };
  });

  // Reconcile (one runReconciliation per participant, ONE batched
  // dispatch for the whole step — Stage 7 Benchmarks defect 2 fix).
  const r = timed(() => {
    const events = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const outcome = handle.getState().calculations[row.key];
      const recorded = App.makeBenefit(
        { planVersionId: "v1", measurementDate: row.dote, rounding: { stage: "final-only", mode: "nearest-cent", source: "bench" } },
        App.makeMoney(row.paAmbCents),
        "monthly",
        undefined,
        "prior-administrator",
      );
      const inputs = App.buildReconciliationInputs({
        outcome, recorded, toleranceApplied: tolerance, comparisonBasis: "same-basis",
      });
      const next = App.runReconciliation(handle.getState(), row.key, inputs, config, "bench", TS);
      events.push({ kind: "reconciliation-completed", reconciliation: next.reconciliations[row.key], actor: "bench", occurredAt: TS });
    }
    handle.dispatchMany(events);
    return { reconciled: Object.keys(handle.getState().reconciliations).length };
  });

  // Statistics (one dispatch for the whole population).
  const s = timed(() => {
    const state = handle.getState();
    const statRows = rows.map((row, i) => {
      const fx = fixtures[i];
      const rec = state.reconciliations[row.key];
      const months = (2026 - Number(row.dote.slice(0, 4))) * 12 + 5;
      return {
        participantKey: row.key,
        status: "2",
        employmentGroup: null, formulaType: "unit-credit", amendmentCohort: null,
        paAmbMinor: row.paAmbCents,
        reconstructedMinor: rec.reconstructed?.amount?.amountMinor ?? null,
        deltaMinor: rec.comparison.comparable ? rec.comparison.delta.amountMinor : null,
        absDeltaMinor: rec.comparison.comparable ? rec.comparison.absDelta.amountMinor : null,
        relDelta: rec.comparison.comparable && rec.comparison.relative.kind === "defined" ? rec.comparison.relative.value : null,
        denominatorFlag: null,
        ageYears: ageAt(row.dob, row.dote),
        serviceYears: fx.serviceYears,
        compensationMinor: fx.avgAnnualMinor,
        retirementStatus: "2",
        dataCompleteness: null,
        monthsSinceRecorded: months < 0 ? null : months,
        qdro: false, priorDistribution: false,
        employmentPeriods: 1,
      };
    });
    const next = App.runStatistics(state, statRows, { absMinor: 100, relDecimal: "0.01", source: "bench tolerance v1" }, "bench", TS);
    handle.dispatch({ kind: "statistics-completed", population: next.statistics, outliers: next.statisticsOutliers, actor: "bench", occurredAt: TS });
    return {
      populationN: next.statistics.pooled.n,
      flags: (next.statisticsOutliers?.flags ?? []).length,
    };
  });

  return {
    n: rows.length,
    validateMs: v.ms,
    validateOut: v.out,
    calculateMs: c.ms,
    calculateOut: c.out,
    reconcileMs: r.ms,
    reconcileOut: r.out,
    statisticsMs: s.ms,
    statisticsOut: s.out,
    stateSizes: stateSizes(),
    wizard: handle.getState().wizard,
  };
}

async function main() {
  const n = Number(process.argv[2]);
  if (![100, 1000, 10000].includes(n)) {
    console.error("usage: ui-path-run.mjs <100|1000|10000>");
    process.exit(2);
  }
  const csvText = readFileSync(`${ROOT}/stage3/poc/poc-p10-synthetic-${n}.csv`, "utf8");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const heapSamples = [];
    let sampling = true;
    async function sampleHeap() {
      try {
        const { metrics } = await cdp.send("Performance.getMetrics");
        const used = metrics.find((m) => m.name === "JSHeapUsedSize");
        if (used !== undefined) heapSamples.push(used.value / 1048576);
      } catch { /* best-effort */ }
    }
    const sampler = setInterval(() => {
      if (sampling) void sampleHeap();
    }, 50);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(`file://${ROOT}/pa-amb-analysis.html`);
    await page.waitForSelector("#pa-amb-app");
    // Inject the bench bundle (input builders only; no DOM use).
    await page.addScriptTag({ path: `${ROOT}/stage7/bench/browser-bundle.js` });
    await page.waitForFunction(() => window.Bench !== undefined && window.Bench.buildInputs !== undefined);
    const t0 = Date.now();
    const poller = setInterval(() => {
      if (sampling) void sampleHeap();
    }, 50);
    const result = await page.evaluate(driveUi, csvText);
    clearInterval(poller);
    sampling = false;
    clearInterval(sampler);
    const wallMs = Date.now() - t0;
    await sampleHeap();
    const heapPeak = heapSamples.length > 0 ? Math.max(...heapSamples) : null;
    if (errors.length > 0) throw new Error(`page errors: ${errors.join(" | ")}`);
    const out = { ...result, wallMs, heapPeakMB: heapPeak, heapSamples: heapSamples.length, engine: "browser-ui-path" };
    const outPath = `${ROOT}/stage7/bench/results-uipath-${n}.json`;
    writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
    console.log(
      `UI-PATH N=${n} wall=${wallMs}ms heapPeak=${heapPeak?.toFixed(1)}MB ` +
        `validate=${result.validateMs.toFixed(1)} calculate=${result.calculateMs.toFixed(1)} ` +
        `reconcile=${result.reconcileMs.toFixed(1)} statistics=${result.statisticsMs.toFixed(1)}`,
    );
    console.log(`  validate: ${JSON.stringify(result.validateOut)}`);
    console.log(`  calculate: ${JSON.stringify(result.calculateOut)} reconcile: ${JSON.stringify(result.reconcileOut)} statistics: ${JSON.stringify(result.statisticsOut)}`);
    console.log(`  state: ${JSON.stringify(result.stateSizes)} wizard=${JSON.stringify(result.wizard.completed)}`);
    console.log(`  wrote ${outPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`FAIL ui-path: ${err.message}`);
  process.exit(1);
});
