// Stage 7 reproducibility — statistical module determinism (NEW file).
//
// Re-runs every stochastic element of src/statistics.ts on the same
// synthetic 100-participant population (from 03-repro-population.mjs):
// isolation forest, multivariate outliers, Bayesian fit, GAM, k-fold CV
// (explicit and default seed), decision tree (explicit and default
// seed), mixed-effects, Huber, ridge, lasso, OLS. Each is run twice in
// this process and once in a fresh child process; outputs are compared
// as canonical JSON. Seeded PRNGs must reproduce exactly; any unseeded
// randomness is a defect.
//
// Usage:
//   node stage7/03-repro-stats.mjs
//   node stage7/03-repro-stats.mjs --single <dir>   # one run into <dir>
//
// Exit 0 = identical everywhere. Exit 1 = any diff. Synthetic data only.
// No source file is edited.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildModelData,
  crossValidate,
  detectMultivariateOutliers,
  fitBayesian,
  fitDecisionTree,
  fitGam,
  fitHuber,
  fitLasso,
  fitMixedEffects,
  fitOls,
  fitRidge,
  isolationForest,
  kFoldIndices,
  mulberry32,
  seededShuffle,
} from "../dist/src/statistics.js";
import { buildPopulation100 } from "./03-repro-population.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const SEED = 20261112;

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

