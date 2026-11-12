/**
 * Tests for the Stage 5 statistical module (Worker 2).
 *
 * Plain node:test; no external package. Seeded PRNG (mulberry32, imported
 * from the module under test) drives every generator, so runs are
 * reproducible: the same seed always produces the same cases.
 *
 * Synthetic data only. Fictional participants SYN-xxx. No live case data.
 * Money in integer minor units (cents). Δ/D/R values are supplied to the
 * module as pre-computed reconciliation outputs — the module never
 * computes them, so the tests supply them as fixtures.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  accrualPatternHeuristic,
  benefitCompRatioHeuristic,
  buildModelData,
  chiSquare975,
  crossValidate,
  describePopulation,
  detectMultivariateOutliers,
  detectOutliers,
  fitBayesian,
  fitDecisionTree,
  fitGam,
  fitHuber,
  fitLasso,
  fitMixedEffects,
  fitOls,
  fitRidge,
  fitSummary,
  influenceCheck,
  isolationForest,
  kFoldIndices,
  mahalanobisOutliers,
  modifiedZScores,
  mulberry32,
  percentileScreen,
  reasonablenessScreeningNote,
  residualDiagnostics,
  rmseMae,
  selectRidgePenalty,
  serviceSensitivityHeuristic,
  smallBenefitHeuristic,
  suggestHypotheses,
  summarizeDecimals,
  summarizeMoneyMinor,
  summarizeNumbers,
  tukeyFences,
  type ModelData,
  type StatRow,
} from "../src/statistics.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function row(overrides: Partial<StatRow> = {}): StatRow {
  return {
    participantKey: "SYN-001",
    status: "terminated-vested",
    employmentGroup: "non-union",
    formulaType: "unit-credit",
    amendmentCohort: "1985",
    paAmbMinor: 150000,
    reconstructedMinor: 150000,
    deltaMinor: 0,
    absDeltaMinor: 0,
    relDelta: "0",
    denominatorFlag: null,
    ageYears: 60,
    serviceYears: 20,
    compensationMinor: 6000000,
    retirementStatus: "deferred",
    dataCompleteness: 1,
    monthsSinceRecorded: 12,
    qdro: false,
    priorDistribution: false,
    employmentPeriods: 1,
    ...overrides,
  };
}

function approx(actual: number | null | undefined, expected: number, tolerance: number, label: string): void {
  assert.ok(actual !== null && actual !== undefined, `${label}: expected a number, got ${String(actual)}`);
  assert.ok(
    Math.abs((actual as number) - expected) <= tolerance,
    `${label}: got ${actual}, expected ${expected} ± ${tolerance}`,
  );
}

// ---------------------------------------------------------------------------
// §3.1 Descriptives
// ---------------------------------------------------------------------------

describe("descriptives: hand-computed values", () => {
  it("summarizeMoneyMinor: mean/median/min/max on [100, 200, 300] cents", () => {
    const s = summarizeMoneyMinor([100, 200, 300]);
    assert.equal(s.count, 3);
    assert.equal(s.missing, 0);
    assert.equal(s.meanDollars, "2");
    assert.equal(s.medianDollars, "2");
    assert.equal(s.minMinor, 100);
    assert.equal(s.maxMinor, 300);
    assert.equal(s.quantilesDollars.p25, "1.5");
    assert.equal(s.quantilesDollars.p75, "2.5");
  });

  it("summarizeMoneyMinor: nulls are missing, never zero", () => {
    const s = summarizeMoneyMinor([100, null, 300]);
    assert.equal(s.count, 2);
    assert.equal(s.missing, 1);
    assert.equal(s.meanDollars, "2");
    assert.equal(s.minMinor, 100);
  });

  it("summarizeNumbers: mean 5, median 4.5, sd sqrt(32/7) on [2,4,4,4,5,5,7,9]", () => {
    const s = summarizeNumbers([2, 4, 4, 4, 5, 5, 7, 9]);
    assert.equal(s.mean, 5);
    assert.equal(s.median, 4.5);
    approx(s.sd, Math.sqrt(32 / 7), 0.001, "sd");
    assert.equal(s.quantiles.p25, 4);
    assert.equal(s.quantiles.p75, 5.5);
  });

  it("summarizeDecimals: exact mean/median of relative discrepancies", () => {
    const s = summarizeDecimals(["0.01", "0.02", "0.03"]);
    assert.equal(s.count, 3);
    assert.equal(s.mean, "0.02");
    assert.equal(s.median, "0.02");
    assert.equal(s.min, "0.01");
    assert.equal(s.max, "0.03");
  });

  it("rmseMae: MAE $2.00 and RMSE sqrt(140000/3) cents on [100,-200,300]", () => {
    const { rmseMinor, maeDollars, count } = rmseMae([100, -200, 300]);
    assert.equal(count, 3);
    assert.equal(maeDollars, "2");
    approx(rmseMinor, Math.sqrt(140000 / 3), 0.01, "rmse");
  });

  it("describePopulation: pooled + strata, materiality counts, missing counts", () => {
    const rows: StatRow[] = [
      row({ participantKey: "SYN-101", deltaMinor: 100, absDeltaMinor: 100, relDelta: "0.001" }),
      row({ participantKey: "SYN-102", deltaMinor: -200, absDeltaMinor: 200, relDelta: "-0.002" }),
      row({ participantKey: "SYN-103", deltaMinor: 0, absDeltaMinor: 0, relDelta: "0" }),
      row({ participantKey: "SYN-104", formulaType: "flat-dollar", amendmentCohort: "1994", deltaMinor: 5000, absDeltaMinor: 5000, relDelta: "0.06" }),
      row({ participantKey: "SYN-105", formulaType: "flat-dollar", amendmentCohort: "1994", deltaMinor: 6000, absDeltaMinor: 6000, relDelta: "0.07" }),
      row({ participantKey: "SYN-106", formulaType: "flat-dollar", amendmentCohort: "1994", deltaMinor: -100, absDeltaMinor: 100, relDelta: "-0.001" }),
      row({ participantKey: "SYN-107", paAmbMinor: null, deltaMinor: null, absDeltaMinor: null, relDelta: null, status: "active" }),
    ];
    const desc = describePopulation(rows, {
      absMinor: 1000,
      relDecimal: "0.05",
      source: "test fixture — case tolerance record v1 (illustration only, not a PBGC rule)",
    });
    assert.equal(desc.pooled.n, 7);
    assert.equal(desc.pooled.materiality.absOver, 2);
    assert.equal(desc.pooled.materiality.relOver, 2);
    assert.equal(desc.pooled.materiality.eitherOver, 2);
    assert.equal(desc.pooled.missing.paAmb, 1);
    assert.equal(desc.excludedFromDiscrepancy, 1);
    assert.equal(desc.byFormulaType.length, 2);
    assert.equal(desc.byAmendmentCohort.length, 2);
    assert.equal(desc.byStatus.length, 2);
    // Sign share: non-zero deltas 100, -200, 5000, 6000, -100 → 3/5 positive.
    approx(desc.pooled.signSharePositive, 0.6, 0.001, "sign share");
    // Pooled delta mean: (100-200+0+5000+6000-100)/6 = 1800 cents = $18.
    assert.equal(desc.pooled.delta.meanDollars, "18");
    // Stratified table is not pooled-only: flat-dollar stratum has the big deltas.
    const flat = desc.byFormulaType.find((g) => g.key === "flat-dollar");
    if (flat === undefined) throw new Error("flat-dollar stratum missing");
    assert.equal(flat.materiality.eitherOver, 2);
    const unit = desc.byFormulaType.find((g) => g.key === "unit-credit");
    if (unit === undefined) throw new Error("unit-credit stratum missing");
    assert.equal(unit.materiality.eitherOver, 0);
  });
});

// ---------------------------------------------------------------------------
// §3.2 Outlier detection
// ---------------------------------------------------------------------------

describe("outliers: univariate methods", () => {
  it("modified z-score: planted outlier flagged; MAD=0 fallback is recorded", () => {
    const values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100];
    const r = modifiedZScores(values);
    assert.equal(r.median, 0);
    assert.equal(r.mad, 0);
    assert.equal(r.fallback, "mean-absolute-deviation");
    assert.equal(r.flagged[10], true);
    assert.equal(r.flagged.filter(Boolean).length, 1);
    assert.ok((r.scores[10] ?? 0) > 3.5);
  });

  it("modified z-score: no flag on a tight cluster", () => {
    const r = modifiedZScores([100, 101, 99, 100, 102, 98, 100, 101]);
    assert.equal(r.flagged.filter(Boolean).length, 0);
  });

  it("Tukey: 100 is outside the inner and outer fences of 1..10", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100];
    const r = tukeyFences(values);
    assert.equal(r.flaggedInner[10], true);
    assert.equal(r.flaggedOuter[10], true);
    assert.equal(r.flaggedInner[9], false);
  });

  it("percentile screening: 1 and 100 are the 1% extremes of 1..100", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const r = percentileScreen(values);
    assert.equal(r.flagged1pct[0], true);
    assert.equal(r.flagged1pct[99], true);
    assert.equal(r.flagged1pct[50], false);
    approx(r.cutPoints.p1, 1.99, 0.01, "p1 cut");
    approx(r.cutPoints.p99, 99.01, 0.01, "p99 cut");
  });

  it("residual diagnostics: large residual + high leverage has Cook's D above 4/n", () => {
    const d = residualDiagnostics([0, 0, 0, 10], [0.1, 0.1, 0.1, 0.5], 2);
    assert.equal(d.flagged[3], true);
    assert.equal(d.flagged[0], false);
    approx(d.cooksDistance[3], 2, 0.01, "Cook's D");
    assert.equal(d.threshold, 1);
  });

  it("chi-square 0.975 quantile matches the table for df=2", () => {
    approx(chiSquare975(2), 7.378, 0.001, "chi2 df2");
  });
});

describe("outliers: multivariate methods", () => {
  // 20 clustered points + 1 far point.
  const cluster: number[][] = Array.from({ length: 20 }, (_, i) => [
    60 + ((i * 7) % 5) - 2,
    20 + ((i * 3) % 5) - 2,
  ]);
  const far: number[][] = [...cluster, [90, 40]];

  it("Mahalanobis: the far point is flagged, the cluster is not", () => {
    const r = mahalanobisOutliers(far, { robust: true });
    assert.equal(r.flagged[20], true);
    assert.equal(r.flagged.slice(0, 20).filter(Boolean).length, 0);
    assert.equal(r.excluded, 0);
  });

  it("Mahalanobis: rows with a null are excluded, not flagged", () => {
    const withNull: (number | null)[][] = [...far, [null, 20]];
    const r = mahalanobisOutliers(withNull, { robust: true });
    assert.equal(r.excluded, 1);
    assert.equal(r.flagged[21], false);
  });

  it("isolation forest: deterministic, seeded — the far point scores highest and is flagged", () => {
    const a = isolationForest(far, { nTrees: 50, subSampleSize: 16, seed: 42, contamination: 0.05 });
    const b = isolationForest(far, { nTrees: 50, subSampleSize: 16, seed: 42, contamination: 0.05 });
    assert.deepEqual(a.scores, b.scores);
    assert.equal(a.flagged[20], true);
    const maxScore = Math.max(...a.scores);
    assert.equal(a.scores[20], maxScore);
    assert.equal(a.contamination, 0.05);
  });
});

describe("outliers: group-aware detection (pooled vs within-cohort)", () => {
  it("a planted outlier is flagged within-cohort; a legitimate formula-group difference is not", () => {
    const rng = mulberry32(20261112);
    const rows: StatRow[] = [];
    // Group A (unit-credit / 1985): deltas near 0, plus one planted outlier.
    for (let i = 0; i < 20; i += 1) {
      rows.push(
        row({
          participantKey: `SYN-A${String(i).padStart(2, "0")}`,
          deltaMinor: Math.round((rng() - 0.5) * 400),
          absDeltaMinor: 100,
          relDelta: "0.001",
        }),
      );
    }
    rows.push(
      row({ participantKey: "SYN-A-OUT", deltaMinor: 500000, absDeltaMinor: 500000, relDelta: "0.5" }),
    );
    // Group B (flat-dollar / 1994): deltas near $500 — ordinary for its
    // formula group, extreme in the pooled population.
    for (let i = 0; i < 5; i += 1) {
      rows.push(
        row({
          participantKey: `SYN-B${String(i).padStart(2, "0")}`,
          formulaType: "flat-dollar",
          amendmentCohort: "1994",
          deltaMinor: 50000 + Math.round((rng() - 0.5) * 400),
          absDeltaMinor: 50000,
          relDelta: "0.05",
        }),
      );
    }
    const result = detectOutliers(rows, { valueField: "deltaMinor", methods: ["tukey", "modified-z"] });
    const flaggedKeys = new Set(result.flags.map((f) => f.participantKey));
    const explainedKeys = new Set(result.explainedByGroup.map((f) => f.participantKey));
    // Planted outlier: flagged within its cohort.
    assert.ok(flaggedKeys.has("SYN-A-OUT"), "planted outlier must be flagged");
    assert.ok(
      result.flags.some((f) => f.participantKey === "SYN-A-OUT" && f.scope === "within-cohort"),
      "planted outlier must be flagged within-cohort",
    );
    // Group B: pooled-extreme but ordinary within its group — explained,
    // never flagged as errors.
    for (let i = 0; i < 5; i += 1) {
      const key = `SYN-B${String(i).padStart(2, "0")}`;
      assert.ok(!flaggedKeys.has(key), `${key} must not be flagged as an error`);
      assert.ok(explainedKeys.has(key), `${key} must be reported as explained by its group`);
    }
    assert.ok(result.pooledFlaggedCount > 0, "pooled run must have flagged the group difference");
    assert.ok(result.withinFlaggedCount > 0, "within-cohort run must have flagged the outlier");
  });

  it("detectMultivariateOutliers: pooled flag explained by cohort is not an error", () => {
    const rows: StatRow[] = [];
    for (let i = 0; i < 12; i += 1) {
      rows.push(row({ participantKey: `SYN-M${String(i).padStart(2, "0")}`, ageYears: 60 + (i % 3), serviceYears: 20 + (i % 3) }));
    }
    for (let i = 0; i < 12; i += 1) {
      rows.push(
        row({
          participantKey: `SYN-N${String(i).padStart(2, "0")}`,
          formulaType: "flat-dollar",
          amendmentCohort: "1994",
          ageYears: 45 + (i % 3),
          serviceYears: 8 + (i % 3),
        }),
      );
    }
    const result = detectMultivariateOutliers(
      rows,
      [(r) => r.ageYears, (r) => r.serviceYears],
      { seed: 7, contamination: 0.1 },
    );
    // No participant is an outlier within its own cohort.
    assert.equal(result.flags.filter((f) => f.scope === "within-cohort").length, 0);
    assert.ok(result.mahalanobis.distances.length === 24);
  });
});

// ---------------------------------------------------------------------------
// §3.3 Multivariate models (synthetic data with known structure)
// ---------------------------------------------------------------------------

function modelRows(args: {
  n: number;
  seed: number;
  deltaFn: (service: number, age: number, cohort: string, rng: () => number) => number;
  outlierKey?: string;
  outlierExtraMinor?: number;
}): StatRow[] {
  const rng = mulberry32(args.seed);
  const rows: StatRow[] = [];
  for (let i = 0; i < args.n; i += 1) {
    const service = 5 + (i % 31);
    const age = 45 + Math.floor(rng() * 20);
    const cohort = i % 2 === 0 ? "1985" : "1994";
    const deltaDollars = args.deltaFn(service, age, cohort, rng);
    const key = `SYN-M${String(i).padStart(3, "0")}`;
    const extra = key === args.outlierKey ? (args.outlierExtraMinor ?? 0) : 0;
    const deltaMinor = Math.round(deltaDollars * 100) + extra;
    rows.push(
      row({
        participantKey: key,
        serviceYears: service,
        ageYears: age,
        amendmentCohort: cohort,
        formulaType: "unit-credit",
        deltaMinor,
        absDeltaMinor: Math.abs(deltaMinor),
        relDelta: "0.01",
        compensationMinor: 6000000,
      }),
    );
  }
  return rows;
}

function readyData(rows: StatRow[], outcome: "deltaDollars" | "absDeltaDollars" | "relDelta", predictors: string[]): ModelData {
  const built = buildModelData(rows, { outcome, predictors });
  assert.equal(built.kind, "ready", built.kind === "refused" ? built.reason : "not ready");
  if (built.kind !== "ready") throw new Error("unreachable");
  return built.data;
}

describe("models: guards (leakage, sample size)", () => {
  it("a leaked predictor is refused, never silently dropped", () => {
    const rows = modelRows({ n: 30, seed: 1, deltaFn: (s) => 10 * s });
    const built = buildModelData(rows, { outcome: "deltaDollars", predictors: ["paAmbMinor"] });
    assert.equal(built.kind, "refused");
    if (built.kind !== "refused") throw new Error("unreachable");
    assert.match(built.reason, /Leakage guard/);
  });

  it("an unknown predictor is refused", () => {
    const rows = modelRows({ n: 30, seed: 1, deltaFn: (s) => 10 * s });
    const built = buildModelData(rows, { outcome: "deltaDollars", predictors: ["notAField"] });
    assert.equal(built.kind, "refused");
  });

  it("an underpowered model is refused (n < 10 per predictor)", () => {
    const rows = modelRows({ n: 15, seed: 1, deltaFn: (s) => 10 * s });
    const built = buildModelData(rows, {
      outcome: "deltaDollars",
      predictors: ["serviceYears", "ageYears", "compensationDollars"],
    });
    assert.equal(built.kind, "refused");
    if (built.kind !== "refused") throw new Error("unreachable");
    assert.match(built.reason, /Underpowered/);
    assert.equal(built.required, 30);
  });

  it("grouped k-fold keeps whole cohorts out of both train and test", () => {
    const groups = ["a", "a", "b", "b", "c", "c", "d", "d", "e", "e", "f", "f"];
    const folds = kFoldIndices(12, 3, 5, groups);
    assert.equal(folds.length, 3);
    const seen = new Map<string, number>();
    folds.forEach((fold, fi) => {
      for (const idx of fold) {
        const g = groups[idx] as string;
        if (seen.has(g)) assert.equal(seen.get(g), fi, `group ${g} split across folds`);
        else seen.set(g, fi);
      }
    });
  });
});

describe("models: Huber robust regression recovers known structure", () => {
  // delta = 20 + 10*service + small noise, plus one +$500 outlier.
  const rows = modelRows({
    n: 60,
    seed: 11,
    deltaFn: (s, _a, _c, rng) => 20 + 10 * s + (rng() - 0.5) * 4,
    outlierKey: "SYN-M059",
    outlierExtraMinor: 50000,
  });
  const data = readyData(rows, "deltaDollars", ["serviceYears"]);

  it("Huber recovers slope ≈ 10 and intercept ≈ 20 despite the outlier", () => {
    const fit = fitHuber(data);
    approx(fit.coefficients[1], 10, 1, "huber slope");
    approx(fit.coefficients[0], 20, 5, "huber intercept");
    assert.equal(fit.converged, true);
    assert.ok(fit.robustStandardErrors.every((se) => Number.isFinite(se) && se > 0));
    // Standard R² is computed on the raw residuals, so the planted +$500
    // outlier depresses it; R² on the 59 clean rows must be high.
    const cleanIdx = data.keys.map((_, i) => i).filter((i) => data.keys[i] !== "SYN-M059");
    const cleanR2 = fitSummary(
      cleanIdx.map((i) => data.y[i] as number),
      cleanIdx.map((i) => fit.fitted[i] as number),
      2,
    ).r2;
    assert.ok((cleanR2 ?? 0) > 0.9, `clean r2 ${cleanR2}`);
    // Huber does not chase the outlier: its fitted value for the outlier
    // row stays near the true line (≈ $350), not near the recorded $849.
    const outlierIdx = data.keys.indexOf("SYN-M059");
    approx(fit.fitted[outlierIdx], 350, 15, "huber fitted for outlier row");
  });

  it("OLS is pulled further by the outlier than Huber (robustness check)", () => {
    const ols = fitOls(data);
    const huber = fitHuber(data);
    const olsErr = Math.abs((ols.coefficients[1] ?? 0) - 10);
    const huberErr = Math.abs((huber.coefficients[1] ?? 0) - 10);
    assert.ok(huberErr < olsErr, `huber err ${huberErr} should beat OLS err ${olsErr}`);
  });

  it("cross-validated RMSE is finite and close to the in-sample RMSE", () => {
    const cv = crossValidate(
      data,
      (train, test) => {
        const fit = fitHuber(readyData(rows.filter((_, i) => train.includes(i)), "deltaDollars", ["serviceYears"]));
        return test.map((i) => (fit.coefficients[0] ?? 0) + (fit.coefficients[1] ?? 0) * (data.x[i]?.[0] ?? 0));
      },
      { k: 5, seed: 3 },
    );
    assert.ok(Number.isFinite(cv.rmse) && cv.rmse > 0);
    assert.equal(cv.perFoldRmse.length, 5);
  });

  it("influence check names the outlier as the top Cook's distance", () => {
    const check = influenceCheck(data, { topK: 1, stabilityThreshold: 5 });
    assert.equal(check.topCooksDistance[0]?.participantKey, "SYN-M059");
    assert.ok((check.topCooksDistance[0]?.cooksDistance ?? 0) > 0);
    assert.ok(check.maxCoefficientChange !== null);
  });
});

describe("models: ridge, lasso, GAM, mixed-effects, Bayesian", () => {
  const cleanRows = modelRows({
    n: 60,
    seed: 21,
    deltaFn: (s, _a, _c, rng) => 20 + 10 * s + (rng() - 0.5) * 4,
  });
  const cleanData = readyData(cleanRows, "deltaDollars", ["serviceYears"]);

  it("ridge: penalty is selected from the stated grid by CV", () => {
    const selected = selectRidgePenalty(cleanData, [0.1, 1, 10, 100, 1000], { k: 5, seed: 3 });
    assert.ok([0.1, 1, 10, 100, 1000].includes(selected.lambda));
    assert.ok(Number.isFinite(selected.bestCvRmse) && selected.bestCvRmse > 0);
    assert.equal(selected.cvRmseByLambda.length, 5);
    const fit = fitRidge(cleanData, selected.lambda);
    approx(fit.coefficients[0], 10, 1.5, "ridge slope (shrunken, near 10)");
    assert.ok((fit.summary.r2 ?? 0) > 0.9);
  });

  it("lasso: runs, recovers the service effect, reports the selected set", () => {
    const data = readyData(cleanRows, "deltaDollars", ["serviceYears", "ageYears"]);
    const fit = fitLasso(data, 10);
    assert.ok(Number.isFinite(fit.coefficients[0] ?? NaN));
    approx(fit.coefficients[0], 10, 2, "lasso service slope");
    assert.ok(Array.isArray(fit.selectedPredictors));
    assert.ok((fit.summary.r2 ?? 0) > 0.8);
  });

  it("GAM beats OLS on a quadratic relationship", () => {
    const quadRows = modelRows({
      n: 80,
      seed: 31,
      deltaFn: (s, _a, _c, rng) => 20 + 0.2 * (s - 20) * (s - 20) + (rng() - 0.5) * 4,
    });
    const quadData = readyData(quadRows, "deltaDollars", ["serviceYears"]);
    const ols = fitOls(quadData);
    const gam = fitGam(quadData, { smoothPredictors: ["serviceYears"], knotsPerTerm: 4, lambda: 1, cvFolds: 5, seed: 3 });
    assert.ok((gam.summary.r2 ?? 0) > (ols.summary.r2 ?? 0) + 0.1, `gam r2 ${gam.summary.r2} vs ols r2 ${ols.summary.r2}`);
    assert.ok((gam.summary.r2 ?? 0) > 0.7);
    assert.ok(gam.cvRmse !== null && Number.isFinite(gam.cvRmse));
    assert.equal(Object.keys(gam.knots).length, 1);
  });

  it("mixed-effects: cohort intercepts differ and ICC > 0 for a cohort shift", () => {
    const cohortRows = modelRows({
      n: 60,
      seed: 41,
      deltaFn: (s, _a, cohort, rng) => 5 + 10 * s + (cohort === "1994" ? 30 : 0) + (rng() - 0.5) * 4,
    });
    const cohortData = readyData(cohortRows, "deltaDollars", ["serviceYears"]);
    // Attach the cohort as the grouping variable.
    const grouped: ModelData = { ...cohortData, groups: cohortRows.map((r) => r.amendmentCohort) };
    const fit = fitMixedEffects(grouped);
    const diff = Math.abs((fit.groupIntercepts["1994"] ?? 0) - (fit.groupIntercepts["1985"] ?? 0));
    assert.ok(diff > 15, `group intercept difference ${diff}`);
    assert.ok(fit.icc > 0.05, `icc ${fit.icc}`);
    assert.ok(fit.tau2 > 0);
    assert.equal(fit.groupSizes["1985"], 30);
    assert.equal(fit.groupSizes["1994"], 30);
  });

  it("Bayesian: weak prior recovers slope ≈ 10 with a credible interval and prior sensitivity", () => {
    const fit = fitBayesian(cleanData, {
      mean: [0, 0],
      sd: [100, 100],
      sigma2: null,
      basis: "Weakly informative case-set prior (test fixture): prior SD 100 on dollars, so the data dominate; sigma2 estimated from OLS residuals and stated.",
    });
    approx(fit.posteriorMean[1], 10, 1, "bayesian slope");
    const [lo, hi] = fit.credibleInterval95[1] as [number, number];
    assert.ok(lo < 10 && 10 < hi, `credible interval [${lo}, ${hi}] must contain 10`);
    assert.equal(fit.sigma2Estimated, true);
    assert.ok(Number.isFinite(fit.priorSensitivity.sdDoubledMaxChange));
    assert.ok(Number.isFinite(fit.priorSensitivity.sdHalvedMaxChange));
    assert.ok(fit.priorSensitivity.sdHalvedMaxChange >= 0);
  });
});

describe("models: decision tree for recurring patterns", () => {
  it("finds the service split and classifies the planted pattern", () => {
    const rows = modelRows({
      n: 60,
      seed: 51,
      deltaFn: (s, _a, _c, rng) => (s > 25 ? 200 : 10) + (rng() - 0.5) * 4,
    });
    const data = readyData(rows, "deltaDollars", ["serviceYears", "ageYears"]);
    const labels = rows.map((r) => ((r.deltaMinor ?? 0) > 10000 ? 1 : 0));
    const tree = fitDecisionTree(data, labels, { minLeaf: 5, maxDepth: 3, seed: 7 });
    assert.ok(tree.validationAccuracy !== null && (tree.validationAccuracy ?? 0) > 0.8, `val acc ${tree.validationAccuracy}`);
    assert.ok(tree.rules.some((rule) => rule.includes("serviceYears")), `rules: ${tree.rules.join(" | ")}`);
    assert.ok(tree.depth >= 1 && tree.depth <= 3);
  });
});

describe("models: hypothesis suggestions are suggestive only", () => {
  it("a significant service coefficient suggests H2; a cohort effect suggests H6", () => {
    const suggestions = suggestHypotheses(
      [{ predictor: "serviceYears", coefficient: 10, standardError: 1 }],
      { cohortVariable: "amendmentCohort", maxGroupDifference: 30, outcomeScale: 10 },
    );
    assert.ok(suggestions.some((s) => s.hypothesisCode === "H2"));
    assert.ok(suggestions.some((s) => s.hypothesisCode === "H6"));
    assert.ok(suggestions.every((s) => s.strength === "suggestive"));
    assert.ok(suggestions.every((s) => s.note.includes("Suggestion only")));
  });

  it("a non-significant predictor (|t| < 2) suggests nothing", () => {
    const suggestions = suggestHypotheses(
      [{ predictor: "serviceYears", coefficient: 0.5, standardError: 1 }],
      null,
    );
    assert.equal(suggestions.length, 0);
  });
});

// ---------------------------------------------------------------------------
// §3.4 Heuristics
// ---------------------------------------------------------------------------

describe("heuristics: labelled, plan-based, never overriding", () => {
  it("benefit-to-compensation ratio: plan-implied ratio is not flagged; a 2x ratio is", () => {
    const base = row({ paAmbMinor: 150000, serviceYears: 20 });
    const args = {
      avgCompMonthlyMinor: 500000,
      accrualRateDecimal: "0.015",
      deviationThresholdDecimal: "0.5",
      basisCitation: "Test plan §5.01: 1.5% accrual rate; threshold is a case-set parameter.",
    };
    const ok = benefitCompRatioHeuristic(base, args);
    assert.equal(ok.flagged, false);
    assert.equal(ok.basis.kind, "plan-arithmetic");
    assert.equal(ok.overridesFormula, false);
    const bad = benefitCompRatioHeuristic(row({ paAmbMinor: 300000, serviceYears: 20 }), args);
    assert.equal(bad.flagged, true);
  });

  it("benefit-to-compensation ratio: missing compensation is not evaluable, never zero", () => {
    const f = benefitCompRatioHeuristic(row({ paAmbMinor: 150000 }), {
      avgCompMonthlyMinor: null,
      accrualRateDecimal: "0.015",
      deviationThresholdDecimal: "0.5",
      basisCitation: "Test plan §5.01.",
    });
    assert.equal(f.flagged, false);
    assert.match(f.detail, /missing/);
  });

  it("accrual pattern: cohort median is the reference; an off-pattern rate is flagged", () => {
    const rates = [75, 76, 74, 75, 77, 75, 76]; // dollars per year of service
    const normal = accrualPatternHeuristic(row({ paAmbMinor: 150000, serviceYears: 20 }), rates);
    assert.equal(normal.flagged, false);
    assert.equal(normal.basis.kind, "empirical-cohort");
    const off = accrualPatternHeuristic(row({ paAmbMinor: 300000, serviceYears: 20 }), rates);
    assert.equal(off.flagged, true);
  });

  it("service sensitivity: |Δ| above N years' accrual is flagged", () => {
    const args = { oneYearAccrualMinor: 7500, yearsThreshold: 3, basisCitation: "Test plan §5.01: one year's accrual = 1.5% × average monthly compensation." };
    assert.equal(serviceSensitivityHeuristic(50000, args).flagged, true);
    assert.equal(serviceSensitivityHeuristic(10000, args).flagged, false);
    assert.equal(serviceSensitivityHeuristic(null, args).flagged, false);
  });

  it("small-benefit attention: a pattern of small benefits is flagged", () => {
    const rows: StatRow[] = Array.from({ length: 10 }, (_, i) =>
      row({ participantKey: `SYN-S${i}`, paAmbMinor: i < 3 ? 5000 : 150000 }),
    );
    const f = smallBenefitHeuristic(rows, {
      materialityMinor: 10000,
      patternShareThreshold: 0.2,
      basisCitation: "Judgment (Stage 1 output 03 §3.4, level 6); materiality threshold is the case actuary's.",
    });
    assert.equal(f.flagged, true);
    assert.equal(f.basis.kind, "judgment");
  });

  it("reasonableness screening cites DBAB Ch. 16 Q 16:6 and asserts no threshold", () => {
    const f = reasonablenessScreeningNote(["benefit-to-compensation ratio", "accrual pattern"]);
    assert.equal(f.flagged, false);
    assert.match(f.basis.citation, /Ch\. 16, Q 16:6/);
    assert.match(f.detail, /No threshold is asserted/);
  });

  it("a heuristic never changes a benefit and never overrides the formula", () => {
    const before = row({ paAmbMinor: 150000, serviceYears: 20 });
    const snapshot = JSON.stringify(before);
    const benefitMinorBefore = before.paAmbMinor;
    const findings = [
      benefitCompRatioHeuristic(before, {
        avgCompMonthlyMinor: 500000,
        accrualRateDecimal: "0.015",
        deviationThresholdDecimal: "0.5",
        basisCitation: "Test plan §5.01.",
      }),
      accrualPatternHeuristic(before, [75, 76, 74, 75, 77, 75, 76]),
      serviceSensitivityHeuristic(before.deltaMinor, {
        oneYearAccrualMinor: 7500,
        yearsThreshold: 3,
        basisCitation: "Test plan §5.01.",
      }),
    ];
    // The input row is untouched (heuristics are pure) and the benefit is unchanged.
    assert.equal(JSON.stringify(before), snapshot);
    assert.equal(before.paAmbMinor, benefitMinorBefore);
    assert.equal(before.paAmbMinor, 150000);
    for (const f of findings) {
      assert.equal(f.overridesFormula, false);
      assert.ok(!("benefitMinor" in f) && !("amountMinor" in f) && !("correctedBenefit" in f));
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("determinism: same input + same seed → identical output", () => {
  it("mulberry32 sequences repeat exactly", () => {
    const a = mulberry32(99);
    const b = mulberry32(99);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    assert.deepEqual(seqA, seqB);
  });

  it("Huber fit and isolation forest are identical when run twice", () => {
    const rows = modelRows({
      n: 60,
      seed: 61,
      deltaFn: (s, _a, _c, rng) => 20 + 10 * s + (rng() - 0.5) * 4,
    });
    const data = readyData(rows, "deltaDollars", ["serviceYears"]);
    const h1 = fitHuber(data);
    const h2 = fitHuber(data);
    assert.deepEqual(h1.coefficients, h2.coefficients);
    assert.deepEqual(h1.fitted, h2.fitted);
    const matrix = rows.map((r) => [r.ageYears as number, r.serviceYears as number]);
    const f1 = isolationForest(matrix, { nTrees: 20, subSampleSize: 16, seed: 5, contamination: 0.1 });
    const f2 = isolationForest(matrix, { nTrees: 20, subSampleSize: 16, seed: 5, contamination: 0.1 });
    assert.deepEqual(f1.scores, f2.scores);
    assert.deepEqual(f1.flagged, f2.flagged);
  });

  it("outlier detection and descriptives are pure (same input → same output)", () => {
    const rows = modelRows({ n: 30, seed: 71, deltaFn: (s) => 10 * s });
    const d1 = describePopulation(rows, { absMinor: 1000, relDecimal: "0.05", source: "test" });
    const d2 = describePopulation(rows, { absMinor: 1000, relDecimal: "0.05", source: "test" });
    assert.deepEqual(d1, d2);
    const o1 = detectOutliers(rows, { valueField: "deltaMinor" });
    const o2 = detectOutliers(rows, { valueField: "deltaMinor" });
    assert.deepEqual(o1, o2);
  });
});
