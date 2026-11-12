/**
 * Decimal-safe arithmetic — DIRECT ScaledInt implementation.
 *
 * Decision (Stage 2 output 04, §10 OD-1; Stage 3 §5.5, decision D-5.1):
 * the engine implements ScaledInt arithmetic directly. No vendored decimal
 * library, no external package. A binary float never touches money, service,
 * compensation, rates, or factors (04 §3.1 rule R-1).
 *
 * - Canonical stored form: DecimalString (e.g. "0.015", "1234.56", "22.5").
 * - In-engine working form: ScaledInt — a bigint value with a recorded
 *   scale; the real value is value / 10^scale.
 * - Rational form retained alongside the decimal wherever the plan defines
 *   a credit as a fraction (D-5.1). A rational with a non-terminating
 *   decimal expansion is never converted to a rounded decimal for storage:
 *   it converts only at a prescribed rounding point, at a recorded scale
 *   of at least 10 decimal places (04 §3.1 rule R-2).
 * - Rounding happens only at prescribed points (04 §3.1 rule R-3), via
 *   decRound with an explicit unit and mode. No intermediate is rounded
 *   "to keep the numbers tidy".
 * - Division is carried at a recorded scale of at least 10 decimal places
 *   (04 §3.1 rule R-2); the scale is an argument, never a hidden default.
 *
 * All functions are pure. No clock, no network, no randomness.
 */

import type {
  DecimalString,
  Money,
  MoneyMinor,
  Rational,
  RoundingMode,
  ScaledInt,
} from "./types";

/** Minimum scale for division / rational-to-decimal conversion (04 §3.1 R-2). */
export const MIN_DIVISION_SCALE = 10;

/** Minor units per major unit for USD money (01 §1.2). */
export const MINOR_UNITS_PER_MAJOR = 100;

// ---------------------------------------------------------------------------
// Parsing and canonical form
// ---------------------------------------------------------------------------

/** Canonical DecimalString: optional "-", then digits with no leading zero
 *  (unless the value is exactly "0"), then an optional fraction with no
 *  trailing zeros. No exponent notation, no "+". */
const CANONICAL_DECIMAL_RE = /^-?(0|[1-9]\d*)(\.\d*[1-9]|\.0)?$/;

/** Accepts any plain decimal string the parser can read exactly
 *  (optional sign, digits, optional fraction). Rejects exponents, ".5",
 *  "5.", empty strings, and anything else. */
const PARSEABLE_DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** True when `value` is already in canonical DecimalString form. */
export function isCanonicalDecimalString(value: string): boolean {
  if (value === "-0" || value === "-0.0") return false;
  if (!CANONICAL_DECIMAL_RE.test(value)) return false;
  // Reject a fraction that is all zeros beyond the point ("1.00") and
  // any trailing zero in the fraction ("1.50").
  const dot = value.indexOf(".");
  if (dot !== -1) {
    const frac = value.slice(dot + 1);
    if (frac.length === 0 || frac.endsWith("0")) return false;
  }
  return true;
}

/** Parse an exact decimal string into its ScaledInt working form.
 *  Never parses through a binary float. Throws on anything that is not
 *  an exact decimal string. */
export function parseDecimalString(value: string): ScaledInt {
  if (!PARSEABLE_DECIMAL_RE.test(value)) {
    throw new Error(`Not an exact decimal string: ${JSON.stringify(value)}`);
  }
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  const dot = digits.indexOf(".");
  const intPart = dot === -1 ? digits : digits.slice(0, dot);
  const fracPart = dot === -1 ? "" : digits.slice(dot + 1);
  // Strip leading zeros from the integer part and trailing zeros from
  // the fraction; the numeric value is unchanged.
  const intTrimmed = intPart.replace(/^0+(?=\d)/, "");
  const fracTrimmed = fracPart.replace(/0+$/, "");
  const scale = fracTrimmed.length;
  const combined = intTrimmed + fracTrimmed;
  let intValue = combined === "" ? 0n : BigInt(combined);
  if (intValue === 0n) {
    // "-0", "-0.00", "0.00" are all zero; canonical form is "0".
    return { value: 0n, scale: 0 };
  }
  if (negative) intValue = -intValue;
  return { value: intValue, scale };
}

