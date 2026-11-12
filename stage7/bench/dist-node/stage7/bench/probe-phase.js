"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Stage 7 phase probe — time ONE engine phase in isolation.
//
// Builds the bench inputs once (setup, timed separately), then times a
// single phase: validate | calculate | reconcile | statistics | report.
// Reconcile/statistics/report probes run the earlier phases as untimed
// setup. Used to find the scaling curve of a single phase without
// re-running the whole chain.
// Usage: node stage7/bench/dist-node/stage7/bench/probe-phase.js <phase> <csvPath>
const node_fs_1 = require("node:fs");
const core_1 = require("./core");
const validation_1 = require("../../src/validation");
const pipeline_1 = require("../../src/pipeline");
const reconciliation_1 = require("../../src/reconciliation");
const reconcile_1 = require("../../src/reconcile");
const statistics_1 = require("../../src/statistics");
const formulas_1 = require("../../src/formulas");
const decimal_1 = require("../../src/decimal");
const RECON_CONFIG = {
    epsilonRMinor: 100,
    epsilonRSource: "bench: $1.00/month smallest amount",
    materialityMinor: 100,
    materialitySource: "bench tolerance v1 ($1.00)",
};
function tolerance() {
    return {
        version: 1,
        absoluteMinor: 100,
        relativeDecimal: "0.001",
        application: "either",
        authority: "bench fixture",
        approvedBy: "bench",
        approvedDate: "2026-01-01",
    };
}
function validationContext() {
    return {
        dopt: "2045-06-30",
        today: "2026-11-12",
        runId: "run-bench-1",
        recordedDate: "2026-11-12",
        tolerance: {
            version: 1,
            absoluteMinor: 200,
            relativeDecimal: null,
            application: "either",
            authority: "bench fixture",
            approvedBy: "bench",
            approvedDate: "2026-11-12",
        },
        serviceTolerance: "0",
        monthlyBenefitPlausibilityCap: 2500000,
        plausibleBenefitCompRatioRange: null,
        planServiceCreditRule: null,
        validFormCodes: ["NSF", "NMF", "QPSA", "J&S50", "J&S75", "J&S100"],
        file: {
            openable: true,
            truncated: false,
            hashMatches: true,
            hashBefore: "bench",
            hashAfter: "bench",
            macroRan: false,
            unknownFields: [],
        },
        priorExtract: null,
    };
}
function main() {
    const phase = process.argv[2];
    const csvPath = process.argv[3];
    if (phase === undefined || csvPath === undefined) {
        console.error("usage: probe-phase.js <validate|calculate|reconcile|statistics|report> <csvPath>");
        process.exit(2);
    }
    const csvText = (0, node_fs_1.readFileSync)(csvPath, "utf8");
    const tSetup0 = globalThis.performance.now();
    const { rows, fixtures, validationInputs, requests, inputs } = (0, core_1.buildBenchInputs)(csvText);
    const n = rows.length;
    const setupMs = globalThis.performance.now() - tSetup0;
    const heapMB = () => Math.round(process.memoryUsage().heapUsed / 1048576);
    const rssMB = () => Math.round(process.memoryUsage().rss / 1048576);
    console.log(`PROBE ${phase} N=${n} setup(import)=${setupMs.toFixed(1)}ms heap=${heapMB()}MB rss=${rssMB()}MB`);
    if (phase === "validate") {
        const t0 = globalThis.performance.now();
        const v = (0, validation_1.validateCasePackage)(validationInputs, validationContext());
        console.log(`PROBE validate N=${n}: ${(globalThis.performance.now() - t0).toFixed(1)}ms rules=${v.summary.rulesEvaluated} findings=${v.allFindings.length} heap=${heapMB()}MB rss=${rssMB()}MB`);
        return;
    }
    // Setup for the later phases: calculate everything (untimed here).
    const outcomes = [];
    for (let i = 0; i < n; i += 1) {
        const req = requests[i];
        const inp = inputs[i];
        if (req === undefined || inp === undefined)
            throw new Error("probe: missing request");
        outcomes.push((0, pipeline_1.calculateAccruedBenefit)(req, inp));
    }
    if (phase === "calculate") {
        // Re-time a second pass (warm) so the number is the calc cost itself.
        const t0 = globalThis.performance.now();
        for (let i = 0; i < n; i += 1) {
            const req = requests[i];
            const inp = inputs[i];
            if (req === undefined || inp === undefined)
                throw new Error("probe: missing request");
            (0, pipeline_1.calculateAccruedBenefit)(req, inp);
        }
        console.log(`PROBE calculate N=${n} (2nd pass): ${(globalThis.performance.now() - t0).toFixed(1)}ms heap=${heapMB()}MB rss=${rssMB()}MB`);
        return;
    }
    const recs = [];
    for (let i = 0; i < n; i += 1) {
        const fx = fixtures[i];
        const outcome = outcomes[i];
        if (fx === undefined || outcome === undefined)
            throw new Error("probe: missing fixture/outcome");
        const recorded = (0, formulas_1.makeBenefit)({ planVersionId: "v1", measurementDate: fx.row.dote, rounding: { stage: "final-only", mode: "nearest-cent", source: "bench" } }, (0, decimal_1.makeMoney)(fx.row.paAmbCents), "monthly", undefined, "prior-administrator");
        const ri = (0, reconciliation_1.buildReconciliationInputs)({ outcome, recorded, toleranceApplied: tolerance(), comparisonBasis: "same-basis" });
        recs.push((0, reconcile_1.reconcileParticipant)({ participantKey: fx.row.key, inputs: ri, config: RECON_CONFIG }));
    }
    if (phase === "reconcile") {
        const t0 = globalThis.performance.now();
        for (let i = 0; i < n; i += 1) {
            const fx = fixtures[i];
            const outcome = outcomes[i];
            if (fx === undefined || outcome === undefined)
                throw new Error("probe: missing fixture/outcome");
            const recorded = (0, formulas_1.makeBenefit)({ planVersionId: "v1", measurementDate: fx.row.dote, rounding: { stage: "final-only", mode: "nearest-cent", source: "bench" } }, (0, decimal_1.makeMoney)(fx.row.paAmbCents), "monthly", undefined, "prior-administrator");
            const ri = (0, reconciliation_1.buildReconciliationInputs)({ outcome, recorded, toleranceApplied: tolerance(), comparisonBasis: "same-basis" });
            (0, reconcile_1.reconcileParticipant)({ participantKey: fx.row.key, inputs: ri, config: RECON_CONFIG });
        }
        console.log(`PROBE reconcile N=${n} (2nd pass): ${(globalThis.performance.now() - t0).toFixed(1)}ms heap=${heapMB()}MB rss=${rssMB()}MB`);
        return;
    }
    const statRows = fixtures.map((fx, i) => {
        const rec = recs[i];
        if (rec === undefined)
            throw new Error("probe: missing reconciliation");
        return {
            participantKey: fx.row.key,
            status: "2",
            employmentGroup: null,
            formulaType: "unit-credit",
            amendmentCohort: null,
            paAmbMinor: fx.row.paAmbCents,
            reconstructedMinor: rec.reconstructed?.amount?.amountMinor ?? null,
            deltaMinor: rec.comparison.comparable ? rec.comparison.delta.amountMinor : null,
            absDeltaMinor: rec.comparison.comparable ? rec.comparison.absDelta.amountMinor : null,
            relDelta: rec.comparison.comparable && rec.comparison.relative.kind === "defined" ? rec.comparison.relative.value : null,
            denominatorFlag: null,
            ageYears: 58,
            serviceYears: fx.serviceYears,
            compensationMinor: fx.avgAnnualMinor,
            retirementStatus: "2",
            dataCompleteness: null,
            monthsSinceRecorded: 80,
            qdro: false,
            priorDistribution: false,
            employmentPeriods: 1,
        };
    });
    if (phase === "statistics") {
        const t0 = globalThis.performance.now();
        (0, statistics_1.describePopulation)(statRows, { absMinor: 100, relDecimal: "0.01", source: "bench tolerance v1" });
        const t1 = globalThis.performance.now();
        (0, statistics_1.detectOutliers)(statRows, { valueField: "deltaMinor" });
        const t2 = globalThis.performance.now();
        console.log(`PROBE statistics N=${n}: describe=${(t1 - t0).toFixed(1)}ms outliers=${(t2 - t1).toFixed(1)}ms total=${(t2 - t0).toFixed(1)}ms heap=${heapMB()}MB rss=${rssMB()}MB`);
        return;
    }
    if (phase === "report") {
        // Full-chain report timing via runBench is already measured; here time
        // only the CSV+XLSX build from the compact arrays is out of scope —
        // report the whole runBench instead.
        console.log("PROBE report: use runBench (node-run.js) for report timings.");
        return;
    }
    console.error(`unknown phase: ${phase}`);
    process.exit(2);
}
main();
