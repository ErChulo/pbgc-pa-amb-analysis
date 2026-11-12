/**
 * Date primitives — Stage 3 output 02, §1 (rules D-1.1–D-1.10).
 *
 * The engine needs exactly these primitives, each with one stated
 * convention. All date arithmetic is integer arithmetic on days since the
 * epoch, never on milliseconds and never on floats (D-1.1, D-1.2).
 *
 * - Days-between is exclusive of the start date, inclusive of the end
 *   date: daysBetween(a, a) = 0 (§1.2).
 * - Age is completed years by the calendar method, never days/365 (D-1.4).
 * - Month-end clamping is non-sticky (D-1.6, D-1.7).
 * - The Gregorian leap-year rule applies always (D-1.9).
 * - A date is never moved to a month/year boundary unless a plan
 *   provision says so (D-1.10); the boundary functions here only perform
 *   the movement, they never decide that it applies.
 * - Leap-day birthdays (D-1.5): the birthday in a non-leap year is a
 *   per-plan input. When the convention is null, ageAt refuses for a
 *   non-leap-year birthday instead of guessing.
 *
 * All functions are pure. No clock, no locale, no timezone database,
 * no network. Synthetic dates only; no live case data.
 */

import type { DateString } from "./types";

/** Leap-day birthday convention (Stage 3 §1.3, rule D-1.5). null means
 *  the plan document / administrator convention has not established it. */
export type LeapDayBirthday = "feb-28" | "mar-01";

const DAY_MS = 86400000;

/** Strict ISO calendar date: YYYY-MM-DD with zero-padded month and day. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function splitParts(date: DateString): { year: number; month: number; day: number } {
  const parts = date.split("-");
  const y = parts[0] === undefined ? NaN : Number(parts[0]);
  const m = parts[1] === undefined ? NaN : Number(parts[1]);
  const d = parts[2] === undefined ? NaN : Number(parts[2]);
  return { year: y, month: m, day: d };
}

/**
 * Validate an ISO calendar date string (Stage 3 §5.2, F-D-09; rule D-1.3).
 * Rejects anything that is not a valid calendar date — e.g. 2021-02-29,
 * 2020-13-01, 2020-00-10, "1986-4-1" (non-ISO) — and never coerces it
 * (never rolls forward to 2021-03-01). Throws on rejection.
 */
export function validateDateString(s: string): DateString {
  if (!ISO_DATE_RE.test(s)) {
    throw new Error(`Not a valid ISO calendar date (YYYY-MM-DD): ${JSON.stringify(s)}`);
  }
  const { year, month, day } = splitParts(s);
  if (month < 1 || month > 12) {
    throw new Error(`Not a valid calendar date (month out of range): ${JSON.stringify(s)}`);
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`Not a valid calendar date (day out of range): ${JSON.stringify(s)}`);
  }
  return s;
}

/**
 * Days since 1970-01-01 (Unix epoch), UTC (Stage 3 §1.1, rules D-1.1–D-1.2).
 * Conversion is Math.trunc(Date.UTC(y, m−1, d) / 86400000); the divisor is
 * exact and the dividend is an integer number of milliseconds, so no
 * binary float touches a day count. Fits Int32 for every date the system
 * will ever see.
 */
export function daysSinceEpoch(date: DateString): number {
  const valid = validateDateString(date);
  const { year, month, day } = splitParts(valid);
  return Math.trunc(Date.UTC(year, month - 1, day) / DAY_MS);
}

/** Inverse of daysSinceEpoch: the ISO calendar date n days after the epoch. */
export function dateFromDays(n: number): DateString {
  if (!Number.isInteger(n)) {
    throw new Error(`dateFromDays requires an integer day count; got ${n}`);
  }
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Days from `start` (exclusive) to `end` (inclusive): the number of
 * midnights crossed. daysBetween(a, a) = 0. Negative when end < start;
 * callers that need a non-negative span must check and reject, not abs().
 */
export function daysBetween(start: DateString, end: DateString): number {
  return daysSinceEpoch(end) - daysSinceEpoch(start);
}

/** Gregorian leap-year rule: divisible by 4, except centuries, except
 *  centuries divisible by 400 (rule D-1.9). */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Days in a month (1-based month). February returns 29 in a leap year. */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`daysInMonth: invalid year/month ${year}/${month}`);
  }
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      // Unreachable: month is range-checked above; strict-index guard.
      throw new Error(`daysInMonth: invalid month ${month}`);
  }
}

/**
 * Add `n` calendar months to a date (n may be negative). If the target
 * month is shorter than the source day, clamp to the target month's last
 * day. Clamping is NOT sticky (rule D-1.7): each addition is computed
 * from the date it is given, so 2020-01-31 + 1 month + 1 month is
 * 2020-03-29, not 2020-03-31.
 */
export function addMonths(date: DateString, n: number): DateString {
  if (!Number.isInteger(n)) {
    throw new Error(`addMonths requires an integer month count; got ${n}`);
  }
  const valid = validateDateString(date);
  const { year, month, day } = splitParts(valid);
  const total = year * 12 + (month - 1) + n;
  const newYear = Math.floor(total / 12);
  const newMonth0 = total - newYear * 12; // 0-based month
  const newDay = Math.min(day, daysInMonth(newYear, newMonth0 + 1));
  return formatDate(newYear, newMonth0 + 1, newDay);
}

/** Add `n` calendar years: addMonths(date, 12n). A leap-day date clamps
 *  to 02-28 in a non-leap target year; that is a clamping artefact, not a
 *  statement about when the birthday falls (rule D-1.8, D-1.5). */
