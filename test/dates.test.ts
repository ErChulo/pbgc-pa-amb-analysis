/**
 * Unit tests for src/dates.ts — the nine date primitives.
 *
 * This file ports the Stage 3 Node verification harness
 * (stage3/date-primitives-harness.js, 58/58 checks, Node v24.22.1, day
 * counts cross-checked against GNU `date`) into the TypeScript test
 * suite as a regression suite. 52 of the 58 checks live here; the 6
 * Blond §1.58 band checks live in test/service.test.ts, where the band
 * function lives (they are counted there, so the total is still 58).
 *
 * Two harness values are ported CORRECTED, not verbatim: the harness's
 * own days/365 checks used the pre-correction day counts 8861/6478
 * (the harness author notes two hand-computed counts were wrong and
 * were corrected to 8856/6483 — see stage3/02-date-calculations.md
 * Appendix A). 8856/365 = 24.2630136986 and 6483/365 = 17.7616438356,
 * not the 24.2767 / 17.7479 printed in the Stage 3 doc's §2.5 table,
 * which still carries the stale counts. The conclusion is unchanged —
 * days/365 does not reproduce 24.25 — and is now exact.
 *
 * Run with plain node + node:test (no test framework dependency):
 *   npm test            (builds with tsc, then runs node --test dist/test/)
 *
 * Synthetic dates only. No live case data.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addMonths,
  addYears,
  ageAt,
  completedYMD,
  dateFromDays,
  daysBetween,
  daysInMonth,
  daysSinceEpoch,
  firstOfMonthCoincidentOrNext,
  isLeapYear,
  monthStart,
  nextMonthStart,
  nextYearStart,
  validateDateString,
  yearStart,
} from "../src/dates.js";
import { decAdd, decDivide } from "../src/decimal.js";

/** St. Rose §3.2(b) months rule, from completedYMD: completed years and
 *  months with any fractional part of a month rounded UP to a whole month. */
function stRoseMonths(start: string, end: string): string {
  const { years, months, days } = completedYMD(start, end);
  const totalMonths = years * 12 + months + (days > 0 ? 1 : 0);
  return decDivide(String(totalMonths), "12", 10);
}

describe("days-between (T-D-01): exclusive of start, inclusive of end", () => {
  it("one day between consecutive dates; zero for the same date", () => {
    assert.equal(daysBetween("2020-01-01", "2020-01-02"), 1);
    assert.equal(daysBetween("2020-02-29", "2020-02-29"), 0);
    // Inclusive count (both endpoints) is daysBetween + 1.
    assert.equal(daysBetween("2020-01-01", "2020-01-31") + 1, 31);
  });

  it("leap February counts 2 days, non-leap February 1 day", () => {
    assert.equal(daysBetween("2020-02-28", "2020-03-01"), 2);
    assert.equal(daysBetween("2021-02-28", "2021-03-01"), 1);
  });

  it("year boundary is 1 day; Stage 2 example spans are exact", () => {
    assert.equal(daysBetween("2020-12-31", "2021-01-01"), 1);
    assert.equal(daysBetween("1986-04-01", "2010-06-30"), 8856);
    assert.equal(daysBetween("1986-04-01", "2003-12-31"), 6483);
    assert.equal(daysBetween("2004-01-01", "2010-06-30"), 2372);
  });
});

describe("days-since-epoch (T-D-02): Int32 round-trip, no drift", () => {
  it("epoch values match the harness table", () => {
    assert.equal(daysSinceEpoch("1970-01-01"), 0);
    assert.equal(daysSinceEpoch("2020-02-29"), 18321);
    assert.equal(daysSinceEpoch("1900-01-01"), -25567);
    assert.equal(daysSinceEpoch("2099-12-31") <= 2147483647, true);
  });

  it("round-trips date -> days -> date", () => {
    assert.equal(dateFromDays(daysSinceEpoch("2020-02-29")), "2020-02-29");
    assert.equal(dateFromDays(daysSinceEpoch("1986-04-01")), "1986-04-01");
    assert.equal(dateFromDays(daysSinceEpoch("2010-06-30")), "2010-06-30");
  });

  it("no drift over the sampled range 1900-01-01 to 2099-12-31", () => {
    let drift = false;
    for (let n = -25567; n <= 47481; n += 7919) {
      if (daysSinceEpoch(dateFromDays(n)) !== n) drift = true;
    }
    assert.equal(drift, false);
  });
});

