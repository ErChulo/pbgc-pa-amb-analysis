/**
 * Unit tests for src/service.ts — credited / vesting / eligibility service.
 *
 * Covers Stage 3 §5.7 tests T-S-01–T-S-17, the six indeterminacy tests
 * T-I-01–T-I-06, finding D-2.1 (months rule, never days/365), and the
 * three-quantities distinction (§2.1). The 6 Blond §1.58 band checks
 * from the Stage 3 harness (58/58) live here too (T-S-02), completing
 * the 58 ported harness checks (52 in test/dates.test.ts + 6 here).
 *
 * Run with plain node + node:test (no test framework dependency):
 *   npm test            (builds with tsc, then runs node --test dist/test/)
 *
 * Synthetic data only — all participants fictional, all dates synthetic
 * (except the two plan documents' own effective dates, which are
 * document facts). No live case data.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyBreaks,
  applyFreeze,
  applyServiceCap,
  computeCreditedService,
  computeEligibilityService,
  computeVestingService,
  hoursPeriodCreditRange,
  normalRetirementDate,
  serviceAtDate,
  spanningMonths,
  splitServiceByVersion,
  vestingPercent,
  type BreakRule,
  type EmploymentPeriodInput,
  type ServiceDefinition,
} from "../src/service.js";
import type { ServiceResult } from "../src/types.js";
import { completedYMD } from "../src/dates.js";
import { decAdd, decDivide } from "../src/decimal.js";

// ---------------------------------------------------------------------------
// Fixtures (synthetic plan definitions, after the Stage 3 examples)
// ---------------------------------------------------------------------------

function stRoseDef(overrides: Partial<ServiceDefinition> = {}): ServiceDefinition {
  return {
    planVersionId: "pv-strose-1985",
    creditedMethod: "elapsed-time",
    vestingMethod: "elapsed-time",
    eligibilityMethod: "hours-based",
    fullYearHours: "1000",
    vestingFullYearHours: "1000",
    eligibilityFullYearHours: "1000",
    breakHours: "500",
    hoursBands: null,
    hoursEquivalency: null,
    computationPeriod: "plan-year",
    fractionalConversion: { kind: "months-round-up", citation: "St. Rose §3.2(b)" },
    proration: null,
    vestingSchedule: [
      { minWholeYears: 0, maxWholeYears: 3, percent: "0", ruleRef: "St. Rose §5.4" },
      { minWholeYears: 4, maxWholeYears: 4, percent: "0.4", ruleRef: "St. Rose §5.4" },
      { minWholeYears: 5, maxWholeYears: 5, percent: "0.5", ruleRef: "St. Rose §5.4" },
      { minWholeYears: 6, maxWholeYears: 6, percent: "0.6", ruleRef: "St. Rose §5.4" },
      { minWholeYears: 7, maxWholeYears: 7, percent: "0.7", ruleRef: "St. Rose §5.4" },
      { minWholeYears: 8, maxWholeYears: 8, percent: "0.8", ruleRef: "St. Rose §5.4" },
      { minWholeYears: 9, maxWholeYears: 9, percent: "0.9", ruleRef: "St. Rose §5.4" },
      { minWholeYears: 10, maxWholeYears: null, percent: "1", ruleRef: "St. Rose §5.4" },
    ],
    specialVesting: [],
    breakRule: { credited: null, vesting: null, eligibility: null },
    accrualStart: "participation-date",
    pastServiceCredit: null,
    predecessorServiceCredit: null,
    serviceCap: null,
    freeze: null,
    nrdRule: { kind: "first-of-month-coincident-or-next", citation: "Blond §5.02 shape" },
    leapDayBirthday: "mar-01",
    vestingExcludesPreAge18: false,
    ...overrides,
  };
}

function blondDef(overrides: Partial<ServiceDefinition> = {}): ServiceDefinition {
  return {
    planVersionId: "pv-blond-2006",
    creditedMethod: "hours-based",
    vestingMethod: "hours-based",
    eligibilityMethod: "hours-based",
    fullYearHours: "1800",
    vestingFullYearHours: "1000",
    eligibilityFullYearHours: "1000",
    breakHours: "500",
    hoursBands: [
      { minHours: "1800", maxHours: null, creditYears: "1" },
      { minHours: "1350", maxHours: "1799", creditYears: "0.75" },
      { minHours: "1000", maxHours: "1349", creditYears: "0.5" },
      { minHours: "0", maxHours: "999", creditYears: "0" },
    ],
    hoursEquivalency: null,
    computationPeriod: "plan-year",
    fractionalConversion: null,
    proration: null,
    vestingSchedule: [
      { minWholeYears: 0, maxWholeYears: 4, percent: "0", ruleRef: "Blond §8.02" },
      { minWholeYears: 5, maxWholeYears: null, percent: "1", ruleRef: "Blond §8.02" },
    ],
    specialVesting: [
      { condition: "early-retirement", percent: "1", ruleRef: "Blond §8.02" },
      { condition: "disability", percent: "1", ruleRef: "Blond §8.02" },
    ],
    breakRule: { credited: null, vesting: null, eligibility: null },
    accrualStart: "hire-date",
    pastServiceCredit: null,
    predecessorServiceCredit: null,
    serviceCap: { maxYears: "30", whichYears: "last-n", ruleRef: "Blond §5.01" },
    freeze: {
      freezeDate: "2006-08-01",
      scope: "partial-accrual-only",
      inclusiveOfFreezeDate: false,
      ruleRef: "Blond §1.58",
    },
    nrdRule: { kind: "first-of-month-coincident-or-next", citation: "Blond §5.02 shape" },
    leapDayBirthday: "mar-01",
    vestingExcludesPreAge18: false,
    ...overrides,
  };
}

/** DBAB Q 7:21 Jake: full year = 2,000 hours; vesting threshold 1,000. */
function jakeDef(overrides: Partial<ServiceDefinition> = {}): ServiceDefinition {
  return {
    planVersionId: "pv-jake-example",
    creditedMethod: "hours-based",
    vestingMethod: "hours-based",
    eligibilityMethod: "hours-based",
    fullYearHours: "2000",
    vestingFullYearHours: "1000",
    eligibilityFullYearHours: "1000",
    breakHours: "500",
    hoursBands: null,
    hoursEquivalency: null,
    computationPeriod: "plan-year",
    fractionalConversion: { kind: "hours-fraction", denominatorHours: "2000", citation: "[DBAB-7] Q 7:21" },
    proration: null,
    vestingSchedule: null,
    specialVesting: [],
    breakRule: { credited: null, vesting: null, eligibility: null },
    accrualStart: "hire-date",
    pastServiceCredit: null,
    predecessorServiceCredit: null,
    serviceCap: null,
    freeze: null,
    nrdRule: null,
    leapDayBirthday: "mar-01",
    vestingExcludesPreAge18: false,
    ...overrides,
  };
}

