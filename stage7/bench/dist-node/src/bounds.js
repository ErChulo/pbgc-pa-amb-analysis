"use strict";
/**
 * Bounds / scenarios path — Stage 4 (Wave 2).
 *
 * Stage 2 output 04 §5. Taken whenever the exact path cannot complete:
 * one or more inputs are missing (class M3 — reasonable bounds
 * establishable — or M4 — stated assumption) and no input is class M5
 * (indeterminate) and the comparison basis is established. If any input
 * is M5, or the basis is unresolved, the outcome is `indeterminate`,
 * not bounds.
 *
 * Bounds are derived, not estimated (rule B-1): each bound is computed by
 * evaluating the benefit formula at the extreme values of the missing
 * inputs consistent with the known facts and the plan provisions.
 * Monotonicity must be verified (rule B-2): bounds computed at endpoints
 * only, for a non-monotone formula, are wrong. Bounds widen honestly
 * (rule B-3): an assumption that narrows the bounds is stated as an
 * assumption (class M4) and the assumption-free bounds are also reported.
 *
 * What bounds are not (Stage 2 output 04 §5.5):
 * - Bounds are NOT confidence intervals. A 95% confidence interval is a
 *   statement about sampling uncertainty; bounds here are guarantees
 *   conditional on the stated assumptions: if the assumptions hold, the
 *   true benefit (under the correct formula) lies in [B_i^min, B_i^max].
 * - A bound is NOT an exact benefit. minBenefit / maxBenefit carry
 *   source "bound"; neither may be compared to PA_AMB as if it were B̂_i.
 *   The comparison for a bounds case is the recorded-position test:
 *   inside (consistent), outside (inconsistent under the stated
 *   assumptions — investigate), or recorded-missing.
 * - Imputation NEVER fills an individual's inputs. Statistical
 *   missing-data methods (multiple imputation) may be used for
 *   population-level summaries; they must never be used to fill in an
 *   individual participant's benefit inputs and present the result as
 *   that participant's reconstructed benefit. A scenario that fills a
 *   missing year at the average of known years is labelled as an
 *   assumption, never presented as the benefit.
 *
 * This module is a pure constructor layer: the pipeline evaluates the
 * endpoints (it owns the request and the missing-input filling) and hands
 * the evaluated endpoint benefits here. `deriveBounds` in the Stage 2
 * spec takes (request, missingInputs, feasibleRegion) and runs the
 * pipeline per evaluation point; that re-running needs a reference to the
 * pipeline, so this module takes the evaluated endpoints as an argument
 * instead (dependency injection — the pipeline passes its own evaluator).
 * See pipeline.ts `deriveBoundsForRequest`.
 *
 * Pure functions only. No clock, no storage, no network, no randomness.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBoundsEstablishable = isBoundsEstablishable;
exports.recordedPosition = recordedPosition;
exports.checkMonotonicity = checkMonotonicity;
exports.attributeWidth = attributeWidth;
exports.untracedScenarios = untracedScenarios;
exports.allScenariosTraced = allScenariosTraced;
exports.generateScenarios = generateScenarios;
exports.buildBoundsResult = buildBoundsResult;
exports.boundsResultFromCalcResult = boundsResultFromCalcResult;
exports.boundsWidthMinor = boundsWidthMinor;
exports.feasibleRegionDescription = feasibleRegionDescription;
const decimal_1 = require("./decimal");
/** True when the bounds path may be taken for these missing inputs:
 *  every missing input is class M3 ("c") or M4 ("d"), and every one of
 *  them is covered by a feasible range. Any class M5 ("e") input, or an
 *  uncovered input, means indeterminate, not bounds. */
function isBoundsEstablishable(missingInputs, ranges) {
    for (const item of missingInputs) {
        if (item.missingClass !== "c" && item.missingClass !== "d")
            return false;
        if (!ranges.some((r) => r.field === item.field))
            return false;
    }
    return missingInputs.length > 0;
}
/** Where the recorded PA_AMB falls relative to the justified range. */
function recordedPosition(recorded, min, max) {
    if (recorded === null)
        return "recorded-missing";
    if (recorded.amountMinor < min.amountMinor)
        return "below-min";
    if (recorded.amountMinor > max.amountMinor)
        return "above-max";
    return "inside";
}
/**
 * Monotonicity verification over evaluated points (Stage 2 output 04
 * §5.2 rule B-2). Each point is the benefit (monthly minor units) at one
 * value of one missing input. Monotone holds when the extreme benefits
 * occur at the extreme input values — i.e. no interior point lies outside
 * the endpoint range. `verifiedBy` records how it was established.
 */
function checkMonotonicity(input, points) {
    if (points.length < 2) {
        return { input, monotone: false, verifiedBy: "fewer than two evaluation points" };
    }
    const sorted = [...points].sort((a, b) => (0, decimal_1.decCompare)(a.inputValue, b.inputValue));
    const lowest = sorted[0];
    const highest = sorted[sorted.length - 1];
    if (lowest === undefined || highest === undefined) {
        return { input, monotone: false, verifiedBy: "no evaluation points" };
    }
    const endpointMin = Math.min(lowest.benefitMinor, highest.benefitMinor);
    const endpointMax = Math.max(lowest.benefitMinor, highest.benefitMinor);
    const interiorOutside = sorted.some((pt) => pt.benefitMinor < endpointMin || pt.benefitMinor > endpointMax);
    return {
        input,
        monotone: !interiorOutside,
        verifiedBy: interiorOutside
            ? "endpoint+kink evaluation — interior point outside the endpoint range"
            : "endpoint+kink evaluation",
    };
}
/**
 * Width attribution by leave-one-out bounding (Stage 2 output 04 §5.4):
 * recompute the bounds with each missing input hypothetically known at
 * its midpoint (labelled as an assumption) and record how much the
 * interval narrows. `narrowedWidthMinor` is the width with that input
 * fixed at its midpoint. The key question is decision sensitivity, not
 * benefit movement: `couldChangeDisposition` is caller-stated (does
 * resolving the input move the participant across a tolerance or
 * disposition boundary?).
 */
