/**
 * Tests for the 34 formula operations (src/formulas.ts), the statutory
 * accrual tests (src/accrualTests.ts), and the composition engine
 * (src/compose.ts). Plain node:test; no framework.
 *
 * Every numerical example is fictional (Stage 1 §10 of
 * 01-formula-classification.md; DBAB worked examples use fictional
 * companies and people). Money is asserted in integer minor units.
 * The CalcContext rounding is "nearest-cent" (plan-stated mode for the
 * test fixtures): a monthly value with fractional cents is the half-up
 * cents representation of the exact value.
 *
 * Two deliberate divergences from the Answer Book's printed numbers are
 * asserted here, because the engine rounds only at prescribed points
 * (MASTER_PROMPT §9) while the book rounds an intermediate to whole
 * dollars for presentation:
 * - I-01 Frank: the book rounds the per-year amount $1,027.50 to $1,028
 *   and prints $2,142/month. The engine keeps $25,687.50/year exact and
 *   rounds only the final monthly amount: $2,140.63/month.
 * - I-05 Employee A: the book rounds the offset $819.65 to $820 and
 *   prints $180/month. The engine keeps the offset exact: $180.35/month.
 * - C-05 D&R Method 1: the book's $29,000/year is $2,416.67/month. The
 *   engine sums the annual components exactly ($29,000/year); the
 *   monthly $2,416.67 is asserted as the conversion of that annual sum,
 *   not as the sum of the rounded monthlies ($2,083.33 + $333.33 =
 *   $2,416.66).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeMoney } from "../src/decimal.js";
import type {
  CalcContext,
  CalcResult,
  PlanVersion,
  PlanVersionTimeline,
  Provenance,
  SourcedValue,
  TypedBenefitQuantity,
} from "../src/types.js";
import {
  applySection415Limit,
  applyVesting,
  calcCareerAverage,
  calcCashBalance,
  calcContributory,
  calcCoveredCompIntegration,
  calcDollarPerYear,
  calcEmployeeContributionBenefit,
  calcExcessBenefit,
  calcFinalOrHighestAverage,
  calcFlatDollar,
  calcFixedPercentage,
  calcFractionalAccrual,
  calcFreshStart,
  calcFrozen,
  calcGrandfathered,
  calcGreaterOf,
  calcGroupSpecific,
  calcLesserOf,
  calcMinimumBenefit,
  calcMultiplePeriods,
  calcOtherHybrid,
  calcPastServiceCredit,
  calcPensionEquity,
  calcPermittedDisparity,
  calcPiaOffset,
  calcPlanOffset,
  calcPostNra,
  calcRehireRestoration,
  calcServiceCapped,
  calcStepRate,
  calcUnitCredit,
  capCompensationYear,
  convertFormAndAge,
  datedValue,
  evaluateFormulaCall,
  makeBenefit,
  monthlyMoneyOfAnnual,
} from "../src/formulas.js";
import {
  applyLimit,
  applyProtection,
  checkAntiDecrease,
  combineResults,
  describeComparison,
  normalizeBenefit,
  selectProvisionsByDate,
} from "../src/compose.js";
import {
  runAccrualTests,
  test133PercentRule,
  testFractionalRule,
  testThreePercentRule,
} from "../src/accrualTests.js";

const ctx: CalcContext = {
  planVersionId: "v1",
  measurementDate: "2020-02-29",
  rounding: { stage: "final-only", mode: "nearest-cent", source: "test fixture" },
};

/** Minor units of an exact result; throws (failing the test) otherwise. */
function exactMinor(result: CalcResult<TypedBenefitQuantity>): number {
  assert.equal(result.kind, "exact", `expected exact, got ${result.kind}`);
  if (result.kind !== "exact") throw new Error("unreachable");
  const amount = result.value.amount;
  assert.equal(amount !== null, true, "exact result carries no amount");
  return amount?.amountMinor ?? -1;
}

function boundMinors(result: CalcResult<TypedBenefitQuantity>): [number, number] {
  assert.equal(result.kind, "bound", `expected bound, got ${result.kind}`);
  if (result.kind !== "bound") throw new Error("unreachable");
  return [
    result.min.amount?.amountMinor ?? -1,
    result.max.amount?.amountMinor ?? -1,
  ];
}

function scenarioMinors(result: CalcResult<TypedBenefitQuantity>): number[] {
  assert.equal(result.kind, "scenarios", `expected scenarios, got ${result.kind}`);
  if (result.kind !== "scenarios") throw new Error("unreachable");
  return result.scenarios.map((s) => s.value.amount?.amountMinor ?? -1);
}

/** An exact monthly TypedBenefitQuantity, for combination-formula inputs. */
function monthlyExact(minor: number): CalcResult<TypedBenefitQuantity> {
  return {
    kind: "exact",
    value: makeBenefit(ctx, makeMoney(minor), "monthly"),
    evidenceGrade: "fact",
  };
}

function annualExact(minor: number): CalcResult<TypedBenefitQuantity> {
  return {
    kind: "exact",
    value: makeBenefit(ctx, makeMoney(minor), "annual"),
    evidenceGrade: "fact",
  };
}

function prov(): Provenance {
  return {
    documentId: "doc-1",
    location: {
      kind: "user-entered",
      enteredBy: "tester",
      enteredDate: "2026-01-01",
      entryForm: "test",
    },
    acquisition: "user-entered",
    derivation: null,
    sourceFileHash: null,
  };
}

function sourced<T>(value: T | null): SourcedValue<T> {
  return { value, provenance: prov() };
}

function planVersion(
  versionId: string,
  effectiveDate: string,
  formulaIds: string[],
): PlanVersion {
  return {
    id: versionId,
    version: 1,
    supersedesId: null,
    sourceRecordIds: [],
    createdDate: "2026-01-01",
    createdBy: "tester",
    planId: "plan-1",
    versionId,
    effectiveDate: sourced(effectiveDate),
    adoptionDate: sourced("1985-06-01"),
    restatementDate: sourced(null),
    provisionText: sourced(""),
    provisionSection: sourced("§5.01"),
    supersedesVersionId: null,
    grandfatheredGroups: sourced([]),
    freeze: sourced(null),
    sourceDocumentId: "doc-1",
    changeSummary: "",
    statutoryLimitsInForce: [],
    formulaIds,
  };
}

// ---------------------------------------------------------------------------
// T-01–T-09 — Traditional formulas
// ---------------------------------------------------------------------------

