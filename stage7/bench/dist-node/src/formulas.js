"use strict";
/**
 * The 34 formula operations — Stage 4 (Wave 2).
 *
 * Stage 2 output 04 §11 catalog (T-01–T-09, I-01–I-05, C-01–C-07,
 * S-01–S-08, X-01–X-05), each as a typed function returning
 * `CalcResult<TypedBenefitQuantity>` = exact | bound | scenarios |
 * indeterminate, each with its spec items (inputs/units, predicates,
 * effective dates, rounding, citations) and its "If inexact" line.
 *
 * A formula that cannot be evaluated returns `indeterminate`, never a
 * made-up exact number and never a silent failure. A formula whose
 * applicability predicate fails is refused: the indeterminate result names
 * the predicate in `missingInputs` with the prefix `predicate:` and the
 * resolution in `wouldResolve` — the pipeline maps that to a rule-refused
 * stage failure (Stage 2 output 04 §1.3 rule F-2).
 *
 * Money: integer minor units (types.ts). All arithmetic is exact-decimal
 * via src/decimal.ts; division is carried at scale 10 (Stage 2 output 04
 * §3.1 rule R-2). Annual benefits convert to monthly by ÷12 unless the
 * plan states otherwise. A formula returns its result in its natural
 * periodicity (annual for compensation-based formulas, monthly for
 * dollar-based ones); the pipeline's Stage 9 performs the basis conversion.
 *
 * Money representation note: `Money` is integer minor units, so a monthly
 * value with fractional cents cannot be stored exactly. Where an exact
 * monthly value has fractional cents, the Money amount is the half-up
 * cents representation of the exact value when the plan-stated rounding
 * mode is "none" (no rounding rule is assumed — Stage 2 output 04 §11.1
 * design decision 5); when a mode is stated it is applied. The pipeline
 * retains exact decimals in its trace; these functions return the Money
 * the type requires.
 *
 * Anti-decrease guardrails (Stage 1 §3.3; IRC §411(b)(1)(G), §411(d)(6),
 * §411(a)(9)) are post-condition checks: a computed negative benefit is
 * refused as indeterminate with the violation named. Cross-date guardrail
 * comparison (prior vs current benefit) lives in compose.ts
 * (`checkAntiDecrease`), where both values are available.
 *
 * The statutory accrual tests (3%, 133⅓%, fractional) are compliance
 * checks in src/accrualTests.ts — NOT formula operations here. The one
 * exception is T-08, which refuses a band structure that violates the
 * 133⅓% rule outright, because such a structure is not a valid qualified
 * formula (DBAB Q 9:12, Ex. 2).
 *
 * Tables not embedded (Stage 2 output 04 §11.9 decision 1): covered-
 * compensation tables, §415 / §401(a)(17) tables after 2023, and federal
 * midterm rates are taken as loaded, versioned table parameters. Until a
 * table is loaded, any function depending on it returns `indeterminate` —
 * never a neighbouring year's value.
 *
 * Pure functions only. No clock, no storage, no network, no randomness.
 * Synthetic test examples are in test/formulas.test.ts.
 *
 * ADAPTER NOTE (Wave 3): the S-08 whole-years-between helper now uses
 * the real src/dates.ts `completedYMD` (calendar years, never days/365).
 * The formula-level rounding helpers (`roundOutputValue`, `moneyOf`)
 * remain local: they map a formula `RoundingSpec` (mode only) to
 * decRound, while src/rounding.ts `applyMoneyRounding` needs a full
 * `RoundingRule` (target/unit/mode/stage/source) that formulas do not
 * carry — constructing one would invent a rule. Both call the same
 * decRound primitive on the same values.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeBenefitQuantity = exports.applyMonthlyLimit = void 0;
exports.scenarioTraceStep = scenarioTraceStep;
exports.namedScenario = namedScenario;
exports.datedValue = datedValue;
exports.roundOutputValue = roundOutputValue;
exports.moneyOf = moneyOf;
exports.makeBenefit = makeBenefit;
exports.annualToMonthlyDecimal = annualToMonthlyDecimal;
exports.monthlyMoneyOfAnnual = monthlyMoneyOfAnnual;
exports.calcFlatDollar = calcFlatDollar;
exports.calcFixedPercentage = calcFixedPercentage;
exports.calcDollarPerYear = calcDollarPerYear;
exports.calcUnitCredit = calcUnitCredit;
exports.calcCareerAverage = calcCareerAverage;
exports.calcFinalOrHighestAverage = calcFinalOrHighestAverage;
exports.calcFractionalAccrual = calcFractionalAccrual;
exports.calcStepRate = calcStepRate;
exports.calcServiceCapped = calcServiceCapped;
exports.calcExcessBenefit = calcExcessBenefit;
exports.calcCoveredCompIntegration = calcCoveredCompIntegration;
exports.calcPermittedDisparity = calcPermittedDisparity;
exports.calcPiaOffset = calcPiaOffset;
exports.calcPlanOffset = calcPlanOffset;
exports.calcGreaterOf = calcGreaterOf;
exports.calcLesserOf = calcLesserOf;
exports.calcMinimumBenefit = calcMinimumBenefit;
exports.calcGrandfathered = calcGrandfathered;
exports.calcFreshStart = calcFreshStart;
exports.calcMultiplePeriods = calcMultiplePeriods;
exports.calcGroupSpecific = calcGroupSpecific;
exports.calcCashBalance = calcCashBalance;
exports.pensionEquityLumpSum = pensionEquityLumpSum;
exports.calcPensionEquity = calcPensionEquity;
exports.calcOtherHybrid = calcOtherHybrid;
exports.calcContributory = calcContributory;
exports.calcEmployeeContributionBenefit = calcEmployeeContributionBenefit;
exports.calcFrozen = calcFrozen;
exports.calcPastServiceCredit = calcPastServiceCredit;
exports.calcRehireRestoration = calcRehireRestoration;
exports.applySection415Limit = applySection415Limit;
exports.capCompensationYear = capCompensationYear;
exports.convertFormAndAge = convertFormAndAge;
exports.calcPostNra = calcPostNra;
exports.applyVesting = applyVesting;
exports.evaluateFormulaCall = evaluateFormulaCall;
const decimal_1 = require("./decimal");
const compose_1 = require("./compose");
Object.defineProperty(exports, "applyMonthlyLimit", { enumerable: true, get: function () { return compose_1.applyLimit; } });
Object.defineProperty(exports, "normalizeBenefitQuantity", { enumerable: true, get: function () { return compose_1.normalizeBenefit; } });
const dates_1 = require("./dates");
// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
/** The 34 formula ids. */
/**
 * Per-scenario derivation trace (Stage 5 fix for the Stage 4.5 gap: the
 * List-effect gap — formula-level scenario evaluation carried no trace).
 *
 * One step per scenario: the scenario's distinguishing assumption inputs,
 * the computed benefit (integer minor units, or null when the scenario
 * value carries no amount), and the rule with its citation. The step is
 * numbered 1: it is the first step of this scenario's own derivation,
 * not a continuation of the pipeline trace — the pipeline trace up to
 * Stage 5 is shared by all scenarios and is not per-scenario provenance.
 * Evidence grade is "estimate": a scenario is an estimate by
 * construction (CalcResult "scenarios" carries evidenceGrade "estimate").
 *
 * Where a trace genuinely cannot be produced, the caller leaves `trace`
 * null/undefined on the NamedScenario — never a fabricated step. The
 * `namedScenario` helper below is the only place a formula-level trace
 * is built; every scenario-producing function below uses it.
 */
function scenarioTraceStep(args) {
    const step = {
        step: 1,
        name: `scenario-${args.formulaId}`,
        inputs: [{ field: "scenario", value: args.scenarioName }, ...args.inputs],
        output: args.outputMinor,
        ruleRef: args.ruleRef,
        evidenceGrade: "estimate",
        assumption: args.scenarioName,
    };
    return [step];
}
/** Build one NamedScenario with its per-scenario derivation trace
 *  attached (spec §1.6; Stage 4.5 fix). `inputs` are the scenario's
 *  distinguishing assumption inputs — the values that differ from the
 *  other scenarios of the same formula (e.g. the candidate full service,
 *  the averaging period, the disparity method). Shared inputs live in
 *  the pipeline trace and are not repeated here. */
function namedScenario(args) {
    return {
        name: args.name,
        value: args.value,
        basis: args.basis,
        trace: scenarioTraceStep({
            formulaId: args.formulaId,
            scenarioName: args.name,
            inputs: args.inputs,
            outputMinor: args.value.amount === null ? null : args.value.amount.amountMinor,
            ruleRef: args.ruleRef,
        }),
    };
}
/** Build a DatedValue for tests and callers. */
function datedValue(value, effectiveFrom, planVersionId) {
    return { value, effectiveFrom, planVersionId };
}
/** Apply the plan-stated rounding mode to an exact decimal value. */
function roundOutputValue(rounding, value) {
    switch (rounding.mode) {
        case "nearest-cent":
            return (0, decimal_1.decRound)(value, "0.01", "half-up");
        case "nearest-dollar":
            return (0, decimal_1.decRound)(value, "1", "half-up");
        case "truncate":
            return (0, decimal_1.decRound)(value, "0.01", "down");
        case "none":
            return value;
    }
}
/**
 * Convert an exact decimal dollar value to Money. The value is first
 * rounded per the plan-stated mode; if it still has fractional cents
 * (mode "none"), the half-up cents representation is used — see the module
 * header note. Never throws on a fractional-cent value.
 */
function moneyOf(rounding, value) {
    const rounded = roundOutputValue(rounding, value);
    try {
        return (0, decimal_1.moneyFromDecimalString)(rounded);
    }
    catch {
        return (0, decimal_1.moneyFromDecimalString)((0, decimal_1.decRound)(rounded, "0.01", "half-up"));
    }
}
/** Build the TypedBenefitQuantity for a computed amount. */
function makeBenefit(ctx, amount, periodicity, basis, source = "independent-calculation") {
    return {
        amount,
        periodicity,
        measurementDate: ctx.measurementDate,
        measurementBasis: basis?.measurementBasis ?? "unresolved",
        basisNote: basis?.basisNote ?? null,
        commencementBasis: basis?.commencementBasis ?? null,
        retirementAge: basis?.retirementAge ?? null,
        retirementDate: null,
        annuityForm: basis?.annuityForm ?? "unknown",
        vestingTreatment: basis?.vestingTreatment ?? "gross",
        planVersionId: ctx.planVersionId,
        formulaId: null,
        source,
        status: "calculated",
        ownerId: basis?.ownerId ?? `calc-${ctx.planVersionId}-${ctx.measurementDate}`,
    };
}
function exactResult(ctx, amount, periodicity, basis, evidenceGrade = "fact") {
    return {
        kind: "exact",
        value: makeBenefit(ctx, amount, periodicity, basis),
        evidenceGrade,
    };
}
function indeterminate(missingInputs, wouldResolve) {
    return { kind: "indeterminate", evidenceGrade: "unknown", missingInputs, wouldResolve };
}
/** Refuse a formula whose applicability predicate fails (rule F-2). */
function refused(predicate) {
    return indeterminate([`predicate:${predicate}`], [`${predicate} — the formula does not apply to this participant`]);
}
/** Refuse a computed negative benefit (anti-decrease guardrail). */
function negativeRefused(value, formulaId) {
    return indeterminate([`computed benefit is negative ($${value}) — anti-decrease guardrail IRC §411(b)(1)(G)`], [`a non-negative benefit under ${formulaId}`]);
}
/** True when a DecimalString is a usable non-negative number. */
function isNonNegativeDecimal(value) {
    if (value === null || value === undefined)
        return false;
    try {
        return (0, decimal_1.decCompare)(value, "0") >= 0;
    }
    catch {
        return false;
    }
}
/** Exact annual dollars → monthly dollars (÷12 at scale 10). */
function annualToMonthlyDecimal(annual) {
    return (0, decimal_1.decDivide)(annual, "12", 10);
}
/** Monthly Money from an exact annual decimal, via the plan rounding. */
function monthlyMoneyOfAnnual(rounding, annual) {
    return moneyOf(rounding, annualToMonthlyDecimal(annual));
}
/**
 * T-01 — Flat-dollar benefit. B_t = D × (S_t / S_full); if the plan states
 * no service reduction, B_t = D. Monthly. DBAB Q 9:3; Q 9:7;
 * IRC §411(a)(7)(A)(i). S_t ≥ S_full ⇒ full D.
 */
function calcFlatDollar(ctx, p) {
    if (!isNonNegativeDecimal(p.flatAmount.value)
        || !isNonNegativeDecimal(p.service)
        || !isNonNegativeDecimal(p.fullService)) {
        return indeterminate(["flat amount, service, and full service must be non-negative decimals"], ["non-negative values for D, S_t, and S_full"]);
    }
    if ((0, decimal_1.decCompare)(p.fullService, "0") === 0 && p.noServiceReduction !== true) {
        return indeterminate(["full service S_full is zero"], ["the service required for the unreduced flat benefit"]);
    }
    if (p.flatAmountCandidates !== undefined && p.flatAmountCandidates.length > 0) {
        const fraction = p.noServiceReduction === true
            ? "1"
            : (0, decimal_1.decDivide)((0, decimal_1.decCompare)(p.service, p.fullService) >= 0 ? p.fullService : p.service, p.fullService, 10);
        const amounts = p.flatAmountCandidates.map((c) => moneyOf(ctx.rounding, (0, decimal_1.decMultiply)(c.value, fraction)));
        const minors = amounts.map((m) => m.amountMinor);
        const min = Math.min(...minors);
        const max = Math.max(...minors);
        return {
            kind: "bound",
            min: makeBenefit(ctx, (0, decimal_1.makeMoney)(min), "monthly", p.basis, "bound"),
            max: makeBenefit(ctx, (0, decimal_1.makeMoney)(max), "monthly", p.basis, "bound"),
            evidenceGrade: "estimate",
            missingInputs: ["flat amount D at the measurement date"],
        };
    }
    if (p.fullServiceCandidates !== undefined && p.fullServiceCandidates.length > 0) {
        return {
            kind: "scenarios",
            scenarios: p.fullServiceCandidates.map((sFull) => namedScenario({
                name: `full service ${sFull} years`,
                value: makeBenefit(ctx, moneyOf(ctx.rounding, p.noServiceReduction === true
                    ? p.flatAmount.value
                    : (0, decimal_1.decMultiply)(p.flatAmount.value, (0, decimal_1.decDivide)((0, decimal_1.decCompare)(p.service, sFull) >= 0 ? sFull : p.service, sFull, 10))), "monthly", p.basis, "scenario"),
                basis: `S_full = ${sFull}`,
                formulaId: "T-01",
                inputs: [
                    { field: "fullService", value: sFull },
                    { field: "service", value: p.service },
                    { field: "flatAmount", value: p.flatAmount.value },
                ],
                ruleRef: "T-01 flat-dollar benefit (DBAB Q 9:3; Q 9:7; IRC §411(a)(7)(A)(i))",
            })),
            evidenceGrade: "estimate",
            missingInputs: ["full service S_full"],
        };
    }
    const fraction = p.noServiceReduction === true
        ? "1"
        : (0, decimal_1.decDivide)((0, decimal_1.decCompare)(p.service, p.fullService) >= 0 ? p.fullService : p.service, p.fullService, 10);
    const benefit = (0, decimal_1.decMultiply)(p.flatAmount.value, fraction);
    if ((0, decimal_1.decCompare)(benefit, "0") < 0)
        return negativeRefused(benefit, "T-01");
    return exactResult(ctx, moneyOf(ctx.rounding, benefit), "monthly", p.basis);
}
/**
 * T-02 — Fixed-percentage-of-compensation benefit.
 * B_t = p × C̄_t × (S_t / S_full), annual; ÷12 monthly.
 * DBAB Q 9:3, Ex. 2; Q 9:37–9:45; IRC §414(s), §401(a)(17).
 */