/** Render a ScaledInt as its canonical DecimalString. */
export function scaledIntToDecimalString(scaled: ScaledInt): DecimalString {
  const { value, scale } = scaled;
  if (value === 0n) return "0";
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();
  let out: string;
  if (scale === 0) {
    out = digits;
  } else if (digits.length > scale) {
    out = digits.slice(0, digits.length - scale) + "." + digits.slice(digits.length - scale);
  } else {
    out = "0." + "0".repeat(scale - digits.length) + digits;
  }
  // Strip trailing zeros in the fraction (they carry no value).
  if (out.includes(".")) out = out.replace(/0+$/, "").replace(/\.$/, "");
  return (negative ? "-" : "") + out;
}

/** Canonicalize a decimal string: parse it exactly, render it canonical.
 *  Throws on anything that is not an exact decimal string. */
export function canonicalDecimalString(value: string): DecimalString {
  return scaledIntToDecimalString(parseDecimalString(value));
}

// ---------------------------------------------------------------------------
// Internal helpers (bigint only; no float anywhere)
// ---------------------------------------------------------------------------

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** Rescale a ScaledInt to a larger scale (exact: multiply by 10^diff). */
function rescaleTo(scaled: ScaledInt, scale: number): bigint {
  if (scale < scaled.scale) {
    throw new Error(`Cannot rescale ${scaledIntToDecimalString(scaled)} down to scale ${scale}`);
  }
  return scaled.value * pow10(scale - scaled.scale);
}

function fromBigint(value: bigint, scale: number): ScaledInt {
  // Normalise: strip trailing zeros so the recorded scale is minimal.
  if (value === 0n) return { value: 0n, scale: 0 };
  let v = value;
  let s = scale;
  while (s > 0 && v % 10n === 0n) {
    v /= 10n;
    s -= 1;
  }
  return { value: v, scale: s };
}

/** Round a bigint quotient with remainder to the nearest integer under
 *  the given mode. `quotient` is the truncated quotient (toward zero),
 *  `remainder` the signed remainder, `divisor` the signed divisor.
 *  The true value is quotient + remainder/divisor. Returns the rounded
 *  quotient. */
function roundQuotient(
  quotient: bigint,
  remainder: bigint,
  divisor: bigint,
  mode: RoundingMode,
): bigint {
  if (remainder === 0n) return quotient;
  const absDivisor = divisor < 0n ? -divisor : divisor;
  const absRem = remainder < 0n ? -remainder : remainder;
  // Sign of the fractional part remainder/divisor.
  const fracNegative = (remainder < 0n) !== (divisor < 0n);
  const doubled = absRem * 2n;
  // Direction of "away from zero": the sign of the true value.
  const trueNegative = quotient < 0n || (quotient === 0n && fracNegative);
  const away = trueNegative ? -1n : 1n;
  // Direction from the truncated quotient toward the true value.
  const towardTrue = fracNegative ? -1n : 1n;
  switch (mode) {
    case "down": // toward zero: never increment
      return quotient;
    case "up": // away from zero: always increment
      return quotient + away;
    case "floor": // toward -inf: increment only when the true value is below the quotient
      return fracNegative ? quotient - 1n : quotient;
    case "ceiling": // toward +inf: increment only when the true value is above the quotient
      return fracNegative ? quotient : quotient + 1n;
    case "half-up": // ties away from zero
      return doubled >= absDivisor ? quotient + away : quotient;
    case "half-even": {
      if (doubled > absDivisor) return quotient + away;
      if (doubled === absDivisor) {
        // Tie: round to the even neighbour.
        return quotient % 2n !== 0n ? quotient + towardTrue : quotient;
      }
      return quotient;
    }
  }
}