function period(
  start: string,
  end: string | null,
  accrualStartDate: string | null = null,
  hours: EmploymentPeriodInput["hoursByComputationPeriod"] = [],
  breakBefore: EmploymentPeriodInput["breakBefore"] = null,
): EmploymentPeriodInput {
  return {
    periodStart: start,
    periodEnd: end,
    hoursByComputationPeriod: hours,
    leavePeriods: [],
    isCoveredClass: true,
    accrualStartDate,
    breakBefore,
  };
}

function hoursPeriod(start: string, end: string, hours: string | null) {
  return { periodStart: start, periodEnd: end, hours };
}

/** Fictional Ana Ruiz (Stage 2 §8.2): hired 1986-04-01, DOTE 2010-06-30. */
const ANA = period("1986-04-01", "2010-06-30", "1986-04-01");

function svc(value: string | null, missingInputs: string[] = []): ServiceResult {
  return { value, rational: null, periods: [], missingInputs, roundingApplied: [] };
}

const PARITY_RULE: BreakRule = {
  kind: "hours-threshold",
  thresholdHours: "500",
  severanceMonths: null,
  holdout: "none",
  parity: { applies: true, minBreakYears: "5", ruleRef: "Blond §3.05" },
  restoration: null,
  ruleRef: "Blond §3.05",
};

// ---------------------------------------------------------------------------
// T-S-01 / D-2.1 — St. Rose months rule
// ---------------------------------------------------------------------------

