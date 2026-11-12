"use strict";
/**
 * Service computation — Stage 3 output 02, §2–§5 (Stage 3 of the pipeline).
 *
 * Credited service, vesting service, and eligibility service are THREE
 * DIFFERENT quantities (different start dates, units, crediting rules,
 * break treatment, caps). Each is computed exactly per the plan document
 * definitions carried in the case package (ServiceDefinition inputs).
 * There are no defaults anywhere in this module (rule D-0):
 * a definition the documents do not give is null, and null drives the
 * indeterminacy path (§5.8, rules I-1–I-6) — never a fallback value.
 *
 * Ordering (§5.3): breaks are applied to the period list BEFORE
 * conversion to years; proration is applied to the converted credit;
 * the cap is applied at formula-evaluation time to the credited quantity
 * only (applyServiceCap, never inside the compute functions); the freeze
 * is applied by clipping period ends at the freeze cutoff.
 *
 * NEVER days/365 for credited service unless the plan's own
 * fractionalConversion rule says so (finding D-2.1: the Stage 2 example
 * 1986-04-01 → 2010-06-30 = 24.25 years is exactly the St. Rose
 * months rule, not 24.2767 under days/365). Date→service conversion is
 * always a named per-plan rule checked against known values.
 *
 * DOTE ≠ DOPT, always (rule D-4.1). DOTE may be null; then
 * serviceAtDate(null) is unresolved and no Δ is computed (rule D-4.2).
 *
 * All functions are pure. Decimal-safe via src/decimal.ts (ScaledInt);
 * a binary float never touches a service value. Synthetic data only.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.employmentPeriodInputFromEmploymentPeriod = employmentPeriodInputFromEmploymentPeriod;
exports.decimalStringToRational = decimalStringToRational;
exports.spanningMonths = spanningMonths;
exports.hoursPeriodCreditRange = hoursPeriodCreditRange;
exports.applyBreaks = applyBreaks;
exports.computeCreditedService = computeCreditedService;
exports.computeVestingService = computeVestingService;
exports.computeEligibilityService = computeEligibilityService;
exports.vestingPercent = vestingPercent;
exports.applyServiceCap = applyServiceCap;
exports.applyFreeze = applyFreeze;
exports.splitServiceByVersion = splitServiceByVersion;
exports.normalRetirementDate = normalRetirementDate;
exports.serviceAtDate = serviceAtDate;
const decimal_1 = require("./decimal");
const dates_1 = require("./dates");
/**
 * Convert a stored EmploymentPeriod (types.ts) to the service module's
 * EmploymentPeriodInput. A lossless mapping only where the source carries
 * the data: hours-by-computation-period and leave periods are NOT stored
 * on EmploymentPeriod, so they map to empty lists. That makes the
 * converter elapsed-time only in effect: an hours-based definition over
 * a converted period computes from zero computation periods (value "0",
 * no traces) — it does NOT report the hours as missing, because there
 * are no periods for hours to be missing from. A caller with a
 * hours-based plan must build the EmploymentPeriodInput directly, with
 * hours, and must not use this converter to stand in for hours data.
 * `accrualStartDate` is caller-supplied (the participation date, from
 * the eligibility determination); null when not established — a
 * definition whose accrualStart is "participation-date" then refuses
 * (I-1) rather than assuming the hire date. Breaks are NOT inferred
 * from the period rows: `breakBefore` is null unless the caller states
 * a break. Covered class is not recorded on EmploymentPeriod; the
 * converter records `true` only because no computation in this module
 * reads `isCoveredClass` (it is carried data), and a caller that knows
 * a period is not in a covered class must build the
 * EmploymentPeriodInput directly instead of using this converter.
 */
function employmentPeriodInputFromEmploymentPeriod(period, accrualStartDate) {
    return {
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        hoursByComputationPeriod: [],
        leavePeriods: [],
        isCoveredClass: true,
        accrualStartDate,
        breakBefore: null,
    };
}
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function emptyServiceResult(missingInputs) {
    return { value: null, rational: null, periods: [], missingInputs, roundingApplied: [] };
}
function gcd(a, b) {
    let x = a < 0n ? -a : a;
    let y = b < 0n ? -b : b;
    while (y !== 0n) {
        const t = x % y;
        x = y;
        y = t;
    }
    return x === 0n ? 1n : x;
}
function reduceRational(numerator, denominator) {
    const g = gcd(numerator, denominator);
    return { numerator: numerator / g, denominator: denominator / g };
}
/** Exact rational for a terminating DecimalString (e.g. "0.75" → 3/4). */
function decimalStringToRational(value) {
    const parsed = (0, decimal_1.parseDecimalString)(value);
    const denominator = 10n ** BigInt(parsed.scale);
    return reduceRational(parsed.value, denominator);
}
function addRationals(a, b) {
    if (a === null || b === null)
        return null;
    const numerator = a.numerator * b.denominator + b.numerator * a.denominator;
    const denominator = a.denominator * b.denominator;
    return reduceRational(numerator, denominator);
}
/** The freeze cutoff for a quantity: the last date that still earns
 *  service. Blond §1.58: frozen effective 2006-08-01, service through
 *  2006-07-31 counts, so the cutoff is the day before the freeze date
 *  unless the plan states the freeze date itself is inclusive. Returns
 *  null when no freeze binds this quantity. */
function freezeCutoff(def, quantity) {
    const freeze = def.freeze;
    if (freeze === null)
        return null;
    if (freeze.scope === "partial-accrual-only" && quantity !== "credited")
        return null;
    if (freeze.inclusiveOfFreezeDate)
        return freeze.freezeDate;
    return (0, dates_1.dateFromDays)((0, dates_1.daysSinceEpoch)(freeze.freezeDate) - 1);
}
/** Clip a period end at the measurement date and at the freeze cutoff. */
function clippedEnd(periodEnd, asOf, cutoff) {
    let end = periodEnd ?? asOf;
    if ((0, dates_1.daysSinceEpoch)(end) > (0, dates_1.daysSinceEpoch)(asOf))
        end = asOf;
    if (cutoff !== null && (0, dates_1.daysSinceEpoch)(end) > (0, dates_1.daysSinceEpoch)(cutoff))
        end = cutoff;
    return end;
}
/**
 * Convert a completedYMD decomposition to service years under the plan's
 * fractionalConversion rule. Returns the value plus, where the rule is a
 * months rule, the exact rational (totalMonths/12). Returns null when the
 * rule is null (I-3) or does not apply to this decomposition.
 */