describe("leap years (T-D-03): Gregorian rule, always", () => {
  it("divisible by 400 leaps; divisible by 100 (not 400) does not", () => {
    assert.equal(isLeapYear(2020), true);
    assert.equal(isLeapYear(2000), true);
    assert.equal(isLeapYear(1900), false);
    assert.equal(isLeapYear(2021), false);
  });

  it("February has 29 days in a leap year, 28 otherwise", () => {
    assert.equal(daysInMonth(2020, 2), 29);
    assert.equal(daysInMonth(2021, 2), 28);
    assert.equal(daysInMonth(1900, 2), 28);
    assert.equal(daysInMonth(2000, 2), 29);
  });
});

describe("addMonths / addYears (T-D-04, T-D-05): month-end clamping, non-sticky", () => {
  it("clamps to the target month's last day", () => {
    assert.equal(addMonths("2020-01-31", 1), "2020-02-29");
    assert.equal(addMonths("2021-01-31", 1), "2021-02-28");
    assert.equal(addMonths("2020-01-30", 1), "2020-02-29");
    assert.equal(addMonths("2020-03-31", -1), "2020-02-29");
    assert.equal(addMonths("2020-08-31", 6), "2021-02-28");
  });

  it("crosses year boundaries correctly", () => {
    assert.equal(addMonths("2020-12-31", 1), "2021-01-31");
    assert.equal(addMonths("2019-12-15", 13), "2021-01-15");
  });

  it("addYears on a leap day clamps in non-leap years", () => {
    assert.equal(addYears("2020-02-29", 1), "2021-02-28");
    assert.equal(addYears("2020-02-29", 4), "2024-02-29");
    assert.equal(addYears("2020-02-29", -1), "2019-02-28");
  });

  it("clamping is NOT sticky: Jan 31 + 1 month + 1 month is Mar 29", () => {
    assert.equal(addMonths(addMonths("2020-01-31", 1), 1), "2020-03-29");
  });
});

describe("age (T-D-06): completed years by the calendar method", () => {
  it("age at DOTE and around the 65th birthday", () => {
    assert.equal(ageAt("1960-03-14", "2010-06-30"), 50);
    assert.equal(ageAt("1960-03-14", "2025-03-13"), 64);
    assert.equal(ageAt("1960-03-14", "2025-03-14"), 65);
  });

  it("leap-day birthday under the mar-01 convention (harness raw calendar behaviour)", () => {
    assert.equal(ageAt("2000-02-29", "2021-02-28", "mar-01"), 20);
    assert.equal(ageAt("2000-02-29", "2021-03-01", "mar-01"), 21);
  });

  it("leap-day birthday under the feb-28 convention turns 21 on Feb 28", () => {
    assert.equal(ageAt("2000-02-29", "2021-02-28", "feb-28"), 21);
  });

  it("leap-day birthday with a null convention REFUSES in a non-leap year (D-1.5)", () => {
    assert.throws(() => ageAt("2000-02-29", "2021-02-28", null), /leap-day birthday/);
    assert.throws(() => ageAt("2000-02-29", "2021-03-01", null), /leap-day birthday/);
    // In a leap year there is nothing to decide: no refusal.
    assert.equal(ageAt("2000-02-29", "2024-02-29", null), 24);
    // A non-leap-day birthday never needs the convention.
    assert.equal(ageAt("1960-03-14", "2025-03-14", null), 65);
  });

  it("refuses a measurement date before the date of birth", () => {
    assert.throws(() => ageAt("1960-03-14", "1960-03-13"), /before date of birth/);
  });
});

