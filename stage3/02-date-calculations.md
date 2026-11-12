# Stage 3 — Date Calculations and Date Roundings

**Project:** PBGC Prior Administrator Accrued Monthly Benefit (PA_AMB) Analysis System
**Repository:** ErChulo/pbgc-pa-amb-analysis (public, `main`)
**Document:** `stage3/02-date-calculations.md` (Stage 3 output 2 of 2)
**Date:** 2026-11-12
**Status:** Research and specification only. No engine, no UI, no full app. Nothing here is
an official PBGC classification, tolerance, or rule unless a PBGC source is cited for it.
**Governing spec:** `MASTER_PROMPT.md` (§3 fundamental concepts, §5 temporal reconstruction,
§8 calculation engine, §9 rounding, §12 missing data)
**Stage 1 basis:** `stage1/01-formula-classification.md` (formula library; service and rounding
sections), `stage1/02-data-requirements-validation.md` and
`stage1/03-reconciliation-statistical-methodology.md` (service fields, rounding as diagnostic
hypothesis)
**Stage 2 basis:** `stage2/01-data-model.md` (service fields, worked example), `stage2/04-calculation-functions.md`
(Stage 3 service computation, ten §8 stages, §11 rounding, open item OD-2)
**Verification harness:** `stage3/date-primitives-harness.js` — Node verification of every
date primitive in §1, synthetic dates only. Run with `node date-primitives-harness.js`.

---

## 0. Read this first

### 0.1 The user emphasis that governs this document

> Be careful with the date calculations and the date roundings. It is very important to take
> into account the credited service definitions from the plan document definitions and the
> vesting service definitions. Credited service (benefit accrual service) and vesting service
> are different quantities, defined per plan document — the engine must compute each exactly
> per the plan, with date rounding per plan.

This document exists because of that emphasis. Its central rule, stated once here and
applied everywhere below:

**RULE D-0 — No date convention, service definition, or rounding rule is a default.**
Every date primitive has one stated convention (§1). Every service quantity is computed
from the plan document's own definition, taken as a per-plan input (§2). Every rounding
is prescribed by the plan document (or by documented administrator evidence) for that
plan version and that calculation stage, or it is not applied (§3). Where the plan
document does not give the definition, the engine widens bounds or goes Indeterminate —
it never invents a definition (§5.8).

### 0.2 Standing requirement (from Stage 1 output 01, §0)

The application must still produce reliable actuarial calculations and documented acceptance
decisions when exact historical reconstruction is impossible. Consequences for dates:

- A service quantity whose definition is missing from the plan documents is **unknown**,
  never filled with a "typical" definition (e.g. never assume 1,000 hours = 1 year, never
  assume elapsed time, never assume fractional years).
- A date whose value is missing (a hire date, a DOTE, a freeze date) widens the service
  interval or makes the participant Indeterminate; it is never replaced by a neighbouring
  date.
- A numerical match obtained by arbitrarily changing a date convention, a service
  definition, or a rounding rule is **not** proof of the administrator's methodology
  (MASTER_PROMPT §9; Stage 2 output 04, §4.4 anti-coincidence rule).

### 0.3 What this document does and does not do

- **Does:** define the date primitives (§1); define credited vs vesting vs eligibility
  service and how each is computed under hours-based and elapsed-time crediting (§2);
  define date rounding per plan and per provision era (§3); enumerate edge cases (§4);
  give Stage 4 an exact implementation list of date/service functions with signatures,
  per-plan inputs, rounding configuration, and tests (§5).
- **Does not:** implement any function (signatures only, no bodies); define any benefit
  formula (Stage 1 output 01 owns the formula catalog); set any tolerance (a human-set,
  per-case parameter — Stage 2 output 01, §0.1 fact 5); or state any service definition
  or rounding rule that no source gives.

### 0.4 Sources and traceability

Every service definition or rounding rule in this document traces to one of:

| Tag | Source |
|---|---|
| `[DBAB-7]` | Defined Benefit Answer Book, Ch. 7, Measuring Service (local copy `~/workspace/pbgc_review/pa-amb/DBAB-Ch07.txt`) |
| `[DBAB-9]` | Defined Benefit Answer Book, Ch. 9, Plan Benefits / Accrued Benefits (local copy `~/workspace/pbgc_review/pa-amb/DBAB-Ch09.txt`) |
| `[ST-ROSE]` | College of St. Rose plan document, effective 1985-07-01 (local extract `~/workspace/pbgc_review/plan_docs/1985_Plan_Document.txt`) — used only as an example of how a plan document defines service |
| `[BLOND]` | Blonder Tongue plan document, effective 2006-02-01 (local extract `~/workspace/pbgc_review/plan_docs/Blond-2006-plan.txt`) — same use |
| `[BCV-DICT]` | BCV Data Dictionary, 2026-10-30 index (local copy `~/workspace/pbgc_review/BCV_Data_Dictionary.csv`, 1,172 field records) |
| `[S1-01]` / `[S1-02]` / `[S1-03]` | Stage 1 outputs 01 / 02 / 03 |
| `[S2-01]` / `[S2-04]` | Stage 2 outputs 01 / 04 |
| `[NODE]` | Node verification harness `stage3/date-primitives-harness.js`, run 2026-11-12 (Node v24.22.1), 58/58 checks passed, day counts cross-checked against GNU `date` |