function calcFixedPercentage(ctx, p) {
    if (!isNonNegativeDecimal(p.percent.value)
        || !isNonNegativeDecimal(p.avgComp)
        || !isNonNegativeDecimal(p.service)
        || !isNonNegativeDecimal(p.fullService)) {
        return indeterminate(["percent, average compensation, service, and full service must be non-negative decimals"], ["non-negative values for p, C̄_t, S_t, and S_full"]);
    }
    if ((0, decimal_1.decCompare)(p.fullService, "0") === 0) {
        return indeterminate(["full service S_full is zero"], ["the service required for the unreduced benefit"]);
    }
    if (p.avgCompCandidates !== undefined && p.avgCompCandidates.length > 0) {
        const fraction = (0, decimal_1.decDivide)((0, decimal_1.decCompare)(p.service, p.fullService) >= 0 ? p.fullService : p.service, p.fullService, 10);
        return {
            kind: "scenarios",
            scenarios: p.avgCompCandidates.map((c) => namedScenario({
                name: `averaging period ${c.period}`,
                value: makeBenefit(ctx, monthlyMoneyOfAnnual(ctx.rounding, (0, decimal_1.decMultiply)((0, decimal_1.decMultiply)(p.percent.value, c.avgComp), fraction)), "monthly", p.basis, "scenario"),
                basis: c.period,
                formulaId: "T-02",
                inputs: [
                    { field: "averagingPeriod", value: c.period },
                    { field: "avgComp", value: c.avgComp },
                    { field: "percent", value: p.percent.value },
                    { field: "service", value: p.service },
                ],
                ruleRef: "T-02 fixed-percentage benefit (DBAB Q 9:4)",
            })),
            evidenceGrade: "estimate",
            missingInputs: ["averaging period"],
        };
    }
    const fraction = (0, decimal_1.decDivide)((0, decimal_1.decCompare)(p.service, p.fullService) >= 0 ? p.fullService : p.service, p.fullService, 10);
    const annual = (0, decimal_1.decMultiply)((0, decimal_1.decMultiply)(p.percent.value, p.avgComp), fraction);
    if ((0, decimal_1.decCompare)(annual, "0") < 0)
        return negativeRefused(annual, "T-02");
    return exactResult(ctx, monthlyMoneyOfAnnual(ctx.rounding, annual), "monthly", p.basis);
}
/**
 * T-03 — Dollar-per-year-of-service benefit. B_t = d × S_t; with period
 * rates, B_t = Σ_p d_p × S_{t,p}. Monthly. The most common formula in PBGC
 * trusteed plans ("Accrued monthly benefit = YOS × benefit rate").
 * DBAB Q 9:4, Ex. 2; Q 9:10, Ex. 2; PBGC current policies Ex. 17.
 */
function calcDollarPerYear(ctx, p) {
    if (!isNonNegativeDecimal(p.service)) {
        return indeterminate(["service must be a non-negative decimal"], ["credited service S_t"]);
    }
    const cappedService = p.serviceCap !== undefined
        && (0, decimal_1.decCompare)(p.service, p.serviceCap) > 0
        ? p.serviceCap
        : p.service;
    if (p.periodRates !== undefined && p.periodRates.length > 0) {
        let total = "0";
        for (const period of p.periodRates) {
            if (!isNonNegativeDecimal(period.rate) || !isNonNegativeDecimal(period.service)) {
                return indeterminate(["a period rate or period service is missing or negative"], ["a rate and service for every period"]);
            }
            total = (0, decimal_1.decAdd)(total, (0, decimal_1.decMultiply)(period.rate, period.service));
        }
        if ((0, decimal_1.decCompare)(total, "0") < 0)
            return negativeRefused(total, "T-03");
        return exactResult(ctx, moneyOf(ctx.rounding, total), "monthly", p.basis);
    }
    if (!isNonNegativeDecimal(p.unitRate.value)) {
        return indeterminate(["unit rate d must be a non-negative decimal"], ["the dollar unit rate d"]);
    }
    if (p.unitRateRange !== undefined) {
        if (!isNonNegativeDecimal(p.unitRateRange.low) || !isNonNegativeDecimal(p.unitRateRange.high)) {
            return indeterminate(["unit-rate range bounds must be non-negative decimals"], ["the documented rate range"]);
        }
        return {
            kind: "bound",
            min: makeBenefit(ctx, moneyOf(ctx.rounding, (0, decimal_1.decMultiply)(p.unitRateRange.low, cappedService)), "monthly", p.basis, "bound"),
            max: makeBenefit(ctx, moneyOf(ctx.rounding, (0, decimal_1.decMultiply)(p.unitRateRange.high, cappedService)), "monthly", p.basis, "bound"),
            evidenceGrade: "estimate",
            missingInputs: ["historical dollar unit rate d"],
        };
    }
    const benefit = (0, decimal_1.decMultiply)(p.unitRate.value, cappedService);
    if ((0, decimal_1.decCompare)(benefit, "0") < 0)
        return negativeRefused(benefit, "T-03");
    return exactResult(ctx, moneyOf(ctx.rounding, benefit), "monthly", p.basis);
}
/**
 * T-04 — Unit-credit benefit (percentage of compensation per year).
 * B_t = α × C̄_t × S_t, annual (MASTER_PROMPT §4 canonical form
 * B_t = α S_t C̄_t); ÷12 monthly. DBAB Q 9:4; Q 9:10; Q 10:17;
 * IRC §411(b)(1)(A)–(B).
 */
function calcUnitCredit(ctx, p) {
    if (!isNonNegativeDecimal(p.avgComp) || !isNonNegativeDecimal(p.service)) {
        return indeterminate(["average compensation and service must be non-negative decimals"], ["average compensation C̄_t and credited service S_t"]);
    }
    if (!isNonNegativeDecimal(p.accrualRate.value)) {
        return indeterminate(["accrual rate α must be a non-negative decimal"], ["the accrual rate α"]);
    }
    const cappedService = p.serviceCap !== undefined
        && (0, decimal_1.decCompare)(p.service, p.serviceCap) > 0
        ? p.serviceCap
        : p.service;
    const annualFor = (rate, comp) => (0, decimal_1.decMultiply)((0, decimal_1.decMultiply)(rate, comp), cappedService);
    if (p.avgCompRange !== undefined || p.accrualRateRange !== undefined) {
        const rateLow = p.accrualRateRange?.low ?? p.accrualRate.value;
        const rateHigh = p.accrualRateRange?.high ?? p.accrualRate.value;
        const compLow = p.avgCompRange?.low ?? p.avgComp;
        const compHigh = p.avgCompRange?.high ?? p.avgComp;
        if (!isNonNegativeDecimal(rateLow) || !isNonNegativeDecimal(rateHigh)
            || !isNonNegativeDecimal(compLow) || !isNonNegativeDecimal(compHigh)) {
            return indeterminate(["bound inputs must be non-negative decimals"], ["the documented input ranges"]);
        }
        return {
            kind: "bound",
            min: makeBenefit(ctx, monthlyMoneyOfAnnual(ctx.rounding, annualFor(rateLow, compLow)), "monthly", p.basis, "bound"),
            max: makeBenefit(ctx, monthlyMoneyOfAnnual(ctx.rounding, annualFor(rateHigh, compHigh)), "monthly", p.basis, "bound"),
            evidenceGrade: "estimate",
            missingInputs: [
                ...(p.avgCompRange !== undefined ? ["average compensation C̄_t"] : []),
                ...(p.accrualRateRange !== undefined ? ["accrual rate α history"] : []),
            ],
        };
    }
    const annual = annualFor(p.accrualRate.value, p.avgComp);
    if ((0, decimal_1.decCompare)(annual, "0") < 0)
        return negativeRefused(annual, "T-04");
    return exactResult(ctx, monthlyMoneyOfAnnual(ctx.rounding, annual), "monthly", p.basis);
}
/**
 * T-05 — Career-average compensation benefit.
 * B_t = α × C̄_t^career × S_t, equivalently B_t = α × Σ_y C_y (the
 * year-by-year form — the safer implementation, preserving the per-year
 * §401(a)(17) cap). The fractional accrual method does NOT apply to
 * career-average plans (average period > 10 years). DBAB Q 9:12;
 * Q 10:18; IRC §411(b)(1)(C).
 */
function calcCareerAverage(ctx, p) {
    if (!isNonNegativeDecimal(p.accrualRate.value) || !isNonNegativeDecimal(p.service)) {
        return indeterminate(["accrual rate α and service must be non-negative decimals"], ["the accrual rate α and credited service S_t"]);
    }
    for (const y of p.compByYear) {
        if (!isNonNegativeDecimal(y.comp)) {
            return indeterminate([`compensation year ${y.year} is missing or negative`], [`compensation for ${y.year}`]);
        }
    }
    if (p.compByYear.length === 0 && (p.missingYears === undefined || p.missingYears.length === 0)) {
        return indeterminate(["no compensation years supplied for the career average"], ["the compensation history"]);
    }
    const sumKnown = p.compByYear.reduce((acc, y) => (0, decimal_1.decAdd)(acc, y.comp), "0");
    if (p.missingYears !== undefined && p.missingYears.length > 0) {
        for (const m of p.missingYears) {
            if (!isNonNegativeDecimal(m.low) || !isNonNegativeDecimal(m.high)) {
                return indeterminate([`missing-year bounds for ${m.year} must be non-negative decimals`], [`bounded fills for ${m.year}`]);
            }
        }
        const lowSum = p.missingYears.reduce((acc, m) => (0, decimal_1.decAdd)(acc, m.low), sumKnown);
        const highSum = p.missingYears.reduce((acc, m) => (0, decimal_1.decAdd)(acc, m.high), sumKnown);
        return {
            kind: "bound",
            min: makeBenefit(ctx, monthlyMoneyOfAnnual(ctx.rounding, (0, decimal_1.decMultiply)(p.accrualRate.value, lowSum)), "monthly", p.basis, "bound"),
            max: makeBenefit(ctx, monthlyMoneyOfAnnual(ctx.rounding, (0, decimal_1.decMultiply)(p.accrualRate.value, highSum)), "monthly", p.basis, "bound"),
            evidenceGrade: "estimate",
            missingInputs: p.missingYears.map((m) => `compensation year ${m.year}`),
        };
    }
    const annual = (0, decimal_1.decMultiply)(p.accrualRate.value, sumKnown);
    if ((0, decimal_1.decCompare)(annual, "0") < 0)
        return negativeRefused(annual, "T-05");
    return exactResult(ctx, monthlyMoneyOfAnnual(ctx.rounding, annual), "monthly", p.basis);
}
function averageOfYears(compByYear, windowYears, windowKind) {
    const sorted = [...compByYear].sort((a, b) => a.year - b.year);
    if (sorted.length < windowYears)
        return null;
    if (windowKind === "final") {
        const window = sorted.slice(sorted.length - windowYears);
        const sum = window.reduce((acc, y) => (0, decimal_1.decAdd)(acc, y.comp), "0");
        return { average: (0, decimal_1.decDivide)(sum, String(windowYears), 10), yearsUsed: window.map((y) => y.year) };
    }
    let best = null;
    for (let i = 0; i + windowYears <= sorted.length; i += 1) {
        const window = sorted.slice(i, i + windowYears);
        const years = window.map((y) => y.year);
        let consecutive = true;
        for (let k = 1; k < years.length; k += 1) {
            if (years[k] !== years[k - 1] + 1)
                consecutive = false;
        }
        if (!consecutive)
            continue;
        const sum = window.reduce((acc, y) => (0, decimal_1.decAdd)(acc, y.comp), "0");
        const average = (0, decimal_1.decDivide)(sum, String(windowYears), 10);
        if (best === null || (0, decimal_1.decCompare)(average, best.average) > 0) {
            best = { average, yearsUsed: years };
        }
    }
    return best;
}
/**
 * T-06 — Final-average / highest-average compensation benefit.
 * B_t = α × C̄_t^(n) × S_t, where C̄_t^(n) is the average of the highest
 * (or final) n consecutive years through t. DBAB Q 9:4, Ex. 1; Q 9:10,
 * Ex. 1; Q 9:50–9:52; Q 10:32.
 */
function calcFinalOrHighestAverage(ctx, p) {
    if (!isNonNegativeDecimal(p.accrualRate.value) || !isNonNegativeDecimal(p.service)) {
        return indeterminate(["accrual rate α and service must be non-negative decimals"], ["the accrual rate α and credited service S_t"]);
    }
    for (const y of p.compByYear) {
        if (!isNonNegativeDecimal(y.comp)) {
            return indeterminate([`compensation year ${y.year} is missing or negative`], [`compensation for ${y.year}`]);
        }
    }
    if (p.windowYears <= 0) {
        return indeterminate(["averaging window must be a positive number of years"], ["the averaging period n"]);
    }
    const benefitForAverage = (average) => monthlyMoneyOfAnnual(ctx.rounding, (0, decimal_1.decMultiply)((0, decimal_1.decMultiply)(p.accrualRate.value, average), p.service));
    if (p.windowKindUnknown === true) {
        const highest = averageOfYears(p.compByYear, p.windowYears, "highest");
        const final = averageOfYears(p.compByYear, p.windowYears, "final");
        if (highest === null || final === null) {
            return indeterminate(["fewer than n compensation years are available for the averaging window"], ["the compensation years in the averaging window"]);
        }
        return {
            kind: "scenarios",
            scenarios: [
                namedScenario({
                    name: `highest-${p.windowYears}-year average`,
                    value: makeBenefit(ctx, benefitForAverage(highest.average), "monthly", p.basis, "scenario"),
                    basis: `highest ${p.windowYears} consecutive years`,
                    formulaId: "T-06",
                    inputs: [
                        { field: "windowKind", value: "highest" },
                        { field: "averageCompensation", value: highest.average },
                        { field: "yearsUsed", value: highest.yearsUsed.join(",") },
                        { field: "accrualRate", value: p.accrualRate.value },
                        { field: "service", value: p.service },
                    ],
                    ruleRef: "T-06 final/highest-average benefit (DBAB Q 9:4, Ex. 1; Q 9:10, Ex. 1)",
                }),
                namedScenario({
                    name: `final-${p.windowYears}-year average`,
                    value: makeBenefit(ctx, benefitForAverage(final.average), "monthly", p.basis, "scenario"),
                    basis: `final ${p.windowYears} years`,
                    formulaId: "T-06",
                    inputs: [
                        { field: "windowKind", value: "final" },
                        { field: "averageCompensation", value: final.average },
                        { field: "yearsUsed", value: final.yearsUsed.join(",") },
                        { field: "accrualRate", value: p.accrualRate.value },
                        { field: "service", value: p.service },
                    ],
                    ruleRef: "T-06 final/highest-average benefit (DBAB Q 9:4, Ex. 1; Q 9:10, Ex. 1)",
                }),
            ],
            evidenceGrade: "estimate",
            missingInputs: ["whether the plan's averaging period is highest or final"],
        };
    }
    if (p.missingYears !== undefined && p.missingYears.length > 0) {
        const lowFilled = [...p.compByYear, ...p.missingYears.map((m) => ({ year: m.year, comp: m.low }))];
        const highFilled = [...p.compByYear, ...p.missingYears.map((m) => ({ year: m.year, comp: m.high }))];
        const lowAvg = averageOfYears(lowFilled, p.windowYears, p.windowKind);
        const highAvg = averageOfYears(highFilled, p.windowYears, p.windowKind);
        if (lowAvg === null || highAvg === null) {
            return indeterminate(["the averaging window cannot be completed even with bounded fills"], ["the compensation years in the averaging window"]);
        }
        return {
            kind: "bound",
            min: makeBenefit(ctx, benefitForAverage(lowAvg.average), "monthly", p.basis, "bound"),
            max: makeBenefit(ctx, benefitForAverage(highAvg.average), "monthly", p.basis, "bound"),
            evidenceGrade: "estimate",
            missingInputs: p.missingYears.map((m) => `compensation year ${m.year}`),
        };
    }
    const found = averageOfYears(p.compByYear, p.windowYears, p.windowKind);
    if (found === null) {
        if (p.shortWindowRule !== undefined) {
            const all = [...p.compByYear].sort((a, b) => a.year - b.year);
            const window = p.windowKind === "final"
                ? all
                : all.slice(Math.max(0, all.length - p.windowYears));
            const sum = window.reduce((acc, y) => (0, decimal_1.decAdd)(acc, y.comp), "0");
            const average = (0, decimal_1.decDivide)(sum, String(window.length), 10);
            return exactResult(ctx, benefitForAverage(average), "monthly", p.basis, "assumption");
        }
        return indeterminate([`fewer than ${p.windowYears} compensation years are available and no short-window rule is stated`], ["the plan's short-averaging-window rule"]);
    }
    const annual = (0, decimal_1.decMultiply)((0, decimal_1.decMultiply)(p.accrualRate.value, found.average), p.service);
    if ((0, decimal_1.decCompare)(annual, "0") < 0)
        return negativeRefused(annual, "T-06");
    return exactResult(ctx, benefitForAverage(found.average), "monthly", p.basis);
}
/**
 * T-07 — Fractional accrual. B_t = B_t^proj × (S_t / S_t^proj).
 * DBAB Q 9:8; Q 9:9 (partial-year rule, Rev. Rul. 81-11); Q 9:12;
 * Q 10:18–10:19; Treas. Reg. §1.411(b)-1(b)(3); IRC §411(b)(1)(C).
 * The denominator may not exceed the plan's service cap (DBAB Q 9:21).
 * Not available for career-average plans (T-05).
 */