describe("T-01 flat-dollar", () => {
  it("Dane: $1,000 x 10/25 = $400/month; Brittany full $1,000/month", () => {
    const dane = calcFlatDollar(ctx, {
      flatAmount: datedValue("1000", "1985-07-01", "v1"),
      service: "10",
      fullService: "25",
    });
    assert.equal(exactMinor(dane), 40000);
    const brittany = calcFlatDollar(ctx, {
      flatAmount: datedValue("1000", "1985-07-01", "v1"),
      service: "30",
      fullService: "25",
    });
    assert.equal(exactMinor(brittany), 100000);
  });

  it("candidate flat amounts give a bound, never a point value", () => {
    const result = calcFlatDollar(ctx, {
      flatAmount: datedValue("1000", "1985-07-01", "v1"),
      service: "10",
      fullService: "25",
      flatAmountCandidates: [
        datedValue("900", "1985-07-01", "v1"),
        datedValue("1000", "1985-07-01", "v1"),
        datedValue("1100", "1985-07-01", "v1"),
      ],
    });
    assert.deepEqual(boundMinors(result), [36000, 44000]);
  });
});

describe("T-02 fixed-percentage", () => {
  it("Reese: 75% x $60,000 x 10/30 = $15,000/year = $1,250/month", () => {
    const result = calcFixedPercentage(ctx, {
      percent: datedValue("0.75", "1985-07-01", "v1"),
      avgComp: "60000",
      service: "10",
      fullService: "30",
    });
    assert.equal(exactMinor(result), 125000);
  });

  it("candidate averaging periods give scenarios", () => {
    const result = calcFixedPercentage(ctx, {
      percent: datedValue("0.75", "1985-07-01", "v1"),
      avgComp: "60000",
      service: "10",
      fullService: "30",
      avgCompCandidates: [
        { period: "final-3-year", avgComp: "60000" },
        { period: "highest-5-year", avgComp: "58000" },
      ],
    });
    assert.deepEqual(scenarioMinors(result), [125000, 120833]);
  });
});

describe("T-03 dollar-per-year", () => {
  it("Robby: 20 x $100 = $2,000/month", () => {
    const result = calcDollarPerYear(ctx, {
      unitRate: datedValue("100", "1985-07-01", "v1"),
      service: "20",
    });
    assert.equal(exactMinor(result), 200000);
  });

  it("documented rate range gives a bound", () => {
    const result = calcDollarPerYear(ctx, {
      unitRate: datedValue("100", "1985-07-01", "v1"),
      service: "20",
      unitRateRange: { low: "90", high: "110" },
    });
    assert.deepEqual(boundMinors(result), [180000, 220000]);
  });
});

describe("T-04 unit-credit", () => {
  it("Frank: 1% x $60,000 x 20 = $12,000/year = $1,000/month", () => {
    const result = calcUnitCredit(ctx, {
      accrualRate: datedValue("0.01", "1985-07-01", "v1"),
      avgComp: "60000",
      service: "20",
    });
    assert.equal(exactMinor(result), 100000);
  });

  it("average-compensation range gives a bound", () => {
    const result = calcUnitCredit(ctx, {
      accrualRate: datedValue("0.01", "1985-07-01", "v1"),
      avgComp: "60000",
      service: "20",
      avgCompRange: { low: "55000", high: "65000" },
    });
    assert.deepEqual(boundMinors(result), [91667, 108333]);
  });
});

describe("T-05 career-average", () => {
  const twentyYears = Array.from({ length: 20 }, (_, i) => ({
    year: 2000 + i,
    comp: "50000",
  }));

  it("Ana: 1.5% x $50,000 x 20 = $15,000/year = $1,250/month", () => {
    const result = calcCareerAverage(ctx, {
      accrualRate: datedValue("0.015", "1985-07-01", "v1"),
      compByYear: twentyYears,
      service: "20",
    });
    assert.equal(exactMinor(result), 125000);
  });

  it("one missing year with bounded fills gives a bound", () => {
    const result = calcCareerAverage(ctx, {
      accrualRate: datedValue("0.015", "1985-07-01", "v1"),
      compByYear: twentyYears.slice(0, 19),
      service: "20",
      missingYears: [{ year: 2019, low: "40000", high: "60000" }],
    });
    assert.deepEqual(boundMinors(result), [123750, 126250]);
  });
});

describe("T-06 final/highest-average", () => {
  it("Ben: 1.5% x $80,000 x 25 = $30,000/year = $2,500/month", () => {
    const result = calcFinalOrHighestAverage(ctx, {
      accrualRate: datedValue("0.015", "1985-07-01", "v1"),
      windowYears: 3,
      windowKind: "highest",
      compByYear: [
        { year: 2015, comp: "70000" },
        { year: 2016, comp: "75000" },
        { year: 2017, comp: "80000" },
        { year: 2018, comp: "80000" },
        { year: 2019, comp: "80000" },
      ],
      service: "25",
    });
    assert.equal(exactMinor(result), 250000);
  });

  it("highest vs final undocumented gives scenarios", () => {
    const result = calcFinalOrHighestAverage(ctx, {
      accrualRate: datedValue("0.015", "1985-07-01", "v1"),
      windowYears: 3,
      windowKind: "highest",
      compByYear: [
        { year: 2015, comp: "90000" },
        { year: 2016, comp: "85000" },
        { year: 2017, comp: "80000" },
        { year: 2018, comp: "75000" },
        { year: 2019, comp: "70000" },
      ],
      service: "25",
      windowKindUnknown: true,
    });
    // Highest 3 (2015-2017, avg $85,000): $2,656.25. Final 3 (2017-2019,
    // avg $75,000): $2,343.75. Order follows the scenario list: highest
    // first when windowKind is "highest".
    assert.deepEqual(scenarioMinors(result), [265625, 234375]);
  });
});

describe("T-07 fractional accrual", () => {
  it("Andrew: 50% x $60,000 x 20/30 = $20,000/year = $1,666.67/month", () => {
    const result = calcFractionalAccrual(ctx, {
      projectedBenefit: "30000",
      service: "20",
      projectedService: "30",
    });
    assert.equal(exactMinor(result), 166667);
  });

  it("projected-service conventions give scenarios", () => {
    const result = calcFractionalAccrual(ctx, {
      projectedBenefit: "30000",
      service: "20",
      projectedService: "30",
      projectedServiceScenarios: [
        { label: "to 65", projectedService: "30" },
        { label: "to 62", projectedService: "27" },
      ],
    });
    assert.deepEqual(scenarioMinors(result), [166667, 185185]);
  });
});

describe("T-08 step-rate", () => {
  const daneBands = [
    { fromService: "0", toService: "15", rate: datedValue("0.01", "1985-07-01", "v1") },
    { fromService: "15", toService: "20", rate: datedValue("0.014", "1985-07-01", "v1") },
    { fromService: "20", toService: null, rate: datedValue("0.0165", "1985-07-01", "v1") },
  ];

  it("Dane tiers: 30.25% x $60,000 = $18,150/year = $1,512.50/month", () => {
    const result = calcStepRate(ctx, {
      bands: daneBands,
      avgComp: "60000",
      service: "25",
    });
    assert.equal(exactMinor(result), 151250);
  });

  it("dollar form: 15 x $80 + 10 x $100 = $2,200/month", () => {
    const result = calcStepRate(ctx, {
      bands: daneBands,
      service: "25",
      dollarRates: [
        { fromService: "0", toService: "15", rate: "80" },
        { fromService: "15", toService: null, rate: "100" },
      ],
    });
    assert.equal(exactMinor(result), 220000);
  });
});