function runStatsOnce() {
  const { rows } = buildPopulation100();
  const out = {};
  const matrix = rows.map((r) => [r.deltaMinor ?? 0, r.ageYears ?? 0, r.serviceYears ?? 0, (r.compensationMinor ?? 0) / 100]);

  // Isolation forest: explicit seed, twice in a row (same call, same seed).
  out.isolationForestSeeded = isolationForest(matrix, { nTrees: 50, subSampleSize: 32, seed: SEED, contamination: 0.05 });
  out.isolationForestSeededAgain = isolationForest(matrix, { nTrees: 50, subSampleSize: 32, seed: SEED, contamination: 0.05 });
  // Multivariate outliers (isolation forest inside, explicit seed).
  out.multivariate = detectMultivariateOutliers(rows, [(r) => r.deltaMinor, (r) => r.ageYears, (r) => r.serviceYears], { seed: SEED, contamination: 0.05, nTrees: 50, subSampleSize: 32 });
  out.multivariateAgain = detectMultivariateOutliers(rows, [(r) => r.deltaMinor, (r) => r.ageYears, (r) => r.serviceYears], { seed: SEED, contamination: 0.05, nTrees: 50, subSampleSize: 32 });

  // Model data: outcome deltaDollars, 3 allowed predictors (n=100 >= 30 required).
  const built = buildModelData(rows, { outcome: "deltaDollars", predictors: ["ageYears", "serviceYears", "compensationDollars"] });
  if (built.kind !== "ready") throw new Error(`buildModelData refused: ${built.reason}`);
  const data = built.data;
  out.modelData = { n: data.y.length, predictors: data.predictorNames, excludedMissing: built.excludedMissing };
  out.ols = fitOls(data);
  out.huber = fitHuber(data, { maxIterations: 50 });
  out.ridge = fitRidge(data, 1);
  out.lasso = fitLasso(data, 1);
  out.mixedEffects = fitMixedEffects(data);
  const prior = {
    mean: new Array(data.predictorNames.length + 1).fill(0),
    sd: new Array(data.predictorNames.length + 1).fill(1000),
    sigma2: null,
    basis: "Stage 7 fixture: diffuse prior, intercept + 3 predictors",
  };
  out.bayesian = fitBayesian(data, prior);
  out.bayesianAgain = fitBayesian(data, prior);
  out.gamSeeded = fitGam(data, { smoothPredictors: ["ageYears", "serviceYears"], seed: SEED });
  out.gamDefaultSeed = fitGam(data, { smoothPredictors: ["ageYears", "serviceYears"] });
  out.gamDefaultSeedAgain = fitGam(data, { smoothPredictors: ["ageYears", "serviceYears"] });

  // k-fold CV: explicit seed, default seed, and raw fold indices.
  const fitPredict = (train, test) => {
    const trainData = { keys: train.map((i) => data.keys[i]), y: train.map((i) => data.y[i]), x: train.map((i) => data.x[i]), predictorNames: data.predictorNames, groups: train.map((i) => data.groups[i]) };
    const fit = fitOls(trainData);
    const beta = fit.coefficients;
    return test.map((i) => beta[0] + data.x[i].reduce((s, v, j) => s + v * (beta[j + 1] ?? 0), 0));
  };
  out.cvSeeded = crossValidate(data, fitPredict, { k: 5, seed: SEED });
  out.cvDefaultSeed = crossValidate(data, fitPredict, { k: 5 });
  out.cvDefaultSeedAgain = crossValidate(data, fitPredict, { k: 5 });
  out.kFoldSeeded = kFoldIndices(data.y.length, 5, SEED);
  out.kFoldDefault = kFoldIndices(data.y.length, 5);
  out.kFoldDefaultAgain = kFoldIndices(data.y.length, 5);

  // Decision tree: explicit and default seed.
  const labels = data.y.map((v) => (Math.abs(v) > 100 ? 1 : 0));
  out.treeSeeded = fitDecisionTree(data, labels, { minLeaf: 5, maxDepth: 4, seed: SEED });
  out.treeDefaultSeed = fitDecisionTree(data, labels, { minLeaf: 5, maxDepth: 4 });
  out.treeDefaultSeedAgain = fitDecisionTree(data, labels, { minLeaf: 5, maxDepth: 4 });

  // PRNG itself: same seed -> same stream.
  const rngA = mulberry32(SEED);
  const rngB = mulberry32(SEED);
  out.prngStreamA = Array.from({ length: 10 }, () => rngA());
  out.prngStreamB = Array.from({ length: 10 }, () => rngB());
  out.shuffleA = seededShuffle(Array.from({ length: 20 }, (_, i) => i), mulberry32(SEED));
  out.shuffleB = seededShuffle(Array.from({ length: 20 }, (_, i) => i), mulberry32(SEED));

  return JSON.stringify(out, null, 2) + "\n";
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--single" && args[1]) {
    mkdirSync(args[1], { recursive: true });
    const s = runStatsOnce();
    writeFileSync(join(args[1], "stats.json"), s);
    console.log(`single run: ${args[1]} sha256=${sha256(s)}`);
    return 0;
  }
  const a = runStatsOnce();
  const b = runStatsOnce();
  const runsDir = join(DIR, "runs");
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(runsDir, "stats-A.json"), a);
  writeFileSync(join(runsDir, "stats-B.json"), b);
  const child = spawnSync(process.execPath, [join(DIR, "03-repro-stats.mjs"), "--single", join(runsDir, "stats-C")], { stdio: "inherit" });
  if (child.status !== 0) {
    console.error("FAIL: child process run C failed");
    return 1;
  }
  const c = readFileSync(join(runsDir, "stats-C", "stats.json"), "utf8");
  const ha = sha256(a);
  const hb = sha256(b);
  const hc = sha256(c);
  console.log(`stats A ${ha.slice(0, 16)}  B ${hb.slice(0, 16)}  C ${hc.slice(0, 16)}`);
  const parsed = JSON.parse(a);
  const checks = [
    ["isolationForest(seed) repeat", parsed.isolationForestSeeded, parsed.isolationForestSeededAgain],
    ["multivariate repeat", parsed.multivariate, parsed.multivariateAgain],
    ["bayesian repeat", parsed.bayesian, parsed.bayesianAgain],
    ["gam default-seed repeat", parsed.gamDefaultSeed, parsed.gamDefaultSeedAgain],
    ["cv default-seed repeat", parsed.cvDefaultSeed, parsed.cvDefaultSeedAgain],
    ["kFold default repeat", parsed.kFoldDefault, parsed.kFoldDefaultAgain],
    ["tree default-seed repeat", parsed.treeDefaultSeed, parsed.treeDefaultSeedAgain],
    ["prng stream repeat", parsed.prngStreamA, parsed.prngStreamB],
    ["shuffle repeat", parsed.shuffleA, parsed.shuffleB],
  ];
  let bad = 0;
  for (const [name, x, y] of checks) {
    const same = JSON.stringify(x) === JSON.stringify(y);
    console.log(`  ${same ? "PASS" : "FAIL"} ${name}`);
    if (!same) bad += 1;
  }
  console.log(`  isolation forest flagged: ${parsed.isolationForestSeeded.flagged.length} rows; threshold ${parsed.isolationForestSeeded.threshold}`);
  console.log(`  GAM: ${JSON.stringify(parsed.gamSeeded)}; OLS R2: ${parsed.ols.summary.r2}`);
  if (ha !== hb || ha !== hc || bad > 0) {
    console.error("FAIL: statistical outputs differ across identical runs");
    return 1;
  }
  console.log("PASS: statistical outputs byte-identical across A, B, C (explicit + default seeds)");
  return 0;
}

process.exit(main());