function convertYMD(ymd, conversion, start, end) {
    if (conversion === null)
        return null;
    switch (conversion.kind) {
        case "months-round-up": {
            const totalMonths = ymd.years * 12 + ymd.months + (ymd.days > 0 ? 1 : 0);
            return {
                value: (0, decimal_1.decDivide)(String(totalMonths), "12", 10),
                rational: reduceRational(BigInt(totalMonths), 12n),
            };
        }
        case "months-truncate":
        case "months-exact": {
            const totalMonths = ymd.years * 12 + ymd.months;
            return {
                value: (0, decimal_1.decDivide)(String(totalMonths), "12", 10),
                rational: reduceRational(BigInt(totalMonths), 12n),
            };
        }
        case "days-divided": {
            // Named per-plan days rule only (e.g. days/365). Never a default.
            const days = (0, dates_1.daysBetween)(start, end);
            return { value: (0, decimal_1.decDivide)(String(days), conversion.denominator, 10), rational: null };
        }
        case "hours-fraction":
            // An hours fraction does not convert an elapsed-time decomposition.
            return null;
        default:
            return null;
    }
}
/** Whole calendar months covered by [start, end], DBAB Q 7:44 counting:
 *  the months the span covers (Jan 1 → Aug 31 covers 8 months), used only
 *  for the service-spanning total. This is a segment-counting convention
 *  for that worked example, not a general service conversion. */
function monthsCovered(start, end) {
    const a = (0, dates_1.completedYMD)(start, end);
    // completedYMD gives whole months + leftover days; a span that reaches
    // into a further calendar month covers one more month than the whole
    // months when the end day reaches the start day.
    const startDay = Number(start.slice(8, 10));
    const endDay = Number(end.slice(8, 10));
    return a.years * 12 + a.months + (a.days > 0 && endDay >= startDay ? 1 : 0);
}
/**
 * Elapsed-time months credited including service-spanning gaps
 * ([DBAB-7] Q 7:44): periods of severance under 12 months are
 * disregarded and the absence is credited as service. Walt: 6 months'
 * service + 2-month layoff + return 5 months later = 13 months credited
 * (8 months' service + 5 months' severance).
 */
function spanningMonths(periods, asOf) {
    const validAsOf = (0, dates_1.validateDateString)(asOf);
    const sorted = [...periods].sort((a, b) => (0, dates_1.daysSinceEpoch)(a.periodStart) - (0, dates_1.daysSinceEpoch)(b.periodStart));
    let total = 0;
    let prevEnd = null;
    for (const p of sorted) {
        const start = (0, dates_1.validateDateString)(p.periodStart);
        if ((0, dates_1.daysSinceEpoch)(start) > (0, dates_1.daysSinceEpoch)(validAsOf))
            continue;
        const end = clippedEnd(p.periodEnd, validAsOf, null);
        if ((0, dates_1.daysSinceEpoch)(end) < (0, dates_1.daysSinceEpoch)(start))
            continue;
        total += monthsCovered(start, end);
        if (prevEnd !== null && (0, dates_1.daysSinceEpoch)(start) > (0, dates_1.daysSinceEpoch)(prevEnd)) {
            // Gap between periods: a severance under 12 months is spanned
            // (credited); a severance of 12 months or more is a break, not credited.
            const gapMonths = (0, dates_1.completedYMD)(prevEnd, start);
            const gapUnder12Months = gapMonths.years === 0 && gapMonths.months < 12;
            if (gapUnder12Months)
                total += monthsCovered(prevEnd, start);
        }
        if (prevEnd === null || (0, dates_1.daysSinceEpoch)(end) > (0, dates_1.daysSinceEpoch)(prevEnd))
            prevEnd = end;
    }
    return total;
}
/** Hours credit for one computation period under the plan's bands or
 *  full-year threshold. Returns null when the credit cannot be
 *  established (hours missing, or no rule for a partial year). */
function hoursPeriodCredit(hours, def, thresholdHours) {
    if (hours === null)
        return null;
    if (def.hoursBands !== null) {
        for (const band of def.hoursBands) {
            const atMin = (0, decimal_1.decCompare)(hours, band.minHours) >= 0;
            const atMax = band.maxHours === null || (0, decimal_1.decCompare)(hours, band.maxHours) <= 0;
            if (atMin && atMax) {
                return { credit: band.creditYears, rational: decimalStringToRational(band.creditYears) };
            }
        }
        return null;
    }
    if (thresholdHours === null)
        return null;
    if ((0, decimal_1.decCompare)(hours, thresholdHours) >= 0) {
        return { credit: "1", rational: { numerator: 1n, denominator: 1n } };
    }
    // Below a full year: a partial year needs the plan's hours-fraction rule.
    if (def.fractionalConversion !== null &&
        def.fractionalConversion.kind === "hours-fraction") {
        const credit = (0, decimal_1.decDivide)(hours, def.fractionalConversion.denominatorHours, 10);
        return { credit, rational: decimalStringToRational(credit) };
    }
    return null;
}
/** The range a missing-hours computation period could produce (I-2):
 *  0 … the maximum credit for the period under the stated method.
 *  Never filled with elapsed time. */
function hoursPeriodCreditRange(def) {
    if (def.hoursBands !== null) {
        let max = "0";
        for (const band of def.hoursBands) {
            if ((0, decimal_1.decCompare)(band.creditYears, max) > 0)
                max = band.creditYears;
        }
        return { min: "0", max };
    }
    if (def.fullYearHours !== null)
        return { min: "0", max: "1" };
    return null;
}
// ---------------------------------------------------------------------------
// F-S-05 — breaks (applied to the period list BEFORE conversion)
// ---------------------------------------------------------------------------
/**
 * Apply the plan's break rules to the period list (Stage 3 §4.2).
 * The trace credits here are elapsed-time months/12 (trace measure only);
 * the authoritative conversion happens in F-S-01–F-S-03.
 *
 * - One-year holdout: pre-break service is held out until the employee
 *   completes a year of service after reemployment; it is a state, not a
 *   deletion — held-out periods are returned in `heldOut`.
 * - Rule of parity (nonvested only): pre-break service is permanently
 *   disregarded when the consecutive break equals or exceeds the greater
 *   of 5 years or the pre-break service. Vested participants keep
 *   pre-break service. When vestingStatus is null the parity comparison
 *   cannot be decided and pre-break service is retained (the trace says
 *   the parity question is undecided); callers that need a parity
 *   decision must supply the vesting status.
 */
