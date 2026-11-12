/**
 * Property-based tests for the Stage 4 deterministic engine (Wave 3).
 *
 * Plain node:test; no external package. A small seeded PRNG (mulberry32)
 * drives every generator, so runs are reproducible: the same seed always
 * produces the same cases. Each property runs 120 generated cases.
 *
 * MASTER_PROMPT §13 / §20: property-based tests for mathematical
 * invariants. Every property states the invariant first, then the
 * generator; a failure names the generated case that broke it.
 *
 * Synthetic data only. Fictional participants only. No live case data.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decAdd,
  decCompare,
  decDivide,
  decMultiply,
  decRound,
  decSubtract,
  makeMoney,
  moneyFromDecimalString,
  moneyMinorFromDecimalString,
  moneyMinorToDecimalString,
  parseDecimalString,
} from "../src/decimal.js";
import type { DateString, DecimalString } from "../src/types.js";
import {
  addMonths,
  addYears,
  ageAt,
  completedYMD,
  daysBetween,
  daysInMonth,
} from "../src/dates.js";
import {
  applyServiceCap,
  computeCreditedService,
  vestingPercent,
  type EmploymentPeriodInput,
  type ServiceDefinition,
} from "../src/service.js";
import type { ServiceResult } from "../src/types.js";
import { applyLimit, applyProtection, combineResults } from "../src/compose.js";
import { calcDollarPerYear, calcRehireRestoration, calcUnitCredit, datedValue, makeBenefit } from "../src/formulas.js";
import type { CalcContext, CalcResult, TypedBenefitQuantity } from "../src/types.js";
import {
  boundsWidthMinor,
  buildBoundsResult,
  checkMonotonicity,
  recordedPosition,
} from "../src/bounds.js";
import { RULE_ORDER, validateCasePackage } from "../src/validation.js";
import type { ValidationContext, ValidationParticipant } from "../src/validation.js";

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

/** Random integer in [min, max] inclusive. */
function ri(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error("pick: empty list");
  return item;
}

/** Random exact dollars with at most 2 decimal places, from integer cents. */
function randDollars(rng: () => number, minCents: number, maxCents: number): DecimalString {
  const cents = ri(rng, minCents, maxCents);
  return moneyMinorToDecimalString(cents);
}

/** Random valid ISO date; day ≤ 28 when `safeDay` so month-end clamping
 *  never applies (addMonths/addYears inverse holds exactly there). */
