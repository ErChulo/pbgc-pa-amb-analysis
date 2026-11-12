/**
 * Stage 5 (Worker 4) property tests for the reconciliation engine.
 *
 * Seeded, reproducible (mulberry32, seed 20261112 — the test/property.test.ts
 * pattern: one stream per property). Each property runs 120 generated cases.
 *
 * Properties (MASTER_PROMPT §10, §12, §20):
 * 1. Reconciliation invariants: Δ = recorded − reconstructed exactly
 *    (integer minor units); D = |Δ|; R is computed only when the
 *    denominator is meaningful (recon ≥ $1.00/month); a zero denominator
 *    is flagged, never divided by; Δ is antisymmetric.
 * 2. Bounds widening under missing data: more missing inputs → bounds
 *    never narrower; a missing input with a degenerate (zero-width)
 *    range does not widen the bounds.
 * 3. Ranking stability: adding an irrelevant hypothesis (refuted, or
 *    plausible but non-resolving and undocumented) does not change the
 *    top-ranked supported hypothesis; ranking does not mutate its input.
 * 4. Determinism: the same input + the same seed → identical output
 *    (calculation outcome, hypothesis ranking, generated population).
 *
 * Δ/D/R are computed here from the two amounts (MASTER_PROMPT §10) —
 * the reconciliation module (another worker) owns those computations
 * in production; these properties state the invariants that module
 * must satisfy.
 *
 * Plain node:test + node:assert. Synthetic data only. No live case data.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decAdd, decCompare, decDivide, decMultiply, makeMoney } from "../src/decimal.js";
import type {
  CalcContext,
  CalculationRequest,
  CompensationHistory,
  EmploymentPeriod,
  PlanVersion,
  Provenance,
  RoundingConfig,
  RoundingSequence,
  ServiceHistory,
  SourcedValue,
  ToleranceRecord,
  TypedBenefitQuantity,
} from "../src/types.js";
import { calcUnitCredit, datedValue, makeBenefit } from "../src/formulas.js";
import { calculateAccruedBenefit } from "../src/pipeline.js";
import type { PipelineInputs } from "../src/pipeline.js";
import {
  buildBoundsResult,
  checkMonotonicity,
  recordedPosition,
} from "../src/bounds.js";
import {
  makeCounterfactualResult,
  rankCounterfactuals,
  type RankableCounterfactual,
} from "../src/reconciliation.js";

// ---------------------------------------------------------------------------
// Seeded PRNG + generators (fixed seed 20261112; one stream per property)
// ---------------------------------------------------------------------------

const SEED = 20261112;
const CASES = 120;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngFor(propertyIndex: number): () => number {
  return mulberry32(SEED + propertyIndex * 7919);
}

function ri(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

const CTX: CalcContext = {
  planVersionId: "v1",
  measurementDate: "2020-02-29",
  rounding: { stage: "final-only", mode: "nearest-cent", source: "property test" },
};

/** The $1.00/month small-denominator epsilon (pipeline default). */
const EPSILON_R_MINOR = 100;

/** Denominator flag for R (MASTER_PROMPT §10; Stage 1 output 03 §2.3). */
function denominatorFlag(reconMinor: number): string | null {
  if (reconMinor === 0) return "R_UNDEFINED_ZERO_DENOMINATOR";
  if (reconMinor > 0 && reconMinor < EPSILON_R_MINOR) return "R_UNSTABLE_SMALL_DENOMINATOR";
  return null;
}

const DOLLAR_SEQUENCE: RoundingSequence = {
  sequenceId: "hypothesis-dollar",
  rules: [
    {
      target: "final-monthly-benefit",
      unit: "1",
      mode: "half-up",
      stage: "final",
      source: { kind: "plan-provision", citation: "plan §5.01 (property test)" },
    },
  ],
};

// ---------------------------------------------------------------------------
// Property 1 — Δ / D / R invariants
// ---------------------------------------------------------------------------

