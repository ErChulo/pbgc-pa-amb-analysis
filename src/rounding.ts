/**
 * Rounding — Stage 3 output 02, §3 (Stage 8 of the pipeline; MASTER_PROMPT §9).
 *
 * Three different things are called "rounding" and must never be confused:
 *   R-1  a service quantity (years) — plan-specific, stage-specific (D-3.1, D-3.2);
 *   R-2  a date moved to a boundary — per plan, per purpose (see src/dates.ts);
 *   R-3  a money amount (or an average, a rate, a factor) — Stage 2 output 04, §4.
 *
 * Rules enforced here:
 * - Rounding is applied only at prescribed points, under a per-plan
 *   versioned RoundingConfig with the closed mode list (half-up,
 *   half-even, down, up, floor, ceiling). A rule that is not documented
 *   for the plan version is never applied as the prescribed sequence.
 * - Definition-internal service rounding (e.g. the St. Rose months
 *   round-up, which is part of the service definition itself) is recorded
 *   in the service computation (src/service.ts), never re-applied here.
 * - Anti-coincidence (§3.5, rules A-1–A-5): a match obtained by arbitrary
 *   changes to rounding conventions is NEVER proof of the administrator's
 *   methodology. A rounding hypothesis is Supported only if (a) the
 *   sequence is documented in the plan, the administrator's workpapers,
 *   or a valuation report, or (b) the same sequence resolves discrepancies
 *   across the cohort and no document contradicts it. Otherwise it is
 *   Coincidence: recorded as such, never presented as an explanation, and
 *   never sufficient to move a disposition to Verified.
 *
 * All functions are pure. Decimal-safe via src/decimal.ts; a binary float
 * never touches a rounded value. Synthetic data only.
 */

import type {
  CounterfactualResult,
  DecimalString,
  Money,
  RoundingConfig,
  RoundingRule,
  RoundingSequence,
  ServiceResult,
  TypedBenefitQuantity,
} from "./types";
import {
  decAdd,
  decCompare,
  decDivide,
  decMultiply,
  decRound,
  makeMoney,
} from "./decimal";

// ---------------------------------------------------------------------------
// F-R-01 — apply a prescribed service rounding rule (R-1, Stage 8)
// ---------------------------------------------------------------------------

/**
 * Apply one configured R-1 service-rounding rule to a service result,
 * at the configured stage — or record `none-prescribed` when the rule is
 * null (no rounding rule documented for this plan version: nothing is
 * applied, and nothing is invented). Definition-internal rounding is
 * NOT re-applied here; it already happened in the service computation.
 * The operation is recorded in ServiceResult.roundingApplied. A rule
 * whose target is not "credited-service" is refused (it rounds something
 * else, and applying it to service would be a category error).
 */
export function applyServiceRounding(
  service: ServiceResult,
  rule: RoundingRule | null,
): ServiceResult {
  if (rule === null) return service;
  if (service.value === null) return service;
  if (rule.target !== "credited-service") {
    throw new Error(
      `applyServiceRounding: rule target is ${rule.target}, not "credited-service" — refusing to apply a non-service rule to service`,
    );
  }
  const after = decRound(service.value, rule.unit, rule.mode);
  return {
    ...service,
    value: after,
    rational: null,
    roundingApplied: [
      ...service.roundingApplied,
      {
        rule: `Stage 8 service rounding: ${rule.target} to ${rule.unit} (${rule.mode}), stage ${rule.stage}, ${rule.source.citation ?? "source not documented"}`,
        before: service.value,
        after,
      },
    ],
  };
}

/**
 * Apply one R-3 money rounding rule to an exact decimal money value
 * (dollars). Used for the Blond §5.01 case: the final annual normal
 * retirement benefit rounded to the nearest whole dollar — applied to
 * the final amount only, never to the per-period components.
 */
export function applyMoneyRounding(
  value: DecimalString,
  rule: RoundingRule,
): DecimalString {
  return decRound(value, rule.unit, rule.mode);
}