function randDate(rng: () => number, minYear: number, maxYear: number, safeDay = false): DateString {
  const year = ri(rng, minYear, maxYear);
  const month = ri(rng, 1, 12);
  const maxDay = safeDay ? 28 : daysInMonth(year, month);
  const day = ri(rng, 1, maxDay);
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const ctx: CalcContext = {
  planVersionId: "v1",
  measurementDate: "2020-02-29",
  rounding: { stage: "final-only", mode: "nearest-cent", source: "property test" },
};

function exactMinor(result: CalcResult<TypedBenefitQuantity>): number {
  assert.equal(result.kind, "exact");
  if (result.kind !== "exact") throw new Error("unreachable");
  assert.equal(result.value.amount === null, false);
  return result.value.amount?.amountMinor ?? -1;
}

function dollarPerYear(rate: DecimalString, service: DecimalString): CalcResult<TypedBenefitQuantity> {
  return calcDollarPerYear(ctx, {
    unitRate: datedValue(rate, "1985-07-01", "v1"),
    service,
  });
}

// ---------------------------------------------------------------------------
// Decimal arithmetic
// ---------------------------------------------------------------------------

describe("property: decimal arithmetic", () => {
  it("add then subtract round-trips: (a + b) - b == a", () => {
    const rng = rngFor(1);
    for (let i = 0; i < CASES; i += 1) {
      const a = randDollars(rng, -100000, 100000);
      const b = randDollars(rng, -100000, 100000);
      const back = decSubtract(decAdd(a, b), b);
      assert.equal(decCompare(back, a), 0, `case ${i}: a=${a} b=${b} back=${back}`);
    }
  });

  it("multiply then divide round-trips for exact divisors: (a * k) / k == a", () => {
    const rng = rngFor(2);
    for (let i = 0; i < CASES; i += 1) {
      const a = randDollars(rng, 0, 100000);
      const k = pick(rng, ["2", "4", "5", "10", "20", "25", "50", "100"] as const);
      const back = decDivide(decMultiply(a, k), k, 10);
      assert.equal(decCompare(back, a), 0, `case ${i}: a=${a} k=${k} back=${back}`);
    }
  });

  it("monotone: a <= b implies a + c <= b + c, and a * c <= b * c for c >= 0", () => {
    const rng = rngFor(3);
    for (let i = 0; i < CASES; i += 1) {
      const aCents = ri(rng, -100000, 100000);
      const bCents = aCents + ri(rng, 0, 50000);
      const a = moneyMinorToDecimalString(aCents);
      const b = moneyMinorToDecimalString(bCents);
      const c = randDollars(rng, -100000, 100000);
      const d = randDollars(rng, 0, 100000);
      assert.equal(decCompare(decAdd(a, c), decAdd(b, c)) <= 0, true, `case ${i}: add monotone`);
      assert.equal(decCompare(decMultiply(a, d), decMultiply(b, d)) <= 0, true, `case ${i}: mul monotone`);
    }
  });

  it("money stays integer cents: decimal -> minor -> decimal round-trips", () => {
    const rng = rngFor(4);
    for (let i = 0; i < CASES; i += 1) {
      const cents = ri(rng, -1000000, 1000000);
      const money = makeMoney(cents);
      assert.equal(money.amountMinor, cents);
      assert.equal(Number.isInteger(money.amountMinor), true);
      const text = moneyMinorToDecimalString(cents);
      assert.equal(moneyMinorFromDecimalString(text), cents, `case ${i}: cents=${cents}`);
      assert.equal(moneyFromDecimalString(text).amountMinor, cents);
    }
  });

  it("half-up cent rounding: at most 2 decimals, within half a cent", () => {
    const rng = rngFor(5);
    for (let i = 0; i < CASES; i += 1) {
      // Up to 4 decimal places, so rounding actually moves the value.
      const cents4 = ri(rng, 0, 1000000);
      const value = `${Math.trunc(cents4 / 10000)}.${String(cents4 % 10000).padStart(4, "0")}`;
      const rounded = decRound(value, "0.01", "half-up");
      assert.equal(parseDecimalString(rounded).scale <= 2, true, `case ${i}: ${value} -> ${rounded}`);
      const diff = decSubtract(rounded, value);
      assert.equal(decCompare(diff, "-0.005") >= 0 && decCompare(diff, "0.005") <= 0, true, `case ${i}: ${value} -> ${rounded} diff ${diff}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Date primitives
// ---------------------------------------------------------------------------

describe("property: date primitives", () => {
  it("addMonths/addYears inverse where defined (day <= 28): +n then -n returns the date", () => {
    const rng = rngFor(6);
    for (let i = 0; i < CASES; i += 1) {
      const d = randDate(rng, 1980, 2020, true);
      const n = ri(rng, -60, 60);
      assert.equal(addMonths(addMonths(d, n), -n), d, `case ${i}: ${d} + ${n}`);
      const years = ri(rng, -10, 10);
      assert.equal(addYears(addYears(d, years), -years), d, `case ${i}: ${d} + ${years}y`);
      assert.equal(addYears(d, years), addMonths(d, years * 12), `case ${i}: addYears == addMonths x12`);
    }
  });

  it("daysBetween antisymmetry: d(a,b) == -d(b,a), and d(a,a) == 0", () => {
    const rng = rngFor(7);
    for (let i = 0; i < CASES; i += 1) {
      const a = randDate(rng, 1980, 2020);
      const b = randDate(rng, 1980, 2020);
      assert.equal(daysBetween(a, b), -daysBetween(b, a), `case ${i}: ${a} ${b}`);
      assert.equal(daysBetween(a, a), 0);
    }
  });

  it("completedYMD decomposition sums back to the end date", () => {
    const rng = rngFor(8);
    for (let i = 0; i < CASES; i += 1) {
      let start = randDate(rng, 1980, 2010);
      let end = randDate(rng, 1980, 2020);
      if (daysBetween(start, end) < 0) [start, end] = [end, start];
      const { years, months, days } = completedYMD(start, end);
      const anchor = addMonths(start, years * 12 + months);
      assert.equal(daysBetween(anchor, end), days, `case ${i}: ${start} -> ${end}`);
      assert.equal(daysBetween(anchor, end) >= 0, true);
      assert.equal(daysBetween(addMonths(start, years * 12 + months + 1), end) < 0, true, `case ${i}: next whole month overshoots ${start} -> ${end}`);
    }
  });

  it("ageAt is monotone in the measurement date", () => {
    const rng = rngFor(9);
    for (let i = 0; i < CASES; i += 1) {
      const dob = randDate(rng, 1950, 1970, true);
      let t1 = randDate(rng, 2000, 2020);
      let t2 = randDate(rng, 2000, 2020);
      if (daysBetween(t1, t2) < 0) [t1, t2] = [t2, t1];
      assert.equal(ageAt(dob, t1) <= ageAt(dob, t2), true, `case ${i}: dob=${dob} ${t1} ${t2}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

function elapsedDef(
  conversion: ServiceDefinition["fractionalConversion"],
  overrides: Partial<ServiceDefinition> = {},
): ServiceDefinition {
  return {
    planVersionId: "pv-prop",
    creditedMethod: "elapsed-time",
    vestingMethod: "elapsed-time",
    eligibilityMethod: "elapsed-time",
    fullYearHours: null,
    vestingFullYearHours: null,
    eligibilityFullYearHours: null,
    breakHours: null,
    hoursBands: null,
    hoursEquivalency: null,
    computationPeriod: "anniversary-year",
    fractionalConversion: conversion,
    proration: null,
    vestingSchedule: [
      { minWholeYears: 0, maxWholeYears: 3, percent: "0", ruleRef: "prop §5.4" },
      { minWholeYears: 4, maxWholeYears: 4, percent: "0.4", ruleRef: "prop §5.4" },
      { minWholeYears: 5, maxWholeYears: 5, percent: "0.5", ruleRef: "prop §5.4" },
      { minWholeYears: 6, maxWholeYears: 6, percent: "0.6", ruleRef: "prop §5.4" },
      { minWholeYears: 7, maxWholeYears: 7, percent: "0.7", ruleRef: "prop §5.4" },
      { minWholeYears: 8, maxWholeYears: 8, percent: "0.8", ruleRef: "prop §5.4" },
      { minWholeYears: 9, maxWholeYears: 9, percent: "0.9", ruleRef: "prop §5.4" },
      { minWholeYears: 10, maxWholeYears: null, percent: "1", ruleRef: "prop §5.4" },
    ],
    specialVesting: [],
    breakRule: { credited: null, vesting: null, eligibility: null },
    accrualStart: "participation-date",
    pastServiceCredit: null,
    predecessorServiceCredit: null,
    serviceCap: null,
    freeze: null,
    nrdRule: null,
    leapDayBirthday: null,
    vestingExcludesPreAge18: false,
    ...overrides,
  };
}

function elapsedPeriod(start: DateString, end: DateString): EmploymentPeriodInput {
  return {
    periodStart: start,
    periodEnd: end,
    hoursByComputationPeriod: [],
    leavePeriods: [],
    isCoveredClass: true,
    accrualStartDate: start,
    breakBefore: null,
  };
}

function serviceResult(value: DecimalString): ServiceResult {
  return { value, rational: null, periods: [], missingInputs: [], roundingApplied: [] };
}

describe("property: service functions", () => {
  it("credited service (months-truncate) equals the completed whole months / 12", () => {
    const rng = rngFor(10);
    const def = elapsedDef({ kind: "months-truncate", citation: "prop" });
    for (let i = 0; i < CASES; i += 1) {
      let start = randDate(rng, 1980, 2010);
      let end = randDate(rng, 1980, 2020);
      if (daysBetween(start, end) < 0) [start, end] = [end, start];
      const got = computeCreditedService([elapsedPeriod(start, end)], end, def);
      const { years, months } = completedYMD(start, end);
      const expected = decDivide(String(years * 12 + months), "12", 10);
      assert.equal(got.value, expected, `case ${i}: ${start} -> ${end} got ${got.value}`);
    }
  });

  it("credited service (months-round-up) is the truncated value or one month more, never more", () => {
    const rng = rngFor(11);
    const def = elapsedDef({ kind: "months-round-up", citation: "prop" });
    for (let i = 0; i < CASES; i += 1) {
      let start = randDate(rng, 1980, 2010);
      let end = randDate(rng, 1980, 2020);
      if (daysBetween(start, end) < 0) [start, end] = [end, start];
      const got = computeCreditedService([elapsedPeriod(start, end)], end, def);
      const { years, months, days } = completedYMD(start, end);
      const totalMonths = years * 12 + months;
      const expected = decDivide(String(totalMonths + (days > 0 ? 1 : 0)), "12", 10);
      assert.equal(got.value, expected, `case ${i}: ${start} -> ${end} got ${got.value}`);
      // Credited never exceeds the elapsed span rounded up to whole months.
      assert.equal(got.value !== null && decCompare(got.value, decDivide(String(totalMonths + 1), "12", 10)) <= 0, true);
    }
  });

  it("vesting percent is monotone in whole years of vesting service", () => {
    const rng = rngFor(12);
    const def = elapsedDef({ kind: "months-truncate", citation: "prop" });
    for (let i = 0; i < CASES; i += 1) {
      const s1 = ri(rng, 0, 15);
      const s2 = s1 + ri(rng, 0, 15 - s1);
      const vp1 = vestingPercent(serviceResult(String(s1)), def, "2020-02-29", "");
      const vp2 = vestingPercent(serviceResult(String(s2)), def, "2020-02-29", "");
      assert.equal(vp1.vp === null, false);
      assert.equal(vp2.vp === null, false);
      assert.equal(vp1.vp !== null && vp2.vp !== null && decCompare(vp1.vp, vp2.vp) <= 0, true, `case ${i}: ${s1}y -> ${vp1.vp}, ${s2}y -> ${vp2.vp}`);
    }
  });

  it("a service cap never increases service: capped <= uncapped, and a cap above service changes nothing", () => {
    const rng = rngFor(13);
    for (let i = 0; i < CASES; i += 1) {
      const value = randDollars(rng, 0, 4000); // 0–40 years
      const cap = randDollars(rng, 0, 4000);
      const capped = applyServiceCap(
        serviceResult(value),
        { maxYears: cap, whichYears: "last-n", ruleRef: "prop" },
        "2020-02-29",
      );
      assert.equal(capped.value === null, false);
      assert.equal(capped.value !== null && decCompare(capped.value, value) <= 0, true, `case ${i}: value=${value} cap=${cap} capped=${capped.value}`);
      if (decCompare(cap, value) >= 0) {
        assert.equal(capped.value, value, `case ${i}: cap above service must not change it`);
      } else {
        assert.equal(capped.value, cap, `case ${i}: cap below service must bind`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Composition: Compose / Protect / Limit
// ---------------------------------------------------------------------------

describe("property: composition", () => {
  it("Compose is associative over independent exact operations (sum, greater-of, lesser-of)", () => {
    const rng = rngFor(14);
    for (const rule of ["sum", "greater-of", "lesser-of"] as const) {
      for (let i = 0; i < CASES; i += 1) {
        const a = dollarPerYear(randDollars(rng, 1000, 10000), "5");
        const b = dollarPerYear(randDollars(rng, 1000, 10000), "5");
        const c = dollarPerYear(randDollars(rng, 1000, 10000), "5");
        const flat = combineResults([a, b, c], rule);
        const left = combineResults([combineResults([a, b], rule), c], rule);
        const right = combineResults([a, combineResults([b, c], rule)], rule);
        assert.equal(exactMinor(flat), exactMinor(left), `case ${i} ${rule}: flat vs left`);
        assert.equal(exactMinor(flat), exactMinor(right), `case ${i} ${rule}: flat vs right`);
      }
    }
  });

  it("Protect never reduces a protected benefit (greater-of floor)", () => {
    const rng = rngFor(15);
    for (let i = 0; i < CASES; i += 1) {
      const current = dollarPerYear(randDollars(rng, 1000, 10000), "5");
      const prot = dollarPerYear(randDollars(rng, 0, 15000), "5");
      const out = applyProtection(current, prot, { method: "greater-of", ruleRef: "prop" });
      assert.equal(exactMinor(out) >= exactMinor(current), true, `case ${i}: current=${exactMinor(current)} protected=${exactMinor(prot)} out=${exactMinor(out)}`);
      const none = applyProtection(current, null, { method: "greater-of", ruleRef: "prop" });
      assert.equal(exactMinor(none), exactMinor(current), `case ${i}: no protection is identity`);
    }
  });

  it("Limit never increases a benefit past the limit", () => {    const rng = rngFor(16);
    for (let i = 0; i < CASES; i += 1) {
      const benefit = dollarPerYear(randDollars(rng, 1000, 20000), "5");
      const cap = randDollars(rng, 0, 20000);
      const out = applyLimit(benefit, [{ capMonthly: cap, ruleRef: "prop" }]);
      const capMinor = moneyMinorFromDecimalString(cap);
      assert.equal(exactMinor(out) <= exactMinor(benefit), true, `case ${i}: limit increased the benefit`);
      assert.equal(exactMinor(out) <= capMinor, true, `case ${i}: ${exactMinor(out)} past cap ${capMinor}`);
      if (decCompare(cap, moneyMinorToDecimalString(exactMinor(benefit))) >= 0) {
        assert.equal(exactMinor(out), exactMinor(benefit), `case ${i}: cap above benefit is identity`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Rewiring regression: S-08 break years are calendar years (D-1.4),
// never days/365 (formulas.ts breakYearsBetween now uses completedYMD)
// ---------------------------------------------------------------------------

describe("regression: break years are calendar years, not days/365", () => {
  it("a break of 2016-01-01 to 2020-12-31 is 4 calendar years, not 5 — no forfeiture", () => {
    // 1826 days: floor(1826/365) = 5 under the old computation, but the
    // 5th anniversary (2021-01-01) is not reached, so the break is 4
    // completed calendar years and the 5-year forfeiture does not apply.
    const underlying = (service: string): CalcResult<TypedBenefitQuantity> =>
      calcUnitCredit(ctx, {
        accrualRate: datedValue("0.01", "1985-07-01", "v1"),
        avgComp: "55000",
        service,
      });
    const result = calcRehireRestoration(ctx, {
      employmentPeriods: [
        { from: "2010-01-01", to: "2016-01-01", serviceYears: "6" },
        { from: "2020-12-31", to: null, serviceYears: "1" },
      ],
      vestingStatusAtEachBreak: [
        { breakDate: "2016-01-01", vested: false, vestingService: "6" },
      ],
      underlying,
    });
    assert.equal(result.kind, "exact");
    assert.equal(exactMinor(result), 32083);
  });
});

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

describe("property: bounds", () => {
  it("min <= possible <= max, width >= 0, recorded position matches the interval", () => {
    const rng = rngFor(17);
    for (let i = 0; i < CASES; i += 1) {
      const minMinor = ri(rng, 0, 200000);
      const maxMinor = minMinor + ri(rng, 0, 50000);
      const recordedMinor = ri(rng, Math.max(0, minMinor - 20000), maxMinor + 20000);
      const recorded = rng() < 0.15 ? null : makeBenefit(ctx, makeMoney(recordedMinor), "monthly");
      const bounds = buildBoundsResult({
        minBenefit: makeBenefit(ctx, makeMoney(minMinor), "monthly"),
        maxBenefit: makeBenefit(ctx, makeMoney(maxMinor), "monthly"),
        assumptions: ["prop test"],
        derivation: { method: "endpoint-evaluation", kinkPoints: [], monotonicity: [], feasibleRegion: "prop" },
        widthAttribution: [],
        scenarios: [],
        recordedPaAmb: recorded,
      });
      assert.equal(bounds.min.amountMinor <= bounds.max.amountMinor, true);
      assert.equal(boundsWidthMinor(bounds) >= 0, true);
      assert.equal(boundsWidthMinor(bounds), maxMinor - minMinor);
      const expected = recorded === null
        ? "recorded-missing"
        : recordedMinor < minMinor ? "below-min" : recordedMinor > maxMinor ? "above-max" : "inside";
      assert.equal(bounds.recordedPosition, expected, `case ${i}: recorded=${recordedMinor}`);
      assert.equal(recordedPosition(recorded?.amount ?? null, bounds.min, bounds.max), expected);
    }
  });

  it("bounds widen, never narrow, when the missing input's range widens", () => {
    const rng = rngFor(18);
    for (let i = 0; i < CASES; i += 1) {
      const lo = ri(rng, 100, 9000); // cents per month of unit rate
      const hi = lo + ri(rng, 0, 5000);
      const widenLo = Math.max(0, lo - ri(rng, 0, 1000));
      const widenHi = hi + ri(rng, 0, 1000);
      const narrow = calcDollarPerYear(ctx, {
        unitRate: datedValue("0", "1985-07-01", "v1"),
        service: "10",
        unitRateRange: { low: moneyMinorToDecimalString(lo), high: moneyMinorToDecimalString(hi) },
      });
      const wide = calcDollarPerYear(ctx, {
        unitRate: datedValue("0", "1985-07-01", "v1"),
        service: "10",
        unitRateRange: { low: moneyMinorToDecimalString(widenLo), high: moneyMinorToDecimalString(widenHi) },
      });
      assert.equal(narrow.kind, "bound");
      assert.equal(wide.kind, "bound");
      if (narrow.kind !== "bound" || wide.kind !== "bound") throw new Error("unreachable");
      const narrowWidth = (narrow.max.amount?.amountMinor ?? 0) - (narrow.min.amount?.amountMinor ?? 0);
      const wideWidth = (wide.max.amount?.amountMinor ?? 0) - (wide.min.amount?.amountMinor ?? 0);
      assert.equal(wideWidth >= narrowWidth, true, `case ${i}: narrow=${narrowWidth} wide=${wideWidth}`);
      // The exact value at a mid rate sits inside the wide bound.
      const mid = moneyMinorToDecimalString(Math.floor((widenLo + widenHi) / 2));
      const exact = dollarPerYear(mid, "10");
      assert.equal(exactMinor(exact) >= (wide.min.amount?.amountMinor ?? 0), true);
      assert.equal(exactMinor(exact) <= (wide.max.amount?.amountMinor ?? 0), true);
    }
  });

  it("checkMonotonicity: a monotone sequence is monotone; an interior spike is not", () => {
    const rng = rngFor(19);
    for (let i = 0; i < CASES; i += 1) {
      const n = ri(rng, 3, 8);
      const start = ri(rng, 0, 1000);
      const step = ri(rng, 1, 500);
      const increasing = Array.from({ length: n }, (_, k) => ({
        inputValue: String(1000 + k * 100),
        benefitMinor: start + k * step,
      }));
      assert.equal(checkMonotonicity("prop", increasing).monotone, true, `case ${i}: increasing`);
      const decreasing = increasing.map((p) => ({ ...p, benefitMinor: start + (n - 1) * step - (p.benefitMinor - start) }));
      assert.equal(checkMonotonicity("prop", decreasing).monotone, true, `case ${i}: decreasing`);
      const spiked = increasing.map((p, k) => (k === 1 ? { ...p, benefitMinor: start + n * step + 1000 } : p));
      assert.equal(checkMonotonicity("prop", spiked).monotone, false, `case ${i}: spike must fail`);
    }
  });
});

// ---------------------------------------------------------------------------
// Validation: a finding's blocksScope is always one of the six values
// ---------------------------------------------------------------------------

const SIX_SCOPES = ["import", "participant-calculation", "exact-calculation", "comparison", "decision", "none"] as const;

function sparseParticipant(overrides: Partial<ValidationParticipant> = {}): ValidationParticipant {
  return {
    participantKey: "PROP-001",
    bcvRecId: 1,
    caseNumber: "00012345",
    idType: "1",
    ssn: "111223333",
    firstName: "Prop",
    lastName: "Fictional",
    dob: "1962-03-14",
    sex: "M",
    dateOfDeath: null,
    retstat: "2",
    rettyp: null,
    doh: "1990-05-01",
    dote: "2019-06-15",
    dop: "1990-05-01",
    dobfParticipant: null,
    dor: null,
    postDoptDote: null,
    nrd: "2027-03-14",
    anb: 59,
    sanb: 58,
    rbd: "2027-04-01",
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
    cspa: "12.5",
    vspa: "12.5",
    espa: "12.5",
    cs: "12.5",
    vs: "12.5",
    es: "12.5",
    csUnit: "years",
    vsUnit: "years",
    vppa: "1",
    paAmb: 124000,
    paAcomp: 410000,
    paAcompPeriodicity: "monthly",
    cuComp: 450000,
    pia: null,
    integrationMethod: "none",
    firstYear: 2010,
    lastYear: 2019,
    salaryByYear: Array.from({ length: 10 }, (_, k) => ({ year: 2010 + k, amount: 4000000 + k * 10000 })),
    annact: "A",
    annualizationBasisNoted: true,
    averagingPeriodYears: [2015, 2016, 2017, 2018, 2019],
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
    xrd: "2027-03-14",
    xrdMbTerm: 124000,
    pvReteec: null,
    measurementDate: "2019-06-15",
    recordedDate: "2019-07-01",
    measurementDisagreementExplained: false,
    assertedBasisNrd: false,
    nrdBasisEvidence: false,
    explicitNoBenefitStatement: false,
    vestingTreatment: "gross",
    annuityForm: "NSF",
    annuityFormConversionDocumented: false,
    calcMeasurementDate: "2019-06-15",
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
    schedulePaAmb: 124000,
    scheduleExplanationDocumented: false,
    bcvComparison: null,
    paymentAmountMinor: null,
    convertedPaAmbMinor: null,
    ardFactorsPresent: false,
    priorDistribution: null,
    formulaCheckValueMinor: 124000,
    formulaKnownForX06: true,
    formulaCheckValuesMinor: [124000],
    documentedHypothesis: false,
    pfFactors: null,
    proposedDisposition: null,
    evidenceCount: 0,
    paAmbAccept: null,
    disposition: null,
    decisionExists: false,
    rejectionRationaleStated: false,
    sourcesUsed: [],
    candidateMeasurementDates: ["2019-06-15"],
    establishedMeasurementDate: "2019-06-15",
    prior: null,
    ...overrides,
  };
}

function propContext(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    dopt: "2021-06-30",
    today: "2026-11-12",
    runId: "run-prop-1",
    recordedDate: "2026-11-12",
    tolerance: {
      version: 1,
      absoluteMinor: 200,
      relativeDecimal: null,
      application: "either",
      authority: "case actuary — case record M-7 (illustration only, not a PBGC rule)",
      approvedBy: "case actuary",
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
      hashBefore: "aaaa",
      hashAfter: "aaaa",
      macroRan: false,
      unknownFields: [],
    },
    priorExtract: null,
    ...overrides,
  };
}

describe("property: validation findings", () => {
  it("every finding's blocksScope is one of the six values, across generated packages", () => {
    const rng = rngFor(20);
    for (let i = 0; i < CASES; i += 1) {
      // Vary the fields most likely to change which rules fire.
      const p = sparseParticipant({
        paAmb: pick(rng, [null, 0, 124000, 2500000] as const),
        retstat: pick(rng, ["1", "2", "3", "4", "5"] as const),
        dote: pick(rng, [null, "2019-06-15", "2025-01-01"] as const),
        cspa: pick(rng, ["12.5", "0", null] as const),
        vppa: pick(rng, ["1", "0", null] as const),
      });
      const result = validateCasePackage([p], propContext());
      assert.equal(result.allFindings.length > 0, true, `case ${i}: expected findings`);
      for (const finding of result.allFindings) {
        assert.equal((SIX_SCOPES as readonly string[]).includes(finding.blocksScope), true, `case ${i}: rule ${finding.ruleId} blocksScope=${finding.blocksScope}`);
      }
      // The catalog itself covers all 66 rules.
      assert.equal(RULE_ORDER.length, 66);
    }
  });
});
