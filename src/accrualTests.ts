/**
 * Statutory accrual tests — Stage 4 (Wave 2).
 *
 * IRC §411(b)(1) accrual tests (DBAB Q 9:11–9:12; FORMULA_TAXONOMY.md §3.3).
 * These are COMPLIANCE requirements, not benefit formula types, and not
 * formula operations: they test whether a plan's accrual method (or a
 * reconstructed accrual) satisfies the anti-backloading floor. They never
 * compute a benefit.
 *
 * - 3% rule, IRC §411(b)(1)(A): the accrued benefit at any time must be at
 *   least 3% of the projected normal retirement benefit, multiplied by
 *   years of service (capped at 33⅓ years).
 * - 133⅓% rule, IRC §411(b)(1)(B): the annual rate at which benefits
 *   accrue in any later year may not exceed 133⅓% of the rate in any
 *   earlier year (the binding constraint on step-rate / tiered formulas).
 * - Fractional rule, IRC §411(b)(1)(C): the accrued benefit must be at
 *   least the projected benefit multiplied by the service fraction
 *   (S_t / S_t^proj), with the partial-year accrual-ratio adjustment of
 *   DBAB Q 9:9 / Rev. Rul. 81-11 where it applies.
 *
 * Every plan's accrued benefit must satisfy one of the three tests. Where
 * the plan's method is unknown, the fractional rule is the diagnostic
 * default (Stage 1 §3.4). A reconstruction that accrues slower than the
 * applicable test is not a valid accrued benefit.
 *
 * Pure functions; decimal-safe via src/decimal.ts. No binary float touches
 * a rate, a benefit, or service.
 */

import type { DecimalString } from "./types";
import {
  decCompare,
  decDivide,
  decMultiply,
} from "./decimal";

export type AccrualTestName = "three-percent" | "133-percent" | "fractional";

export interface AccrualTestResult {
  test: AccrualTestName;
  passes: boolean;
  /** Required minimum accrued benefit (annual $), or null when the test
   *  has no benefit-valued minimum (133⅓% is a rate test). */
  required: DecimalString | null;
  /** Actual accrued benefit (annual $) tested, or null for the rate test. */
  actual: DecimalString | null;
  detail: string;
  citation: string;
}

const CITATION_3PCT = "IRC §411(b)(1)(A); DBAB Q 9:11–9:12";
const CITATION_133 = "IRC §411(b)(1)(B); DBAB Q 9:12";
const CITATION_FRAC = "IRC §411(b)(1)(C); DBAB Q 9:8–9:9; Treas. Reg. §1.411(b)-1(b)(3)";

/**
 * 3% rule. Required minimum = 0.03 × projected normal retirement benefit
 * × min(service, 100/3). Service is capped at 33⅓ years: beyond that the
 * required minimum stops growing (0.03 × 33⅓ = 100% of the projected
 * benefit).
 */
export function testThreePercentRule(p: {
  accruedBenefitAnnual: DecimalString;
  projectedNormalBenefitAnnual: DecimalString;
  serviceYears: DecimalString;
}): AccrualTestResult {
  if (decCompare(p.serviceYears, "0") < 0
    || decCompare(p.accruedBenefitAnnual, "0") < 0
    || decCompare(p.projectedNormalBenefitAnnual, "0") < 0) {
    return {
      test: "three-percent",
      passes: false,
      required: null,
      actual: p.accruedBenefitAnnual,
      detail: "negative input refused: service, accrued benefit, and projected benefit must be non-negative",
      citation: CITATION_3PCT,
    };
  }
  const cappedService =
    decCompare(p.serviceYears, decDivide("100", "3", 10)) > 0
      ? decDivide("100", "3", 10)
      : p.serviceYears;
  const required = decMultiply(
    decMultiply("0.03", p.projectedNormalBenefitAnnual),
    cappedService,
  );
  const passes = decCompare(p.accruedBenefitAnnual, required) >= 0;
  return {
    test: "three-percent",
    passes,
    required,
    actual: p.accruedBenefitAnnual,
    detail: passes
      ? `accrued $${p.accruedBenefitAnnual}/year is at least 3% × projected $${p.projectedNormalBenefitAnnual}/year × ${cappedService} years = $${required}/year`
      : `accrued $${p.accruedBenefitAnnual}/year is below 3% × projected $${p.projectedNormalBenefitAnnual}/year × ${cappedService} years = $${required}/year`,
    citation: CITATION_3PCT,
  };
}

/**
 * 133⅓% rule. Every later band rate must be ≤ 4/3 of every earlier band
 * rate. A tiered formula that violates it (e.g. 1% then 1.5% — 150% >
 * 133⅓%) is not a valid qualified formula (DBAB Q 9:12, Ex. 2).
 */