describe("completed YMD (T-D-07): calendar decomposition", () => {
  it("DBAB Q 7:35 Lynn: two years and two months, exactly as stated", () => {
    assert.deepEqual(completedYMD("2011-01-15", "2013-03-15"), { years: 2, months: 2, days: 0 });
  });

  it("DBAB Q 7:38 Matt: 1400 days / 365 floors to 3 vesting years", () => {
    assert.equal(Math.floor(1400 / 365), 3);
  });

  it("Stage 2 example spans decompose exactly", () => {
    assert.deepEqual(completedYMD("1986-04-01", "2010-06-30"), { years: 24, months: 2, days: 29 });
    assert.deepEqual(completedYMD("1986-04-01", "2003-12-31"), { years: 17, months: 8, days: 30 });
    assert.deepEqual(completedYMD("2004-01-01", "2010-06-30"), { years: 6, months: 5, days: 29 });
  });

  it("month-end start dates decompose by the clamping rule, not by borrowing", () => {
    // Jan 31 + 1 month clamps to Feb 29, plus 1 day: {0, 1, 1}.
    assert.deepEqual(completedYMD("2020-01-31", "2020-03-01"), { years: 0, months: 1, days: 1 });
  });

  it("refuses end before start", () => {
    assert.throws(() => completedYMD("2010-06-30", "1986-04-01"), /before start/);
  });
});

describe("St. Rose months rule vs days/365 (D-2.1, from the harness)", () => {
  it("months round-up reproduces 24.25 / 17.75 / 6.5 exactly", () => {
    assert.equal(stRoseMonths("1986-04-01", "2010-06-30"), "24.25");
    assert.equal(stRoseMonths("1986-04-01", "2003-12-31"), "17.75");
    assert.equal(stRoseMonths("2004-01-01", "2010-06-30"), "6.5");
    assert.equal(
      decAdd(stRoseMonths("1986-04-01", "2003-12-31"), stRoseMonths("2004-01-01", "2010-06-30")),
      "24.25",
    );
  });

  it("days/365 does NOT reproduce them (verified day counts 8856 / 6483)", () => {
    assert.equal(decDivide("8856", "365", 10), "24.2630136986");
    assert.equal(decDivide("6483", "365", 10), "17.7616438356");
    assert.equal(decDivide("2372", "365", 10), "6.498630137");
    assert.equal(decDivide("8856", "365", 10) === "24.25", false);
    assert.equal(decDivide("6483", "365", 10) === "17.75", false);
  });
});

describe("month / year boundaries (T-D-08)", () => {
  it("first-of-month coincident-or-next (Blond §5.02 shape)", () => {
    assert.equal(firstOfMonthCoincidentOrNext("2020-03-01"), "2020-03-01");
    assert.equal(firstOfMonthCoincidentOrNext("2020-03-02"), "2020-04-01");
    assert.equal(firstOfMonthCoincidentOrNext("2020-03-31"), "2020-04-01");
  });

  it("monthStart / nextMonthStart / yearStart / nextYearStart", () => {
    assert.equal(monthStart("2020-03-14"), "2020-03-01");
    assert.equal(nextMonthStart("2020-03-14"), "2020-04-01");
    assert.equal(nextMonthStart("2020-12-15"), "2021-01-01");
    assert.equal(yearStart("2020-03-14"), "2020-01-01");
    assert.equal(nextYearStart("2020-03-14"), "2021-01-01");
  });
});

describe("validation (T-D-09): invalid dates are rejected, never coerced", () => {
  it("rejects impossible calendar dates", () => {
    assert.throws(() => validateDateString("2021-02-29"), /Not a valid calendar date/);
    assert.throws(() => validateDateString("2020-13-01"), /Not a valid calendar date/);
    assert.throws(() => validateDateString("2020-00-10"), /Not a valid calendar date/);
    assert.throws(() => validateDateString("2020-02-30"), /Not a valid calendar date/);
  });

  it("rejects non-ISO strings", () => {
    assert.throws(() => validateDateString("1986-4-1"), /Not a valid ISO calendar date/);
    assert.throws(() => validateDateString("04/01/1986"), /Not a valid ISO calendar date/);
    assert.throws(() => validateDateString(""), /Not a valid ISO calendar date/);
    assert.throws(() => validateDateString("2020-01-01T00:00:00"), /Not a valid ISO calendar date/);
  });

  it("accepts valid dates and rejects them in the other primitives too", () => {
    assert.equal(validateDateString("2020-02-29"), "2020-02-29");
    assert.throws(() => daysBetween("2021-02-29", "2021-03-01"), /Not a valid calendar date/);
    assert.throws(() => addMonths("2021-02-29", 1), /Not a valid calendar date/);
    assert.throws(() => daysInMonth(2020, 13), /invalid year\/month/);
  });
});
