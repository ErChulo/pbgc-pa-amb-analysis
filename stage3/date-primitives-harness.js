// Stage 3 date-primitives verification harness (synthetic dates only).
// Pure UTC integer arithmetic; no floats touch a day count.
"use strict";
const assert = require("assert");
const DAY_MS = 86400000;

function parse(s) { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function fmt(dt) { return dt.toISOString().slice(0, 10); }
function daysSinceEpoch(s) { return Math.trunc(parse(s).getTime() / DAY_MS); } // Int32 for 1900-2100
function fromDays(n) { return fmt(new Date(n * DAY_MS)); }
function daysBetween(a, b) { return daysSinceEpoch(b) - daysSinceEpoch(a); } // exclusive of start, inclusive of end
function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m 1-based
function addMonths(s, n) {
  const [y, m, d] = s.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12), nm = total - ny * 12; // 0-based month
  const nd = Math.min(d, daysInMonth(ny, nm + 1)); // month-end clamping
  return fmt(new Date(Date.UTC(ny, nm, nd)));
}
function addYears(s, n) { return addMonths(s, n * 12); }
// Completed whole years + whole months + leftover days, calendar method.
function completedYMD(a, b) {
  let [y1, m1, d1] = a.split("-").map(Number);
  let [y2, m2, d2] = b.split("-").map(Number);
  let years = y2 - y1, months = m2 - m1, days = d2 - d1;
  if (days < 0) { months -= 1; days += daysInMonth(y2, m2 - 1 === 0 ? 12 : m2 - 1); }
  if (months < 0) { years -= 1; months += 12; }
  return { years, months, days };
}
// St Rose §3.2(b): completed years+months, fractional month rounded UP to a whole month.
function stRoseService(a, b) {
  const { years, months, days } = completedYMD(a, b);
  const totalMonths = years * 12 + months + (days > 0 ? 1 : 0);
  return totalMonths / 12; // exact rational months/12; display only
}
function ageAt(dob, at) {
  const { years } = completedYMD(dob, at);
  return years; // completed years; negative if at < dob (caller must reject)
}

const T = [];
function check(name, actual, expected) {
  const ok = Object.is(actual, expected);
  T.push({ name, actual, expected, ok });
  if (!ok) console.log("FAIL", name, "actual", actual, "expected", expected);
}

// --- days-between / inclusive-exclusive ---
check("daysBetween 2020-01-01->2020-01-02 (exclusive start)", daysBetween("2020-01-01", "2020-01-02"), 1);
check("daysBetween same date", daysBetween("2020-02-29", "2020-02-29"), 0);
check("daysBetween inclusive 2020-01-01..2020-01-31", daysBetween("2020-01-01", "2020-01-31") + 1, 31);
check("daysBetween leap Feb 2020-02-28->2020-03-01", daysBetween("2020-02-28", "2020-03-01"), 2);
check("daysBetween non-leap Feb 2021-02-28->2021-03-01", daysBetween("2021-02-28", "2021-03-01"), 1);
check("daysBetween year boundary 2020-12-31->2021-01-01", daysBetween("2020-12-31", "2021-01-01"), 1);
check("daysBetween 1986-04-01->2010-06-30", daysBetween("1986-04-01", "2010-06-30"), 8856);
check("daysBetween 1986-04-01->2003-12-31", daysBetween("1986-04-01", "2003-12-31"), 6483);
check("daysBetween 2004-01-01->2010-06-30", daysBetween("2004-01-01", "2010-06-30"), 2372);

// --- days-since-epoch Int32 roundtrip ---
check("epoch 1970-01-01", daysSinceEpoch("1970-01-01"), 0);
check("epoch 2020-02-29", daysSinceEpoch("2020-02-29"), 18321);
check("epoch 1900-01-01", daysSinceEpoch("1900-01-01"), -25567);
check("epoch 2099-12-31 in Int32", daysSinceEpoch("2099-12-31") <= 2147483647, true);
check("roundtrip 2020-02-29", fromDays(daysSinceEpoch("2020-02-29")), "2020-02-29");
check("roundtrip 1986-04-01", fromDays(daysSinceEpoch("1986-04-01")), "1986-04-01");
check("roundtrip 2010-06-30", fromDays(daysSinceEpoch("2010-06-30")), "2010-06-30");

// --- leap years ---
check("isLeap 2020", isLeap(2020), true);
check("isLeap 2000 (div 400)", isLeap(2000), true);
check("isLeap 1900 (div 100, not 400)", isLeap(1900), false);
check("isLeap 2021", isLeap(2021), false);
check("daysInMonth Feb 2020", daysInMonth(2020, 2), 29);
check("daysInMonth Feb 2021", daysInMonth(2021, 2), 28);
check("daysInMonth Feb 1900", daysInMonth(1900, 2), 28);
check("daysInMonth Feb 2000", daysInMonth(2000, 2), 29);

