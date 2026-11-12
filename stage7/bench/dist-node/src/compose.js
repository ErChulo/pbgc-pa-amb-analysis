"use strict";
/**
 * Formula composition engine — Stage 4 (Wave 2).
 *
 * Implements the general model from FORMULA_TAXONOMY.md §9 and Stage 2
 * output 04 §11.7 (composition order):
 *
 *   AMB_i(t) = Normalize(Limit(Protect(Compose(F1..Fn))))
 *
 * Each layer is an independent, reusable, pure module over formula
 * operations. Formula types, accrual methodologies, service definitions,
 * compensation definitions, historical protections, statutory limits, and
 * annuity conversions remain independent modules: this file composes them,
 * it does not re-implement any of them.
 *
 * Composition order (Stage 2 output 04 §11.7): base formula (T-/S-) →
 * period/group combination (C-06/C-07) → integration/offsets (I-) →
 * greater-of / lesser-of / minimum / grandfather (C-01–C-05) → §415
 * (X-01) → §401(a)(17) per-year inside the compensation inputs (X-02) →
 * service cap (T-09) → vesting (X-05) → form/age conversion (X-03) only
 * when the comparison basis requires B4.
 *
 * Effective-dated provision selection: each period is priced under the
 * version in force for that period. The latest formula is never applied
 * retroactively (MASTER_PROMPT §5). `selectProvisionsByDate` and
 * `provisionVersionsForPeriods` are the selection primitives; the pipeline
 * (Stage 1) owns the decision of which version governs a measurement date.
 *
 * Money: integer minor units throughout (types.ts). Exact decimals are
 * carried as DecimalString and combined with the src/decimal.ts surface
 * only. No binary float touches money, service, compensation, rates, or
 * factors (Stage 2 output 04 §3.1 rule R-1).
 *
 * Pure functions only. No clock, no storage, no network, no randomness.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decSubtract = exports.decMultiply = exports.decDivide = exports.decAdd = void 0;
exports.amountMinorOf = amountMinorOf;
exports.amountDecimalOf = amountDecimalOf;
exports.rebaseBenefit = rebaseBenefit;
exports.combineResults = combineResults;
exports.composeFormulas = composeFormulas;
exports.describeComparison = describeComparison;
exports.applyProtection = applyProtection;
exports.applyLimit = applyLimit;
exports.normalizeBenefit = normalizeBenefit;
exports.checkAntiDecrease = checkAntiDecrease;
exports.selectProvisionsByDate = selectProvisionsByDate;
exports.provisionVersionsForPeriods = provisionVersionsForPeriods;
const decimal_1 = require("./decimal");
Object.defineProperty(exports, "decAdd", { enumerable: true, get: function () { return decimal_1.decAdd; } });
Object.defineProperty(exports, "decDivide", { enumerable: true, get: function () { return decimal_1.decDivide; } });
Object.defineProperty(exports, "decMultiply", { enumerable: true, get: function () { return decimal_1.decMultiply; } });
Object.defineProperty(exports, "decSubtract", { enumerable: true, get: function () { return decimal_1.decSubtract; } });
const model_1 = require("./model");
/** The amount of a benefit quantity as integer minor units, or null when
 *  the quantity carries no amount (missing / indeterminate — never 0). */
function amountMinorOf(benefit) {
    return benefit.amount === null ? null : benefit.amount.amountMinor;
}
/** The amount of a benefit quantity as an exact decimal string (dollars),
 *  or null when the quantity carries no amount. */
function amountDecimalOf(benefit) {
    const minor = amountMinorOf(benefit);
    return minor === null ? null : (0, decimal_1.moneyMinorToDecimalString)(minor);
}
/** Build a TypedBenefitQuantity for a computed amount, on the same basis
 *  as a reference quantity (same periodicity, dates, form, vesting,
 *  version, owner), with a new amount. */
function rebaseBenefit(reference, amount) {
    return { ...reference, amount };
}
/** The periodicity of a CalcResult's value, or null for a non-exact result
 *  (bounds and scenarios carry their own values; indeterminate has none). */