function calcFractionalAccrual(ctx, p) {
    if (!isNonNegativeDecimal(p.projectedBenefit) || !isNonNegativeDecimal(p.service)) {
        return indeterminate(["projected benefit and service must be non-negative decimals"], ["the projected benefit B_t^proj and service S_t"]);
    }
    if (p.projectedServiceScenarios !== undefined && p.projectedServiceScenarios.length > 0) {
        const scenarios = [];
        for (const s of p.projectedServiceScenarios) {
            const one = calcFractionalAccrual(ctx, { ...p, projectedService: s.projectedService, projectedServiceScenarios: undefined });
            if (one.kind !== "exact")
                return one;
            scenarios.push(namedScenario({
                name: s.label,
                value: { ...one.value, source: "scenario" },
                basis: s.label,
                formulaId: "T-07",
                inputs: [
                    { field: "projectedService", value: s.projectedService },
                    { field: "service", value: p.service },
                    { field: "projectedBenefit", value: p.projectedBenefit },
                ],
                ruleRef: "T-07 fractional accrual (DBAB Q 9:8; Q 9:9)",
            }));
        }
        return { kind: "scenarios", scenarios, evidenceGrade: "estimate", missingInputs: ["projected-service convention"] };
    }
    if (!isNonNegativeDecimal(p.projectedService) || (0, decimal_1.decCompare)(p.projectedService, "0") === 0) {
        return indeterminate(["projected service must be a positive decimal"], ["the projected total service S_t^proj"]);
    }
    const denominator = p.serviceCap !== undefined
        && (0, decimal_1.decCompare)(p.projectedService, p.serviceCap) > 0
        ? p.serviceCap
        : p.projectedService;
    // Multiply before dividing (same exactness point as the fractional
    // rule in accrualTests.ts): (B_proj × S) / S_proj is exact when the
    // division is exact; B_proj × (S/S_proj) rounds ⅔ to 0.6666666667
    // at scale 10 and overshoots by a micro-cent.
    const annual = p.partialYearRatio !== undefined
        ? (0, decimal_1.decMultiply)(p.projectedBenefit, p.partialYearRatio)
        : (0, decimal_1.decDivide)((0, decimal_1.decMultiply)(p.projectedBenefit, p.service), denominator, 10);
    if ((0, decimal_1.decCompare)(annual, "0") < 0)
        return negativeRefused(annual, "T-07");
    return exactResult(ctx, monthlyMoneyOfAnnual(ctx.rounding, annual), "monthly", p.basis);
}
/** Service in each band for a total service amount. */
function splitServiceIntoBands(service, bands) {
    return bands.map((band) => {
        const from = band.fromService;
        const to = band.toService;
        if ((0, decimal_1.decCompare)(service, from) <= 0)
            return "0";
        const inBand = to === null
            ? (0, decimal_1.decSubtract)(service, from)
            : (0, decimal_1.decSubtract)((0, decimal_1.decCompare)(service, to) < 0 ? service : to, from);
        return (0, decimal_1.decCompare)(inBand, "0") < 0 ? "0" : inBand;
    });
}
/**
 * T-08 — Step-rate / tiered service formulas.
 * Percentage form: B_t = C̄_t × Σ_k α_k × S_{t,k}.
 * Dollar form: B_t = Σ_k d_k × S_{t,k}.
 * DBAB Q 9:12, Ex. 1; Q 10:17; IRC §411(b)(1)(B) (133⅓% rule — a later
 * band's rate may not exceed 133⅓% of any earlier band's rate). The
 * 133⅓% rule is a COMPLIANCE test (see accrualTests.ts), not a refusal:
 * a plan satisfies IRC §411(b)(1) by meeting any one of the three tests,
 * and the Dane tiers below fail 133⅓% but pass the 3% rule, so they
 * compute exactly. A 133⅓% failure is a finding for the compliance
 * record, never a reason to refuse the benefit.
 */
function calcStepRate(ctx, p) {
    if (!isNonNegativeDecimal(p.service)) {
        return indeterminate(["service must be a non-negative decimal"], ["credited service S_t"]);
    }
    if (p.dollarRates !== undefined && p.dollarRates.length > 0) {
        const splits = splitServiceIntoBands(p.service, p.dollarRates);
        let total = "0";
        for (let i = 0; i < p.dollarRates.length; i += 1) {
            const rate = p.dollarRates[i]?.rate;
            const split = splits[i];
            if (rate === undefined || split === undefined || !isNonNegativeDecimal(rate)) {
                return indeterminate(["a dollar band rate is missing or negative"], ["the dollar rate for every band"]);
            }
            total = (0, decimal_1.decAdd)(total, (0, decimal_1.decMultiply)(rate, split));
        }
        if ((0, decimal_1.decCompare)(total, "0") < 0)
            return negativeRefused(total, "T-08");
        return exactResult(ctx, moneyOf(ctx.rounding, total), "monthly", p.basis);
    }
    if (p.avgComp === undefined) {
        return indeterminate(["average compensation is required for the percentage form"], ["average compensation C̄_t"]);
    }
    if (!isNonNegativeDecimal(p.avgComp)) {
        return indeterminate(["average compensation must be a non-negative decimal"], ["average compensation C̄_t"]);
    }
    if (p.bands.length === 0) {
        return indeterminate(["no service bands supplied"], ["the plan's service bands and rates"]);
    }
    const rates = p.bands.map((b) => b.rate.value);
    for (const r of rates) {
        if (!isNonNegativeDecimal(r)) {
            return indeterminate(["a band rate is missing or negative"], ["the accrual rate for every band"]);
        }
    }
    // NOTE (2026-11-12, spec-ambiguity resolution): the 133⅓% rule is NOT
    // applied here as a refusal. A plan satisfies IRC §411(b)(1) by meeting
    // ANY ONE of the three accrual tests, and the spec's own numerical
    // example for this formula (Stage 1 T-08 item 10 — Dane, 1% / 1.4% /
    // 1.65%) violates the 133⅓% rule (1.4% > 4/3 × 1%) yet is cited in
    // item 8 as the "3% rule test": it passes the 3% rule (30.25% accrued
    // vs 3% × 30.25% × 25 = 22.6875% required), so it is a valid qualified
    // formula. Refusing it here would make the formula refuse its own
    // spec example. The 133⅓% test lives in accrualTests.ts as a compliance
    // check (test133PercentRule), where a failure is a finding, not a
    // refusal to compute. The earlier draft decision (refuse on violation)
    // is superseded by this reading; see the test file for both sides.
    const splits = splitServiceIntoBands(p.service, p.bands);
    let accruedPercent = "0";
    for (let i = 0; i < p.bands.length; i += 1) {
        const rate = rates[i];
        const split = splits[i];
        if (rate === undefined || split === undefined)
            continue;
        accruedPercent = (0, decimal_1.decAdd)(accruedPercent, (0, decimal_1.decMultiply)(rate, split));
    }
    const annual = (0, decimal_1.decMultiply)(p.avgComp, accruedPercent);
    if ((0, decimal_1.decCompare)(annual, "0") < 0)
        return negativeRefused(annual, "T-08");
    return exactResult(ctx, monthlyMoneyOfAnnual(ctx.rounding, annual), "monthly", p.basis);
}
/**
 * T-09 — Maximum credited-service limits. B_t = F(C̄_t, min(S_t, S_max)) —
 * the underlying formula F (any of T-01–T-08) evaluated with service
 * capped. The cap applies to service counted, not to the benefit directly.
 * DBAB Q 9:21; Blonder-Tongue plan §5.01 (30-year cap). In a final-average
 * plan the benefit can still grow after the cap through C̄_t increases.
 */
function calcServiceCapped(ctx, p) {
    if (!isNonNegativeDecimal(p.service) || !isNonNegativeDecimal(p.serviceCap.value)) {
        return indeterminate(["service and the service cap must be non-negative decimals"], ["credited service S_t and the maximum S_max"]);
    }
    if (p.minPlausibleCap !== undefined) {
        const uncapped = p.underlying(p.service);
        const capped = p.underlying(p.minPlausibleCap);
        const combined = (0, compose_1.combineResults)([uncapped, capped], "greater-of");
        if (combined.kind === "bound")
            return combined;
        if (combined.kind === "exact") {
            // Both endpoints exact: the bound is [capped, uncapped].
            const lo = capped.kind === "exact" ? capped.value : null;
            const hi = uncapped.kind === "exact" ? uncapped.value : null;
            if (lo !== null && hi !== null) {
                return {
                    kind: "bound",
                    min: { ...lo, source: "bound" },
                    max: { ...hi, source: "bound" },
                    evidenceGrade: "estimate",
                    missingInputs: ["maximum credited service S_max"],
                };
            }
        }
        return combined;
    }
    const cappedService = (0, decimal_1.decCompare)(p.service, p.serviceCap.value) > 0
        ? p.serviceCap.value
        : p.service;
    return p.underlying(cappedService);
}
/**
 * I-01 — Excess benefit formula.
 * Unit-credit: B_t = [β_b × min(C̄_t, L) + β_e × max(C̄_t − L, 0)] × S_t.
 * Flat: B_t = [β_b × min(C̄_t, L) + β_e × max(C̄_t − L, 0)] × (S_t / S_full).
 * DBAB Q 9:5; Q 10:26–10:30; Treas. Reg. §1.401(l)-3. If C̄_t ≤ L the
 * formula collapses to the base rate.
 */
function calcExcessBenefit(ctx, p) {
    if (!isNonNegativeDecimal(p.baseRate.value) || !isNonNegativeDecimal(p.excessRate.value)
        || !isNonNegativeDecimal(p.avgComp) || !isNonNegativeDecimal(p.service)) {
        return indeterminate(["base rate, excess rate, average compensation, and service must be non-negative decimals"], ["β_b, β_e, C̄_t, and S_t"]);
    }
    const annualForLevel = (level) => {
        const below = (0, decimal_1.decCompare)(p.avgComp, level) <= 0 ? p.avgComp : level;
        const above = (0, decimal_1.decCompare)(p.avgComp, level) <= 0
            ? "0"
            : (0, decimal_1.decSubtract)(p.avgComp, level);
        const perYear = (0, decimal_1.decAdd)((0, decimal_1.decMultiply)(p.baseRate.value, below), (0, decimal_1.decMultiply)(p.excessRate.value, above));
        if (p.form === "flat") {
            if (p.fullService === undefined || (0, decimal_1.decCompare)(p.fullService, "0") === 0) {
                throw new Error("calcExcessBenefit: flat form requires a positive fullService");
            }
            const fraction = (0, decimal_1.decDivide)((0, decimal_1.decCompare)(p.service, p.fullService) >= 0 ? p.fullService : p.service, p.fullService, 10);
            return (0, decimal_1.decMultiply)(perYear, fraction);
        }
        return (0, decimal_1.decMultiply)(perYear, p.service);
    };
    if (p.form === "flat" && (p.fullService === undefined || !isNonNegativeDecimal(p.fullService))) {
        return indeterminate(["flat form requires full service S_full"], ["full service S_full"]);
    }
    if (!isNonNegativeDecimal(p.integrationLevel.value)) {
        return indeterminate(["integration level L must be a non-negative decimal"], ["the integration level L"]);
    }
    if (p.integrationLevelRange !== undefined) {
        const low = annualForLevel(p.integrationLevelRange.low);
        const high = annualForLevel(p.integrationLevelRange.high);
        const lo = (0, decimal_1.decCompare)(low, high) <= 0 ? low : high;
        const hi = (0, decimal_1.decCompare)(low, high) <= 0 ? high : low;
        return {
            kind: "bound",
            min: makeBenefit(ctx, monthlyMoneyOfAnnual(ctx.rounding, lo), "monthly", p.basis, "bound"),
            max: makeBenefit(ctx, monthlyMoneyOfAnnual(ctx.rounding, hi), "monthly", p.basis, "bound"),
            evidenceGrade: "estimate",
            missingInputs: ["integration level L"],
        };
    }
    const annual = annualForLevel(p.integrationLevel.value);
    if ((0, decimal_1.decCompare)(annual, "0") < 0)
        return negativeRefused(annual, "I-01");
    return exactResult(ctx, monthlyMoneyOfAnnual(ctx.rounding, annual), "monthly", p.basis);
}
/**
 * I-02 — Covered-compensation integration. Same structure as I-01 with
 * L = CC_i(t), the participant's covered compensation (average of the
 * Social Security taxable wage bases over the participant's working
 * lifetime, by birth year and calculation date). DBAB Q 9:5; Q 10:31–10:35;
 * IRC §401(l). A missing birth year is indeterminate — a birth year is
 * never estimated from age bands. A missing table year fails loudly —
 * never a neighbouring year's value. IRC §401(a)(15) prohibits reducing
 * an accrued benefit because covered compensation increased, for anyone
 * separated after 1974-09-02.
 */
function calcCoveredCompIntegration(ctx, p) {
    if (p.birthYear === null || p.birthYear === undefined) {
        return indeterminate(["birth year is missing — covered compensation cannot be determined"], ["the participant's birth year"]);
    }
    if (p.coveredCompTable === null || p.coveredCompTable === undefined) {
        return indeterminate([`covered-compensation table for ${p.calculationDate.slice(0, 4)} is not loaded`], [`the IRS covered-compensation table for ${p.calculationDate.slice(0, 4)}`]);
    }
    const coveredComp = p.coveredCompTable.valuesByBirthYear[p.birthYear];
    if (coveredComp === undefined) {
        return indeterminate([`covered-compensation table has no value for birth year ${p.birthYear}`], [`the covered-compensation value for birth year ${p.birthYear}`]);
    }
    return calcExcessBenefit(ctx, {
        baseRate: p.baseRate,
        excessRate: p.excessRate,
        integrationLevel: datedValue(coveredComp, p.calculationDate, ctx.planVersionId),
        avgComp: p.avgComp,
        service: p.service,
        form: "unit-credit",
        basis: p.basis,
    });
}
/**
 * I-03 — Social Security permitted disparity (IRC §401(l)).
 * Excess: B_t = [β_base × C̄_t + β_excess × max(C̄_t − L, 0)] × S_t,
 *   β_excess ≤ min(0.75%, β_base).
 * Offset: B_t = [γ_gross × C̄_t − γ_offset × min(C̄_t, L)] × S_t,
 *   γ_offset ≤ min(0.75%, ½ γ_gross × C̄_t / min(C̄_t, L)).
 * Service beyond 35 years earns no additional disparity. The 0.75%
 * allowances are exact percentages — 0.75% is never rounded to 0.8%.
 * DBAB Q 10:25–10:30; IRC §401(l); Treas. Reg. §1.401(l)-3.
 */