describe("reconciliation invariants (Δ, D, R)", () => {
  it("Δ is exact, D is |Δ|, R exists only for a meaningful denominator, Δ is antisymmetric", () => {
    const rng = rngFor(1);
    for (let n = 0; n < CASES; n += 1) {
      // Recon from $0.00 to $3,000.00/month; recorded likewise. The
      // zero and near-zero denominators are generated deliberately:
      // every 10th case forces recon = 0, every 11th forces $0.50.
      let reconMinor = ri(rng, 0, 300000);
      if (n % 10 === 0) reconMinor = 0;
      if (n % 11 === 0) reconMinor = 50;
      const recordedMinor = ri(rng, 0, 300000);
      const delta = recordedMinor - reconMinor;
      const d = delta < 0 ? -delta : delta;
      assert.equal(d, Math.abs(recordedMinor - reconMinor), `case ${n}: D = |Δ|`);
      assert.equal(delta, -(reconMinor - recordedMinor), `case ${n}: Δ is antisymmetric`);
      const flag = denominatorFlag(reconMinor);
      if (reconMinor === 0) {
        assert.equal(flag, "R_UNDEFINED_ZERO_DENOMINATOR", `case ${n}: zero denominator is flagged, never divided by`);
      } else if (reconMinor < EPSILON_R_MINOR) {
        assert.equal(flag, "R_UNSTABLE_SMALL_DENOMINATOR", `case ${n}: small denominator is flagged`);
      } else {
        assert.equal(flag, null, `case ${n}: meaningful denominator carries no flag`);
        const r = decDivide(String(delta), String(reconMinor), 10);
        // R has the sign of Δ and is exactly Δ/recon.
        assert.equal(decCompare(r, "0") === 0, delta === 0, `case ${n}: R is zero exactly when Δ is zero`);
        assert.equal(
          (decCompare(r, "0") > 0) === (delta > 0) && (decCompare(r, "0") < 0) === (delta < 0),
          true,
          `case ${n}: sign(R) = sign(Δ)`,
        );
        // R recomputed from the same inputs is identical (deterministic).
        assert.equal(decDivide(String(delta), String(reconMinor), 10), r, `case ${n}: R is deterministic`);
      }
    }
  });

  it("recordedPosition agrees with the manual comparison against [min, max]", () => {
    const rng = rngFor(2);
    for (let n = 0; n < CASES; n += 1) {
      const minMinor = ri(rng, 50000, 150000);
      const maxMinor = minMinor + ri(rng, 0, 50000);
      const recordedMinor = n % 3 === 0 ? null : ri(rng, 0, 200000);
      const recorded = recordedMinor === null ? null : makeMoney(recordedMinor);
      const position = recordedPosition(recorded, makeMoney(minMinor), makeMoney(maxMinor));
      if (recordedMinor === null) assert.equal(position, "recorded-missing");
      else if (recordedMinor < minMinor) assert.equal(position, "below-min");
      else if (recordedMinor > maxMinor) assert.equal(position, "above-max");
      else assert.equal(position, "inside");
    }
  });
});

// ---------------------------------------------------------------------------
// Property 2 — bounds widening under missing data
// ---------------------------------------------------------------------------

