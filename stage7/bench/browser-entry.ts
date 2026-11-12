/**
 * Stage 7 §21 benchmark — browser entry.
 * Bundled with esbuild into stage7/bench/browser-bundle.js and loaded by
 * stage7/bench/browser-bench.html under file://. Exposes
 * window.Bench.run(csvText) which runs the same core.runBench as the
 * Node runner and returns the result (memory from performance.memory
 * where available; outer RSS is sampled by the Playwright driver).
 */
import { buildBenchInputs, runBench } from "./core";
import type { BenchMemory, BenchResult } from "./core";

declare const globalThis: {
  Bench?: {
    run: (csvText: string, opts?: { skipValidation?: boolean }) => BenchResult;
    buildInputs: (csvText: string) => ReturnType<typeof buildBenchInputs>;
    progress: Array<{ phase: string; ms: number }>;
  };
  performance?: { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } };
};

function memory(): BenchMemory {
  const pm = globalThis.performance?.memory;
  if (pm === undefined) return { rssMB: null, heapUsedMB: null, heapTotalMB: null };
  return {
    rssMB: null,
    heapUsedMB: pm.usedJSHeapSize / 1048576,
    heapTotalMB: pm.totalJSHeapSize / 1048576,
  };
}

globalThis.Bench = {
  run: (csvText: string, opts?: { skipValidation?: boolean }): BenchResult =>
    runBench(csvText, memory, (phaseName, ms) => {
      globalThis.Bench?.progress.push({ phase: phaseName, ms });
    }, opts),
  buildInputs: (csvText: string) => buildBenchInputs(csvText),
  progress: [],
};