// ---------------------------------------------------------------------------
// F-R-02 — maximum plausible rounding effect (Stage 2 output 04, §4.3)
// ---------------------------------------------------------------------------

/**
 * Maximum plausible rounding effect for one participant: the sum of the
 * per-stage rounding units, in money. A discrepancy larger than this
 * cannot be explained by rounding alone ([S1-03] §2.7).
 *
 * Per stage, the maximum effect is half the unit for nearest modes
 * (half-up, half-even) and the full unit for one-sided modes (down, up,
 * floor, ceiling). Money-target rules contribute their unit in dollars
 * directly; a credited-service rule contributes unit-years × the benefit
 * per year of service (benefit ÷ service), which needs both the benefit
 * and the service — when either is unavailable that stage is skipped
 * and the skip is part of the documented limitation, not a zero. The
 * total is converted to integer minor units with a ceiling, so the bound
 * is never understated (e.g. a $0.005 cent-rounding effect bounds at
 * 1 minor unit, not 0). No prescribed sequence → Money 0.
 */
export function maxPlausibleRoundingEffect(
  benefit: TypedBenefitQuantity,
  rounding: RoundingConfig,
  service: ServiceResult,
): Money {
  const sequence = rounding.prescribedSequence;
  if (sequence === null) return makeMoney(0);
  let totalDollars: DecimalString = "0";
  for (const rule of sequence.rules) {
    const half = rule.mode === "half-up" || rule.mode === "half-even";
    const unitEffect = half
      ? decDivide(rule.unit, "2", 10)
      : rule.unit;
    if (rule.target === "credited-service") {
      if (benefit.amount === null || service.value === null) continue;
      if (decCompare(service.value, "0") === 0) continue;
      // Benefit per year of service, in dollars.
      const benefitDollars = decDivide(
        String(benefit.amount.amountMinor),
        "100",
        10,
      );
      const perYear = decDivide(benefitDollars, service.value, 10);
      totalDollars = decAdd(totalDollars, decMultiply(perYear, unitEffect));
    } else if (
      rule.target === "compensation" ||
      rule.target === "average-compensation" ||
      rule.target === "social-security-offset" ||
      rule.target === "intermediate-component" ||
      rule.target === "final-monthly-benefit"
    ) {
      // Unit stated in dollars for these targets.
      totalDollars = decAdd(totalDollars, unitEffect);
    } else {
      // Factor targets (retirement-factor, actuarial-equivalence-factor,
      // accrual-percentage): the money effect cannot be quantified from
      // the unit alone, so the stage is skipped, not zeroed.
      continue;
    }
  }
  // Dollars → minor units, ceiling so the bound is never understated.
  const minorExact = decMultiply(totalDollars, "100");
  const minorCeiled = decRound(minorExact, "1", "ceiling");
  return makeMoney(Number(minorCeiled));
}

// ---------------------------------------------------------------------------
// F-R-03 — test a rounding sequence as a diagnostic hypothesis (H15)
// ---------------------------------------------------------------------------

/** Is this sequence documented in the plan, workpapers, or a valuation
 *  report (Stage 3 §3.5 rule A-3(a))? A sequence is documented only when
 *  every rule in it has a documented source; one undocumented rule makes
 *  the sequence undocumented as a whole. */
export function isDocumentedSequence(sequence: RoundingSequence): boolean {
  if (sequence.rules.length === 0) return false;
  return sequence.rules.every((rule) => rule.source.kind !== "not-documented");
}