describe("T-09 service-capped", () => {
  const unitCredit = (service: string): CalcResult<TypedBenefitQuantity> =>
    calcUnitCredit(ctx, {
      accrualRate: datedValue("0.01", "1985-07-01", "v1"),
      avgComp: "80000",
      service,
    });

  it("Carla: 1% x $80,000 x 25 (capped from 35) = $1,666.67/month", () => {
    const result = calcServiceCapped(ctx, {
      serviceCap: datedValue("25", "1985-07-01", "v1"),
      service: "35",
      whichYears: "last-n",
      underlying: unitCredit,
    });
    assert.equal(exactMinor(result), 166667);
  });

  it("minimum plausible cap gives a bound", () => {
    const result = calcServiceCapped(ctx, {
      serviceCap: datedValue("25", "1985-07-01", "v1"),
      service: "35",
      whichYears: "last-n",
      underlying: unitCredit,
      minPlausibleCap: "20",
    });
    assert.deepEqual(boundMinors(result), [133333, 233333]);
  });
});

// ---------------------------------------------------------------------------
// I-01–I-05 — Integrated formulas
// ---------------------------------------------------------------------------

describe("I-01 excess benefit", () => {
  it("Frank: 1% to $45,000 + 1.65% above, $80,000 avg, 25 years = $2,140.63/month (book rounds the intermediate to $2,142)", () => {
    const result = calcExcessBenefit(ctx, {
      baseRate: datedValue("0.01", "1985-07-01", "v1"),
      excessRate: datedValue("0.0165", "1985-07-01", "v1"),
      integrationLevel: datedValue("45000", "1985-07-01", "v1"),
      avgComp: "80000",
      service: "25",
      form: "unit-credit",
    });
    assert.equal(exactMinor(result), 214063);
  });

  it("integration-level range gives a bound", () => {
    const result = calcExcessBenefit(ctx, {
      baseRate: datedValue("0.01", "1985-07-01", "v1"),
      excessRate: datedValue("0.0165", "1985-07-01", "v1"),
      integrationLevel: datedValue("45000", "1985-07-01", "v1"),
      avgComp: "80000",
      service: "25",
      form: "unit-credit",
      integrationLevelRange: { low: "40000", high: "50000" },
    });
    assert.deepEqual(boundMinors(result), [207292, 220833]);
  });
});

describe("I-02 covered-compensation integration", () => {
  const table = {
    tableYear: 2024,
    valuesByBirthYear: { 1960: "45000" },
    source: "IRS covered-compensation table 2024",
  };

  it("Frank via the table lookup: same $2,140.63/month as I-01", () => {
    const result = calcCoveredCompIntegration(ctx, {
      baseRate: datedValue("0.01", "1985-07-01", "v1"),
      excessRate: datedValue("0.0165", "1985-07-01", "v1"),
      birthYear: 1960,
      calculationDate: "2024-02-29",
      coveredCompTable: table,
      avgComp: "80000",
      service: "25",
    });
    assert.equal(exactMinor(result), 214063);
  });

  it("missing birth year is indeterminate — never estimated from age bands", () => {
    const result = calcCoveredCompIntegration(ctx, {
      baseRate: datedValue("0.01", "1985-07-01", "v1"),
      excessRate: datedValue("0.0165", "1985-07-01", "v1"),
      birthYear: null,
      calculationDate: "2024-02-29",
      coveredCompTable: table,
      avgComp: "80000",
      service: "25",
    });
    assert.equal(result.kind, "indeterminate");
  });

  it("missing table is indeterminate — never a neighbouring year", () => {
    const result = calcCoveredCompIntegration(ctx, {
      baseRate: datedValue("0.01", "1985-07-01", "v1"),
      excessRate: datedValue("0.0165", "1985-07-01", "v1"),
      birthYear: 1960,
      calculationDate: "2024-02-29",
      coveredCompTable: null,
      avgComp: "80000",
      service: "25",
    });
    assert.equal(result.kind, "indeterminate");
  });
});

describe("I-03 permitted disparity", () => {
  it("Dana Kim: [0.75% x $60,000 + 0.65% x $50,000] x 20 = $1,291.67/month", () => {
    const result = calcPermittedDisparity(ctx, {
      method: "excess",
      baseRate: datedValue("0.0075", "1985-07-01", "v1"),
      excessOrOffsetRate: datedValue("0.0065", "1985-07-01", "v1"),
      level: datedValue("10000", "1985-07-01", "v1"),
      avgComp: "60000",
      service: "20",
    });
    assert.equal(exactMinor(result), 129167);
  });

  it("undocumented method gives excess vs offset scenarios", () => {
    const result = calcPermittedDisparity(ctx, {
      method: "excess",
      baseRate: datedValue("0.0075", "1985-07-01", "v1"),
      excessOrOffsetRate: datedValue("0.0065", "1985-07-01", "v1"),
      level: datedValue("10000", "1985-07-01", "v1"),
      avgComp: "60000",
      service: "20",
      methodUnknown: true,
    });
    assert.deepEqual(scenarioMinors(result), [129167, 64167]);
  });

  it("excess rate above the 0.75% allowance is indeterminate", () => {
    const result = calcPermittedDisparity(ctx, {
      method: "excess",
      baseRate: datedValue("0.0075", "1985-07-01", "v1"),
      excessOrOffsetRate: datedValue("0.008", "1985-07-01", "v1"),
      level: datedValue("10000", "1985-07-01", "v1"),
      avgComp: "60000",
      service: "20",
    });
    assert.equal(result.kind, "indeterminate");
  });
});

describe("I-04 PIA offset", () => {
  it("Eli: $2,400 gross - 50% x $1,500 PIA = $1,650/month", () => {
    const result = calcPiaOffset(ctx, {
      grossBenefit: "2400",
      pia: datedValue("1500", "2020-02-29", "v1"),
      offsetFraction: datedValue("0.5", "1985-07-01", "v1"),
      service: "20",
      piaBasis: "actual-wage-history",
      socialSecurityActVersion: "2024",
    });
    assert.equal(exactMinor(result), 165000);
  });

  it("PIA range gives a bound (max PIA = min benefit)", () => {
    const result = calcPiaOffset(ctx, {
      grossBenefit: "2400",
      pia: null,
      offsetFraction: datedValue("0.5", "1985-07-01", "v1"),
      service: "20",
      piaBasis: "actual-wage-history",
      socialSecurityActVersion: "2024",
      piaRange: { low: "1200", high: "1800" },
    });
    assert.deepEqual(boundMinors(result), [150000, 180000]);
  });

  it("PIA missing with no range is indeterminate", () => {
    const result = calcPiaOffset(ctx, {
      grossBenefit: "2400",
      pia: null,
      offsetFraction: datedValue("0.5", "1985-07-01", "v1"),
      service: "20",
      piaBasis: "actual-wage-history",
      socialSecurityActVersion: "2024",
    });
    assert.equal(result.kind, "indeterminate");
  });
});