function resultPeriodicity(result) {
    if (result.kind === "exact")
        return result.value.periodicity;
    if (result.kind === "bound")
        return result.min.periodicity;
    if (result.kind === "scenarios") {
        const first = result.scenarios[0];
        return first === undefined ? null : first.value.periodicity;
    }
    return null;
}
/** Combine exact amounts under a rule. Amounts are integer minor units. */
function combineMinors(minors, combine) {
    if (minors.length === 0) {
        throw new Error("combineMinors: no components to combine");
    }
    const first = minors[0];
    if (first === undefined)
        throw new Error("combineMinors: empty component list");
    if (combine === "sum") {
        let total = 0;
        for (const m of minors)
            total += m;
        return total;
    }
    if (combine === "greater-of") {
        let best = first;
        for (const m of minors)
            if (m > best)
                best = m;
        return best;
    }
    let best = first;
    for (const m of minors)
        if (m < best)
            best = m;
    return best;
}
/**
 * Combine a list of CalcResults under one rule, propagating inexactness
 * instead of inventing a point value (Stage 2 output 04 §11.1):
 *
 * - all exact → exact combination.
 * - any indeterminate → indeterminate, unless the rule is greater-of and
 *   the caller supplied `uncomputableMaxMinor` (C-01 rule: the bound is
 *   [best computable, best computable + max plausible uncomputable]).
 * - exact + bound mixes → bound: sum adds the endpoints; greater-of takes
 *   max of mins / max of maxes; lesser-of takes min of mins / min of maxes.
 * - scenarios → scenarios, combined element-wise when every scenario list
 *   has the same length; otherwise indeterminate (the mix is not a
 *   well-defined scenario set — recorded, not guessed).
 *
 * A bound's min/max are TypedBenefitQuantity values on the same basis, so
 * a bound across bases is never produced here: mixed periodicities are
 * refused as indeterminate.
 */
