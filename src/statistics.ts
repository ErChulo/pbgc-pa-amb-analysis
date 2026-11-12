/**
 * Statistical analysis module — Stage 5 (Worker 2).
 *
 * Stage 1 output 03, Part B (§3.1–§3.4); MASTER_PROMPT §11.
 *
 * BOUNDARY (read this first):
 * - This module READS reconciliation outputs and SUGGESTS hypotheses. It
 *   never computes Δ/D/R: the caller (the reconciliation module, which
 *   owns Δ/D/R) supplies pre-computed discrepancy values on each row.
 * - Statistics suggest; they never decide. An outlier flag is a work-list
 *   entry for investigation, never a correction. A close numeric match is
 *   an investigation signal, never proof of correctness. A heuristic is
 *   labelled as a heuristic and can never override the governing plan
 *   formula. No function here returns a benefit, a disposition, or a
 *   corrected amount.
 * - Money is integer minor units (cents) everywhere it is stored or
 *   summed: sums of money use bigint cents, means of money use exact
 *   decimal division (decDivide). A standard deviation or a regression
 *   coefficient is a reporting/model quantity computed from those exact
 *   sums; it is never used to round or to produce a money amount.
 * - Deterministic: every stochastic element uses a seeded PRNG
 *   (mulberry32, same pattern as test/property.test.ts). No Math.random,
 *   no Date.now, no unseeded randomness anywhere in this file.
 * - No network, no fetch, no external packages, no WASM, no worker.
 *   Embedded JS routines are the Stage 1 architecture baseline
 *   (stage1/04-architecture-decision.md §4.3).
 * - Thresholds, priors, penalties and heuristic parameters are
 *   caller-supplied case-set parameters, labelled with their source.
 *   Nothing here is a universal PBGC tolerance or standard: no PBGC
 *   tolerance for PA_AMB reconciliation was found (Stage 1 output 03,
 *   §1.2 Finding 1); the only PBGC dollar thresholds found are Policy
 *   5.8-1 benefit-correction tolerances, which govern a different
 *   decision and must be labelled as borrowed when used as screening
 *   values.
 *
 * Synthetic data only. Fictional participants only.
 */

import {
  decAdd,
  decCompare,
  decDivide,
  decMultiply,
  decSubtract,
  moneyMinorToDecimalString,
} from "./decimal";
import type { DecimalString } from "./types";

export const STATISTICS_MODULE_VERSION = "0.1.0";

/** Iglewicz–Hoaglin modified-z threshold (Stage 1 output 03, §3.2). */
export const MODIFIED_Z_THRESHOLD = 3.5;
/** Tukey inner-fence multiplier (Tukey, 1977). */
export const TUKEY_INNER_FENCE = 1.5;
/** Tukey outer ("far out") fence multiplier. */
export const TUKEY_OUTER_FENCE = 3;
/** Huber tuning constant (Huber, 1981/2009). */
export const HUBER_TUNING_CONSTANT = 1.345;
/** Minimum observations per predictor for a multivariate model
 *  (Stage 1 output 03, §3.3: ~10 observations per predictor). */
export const MIN_OBS_PER_PREDICTOR = 10;

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32 — same pattern as test/property.test.ts)
// ---------------------------------------------------------------------------

/** Deterministic PRNG. Every stochastic element in this module takes its
 *  randomness from a function returned here, seeded by the caller. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded Fisher–Yates shuffle. Returns a new array; the input is untouched. */
export function seededShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j] as T;
    out[j] = tmp as T;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Input row
// ---------------------------------------------------------------------------

/**
 * One participant's reconciliation outputs plus candidate explanatory
 * variables (MASTER_PROMPT §11 / Stage 1 output 03, §3.3).
 *
 * deltaMinor / absDeltaMinor / relDelta are SUPPLIED by the
 * reconciliation module — this module never computes them. A null is a
 * missing value (blank, never zero); rows with a null discrepancy are
 * excluded from the discrepancy statistics and counted in `missing`.
 */
export interface StatRow {
  participantKey: string;
  /** Participant status, e.g. "active" | "terminated-vested" | "retired" |
   *  "deceased" | "alternate-payee". Free text from the case; never coined. */
  status: string;
  employmentGroup: string | null;
  formulaType: string | null;
  amendmentCohort: string | null;
  /** Recorded PA_AMB, integer minor units. null = blank (missing). */
  paAmbMinor: number | null;
  /** Independently reconstructed benefit, integer minor units. null when
   *  no exact reconstruction exists. */
  reconstructedMinor: number | null;
  /** Δ_i = B_i^PA − B̂_i, integer minor units, supplied by reconciliation. */
  deltaMinor: number | null;
  /** D_i = |Δ_i|, integer minor units, supplied by reconciliation. */
  absDeltaMinor: number | null;
  /** R_i = Δ_i / B̂_i, exact decimal string, supplied by reconciliation.
   *  null when undefined/flagged (zero or near-zero denominator). */
  relDelta: DecimalString | null;
  /** Denominator flag from Stage 1 output 03, §2.3, or null. */
  denominatorFlag: string | null;
  ageYears: number | null;
  serviceYears: number | null;
  /** Annual compensation, integer minor units. null when missing. */
  compensationMinor: number | null;
  retirementStatus: string | null;
  /** Data completeness, 0–1 (share of required inputs present), or null. */
  dataCompleteness: number | null;
  /** Months since the recorded benefit was calculated, or null. */
  monthsSinceRecorded: number | null;
  qdro: boolean;
  priorDistribution: boolean;
  employmentPeriods: number | null;
}

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

function sortedNumbers(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/** Type-7 quantile (linear interpolation on the sorted values), the
 *  standard definition used by R's default quantile type. */
export function quantile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  if (p < 0 || p > 1) throw new Error(`quantile: p must be in [0,1]; got ${p}`);
  const sorted = sortedNumbers(values);
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const loV = sorted[lo];
  const hiV = sorted[hi];
  if (loV === undefined || hiV === undefined) return null;
  return loV + (h - lo) * (hiV - loV);
}

function medianOf(values: readonly number[]): number | null {
  return quantile(values, 0.5);
}

function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Sample standard deviation (denominator n−1). null when n < 2. */
function sampleSd(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = meanOf(values);
  if (mean === null) return null;
  let ss = 0;
  for (const v of values) ss += (v - mean) * (v - mean);
  return Math.sqrt(ss / (values.length - 1));
}

/** Quantile of exact decimal strings, via exact decimal arithmetic. */
function quantileDecimal(sorted: readonly DecimalString[], p: number): DecimalString {
  if (sorted.length === 0) throw new Error("quantileDecimal: empty values");
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const loV = sorted[lo];
  const hiV = sorted[hi];
  if (loV === undefined || hiV === undefined) throw new Error("quantileDecimal: index error");
  if (hi === lo) return loV;
  const frac = (h - lo).toFixed(10);
  return decAdd(loV, decMultiply(decSubtract(hiV, loV), frac));
}

function sortDecimals(values: readonly DecimalString[]): DecimalString[] {
  return [...values].sort((a, b) => decCompare(a, b));
}

// ---------------------------------------------------------------------------
// §3.1 Descriptive statistics
// ---------------------------------------------------------------------------

export interface NumericSummary {
  count: number;
  missing: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  min: number | null;
  max: number | null;
  quantiles: Record<"p1" | "p5" | "p25" | "p50" | "p75" | "p95" | "p99", number | null>;
}

/** Summary of plain numbers (ages, service years, ratios-as-numbers).
 *  Money must use summarizeMoneyMinor instead — never a binary float
 *  on money. */
export function summarizeNumbers(values: readonly (number | null)[]): NumericSummary {
  const present = values.filter((v): v is number => v !== null);
  return {
    count: present.length,
    missing: values.length - present.length,
    mean: meanOf(present),
    median: medianOf(present),
    sd: sampleSd(present),
    min: present.length === 0 ? null : Math.min(...present),
    max: present.length === 0 ? null : Math.max(...present),
    quantiles: {
      p1: quantile(present, 0.01),
      p5: quantile(present, 0.05),
      p25: quantile(present, 0.25),
      p50: quantile(present, 0.5),
      p75: quantile(present, 0.75),
      p95: quantile(present, 0.95),
      p99: quantile(present, 0.99),
    },
  };
}

export interface DecimalSummary {
  count: number;
  missing: number;
  /** Exact mean, decimal dollars (or the ratio's own units). */
  mean: DecimalString | null;
  median: DecimalString | null;
  /** Reporting SD only (dimensionless ratio scale); null when n < 2. */
  sd: number | null;
  min: DecimalString | null;
  max: DecimalString | null;
  quantiles: Record<"p1" | "p5" | "p25" | "p50" | "p75" | "p95" | "p99", DecimalString | null>;
}

/** Summary of exact decimal values (relative discrepancies R_i).
 *  Mean/median/quantiles are exact decimal arithmetic; the SD is a
 *  reporting statistic on the ratio scale. */
export function summarizeDecimals(values: readonly (DecimalString | null)[]): DecimalSummary {
  const present = values.filter((v): v is DecimalString => v !== null);
  const sorted = sortDecimals(present);
  let mean: DecimalString | null = null;
  if (present.length > 0) {
    let sum: DecimalString = "0";
    for (const v of present) sum = decAdd(sum, v);
    mean = decDivide(sum, String(present.length), 10);
  }
  const asNumbers = present.map((v) => Number(v));
  return {
    count: present.length,
    missing: values.length - present.length,
    mean,
    median: sorted.length === 0 ? null : quantileDecimal(sorted, 0.5),
    sd: sampleSd(asNumbers),
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
    quantiles: {
      p1: sorted.length === 0 ? null : quantileDecimal(sorted, 0.01),
      p5: sorted.length === 0 ? null : quantileDecimal(sorted, 0.05),
      p25: sorted.length === 0 ? null : quantileDecimal(sorted, 0.25),
      p50: sorted.length === 0 ? null : quantileDecimal(sorted, 0.5),
      p75: sorted.length === 0 ? null : quantileDecimal(sorted, 0.75),
      p95: sorted.length === 0 ? null : quantileDecimal(sorted, 0.95),
      p99: sorted.length === 0 ? null : quantileDecimal(sorted, 0.99),
    },
  };
}

export interface MoneySummary {
  count: number;
  missing: number;
  /** Exact mean in dollars (decimal string). Sums use bigint cents. */
  meanDollars: DecimalString | null;
  /** Exact median in dollars (decimal string). */
  medianDollars: DecimalString | null;
  /** Sample SD in minor units (cents), reporting only — never a money amount. */
  sdMinor: number | null;
  minMinor: number | null;
  maxMinor: number | null;
  quantilesDollars: Record<"p1" | "p5" | "p25" | "p50" | "p75" | "p95" | "p99", DecimalString | null>;
}

/**
 * Summary of money values in integer minor units. Sums are exact bigint
 * cents; mean/median/quantiles are exact decimal dollars. The SD is
 * derived from exact bigint sums of squares and is a reporting statistic
 * only.
 */
export function summarizeMoneyMinor(values: readonly (number | null)[]): MoneySummary {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) {
    return {
      count: 0,
      missing: values.length,
      meanDollars: null,
      medianDollars: null,
      sdMinor: null,
      minMinor: null,
      maxMinor: null,
      quantilesDollars: { p1: null, p5: null, p25: null, p50: null, p75: null, p95: null, p99: null },
    };
  }
  let sum = 0n;
  let sumSq = 0n;
  for (const v of present) {
    const b = BigInt(v);
    sum += b;
    sumSq += b * b;
  }
  const n = present.length;
  // Sum is in integer minor units; the mean in dollars divides by n×100.
  const meanDollars = decDivide(sum.toString(), String(n * 100), 10);
  const sortedDollars = sortedNumbers(present).map((c) => moneyMinorToDecimalString(c));
  const sortedCents = sortedNumbers(present);
  // Exact sample variance from bigint sums: var = (n*Σx² − (Σx)²) / (n(n−1)).
  // The bigint numerator is exact; the final division to a reporting
  // number is the only inexact step and never feeds a money amount.
  let sdMinor: number | null = null;
  if (n >= 2) {
    const numerator = BigInt(n) * sumSq - sum * sum;
    const variance = Number(numerator) / (n * (n - 1));
    sdMinor = Math.sqrt(Math.max(0, variance));
  }
  const q = (p: number): DecimalString => quantileDecimal(sortedDollars, p);
  return {
    count: n,
    missing: values.length - n,
    meanDollars,
    medianDollars: q(0.5),
    sdMinor,
    minMinor: sortedCents[0] ?? null,
    maxMinor: sortedCents[sortedCents.length - 1] ?? null,
    quantilesDollars: { p1: q(0.01), p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95), p99: q(0.99) },
  };
}

/** RMSE and MAE of the signed discrepancies (integer cents).
 *  RMSE = √(mean(Δ²)); MAE = mean(D). Both from exact bigint sums. */