function calcPermittedDisparity(ctx, p) {
    if (!isNonNegativeDecimal(p.baseRate.value) || !isNonNegativeDecimal(p.excessOrOffsetRate.value)
        || !isNonNegativeDecimal(p.level.value) || !isNonNegativeDecimal(p.avgComp)
        || !isNonNegativeDecimal(p.service)) {
        return indeterminate(["base/gross rate, excess/offset rate, level, average compensation, and service must be non-negative decimals"], ["the disparity rates, level L, C̄_t, and S_t"]);
    }
    if (p.methodUnknown === true) {
        const excess = calcPermittedDisparity(ctx, { ...p, method: "excess", methodUnknown: undefined });
        const offset = calcPermittedDisparity(ctx, { ...p, method: "offset", methodUnknown: undefined });
        if (excess.kind !== "exact" || offset.kind !== "exact") {
            return excess.kind === "indeterminate" ? excess : offset;
        }
        return {
            kind: "scenarios",
            scenarios: [
                namedScenario({
                    name: "excess method",
                    value: { ...excess.value, source: "scenario" },
                    basis: "IRC §401(l) excess method",
                    formulaId: "I-03",
                    inputs: [
                        { field: "disparityMethod", value: "excess" },
                        { field: "baseRate", value: p.baseRate.value },
                        { field: "excessRate", value: p.excessOrOffsetRate.value },
                        { field: "level", value: p.level.value },
                        { field: "avgComp", value: p.avgComp },
                        { field: "service", value: p.service },
                    ],
                    ruleRef: "I-03 permitted disparity (DBAB Q 10:25–10:30; IRC §401(l))",
                }),
                namedScenario({
                    name: "offset method",
                    value: { ...offset.value, source: "scenario" },
                    basis: "IRC §401(l) offset method",
                    formulaId: "I-03",
                    inputs: [
                        { field: "disparityMethod", value: "offset" },
                        { field: "baseRate", value: p.baseRate.value },
                        { field: "offsetRate", value: p.excessOrOffsetRate.value },
                        { field: "level", value: p.level.value },
                        { field: "avgComp", value: p.avgComp },
                        { field: "service", value: p.service },
                    ],
                    ruleRef: "I-03 permitted disparity (DBAB Q 10:25–10:30; IRC §401(l))",
                }),
            ],
            evidenceGrade: "estimate",
            missingInputs: ["the plan's disparity method (excess vs offset)"],
        };
    }
    const service = (0, decimal_1.decCompare)(p.service, "35") > 0 ? "35" : p.service;
    if (p.method === "excess") {
        const maxExcess = (0, decimal_1.decCompare)(p.baseRate.value, "0.0075") < 0
            ? p.baseRate.value
            : "0.0075";
        if ((0, decimal_1.decCompare)(p.excessOrOffsetRate.value, maxExcess) > 0) {
            return indeterminate([`excess rate ${p.excessOrOffsetRate.value} exceeds the maximum excess allowance ${maxExcess} (IRC §401(l))`], ["an excess rate within the permitted-disparity allowance"]);
        }
        const above = (0, decimal_1.decCompare)(p.avgComp, p.level.value) <= 0
            ? "0"
            : (0, decimal_1.decSubtract)(p.avgComp, p.level.value);
        const annual = (0, decimal_1.decMultiply)((0, decimal_1.decAdd)((0, decimal_1.decMultiply)(p.baseRate.value, p.avgComp), (0, decimal_1.decMultiply)(p.excessOrOffsetRate.value, above)), service);
        if ((0, decimal_1.decCompare)(annual, "0") < 0)
            return negativeRefused(annual, "I-03");
        return exactResult(ctx, monthlyMoneyOfAnnual(ctx.rounding, annual), "monthly", p.basis);
    }
    const cappedComp = (0, decimal_1.decCompare)(p.avgComp, p.level.value) <= 0 ? p.avgComp : p.level.value;
    const maxOffset = (0, decimal_1.decCompare)(cappedComp, "0") === 0
        ? "0.0075"
        : (() => {
            const half = (0, decimal_1.decMultiply)("0.5", (0, decimal_1.decMultiply)(p.baseRate.value, (0, decimal_1.decDivide)(p.avgComp, cappedComp, 10)));
            return (0, decimal_1.decCompare)(half, "0.0075") < 0 ? half : "0.0075";
        })();
    if ((0, decimal_1.decCompare)(p.excessOrOffsetRate.value, maxOffset) > 0) {
        return indeterminate([`offset rate ${p.excessOrOffsetRate.value} exceeds the maximum offset allowance ${maxOffset} (IRC §401(l))`], ["an offset rate within the permitted-disparity allowance"]);
    }
    const annual = (0, decimal_1.decMultiply)((0, decimal_1.decSubtract)((0, decimal_1.decMultiply)(p.baseRate.value, p.avgComp), (0, decimal_1.decMultiply)(p.excessOrOffsetRate.value, cappedComp)), service);
    if ((0, decimal_1.decCompare)(annual, "0") < 0)
        return negativeRefused(annual, "I-03");
    return exactResult(ctx, monthlyMoneyOfAnnual(ctx.rounding, annual), "monthly", p.basis);
}
/**
 * I-04 — Primary Insurance Amount (PIA) offsets.
 * B_t = B_t^gross − γ × PIA_t × (S_t / S_ref), floored at zero unless the
 * plan provides otherwise. Monthly. DBAB Q 9:6; Q 9:16 (Rev. Rul. 84-45;
 * IRC §401(a)(15)); BCV IACT. Never offset with an estimated PIA in a way
 * that forfeits accrued benefits; never reduce a separated participant's
 * accrued benefit because the offset grew.
 */
function calcPiaOffset(ctx, p) {
    if (!isNonNegativeDecimal(p.grossBenefit) || !isNonNegativeDecimal(p.offsetFraction.value)
        || !isNonNegativeDecimal(p.service)) {
        return indeterminate(["gross benefit, offset fraction, and service must be non-negative decimals"], ["the gross benefit B_t^gross, offset fraction γ, and service S_t"]);
    }
    if (p.prorateDenominator !== undefined
        && (!isNonNegativeDecimal(p.prorateDenominator) || (0, decimal_1.decCompare)(p.prorateDenominator, "0") === 0)) {
        return indeterminate(["proration denominator S_ref must be a positive decimal"], ["the offset proration denominator S_ref"]);
    }
    const netForPia = (pia) => {
        const proration = p.prorateDenominator !== undefined
            ? (0, decimal_1.decDivide)(p.service, p.prorateDenominator, 10)
            : "1";
        const offset = (0, decimal_1.decMultiply)((0, decimal_1.decMultiply)(p.offsetFraction.value, pia), proration);
        const net = (0, decimal_1.decSubtract)(p.grossBenefit, offset);
        return (0, decimal_1.decCompare)(net, "0") < 0 ? "0" : net;
    };
    if (p.pia === null || p.pia === undefined) {
        if (p.piaRange !== undefined) {
            if (!isNonNegativeDecimal(p.piaRange.low) || !isNonNegativeDecimal(p.piaRange.high)) {
                return indeterminate(["PIA range bounds must be non-negative decimals"], ["the plausible PIA range"]);
            }
            return {
                kind: "bound",
                min: makeBenefit(ctx, moneyOf(ctx.rounding, netForPia(p.piaRange.high)), "monthly", p.basis, "bound"),
                max: makeBenefit(ctx, moneyOf(ctx.rounding, netForPia(p.piaRange.low)), "monthly", p.basis, "bound"),
                evidenceGrade: "estimate",
                missingInputs: ["Primary Insurance Amount PIA_t"],
            };
        }
        return indeterminate(["Primary Insurance Amount PIA_t is not available"], ["the administrator's PIA worksheet (not a re-estimate by the system)"]);
    }
    if (!isNonNegativeDecimal(p.pia.value)) {
        return indeterminate(["PIA must be a non-negative decimal"], ["the Primary Insurance Amount PIA_t"]);
    }
    const net = netForPia(p.pia.value);
    return exactResult(ctx, moneyOf(ctx.rounding, net), "monthly", p.basis);
}
/** Integer power of an exact decimal (exponent must be a whole number). */
function powInteger(base, exponent) {
    const n = Number(exponent);
    if (!Number.isInteger(n) || n < 0 || n > 100)
        return null;
    let result = "1";
    for (let i = 0; i < n; i += 1)
        result = (0, decimal_1.decMultiply)(result, base);
    return result;
}
/**
 * I-05 — Other plan-specific offsets (floor-offset, prior distributions,
 * other-plan offsets). B_t^net = max(B_t^gross − Offset_t, 0).
 * Floor-offset: Offset_t = ProjDC_t / APR, with ProjDC_t the DC account
 * projected to NRA at the DB plan's interest rate assuming no future
 * contributions. Only the vested portion of a DC account may offset
 * (Rev. Rul. 76-259). DBAB Q 4:16, Q 4:27–Q 4:29, Q 4:31. In a frozen DB
 * plan subject to a floor-offset, the offset is frozen too (DBAB Q 4:29).
 */
function calcPlanOffset(ctx, p) {
    if (!isNonNegativeDecimal(p.grossBenefit)) {
        return indeterminate(["gross benefit must be a non-negative decimal"], ["the gross accrued benefit"]);
    }
    let offset = null;
    if (p.offsetKind === "floor-offset-dc") {
        if (p.dcBalance === undefined) {
            if (p.maxPlausibleOffset !== undefined) {
                if (!isNonNegativeDecimal(p.maxPlausibleOffset)) {
                    return indeterminate(["maximum plausible offset must be a non-negative decimal"], ["the largest offset consistent with the evidence"]);
                }
                const minNet = (0, decimal_1.decCompare)(p.grossBenefit, p.maxPlausibleOffset) > 0
                    ? (0, decimal_1.decSubtract)(p.grossBenefit, p.maxPlausibleOffset)
                    : "0";
                return {
                    kind: "bound",
                    min: makeBenefit(ctx, moneyOf(ctx.rounding, minNet), "monthly", p.basis, "bound"),
                    max: makeBenefit(ctx, moneyOf(ctx.rounding, p.grossBenefit), "monthly", p.basis, "bound"),
                    evidenceGrade: "estimate",
                    missingInputs: ["defined-contribution account history"],
                };
            }
            return {
                kind: "bound",
                min: makeBenefit(ctx, moneyOf(ctx.rounding, "0"), "monthly", p.basis, "bound"),
                max: makeBenefit(ctx, moneyOf(ctx.rounding, p.grossBenefit), "monthly", p.basis, "bound"),
                evidenceGrade: "estimate",
                missingInputs: ["defined-contribution account history"],
            };
        }
        if (!isNonNegativeDecimal(p.dcBalance) || p.aprAtNra === undefined
            || !isNonNegativeDecimal(p.aprAtNra) || (0, decimal_1.decCompare)(p.aprAtNra, "0") === 0) {
            return indeterminate(["DC balance and a positive APR at NRA are required for the floor-offset"], ["the DC account balance and the APR at NRA"]);
        }
        const rate = p.projectionRate ?? "0";
        const years = p.yearsToNra ?? "0";
        if (!isNonNegativeDecimal(rate) || !isNonNegativeDecimal(years)) {
            return indeterminate(["projection rate and years to NRA must be non-negative decimals"], ["the DC projection rate and years to NRA"]);
        }
        const growth = powInteger((0, decimal_1.decAdd)("1", rate), years);
        if (growth === null) {
            return indeterminate(["years to NRA for the DC projection must be a whole number of years"], ["an integer years-to-NRA for the DC projection"]);
        }
        const projected = (0, decimal_1.decMultiply)(p.dcBalance, growth);
        offset = (0, decimal_1.decDivide)(projected, p.aprAtNra, 10);
    }
    else if (p.offsetKind === "prior-distribution") {
        const offsets = p.priorDistributionOffsetsMonthly ?? [];
        for (const o of offsets) {
            if (!isNonNegativeDecimal(o)) {
                return indeterminate(["a prior-distribution offset is missing or negative"], ["the actuarial-equivalent offsets of the prior distributions"]);
            }
        }
        offset = offsets.reduce((acc, o) => (0, decimal_1.decAdd)(acc, o), "0");
        if (offsets.length === 0 && (p.priorDistributions === undefined || p.priorDistributions.length === 0)) {
            return indeterminate(["no prior distributions and no precomputed offsets supplied"], ["the prior distribution amounts and dates"]);
        }
    }
    else {
        if (p.otherPlanOffset === undefined || !isNonNegativeDecimal(p.otherPlanOffset)) {
            return indeterminate(["other-plan offset must be a non-negative decimal"], ["the other-plan offset as the plan defines it"]);
        }
        offset = p.otherPlanOffset;
    }
    if (offset === null) {
        return indeterminate(["offset could not be determined"], ["the offset inputs for this kind"]);
    }
    const net = (0, decimal_1.decSubtract)(p.grossBenefit, offset);
    const floored = (0, decimal_1.decCompare)(net, "0") < 0 ? "0" : net;
    return exactResult(ctx, moneyOf(ctx.rounding, floored), "monthly", p.basis);
}
/**
 * C-01 — Greater-of formulas. B_t = max(B_t^(1), …, B_t^(n)). The result
 * records the winning value; which component won, and by how much, is
 * available from compose.describeComparison. DBAB Q 9:13; Q 10:18–10:19.
 * If one component cannot be computed, the bound is [best computable,
 * best computable + max plausible uncomputable].
 */
function calcGreaterOf(ctx, p) {
    void ctx;
    if (p.components.length === 0) {
        return indeterminate(["no components supplied"], ["at least one component formula"]);
    }
    return (0, compose_1.combineResults)(p.components.map((c) => c.result), "greater-of", { uncomputableMaxMinor: p.uncomputableMaxMinor ?? null });
}
/**
 * C-02 — Lesser-of formulas. B_t = min(B_t^(1), …, B_t^(n)). DBAB Q 9:13;
 * Q 12:4–12:5 (§415 lesser-of); IRC §415(b). If the binding component is
 * uncomputable, only an upper bound exists (B_t ≤ the smallest computable
 * component): the bound is [0, smallest computable], with the missing
 * component named — the uncomputable component is never assumed not to bind.
 */
function calcLesserOf(ctx, p) {
    void ctx;
    if (p.components.length === 0) {
        return indeterminate(["no components supplied"], ["at least one component formula"]);
    }
    const hasIndeterminate = p.components.some((c) => c.result.kind === "indeterminate");
    if (hasIndeterminate) {
        const computables = p.components.filter((c) => c.result.kind !== "indeterminate");
        const maxes = [];
        let reference = null;
        for (const c of computables) {
            if (c.result.kind === "exact") {
                const m = c.result.value.amount;
                if (m !== null)
                    maxes.push(m.amountMinor);
                if (reference === null)
                    reference = c.result.value;
            }
            else if (c.result.kind === "bound") {
                const m = c.result.max.amount;
                if (m !== null)
                    maxes.push(m.amountMinor);
                if (reference === null)
                    reference = c.result.max;
            }
        }
        if (maxes.length === 0 || reference === null) {
            return indeterminate(p.components.filter((c) => c.result.kind === "indeterminate").flatMap((c) => c.result.kind === "indeterminate" ? c.result.missingInputs : []), ["the binding component"]);
        }
        return {
            kind: "bound",
            min: { ...reference, amount: (0, decimal_1.makeMoney)(0), source: "bound" },
            max: { ...reference, amount: (0, decimal_1.makeMoney)(Math.min(...maxes)), source: "bound" },
            evidenceGrade: "estimate",
            missingInputs: p.components
                .filter((c) => c.result.kind === "indeterminate")
                .flatMap((c) => (c.result.kind === "indeterminate" ? c.result.missingInputs : [])),
        };
    }
    return (0, compose_1.combineResults)(p.components.map((c) => c.result), "lesser-of");
}
/**
 * C-03 — Minimum benefit guarantees (including top-heavy minimum).
 * B_t = max(B_t^formula, B_t^min). Top-heavy minimum (IRC §416(c)(1)(B)):
 * B_t^TH = 2% × C̄_t^(5yr-highest) × S_t^TH, capped at 20% of average
 * compensation. DBAB Q 9:29–9:36; IRC §416(c); Treas. Reg. §1.416-1.
 */