describe("T-S-01 / D-2.1: St. Rose months rule reproduces 24.25 exactly", () => {
  it("1986-04-01 -> 2010-06-30 is 24.25 years", () => {
    const result = computeCreditedService([ANA], "2010-06-30", stRoseDef());
    assert.equal(result.value, "24.25");
    assert.deepEqual(result.rational, { numerator: 97n, denominator: 4n });
    assert.deepEqual(result.missingInputs, []);
  });

  it("splits 17.75 + 6.5 sum exactly to 24.25", () => {
    const pre = computeCreditedService(
      [period("1986-04-01", "2003-12-31", "1986-04-01")],
      "2003-12-31",
      stRoseDef(),
    );
    const post = computeCreditedService(
      [period("2004-01-01", "2010-06-30", "2004-01-01")],
      "2010-06-30",
      stRoseDef(),
    );
    assert.equal(pre.value, "17.75");
    assert.equal(post.value, "6.5");
    assert.equal(decAdd(pre.value as string, post.value as string), "24.25");
  });

  it("days/365 is rejected: it does not reproduce 24.25", () => {
    assert.equal(decDivide("8856", "365", 10), "24.2630136986");
    assert.equal(decDivide("8856", "365", 10) === "24.25", false);
    // A plan that actually states days/365 gets days/365 — but only
    // because the plan says so, never by default.
    const daysDef = stRoseDef({
      fractionalConversion: { kind: "days-divided", denominator: "365", citation: "plan § (stated days rule)" },
    });
    assert.equal(computeCreditedService([ANA], "2010-06-30", daysDef).value, "24.2630136986");
  });
});

// ---------------------------------------------------------------------------
// T-S-02 — Blond §1.58 bands (the remaining 6 harness checks)
// ---------------------------------------------------------------------------

describe("T-S-02: Blond §1.58 banded hours table (harness checks 53-58)", () => {
  const cases: Array<[string, string]> = [
    ["1800", "1"],
    ["1799", "0.75"],
    ["1350", "0.75"],
    ["1349", "0.5"],
    ["1000", "0.5"],
    ["999", "0"],
  ];
  for (const [hours, expected] of cases) {
    it(`${hours} hours -> ${expected} year(s)`, () => {
      const p = period("2005-01-01", "2005-12-31", null, [
        hoursPeriod("2005-01-01", "2005-12-31", hours),
      ]);
      const result = computeCreditedService([p], "2005-12-31", blondDef());
      assert.equal(result.value, expected);
    });
  }

  it("the 999 vs 1000 cliff is half a year of credited service", () => {
    const at999 = computeCreditedService(
      [period("2005-01-01", "2005-12-31", null, [hoursPeriod("2005-01-01", "2005-12-31", "999")])],
      "2005-12-31",
      blondDef(),
    );
    const at1000 = computeCreditedService(
      [period("2005-01-01", "2005-12-31", null, [hoursPeriod("2005-01-01", "2005-12-31", "1000")])],
      "2005-12-31",
      blondDef(),
    );
    assert.equal(at999.value, "0");
    assert.equal(at1000.value, "0.5");
  });
});

// ---------------------------------------------------------------------------
// T-S-03 — Jake: same hours, different quantities
// ---------------------------------------------------------------------------

describe("T-S-03: DBAB Jake — 1800/2000 hours is 0.9 credited, 1 vesting", () => {
  it("credited service is the hours fraction", () => {
    const p = period("2020-01-01", "2020-12-31", null, [
      hoursPeriod("2020-01-01", "2020-12-31", "1800"),
    ]);
    const result = computeCreditedService([p], "2020-12-31", jakeDef());
    assert.equal(result.value, "0.9");
    assert.deepEqual(result.rational, { numerator: 9n, denominator: 10n });
  });

  it("vesting service is a whole year at the 1000-hour threshold", () => {
    const p = period("2020-01-01", "2020-12-31", null, [
      hoursPeriod("2020-01-01", "2020-12-31", "1800"),
    ]);
    assert.equal(computeVestingService([p], "2020-12-31", jakeDef()).value, "1");
  });
});

// ---------------------------------------------------------------------------
// T-S-04 / T-S-05 — elapsed-time vesting aggregation and spanning
// ---------------------------------------------------------------------------

