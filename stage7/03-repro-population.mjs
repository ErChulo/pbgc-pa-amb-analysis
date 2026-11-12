// Stage 7 reproducibility — synthetic 100-participant population (NEW file).
//
// Builds 100 fictional participants (SYN-R7-001..100, seeded mulberry32),
// runs each through calculateAccruedBenefit -> buildReconciliationInputs
// -> reconcileParticipant -> mapDisposition, then describePopulation +
// detectOutliers, and returns one canonical JSON string of every output.
// Fixture shapes mirror test/population.test.ts (same formula T-04,
// 1.5% unit-credit, final-3-year, same tolerance record shape); the
// participant values are new (seeded rng, seed 20261112).
//
// Usage:
//   node stage7/03-repro-population.mjs            # A + B in-process, C in a
//                                                  # fresh child process; compare
//   node stage7/03-repro-population.mjs --single <dir>   # one run into <dir>
//
// Exit 0 = byte-identical canonical outputs across runs. Exit 1 = any diff.
// Synthetic data only. No source file is edited.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { mulberry32, describePopulation, detectOutliers } from "../dist/src/statistics.js";
import { makeMoney } from "../dist/src/decimal.js";
import { makeBenefit } from "../dist/src/formulas.js";
import { calculateAccruedBenefit } from "../dist/src/pipeline.js";
import { buildReconciliationInputs } from "../dist/src/reconciliation.js";
import { reconcileParticipant } from "../dist/src/reconcile.js";
import { mapDisposition } from "../dist/src/dispositionMapping.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const SEED = 20261112;
const N = 100;

function prov() {
  return {
    documentId: "doc-r7",
    location: { kind: "user-entered", enteredBy: "tester", enteredDate: "2026-01-01", entryForm: "test" },
    acquisition: "user-entered",
    derivation: null,
    sourceFileHash: null,
  };
}
function sourced(value) {
  return { value, provenance: prov() };
}
function entity(id) {
  return { id, version: 1, supersedesId: null, sourceRecordIds: [], createdDate: "2026-01-01", createdBy: "tester" };
}
function roundingConfig() {
  return {
    configId: "rc-r7",
    version: "rounding-config v1.0.0",
    planVersionId: "v1",
    prescribedSequence: {
      sequenceId: "prescribed",
      rules: [{ target: "final-monthly-benefit", unit: "0.01", mode: "half-up", stage: "final", source: { kind: "plan-provision", citation: "plan §5.01" } }],
    },
    alternativeSequences: [],
    setBy: "tester",
    setDate: "2026-01-01",
    rationale: "stage 7 reproducibility fixture",
  };
}
function tolerance() {
  return { version: 1, absoluteMinor: 100, relativeDecimal: "0.001", application: "either", authority: "stage 7 fixture", approvedBy: "tester", approvedDate: "2026-01-01" };
}