// ---------------------------------------------------------------------------
// Arithmetic surface (Stage 2 output 04, §3.2) — the engine's only
// arithmetic surface. Every function takes and returns DecimalString,
// except decCompare.
// ---------------------------------------------------------------------------

/** Exact addition. Scales add implicitly; the result is canonical. */
export function decAdd(a: DecimalString, b: DecimalString): DecimalString {
  const x = parseDecimalString(a);
  const y = parseDecimalString(b);
  const scale = Math.max(x.scale, y.scale);
  return scaledIntToDecimalString(fromBigint(rescaleTo(x, scale) + rescaleTo(y, scale), scale));
}

/** Exact subtraction. */
export function decSubtract(a: DecimalString, b: DecimalString): DecimalString {
  const x = parseDecimalString(a);
  const y = parseDecimalString(b);
  const scale = Math.max(x.scale, y.scale);
  return scaledIntToDecimalString(fromBigint(rescaleTo(x, scale) - rescaleTo(y, scale), scale));
}

/** Exact multiplication. Multiplication adds scales; no precision is lost. */
export function decMultiply(a: DecimalString, b: DecimalString): DecimalString {
  const x = parseDecimalString(a);
  const y = parseDecimalString(b);
  return scaledIntToDecimalString(fromBigint(x.value * y.value, x.scale + y.scale));
}

/** Exact division at the recorded scale (≥ 10 places). The scale is an
 *  argument, never a hidden default. Rounding at the final digit is
 *  half-up (ties away from zero); the scale used is recorded by the caller
 *  in the trace step. Throws on division by zero and on scale < 10. */
export function decDivide(a: DecimalString, b: DecimalString, scale: number): DecimalString {
  if (!Number.isInteger(scale) || scale < MIN_DIVISION_SCALE) {
    throw new Error(
      `decDivide requires an integer scale >= ${MIN_DIVISION_SCALE}; got ${scale}`,
    );
  }
  const x = parseDecimalString(a);
  const y = parseDecimalString(b);
  if (y.value === 0n) throw new Error("decDivide: division by zero");
  // a / b = (x.value / 10^x.scale) / (y.value / 10^y.scale)
  //       = (x.value * 10^y.scale) / (y.value * 10^x.scale)
  // Result at the requested scale: round((a/b) * 10^scale) / 10^scale.
  const numerator = x.value * pow10(y.scale + scale);
  const denominator = y.value * pow10(x.scale);
  const quotient = numerator / denominator; // truncates toward zero
  const remainder = numerator % denominator;
  const rounded = roundQuotient(quotient, remainder, denominator, "half-up");
  return scaledIntToDecimalString(fromBigint(rounded, scale));
}

/** Rounding of an exact decimal to a stated unit and mode (§4.2). The only
 *  place a value loses precision, and only when a rule prescribes it. */
export function decRound(value: DecimalString, unit: DecimalString, mode: RoundingMode): DecimalString {
  const x = parseDecimalString(value);
  const u = parseDecimalString(unit);
  if (u.value <= 0n) throw new Error(`decRound: unit must be positive; got ${unit}`);
  const scale = Math.max(x.scale, u.scale);
  const scaledValue = rescaleTo(x, scale);
  const scaledUnit = rescaleTo(u, scale);
  const quotient = scaledValue / scaledUnit; // truncates toward zero
  const remainder = scaledValue % scaledUnit;
  const rounded = roundQuotient(quotient, remainder, scaledUnit, mode);
  return scaledIntToDecimalString(fromBigint(rounded * scaledUnit, scale));
}