Plan-document extracts are **examples of how plan documents define service**, never live
case data. No participant in this document is real: all participants are fictional, all
dates synthetic (except the two plan documents' own effective dates, which are document
facts, and the Answer Book's worked examples, which are labelled as such).

### 0.5 Dates in this document

All dates are ISO calendar dates (`YYYY-MM-DD`). No time-of-day is stored anywhere in
the calculation core (Stage 2 output 01, §1.3). A partial date is never silently completed:
a source that gives only a year stores a year, not a fabricated `YYYY-01-01`.

---

## 1. Date primitives

The engine needs exactly the primitives in this section — no more. Each primitive has one
stated convention, a TypeScript signature (bodies are Stage 4 work), and a Node-verified
result. The harness proves the conventions behave as stated, including edge cases; it does
not prove any plan's definition, which is a matter of reading the plan document (§2).

### 1.1 Representation: days-since-epoch as Int32

```typescript
/** ISO calendar date, YYYY-MM-DD. No time-of-day. (Stage 2 output 01, §1.1.) */
type DateString = string;

/** Days since 1970-01-01 (Unix epoch), UTC. Fits Int32 for every date the
 *  system will ever see (Int32 range ≈ ±5.8 million years). The engine's
 *  internal date representation: all date arithmetic is integer arithmetic
 *  on this value, never on milliseconds, never on floats. */
type DaysSinceEpoch = number; // integer; -2^31 ≤ value ≤ 2^31 − 1
```

Rules:

- **D-1.1.** All dates are converted to `DaysSinceEpoch` at the boundary (import /
  user entry) using UTC midnight. Local-time conversion is forbidden: a date parsed
  in a local timezone can shift by a day across a DST boundary, and a one-day shift
  changes service, age, and NRD.
- **D-1.2.** The conversion is `Math.trunc(Date.UTC(y, m−1, d) / 86400000)`. The divisor
  is exact; the dividend is an integer number of milliseconds, so no binary float
  touches a day count. (The harness verifies round-trip `date → days → date` with no
  drift over a sampled range 1900-01-01 to 2099-12-31.)
- **D-1.3.** A `DateString` that is not a valid calendar date (e.g. `2021-02-29`,
  `2020-13-01`) is rejected at the boundary with a validation error, never coerced
  (e.g. never rolled forward to `2021-03-01`). JavaScript's `Date` constructor
  silently rolls invalid dates forward; the engine must validate `y/m/d` against
  the calendar *before* constructing a date.

Measured results `[NODE]`:

| Input | `daysSinceEpoch` |
|---|---|
| `1970-01-01` | `0` |
| `2020-02-29` | `18321` |
| `1900-01-01` | `−25567` |
| `2099-12-31` | `47481` (well inside Int32) |

### 1.2 Days-between: exclusive of the start date, inclusive of the end date

```typescript
/** Days from `start` (exclusive) to `end` (inclusive): the number of
 *  midnights crossed. daysBetween(a, a) = 0. Negative when end < start;
 *  callers that need a non-negative span must check and reject, not abs(). */
declare function daysBetween(start: DateString, end: DateString): number;
```

This is the system's **one** days-between convention. It is the convention the
`date` command and the harness both use, and it is the convention under which
"elapsed time" in §2.3 is measured. The inclusive count (both endpoints counted)
is `daysBetween(a, b) + 1` and is used **only** where a rule explicitly counts both
endpoints — no rule found in the sources does, so the inclusive form is defined
here for completeness and must not be used unless a plan document requires it,
with the requirement cited in the trace.

Why this convention matters: a one-day error in a span is a 1/365-year error in
elapsed-time service (≈ 0.0027 years). That is small per participant but it is a
*systematic* error if the convention is wrong — it shifts every participant the
same way, which is exactly the kind of error the reconciliation statistics (§10
of the master prompt) would read as a methodological difference.

Measured results `[NODE]` (all cross-checked against GNU `date +%s` arithmetic):

| Span | `daysBetween` |
|---|---|
| `2020-01-01` → `2020-01-02` | `1` |
| `2020-02-29` → `2020-02-29` | `0` |
| `2020-02-28` → `2020-03-01` (leap year) | `2` |
| `2021-02-28` → `2021-03-01` (non-leap) | `1` |
| `2020-12-31` → `2021-01-01` (year boundary) | `1` |
| `1986-04-01` → `2010-06-30` (Stage 2 example) | `8856` |
| `1986-04-01` → `2003-12-31` (pre-2004 split) | `6483` |
| `2004-01-01` → `2010-06-30` (post-2003 split) | `2372` |

Note for the record: two day counts in the first draft of the harness (8861, 6478)
were hand-computed and wrong; the harness caught them and GNU `date` confirmed
the corrected values (8856, 6483). This is why day counts are verified, never
hand-computed into a spec.

### 1.3 Age: completed years at a date

```typescript
/** Completed whole years of age at `at`: the age the person turned on their
 *  most recent birthday on or before `at`. Throws / refuses when at < dob. */
declare function ageAt(dob: DateString, at: DateString): number;
```

Rules:

- **D-1.4.** Age is completed years, computed by the calendar method (§1.6), not by
  `daysBetween / 365` and not by `daysBetween / 365.25`. A days-divided age is wrong
  by up to a day around birthdays and leap days, and the birthday is exactly where
  NRD and early-retirement eligibility are decided.
- **D-1.5.** Leap-day birthdays (DOB `02-29`): the birthday in a non-leap year is a
  per-plan input — the plan document or the administrator's convention decides
  whether the birthday falls on `02-28` or `03-01`. The engine must **not** pick one
  silently. Until the case establishes it, an age or NRD that depends on a leap-day
  birthday in a non-leap year is unresolved for that participant (widen / Indeterminate,
  §5.8). The harness records the raw calendar behaviour only: `ageAt("2000-02-29",
  "2021-02-28") = 20`, `ageAt("2000-02-29", "2021-03-01") = 21` — i.e. under the
  strict calendar method the 21st birthday is reached on 2021-03-01, not 2021-02-28.
  That is a measurement, not a rule; the rule comes from the plan.

Measured results `[NODE]`:

| DOB → at | Age |
|---|---|
| `1960-03-14` → `2010-06-30` | `50` |
| `1960-03-14` → `2025-03-13` (day before 65th birthday) | `64` |
| `1960-03-14` → `2025-03-14` (65th birthday) | `65` |
| `2000-02-29` → `2021-02-28` | `20` |
| `2000-02-29` → `2021-03-01` | `21` |

### 1.4 Adding months and years: month-end clamping, non-sticky

```typescript
/** Add `n` calendar months to a date (n may be negative). If the target
 *  month is shorter than the source day, clamp to the target month's last
 *  day. Clamping is NOT sticky: the clamped day does not propagate to the
 *  next addition — each addition is computed from the date it is given. */
declare function addMonths(date: DateString, n: number): DateString;

/** Add `n` calendar years: addMonths(date, 12n). A leap-day date clamps
 *  to 02-28 in a non-leap target year (see §1.3, D-1.5). */
declare function addYears(date: DateString, n: number): DateString;
```

Rules:

- **D-1.6.** Month-end clamping is the convention: `2020-01-31 + 1 month =
  2020-02-29` (leap year), `2021-01-31 + 1 month = 2021-02-28`. The alternative
  (roll forward into the next month, giving `2020-03-02`) is **not** used: it
  silently moves a date across a month boundary, which changes computation
  periods, averaging windows, and NRD.
- **D-1.7.** Clamping is not sticky. `2020-01-31 + 1 month + 1 month` is
  `2020-03-29`, **not** `2020-03-31`: the intermediate clamped date (`2020-02-29`)
  is a real date, and adding a month to it gives `2020-03-29`. Any implementation
  that remembers the original day-of-month (31) across additions is a different
  convention and must be labelled as such; it is not this primitive. Stage 4
  must test this case explicitly (§5.7, test T-D-07).
- **D-1.8.** `addYears` on a leap day: `2020-02-29 + 1 year = 2021-02-28`,
  `+ 4 years = 2024-02-29`. The 02-28 result in a non-leap year is a clamping
  artefact, not a statement about when the birthday falls (§1.3, D-1.5).

Measured results `[NODE]`:

| Operation | Result |
|---|---|
| `2020-01-31 + 1 mo` | `2020-02-29` |
| `2021-01-31 + 1 mo` | `2021-02-28` |
| `2020-01-30 + 1 mo` | `2020-02-29` |
| `2020-03-31 − 1 mo` | `2020-02-29` |
| `2020-08-31 + 6 mo` | `2021-02-28` |
| `2020-12-31 + 1 mo` (year boundary) | `2021-01-31` |
| `2019-12-15 + 13 mo` | `2021-01-15` |
| `2020-02-29 + 1 yr` | `2021-02-28` |
| `2020-02-29 + 4 yr` | `2024-02-29` |
| `2020-02-29 − 1 yr` | `2019-02-28` |
| `2020-01-31 + 1 mo, then + 1 mo` (non-sticky) | `2020-03-29` |

### 1.5 Leap-year handling

```typescript
/** Gregorian leap-year rule: divisible by 4, except centuries, except
 *  centuries divisible by 400. */
declare function isLeapYear(year: number): boolean;

/** Days in a month (1-based month). February returns 29 in a leap year. */
declare function daysInMonth(year: number, month: number): number;
```

Measured results `[NODE]`: `isLeapYear(2020) = true`, `isLeapYear(2000) = true`
(divisible by 400), `isLeapYear(1900) = false` (divisible by 100, not 400),
`isLeapYear(2021) = false`; `daysInMonth(2020, 2) = 29`, `daysInMonth(2021, 2) = 28`,
`daysInMonth(1900, 2) = 28`, `daysInMonth(2000, 2) = 29`.

Rule **D-1.9**: the leap-year rule is the Gregorian rule, always. A 365-day year,
a 360-day year, and a 365.25-day year are **not** date primitives — they are
service-conversion conventions, and they belong in §2, where the plan document
decides whether they exist at all. No date primitive in this section divides by
365, 360, or 365.25.

### 1.6 Completed years / months / days between two dates (calendar method)

```typescript
/** Calendar decomposition of [start, end]: whole years, then whole months,
 *  then leftover days, each counted on the calendar (a "month" is a
 *  calendar month, not 30 days, not 365/12 days). Refuses when end < start. */
declare function completedYMD(start: DateString, end: DateString): {
  years: number; months: number; days: number;
};
```

This is the primitive that service computation builds on (§2.3, §2.4). It is
deliberately **not** a conversion to fractional years: the conversion from
`{years, months, days}` to a service quantity is a plan rule (§2.4, §3.2), and
different plans convert the same `{years, months, days}` differently. The
primitive returns the decomposition; the plan rule decides what it means.

Measured results `[NODE]`:

| Span | `{years, months, days}` |
|---|---|
| `2011-01-15` → `2013-03-15` (DBAB Q 7:35 example `[DBAB-7]`) | `{2, 2, 0}` — "two years and two months", exactly as the Answer Book states |
| `1986-04-01` → `2010-06-30` (Stage 2 example) | `{24, 2, 29}` |
| `1986-04-01` → `2003-12-31` | `{17, 8, 30}` |
| `2004-01-01` → `2010-06-30` | `{6, 5, 29}` |

### 1.7 Month-boundary rounding (of dates, not of service)

A date may need to be moved to a month or year boundary before it is used — for
example, a plan that defines NRD as the first of the month coincident with or
next following the 65th birthday (the Blonder Tongue commencement convention,
§5.02 `[BLOND]` — a plan term, not a general rule), or a plan that measures
service in whole calendar months. The primitives:

```typescript
/** First day of the month containing `date`. */
declare function monthStart(date: DateString): DateString;
/** First day of the month after the month containing `date`. */
declare function nextMonthStart(date: DateString): DateString;
/** First day of the calendar month coincident with or next following `date`
 *  (the Blond §5.02 shape): `date` itself when it is already a 1st, else
 *  the next month's 1st. */
declare function firstOfMonthCoincidentOrNext(date: DateString): DateString;
/** First day of the year containing `date` / first day of the next year. */
declare function yearStart(date: DateString): DateString;
declare function nextYearStart(date: DateString): DateString;
```

Rule **D-1.10**: month/year-boundary movement is a **per-plan, per-purpose**
operation. The engine never moves a date to a boundary unless a plan provision
(or a documented administrator convention) says to, for that purpose, and the
trace records the unmoved date, the moved date, and the provision. In particular,
DOTE is never moved to a month-end or year-end "for convenience": PA_AMB is
measured at DOTE as it stands, and a moved DOTE is a different measurement date
(and therefore a different comparison basis — Stage 2 output 01, §5.3).

### 1.8 What is NOT a date primitive

- **No business-day arithmetic.** No source gives a business-day rule for service
  or benefit dates. If a plan document states one, it enters as a per-plan input
  with its own definition; the core does not provide it.
- **No timezone handling.** Dates are calendar dates (§0.5). Any timestamp that
  arrives with a time-of-day is truncated to its UTC calendar date at import,
  with the truncation recorded in the import log — and a timestamp whose UTC date
  differs from its stated local date is flagged, not silently resolved.
- **No "30 days = 1 month" / "365 days = 1 year" conversion in the core.**
  Those conversions exist in the regulations for elapsed-time vesting
  (Treas. Reg. §1.410(a)-7, via `[DBAB-7]` Q 7:37–7:38: "Thirty days of service
  are deemed to be a month; 365 days are treated as a one-year period of
  service"), and they are specified in §2.3 as a **vesting-service** conversion
  under elapsed-time crediting — not as a general date primitive, and never as
  a way to compute credited service unless the plan says so.

---

## 2. Credited service vs vesting service vs eligibility service

### 2.1 The three quantities are different — and the plan document defines each

A participant has (up to) three service quantities, and they are not interchangeable
(`[DBAB-7]` Q 7:1–7:2; `[S1-02]` §A.2.8; `[S2-01]` §7.8):

| Quantity | What it measures | What it decides | BCV fields (at DOTE) |
|---|---|---|---|
| **Credited service** (benefit service) | Service counted toward the **amount** of the accrued benefit | The benefit formula's `S_t` (Stage 1 output 01, §4 notation) | PA-reported `CSPA` (Input); BCV-calculated `CS` (Calculated) |
| **Vesting service** | Service counted toward **whether** the benefit is nonforfeitable, and how much of it is | The vesting percentage `VP` (via the plan's vesting schedule) | PA-reported `VSPA` (Input); BCV-calculated `VS` (Calculated) |
| **Eligibility service** | Service counted toward **whether** the employee becomes a participant | Participation date, hence when accrual can start | PA-reported `ESPA` (Input); BCV-calculated `ES` (Calculated) |

Definitions from the dictionary `[BCV-DICT]` (verbatim descriptions, BCV1):

- `CSPA` — "Plan Administrator's Credited (Benefit) Service at DOTE", NUMBER, Input.
- `VSPA` — "Plan Administrator's Vesting Service at DOTE", NUMBER, Input.
- `ESPA` — "Plan Administrator's Plan Eligibility Service at DOTE", NUMBER, Input.
- `CS` — "Years of Credited (Benefit) Service at DOTE", NUMBER, Calculated (BCV add-in
  functions COMPM, COMPAM, COMPYM, COMPAYM, SERVBA, SERVBW, SERVYCA, SERVYCP, SERVYCW,
  SERVYPA, SERVYPP, SERVYPW).
- `VS` — "Years of Vesting Service at DOTE", NUMBER, Calculated (same add-in family).
- `ES` — "Years of Eligibility Service at DOTE", NUMBER, Calculated (same add-in family).

The same three quantities exist at other measurement dates in BCV10 (`PC3_CS` /
`PC3_VS` at DOPT/BPD−3; `BPD_CS` / `BPD_VS` at BPD). Service is a **dated measure**,
not a single number (Stage 2 output 01, §6.3 rule 2): `CSPA`/`CS` are service *at
DOTE*; reconstruction at any other date `t` needs service *through `t`*, computed
from the employment-period timeline, not from the DOTE value.

**How they differ, in practice:**

1. **Different start dates.** Eligibility service typically starts at hire; vesting
   service typically starts at hire (or at age 18, where the plan excludes pre-18
   service — `[DBAB-7]` Q 7:40); credited service typically starts at *participation*,
   not hire (a participant accrues benefit service only once they are a participant).
   A participant hired 1986-04-01 who became a participant 1987-07-01 has, at
   DOTE 2010-06-30, roughly a year more vesting/eligibility service than credited
   service. The engine must compute each from its own start date; it must never
   copy one quantity into another's slot.
2. **Different units.** Vesting and eligibility service are almost always **whole
   years** (a year is credited or it is not — `[DBAB-7]` Q 7:20). Credited service
   is frequently **fractional** (partial years, part-time proration — §2.4). A
   vesting service of 24 and a credited service of 24.25 for the same participant
   at the same date are not a discrepancy; they are the expected shape of the two
   quantities.
3. **Different crediting rules within one plan.** The same plan can credit vesting
   service by hours (1,000 hours = 1 year) and credited service by elapsed time,
   or vice versa. The crediting method is per-quantity, per-plan-version — never
   one method for the whole plan unless the plan document says so.
4. **Different break treatment.** Pre-break service may count for vesting but not
   for benefit accrual (or the reverse), under the plan's break rules (§4.2).
   The one-year holdout rule and the rule of parity (§4.2) apply differently to
   eligibility, vesting, and accrual, and the plan document states which.
5. **Different caps.** A service cap (`S_max`, Stage 1 output 01 T-09) caps
   *credited* service counted in the formula. It does not cap vesting service:
   a participant with 35 years of vesting service and a 30-year credited-service
   cap is 100% vested on a 30-year benefit. The cap is applied to the credited
   quantity only, at the point the formula is evaluated — never to the stored
   service measures.

### 2.2 The crediting methods: hours-based vs elapsed-time

Service is generally measured by one of two methods (`[DBAB-7]` Q 7:2):

**Method H — Hours-based (the general method).** A year of service is credited
when the employee is credited with a stated number of hours of service during a
computation period. The regulatory defaults (`[DBAB-7]` Q 7:3, DOL Reg.
§2530.200b-1) are:

- **1,000 hours** in a 12-month computation period → 1 year of service.
- **500 hours or fewer** in the period → a break in service (one-year break).
- **501–999 hours** → neither a year of service nor a break.

These are *regulatory defaults*, not plan rules. The plan document states its own
thresholds, and the plan's thresholds govern. Two worked plan examples:

- **Blonder Tongue §1.58 `[BLOND]`** (credited service, from 1976-02-01): a
  *banded* hours table, not the 1,000-hour rule — 1,800+ hours = 1 year;
  1,350–1,799 hours = 3/4 year; 1,000–1,349 hours = 1/2 year; under 1,000
  hours = 0. Note the cliffs the engine must reproduce exactly: 1,799 hours
  earns 3/4 year while 1,800 earns a full year; 999 hours earns nothing while
  1,000 earns half a year. A rounding or interpolation of these bands would be
  wrong, not approximate. (Harness `[NODE]`: `blondFraction(1799) = "3/4"`,
  `blondFraction(1800) = "1"`, `blondFraction(999) = "0"`,
  `blondFraction(1000) = "1/2"`.)
- **Blonder Tongue §1.59/§1.61 `[BLOND]`** (eligibility / vesting service):
  the 1,000-hour rule — an Eligibility Computation Period / Vesting Computation
  Period with at least 1,000 Hours of Service = 1 year. Same plan, same
  participant, different thresholds for different quantities: credited service
  uses the banded table, vesting and eligibility use 1,000 hours. This is the
  clearest available demonstration of §2.1 point 3.
- **College of St. Rose §3.1(b) `[ST-ROSE]`**: participation requires a
  12-month period of at least 1,000 Hours of Service (first year measured from
  first Hour of Service; later years measured by Plan Year). §3.3: a One-Year
  Break-in-Service is a Plan Year with not more than 500 Hours of Service.

Hours-based crediting needs **hours data** (payroll / plan records). Where hours
are missing, the service quantity is unknown for the affected computation
periods — the engine must not substitute elapsed time for missing hours, or
vice versa. The substitution is a different crediting method, not an estimate
of the same one.

**Equivalencies.** A plan that measures service by hours may use a DOL
equivalency instead of counting actual hours (`[DBAB-7]` Q 7:7–7:8, DOL Reg.
§2530.200b-3): e.g. 10 hours per day, 45 hours per week, or the working-time
equivalency (870 hours = 1,000 hours when hours are counted on a
hours-worked basis; 750 hours = 1,000 hours on a regular-time basis). The plan
must specifically identify the equivalency used. An equivalency is a per-plan
input (`ServiceDefinition.hoursEquivalency`, §5.2); the engine never assumes one.

**Method E — Elapsed-time.** Service is determined by reference to the time
that elapses during employment, regardless of hours worked (`[DBAB-7]` Q 7:35,
Treas. Reg. §1.410(a)-7). Three years elapsed from employment commencement to
severance = three years of service, whatever the hours. The Answer Book example
(`[DBAB-7]` Q 7:35): Lynn began 2011-01-15, terminated 2013-03-15 → "two years
and two months of service" (harness `[NODE]` reproduces `{2, 2, 0}`).

Elapsed-time specifics the engine must implement exactly:

- **Period of service** (`[DBAB-7]` Q 7:39): for eligibility/vesting, from
  employment commencement (or reemployment commencement) to severance from
  service; for benefit accrual, generally from the date participation begins to
  severance (or transfer out of the eligible class).
- **Vesting aggregation** (`[DBAB-7]` Q 7:36, Q 7:38): periods of service are
  aggregated; a period is not disregarded merely because it is under a year;
  after aggregation, only the **integer portion** counts and the fractional
  remainder is disregarded. The Answer Book example (Q 7:38): periods of 400 +
  600 + 400 days = 1,400 days; 1,400 ÷ 365 = 3.84 → **3 years** of vesting
  service. Note the two conversions the regulation itself states: 30 days are
  deemed a month, 365 days are deemed a year (Q 7:37–7:38). These are
  *vesting-service* conversions under elapsed time — they are specified here,
  in this subsection, and nowhere else.
- **Service-spanning** (`[DBAB-7]` Q 7:44): periods of severance under 12
  months are disregarded and the absence is credited as service, under the two
  spanning rules (severance-then-return within 12 months; absence-then-severance
  with return before the first anniversary of the first day of absence). The
  Answer Book example: Walt, 6 months' service, 2-month layoff, quits, returns
  5 months later → 13 months credited (8 months' service + 5 months' severance).
- **Severance date** (`[DBAB-7]` Q 7:42): the earlier of (1) quit / retire /
  discharge / death, or (2) the first anniversary of the date the employee was
  absent for another reason. An absence of less than 12 months is not a
  severance at all for vesting purposes (Q 7:40).

**Which method a plan uses is a per-plan, per-quantity, per-era fact.** It is
read from the plan document (§3.2(b) of St. Rose is elapsed-time-flavoured —
"completed years and months"; §1.58 of Blond is hours-based for credited
service). The app takes it as a `PlanVersion` provision (§5.2). A plan may also
change methods by amendment; the method in effect for a service period is the
method in the `PlanVersion` in force for that period (Stage 2 output 01, §6.2).

### 2.3 How each quantity is computed from dates

**Credited service (benefit service), elapsed-time crediting:**

1. Take the participation start date (or the plan's accrual-start date) and the
   measurement date `t` (DOTE for PA_AMB; DOPT, a freeze date, or another
   reconstruction date for other calculations).
2. Decompose `[start, t]` with `completedYMD` (§1.6).
3. Convert the decomposition to a service quantity **per the plan's conversion
   rule** (§2.4): whole years + whole months + fractional-month treatment, or
   days-based, as the plan states.
4. Apply the plan's break/restoration rules (§4.2) to the period list *before*
   converting — breaks remove or suspend periods; they are not a rounding
   applied after conversion.
5. Apply part-time proration (§2.4) if the plan provides it, and the service
   cap `S_max` (§4.6) at the formula-evaluation point.

**Credited service, hours-based crediting:**

1. For each computation period (Plan Year, or the plan's computation period)
   ending on or before `t`, take the credited hours for that period.
2. Apply the plan's hours-to-service table for that period's era (e.g. the
   Blond §1.58 bands; or the 1,000-hour rule; or a fraction `hours / full-time
   hours` — §2.4).
3. Sum the per-period credits. A partial final period (hire mid-year, termination
   mid-year) is credited per the plan's partial-period rule; if the plan has none,
   the partial period is an open item (§5.8), not a pro-rata assumption.
4. Hours are the input; the engine never derives hours from elapsed time.

**Vesting service:**

1. Hours-based: one year per computation period with hours ≥ the plan's
   threshold (1,000 in both example plans); 0 otherwise. Whole years only.
2. Elapsed-time: aggregate all periods of service, convert with the 30-day
   month / 365-day year deeming rule, take the integer portion, disregard the
   remainder (`[DBAB-7]` Q 7:38).
3. Apply the plan's vesting-schedule lookup to get `VP`: the schedule is a
   per-plan-version table, never a formula. Examples: St. Rose §5.4 `[ST-ROSE]`
   — completed years of Service to termination, graded 0% under 4 years, 40% at
   4, +10% per year to 100% at 10 (with a top-heavy alternative schedule, 0%
   under 2 years, 20% at 2, +20% per year to 100% at 6); Blond §8.02 `[BLOND]`
   — cliff vesting, 0% under 5 years (post-1988 schedule) or under 10 years
   (earlier schedule), 100% at 5 / 10, with 100% on early-retirement or
   disability termination. Note: St. Rose §5.4 says "completed years of Service"
   — the vesting lookup consumes the *whole-years* vesting service, and the
   fractional part is irrelevant to it. A vesting service of 9.9 years vests at
   the 9-year row, not the 10-year row.
4. **VP is a lookup, not a computation from dates.** The dates produce the
   service years; the schedule produces the percentage. The engine must keep
   those two steps separate in the trace (Stage 2 output 04, Stage 3 trace:
   one step per service component, then the VP lookup step).

**Eligibility service:**

1. Hours-based: one year per Eligibility Computation Period with hours ≥ the
   plan's threshold; the initial period is measured from the first Hour of
   Service, later periods by Plan Year (St. Rose §3.1(b); Blond §1.59).
2. Elapsed-time: one year per 12 months of service from employment
   commencement (`[DBAB-7]` Q 7:37); successive periods aggregate, 30 days
   deemed a month, 365 days deemed a year.
3. Eligibility service decides the participation date; it does not enter the
   benefit formula. Its date consequence is the accrual-start date used in the
   credited-service computation above.

### 2.4 Variants: part-time proration, partial years, fractional years

**Partial years.** Under hours-based crediting for benefit accrual, an employee
with at least 1,000 hours but fewer than the hours for a full year must receive
at least a partial year, generally the fraction `credited hours / hours for a
full year` (`[DBAB-7]` Q 7:20, DOL Reg. §2530.204-2(c)(1)). The Answer Book
example (Q 7:21, Ex. 1): full year = 2,000 hours; Jake completes 1,800 hours →
`1,800 ÷ 2,000 = 0.9` year. The denominator (hours for a full year) is a
per-plan input — 2,000 in the example, 1,800 in the Blond banded table's top
band, 2,080 in a 40-hour-week plan. The engine never assumes a denominator.

For eligibility and vesting, partial years are **not** credited: 1,000+ hours =
a full year, under 1,000 = no credit for that period (`[DBAB-7]` Q 7:20–7:21).
The same 1,800 hours that earn 0.9 credited years earn 1 vesting year (if the
vesting threshold is 1,000) — another routine divergence between the quantities.

**Part-time proration and the double-proration prohibition.** Where the plan
prorates benefit accrual for part-time service, it must not also prorate through
the compensation average: that is double proration and is prohibited (`[DBAB-7]`
Q 7:21, DOL Reg. §2530.204-2(d)(1)). The Answer Book example: Teri works 1,000
hours/year for 20 years at $20/hour; her average compensation ($20,000) already
reflects part-time work, so crediting her with only 10 years (1,000/2,000 × 20)
would halve her benefit twice ($4,000 instead of $8,000). The engine must
therefore record, per plan version, **which** of the two proration channels the
plan uses (service proration *or* compensation reflection, or full-compensation
adjustment with service proration) — and refuse to apply both. A plan that does
both is flagged as a plan-provision question for the actuary, not silently
"corrected" by the engine.

**Fractional years.** Whether credited service may be fractional is decided by
the plan's service-crediting rule (`[S1-01]` T-03 item 6): "the plan's
service-crediting rule (hours vs elapsed time) determines whether `S_t` is whole
or fractional — do not round service to whole years unless the plan does."
Elapsed-time plans with a months convention produce fractional years routinely
(St. Rose: months/12). Hours-based plans with a banded table produce quarters
and halves (Blond: 3/4, 1/2). Hours-based plans with an hours-fraction produce
arbitrary decimals (0.9 in the Jake example). The representation must hold all
of these exactly — see §5.5 (OD-2 resolution).

**Pre-participation and past-service credits.** Service before participation,
before the plan's adoption, or with a predecessor employer counts only where
the plan document says so (`[DBAB-7]` Q 7:40 lists the permitted vesting
exclusions; St. Rose §3.2(a) counts pre-effective-date service "credited as of
the Effective Date"; Blond §1.29(e) counts predecessor-employer service).
Past-service and special credits are documented plan facts with a citation;
an undocumented excess of service over elapsed time is a diagnostic hypothesis
(service), not a correction (`[S1-02]` rule P-15).

### 2.5 The worked example, re-derived (Stage 2 output 01, §8.2)

Fictional participant Ana Ruiz (`P-SYN-001`), DOB 1960-03-14, hired 1986-04-01,
DOTE 2010-06-30, RETSTAT 2 (Separated Vested), one employment period, no breaks,
no rehire. The Stage 2 model states credited service 1986-04-01 → 2010-06-30 =
**24.25 years**, split pre-2004 **17.75** years (1986-04-01 → 2003-12-31) and
post-2003 **6.5** years (2004-01-01 → 2010-06-30), total ≤ 30 cap.

This document re-derives that number, because the derivation identifies the
conversion rule the example actually uses — and the rule matters more than the
number:

| Span | `completedYMD` (§1.6) | `daysBetween` (§1.2) | St. Rose §3.2(b) months rule: completed years+months, fractional month rounded UP | days/365 |
|---|---|---|---|---|
| 1986-04-01 → 2010-06-30 | {24, 2, 29} | 8856 | 24 + 3/12 = **24.25** | 8856/365 = 24.2767 |
| 1986-04-01 → 2003-12-31 | {17, 8, 30} | 6483 | 17 + 9/12 = **17.75** | 6483/365 = 17.7479 |
| 2004-01-01 → 2010-06-30 | {6, 5, 29} | 2372 | 6 + 6/12 = **6.5** | 2372/365 = 6.4986 |

**Finding D-2.1 (verified `[NODE]`):** the months rule — completed years and
months with any fractional part of a month rounded to the next higher whole
month, exactly St. Rose §3.2(b) `[ST-ROSE]` — reproduces all three Stage 2
numbers **exactly**, and the splits sum exactly (17.75 + 6.5 = 24.25). The
days/365 derivation reproduces none of them exactly (24.2767, 17.7479, 6.4986),
and days/360 gives 24.6 for the total. The Stage 2 example is therefore
consistent with the St. Rose months conversion, not with a days-based
conversion. This is recorded here as a derivation, not as a claim that the
Stage 2 example *used* the St. Rose rule: the Stage 2 model states only that
"the plan counts fractional years". The lesson for Stage 4 is that the
conversion from dates to fractional service must be a named, per-plan rule
whose output is checked against known values — two conversion rules that agree
to two decimal places on one participant (17.7479 vs 17.75) will disagree on
others, and the disagreement is a benefit difference, not a rounding difference.

### 2.6 PA-reported vs BCV-calculated service: the X-07 diagnostic

Both sides are retained (`[S1-02]` §A.2.8; `[S2-01]` §7.8):

| Side | Credited | Vesting | Eligibility |
|---|---|---|---|
| PA-reported (Input, at DOTE) | `CSPA` | `VSPA` | `ESPA` |
| BCV-calculated (Calculated, at DOTE) | `CS` | `VS` | `ES` |

Rule X-07 (`[S1-02]`): if `|CSPA − CS|`, `|VSPA − VS|`, or `|ESPA − ES|`
exceeds the case's service tolerance, that is a **Warning** and a diagnostic
hypothesis (service) for the reconciliation. The default service tolerance is
**0** unless the case record states otherwise — "service is a fact, not an
estimate" (`[S1-02]` X-07). Before treating a difference as an error, the
engine must determine **which service-credit rule each side used** (plan
document §, `[DBAB-7]` Ch. 7): a PA that reports elapsed-time service and a
BCV add-in that computes hours-based service will differ legitimately, and the
difference identifies the rule question — it does not identify which side is
wrong. Related rules: P-06 (CS/VS blank, not in years, or outside 0–999 months,
i.e. 0–83.25 years); P-15 (service exceeding elapsed time + documented credits);
X-05 (CSPA = 0 or blank with PA_AMB > 0); X-09 (nonvested participant with
PA_AMB > 0 — vesting treatment unknown); L-07 (service decreasing between
extracts, or increasing by more than the elapsed time between extracts).

**Which service does the engine use?** Neither `CSPA` nor `CS` is the engine's
input for reconstruction. The engine computes service from the employment-period
timeline under the plan's rules (§2.3), and compares its result with both
`CSPA` and `CS`. The two BCV-side values are diagnostics and cross-checks, not
substitutes for computing service. If the engine's computed service agrees with
one side and not the other, the trace says which side it agrees with and why —
that agreement is evidence about the crediting rule, recorded as a hypothesis
with its evidence, not as verification of the benefit.

### 2.7 Per-plan inputs for service (what the app must take from the plan documents)

No service definition below has a default. Each is a `PlanVersion` provision
(§5.2); a missing one is a missing-data item (§5.8):

1. Crediting method per quantity per era: hours-based / elapsed-time.
2. Hours thresholds per quantity per era (full-year hours, break hours, band
   table if banded) and the computation period (Plan Year / anniversary year).
3. Hours equivalency, if any, identified by name and regulation citation.
4. Fractional-year conversion rule (months rule with fractional-month treatment;
   days rule with denominator; hours fraction with denominator).
5. Part-time proration rule and which channel it uses (service / compensation /
   full-compensation adjustment) — with the double-proration refusal (§2.4).
6. Vesting schedule table per era (whole-year lookup) and any special vesting
   (early-retirement / disability / top-heavy alternative schedule).
7. Break-in-service rule per quantity (hours threshold or severance period;
   holdout vs parity; restoration conditions and repayment terms).
8. Accrual-start rule (participation date; any pre-participation credit;
   predecessor / past-service credit).
9. Service cap `S_max` and the *which-years* rule (first-N / last-N — §4.6).
10. Leave / military / disability credit rules (§4.3).

---

## 3. Date rounding

### 3.1 What "date rounding" covers

Three different things are called "rounding" in this system, and they must never
be confused:

| # | Rounded thing | Examples | Governing rule |
|---|---|---|---|
| R-1 | **A service quantity** (years) | Whole years vs fractional; months rounded up (St. Rose); Blond quarter-year bands; vesting integer truncation | Plan document §; §3.2 below |
| R-2 | **A date** (moved to a boundary) | NRD as first-of-month coincident-or-next; DOBF as a plan date; averaging-window endpoints | Plan document §; §1.7, §3.3 |
| R-3 | **A money amount** (or an average, a rate, a factor) | Final benefit to nearest dollar (Blond §5.01); average compensation rounding; factor rounding | Plan document §; Stage 2 output 04 §4; §3.4 below |

R-1 and R-2 are this document's subject. R-3 is owned by Stage 2 output 04, §4
(`RoundingConfig`, `RoundingRule`, `RoundingSequence`) and is covered here only
where it interacts with dates and service (§3.4). A discrepancy explained as
"rounding" must name which of R-1/R-2/R-3, at which stage, with what quantified
effect — "rounding" without a stage and a number is not an explanation
(`[S1-03]` §2.7; Stage 2 output 04, §4.4 rule A-4).

### 3.2 Rounding a service quantity (R-1): plan-specific and stage-specific

**Rule D-3.1 (from `[S1-01]` T-03 item 6 and Stage 2 output 04 §3 rule R-3):**
service is rounded only where the plan prescribes it, at the point the plan
prescribes it. Service is carried as an exact decimal through Stage 3 of the
pipeline (Stage 2 output 04, §2 Stage 3); rounding of service happens only in
Stage 8 under the rounding configuration — except where a governing rule
explicitly prescribes rounding as part of the service definition itself (e.g.
the St. Rose month round-up, which is part of §3.2(b)'s definition of Service,
not a Stage 8 event). That distinction is recorded in the trace: a
definition-internal rounding is a Stage 3 step citing the plan §; a Stage 8
rounding is a Stage 8 step citing the `RoundingConfig`.

Documented service-rounding rules (the only ones this document states):

| Rule | Source | Exact statement | Effect size |
|---|---|---|---|
| Months round-up | St. Rose §3.2(b) `[ST-ROSE]` | Service from/after the Effective Date: "calculated in completed years and months with any fractional part of a month rounded to the next higher whole month" | Up to +1 month (+1/12 year ≈ 0.0833 yr) per period measured; on a $100/month-per-year formula, up to $8.33/month per period |
| Banded quarters | Blond §1.58 `[BLOND]` | Hours bands → 1, 3/4, 1/2, 0 years | Up to 1/2 year per computation period at the band cliffs (999 vs 1,000 hours) |
| Vesting integer truncation | `[DBAB-7]` Q 7:36, Q 7:38 (elapsed time) | After aggregating periods, "only the integer portion is considered, and the remaining period of service is disregarded" | Up to just under 1 year of vesting service — which can move VP across a cliff (e.g. Blond 5-year cliff: 4.99 years vests 0%, 5.0 vests 100%) |
| Whole-year vesting/eligibility | `[DBAB-7]` Q 7:20 | A computation period earns a whole year or nothing | Binary per period; no fractional vesting/eligibility years exist under hours-based crediting |
| Fractional-accrual partial-year ratchet | `[DBAB-9]` Q 9:9 (via `[S1-01]` T-07 item 9) | After a partial year of participation, the accrual ratio ratchets (e.g. .1125 after a half year, .1379 the next full year; alternative 5.5/39.5 = .1392) | A plan that uses naive `S_t/S_t^proj` with fractional `S_t` under-accrues after a partial year — testable when PA_AMB exceeds the naive reconstruction |

**Rule D-3.2:** no other service rounding exists in this system. In particular:

- **No rounding of service to whole years "for simplicity".** A credited service
  of 24.25 years is 24.25, not 24. Rounding it to 24 would understate a
  $100/month-per-year benefit by $25/month — larger than most reconciliation
  tolerances.
- **No rounding of a service *fraction* before it is used.** In fractional
  accrual (`B_t = B_t^proj × S_t/S_t^proj`, `[S1-01]` T-07), the fraction is
  carried exact; rounding the fraction to a percentage (e.g. 33.33% instead of
  1/3) is a distinct rounding hypothesis with a distinct effect, and it is
  tested as one (§3.5).
- **No averaging of rounding rules across eras.** A plan that changed its
  service-credit rule by amendment applies the old rule to pre-amendment
  periods and the new rule to post-amendment periods. The per-period rule is
  selected by the `PlanVersion` in force for that period (Stage 2 output 01,
  §6.2). A single "current" rule applied to all periods is a retroactive
  application of the latest formula, forbidden by MASTER_PROMPT §5.

### 3.3 Rounding a date (R-2): per plan, per provision era

Date-boundary movement (§1.7) is governed by the same principle: the plan
document states it, per provision era, or it does not happen. Known cases:

- **NRD determination.** The normal retirement date is derived from DOB + NRA
  under the plan's rule. The rule itself is a per-plan input: "first day of the
  month coincident with or next following the 65th birthday" (Blond §5.02
  shape — stated there for early-retirement commencement, and the shape a plan
  commonly uses for NRD) vs "the 65th birthday itself" vs "the first day of the
  Plan Year following the 65th birthday". The engine must not assume any of
  these. NRD is computed by `addYears(dob, nra)` (§1.4) followed by the plan's
  boundary rule (§1.7); each step is traced.
- **DOBF / freeze dates.** A benefit freeze date (plan-level DOBF, participant-level
  BCV1.DOBF) is a date, not a rounding: accrual stops *on* that date. Whether
  service on the freeze date itself counts is a per-plan input (inclusive /
  exclusive of the freeze date), recorded with its citation. The St. Rose
  example has no freeze; the Blond example freezes credited service effective
  2006-08-01 ("shall not increase thereafter", §1.58) — service through
  2006-07-31 counts, service after does not. The boundary day is part of the
  rule, not a rounding choice.
- **Computation-period boundaries.** Hours-based crediting measures hours within
  a computation period (Plan Year, or anniversary year). A hire or termination
  mid-period creates a partial period; how that partial period is treated (full
  period, pro-rata, excluded) is a per-plan input (§2.3). It is not resolved by
  moving the hire/termination date to a period boundary.
- **Averaging-window endpoints.** A final-average or highest-average window
  (e.g. highest 3 consecutive years) has endpoints determined by the measurement
  date and the plan's window rule. Moving a window endpoint by a month changes
  which compensation years enter the average. The window rule is a per-plan
  input; the engine never adjusts a window to make an average come out rounder.

### 3.4 Rounding a money amount (R-3): where it meets dates and service

The money-rounding rules live in Stage 2 output 04, §4 (`RoundingConfig`,
`RoundingRule.target` closed list: compensation, average-compensation,
credited-service, accrual-percentage, social-security-offset,
intermediate-component, retirement-factor, actuarial-equivalence-factor,
final-monthly-benefit; `RoundingMode` closed list: half-up, half-even, down,
up, floor, ceiling). This document adds only the date/service interactions:

- **Blonder Tongue §5.01 `[BLOND]`** — the one plan-stated money-rounding rule
  in the sources: "The amount of Normal Retirement Benefit determined under the
  above formula shall be rounded to the nearest whole dollar." It applies to
  the *final* annual normal retirement benefit, after the period-rated service
  multiplication and the 30-year cap — not to the per-period components, not to
  the unit benefits ($42.00 … $222.00, already whole dollars), and not to the
  monthly amount. A reconstruction that rounds each period's component to the
  nearest dollar and then sums is a *different* rounding sequence with a
  different result, and it is tested as a hypothesis (H15), not applied as the
  prescribed sequence.
- **Service rounding vs benefit rounding are independent hypotheses.** A
  discrepancy of one year's accrual can be explained by service rounding
  (R-1) or by a benefit-amount error; a discrepancy of a few cents can only be
  R-3 (or a factor rounding). The maximum plausible rounding effect bounds
  which explanations are available: rounding monthly benefits to the cent
  bounds any single-stage effect at $0.005 (`[S1-03]` §2.7); rounding service
  to whole years can move a benefit by a full year's accrual. Stage 4 must
  compute `RoundingRecord.maxPlausibleEffect` as the sum of the per-stage
  rounding units in money (Stage 2 output 04, §4.3) — a discrepancy larger than
  that cannot be explained by rounding alone.
- **No PBGC rounding policy exists for benefit amounts.** `[S1-02]` gap G-6:
  "no written PBGC rounding policy found; the PF file's practice (4 dp) is a
  file practice, not a policy. Per-plan rounding must be established from the
  plan document or the PA schedule." The PF 4-decimal factor convention must
  not be imported into benefit rounding (`[S1-01]` T-04 item 6).

### 3.5 The anti-coincidence rule (mandatory, restated for dates)

Stage 2 output 04, §4.4, applied to date/service rounding:

- **A-1.** A rounding sequence (including a service-rounding rule or a
  date-boundary rule) may be tested as a diagnostic hypothesis (H15): for each
  alternative sequence, recompute B̂_i and record the residual discrepancy.
- **A-2.** A successful numerical match obtained by arbitrary changes to
  rounding conventions is **never proof** of the administrator's actual
  methodology (MASTER_PROMPT §9).
- **A-3.** A rounding hypothesis is **Supported** only if (a) the sequence is
  documented in the plan, the administrator's workpapers, or a valuation
  report, or (b) the same sequence resolves discrepancies across the cohort
  (not just one participant) and no document contradicts it. Otherwise it is
  **Coincidence**: recorded as such, never presented as an explanation, and
  never sufficient to move a disposition to Verified.
- **A-4.** When rounding is the supported explanation, the report names the
  stage(s) and the quantified effect (e.g. "final monthly benefit rounded to
  nearest cent; service rounded down to completed years per plan §X").
  "Rounding" without a stage and a number is not an explanation.
- **A-5.** The prescribed sequence is applied in Stage 8. Alternative sequences
  are never applied in Stage 8; they are applied only by the counterfactual
  interface (Stage 2 output 04, §6.2), on a copy of the pipeline state, and
  their results are labelled hypotheses.

**Date-specific corollary (D-3.3):** a match obtained by moving a measurement
date (DOTE vs DOPT vs NRD, §4.4) or by changing a service definition (hours vs
elapsed time, §2.2) is subject to the same rule. A different measurement date
is a different comparison basis, not a rounding hypothesis — and treating it as
a counterfactual risks comparing amounts on different bases (Stage 2 output 04,
open item OD-7). Measurement-date alternatives belong in the scenario set, not
in the rounding-hypothesis set.

### 3.6 Rounding configuration per plan version and per era

`RoundingConfig` (Stage 2 output 04, §4.2) is per-plan-version: `prescribedSequence`
(the one the plan or the evidence states, or null when no rounding rule is
documented for that version) plus `alternativeSequences` (hypotheses only).
For dates and service, the configuration must additionally record, per era:

| Field | Content |
|---|---|
| `serviceRounding` | The R-1 rule for credited service in this version (months rule / banded table / none — with the plan § citation), and separately for vesting service (integer truncation / whole-year rule) |
| `dateBoundaryRules` | The R-2 rules in this version (NRD boundary rule, freeze-date inclusivity, computation-period rule), each with its citation |
| `moneyRounding` | The R-3 sequence (Stage 2 output 04, §4.2 shape) |
| `source` | Per rule: plan-provision / workpaper / valuation-report / not-documented, with citation or null |

A `PlanVersion` whose service or rounding provisions are unknown carries
`prescribedSequence: null` and an explicit missing-data item — never a
"usual" sequence filled in by the app.

---

## 4. Edge cases

### 4.1 Partial years

Covered in §2.4. Additional date points for Stage 4:

- A partial first year (hired mid-computation-period) and a partial final year
  (terminated mid-period) are different cases with potentially different plan
  rules. The engine treats them as separate period types in the trace.
- Under fractional accrual, a partial year of participation triggers the
  ratchet rule (`[DBAB-9]` Q 9:9, `[S1-01]` T-07 item 9): the accrued benefit
  after a partial year is at least the fractional-rule benefit × an accrual
  ratio that ratchets forward. The engine must implement the ratchet as a
  named rule with its regulation citation, not as a smoothing of `S_t/S_t^proj`.
- A participant with fewer years than the averaging window `n` (e.g. 2 years
  of service in a highest-3-year plan) is governed by the plan's short-window
  rule; if the plan has none, the window is an open item (`[S1-01]` T-06
  item 9), and the benefit is bounded over the plausible window treatments.

### 4.2 Breaks in service, restoration, rehires

**Hours-based breaks.** A One-Year Break-in-Service is a computation period
with not more than 500 hours (St. Rose §3.3; Blond §1.39, §3.05). Consequences
depend on vesting status and on the plan's rule:

- **One-year holdout rule:** pre-break service is disregarded *until* the
  employee completes a year of service after reemployment (`[DBAB-7]` Q 7:41,
  Q 7:45). The holdout is temporary: the service returns once the post-break
  year is completed. The engine must model the holdout as a *state* (held out /
  restored), not as a deletion — a reconstruction at a date during the holdout
  shows less service than a reconstruction at a later date for the same
  participant, and both are correct at their dates.
- **Rule of parity:** for a *nonvested* participant, pre-break service is
  permanently disregarded when the consecutive break period equals or exceeds
  the greater of 5 years or the pre-break service (`[DBAB-7]` Q 7:41, Q 7:45;
  St. Rose §3.3(c); Blond §3.05: "the greater of five (5) or his number of
  Years of Eligibility Service prior to such One Year Break in Service").
  The comparison is between two *durations* (break length vs pre-break
  service), both computed by the date primitives (§1) — a date error in either
  duration can flip the parity outcome, which is a cliff: all pre-break service
  or none of it.
- **Pre-break service for eligibility vs vesting vs accrual** can differ: Blond
  §3.05 disregards pre-break *eligibility* service under parity; the vesting
  and accrual consequences are stated separately in the plan. The engine
  applies the break rule per quantity, per the plan's text.

**Elapsed-time breaks.** A one-year period of severance (no Hour of Service in
the 12 consecutive months from the severance date to its first anniversary —
`[DBAB-7]` Q 7:41) is the break; the one-year holdout and rule of parity apply
as above, with "period of severance" in place of "computation period".
Service-spanning (§2.2) means many short severances are not breaks at all.

**Restoration after a distribution.** St. Rose §3.2(c) `[ST-ROSE]`: a
participant who received a distribution of their vested interest gets previous
service credit restored **upon repayment with interest at 5% per year**; without
repayment, the subsequent benefit is reduced by the distributed amount with
interest, and the distribution "will be disregarded for purposes of eligibility
or position on the Plan's vesting schedule". The engine models restoration as a
dated event with a condition (repayment date + amount), not as an automatic
fact: service is restored from the repayment date, and a reconstruction at a
date before repayment shows the service unrestored. The 5% interest rate is a
plan term, not a system constant.

**Rehires.** A rehire creates a new `EmploymentPeriod` (Stage 2 output 01, §6.3
rule 4) — never a merged period with a note. Each period carries its own start
/ end dates, its own hours, and its own break finding. Service is the sum over
periods after the break rules are applied per period boundary. A participant
who returns after a break and then terminates again has *two* DOTEs in their
history but one PA_AMB measurement date: the PA_AMB is at the *last* DOTE
unless the record establishes otherwise, and a PA_AMB measured at an earlier
DOTE is a different measurement basis (§4.4).

**Leaves of absence.** See §4.3.

### 4.3 Leaves of absence, military service, disability

- **Authorized leave.** St. Rose §3.3(g) (and Blond §1.29(f)): hours that
  would normally have been credited but for a maternity/paternity absence are
  credited (8 hours per day, up to 501 hours) *solely to prevent* a One-Year
  Break-in-Service — they prevent the break, they do not earn a year of
  service. The engine must implement leave-credit as break-prevention only,
  with the 501-hour cap, and must not let leave hours earn credited service
  unless the plan says so.
- **Military service.** Blond §1.29(g) / §1.50 / §3.05: Qualified Military
  Service is treated as service, with imputed hours (hours the employee would
  have worked, or average rate over the prior 12 months) and imputed
  compensation; the absence does not constitute a break. St. Rose §3.5: military
  service is an Authorized Leave of Absence, counts as Service, and does not
  cause a break. The imputation rule (which hours, which compensation) is a
  per-plan input; the engine never imputes hours from elapsed time.
- **Disability / layoff.** An absence of less than 12 months is not a severance
  under elapsed time (`[DBAB-7]` Q 7:40–7:42); under hours-based crediting, a
  layoff year with ≤500 hours is a break unless a leave provision prevents it.
  The distinction is method-dependent and must be traced to the method in
  force, not to a generic "leave" flag.

### 4.4 DOTE vs DOPT vs NRD — three dates, three measurement bases

| Date | Meaning | Source | Role in this system |
|---|---|---|---|
| **DOTE** | Participant's Date of Termination of Employment | BCV1.DOTE (Input, DATE); dictionary: "DOPT used for default RBD calculation when NULL and RETSTAT is '3' or '4'" | The stated measurement basis of PA_AMB ("at DOTE"). Service `CSPA`/`CS`/`VSPA`/`VS`/`ESPA`/`ES` are all "at DOTE". |
| **DOPT** | Date of Plan Termination | App-level case fact, sourced from the case file / R5 header — **not** a BCV dictionary field (`[S2-01]` §0.1 fact 10) | The date through which the PBGC valuation runs; a reconstruction date, not the PA_AMB measurement date. Service at DOPT can exceed service at DOTE (employment after DOTE is impossible, but DOPT is usually after DOTE, and the difference is the gap the reconstruction must explain — or the participant terminated before DOPT and service stops at DOTE). |
| **NRD** | Normal Retirement Date | Derived: DOB + NRA under the plan's NRD rule (§3.3) | The commencement basis of the accrued benefit (B1 is expressed at NRD). Never a measurement date for service: service is measured through DOTE (or the reconstruction date), and the benefit is *expressed* at NRD. Confusing NRD with DOTE is a basis error (Stage 1 output 01, §1.2). |

Rules:

- **D-4.1.** DOTE ≠ DOPT. Always. A calculation that substitutes DOPT for DOTE
  (or the reverse) changes the service period, the plan version in force, and
  the comparison basis. The engine stores all three dates separately and the
  trace names which one each computation uses.
- **D-4.2.** DOTE may be null (dictionary permits it in stated circumstances —
  Stage 2 output 01, §1.3 rule 4). A null DOTE makes any "at DOTE" measurement
  unresolved until other evidence establishes a date; no Δ is computed
  (Stage 2 output 04, §1.4).
- **D-4.3.** A recorded PA_AMB without an established measurement date is
  flagged `comparison_basis = UNRESOLVED` (Stage 1 output 01, §3.5): it may be
  compared only against a *range* of reconstructions (one per plausible
  measurement date), never against a single date as if that date were known,
  and it cannot support a Verified disposition.
- **D-4.4.** The date the administrator *recorded* the benefit and the date
  *through which* the benefit was calculated are different fields
  (MASTER_PROMPT §5). A PA schedule dated 2015 that calculates service through
  2010-06-30 is a 2010 measurement with a 2015 record date. The engine uses
  the through-date for service and the record date only for provenance.

### 4.5 Retroactive amendments

- **Adoption date ≠ effective date** (Stage 2 output 01, §1.3 rule 3; §6.2
  rule 2). `P(t)` is selected by **effectiveDate**; `adoptionDate` is the legal
  record. An amendment adopted 2004-06-01 and effective 2004-01-01 governs
  service from 2004-01-01 — including service already rendered before adoption.
  An amendment adopted 2004-01-01 and effective 2005-01-01 does not govern a
  2004 measurement.
- **§411(d)(6) protection** (`[S1-01]` §3.3): an accrued benefit may never
  decrease by plan amendment. A formula change that would reduce an
  already-accrued benefit carries the old benefit forward as a protected floor
  (`[S1-01]` C-04, C-05). For dates, this means the engine must evaluate the
  benefit under *both* the old and new provisions at the amendment's effective
  date and carry the greater forward — the "greater-of" is evaluated at a date,
  and the floor is dated from that date.
- **Fresh-start / wear-away.** A rate decrease applied prospectively (PBGC
  Policy Ex. 17: $50 → $25/month, `[S1-01]` T-03 item 4) protects the old-rate
  accrual: pre-decrease service is priced at the old rate, post-decrease service
  at the new rate. The service *split date* is the amendment's effective date,
  and the split must be computed with the §1 primitives (a one-day error in
  the split date moves a day of service between rates — immaterial per day,
  but the split must be exact so the trace re-adds).
- **Vesting-schedule amendments** cannot decrease any participant's vested
  percentage, and a participant with 3+ years of vesting service may elect the
  old schedule (Blond §8.03 `[BLOND]`; IRC §411(a)(10)). The election right is
  dated (60 days after adoption / effectiveness / notice, whichever is latest);
  the engine records the election window dates and applies the elected schedule
  only where the election is documented.

### 4.6 Plan freezes and service caps

- **Freeze.** A freeze is a `PlanVersion` with a `freeze` block (Stage 2 output
  01, §6.2 rule 6): freeze date, scope (full / partial / accrual-only), DOBF.
  Accrual after the freeze date is zero for the frozen scope. Blond §1.58:
  "Years of Credited Service shall be frozen effective August 1, 2006 and
  shall not increase thereafter." Service through 2006-07-31 counts; the
  freeze date itself (2006-08-01) earns no service. A *partial* freeze (e.g.
  accrual frozen but vesting service continues) freezes credited service only —
  vesting service keeps accruing, and the two quantities diverge after the
  freeze date by design. The engine enforces the freeze by selecting the frozen
  version for dates after the freeze, not by a special case in the formula.
- **Service cap `S_max`.** The cap applies to service *counted*, not to the
  benefit directly (`[S1-01]` T-09). Two plan shapes, with different date
  consequences:
  - *Cap on total service:* `min(S_t, S_max)` — the extra years add nothing,
    but in a final-average plan the benefit can still grow after the cap through
    compensation increases (`[DBAB-9]` Q 9:21, Ex. 1).
  - *Cap on a period (which-years rule):* Blond §5.01 — "no Credited Service in
    excess of thirty (30) years shall be included. In the event a Participant
    has earned Credited Service in excess of thirty (30) years, the benefit will
    be computed using the applicable Unit Benefit in effect in the thirty (30)
    years immediately preceding termination of employment." The cap selects the
    *last* 30 years, not the first 30 — so which years' unit rates apply depends
    on the cap. In a period-rated plan the first-30 vs last-30 choice changes the
    benefit materially, and the choice is a diagnostic, not a rounding error
    (`[S1-01]` T-09 item 11).
  - For flat formulas the *denominator* of the fractional accrual is capped,
    not the numerator alone (`[DBAB-9]` Q 9:21, Ex. 2).
- **Cap + freeze interaction.** A participant who hits the cap before the freeze
  date and a participant who hits it after are the same at DOPT (both capped)
  but different at intermediate dates. Reconstructions at dates between the
  cap date and the freeze date must show the cap binding and the freeze not yet
  in effect; the trace must show both rules' effective dates.

### 4.7 Other edge cases

- **Multiple employment periods / transfers.** Each period is a separate
  `EmploymentPeriod` (§4.2). Transfers between covered and non-covered classes,
  and between employers in a controlled group, are period boundaries with
  their own crediting rules (`[DBAB-7]` Q 7:46–7:49 — service with an
  affiliated employer, predecessor employer, and transfers in/out of covered
  service are per-plan inputs). A transfer out of the eligible class ends
  benefit accrual but may not end vesting service (Blond §3.01: an employee
  reclassified out of the eligible class "shall be credited with Years of
  Vesting Service and Years of Eligibility Service while a member of the
  Excluded Class" but "shall not be credited with any Years of Participation").
- **QDRO splits.** A QDRO alternate-payee split (BCV9 `AMB_SPLIT_DATE`) divides
  the benefit, not the service. Service dates are unaffected; the split date
  determines which benefit is split. The engine never splits service.
- **Prior distributions.** A prior distribution offsets the benefit (Stage 1
  output 01, I-05) and may trigger restoration (§4.2). It does not change any
  date.
- **Age-18 / pre-plan exclusions.** Vesting service may exclude service before
  age 18 and before plan adoption (`[DBAB-7]` Q 7:40). The exclusion is a
  date comparison (DOB + 18 years vs period start, via `addYears` §1.4) and
  must be computed, not assumed from the service total.
- **Top-heavy minimums.** The top-heavy minimum benefit (St. Rose §6.2(b): 2%
  of 5-year highest average × each of the first 10 years of Service in top-heavy
  Plan Years after 1983-12-31) counts only service in top-heavy years — a
  *dated subset* of service, not the whole period. The engine must carry the
  top-heavy year list as dated data.

---

## 5. What Stage 4 must implement

Stage 4 (deterministic actuarial engine, MASTER_PROMPT §23) implements the
functions below. This section is the complete, checkable list: function
signatures in TypeScript, the per-plan inputs each needs, the rounding
configuration each carries, and the tests each needs. Signatures only — no
bodies, no engine code in this stage.

### 5.1 Types Stage 4 needs (additions to Stage 2 output 01 / 04)

```typescript
import type { DateString, DecimalString, Money, PlanVersion, EntityId } from "../stage2/01-data-model";
import type { RoundingConfig, RoundingRule } from "../stage2/04-calculation-functions";

/** One employment period. Dates are inclusive start / inclusive end as
 *  stored; spans are computed with daysBetween (§1.2) by the functions
 *  below, never by re-interpreting the stored dates. */
interface EmploymentPeriodInput {
  periodStart: DateString;
  periodEnd: DateString | null; // null = still employed at the measurement date
  hoursByComputationPeriod: Array<{ periodStart: DateString; periodEnd: DateString; hours: DecimalString }>;
  leavePeriods: Array<{ start: DateString; end: DateString; kind: "authorized" | "maternity-paternity" | "military" | "disability" | "layoff" | "other"; hoursCreditedForBreakPrevention: DecimalString }>;
  isCoveredClass: boolean;
}

/** The plan's service definitions for one PlanVersion. EVERY field is a
 *  per-plan input from the plan documents. There are no defaults in this
 *  interface: a field the documents do not give is null, and null drives
 *  the indeterminacy path (§5.8), never a fallback value. */
interface ServiceDefinition {
  planVersionId: EntityId;
  /** Crediting method per quantity. */
  creditedMethod: "hours-based" | "elapsed-time" | null;
  vestingMethod: "hours-based" | "elapsed-time" | null;
  eligibilityMethod: "hours-based" | "elapsed-time" | null;
  /** Hours thresholds (hours-based only). null where the method is elapsed-time. */
  fullYearHours: DecimalString | null;      // e.g. "1800" (Blond top band) or "1000"
  breakHours: DecimalString | null;         // e.g. "500"
  hoursBands: Array<{ minHours: DecimalString; maxHours: DecimalString | null; creditYears: DecimalString }> | null; // Blond §1.58 shape
  hoursEquivalency: { kind: string; citation: string } | null; // e.g. DOL Reg. §2530.200b-3 equivalency, named
  computationPeriod: "plan-year" | "anniversary-year" | null;
  /** Fractional-year conversion (elapsed-time / months plans). */
  fractionalConversion:
    | { kind: "months-round-up"; citation: string }        // St. Rose §3.2(b)
    | { kind: "months-truncate"; citation: string }
    | { kind: "months-exact"; citation: string }           // months/12, leftover days dropped
    | { kind: "days-divided"; denominator: DecimalString; citation: string } // days/365 etc.
    | { kind: "hours-fraction"; denominatorHours: DecimalString; citation: string } // hours/full-year-hours
    | null;
  /** Part-time proration: which channel, or none. */
  proration: { channel: "service" | "compensation" | "full-compensation-adjustment"; ruleRef: string } | null;
  /** Vesting schedule: whole-year lookup table for this version. */
  vestingSchedule: Array<{ minWholeYears: number; maxWholeYears: number | null; percent: DecimalString }> | null;
  specialVesting: Array<{ condition: string; percent: DecimalString; ruleRef: string }>; // e.g. 100% on early-retirement / disability termination
  /** Break rules per quantity. */
  breakRule: {
    credited: BreakRule | null;
    vesting: BreakRule | null;
    eligibility: BreakRule | null;
  };
  /** Accrual start and special credits. */
  accrualStart: "participation-date" | "hire-date" | null;
  pastServiceCredit: { description: string; ruleRef: string } | null;
  predecessorServiceCredit: { description: string; ruleRef: string } | null;
  /** Cap and freeze. */
  serviceCap: { maxYears: DecimalString; whichYears: "last-n" | "first-n"; ruleRef: string } | null;
  freeze: { freezeDate: DateString; scope: "full" | "partial-accrual-only" | "partial-other"; inclusiveOfFreezeDate: boolean; ruleRef: string } | null;
  /** NRD rule. */
  nrdRule: { kind: "birthday" | "first-of-month-coincident-or-next" | "first-of-plan-year-after" | string; citation: string } | null;
  /** Leap-day birthday convention (D-1.5). */
  leapDayBirthday: "feb-28" | "mar-01" | null;
}

/** One break rule (hours-based or elapsed-time), as the plan states it. */
interface BreakRule {
  kind: "hours-threshold" | "period-of-severance";
  thresholdHours: DecimalString | null;   // hours-based: ≤ this = a break year
  severanceMonths: number | null;         // elapsed-time: months of severance = a break
  holdout: "one-year-holdout" | "none" | null;
  parity: { applies: boolean; minBreakYears: DecimalString | null; ruleRef: string } | null;
  restoration: { requiresRepayment: boolean; interestRate: DecimalString | null; ruleRef: string } | null;
}

/** A service result: exact decimal years plus the full trace inputs.
 *  `value` is null when the quantity cannot be established. */
interface ServiceResult {
  value: DecimalString | null;
  /** Exact rational form, kept alongside the decimal where the plan defines
   *  the credit as a fraction (e.g. 3/4 year, 1800/2000). See §5.5. */
  rational: { numerator: bigint; denominator: bigint } | null;
  periods: ServicePeriodTrace[];
  missingInputs: string[]; // ids of the ServiceDefinition fields that were null
  roundingApplied: Array<{ rule: string; before: DecimalString; after: DecimalString }>;
}

interface ServicePeriodTrace {
  periodStart: DateString;
  periodEnd: DateString;
  method: "hours-based" | "elapsed-time";
  rawCredit: DecimalString;      // before break / proration / cap
  creditAfterBreaks: DecimalString;
  creditAfterProration: DecimalString;
  ruleRef: string;
}
```

### 5.2 Function list — date primitives (§1)

| # | Signature | Per-plan inputs | Rounding carried | Tests (§5.7) |
|---|---|---|---|---|
| F-D-01 | `daysBetween(start: DateString, end: DateString): number` | none | none — integer | T-D-01 |
| F-D-02 | `daysSinceEpoch(date: DateString): number` / `dateFromDays(n: number): DateString` | none | none — integer | T-D-02 |
| F-D-03 | `isLeapYear(year: number): boolean`, `daysInMonth(year: number, month: number): number` | none | none | T-D-03 |
| F-D-04 | `addMonths(date: DateString, n: number): DateString` | none (clamping is the stated convention, §1.4) | none | T-D-04 |
| F-D-05 | `addYears(date: DateString, n: number): DateString` | none | none | T-D-05 |
| F-D-06 | `ageAt(dob: DateString, at: DateString): number` | leap-day birthday convention (`ServiceDefinition.leapDayBirthday`) — null ⇒ refuse when the birthday falls in a non-leap year | none | T-D-06 |
| F-D-07 | `completedYMD(start: DateString, end: DateString): { years, months, days }` | none | none — decomposition only | T-D-07 |
| F-D-08 | `monthStart / nextMonthStart / firstOfMonthCoincidentOrNext / yearStart / nextYearStart(date: DateString): DateString` | the boundary rule that invokes them (per-plan, per-purpose — §1.7) | none — the movement is recorded, not rounded | T-D-08 |
| F-D-09 | `validateDateString(s: string): DateString` — rejects invalid calendar dates, never coerces | none | none | T-D-09 |

**Purity rule (Stage 2 output 04, §0.3):** all of F-D-01–F-D-09 are pure
functions. No clock, no locale, no timezone database, no network. The only
locale-sensitive operation in the system is *display* formatting, which lives
outside the core.

### 5.3 Function list — service computation (Stage 3 of the pipeline)

These are the Stage 3 functions of Stage 2 output 04, §2, specialised by this
document. Each returns a `ServiceResult` (never a bare number) so that a null
value, a rational fraction, and the trace travel together.

| # | Signature | Per-plan inputs | Rounding carried | Tests |
|---|---|---|---|---|
| F-S-01 | `computeCreditedService(periods: EmploymentPeriodInput[], asOf: DateString, def: ServiceDefinition, rounding: RoundingConfig): ServiceResult` | `creditedMethod`, `fullYearHours` / `hoursBands` / `hoursEquivalency`, `computationPeriod`, `fractionalConversion`, `proration`, `breakRule.credited`, `accrualStart`, `pastServiceCredit`, `predecessorServiceCredit`, `serviceCap`, `freeze` | `rounding.serviceRounding` (credited); definition-internal rounding (e.g. months round-up) recorded as a Stage 3 step, not a Stage 8 step (§3.2) | T-S-01…T-S-06 |
| F-S-02 | `computeVestingService(periods, asOf, def, rounding): ServiceResult` | `vestingMethod`, thresholds, `breakRule.vesting`, pre-18 / pre-plan exclusions (dated) | integer truncation (elapsed-time) / whole-year rule (hours-based) — definition-internal | T-S-07…T-S-09 |
| F-S-03 | `computeEligibilityService(periods, asOf, def, rounding): ServiceResult` | `eligibilityMethod`, thresholds, `breakRule.eligibility`, initial-period rule | whole-year rule — definition-internal | T-S-10 |
| F-S-04 | `vestingPercent(vestingService: ServiceResult, def: ServiceDefinition, asOf: DateString, terminationReason: string): { vp: DecimalString \| null; scheduleRow: string \| null; missingInputs: string[] }` | `vestingSchedule`, `specialVesting` (early-retirement / disability 100%), vesting-schedule amendment + election window | none — a table lookup; the lookup input is whole years only | T-S-11 |
| F-S-05 | `applyBreaks(periods, asOf, breakRule: BreakRule, vestingStatus: "vested" \| "nonvested" \| null): { periods: ServicePeriodTrace[]; heldOut: ServicePeriodTrace[]; disregardedByParity: ServicePeriodTrace[] }` | `breakRule` (holdout / parity / restoration) | none | T-S-12 |
| F-S-06 | `applyServiceCap(service: ServiceResult, cap: ServiceDefinition["serviceCap"], asOf: DateString): ServiceResult` | `serviceCap` (max years + which-years) | none — the cap is a truncation, not a rounding; the which-years selection is traced per period | T-S-13 |
| F-S-07 | `applyFreeze(service: ServiceResult, freeze: ServiceDefinition["freeze"], asOf: DateString): ServiceResult` | `freeze` (date, scope, inclusivity) | none | T-S-14 |
| F-S-08 | `splitServiceByVersion(service: ServiceResult, timeline: PlanVersionTimeline, asOf: DateString): Array<{ planVersionId: EntityId; service: DecimalString }>` | the `PlanVersion` timeline (effective dates) | none — the split re-uses the same conversion rule per period; the per-period rule is the version in force for that period | T-S-15 |
| F-S-09 | `normalRetirementDate(dob: DateString, nra: DecimalString, def: ServiceDefinition): DateString \| null` | `nrdRule`, `leapDayBirthday` | none — boundary movement per the plan's rule, traced | T-S-16 |
| F-S-10 | `serviceAtDate(periods, date: DateString, def, rounding): { credited: ServiceResult; vesting: ServiceResult; eligibility: ServiceResult }` — the dated-measure wrapper: service *through* any date, not only DOTE | all of F-S-01–F-S-03 | as F-S-01–F-S-03 | T-S-17 |

**Ordering rule:** breaks (§4.2) are applied to the period list *before*
conversion to years; proration (§2.4) is applied to the converted credit;
the cap (§4.6) is applied at formula-evaluation time to the credited quantity
only; the freeze (§4.6) is applied by version selection, not by truncating a
computed total. A Stage 3 trace that shows the cap applied before the breaks
is wrong, and the Stage 4 test suite must contain a case that distinguishes
the orders (T-S-06).

### 5.4 Function list — rounding (Stage 8 of the pipeline, date/service aspects)

| # | Signature | Per-plan inputs | Tests |
|---|---|---|---|
| F-R-01 | `applyServiceRounding(service: ServiceResult, rule: RoundingRule \| null): ServiceResult` — applies the configured R-1 rule at the configured stage, or records `none-prescribed` | `RoundingConfig.prescribedSequence` (service target), `ServiceDefinition` (for definition-internal rules — which are *not* re-applied here) | T-R-01 |
| F-R-02 | `maxPlausibleRoundingEffect(benefit: TypedBenefitQuantity, rounding: RoundingConfig, service: ServiceResult): Money` — sum of per-stage rounding units in money (Stage 2 output 04, §4.3) | `RoundingConfig` | T-R-02 |
| F-R-03 | `testRoundingSequence(request: CalculationRequest, sequence: RoundingSequence): CounterfactualResult` — the H15 counterfactual (Stage 2 output 04, §6.2); runs on a copy, labels the result `supported` / `plausible` / `coincidence` / `refuted` per §3.5 | the alternative sequence + its source citation | T-R-03 |

### 5.5 OD-2 resolved: service representation (exact decimal + rational)

Stage 2 output 04, open item OD-2, asked: credited service as exact decimal vs
rational (numerator/denominator)? **Decision D-5.1 (Stage 3 decision, recorded
here): both, with a fixed division of labour.**

- **Canonical stored form: `DecimalString`** (Stage 2 output 04, §3.1) — the
  string is the value; arithmetic is `ScaledInt` exact-decimal arithmetic.
  Every service value that enters a benefit formula is a `DecimalString`.
- **Rational form retained alongside** (`ServiceResult.rational`) wherever the
  plan defines the credit as a fraction: Blond quarters (3/4, 1/2), hours
  fractions (1800/2000), fractional-accrual fractions (`S_t/S_t^proj`). The
  rational is the *provenance* of the decimal: it records what the fraction
  was before any decimal conversion.
- **Conversion rule:** a rational with a terminating decimal expansion (3/4 =
  0.75, 1/2 = 0.5, 1800/2000 = 0.9) converts exactly. A rational with a
  non-terminating expansion (1/3, 5.5/39.5) is **never** converted to a rounded
  decimal for storage: it is carried as the rational through the formula and
  converted to decimal only at a prescribed rounding point (Stage 8), at a
  recorded scale of at least 10 decimal places (Stage 2 output 04, §3.1 rule
  R-2). The scale used is recorded in the trace step.
- **Rationale:** the failure mode OD-2 exists to prevent is a service fraction
  silently losing precision and then being multiplied into money. The
  decimal+rationale pair prevents it: the decimal is exact where the fraction
  terminates, and the rational is exact where it does not. No `number`
  (IEEE 754 double) ever holds a service value (Stage 2 output 04, §3.1 rule
  R-1).

### 5.6 What each function needs from the case package

| Input | Where it lives | If missing |
|---|---|---|
| Employment periods, hours, leaves | `EmploymentPeriod` + `ServiceHistory` (Stage 2 output 01, §7.6/§7.8) | The affected computation periods are unknown → widen / Indeterminate (§5.8) |
| Plan service definitions | `PlanVersion` provisions → `ServiceDefinition` (§5.1) | The affected quantity is unknown → widen / Indeterminate (§5.8) |
| Vesting schedule | `PlanVersion` provisions → `ServiceDefinition.vestingSchedule` | `VP` unknown → vested benefit unknown; gross benefit may still be computable and is reported as gross, never as vested |
| Rounding configuration | `RoundingConfig` (Stage 2 output 04, §4.2) + §3.6 era fields | `prescribedSequence: null` → no rounding applied; alternatives tested only as hypotheses |
| Measurement date | `CalculationRequest.measurementDate` | Unresolved basis → no calculation, no Δ (Stage 2 output 04, §1.4) |
| BCV service values | `CSPA`/`CS`/`VSPA`/`VS`/`ESPA`/`ES` (Stage 2 output 01, §7.8) | Diagnostics unavailable; the engine still computes from the timeline — the BCV values are cross-checks, not inputs |

### 5.7 Tests Stage 4 must run (date/service)

All tests use synthetic dates and fictional participants only. Each test states
its source; a test whose expected value comes from no source is not a test.

**Date primitives (from the §1 harness — the harness is the test; Stage 4
re-runs it as a regression suite):**

| Test | Input → expected | Source |
|---|---|---|
| T-D-01 | days-between table (§1.2), incl. leap Feb (2 days) vs non-leap Feb (1 day), year boundary (1 day) | `[NODE]` |
| T-D-02 | epoch round-trip 1970-01-01 = 0, 2020-02-29 = 18321, 1900-01-01 = −25567; round-trip no drift | `[NODE]` |
| T-D-03 | leap rule: 2000 leap, 1900 not, 2020 leap, 2021 not; Feb days 29/28/28/29 | `[NODE]` |
| T-D-04 | addMonths clamping table (§1.4), incl. 2020-01-31+1 = 2020-02-29 and 2021-01-31+1 = 2021-02-28 | `[NODE]` |
| T-D-05 | addYears leap day: +1 = 2021-02-28, +4 = 2024-02-29, −1 = 2019-02-28 | `[NODE]` |
| T-D-06 | age table (§1.3): day-before-birthday 64, birthday 65; leap DOB 20 at 2021-02-28, 21 at 2021-03-01 | `[NODE]` |
| T-D-07 | completedYMD: DBAB Lynn {2,2,0}; Stage 2 spans {24,2,29}, {17,8,30}, {6,5,29}; **non-sticky clamping**: 2020-01-31 +1mo +1mo = 2020-03-29 | `[NODE]` |
| T-D-08 | first-of-month coincident-or-next: 2020-03-01 → 2020-03-01; 2020-03-02 → 2020-04-01; 2020-03-31 → 2020-04-01 | §1.7 (derived from §1.4 primitives; expected values computed by the harness author and verified by hand — record as harness-derived, not plan-sourced) |
| T-D-09 | invalid dates rejected: 2021-02-29, 2020-13-01, 2020-00-10, "1986-4-1" (non-ISO) | §1.1 rule D-1.3 |

**Service computation:**

| Test | Input → expected | Source |
|---|---|---|
| T-S-01 | St. Rose months rule: 1986-04-01 → 2010-06-30 = 24.25; splits 17.75 + 6.5 = 24.25 | §2.5 `[NODE]` |
| T-S-02 | Blond bands: 1800h = 1, 1799h = 3/4, 1350h = 3/4, 1349h = 1/2, 1000h = 1/2, 999h = 0 (per computation period) | `[BLOND]` §1.58 `[NODE]` |
| T-S-03 | DBAB Jake: 1,800/2,000 hours = 0.9 credited year; same hours = 1 vesting year (1,000-hour threshold) | `[DBAB-7]` Q 7:21 Ex. 1; Q 7:20 |
| T-S-04 | DBAB Matt: 400+600+400 days = 1,400 days → 3 vesting years (integer truncation, remainder disregarded) | `[DBAB-7]` Q 7:38 |
| T-S-05 | DBAB Walt (service-spanning): 6 months + 2-month layoff + quit + return 5 months later = 13 months credited | `[DBAB-7]` Q 7:44 |
| T-S-06 | Ordering: a participant with a break *and* a cap — cap applied after breaks, and the trace shows the order; a swapped-order implementation must fail this test | §5.3 ordering rule |
| T-S-07 | Vesting lookup: St. Rose schedule — 9 completed years = 90%, 10 = 100%, 3 = 0%; top-heavy schedule — 2 = 20%, 6 = 100% | `[ST-ROSE]` §5.4, §6.2(c) |
| T-S-08 | Vesting lookup: Blond cliff — 4 vesting years = 0%, 5 = 100% (post-1988 schedule); 9 = 0%, 10 = 100% (earlier schedule) | `[BLOND]` §8.02 |
| T-S-09 | Vesting uses whole years only: 9.99 vesting years → 9-year row (90% St. Rose), never the 10-year row | §2.3 (vesting lookup consumes whole years) |
| T-S-10 | Eligibility: St. Rose — first-year period from first Hour of Service, later years by Plan Year; 1,000-hour threshold | `[ST-ROSE]` §3.1(b) |
| T-S-11 | VP: Blond early-retirement termination = 100% regardless of vesting years; ordinary termination at 4 years = 0% | `[BLOND]` §8.02 |
| T-S-12 | Breaks: rule of parity — nonvested participant, 3 pre-break years, 5-year break → pre-break service disregarded; same facts with a 4-year break → service retained; vested participant with a 5-year break → service retained | `[DBAB-7]` Q 7:41; `[ST-ROSE]` §3.3(c); `[BLOND]` §3.05 |
| T-S-13 | Cap: Blond last-30-years rule — a participant with 35 years whose early years were at $42 and late years at $222 is priced on the last 30 years, not the first 30 | `[BLOND]` §5.01 |
| T-S-14 | Freeze: Blond credited service frozen 2006-08-01 — service through 2006-07-31 counts, service after does not; vesting service (unfrozen scope) continues | `[BLOND]` §1.58 |
| T-S-15 | Version split: Stage 2 Ana Ruiz split — pre-2004 17.75 at the old rate, post-2003 6.5 at the new rate; the latest rate never applied retroactively | `[S2-01]` §8.2; MASTER_PROMPT §5 |
| T-S-16 | NRD: DOB 1960-03-14, NRA 65, first-of-month-coincident-or-next → 2025-04-01; birthday rule → 2025-03-14; the two rules must give different traced results, and the plan's rule selects | §3.3 (Blond §5.02 shape; expected values hand-verified from §1.4 primitives) |
| T-S-17 | `serviceAtDate` at DOTE vs DOPT vs a freeze date for one fictional participant: three different credited-service values, each traced to its date | §4.4 |

**Rounding:**

| Test | Input → expected | Source |
|---|---|---|
| T-R-01 | Blond §5.01: final annual benefit rounded to nearest whole dollar; per-period components *not* rounded — a case where the two sequences differ must be in the suite, with the prescribed sequence giving the §5.01 result | `[BLOND]` §5.01 |
| T-R-02 | `maxPlausibleRoundingEffect`: cent-rounding bounds a single-stage effect at $0.005; whole-year service rounding bounds at one year's accrual — a discrepancy larger than the computed max is flagged "cannot be explained by rounding alone" | `[S1-03]` §2.7 |
| T-R-03 | Anti-coincidence: a rounding sequence with no document support that happens to match PA_AMB is labelled `coincidence`, and the disposition stays out of Verified | §3.5 rules A-1–A-5 |

**Indeterminacy path (the tests that prove the engine does not invent definitions):**

| Test | Input → expected | Source |
|---|---|---|
| T-I-01 | `ServiceDefinition.creditedMethod = null` → `computeCreditedService` returns `value: null`, `missingInputs: ["creditedMethod"]`, and the pipeline takes the bounds path (if the missing input is class M3) or Indeterminate (M5) — never a computed service | §5.8 rule I-1 |
| T-I-02 | Hours-based plan with a computation period's hours missing → that period's credit is unknown; the service result is a *range* (period at 0 … period at its maximum), not a point filled with elapsed time | §5.8 rule I-2 |
| T-I-03 | `fractionalConversion = null` with an elapsed-time plan → service is reported as the `{years, months, days}` decomposition plus bounds over the plausible conversions, never as a single decimal | §5.8 rule I-3 |
| T-I-04 | Leap-day DOB with `leapDayBirthday = null` → `ageAt`/`normalRetirementDate` refuse for a non-leap-year birthday; the participant is Indeterminate on age-dependent quantities only (service still computable) | §1.3 rule D-1.5 |
| T-I-05 | DOTE null → `serviceAtDate(DOTE)` unresolved; no Δ computed; the participant is counted in missing-data reporting, never in the Δ statistics | §4.4 rule D-4.2; Stage 2 output 04, §1.4 |
| T-I-06 | A service definition changed by amendment with the amendment's effective date missing → the era boundary is unknown; service is bounded over the two candidate boundaries, and the disposition cannot be Verified | §4.5; §5.8 rule I-4 |

### 5.8 The indeterminacy path — what happens when a definition is missing

Rules for Stage 4 (all mandatory):

- **I-1. A missing service definition is a missing input, never a default.**
  `ServiceDefinition` fields are nullable (§5.1); a null field names the missing
  input in `ServiceResult.missingInputs` and in the `CalculationStep` trace.
  The pipeline then follows Stage 2 output 04, §1.3 rule F-1: bounds if every
  missing input is class M3 (bounds establishable) or M4 (stated assumption);
  Indeterminate otherwise — with the data request that would resolve each input
  (Stage 1 output 03, §4.6–4.7).
- **I-2. Missing hours are never replaced by elapsed time, and missing elapsed
  time is never replaced by hours.** The two methods are different definitions
  (§2.2). A missing input widens the service interval over the values the
  *stated* method could produce for that period (0 … maximum credit for the
  period), and the widened interval flows into the benefit bounds
  (`B_i^min ≤ B_i^possible ≤ B_i^max`, MASTER_PROMPT §12).
- **I-3. A missing conversion rule is reported as a decomposition, not a
  decimal.** When the fractional-conversion rule is unknown, the engine reports
  `completedYMD` plus the bounds over the plausible conversions (months
  round-up / months truncate / days/365 / days/360, each labelled as a
  scenario) — never a single decimal presented as the service.
- **I-4. A missing era boundary (amendment effective date, freeze date, cap
  introduction date) bounds the service over the candidate boundaries.** The
  bound is computed by evaluating the service at each candidate boundary date
  (endpoint-plus-kinks, Stage 2 output 04, §5.2); if the candidate set is
  unbounded, the outcome is Indeterminate.
- **I-5. A missing vesting schedule makes the vested benefit unknown, not
  zero.** The gross accrued benefit may still be computable and is reported as
  gross (vesting treatment `gross`); the vested benefit is `null` with
  `missingInputs: ["vestingSchedule"]`. A zero vested benefit is reported only
  when a schedule is known and the lookup yields 0%.
- **I-6. Indeterminacy is per-quantity, not per-participant.** A participant
  whose credited service is unknown but whose vesting service is known still
  gets a vesting finding; a participant whose service is known but whose
  measurement date is unresolved gets no Δ but keeps their service
  computation. The pipeline never discards a computable quantity because a
  different quantity failed.

---

## 6. Invariants (date/service)

1. **Service is non-decreasing in the measurement date** within one crediting
   regime, except where a break rule, a freeze, or a correction applies — and
   each exception is traced to its rule and date (`[S1-02]` rule L-07: service
   decreases between extracts only with a documented cause).
2. **Service never exceeds elapsed time plus documented credits** (`[S1-02]`
   rule P-15): `S_t ≤ daysBetween(hire, t)` converted under the plan's rule,
   plus past-service / predecessor credits cited in the trace. An excess is a
   diagnostic hypothesis, not a correction.
3. **Vesting service and credited service are computed independently** and
   compared only as a diagnostic (§2.6). Neither is derived from the other.
4. **A service value is never a float.** `DecimalString` / `ScaledInt` only
   (Stage 2 output 04, §3.1 rule R-1); the rational is retained where the plan
   defines a fraction (§5.5).
5. **Every service value carries its definition.** A `ServiceResult` without a
   `ruleRef` per period and a `ServiceDefinition` version is not a result — it
   is an unprovenanced number and must not enter a benefit calculation.
6. **No date is moved without a cited rule** (§1.7 rule D-1.10). DOTE, DOPT,
   NRD, freeze dates, and amendment effective dates are stored as given and
   moved only by a plan-stated boundary rule, traced.
7. **Rounding is applied once, at the prescribed point, and recorded.**
   Definition-internal rounding (§3.2) is a Stage 3 step; Stage 8 rounding is
   a Stage 8 step; a value rounded twice by the same rule is a defect the test
   suite must catch (T-R-01 covers the Blond case).

---

## 7. Open items for Stage 4 (not decisions)

| # | Item | Status |
|---|---|---|
| OD-2 | Service representation: exact decimal vs rational | **Resolved in this document (§5.5, decision D-5.1):** canonical `DecimalString`, rational retained alongside; non-terminating rationals convert only at a prescribed rounding point at scale ≥ 10. |
| OD-3 | Rounding-mode list completeness (Stage 2 output 04, §10) | Open. The six modes cover the documented cases; a plan may prescribe another (e.g. round to nearest $5). Additions need a recorded decision, not a silent extension. |
| O-D-1 | Leap-day birthday convention | Open per case. No source states a general rule; `ServiceDefinition.leapDayBirthday` is null until the plan document or the administrator's convention establishes it (§1.3, D-1.5). |
| O-D-2 | Short-window rule for averaging when service < `n` years | Open per plan (`[S1-01]` T-06 item 9). If the plan states none, the window is bounded over plausible treatments, never assumed. |
| O-D-3 | Partial computation-period rule (hire/termination mid-period, hours-based) | Open per plan (§2.3). If the plan states none, the partial period is an open item, not a pro-rata assumption. |
| O-D-4 | Freeze-date inclusivity where the plan is silent | Open per plan (§3.3). The engine records the assumption as a scenario, never as the rule. |
| O-D-5 | BCV add-in service functions (SERVYCA etc.) — the exact algorithm behind Calculated `CS`/`VS`/`ES` | Not sourced in this stage. The add-in doc (`BCV_ATPBGC_Add-ins.pdf`, Jul 2024) confirms the function names; the per-function service algorithm is Stage 4 work if the engine needs to reproduce BCV-calculated service rather than only compare against it. Until then, `CS`/`VS`/`ES` are treated as reported Calculated values with their own provenance, not re-derived. |
| O-D-6 | Kink-point discovery for bounds over service inputs (Stage 2 output 04, OD-6) | Open for Stage 4/5. Service kinks: band thresholds (999/1,000 hours), vesting cliffs (5/10 years), cap thresholds (30 years), freeze dates, amendment effective dates. The formula catalog must state each formula's kink structure, or the engine falls back to grid/optimisation. |

---

## 8. Traceability — every rule in this document and its source

| Rule / finding | Source |
|---|---|
| D-0 no defaults | User emphasis 2026-11-12; MASTER_PROMPT §5, §12; Stage 1 output 01 §0 |
| D-1.1–D-1.3 UTC epoch, Int32, no coercion | Stage 2 output 01 §1.1, §1.3; `[NODE]` |
| §1.2 days-between convention | `[NODE]` (verified against GNU `date`) |
| §1.3 age = completed years | §1.6 calendar method; `[NODE]` |
| D-1.5 leap-day birthday unresolved | No source states a rule — recorded as open (O-D-1) |
| §1.4 addMonths clamping, non-sticky | `[NODE]` |
| §1.5 Gregorian leap rule | `[NODE]` |
| §1.6 completed YMD | `[DBAB-7]` Q 7:35 example reproduced `[NODE]` |
| §1.7 boundary movement per plan | `[BLOND]` §5.02 shape |
| §1.8 no 30/365-day conversion in the core | `[DBAB-7]` Q 7:37–7:38 (conversions live in §2.3, vesting only) |
| §2.1 three quantities differ | `[DBAB-7]` Q 7:1–7:2; `[S1-02]` §A.2.8; `[BCV-DICT]` |
| §2.2 hours vs elapsed time; 1,000/500-hour defaults; equivalencies | `[DBAB-7]` Q 7:2–7:8; DOL Reg. §§2530.200b-1, -2, -3 |
| Blond §1.58 bands; §1.59/§1.61 1,000-hour rule | `[BLOND]`; `[NODE]` |
| St. Rose §3.1(b) 1,000 hours; §3.3 500-hour break | `[ST-ROSE]` |
| Elapsed-time vesting aggregation, 30-day month, 365-day year, integer truncation | `[DBAB-7]` Q 7:36–7:38; Treas. Reg. §1.410(a)-7 |
| Service-spanning; severance date; period of service | `[DBAB-7]` Q 7:39–7:44 |
| §2.4 partial years, Jake 0.9, double proration | `[DBAB-7]` Q 7:20–7:21; DOL Reg. §2530.204-2(c), (d) |
| §2.5 24.25 re-derivation | `[S2-01]` §8.2; `[ST-ROSE]` §3.2(b); `[NODE]` |
| §2.6 X-07 diagnostic, tolerance 0 | `[S1-02]` §A.2.8, X-07, P-06, P-15, X-05, X-09, L-07 |
| §3.2 service rounding rules | `[ST-ROSE]` §3.2(b); `[BLOND]` §1.58; `[DBAB-7]` Q 7:20, 7:36, 7:38; `[DBAB-9]` Q 9:9 |
| §3.3 date-boundary rules | `[BLOND]` §5.02, §1.58; §1.7 |
| §3.4 Blond §5.01 nearest whole dollar; no PBGC rounding policy (G-6) | `[BLOND]` §5.01; `[S1-02]` gap G-6; `[S1-01]` T-04 item 6 |
| §3.5 anti-coincidence | MASTER_PROMPT §9; `[S1-03]` §2.7; Stage 2 output 04 §4.4 |
| §4.1 partial years, fractional ratchet | `[DBAB-9]` Q 9:9; `[S1-01]` T-07 item 9; `[S1-01]` T-06 item 9 |
| §4.2 holdout, parity, restoration | `[DBAB-7]` Q 7:41, 7:45; `[ST-ROSE]` §3.2(c), §3.3(c); `[BLOND]` §3.05, §1.39 |
| §4.3 leaves, military | `[ST-ROSE]` §3.3(g), §3.5; `[BLOND]` §1.29(f)–(g), §1.50 |
| §4.4 DOTE/DOPT/NRD | `[BCV-DICT]` (DOTE); `[S2-01]` §0.1 fact 10 (DOPT not a BCV field); Stage 1 output 01 §1.2, §3.5 |
| §4.5 adoption vs effective; §411(d)(6); vesting election | Stage 2 output 01 §1.3, §6.2; `[S1-01]` §3.3, C-04/C-05; `[BLOND]` §8.03 |
| §4.6 freeze; cap, last-30-years rule; denominator cap | `[BLOND]` §1.58, §5.01; `[S1-01]` T-09; `[DBAB-9]` Q 9:21 |
| §5.5 OD-2 resolution D-5.1 | Stage 2 output 04 §10 OD-2; Stage 2 output 04 §3.1 |
| §5.8 indeterminacy rules I-1–I-6 | MASTER_PROMPT §12; Stage 2 output 04 §1.3 F-1, §5; Stage 1 output 03 §4.6–4.7 |

---

## Appendix A — Node verification results

Harness: `stage3/date-primitives-harness.js`. Run 2026-11-12, Node v24.22.1.
**58/58 checks passed.** Day counts cross-checked against GNU `date +%s`
arithmetic (8856, 6483, 2372 all confirmed). Two hand-computed day counts in
the first harness draft were wrong and were corrected from the measured values —
recorded here so a later reader does not "fix" the harness back to the wrong
numbers.

What the harness proves: the §1 primitives behave as stated, including
2020-02-29 leap day, month-end dates (2020-01-31 + 1 month = 2020-02-29;
2021-01-31 + 1 month = 2021-02-28), year boundaries, non-sticky clamping
(2020-01-31 + 1 month + 1 month = 2020-03-29), leap-day ages, the DBAB Q 7:35
elapsed-time example ({2, 2, 0}), the DBAB Q 7:38 vesting aggregation
(1,400 days → 3 years), the Blond §1.58 band cliffs, and the Stage 2 worked
example under the St. Rose months rule (24.25 / 17.75 / 6.5, exact) versus
days/365 (24.2767 / 17.7479 / 6.4986, not exact).

What the harness does **not** prove: any plan's service definition or rounding
rule. Those come from the plan documents cited in §8, and where no document
gives them, §5.8 governs.

---

## Appendix B — What Stage 4 receives from this document

1. The nine date primitives (§1) with their single stated conventions and
   their regression tests (T-D-01–T-D-09).
2. The `ServiceDefinition` interface (§5.1): every service fact the app must
   take from the plan documents, with null meaning "not established" and never
   a default.
3. The ten service functions (F-S-01–F-S-10) and three rounding functions
   (F-R-01–F-R-03) with signatures, inputs, and tests — including six
   indeterminacy tests (T-I-01–T-I-06) that prove the engine does not invent
   a definition.
4. The OD-2 resolution (decision D-5.1): canonical `DecimalString`, rational
   retained alongside.
5. The worked-example finding (D-2.1): the Stage 2 24.25-year example is
   exactly the St. Rose months rule, not a days-based conversion — and the
   conversion rule must therefore be a named per-plan rule checked against
   known values, not an assumed days denominator.