function applyBreaks(periods, asOf, breakRule, vestingStatus) {
    const validAsOf = (0, dates_1.validateDateString)(asOf);
    const sorted = [...periods].sort((a, b) => (0, dates_1.daysSinceEpoch)(a.periodStart) - (0, dates_1.daysSinceEpoch)(b.periodStart));
    const kept = [];
    const heldOut = [];
    const disregarded = [];
    // Pre-break service, in elapsed months/12, for the parity comparison.
    let preBreakService = "0";
    let heldOutPending = [];
    const traceFor = (p) => {
        const start = (0, dates_1.validateDateString)(p.periodStart);
        const end = clippedEnd(p.periodEnd, validAsOf, null);
        const ymd = (0, dates_1.completedYMD)(start, end);
        const months = ymd.years * 12 + ymd.months;
        const credit = (0, decimal_1.decDivide)(String(months), "12", 10);
        return {
            periodStart: start,
            periodEnd: end,
            method: "elapsed-time",
            rawCredit: credit,
            creditAfterBreaks: credit,
            creditAfterProration: credit,
            ruleRef: breakRule === null ? "no break rule stated" : breakRule.ruleRef,
        };
    };
    for (const p of sorted) {
        const trace = traceFor(p);
        const brk = p.breakBefore;
        if (brk !== null && breakRule !== null) {
            // Parity: break >= greater of 5 years or pre-break service, nonvested only.
            const parity = breakRule.parity;
            if (parity !== null &&
                parity.applies &&
                vestingStatus === "nonvested") {
                const threshold = parity.minBreakYears !== null &&
                    (0, decimal_1.decCompare)(parity.minBreakYears, "5") > 0
                    ? parity.minBreakYears
                    : (0, decimal_1.decCompare)(preBreakService, "5") > 0
                        ? preBreakService
                        : "5";
                if ((0, decimal_1.decCompare)(brk.breakYears, threshold) >= 0) {
                    // Disregard everything kept so far (pre-break service) and
                    // anything held out pending.
                    for (const k of kept) {
                        disregarded.push({ ...k, creditAfterBreaks: "0", ruleRef: parity.ruleRef });
                    }
                    for (const h of heldOutPending) {
                        disregarded.push({ ...h, creditAfterBreaks: "0", ruleRef: parity.ruleRef });
                    }
                    kept.length = 0;
                    heldOutPending = [];
                    preBreakService = "0";
                }
            }
            // Holdout: pre-break service is held out until one post-break year
            // of service is completed.
            if (breakRule.holdout === "one-year-holdout") {
                const postStart = (0, dates_1.validateDateString)(p.periodStart);
                const postEnd = clippedEnd(p.periodEnd, validAsOf, null);
                const postYmd = (0, dates_1.completedYMD)(postStart, postEnd);
                const postMonths = postYmd.years * 12 + postYmd.months;
                if (postMonths < 12) {
                    for (const k of kept) {
                        heldOut.push({ ...k, creditAfterBreaks: "0", ruleRef: breakRule.ruleRef });
                    }
                    heldOutPending = [...kept];
                    kept.length = 0;
                }
                else {
                    // Post-break year completed: held-out service is restored.
                    for (const h of heldOutPending)
                        kept.push(h);
                    heldOutPending = [];
                }
            }
        }
        kept.push(trace);
        preBreakService = (0, decimal_1.decAdd)(preBreakService, trace.rawCredit);
    }
    // Periods still held out at the measurement date stay in `heldOut`.
    for (const h of heldOutPending) {
        if (!heldOut.some((x) => x.periodStart === h.periodStart)) {
            heldOut.push({ ...h, creditAfterBreaks: "0", ruleRef: breakRule === null ? "no break rule stated" : breakRule.ruleRef });
        }
    }
    return { periods: kept, heldOut, disregardedByParity: disregarded };
}
// ---------------------------------------------------------------------------
// F-S-01 — credited service
// ---------------------------------------------------------------------------
/**
 * Credited (benefit) service through `asOf` (Stage 3 §2.3).
 * Starts at the accrual-start date (participation date, or hire date
 * where the plan says so), never at hire by default. Applies breaks
 * before conversion, the plan's fractional conversion, part-time
 * proration (service channel only, with the plan's stated factor), and
 * documented past-service / predecessor credits. The service cap is NOT
 * applied here — it is applied at formula-evaluation time by
 * applyServiceCap. Returns value null with missingInputs named when the
 * method, the conversion, the accrual start, or a period's hours are
 * missing (I-1, I-2, I-3) — never a computed service on a guessed rule.
 */
