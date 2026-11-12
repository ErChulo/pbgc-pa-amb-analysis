// Stage 7 — Node-side ground-truth dump for the 1,000-participant population.
//
// Mirrors test/population.test.ts (same seed, same cohorts, same planted
// causes) but writes per-participant results to stage7/population-node.json
// so the browser run can be compared participant-by-participant.
// Synthetic data only. Run: node stage7/03-population-node.mjs
// (after `npm run build`, so dist/ is current).

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decMultiply, makeMoney, moneyMinorToDecimalString } from "../dist/src/decimal.js";
import { makeBenefit } from "../dist/src/formulas.js";
import { calculateAccruedBenefit, testCounterfactual } from "../dist/src/pipeline.js";
import { buildReconciliationInputs, rankCounterfactuals } from "../dist/src/reconciliation.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const SEED = 20261112;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COHORTS = [
  { cohort: "clean", from: 0, to: 399 },
  { cohort: "service", from: 400, to: 549 },
  { cohort: "averaging", from: 550, to: 699 },
  { cohort: "rounding", from: 700, to: 799 },
  { cohort: "missing", from: 800, to: 899 },
  { cohort: "vesting", from: 900, to: 999 },
];
const EXPECTED_TOP = { clean: "none", service: "H2", averaging: "H4", rounding: "H15", missing: "H16", vesting: "H12" };
const EXPECTED_DISPOSITION = {
  clean: "verified",
  service: "correction-recommended",
  averaging: "correction-recommended",
  rounding: "verified",
  missing: "supported-for-acceptance",
  vesting: "requires-investigation",
};