function combineResults(results, combine, opts) {
    if (results.length === 0) {
        return {
            kind: "indeterminate",
            evidenceGrade: "unknown",
            missingInputs: ["no formula components supplied to Compose"],
            wouldResolve: ["at least one formula component"],
        };
    }
    const missingInputs = [];
    for (const r of results) {
        if (r.kind === "bound" || r.kind === "scenarios" || r.kind === "indeterminate") {
            missingInputs.push(...r.missingInputs);
        }
    }
    const periodicities = results
        .map(resultPeriodicity)
        .filter((p) => p !== null);
    const firstPeriodicity = periodicities[0];
    if (firstPeriodicity !== undefined &&
        periodicities.some((p) => p !== firstPeriodicity)) {
        return {
            kind: "indeterminate",
            evidenceGrade: "unknown",
            missingInputs: [
                "formula components on different periodicities cannot be combined",
            ],
            wouldResolve: ["components expressed on one periodicity"],
        };
    }
    const indeterminates = results.filter((r) => r.kind === "indeterminate");
    if (indeterminates.length > 0) {
        if (combine === "greater-of" && opts?.uncomputableMaxMinor !== undefined
            && opts.uncomputableMaxMinor !== null) {
            const computables = results.filter((r) => r.kind !== "indeterminate");
            const exactMinors = computables
                .filter((r) => r.kind === "exact")
                .map((r) => (r.kind === "exact" ? amountMinorOf(r.value) : null))
                .filter((m) => m !== null);
            const boundMins = computables
                .filter((r) => r.kind === "bound")
                .map((r) => (r.kind === "bound" ? amountMinorOf(r.min) : null))
                .filter((m) => m !== null);
            const best = [...exactMinors, ...boundMins];
            if (best.length > 0) {
                const lower = combineMinors(best, "greater-of");
                const firstExact = computables.find((r) => r.kind === "exact");
                const reference = firstExact !== undefined && firstExact.kind === "exact"
                    ? firstExact.value
                    : computables.find((r) => r.kind === "bound")?.kind === "bound"
                        ? computables.find((r) => r.kind === "bound").min
                        : null;
                if (reference !== null) {
                    return {
                        kind: "bound",
                        min: rebaseBenefit(reference, (0, decimal_1.makeMoney)(lower)),
                        max: rebaseBenefit(reference, (0, decimal_1.makeMoney)(lower + (opts.uncomputableMaxMinor ?? 0))),
                        evidenceGrade: "estimate",
                        missingInputs,
                    };
                }
            }
        }
        return {
            kind: "indeterminate",
            evidenceGrade: "unknown",
            missingInputs,
            wouldResolve: indeterminates.flatMap((r) => r.wouldResolve),
        };
    }
    const scenarios = results.filter((r) => r.kind === "scenarios");
    if (scenarios.length > 0) {
        const lengths = scenarios.map((s) => s.scenarios.length);
        const firstLength = lengths[0];
        if (firstLength === undefined || !lengths.every((n) => n === firstLength)) {
            return {
                kind: "indeterminate",
                evidenceGrade: "unknown",
                missingInputs,
                wouldResolve: ["scenario sets of equal length for every component"],
            };
        }
        const combined = firstLength === 0
            ? {
                kind: "indeterminate",
                evidenceGrade: "unknown",
                missingInputs,
                wouldResolve: ["at least one scenario per component"],
            }
            : {
                kind: "scenarios",
                scenarios: Array.from({ length: firstLength }, (_, i) => {
                    const perIndex = results.map((r) => {
                        if (r.kind === "exact")
                            return r.value;
                        if (r.kind === "bound")
                            return r.min;
                        if (r.kind === "scenarios") {
                            const s = r.scenarios[i];
                            return s === undefined ? null : s.value;
                        }
                        return null;
                    });
                    const minors = perIndex
                        .map((b) => (b === null ? null : amountMinorOf(b)))
                        .filter((m) => m !== null);
                    const names = results.map((r, k) => {
                        if (r.kind === "scenarios") {
                            const s = r.scenarios[i];
                            return s === undefined ? `component-${k}` : s.name;
                        }
                        return `component-${k}`;
                    });
                    const firstBenefit = perIndex.find((b) => b !== null);
                    if (firstBenefit === undefined || minors.length !== results.length) {
                        throw new Error("combineResults: scenario combination lost a component");
                    }
                    // Stage 5 (the List-effect gap): carry per-scenario traces
                    // through combination. The combined scenario's trace is the
                    // concatenation of its components' scenario traces at this
                    // index, renumbered sequentially. Exact/bound components
                    // contribute no scenario trace. When no component recorded
                    // a trace, the combined trace stays null — reported, never
                    // fabricated (see bounds.ts `untracedScenarios`).
                    const componentTraces = results.map((r) => {
                        if (r.kind !== "scenarios")
                            return null;
                        const s = r.scenarios[i];
                        return s === undefined ? null : (s.trace ?? null);
                    });
                    let traceStep = 0;
                    const combinedTrace = componentTraces.flatMap((t) => t === null ? [] : t.map((s) => ({ ...s, step: (traceStep += 1) })));
                    return {
                        name: names.join(" + "),
                        value: rebaseBenefit(firstBenefit, (0, decimal_1.makeMoney)(combineMinors(minors, combine))),
                        basis: firstBenefit.planVersionId ?? "scenario",
                        trace: combinedTrace.length === 0 ? null : combinedTrace,
                    };
                }),
                evidenceGrade: "estimate",
                missingInputs,
            };
        return combined;
    }
    const bounds = results.filter((r) => r.kind === "bound");
    if (bounds.length > 0) {
        const exacts = results.filter((r) => r.kind === "exact");
        const reference = exacts[0]?.value ?? bounds[0]?.min;
        if (reference === undefined) {
            throw new Error("combineResults: no reference benefit for bound combination");
        }
        const mins = [];
        const maxes = [];
        for (const r of results) {
            if (r.kind === "exact") {
                const m = amountMinorOf(r.value);
                if (m === null)
                    continue;
                mins.push(m);
                maxes.push(m);
            }
            else if (r.kind === "bound") {
                const lo = amountMinorOf(r.min);
                const hi = amountMinorOf(r.max);
                if (lo === null || hi === null)
                    continue;
                mins.push(lo);
                maxes.push(hi);
            }
        }
        if (mins.length !== results.length || maxes.length !== results.length) {
            return {
                kind: "indeterminate",
                evidenceGrade: "unknown",
                missingInputs: [...missingInputs, "a component benefit carries no amount"],
                wouldResolve: ["an amount for every component"],
            };
        }
        return {
            kind: "bound",
            min: rebaseBenefit(reference, (0, decimal_1.makeMoney)(combineMinors(mins, combine))),
            max: rebaseBenefit(reference, (0, decimal_1.makeMoney)(combineMinors(maxes, combine))),
            evidenceGrade: "estimate",
            missingInputs,
        };
    }
    const exacts = results.filter((r) => r.kind === "exact");
    if (exacts.length !== results.length) {
        return {
            kind: "indeterminate",
            evidenceGrade: "unknown",
            missingInputs,
            wouldResolve: ["a computable value for every component"],
        };
    }
    const minors = exacts.map((r) => amountMinorOf(r.value));
    if (minors.some((m) => m === null)) {
        return {
            kind: "indeterminate",
            evidenceGrade: "unknown",
            missingInputs: [...missingInputs, "an exact component carries no amount"],
            wouldResolve: ["an amount for every component"],
        };
    }
    const reference = exacts[0]?.value;
    if (reference === undefined) {
        throw new Error("combineResults: no exact component");
    }
    return {
        kind: "exact",
        value: rebaseBenefit(reference, (0, decimal_1.makeMoney)(combineMinors(minors, combine))),
        evidenceGrade: exacts.every((r) => r.evidenceGrade === "fact")
            ? "fact"
            : exacts.some((r) => r.evidenceGrade === "assumption")
                ? "assumption"
                : "estimate",
    };
}
/**
 * Compose(F1..Fn) — evaluate the operations in order and combine them
 * under one rule. The order is the caller's (the plan's) order; Compose
 * itself imposes no order beyond it. A component that is refused (its
 * applicability predicate fails) returns indeterminate from the operation
 * itself; Compose propagates that as indeterminate, never silently skips
 * the component (Stage 2 output 04 §1.3 rule F-2).
 */