function computeCreditedService(periods, asOf, def, vestingStatus = null) {
    const validAsOf = (0, dates_1.validateDateString)(asOf);
    if (def.creditedMethod === null) {
        return emptyServiceResult(["creditedMethod"]);
    }
    if (def.accrualStart === null) {
        return emptyServiceResult(["accrualStart"]);
    }
    const cutoff = freezeCutoff(def, "credited");
    const breakResult = applyBreaks(periods, validAsOf, def.breakRule.credited, vestingStatus);
    // Breaks were applied to the period list; rebuild the working period
    // list from the kept traces (held-out and parity-disregarded periods
    // contribute nothing at this date).
    const keptStarts = new Set(breakResult.periods.map((t) => t.periodStart));
    const working = [...periods]
        .sort((a, b) => (0, dates_1.daysSinceEpoch)(a.periodStart) - (0, dates_1.daysSinceEpoch)(b.periodStart))
        .filter((p) => keptStarts.has(p.periodStart));
    const traces = [];
    const missingInputs = [];
    const roundingApplied = [];
    let total = "0";
    let totalRational = { numerator: 0n, denominator: 1n };
    for (const p of working) {
        const rawStart = (0, dates_1.validateDateString)(p.periodStart);
        let start = rawStart;
        if (def.accrualStart === "participation-date") {
            if (p.accrualStartDate === null) {
                missingInputs.push("participationDate");
                continue;
            }
            start = p.accrualStartDate;
        }
        const end = clippedEnd(p.periodEnd, validAsOf, cutoff);
        if ((0, dates_1.daysSinceEpoch)(end) < (0, dates_1.daysSinceEpoch)(start))
            continue;
        if (def.creditedMethod === "elapsed-time") {
            if (def.fractionalConversion === null) {
                missingInputs.push("fractionalConversion");
                continue;
            }
            const ymd = (0, dates_1.completedYMD)(start, end);
            const converted = convertYMD(ymd, def.fractionalConversion, start, end);
            if (converted === null) {
                missingInputs.push("fractionalConversion");
                continue;
            }
            const ruleRef = def.fractionalConversion.citation;
            if (def.fractionalConversion.kind === "months-round-up" && ymd.days > 0) {
                // Definition-internal rounding (Stage 3 step, not a Stage 8 step).
                const unrounded = (0, decimal_1.decDivide)(String(ymd.years * 12 + ymd.months), "12", 10);
                roundingApplied.push({
                    rule: `months-round-up (definition-internal): ${ruleRef}`,
                    before: unrounded,
                    after: converted.value,
                });
            }
            let credit = converted.value;
            let creditRational = converted.rational;
            if (def.proration !== null) {
                if (def.proration.channel === "service") {
                    if (def.proration.factor === null) {
                        missingInputs.push("proration.factor");
                        continue;
                    }
                    credit = (0, decimal_1.decMultiply)(credit, def.proration.factor);
                    creditRational = null;
                }
                // channel "compensation" / "full-compensation-adjustment": the
                // proration lives in the compensation average, not in service —
                // service is not prorated (double-proration prohibition, §2.4).
            }
            traces.push({
                periodStart: start,
                periodEnd: end,
                method: "elapsed-time",
                rawCredit: converted.value,
                creditAfterBreaks: converted.value,
                creditAfterProration: credit,
                ruleRef,
            });
            total = (0, decimal_1.decAdd)(total, credit);
            totalRational = addRationals(totalRational, creditRational);
        }
        else {
            // Hours-based: one credit per computation period.
            for (const hp of p.hoursByComputationPeriod) {
                const hpStart = (0, dates_1.validateDateString)(hp.periodStart);
                const hpEnd = (0, dates_1.validateDateString)(hp.periodEnd);
                if (cutoff !== null && (0, dates_1.daysSinceEpoch)(hpStart) > (0, dates_1.daysSinceEpoch)(cutoff)) {
                    continue; // computation period entirely after the freeze
                }
                if (cutoff !== null && (0, dates_1.daysSinceEpoch)(hpEnd) > (0, dates_1.daysSinceEpoch)(cutoff)) {
                    // A computation period straddling the freeze date is a partial
                    // period; with no plan partial-period rule (O-D-3) it is an
                    // open item, not a pro-rata assumption.
                    missingInputs.push(`partialComputationPeriod:${hp.periodStart}`);
                    continue;
                }
                if ((0, dates_1.daysSinceEpoch)(hpEnd) > (0, dates_1.daysSinceEpoch)(validAsOf)) {
                    // A computation period straddling the measurement date is a
                    // partial period; with no plan partial-period rule (O-D-3) it
                    // is an open item, not a pro-rata assumption.
                    if ((0, dates_1.daysSinceEpoch)(hpStart) <= (0, dates_1.daysSinceEpoch)(validAsOf)) {
                        missingInputs.push(`partialComputationPeriod:${hp.periodStart}`);
                    }
                    continue;
                }
                if (hp.hours === null) {
                    missingInputs.push(`hours:${hp.periodStart}`);
                    continue;
                }
                const got = hoursPeriodCredit(hp.hours, def, def.fullYearHours);
                if (got === null) {
                    missingInputs.push("fractionalConversion");
                    continue;
                }
                // Leave hours prevent a break only; they never earn credit.
                traces.push({
                    periodStart: hpStart,
                    periodEnd: hpEnd,
                    method: "hours-based",
                    rawCredit: got.credit,
                    creditAfterBreaks: got.credit,
                    creditAfterProration: got.credit,
                    ruleRef: def.hoursBands !== null ? "hours bands (plan §)" : "hours-based full-year threshold",
                });
                total = (0, decimal_1.decAdd)(total, got.credit);
                totalRational = addRationals(totalRational, got.rational);
            }
        }
    }
    // Documented past-service / predecessor credits (plan facts with citation).
    for (const extra of [def.pastServiceCredit, def.predecessorServiceCredit]) {
        if (extra !== null) {
            total = (0, decimal_1.decAdd)(total, extra.creditYears);
            totalRational = addRationals(totalRational, decimalStringToRational(extra.creditYears));
            traces.push({
                periodStart: validAsOf,
                periodEnd: validAsOf,
                method: "elapsed-time",
                rawCredit: extra.creditYears,
                creditAfterBreaks: extra.creditYears,
                creditAfterProration: extra.creditYears,
                ruleRef: extra.ruleRef,
            });
        }
    }
    if (missingInputs.length > 0) {
        return { value: null, rational: null, periods: traces, missingInputs, roundingApplied };
    }
    return {
        value: total,
        rational: totalRational,
        periods: traces,
        missingInputs: [],
        roundingApplied,
    };
}
// ---------------------------------------------------------------------------
// F-S-02 — vesting service
// ---------------------------------------------------------------------------
/**
 * Vesting service through `asOf` (Stage 3 §2.3). Whole years only.
 * Hours-based: one year per computation period at or above the plan's
 * threshold. Elapsed-time: aggregate all periods of service, convert
 * with the 30-day month / 365-day year deeming rule, take the integer
 * portion and disregard the remainder ([DBAB-7] Q 7:38: 1,400 days →
 * 3 years). Service-spanning gaps under 12 months are credited (§2.2).
 * Pre-age-18 service is excluded where the plan says so (dated
 * comparison via addYears, never assumed from the total).
 */
