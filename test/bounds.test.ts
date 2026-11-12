/**
 * Tests for the bounds/scenarios path (src/bounds.ts).
 *
 * Bounds are guarantees conditional on the stated assumptions — not
 * confidence intervals, not exact benefits, and never filled by
 * imputation (Stage 2 output 04 §5.5). The §9 worked example (SYN-002)
 * is exercised end-to-end in test/pipeline.test.ts; this file tests the
 * constructors directly.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeMoney } from "../src/decimal.js";
import type {
  CalcContext,
  MissingDataItem,
} from "../src/types.js";
import { makeBenefit } from "../src/formulas.js";
import {
  attributeWidth,
  boundsResultFromCalcResult,
  boundsWidthMinor,
  buildBoundsResult,
  checkMonotonicity,
  feasibleRegionDescription,
  generateScenarios,
  isBoundsEstablishable,
  recordedPosition,
} from "../src/bounds.js";
import type { MissingInputRange } from "../src/bounds.js";

const ctx: CalcContext = {
  planVersionId: "v1",
  measurementDate: "2020-02-29",
  rounding: { stage: "final-only", mode: "nearest-cent", source: "test fixture" },
};

const salary2020Range: MissingInputRange = {
  field: "CompensationHistory.salaryYear 2020",
  missingClass: "c",
  low: "54000",
  high: "64800",
  unit: "annual-compensation-dollars",
  basis: "prior-year salary bounded by the plan's pay scale",
};

function missingItem(field: string, missingClass: "a" | "b" | "c" | "d" | "e"): MissingDataItem {
  return {
    field,
    missingClass,
    consequence: "test fixture",
    resolvesBy: "the missing input",
  };
}

describe("isBoundsEstablishable", () => {
  it("class c/d inputs covered by ranges are establishable", () => {
    assert.equal(
      isBoundsEstablishable(
        [missingItem("CompensationHistory.salaryYear 2020", "c")],
        [salary2020Range],
      ),
      true,
    );
  });

  it("any class e (M5) input makes bounds impossible", () => {
    assert.equal(
      isBoundsEstablishable(
        [
          missingItem("CompensationHistory.salaryYear 2020", "c"),
          missingItem("Participant.dob", "e"),
        ],
        [salary2020Range],
      ),
      false,
    );
  });

  it("an uncovered input makes bounds impossible", () => {
    assert.equal(
      isBoundsEstablishable(
        [missingItem("CompensationHistory.salaryYear 2019", "c")],
        [salary2020Range],
      ),
      false,
    );
  });

  it("no missing inputs means no bounds to establish", () => {
    assert.equal(isBoundsEstablishable([], [salary2020Range]), false);
  });
});

describe("recordedPosition", () => {
  it("inside / below-min / above-max / recorded-missing", () => {
    const min = makeMoney(158400);
    const max = makeMoney(168300);
    assert.equal(recordedPosition(makeMoney(162000), min, max), "inside");
    assert.equal(recordedPosition(makeMoney(158400), min, max), "inside");
    assert.equal(recordedPosition(makeMoney(168300), min, max), "inside");
    assert.equal(recordedPosition(makeMoney(150000), min, max), "below-min");
    assert.equal(recordedPosition(makeMoney(170000), min, max), "above-max");
    assert.equal(recordedPosition(null, min, max), "recorded-missing");
  });
});

describe("checkMonotonicity", () => {
  it("endpoints with an interior point inside the range are monotone", () => {
    const result = checkMonotonicity("CompensationHistory.salaryYear 2020", [
      { inputValue: "54000", benefitMinor: 158400 },
      { inputValue: "59400", benefitMinor: 163350 },
      { inputValue: "64800", benefitMinor: 168300 },
    ]);
    assert.equal(result.monotone, true);
  });

  it("an interior point outside the endpoint range is non-monotone", () => {
    const result = checkMonotonicity("CompensationHistory.salaryYear 2020", [
      { inputValue: "54000", benefitMinor: 158400 },
      { inputValue: "59400", benefitMinor: 200000 },
      { inputValue: "64800", benefitMinor: 168300 },
    ]);
    assert.equal(result.monotone, false);
  });

  it("fewer than two points cannot verify monotonicity", () => {
    const result = checkMonotonicity("CompensationHistory.salaryYear 2020", [
      { inputValue: "54000", benefitMinor: 158400 },
    ]);
    assert.equal(result.monotone, false);
  });
});

describe("attributeWidth", () => {
  it("an input whose midpoint collapses the width contributes all of it", () => {
    const [attribution] = attributeWidth({
      totalMinMinor: 158400,
      totalMaxMinor: 168300,
      inputs: [
        {
          missingInput: "CompensationHistory.salaryYear 2020",
          missingClass: "c",
          narrowedWidthMinor: 0,
          couldChangeDisposition: true,
        },
      ],
    });
    assert.equal(attribution?.widthContribution.amountMinor, 9900);
    assert.equal(attribution?.widthShare, "1");
    assert.equal(attribution?.couldChangeDisposition, true);
  });

  it("an input that narrows the width by half contributes half", () => {
    const [attribution] = attributeWidth({
      totalMinMinor: 158400,
      totalMaxMinor: 168300,
      inputs: [
        {
          missingInput: "CompensationHistory.salaryYear 2020",
          missingClass: "c",
          narrowedWidthMinor: 4950,
          couldChangeDisposition: false,
        },
      ],
    });
    assert.equal(attribution?.widthContribution.amountMinor, 4950);
    assert.equal(attribution?.widthShare, "0.5");
  });
});

describe("generateScenarios", () => {
  it("returns the named scenarios with their stated assumptions", () => {
    const scenarios = generateScenarios({
      endpoints: [
        {
          name: "missing input at lower bound",
          assumptions: "2020 salary at $54,000",
          benefit: makeMoney(158400),
        },
        {
          name: "missing input at midpoint (labelled assumption)",
          assumptions: "2020 salary at $59,400 — assumption, not the benefit",
          benefit: makeMoney(163350),
        },
      ],
      planVersionId: "v1",
      formulaId: "T-04",
    });
    assert.equal(scenarios.length, 2);
    assert.equal(scenarios[0]?.name, "missing input at lower bound");
    assert.equal(scenarios[1]?.benefit?.amountMinor, 163350);
    assert.equal(scenarios[1]?.planVersionId, "v1");
  });
});

describe("buildBoundsResult", () => {
  it("SYN-002 bounds: $1,584.00–$1,683.00, recorded $1,620 inside", () => {
    const bounds = buildBoundsResult({
      minBenefit: makeBenefit(ctx, makeMoney(158400), "monthly"),
      maxBenefit: makeBenefit(ctx, makeMoney(168300), "monthly"),
      assumptions: ["formula T-04 applies to all service"],
      derivation: {
        method: "endpoint-evaluation",
        kinkPoints: [],
        monotonicity: [
          {
            input: "CompensationHistory.salaryYear 2020",
            monotone: true,
            verifiedBy: "endpoint+kink evaluation",
          },
        ],
        feasibleRegion: "CompensationHistory.salaryYear 2020 in [54000, 64800]",
      },
      widthAttribution: [],
      scenarios: generateScenarios({
        endpoints: [
          {
            name: "missing input at lower bound",
            assumptions: "2020 salary at $54,000",
            benefit: makeMoney(158400),
          },
          {
            name: "missing input at upper bound",
            assumptions: "2020 salary at $64,800",
            benefit: makeMoney(168300),
          },
        ],
        planVersionId: "v1",
        formulaId: "T-04",
      }),
      recordedPaAmb: makeBenefit(ctx, makeMoney(162000), "monthly"),
    });
    assert.equal(bounds.min.amountMinor, 158400);
    assert.equal(bounds.max.amountMinor, 168300);
    assert.equal(bounds.recordedPosition, "inside");
    assert.equal(bounds.minBenefit.source, "bound");
    assert.equal(bounds.maxBenefit.source, "bound");
    assert.equal(boundsWidthMinor(bounds), 9900);
  });

  it("reversed endpoints throw — a bound is never silently inverted", () => {
    assert.throws(() =>
      buildBoundsResult({
        minBenefit: makeBenefit(ctx, makeMoney(168300), "monthly"),
        maxBenefit: makeBenefit(ctx, makeMoney(158400), "monthly"),
        assumptions: [],
        derivation: {
          method: "endpoint-evaluation",
          kinkPoints: [],
          monotonicity: [],
          feasibleRegion: "",
        },
        widthAttribution: [],
        scenarios: [],
        recordedPaAmb: null,
      }),
    );
  });
});

describe("boundsResultFromCalcResult", () => {
  it("builds a BoundsResult from a formula bound", () => {
    const bounds = boundsResultFromCalcResult({
      bound: {
        kind: "bound",
        min: makeBenefit(ctx, makeMoney(91667), "monthly"),
        max: makeBenefit(ctx, makeMoney(108333), "monthly"),
        evidenceGrade: "estimate",
        missingInputs: ["average compensation C̄_t"],
      },
      assumptions: ["formula T-04 applies to all service"],
      feasibleRegion: feasibleRegionDescription([salary2020Range]),
      recordedPaAmb: makeBenefit(ctx, makeMoney(100000), "monthly"),
      planVersionId: "v1",
      formulaId: "T-04",
    });
    assert.equal(bounds.min.amountMinor, 91667);
    assert.equal(bounds.max.amountMinor, 108333);
    assert.equal(bounds.recordedPosition, "inside");
    assert.equal(bounds.derivation.method, "endpoint-evaluation");
  });
});

describe("feasibleRegionDescription", () => {
  it("states each range with its field, bounds, unit, and basis", () => {
    const region = feasibleRegionDescription([salary2020Range]);
    assert.equal(
      region.description,
      "CompensationHistory.salaryYear 2020 in [54000, 64800] annual-compensation-dollars (prior-year salary bounded by the plan's pay scale)",
    );
  });
});