function calcMinimumBenefit(ctx, p) {
    void ctx;
    if (p.topHeavy !== undefined) {
        if (!isNonNegativeDecimal(p.topHeavy.fiveYearAvgComp) || !isNonNegativeDecimal(p.topHeavy.topHeavyService)) {
            return indeterminate(["top-heavy average compensation and top-heavy service must be non-negative decimals"], ["the 5-year highest average compensation and top-heavy service"]);
        }
        const uncapped = (0, decimal_1.decMultiply)((0, decimal_1.decMultiply)("0.02", p.topHeavy.fiveYearAvgComp), p.topHeavy.topHeavyService);
        const cap = (0, decimal_1.decMultiply)("0.20", p.topHeavy.fiveYearAvgComp);
        const thAnnual = (0, decimal_1.decCompare)(uncapped, cap) > 0 ? cap : uncapped;
        const thMonthly = makeBenefit(ctx, monthlyMoneyOfAnnual(ctx.rounding, thAnnual), "monthly", undefined, "independent-calculation");
        const thResult = {
            kind: "exact",
            value: thMonthly,
            evidenceGrade: "fact",
        };
        return (0, compose_1.combineResults)([p.formulaBenefit, thResult], "greater-of");
    }
    if (p.topHeavyServiceRange !== undefined) {
        return indeterminate(["top-heavy service range supplied without the 5-year average compensation"], ["the 5-year highest average compensation"]);
    }
    return (0, compose_1.combineResults)([p.formulaBenefit, p.minimumBenefit], "greater-of");
}
/**
 * C-04 — Grandfathered benefit protections (IRC §411(d)(6)).
 * B_t = max(B_t^current-formula, B_t^protected), subject to the plan's
 * wear-away method. IRC §411(d)(6); DBAB Q 9:14; Q 9:27; PBGC current
 * policies Ex. 17. If the pre-amendment benefit cannot be computed, the
 * bound is [earliest documented accrued benefit, current-formula benefit
 * on the most generous plausible old terms].
 */
function calcGrandfathered(ctx, p) {
    void ctx;
    void p.amendment;
    if (p.protectedBenefit.kind === "indeterminate") {
        if (p.earliestDocumentedBenefit !== undefined && p.protectedBenefitUpper !== undefined) {
            const lo = (0, compose_1.combineResults)([p.earliestDocumentedBenefit], "greater-of");
            const hi = (0, compose_1.combineResults)([p.currentBenefit, p.protectedBenefitUpper], "greater-of");
            if (lo.kind === "exact" && hi.kind === "exact") {
                return {
                    kind: "bound",
                    min: { ...lo.value, source: "bound" },
                    max: { ...hi.value, source: "bound" },
                    evidenceGrade: "estimate",
                    missingInputs: p.protectedBenefit.missingInputs,
                };
            }
            if (lo.kind === "exact" && hi.kind === "bound") {
                return {
                    kind: "bound",
                    min: { ...lo.value, source: "bound" },
                    max: hi.max,
                    evidenceGrade: "estimate",
                    missingInputs: p.protectedBenefit.missingInputs,
                };
            }
        }
        return indeterminate(p.protectedBenefit.missingInputs, p.protectedBenefit.wouldResolve);
    }
    // Delegates to the composition engine's Protect layer.
    return (0, compose_1.applyProtection)(p.currentBenefit, p.protectedBenefit, {
        method: p.wearAwayMethod ?? "greater-of",
        postAmendmentAccrual: p.postAmendmentAccrual ?? null,
        ruleRef: "IRC §411(d)(6)",
    });
}
/**
 * C-05 — Transitional formulas following plan amendments (fresh-start).
 * Method 1 — without wear-away: B_t = B^frozen + B^post-fresh-start.
 * Method 2 — with wear-away: B_t = max(B^frozen, B^current-on-total).
 * Method 3 — extended wear-away: B_t = max(Method 1, Method 2).
 * DBAB Q 9:50–9:52; Treas. Reg. §1.401(a)(17)-1(e)(5). The frozen benefit
 * is a fixed anchor — it is not re-rounded when combining. If the plan's
 * elected method is unknown, all three methods are returned as scenarios.
 */
function calcFreshStart(ctx, p) {
    void ctx;
    void p.freshStartDate;
    const frozen = p.frozenBenefit.kind === "indeterminate" && p.frozenBenefitStated !== undefined
        ? p.frozenBenefitStated
        : p.frozenBenefit;
    if (frozen.kind === "indeterminate") {
        return indeterminate(frozen.missingInputs, frozen.wouldResolve);
    }
    const method1 = (0, compose_1.combineResults)([frozen, p.postFreshStartAccrual], "sum");
    const method2 = (0, compose_1.combineResults)([frozen, p.totalServiceBenefit], "greater-of");
    if (p.method === undefined) {
        const scenarios = [];
        for (const [name, result] of [
            ["without wear-away", method1],
            ["with wear-away", method2],
        ]) {
            if (result.kind === "exact") {
                scenarios.push(namedScenario({
                    name,
                    value: { ...result.value, source: "scenario" },
                    basis: name,
                    formulaId: "C-05",
                    inputs: [{ field: "freshStartMethod", value: name }],
                    ruleRef: "C-05 fresh start (DBAB Q 9:50–9:52; Treas. Reg. §1.401(a)(17)-1(e)(5))",
                }));
            }
        }
        const method3 = (0, compose_1.combineResults)([method1, method2], "greater-of");
        if (method3.kind === "exact") {
            scenarios.push(namedScenario({
                name: "extended wear-away",
                value: { ...method3.value, source: "scenario" },
                basis: "extended wear-away",
                formulaId: "C-05",
                inputs: [{ field: "freshStartMethod", value: "extended wear-away" }],
                ruleRef: "C-05 fresh start (DBAB Q 9:50–9:52; Treas. Reg. §1.401(a)(17)-1(e)(5))",
            }));
        }
        if (scenarios.length === 0) {
            return indeterminate(["no fresh-start method could be evaluated"], ["the frozen benefit and the post-fresh-start accruals"]);
        }
        return { kind: "scenarios", scenarios, evidenceGrade: "estimate", missingInputs: ["the plan's elected fresh-start method"] };
    }
    if (p.method === "without-wear-away")
        return method1;
    if (p.method === "with-wear-away")
        return method2;
    return (0, compose_1.combineResults)([method1, method2], "greater-of");
}
/**
 * C-06 — Multiple accrual formulas by period.
 * B_t = Σ_p F_p(C̄_t^(p), S_{t,p}). Each period's formula applies to
 * service in that period; a new formula does not re-price earlier periods
 * except through a stated fresh-start or grandfathering rule (C-04/C-05).
 * Amendment adoption date ≠ effective date — the period split uses the
 * effective date. DBAB Ch. 9; Blonder-Tongue plan §5.01.
 */
function calcMultiplePeriods(ctx, p) {
    if (p.periods.length === 0 && (p.missingPeriods === undefined || p.missingPeriods.length === 0)) {
        return indeterminate(["no accrual periods supplied"], ["the plan's formula-change periods"]);
    }
    const sorted = [...p.periods].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    let periods = sorted;
    if (p.serviceCap !== undefined) {
        const totalService = sorted.reduce((acc, per) => (0, decimal_1.decAdd)(acc, per.service), "0");
        if ((0, decimal_1.decCompare)(totalService, p.serviceCap.cap) > 0) {
            let excess = (0, decimal_1.decSubtract)(totalService, p.serviceCap.cap);
            const kept = p.serviceCap.whichYears === "last-n"
                ? [...sorted].reverse()
                : [...sorted];
            const adjusted = new Map();
            for (const per of kept) {
                if ((0, decimal_1.decCompare)(excess, "0") <= 0)
                    break;
                const cut = (0, decimal_1.decCompare)(per.service, excess) > 0 ? excess : per.service;
                adjusted.set(per.from, (0, decimal_1.decSubtract)(per.service, cut));
                excess = (0, decimal_1.decSubtract)(excess, cut);
            }
            periods = sorted.map((per) => {
                const adj = adjusted.get(per.from);
                return adj === undefined ? per : { ...per, service: adj };
            });
        }
    }
    const results = [];
    for (const per of periods) {
        if (!isNonNegativeDecimal(per.service) || !isNonNegativeDecimal(per.comp)) {
            return indeterminate([`period ${per.from} service or compensation is missing or negative`], [`service and compensation for the period from ${per.from}`]);
        }
        results.push(per.formula(ctx, per.service, per.comp));
    }
    let total = (0, compose_1.combineResults)(results, "sum");
    if (p.missingPeriods !== undefined && p.missingPeriods.length > 0) {
        const maxMissing = p.missingPeriods.reduce((acc, m) => (0, decimal_1.decAdd)(acc, (0, decimal_1.decMultiply)(m.maxPlausibleRate, m.service)), "0");
        if (total.kind === "exact") {
            const reference = total.value;
            const lo = total.value.amount;
            if (lo !== null) {
                const hiMoney = moneyOf(ctx.rounding, (0, decimal_1.decAdd)((0, decimal_1.moneyMinorToDecimalString)(lo.amountMinor), maxMissing));
                return {
                    kind: "bound",
                    min: { ...reference, source: "bound" },
                    max: { ...reference, amount: hiMoney, source: "bound" },
                    evidenceGrade: "estimate",
                    missingInputs: ["a period formula is missing"],
                };
            }
        }
        if (total.kind === "bound") {
            const hiMoney = moneyOf(ctx.rounding, (0, decimal_1.decAdd)((0, decimal_1.moneyMinorToDecimalString)(total.max.amount?.amountMinor ?? 0), maxMissing));
            return {
                ...total,
                max: { ...total.max, amount: hiMoney },
                missingInputs: [...total.missingInputs, "a period formula is missing"],
            };
        }
        return total;
    }
    return total;
}
/**
 * C-07 — Union / nonunion / group-specific formulas.
 * B_t = F_{g(i)}(X_i(≤t), P(≤t)). A group transfer moves the participant
 * to the new group's formula prospectively; prior service stays under the
 * old group's formula unless the plan says otherwise. DBAB Q 9:13;
 * Q 10:16; Ch. 7.
 */
function calcGroupSpecific(ctx, p) {
    if (p.groupHistory.length === 0 && (p.possibleGroupsForUnknownService === undefined || p.possibleGroupsForUnknownService.length === 0)) {
        return indeterminate(["no group history supplied"], ["the participant's employment-group history"]);
    }
    const results = [];
    for (const segment of p.groupHistory) {
        const formula = p.groupFormulas[segment.groupId];
        if (formula === undefined) {
            return indeterminate([`no formula supplied for group ${segment.groupId}`], [`the benefit formula for group ${segment.groupId}`]);
        }
        if (!isNonNegativeDecimal(segment.service) || !isNonNegativeDecimal(segment.comp)) {
            return indeterminate([`group segment ${segment.groupId} service or compensation is missing or negative`], [`service and compensation for the ${segment.groupId} segment`]);
        }
        results.push(formula(ctx, segment.service, segment.comp));
    }
    if (p.possibleGroupsForUnknownService !== undefined && p.possibleGroupsForUnknownService.length > 0) {
        for (const unknown of p.possibleGroupsForUnknownService) {
            const options = [];
            for (const groupId of unknown.groupIds) {
                const formula = p.groupFormulas[groupId];
                if (formula === undefined)
                    continue;
                options.push(formula(ctx, unknown.service, unknown.comp));
            }
            if (options.length === 0) {
                return indeterminate(["no formula supplied for any plausible group for unknown service"], ["the benefit formula for the plausible groups"]);
            }
            const exacts = options.filter((o) => o.kind === "exact");
            if (exacts.length !== options.length) {
                return indeterminate(["a plausible group's formula could not be evaluated for the unknown service"], ["the formulas for the plausible groups"]);
            }
            const minors = exacts.map((o) => (o.kind === "exact" ? o.value.amount?.amountMinor ?? null : null));
            if (minors.some((m) => m === null)) {
                return indeterminate(["a plausible group's benefit carries no amount"], ["amounts for the plausible groups"]);
            }
            const reference = exacts[0].value;
            results.push({
                kind: "bound",
                min: { ...reference, amount: (0, decimal_1.makeMoney)(Math.min(...minors)), source: "bound" },
                max: { ...reference, amount: (0, decimal_1.makeMoney)(Math.max(...minors)), source: "bound" },
                evidenceGrade: "estimate",
                missingInputs: ["employment group for part of the service"],
            });
        }
    }
    return (0, compose_1.combineResults)(results, p.combine);
}
/**
 * S-01 — Cash balance plans. Hypothetical account:
 * H_t = Σ_y [PC_y × Π_{k>y} (1 + i_k)], rolled forward year by year as
 * balance = balance × (1 + i_y) + PC_y. Accrued benefit (monthly, at NRA):
 * B_t = H_t × (1 + i)^(NRA − age_t) / APR_NRA, projecting with interest
 * credits only, not future pay credits. DBAB Ch. 18 (Q 18:1–18:6,
 * Q 18:24–18:26); Q 27:6; IRC §411(a)(13), §411(b)(5);
 * Treas. Reg. §1.411(b)(5)-1. Conversion protection: the prior accrued
 * benefit becomes the opening balance; wear-away on conversion is the
 * classic failure.
 */
function calcCashBalance(ctx, p) {
    if (p.openingBalanceUnknown === true) {
        return indeterminate(["opening balance on conversion from a traditional formula is unknown"], ["the conversion amendment stating the opening balance"]);
    }
    if (!isNonNegativeDecimal(p.aprAtNra) || (0, decimal_1.decCompare)(p.aprAtNra, "0") === 0) {
        return indeterminate(["APR at NRA must be a positive decimal"], ["the plan's APR at NRA"]);
    }
    if (!isNonNegativeDecimal(p.ageAtMeasurement) || !isNonNegativeDecimal(p.normalRetirementAge)) {
        return indeterminate(["age at measurement and NRA must be non-negative decimals"], ["the participant's age and the normal retirement age"]);
    }
    const rates = new Map();
    for (const r of p.interestRates) {
        if (!isNonNegativeDecimal(r.rate)) {
            return indeterminate([`interest-crediting rate for ${r.year} is missing or negative`], [`the interest-crediting rate for ${r.year}`]);
        }
        rates.set(r.year, r.rate);
    }
    const credits = [...p.payCredits].sort((a, b) => a.year - b.year);
    let balance = p.openingBalance !== undefined ? p.openingBalance : "0";
    if (!isNonNegativeDecimal(balance)) {
        return indeterminate(["opening balance must be a non-negative decimal"], ["the opening balance"]);
    }
    for (const pc of credits) {
        if (!isNonNegativeDecimal(pc.credit)) {
            return indeterminate([`pay credit for ${pc.year} is missing or negative`], [`the pay credit for ${pc.year}`]);
        }
        const rate = rates.get(pc.year);
        if (rate === undefined) {
            return indeterminate([`interest-crediting rate for ${pc.year} is not loaded`], [`the interest-crediting history for ${pc.year}`]);
        }
        balance = (0, decimal_1.decAdd)((0, decimal_1.decMultiply)(balance, (0, decimal_1.decAdd)("1", rate)), pc.credit);
    }
    const yearsToNra = (0, decimal_1.decSubtract)(p.normalRetirementAge, p.ageAtMeasurement);
    if ((0, decimal_1.decCompare)(yearsToNra, "0") < 0) {
        return indeterminate(["age at measurement is past the normal retirement age"], ["the projection to NRA"]);
    }
    const projectionRate = p.terminationDate !== undefined && p.fiveYearAvgRate !== undefined
        ? p.fiveYearAvgRate
        : (() => {
            const last = credits[credits.length - 1];
            if (last === undefined)
                return "0";
            return rates.get(last.year) ?? "0";
        })();
    const growth = powInteger((0, decimal_1.decAdd)("1", projectionRate), yearsToNra);
    if (growth === null) {
        return indeterminate(["years from measurement to NRA must be a whole number for the interest projection"], ["a whole number of years from measurement to NRA"]);
    }
    const projected = (0, decimal_1.decMultiply)(balance, growth);
    const monthly = (0, decimal_1.decDivide)(projected, p.aprAtNra, 10);
    if ((0, decimal_1.decCompare)(monthly, "0") < 0)
        return negativeRefused(monthly, "S-01");
    return exactResult(ctx, moneyOf(ctx.rounding, monthly), "monthly", p.basis);
}
/** The pension-equity lump-sum value L_t = κ_t × C̄_t^FAC, exactly. */
function pensionEquityLumpSum(p) {
    let kappa = "0";
    for (const c of p.percentageCredits) {
        if (!isNonNegativeDecimal(c.points))
            return null;
        kappa = (0, decimal_1.decAdd)(kappa, c.points);
    }
    if (!isNonNegativeDecimal(p.finalAvgComp))
        return null;
    return (0, decimal_1.decMultiply)(kappa, p.finalAvgComp);
}
/**
 * S-02 — Pension equity plans (PEP). Accumulated percentage
 * κ_t = Σ_y κ_y. Lump-sum value L_t = κ_t × C̄_t^FAC. Annuity
 * B_t = L_t / APR_NRA (monthly). IRC §411(a)(13)(C); DBAB Q 9:15. The
 * accumulated PEP benefit may decline when final average compensation
 * declines — the one design where a falling accrued benefit is expected
 * behaviour. If the conversion factors are unknown, the lump-sum value is
 * reported exactly (see pensionEquityLumpSum) and the annuity is bounded
 * over the plausible APR range.
 */