function computeVestingService(periods, asOf, def, dob = null) {
    const validAsOf = (0, dates_1.validateDateString)(asOf);
    if (def.vestingMethod === null) {
        return emptyServiceResult(["vestingMethod"]);
    }
    const cutoff = freezeCutoff(def, "vesting");
    const vestingThreshold = def.vestingFullYearHours ?? def.fullYearHours;
    const traces = [];
    const missingInputs = [];
    const roundingApplied = [];
    if (def.vestingExcludesPreAge18 && dob === null) {
        return emptyServiceResult(["dob"]);
    }
    if (def.vestingMethod === "hours-based") {
        if (vestingThreshold === null)
            return emptyServiceResult(["vestingFullYearHours"]);
        let total = 0;
        for (const p of periods) {
            for (const hp of p.hoursByComputationPeriod) {
                const hpStart = (0, dates_1.validateDateString)(hp.periodStart);
                const hpEnd = (0, dates_1.validateDateString)(hp.periodEnd);
                if (cutoff !== null && (0, dates_1.daysSinceEpoch)(hpStart) > (0, dates_1.daysSinceEpoch)(cutoff)) {
                    continue; // computation period entirely after the freeze
                }
                if (cutoff !== null && (0, dates_1.daysSinceEpoch)(hpEnd) > (0, dates_1.daysSinceEpoch)(cutoff)) {
                    missingInputs.push(`partialComputationPeriod:${hp.periodStart}`);
                    continue;
                }
                if ((0, dates_1.daysSinceEpoch)(hpEnd) > (0, dates_1.daysSinceEpoch)(validAsOf)) {
                    if ((0, dates_1.daysSinceEpoch)(hpStart) <= (0, dates_1.daysSinceEpoch)(validAsOf)) {
                        missingInputs.push(`partialComputationPeriod:${hp.periodStart}`);
                    }
                    continue;
                }
                if (hp.hours === null) {
                    missingInputs.push(`hours:${hp.periodStart}`);
                    continue;
                }
                // Leave hours (≤501) keep the period from being a break year,
                // but they never earn the year: the credit uses actual hours only.
                const credit = (0, decimal_1.decCompare)(hp.hours, vestingThreshold) >= 0 ? "1" : "0";
                traces.push({
                    periodStart: hpStart,
                    periodEnd: hpEnd,
                    method: "hours-based",
                    rawCredit: credit,
                    creditAfterBreaks: credit,
                    creditAfterProration: credit,
                    ruleRef: "vesting whole-year rule",
                });
                total += Number(credit);
            }
        }
        if (missingInputs.length > 0) {
            return { value: null, rational: null, periods: traces, missingInputs, roundingApplied };
        }
        return {
            value: String(total),
            rational: { numerator: BigInt(total), denominator: 1n },
            periods: traces,
            missingInputs: [],
            roundingApplied,
        };
    }
    // Elapsed-time: aggregate periods (breaks per the vesting break rule),
    // span gaps under 12 months, convert days/365, integer portion only.
    const breakResult = applyBreaks(periods, validAsOf, def.breakRule.vesting, null);
    const keptStarts = new Set(breakResult.periods.map((t) => t.periodStart));
    const working = [...periods]
        .sort((a, b) => (0, dates_1.daysSinceEpoch)(a.periodStart) - (0, dates_1.daysSinceEpoch)(b.periodStart))
        .filter((p) => keptStarts.has(p.periodStart));
    let totalDays = 0;
    let prevEnd = null;
    const age18Date = dob !== null && def.vestingExcludesPreAge18 ? (0, dates_1.addYears)(dob, 18) : null;
    for (const p of working) {
        let start = (0, dates_1.validateDateString)(p.periodStart);
        if (age18Date !== null && (0, dates_1.daysSinceEpoch)(start) < (0, dates_1.daysSinceEpoch)(age18Date)) {
            start = age18Date;
        }
        const end = clippedEnd(p.periodEnd, validAsOf, cutoff);
        if ((0, dates_1.daysSinceEpoch)(end) < (0, dates_1.daysSinceEpoch)(start))
            continue;
        totalDays += (0, dates_1.daysBetween)(start, end);
        if (prevEnd !== null && (0, dates_1.daysSinceEpoch)(start) > (0, dates_1.daysSinceEpoch)(prevEnd)) {
            const gap = (0, dates_1.completedYMD)(prevEnd, start);
            if (gap.years === 0 && gap.months < 12) {
                totalDays += (0, dates_1.daysBetween)(prevEnd, start); // service-spanning
            }
        }
        if (prevEnd === null || (0, dates_1.daysSinceEpoch)(end) > (0, dates_1.daysSinceEpoch)(prevEnd))
            prevEnd = end;
        traces.push({
            periodStart: start,
            periodEnd: end,
            method: "elapsed-time",
            rawCredit: String((0, dates_1.daysBetween)(start, end)),
            creditAfterBreaks: String((0, dates_1.daysBetween)(start, end)),
            creditAfterProration: String((0, dates_1.daysBetween)(start, end)),
            ruleRef: "elapsed-time vesting aggregation (30-day month / 365-day year)",
        });
    }
    const years = Math.floor(totalDays / 365);
    if (totalDays > 0) {
        roundingApplied.push({
            rule: "vesting integer truncation ([DBAB-7] Q 7:38): only the integer portion counts",
            before: (0, decimal_1.decDivide)(String(totalDays), "365", 10),
            after: String(years),
        });
    }
    return {
        value: String(years),
        rational: { numerator: BigInt(years), denominator: 1n },
        periods: traces,
        missingInputs: [],
        roundingApplied,
    };
}
// ---------------------------------------------------------------------------
// F-S-03 — eligibility service
// ---------------------------------------------------------------------------
/**
 * Eligibility service through `asOf` (Stage 3 §2.3). Whole years only.
 * Hours-based: one year per Eligibility Computation Period at or above
 * the plan's threshold; the initial period is measured from the first
 * Hour of Service, later periods by Plan Year (St. Rose §3.1(b)).
 * Elapsed-time: one year per 12 months from employment commencement,
 * periods aggregated, 30 days deemed a month, 365 days deemed a year.
 * Eligibility service decides the participation date; it does not enter
 * the benefit formula.
 */