export function rmseMae(deltaMinor: readonly (number | null)[]): {
  rmseMinor: number | null;
  maeDollars: DecimalString | null;
  count: number;
} {
  const present = deltaMinor.filter((v): v is number => v !== null);
  if (present.length === 0) return { rmseMinor: null, maeDollars: null, count: 0 };
  let sumSq = 0n;
  let sumAbs = 0n;
  for (const v of present) {
    const b = BigInt(v);
    sumSq += b * b;
    sumAbs += b < 0n ? -b : b;
  }
  const rmseMinor = Math.sqrt(Number(sumSq) / present.length);
  return {
    rmseMinor,
    // MAE in dollars: mean absolute cents divided by 100.
    maeDollars: decDivide(sumAbs.toString(), String(present.length * 100), 10),
    count: present.length,
  };
}

export interface GroupSummary {
  key: string;
  n: number;
  countsByStatus: Record<string, number>;
  countsByEmploymentGroup: Record<string, number>;
  paAmb: MoneySummary;
  reconstructed: MoneySummary;
  delta: MoneySummary;
  absDelta: MoneySummary;
  relDelta: DecimalSummary;
  rmseMinor: number | null;
  maeDollars: DecimalString | null;
  /** Share of defined, non-zero discrepancies that are positive.
   *  A share far from 0.5 is itself a finding (one-sided pattern). */
  signSharePositive: number | null;
  materiality: {
    absOver: number;
    relOver: number;
    eitherOver: number;
    total: number;
    shareEither: number | null;
  };
  missing: {
    paAmb: number;
    reconstructed: number;
    delta: number;
    service: number;
    compensation: number;
    age: number;
  };
}

export interface MaterialityThresholds {
  /** Absolute threshold in minor units, or null when no absolute leg is set. */
  absMinor: number | null;
  /** Relative threshold as an exact decimal proportion (e.g. "0.01"), or null. */
  relDecimal: DecimalString | null;
  /** Where the thresholds came from — e.g. "case tolerance record v1"
   *  or "Policy 5.8-1 $1.00/$5.00, borrowed as screening values — that
   *  policy governs benefit corrections, not PA_AMB acceptance". */
  source: string;
}

function summarizeGroup(key: string, rows: readonly StatRow[], thresholds: MaterialityThresholds): GroupSummary {
  const countsByStatus: Record<string, number> = {};
  const countsByEmploymentGroup: Record<string, number> = {};
  for (const row of rows) {
    countsByStatus[row.status] = (countsByStatus[row.status] ?? 0) + 1;
    const group = row.employmentGroup ?? "(not recorded)";
    countsByEmploymentGroup[group] = (countsByEmploymentGroup[group] ?? 0) + 1;
  }
  const deltas = rows.map((r) => r.deltaMinor).filter((v): v is number => v !== null);
  const nonZero = deltas.filter((d) => d !== 0);
  const positive = nonZero.filter((d) => d > 0).length;
  const { rmseMinor, maeDollars } = rmseMae(rows.map((r) => r.deltaMinor));
  let absOver = 0;
  let relOver = 0;
  let eitherOver = 0;
  for (const row of rows) {
    const absHit = thresholds.absMinor !== null && row.absDeltaMinor !== null && row.absDeltaMinor > thresholds.absMinor;
    const relHit =
      thresholds.relDecimal !== null &&
      row.relDelta !== null &&
      decCompare(row.relDelta.startsWith("-") ? row.relDelta.slice(1) : row.relDelta, thresholds.relDecimal) > 0;
    if (absHit) absOver += 1;
    if (relHit) relOver += 1;
    if (absHit || relHit) eitherOver += 1;
  }
  return {
    key,
    n: rows.length,
    countsByStatus,
    countsByEmploymentGroup,
    paAmb: summarizeMoneyMinor(rows.map((r) => r.paAmbMinor)),
    reconstructed: summarizeMoneyMinor(rows.map((r) => r.reconstructedMinor)),
    delta: summarizeMoneyMinor(rows.map((r) => r.deltaMinor)),
    absDelta: summarizeMoneyMinor(rows.map((r) => r.absDeltaMinor)),
    relDelta: summarizeDecimals(rows.map((r) => r.relDelta)),
    rmseMinor,
    maeDollars,
    signSharePositive: nonZero.length === 0 ? null : positive / nonZero.length,
    materiality: {
      absOver,
      relOver,
      eitherOver,
      total: rows.length,
      shareEither: rows.length === 0 ? null : eitherOver / rows.length,
    },
    missing: {
      paAmb: rows.filter((r) => r.paAmbMinor === null).length,
      reconstructed: rows.filter((r) => r.reconstructedMinor === null).length,
      delta: rows.filter((r) => r.deltaMinor === null).length,
      service: rows.filter((r) => r.serviceYears === null).length,
      compensation: rows.filter((r) => r.compensationMinor === null).length,
      age: rows.filter((r) => r.ageYears === null).length,
    },
  };
}

export interface PopulationDescription {
  pooled: GroupSummary;
  byFormulaType: GroupSummary[];
  byAmendmentCohort: GroupSummary[];
  byEmploymentGroup: GroupSummary[];
  byStatus: GroupSummary[];
  /** Rows excluded from the discrepancy statistics: no Δ because the
   *  comparison basis is unresolved or the recorded amount is blank. */
  excludedFromDiscrepancy: number;
  thresholds: MaterialityThresholds;
  note: string;
}

function stratify(
  rows: readonly StatRow[],
  keyFn: (row: StatRow) => string,
  thresholds: MaterialityThresholds,
): GroupSummary[] {
  const groups = new Map<string, StatRow[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [row]);
    else bucket.push(row);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, bucket]) => summarizeGroup(key, bucket, thresholds));
}

/**
 * §3.1 descriptives. Stratification is mandatory: every headline number
 *  is accompanied by its stratified tables (by formula type, amendment
 *  cohort, employment group, status). A pooled-only summary is not
 *  returned on its own — the pooled table is one entry among the strata.
 */
export function describePopulation(
  rows: readonly StatRow[],
  thresholds: MaterialityThresholds,
): PopulationDescription {
  return {
    pooled: summarizeGroup("pooled", rows, thresholds),
    byFormulaType: stratify(rows, (r) => r.formulaType ?? "(not recorded)", thresholds),
    byAmendmentCohort: stratify(rows, (r) => r.amendmentCohort ?? "(not recorded)", thresholds),
    byEmploymentGroup: stratify(rows, (r) => r.employmentGroup ?? "(not recorded)", thresholds),
    byStatus: stratify(rows, (r) => r.status, thresholds),
    excludedFromDiscrepancy: rows.filter((r) => r.deltaMinor === null).length,
    thresholds,
    note: "Statistics are computed on the reconciliation population (participants with a supplied Δ). Rows without Δ are counted in excludedFromDiscrepancy and in missing counts, never treated as zero. Statistical outputs suggest hypotheses; they do not establish any participant's legally correct benefit.",
  };
}

// ---------------------------------------------------------------------------
// §3.2 Outlier detection
//
// Principle: outliers are investigated, never auto-corrected. Every
// screen runs WITHIN each cohort as well as pooled (group-aware detection
// is mandatory): a benefit ordinary in its own formula group but extreme
// pooled is not an error.
// ---------------------------------------------------------------------------

export interface ModifiedZResult {
  median: number | null;
  mad: number | null;
  /** "none" normally; "mean-absolute-deviation" when MAD = 0 (more than
   *  half the values identical — common when many Δ = 0). Never divide
   *  by zero. */
  fallback: "none" | "mean-absolute-deviation";
  scores: (number | null)[];
  flagged: boolean[];
  threshold: number;
}

/**
 * Robust (modified) z-score via median and MAD (Iglewicz & Hoaglin,
 * 1993): M = 0.6745 × (x − median) / MAD. Flag |M| > 3.5.
 * The 0.6745 factor puts the score on the standard-deviation scale for
 * normal data; median and MAD have a 50% breakdown point.
 */
export function modifiedZScores(
  values: readonly (number | null)[],
  threshold: number = MODIFIED_Z_THRESHOLD,
): ModifiedZResult {
  const present = values.filter((v): v is number => v !== null);
  const median = medianOf(present);
  if (median === null || present.length === 0) {
    return { median: null, mad: null, fallback: "none", scores: values.map(() => null), flagged: values.map(() => false), threshold };
  }
  const absDev = present.map((v) => Math.abs(v - median));
  let mad = medianOf(absDev);
  let fallback: ModifiedZResult["fallback"] = "none";
  let scale = mad;
  if (mad === 0 || mad === null) {
    // Degenerate case: fall back to the mean absolute deviation from the
    // median, and record the fallback. Never divide by zero.
    fallback = "mean-absolute-deviation";
    const meanAbs = meanOf(absDev);
    scale = meanAbs === null || meanAbs === 0 ? null : meanAbs;
    mad = 0;
  }
  const scores: (number | null)[] = values.map((v) => {
    if (v === null || scale === null || scale === 0) return null;
    return (0.6745 * (v - median)) / scale;
  });
  return {
    median,
    mad,
    fallback,
    scores,
    flagged: scores.map((s) => s !== null && Math.abs(s) > threshold),
    threshold,
  };
}

export interface TukeyResult {
  q1: number | null;
  q3: number | null;
  iqr: number | null;
  lowerInner: number | null;
  upperInner: number | null;
  lowerOuter: number | null;
  upperOuter: number | null;
  /** Outside the 1.5×IQR inner fences. */
  flaggedInner: boolean[];
  /** Outside the 3×IQR outer ("far out") fences. */
  flaggedOuter: boolean[];
}

/** Tukey (1977) IQR fences. */
export function tukeyFences(values: readonly (number | null)[]): TukeyResult {
  const present = values.filter((v): v is number => v !== null);
  const q1 = quantile(present, 0.25);
  const q3 = quantile(present, 0.75);
  const iqr = q1 === null || q3 === null ? null : q3 - q1;
  const lowerInner = q1 === null || iqr === null ? null : q1 - TUKEY_INNER_FENCE * iqr;
  const upperInner = q3 === null || iqr === null ? null : q3 + TUKEY_INNER_FENCE * iqr;
  const lowerOuter = q1 === null || iqr === null ? null : q1 - TUKEY_OUTER_FENCE * iqr;
  const upperOuter = q3 === null || iqr === null ? null : q3 + TUKEY_OUTER_FENCE * iqr;
  return {
    q1,
    q3,
    iqr,
    lowerInner,
    upperInner,
    lowerOuter,
    upperOuter,
    flaggedInner: values.map((v) => v !== null && lowerInner !== null && upperInner !== null && (v < lowerInner || v > upperInner)),
    flaggedOuter: values.map((v) => v !== null && lowerOuter !== null && upperOuter !== null && (v < lowerOuter || v > upperOuter)),
  };
}

export interface PercentileScreenResult {
  cutPoints: { p0_5: number | null; p1: number | null; p99: number | null; p99_5: number | null };
  /** In the bottom/top 1% (review list). */
  flagged1pct: boolean[];
  /** In the bottom/top 0.5% (review list). */
  flagged0_5pct: boolean[];
}

/** Percentile screening: the cut points are reported so the actuary can
 *  see how arbitrary the cut is. */
export function percentileScreen(values: readonly (number | null)[]): PercentileScreenResult {
  const present = values.filter((v): v is number => v !== null);
  const cutPoints = {
    p0_5: quantile(present, 0.005),
    p1: quantile(present, 0.01),
    p99: quantile(present, 0.99),
    p99_5: quantile(present, 0.995),
  };
  return {
    cutPoints,
    flagged1pct: values.map(
      (v) => v !== null && cutPoints.p1 !== null && cutPoints.p99 !== null && (v <= cutPoints.p1 || v >= cutPoints.p99),
    ),
    flagged0_5pct: values.map(
      (v) => v !== null && cutPoints.p0_5 !== null && cutPoints.p99_5 !== null && (v <= cutPoints.p0_5 || v >= cutPoints.p99_5),
    ),
  };
}

// --- Matrix helpers (small dense matrices; Gauss–Jordan with pivoting) ---

export function matrixInverse(a: readonly (readonly number[])[]): number[][] | null {
  const n = a.length;
  if (n === 0) return null;
  for (const row of a) if (row.length !== n) return null;
  const aug: number[][] = a.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(aug[r]?.[col] ?? 0) > Math.abs(aug[pivot]?.[col] ?? 0)) pivot = r;
    }
    if (Math.abs(aug[pivot]?.[col] ?? 0) < 1e-12) return null; // singular
    if (pivot !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivot] as number[];
      aug[pivot] = tmp as number[];
    }
    const pivotVal = aug[col]?.[col] as number;
    for (let j = 0; j < 2 * n; j += 1) aug[col]![j] = (aug[col]?.[j] ?? 0) / pivotVal;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = aug[r]?.[col] ?? 0;
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j += 1) {
        aug[r]![j] = (aug[r]?.[j] ?? 0) - factor * (aug[col]?.[j] ?? 0);
      }
    }
  }
  return aug.map((row) => row.slice(n));
}

function matVecMul(a: readonly (readonly number[])[], v: readonly number[]): number[] {
  return a.map((row) => row.reduce((sum, val, j) => sum + val * (v[j] ?? 0), 0));
}

