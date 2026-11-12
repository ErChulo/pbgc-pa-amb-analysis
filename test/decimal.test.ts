/**
 * Unit tests for src/decimal.ts — exact-decimal arithmetic.
 *
 * Run with plain node + node:test (no test framework dependency):
 *   npm test            (builds with tsc, then runs node --test dist/test/)
 *
 * Synthetic values only. No live case data. Expected values below are
 * hand-computed from the decimal definitions, plus the two worked
 * examples in Stage 2 output 04 (§8 exact, §9 bounds).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalDecimalString,
  decAdd,
  decCompare,
  decDivide,
  decMultiply,
  decRound,
  decSubtract,
  isCanonicalDecimalString,
  makeMoney,
  moneyFromDecimalString,
  moneyMinorFromDecimalString,
  moneyMinorToDecimalString,
  parseDecimalString,
  rationalToDecimalString,
  scaledIntToDecimalString,
} from "../src/decimal.js";

describe("canonical form (Stage 3 §5.5, D-5.1)", () => {
  it("renders parsed decimals canonically", () => {
    assert.equal(scaledIntToDecimalString(parseDecimalString("0.015")), "0.015");
    assert.equal(scaledIntToDecimalString(parseDecimalString("10.00")), "10");
    assert.equal(scaledIntToDecimalString(parseDecimalString("-0.00")), "0");
    assert.equal(scaledIntToDecimalString(parseDecimalString("1234.560")), "1234.56");
    assert.equal(canonicalDecimalString("22.50"), "22.5");
  });

  it("recognises canonical strings and rejects the rest", () => {
    assert.equal(isCanonicalDecimalString("0.015"), true);
    assert.equal(isCanonicalDecimalString("1234.56"), true);
    assert.equal(isCanonicalDecimalString("22.5"), true);
    assert.equal(isCanonicalDecimalString("0"), true);
    assert.equal(isCanonicalDecimalString("10"), true);
    assert.equal(isCanonicalDecimalString("1.50"), false); // trailing zero
    assert.equal(isCanonicalDecimalString("1.00"), false);
    assert.equal(isCanonicalDecimalString("01"), false); // leading zero
    assert.equal(isCanonicalDecimalString("-0"), false);
    assert.equal(isCanonicalDecimalString("1e3"), false); // no exponents
    assert.equal(isCanonicalDecimalString(".5"), false);
    assert.equal(isCanonicalDecimalString("5."), false);
    assert.equal(isCanonicalDecimalString(""), false);
  });

  it("refuses strings that are not exact decimals", () => {
    assert.throws(() => parseDecimalString("abc"), /Not an exact decimal string/);
    assert.throws(() => parseDecimalString("1e3"), /Not an exact decimal string/);
    assert.throws(() => parseDecimalString(""), /Not an exact decimal string/);
    assert.throws(() => parseDecimalString("1,000.00"), /Not an exact decimal string/);
  });
});

describe("exact add / subtract / multiply (no binary float)", () => {
  it("0.1 + 0.2 is exactly 0.3", () => {
    assert.equal(decAdd("0.1", "0.2"), "0.3");
  });

  it("adds and subtracts across scales", () => {
    assert.equal(decAdd("1234.56", "0.44"), "1235");
    assert.equal(decAdd("-5", "5"), "0");
    assert.equal(decSubtract("1.5", "0.75"), "0.75");
    assert.equal(decSubtract("0", "0.005"), "-0.005");
    assert.equal(decSubtract("17.75", "6.5"), "11.25");
  });

  it("multiplies exactly; scales add", () => {
    assert.equal(decMultiply("0.015", "20"), "0.3");
    assert.equal(decMultiply("1.5", "5000"), "7500");
    assert.equal(decMultiply("0.1", "0.2"), "0.02");
    assert.equal(decMultiply("-2", "3.5"), "-7");
    assert.equal(decMultiply("0", "1234.56"), "0");
  });
});

describe("division at a recorded scale >= 10 (04 §3.1 R-2)", () => {
  it("divides 1/3 and 2/3 at scale 10, half-up", () => {
    assert.equal(decDivide("1", "3", 10), "0.3333333333");
    assert.equal(decDivide("2", "3", 10), "0.6666666667");
  });

  it("divides exactly when the result terminates", () => {
    assert.equal(decDivide("14400", "3", 10), "4800");
    assert.equal(decDivide("5000", "12", 10), "416.6666666667");
  });

  it("rounds away from zero for negative divisors", () => {
    assert.equal(decDivide("2", "-3", 10), "-0.6666666667");
    assert.equal(decDivide("-2", "3", 10), "-0.6666666667");
  });

  it("refuses division by zero and scale below 10", () => {
    assert.throws(() => decDivide("1", "0", 10), /division by zero/);
    assert.throws(() => decDivide("1", "3", 9), /scale >= 10/);
    assert.throws(() => decDivide("1", "3", 2), /scale >= 10/);
  });
});

describe("rounding at prescribed points only (04 §3.1 R-3, §4.2)", () => {
  it("half-up rounds ties away from zero", () => {
    assert.equal(decRound("2.5", "1", "half-up"), "3");
    assert.equal(decRound("-2.5", "1", "half-up"), "-3");
    assert.equal(decRound("1.005", "0.01", "half-up"), "1.01");
    // Exact-decimal proof: 2.675 is exact here, so it rounds up.
    // (A binary float would give 2.67.)
    assert.equal(decRound("2.675", "0.01", "half-up"), "2.68");
  });

  it("half-even rounds ties to the even neighbour", () => {
    assert.equal(decRound("2.5", "1", "half-even"), "2");
    assert.equal(decRound("3.5", "1", "half-even"), "4");
    assert.equal(decRound("-2.5", "1", "half-even"), "-2");
    assert.equal(decRound("-3.5", "1", "half-even"), "-4");
    assert.equal(decRound("1.005", "0.01", "half-even"), "1");
  });

  it("down truncates toward zero; up rounds away from zero", () => {
    assert.equal(decRound("1.9", "1", "down"), "1");
    assert.equal(decRound("-1.9", "1", "down"), "-1");
    assert.equal(decRound("1.1", "1", "up"), "2");
    assert.equal(decRound("-1.1", "1", "up"), "-2");
  });

  it("floor goes toward -inf; ceiling toward +inf", () => {
    assert.equal(decRound("1.9", "1", "floor"), "1");
    assert.equal(decRound("-1.1", "1", "floor"), "-2");
    assert.equal(decRound("1.1", "1", "ceiling"), "2");
    assert.equal(decRound("-1.9", "1", "ceiling"), "-1");
  });

  it("a no-op rounding is recorded as a no-op, not an error", () => {
    assert.equal(decRound("1500", "0.01", "half-up"), "1500");
  });

  it("refuses a non-positive unit", () => {
    assert.throws(() => decRound("1.5", "0", "half-up"), /unit must be positive/);
    assert.throws(() => decRound("1.5", "-1", "half-up"), /unit must be positive/);
  });
});

describe("comparison without float", () => {
  it("compares exact decimals", () => {
    assert.equal(decCompare("1.0", "1"), 0);
    assert.equal(decCompare("0.015", "0.02"), -1);
    assert.equal(decCompare("0.02", "0.015"), 1);
    assert.equal(decCompare("-1", "0"), -1);
    assert.equal(decCompare("22.5", "22.50"), 0);
  });
});

describe("rationals retained alongside (Stage 3 §5.5, D-5.1)", () => {
  it("converts terminating rationals exactly", () => {
    assert.equal(
      rationalToDecimalString({ numerator: 3n, denominator: 4n }, 10, "half-up"),
      "0.75",
    );
    assert.equal(
      rationalToDecimalString({ numerator: 1800n, denominator: 2000n }, 10, "half-up"),
      "0.9",
    );
    assert.equal(
      rationalToDecimalString({ numerator: 1n, denominator: 2n }, 10, "half-up"),
      "0.5",
    );
  });

  it("converts non-terminating rationals only at scale >= 10", () => {
    assert.equal(
      rationalToDecimalString({ numerator: 1n, denominator: 3n }, 10, "half-up"),
      "0.3333333333",
    );
    // Fractional-accrual ratchet alternative 5.5/39.5 = 11/79 (DBAB Q 9:9).
    assert.equal(
      rationalToDecimalString({ numerator: 11n, denominator: 79n }, 10, "half-up"),
      "0.1392405063",
    );
  });

  it("refuses a zero denominator and a scale below 10", () => {
    assert.throws(
      () => rationalToDecimalString({ numerator: 1n, denominator: 0n }, 10, "half-up"),
      /zero denominator/,
    );
    assert.throws(
      () => rationalToDecimalString({ numerator: 1n, denominator: 3n }, 9, "half-up"),
      /scale >= 10/,
    );
  });
});

describe("money guard — integer minor units, never a float (01 §1.2)", () => {
  it("builds money from integer minor units", () => {
    assert.deepEqual(makeMoney(150000), {
      amountMinor: 150000,
      minorUnitsPerMajor: 100,
      currency: "USD",
      sourceDecimalPlaces: null,
    });
    assert.equal(makeMoney(-50).amountMinor, -50);
  });

  it("refuses non-integer minor units", () => {
    assert.throws(() => makeMoney(100.5), /integer minor units/);
  });

  it("converts exact decimal dollars to cents", () => {
    assert.equal(moneyMinorFromDecimalString("10.00"), 1000);
    assert.equal(moneyMinorFromDecimalString("0.1"), 10);
    assert.equal(moneyMinorFromDecimalString("1232.50"), 123250);
    assert.equal(moneyMinorFromDecimalString("-5"), -500);
  });

  it("refuses values that are not an exact whole number of cents", () => {
    assert.throws(
      () => moneyMinorFromDecimalString("10.005"),
      /Not an exact whole number of cents/,
    );
    assert.throws(
      () => moneyMinorFromDecimalString("0.001"),
      /Not an exact whole number of cents/,
    );
  });

  it("builds Money from a decimal string and renders cents back", () => {
    assert.deepEqual(moneyFromDecimalString("1232.50", 2), {
      amountMinor: 123250,
      minorUnitsPerMajor: 100,
      currency: "USD",
      sourceDecimalPlaces: 2,
    });
    assert.equal(moneyMinorToDecimalString(123250), "1232.5");
    assert.equal(moneyMinorToDecimalString(1000), "10");
    assert.equal(moneyMinorToDecimalString(0), "0");
    assert.equal(moneyMinorToDecimalString(-50), "-0.5");
  });
});

describe("worked examples (Stage 2 output 04, §8 and §9)", () => {
  it("§8 exact case: 0.015 x 20 x $5,000.00 = $1,500.00", () => {
    const average = decDivide(decAdd(decAdd("4800", "5000"), "5200"), "3", 10);
    assert.equal(average, "5000");
    const benefit = decMultiply(decMultiply("0.015", "20"), average);
    assert.equal(benefit, "1500");
    assert.equal(moneyMinorFromDecimalString(benefit), 150000);
  });

  it("§9 bounds case: missing year bounded [$4,500, $5,400] -> [$1,584, $1,683]", () => {
    const avgMin = decDivide(decAdd(decAdd("4800", "5100"), "4500"), "3", 10);
    const avgMax = decDivide(decAdd(decAdd("4800", "5100"), "5400"), "3", 10);
    assert.equal(avgMin, "4800");
    assert.equal(avgMax, "5100");
    assert.equal(decMultiply(decMultiply("0.015", "22"), avgMin), "1584");
    assert.equal(decMultiply(decMultiply("0.015", "22"), avgMax), "1683");
  });

  it("Stage 2 example split: 17.75 + 6.5 = 24.25 (St. Rose months rule)", () => {
    assert.equal(decAdd("17.75", "6.5"), "24.25");
  });
});