describe("I-05 plan offset", () => {
  it("Employee A: $1,000 - $50,000 x 1.07^10 / 120 = $180.35/month (book rounds the offset to $820, giving $180)", () => {
    const result = calcPlanOffset(ctx, {
      grossBenefit: "1000",
      offsetKind: "floor-offset-dc",
      dcBalance: "50000",
      projectionRate: "0.07",
      yearsToNra: "10",
      aprAtNra: "120",
    });
    assert.equal(exactMinor(result), 18035);
  });

  it("no DC balance bounds the net between $0 and the gross", () => {
    const result = calcPlanOffset(ctx, {
      grossBenefit: "1000",
      offsetKind: "floor-offset-dc",
    });
    assert.deepEqual(boundMinors(result), [0, 100000]);
  });
});

// ---------------------------------------------------------------------------
// C-01–C-07 — Combination formulas
// ---------------------------------------------------------------------------

describe("C-01 greater-of", () => {
  it("Fatima: max($1,500 unit-credit, $1,000 flat) = $1,500/month", () => {
    const a = calcUnitCredit(ctx, {
      accrualRate: datedValue("0.015", "1985-07-01", "v1"),
      avgComp: "60000",
      service: "20",
    });
    const b = calcFlatDollar(ctx, {
      flatAmount: datedValue("1000", "1985-07-01", "v1"),
      service: "20",
      fullService: "20",
      noServiceReduction: true,
    });
    const result = calcGreaterOf(ctx, {
      components: [
        { name: "unit-credit", result: a },
        { name: "flat", result: b },
      ],
    });
    assert.equal(exactMinor(result), 150000);
  });

  it("uncomputable component + max plausible value gives a bound", () => {
    const a = calcUnitCredit(ctx, {
      accrualRate: datedValue("0.015", "1985-07-01", "v1"),
      avgComp: "60000",
      service: "20",
    });
    const b: CalcResult<TypedBenefitQuantity> = {
      kind: "indeterminate",
      evidenceGrade: "unknown",
      missingInputs: ["the flat formula's service history"],
      wouldResolve: ["the flat formula's service history"],
    };
    const result = calcGreaterOf(ctx, {
      components: [
        { name: "unit-credit", result: a },
        { name: "flat", result: b },
      ],
      uncomputableMaxMinor: 50000,
    });
    assert.deepEqual(boundMinors(result), [150000, 200000]);
  });
});

describe("C-02 lesser-of", () => {
  it("George: min($2,000 formula, $1,800 limit) = $1,800/month", () => {
    const result = calcLesserOf(ctx, {
      components: [
        { name: "formula", result: monthlyExact(200000) },
        { name: "415-limited", result: monthlyExact(180000) },
      ],
    });
    assert.equal(exactMinor(result), 180000);
  });

  it("binding component uncomputable gives a [0, smallest computable] bound", () => {
    const missing: CalcResult<TypedBenefitQuantity> = {
      kind: "indeterminate",
      evidenceGrade: "unknown",
      missingInputs: ["the collectively-bargained cap"],
      wouldResolve: ["the collective bargaining agreement"],
    };
    const result = calcLesserOf(ctx, {
      components: [
        { name: "formula", result: monthlyExact(200000) },
        { name: "cap", result: missing },
      ],
    });
    assert.deepEqual(boundMinors(result), [0, 200000]);
  });
});

describe("C-03 minimum benefit", () => {
  it("Nick: formula $1,000/month beats the top-heavy minimum $333.33/month", () => {
    const result = calcMinimumBenefit(ctx, {
      formulaBenefit: monthlyExact(100000),
      minimumBenefit: monthlyExact(0),
      topHeavy: { fiveYearAvgComp: "40000", topHeavyService: "5" },
    });
    assert.equal(exactMinor(result), 100000);
  });

  it("top-heavy minimum alone is 2% x 5 x $40,000 = $333.33/month", () => {
    const result = calcMinimumBenefit(ctx, {
      formulaBenefit: monthlyExact(20000),
      minimumBenefit: monthlyExact(0),
      topHeavy: { fiveYearAvgComp: "40000", topHeavyService: "5" },
    });
    assert.equal(exactMinor(result), 33333);
  });
});

describe("C-04 grandfathered", () => {
  it("Hannah: max($1,800 new, $2,000 protected) = $2,000/month", () => {
    const result = calcGrandfathered(ctx, {
      currentBenefit: monthlyExact(180000),
      protectedBenefit: monthlyExact(200000),
      amendment: { adoptionDate: "2019-01-01", effectiveDate: "2020-01-01" },
    });
    assert.equal(exactMinor(result), 200000);
  });
});

describe("C-05 fresh-start", () => {
  const frozen = annualExact(2500000);
  const post = annualExact(400000);
  const total = annualExact(2400000);

  it("D&R Method 1 (without wear-away): $25,000 + $4,000 = $29,000/year", () => {
    const result = calcFreshStart(ctx, {
      method: "without-wear-away",
      frozenBenefit: frozen,
      postFreshStartAccrual: post,
      totalServiceBenefit: total,
      freshStartDate: "1988-12-31",
    });
    assert.equal(exactMinor(result), 2900000);
    // $29,000/year is $2,416.67/month — asserted as the conversion of the
    // exact annual sum, not the sum of the rounded monthlies.
    assert.equal(monthlyMoneyOfAnnual(ctx.rounding, "29000").amountMinor, 241667);
  });

  it("D&R Method 2 (with wear-away): max($25,000, $24,000) = $25,000/year", () => {
    const result = calcFreshStart(ctx, {
      method: "with-wear-away",
      frozenBenefit: frozen,
      postFreshStartAccrual: post,
      totalServiceBenefit: total,
      freshStartDate: "1988-12-31",
    });
    assert.equal(exactMinor(result), 2500000);
    assert.equal(monthlyMoneyOfAnnual(ctx.rounding, "25000").amountMinor, 208333);
  });

  it("method unknown gives all three methods as scenarios", () => {
    const result = calcFreshStart(ctx, {
      frozenBenefit: frozen,
      postFreshStartAccrual: post,
      totalServiceBenefit: total,
      freshStartDate: "1988-12-31",
    });
    assert.deepEqual(scenarioMinors(result), [2900000, 2500000, 2900000]);
  });
});

describe("C-06 multiple periods", () => {
  it("Ivan: 10 x $90 + 10 x $150 = $2,400/month", () => {
    const result = calcMultiplePeriods(ctx, {
      periods: [
        {
          from: "1986-01-01",
          to: "1988-12-31",
          formula: (c, s) => calcDollarPerYear(c, {
            unitRate: datedValue("90", "1986-01-01", "v1"),
            service: s,
          }),
          service: "10",
          comp: "0",
        },
        {
          from: "1991-01-01",
          to: "1994-12-31",
          formula: (c, s) => calcDollarPerYear(c, {
            unitRate: datedValue("150", "1991-01-01", "v1"),
            service: s,
          }),
          service: "10",
          comp: "0",
        },
      ],
    });
    assert.equal(exactMinor(result), 240000);
  });
});