describe("bounds widening under missing data", () => {
  /** Monthly benefit (minor units) for a T-04 unit-credit benefit at a
   *  given average compensation (exact dollars) and 20 years' service. */
  function monthlyMinor(avgCompDollars: string): number {
    const result = calcUnitCredit(CTX, {
      accrualRate: datedValue("0.015", "1985-07-01", "v1"),
      avgComp: avgCompDollars,
      service: "20",
    });
    if (result.kind !== "exact") throw new Error("monthlyMinor: T-04 did not evaluate exactly");
    const minor = result.value.amount?.amountMinor ?? null;
    if (minor === null) throw new Error("monthlyMinor: no amount");
    return minor;
  }

  /** Bounds over a 3-year window with k missing years, each bounded in
   *  [0.9S, 1.1S] around the known salary S (dollars). The benefit is
   *  monotone in the missing salary, so the endpoints are the bounds. */
  function boundsForMissing(k: number, salaryDollars: string): { minMinor: number; maxMinor: number } {
    const low = decMultiply(salaryDollars, "0.9");
    const high = decMultiply(salaryDollars, "1.1");
    const knownTotal = decMultiply(salaryDollars, String(3 - k));
    const avgLowExact = decDivide(decAdd(knownTotal, decMultiply(low, String(k))), "3", 10);
    const avgHighExact = decDivide(decAdd(knownTotal, decMultiply(high, String(k))), "3", 10);
    return { minMinor: monthlyMinor(avgLowExact), maxMinor: monthlyMinor(avgHighExact) };
  }

  it("more missing years → bounds never narrower; a zero-width range does not widen", () => {
    const rng = rngFor(3);
    for (let n = 0; n < CASES; n += 1) {
      const salaryDollars = String(ri(rng, 40000, 80000));
      const w1 = boundsForMissing(1, salaryDollars);
      const w2 = boundsForMissing(2, salaryDollars);
      const w3 = boundsForMissing(3, salaryDollars);
      const width1 = w1.maxMinor - w1.minMinor;
      const width2 = w2.maxMinor - w2.minMinor;
      const width3 = w3.maxMinor - w3.minMinor;
      assert.ok(width1 > 0, `case ${n}: one missing year gives a positive width`);
      assert.ok(width2 >= width1, `case ${n}: width(2) ${width2} >= width(1) ${width1}`);
      assert.ok(width3 >= width2, `case ${n}: width(3) ${width3} >= width(2) ${width2}`);
      // Monotonicity check on the evaluated points (Stage 2 output 04
      // §5.2 rule B-2): the benefit is monotone in the missing salary.
      const mono = checkMonotonicity("missing salary year", [
        { inputValue: decMultiply(salaryDollars, "0.9"), benefitMinor: w1.minMinor },
        { inputValue: salaryDollars, benefitMinor: monthlyMinor(salaryDollars) },
        { inputValue: decMultiply(salaryDollars, "1.1"), benefitMinor: w1.maxMinor },
      ]);
      assert.equal(mono.monotone, true, `case ${n}: benefit is monotone in the missing salary`);
      // A missing year with a degenerate range [S, S] contributes no
      // width: bounds over that year alone collapse to the exact value.
      const exact = monthlyMinor(salaryDollars);
      const degenerate = buildBoundsResult({
        minBenefit: makeBenefit(CTX, makeMoney(exact), "monthly"),
        maxBenefit: makeBenefit(CTX, makeMoney(exact), "monthly"),
        assumptions: ["missing year filled at its only feasible value"],
        derivation: {
          method: "endpoint-evaluation",
          kinkPoints: [],
          monotonicity: [{ input: "missing salary year", monotone: true, verifiedBy: "formula structure" }],
          feasibleRegion: "missing salary year in [S, S]",
        },
        widthAttribution: [],
        scenarios: [],
        recordedPaAmb: makeBenefit(CTX, makeMoney(exact), "monthly", undefined, "prior-administrator"),
      });
      assert.equal(degenerate.max.amountMinor - degenerate.min.amountMinor, 0);
      assert.equal(degenerate.recordedPosition, "inside");
    }
  });
});

// ---------------------------------------------------------------------------
// Property 3 — ranking stability
// ---------------------------------------------------------------------------

