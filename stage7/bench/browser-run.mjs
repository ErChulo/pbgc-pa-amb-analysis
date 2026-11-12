// Stage 7 §21 benchmark — browser (Playwright, file://) runner.
//
// For one N per process: launches Chromium headless with a KNOWN
// user-data-dir, opens stage7/bench/browser-bench.html via file://,
// passes the P-10 synthetic CSV text into the page, runs the same
// core.runBench as the Node runner, and records timings + memory.
// Memory: JS heap via CDP Performance.getMetrics (sampled every 50 ms;
// the in-page performance.memory figure stays flat at 9.5 MB in the
// headless shell and is not trusted — see P-10 notes) plus the outer
// RSS of the browser's processes (P-10 method, kept as a secondary
// figure). Writes stage7/bench/results-browser-<N>.json.
// Usage: node stage7/bench/browser-run.mjs <100|1000|10000|100000>

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(
  "/home/hatch/workspace/pbgc-pa-amb-analysis/stage3/live-test/package.json",
);
const { chromium } = require("playwright");

const ROOT = "/home/hatch/workspace/pbgc-pa-amb-analysis";
const PROFILE = `/tmp/stage7-bench-profile-${process.argv[2] ?? "x"}`;

function rssMB() {
  try {
    const out = execSync(
      `ps -eo rss,args | grep -F '${PROFILE}' | grep -v grep | awk '{s+=$1} END {print s+0}'`,
      { encoding: "utf8" },
    );
    return Number(out.trim()) / 1024;
  } catch {
    return null;
  }
}

async function main() {
  const n = Number(process.argv[2]);
  if (![100, 1000, 10000, 100000].includes(n)) {
    console.error("usage: browser-run.mjs <100|1000|10000|100000>");
    process.exit(2);
  }
  const csvText = readFileSync(`${ROOT}/stage3/poc/poc-p10-synthetic-${n}.csv`, "utf8");
  rmSync(PROFILE, { recursive: true, force: true });
  // launchPersistentContext (not --user-data-dir, which Playwright rejects)
  // so the browser's processes carry the profile path in their command line
  // and the RSS sampler can attribute them to this browser only.
  const context = await chromium.launchPersistentContext(PROFILE, { headless: true });
  const rssSamples = [];
  const heapSamples = [];
  let sampling = true;
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  async function sampleHeap() {
    try {
      const { metrics } = await cdp.send("Performance.getMetrics");
      const used = metrics.find((m) => m.name === "JSHeapUsedSize");
      if (used !== undefined) heapSamples.push(used.value / 1048576);
    } catch {
      // Sampling is best-effort; a missed sample is not a bench failure.
    }
  }
  const sampler = setInterval(() => {
    const v = rssMB();
    if (v !== null) rssSamples.push(v);
    if (sampling) void sampleHeap();
  }, 50);
  try {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    const before = rssMB();
    await sampleHeap();
    const heapBefore = heapSamples.length > 0 ? heapSamples[heapSamples.length - 1] : null;
    await page.goto(`file://${ROOT}/stage7/bench/browser-bench.html`);
    await page.waitForFunction(() => window.Bench !== undefined);
    const skipValidation = process.env.BENCH_SKIP_VALIDATION === "1";
    const t0 = Date.now();
    const runPromise = page.evaluate(
      ({ csv, skip }) => window.Bench.run(csv, { skipValidation: skip }),
      { csv: csvText, skip: skipValidation },
    );
    // Sample the heap while the run is in flight (the evaluate promise
    // resolves only when runBench returns).
    const poller = setInterval(() => {
      if (sampling) void sampleHeap();
    }, 50);
    const result = await runPromise;
    clearInterval(poller);
    sampling = false;
    const wallMs = Date.now() - t0;
    const after = rssMB();
    await sampleHeap();
    const heapAfter = heapSamples.length > 0 ? heapSamples[heapSamples.length - 1] : null;
    const heapPeak = heapSamples.length > 0 ? Math.max(...heapSamples) : null;
    const rssPeak = rssSamples.length > 0 ? Math.max(...rssSamples) : null;
    if (errors.length > 0) throw new Error(`page errors: ${errors.join(" | ")}`);
    const out = {
      ...result,
      wallMs,
      engine: "browser",
      browser: "Chromium 158 (Playwright 1.65.0, headless shell, Linux, file://)",
      rss: { beforeMB: before, peakMB: rssPeak, afterMB: after, samples: rssSamples.length },
      heap: { beforeMB: heapBefore, peakMB: heapPeak, afterMB: heapAfter, samples: heapSamples.length },
      peakRssMB: rssPeak,
      peakHeapMB: heapPeak,
    };
    const outPath = `${ROOT}/stage7/bench/results-browser-${n}.json`;
    writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
    const p = result.phases;
    const c = result.counts;
    console.log(
      `BROWSER N=${n} wall=${wallMs}ms rssBefore=${before?.toFixed(1)} rssPeak=${rssPeak?.toFixed(1)} heapBefore=${heapBefore?.toFixed(1)} heapPeak=${heapPeak?.toFixed(1)} heapAfter=${heapAfter?.toFixed(1)}MB ` +
        `import=${p.importMs.toFixed(1)} validate=${p.validationMs.toFixed(1)} ` +
        `calc=${p.calculateMs.toFixed(1)} recon=${p.reconcileMs.toFixed(1)} ` +
        `stats=${p.statisticsMs.toFixed(1)} model=${p.modelFitMs.toFixed(1)} ` +
        `csv=${p.reportCsvMs.toFixed(1)} xlsx=${p.reportXlsxMs.toFixed(1)} html=${p.reportHtmlMs.toFixed(1)} ` +
        `incr=${p.incrementalTotalMs.toFixed(1)} ` +
        `(calc1=${p.incrementalCalcOneMs.toFixed(2)} recon1=${p.incrementalReconcileOneMs.toFixed(2)} ` +
        `statsRe=${p.incrementalStatsRerunMs.toFixed(1)} csvRe=${p.incrementalCsvRebuildMs.toFixed(1)})`,
    );
    console.log(
      `  counts exact=${c.exact} bounds=${c.bounds} indet=${c.indeterminate} ` +
        `withinTol=${c.withinTolerance} outsideTol=${c.outsideTolerance} notComp=${c.notComparable} ` +
        `flags=${c.outlierFlags} meanAbsDelta=${c.meanAbsDeltaMinor} maxAbsDelta=${c.maxAbsDeltaMinor} ` +
        `valRules=${c.validationRulesEvaluated} valFindings=${c.validationFindings} ` +
        `csvOut=${c.csvBytesOut}B xlsxOut=${c.xlsxBytesOut}B htmlChars=${c.reportHtmlChars}`,
    );
    console.log(`  model: ${p.modelFitNote}`);
    console.log(`  wrote ${outPath}`);
  } finally {
    clearInterval(sampler);
    sampling = false;
    await context.close();
  }
}

main().catch((err) => {
  console.error(`FAIL browser bench: ${err.message}`);
  process.exit(1);
});
