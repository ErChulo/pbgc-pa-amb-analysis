"use strict";
/**
 * Stage 7 §21 benchmark core — shared by the Node and browser runs.
 *
 * Runs representative fictional populations (100 / 1,000 / 10,000 /
 * 100,000 participants) end-to-end through the REAL engine chain:
 * CSV import → validateCasePackage → calculateAccruedBenefit →
 * buildReconciliationInputs + reconcileParticipant → describePopulation
 * + detectOutliers (+ one OLS model fit) → CSV / XLSX / plan-report
 * generation → incremental recalculation of one changed participant.
 *
 * Population: the Stage 3 P-10 synthetic CSVs (seed 20261112, unit-credit
 * 1.5%, 5% missing average compensation, ±$20 planted discrepancy on
 * ~10% of exact rows). The fixture builders below mirror
 * test/population.test.ts (same formula T-04, same rounding config,
 * same tolerance, same validation-context shape); the salary history is
 * built so the pipeline's Stage 4 final-3-year average equals the CSV
 * average exactly (all five years equal), and the Stage 3 credited
 * service equals the CSV service, so the reconstruction matches the
 * P-10 planted value up to the planted discrepancy and pipeline
 * rounding. Synthetic data only; no live case data.
 *
 * This file imports engine modules only (plus the UI export/report
 * builders, which are pure functions). It never touches the DOM, so it
 * runs identically in Node and in the browser bundle.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCsv = parseCsv;
exports.p10ReconMinor = p10ReconMinor;
exports.debugOutcomes = debugOutcomes;
exports.buildBenchInputs = buildBenchInputs;
exports.runBench = runBench;
const decimal_1 = require("../../src/decimal");
const formulas_1 = require("../../src/formulas");
const pipeline_1 = require("../../src/pipeline");
const validation_1 = require("../../src/validation");
const reconciliation_1 = require("../../src/reconciliation");
const reconcile_1 = require("../../src/reconcile");
const statistics_1 = require("../../src/statistics");
const exports_1 = require("../../src/ui/exports");
const reports_1 = require("../../src/ui/reports");
function parseCsv(csvText) {
    const lines = csvText.split("\n").filter((l) => l.length > 0);
    const rows = [];
    for (let i = 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (line === undefined)
            continue;
        const f = line.split(",");
        const key = f[0];
        const dob = f[1];
        const hire = f[2];
        const dote = f[3];
        const serviceMilli = Number(f[4]);
        const avgCents = f[5] === "" || f[5] === undefined ? null : Number(f[5]);
        const paAmbCents = Number(f[6]);
        if (key === undefined || dob === undefined || hire === undefined || dote === undefined) {
            throw new Error(`bench parse: malformed line ${i + 1}`);
        }
        rows.push({ key, dob, hire, dote, serviceMilli, avgCents, paAmbCents });
    }
    return rows;
}
// ---------------------------------------------------------------------------
// Shared fixture constants (population.test.ts shape)
// ---------------------------------------------------------------------------
const CASE_NUMBER = "99999999";
const DOPT = "2045-06-30";
const TODAY = "2026-11-12";
function prov() {
    return {
        documentId: "doc-bench",
        location: { kind: "user-entered", enteredBy: "bench", enteredDate: "2026-01-01", entryForm: "bench" },
        acquisition: "user-entered",
        derivation: null,
        sourceFileHash: null,
    };
}
function sourced(value) {
    return { value, provenance: prov() };
}
function entity(id) {
    return { id, version: 1, supersedesId: null, sourceRecordIds: [], createdDate: "2026-01-01", createdBy: "bench" };
}
function planVersion() {
    return {
        ...entity("v1"),
        planId: "plan-1",
        versionId: "v1",
        effectiveDate: sourced("1960-01-01"),
        adoptionDate: sourced("1959-06-01"),
        restatementDate: sourced(null),
        provisionText: sourced(""),
        provisionSection: sourced("§5.01"),
        supersedesVersionId: null,
        grandfatheredGroups: sourced([]),
        freeze: sourced(null),
        sourceDocumentId: "doc-1",
        changeSummary: "",
        statutoryLimitsInForce: [],
        formulaIds: ["T-04"],
    };
}
function roundingConfig() {
    return {
        configId: "rc-1",
        version: "rounding-config v1.0.0",
        planVersionId: "v1",
        prescribedSequence: {
            sequenceId: "prescribed",
            rules: [
                {
                    target: "final-monthly-benefit",
                    unit: "0.01",
                    mode: "half-up",
                    stage: "final",
                    source: { kind: "plan-provision", citation: "plan §5.01" },
                },
            ],
        },
        alternativeSequences: [],
        setBy: "bench",
        setDate: "2026-01-01",
        rationale: "bench fixture",
    };
}
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
/** P-10 planted reconstruction, integer cents (BigInt, exact). */
function p10ReconMinor(serviceMilli, avgCents) {
    return Number((150n * BigInt(serviceMilli) * BigInt(avgCents)) / 10000000n);
}
function dollarsString(minor) {
    const dollars = Math.trunc(minor / 100);
    const cents = minor - dollars * 100;
    return `${dollars}.${String(cents).padStart(2, "0")}`;
}
function ageAt(dob, date) {
    const years = Number(date.slice(0, 4)) - Number(dob.slice(0, 4));
    return date.slice(5) < dob.slice(5) ? years - 1 : years;
}
function nrdOf(dob) {
    return `${Number(dob.slice(0, 4)) + 65}${dob.slice(4)}`;
}
function rowFixture(row, index) {
    const serviceYears = row.serviceMilli / 1000;
    const doteYear = Number(row.dote.slice(0, 4));
    const salaryYears = [doteYear - 4, doteYear - 3, doteYear - 2, doteYear - 1, doteYear];
    let salaries;
    let avgAnnualMinor;
    let reconMinor;
    if (row.avgCents === null) {
        // Missing average: the four earlier years carry a stated $3,000/mo
        // ($36,000/yr); the DOTE year is blank, so the outcome is bounds
        // over the stated feasible range $1,000–$8,000/mo (annual
        // $12,000–$96,000), the same range the P-10 harness used.
        avgAnnualMinor = null;
        reconMinor = null;
        salaries = salaryYears.map((year, i) => ({
            year,
            minor: i === salaryYears.length - 1 ? null : 3600000,
        }));
    }
    else {
        avgAnnualMinor = row.avgCents * 12;
        reconMinor = p10ReconMinor(row.serviceMilli, row.avgCents);
        salaries = salaryYears.map((year) => ({ year, minor: avgAnnualMinor }));
    }
    return {
        row,
        index,
        serviceYears,
        serviceStr: String(Math.round(serviceYears * 1000) / 1000),
        doteYear,
        salaryYears,
        avgAnnualMinor,
        salaries,
        reconMinor,
    };
}
function employmentPeriod(fx) {
    const { row } = fx;
    return {
        ...entity(`ep-${row.key}`),
        participantKey: row.key,
        doh: sourced(row.hire),
        dote: sourced(row.dote),
        dop: sourced(null),
        dobfParticipant: sourced(null),
        dor: sourced(null),
        postDoptDote: sourced(null),
        periodSeq: 1,
        periodType: "initial-hire",
        periodStart: row.hire,
        periodEnd: row.dote,
        breakInService: null,
        hoursPerPeriod: sourced(null),
    };
}
function serviceHistory(fx) {
    const { row } = fx;
    return {
        ...entity(`sh-${row.key}`),
        participantKey: row.key,
        asOfDate: sourced(row.dote),
        paCreditedService: sourced(fx.serviceYears),
        paVestingService: sourced(fx.serviceYears),
        paEligibilityService: sourced(fx.serviceYears),
        bcvCreditedService: sourced(fx.serviceYears),
        bcvVestingService: sourced(fx.serviceYears),
        bcvEligibilityService: sourced(fx.serviceYears),
        paVestingPercent: sourced("1"),
        bcvVestingPercent: sourced("1"),
        serviceMeasure: "years",
        servicePeriods: [{ start: row.hire, end: row.dote, measure: fx.serviceYears, provenance: prov() }],
        breaksApplied: [],
        distributions: [],
    };
}
function compensationHistory(fx) {
    const { row } = fx;
    return {
        ...entity(`ch-${row.key}`),
        participantKey: row.key,
        firstYear: sourced(fx.salaryYears[0] ?? fx.doteYear - 4),
        lastYear: sourced(fx.salaryYears[fx.salaryYears.length - 1] ?? fx.doteYear),
        salaryByYear: fx.salaries.map((s, i) => ({
            salaryYear: s.year,
            sourceField: `S00${i + 1}`,
            amount: s.minor === null ? null : (0, decimal_1.makeMoney)(s.minor),
            annualized: false,
            provenance: prov(),
        })),
        annualizedFlagSource: sourced(null),
        salaryDesc: sourced("W-2 wages"),
        currentMonthlyComp: sourced(null),
        paAverageComp: sourced(null),
        compensationDefinitionApplied: "plan §2.01",
        nonCensusInputs: [],
    };
}
function recordedBenefit(fx, paAmbCents) {
    return (0, formulas_1.makeBenefit)({
        planVersionId: "v1",
        measurementDate: fx.row.dote,
        rounding: { stage: "final-only", mode: "nearest-cent", source: "bench" },
    }, (0, decimal_1.makeMoney)(paAmbCents), "monthly", undefined, "prior-administrator");
}
function makeRequest(fx) {
    return {
        participantKey: fx.row.key,
        participantHistory: {
            participantKey: fx.row.key,
            employmentPeriods: [employmentPeriod(fx)],
            compensationHistory: compensationHistory(fx),
            serviceHistory: serviceHistory(fx),
            benefitObservations: [],
        },
        provisionTimeline: { planId: "plan-1", versions: [planVersion()] },
        measurementDate: fx.row.dote,
        measurementBasis: "dote",
        calculationKind: "accrued",
        formulaId: "T-04",
        roundingConfig: roundingConfig(),
        tolerance: tolerance(),
        runContext: {
            engineVersion: "0.1.0",
            ruleVersion: "2026-11-12",
            formulaTaxonomyVersion: "1.0",
            inputSnapshotHash: "bench",
        },
    };
}
function makeInputs(fx, paAmbCents) {
    const inputs = {
        formulaCall: {
            formulaId: "T-04",
            params: {
                accrualRate: { value: "0.015", effectiveFrom: "1960-01-01", planVersionId: "v1" },
                avgComp: fx.avgAnnualMinor === null ? "36000" : dollarsString(fx.avgAnnualMinor),
                service: fx.serviceStr,
            },
        },
        recordedPaAmb: recordedBenefit(fx, paAmbCents),
        averagingPeriod: { kind: "final", years: 3, description: "final-3-year", ruleRef: "plan §5.01" },
        alternativeAveragingPeriods: ["final-5-year"],
        requiredBasis: { annuityForm: "NSF", retirementAge: 65 },
    };
    if (fx.row.avgCents === null) {
        inputs.boundsSpec = {
            ranges: [
                {
                    field: `CompensationHistory.salaryYear ${fx.doteYear}`,
                    missingClass: "c",
                    low: "12000",
                    high: "96000",
                    unit: "annual-compensation-dollars",
                    basis: "feasible average range $1,000–$8,000/mo (bench fixture, same range as P-10)",
                },
            ],
            assumptions: ["formula T-04 applies to all service"],
        };
    }
    return inputs;
}
// ---------------------------------------------------------------------------
// Validation input (population.test.ts validationParticipant, row-shaped)
// ---------------------------------------------------------------------------
function validationParticipant(fx) {
    const { row } = fx;
    const populated = fx.salaries.filter((s) => s.minor !== null);
    const meanAnnualMinor = populated.length === 0
        ? null
        : Math.round(populated.reduce((s, x) => s + x.minor, 0) / populated.length);
    const lastSalary = populated[populated.length - 1];
    const serviceStr = fx.serviceStr;
    const dote = row.dote;
    return {
        participantKey: row.key,
        bcvRecId: fx.index + 1,
        caseNumber: CASE_NUMBER,
        idType: "1",
        ssn: null,
        firstName: "Syn",
        lastName: "Fictional",
        dob: row.dob,
        sex: "M",
        dateOfDeath: null,
        retstat: "2",
        rettyp: null,
        doh: row.hire,
        dote,
        dop: row.hire,
        dobfParticipant: null,
        dor: null,
        postDoptDote: null,
        nrd: nrdOf(row.dob),
        anb: ageAt(row.dob, dote),
        sanb: null,
        rbd: nrdOf(row.dob),
        rbdDeterminable: true,
        rbdMissingFields: [],
        inPayAtDopt: null,
        isPreDoptRetiree: false,
        isDeferredRecord: true,
        sbcd: null,
        spouseSsn: null,
        spouseLastName: null,
        spouseDob: null,
        spouseSex: null,
        spouseDateOfDeath: null,
        benSsn: null,
        benLastName: null,
        benDob: null,
        benSex: null,
        benDateOfDeath: null,
        apDob: null,
        apSex: null,
        apDateOfDeath: null,
        cspa: serviceStr,
        vspa: serviceStr,
        espa: serviceStr,
        cs: serviceStr,
        vs: serviceStr,
        es: serviceStr,
        csUnit: "years",
        vsUnit: "years",
        vppa: "1",
        paAmb: row.paAmbCents,
        paAcomp: row.avgCents,
        paAcompPeriodicity: "monthly",
        cuComp: lastSalary === undefined ? null : Math.round(lastSalary.minor / 12),
        pia: null,
        integrationMethod: "none",
        firstYear: fx.salaryYears[0] ?? fx.doteYear - 4,
        lastYear: fx.salaryYears[fx.salaryYears.length - 1] ?? fx.doteYear,
        salaryByYear: populated.map((s) => ({ year: s.year, amount: s.minor })),
        annact: "A",
        annualizationBasisNoted: true,
        averagingPeriodYears: [fx.doteYear - 2, fx.doteYear - 1, fx.doteYear],
        formCode: "NSF",
        formCodeNsf: "NSF",
        formCodeNmf: "NMF",
        formCodeQpsa: null,
        formCodeArd: null,
        spcVal: "0",
        spcNsf: "0",
        spcArd: "0",
        mths: 0,
        mthsNsf: 0,
        mthsArd: 0,
        formCodeIsJointLife: false,
        recordIsSingleLife: true,
        lsTerm: "N",
        xrd: nrdOf(row.dob),
        xrdMbTerm: row.paAmbCents,
        pvReteec: null,
        measurementDate: dote,
        recordedDate: dote,
        measurementDisagreementExplained: false,
        assertedBasisNrd: false,
        nrdBasisEvidence: false,
        explicitNoBenefitStatement: false,
        vestingTreatment: "gross",
        annuityForm: "NSF",
        annuityFormConversionDocumented: false,
        calcMeasurementDate: dote,
        calcAnnuityForm: "NSF",
        calcVestingTreatment: "gross",
        planFreezeDate: null,
        accrualAfterFreeze: false,
        benefitReflectsPostFreezeAccrual: false,
        mandcwi: null,
        volcwi: null,
        cashBalDopt: null,
        formulaType: "unit-credit",
        contributionTreatmentDocumented: true,
        cashBalanceExplanationDocumented: true,
        documentedMinimumOrGrandfatherOrPastServiceCredit: false,
        participationBeforeEligibility: false,
        serviceAccruesBeforeDop: false,
        parseError: null,
        badDates: [],
        badNumbers: [],
        fieldsWithoutProvenance: [],
        supportingEvidenceForScale: true,
        s001Derivable: true,
        scheduleProvided: true,
        scheduleRowExists: true,
        schedulePaAmb: row.paAmbCents,
        scheduleExplanationDocumented: false,
        bcvComparison: null,
        paymentAmountMinor: null,
        convertedPaAmbMinor: null,
        ardFactorsPresent: false,
        priorDistribution: null,
        formulaCheckValueMinor: fx.reconMinor,
        formulaKnownForX06: true,
        formulaCheckValuesMinor: fx.reconMinor === null ? null : [fx.reconMinor],
        documentedHypothesis: false,
        pfFactors: null,
        proposedDisposition: null,
        evidenceCount: 0,
        paAmbAccept: null,
        disposition: null,
        decisionExists: false,
        rejectionRationaleStated: false,
        sourcesUsed: [],
        candidateMeasurementDates: [dote],
        establishedMeasurementDate: dote,
        prior: null,
    };
}
function validationContext() {
    return {
        dopt: DOPT,
        today: TODAY,
        runId: "run-bench-1",
        recordedDate: TODAY,
        tolerance: {
            version: 1,
            absoluteMinor: 200,
            relativeDecimal: null,
            application: "either",
            authority: "bench fixture",
            approvedBy: "bench",
            approvedDate: TODAY,
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
const RECON_CONFIG = {
    epsilonRMinor: 100,
    epsilonRSource: "bench: $1.00/month smallest amount",
    materialityMinor: 100,
    materialitySource: "bench tolerance v1 ($1.00)",
};
const STAT_THRESHOLDS = {
    absMinor: 100,
    relDecimal: "0.01",
    source: "bench tolerance v1",
};
function nowMs() {
    return globalThis.performance.now();
}
// Per-participant verdict/disposition columns, filled in runBench's
// reconcile loop and read by the CSV/XLSX builders. Rebuilt on every
// runBench call.
let verdictRows = [];
let dispositionRows = [];
/**
 * Debug helper (bench only): per-participant pipeline outcome with the
 * indeterminate reason detail, so a bad fixture shape shows up here
 * instead of as a silent count in the benchmark table.
 */
function debugOutcomes(csvText) {
    const rows = parseCsv(csvText);
    return rows.map((row, i) => {
        const fx = rowFixture(row, i);
        const outcome = (0, pipeline_1.calculateAccruedBenefit)(makeRequest(fx), makeInputs(fx, row.paAmbCents));
        return {
            key: row.key,
            kind: outcome.kind,
            reasonCode: outcome.kind === "indeterminate" ? outcome.reason.code : null,
            reasonDetail: outcome.kind === "indeterminate" ? (outcome.reason.detail ?? null) : null,
            reconMinor: outcome.kind === "exact" ? (outcome.benefit.amount?.amountMinor ?? null) : null,
            recordedMinor: row.paAmbCents,
        };
    });
}
/**
 * Build the engine inputs for a CSV population (exported for phase
 * probes: build once, time one phase in isolation).
 */
function buildBenchInputs(csvText) {
    const rows = parseCsv(csvText);
    const fixtures = rows.map((row, i) => rowFixture(row, i));
    return {
        rows,
        fixtures,
        validationInputs: fixtures.map((fx) => validationParticipant(fx)),
        requests: fixtures.map((fx) => makeRequest(fx)),
        inputs: fixtures.map((fx) => makeInputs(fx, fx.row.paAmbCents)),
    };
}
function runBench(csvText, memory, onPhase, opts) {
    const notes = [];
    const memStart = memory();
    const csvBytes = new TextEncoder().encode(csvText).length;
    // Per-participant verdict/disposition columns for the report builders.
    verdictRows = new Array(0);
    dispositionRows = new Array(0);
    const phase = (name, startedAt) => {
        if (onPhase === undefined)
            return;
        onPhase(name, nowMs() - startedAt, memory().rssMB);
    };
    // --- 1. Import: CSV parse + engine input construction.
    const t0 = nowMs();
    const { rows, fixtures, validationInputs, requests, inputs } = buildBenchInputs(csvText);
    const n = rows.length;
    const importMs = nowMs() - t0;
    phase("import", t0);
    const memAfterImport = memory();
    // --- 2. Validation (whole population, one call, as the app does).
    // skipValidation (probe only): the P-16 population rule is an O(n²)
    // pairwise identity check (see findings file §4); at 100k it does not
    // finish on this machine. Skipping it measures the other phases.
    const t1 = nowMs();
    let validationRulesEvaluated = 0;
    let validationFindings = 0;
    if (opts?.skipValidation === true) {
        notes.push("validation skipped by probe option (P-16 is O(n²); see findings file §4)");
    }
    else {
        const validation = (0, validation_1.validateCasePackage)(validationInputs, validationContext());
        validationRulesEvaluated = validation.summary.rulesEvaluated;
        validationFindings = validation.allFindings.length;
    }
    const validationMs = nowMs() - t1;
    phase("validation", t1);
    const memAfterValidation = memory();
    // --- 3. Calculation (ten-stage pipeline, one participant at a time).
    const t2 = nowMs();
    const outcomes = new Array(n);
    let exact = 0;
    let bounds = 0;
    let indeterminate = 0;
    const indeterminateReasons = {};
    for (let i = 0; i < n; i += 1) {
        const request = requests[i];
        const input = inputs[i];
        if (request === undefined || input === undefined)
            throw new Error("bench: missing request");
        const outcome = (0, pipeline_1.calculateAccruedBenefit)(request, input);
        outcomes[i] = outcome;
        if (outcome.kind === "exact")
            exact += 1;
        else if (outcome.kind === "bounds")
            bounds += 1;
        else {
            indeterminate += 1;
            indeterminateReasons[outcome.reason.code] =
                (indeterminateReasons[outcome.reason.code] ?? 0) + 1;
        }
    }
    const calculateMs = nowMs() - t2;
    phase("calculate", t2);
    const memAfterCalculate = memory();
    // --- 4. Reconciliation (Δ/D/R, tolerance, recommended disposition).
    const t3 = nowMs();
    const deltas = new Array(n);
    const absDeltas = new Array(n);
    const relDeltas = new Array(n);
    const reconMinors = new Array(n);
    const dispositions = {};
    let withinTolerance = 0;
    let outsideTolerance = 0;
    let notComparable = 0;
    let paInsideBounds = 0;
    let paOutsideBounds = 0;
    let sumAbsDelta = 0;
    let countAbsDelta = 0;
    let maxAbsDelta = null;
    for (let i = 0; i < n; i += 1) {
        const fx = fixtures[i];
        const outcome = outcomes[i];
        if (fx === undefined || outcome === undefined)
            throw new Error("bench: missing outcome");
        const reconInputs = (0, reconciliation_1.buildReconciliationInputs)({
            outcome,
            recorded: recordedBenefit(fx, fx.row.paAmbCents),
            toleranceApplied: tolerance(),
            comparisonBasis: "same-basis",
        });
        const rec = (0, reconcile_1.reconcileParticipant)({
            participantKey: fx.row.key,
            inputs: reconInputs,
            config: RECON_CONFIG,
        });
        dispositions[rec.recommendedDisposition] = (dispositions[rec.recommendedDisposition] ?? 0) + 1;
        verdictRows[i] = rec.toleranceVerdict;
        dispositionRows[i] = rec.recommendedDisposition;
        if (rec.comparison.comparable) {
            const d = rec.comparison.delta.amountMinor;
            const a = rec.comparison.absDelta.amountMinor;
            deltas[i] = d;
            absDeltas[i] = a;
            relDeltas[i] =
                rec.comparison.relative.kind === "defined" ? rec.comparison.relative.value : null;
            reconMinors[i] = rec.reconstructed?.amount?.amountMinor ?? null;
            sumAbsDelta += a;
            countAbsDelta += 1;
            if (maxAbsDelta === null || a > maxAbsDelta)
                maxAbsDelta = a;
        }
        else {
            deltas[i] = null;
            absDeltas[i] = null;
            relDeltas[i] = null;
            reconMinors[i] = null;
            notComparable += 1;
        }
        if (rec.toleranceVerdict === "within-tolerance")
            withinTolerance += 1;
        else if (rec.toleranceVerdict === "outside-tolerance")
            outsideTolerance += 1;
        if (outcome.kind === "bounds") {
            if (outcome.bounds.recordedPosition === "inside")
                paInsideBounds += 1;
            else
                paOutsideBounds += 1;
        }
    }
    const reconcileMs = nowMs() - t3;
    phase("reconcile", t3);
    const memAfterReconcile = memory();
    // --- 5. Statistics (population description + outlier screens).
    const statRows = fixtures.map((fx, i) => {
        const months = (2026 - fx.doteYear) * 12 + 5;
        return {
            participantKey: fx.row.key,
            status: "2",
            employmentGroup: null,
            formulaType: "unit-credit",
            amendmentCohort: null,
            paAmbMinor: fx.row.paAmbCents,
            reconstructedMinor: reconMinors[i] ?? null,
            deltaMinor: deltas[i] ?? null,
            absDeltaMinor: absDeltas[i] ?? null,
            relDelta: relDeltas[i] ?? null,
            denominatorFlag: null,
            ageYears: ageAt(fx.row.dob, fx.row.dote),
            serviceYears: fx.serviceYears,
            compensationMinor: fx.avgAnnualMinor,
            retirementStatus: "2",
            dataCompleteness: null,
            monthsSinceRecorded: months < 0 ? null : months,
            qdro: false,
            priorDistribution: false,
            employmentPeriods: 1,
        };
    });
    const t4 = nowMs();
    const population = (0, statistics_1.describePopulation)(statRows, STAT_THRESHOLDS);
    const outliers = (0, statistics_1.detectOutliers)(statRows, { valueField: "deltaMinor" });
    const statisticsMs = nowMs() - t4;
    phase("statistics", t4);
    void population;
    const memAfterStatistics = memory();
    // --- 5b. One OLS model fit (multivariate layer, §11): Δ$ on age,
    // service, compensation. Timed separately — the wizard path runs
    // descriptives + outlier screens only; model fits are on demand.
    const t5 = nowMs();
    let modelFitNote = "";
    const modelData = (0, statistics_1.buildModelData)(statRows, {
        outcome: "deltaDollars",
        predictors: ["ageYears", "serviceYears", "compensationDollars"],
    });
    if (modelData.kind === "ready") {
        const fit = (0, statistics_1.fitOls)(modelData.data);
        modelFitNote = `OLS ready: n=${modelData.data.y.length}, R²=${fit.summary.r2 === null ? "n/a" : fit.summary.r2.toFixed(4)}`;
    }
    else {
        modelFitNote = `OLS refused: ${modelData.reason}`;
    }
    const modelFitMs = nowMs() - t5;
    phase("model-fit", t5);
    // --- 6. Report generation: reconciliation CSV + XLSX + plan report HTML.
    const t6 = nowMs();
    const reconCsv = (0, exports_1.buildCsv)(csvRowsForReport(fixtures, reconMinors, deltas, absDeltas, relDeltas, verdictRows, dispositionRows));
    const reportCsvMs = nowMs() - t6;
    phase("report-csv", t6);
    const t7 = nowMs();
    const xlsx = (0, exports_1.buildXlsx)([
        { name: "Reconciliation", rows: xlsxRowsForReport(fixtures, reconMinors, deltas, absDeltas, relDeltas, verdictRows, dispositionRows) },
    ]);
    const reportXlsxMs = nowMs() - t7;
    phase("report-xlsx", t7);
    const t8 = nowMs();
    const reportInput = {
        casePackage: {
            caseNumber: CASE_NUMBER,
            planName: "Bench Plan (fictional)",
            planNumber: "001",
            dopt: DOPT,
            participantCount: n,
            completenessGrade: "complete",
        },
        validationSummary: {
            totalFindings: validationFindings,
            bySeverity: {},
            blockingCount: 0,
            findings: [],
        },
        reconciliationSummary: {
            participantsCompared: countAbsDelta,
            matched: deltas.filter((d) => d === 0).length,
            withinTolerance,
            materialDifferences: outsideTolerance,
            notComparable,
            indeterminate,
            blankPaAmb: 0,
            meanAbsDeltaMinor: countAbsDelta === 0 ? null : Math.round(sumAbsDelta / countAbsDelta),
            tolerance: "bench tolerance v1 ($1.00 / 0.1%)",
            byGroup: [],
        },
        statisticsSummary: {
            outliers: [
                { label: "Flagged within cohort", count: outliers.flags.length, population: n, units: "participants" },
                { label: "Explained by group (not errors)", count: outliers.explainedByGroup.length, population: n, units: "participants" },
            ],
            outlierNotes: ["Bench run: outlier flags are prompts to investigate, never corrections."],
        },
        dispositions: Object.entries(dispositions).map(([disposition, count]) => ({
            disposition: disposition,
            count,
            population: n,
        })),
        findings: [],
        missingData: [],
        reproducibility: {
            inputSnapshotHash: "bench",
            ruleVersion: "2026-11-12",
            formulaVersion: "1.0",
            toleranceVersion: "v1",
            engineVersion: "0.1.0",
        },
    };
    const reportHtml = (0, reports_1.renderPlanReport)(reportInput);
    const reportHtmlMs = nowMs() - t8;
    phase("report-html", t8);
    const memAfterReport = memory();
    // --- 7. Incremental recalculation: change one participant's PA_AMB
    // (+$100.00) and re-run that participant, then the population-wide
    // statistics and the CSV rebuild that a re-run entails.
    const mid = Math.floor(n / 2);
    const midFx = fixtures[mid];
    if (midFx === undefined)
        throw new Error("bench: no middle participant");
    const newPaAmb = midFx.row.paAmbCents + 10000;
    const t9 = nowMs();
    const midOutcome = (0, pipeline_1.calculateAccruedBenefit)(requests[mid], makeInputs(midFx, newPaAmb));
    const incrementalCalcOneMs = nowMs() - t9;
    const t10 = nowMs();
    const midReconInputs = (0, reconciliation_1.buildReconciliationInputs)({
        outcome: midOutcome,
        recorded: recordedBenefit(midFx, newPaAmb),
        toleranceApplied: tolerance(),
        comparisonBasis: "same-basis",
    });
    const midRec = (0, reconcile_1.reconcileParticipant)({
        participantKey: midFx.row.key,
        inputs: midReconInputs,
        config: RECON_CONFIG,
    });
    const incrementalReconcileOneMs = nowMs() - t10;
    const t11 = nowMs();
    const updatedRows = statRows.map((r, i) => {
        if (i !== mid)
            return r;
        return {
            ...r,
            paAmbMinor: newPaAmb,
            deltaMinor: midRec.comparison.comparable ? midRec.comparison.delta.amountMinor : null,
            absDeltaMinor: midRec.comparison.comparable ? midRec.comparison.absDelta.amountMinor : null,
            relDelta: midRec.comparison.comparable && midRec.comparison.relative.kind === "defined"
                ? midRec.comparison.relative.value
                : null,
        };
    });
    (0, statistics_1.describePopulation)(updatedRows, STAT_THRESHOLDS);
    (0, statistics_1.detectOutliers)(updatedRows, { valueField: "deltaMinor" });
    const incrementalStatsRerunMs = nowMs() - t11;
    const t12 = nowMs();
    deltas[mid] = midRec.comparison.comparable ? midRec.comparison.delta.amountMinor : null;
    verdictRows[mid] = midRec.toleranceVerdict;
    dispositionRows[mid] = midRec.recommendedDisposition;
    (0, exports_1.buildCsv)(csvRowsForReport(fixtures, reconMinors, deltas, absDeltas, relDeltas, verdictRows, dispositionRows));
    const incrementalCsvRebuildMs = nowMs() - t12;
    phase("incremental", t9);
    return {
        n,
        csvBytes,
        phases: {
            importMs,
            validationMs,
            calculateMs,
            reconcileMs,
            statisticsMs,
            modelFitMs,
            modelFitNote,
            reportCsvMs,
            reportXlsxMs,
            reportHtmlMs,
            incrementalCalcOneMs,
            incrementalReconcileOneMs,
            incrementalStatsRerunMs,
            incrementalCsvRebuildMs,
            incrementalTotalMs: incrementalCalcOneMs + incrementalReconcileOneMs + incrementalStatsRerunMs + incrementalCsvRebuildMs,
        },
        counts: {
            exact,
            bounds,
            indeterminate,
            indeterminateReasons,
            withinTolerance,
            outsideTolerance,
            notComparable,
            paInsideBounds,
            paOutsideBounds,
            outlierFlags: outliers.flags.length,
            outlierExplainedByGroup: outliers.explainedByGroup.length,
            meanAbsDeltaMinor: countAbsDelta === 0 ? null : Math.round(sumAbsDelta / countAbsDelta),
            maxAbsDeltaMinor: maxAbsDelta,
            validationRulesEvaluated,
            validationFindings,
            csvBytesOut: new TextEncoder().encode(reconCsv).length,
            xlsxBytesOut: xlsx.length,
            reportHtmlChars: reportHtml.length,
        },
        dispositions,
        memory: {
            start: memStart,
            afterImport: memAfterImport,
            afterValidation: memAfterValidation,
            afterCalculate: memAfterCalculate,
            afterReconcile: memAfterReconcile,
            afterStatistics: memAfterStatistics,
            afterReport: memAfterReport,
            end: memory(),
        },
        notes,
    };
}
function csvRowsForReport(fixtures, reconMinors, deltas, absDeltas, relDeltas, verdicts, dispositions) {
    const rows = [
        ["participantKey", "recordedMinor", "reconstructedMinor", "deltaMinor", "absDeltaMinor", "relDelta", "toleranceVerdict", "recommendedDisposition"],
    ];
    for (let i = 0; i < fixtures.length; i += 1) {
        const fx = fixtures[i];
        if (fx === undefined)
            continue;
        rows.push([
            fx.row.key,
            String(fx.row.paAmbCents),
            reconMinors[i] === null || reconMinors[i] === undefined ? "" : String(reconMinors[i]),
            deltas[i] === null || deltas[i] === undefined ? "" : String(deltas[i]),
            absDeltas[i] === null || absDeltas[i] === undefined ? "" : String(absDeltas[i]),
            relDeltas[i] ?? "",
            verdicts[i] ?? "",
            dispositions[i] ?? "",
        ]);
    }
    return rows;
}
function xlsxRowsForReport(fixtures, reconMinors, deltas, absDeltas, relDeltas, verdicts, dispositions) {
    const rows = [
        ["participantKey", "recordedMinor", "reconstructedMinor", "deltaMinor", "absDeltaMinor", "relDelta", "toleranceVerdict", "recommendedDisposition"],
    ];
    for (let i = 0; i < fixtures.length; i += 1) {
        const fx = fixtures[i];
        if (fx === undefined)
            continue;
        rows.push([
            fx.row.key,
            fx.row.paAmbCents,
            reconMinors[i] ?? "",
            deltas[i] ?? "",
            absDeltas[i] ?? "",
            relDeltas[i] ?? "",
            verdicts[i] ?? "",
            dispositions[i] ?? "",
        ]);
    }
    return rows;
}