describe("C-07 group-specific", () => {
  const unionFormula = (
    c: CalcContext,
    s: string,
  ): CalcResult<TypedBenefitQuantity> => calcDollarPerYear(c, {
    unitRate: datedValue("80", "1995-01-01", "v1"),
    service: s,
  });
  const nonunionFormula = (
    c: CalcContext,
    s: string,
    comp: string,
  ): CalcResult<TypedBenefitQuantity> => calcUnitCredit(c, {
    accrualRate: datedValue("0.015", "1995-01-01", "v1"),
    avgComp: comp,
    service: s,
  });

  it("Julia: 25 union years x $80 = $2,000/month", () => {
    const result = calcGroupSpecific(ctx, {
      groupHistory: [
        { from: "1995-01-01", to: null, groupId: "union", service: "25", comp: "60000" },
      ],
      groupFormulas: { union: unionFormula, nonunion: nonunionFormula },
      combine: "sum",
    });
    assert.equal(exactMinor(result), 200000);
  });

  it("unknown group for 5 years bounds the total over both groups", () => {
    const result = calcGroupSpecific(ctx, {
      groupHistory: [
        { from: "1995-01-01", to: null, groupId: "union", service: "25", comp: "60000" },
      ],
      groupFormulas: { union: unionFormula, nonunion: nonunionFormula },
      combine: "sum",
      possibleGroupsForUnknownService: [
        { service: "5", comp: "60000", groupIds: ["union", "nonunion"] },
      ],
    });
    // Known $2,000 + unknown 5 years: union $400, nonunion $375.
    assert.deepEqual(boundMinors(result), [237500, 240000]);
  });
});

// ---------------------------------------------------------------------------
// S-01–S-08 — Hybrid and special formulas
// ---------------------------------------------------------------------------

describe("S-01 cash balance", () => {
  it("Neff: $50,000 x 1.05^20 / 151.458 = $875.92/month", () => {
    const result = calcCashBalance(ctx, {
      openingBalance: "50000",
      payCredits: [],
      interestRates: [],
      ageAtMeasurement: "45",
      normalRetirementAge: "65",
      aprAtNra: "151.458",
      terminationDate: "2022-12-31",
      fiveYearAvgRate: "0.05",
    });
    assert.equal(exactMinor(result), 87592);
  });

  it("unknown opening balance is indeterminate", () => {
    const result = calcCashBalance(ctx, {
      payCredits: [],
      interestRates: [],
      ageAtMeasurement: "45",
      normalRetirementAge: "65",
      aprAtNra: "151.458",
      openingBalanceUnknown: true,
    });
    assert.equal(result.kind, "indeterminate");
  });
});

describe("S-02 pension equity", () => {
  const credits = Array.from({ length: 20 }, (_, i) => ({
    year: 2000 + i,
    points: "0.02",
  }));

  it("Karen: 40% x $75,000 = $30,000 / 151.458 = $198.07/month", () => {
    const result = calcPensionEquity(ctx, {
      percentageCredits: credits,
      finalAvgComp: "75000",
      aprAtNra: "151.458",
    });
    assert.equal(exactMinor(result), 19807);
  });

  it("APR range gives a bound on the annuity", () => {
    const result = calcPensionEquity(ctx, {
      percentageCredits: credits,
      finalAvgComp: "75000",
      aprAtNra: null,
      aprRange: { low: "140", high: "160" },
    });
    assert.deepEqual(boundMinors(result), [18750, 21429]);
  });

  it("no APR and no range is indeterminate (lump sum stays exact)", () => {
    const result = calcPensionEquity(ctx, {
      percentageCredits: credits,
      finalAvgComp: "75000",
      aprAtNra: null,
    });
    assert.equal(result.kind, "indeterminate");
  });
});

describe("S-03 other hybrid", () => {
  it("Luis: $30,000 target x 15/30 = $15,000/year = $1,250/month", () => {
    const result = calcOtherHybrid(ctx, {
      hybridKind: "target-benefit",
      targetBenefit: "30000",
      service: "15",
      projectedService: "30",
      accrualMethod: "fractional",
    });
    assert.equal(exactMinor(result), 125000);
  });

  it("unstated accrual method gives fractional vs unit-credit scenarios", () => {
    const result = calcOtherHybrid(ctx, {
      hybridKind: "target-benefit",
      targetBenefit: "30000",
      service: "15",
      projectedService: "30",
    });
    assert.deepEqual(scenarioMinors(result), [125000, 125000]);
  });
});

describe("S-04 contributory", () => {
  it("Diane: $500 total - $231.83 employee = $268.17 employer", () => {
    const result = calcContributory(ctx, {
      totalBenefit: monthlyExact(50000),
      employeePortion: monthlyExact(23183),
    });
    assert.equal(exactMinor(result), 26817);
  });

  it("missing contribution history bounds the employer portion", () => {
    const missing: CalcResult<TypedBenefitQuantity> = {
      kind: "indeterminate",
      evidenceGrade: "unknown",
      missingInputs: ["mandatory contribution history"],
      wouldResolve: ["the contribution history"],
    };
    const result = calcContributory(ctx, {
      totalBenefit: monthlyExact(50000),
      employeePortion: missing,
    });
    assert.deepEqual(boundMinors(result), [0, 50000]);
  });
});

describe("S-05 employee contributions", () => {
  it("single $10,000 contribution in 2000, 6% to NRA 2001, APR 100 = $106.00/month", () => {
    const result = calcEmployeeContributionBenefit(ctx, {
      contributions: [{ year: 2000, amount: "10000" }],
      federalMidtermRates: [],
      section417eRate: "0.06",
      apr417e: "100",
      totalBenefit: "500",
      determinationYear: 2000,
      nraYear: 2001,
    });
    assert.equal(exactMinor(result), 10600);
  });
});

describe("S-06 frozen", () => {
  it("Maria: hard freeze at 2015-12-31 keeps $1,125/month", () => {
    const result = calcFrozen(ctx, {
      freezeType: "hard",
      freezeDate: "2015-12-31",
      benefitAtFreeze: monthlyExact(112500),
    });
    assert.equal(exactMinor(result), 112500);
  });
});

describe("S-07 past-service credit", () => {
  it("Noah: 1% x $50,000 x (12 + 8) = $10,000/year = $833.33/month", () => {
    const result = calcPastServiceCredit(ctx, {
      pastService: "8",
      currentService: "12",
      creditingRule: "plan §5.02",
      avgComp: "50000",
      accrualRate: datedValue("0.01", "1990-01-01", "v1"),
      planEffectiveDate: "1990-01-01",
    });
    assert.equal(exactMinor(result), 83333);
  });

  it("maximum creditable past service gives a bound", () => {
    const result = calcPastServiceCredit(ctx, {
      pastService: "8",
      currentService: "12",
      creditingRule: "plan §5.02",
      avgComp: "50000",
      accrualRate: datedValue("0.01", "1990-01-01", "v1"),
      planEffectiveDate: "1990-01-01",
      pastServiceMax: "10",
    });
    assert.deepEqual(boundMinors(result), [83333, 91667]);
  });
});