function calcPensionEquity(ctx, p) {
    const lumpSum = pensionEquityLumpSum(p);
    if (lumpSum === null) {
        return indeterminate(["percentage credits or final average compensation are missing or negative"], ["the annual percentage credits and final average compensation"]);
    }
    if (p.aprAtNra === null || p.aprAtNra === undefined) {
        if (p.aprRange !== undefined) {
            if (!isNonNegativeDecimal(p.aprRange.low) || !isNonNegativeDecimal(p.aprRange.high)
                || (0, decimal_1.decCompare)(p.aprRange.low, "0") === 0) {
                return indeterminate(["APR range bounds must be positive decimals"], ["the plausible APR range at NRA"]);
            }
            return {
                kind: "bound",
                min: makeBenefit(ctx, moneyOf(ctx.rounding, (0, decimal_1.decDivide)(lumpSum, p.aprRange.high, 10)), "monthly", p.basis, "bound"),
                max: makeBenefit(ctx, moneyOf(ctx.rounding, (0, decimal_1.decDivide)(lumpSum, p.aprRange.low, 10)), "monthly", p.basis, "bound"),
                evidenceGrade: "estimate",
                missingInputs: ["annuity conversion factor (APR at NRA)"],
            };
        }
        return indeterminate(["annuity conversion factor (APR at NRA) is unknown; lump-sum value is exactly $" + lumpSum], ["the plan's annuity conversion factors at NRA"]);
    }
    if (!isNonNegativeDecimal(p.aprAtNra) || (0, decimal_1.decCompare)(p.aprAtNra, "0") === 0) {
        return indeterminate(["APR at NRA must be a positive decimal"], ["the plan's APR at NRA"]);
    }
    const monthly = (0, decimal_1.decDivide)(lumpSum, p.aprAtNra, 10);
    if ((0, decimal_1.decCompare)(monthly, "0") < 0)
        return negativeRefused(monthly, "S-02");
    return exactResult(ctx, moneyOf(ctx.rounding, monthly), "monthly", p.basis);
}
/**
 * S-03 — Other statutory hybrid arrangements (target benefit and
 * floor-offset hybrids). Target benefit: B_t = B^target × (S_t / S_t^proj)
 * (fractional) or as the plan defines. Contributions do NOT define the
 * benefit — a low contribution year does not reduce the accrued benefit.
 * DBAB Ch. 4 (Q 4:8–4:14; Q 4:15–4:31; Q 4:32+); IRC §411(a)(13).
 * If the accrual method is unstated, fractional vs unit-credit are
 * returned as scenarios (for a fixed target benefit the amounts coincide;
 * the method stays unresolved).
 */
function calcOtherHybrid(ctx, p) {
    if (p.hybridKind === "floor-offset-hybrid" || p.hybridKind === "cash-balance-as-floor") {
        if (p.floorOffset === undefined) {
            return indeterminate(["floor-offset inputs are required for this hybrid kind"], ["the floor-offset inputs (as I-05)"]);
        }
        return calcPlanOffset(ctx, p.floorOffset);
    }
    if (p.targetBenefit === undefined || p.service === undefined || p.projectedService === undefined) {
        return indeterminate(["target benefit, service, and projected service are required for a target-benefit plan"], ["the target benefit at NRA, service S_t, and projected service S_t^proj"]);
    }
    if (!isNonNegativeDecimal(p.targetBenefit) || !isNonNegativeDecimal(p.service)
        || !isNonNegativeDecimal(p.projectedService) || (0, decimal_1.decCompare)(p.projectedService, "0") === 0) {
        return indeterminate(["target benefit, service, and projected service must be non-negative decimals with positive projected service"], ["the target benefit, service, and projected service"]);
    }
    const annual = (0, decimal_1.decMultiply)(p.targetBenefit, (0, decimal_1.decDivide)(p.service, p.projectedService, 10));
    const monthly = monthlyMoneyOfAnnual(ctx.rounding, annual);
    if (p.accrualMethod === undefined) {
        return {
            kind: "scenarios",
            scenarios: [
                namedScenario({
                    name: "fractional accrual",
                    value: makeBenefit(ctx, monthly, "monthly", p.basis, "scenario"),
                    basis: "fractional accrual method",
                    formulaId: "S-03",
                    inputs: [
                        { field: "accrualMethod", value: "fractional" },
                        { field: "targetBenefit", value: p.targetBenefit },
                        { field: "service", value: p.service },
                        { field: "projectedService", value: p.projectedService },
                    ],
                    ruleRef: "S-03 target-benefit hybrid (DBAB Ch. 4; IRC §411(a)(13))",
                }),
                namedScenario({
                    name: "unit-credit accrual",
                    value: makeBenefit(ctx, monthly, "monthly", p.basis, "scenario"),
                    basis: "unit-credit accrual method",
                    formulaId: "S-03",
                    inputs: [
                        { field: "accrualMethod", value: "unit-credit" },
                        { field: "targetBenefit", value: p.targetBenefit },
                        { field: "service", value: p.service },
                        { field: "projectedService", value: p.projectedService },
                    ],
                    ruleRef: "S-03 target-benefit hybrid (DBAB Ch. 4; IRC §411(a)(13))",
                }),
            ],
            evidenceGrade: "estimate",
            missingInputs: ["the plan's stated accrual method for the target benefit"],
        };
    }
    if ((0, decimal_1.decCompare)(annual, "0") < 0)
        return negativeRefused(annual, "S-03");
    return exactResult(ctx, monthly, "monthly", p.basis);
}
/**
 * S-04 — Contributory defined-benefit plans. Total accrued benefit
 * B_t^total split into B_t^ee (from mandatory employee contributions,
 * S-05) and B_t^er = max(B_t^total − B_t^ee, 0). Only the employer portion
 * is subject to vesting (DBAB Q 9:56). This function returns the EMPLOYER
 * portion (B_t^er); the total is an input. DBAB Q 9:53–9:56;
 * IRC §411(c)(1)–(2). If the contribution history is missing, the
 * employee portion is bounded by [0, B_t^total] and the split is
 * indeterminate — but the total may still be verifiable.
 */
function calcContributory(ctx, p) {
    void ctx;
    if (p.totalBenefit.kind === "indeterminate") {
        return indeterminate(p.totalBenefit.missingInputs, p.totalBenefit.wouldResolve);
    }
    if (p.employeePortion.kind === "indeterminate") {
        if (p.totalBenefit.kind === "exact") {
            const total = p.totalBenefit.value.amount;
            if (total !== null) {
                return {
                    kind: "bound",
                    min: { ...p.totalBenefit.value, amount: (0, decimal_1.makeMoney)(0), source: "bound" },
                    max: { ...p.totalBenefit.value, source: "bound" },
                    evidenceGrade: "estimate",
                    missingInputs: p.employeePortion.missingInputs,
                };
            }
        }
        return indeterminate(p.employeePortion.missingInputs, p.employeePortion.wouldResolve);
    }
    const employer = (0, compose_1.combineResults)([p.totalBenefit, p.employeePortion], "sum");
    void employer;
    // Employer portion = total − employee portion (not a sum): compute directly.
    const totalMinor = p.totalBenefit.kind === "exact"
        ? p.totalBenefit.value.amount?.amountMinor ?? null
        : p.totalBenefit.kind === "bound"
            ? p.totalBenefit.max.amount?.amountMinor ?? null
            : null;
    const eeMinor = p.employeePortion.kind === "exact"
        ? p.employeePortion.value.amount?.amountMinor ?? null
        : p.employeePortion.kind === "bound"
            ? p.employeePortion.max.amount?.amountMinor ?? null
            : null;
    if (totalMinor === null || eeMinor === null) {
        return indeterminate(["total benefit or employee portion carries no amount"], ["amounts for the total benefit and the employee portion"]);
    }
    const reference = p.totalBenefit.kind === "exact"
        ? p.totalBenefit.value
        : p.totalBenefit.max;
    const net = Math.max(totalMinor - eeMinor, 0);
    if (p.totalBenefit.kind === "bound" || p.employeePortion.kind === "bound") {
        const totalMin = p.totalBenefit.kind === "bound"
            ? p.totalBenefit.min.amount?.amountMinor ?? totalMinor
            : totalMinor;
        const eeMax = p.employeePortion.kind === "bound"
            ? p.employeePortion.max.amount?.amountMinor ?? eeMinor
            : eeMinor;
        return {
            kind: "bound",
            min: { ...reference, amount: (0, decimal_1.makeMoney)(Math.max(totalMin - eeMax, 0)), source: "bound" },
            max: { ...reference, amount: (0, decimal_1.makeMoney)(net), source: "bound" },
            evidenceGrade: "estimate",
            missingInputs: [
                ...(p.totalBenefit.kind === "bound" ? p.totalBenefit.missingInputs : []),
                ...(p.employeePortion.kind === "bound" ? p.employeePortion.missingInputs : []),
            ],
        };
    }
    return {
        kind: "exact",
        value: { ...reference, amount: (0, decimal_1.makeMoney)(net) },
        evidenceGrade: "fact",
    };
}
/**
 * S-05 — Employee-contribution accounts / offsets (IRC §411(c)).
 * Accumulated contributions at NRA: AC_NRA = Σ_y c_y × Π (1 + r_k), with
 * r = 5% compounded annually before the first plan year beginning after
 * 1987-12-31; r = 120% of the federal midterm rate from then to the
 * determination date; r = §417(e) applicable rate from the determination
 * date to NRA. Employee benefit: B_t^ee = AC_NRA / APR_417(e) (monthly).
 * Employer benefit: B_t^er = max(B_t^total − B_t^ee, 0). This function
 * returns the EMPLOYEE portion (B_t^ee). DBAB Q 9:53–9:56 (Diane example);
 * IRC §411(c)(2)(B)–(C); Treas. Reg. §1.417(e)-1(d)(1). The §417(e) figure
 * is a floor: the converted benefit using plan factors can never be less
 * than the benefit using §417(e) rates.
 */
function calcEmployeeContributionBenefit(ctx, p) {
    if (!isNonNegativeDecimal(p.section417eRate) || !isNonNegativeDecimal(p.apr417e)
        || (0, decimal_1.decCompare)(p.apr417e, "0") === 0 || !isNonNegativeDecimal(p.totalBenefit)) {
        return indeterminate(["§417(e) rate, APR, and total benefit must be non-negative decimals with a positive APR"], ["the §417(e) applicable rate, the §417(e) APR, and the total benefit"]);
    }
    const fmr = new Map();
    for (const r of p.federalMidtermRates) {
        if (!isNonNegativeDecimal(r.rate)) {
            return indeterminate([`federal midterm rate for ${r.year} is missing or negative`], [`the federal midterm rate for ${r.year}`]);
        }
        fmr.set(r.year, r.rate);
    }
    let accumulated = "0";
    for (const c of p.contributions) {
        if (!isNonNegativeDecimal(c.amount)) {
            return indeterminate([`mandatory contribution for ${c.year} is missing or negative`], [`the mandatory contributions for ${c.year}`]);
        }
        let value = c.amount;
        for (let y = c.year; y < p.nraYear; y += 1) {
            let rate;
            if (y < 1988) {
                rate = "0.05";
            }
            else if (y < p.determinationYear) {
                const f = fmr.get(y);
                if (f === undefined) {
                    return indeterminate([`federal midterm rate for ${y} is not loaded`], [`the federal midterm rate table for ${y}`]);
                }
                rate = (0, decimal_1.decMultiply)("1.2", f);
            }
            else {
                rate = p.section417eRate;
            }
            value = (0, decimal_1.decMultiply)(value, (0, decimal_1.decAdd)("1", rate));
        }
        accumulated = (0, decimal_1.decAdd)(accumulated, value);
    }
    const monthly = (0, decimal_1.decDivide)(accumulated, p.apr417e, 10);
    if ((0, decimal_1.decCompare)(monthly, "0") < 0)
        return negativeRefused(monthly, "S-05");
    return exactResult(ctx, moneyOf(ctx.rounding, monthly), "monthly", p.basis);
}
/**
 * S-06 — Frozen and partially frozen plans. Hard freeze (DBAB Q 26:4):
 * B_t = F(X_i(≤ t_freeze), P(≤ t_freeze)) for all t ≥ t_freeze. Soft
 * freeze, closed to new entrants (Q 26:3): existing participants continue
 * accruing normally. Soft freeze, accrual rate zero but compensation
 * grows (Q 26:3): B_t = α × C̄_t × S_{t_freeze}. DBAB Ch. 26;
 * IRC §411(d)(6); ERISA §204(h). A freeze may not take away benefits
 * already accrued. For t > t_freeze, verify no post-freeze service or
 * compensation leaked into a hard-frozen benefit.
 */