describe("T-S-04: DBAB Matt — 400+600+400 days floors to 3 vesting years", () => {
  it("aggregates periods, converts days/365, truncates the remainder", () => {
    const periods = [
      period("2020-01-01", "2021-02-04"),
      period("2021-02-04", "2022-09-27"),
      period("2022-09-27", "2023-11-01"),
    ];
    const result = computeVestingService(periods, "2023-11-01", stRoseDef());
    assert.equal(result.value, "3");
    assert.equal(result.roundingApplied.length, 1);
    assert.equal(result.roundingApplied[0]?.before, "3.8356164384");
    assert.equal(result.roundingApplied[0]?.after, "3");
  });
});

describe("T-S-05: DBAB Walt — service-spanning credits 13 months", () => {
  const walt = [
    period("2020-01-01", "2020-08-31"),
    period("2021-02-01", "2021-06-30"),
  ];
  it("8 months' service + 5 months' severance (under 12 months) = 13 months", () => {
    assert.equal(spanningMonths(walt, "2021-02-01"), 13);
  });

  it("vesting years at the return date are 1 (397 days, remainder disregarded)", () => {
    assert.equal(computeVestingService(walt, "2021-02-01", stRoseDef()).value, "1");
  });
});

// ---------------------------------------------------------------------------
// T-S-06 — ordering: breaks before conversion, cap last
// ---------------------------------------------------------------------------

describe("T-S-06: ordering — breaks in Stage 3, cap at formula-evaluation time", () => {
  it("computeCreditedService does NOT apply the cap (35 years stays 35)", () => {
    const p = period("1986-04-01", "2021-04-01", "1986-04-01");
    const result = computeCreditedService([p], "2021-04-01", stRoseDef());
    assert.equal(result.value, "35");
    assert.equal(result.periods[0]?.creditAfterBreaks, result.periods[0]?.rawCredit);
  });

  it("applyServiceCap then caps the credited quantity to 30", () => {
    const p = period("1986-04-01", "2021-04-01", "1986-04-01");
    const uncapped = computeCreditedService([p], "2021-04-01", stRoseDef());
    const capped = applyServiceCap(uncapped, { maxYears: "30", whichYears: "last-n", ruleRef: "Blond §5.01" }, "2021-04-01");
    assert.equal(capped.value, "30");
  });

  it("a cap above the service, or a null cap, leaves the service unchanged", () => {
    const uncapped = computeCreditedService([ANA], "2010-06-30", stRoseDef());
    assert.equal(
      applyServiceCap(uncapped, { maxYears: "30", whichYears: "last-n", ruleRef: "Blond §5.01" }, "2010-06-30").value,
      "24.25",
    );
    assert.equal(applyServiceCap(uncapped, null, "2010-06-30").value, "24.25");
  });
});

// ---------------------------------------------------------------------------
// T-S-07–T-S-11 — vesting lookups
// ---------------------------------------------------------------------------

describe("T-S-07: St. Rose vesting schedule (graded)", () => {
  it("9 years -> 90%, 10 years -> 100%, 3 years -> 0%", () => {
    const def = stRoseDef();
    assert.equal(vestingPercent(svc("9"), def, "2010-06-30", "termination").vp, "0.9");
    assert.equal(vestingPercent(svc("10"), def, "2010-06-30", "termination").vp, "1");
    assert.equal(vestingPercent(svc("3"), def, "2010-06-30", "termination").vp, "0");
  });

  it("top-heavy schedule: 2 years -> 20%, 6 years -> 100%", () => {
    const def = stRoseDef({
      vestingSchedule: [
        { minWholeYears: 0, maxWholeYears: 1, percent: "0", ruleRef: "St. Rose §6.2(c)" },
        { minWholeYears: 2, maxWholeYears: 2, percent: "0.2", ruleRef: "St. Rose §6.2(c)" },
        { minWholeYears: 3, maxWholeYears: 3, percent: "0.4", ruleRef: "St. Rose §6.2(c)" },
        { minWholeYears: 4, maxWholeYears: 4, percent: "0.6", ruleRef: "St. Rose §6.2(c)" },
        { minWholeYears: 5, maxWholeYears: 5, percent: "0.8", ruleRef: "St. Rose §6.2(c)" },
        { minWholeYears: 6, maxWholeYears: null, percent: "1", ruleRef: "St. Rose §6.2(c)" },
      ],
    });
    assert.equal(vestingPercent(svc("2"), def, "2010-06-30", "termination").vp, "0.2");
    assert.equal(vestingPercent(svc("6"), def, "2010-06-30", "termination").vp, "1");
  });
});