/**
 * Test a rounding sequence as the H15 counterfactual (Stage 2 output 04,
 * §6.2; Stage 3 §3.5). Runs on a copy of the pipeline state and labels
 * the result per rules A-1–A-5.
 *
 * The recomputed benefit under the sequence is supplied by the caller:
 * this module classifies the hypothesis; the formula engine (which
 * recomputes benefits) is a separate Stage 4 worker, so this function
 * takes the recomputed benefit rather than pretending to recompute it.
 * `recordedBenefit` is the prior administrator's amount on the same
 * basis; `toleranceMinor` is the case tolerance in minor units (null =
 * exact match required). `resolvesAcrossCohort` is the A-3(b) test:
 * the same sequence resolves discrepancies across the cohort, not just
 * this participant.
 *
 * - documented + match → "supported";
 * - documented + no match → "refuted";
 * - undocumented + match + resolves across cohort and no contradicting
 *   document → "supported" (A-3(b));
 * - undocumented + match, otherwise → "coincidence" (A-2, A-3): recorded
 *   as such, never presented as an explanation, never moves a
 *   disposition to Verified;
 * - undocumented + no match → "refuted".
 * `benefit` in the result is the recomputed benefit (null when the
 * sequence could not be evaluated); `residualDelta` is the recomputed
 * benefit minus the recorded benefit, in minor units (null when either
 * amount is missing).
 */
export function testRoundingSequence(args: {
  sequence: RoundingSequence;
  recomputedBenefit: TypedBenefitQuantity | null;
  recordedBenefit: TypedBenefitQuantity | null;
  toleranceMinor: number | null;
  resolvesAcrossCohort: boolean;
  contradictedByDocument: boolean;
}): CounterfactualResult {
  const { sequence, recomputedBenefit, recordedBenefit } = args;
  const operation: CounterfactualResult["operation"] = { kind: "rounding-sequence", sequence };
  const documented = isDocumentedSequence(sequence);

  let residualDelta: Money | null = null;
  let matches = false;
  if (recomputedBenefit?.amount !== null && recomputedBenefit?.amount !== undefined) {
    if (recordedBenefit?.amount !== null && recordedBenefit?.amount !== undefined) {
      const deltaMinor =
        recomputedBenefit.amount.amountMinor - recordedBenefit.amount.amountMinor;
      residualDelta = makeMoney(deltaMinor);
      const tolerance = args.toleranceMinor ?? 0;
      matches = Math.abs(deltaMinor) <= tolerance;
    }
  }
  if (recomputedBenefit === null) {
    return {
      operation,
      hypothesisCode: "H15",
      benefit: null,
      residualDelta: null,
      supportClass: "refuted",
      evidenceFor: [],
      evidenceAgainst: ["rounding sequence could not be evaluated to a benefit"],
    };
  }

  let supportClass: CounterfactualResult["supportClass"];
  const evidenceFor: string[] = [];
  const evidenceAgainst: string[] = [];
  if (matches && documented) {
    supportClass = "supported";
    evidenceFor.push("rounding sequence is documented in the plan, workpapers, or a valuation report, and the recomputed benefit matches the recorded benefit");
  } else if (matches && !documented && args.resolvesAcrossCohort && !args.contradictedByDocument) {
    supportClass = "supported";
    evidenceFor.push("undocumented sequence, but the same sequence resolves discrepancies across the cohort and no document contradicts it (rule A-3(b))");
  } else if (matches && !documented) {
    supportClass = "coincidence";
    evidenceAgainst.push(
      "a match obtained by an undocumented rounding sequence is not proof of the administrator's methodology (rule A-2); recorded as coincidence, never presented as an explanation",
    );
  } else {
    supportClass = "refuted";
    evidenceAgainst.push("the rounding sequence does not reproduce the recorded benefit");
  }
  return {
    operation,
    hypothesisCode: "H15",
    benefit: recomputedBenefit,
    residualDelta,
    supportClass,
    evidenceFor,
    evidenceAgainst,
  };
}

/** A discrepancy larger than the max plausible rounding effect cannot be
 *  explained by rounding alone ([S1-03] §2.7). Returns true when rounding
 *  alone cannot explain a discrepancy of `deltaMinor` minor units. */
export function discrepancyExceedsRounding(
  deltaMinor: number,
  maxEffect: Money,
): boolean {
  return Math.abs(deltaMinor) > maxEffect.amountMinor;
}