function planVersion() {
  return {
    ...entity("v1"),
    planId: "plan-1",
    versionId: "v1",
    effectiveDate: sourced("1985-07-01"),
    adoptionDate: sourced("1985-06-01"),
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

/** One participant's inputs. Service and pay vary by seeded rng. */
function participantInputs(i, rng) {
  const key = `SYN-R7-${String(i + 1).padStart(3, "0")}`;
  const serviceYears = 10 + (i % 26);
  const dobYear = 1955 + (i % 20);
  const dob = `${dobYear}-03-14`;
  const dohYear = 1995 + (i % 10);
  const base = 40000 + Math.floor(rng() * 40001);
  const salaries = [2015, 2016, 2017, 2018, 2019].map((year) => {
    const growth = Math.pow(1.02, year - 2015);
    const jitter = 1 + (rng() - 0.5) * 0.02;
    return { year, minor: Math.round(base * growth * jitter) * 100 };
  });
  const final3 = salaries.slice(-3);
  const avgComp = String(Math.round(final3.reduce((s, x) => s + x.minor / 100, 0) / 3));
  const meanAnnualMinor = Math.round(salaries.reduce((s, x) => s + x.minor, 0) / salaries.length);
  const employmentPeriods = [{
    ...entity(`ep-${key}`),
    participantKey: key,
    doh: sourced(`${dohYear}-01-01`),
    dote: sourced("2020-02-29"),
    dop: sourced(null),
    dobfParticipant: sourced(null),
    dor: sourced(null),
    postDoptDote: sourced(null),
    periodSeq: 1,
    periodType: "initial-hire",
    periodStart: `${dohYear}-01-01`,
    periodEnd: "2020-02-29",
    breakInService: null,
    hoursPerPeriod: sourced(null),
  }];
  const serviceHistory = {
    ...entity(`sh-${key}`),
    participantKey: key,
    asOfDate: sourced("2020-02-29"),
    paCreditedService: sourced(serviceYears),
    paVestingService: sourced(serviceYears),
    paEligibilityService: sourced(serviceYears),
    bcvCreditedService: sourced(serviceYears),
    bcvVestingService: sourced(serviceYears),
    bcvEligibilityService: sourced(serviceYears),
    paVestingPercent: sourced("100"),
    bcvVestingPercent: sourced("100"),
    serviceMeasure: "years",
    servicePeriods: [{ start: `${dohYear}-01-01`, end: "2020-02-29", measure: serviceYears, provenance: prov() }],
    breaksApplied: [],
    distributions: [],
  };
  const compensationHistory = {
    ...entity(`ch-${key}`),
    participantKey: key,
    firstYear: sourced(2015),
    lastYear: sourced(2019),
    salaryByYear: salaries.map((s, j) => ({
      salaryYear: s.year,
      sourceField: `S00${j + 1}`,
      amount: makeMoney(s.minor),
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
  const request = {
    participantKey: key,
    participantHistory: { participantKey: key, employmentPeriods, compensationHistory, serviceHistory, benefitObservations: [] },
    provisionTimeline: { planId: "plan-1", versions: [planVersion()] },
    measurementDate: "2020-02-29",
    measurementBasis: "dote",
    calculationKind: "accrued",
    formulaId: "T-04",
    roundingConfig: roundingConfig(),
    tolerance: tolerance(),
    runContext: { engineVersion: "0.1.0", ruleVersion: "2026-11-12", formulaTaxonomyVersion: "1.0", inputSnapshotHash: "r7" },
  };
  const inputs = {
    formulaCall: {
      formulaId: "T-04",
      params: {
        accrualRate: { value: "0.015", effectiveFrom: "1985-07-01", planVersionId: "v1" },
        avgComp,
        service: String(serviceYears),
      },
    },
    recordedPaAmb: null,
    averagingPeriod: { kind: "final", years: 3, description: "final-3-year", ruleRef: "plan §5.01" },
    requiredBasis: { annuityForm: "NSF", retirementAge: 65 },
  };
  return { key, dob, serviceYears, meanAnnualMinor, request, inputs };
}

function recordedBenefit(minor) {
  return makeBenefit(
    { planVersionId: "v1", measurementDate: "2020-02-29", rounding: { stage: "final-only", mode: "nearest-cent", source: "test" } },
    makeMoney(minor),
    "monthly",
    undefined,
    "prior-administrator",
  );
}

function baseEvidence(key, rec) {
  return {
    participantKey: key,
    caseId: "00098765",
    toleranceSetId: "tol-r7",
    completenessGrade: "complete",
    comparisonBasis: "established",
    basisUnresolvable: false,
    basisNote: null,
    reconstructedMinor: rec.reconstructed?.amount?.amountMinor ?? null,
    recordedMinor: rec.recorded?.amount?.amountMinor ?? null,
    deltaMinor: rec.comparison.comparable ? rec.comparison.delta.amountMinor : null,
    withinTolerance: rec.comparison.comparable ? rec.toleranceVerdict === "within-tolerance" : null,
    denominatorFlag: rec.comparison.comparable ? rec.comparison.denominatorFlag : null,
    boundsMinor: null,
    boundWidthMaterial: false,
    boundWidthJustification: null,
    boundAssumptionsInDoubt: false,
    hypotheses: [],
    conflictingCorrections: false,
    correctedBenefitMinor: null,
    correctionReasonablyCertain: false,
    correctionDirection: null,
    missingEvidence: [],
    dataRequests: [],
    nextSteps: [],
    uninvestigatedFlag: false,
    blockingValidationOutstanding: false,
    statisticalOnly: false,
    contradictoryEvidenceUnresolved: false,
    supportedGround: null,
    indeterminateRationale: null,
    noFurtherRequestReason: null,
    ruleApplicabilityOk: true,
    snapshotMatches: true,
  };
}

/** Full 100-participant run. Returns { canonical, rows, summary }. */
export function buildPopulation100() {
  const rng = mulberry32(SEED);
  const reconConfig = {
    epsilonRMinor: 100,
    epsilonRSource: "Stage 7 fixture",
    materialityMinor: 100,
    materialitySource: "Stage 7 fixture tolerance v1 ($1.00)",
  };
  const participants = [];
  const rows = [];
  let nonExact = 0;
  for (let i = 0; i < N; i += 1) {
    const p = participantInputs(i, rng);
    // Pass 1: reconstruction with no recorded amount.
    const probe = calculateAccruedBenefit(p.request, p.inputs);
    if (probe.kind !== "exact") {
      nonExact += 1;
      participants.push({ key: p.key, kind: probe.kind, reason: probe.reason ?? null });
      continue;
    }
    const exactMinor = probe.benefit.amount.amountMinor;
    // Planted discrepancies: i%10==7 -> +$1,000; ==8 -> -$50; ==9 -> +$0.50.
    let recordedMinor = exactMinor;
    if (i % 10 === 7) recordedMinor = exactMinor + 100000;
    else if (i % 10 === 8) recordedMinor = exactMinor - 5000;
    else if (i % 10 === 9) recordedMinor = exactMinor + 50;
    const recorded = recordedBenefit(recordedMinor);
    const inputs = { ...p.inputs, recordedPaAmb: recorded };
    const outcome = calculateAccruedBenefit(p.request, inputs);
    if (outcome.kind !== "exact" || outcome.benefit.amount.amountMinor !== exactMinor) {
      throw new Error(`${p.key}: recorded amount changed the reconstruction (${exactMinor} -> ${outcome.kind})`);
    }
    const recInputs = buildReconciliationInputs({
      outcome,
      recorded,
      toleranceApplied: tolerance(),
      comparisonBasis: "basis-converted",
      basisConversion: "vesting",
    });
    const rec = reconcileParticipant({ participantKey: p.key, inputs: recInputs, config: reconConfig });
    const evidence = baseEvidence(p.key, rec);
    if (i % 10 === 7) {
      evidence.hypotheses = [{ code: "H2", supportClass: "proposed", material: true }];
      evidence.nextSteps = ["Ask the prior administrator for the workpaper."];
    }
    const recommendation = mapDisposition(evidence);
    const ageYears = 2020 - Number(p.dob.slice(0, 4)) - ("02-29" < p.dob.slice(5) ? 1 : 0);
    rows.push({
      participantKey: p.key,
      status: "2",
      employmentGroup: null,
      formulaType: "unit-credit",
      amendmentCohort: null,
      paAmbMinor: recordedMinor,
      reconstructedMinor: exactMinor,
      deltaMinor: rec.comparison.comparable ? rec.comparison.delta.amountMinor : null,
      absDeltaMinor: rec.comparison.comparable ? rec.comparison.absDelta.amountMinor : null,
      relDelta: rec.comparison.comparable && rec.comparison.relative.kind === "defined" ? rec.comparison.relative.value : null,
      denominatorFlag: rec.comparison.comparable ? rec.comparison.denominatorFlag : null,
      ageYears,
      serviceYears: p.serviceYears,
      compensationMinor: p.meanAnnualMinor,
      retirementStatus: "2",
      dataCompleteness: null,
      monthsSinceRecorded: 80,
      qdro: false,
      priorDistribution: false,
      employmentPeriods: 1,
    });
    participants.push({
      key: p.key,
      exactMinor,
      recordedMinor,
      deltaMinor: rec.comparison.delta.amountMinor,
      toleranceVerdict: rec.toleranceVerdict,
      recommendedDisposition: rec.recommendedDisposition,
      mappedDisposition: recommendation.disposition,
      traceSteps: outcome.trace?.length ?? outcome.benefit?.trace?.length ?? null,
      outcome: JSON.parse(JSON.stringify(outcome)),
      reconciliation: JSON.parse(JSON.stringify(rec)),
    });
  }
  const population = describePopulation(rows, { absMinor: 100, relDecimal: "0.01", source: "case tolerance record v1" });
  const outliers = detectOutliers(rows, { valueField: "deltaMinor" });
  const summary = {
    n: N,
    nonExact,
    exactCount: participants.filter((x) => x.exactMinor !== undefined).length,
    plantedGap100000: participants.filter((x) => x.deltaMinor === 100000).length,
    deltaMinus5000: participants.filter((x) => x.deltaMinor === -5000).length,
    delta50: participants.filter((x) => x.deltaMinor === 50).length,
    delta0: participants.filter((x) => x.deltaMinor === 0).length,
    dispositions: Object.fromEntries(
      ["verified", "requires-investigation", "supported-for-acceptance", "correction-recommended", "indeterminate"].map((d) => [
        d,
        participants.filter((x) => x.mappedDisposition === d).length,
      ]),
    ),
    populationN: population.pooled.n,
    outlierFlags: outliers.flags.map((f) => ({ key: f.participantKey, method: f.method, score: f.score })),
  };
  const canonical = JSON.stringify({ participants, population, outliers, summary }, null, 2) + "\n";
  return { canonical, rows, summary };
}

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--single" && args[1]) {
    mkdirSync(args[1], { recursive: true });
    const r = buildPopulation100();
    writeFileSync(join(args[1], "population100.json"), r.canonical);
    console.log(`single run: ${args[1]} sha256=${sha256(r.canonical)}`);
    console.log(JSON.stringify(r.summary, null, 2));
    return 0;
  }
  const a = buildPopulation100();
  const b = buildPopulation100();
  const runsDir = join(DIR, "runs");
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(runsDir, "population100-A.json"), a.canonical);
  writeFileSync(join(runsDir, "population100-B.json"), b.canonical);
  const child = spawnSync(process.execPath, [join(DIR, "03-repro-population.mjs"), "--single", join(runsDir, "population100-C")], { stdio: "inherit" });
  if (child.status !== 0) {
    console.error("FAIL: child process run C failed");
    return 1;
  }
  const c = readFileSync(join(runsDir, "population100-C", "population100.json"), "utf8");
  const ha = sha256(a.canonical);
  const hb = sha256(b.canonical);
  const hc = sha256(c);
  console.log(`population100 A ${ha.slice(0, 16)}  B ${hb.slice(0, 16)}  C ${hc.slice(0, 16)}`);
  console.log("summary A:", JSON.stringify(a.summary));
  if (ha !== hb || ha !== hc) {
    console.error("FAIL: 100-participant outputs differ across identical runs");
    return 1;
  }
  console.log("PASS: 100-participant outputs byte-identical across A, B, C");
  return 0;
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("03-repro-population.mjs")) {
  process.exit(main());
}