describe("T-S-08 / T-S-09 / T-S-11: Blond cliff, whole years only, special vesting", () => {
  it("Blond cliff: 4 vesting years -> 0%, 5 -> 100%", () => {
    const def = blondDef();
    assert.equal(vestingPercent(svc("4"), def, "2010-06-30", "termination").vp, "0");
    assert.equal(vestingPercent(svc("5"), def, "2010-06-30", "termination").vp, "1");
  });

  it("9.99 vesting years vests at the 9-year row, never the 10-year row", () => {
    assert.equal(vestingPercent(svc("9.99"), stRoseDef(), "2010-06-30", "termination").vp, "0.9");
  });

  it("early-retirement termination is 100% regardless of vesting years", () => {
    const def = blondDef();
    assert.equal(vestingPercent(svc("4"), def, "2010-06-30", "early-retirement").vp, "1");
    assert.equal(vestingPercent(svc("4"), def, "2010-06-30", "termination").vp, "0");
  });

  it("a missing vesting schedule makes VP unknown, not zero (I-5)", () => {
    const def = stRoseDef({ vestingSchedule: null });
    const result = vestingPercent(svc("5"), def, "2010-06-30", "termination");
    assert.equal(result.vp, null);
    assert.deepEqual(result.missingInputs, ["vestingSchedule"]);
  });
});

// ---------------------------------------------------------------------------
// T-S-10 — eligibility
// ---------------------------------------------------------------------------

describe("T-S-10: eligibility — 1000-hour threshold, whole years", () => {
  it("one qualifying year and one short year give 1 year of eligibility service", () => {
    const p = period("1986-01-01", "1987-12-31", null, [
      hoursPeriod("1986-01-01", "1986-12-31", "1000"),
      hoursPeriod("1987-01-01", "1987-12-31", "900"),
    ]);
    assert.equal(computeEligibilityService([p], "1987-12-31", stRoseDef()).value, "1");
  });
});

// ---------------------------------------------------------------------------
// T-S-12 — breaks: parity and holdout
// ---------------------------------------------------------------------------

describe("T-S-12: rule of parity and one-year holdout", () => {
  const preBreak = period("1986-04-01", "1989-04-01", "1986-04-01");

  it("nonvested, 3 pre-break years, 5-year break -> pre-break service disregarded", () => {
    const post = period("1994-04-01", "1995-04-01", "1994-04-01", [], {
      breakYears: "5",
      ruleRef: "Blond §3.05",
    });
    const result = applyBreaks([preBreak, post], "1995-04-01", PARITY_RULE, "nonvested");
    assert.equal(result.periods.length, 1);
    assert.equal(result.disregardedByParity.length, 1);
    assert.equal(result.disregardedByParity[0]?.periodStart, "1986-04-01");
  });

  it("same facts with a 4-year break -> service retained", () => {
    const post = period("1993-04-01", "1994-04-01", "1993-04-01", [], {
      breakYears: "4",
      ruleRef: "Blond §3.05",
    });
    const result = applyBreaks([preBreak, post], "1994-04-01", PARITY_RULE, "nonvested");
    assert.equal(result.periods.length, 2);
    assert.equal(result.disregardedByParity.length, 0);
  });

  it("vested participant with a 5-year break -> service retained", () => {
    const post = period("1994-04-01", "1995-04-01", "1994-04-01", [], {
      breakYears: "5",
      ruleRef: "Blond §3.05",
    });
    const result = applyBreaks([preBreak, post], "1995-04-01", PARITY_RULE, "vested");
    assert.equal(result.periods.length, 2);
    assert.equal(result.disregardedByParity.length, 0);
  });

  it("one-year holdout: pre-break service held out until a post-break year is completed", () => {
    const holdoutRule: BreakRule = { ...PARITY_RULE, holdout: "one-year-holdout", parity: null };
    const shortReturn = period("1990-01-01", "1990-06-30", "1990-01-01", [], {
      breakYears: "1",
      ruleRef: "plan §",
    });
    const held = applyBreaks([preBreak, shortReturn], "1990-06-30", holdoutRule, "nonvested");
    assert.equal(held.periods.length, 1);
    assert.equal(held.heldOut.length, 1);
    const longReturn = period("1990-01-01", "1991-06-30", "1990-01-01", [], {
      breakYears: "1",
      ruleRef: "plan §",
    });
    const restored = applyBreaks([preBreak, longReturn], "1991-06-30", holdoutRule, "nonvested");
    assert.equal(restored.periods.length, 2);
    assert.equal(restored.heldOut.length, 0);
  });
});