describe("S-08 rehire and restoration", () => {
  const underlying = (service: string): CalcResult<TypedBenefitQuantity> =>
    calcUnitCredit(ctx, {
      accrualRate: datedValue("0.01", "1985-07-01", "v1"),
      avgComp: "55000",
      service,
    });

  it("Olga restored: 3-year break, 6 + 1 = 7 years = $320.83/month", () => {
    const result = calcRehireRestoration(ctx, {
      employmentPeriods: [
        { from: "2010-01-01", to: "2016-01-01", serviceYears: "6" },
        { from: "2019-01-01", to: null, serviceYears: "1" },
      ],
      vestingStatusAtEachBreak: [
        { breakDate: "2016-01-01", vested: false, vestingService: "6" },
      ],
      underlying,
    });
    assert.equal(exactMinor(result), 32083);
  });

  it("5-year break: restored ($320.83) vs forfeited ($45.83) scenarios", () => {
    const result = calcRehireRestoration(ctx, {
      employmentPeriods: [
        { from: "2010-01-01", to: "2016-01-01", serviceYears: "6" },
        { from: "2021-01-01", to: null, serviceYears: "1" },
      ],
      vestingStatusAtEachBreak: [
        { breakDate: "2016-01-01", vested: false, vestingService: "6" },
      ],
      underlying,
    });
    assert.deepEqual(scenarioMinors(result), [32083, 4583]);
    if (result.kind === "scenarios") {
      assert.equal(result.scenarios[0]?.name, "pre-break service restored");
      assert.equal(result.scenarios[1]?.name, "pre-break service forfeited");
    }
  });
});

// ---------------------------------------------------------------------------
// X-01–X-05 — Limits and conversions
// ---------------------------------------------------------------------------

describe("X-01 section 415 limit", () => {
  it("Jan: min($17,500 formula, $15,458.33 dollar cap, $23,333.33 comp cap) = $15,458.33/month", () => {
    const result = applySection415Limit(ctx, {
      formulaBenefit: "17500",
      dollarLimitTable: {
        limitationYear: 2023,
        dollarLimitAnnual: "265000",
        source: "IRC §415(b) 2023",
      },
      high3AvgComp: "280000",
      yearsOfParticipation: "7",
      yearsOfService: "25",
    });
    assert.equal(exactMinor(result), 1545833);
  });

  it("YOP range gives a bound over the dollar-limit range", () => {
    const result = applySection415Limit(ctx, {
      formulaBenefit: "17500",
      dollarLimitTable: {
        limitationYear: 2023,
        dollarLimitAnnual: "265000",
        source: "IRC §415(b) 2023",
      },
      high3AvgComp: "280000",
      yearsOfParticipation: "7",
      yearsOfService: "25",
      yearsOfParticipationRange: { low: "5", high: "9" },
    });
    assert.deepEqual(boundMinors(result), [1104167, 1750000]);
  });

  it("commencement before 65 without adjustment factors is indeterminate", () => {
    const result = applySection415Limit(ctx, {
      formulaBenefit: "17500",
      dollarLimitTable: {
        limitationYear: 2023,
        dollarLimitAnnual: "265000",
        source: "IRC §415(b) 2023",
      },
      high3AvgComp: "280000",
      yearsOfParticipation: "7",
      yearsOfService: "25",
      commencementAge: "60",
    });
    assert.equal(result.kind, "indeterminate");
  });
});

describe("X-02 section 401(a)(17) compensation cap", () => {
  it("Reese: capped years average ($150,000 + $150,000 + $135,000) / 3 = $145,000", () => {
    const capped = capCompensationYear(ctx, {
      compByYear: [
        { year: 1992, comp: "135000" },
        { year: 1993, comp: "155000" },
        { year: 1994, comp: "160000" },
      ],
      compLimitTable: {
        limitsByYear: { 1992: "150000", 1993: "150000", 1994: "150000" },
        source: "IRC §401(a)(17)",
      },
    });
    assert.deepEqual(
      capped.cappedByYear.map((y) => y.comp),
      ["135000", "150000", "150000"],
    );
    const total = capped.cappedByYear.reduce((acc, y) => acc + Number(y.comp), 0);
    assert.equal(total / 3, 145000);
  });

  it("missing table year throws — never a neighbouring year's value", () => {
    assert.throws(() =>
      capCompensationYear(ctx, {
        compByYear: [{ year: 1995, comp: "100000" }],
        compLimitTable: {
          limitsByYear: { 1994: "150000" },
          source: "IRC §401(a)(17)",
        },
      }),
    );
  });
});

describe("X-03 form and age conversion", () => {
  it("(a) form: $1,000 x 110.905 / 118.708 = $934.27/month", () => {
    const result = convertFormAndAge(ctx, {
      normalBenefit: "1000",
      aprNormal: "110.905",
      aprAlternate: "118.708",
      interestRate: "0.06",
      toForm: "10-year certain-and-life",
      deferralMortality: "N",
      mortalityTable: "UP84",
    });
    assert.equal(exactMinor(result), 93427);
  });

  it("(b) early: $1,000 x 126.910 x 0.747258 / 141.335 = $670.99/month at 60", () => {
    const result = convertFormAndAge(ctx, {
      normalBenefit: "1000",
      aprNormal: "141.335",
      aprAlternate: "141.335",
      aprAtNra: "126.910",
      aprAtEarlyAge: "141.335",
      interestRate: "0.06",
      yearsEarly: "5",
      toForm: "life annuity",
      deferralMortality: "N",
      mortalityTable: "UP84",
    });
    assert.equal(exactMinor(result), 67099);
  });

  it("alternative APR sets give scenarios", () => {
    const result = convertFormAndAge(ctx, {
      normalBenefit: "1000",
      aprNormal: "110.905",
      aprAlternate: "118.708",
      interestRate: "0.06",
      toForm: "10-year certain-and-life",
      deferralMortality: "N",
      mortalityTable: "UP84",
      aprAlternatives: [
        { label: "UP84", aprNormal: "110.905", aprAlternate: "118.708" },
        { label: "UP94", aprNormal: "110.905", aprAlternate: "120.000" },
      ],
    });
    assert.deepEqual(scenarioMinors(result), [93427, 92421]);
  });
});