function calcFrozen(ctx, p) {
    void ctx;
    if (p.freezeTypeUnknown === true) {
        const scenarios = [];
        const hard = calcFrozen(ctx, { ...p, freezeType: "hard", freezeTypeUnknown: undefined });
        if (hard.kind === "exact") {
            scenarios.push(namedScenario({
                name: "hard freeze",
                value: { ...hard.value, source: "scenario" },
                basis: "hard freeze at " + p.freezeDate,
                formulaId: "S-06",
                inputs: [
                    { field: "freezeType", value: "hard" },
                    { field: "freezeDate", value: p.freezeDate },
                ],
                ruleRef: "S-06 frozen plan, hard freeze (DBAB Q 26:4)",
            }));
        }
        const closed = p.liveBenefit !== undefined
            ? calcFrozen(ctx, { ...p, freezeType: "closed-to-new-entrants", freezeTypeUnknown: undefined })
            : null;
        if (closed !== null && closed.kind === "exact") {
            scenarios.push(namedScenario({
                name: "closed to new entrants",
                value: { ...closed.value, source: "scenario" },
                basis: "soft freeze, closed to new entrants",
                formulaId: "S-06",
                inputs: [
                    { field: "freezeType", value: "closed-to-new-entrants" },
                    { field: "freezeDate", value: p.freezeDate },
                ],
                ruleRef: "S-06 frozen plan, soft freeze closed to new entrants (DBAB Q 26:3)",
            }));
        }
        const compGrows = calcFrozen(ctx, { ...p, freezeType: "rate-zero-comp-grows", freezeTypeUnknown: undefined });
        if (compGrows.kind === "exact") {
            scenarios.push(namedScenario({
                name: "rate zero, compensation grows",
                value: { ...compGrows.value, source: "scenario" },
                basis: "soft freeze, accrual rate zero",
                formulaId: "S-06",
                inputs: [
                    { field: "freezeType", value: "rate-zero-comp-grows" },
                    { field: "freezeDate", value: p.freezeDate },
                ],
                ruleRef: "S-06 frozen plan, accrual rate zero (DBAB Q 26:3)",
            }));
        }
        if (scenarios.length === 0) {
            return indeterminate(["no freeze variant could be evaluated"], ["the benefit at the freeze date and the live-formula benefit"]);
        }
        return { kind: "scenarios", scenarios, evidenceGrade: "estimate", missingInputs: ["freeze type"] };
    }
    if (p.freezeType === "hard")
        return p.benefitAtFreeze;
    if (p.freezeType === "closed-to-new-entrants") {
        if (p.liveBenefit === undefined) {
            return indeterminate(["live-formula benefit is required for the closed-to-new-entrants freeze"], ["the benefit under the live formula at the measurement date"]);
        }
        return p.liveBenefit;
    }
    if (p.currentAvgComp === undefined || p.frozenService === undefined || p.accrualRate === undefined) {
        return indeterminate(["current average compensation, frozen service, and the accrual rate are required for the rate-zero-comp-grows freeze"], ["current average compensation C̄_t, frozen service S_{t_freeze}, and α"]);
    }
    if (!isNonNegativeDecimal(p.currentAvgComp) || !isNonNegativeDecimal(p.frozenService)
        || !isNonNegativeDecimal(p.accrualRate.value)) {
        return indeterminate(["current average compensation, frozen service, and accrual rate must be non-negative decimals"], ["C̄_t, S_{t_freeze}, and α"]);
    }
    const annual = (0, decimal_1.decMultiply)((0, decimal_1.decMultiply)(p.accrualRate.value, p.currentAvgComp), p.frozenService);
    if ((0, decimal_1.decCompare)(annual, "0") < 0)
        return negativeRefused(annual, "S-06");
    return exactResult(ctx, monthlyMoneyOfAnnual(ctx.rounding, annual), "monthly", p.basis);
}
/**
 * S-07 — Special past-service credits. B_t = F(C̄_t, S_t^current + S^past).
 * DBAB Q 9:19; Q 9:20 (§415); Q 9:22 (excluding service before a date);
 * Treas. Reg. §1.401(a)(4)-5(a)(3). §415: the dollar limit's participation
 * numerator is never less than 1.
 */
function calcPastServiceCredit(ctx, p) {
    if (!isNonNegativeDecimal(p.currentService) || !isNonNegativeDecimal(p.avgComp)
        || !isNonNegativeDecimal(p.accrualRate.value)) {
        return indeterminate(["current service, average compensation, and accrual rate must be non-negative decimals"], ["current service, C̄_t, and α"]);
    }
    const benefitForPast = (past) => (0, decimal_1.decMultiply)((0, decimal_1.decMultiply)(p.accrualRate.value, p.avgComp), (0, decimal_1.decAdd)(p.currentService, past));
    if (p.pastServiceMax !== undefined) {
        if (!isNonNegativeDecimal(p.pastService) || !isNonNegativeDecimal(p.pastServiceMax)) {
            return indeterminate(["past service bounds must be non-negative decimals"], ["the past-service credit"]);
        }
        return {
            kind: "bound",
            min: makeBenefit(ctx, monthlyMoneyOfAnnual(ctx.rounding, benefitForPast(p.pastService)), "monthly", p.basis, "bound"),
            max: makeBenefit(ctx, monthlyMoneyOfAnnual(ctx.rounding, benefitForPast(p.pastServiceMax)), "monthly", p.basis, "bound"),
            evidenceGrade: "estimate",
            missingInputs: ["past-service credit"],
        };
    }
    if (!isNonNegativeDecimal(p.pastService)) {
        return indeterminate(["past service must be a non-negative decimal"], ["the past-service credit"]);
    }
    const annual = benefitForPast(p.pastService);
    if ((0, decimal_1.decCompare)(annual, "0") < 0)
        return negativeRefused(annual, "S-07");
    return exactResult(ctx, monthlyMoneyOfAnnual(ctx.rounding, annual), "monthly", p.basis);
}
/**
 * S-08 — Rehire and restoration provisions. Service after rehire:
 * S_t = S^pre-break (if restored) + S^post-rehire. A 1-year break (≤500
 * hours) suspends credit; pre-break service is restored after the
 * participant completes 1 year of service after rehire, with the 5-year
 * rule / rule of parity governing forfeiture of pre-break service for
 * nonvested participants. Restoration of a prior distribution: the
 * benefit is reinstated if the participant repaid the distribution plus
 * interest per the plan; otherwise the benefit is reduced by the
 * actuarial equivalent of the prior distributions. DBAB Ch. 7; Q 9:58–9:68;
 * ERISA §203 / IRC §411(a)(6); DOL Reg. §2530.203-3.
 */
function calcRehireRestoration(ctx, p) {
    const sorted = [...p.employmentPeriods].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    for (const per of sorted) {
        if (!isNonNegativeDecimal(per.serviceYears)) {
            return indeterminate([`service for the period from ${per.from} is missing or negative`], [`service for the period from ${per.from}`]);
        }
    }
    const totalService = sorted.reduce((acc, per) => (0, decimal_1.decAdd)(acc, per.serviceYears), "0");
    const breakByDate = new Map();
    for (const b of p.vestingStatusAtEachBreak)
        breakByDate.set(b.breakDate, b);
    // Restoration determination, period by period: pre-break service is
    // forfeited only for a nonvested participant whose break reaches 5 years
    // (the 5-year rule / rule of parity). A vested participant's pre-break
    // service is always restored.
    let restoredService = "0";
    let forfeitedService = "0";
    let previousEnd = null;
    for (const per of sorted) {
        if (previousEnd !== null) {
            const breakInfo = breakByDate.get(previousEnd);
            if (breakInfo !== undefined && !breakInfo.vested) {
                // Break length in whole years, from the prior period end to this start.
                const breakYears = breakYearsBetween(previousEnd, per.from);
                if (breakYears !== null && breakYears >= 5) {
                    forfeitedService = (0, decimal_1.decAdd)(forfeitedService, restoredService);
                    restoredService = "0";
                }
            }
        }
        restoredService = (0, decimal_1.decAdd)(restoredService, per.serviceYears);
        previousEnd = per.to;
    }
    const repaid = p.repaymentRestoresBenefit === true
        && p.repayments !== undefined && p.repayments.length > 0;
    const offset = !repaid && p.priorDistributionOffsetMonthly !== undefined
        ? p.priorDistributionOffsetMonthly
        : "0";
    if (!isNonNegativeDecimal(offset)) {
        return indeterminate(["prior-distribution offset must be a non-negative decimal"], ["the actuarial-equivalent offset of the prior distributions"]);
    }
    if ((0, decimal_1.decCompare)(forfeitedService, "0") > 0) {
        // NOTE (2026-11-12, bug fix): the two scenario values were swapped —
        // "restored" carried the post-forfeiture service (1 year, $45.83) and
        // "forfeited" carried total service (7 years, $320.83). Restored means
        // the pre-break service counts (total service); forfeited means only
        // the post-rehire service counts (restoredService after the forfeit).
        const restoredResult = p.underlying(totalService);
        const forfeitedResult = p.underlying(restoredService);
        const applyOffset = (r) => {
            if (r.kind !== "exact")
                return r;
            const amount = r.value.amount;
            if (amount === null)
                return r;
            const net = Math.max(amount.amountMinor - Number(moneyOf(ctx.rounding, offset).amountMinor), 0);
            return { ...r, value: { ...r.value, amount: (0, decimal_1.makeMoney)(net) } };
        };
        const restored = applyOffset(restoredResult);
        const forfeited = applyOffset(forfeitedResult);
        if (restored.kind === "exact" && forfeited.kind === "exact") {
            return {
                kind: "scenarios",
                scenarios: [
                    namedScenario({
                        name: "pre-break service restored",
                        value: { ...restored.value, source: "scenario" },
                        basis: "restoration after rehire",
                        formulaId: "S-08",
                        inputs: [
                            { field: "preBreakService", value: "restored" },
                            { field: "serviceYears", value: totalService },
                        ],
                        ruleRef: "S-08 rehire restoration (DBAB Q 7:44; 5-year break / rule of parity)",
                    }),
                    namedScenario({
                        name: "pre-break service forfeited",
                        value: { ...forfeited.value, source: "scenario" },
                        basis: "5-year break rule / rule of parity",
                        formulaId: "S-08",
                        inputs: [
                            { field: "preBreakService", value: "forfeited" },
                            { field: "serviceYears", value: restoredService },
                        ],
                        ruleRef: "S-08 rehire restoration (DBAB Q 7:44; 5-year break / rule of parity)",
                    }),
                ],
                evidenceGrade: "estimate",
                missingInputs: ["whether the pre-break service is restored or forfeited"],
            };
        }
        return restored;
    }
    const result = p.underlying(restoredService);
    if (result.kind !== "exact")
        return result;
    const amount = result.value.amount;
    if (amount === null)
        return result;
    const net = Math.max(amount.amountMinor - moneyOf(ctx.rounding, offset).amountMinor, 0);
    return { ...result, value: { ...result.value, amount: (0, decimal_1.makeMoney)(net) } };
}
/**
 * Whole years between two ISO dates (calendar method, floor — Stage 3
 * rule D-1.4: completed years, never days/365). REWIRED (Wave 3): the
 * real src/dates.ts `completedYMD` primitive replaces the local
 * floor(days/365) computation. The two agree on whole-year boundaries
 * (the S-08 pinned cases: 3-year and 5-year breaks) but differ just
 * short of an anniversary — e.g. 2016-01-01 → 2020-12-31 is 4 calendar
 * years, while floor(1826/365) says 5 — and the calendar reading is
 * the one D-1.4 states. Returns null when the span is not positive or
 * a date is not a valid ISO calendar date (the old null contract).
 */
function breakYearsBetween(from, to) {
    if (to <= from)
        return null;
    try {
        return (0, dates_1.completedYMD)(from, to).years;
    }
    catch {
        return null;
    }
}
/**
 * X-01 — IRC §415 maximum benefit limit.
 * B_t ≤ min(L$_t × max(YOP_t, 1)/10, 100% × C̄_t^(high-3) × max(YOS_t, 1)/10).
 * The dollar limit is reduced 1/10 per year of participation under 10;
 * the compensation limit 1/10 per year of service under 10; neither
 * denominator is ever below 1. Monthly, straight-life annuity at NRA.
 * DBAB Q 12:4–12:5, Q 12:13–12:22; IRC §415(b), (d);
 * Treas. Reg. §1.415(b)-1. Employee-contribution and rollover benefits are
 * excluded from the limit. The dollar limit increases in $5,000 multiples,
 * rounded down (IRC §415(d)(1)) — the table value supplied is used as stated.
 */
function applySection415Limit(ctx, p) {
    if (!isNonNegativeDecimal(p.formulaBenefit) || !isNonNegativeDecimal(p.high3AvgComp)
        || !isNonNegativeDecimal(p.yearsOfService)) {
        return indeterminate(["formula benefit, high-3 average compensation, and years of service must be non-negative decimals"], ["the formula benefit, high-3 average compensation, and years of service"]);
    }
    if (p.commencementAge !== undefined && (0, decimal_1.decCompare)(p.commencementAge, "65") !== 0) {
        return indeterminate(["§415 age adjustments apply when benefits begin before 62 or after 65 (DBAB Q 12:22) and the adjustment factors are not supplied"], ["the §415 age-adjustment factors for commencement at age " + p.commencementAge]);
    }
    if (p.dollarLimitTable === null || p.dollarLimitTable === undefined) {
        return indeterminate(["§415 dollar-limit table for the limitation year is not loaded"], ["the §415 dollar-limit table for the limitation year"]);
    }
    if (!isNonNegativeDecimal(p.dollarLimitTable.dollarLimitAnnual)) {
        return indeterminate(["§415 dollar limit must be a non-negative decimal"], ["the §415 dollar limit for the limitation year"]);
    }
    const capForYop = (yop) => {
        const yopFactor = (0, decimal_1.decDivide)((0, decimal_1.decCompare)(yop, "1") < 0 ? "1" : yop, "10", 10);
        const dollarCap = (0, decimal_1.decMultiply)(p.dollarLimitTable?.dollarLimitAnnual ?? "0", yopFactor);
        const yosFactor = (0, decimal_1.decDivide)((0, decimal_1.decCompare)(p.yearsOfService, "1") < 0 ? "1" : p.yearsOfService, "10", 10);
        const compCap = (0, decimal_1.decMultiply)(p.high3AvgComp, yosFactor);
        const annualCap = (0, decimal_1.decCompare)(dollarCap, compCap) <= 0 ? dollarCap : compCap;
        const monthlyCap = annualToMonthlyDecimal(annualCap);
        const formulaMonthly = p.formulaBenefit;
        return (0, decimal_1.decCompare)(formulaMonthly, monthlyCap) <= 0 ? formulaMonthly : monthlyCap;
    };
    if (p.yearsOfParticipationRange !== undefined) {
        if (!isNonNegativeDecimal(p.yearsOfParticipationRange.low)
            || !isNonNegativeDecimal(p.yearsOfParticipationRange.high)) {
            return indeterminate(["years-of-participation range bounds must be non-negative decimals"], ["the participation history"]);
        }
        // NOTE (2026-11-12, bug fix): lo/hi were swapped — capForYop(high YOP)
        // is the LARGER benefit (the cap binds less), so it is the max, not
        // the min. The bound is [cap at low YOP, cap at high YOP].
        const lo = capForYop(p.yearsOfParticipationRange.low);
        const hi = capForYop(p.yearsOfParticipationRange.high);
        return {
            kind: "bound",
            min: makeBenefit(ctx, moneyOf(ctx.rounding, lo), "monthly", p.basis, "bound"),
            max: makeBenefit(ctx, moneyOf(ctx.rounding, hi), "monthly", p.basis, "bound"),
            evidenceGrade: "estimate",
            missingInputs: ["years of participation"],
        };
    }
    if (!isNonNegativeDecimal(p.yearsOfParticipation)) {
        return indeterminate(["years of participation must be a non-negative decimal"], ["the participation history"]);
    }
    const capped = capForYop(p.yearsOfParticipation);
    if ((0, decimal_1.decCompare)(capped, "0") < 0)
        return negativeRefused(capped, "X-01");
    return exactResult(ctx, moneyOf(ctx.rounding, capped), "monthly", p.basis);
}
/**
 * X-02 — IRC §401(a)(17) compensation limit. A per-year input transform,
 * not a formula in its own right: C_y^used = min(C_y, L^comp_y), where
 * L^comp_y is the limit for the plan year beginning in calendar year y.
 * The cap is applied to years, not to the average (DBAB Q 9:50, Ex. 1).
 * Before 1989 the limit is deemed $200,000. A missing table year fails
 * loudly — never a neighbouring year's value. The EGTRRA retroactivity
 * election is a property of the table supplied: if the election is
 * undocumented, call this transform with both tables and treat the results
 * as scenarios at the call site. DBAB Q 9:46–9:52; IRC §401(a)(17);
 * Treas. Reg. §1.401(a)(17)-1; Notice 2001-56; Rev. Rul. 2003-11.
 */
