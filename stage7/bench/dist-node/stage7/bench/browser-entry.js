"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Stage 7 §21 benchmark — browser entry.
 * Bundled with esbuild into stage7/bench/browser-bundle.js and loaded by
 * stage7/bench/browser-bench.html under file://. Exposes
 * window.Bench.run(csvText) which runs the same core.runBench as the
 * Node runner and returns the result (memory from performance.memory
 * where available; outer RSS is sampled by the Playwright driver).
 */
const core_1 = require("./core");
function memory() {
    const pm = globalThis.performance?.memory;
    if (pm === undefined)
        return { rssMB: null, heapUsedMB: null, heapTotalMB: null };
    return {
        rssMB: null,
        heapUsedMB: pm.usedJSHeapSize / 1048576,
        heapTotalMB: pm.totalJSHeapSize / 1048576,
    };
}
globalThis.Bench = {
    run: (csvText, opts) => (0, core_1.runBench)(csvText, memory, (phaseName, ms) => {
        globalThis.Bench?.progress.push({ phase: phaseName, ms });
    }, opts),
    buildInputs: (csvText) => (0, core_1.buildBenchInputs)(csvText),
    progress: [],
};