// ---------------------------------------------------------------------------
// T-S-13 / T-S-14 — cap and freeze
// ---------------------------------------------------------------------------

describe("T-S-13: cap — Blond last-30-years rule", () => {
  it("35 years caps to 30; first-N and last-N give the same capped total", () => {
    const p = period("1986-04-01", "2021-04-01", "1986-04-01");
    const uncapped = computeCreditedService([p], "2021-04-01", stRoseDef());
    assert.equal(uncapped.value, "35");
    assert.equal(
      applyServiceCap(uncapped, { maxYears: "30", whichYears: "last-n", ruleRef: "Blond §5.01" }, "2021-04-01").value,
      "30",
    );
    assert.equal(
      applyServiceCap(uncapped, { maxYears: "30", whichYears: "first-n", ruleRef: "plan §" }, "2021-04-01").value,
      "30",
    );
    // The which-years choice changes which years' unit rates apply at
    // the formula stage, not the capped total — it is carried in the
    // cap's ruleRef, not in the service value.
  });
});

describe("T-S-14: freeze — Blond credited service frozen 2006-08-01", () => {
  const frozenDef = stRoseDef({
    freeze: {
      freezeDate: "2006-08-01",
      scope: "partial-accrual-only",
      inclusiveOfFreezeDate: false,
      ruleRef: "Blond §1.58",
    },
  });

  it("credited service stops at 2006-07-31; vesting service continues", () => {
    assert.equal(computeCreditedService([ANA], "2010-06-30", frozenDef).value, "20.3333333333");
    assert.equal(computeVestingService([ANA], "2010-06-30", frozenDef).value, "24");
  });

  it("applyFreeze is a guard: no freeze, or asOf before the freeze, leaves the service unchanged", () => {
    const unfrozen = computeCreditedService([ANA], "2010-06-30", stRoseDef());
    assert.equal(applyFreeze(unfrozen, null, "2010-06-30").value, "24.25");
    const preFreeze = computeCreditedService([ANA], "2006-07-31", stRoseDef());
    assert.equal(applyFreeze(preFreeze, frozenDef.freeze, "2006-07-31", frozenDef).value, "20.3333333333");
  });

  it("applyFreeze with the definition recomputes a straddling period exactly; without it, it refuses", () => {
    const unfrozen = computeCreditedService([ANA], "2010-06-30", stRoseDef());
    const withDef = applyFreeze(unfrozen, frozenDef.freeze, "2010-06-30", frozenDef);
    assert.equal(withDef.value, "20.3333333333");
    const withoutDef = applyFreeze(unfrozen, frozenDef.freeze, "2010-06-30");
    assert.equal(withoutDef.value, null);
    assert.equal(withoutDef.missingInputs.includes("applyFreeze:conversion-unknown"), true);
  });
});

// ---------------------------------------------------------------------------
// T-S-15 / T-S-16 / T-S-17 — version split, NRD, service at a date
// ---------------------------------------------------------------------------

describe("T-S-15: version split — pre-2004 17.75, post-2003 6.5", () => {
  it("splits at the amendment effective date; the latest rate is never retroactive", () => {
    const service = computeCreditedService([ANA], "2010-06-30", stRoseDef());
    const split = splitServiceByVersion(
      service,
      [
        { planVersionId: "pv-1985", effectiveDate: "1986-04-01" },
        { planVersionId: "pv-2004", effectiveDate: "2004-01-01" },
      ],
      "2010-06-30",
      stRoseDef(),
    );
    assert.deepEqual(split, [
      { planVersionId: "pv-1985", service: "17.75" },
      { planVersionId: "pv-2004", service: "6.5" },
    ]);
    assert.equal(decAdd(split[0]?.service as string, split[1]?.service as string), "24.25");
  });
});