function composeFormulas(ctx, operations, combine, opts) {
    return combineResults(operations.map((op) => op(ctx)), combine, opts);
}
/**
 * Describe a greater-of / lesser-of comparison over exact components:
 * which component won (or bound), and by how much. Used by the pipeline
 * Stage 6 trace so the margin is a number, not a claim. Returns null when
 * any component is not exact.
 */
function describeComparison(components, combine) {
    const exacts = [];
    for (const c of components) {
        if (c.result.kind !== "exact")
            return null;
        const amount = c.result.value.amount;
        if (amount === null)
            return null;
        exacts.push({ name: c.name, minor: amount.amountMinor, money: amount });
    }
    if (exacts.length === 0)
        return null;
    const sorted = [...exacts].sort((a, b) => combine === "greater-of" ? b.minor - a.minor : a.minor - b.minor);
    const winner = sorted[0];
    const runnerUp = sorted[1];
    if (winner === undefined)
        return null;
    return {
        candidates: exacts.map((e) => e.money),
        selected: winner.money,
        winnerName: winner.name,
        marginMinor: runnerUp === undefined ? 0 : winner.minor - runnerUp.minor,
    };
}
/**
 * Protect — apply historical accrual, grandfathering, and protection
 * provisions (IRC §411(d)(6); Stage 2 output 04 §2 Stage 6).
 *
 * - method "greater-of" (the §411(d)(6) floor itself): max(current,
 *   protected).
 * - method "frozen-plus-post": protected + post-amendment accruals.
 * - method "extended": max(frozen-plus-post, greater-of).
 *
 * When no protected benefit applies, the current benefit is returned
 * unchanged. A protected benefit that exceeds the current benefit is the
 * result — a decrease by amendment is never silently applied (§411(d)(6)).
 */