export function addYears(date: DateString, n: number): DateString {
  if (!Number.isInteger(n)) {
    throw new Error(`addYears requires an integer year count; got ${n}`);
  }
  return addMonths(date, n * 12);
}

function formatDate(year: number, month: number, day: number): DateString {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The birthday date in a given year, under the leap-day convention.
 * Returns null when the birthday cannot be established: DOB 02-29 in a
 * non-leap year with a null convention (rule D-1.5 — refuse, never guess).
 */
export function birthdayInYear(
  dob: DateString,
  year: number,
  leapDayBirthday: LeapDayBirthday | null,
): DateString | null {
  const valid = validateDateString(dob);
  const { month, day } = splitParts(valid);
  if (month === 2 && day === 29 && !isLeapYear(year)) {
    if (leapDayBirthday === null) return null;
    return leapDayBirthday === "feb-28"
      ? formatDate(year, 2, 28)
      : formatDate(year, 3, 1);
  }
  return formatDate(year, month, day);
}

/**
 * Completed whole years of age at `at`: the age the person turned on
 * their most recent birthday on or before `at` (rule D-1.4).
 *
 * `leapDayBirthday` is the per-plan convention for a 02-29 birthday in a
 * non-leap year (rule D-1.5). It defaults to null: with a null convention
 * and a leap-day birthday whose birthday year is not a leap year, ageAt
 * THROWS rather than guessing. Pass "mar-01" explicitly to reproduce the
 * harness's raw calendar measurement (birthday reached on 03-01).
 * Throws when at < dob.
 */
export function ageAt(
  dob: DateString,
  at: DateString,
  leapDayBirthday: LeapDayBirthday | null = null,
): number {
  const birth = validateDateString(dob);
  const atDate = validateDateString(at);
  if (daysSinceEpoch(atDate) < daysSinceEpoch(birth)) {
    throw new Error(`ageAt: measurement date ${at} is before date of birth ${dob}`);
  }
  const { year: birthYear } = splitParts(birth);
  const { year: atYear } = splitParts(atDate);
  const birthdayThisYear = birthdayInYear(birth, atYear, leapDayBirthday);
  if (birthdayThisYear === null) {
    throw new Error(
      `ageAt: leap-day birthday ${dob} in non-leap year ${atYear} with no leap-day ` +
        `birthday convention established (D-1.5) — refusing, not guessing`,
    );
  }
  const hadBirthday = daysSinceEpoch(atDate) >= daysSinceEpoch(birthdayThisYear);
  return atYear - birthYear - (hadBirthday ? 0 : 1);
}

/**
 * Calendar decomposition of [start, end]: whole years, then whole months,
 * then leftover days, each counted on the calendar (a "month" is a
 * calendar month, not 30 days). Deliberately NOT a conversion to
 * fractional years: the conversion is a plan rule (Stage 3 §2.4).
 * Throws when end < start.
 *
 * Computed by finding the largest whole-month count k with
 * addMonths(start, k) <= end, so month-end clamping is handled exactly
 * (e.g. 2020-01-31 → 2020-03-01 is {0, 1, 1}: Jan 31 + 1 month clamps
 * to Feb 29, plus 1 day).
 */
export function completedYMD(
  start: DateString,
  end: DateString,
): { years: number; months: number; days: number } {
  const startValid = validateDateString(start);
  const endValid = validateDateString(end);
  if (daysSinceEpoch(endValid) < daysSinceEpoch(startValid)) {
    throw new Error(`completedYMD: end ${end} is before start ${start}`);
  }
  const { year: y1, month: m1 } = splitParts(startValid);
  const { year: y2, month: m2 } = splitParts(endValid);
  let totalMonths = (y2 - y1) * 12 + (m2 - m1);
  // addMonths(start, totalMonths) can overshoot end when the start day
  // exceeds the end day (e.g. Jan 31 → Mar 01 with totalMonths 2 gives
  // Mar 31); step down until it fits, then step up while the next month
  // still fits. At most a few steps either way.
  while (totalMonths > 0 && daysSinceEpoch(addMonths(startValid, totalMonths)) > daysSinceEpoch(endValid)) {
    totalMonths -= 1;
  }
  while (daysSinceEpoch(addMonths(startValid, totalMonths + 1)) <= daysSinceEpoch(endValid)) {
    totalMonths += 1;
  }
  const anchor = addMonths(startValid, totalMonths);
  const days = daysBetween(anchor, endValid);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths - years * 12;
  return { years, months, days };
}

/** First day of the month containing `date`. */
export function monthStart(date: DateString): DateString {
  const valid = validateDateString(date);
  const { year, month } = splitParts(valid);
  return formatDate(year, month, 1);
}

/** First day of the month after the month containing `date`. */
export function nextMonthStart(date: DateString): DateString {
  return addMonths(monthStart(date), 1);
}

/**
 * First day of the calendar month coincident with or next following
 * `date` (the Blond §5.02 shape): `date` itself when it is already a
 * 1st, else the next month's 1st.
 */
export function firstOfMonthCoincidentOrNext(date: DateString): DateString {
  const valid = validateDateString(date);
  const { day } = splitParts(valid);
  return day === 1 ? valid : nextMonthStart(valid);
}

/** First day of the year containing `date`. */
export function yearStart(date: DateString): DateString {
  const valid = validateDateString(date);
  const { year } = splitParts(valid);
  return formatDate(year, 1, 1);
}

/** First day of the next year after the year containing `date`. */
export function nextYearStart(date: DateString): DateString {
  const valid = validateDateString(date);
  const { year } = splitParts(valid);
  return formatDate(year + 1, 1, 1);
}