describe("T-S-16: NRD — the plan's boundary rule selects the date", () => {
  it("first-of-month-coincident-or-next gives 2025-04-01; birthday rule gives 2025-03-14", () => {
    const firstOfMonth = stRoseDef({
      nrdRule: { kind: "first-of-month-coincident-or-next", citation: "Blond §5.02 shape" },
    });
    const birthday = stRoseDef({ nrdRule: { kind: "birthday", citation: "plan §" } });
    assert.equal(normalRetirementDate("1960-03-14", "65", firstOfMonth), "2025-04-01");
    assert.equal(normalRetirementDate("1960-03-14", "65", birthday), "2025-03-14");
  });

  it("a birthday on the 1st is coincident: first-of-month gives the birthday itself", () => {
    assert.equal(normalRetirementDate("1960-03-01", "65", stRoseDef()), "2025-03-01");
  });

  it("a missing NRD rule returns null; an unknown rule kind returns null", () => {
    assert.equal(normalRetirementDate("1960-03-14", "65", stRoseDef({ nrdRule: null })), null);
    assert.equal(
      normalRetirementDate(
        "1960-03-14",
        "65",
        stRoseDef({ nrdRule: { kind: "some-unrecorded-rule", citation: "plan §" } }),
      ),
      null,
    );
  });
});

describe("T-S-17: serviceAtDate — one participant, three different dated measures", () => {
  it("credited service at 2000-06-30, 2006-07-31, and DOTE 2010-06-30", () => {
    const def = stRoseDef();
    assert.equal(serviceAtDate([ANA], "2000-06-30", def).credited.value, "14.25");
    assert.equal(serviceAtDate([ANA], "2006-07-31", def).credited.value, "20.3333333333");
    assert.equal(serviceAtDate([ANA], "2010-06-30", def).credited.value, "24.25");
  });

  it("DOTE vs DOPT: service stops at DOTE for a terminated participant (D-4.1)", () => {
    const def = stRoseDef();
    assert.equal(serviceAtDate([ANA], "2010-06-30", def).credited.value, "24.25");
    assert.equal(serviceAtDate([ANA], "2012-06-30", def).credited.value, "24.25");
  });
});

// ---------------------------------------------------------------------------
// §2.1 — the three quantities are different
// ---------------------------------------------------------------------------

describe("three quantities: credited vs vesting vs eligibility (§2.1)", () => {
  it("hired 1986-04-01, participant 1987-07-01: credited 23, vesting 24, eligibility 24", () => {
    const def = stRoseDef({ eligibilityMethod: "elapsed-time" });
    const p = period("1986-04-01", "2010-06-30", "1987-07-01");
    const all = serviceAtDate([p], "2010-06-30", def);
    assert.equal(all.credited.value, "23");
    assert.equal(all.vesting.value, "24");
    assert.equal(all.eligibility.value, "24");
    assert.equal(all.credited.value === all.vesting.value, false);
  });

  it("vesting and credited service are computed independently, never copied", () => {
    const def = stRoseDef();
    const all = serviceAtDate([ANA], "2010-06-30", def);
    // Credited is fractional (months rule); vesting is whole years.
    assert.equal(all.credited.value, "24.25");
    assert.equal(all.vesting.value, "24");
  });
});

// ---------------------------------------------------------------------------
// Proration and documented special credits
// ---------------------------------------------------------------------------

describe("proration and special credits (§2.4)", () => {
  it("service-channel proration multiplies the converted credit", () => {
    const def = stRoseDef({
      proration: { channel: "service", ruleRef: "plan §", factor: "0.5" },
    });
    assert.equal(computeCreditedService([ANA], "2010-06-30", def).value, "12.125");
  });

  it("proration stated without a factor is missing, not assumed", () => {
    const def = stRoseDef({
      proration: { channel: "service", ruleRef: "plan §", factor: null },
    });
    const result = computeCreditedService([ANA], "2010-06-30", def);
    assert.equal(result.value, null);
    assert.equal(result.missingInputs.includes("proration.factor"), true);
  });

  it("documented past-service credit is added with its citation", () => {
    const def = stRoseDef({
      pastServiceCredit: {
        description: "pre-effective-date service",
        ruleRef: "St. Rose §3.2(a)",
        creditYears: "2",
      },
    });
    assert.equal(computeCreditedService([ANA], "2010-06-30", def).value, "26.25");
  });
});

