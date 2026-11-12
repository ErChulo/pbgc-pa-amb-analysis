/**
 * Unit tests for src/rounding.ts — Stage 8 rounding and the
 * anti-coincidence rule (Stage 3 §3.5, rules A-1–A-5; §5.7 T-R-01–T-R-03).
 *
 * Covers:
 * - F-R-01 applyServiceRounding (prescribed R-1 rule, or none-prescribed);
 * - R-3 money rounding, Blond §5.01 (final annual benefit to the nearest
 *   whole dollar; per-period components NOT rounded);
 * - F-R-02 maxPlausibleRoundingEffect (a discrepancy larger than the max
 *   cannot be explained by rounding alone);
 * - F-R-03 testRoundingSequence (H15 counterfactual: supported /
 *   plausible / coincidence / refuted).
 *
 * Run with plain node + node:test (no test framework dependency):
 *   npm test            (builds with tsc, then runs node --test dist/test/)
 *
 * Synthetic data only. No live case data.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyMoneyRounding,
  applyServiceRounding,
  discrepancyExceedsRounding,
  isDocumentedSequence,
  maxPlausibleRoundingEffect,
  testRoundingSequence,
} from "../src/rounding.js";
import type {
  RoundingConfig,
  RoundingRule,
  RoundingSequence,
  ServiceResult,
  TypedBenefitQuantity,
} from "../src/types.js";
import { decAdd, decRound, makeMoney } from "../src/decimal.js";

function serviceRule(overrides: Partial<RoundingRule> = {}): RoundingRule {
  return {
    target: "credited-service",
    unit: "1",
    mode: "half-up",
    stage: "final",
    source: { kind: "plan-provision", citation: "plan § (service rounding)" },
    ...overrides,
  };
}

function moneyRule(overrides: Partial<RoundingRule> = {}): RoundingRule {
  return {
    target: "final-monthly-benefit",
    unit: "0.01",
    mode: "half-up",
    stage: "final",
    source: { kind: "plan-provision", citation: "plan § (money rounding)" },
    ...overrides,
  };
}

function config(prescribedSequence: RoundingSequence | null): RoundingConfig {
  return {
    configId: "rc-test",
    version: "rounding-config v1.0.0",
    planVersionId: "pv-1",
    prescribedSequence,
    alternativeSequences: [],
    setBy: "tester",
    setDate: "2026-11-12",
    rationale: "test fixture",
  };
}

function svc(value: string | null): ServiceResult {
  return { value, rational: null, periods: [], missingInputs: [], roundingApplied: [] };
}

function benefit(amountMinor: number): TypedBenefitQuantity {
  return {
    amount: makeMoney(amountMinor),
    periodicity: "monthly",
    measurementDate: "2010-06-30",
    measurementBasis: "dote",
    basisNote: null,
    commencementBasis: "payable at NRD",
    retirementAge: 65,
    retirementDate: "2025-03-14",
    annuityForm: "NSF",
    vestingTreatment: "vested",
    planVersionId: "pv-1",
    formulaId: "f-1",
    source: "prior-administrator",
    status: "recorded",
    ownerId: "obs-1",
  };
}

describe("F-R-01: applyServiceRounding (R-1, Stage 8)", () => {
  it("applies the prescribed rule and records the operation", () => {
    const result = applyServiceRounding(svc("24.25"), serviceRule({ unit: "1", mode: "half-up" }));
    assert.equal(result.value, "24");
    assert.equal(result.roundingApplied.length, 1);
    assert.equal(result.roundingApplied[0]?.before, "24.25");
    assert.equal(result.roundingApplied[0]?.after, "24");
  });

  it("a null rule means none-prescribed: the service is returned unchanged", () => {
    const result = applyServiceRounding(svc("24.25"), null);
    assert.equal(result.value, "24.25");
    assert.equal(result.roundingApplied.length, 0);
  });

  it("a null service value stays null (no rounding of an unknown quantity)", () => {
    assert.equal(applyServiceRounding(svc(null), serviceRule()).value, null);
  });

  it("refuses to apply a non-service rule to service", () => {
    assert.throws(
      () => applyServiceRounding(svc("24.25"), moneyRule()),
      /not "credited-service"/,
    );
  });

  it("definition-internal rounding is not re-applied here (no double rounding)", () => {
    // 24.25 already carries its months round-up from the service
    // computation; Stage 8 applies only the configured rule, once.
    const once = applyServiceRounding(svc("24.25"), serviceRule({ unit: "1", mode: "down" }));
    assert.equal(once.value, "24");
    assert.equal(once.roundingApplied.length, 1);
  });
});

describe("T-R-01: Blond §5.01 — final benefit to the nearest whole dollar", () => {
  it("the prescribed sequence rounds the FINAL annual benefit only", () => {
    const rule = moneyRule({ target: "final-monthly-benefit", unit: "1", mode: "half-up" });
    assert.equal(applyMoneyRounding("1234.56", rule), "1235");
    assert.equal(applyMoneyRounding("1234.49", rule), "1234");
  });

  it("per-period rounding is a DIFFERENT sequence with a different result", () => {
    // Three period components of 100.4: rounded per period they sum to
    // 300; summed first and rounded once (the §5.01 sequence) they give 301.
    const perPeriod = decAdd(decAdd(decRound("100.4", "1", "half-up"), decRound("100.4", "1", "half-up")), decRound("100.4", "1", "half-up"));
    const prescribed = decRound(decAdd(decAdd("100.4", "100.4"), "100.4"), "1", "half-up");
    assert.equal(perPeriod, "300");
    assert.equal(prescribed, "301");
    assert.equal(perPeriod === prescribed, false);
  });
});

describe("T-R-02: maxPlausibleRoundingEffect", () => {
  it("cent-rounding bounds a single-stage effect at $0.005 (1 minor unit, ceiling)", () => {
    const cfg = config({
      sequenceId: "seq-cent",
      rules: [moneyRule({ unit: "0.01", mode: "half-up" })],
    });
    const effect = maxPlausibleRoundingEffect(benefit(242500), cfg, svc("24.25"));
    assert.equal(effect.amountMinor, 1);
  });

  it("whole-year service rounding bounds at one year's accrual", () => {
    // $2,425/month over 24.25 years = $100/month per year of service;
    // a 1-year unit at half-up bounds the effect at $50.
    const cfg = config({
      sequenceId: "seq-service",
      rules: [serviceRule({ unit: "1", mode: "half-up" })],
    });
    const effect = maxPlausibleRoundingEffect(benefit(242500), cfg, svc("24.25"));
    assert.equal(effect.amountMinor, 5000);
  });

  it("the max is the sum over stages; no prescribed sequence means zero", () => {
    const cfg = config({
      sequenceId: "seq-both",
      rules: [
        moneyRule({ unit: "0.01", mode: "half-up" }),
        serviceRule({ unit: "1", mode: "half-up" }),
      ],
    });
    assert.equal(maxPlausibleRoundingEffect(benefit(242500), cfg, svc("24.25")).amountMinor, 5001);
    assert.equal(maxPlausibleRoundingEffect(benefit(242500), config(null), svc("24.25")).amountMinor, 0);
  });

  it("a discrepancy larger than the max cannot be explained by rounding alone", () => {
    const cfg = config({
      sequenceId: "seq-cent",
      rules: [moneyRule({ unit: "0.01", mode: "half-up" })],
    });
    const max = maxPlausibleRoundingEffect(benefit(242500), cfg, svc("24.25"));
    assert.equal(discrepancyExceedsRounding(2, max), true);
    assert.equal(discrepancyExceedsRounding(1, max), false);
    assert.equal(discrepancyExceedsRounding(0, max), false);
  });
});

describe("T-R-03 / §3.5: anti-coincidence — a match is not proof", () => {
  const documentedSeq: RoundingSequence = {
    sequenceId: "seq-documented",
    rules: [moneyRule({ source: { kind: "plan-provision", citation: "Blond §5.01" } })],
  };
  const undocumentedSeq: RoundingSequence = {
    sequenceId: "seq-undocumented",
    rules: [moneyRule({ source: { kind: "not-documented", citation: null } })],
  };

  it("documented sequence + match -> supported", () => {
    const result = testRoundingSequence({
      sequence: documentedSeq,
      recomputedBenefit: benefit(242500),
      recordedBenefit: benefit(242500),
      toleranceMinor: 0,
      resolvesAcrossCohort: false,
      contradictedByDocument: false,
    });
    assert.equal(result.supportClass, "supported");
    assert.equal(result.residualDelta?.amountMinor, 0);
  });

  it("undocumented sequence + match -> coincidence, never an explanation", () => {
    const result = testRoundingSequence({
      sequence: undocumentedSeq,
      recomputedBenefit: benefit(242500),
      recordedBenefit: benefit(242500),
      toleranceMinor: 0,
      resolvesAcrossCohort: false,
      contradictedByDocument: false,
    });
    assert.equal(result.supportClass, "coincidence");
    assert.equal(result.residualDelta?.amountMinor, 0);
  });

  it("undocumented sequence + match + cohort-wide resolution -> supported (A-3(b))", () => {
    const result = testRoundingSequence({
      sequence: undocumentedSeq,
      recomputedBenefit: benefit(242500),
      recordedBenefit: benefit(242500),
      toleranceMinor: 0,
      resolvesAcrossCohort: true,
      contradictedByDocument: false,
    });
    assert.equal(result.supportClass, "supported");
  });

  it("documented sequence + no match -> refuted; unevaluable sequence -> refuted", () => {
    const noMatch = testRoundingSequence({
      sequence: documentedSeq,
      recomputedBenefit: benefit(242600),
      recordedBenefit: benefit(242500),
      toleranceMinor: 0,
      resolvesAcrossCohort: false,
      contradictedByDocument: false,
    });
    assert.equal(noMatch.supportClass, "refuted");
    assert.equal(noMatch.residualDelta?.amountMinor, 100);
    const unevaluable = testRoundingSequence({
      sequence: documentedSeq,
      recomputedBenefit: null,
      recordedBenefit: benefit(242500),
      toleranceMinor: 0,
      resolvesAcrossCohort: false,
      contradictedByDocument: false,
    });
    assert.equal(unevaluable.supportClass, "refuted");
    assert.equal(unevaluable.benefit, null);
  });

  it("isDocumentedSequence: one undocumented rule makes the sequence undocumented", () => {
    assert.equal(isDocumentedSequence(documentedSeq), true);
    assert.equal(isDocumentedSequence(undocumentedSeq), false);
    assert.equal(
      isDocumentedSequence({
        sequenceId: "seq-mixed",
        rules: [
          moneyRule({ source: { kind: "plan-provision", citation: "plan §" } }),
          moneyRule({ source: { kind: "not-documented", citation: null } }),
        ],
      }),
      false,
    );
    assert.equal(isDocumentedSequence({ sequenceId: "seq-empty", rules: [] }), false);
  });
});