function attributeWidth(args) {
    const totalWidth = args.totalMaxMinor - args.totalMinMinor;
    return args.inputs.map((input) => {
        const contribution = Math.max(totalWidth - input.narrowedWidthMinor, 0);
        const share = totalWidth === 0
            ? "0"
            : (0, decimal_1.decDivide)(String(contribution), String(totalWidth), 10);
        return {
            missingInput: input.missingInput,
            missingClass: input.missingClass,
            widthContribution: (0, decimal_1.makeMoney)(contribution),
            widthShare: share,
            couldChangeDisposition: input.couldChangeDisposition,
        };
    });
}
/**
 * Scenario generation (Stage 2 output 04 §5.3): named, reproducible
 * scenarios, each with its stated assumptions. A scenario's benefit is
 * never presented as the benefit. The midpoint scenario ("missing year at
 * the average of known years") is labelled as an assumption.
 *
 * A per-scenario derivation trace is carried through when the caller has
 * one (Stage 5: formula functions record one via `namedScenario`;
 * compose.ts carries traces through combination). An endpoint evaluated
 * without a recorded trace carries none — `trace` stays null.
 */
/** Scenarios in a BoundsResult that carry no per-scenario derivation
 *  trace (Stage 5: the missing-trace report, not a fabrication). A
 *  scenario without a trace is reported as "per-scenario derivation
 *  trace not recorded" (publication.ts `publishFindings`); this helper
 *  is the pure query behind that report — it lists the untraced
 *  scenarios so a caller can count and name them. An empty result means
 *  every scenario is traced. */
function untracedScenarios(scenarios) {
    return scenarios.filter((s) => s.trace === null || s.trace === undefined);
}
/** True when every scenario in the set carries a derivation trace. */
function allScenariosTraced(scenarios) {
    return untracedScenarios(scenarios).length === 0;
}
function generateScenarios(args) {
    return args.endpoints.map((e) => ({
        name: e.name,
        assumptions: e.assumptions,
        benefit: e.benefit,
        planVersionId: args.planVersionId,
        formulaId: args.formulaId,
        trace: e.trace ?? null,
    }));
}
/**
 * Build a BoundsResult from evaluated endpoint benefits. The min/max
 * benefits are TypedBenefitQuantity values with source "bound" — for the
 * min and the max separately, so neither is ever mistaken for an exact
 * benefit. The caller supplies the derivation (method, kink points,
 * monotonicity, feasible region) it actually performed.
 */
function buildBoundsResult(args) {
    const min = args.minBenefit.amount;
    const max = args.maxBenefit.amount;
    if (min === null || max === null) {
        throw new Error("buildBoundsResult: endpoint benefits must carry amounts");
    }
    if (min.amountMinor > max.amountMinor) {
        throw new Error("buildBoundsResult: min exceeds max — endpoints are reversed");
    }
    const recorded = args.recordedPaAmb === null ? null : args.recordedPaAmb.amount;
    return {
        min,
        max,
        assumptions: args.assumptions,
        derivation: args.derivation,
        widthAttribution: args.widthAttribution,
        scenarios: args.scenarios,
        recordedPosition: recordedPosition(recorded, min, max),
        minBenefit: { ...args.minBenefit, source: "bound", status: "calculated" },
        maxBenefit: { ...args.maxBenefit, source: "bound", status: "calculated" },
    };
}
/**
 * Build a BoundsResult directly from a formula's bound CalcResult
 * (Stage 5 returning a bound). The derivation is endpoint evaluation
 * over the formula's missing inputs; the caller supplies the assumption
 * set and the recorded PA_AMB.
 */
function boundsResultFromCalcResult(args) {
    return buildBoundsResult({
        minBenefit: args.bound.min,
        maxBenefit: args.bound.max,
        assumptions: args.assumptions,
        derivation: {
            method: "endpoint-evaluation",
            kinkPoints: [],
            monotonicity: args.bound.missingInputs.map((input) => ({
                input,
                monotone: true,
                verifiedBy: "formula structure",
            })),
            feasibleRegion: args.feasibleRegion.description,
        },
        widthAttribution: [],
        scenarios: [],
        recordedPaAmb: args.recordedPaAmb,
    });
}
/**
 * The interval width in minor units, as an exact decimal dollars string.
 * Used for the materiality comparison (width vs τ_material): if the width
 * is small relative to τ_material the uncertainty is immaterial; if large,
 * the uncertainty itself is the finding (Stage 2 output 04 §5.5, rule B-5).
 */
function boundsWidthMinor(bounds) {
    return bounds.max.amountMinor - bounds.min.amountMinor;
}
/** A feasibility description for one missing input range. */
function feasibleRegionDescription(ranges) {
    return {
        description: ranges
            .map((r) => `${r.field} in [${r.low}, ${r.high}] ${r.unit} (${r.basis})`)
            .join("; "),
    };
}