// ---------------------------------------------------------------------------
// T-I-01–T-I-06 — indeterminacy (the engine does not invent definitions)
// ---------------------------------------------------------------------------

describe("indeterminacy (T-I-01–T-I-06, §5.8 rules I-1–I-4)", () => {
  it("T-I-01: creditedMethod null -> value null, missingInputs ['creditedMethod']", () => {
    const result = computeCreditedService([ANA], "2010-06-30", stRoseDef({ creditedMethod: null }));
    assert.equal(result.value, null);
    assert.deepEqual(result.missingInputs, ["creditedMethod"]);
  });

  it("T-I-02: hours missing for a computation period -> unknown, never elapsed time", () => {
    const p = period("2020-01-01", "2020-12-31", null, [
      hoursPeriod("2020-01-01", "2020-12-31", null),
    ]);
    const result = computeCreditedService([p], "2020-12-31", jakeDef());
    assert.equal(result.value, null);
    assert.equal(result.missingInputs.includes("hours:2020-01-01"), true);
    // The period's range under the STATED method is 0 … 1 year.
    assert.deepEqual(hoursPeriodCreditRange(jakeDef()), { min: "0", max: "1" });
    assert.deepEqual(hoursPeriodCreditRange(blondDef()), { min: "0", max: "1" });
  });

  it("T-I-03: fractionalConversion null -> value null; the decomposition is still reported", () => {
    const result = computeCreditedService([ANA], "2010-06-30", stRoseDef({ fractionalConversion: null }));
    assert.equal(result.value, null);
    assert.equal(result.missingInputs.includes("fractionalConversion"), true);
    assert.deepEqual(completedYMD("1986-04-01", "2010-06-30"), { years: 24, months: 2, days: 29 });
  });

  it("T-I-04: leap-day DOB with a null convention -> NRD refuses; service still computable", () => {
    const def = stRoseDef({
      leapDayBirthday: null,
      nrdRule: { kind: "birthday", citation: "plan §" },
    });
    assert.equal(normalRetirementDate("2000-02-29", "65", def), null);
    assert.equal(
      normalRetirementDate(
        "2000-02-29",
        "65",
        stRoseDef({ leapDayBirthday: "mar-01", nrdRule: { kind: "birthday", citation: "plan §" } }),
      ),
      "2065-03-01",
    );
    assert.equal(
      normalRetirementDate(
        "2000-02-29",
        "65",
        stRoseDef({ leapDayBirthday: "feb-28", nrdRule: { kind: "birthday", citation: "plan §" } }),
      ),
      "2065-02-28",
    );
    // Age-dependent quantities are indeterminate; service is not.
    assert.equal(computeCreditedService([ANA], "2010-06-30", def).value, "24.25");
  });

  it("T-I-05: DOTE null -> serviceAtDate unresolved; no Δ computed", () => {
    const all = serviceAtDate([ANA], null, stRoseDef());
    assert.equal(all.credited.value, null);
    assert.equal(all.vesting.value, null);
    assert.equal(all.eligibility.value, null);
    assert.equal(all.credited.missingInputs.includes("measurementDate"), true);
  });

  it("T-I-06: amendment effective date missing -> the split refuses (I-4)", () => {
    const service = computeCreditedService([ANA], "2010-06-30", stRoseDef());
    assert.throws(
      () =>
        splitServiceByVersion(
          service,
          [
            { planVersionId: "pv-1985", effectiveDate: "1986-04-01" },
            { planVersionId: "pv-2004", effectiveDate: null },
          ],
          "2010-06-30",
          stRoseDef(),
        ),
      /effective date missing/,
    );
    assert.throws(
      () =>
        splitServiceByVersion(
          service,
          [
            { planVersionId: "pv-1985", effectiveDate: "1986-04-01" },
            { planVersionId: "pv-2004", effectiveDate: "2004-01-01" },
          ],
          "2010-06-30",
        ),
      /no ServiceDefinition/,
    );
  });

  it("I-6: indeterminacy is per-quantity — credited unknown, vesting still known", () => {
    const def = stRoseDef({ creditedMethod: null });
    const all = serviceAtDate([ANA], "2010-06-30", def);
    assert.equal(all.credited.value, null);
    assert.equal(all.vesting.value, "24");
  });
});