function matMul(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): number[][] {
  const cols = b[0]?.length ?? 0;
  return a.map((row) =>
    Array.from({ length: cols }, (_, j) => row.reduce((sum, val, k) => sum + val * (b[k]?.[j] ?? 0), 0)),
  );
}

function matTranspose(a: readonly (readonly number[])[]): number[][] {
  const rows = a.length;
  const cols = a[0]?.length ?? 0;
  return Array.from({ length: cols }, (_, j) => Array.from({ length: rows }, (_, i) => a[i]?.[j] ?? 0));
}

/** Chi-square 0.975 quantile. Table for df 1–10; Wilson–Hilferty
 *  approximation above that. */
export function chiSquare975(df: number): number {
  const table: Record<number, number> = {
    1: 5.024, 2: 7.378, 3: 9.348, 4: 11.143, 5: 12.833,
    6: 14.449, 7: 16.013, 8: 17.535, 9: 19.023, 10: 20.483,
  };
  const exact = table[df];
  if (exact !== undefined) return exact;
  const z = 1.96;
  const t = 1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df));
  return df * t * t * t;
}

export interface MahalanobisResult {
  distances: number[];
  threshold: number;
  flagged: boolean[];
  /** When robust: mean/covariance were recomputed after one trimming
   *  pass (a deterministic reweighting, not a full MCD fit — the full
   *  Minimum Covariance Determinant is out of scope for the embedded
   *  baseline; the trimming pass is stated here, not hidden). */
  robust: boolean;
  dimension: number;
}

/**
 * Mahalanobis distance on the supplied variables. Use a robust
 * covariance (one trimming pass) when `robust` is set — the classical
 * covariance is distorted by the same outliers being hunted (Stage 1
 * output 03, §3.2). Flags by the chi-square 0.975 quantile.
 * Rows containing a null are excluded (and reported via `excluded`).
 */
export function mahalanobisOutliers(
  data: readonly (readonly (number | null)[])[],
  options: { robust?: boolean; quantile?: number } = {},
): MahalanobisResult & { excluded: number } {
  const clean = data.filter((row) => row.every((v) => v !== null)) as number[][];
  const excluded = data.length - clean.length;
  const p = clean[0]?.length ?? 0;
  if (clean.length < p + 2 || p === 0) {
    return { distances: data.map(() => 0), threshold: 0, flagged: data.map(() => false), robust: options.robust ?? false, dimension: p, excluded };
  }
  const meanOfRows = (rows: number[][]): number[] => {
    const n = rows.length;
    return Array.from({ length: p }, (_, j) => rows.reduce((s, r) => s + (r[j] ?? 0), 0) / n);
  };
  const covOf = (rows: number[][], mean: number[]): number[][] | null => {
    const n = rows.length;
    const cov: number[][] = Array.from({ length: p }, () => Array.from({ length: p }, () => 0));
    for (const r of rows) {
      for (let i = 0; i < p; i += 1) {
        const covRow = cov[i] as number[];
        for (let j = 0; j < p; j += 1) {
          covRow[j] = (covRow[j] ?? 0) + ((r[i] ?? 0) - mean[i]!) * ((r[j] ?? 0) - mean[j]!);
        }
      }
    }
    for (let i = 0; i < p; i += 1) {
      const covRow = cov[i] as number[];
      for (let j = 0; j < p; j += 1) covRow[j] = (covRow[j] ?? 0) / (n - 1);
    }
    return matrixInverse(cov) === null ? null : cov;
  };
  const distancesWith = (mean: number[], covInv: number[][]): number[] =>
    clean.map((r) => {
      const d = r.map((v, j) => v - (mean[j] ?? 0));
      const tmp = matVecMul(covInv, d);
      const q = d.reduce((s, v, j) => s + v * (tmp[j] ?? 0), 0);
      return Math.sqrt(Math.max(0, q));
    });
  const threshold = Math.sqrt(options.quantile !== undefined ? options.quantile : chiSquare975(p));
  let mean = meanOfRows(clean);
  let cov = covOf(clean, mean);
  if (cov === null) {
    return { distances: data.map(() => 0), threshold, flagged: data.map(() => false), robust: options.robust ?? false, dimension: p, excluded };
  }
  let covInv = matrixInverse(cov);
  if (covInv === null) {
    return { distances: data.map(() => 0), threshold, flagged: data.map(() => false), robust: options.robust ?? false, dimension: p, excluded };
  }
  let distances = distancesWith(mean, covInv);
  if (options.robust === true) {
    const kept = clean.filter((_, i) => (distances[i] ?? 0) <= threshold);
    if (kept.length >= p + 2 && kept.length < clean.length) {
      mean = meanOfRows(kept);
      const cov2 = covOf(kept, mean);
      const inv2 = cov2 === null ? null : matrixInverse(cov2);
      if (inv2 !== null) distances = distancesWith(mean, inv2);
    }
  }
  // Map back onto the original rows (excluded rows get distance 0, unflagged).
  const fullDistances: number[] = [];
  const fullFlagged: boolean[] = [];
  let cleanIdx = 0;
  for (const row of data) {
    if (row.every((v) => v !== null)) {
      const d = distances[cleanIdx] ?? 0;
      fullDistances.push(d);
      fullFlagged.push(d > threshold);
      cleanIdx += 1;
    } else {
      fullDistances.push(0);
      fullFlagged.push(false);
    }
  }
  return { distances: fullDistances, threshold, flagged: fullFlagged, robust: options.robust ?? false, dimension: p, excluded };
}

// --- Isolation forest (deterministic, seeded; Liu, Ting & Zhou, 2008) ---

function harmonicNumber(n: number): number {
  let h = 0;
  for (let i = 1; i <= n; i += 1) h += 1 / i;
  return h;
}

/** Expected path length of an unsuccessful search in a BST of n nodes. */
function cFactor(n: number): number {
  if (n <= 1) return 0;
  return 2 * harmonicNumber(n - 1) - (2 * (n - 1)) / n;
}

interface IsolationNode {
  size: number;
  feature: number | null;
  splitValue: number | null;
  left: IsolationNode | null;
  right: IsolationNode | null;
}

function buildIsolationTree(
  rows: readonly (readonly number[])[],
  indices: number[],
  depth: number,
  maxDepth: number,
  rng: () => number,
): IsolationNode {
  if (indices.length <= 1 || depth >= maxDepth) {
    return { size: indices.length, feature: null, splitValue: null, left: null, right: null };
  }
  const p = rows[0]?.length ?? 0;
  const feature = Math.floor(rng() * p);
  let min = Infinity;
  let max = -Infinity;
  for (const i of indices) {
    const v = rows[i]?.[feature] ?? 0;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) {
    return { size: indices.length, feature: null, splitValue: null, left: null, right: null };
  }
  const splitValue = min + rng() * (max - min);
  const left: number[] = [];
  const right: number[] = [];
  for (const i of indices) {
    if ((rows[i]?.[feature] ?? 0) < splitValue) left.push(i);
    else right.push(i);
  }
  if (left.length === 0 || right.length === 0) {
    return { size: indices.length, feature: null, splitValue: null, left: null, right: null };
  }
  return {
    size: indices.length,
    feature,
    splitValue,
    left: buildIsolationTree(rows, left, depth + 1, maxDepth, rng),
    right: buildIsolationTree(rows, right, depth + 1, maxDepth, rng),
  };
}

function isolationPathLength(node: IsolationNode, row: readonly number[], depth: number): number {
  if (node.feature === null || node.left === null || node.right === null) {
    return depth + cFactor(node.size);
  }
  const v = row[node.feature] ?? 0;
  return isolationPathLength(v < (node.splitValue ?? 0) ? node.left : node.right, row, depth + 1);
}

export interface IsolationForestResult {
  /** Anomaly scores in [0,1]; higher = more anomalous. */
  scores: number[];
  threshold: number;
  flagged: boolean[];
  contamination: number;
  nTrees: number;
  subSampleSize: number;
  seed: number;
}

/**
 * Isolation forest as a secondary screen. Deterministic: every split
 * and every subsample comes from mulberry32(seed). Reports anomaly
 * scores, not just a binary flag; the contamination parameter is
 * caller-supplied and recorded in the result.
 */
export function isolationForest(
  data: readonly (readonly number[])[],
  options: { nTrees: number; subSampleSize: number; seed: number; contamination: number },
): IsolationForestResult {
  const { nTrees, subSampleSize, seed, contamination } = options;
  if (data.length === 0) return { scores: [], threshold: 0, flagged: [], contamination, nTrees, subSampleSize, seed };
  if (contamination <= 0 || contamination >= 1) {
    throw new Error(`isolationForest: contamination must be in (0,1); got ${contamination}`);
  }
  const rng = mulberry32(seed);
  const sub = Math.min(subSampleSize, data.length);
  const maxDepth = Math.ceil(Math.log2(sub));
  const trees: IsolationNode[] = [];
  for (let t = 0; t < nTrees; t += 1) {
    const shuffled = seededShuffle(data.map((_, i) => i), rng);
    trees.push(buildIsolationTree(data, shuffled.slice(0, sub), 0, maxDepth, rng));
  }
  const c = cFactor(sub);
  const scores = data.map((row) => {
    const avgPath = trees.reduce((s, tree) => s + isolationPathLength(tree, row, 0), 0) / nTrees;
    return c === 0 ? 0 : Math.pow(2, -avgPath / c);
  });
  const sortedScores = [...scores].sort((a, b) => b - a);
  const cutIndex = Math.max(0, Math.floor(contamination * scores.length) - 1);
  const threshold = sortedScores[cutIndex] ?? 0;
  return {
    scores,
    threshold,
    flagged: scores.map((s) => s >= threshold),
    contamination,
    nTrees,
    subSampleSize: sub,
    seed,
  };
}

// --- Model residual diagnostics ---

export interface ResidualDiagnostics {
  standardizedResiduals: (number | null)[];
  cooksDistance: (number | null)[];
  /** Participants whose Cook's distance exceeds 4/n (a common
   *  screening rule, labelled as such — not a PBGC rule). */
  flagged: boolean[];
  threshold: number;
  mse: number | null;
}

/**
 * Residual diagnostics (Cook, 1977): standardized residuals and Cook's
 * distance from caller-supplied residuals and leverage (hat) values.
 * A participant with a large residual AND high leverage deserves
 * investigation of both the data and the model.
 */
export function residualDiagnostics(
  residuals: readonly number[],
  leverages: readonly number[],
  p: number,
): ResidualDiagnostics {
  const n = residuals.length;
  const threshold = n === 0 ? 0 : 4 / n;
  if (n === 0 || n <= p) {
    return { standardizedResiduals: residuals.map(() => null), cooksDistance: residuals.map(() => null), flagged: residuals.map(() => false), threshold, mse: null };
  }
  const ssr = residuals.reduce((s, r) => s + r * r, 0);
  const mse = ssr / (n - p);
  const standardized: (number | null)[] = residuals.map((r, i) => {
    const h = leverages[i] ?? 0;
    if (mse <= 0 || h >= 1) return null;
    return r / Math.sqrt(mse * (1 - h));
  });
  const cooks: (number | null)[] = residuals.map((r, i) => {
    const h = leverages[i] ?? 0;
    if (mse <= 0 || h >= 1 || p === 0) return null;
    return (r * r) / (p * mse) * (h / ((1 - h) * (1 - h)));
  });
  return {
    standardizedResiduals: standardized,
    cooksDistance: cooks,
    flagged: cooks.map((d) => d !== null && d > threshold),
    threshold,
    mse,
  };
}

// --- Group-aware detection driver ---

export type OutlierValueField = "deltaMinor" | "absDeltaMinor" | "relDelta" | "paAmbMinor";
export type OutlierMethod = "modified-z" | "tukey" | "percentile";

export interface OutlierFlag {
  participantKey: string;
  method: OutlierMethod;
  /** "within-cohort" is the primary scope; "pooled" flags are reported
   *  only when the within-cohort run does not explain them away. */
  scope: "within-cohort" | "pooled";
  score: number | null;
  threshold: number;
  cohort: string;
  note: string;
}

export interface OutlierDetectionResult {
  flags: OutlierFlag[];
  /** Flagged pooled but NOT within their cohort: a legitimate
   *  formula-group difference, not an error. Reported here so the
   *  difference is visible and explicitly not treated as an error. */
  explainedByGroup: OutlierFlag[];
  pooledFlaggedCount: number;
  withinFlaggedCount: number;
  methods: OutlierMethod[];
}

function valueForField(row: StatRow, field: OutlierValueField): number | null {
  switch (field) {
    case "deltaMinor":
      return row.deltaMinor;
    case "absDeltaMinor":
      return row.absDeltaMinor;
    case "paAmbMinor":
      return row.paAmbMinor;
    case "relDelta":
      return row.relDelta === null ? null : Number(row.relDelta);
  }
}