function computeEligibilityService(periods, asOf, def) {
    const validAsOf = (0, dates_1.validateDateString)(asOf);
    if (def.eligibilityMethod === null) {
        return emptyServiceResult(["eligibilityMethod"]);
    }
    const cutoff = freezeCutoff(def, "eligibility");
    const threshold = def.eligibilityFullYearHours ?? def.fullYearHours;
    const traces = [];
    const missingInputs = [];
    if (def.eligibilityMethod === "hours-based") {
        if (threshold === null)
            return emptyServiceResult(["eligibilityFullYearHours"]);
        let total = 0;
        for (const p of periods) {
            for (const hp of p.hoursByComputationPeriod) {
                const hpStart = (0, dates_1.validateDateString)(hp.periodStart);
                const hpEnd = (0, dates_1.validateDateString)(hp.periodEnd);
                if (cutoff !== null && (0, dates_1.daysSinceEpoch)(hpStart) > (0, dates_1.daysSinceEpoch)(cutoff)) {
                    continue; // computation period entirely after the freeze
                }
                if (cutoff !== null && (0, dates_1.daysSinceEpoch)(hpEnd) > (0, dates_1.daysSinceEpoch)(cutoff)) {
                    missingInputs.push(`partialComputationPeriod:${hp.periodStart}`);
                    continue;
                }
                if ((0, dates_1.daysSinceEpoch)(hpEnd) > (0, dates_1.daysSinceEpoch)(validAsOf)) {
                    if ((0, dates_1.daysSinceEpoch)(hpStart) <= (0, dates_1.daysSinceEpoch)(validAsOf)) {
                        missingInputs.push(`partialComputationPeriod:${hp.periodStart}`);
                    }
                    continue;
                }
                if (hp.hours === null) {
                    missingInputs.push(`hours:${hp.periodStart}`);
                    continue;
                }
                const credit = (0, decimal_1.decCompare)(hp.hours, threshold) >= 0 ? "1" : "0";
                traces.push({
                    periodStart: hpStart,
                    periodEnd: hpEnd,
                    method: "hours-based",
                    rawCredit: credit,
                    creditAfterBreaks: credit,
                    creditAfterProration: credit,
                    ruleRef: "eligibility whole-year rule",
                });
                total += Number(credit);
            }
        }
        if (missingInputs.length > 0) {
            return { value: null, rational: null, periods: traces, missingInputs, roundingApplied: [] };
        }
        return {
            value: String(total),
            rational: { numerator: BigInt(total), denominator: 1n },
            periods: traces,
            missingInputs: [],
            roundingApplied: [],
        };
    }
    // Elapsed-time: aggregate periods, 365-day year, integer portion only.
    const breakResult = applyBreaks(periods, validAsOf, def.breakRule.eligibility, null);
    const keptStarts = new Set(breakResult.periods.map((t) => t.periodStart));
    const working = [...periods]
        .sort((a, b) => (0, dates_1.daysSinceEpoch)(a.periodStart) - (0, dates_1.daysSinceEpoch)(b.periodStart))
        .filter((p) => keptStarts.has(p.periodStart));
    let totalDays = 0;
    let prevEnd = null;
    for (const p of working) {
        const start = (0, dates_1.validateDateString)(p.periodStart);
        const end = clippedEnd(p.periodEnd, validAsOf, cutoff);
        if ((0, dates_1.daysSinceEpoch)(end) < (0, dates_1.daysSinceEpoch)(start))
            continue;
        totalDays += (0, dates_1.daysBetween)(start, end);
        if (prevEnd !== null && (0, dates_1.daysSinceEpoch)(start) > (0, dates_1.daysSinceEpoch)(prevEnd)) {
            const gap = (0, dates_1.completedYMD)(prevEnd, start);
            if (gap.years === 0 && gap.months < 12)
                totalDays += (0, dates_1.daysBetween)(prevEnd, start);
        }
        if (prevEnd === null || (0, dates_1.daysSinceEpoch)(end) > (0, dates_1.daysSinceEpoch)(prevEnd))
            prevEnd = end;
        traces.push({
            periodStart: start,
            periodEnd: end,
            method: "elapsed-time",
            rawCredit: String((0, dates_1.daysBetween)(start, end)),
            creditAfterBreaks: String((0, dates_1.daysBetween)(start, end)),
            creditAfterProration: String((0, dates_1.daysBetween)(start, end)),
            ruleRef: "eligibility elapsed-time aggregation",
        });
    }
    const years = Math.floor(totalDays / 365);
    return {
        value: String(years),
        rational: { numerator: BigInt(years), denominator: 1n },
        periods: traces,
        missingInputs: [],
        roundingApplied: [],
    };
}
// ---------------------------------------------------------------------------
// F-S-04 — vesting percent (a table lookup, not a computation from dates)
// ---------------------------------------------------------------------------
/**
 * Vesting percentage VP from whole-years vesting service (Stage 3 §2.3).
 * The dates produce the service years; the schedule produces the
 * percentage — the two steps stay separate in the trace. The lookup
 * consumes WHOLE years only: 9.99 vesting years vests at the 9-year row,
 * never the 10-year row. Special vesting (e.g. 100% on early-retirement
 * or disability termination) is checked first, by exact condition match
 * against `terminationReason`. A missing schedule makes the vested
 * benefit unknown, not zero (I-5): vp is null with
 * missingInputs ["vestingSchedule"].
 */
