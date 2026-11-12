/**
 * Stage 7 §21 benchmark — Node runner.
 * Usage: node dist-node/stage7/bench/node-run.js <N> [csvPath]
 * Reads the P-10 synthetic CSV for N (default stage3/poc/poc-p10-synthetic-<N>.csv),
 * runs the full engine chain via ./core, and prints the result as JSON
 * plus one human-readable summary line per phase. Run one N per process
 * so process.resourceUsage().maxRSS is that size's peak.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { runBench } from "./core";
import type { BenchMemory } from "./core";

function memory(): BenchMemory {
  const m = process.memoryUsage();
  return {
    rssMB: m.rss / 1048576,
    heapUsedMB: m.heapUsed / 1048576,
    heapTotalMB: m.heapTotal / 1048576,
  };
}

function main(): void {
  const n = Number(process.argv[2]);
  if (![100, 1000, 10000, 100000].includes(n)) {
    console.error("usage: node-run.js <100|1000|10000|100000> [csvPath]");
    process.exit(2);
  }
  const csvPath =
    process.argv[3] ??
    `/home/hatch/workspace/pbgc-pa-amb-analysis/stage3/poc/poc-p10-synthetic-${n}.csv`;
  const csvText = readFileSync(csvPath, "utf8");
  const t0 = Date.now();
  const skipValidation = process.env.BENCH_SKIP_VALIDATION === "1";
  const result = runBench(csvText, memory, (phaseName, ms, rssMB) => {
    console.error(
      `  [${((Date.now() - t0) / 1000).toFixed(1)}s] phase ${phaseName}: ${ms.toFixed(1)}ms rss=${rssMB === null ? "n/a" : rssMB.toFixed(0) + "MB"}`,
    );
  }, { skipValidation });
  const wallMs = Date.now() - t0;
  const peakRssMB = process.resourceUsage().maxRSS / 1024;
  const out = { ...result, wallMs, peakRssMB: Math.round(peakRssMB * 10) / 10, engine: "node", nodeVersion: process.version };
  const outPath = `/home/hatch/workspace/pbgc-pa-amb-analysis/stage7/bench/results-node-${n}.json`;
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  const p = result.phases;
  const c = result.counts;
  console.log(
    `NODE N=${n} wall=${wallMs}ms peakRSS=${out.peakRssMB}MB ` +
      `import=${p.importMs.toFixed(1)} validate=${p.validationMs.toFixed(1)} ` +
      `calc=${p.calculateMs.toFixed(1)} recon=${p.reconcileMs.toFixed(1)} ` +
      `stats=${p.statisticsMs.toFixed(1)} model=${p.modelFitMs.toFixed(1)} ` +
      `csv=${p.reportCsvMs.toFixed(1)} xlsx=${p.reportXlsxMs.toFixed(1)} html=${p.reportHtmlMs.toFixed(1)} ` +
      `incr=${p.incrementalTotalMs.toFixed(1)} ` +
      `(calc1=${p.incrementalCalcOneMs.toFixed(2)} recon1=${p.incrementalReconcileOneMs.toFixed(2)} ` +
      `statsRe=${p.incrementalStatsRerunMs.toFixed(1)} csvRe=${p.incrementalCsvRebuildMs.toFixed(1)})`,
  );
  console.log(
    `  counts exact=${c.exact} bounds=${c.bounds} indet=${c.indeterminate} ${JSON.stringify(c.indeterminateReasons)} ` +
      `withinTol=${c.withinTolerance} outsideTol=${c.outsideTolerance} notComp=${c.notComparable} ` +
      `paInBounds=${c.paInsideBounds} paOutBounds=${c.paOutsideBounds} ` +
      `flags=${c.outlierFlags} explained=${c.outlierExplainedByGroup} ` +
      `meanAbsDelta=${c.meanAbsDeltaMinor} maxAbsDelta=${c.maxAbsDeltaMinor} ` +
      `valRules=${c.validationRulesEvaluated} valFindings=${c.validationFindings} ` +
      `csvOut=${c.csvBytesOut}B xlsxOut=${c.xlsxBytesOut}B htmlChars=${c.reportHtmlChars}`,
  );
  console.log(`  model: ${p.modelFitNote}`);
  console.log(`  dispositions: ${JSON.stringify(result.dispositions)}`);
  console.log(`  wrote ${outPath}`);
}

main();