function flagWithMethod(values: readonly (number | null)[], method: OutlierMethod): { flagged: boolean[]; scores: readonly (number | null)[]; threshold: number } {
  if (method === "modified-z") {
    const r = modifiedZScores(values);
    return { flagged: r.flagged, scores: r.scores, threshold: r.threshold };
  }
  if (method === "tukey") {
    const r = tukeyFences(values);
    return { flagged: r.flaggedInner, scores: values, threshold: TUKEY_INNER_FENCE };
  }
  const r = percentileScreen(values);
  return { flagged: r.flagged1pct, scores: values, threshold: 0.01 };
}

/**
 * Group-aware outlier detection. Runs each method pooled AND within
 * each cohort (formula type + amendment cohort). A participant flagged
 * pooled but not within-cohort lands in `explainedByGroup`, never in
 * `flags`: legitimate differences among formula groups are never
 * classified as errors merely because they are unusual pooled.
 */
export function detectOutliers(
  rows: readonly StatRow[],
  options: {
    valueField: OutlierValueField;
    methods?: OutlierMethod[];
  },
): OutlierDetectionResult {
  const methods = options.methods ?? (["modified-z", "tukey", "percentile"] as OutlierMethod[]);
  const cohortKey = (row: StatRow): string =>
    `${row.formulaType ?? "(not recorded)"} | ${row.amendmentCohort ?? "(not recorded)"}`;
  const values = rows.map((r) => valueForField(r, options.valueField));
  const flags: OutlierFlag[] = [];
  const explainedByGroup: OutlierFlag[] = [];
  let pooledFlaggedCount = 0;
  let withinFlaggedCount = 0;
  for (const method of methods) {
    const pooled = flagWithMethod(values, method);
    // Within-cohort run, one cohort at a time.
    const withinFlagged = new Set<number>();
    const cohorts = new Map<string, number[]>();
    rows.forEach((row, i) => {
      const key = cohortKey(row);
      const bucket = cohorts.get(key);
      if (bucket === undefined) cohorts.set(key, [i]);
      else bucket.push(i);
    });
    for (const [cohort, indices] of cohorts) {
      if (indices.length < 4) continue; // too small for a within-cohort screen; pooled stands, labelled
      const subValues = indices.map((i) => values[i] as number | null);
      const sub = flagWithMethod(subValues, method);
      indices.forEach((rowIdx, j) => {
        if (sub.flagged[j] === true) {
          withinFlagged.add(rowIdx);
          withinFlaggedCount += 1;
          flags.push({
            participantKey: rows[rowIdx]?.participantKey ?? "",
            method,
            scope: "within-cohort",
            score: sub.scores[j] ?? null,
            threshold: sub.threshold,
            cohort,
            note: "Flagged within its own formula/amendment cohort — investigate, never auto-correct.",
          });
        }
      });
    }
    pooled.flagged.forEach((isFlagged, i) => {
      if (!isFlagged) return;
      pooledFlaggedCount += 1;
      if (withinFlagged.has(i)) return; // already flagged within-cohort
      const row = rows[i];
      if (row === undefined) return;
      const cohortSize = cohorts.get(cohortKey(row))?.length ?? 0;
      if (cohortSize >= 4) {
        // Pooled flag, within-cohort run explains it: group difference.
        explainedByGroup.push({
          participantKey: row.participantKey,
          method,
          scope: "pooled",
          score: pooled.scores[i] ?? null,
          threshold: pooled.threshold,
          cohort: cohortKey(row),
          note: "Pooled flag explained by the participant's formula/amendment cohort — a legitimate group difference, not an error.",
        });
      } else {
        // Cohort too small for a within-cohort screen: keep the pooled
        // flag, labelled as pooled-only because the cohort is small.
        flags.push({
          participantKey: row.participantKey,
          method,
          scope: "pooled",
          score: pooled.scores[i] ?? null,
          threshold: pooled.threshold,
          cohort: cohortKey(row),
          note: "Pooled flag; cohort too small (n < 4) for a within-cohort screen — treat as a pooled-only signal.",
        });
      }
    });
  }
  return { flags, explainedByGroup, pooledFlaggedCount, withinFlaggedCount, methods };
}

/**
 * Multivariate outlier screen (Mahalanobis + isolation forest) run
 * pooled and within each cohort, with the same group-aware rule as
 * detectOutliers: pooled-only flags explained by the cohort are
 * reported separately, never as errors.
 */
export function detectMultivariateOutliers(
  rows: readonly StatRow[],
  variables: Array<(row: StatRow) => number | null>,
  options: { seed: number; contamination: number; nTrees?: number; subSampleSize?: number },
): { flags: OutlierFlag[]; explainedByGroup: OutlierFlag[]; mahalanobis: MahalanobisResult; forest: IsolationForestResult } {
  const cohortKey = (row: StatRow): string =>
    `${row.formulaType ?? "(not recorded)"} | ${row.amendmentCohort ?? "(not recorded)"}`;
  const matrix = rows.map((r) => variables.map((f) => f(r)));
  const cleanMatrix = matrix.filter((row) => row.every((v) => v !== null)) as number[][];
  const cleanKeys = rows.filter((_, i) => matrix[i]?.every((v) => v !== null)).map((r) => r.participantKey);
  const mahalanobis = mahalanobisOutliers(matrix, { robust: true });
  const forest =
    cleanMatrix.length === 0
      ? { scores: [], threshold: 0, flagged: [], contamination: options.contamination, nTrees: 0, subSampleSize: 0, seed: options.seed }
      : isolationForest(cleanMatrix, {
          nTrees: options.nTrees ?? 100,
          subSampleSize: options.subSampleSize ?? Math.min(256, cleanMatrix.length),
          seed: options.seed,
          contamination: options.contamination,
        });
  const flags: OutlierFlag[] = [];
  const explainedByGroup: OutlierFlag[] = [];
  // Within-cohort Mahalanobis: a participant flagged pooled by either
  // method but not within-cohort is a group difference.
  const withinFlagged = new Set<string>();
  const cohorts = new Map<string, StatRow[]>();
  for (const row of rows) {
    const key = cohortKey(row);
    const bucket = cohorts.get(key);
    if (bucket === undefined) cohorts.set(key, [row]);
    else bucket.push(row);
  }
  for (const [cohort, bucket] of cohorts) {
    if (bucket.length < 6) continue;
    const subMatrix = bucket.map((r) => variables.map((f) => f(r)));
    const sub = mahalanobisOutliers(subMatrix, { robust: true });
    bucket.forEach((row, j) => {
      if (sub.flagged[j] === true) {
        withinFlagged.add(row.participantKey);
        flags.push({
          participantKey: row.participantKey,
          method: "modified-z",
          scope: "within-cohort",
          score: sub.distances[j] ?? null,
          threshold: sub.threshold,
          cohort,
          note: "Mahalanobis distance beyond the chi-square threshold within its own cohort — investigate, never auto-correct.",
        });
      }
    });
  }
  rows.forEach((row, i) => {
    const pooledFlag = mahalanobis.flagged[i] === true;
    const forestIdx = cleanKeys.indexOf(row.participantKey);
    const forestFlag = forestIdx >= 0 && forest.flagged[forestIdx] === true;
    if (!pooledFlag && !forestFlag) return;
    if (withinFlagged.has(row.participantKey)) return;
    const cohortSize = cohorts.get(cohortKey(row))?.length ?? 0;
    if (cohortSize >= 6) {
      explainedByGroup.push({
        participantKey: row.participantKey,
        method: "modified-z",
        scope: "pooled",
        score: mahalanobis.distances[i] ?? null,
        threshold: mahalanobis.threshold,
        cohort: cohortKey(row),
        note: "Pooled multivariate flag explained by the participant's cohort — a legitimate group difference, not an error.",
      });
    } else {
      flags.push({
        participantKey: row.participantKey,
        method: "modified-z",
        scope: "pooled",
        score: mahalanobis.distances[i] ?? null,
        threshold: mahalanobis.threshold,
        cohort: cohortKey(row),
        note: "Pooled multivariate flag; cohort too small for a within-cohort screen.",
      });
    }
  });
  return { flags, explainedByGroup, mahalanobis, forest };
}

// ---------------------------------------------------------------------------
// §3.3 Multivariate modeling
//
// Models answer "what predicts the discrepancy?" and "which participants
// look like known problem patterns?" — never "what is the correct
// benefit?" A coefficient is a pattern in the data; it becomes an
// actuarial finding only when a plan document, amendment, or valuation
// report explains it. The model proposes; the documents dispose.
//
// LEAKAGE GUARD: no predictor may be derived from B_i^PA, B̂_i, Δ_i, D_i
// or R_i. buildModelData refuses such predictors. Overfitting guard:
// k-fold cross-validation (grouped by cohort where cohorts are the
// generalisation unit), regularisation/pruning for flexible models, and
// a sample-size rule (~10 observations per predictor; small cohorts get
// descriptive treatment only).
// ---------------------------------------------------------------------------

/** Numeric predictors a model may use. Categorical groupings
 *  (employment group, formula type, amendment cohort) enter the
 *  mixed-effects model as groups and the tree as one-hot columns built
 *  by the caller — never as a free-text string in a regression. */
export const ALLOWED_PREDICTORS = [
  "ageYears",
  "serviceYears",
  "compensationDollars",
  "dataCompleteness",
  "monthsSinceRecorded",
  "employmentPeriods",
  "qdro",
  "priorDistribution",
] as const;
export type PredictorName = (typeof ALLOWED_PREDICTORS)[number];

/** Predictor names that leak the outcome: any variable derived from
 *  B_i^PA, B̂_i, Δ_i, D_i or R_i. A model given one is refused. */
export const LEAKED_PREDICTOR_NAMES: readonly string[] = [
  "paAmbMinor",
  "paAmb",
  "reconstructedMinor",
  "reconstructed",
  "deltaMinor",
  "absDeltaMinor",
  "relDelta",
  "benefit",
  "delta",
];

export type OutcomeName = "deltaDollars" | "absDeltaDollars" | "relDelta";

export interface ModelData {
  keys: string[];
  /** Outcome in dollars (delta/absDelta) or as a plain ratio (relDelta). */
  y: number[];
  /** Design rows, one column per predictor, in predictorNames order. */
  x: number[][];
  predictorNames: PredictorName[];
  groups: (string | null)[];
}

export type ModelDataResult =
  | { kind: "ready"; data: ModelData }
  | { kind: "refused"; reason: string; n: number; predictors: number; required: number };

function numericPredictor(row: StatRow, name: PredictorName): number | null {
  switch (name) {
    case "ageYears":
      return row.ageYears;
    case "serviceYears":
      return row.serviceYears;
    case "compensationDollars":
      return row.compensationMinor === null ? null : row.compensationMinor / 100;
    case "dataCompleteness":
      return row.dataCompleteness;
    case "monthsSinceRecorded":
      return row.monthsSinceRecorded;
    case "employmentPeriods":
      return row.employmentPeriods;
    case "qdro":
      return row.qdro ? 1 : 0;
    case "priorDistribution":
      return row.priorDistribution ? 1 : 0;
  }
}

function outcomeValue(row: StatRow, outcome: OutcomeName): number | null {
  switch (outcome) {
    case "deltaDollars":
      return row.deltaMinor === null ? null : row.deltaMinor / 100;
    case "absDeltaDollars":
      return row.absDeltaMinor === null ? null : row.absDeltaMinor / 100;
    case "relDelta":
      return row.relDelta === null ? null : Number(row.relDelta);
  }
}

/**
 * Build a modelling dataset with the leakage and sample-size guards.
 * - Refuses any predictor in LEAKED_PREDICTOR_NAMES or outside
 *   ALLOWED_PREDICTORS (a leaked variable must be refused, never
 *   silently dropped — the caller must see the refusal).
 * - Refuses when n < 10 observations per predictor (Stage 1 output 03,
 *   §3.3): small cohorts get descriptive treatment only.
 * - Rows missing the outcome or any predictor are excluded and counted.
 */
export function buildModelData(
  rows: readonly StatRow[],
  args: { outcome: OutcomeName; predictors: readonly string[]; groupKey?: (row: StatRow) => string | null },
): ModelDataResult & { excludedMissing: number } {
  for (const name of args.predictors) {
    if (LEAKED_PREDICTOR_NAMES.includes(name)) {
      return {
        kind: "refused",
        reason: `Leakage guard: predictor "${name}" is derived from the recorded benefit, the reconstruction, or the discrepancy itself and must not predict it.`,
        n: rows.length,
        predictors: args.predictors.length,
        required: args.predictors.length * MIN_OBS_PER_PREDICTOR,
        excludedMissing: 0,
      };
    }
    if (!(ALLOWED_PREDICTORS as readonly string[]).includes(name)) {
      return {
        kind: "refused",
        reason: `Unknown predictor "${name}". Allowed predictors: ${ALLOWED_PREDICTORS.join(", ")}.`,
        n: rows.length,
        predictors: args.predictors.length,
        required: args.predictors.length * MIN_OBS_PER_PREDICTOR,
        excludedMissing: 0,
      };
    }
  }
  const names = args.predictors as PredictorName[];
  const keys: string[] = [];
  const y: number[] = [];
  const x: number[][] = [];
  const groups: (string | null)[] = [];
  let excludedMissing = 0;
  for (const row of rows) {
    const yv = outcomeValue(row, args.outcome);
    const xv = names.map((n) => numericPredictor(row, n));
    if (yv === null || xv.some((v) => v === null)) {
      excludedMissing += 1;
      continue;
    }
    keys.push(row.participantKey);
    y.push(yv);
    x.push(xv as number[]);
    groups.push(args.groupKey === undefined ? null : args.groupKey(row));
  }
  const required = names.length * MIN_OBS_PER_PREDICTOR;
  if (y.length < required) {
    return {
      kind: "refused",
      reason: `Underpowered: ${y.length} complete observations for ${names.length} predictor(s); at least ${required} (≈10 per predictor) are required. Use descriptive treatment only.`,
      n: y.length,
      predictors: names.length,
      required,
      excludedMissing,
    };
  }
  return { kind: "ready", data: { keys, y, x, predictorNames: names, groups }, excludedMissing };
}