function applyProtection(current, protectedBenefit, opts) {
    void opts.ruleRef;
    if (protectedBenefit === null)
        return current;
    const method = opts.method ?? "greater-of";
    if (method === "greater-of") {
        return combineResults([current, protectedBenefit], "greater-of");
    }
    if (method === "frozen-plus-post") {
        if (opts.postAmendmentAccrual === null || opts.postAmendmentAccrual === undefined) {
            return {
                kind: "indeterminate",
                evidenceGrade: "unknown",
                missingInputs: ["post-amendment accruals for the frozen-plus-post method"],
                wouldResolve: ["the post-amendment accrual benefit"],
            };
        }
        return combineResults([protectedBenefit, opts.postAmendmentAccrual], "sum");
    }
    // extended wear-away: max(frozen-plus-post, greater-of)
    if (opts.postAmendmentAccrual === null || opts.postAmendmentAccrual === undefined) {
        return {
            kind: "indeterminate",
            evidenceGrade: "unknown",
            missingInputs: ["post-amendment accruals for the extended wear-away method"],
            wouldResolve: ["the post-amendment accrual benefit"],
        };
    }
    const frozenPlusPost = combineResults([protectedBenefit, opts.postAmendmentAccrual], "sum");
    const greaterOf = combineResults([current, protectedBenefit], "greater-of");
    return combineResults([frozenPlusPost, greaterOf], "greater-of");
}
/**
 * Limit — apply plan and statutory benefit restrictions that take the form
 * of a cap (Stage 2 output 04 §2 Stage 7; X-01 §415 is a lesser-of, an
 * offset is a subtraction — both are expressed here as caps or handled by
 * the formula functions, never by silently reducing a benefit).
 *
 * Each cap is an exact monthly decimal with its rule citation. The benefit
 * is the minimum of itself and every cap. Bounds are capped endpoint-wise;
 * scenarios endpoint-wise per scenario. A negative cap is refused as
 * indeterminate (a cap cannot be negative).
 */
function applyLimit(benefit, caps) {
    for (const cap of caps) {
        if ((0, decimal_1.decCompare)(cap.capMonthly, "0") < 0) {
            return {
                kind: "indeterminate",
                evidenceGrade: "unknown",
                missingInputs: [`negative benefit cap ${cap.capMonthly} (${cap.ruleRef})`],
                wouldResolve: ["a non-negative cap value"],
            };
        }
    }
    const capOne = (value) => {
        const amount = amountDecimalOf(value);
        if (amount === null)
            return value;
        let capped = amount;
        for (const cap of caps) {
            if ((0, decimal_1.decCompare)(capped, cap.capMonthly) > 0)
                capped = cap.capMonthly;
        }
        if (value.periodicity === "monthly") {
            return rebaseBenefit(value, (0, decimal_1.moneyFromDecimalString)((0, decimal_1.decRound)(capped, "0.01", "half-up")));
        }
        return rebaseBenefit(value, (0, decimal_1.moneyFromDecimalString)((0, decimal_1.decRound)(capped, "0.01", "half-up")));
    };
    if (benefit.kind === "exact") {
        return { ...benefit, value: capOne(benefit.value) };
    }
    if (benefit.kind === "bound") {
        return { ...benefit, min: capOne(benefit.min), max: capOne(benefit.max) };
    }
    if (benefit.kind === "scenarios") {
        return {
            ...benefit,
            scenarios: benefit.scenarios.map((s) => ({ ...s, value: capOne(s.value) })),
        };
    }
    return benefit;
}
/**
 * Normalize — express a benefit on the required basis (Stage 2 output 04
 * §2 Stage 9): annual ↔ monthly conversion, vesting application, and
 * application of a precomputed form/age factor. The factor itself is never
 * invented here: form/age conversion factors come from X-03
 * (convertFormAndAge in formulas.ts), vesting percents from the plan's
 * schedule (X-05). Annual → monthly is an exact-decimal ÷12 at scale 10
 * (Stage 2 output 04 §3.1 rule R-4); the resulting Money is the half-up
 * cents representation of that exact value when it is not already whole
 * cents, and the exact value is the caller's to record in the trace.
 */