function capCompensationYear(ctx, p) {
    void ctx;
    void p.egtrraRetroactivityElected;
    if (p.compLimitTable === null || p.compLimitTable === undefined) {
        throw new Error("capCompensationYear: §401(a)(17) table is not loaded — refusing, never substituting a neighbouring year");
    }
    const cappedByYear = [];
    for (const y of p.compByYear) {
        if (!isNonNegativeDecimal(y.comp)) {
            throw new Error(`capCompensationYear: compensation for ${y.year} is missing or negative`);
        }
        const limit = y.year < 1989
            ? "200000"
            : p.compLimitTable.limitsByYear[y.year];
        if (limit === undefined) {
            throw new Error(`capCompensationYear: §401(a)(17) table has no limit for ${y.year} — refusing, never substituting a neighbouring year`);
        }
        cappedByYear.push({
            year: y.year,
            comp: (0, decimal_1.decCompare)(y.comp, limit) <= 0 ? y.comp : limit,
        });
    }
    return { cappedByYear };
}
/**
 * X-03 — Form-of-payment and commencement-age conversion (actuarial
 * equivalence). Alternate form: B^alt = B^normal × APR^normal / APR^alt
 * (APR at the payment age). Alternate retirement age (mortality ignored
 * pre-retirement, per plan): B^early = B^NRA × APR^NRA × v^n / APR^early,
 * where v^n = (1+i)^(−n), n = years early. Both steps in sequence if both
 * apply (DBAB Q 9:24). Output: B4 (benefit payable at commencement) in the
 * elected form. This entry converts B1 to B4; it does not create an
 * accrued benefit. DBAB Q 9:23–9:28; BCV ATPBGC Add-ins (Jul 2024)
 * ERFAEQ / LRFAEQ / BFCFAEQ. Subsidised optional forms (DBAB Q 9:28) are
 * worth more than the actuarially equivalent benefit — the excess is an
 * employer subsidy, excluded from the accrued benefit for §411 purposes.
 */
function convertFormAndAge(ctx, p) {
    void p.toForm;
    void p.toSurvivorPct;
    void p.monthsCertain;
    void p.deferralMortality;
    void p.mortalityTable;
    if (!isNonNegativeDecimal(p.normalBenefit) || !isNonNegativeDecimal(p.interestRate)) {
        return indeterminate(["normal benefit and interest rate must be non-negative decimals"], ["the normal-form benefit B1 and the plan interest rate"]);
    }
    if (p.aprAlternatives !== undefined && p.aprAlternatives.length > 0) {
        const scenarios = [];
        for (const alt of p.aprAlternatives) {
            const one = convertFormAndAge(ctx, {
                ...p,
                aprNormal: alt.aprNormal,
                aprAlternate: alt.aprAlternate,
                aprAlternatives: undefined,
            });
            if (one.kind !== "exact")
                return one;
            scenarios.push(namedScenario({
                name: alt.label,
                value: { ...one.value, source: "scenario" },
                basis: alt.label,
                formulaId: "X-03",
                inputs: [
                    { field: "aprNormal", value: alt.aprNormal },
                    { field: "aprAlternate", value: alt.aprAlternate },
                    { field: "normalBenefit", value: p.normalBenefit },
                    { field: "interestRate", value: p.interestRate },
                ],
                ruleRef: "X-03 form/age conversion (DBAB Q 9:23–9:28; BCV ATPBGC Add-ins ERFAEQ/LRFAEQ/BFCFAEQ)",
            }));
        }
        return { kind: "scenarios", scenarios, evidenceGrade: "estimate", missingInputs: ["actuarial equivalence assumptions"] };
    }
    if (!isNonNegativeDecimal(p.aprNormal) || !isNonNegativeDecimal(p.aprAlternate)
        || (0, decimal_1.decCompare)(p.aprAlternate, "0") === 0) {
        return indeterminate(["APRs must be non-negative decimals with a positive alternate-form APR"], ["the plan's actuarial equivalence assumptions"]);
    }
    let benefit = p.normalBenefit;
    if (p.yearsEarly !== undefined) {
        if (p.aprAtNra === undefined || p.aprAtEarlyAge === undefined) {
            return indeterminate(["APR at NRA and APR at the early age are required for the age conversion"], ["the APRs at NRA and at the early commencement age"]);
        }
        if (!isNonNegativeDecimal(p.aprAtNra) || !isNonNegativeDecimal(p.aprAtEarlyAge)
            || (0, decimal_1.decCompare)(p.aprAtEarlyAge, "0") === 0 || !isNonNegativeDecimal(p.yearsEarly)) {
            return indeterminate(["age-conversion APRs and years early must be non-negative decimals with a positive early-age APR"], ["the APRs and years early for the age conversion"]);
        }
        const growth = powInteger((0, decimal_1.decAdd)("1", p.interestRate), p.yearsEarly);
        if (growth === null) {
            return indeterminate(["years early must be a whole number for the discount factor v^n"], ["a whole number of years early"]);
        }
        const discount = (0, decimal_1.decDivide)("1", growth, 10);
        benefit = (0, decimal_1.decDivide)((0, decimal_1.decMultiply)((0, decimal_1.decMultiply)(benefit, p.aprAtNra), discount), p.aprAtEarlyAge, 10);
    }
    benefit = (0, decimal_1.decDivide)((0, decimal_1.decMultiply)(benefit, p.aprNormal), p.aprAlternate, 10);
    if ((0, decimal_1.decCompare)(benefit, "0") < 0)
        return negativeRefused(benefit, "X-03");
    return exactResult(ctx, moneyOf(ctx.rounding, benefit), "monthly", p.basis);
}
/**
 * X-04 — Benefit accruals after normal retirement age.
 * Option 1 — additional accruals with suspension: B = F(S_t, C̄_t).
 * Option 2 — greater of: B = max(F(S_t, C̄_t), AE(B_NRA to t)).
 * Option 3 — additional accruals offset by benefits paid:
 *   B = F(S_t, C̄_t) − AE(payments made since NRA), floored at the benefit
 *   already in pay.
 * Output: monthly benefit in the normal form at the actual retirement date
 * (B4, not B1). DBAB Q 9:57–9:68; Prop. Treas. Reg. §1.411(b)-2(b)(4)(iv);
 * ERISA §203(a)(3)(B); DOL Reg. §2530.203-3. If the plan's elected option
 * is unknown, all three are returned as scenarios.
 */
function calcPostNra(ctx, p) {
    void p.aeBasis;
    if (!isNonNegativeDecimal(p.nraBenefit) || !isNonNegativeDecimal(p.currentFormulaBenefit)) {
        return indeterminate(["NRA benefit and current formula benefit must be non-negative decimals"], ["the NRA benefit and the current formula benefit"]);
    }
    const option1 = p.currentFormulaBenefit;
    const option2 = p.actuarialEquivalentOfNraBenefit !== undefined
        ? ((0, decimal_1.decCompare)(p.currentFormulaBenefit, p.actuarialEquivalentOfNraBenefit) >= 0
            ? p.currentFormulaBenefit
            : p.actuarialEquivalentOfNraBenefit)
        : null;
    const option3 = p.aeOfPaymentsSinceNra !== undefined
        ? (() => {
            const net = (0, decimal_1.decSubtract)(p.currentFormulaBenefit, p.aeOfPaymentsSinceNra);
            const floor = p.benefitAlreadyInPay ?? p.nraBenefit;
            return (0, decimal_1.decCompare)(net, floor) < 0 ? floor : net;
        })()
        : null;
    if (p.option === undefined) {
        const scenarios = [
            namedScenario({
                name: "suspension",
                value: makeBenefit(ctx, moneyOf(ctx.rounding, option1), "monthly", p.basis, "scenario"),
                basis: "Option 1 — additional accruals with suspension",
                formulaId: "X-04",
                inputs: [
                    { field: "postNraOption", value: "suspension" },
                    { field: "currentFormulaBenefit", value: p.currentFormulaBenefit },
                ],
                ruleRef: "X-04 post-NRA benefit (DBAB Q 9:57–9:68; ERISA §203(a)(3)(B))",
            }),
        ];
        if (option2 !== null) {
            scenarios.push(namedScenario({
                name: "greater-of",
                value: makeBenefit(ctx, moneyOf(ctx.rounding, option2), "monthly", p.basis, "scenario"),
                basis: "Option 2 — greater of accrual and AE of NRA benefit",
                formulaId: "X-04",
                inputs: [
                    { field: "postNraOption", value: "greater-of" },
                    { field: "currentFormulaBenefit", value: p.currentFormulaBenefit },
                    { field: "actuarialEquivalentOfNraBenefit", value: p.actuarialEquivalentOfNraBenefit ?? null },
                ],
                ruleRef: "X-04 post-NRA benefit (DBAB Q 9:57–9:68; ERISA §203(a)(3)(B))",
            }));
        }
        if (option3 !== null) {
            scenarios.push(namedScenario({
                name: "offset-by-payments",
                value: makeBenefit(ctx, moneyOf(ctx.rounding, option3), "monthly", p.basis, "scenario"),
                basis: "Option 3 — accruals offset by benefits paid",
                formulaId: "X-04",
                inputs: [
                    { field: "postNraOption", value: "offset-by-payments" },
                    { field: "currentFormulaBenefit", value: p.currentFormulaBenefit },
                    { field: "aeOfPaymentsSinceNra", value: p.aeOfPaymentsSinceNra ?? null },
                ],
                ruleRef: "X-04 post-NRA benefit (DBAB Q 9:57–9:68; ERISA §203(a)(3)(B))",
            }));
        }
        return { kind: "scenarios", scenarios, evidenceGrade: "estimate", missingInputs: ["the plan's elected post-NRA option"] };
    }
    if (p.option === "suspension") {
        return exactResult(ctx, moneyOf(ctx.rounding, option1), "monthly", p.basis);
    }
    if (p.option === "greater-of") {
        if (option2 === null) {
            return indeterminate(["actuarial equivalent of the NRA benefit is required for the greater-of option"], ["AE(B_NRA to t) on the stated actuarial equivalence basis"]);
        }
        return exactResult(ctx, moneyOf(ctx.rounding, option2), "monthly", p.basis);
    }
    if (option3 === null) {
        return indeterminate(["actuarial equivalent of the payments made since NRA is required for the offset option"], ["AE(payments made since NRA) on the stated actuarial equivalence basis"]);
    }
    return exactResult(ctx, moneyOf(ctx.rounding, option3), "monthly", p.basis);
}
/**
 * X-05 — Vesting application (accrued → vested accrued).
 * B_t^vested = VP_t × B_t, where VP_t is the vesting percent from the
 * plan's schedule at t. Only the employer-contribution portion is subject
 * to vesting (S-04). Output: B2 (vested accrued benefit), monthly, in the
 * normal single form (VB) or automatic form (VBNF). DBAB Ch. 8;
 * IRC §411(a); BCV VP, VB, VBNF. VP is entered as a fraction (e.g. 1, not
 * 100). A participant 100% vested has B^vested = B_t.
 */
function applyVesting(ctx, p) {
    if (!isNonNegativeDecimal(p.accruedBenefit) || !isNonNegativeDecimal(p.vestingService)) {
        return indeterminate(["accrued benefit and vesting service must be non-negative decimals"], ["the accrued benefit B_t and vesting service VS_t"]);
    }
    const vestedForVp = (vp) => {
        if (p.employerPortionOnly) {
            const ee = p.employeePortion ?? "0";
            if (!isNonNegativeDecimal(ee)) {
                throw new Error("applyVesting: employee portion must be a non-negative decimal");
            }
            const employer = (0, decimal_1.decCompare)(p.accruedBenefit, ee) > 0
                ? (0, decimal_1.decSubtract)(p.accruedBenefit, ee)
                : "0";
            return (0, decimal_1.decAdd)(ee, (0, decimal_1.decMultiply)(employer, vp));
        }
        return (0, decimal_1.decMultiply)(p.accruedBenefit, vp);
    };
    if (p.vestingPercentRange !== undefined) {
        if (!isNonNegativeDecimal(p.vestingPercentRange.low) || !isNonNegativeDecimal(p.vestingPercentRange.high)) {
            return indeterminate(["vesting-percent range bounds must be non-negative decimals"], ["the vesting schedule"]);
        }
        return {
            kind: "bound",
            min: makeBenefit(ctx, moneyOf(ctx.rounding, vestedForVp(p.vestingPercentRange.low)), "monthly", p.basis, "bound"),
            max: makeBenefit(ctx, moneyOf(ctx.rounding, vestedForVp(p.vestingPercentRange.high)), "monthly", p.basis, "bound"),
            evidenceGrade: "estimate",
            missingInputs: ["vesting schedule"],
        };
    }
    let vp = null;
    for (const row of p.vestingSchedule) {
        if (!isNonNegativeDecimal(row.serviceYears) || !isNonNegativeDecimal(row.percent)) {
            return indeterminate(["vesting schedule rows must be non-negative decimals"], ["the vesting schedule"]);
        }
        if ((0, decimal_1.decCompare)(p.vestingService, row.serviceYears) >= 0) {
            if (vp === null || (0, decimal_1.decCompare)(row.serviceYears, "0") >= 0) {
                // Last matching row wins (schedule is ordered by service).
                vp = row.percent;
            }
        }
    }
    if (vp === null) {
        return indeterminate(["no vesting schedule row applies to this vesting service"], ["the plan's vesting schedule"]);
    }
    if ((0, decimal_1.decCompare)(vp, "0") < 0 || (0, decimal_1.decCompare)(vp, "1") > 0) {
        return indeterminate([`vesting percent ${vp} is outside [0, 1]`], ["a vesting percent between 0 and 1"]);
    }
    const vested = vestedForVp(vp);
    if ((0, decimal_1.decCompare)(vested, "0") < 0)
        return negativeRefused(vested, "X-05");
    const result = exactResult(ctx, moneyOf(ctx.rounding, vested), "monthly", { ...p.basis, vestingTreatment: "vested" });
    return result;
}
/**
 * Evaluate one FormulaCall. X-02 is a per-year input transform returning
 * capped compensation, not a benefit (Stage 2 output 04 §11.6 design
 * decision 3): it cannot be a Stage 5 formula call and is refused here
 * as indeterminate, with the resolution named.
 */
function evaluateFormulaCall(ctx, call) {
    switch (call.formulaId) {
        case "T-01": return calcFlatDollar(ctx, call.params);
        case "T-02": return calcFixedPercentage(ctx, call.params);
        case "T-03": return calcDollarPerYear(ctx, call.params);
        case "T-04": return calcUnitCredit(ctx, call.params);
        case "T-05": return calcCareerAverage(ctx, call.params);
        case "T-06": return calcFinalOrHighestAverage(ctx, call.params);
        case "T-07": return calcFractionalAccrual(ctx, call.params);
        case "T-08": return calcStepRate(ctx, call.params);
        case "T-09": return calcServiceCapped(ctx, call.params);
        case "I-01": return calcExcessBenefit(ctx, call.params);
        case "I-02": return calcCoveredCompIntegration(ctx, call.params);
        case "I-03": return calcPermittedDisparity(ctx, call.params);
        case "I-04": return calcPiaOffset(ctx, call.params);
        case "I-05": return calcPlanOffset(ctx, call.params);
        case "C-01": return calcGreaterOf(ctx, call.params);
        case "C-02": return calcLesserOf(ctx, call.params);
        case "C-03": return calcMinimumBenefit(ctx, call.params);
        case "C-04": return calcGrandfathered(ctx, call.params);
        case "C-05": return calcFreshStart(ctx, call.params);
        case "C-06": return calcMultiplePeriods(ctx, call.params);
        case "C-07": return calcGroupSpecific(ctx, call.params);
        case "S-01": return calcCashBalance(ctx, call.params);
        case "S-02": return calcPensionEquity(ctx, call.params);
        case "S-03": return calcOtherHybrid(ctx, call.params);
        case "S-04": return calcContributory(ctx, call.params);
        case "S-05": return calcEmployeeContributionBenefit(ctx, call.params);
        case "S-06": return calcFrozen(ctx, call.params);
        case "S-07": return calcPastServiceCredit(ctx, call.params);
        case "S-08": return calcRehireRestoration(ctx, call.params);
        case "X-01": return applySection415Limit(ctx, call.params);
        case "X-02": return indeterminate(["X-02 is a per-year compensation transform, not a benefit formula"], ["capCompensationYear applied to the compensation inputs before Stage 5"]);
        case "X-03": return convertFormAndAge(ctx, call.params);
        case "X-04": return calcPostNra(ctx, call.params);
        case "X-05": return applyVesting(ctx, call.params);
    }
}