export function test133PercentRule(p: {
  bandRates: DecimalString[];
}): AccrualTestResult {
  const violations: string[] = [];
  for (let j = 1; j < p.bandRates.length; j += 1) {
    const later = p.bandRates[j];
    if (later === undefined) continue;
    for (let i = 0; i < j; i += 1) {
      const earlier = p.bandRates[i];
      if (earlier === undefined) continue;
      const maxLater = decMultiply(earlier, decDivide("4", "3", 10));
      if (decCompare(later, maxLater) > 0) {
        violations.push(
          `band ${j + 1} rate ${later} exceeds 133⅓% of band ${i + 1} rate ${earlier} (max ${maxLater})`,
        );
      }
    }
  }
  const passes = violations.length === 0;
  return {
    test: "133-percent",
    passes,
    required: null,
    actual: null,
    detail: passes
      ? `all later band rates are within 133⅓% of every earlier band rate (${p.bandRates.join(", ")})`
      : violations.join("; "),
    citation: CITATION_133,
  };
}

/**
 * Fractional rule. Required minimum = projected benefit × the service
 * fraction. The fraction is S_t / S_t^proj, or the partial-year accrual
 * ratio when one applies (DBAB Q 9:9: after a partial year of
 * participation the ratio ratchets forward — e.g. .1125 after a half year,
 * .1379 the next full year — and a plan that simply uses S_t/S_t^proj with
 * fractional S_t may under-accrue). When a partial-year ratio is supplied
 * it replaces the naive fraction.
 */
export function testFractionalRule(p: {
  accruedBenefitAnnual: DecimalString;
  projectedBenefitAnnual: DecimalString;
  serviceYears: DecimalString;
  projectedServiceYears: DecimalString;
  partialYearRatio?: DecimalString;
}): AccrualTestResult {
  if (decCompare(p.projectedServiceYears, "0") <= 0) {
    return {
      test: "fractional",
      passes: false,
      required: null,
      actual: p.accruedBenefitAnnual,
      detail: "projected service must be positive for the fractional rule",
      citation: CITATION_FRAC,
    };
  }
  const fraction =
    p.partialYearRatio !== undefined
      ? p.partialYearRatio
      : decDivide(p.serviceYears, p.projectedServiceYears, 10);
  // Multiply before dividing when no partial-year ratio is supplied:
  // B_proj × (S/S_proj) computed as (B_proj × S) / S_proj keeps the
  // result exact when the division is exact (e.g. 20/30 of $30,000 is
  // exactly $20,000). Dividing first rounds ⅔ to 0.6666666667 at scale
  // 10, and multiplying back overshoots the floor by a micro-cent —
  // enough to fail a benefit that exactly meets the floor.
  const required = p.partialYearRatio !== undefined
    ? decMultiply(p.projectedBenefitAnnual, fraction)
    : decDivide(
      decMultiply(p.projectedBenefitAnnual, p.serviceYears),
      p.projectedServiceYears,
      10,
    );
  const passes = decCompare(p.accruedBenefitAnnual, required) >= 0;
  return {
    test: "fractional",
    passes,
    required,
    actual: p.accruedBenefitAnnual,
    detail: passes
      ? `accrued $${p.accruedBenefitAnnual}/year is at least projected $${p.projectedBenefitAnnual}/year × ${fraction} = $${required}/year`
      : `accrued $${p.accruedBenefitAnnual}/year is below projected $${p.projectedBenefitAnnual}/year × ${fraction} = $${required}/year`,
    citation: CITATION_FRAC,
  };
}

/**
 * Run the tests applicable to an accrual method. Unit-credit and
 * step-rate methods are tested under the 3% and 133⅓% rules (DBAB Q 9:12);
 * fractional and flat methods under the fractional rule (the usual method
 * for flat formulas — Stage 1 T-01 item 9). The caller states the method;
 * it is never inferred from which test the numbers happen to pass.
 */
export function runAccrualTests(p: {
  method: "unit-credit" | "fractional" | "flat" | "step-rate";
  accruedBenefitAnnual: DecimalString;
  projectedBenefitAnnual: DecimalString;
  serviceYears: DecimalString;
  projectedServiceYears: DecimalString;
  bandRates?: DecimalString[];
  partialYearRatio?: DecimalString;
}): AccrualTestResult[] {
  const results: AccrualTestResult[] = [];
  if (p.method === "unit-credit" || p.method === "step-rate") {
    results.push(
      testThreePercentRule({
        accruedBenefitAnnual: p.accruedBenefitAnnual,
        projectedNormalBenefitAnnual: p.projectedBenefitAnnual,
        serviceYears: p.serviceYears,
      }),
    );
    if (p.bandRates !== undefined && p.bandRates.length > 1) {
      results.push(test133PercentRule({ bandRates: p.bandRates }));
    }
  } else {
    results.push(
      testFractionalRule({
        accruedBenefitAnnual: p.accruedBenefitAnnual,
        projectedBenefitAnnual: p.projectedBenefitAnnual,
        serviceYears: p.serviceYears,
        projectedServiceYears: p.projectedServiceYears,
        partialYearRatio: p.partialYearRatio,
      }),
    );
  }
  return results;
}