function vestingPercent(vestingService, def, asOf, terminationReason) {
    void asOf;
    if (vestingService.value === null) {
        return { vp: null, scheduleRow: null, missingInputs: [...vestingService.missingInputs] };
    }
    for (const special of def.specialVesting) {
        if (special.condition === terminationReason) {
            return {
                vp: special.percent,
                scheduleRow: `special vesting: ${special.condition} → ${special.percent} (${special.ruleRef})`,
                missingInputs: [],
            };
        }
    }
    if (def.vestingSchedule === null) {
        return { vp: null, scheduleRow: null, missingInputs: ["vestingSchedule"] };
    }
    // Whole years only: the integer portion of the service value.
    // parseDecimalString gives the scaled integer; bigint division by
    // 10^scale truncates toward zero, which for non-negative service is
    // the whole-years count (9.99 → 9).
    const parsed = (0, decimal_1.parseDecimalString)(vestingService.value);
    const wholeYears = Number(parsed.value / 10n ** BigInt(parsed.scale));
    for (const row of def.vestingSchedule) {
        const atMin = wholeYears >= row.minWholeYears;
        const atMax = row.maxWholeYears === null || wholeYears <= row.maxWholeYears;
        if (atMin && atMax) {
            return {
                vp: row.percent,
                scheduleRow: `${wholeYears} whole years → ${row.percent} (${row.ruleRef})`,
                missingInputs: [],
            };
        }
    }
    return { vp: null, scheduleRow: null, missingInputs: ["vestingSchedule"] };
}
// ---------------------------------------------------------------------------
// F-S-06 — service cap (formula-evaluation time, credited only)
// ---------------------------------------------------------------------------
/**
 * Apply the service cap S_max to credited service (Stage 3 §4.6).
 * The cap truncates the service counted, it is not a rounding; the
 * which-years selection (first-N vs last-N — Blond §5.01 prices the LAST
 * 30 years) changes which years' rates apply at the formula stage, not
 * the capped total, so the capped total is the same either way and the
 * which-years choice is carried in the cap's ruleRef for the formula
 * stage to apply. A null cap, or a null service value, returns the
 * service unchanged. Never applied to vesting or eligibility service.
 */
function applyServiceCap(service, cap, asOf) {
    void asOf;
    if (cap === null || service.value === null)
        return service;
    if ((0, decimal_1.decCompare)(service.value, cap.maxYears) <= 0)
        return service;
    return {
        ...service,
        value: cap.maxYears,
        rational: decimalStringToRational(cap.maxYears),
    };
}
// ---------------------------------------------------------------------------
// F-S-07 — freeze (guard; exact recomputation needs the definition)
// ---------------------------------------------------------------------------
/**
 * Apply a freeze to an already-computed service result (Stage 3 §4.6).
 * The primary enforcement is inside the compute functions, which clip
 * period ends at the freeze cutoff. This function is the guard for a
 * result computed without freeze awareness: periods ending on or before
 * the cutoff are kept whole; periods starting on or after the cutoff
 * contribute nothing; a period STRADDLING the cutoff can only be split
 * exactly with the plan's fractionalConversion, so without `def` the
 * result becomes value null with missingInputs
 * ["applyFreeze:conversion-unknown"] (I-1) rather than a pro-rata guess.
 * A freeze whose scope does not cover the quantity (partial-accrual-only
 * freeze on a vesting result) returns the service unchanged.
 */
function applyFreeze(service, freeze, asOf, def = null, quantity = "credited") {
    void asOf;
    if (freeze === null || service.value === null)
        return service;
    if (freeze.scope === "partial-accrual-only" && quantity !== "credited")
        return service;
    const cutoff = freeze.inclusiveOfFreezeDate
        ? freeze.freezeDate
        : (0, dates_1.dateFromDays)((0, dates_1.daysSinceEpoch)(freeze.freezeDate) - 1);
    let total = "0";
    let totalRational = { numerator: 0n, denominator: 1n };
    const missingInputs = [];
    for (const period of service.periods) {
        if ((0, dates_1.daysSinceEpoch)(period.periodStart) > (0, dates_1.daysSinceEpoch)(cutoff)) {
            continue; // entirely after the freeze: contributes nothing
        }
        if ((0, dates_1.daysSinceEpoch)(period.periodEnd) <= (0, dates_1.daysSinceEpoch)(cutoff)) {
            total = (0, decimal_1.decAdd)(total, period.creditAfterProration);
            // The rational is not tracked across re-summation from traces.
            totalRational = null;
            continue;
        }
        // Straddling period: exact split needs the plan's conversion rule.
        if (def === null || def.fractionalConversion === null) {
            missingInputs.push("applyFreeze:conversion-unknown");
            continue;
        }
        if (period.method === "hours-based") {
            missingInputs.push("applyFreeze:partial-computation-period");
            continue;
        }
        const ymd = (0, dates_1.completedYMD)(period.periodStart, cutoff);
        const converted = convertYMD(ymd, def.fractionalConversion, period.periodStart, cutoff);
        if (converted === null) {
            missingInputs.push("applyFreeze:conversion-unknown");
            continue;
        }
        total = (0, decimal_1.decAdd)(total, converted.value);
        totalRational = addRationals(totalRational, converted.rational);
    }
    if (missingInputs.length > 0) {
        return { ...service, value: null, rational: null, missingInputs };
    }
    return { ...service, value: total, rational: totalRational };
}
// ---------------------------------------------------------------------------
// F-S-08 — split service by plan version
// ---------------------------------------------------------------------------
/**
 * Split a service result across plan versions by effective date
 * (Stage 3 §4.5, §5.3). A period wholly inside one version goes to that
 * version; a period straddling a boundary is split at the boundary using
 * the plan's fractionalConversion (from `def`). Without `def`, a
 * straddling period cannot be split exactly and the function THROWS
 * rather than guessing the split; with a null effective date in the
 * boundaries it also throws (I-4: the era boundary is unknown, so the
 * service is bounded over the candidate boundaries by the caller, never
 * split on a guessed date). Boundaries must be sorted by effectiveDate
 * ascending; the first version governs from its effective date.
 */