/** Add an intercept column to a design matrix. */
function withIntercept(x: readonly (readonly number[])[]): number[][] {
  return x.map((row) => [1, ...row]);
}

/** Solve A·β = b by Gauss–Jordan; null when A is singular. */
function solveLinear(a: readonly (readonly number[])[], b: readonly number[]): number[] | null {
  const n = a.length;
  const aug: number[][] = a.map((row, i) => [...row, b[i] ?? 0]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(aug[r]?.[col] ?? 0) > Math.abs(aug[pivot]?.[col] ?? 0)) pivot = r;
    }
    if (Math.abs(aug[pivot]?.[col] ?? 0) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivot] as number[];
      aug[pivot] = tmp as number[];
    }
    const pivotVal = aug[col]?.[col] as number;
    for (let j = col; j <= n; j += 1) aug[col]![j] = (aug[col]?.[j] ?? 0) / pivotVal;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = aug[r]?.[col] ?? 0;
      if (factor === 0) continue;
      for (let j = col; j <= n; j += 1) aug[r]![j] = (aug[r]?.[j] ?? 0) - factor * (aug[col]?.[j] ?? 0);
    }
  }
  return aug.map((row) => row[n] ?? 0);
}

export interface FitSummary {
  n: number;
  p: number;
  r2: number | null;
  adjR2: number | null;
  rmse: number;
  mae: number;
}

export function fitSummary(y: readonly number[], fitted: readonly number[], p: number): FitSummary {
  const n = y.length;
  const residuals = y.map((v, i) => v - (fitted[i] ?? 0));
  const ssr = residuals.reduce((s, r) => s + r * r, 0);
  const mean = meanOf(y) ?? 0;
  const sst = y.reduce((s, v) => s + (v - mean) * (v - mean), 0);
  const r2 = sst === 0 ? null : 1 - ssr / sst;
  return {
    n,
    p,
    r2,
    adjR2: r2 === null || n <= p ? null : 1 - (1 - r2) * ((n - 1) / (n - p)),
    rmse: Math.sqrt(ssr / Math.max(1, n)),
    mae: residuals.reduce((s, r) => s + Math.abs(r), 0) / Math.max(1, n),
  };
}

/** Ordinary least squares via the normal equations. Throws on a
 *  singular design (collinear predictors) — a construction error, not
 *  a result. */
export function fitOls(data: ModelData): {
  coefficients: number[];
  fitted: number[];
  residuals: number[];
  standardErrors: number[];
  summary: FitSummary;
} {
  const X = withIntercept(data.x);
  const Xt = matTranspose(X);
  const XtX = matMul(Xt, X);
  const XtXInv = matrixInverse(XtX);
  if (XtXInv === null) throw new Error("fitOls: singular design matrix (collinear predictors)");
  const XtY = matVecMul(Xt, data.y);
  const beta = matVecMul(XtXInv, XtY);
  const fitted = X.map((row) => row.reduce((s, v, j) => s + v * (beta[j] ?? 0), 0));
  const residuals = data.y.map((v, i) => v - (fitted[i] ?? 0));
  const p = X[0]?.length ?? 0;
  const ssr = residuals.reduce((s, r) => s + r * r, 0);
  const sigma2 = ssr / Math.max(1, data.y.length - p);
  const standardErrors = XtXInv.map((row, i) => Math.sqrt(Math.max(0, sigma2 * (row[i] ?? 0))));
  return { coefficients: beta, fitted, residuals, standardErrors, summary: fitSummary(data.y, fitted, p) };
}

/** Weighted least squares with the given per-row weights. */
function fitWeightedLs(x: readonly (readonly number[])[], y: readonly number[], weights: readonly number[]): number[] | null {
  const X = withIntercept(x);
  const XtW: number[][] = X.map((row, i) => row.map((v) => v * (weights[i] ?? 0)));
  const XtWX = matMul(matTranspose(XtW), X);
  const XtWY = matVecMul(matTranspose(XtW), y);
  return solveLinear(XtWX, XtWY);
}

export interface HuberResult {
  coefficients: number[];
  fitted: number[];
  residuals: number[];
  /** Approximate robust standard errors (scale × √diag((X′WX)⁻¹)). */
  robustStandardErrors: number[];
  scale: number;
  iterations: number;
  converged: boolean;
  summary: FitSummary;
}

/**
 * Huber robust regression (Huber M-estimation; Huber, 1981/2009) by
 * iteratively reweighted least squares, tuning constant k = 1.345.
 * Resistant to the outliers being investigated. The residual scale is
 * 1.4826 × MAD of the residuals, re-estimated each iteration.
 */
export function fitHuber(
  data: ModelData,
  options: { tuning?: number; maxIterations?: number; tolerance?: number } = {},
): HuberResult {
  const k = options.tuning ?? HUBER_TUNING_CONSTANT;
  const maxIterations = options.maxIterations ?? 50;
  const tolerance = options.tolerance ?? 1e-8;
  const ols = fitOls(data);
  let beta = [...ols.coefficients];
  let scale = 1;
  let converged = false;
  let iterations = 0;
  for (let iter = 0; iter < maxIterations; iter += 1) {
    iterations = iter + 1;
    const fitted = withIntercept(data.x).map((row) => row.reduce((s, v, j) => s + v * (beta[j] ?? 0), 0));
    const residuals = data.y.map((v, i) => v - (fitted[i] ?? 0));
    const med = medianOf(residuals) ?? 0;
    const mad = medianOf(residuals.map((r) => Math.abs(r - med))) ?? 0;
    scale = mad === 0 ? sampleSd(residuals) ?? 1 : 1.4826 * mad;
    if (scale === 0) scale = 1;
    const weights = residuals.map((r) => {
      const u = Math.abs(r) / (k * scale);
      return u <= 1 ? 1 : 1 / u;
    });
    const next = fitWeightedLs(data.x, data.y, weights);
    if (next === null) throw new Error("fitHuber: singular weighted design matrix");
    const maxChange = Math.max(...next.map((v, j) => Math.abs(v - (beta[j] ?? 0))));
    beta = next;
    if (maxChange < tolerance) {
      converged = true;
      break;
    }
  }
  const X = withIntercept(data.x);
  const fitted = X.map((row) => row.reduce((s, v, j) => s + v * (beta[j] ?? 0), 0));
  const residuals = data.y.map((v, i) => v - (fitted[i] ?? 0));
  const med = medianOf(residuals) ?? 0;
  const mad = medianOf(residuals.map((r) => Math.abs(r - med))) ?? 0;
  scale = mad === 0 ? sampleSd(residuals) ?? 1 : 1.4826 * mad;
  if (scale === 0) scale = 1;
  const weights = residuals.map((r) => {
    const u = Math.abs(r) / (k * scale);
    return u <= 1 ? 1 : 1 / u;
  });
  const XtW: number[][] = X.map((row, i) => row.map((v) => v * (weights[i] ?? 0)));
  const XtWXInv = matrixInverse(matMul(matTranspose(XtW), X));
  const robustStandardErrors =
    XtWXInv === null
      ? beta.map(() => NaN)
      : XtWXInv.map((row, i) => scale * Math.sqrt(Math.max(0, row[i] ?? 0)));
  return {
    coefficients: beta,
    fitted,
    residuals,
    robustStandardErrors,
    scale,
    iterations,
    converged,
    summary: fitSummary(data.y, fitted, X[0]?.length ?? 0),
  };
}

// --- Cross-validation (k-fold; grouped by cohort where given) ---

/**
 * Deterministic k-fold indices. When `groups` is supplied, whole groups
 * are assigned round-robin to folds (grouped folds: cohorts are the
 * generalisation unit, so a cohort never appears in both train and
 * test). Otherwise the indices are seeded-shuffled and chunked.
 */
export function kFoldIndices(
  n: number,
  k: number,
  seed: number,
  groups?: readonly (string | null)[],
): number[][] {
  if (k < 2) throw new Error(`kFoldIndices: k must be >= 2; got ${k}`);
  if (groups !== undefined) {
    const byGroup = new Map<string, number[]>();
    groups.forEach((g, i) => {
      const key = g ?? "(none)";
      const bucket = byGroup.get(key);
      if (bucket === undefined) byGroup.set(key, [i]);
      else bucket.push(i);
    });
    const folds: number[][] = Array.from({ length: k }, () => []);
    const names = [...byGroup.keys()].sort();
    names.forEach((name, gi) => {
      const bucket = byGroup.get(name) ?? [];
      folds[gi % k]?.push(...bucket);
    });
    return folds;
  }
  const shuffled = seededShuffle(Array.from({ length: n }, (_, i) => i), mulberry32(seed));
  const folds: number[][] = Array.from({ length: k }, () => []);
  shuffled.forEach((idx, pos) => {
    folds[pos % k]?.push(idx);
  });
  return folds;
}

/**
 * Generic k-fold cross-validated RMSE/MAE. `fitPredict` fits on the
 * train indices and returns predictions for the test indices.
 * In-sample fit alone is never reported as evidence.
 */
export function crossValidate(
  data: ModelData,
  fitPredict: (train: readonly number[], test: readonly number[]) => number[],
  options: { k?: number; seed?: number; grouped?: boolean },
): { rmse: number; mae: number; perFoldRmse: number[] } {
  const k = options.k ?? 5;
  const folds = kFoldIndices(data.y.length, k, options.seed ?? 20261112, options.grouped === true ? data.groups : undefined);
  const perFoldRmse: number[] = [];
  let ss = 0;
  let abs = 0;
  let count = 0;
  for (let f = 0; f < k; f += 1) {
    const test = folds[f] ?? [];
    if (test.length === 0) continue;
    const train = folds.flatMap((fold, fi) => (fi === f ? [] : fold));
    const preds = fitPredict(train, test);
    let foldSs = 0;
    test.forEach((idx, j) => {
      const err = (data.y[idx] ?? 0) - (preds[j] ?? 0);
      foldSs += err * err;
      ss += err * err;
      abs += Math.abs(err);
      count += 1;
    });
    perFoldRmse.push(Math.sqrt(foldSs / test.length));
  }
  return { rmse: Math.sqrt(ss / Math.max(1, count)), mae: abs / Math.max(1, count), perFoldRmse };
}

function subsetModelData(data: ModelData, indices: readonly number[]): ModelData {
  return {
    keys: indices.map((i) => data.keys[i] ?? ""),
    y: indices.map((i) => data.y[i] ?? 0),
    x: indices.map((i) => data.x[i] ?? []),
    predictorNames: data.predictorNames,
    groups: indices.map((i) => data.groups[i] ?? null),
  };
}

function predictWith(beta: readonly number[], x: readonly (readonly number[])[]): number[] {
  return x.map((row) => {
    let s = beta[0] ?? 0;
    row.forEach((v, j) => {
      s += v * (beta[j + 1] ?? 0);
    });
    return s;
  });
}

// --- Regularized regression: ridge + lasso ---

function centerScale(
  x: readonly (readonly number[])[],
  y: readonly number[],
): { xCentered: number[][]; yCentered: number[]; xMean: number[]; xSd: number[]; yMean: number } {
  const p = x[0]?.length ?? 0;
  const xMean = Array.from({ length: p }, (_, j) => meanOf(x.map((r) => r[j] ?? 0)) ?? 0);
  const xSd = Array.from({ length: p }, (_, j) => sampleSd(x.map((r) => r[j] ?? 0)) ?? 1);
  const yMean = meanOf(y) ?? 0;
  return {
    xCentered: x.map((row) => row.map((v, j) => (v - xMean[j]!) / (xSd[j] === 0 ? 1 : xSd[j]!))),
    yCentered: y.map((v) => v - yMean),
    xMean,
    xSd: xSd.map((s) => (s === 0 ? 1 : s)),
    yMean,
  };
}

export interface RidgeResult {
  coefficients: number[];
  intercept: number;
  lambda: number;
  fitted: number[];
  residuals: number[];
  summary: FitSummary;
}

/**
 * Ridge regression (penalised least squares). Coefficients are shrunken
 * — do not interpret them as actuarial effects; ridge is for screening
 * and stabilisation, not for benefit formulas.
 */