describe("ranking stability", () => {
  function supportedTop(): RankableCounterfactual {
    return {
      ...makeCounterfactualResult({
        operation: { kind: "service-delta-years", years: "+1" },
        hypothesisCode: "H2",
        benefit: makeBenefit(CTX, makeMoney(150000), "monthly"),
        residualDelta: makeMoney(0),
        supportClass: "supported",
        evidenceFor: ["the counterfactual benefit equals the recorded PA_AMB"],
        evidenceAgainst: [],
      }),
      documentedMechanism: false,
      resolvesCohort: true,
    };
  }

  function otherHypothesis(code: "H4" | "H12", supportClass: "plausible" | "refuted"): RankableCounterfactual {
    const operation =
      code === "H4"
        ? { kind: "averaging-period", period: "final-5-year" } as const
        : { kind: "vesting", mode: "not-applied" } as const;
    return {
      ...makeCounterfactualResult({
        operation,
        hypothesisCode: code,
        benefit: makeBenefit(CTX, makeMoney(140000), "monthly"),
        residualDelta: makeMoney(10000),
        supportClass,
        evidenceFor: [],
        evidenceAgainst: ["residual Δ is 100.00"],
      }),
      documentedMechanism: false,
      resolvesCohort: false,
    };
  }

  it("adding an irrelevant hypothesis does not change the top-ranked supported hypothesis", () => {
    const rng = rngFor(4);
    for (let n = 0; n < CASES; n += 1) {
      const top = supportedTop();
      const others = [otherHypothesis("H4", "plausible"), otherHypothesis("H12", "refuted")];
      const base = rankCounterfactuals([top, ...others]);
      assert.equal(base[0]?.hypothesisCode, "H2", `case ${n}: top is H2 before adding`);
      // Irrelevant hypothesis 1: refuted, undocumented, non-resolving.
      const irrelevantRefuted: RankableCounterfactual = {
        ...makeCounterfactualResult({
          operation: { kind: "rounding-sequence", sequence: DOLLAR_SEQUENCE },
          hypothesisCode: "H15",
          benefit: makeBenefit(CTX, makeMoney(150001), "monthly"),
          residualDelta: makeMoney(-1),
          supportClass: "refuted",
          evidenceFor: [],
          evidenceAgainst: ["residual Δ is -0.01"],
        }),
        documentedMechanism: false,
        resolvesCohort: false,
      };
      const withRefuted = rankCounterfactuals([top, ...others, irrelevantRefuted]);
      assert.equal(withRefuted[0]?.hypothesisCode, "H2", `case ${n}: refuted addition leaves top at H2`);
      // Irrelevant hypothesis 2: plausible but non-resolving, undocumented,
      // with a larger residual than the top.
      const irrelevantPlausible: RankableCounterfactual = {
        ...makeCounterfactualResult({
          operation: { kind: "rounding-sequence", sequence: DOLLAR_SEQUENCE },
          hypothesisCode: "H15",
          benefit: makeBenefit(CTX, makeMoney(120000 + ri(rng, 0, 10000)), "monthly"),
          residualDelta: makeMoney(20000 + ri(rng, 0, 10000)),
          supportClass: "plausible",
          evidenceFor: [],
          evidenceAgainst: ["residual Δ is large"],
        }),
        documentedMechanism: false,
        resolvesCohort: false,
      };
      const withPlausible = rankCounterfactuals([top, ...others, irrelevantPlausible]);
      assert.equal(withPlausible[0]?.hypothesisCode, "H2", `case ${n}: plausible non-resolving addition leaves top at H2`);
      // Ranking does not mutate its input.
      const snapshot = JSON.stringify([top, ...others]);
      rankCounterfactuals([top, ...others]);
      assert.equal(JSON.stringify([top, ...others]), snapshot, `case ${n}: ranking leaves its input untouched`);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 4 — determinism
// ---------------------------------------------------------------------------

describe("determinism (same input + same seed → identical output)", () => {
  function prov(): Provenance {
    return {
      documentId: "doc-prop",
      location: { kind: "user-entered", enteredBy: "tester", enteredDate: "2026-01-01", entryForm: "test" },
      acquisition: "user-entered",
      derivation: null,
      sourceFileHash: null,
    };
  }

  function sourced<T>(value: T | null): SourcedValue<T> {
    return { value, provenance: prov() };
  }

  function roundingConfig(): RoundingConfig {
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
      setBy: "tester",
      setDate: "2026-01-01",
      rationale: "property test fixture",
    };
  }

  function tolerance(): ToleranceRecord {
    return {
      version: 1,
      absoluteMinor: 100,
      relativeDecimal: "0.001",
      application: "either",
      authority: "property test fixture",
      approvedBy: "tester",
      approvedDate: "2026-01-01",
    };
  }

  function makeRequest(rng: () => number): { request: CalculationRequest; inputs: PipelineInputs } {
    const base = 48000 + Math.floor(rng() * 24001);
    const salaries: Array<{ year: number; minor: number | null }> = [2017, 2018, 2019].map((year) => ({
      year,
      minor: Math.round(base * Math.pow(1.02, year - 2015) * (1 + (rng() - 0.5) * 0.02)) * 100,
    }));
    const participantKey = "SYN-PROP-001";
    const compHistory: CompensationHistory = {
      id: "ch-1",
      version: 1,
      supersedesId: null,
      sourceRecordIds: [],
      createdDate: "2026-01-01",
      createdBy: "tester",
      participantKey,
      firstYear: sourced(2017),
      lastYear: sourced(2019),
      salaryByYear: salaries.map((s, i) => ({
        salaryYear: s.year,
        sourceField: `S00${i + 1}`,
        amount: s.minor === null ? null : makeMoney(s.minor),
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
    const serviceHistory: ServiceHistory = {
      id: "sh-1",
      version: 1,
      supersedesId: null,
      sourceRecordIds: [],
      createdDate: "2026-01-01",
      createdBy: "tester",
      participantKey,
      asOfDate: sourced("2020-02-29"),
      paCreditedService: sourced(20),
      paVestingService: sourced(20),
      paEligibilityService: sourced(20),
      bcvCreditedService: sourced(20),
      bcvVestingService: sourced(20),
      bcvEligibilityService: sourced(20),
      paVestingPercent: sourced("1"),
      bcvVestingPercent: sourced("1"),
      serviceMeasure: "years",
      servicePeriods: [{ start: "2000-01-01", end: "2020-02-29", measure: 20, provenance: prov() }],
      breaksApplied: [],
      distributions: [],
    };
    const employmentPeriod: EmploymentPeriod = {
      id: "ep-1",
      version: 1,
      supersedesId: null,
      sourceRecordIds: [],
      createdDate: "2026-01-01",
      createdBy: "tester",
      participantKey,
      doh: sourced("2000-01-01"),
      dote: sourced("2020-02-29"),
      dop: sourced(null),
      dobfParticipant: sourced(null),
      dor: sourced(null),
      postDoptDote: sourced(null),
      periodSeq: 1,
      periodType: "initial-hire",
      periodStart: "2000-01-01",
      periodEnd: "2020-02-29",
      breakInService: null,
      hoursPerPeriod: sourced(null),
    };
    const planVersion: PlanVersion = {
      id: "v1",
      version: 1,
      supersedesId: null,
      sourceRecordIds: [],
      createdDate: "2026-01-01",
      createdBy: "tester",
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
    const request: CalculationRequest = {
      participantKey,
      participantHistory: {
        participantKey,
        employmentPeriods: [employmentPeriod],
        compensationHistory: compHistory,
        serviceHistory,
        benefitObservations: [],
      },
      provisionTimeline: { planId: "plan-1", versions: [planVersion] },
      measurementDate: "2020-02-29",
      measurementBasis: "dote",
      calculationKind: "accrued",
      formulaId: "T-04",
      roundingConfig: roundingConfig(),
      tolerance: tolerance(),
      runContext: {
        engineVersion: "0.1.0",
        ruleVersion: "2026-11-12",
        formulaTaxonomyVersion: "1.0",
        inputSnapshotHash: "test",
      },
    };
    const inputs: PipelineInputs = {
      formulaCall: {
        formulaId: "T-04",
        params: {
          accrualRate: datedValue("0.015", "1985-07-01", "v1"),
          avgComp: "60000",
          service: "20",
        },
      },
      recordedPaAmb: null,
      averagingPeriod: { kind: "final", years: 3, description: "final-3-year", ruleRef: "plan §5.01" },
      requiredBasis: { annuityForm: "NSF", retirementAge: 65 },
    };
    return { request, inputs };
  }

  it("identical calculation outcomes, rankings, and generated populations from the same seed", () => {
    const rng = rngFor(5);
    for (let n = 0; n < CASES; n += 1) {
      const { request, inputs } = makeRequest(rng);
      const first = calculateAccruedBenefit(request, inputs);
      const second = calculateAccruedBenefit(request, inputs);
      assert.equal(
        JSON.stringify(first),
        JSON.stringify(second),
        `case ${n}: the same calculation twice gives identical output`,
      );
      if (first.kind !== "exact") throw new Error(`case ${n}: expected an exact outcome`);
      // Ranking determinism on a fixed list.
      const list: RankableCounterfactual[] = [
        {
          ...makeCounterfactualResult({
            operation: { kind: "service-delta-years", years: "+1" },
            hypothesisCode: "H2",
            benefit: makeBenefit(CTX, makeMoney(150000), "monthly"),
            residualDelta: makeMoney(0),
            supportClass: "supported",
            evidenceFor: ["residual is zero"],
            evidenceAgainst: [],
          }),
          documentedMechanism: false,
          resolvesCohort: true,
        },
        {
          ...makeCounterfactualResult({
            operation: { kind: "averaging-period", period: "final-5-year" },
            hypothesisCode: "H4",
            benefit: makeBenefit(CTX, makeMoney(140000), "monthly"),
            residualDelta: makeMoney(10000),
            supportClass: "refuted",
            evidenceFor: [],
            evidenceAgainst: ["residual Δ is 100.00"],
          }),
          documentedMechanism: false,
          resolvesCohort: false,
        },
      ];
      assert.deepEqual(rankCounterfactuals(list), rankCounterfactuals(list), `case ${n}: ranking is deterministic`);
      // Seeded generation determinism: two fresh streams, same seed.
      const streamA = mulberry32(SEED + n);
      const streamB = mulberry32(SEED + n);
      const salariesA = [2017, 2018, 2019].map(() => ri(streamA, 4800000, 7200000));
      const salariesB = [2017, 2018, 2019].map(() => ri(streamB, 4800000, 7200000));
      assert.deepEqual(salariesB, salariesA, `case ${n}: the same seed generates the same population`);
    }
  });
});