function splitServiceByVersion(service, boundaries, asOf, def = null) {
    void asOf;
    if (boundaries.length === 0) {
        throw new Error("splitServiceByVersion: no plan versions supplied");
    }
    for (const b of boundaries) {
        if (b.effectiveDate === null) {
            throw new Error(`splitServiceByVersion: amendment effective date missing for version ${b.planVersionId} ` +
                `(I-4) — the era boundary is unknown; bound the service over the candidate boundaries instead`);
        }
    }
    const sorted = [...boundaries].sort((a, b) => (0, dates_1.daysSinceEpoch)(a.effectiveDate) - (0, dates_1.daysSinceEpoch)(b.effectiveDate));
    const totals = new Map();
    for (const b of sorted)
        totals.set(b.planVersionId, "0");
    const versionAt = (date) => {
        let current = sorted[0];
        for (const b of sorted) {
            if ((0, dates_1.daysSinceEpoch)(b.effectiveDate) <= (0, dates_1.daysSinceEpoch)(date))
                current = b;
            else
                break;
        }
        return current.planVersionId;
    };
    for (const period of service.periods) {
        if (period.method === "hours-based") {
            // Hours credits belong to the version in force at the period start;
            // a computation period straddling a boundary needs the plan's
            // partial-period rule (O-D-3) and is refused here.
            const versionId = versionAt(period.periodStart);
            totals.set(versionId, (0, decimal_1.decAdd)(totals.get(versionId), period.creditAfterProration));
            continue;
        }
        // Elapsed-time period: split at every boundary inside (start, end].
        const cuts = [period.periodStart];
        for (const b of sorted) {
            const eff = b.effectiveDate;
            if ((0, dates_1.daysSinceEpoch)(eff) > (0, dates_1.daysSinceEpoch)(period.periodStart) &&
                (0, dates_1.daysSinceEpoch)(eff) <= (0, dates_1.daysSinceEpoch)(period.periodEnd)) {
                cuts.push(eff);
            }
        }
        cuts.push((0, dates_1.dateFromDays)((0, dates_1.daysSinceEpoch)(period.periodEnd) + 1)); // sentinel: end-exclusive
        for (let i = 0; i < cuts.length - 1; i += 1) {
            const segStart = cuts[i];
            const segEndExclusive = cuts[i + 1];
            const segEnd = (0, dates_1.dateFromDays)((0, dates_1.daysSinceEpoch)(segEndExclusive) - 1);
            if ((0, dates_1.daysSinceEpoch)(segEnd) < (0, dates_1.daysSinceEpoch)(segStart))
                continue;
            const versionId = versionAt(segStart);
            if (segStart === period.periodStart && segEnd === period.periodEnd) {
                totals.set(versionId, (0, decimal_1.decAdd)(totals.get(versionId), period.creditAfterProration));
                continue;
            }
            if (def === null || def.fractionalConversion === null) {
                throw new Error("splitServiceByVersion: a period straddles a version boundary and no " +
                    "ServiceDefinition was supplied to split it exactly — refusing, not guessing");
            }
            const ymd = (0, dates_1.completedYMD)(segStart, segEnd);
            const converted = convertYMD(ymd, def.fractionalConversion, segStart, segEnd);
            if (converted === null) {
                throw new Error("splitServiceByVersion: the plan's fractionalConversion cannot convert a split segment");
            }
            totals.set(versionId, (0, decimal_1.decAdd)(totals.get(versionId), converted.value));
        }
    }
    return sorted.map((b) => ({
        planVersionId: b.planVersionId,
        service: totals.get(b.planVersionId),
    }));
}
// ---------------------------------------------------------------------------
// F-S-09 — normal retirement date
// ---------------------------------------------------------------------------
/**
 * Normal retirement date: DOB + NRA under the plan's NRD rule
 * (Stage 3 §3.3). Returns null when the rule is missing (nrdRule null),
 * when NRA is not a whole number of months, or when a leap-day birthday
 * in a non-leap target year has no established convention (D-1.5).
 * The boundary movement is traced by the rule kind: "birthday" (the
 * 65th birthday itself), "first-of-month-coincident-or-next" (Blond
 * §5.02 shape), "first-of-plan-year-after" (Jan 1 of the following year).
 */
function normalRetirementDate(dob, nra, def) {
    const birth = (0, dates_1.validateDateString)(dob);
    if (def.nrdRule === null)
        return null;
    // NRA must convert to a whole number of months (65 → 780; 65.5 → 786).
    const nraParsed = (0, decimal_1.parseDecimalString)(nra);
    const monthsScaled = nraParsed.value * 12n;
    const monthsDenominator = 10n ** BigInt(nraParsed.scale);
    if (monthsScaled % monthsDenominator !== 0n)
        return null;
    const months = Number(monthsScaled / monthsDenominator);
    const { month: birthMonth, day: birthDay } = {
        month: Number(birth.slice(5, 7)),
        day: Number(birth.slice(8, 10)),
    };
    // addMonths handles the year/month arithmetic; the leap-day birthday
    // itself is resolved through birthdayInYear so a null convention refuses.
    const added = (0, dates_1.addMonths)(birth, months);
    const addedParts = { year: Number(added.slice(0, 4)) };
    if (birthMonth === 2 && birthDay === 29 && !isLeapYearCheck(addedParts.year)) {
        const birthday = (0, dates_1.birthdayInYear)(birth, addedParts.year, def.leapDayBirthday);
        if (birthday === null)
            return null;
        return applyNrdBoundary(birthday, def);
    }
    return applyNrdBoundary(added, def);
}
function isLeapYearCheck(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
function applyNrdBoundary(birthday, def) {
    const rule = def.nrdRule;
    if (rule === null)
        return null;
    switch (rule.kind) {
        case "birthday":
            return birthday;
        case "first-of-month-coincident-or-next":
            return (0, dates_1.firstOfMonthCoincidentOrNext)(birthday);
        case "first-of-plan-year-after":
            return (0, dates_1.nextYearStart)(birthday);
        default:
            // A rule kind this module does not know is refused, not defaulted.
            return null;
    }
}
// ---------------------------------------------------------------------------
// F-S-10 — service at any date (the dated-measure wrapper)
// ---------------------------------------------------------------------------
/**
 * Service through any date (Stage 3 §4.4): the dated-measure wrapper.
 * Service is a dated measure, not a single number — CSPA/CS are service
 * *at DOTE*; reconstruction at any other date needs service *through*
 * that date, computed from the employment-period timeline.
 * `date: null` (DOTE null, rule D-4.2) returns all three quantities
 * unresolved (value null, missingInputs ["measurementDate"]); no Δ is
 * computed from an unresolved measurement date.
 */
function serviceAtDate(periods, date, def, dob = null, vestingStatus = null) {
    if (date === null) {
        const unresolved = (field) => ({
            value: null,
            rational: null,
            periods: [],
            missingInputs: ["measurementDate", field],
            roundingApplied: [],
        });
        return {
            credited: unresolved("creditedMethod"),
            vesting: unresolved("vestingMethod"),
            eligibility: unresolved("eligibilityMethod"),
        };
    }
    return {
        credited: computeCreditedService(periods, date, def, vestingStatus),
        vesting: computeVestingService(periods, date, def, dob),
        eligibility: computeEligibilityService(periods, date, def),
    };
}