function cohortOf(index) {
  for (const c of COHORTS) if (index >= c.from && index <= c.to) return c.cohort;
  throw new Error(`no cohort for index ${index}`);
}
function key(index) { return `SYN-POP-${String(index + 1).padStart(4, "0")}`; }
function prov() {
  return { documentId: "doc-pop", location: { kind: "user-entered", enteredBy: "tester", enteredDate: "2026-01-01", entryForm: "test" }, acquisition: "user-entered", derivation: null, sourceFileHash: null };
}
function sourced(value) { return { value, provenance: prov() }; }
function entity(id) {
  return { id, version: 1, supersedesId: null, sourceRecordIds: [], createdDate: "2026-01-01", createdBy: "tester" };
}
function planVersion() {
  return { ...entity("v1"), planId: "plan-1", versionId: "v1", effectiveDate: sourced("1985-07-01"), adoptionDate: sourced("1985-06-01"), restatementDate: sourced(null), provisionText: sourced(""), provisionSection: sourced("§5.01"), supersedesVersionId: null, grandfatheredGroups: sourced([]), freeze: sourced(null), sourceDocumentId: "doc-1", changeSummary: "", statutoryLimitsInForce: [], formulaIds: ["T-04"] };
}
function employmentPeriod(participantKey) {
  return { ...entity(`ep-${participantKey}`), participantKey, doh: sourced("2000-01-01"), dote: sourced("2020-02-29"), dop: sourced(null), dobfParticipant: sourced(null), dor: sourced(null), postDoptDote: sourced(null), periodSeq: 1, periodType: "initial-hire", periodStart: "2000-01-01", periodEnd: "2020-02-29", breakInService: null, hoursPerPeriod: sourced(null) };
}
function serviceHistory(participantKey, vp) {
  return { ...entity(`sh-${participantKey}`), participantKey, asOfDate: sourced("2020-02-29"), paCreditedService: sourced(20), paVestingService: sourced(20), paEligibilityService: sourced(20), bcvCreditedService: sourced(20), bcvVestingService: sourced(20), bcvEligibilityService: sourced(20), paVestingPercent: sourced(vp), bcvVestingPercent: sourced(vp), serviceMeasure: "years", servicePeriods: [{ start: "2000-01-01", end: "2020-02-29", measure: 20, provenance: prov() }], breaksApplied: [], distributions: [] };
}
function compensationHistory(participantKey, salaries) {
  return { ...entity(`ch-${participantKey}`), participantKey, firstYear: sourced(salaries[0]?.year ?? 2015), lastYear: sourced(salaries[salaries.length - 1]?.year ?? 2019), salaryByYear: salaries.map((s, i) => ({ salaryYear: s.year, sourceField: `S00${i + 1}`, amount: s.minor === null ? null : makeMoney(s.minor), annualized: false, provenance: prov() })), annualizedFlagSource: sourced(null), salaryDesc: sourced("W-2 wages"), currentMonthlyComp: sourced(null), paAverageComp: sourced(null), compensationDefinitionApplied: "plan §2.01", nonCensusInputs: [] };
}
function roundingConfig() {
  return { configId: "rc-1", version: "rounding-config v1.0.0", planVersionId: "v1", prescribedSequence: { sequenceId: "prescribed", rules: [{ target: "final-monthly-benefit", unit: "0.01", mode: "half-up", stage: "final", source: { kind: "plan-provision", citation: "plan §5.01" } }] }, alternativeSequences: [], setBy: "tester", setDate: "2026-01-01", rationale: "test fixture" };
}
function tolerance() {
  return { version: 1, absoluteMinor: 100, relativeDecimal: "0.001", application: "either", authority: "test fixture", approvedBy: "tester", approvedDate: "2026-01-01" };
}
const DOLLAR_SEQUENCE = {
  sequenceId: "hypothesis-dollar",
  rules: [{ target: "final-monthly-benefit", unit: "1", mode: "half-up", stage: "final", source: { kind: "plan-provision", citation: "plan §5.01 (test hypothesis)" } }],
};
function baseInputs(recordedPaAmb) {
  return {
    formulaCall: { formulaId: "T-04", params: { accrualRate: { value: "0.015", effectiveFrom: "1985-07-01", planVersionId: "v1" }, avgComp: "60000", service: "20" } },
    recordedPaAmb,
    averagingPeriod: { kind: "final", years: 3, description: "final-3-year", ruleRef: "plan §5.01" },
    alternativeAveragingPeriods: ["final-5-year"],
    requiredBasis: { annuityForm: "NSF", retirementAge: 65 },
  };
}
function makeRequest(args) {
  return {
    participantKey: args.participantKey,
    participantHistory: { participantKey: args.participantKey, employmentPeriods: [employmentPeriod(args.participantKey)], compensationHistory: compensationHistory(args.participantKey, args.salaries), serviceHistory: serviceHistory(args.participantKey, args.vp), benefitObservations: [] },
    provisionTimeline: { planId: "plan-1", versions: [planVersion()] },
    measurementDate: "2020-02-29", measurementBasis: "dote", calculationKind: "accrued", formulaId: "T-04",
    roundingConfig: roundingConfig(), tolerance: tolerance(),
    runContext: { engineVersion: "0.1.0", ruleVersion: "2026-11-12", formulaTaxonomyVersion: "1.0", inputSnapshotHash: "test" },
  };
}
function recordedBenefit(minor) {
  return makeBenefit({ planVersionId: "v1", measurementDate: "2020-02-29", rounding: { stage: "final-only", mode: "nearest-cent", source: "test" } }, makeMoney(minor), "monthly", undefined, "prior-administrator");
}
function salariesFor(rng, missing2020) {
  const base = 48000 + Math.floor(rng() * 24001);
  const years = missing2020 ? [2018, 2019, 2020] : [2015, 2016, 2017, 2018, 2019];
  return years.map((year) => {
    if (missing2020 && year === 2020) return { year, minor: null };
    const growth = Math.pow(1.02, year - 2015);
    const jitter = 1 + (rng() - 0.5) * 0.02;
    return { year, minor: Math.round(base * growth * jitter) * 100 };
  });
}
function recommendDisposition(args) {
  if (args.outcomeKind === "bounds") return args.recordedPosition === "inside" ? "supported-for-acceptance" : "requires-investigation";
  if (args.outcomeKind !== "exact") return "indeterminate";
  if (args.withinTolerance) return "verified";
  if (args.topSupport === "coincidence" || args.topSupport === "refuted" || args.topSupport === "none") return "requires-investigation";
  if (args.topResidualZero && args.topResolvesCohort) return "correction-recommended";
  return "requires-investigation";
}
function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length, mid = s[Math.floor(n / 2)];
  return n % 2 === 1 ? mid : (s[n / 2 - 1] + mid) / 2;
}