describe("X-04 post-NRA accruals", () => {
  const base = {
    nraBenefit: "600",
    currentFormulaBenefit: "640",
    aeBasis: "plan §7.03",
  };

  it("Brenden option 1 (suspension): $640/month", () => {
    const result = calcPostNra(ctx, { ...base, option: "suspension" });
    assert.equal(exactMinor(result), 64000);
  });

  it("Brenden option 2 (greater-of): max($620, $672) = $672/month", () => {
    const result = calcPostNra(ctx, {
      nraBenefit: "600",
      currentFormulaBenefit: "620",
      actuarialEquivalentOfNraBenefit: "672",
      aeBasis: "plan §7.03",
      option: "greater-of",
    });
    assert.equal(exactMinor(result), 67200);
  });

  it("Brenden option 3 (offset): $640 - $156 floored at $600 in pay = $600/month", () => {
    const result = calcPostNra(ctx, {
      ...base,
      aeOfPaymentsSinceNra: "156",
      benefitAlreadyInPay: "600",
      option: "offset-by-payments",
    });
    assert.equal(exactMinor(result), 60000);
  });

  it("option unknown gives all three options as scenarios", () => {
    const result = calcPostNra(ctx, {
      ...base,
      actuarialEquivalentOfNraBenefit: "672",
      aeOfPaymentsSinceNra: "156",
      benefitAlreadyInPay: "600",
    });
    assert.deepEqual(scenarioMinors(result), [64000, 67200, 60000]);
  });
});

describe("X-05 vesting", () => {
  it("Priya: $1,000 x VP 0.60 (3 years graded) = $600/month", () => {
    const result = applyVesting(ctx, {
      accruedBenefit: "1000",
      vestingService: "3",
      vestingSchedule: [
        { serviceYears: "0", percent: "0" },
        { serviceYears: "3", percent: "0.6" },
      ],
      employerPortionOnly: false,
    });
    assert.equal(exactMinor(result), 60000);
    if (result.kind === "exact") {
      assert.equal(result.value.vestingTreatment, "vested");
    }
  });

  it("vesting-percent range gives a bound", () => {
    const result = applyVesting(ctx, {
      accruedBenefit: "1000",
      vestingService: "3",
      vestingSchedule: [{ serviceYears: "3", percent: "0.6" }],
      employerPortionOnly: false,
      vestingPercentRange: { low: "0.4", high: "0.8" },
    });
    assert.deepEqual(boundMinors(result), [40000, 80000]);
  });
});

describe("evaluateFormulaCall dispatch", () => {
  it("dispatches T-04 and X-05; refuses X-02 as a per-year transform", () => {
    const unitCredit = evaluateFormulaCall(ctx, {
      formulaId: "T-04",
      params: {
        accrualRate: datedValue("0.015", "1985-07-01", "v1"),
        avgComp: "5000",
        service: "20",
      },
    });
    assert.equal(exactMinor(unitCredit), 12500);
    const vesting = evaluateFormulaCall(ctx, {
      formulaId: "X-05",
      params: {
        accruedBenefit: "1000",
        vestingService: "3",
        vestingSchedule: [{ serviceYears: "3", percent: "0.6" }],
        employerPortionOnly: false,
      },
    });
    assert.equal(exactMinor(vesting), 60000);
    const compCap = evaluateFormulaCall(ctx, {
      formulaId: "X-02",
      params: {
        compByYear: [{ year: 1994, comp: "160000" }],
        compLimitTable: {
          limitsByYear: { 1994: "150000" },
          source: "IRC §401(a)(17)",
        },
      },
    });
    assert.equal(compCap.kind, "indeterminate");
  });
});

// ---------------------------------------------------------------------------
// Accrual tests — compliance checks, not formula operations
// ---------------------------------------------------------------------------

describe("accrual tests (IRC §411(b)(1))", () => {
  it("3% rule: Dane's 30.25% accrued beats 3% x 30.25% x 25 = 22.6875%", () => {
    const result = testThreePercentRule({
      accruedBenefitAnnual: "18150",
      projectedNormalBenefitAnnual: "18150",
      serviceYears: "25",
    });
    assert.equal(result.passes, true);
    assert.equal(result.required, "13612.5");
  });

  it("3% rule fails when the accrued benefit is below the floor", () => {
    const result = testThreePercentRule({
      accruedBenefitAnnual: "10000",
      projectedNormalBenefitAnnual: "18150",
      serviceYears: "25",
    });
    assert.equal(result.passes, false);
  });

  it("133⅓% rule: 1% then 1.4% fails (140% > 133⅓%)", () => {
    const result = test133PercentRule({ bandRates: ["0.01", "0.014"] });
    assert.equal(result.passes, false);
  });

  it("133⅓% rule: 1% then 1.3% passes", () => {
    const result = test133PercentRule({ bandRates: ["0.01", "0.013"] });
    assert.equal(result.passes, true);
  });

  it("133⅓% rule: Dane's tiers fail it — and that is a compliance finding, not a refusal: Dane passes the 3% rule", () => {
    const rule133 = test133PercentRule({ bandRates: ["0.01", "0.014", "0.0165"] });
    assert.equal(rule133.passes, false);
    const rule3 = testThreePercentRule({
      accruedBenefitAnnual: "18150",
      projectedNormalBenefitAnnual: "18150",
      serviceYears: "25",
    });
    assert.equal(rule3.passes, true);
  });

  it("fractional rule: Andrew's 20/30 of $30,000 meets the $20,000 floor exactly", () => {
    const result = testFractionalRule({
      accruedBenefitAnnual: "20000",
      projectedBenefitAnnual: "30000",
      serviceYears: "20",
      projectedServiceYears: "30",
    });
    assert.equal(result.passes, true);
    assert.equal(result.required, "20000");
  });

  it("runAccrualTests on a step-rate method runs the 3% and 133⅓% tests", () => {
    const results = runAccrualTests({
      method: "step-rate",
      accruedBenefitAnnual: "18150",
      projectedBenefitAnnual: "18150",
      serviceYears: "25",
      projectedServiceYears: "25",
      bandRates: ["0.01", "0.014", "0.0165"],
    });
    assert.equal(results.length, 2);
    assert.equal(results[0]?.test, "three-percent");
    assert.equal(results[0]?.passes, true);
    assert.equal(results[1]?.test, "133-percent");
    assert.equal(results[1]?.passes, false);
  });
});

// ---------------------------------------------------------------------------
// Composition engine (src/compose.ts)
// ---------------------------------------------------------------------------