export function fitRidge(data: ModelData, lambda: number): RidgeResult {
  const { xCentered, yCentered, xMean, xSd, yMean } = centerScale(data.x, data.y);
  const p = xCentered[0]?.length ?? 0;
  const Xt = matTranspose(xCentered);
  const XtX = matMul(Xt, xCentered);
  for (let i = 0; i < p; i += 1) {
    const row = XtX[i] as number[];
    row[i] = (row[i] ?? 0) + lambda;
  }
  const XtY = matVecMul(Xt, yCentered);
  const betaStd = solveLinear(XtX, XtY);
  if (betaStd === null) throw new Error("fitRidge: singular penalised design");
  const coefficients = betaStd.map((b, j) => b / (xSd[j] ?? 1));
  const intercept = yMean - coefficients.reduce((s, b, j) => s + b * (xMean[j] ?? 0), 0);
  const fitted = predictWith([intercept, ...coefficients], data.x);
  const residuals = data.y.map((v, i) => v - (fitted[i] ?? 0));
  return { coefficients, intercept, lambda, fitted, residuals, summary: fitSummary(data.y, fitted, p + 1) };
}

/**
 * Penalty-selection rule (stated, not hidden): λ is chosen by k-fold
 * cross-validation over the supplied grid, minimising CV RMSE. The
 * full CV curve is returned so the actuary can see whether the choice
 * is sharp or flat.
 */
export function selectRidgePenalty(
  data: ModelData,
  lambdas: readonly number[],
  options: { k?: number; seed?: number; grouped?: boolean },
): { lambda: number; cvRmseByLambda: Array<{ lambda: number; cvRmse: number }>; bestCvRmse: number } {
  const curve = lambdas.map((lambda) => {
    const cv = crossValidate(
      data,
      (train, test) => {
        const fit = fitRidge(subsetModelData(data, train), lambda);
        return predictWith([fit.intercept, ...fit.coefficients], test.map((i) => data.x[i] ?? []));
      },
      options,
    );
    return { lambda, cvRmse: cv.rmse };
  });
  let best = curve[0];
  for (const entry of curve) {
    if (best === undefined || entry.cvRmse < best.cvRmse) best = entry;
  }
  if (best === undefined) throw new Error("selectRidgePenalty: empty lambda grid");
  return { lambda: best.lambda, cvRmseByLambda: curve, bestCvRmse: best.cvRmse };
}

export interface LassoResult {
  coefficients: number[];
  intercept: number;
  lambda: number;
  fitted: number[];
  residuals: number[];
  selectedPredictors: string[];
  iterations: number;
  summary: FitSummary;
}

/**
 * Lasso by deterministic coordinate descent (standardized predictors,
 * intercept unpenalised). Predictors shrunk to exactly zero are dropped
 * — lasso is a screening device, not an effect estimator.
 */
export function fitLasso(
  data: ModelData,
  lambda: number,
  options: { maxIterations?: number; tolerance?: number } = {},
): LassoResult {
  const maxIterations = options.maxIterations ?? 200;
  const tolerance = options.tolerance ?? 1e-8;
  const { xCentered, yCentered, xMean, xSd, yMean } = centerScale(data.x, data.y);
  const p = xCentered[0]?.length ?? 0;
  const n = data.y.length;
  let beta = Array.from({ length: p }, () => 0);
  let iterations = 0;
  for (let iter = 0; iter < maxIterations; iter += 1) {
    iterations = iter + 1;
    let maxChange = 0;
    for (let j = 0; j < p; j += 1) {
      // Partial residual excluding predictor j.
      let rho = 0;
      for (let i = 0; i < n; i += 1) {
        const row = xCentered[i] ?? [];
        let predWithoutJ = 0;
        for (let k = 0; k < p; k += 1) {
          if (k !== j) predWithoutJ += (row[k] ?? 0) * (beta[k] ?? 0);
        }
        rho += (row[j] ?? 0) * ((yCentered[i] ?? 0) - predWithoutJ);
      }
      const denom = xCentered.reduce((s, row) => s + (row[j] ?? 0) * (row[j] ?? 0), 0);
      const next = denom === 0 ? 0 : (Math.abs(rho) <= lambda ? 0 : (rho - Math.sign(rho) * lambda) / denom);
      maxChange = Math.max(maxChange, Math.abs(next - (beta[j] ?? 0)));
      beta[j] = next;
    }
    if (maxChange < tolerance) break;
  }
  const coefficients = beta.map((b, j) => b / (xSd[j] ?? 1));
  const intercept = yMean - coefficients.reduce((s, b, j) => s + b * (xMean[j] ?? 0), 0);
  const fitted = predictWith([intercept, ...coefficients], data.x);
  const residuals = data.y.map((v, i) => v - (fitted[i] ?? 0));
  return {
    coefficients,
    intercept,
    lambda,
    fitted,
    residuals,
    selectedPredictors: data.predictorNames.filter((_, j) => Math.abs(coefficients[j] ?? 0) > 0),
    iterations,
    summary: fitSummary(data.y, fitted, p + 1),
  };
}

// --- GAM: linear splines (hinge basis) with a ridge penalty ---

export interface GamResult {
  /** Coefficients on [intercept, linear terms…, hinge terms…]. */
  coefficients: number[];
  fitted: number[];
  residuals: number[];
  /** Knot locations per smoothed predictor (quantiles of that predictor). */
  knots: Record<string, number[]>;
  /** Number of interior knots per smoothed predictor. */
  knotsPerTerm: number;
  /** Ridge penalty applied to the hinge (nonlinear) coefficients. */
  lambda: number;
  summary: FitSummary;
  cvRmse: number | null;
}

/**
 * Generalized additive model (Hastie & Tibshirani, 1990; Wood, 2017)
 * as a linear spline: each smoothed predictor contributes a linear term
 * plus hinge terms (x − knot)₊ at interior knots placed at quantiles.
 * The hinge coefficients carry a ridge penalty λ (smoothness choice,
 * recorded in the result). A GAM that fits a cap as a smooth curve has
 * not "discovered" the cap — the cap is a plan rule.
 */
export function fitGam(
  data: ModelData,
  options: { smoothPredictors: readonly string[]; knotsPerTerm?: number; lambda?: number; cvFolds?: number; seed?: number },
): GamResult {
  const knotsPerTerm = options.knotsPerTerm ?? 4;
  const lambda = options.lambda ?? 1;
  const smoothIdx = options.smoothPredictors.map((name) => {
    const idx = data.predictorNames.indexOf(name as PredictorName);
    if (idx === -1) throw new Error(`fitGam: smooth predictor "${name}" is not in the model`);
    return idx;
  });
  // Knots at interior quantiles of each smoothed predictor.
  const knots: Record<string, number[]> = {};
  const knotValues: number[][] = [];
  for (const idx of smoothIdx) {
    const vals = data.x.map((row) => row[idx] ?? 0);
    const ks: number[] = [];
    for (let q = 1; q <= knotsPerTerm; q += 1) {
      const kv = quantile(vals, q / (knotsPerTerm + 1));
      if (kv !== null && !ks.includes(kv)) ks.push(kv);
    }
    knots[data.predictorNames[idx] as string] = ks;
    knotValues.push(ks);
  }
  const expand = (row: readonly number[]): number[] => {
    const out: number[] = [1, ...row];
    smoothIdx.forEach((idx, t) => {
      for (const knot of knotValues[t] ?? []) {
        out.push(Math.max(0, (row[idx] ?? 0) - knot));
      }
    });
    return out;
  };
  const X = data.x.map(expand);
  const nHinge = X[0]?.length ?? 0;
  const Xt = matTranspose(X);
  const XtX = matMul(Xt, X);
  // Penalise hinge coefficients only (indices >= 1 + p), never the
  // intercept or the linear terms.
  const p = data.predictorNames.length;
  for (let i = 1 + p; i < nHinge; i += 1) {
    const row = XtX[i] as number[];
    row[i] = (row[i] ?? 0) + lambda;
  }
  const XtY = matVecMul(Xt, data.y);
  const beta = solveLinear(XtX, XtY);
  if (beta === null) throw new Error("fitGam: singular penalised design");
  const fitted = X.map((row) => row.reduce((s, v, j) => s + v * (beta[j] ?? 0), 0));
  const residuals = data.y.map((v, i) => v - (fitted[i] ?? 0));
  let cvRmse: number | null = null;
  if (options.cvFolds !== undefined && options.cvFolds >= 2) {
    const cv = crossValidate(
      data,
      (train, test) => {
        const sub = subsetModelData(data, train);
        const fit = fitGam(sub, { ...options, cvFolds: undefined });
        // Re-expand the test rows with the sub-fit's knots: rebuild the
        // expansion from the sub-fit's stored knots.
        const testX = test.map((i) => {
          const row = data.x[i] ?? [];
          const out: number[] = [1, ...row];
          smoothIdx.forEach((idx, t) => {
            const ks = fit.knots[data.predictorNames[idx] as string] ?? [];
            for (const knot of ks) out.push(Math.max(0, (row[idx] ?? 0) - knot));
          });
          return out;
        });
        return testX.map((row) => row.reduce((s, v, j) => s + v * (fit.coefficients[j] ?? 0), 0));
      },
      { k: options.cvFolds, seed: options.seed ?? 20261112 },
    );
    cvRmse = cv.rmse;
  }
  return {
    coefficients: beta,
    fitted,
    residuals,
    knots,
    knotsPerTerm,
    lambda,
    summary: fitSummary(data.y, fitted, nHinge),
    cvRmse,
  };
}

// --- Mixed-effects / hierarchical: random intercepts by cohort ---

export interface MixedEffectsResult {
  fixedCoefficients: number[];
  /** Shrunken (partially pooled) group intercepts. */
  groupIntercepts: Record<string, number>;
  groupSizes: Record<string, number>;
  /** Between-group variance τ² and within-group variance σ². */
  tau2: number;
  sigma2: number;
  /** Intraclass correlation τ²/(τ²+σ²). */
  icc: number;
  fitted: number[];
  residuals: number[];
  summary: FitSummary;
}

/**
 * Mixed-effects model with a random intercept per cohort (Gelman &
 * Hill, 2007), by method of moments with partial pooling: a small
 * cohort's intercept is shrunk toward the overall mean in proportion
 * to τ²/(τ² + σ²/n_j). Random effects are descriptive grouping, not
 * evidence about any individual participant.
 */
export function fitMixedEffects(data: ModelData): MixedEffectsResult {
  const ols = fitOls(data);
  const residuals = ols.residuals;
  const groups = new Map<string, number[]>();
  data.groups.forEach((g, i) => {
    const key = g ?? "(none)";
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [i]);
    else bucket.push(i);
  });
  const groupNames = [...groups.keys()].sort();
  const J = groupNames.length;
  const n = data.y.length;
  // Within-group variance: residuals around their group means.
  let withinSs = 0;
  const groupMeans: Record<string, number> = {};
  const groupSizes: Record<string, number> = {};
  for (const name of groupNames) {
    const idx = groups.get(name) ?? [];
    groupSizes[name] = idx.length;
    const m = meanOf(idx.map((i) => residuals[i] ?? 0)) ?? 0;
    groupMeans[name] = m;
    for (const i of idx) withinSs += ((residuals[i] ?? 0) - m) * ((residuals[i] ?? 0) - m);
  }
  const sigma2 = n - J > 0 ? withinSs / (n - J) : 0;
  // Between-group mean square and the n0 divisor (unbalanced groups).
  let msbNumerator = 0;
  let sumSqN = 0;
  for (const name of groupNames) {
    const nj = groupSizes[name] ?? 0;
    msbNumerator += nj * (groupMeans[name] ?? 0) * (groupMeans[name] ?? 0);
    sumSqN += nj * nj;
  }
  const msb = J > 1 ? msbNumerator / (J - 1) : 0;
  const n0 = J > 1 ? (n - sumSqN / n) / (J - 1) : 0;
  const tau2 = n0 > 0 ? Math.max(0, (msb - sigma2) / n0) : 0;
  const groupIntercepts: Record<string, number> = {};
  for (const name of groupNames) {
    const nj = groupSizes[name] ?? 0;
    const shrink = tau2 + sigma2 / Math.max(1, nj) === 0 ? 0 : tau2 / (tau2 + sigma2 / Math.max(1, nj));
    groupIntercepts[name] = shrink * (groupMeans[name] ?? 0);
  }
  const fitted = data.y.map((_, i) => {
    const g = data.groups[i] ?? "(none)";
    return (ols.fitted[i] ?? 0) + (groupIntercepts[g] ?? 0);
  });
  const fittedResiduals = data.y.map((v, i) => v - (fitted[i] ?? 0));
  return {
    fixedCoefficients: ols.coefficients,
    groupIntercepts,
    groupSizes,
    tau2,
    sigma2,
    icc: tau2 + sigma2 === 0 ? 0 : tau2 / (tau2 + sigma2),
    fitted,
    residuals: fittedResiduals,
    summary: fitSummary(data.y, fitted, ols.coefficients.length + J),
  };
}

// --- Bayesian linear model: closed-form conjugate posterior ---