/** Comparison of exact decimals, without converting to float. */
export function decCompare(a: DecimalString, b: DecimalString): -1 | 0 | 1 {
  const x = parseDecimalString(a);
  const y = parseDecimalString(b);
  const scale = Math.max(x.scale, y.scale);
  const xv = rescaleTo(x, scale);
  const yv = rescaleTo(y, scale);
  if (xv < yv) return -1;
  if (xv > yv) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Rationals (Stage 3 §5.5, decision D-5.1)
// ---------------------------------------------------------------------------

/** Convert an exact rational to a DecimalString at the recorded scale
 *  (≥ 10 places) with the given rounding mode. A rational with a
 *  non-terminating decimal expansion is never converted at a smaller scale
 *  or with a hidden mode. Throws on a zero denominator and on scale < 10. */
export function rationalToDecimalString(
  rational: Rational,
  scale: number,
  mode: RoundingMode,
): DecimalString {
  if (rational.denominator === 0n) {
    throw new Error("rationalToDecimalString: zero denominator");
  }
  if (!Number.isInteger(scale) || scale < MIN_DIVISION_SCALE) {
    throw new Error(
      `rationalToDecimalString requires an integer scale >= ${MIN_DIVISION_SCALE}; got ${scale}`,
    );
  }
  const numerator = rational.numerator * pow10(scale);
  const denominator = rational.denominator;
  const quotient = numerator / denominator; // truncates toward zero
  const remainder = numerator % denominator;
  const rounded = roundQuotient(
    quotient,
    remainder,
    denominator,
    mode,
  );
  return scaledIntToDecimalString(fromBigint(rounded, scale));
}

/** Same conversion, returning the ScaledInt working form. */
export function rationalToScaledInt(
  rational: Rational,
  scale: number,
  mode: RoundingMode,
): ScaledInt {
  return parseDecimalString(rationalToDecimalString(rational, scale, mode));
}

// ---------------------------------------------------------------------------
// Money (Stage 2 output 01, §1.2) — integer minor units, with a guard
// ---------------------------------------------------------------------------

/** Build a Money value from integer minor units. Refuses non-integer input. */
export function makeMoney(amountMinor: MoneyMinor, sourceDecimalPlaces: number | null = null): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new Error(`Money must be integer minor units; got ${amountMinor}`);
  }
  return {
    amountMinor,
    minorUnitsPerMajor: MINOR_UNITS_PER_MAJOR,
    currency: "USD",
    sourceDecimalPlaces,
  };
}

/** Convert an exact decimal string to integer minor units (cents).
 *  GUARD: refuses any value that is not an exact whole number of cents
 *  (e.g. "10.005" throws — it is not a money value, it is a rounding
 *  question for a prescribed rounding point). */
export function moneyMinorFromDecimalString(value: DecimalString): MoneyMinor {
  const parsed = parseDecimalString(value);
  let minor: bigint;
  if (parsed.scale <= 2) {
    minor = parsed.value * pow10(2 - parsed.scale);
  } else {
    const divisor = pow10(parsed.scale - 2);
    if (parsed.value % divisor !== 0n) {
      throw new Error(
        `Not an exact whole number of cents: ${value} — refusing; round only at a prescribed point`,
      );
    }
    minor = parsed.value / divisor;
  }
  const asNumber = Number(minor);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error(`Money value outside the safe integer range: ${value}`);
  }
  return asNumber;
}

/** Build a Money value from an exact decimal string. Same guard as
 *  moneyMinorFromDecimalString: non-integer cents are refused. */
export function moneyFromDecimalString(
  value: DecimalString,
  sourceDecimalPlaces: number | null = null,
): Money {
  return makeMoney(moneyMinorFromDecimalString(value), sourceDecimalPlaces);
}

/** Render integer minor units as a canonical DecimalString (dollars). */
export function moneyMinorToDecimalString(amountMinor: MoneyMinor): DecimalString {
  if (!Number.isInteger(amountMinor)) {
    throw new Error(`Money must be integer minor units; got ${amountMinor}`);
  }
  return scaledIntToDecimalString({ value: BigInt(amountMinor), scale: 2 });
}