describe("composition engine", () => {
  it("combineResults sum adds exact monthlies", () => {
    const result = combineResults(
      [monthlyExact(100000), monthlyExact(50000)],
      "sum",
    );
    assert.equal(exactMinor(result), 150000);
  });

  it("combineResults greater-of takes the max; describeComparison names the winner and margin", () => {
    const components = [
      { name: "unit-credit", result: monthlyExact(150000) },
      { name: "flat", result: monthlyExact(100000) },
    ];
    const result = combineResults(
      components.map((c) => c.result),
      "greater-of",
    );
    assert.equal(exactMinor(result), 150000);
    const comparison = describeComparison(components, "greater-of");
    assert.equal(comparison?.winnerName, "unit-credit");
    assert.equal(comparison?.marginMinor, 50000);
  });

  it("applyProtection greater-of never applies a decrease by amendment", () => {
    const result = applyProtection(monthlyExact(180000), monthlyExact(200000), {
      method: "greater-of",
      ruleRef: "IRC §411(d)(6)",
    });
    assert.equal(exactMinor(result), 200000);
  });

  it("applyProtection with no protected benefit returns the current benefit", () => {
    const result = applyProtection(monthlyExact(180000), null, {
      method: "greater-of",
      ruleRef: "IRC §411(d)(6)",
    });
    assert.equal(exactMinor(result), 180000);
  });

  it("applyLimit caps a monthly benefit; a negative cap is indeterminate", () => {
    const capped = applyLimit(monthlyExact(200000), [
      { capMonthly: "1500", ruleRef: "IRC §415" },
    ]);
    assert.equal(exactMinor(capped), 150000);
    const refused = applyLimit(monthlyExact(200000), [
      { capMonthly: "-100", ruleRef: "bad cap" },
    ]);
    assert.equal(refused.kind, "indeterminate");
  });

  it("normalizeBenefit converts annual $12,000 to monthly $1,000", () => {
    const result = normalizeBenefit(annualExact(1200000), {
      toPeriodicity: "monthly",
      ruleRef: "Stage 9: annual ÷ 12",
    });
    assert.equal(exactMinor(result), 100000);
    if (result.kind === "exact") {
      assert.equal(result.value.periodicity, "monthly");
    }
  });

  it("normalizeBenefit applies vesting: $1,000 x VP 0.60 = $600", () => {
    const result = normalizeBenefit(monthlyExact(100000), {
      vestingPercent: "0.6",
      ruleRef: "Stage 9: VP",
    });
    assert.equal(exactMinor(result), 60000);
  });

  it("checkAntiDecrease flags an unexplained decrease, passes a recognised channel", () => {
    const bad = checkAntiDecrease("1500", "1400");
    assert.equal(bad.ok, false);
    const ok = checkAntiDecrease("1500", "1400", {
      recognisedChannel: "falling final-average compensation (DBAB Q 9:15)",
    });
    assert.equal(ok.ok, true);
    const flat = checkAntiDecrease("1500", "1500");
    assert.equal(flat.ok, true);
  });

  it("selectProvisionsByDate picks the version in force and rejects later ones", () => {
    const timeline: PlanVersionTimeline = {
      planId: "plan-1",
      versions: [
        planVersion("v1", "1985-07-01", ["T-04"]),
        planVersion("v2", "2021-01-01", ["T-06"]),
      ],
    };
    const at2020 = selectProvisionsByDate(timeline, "2020-02-29");
    assert.equal(at2020.version?.versionId, "v1");
    assert.equal(at2020.rejectedLater.length, 1);
    assert.equal(at2020.rejectedLater[0]?.versionId, "v2");
    const before = selectProvisionsByDate(timeline, "1980-01-01");
    assert.equal(before.version, null);
  });
});

// ---------------------------------------------------------------------------
// DB Answer Book question numbers, per formula example (Stage 7 G-ACC-6).
// Every citation below is copied from the §8 "Source citations" line of
// the matching entry in stage1/01-formula-classification.md — nothing is
// coined. Where Stage 1 cites a chapter rather than a question, the
// chapter is recorded as written.
// ---------------------------------------------------------------------------

describe("DBAB question numbers per formula example (Stage 7 G-ACC-6)", () => {
  const FORMULA_DBAB_CITATIONS: Readonly<Record<string, string>> = {
    "T-01": "DBAB Q 9:3; Q 9:7",
    "T-02": "DBAB Q 9:3, Ex. 2; Q 9:37–9:45",
    "T-03": "DBAB Q 9:4, Ex. 2; Q 9:10, Ex. 2",
    "T-04": "DBAB Q 9:4; Q 9:10; Q 10:17",
    "T-05": "DBAB Q 9:12; Q 10:18",
    "T-06": "DBAB Q 9:4, Ex. 1; Q 9:10, Ex. 1; Q 9:50–9:52; Q 10:32",
    "T-07": "DBAB Q 9:8; Q 9:9; Q 9:12; Q 10:18–10:19",
    "T-08": "DBAB Q 9:12, Ex. 1; Q 10:17",
    "T-09": "DBAB Q 9:21",
    "I-01": "DBAB Q 9:5; Q 10:26–10:30",
    "I-02": "DBAB Q 9:5; Q 10:31–10:35",
    "I-03": "DBAB Q 10:25; Q 10:26; Q 10:27–10:30",
    "I-04": "DBAB Q 9:6; Q 9:16",
    "I-05": "DBAB Q 4:16; Q 4:27; Q 4:28; Q 4:29; Q 4:31",
    "C-01": "DBAB Q 9:13; Q 10:18–10:19",
    "C-02": "DBAB Q 9:13; Q 12:4–12:5",
    "C-03": "DBAB Q 9:29–9:36",
    "C-04": "DBAB Q 9:14; Q 9:27; Q 26:1",
    "C-05": "DBAB Q 9:50–9:52",
    "C-06": "DBAB Ch. 9 generally (Blonder-Tongue plan §5.01)",
    "C-07": "DBAB Q 9:13; Q 10:16",
    "S-01": "DBAB Ch. 18, Q 18:1–18:6, Q 18:24–18:26; Q 27:6",
    "S-02": "DBAB Q 9:15; DBAB Ch. 18",
    "S-03": "DBAB Ch. 4, Q 4:8–4:14; Q 4:15–4:31; Q 4:32+",
    "S-04": "DBAB Q 9:53–9:56",
    "S-05": "DBAB Q 9:53–9:56",
    "S-06": "DBAB Ch. 26, Q 26:1–26:4; Q 26:7; Q 26:9–26:10; Q 4:29",
    "S-07": "DBAB Q 9:19; Q 9:20; Q 9:22",
    "S-08": "DBAB Ch. 7; Q 9:58–9:68",
    "X-01": "DBAB Q 12:4; Q 12:5; Q 12:13–12:22",
    "X-02": "DBAB Q 9:46–9:52",
    "X-03": "DBAB Q 9:23–9:28",
    "X-04": "DBAB Q 9:57–9:68",
    "X-05": "DBAB Ch. 8",
  };

  it("all 34 formula operations carry a DBAB citation", () => {
    const expected = [
      "T-01", "T-02", "T-03", "T-04", "T-05", "T-06", "T-07", "T-08", "T-09",
      "I-01", "I-02", "I-03", "I-04", "I-05",
      "C-01", "C-02", "C-03", "C-04", "C-05", "C-06", "C-07",
      "S-01", "S-02", "S-03", "S-04", "S-05", "S-06", "S-07", "S-08",
      "X-01", "X-02", "X-03", "X-04", "X-05",
    ];
    assert.deepEqual(Object.keys(FORMULA_DBAB_CITATIONS).sort(), expected.sort());
    for (const [id, citation] of Object.entries(FORMULA_DBAB_CITATIONS)) {
      assert.ok(citation.includes("DBAB"), `${id} citation must name the DB Answer Book`);
      assert.ok(citation.length > 8, `${id} citation must be a real reference, not a stub`);
    }
  });
});