export interface BayesianPrior {
  /** Prior mean for each coefficient (intercept first). */
  mean: number[];
  /** Prior SD for each coefficient (intercept first). */
  sd: number[];
  /** Known residual variance σ², or null to estimate it from OLS
   *  residuals (stated in the result when estimated). */
  sigma2: number | null;
  /** What justifies this prior — a labelled case-set parameter, never
   *  an invented universal default. */
  basis: string;
}

export interface BayesianResult {
  posteriorMean: number[];
  posteriorSd: number[];
  /** 95% credible intervals (mean ± 1.96·SD). */
  credibleInterval95: Array<[number, number]>;
  sigma2: number;
  sigma2Estimated: boolean;
  priorBasis: string;
  /** Max |Δ coefficient| when the prior SD is doubled and halved. */
  priorSensitivity: { sdDoubledMaxChange: number; sdHalvedMaxChange: number };
  fitted: number[];
  summary: FitSummary;
}

function bayesianFit(data: ModelData, prior: BayesianPrior): { mean: number[]; sd: number[]; fitted: number[]; sigma2: number } {
  const X = withIntercept(data.x);
  const p = X[0]?.length ?? 0;
  if (prior.mean.length !== p || prior.sd.length !== p) {
    throw new Error(`bayesianFit: prior must have ${p} entries (intercept + predictors); got mean=${prior.mean.length}, sd=${prior.sd.length}`);
  }
  let sigma2 = prior.sigma2;
  let estimated = false;
  if (sigma2 === null) {
    const ols = fitOls(data);
    const ssr = ols.residuals.reduce((s, r) => s + r * r, 0);
    sigma2 = ssr / Math.max(1, data.y.length - p);
    estimated = true;
  }
  const Xt = matTranspose(X);
  const XtX = matMul(Xt, X);
  const precision: number[][] = XtX.map((row, i) =>
    row.map((v, j) => v / (sigma2 as number) + (i === j ? 1 / ((prior.sd[i] ?? 1) * (prior.sd[i] ?? 1)) : 0)),
  );
  const XtY = matVecMul(Xt, data.y);
  const rhs = XtY.map((v, i) => v / (sigma2 as number) + (prior.mean[i] ?? 0) / ((prior.sd[i] ?? 1) * (prior.sd[i] ?? 1)));
  const cov = matrixInverse(precision);
  if (cov === null) throw new Error("bayesianFit: singular posterior precision");
  const mean = matVecMul(cov, rhs);
  const sd = cov.map((row, i) => Math.sqrt(Math.max(0, row[i] ?? 0)));
  const fitted = X.map((row) => row.reduce((s, v, j) => s + v * (mean[j] ?? 0), 0));
  void estimated;
  return { mean, sd, fitted, sigma2: sigma2 as number };
}

/**
 * Bayesian linear model (conjugate normal prior, known or
 * OLS-estimated σ²) by closed-form posterior — no MCMC, no unseeded
 * randomness. The prior is caller-supplied with a stated basis; a prior
 * is an assumption, not a fact, so sensitivity to doubling/halving the
 * prior SD is always reported.
 */
export function fitBayesian(data: ModelData, prior: BayesianPrior): BayesianResult {
  const fit = bayesianFit(data, prior);
  const doubled: BayesianPrior = { ...prior, sd: prior.sd.map((s) => s * 2) };
  const halved: BayesianPrior = { ...prior, sd: prior.sd.map((s) => s / 2) };
  const fitDoubled = bayesianFit(data, doubled);
  const fitHalved = bayesianFit(data, halved);
  const maxChange = (other: number[]): number =>
    Math.max(...fit.mean.map((v, j) => Math.abs(v - (other[j] ?? 0))));
  return {
    posteriorMean: fit.mean,
    posteriorSd: fit.sd,
    credibleInterval95: fit.mean.map((m, j) => [m - 1.96 * (fit.sd[j] ?? 0), m + 1.96 * (fit.sd[j] ?? 0)] as [number, number]),
    sigma2: fit.sigma2,
    sigma2Estimated: prior.sigma2 === null,
    priorBasis: prior.basis,
    priorSensitivity: {
      sdDoubledMaxChange: maxChange(fitDoubled.mean),
      sdHalvedMaxChange: maxChange(fitHalved.mean),
    },
    fitted: fit.fitted,
    summary: fitSummary(data.y, fit.fitted, fit.mean.length),
  };
}

// --- Interpretable classification: small decision tree / rule list ---

export type TreeNode =
  | { kind: "leaf"; prediction: 0 | 1; count: number; positives: number }
  | {
      kind: "split";
      predictor: string;
      predictorIndex: number;
      threshold: number;
      left: TreeNode;
      right: TreeNode;
      count: number;
      positives: number;
    };

export interface DecisionTreeResult {
  tree: TreeNode;
  /** Human-readable rules, one per leaf, in rule-list form. */
  rules: string[];
  depth: number;
  minLeaf: number;
  trainAccuracy: number;
  validationAccuracy: number | null;
  predictors: string[];
}

function gini(labels: readonly number[]): number {
  if (labels.length === 0) return 0;
  const p = labels.reduce((s, v) => s + v, 0) / labels.length;
  return 2 * p * (1 - p);
}

function treePredict(node: TreeNode, row: readonly number[]): 0 | 1 {
  if (node.kind === "leaf") return node.prediction;
  return treePredict((row[node.predictorIndex] ?? 0) < node.threshold ? node.left : node.right, row);
}

function growTree(
  x: readonly (readonly number[])[],
  labels: readonly number[],
  predictorNames: readonly string[],
  depth: number,
  maxDepth: number,
  minLeaf: number,
): TreeNode {
  const positives = labels.reduce((s, v) => s + v, 0);
  const prediction: 0 | 1 = positives * 2 >= labels.length ? 1 : 0;
  if (depth >= maxDepth || labels.length < 2 * minLeaf || gini(labels) === 0) {
    return { kind: "leaf", prediction, count: labels.length, positives };
  }
  const parentGini = gini(labels);
  let best: { gain: number; predictorIndex: number; threshold: number; leftIdx: number[]; rightIdx: number[] } | null = null;
  const p = predictorNames.length;
  for (let j = 0; j < p; j += 1) {
    const vals = [...new Set(x.map((row) => row[j] ?? 0))].sort((a, b) => a - b);
    // Candidate thresholds: midpoints, capped at 20 evenly spaced.
    const candidates: number[] = [];
    for (let t = 0; t < vals.length - 1; t += 1) {
      candidates.push(((vals[t] ?? 0) + (vals[t + 1] ?? 0)) / 2);
    }
    const step = Math.max(1, Math.floor(candidates.length / 20));
    for (let c = 0; c < candidates.length; c += step) {
      const threshold = candidates[c] as number;
      const leftIdx: number[] = [];
      const rightIdx: number[] = [];
      x.forEach((row, i) => {
        if ((row[j] ?? 0) < threshold) leftIdx.push(i);
        else rightIdx.push(i);
      });
      if (leftIdx.length < minLeaf || rightIdx.length < minLeaf) continue;
      const gain =
        parentGini -
        (leftIdx.length / labels.length) * gini(leftIdx.map((i) => labels[i] ?? 0)) -
        (rightIdx.length / labels.length) * gini(rightIdx.map((i) => labels[i] ?? 0));
      if (best === null || gain > best.gain) best = { gain, predictorIndex: j, threshold, leftIdx, rightIdx };
    }
  }
  if (best === null || best.gain <= 0) {
    return { kind: "leaf", prediction, count: labels.length, positives };
  }
  const left = growTree(
    best.leftIdx.map((i) => x[i] as readonly number[]),
    best.leftIdx.map((i) => labels[i] as number),
    predictorNames,
    depth + 1,
    maxDepth,
    minLeaf,
  );
  const right = growTree(
    best.rightIdx.map((i) => x[i] as readonly number[]),
    best.rightIdx.map((i) => labels[i] as number),
    predictorNames,
    depth + 1,
    maxDepth,
    minLeaf,
  );
  return {
    kind: "split",
    predictor: predictorNames[best.predictorIndex] as string,
    predictorIndex: best.predictorIndex,
    threshold: best.threshold,
    left,
    right,
    count: labels.length,
    positives,
  };
}

function treeDepth(node: TreeNode): number {
  if (node.kind === "leaf") return 0;
  return 1 + Math.max(treeDepth(node.left), treeDepth(node.right));
}

function treeRules(node: TreeNode, conditions: string[]): string[] {
  if (node.kind === "leaf") {
    const cond = conditions.length === 0 ? "all participants" : conditions.join(" AND ");
    return [`IF ${cond} THEN pattern=${node.prediction} (n=${node.count}, positives=${node.positives})`];
  }
  return [
    ...treeRules(node.left, [...conditions, `${node.predictor} < ${node.threshold}`]),
    ...treeRules(node.right, [...conditions, `${node.predictor} >= ${node.threshold}`]),
  ];
}

/**
 * Interpretable classification for recurring discrepancy patterns
 * (Breiman et al., 1984). The tree is pruned by a deterministic
 * train/validation split: depths 1..maxDepth are tried and the smallest
 * depth with the best validation accuracy is kept. A tree split is a
 * hypothesis, not a rule — it must be checked against the plan
 * documents before it is believed.
 */
export function fitDecisionTree(
  data: ModelData,
  labels: readonly number[],
  options: { minLeaf: number; maxDepth: number; seed?: number; validationFraction?: number },
): DecisionTreeResult {
  if (labels.length !== data.y.length) {
    throw new Error("fitDecisionTree: labels must have one entry per model row");
  }
  if (labels.some((v) => v !== 0 && v !== 1)) {
    throw new Error("fitDecisionTree: labels must be 0 or 1");
  }
  const seed = options.seed ?? 20261112;
  const valFrac = options.validationFraction ?? 0.2;
  const shuffled = seededShuffle(data.y.map((_, i) => i), mulberry32(seed));
  const nVal = Math.max(1, Math.floor(data.y.length * valFrac));
  const valIdx = shuffled.slice(0, nVal);
  const trainIdx = shuffled.slice(nVal);
  const trainX = trainIdx.map((i) => data.x[i] as readonly number[]);
  const trainY = trainIdx.map((i) => labels[i] as number);
  let bestTree: TreeNode | null = null;
  let bestValAcc = -1;
  let bestDepth = 1;
  for (let depth = 1; depth <= options.maxDepth; depth += 1) {
    const tree = growTree(trainX, trainY, data.predictorNames, 0, depth, options.minLeaf);
    const valAcc =
      valIdx.reduce((correct, i) => correct + (treePredict(tree, data.x[i] as readonly number[]) === (labels[i] as number) ? 1 : 0), 0) /
      Math.max(1, valIdx.length);
    if (valAcc > bestValAcc) {
      bestValAcc = valAcc;
      bestTree = tree;
      bestDepth = depth;
    }
  }
  if (bestTree === null) throw new Error("fitDecisionTree: no tree grown");
  const trainAcc =
    trainIdx.reduce((correct, i) => correct + (treePredict(bestTree as TreeNode, data.x[i] as readonly number[]) === (labels[i] as number) ? 1 : 0), 0) /
    Math.max(1, trainIdx.length);
  return {
    tree: bestTree,
    rules: treeRules(bestTree, []),
    depth: bestDepth,
    minLeaf: options.minLeaf,
    trainAccuracy: trainAcc,
    validationAccuracy: bestValAcc,
    predictors: [...data.predictorNames],
  };
}

// --- Influence: refit without the top influencers ---

export interface InfluenceCheck {
  topCooksDistance: Array<{ participantKey: string; cooksDistance: number }>;
  /** Max |Δ coefficient| after refitting without the top influencers. */
  maxCoefficientChange: number | null;
  /** Whether the conclusions are stable: caller-supplied threshold on
   *  the max coefficient change (a case-set parameter). */
  stableAtThreshold: boolean | null;
  threshold: number | null;
}

/**
 * Influence discipline (Stage 1 output 03, §3.3): report Cook's
 * distance, refit without the top influencers, and report whether the
 * conclusions change. If they do, the model is not stable and the
 * finding is not reported as established.
 */
export function influenceCheck(
  data: ModelData,
  options: { topK?: number; stabilityThreshold?: number | null },
): InfluenceCheck {
  const topK = options.topK ?? 3;
  const ols = fitOls(data);
  const p = ols.coefficients.length;
  // Leverage from the hat matrix diagonal: h_i = x_i (X′X)⁻¹ x_i′.
  const X = withIntercept(data.x);
  const XtXInv = matrixInverse(matMul(matTranspose(X), X));
  const leverages = XtXInv === null
    ? X.map(() => 0)
    : X.map((row) => {
        const tmp = matVecMul(XtXInv, row);
        return row.reduce((s, v, j) => s + v * (tmp[j] ?? 0), 0);
      });
  const diag = residualDiagnostics(ols.residuals, leverages, p);
  const ranked = data.keys
    .map((key, i) => ({ participantKey: key, cooksDistance: diag.cooksDistance[i] ?? 0 }))
    .sort((a, b) => b.cooksDistance - a.cooksDistance);
  const top = ranked.slice(0, topK);
  const dropSet = new Set(top.map((t) => t.participantKey));
  const keepIdx = data.keys.map((_, i) => i).filter((i) => !dropSet.has(data.keys[i] as string));
  let maxCoefficientChange: number | null = null;
  if (keepIdx.length >= p * MIN_OBS_PER_PREDICTOR && keepIdx.length > p + 1) {
    try {
      const refit = fitOls(subsetModelData(data, keepIdx));
      maxCoefficientChange = Math.max(...ols.coefficients.map((c, j) => Math.abs(c - (refit.coefficients[j] ?? 0))));
    } catch {
      maxCoefficientChange = null;
    }
  }
  const threshold = options.stabilityThreshold ?? null;
  return {
    topCooksDistance: top,
    maxCoefficientChange,
    stableAtThreshold:
      threshold === null || maxCoefficientChange === null ? null : maxCoefficientChange <= threshold,
    threshold,
  };
}