// --- addMonths / addYears with month-end clamping ---
check("addMonths 2020-01-31 +1", addMonths("2020-01-31", 1), "2020-02-29");
check("addMonths 2021-01-31 +1", addMonths("2021-01-31", 1), "2021-02-28");
check("addMonths 2020-01-30 +1", addMonths("2020-01-30", 1), "2020-02-29");
check("addMonths 2020-03-31 -1", addMonths("2020-03-31", -1), "2020-02-29");
check("addMonths 2020-08-31 +6", addMonths("2020-08-31", 6), "2021-02-28");
check("addMonths 2020-12-31 +1 (year boundary)", addMonths("2020-12-31", 1), "2021-01-31");
check("addMonths 2019-12-15 +13", addMonths("2019-12-15", 13), "2021-01-15");
check("addYears 2020-02-29 +1 (leap day)", addYears("2020-02-29", 1), "2021-02-28");
check("addYears 2020-02-29 +4", addYears("2020-02-29", 4), "2024-02-29");
check("addYears 2020-02-29 -1", addYears("2020-02-29", -1), "2019-02-28");
check("addMonths clamp is NOT sticky: 2020-01-31 +1 then +1", addMonths(addMonths("2020-01-31", 1), 1), "2020-03-29");

// --- age (completed years) ---
check("age DOB 1960-03-14 at 2010-06-30", ageAt("1960-03-14", "2010-06-30"), 50);
check("age day before 65th birthday", ageAt("1960-03-14", "2025-03-13"), 64);
check("age on 65th birthday", ageAt("1960-03-14", "2025-03-14"), 65);
check("age leap DOB 2000-02-29 at 2021-02-28", ageAt("2000-02-29", "2021-02-28"), 20);
check("age leap DOB 2000-02-29 at 2021-03-01", ageAt("2000-02-29", "2021-03-01"), 21);

// --- completed YMD / DBAB elapsed-time example ---
check("DBAB Q7:35 Lynn 2011-01-15->2013-03-15", JSON.stringify(completedYMD("2011-01-15", "2013-03-15")), JSON.stringify({ years: 2, months: 2, days: 0 }));
check("DBAB Q7:38 Matt 1400 days /365 floor", Math.floor(1400 / 365), 3);
check("completedYMD 1986-04-01->2010-06-30", JSON.stringify(completedYMD("1986-04-01", "2010-06-30")), JSON.stringify({ years: 24, months: 2, days: 29 }));
check("completedYMD 1986-04-01->2003-12-31", JSON.stringify(completedYMD("1986-04-01", "2003-12-31")), JSON.stringify({ years: 17, months: 8, days: 30 }));
check("completedYMD 2004-01-01->2010-06-30", JSON.stringify(completedYMD("2004-01-01", "2010-06-30")), JSON.stringify({ years: 6, months: 5, days: 29 }));

// --- Stage 2 worked example (24.25) under candidate derivations ---
check("StRose months-round-up 1986-04-01->2010-06-30 = 24.25", stRoseService("1986-04-01", "2010-06-30"), 24.25);
check("StRose months-round-up pre-2004 split = 17.75", stRoseService("1986-04-01", "2003-12-31"), 17.75);
check("StRose months-round-up post-2003 split = 6.5", stRoseService("2004-01-01", "2010-06-30"), 6.5);
check("splits sum to total", stRoseService("1986-04-01", "2003-12-31") + stRoseService("2004-01-01", "2010-06-30"), 24.25);
// days/365 alternative does NOT reproduce the splits exactly:
const d365pre = 6478 / 365, d365tot = 8861 / 365;
check("days/365 total is NOT 24.25 (it is 24.2767..)", Math.abs(d365tot - 24.25) > 0.001, true);
check("days/365 pre-split differs from 17.75 by >0.001", Math.abs(d365pre - 17.75) > 0.001, true); // 17.7479 rounds to 17.75 at 2dp but is not exact
console.log("days/365 total =", d365tot.toFixed(6), " pre =", d365pre.toFixed(6), " post =", (2372 / 365).toFixed(6));

// --- Blond §1.58 hours-table spot checks (fractions are exact rationals) ---
function blondFraction(hours) {
  if (hours >= 1800) return "1";
  if (hours >= 1350) return "3/4";
  if (hours >= 1000) return "1/2";
  return "0";
}
check("Blond 1800h -> 1", blondFraction(1800), "1");
check("Blond 1799h -> 3/4", blondFraction(1799), "3/4");
check("Blond 1350h -> 3/4", blondFraction(1350), "3/4");
check("Blond 1349h -> 1/2", blondFraction(1349), "1/2");
check("Blond 1000h -> 1/2", blondFraction(1000), "1/2");
check("Blond 999h -> 0", blondFraction(999), "0");
// Blond cliff: 999h vs 1000h differs by half a year of credited service.

// --- Node Date sanity: no float drift in day counts over the test range ---
let drift = false;
for (let n = -25567; n <= 47481; n += 7919) { if (daysSinceEpoch(fromDays(n)) !== n) drift = true; }
check("epoch roundtrip no drift (sampled)", drift, false);

const passed = T.filter(t => t.ok).length;
console.log(`\n${passed}/${T.length} checks passed.`);
if (passed !== T.length) { console.log("FAILURES:"); T.filter(t => !t.ok).forEach(t => console.log(" -", t.name, "actual:", t.actual, "expected:", t.expected)); process.exit(1); }
console.log("Node version:", process.version);