const rng = mulberry32(SEED);
const rows = [];
const cfByIndex = new Map();
for (let i = 0; i < 1000; i += 1) {
  const cohort = cohortOf(i);
  const participantKey = key(i);
  const vp = cohort === "vesting" ? "0.8" : "1";
  let salaries = salariesFor(rng, cohort === "missing");
  let request = makeRequest({ participantKey, salaries, vp });
  if (cohort === "missing") {
    const filled = salaries.map((s) => s.year === 2020 ? { year: 2020, minor: salaries.find((x) => x.year === 2019)?.minor ?? null } : s);
    const planted = calculateAccruedBenefit(makeRequest({ participantKey, salaries: filled, vp }), baseInputs(null));
    if (planted.kind !== "exact") throw new Error(`missing ${participantKey}: planted not exact`);
    const recordedMinor = planted.benefit.amount?.amountMinor ?? null;
    if (recordedMinor === null) throw new Error(`missing ${participantKey}: no amount`);
    const salary2019 = salaries.find((x) => x.year === 2019)?.minor;
    const dollars2019 = moneyMinorToDecimalString(salary2019);
    const inputs = {
      ...baseInputs(recordedBenefit(recordedMinor)),
      boundsSpec: { ranges: [{ field: "CompensationHistory.salaryYear 2020", missingClass: "c", low: decMultiply(dollars2019, "0.9"), high: decMultiply(dollars2019, "1.1"), unit: "annual-compensation-dollars", basis: "2019 salary ±10% (test bounds)" }], assumptions: ["formula T-04 applies to all service"] },
    };
    const outcome = calculateAccruedBenefit(request, inputs);
    if (outcome.kind !== "bounds") throw new Error(`missing ${participantKey}: expected bounds`);
    rows.push({ index: i, key: participantKey, cohort, reconMinor: null, recordedMinor, deltaMinor: null, outcomeKind: "bounds", recordedPosition: outcome.bounds.recordedPosition, boundsMin: outcome.bounds.min.amountMinor, boundsMax: outcome.bounds.max.amountMinor, boundsWidthMinor: outcome.bounds.max.amountMinor - outcome.bounds.min.amountMinor, topCode: "H16", topSupport: "none", topResidualZero: false, topResolvesCohort: false, withinTolerance: false, disposition: recommendDisposition({ outcomeKind: "bounds", recordedPosition: outcome.bounds.recordedPosition, withinTolerance: false, topResidualZero: false, topResolvesCohort: false, topSupport: "none" }) });
    continue;
  }
  let outcome = calculateAccruedBenefit(request, baseInputs(null));
  if (outcome.kind !== "exact") throw new Error(`${participantKey}: expected exact`);
  let reconMinor = outcome.benefit.amount?.amountMinor ?? null;
  if (reconMinor === null) throw new Error(`${participantKey}: no amount`);
  if (cohort === "rounding") {
    let tries = 0;
    while (reconMinor % 100 === 0 && tries < 10) {
      salaries = salaries.map((s) => s.year === 2019 && s.minor !== null ? { year: s.year, minor: s.minor + 100 } : s);
      const retry = calculateAccruedBenefit((request = makeRequest({ participantKey, salaries, vp })), baseInputs(null));
      if (retry.kind !== "exact") throw new Error(`${participantKey}: retry not exact`);
      reconMinor = retry.benefit.amount?.amountMinor ?? null;
      outcome = retry;
      tries += 1;
    }
    if (reconMinor % 100 === 0) throw new Error(`${participantKey}: could not plant rounding difference`);
  }
  let recordedMinor;
  if (cohort === "clean") recordedMinor = reconMinor;
  else if (cohort === "service") {
    const planted = calculateAccruedBenefit(request, { ...baseInputs(null), serviceOverride: { creditedService: "21" } });
    if (planted.kind !== "exact") throw new Error(`${participantKey}: planted service not exact`);
    recordedMinor = planted.benefit.amount?.amountMinor ?? null;
  } else if (cohort === "averaging") {
    const planted = calculateAccruedBenefit(request, { ...baseInputs(null), averagingPeriod: { kind: "final", years: 5, description: "final-5-year", ruleRef: "plan §5.01" } });
    if (planted.kind !== "exact") throw new Error(`${participantKey}: planted averaging not exact`);
    recordedMinor = planted.benefit.amount?.amountMinor ?? null;
  } else if (cohort === "rounding") recordedMinor = Math.round(reconMinor / 100) * 100;
  else {
    const planted = calculateAccruedBenefit(request, { ...baseInputs(null), applyVestingTwice: true });
    if (planted.kind !== "exact") throw new Error(`${participantKey}: planted vesting not exact`);
    recordedMinor = planted.benefit.amount?.amountMinor ?? null;
  }
  if (recordedMinor === null) throw new Error(`${participantKey}: planted no amount`);
  const recorded = recordedBenefit(recordedMinor);
  const reconInputs = buildReconciliationInputs({ outcome, recorded, toleranceApplied: tolerance(), comparisonBasis: "same-basis" });
  if (reconInputs.reconstructed?.amount?.amountMinor !== reconMinor) throw new Error(`${participantKey}: recon inputs mismatch`);
  const deltaMinor = recordedMinor - reconMinor;
  const absDelta = Math.abs(deltaMinor);
  const withinTolerance = absDelta <= 100 || (reconMinor > 0 && absDelta / reconMinor <= 0.001);
  const inputs = baseInputs(recorded);
  const cfs = [
    testCounterfactual(request, { kind: "service-delta-years", years: "+1" }, inputs),
    testCounterfactual(request, { kind: "averaging-period", period: "final-5-year" }, inputs),
    testCounterfactual(request, { kind: "rounding-sequence", sequence: DOLLAR_SEQUENCE }, inputs),
    testCounterfactual(request, { kind: "vesting", mode: "applied-twice-diagnostic" }, inputs),
  ];
  cfByIndex.set(i, cfs.map((cf) => ({ ...cf, documentedMechanism: false, resolvesCohort: false })));
  rows.push({ index: i, key: participantKey, cohort, reconMinor, recordedMinor, deltaMinor, outcomeKind: "exact", recordedPosition: null, boundsMin: null, boundsMax: null, boundsWidthMinor: null, topCode: "pending", topSupport: "none", topResidualZero: false, topResolvesCohort: false, withinTolerance, disposition: "requires-investigation" });
}
for (const c of COHORTS) {
  if (c.cohort === "missing") continue;
  const members = rows.filter((r) => r.cohort === c.cohort);
  const codes = ["H2", "H4", "H15", "H12"];
  const resolveRate = new Map();
  for (const code of codes) {
    let resolved = 0;
    for (const r of members) {
      const list = cfByIndex.get(r.index) ?? [];
      const cf = list.find((x) => x.hypothesisCode === code);
      if (cf !== undefined && cf.residualDelta !== null && cf.residualDelta.amountMinor === 0) resolved += 1;
    }
    resolveRate.set(code, members.length === 0 ? 0 : resolved / members.length);
  }
  for (const r of members) {
    const list = (cfByIndex.get(r.index) ?? []).map((cf) => ({ ...cf, resolvesCohort: (resolveRate.get(cf.hypothesisCode) ?? 0) >= 0.5 }));
    const ranked = rankCounterfactuals(list);
    const top = ranked[0];
    if (top === undefined) throw new Error(`no ranked hypotheses for ${key(r.index)}`);
    r.topCode = top.hypothesisCode;
    r.topSupport = top.supportClass;
    r.topResidualZero = top.residualDelta !== null && top.residualDelta.amountMinor === 0;
    r.topResolvesCohort = top.resolvesCohort;
    r.disposition = recommendDisposition({ outcomeKind: "exact", withinTolerance: r.withinTolerance, topResidualZero: r.topResidualZero, topResolvesCohort: r.topResolvesCohort, topSupport: r.topSupport });
  }
}
// Robust-z ground truth (population.test.ts method).
const exactRows = rows.filter((r) => r.outcomeKind === "exact" && r.deltaMinor !== null);
const deltas = exactRows.map((r) => r.deltaMinor);
const med = median(deltas);
const mad = median(deltas.map((d) => Math.abs(d - med)));
const flagged = exactRows.filter((r) => { const z = (0.6745 * (r.deltaMinor - med)) / mad; return z < -3.5 || z > 3.5; });
const flaggedByCohort = {};
for (const r of flagged) flaggedByCohort[r.cohort] = (flaggedByCohort[r.cohort] ?? 0) + 1;
const mismatches = [];
for (const c of COHORTS) {
  if (c.cohort === "clean") continue;
  for (const r of rows.filter((x) => x.cohort === c.cohort)) {
    if (r.topCode !== EXPECTED_TOP[c.cohort]) mismatches.push(`${r.key} top ${r.topCode} != ${EXPECTED_TOP[c.cohort]}`);
    if (r.disposition !== EXPECTED_DISPOSITION[c.cohort]) mismatches.push(`${r.key} disp ${r.disposition} != ${EXPECTED_DISPOSITION[c.cohort]}`);
  }
}
const out = { seed: SEED, medianDelta: med, mad, flaggedTotal: flagged.length, flaggedByCohort, flaggedKeys: flagged.map((r) => r.key), topMismatches: mismatches, rows };
writeFileSync(join(DIR, "population-node.json"), JSON.stringify(out, null, 2));
console.log(`population-node: n=1000 medianΔ=${med} MAD=${mad} flagged=${flagged.length} byCohort=${JSON.stringify(flaggedByCohort)} mismatches=${mismatches.length}`);
if (mismatches.length > 0) { console.log(mismatches.slice(0, 10).join("\n")); process.exit(1); }