// --- Model findings → hypothesis suggestions (suggestions only) ---

export interface ModelHypothesisSuggestion {
  /** H1–H17 code from the reconciliation catalogue. */
  hypothesisCode: string;
  /** The model pattern that suggests it. */
  basis: string;
  /** Always "suggestive": a suggestion, never a determination. */
  strength: "suggestive";
  note: string;
}

/**
 * Translate model patterns into hypothesis suggestions for the
 * reconciliation module. The reconciliation module owns the catalogue
 * and the ranking; this function only proposes. A suggestion never
 * establishes an explanation and never changes a benefit.
 */
export function suggestHypotheses(
  significantPredictors: ReadonlyArray<{ predictor: string; coefficient: number; standardError: number }>,
  cohortEffect: { cohortVariable: string; maxGroupDifference: number; outcomeScale: number } | null,
): ModelHypothesisSuggestion[] {
  const suggestions: ModelHypothesisSuggestion[] = [];
  const note = "Suggestion only, from a statistical pattern. The reconciliation module must test it against the plan documents; a pattern alone never establishes an explanation.";
  for (const pred of significantPredictors) {
    const t = pred.standardError === 0 ? 0 : Math.abs(pred.coefficient / pred.standardError);
    if (t < 2) continue; // not distinguishable from noise at this screening level
    const map: Record<string, string> = {
      serviceYears: "H2",
      compensationDollars: "H3",
      monthsSinceRecorded: "H1",
      dataCompleteness: "H16",
      qdro: "H11",
      priorDistribution: "H11",
      ageYears: "H14",
      employmentPeriods: "H2",
    };
    const code = map[pred.predictor];
    if (code === undefined) continue;
    suggestions.push({
      hypothesisCode: code,
      basis: `Predictor "${pred.predictor}" is associated with the discrepancy (coefficient ${pred.coefficient}, |t| = ${t.toFixed(2)}).`,
      strength: "suggestive",
      note,
    });
  }
  if (cohortEffect !== null && cohortEffect.maxGroupDifference > cohortEffect.outcomeScale) {
    suggestions.push({
      hypothesisCode: "H6",
      basis: `Cohort variable "${cohortEffect.cohortVariable}" differs by ${cohortEffect.maxGroupDifference} across groups — larger than the outcome scale ${cohortEffect.outcomeScale}; a formula/amendment difference may be at work.`,
      strength: "suggestive",
      note,
    });
  }
  return suggestions;
}

// ---------------------------------------------------------------------------
// §3.4 Heuristics
//
// Screening aids only. Each heuristic is labelled with its basis and
// carries `overridesFormula: false` structurally: a heuristic result
// contains no benefit amount and no path back into a calculation. No
// invented industry standards: no universal benefit-to-pay ratio, no
// "typical" accrual rate, no textbook rule of thumb. Thresholds that
// are not plan arithmetic are caller-supplied case-set parameters.
// ---------------------------------------------------------------------------

export type HeuristicBasisKind = "plan-arithmetic" | "empirical-cohort" | "reference" | "judgment";

export interface HeuristicBasis {
  kind: HeuristicBasisKind;
  /** The source or empirical basis, in words. */
  citation: string;
}

export interface HeuristicFinding {
  heuristicId: string;
  label: string;
  basis: HeuristicBasis;
  flagged: boolean;
  detail: string;
  /** Structural: a heuristic can never override the governing plan
   *  formula. Always false; the field exists so a consumer can assert it. */
  overridesFormula: false;
  note: string;
}

const HEURISTIC_NOTE =
  "Heuristic only — a screening flag for investigation. It never overrides the governing plan formula and never changes a benefit.";

function heuristic(
  heuristicId: string,
  label: string,
  basis: HeuristicBasis,
  flagged: boolean,
  detail: string,
): HeuristicFinding {
  return { heuristicId, label, basis, flagged, detail, overridesFormula: false, note: HEURISTIC_NOTE };
}

/**
 * Benefit-to-compensation ratio (Stage 1 output 03, §3.4). Monthly
 * accrued benefit vs. final-average monthly compensation. The flag
 * threshold is derived from the plan's OWN accrual rate α and service:
 * B ≈ α × S × C̄ implies B/C̄ ≈ α×S. No universal ratio is asserted.
 * Caller supplies the plan's accrual rate and a deviation threshold
 * (case-set parameters, labelled as such).
 */
export function benefitCompRatioHeuristic(
  row: StatRow,
  args: {
    /** Final-average monthly compensation, integer minor units. */
    avgCompMonthlyMinor: number | null;
    /** The plan's accrual rate as an exact decimal (e.g. "0.015"). */
    accrualRateDecimal: DecimalString;
    /** Deviation from the plan-implied ratio that flags review (e.g.
     *  "0.5" = 50%). Case-set parameter. */
    deviationThresholdDecimal: DecimalString;
    /** Where the accrual rate and threshold came from. */
    basisCitation: string;
  },
): HeuristicFinding {
  const basis: HeuristicBasis = {
    kind: "plan-arithmetic",
    citation: args.basisCitation,
  };
  if (row.paAmbMinor === null || args.avgCompMonthlyMinor === null || args.avgCompMonthlyMinor === 0) {
    return heuristic(
      "benefit-comp-ratio",
      "Benefit-to-compensation ratio",
      basis,
      false,
      "Not evaluable: recorded benefit or average compensation is missing (blank, never zero).",
    );
  }
  const ratio = decDivide(String(row.paAmbMinor), String(args.avgCompMonthlyMinor), 10);
  const expected =
    row.serviceYears === null
      ? null
      : decMultiply(args.accrualRateDecimal, String(row.serviceYears));
  if (expected === null) {
    return heuristic(
      "benefit-comp-ratio",
      "Benefit-to-compensation ratio",
      basis,
      false,
      `Ratio is ${ratio}; no plan-implied ratio is computable because credited service is missing.`,
    );
  }
  const deviation = decDivide(
    decSubtract(ratio, expected).startsWith("-")
      ? decSubtract(ratio, expected).slice(1)
      : decSubtract(ratio, expected),
    expected === "0" ? "1" : expected,
    10,
  );
  const flagged = decCompare(deviation, args.deviationThresholdDecimal) > 0;
  return heuristic(
    "benefit-comp-ratio",
    "Benefit-to-compensation ratio",
    basis,
    flagged,
    `Ratio ${ratio} vs. plan-implied ${expected} (accrual rate ${args.accrualRateDecimal} × ${row.serviceYears} years); relative deviation ${deviation} vs. case-set threshold ${args.deviationThresholdDecimal}.`,
  );
}

/**
 * Accrual-pattern check (Stage 1 output 03, §3.4): benefit per year of
 * service vs. the participant's own formula group. The reference is the
 * cohort itself (median/MAD, §3.2) — not an external standard.
 */
export function accrualPatternHeuristic(
  row: StatRow,
  groupPerYearRates: readonly number[],
): HeuristicFinding {
  const basis: HeuristicBasis = {
    kind: "empirical-cohort",
    citation:
      "Within-cohort comparison (median/MAD on the per-year rate, Stage 1 output 03 §3.2/§3.4). The reference is the participant's own formula group, not an external standard.",
  };
  if (row.paAmbMinor === null || row.serviceYears === null || row.serviceYears === 0) {
    return heuristic(
      "accrual-pattern",
      "Accrual pattern (benefit per year of service)",
      basis,
      false,
      "Not evaluable: recorded benefit or credited service is missing or zero.",
    );
  }
  const perYear = row.paAmbMinor / 100 / row.serviceYears; // dollars per year of service
  const result = modifiedZScores(groupPerYearRates);
  const median = result.median;
  const scale = result.mad;
  if (median === null || scale === null || scale === 0) {
    return heuristic(
      "accrual-pattern",
      "Accrual pattern (benefit per year of service)",
      basis,
      false,
      `Per-year accrual is $${perYear.toFixed(2)}; the cohort reference has no usable spread (median/MAD degenerate).`,
    );
  }
  const score = (0.6745 * (perYear - median)) / scale;
  return heuristic(
    "accrual-pattern",
    "Accrual pattern (benefit per year of service)",
    basis,
    Math.abs(score) > MODIFIED_Z_THRESHOLD,
    `Per-year accrual $${perYear.toFixed(2)} vs. cohort median $${median.toFixed(2)}; modified z = ${score.toFixed(2)} (flag above ${MODIFIED_Z_THRESHOLD}, Iglewicz–Hoaglin).`,
  );
}

/**
 * Service sensitivity (Stage 1 output 03, §3.4): changing credited
 * service by one year changes the benefit by approximately one year's
 * accrual (α × C̄). A discrepancy much larger than a stated number of
 * years' accrual is unlikely to be a service error alone. Used to size
 * hypotheses, not to decide them.
 */
export function serviceSensitivityHeuristic(
  deltaMinor: number | null,
  args: {
    /** One year's accrual in minor units (α × average monthly comp). */
    oneYearAccrualMinor: number;
    /** Number of years' accrual the discrepancy is compared against
     *  (case-set parameter). */
    yearsThreshold: number;
    basisCitation: string;
  },
): HeuristicFinding {
  const basis: HeuristicBasis = {
    kind: "plan-arithmetic",
    citation: args.basisCitation,
  };
  if (deltaMinor === null) {
    return heuristic(
      "service-sensitivity",
      "Service sensitivity",
      basis,
      false,
      "Not evaluable: no discrepancy supplied.",
    );
  }
  const limit = args.oneYearAccrualMinor * args.yearsThreshold;
  const flagged = Math.abs(deltaMinor) > limit;
  return heuristic(
    "service-sensitivity",
    "Service sensitivity",
    basis,
    flagged,
    `|Δ| = $${(Math.abs(deltaMinor) / 100).toFixed(2)} vs. ${args.yearsThreshold} years' accrual ($${(limit / 100).toFixed(2)}); a discrepancy larger than this is unlikely to be a service error alone.`,
  );
}

/**
 * Small-benefit attention (Stage 1 output 03, §3.4, judgment level 6):
 * very small benefits deserve the same scrutiny as large ones — a
 * pattern of small-benefit errors can indicate a systematic data
 * problem. The materiality threshold is the actuary's (case-set), not
 * the heuristic's.
 */
export function smallBenefitHeuristic(
  rows: readonly StatRow[],
  args: { materialityMinor: number; patternShareThreshold: number; basisCitation: string },
): HeuristicFinding {
  const basis: HeuristicBasis = {
    kind: "judgment",
    citation: args.basisCitation,
  };
  const small = rows.filter((r) => r.paAmbMinor !== null && r.paAmbMinor < args.materialityMinor);
  const share = rows.length === 0 ? 0 : small.length / rows.length;
  return heuristic(
    "small-benefit-attention",
    "Small-benefit attention",
    basis,
    share > args.patternShareThreshold && small.length > 0,
    `${small.length} of ${rows.length} participants (${(share * 100).toFixed(1)}%) have a recorded benefit below the case materiality threshold of $${(args.materialityMinor / 100).toFixed(2)}; pattern threshold ${args.patternShareThreshold}. Absolute dollars are immaterial; a pattern may still indicate a systematic data problem.`,
  );
}

/**
 * Reasonableness screening as a method (Defined Benefit Answer Book,
 * Ch. 16, Q 16:6 — census and demographic history are used "to
 * calculate accrued benefits and to determine the reasonableness of
 * assumptions"). This supports reasonableness screening as a method;
 * it supplies NO numeric threshold. This finding therefore records
 * only whether the supplied checks were run and what they found — the
 * numeric checks themselves are the other heuristics in this module.
 */
export function reasonablenessScreeningNote(checksRun: readonly string[]): HeuristicFinding {
  return heuristic(
    "reasonableness-screening",
    "Reasonableness screening (method only)",
    {
      kind: "reference",
      citation:
        "Defined Benefit Answer Book, Ch. 16, Q 16:6 — census and demographic history are used to calculate accrued benefits and to determine the reasonableness of assumptions. Supports screening as a method; supplies no numeric threshold.",
    },
    false,
    checksRun.length === 0
      ? "No reasonableness checks were run."
      : `Reasonableness checks run: ${checksRun.join("; ")}. No threshold is asserted by the cited source.`,
  );
}