function normalizeBenefit(benefit, opts) {
    void opts.ruleRef;
    const convertOne = (value) => {
        const amount = amountDecimalOf(value);
        if (amount === null)
            return null;
        let out = amount;
        let periodicity = value.periodicity;
        if (opts.toPeriodicity !== undefined && opts.toPeriodicity !== periodicity) {
            if (periodicity === "annual" && opts.toPeriodicity === "monthly") {
                out = (0, decimal_1.decDivide)(out, "12", 10);
                periodicity = "monthly";
            }
            else if (periodicity === "monthly" && opts.toPeriodicity === "annual") {
                out = (0, decimal_1.decMultiply)(out, "12");
                periodicity = "annual";
            }
        }
        if (opts.vestingPercent !== undefined) {
            out = (0, decimal_1.decMultiply)(out, opts.vestingPercent);
        }
        if (opts.formFactor !== undefined) {
            out = (0, decimal_1.decMultiply)(out, opts.formFactor);
        }
        const money = (0, decimal_1.moneyFromDecimalString)((0, decimal_1.decRound)(out, "0.01", "half-up"));
        return { ...value, amount: money, periodicity };
    };
    if (benefit.kind === "exact") {
        const converted = convertOne(benefit.value);
        if (converted === null)
            return benefit;
        return { ...benefit, value: converted };
    }
    if (benefit.kind === "bound") {
        const lo = convertOne(benefit.min);
        const hi = convertOne(benefit.max);
        if (lo === null || hi === null)
            return benefit;
        return { ...benefit, min: lo, max: hi };
    }
    if (benefit.kind === "scenarios") {
        const converted = benefit.scenarios.map((s) => {
            const v = convertOne(s.value);
            return v === null ? null : { ...s, value: v };
        });
        if (converted.some((v) => v === null))
            return benefit;
        return {
            ...benefit,
            scenarios: converted,
        };
    }
    return benefit;
}
/**
 * Anti-decrease guardrail (Stage 1 §3.3; IRC §411(b)(1)(G), §411(d)(6),
 * §411(a)(9)): an accrued benefit may never decrease on account of
 * increasing age or service, and never by plan amendment. The recognised
 * decrease channels (falling final-average compensation per DBAB Q 9:15,
 * rising Social Security offset within Rev. Rul. 84-45 / IRC §401(a)(15)
 * limits, rising covered compensation, §415 limit changes insulating
 * pre-change accruals) are caller-stated exceptions: when one applies,
 * pass its citation and the check is recorded as evaluated-not-applied.
 * Otherwise a decrease is a guardrail violation, reported — never a
 * silently reduced benefit.
 */
function checkAntiDecrease(priorMonthly, currentMonthly, opts) {
    if ((0, decimal_1.decCompare)(currentMonthly, priorMonthly) >= 0) {
        return { ok: true, violation: null };
    }
    if (opts?.recognisedChannel !== undefined && opts.recognisedChannel !== null) {
        return { ok: true, violation: null };
    }
    return {
        ok: false,
        violation: `accrued benefit decreased from $${priorMonthly}/month to $${currentMonthly}/month ` +
            `with no recognised decrease channel (IRC §411(b)(1)(G) / §411(d)(6))`,
    };
}
/**
 * Select the provisions in force at a date: the last version whose
 * effectiveDate is on or before the date (model.planVersionAtDate —
 * effective date only; the adoption date never selects the version).
 * Returns null version when the date precedes every version (a gap — the
 * caller must name it as missing evidence, never approximate with the
 * nearest version).
 */
function selectProvisionsByDate(timeline, date) {
    const version = (0, model_1.planVersionAtDate)(timeline, date);
    const amendmentHistory = [];
    const rejectedLater = [];
    for (const v of timeline.versions) {
        const effective = v.effectiveDate.value;
        if (effective === null)
            continue;
        if (effective <= date)
            amendmentHistory.push(v);
        else
            rejectedLater.push(v);
    }
    return { version, amendmentHistory, rejectedLater };
}
/**
 * Price each service period under the version in force for that period.
 * The evaluator receives the governing version id (never "latest") and
 * the period; the caller keeps the per-period results. A period that
 * precedes every version yields a null version id — the evaluator must
 * refuse it, not price it under the nearest version.
 */
function provisionVersionsForPeriods(periods, timeline) {
    return periods.map((p) => {
        const version = (0, model_1.planVersionAtDate)(timeline, p.from);
        return { ...p, planVersionId: version === null ? null : version.versionId };
    });
}
