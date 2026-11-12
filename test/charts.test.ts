/**
 * Tests for the Stage 6 hand-built SVG charts (Worker B).
 *
 * Plain node:test; no external package. Every chart is checked for:
 * valid SVG (starts with <svg, ends with </svg>), title and units,
 * outlier flagging where it applies, empty-data handling, single-point
 * handling, and determinism (same input -> byte-identical output).
 *
 * Synthetic data only. Fictional participants SYN-xxx. No live case
 * data. Money in integer minor units (cents).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHARTS_MODULE_VERSION,
  DISPOSITION_ORDER,
  dispositionLabel,
  escapeXml,
  formatMoneyMinor,
  formatNumber,
  formatValue,
  renderBoundsView,
  renderBoxplot,
  renderCohortBars,
  renderDispositionBars,
  renderHistogram,
  renderScatter,
  renderWaterfall,
} from "../src/ui/charts";

// ---------------------------------------------------------------------------
// Shared checks
// ---------------------------------------------------------------------------

function assertValidSvg(svg: string): void {
  assert.ok(svg.startsWith("<svg"), "SVG must start with <svg");
  assert.ok(svg.endsWith("</svg>"), "SVG must end with </svg>");
  assert.ok(svg.includes("<title>"), "SVG must carry an accessible <title>");
  assert.ok(svg.includes("<desc>"), "SVG must carry an accessible <desc>");
  assert.ok(!svg.includes("undefined"), "SVG must not contain the word undefined");
  assert.ok(!svg.includes("NaN"), "SVG must not contain NaN");
}

function assertDeterministic(render: () => string): void {
  assert.equal(render(), render(), "same input must give byte-identical output");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("charts module", () => {
  it("exports a version string", () => {
    assert.equal(typeof CHARTS_MODULE_VERSION, "string");
    assert.ok(CHARTS_MODULE_VERSION.length > 0);
  });

  it("disposition order is the five MASTER_PROMPT §14 states", () => {
    assert.deepEqual([...DISPOSITION_ORDER], [
      "verified",
      "supported-for-acceptance",
      "requires-investigation",
      "correction-recommended",
      "indeterminate",
    ]);
    assert.equal(dispositionLabel("verified"), "Verified");
    assert.equal(dispositionLabel("supported-for-acceptance"), "Supported for acceptance");
    assert.equal(dispositionLabel("requires-investigation"), "Requires investigation");
    assert.equal(dispositionLabel("correction-recommended"), "Correction recommended");
    assert.equal(dispositionLabel("indeterminate"), "Indeterminate");
  });

  it("escapeXml escapes markup", () => {
    assert.equal(escapeXml('<a href="x">&\'b\''), "&lt;a href=&quot;x&quot;&gt;&amp;&apos;b&apos;");
  });

  it("formatMoneyMinor formats integer minor units exactly", () => {
    assert.equal(formatMoneyMinor(123456), "$1,234.56");
    assert.equal(formatMoneyMinor(-500), "-$5.00");
    assert.equal(formatMoneyMinor(0), "$0.00");
    assert.equal(formatMoneyMinor(100), "$1.00");
    assert.equal(formatMoneyMinor(105), "$1.05");
  });

  it("formatNumber groups digits and trims zeros", () => {
    assert.equal(formatNumber(1234567), "1,234,567");
    assert.equal(formatNumber(-250), "-250");
    assert.equal(formatNumber(12.5), "12.5");
    assert.equal(formatNumber(0), "0");
  });

  it("formatValue uses money formatting for money units only", () => {
    assert.equal(formatValue(123456, "$/month"), "$1,234.56");
    assert.equal(formatValue(12.5, "%"), "12.5");
    assert.equal(formatValue(1234, "participants"), "1,234");
  });
});

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

describe("renderHistogram", () => {
  const values = [0, 100, -250, 300, 100, 0, 500, -100, 200, 150, 100, -50];
  const opts = { title: "Δ distribution", unit: "$/month" };

  it("renders valid SVG with title, unit, and counts", () => {
    const svg = renderHistogram(values, opts);
    assertValidSvg(svg);
    assert.ok(svg.includes("Δ distribution"));
    assert.ok(svg.includes("$/month"));
    assert.ok(svg.includes("n = 12 participants"));
    assert.ok(svg.includes("data-bin="));
    assert.ok(svg.includes("data-count="));
  });

  it("is deterministic", () => {
    assertDeterministic(() => renderHistogram(values, opts));
  });

  it("handles empty data with a no-data message, never a broken chart", () => {
    const svg = renderHistogram([], opts);
    assertValidSvg(svg);
    assert.ok(svg.includes("No data"));
    assert.ok(svg.includes("Δ distribution"));
  });

  it("handles a single value", () => {
    const svg = renderHistogram([250], opts);
    assertValidSvg(svg);
    assert.ok(svg.includes('data-count="1"'));
  });

  it("highlights bins holding highlighted values", () => {
    const svg = renderHistogram(values, {
      ...opts,
      highlight: (v) => Math.abs(v) >= 500,
    });
    assertValidSvg(svg);
    // The 500 bin uses the accent fill; other bins use the muted fill.
    assert.ok(svg.includes('fill="var(--accent)"'));
    assert.ok(svg.includes('fill="var(--muted)"'));
  });

  it("honours an explicit bin count", () => {
    const svg = renderHistogram(values, { ...opts, bins: 4 });
    assertValidSvg(svg);
    assert.ok(svg.includes('data-bin="3"'));
    assert.ok(!svg.includes('data-bin="4"'));
  });

  it("uses CSS variables, never hardcoded theme colours", () => {
    const svg = renderHistogram(values, opts);
    assert.ok(svg.includes("var(--fg)"));
    assert.ok(svg.includes("var(--muted)"));
    assert.ok(!svg.includes("#000000"));
    assert.ok(!svg.includes("#f2f0e9"));
    assert.ok(!svg.includes("#002d72"));
    // Accent appears when a highlight is supplied (see highlight test).
    const highlighted = renderHistogram(values, { ...opts, highlight: (v) => v >= 500 });
    assert.ok(highlighted.includes("var(--accent)"));
  });

  it("escapes markup in the title", () => {
    const svg = renderHistogram(values, { title: "Δ <script>", unit: "$/month" });
    assert.ok(!svg.includes("<script>"));
    assert.ok(svg.includes("&lt;script&gt;"));
  });
});

// ---------------------------------------------------------------------------
// Scatter
// ---------------------------------------------------------------------------

describe("renderScatter", () => {
  const points = [
    { x: 85000, y: 0, label: "SYN-001", flagged: false },
    { x: 120000, y: 500, label: "SYN-002", flagged: false },
    { x: 95000, y: -4200, label: "SYN-003", flagged: true },
    { x: 200000, y: 1500, label: "SYN-004", flagged: false },
  ];
  const opts = { title: "Δ vs reconstructed benefit", xLabel: "B̂ ($/month)", yLabel: "Δ ($/month)" };

  it("renders valid SVG with title and axis labels", () => {
    const svg = renderScatter(points, opts);
    assertValidSvg(svg);
    assert.ok(svg.includes("Δ vs reconstructed benefit"));
    assert.ok(svg.includes("B̂"));
    assert.ok(svg.includes("Δ = 0"));
  });

  it("is deterministic", () => {
    assertDeterministic(() => renderScatter(points, opts));
  });

  it("flags outliers with a distinct marker, label, and data attributes", () => {
    const svg = renderScatter(points, opts);
    assert.ok(svg.includes("<polygon"), "flagged point must be a diamond (polygon), not a circle");
    assert.ok(svg.includes('data-participant="SYN-003"'));
    assert.ok(svg.includes('data-flagged="true"'));
    assert.ok(svg.includes('data-flagged="false"'));
    assert.ok(svg.includes("SYN-003"));
    // The flagged label text appears next to the diamond.
    assert.ok(svg.includes(">SYN-003</text>"));
  });

  it("carries data-x and data-y on every point for drill-down", () => {
    const svg = renderScatter(points, opts);
    for (const p of points) {
      assert.ok(svg.includes(`data-x="${p.x}"`), `missing data-x for ${p.label}`);
      assert.ok(svg.includes(`data-y="${p.y}"`), `missing data-y for ${p.label}`);
    }
  });

  it("handles empty data", () => {
    const svg = renderScatter([], opts);
    assertValidSvg(svg);
    assert.ok(svg.includes("No data"));
  });

  it("handles a single point", () => {
    const svg = renderScatter([points[0] as (typeof points)[number]], opts);
    assertValidSvg(svg);
    assert.ok(svg.includes('data-participant="SYN-001"'));
  });
});

// ---------------------------------------------------------------------------
// Cohort bars
// ---------------------------------------------------------------------------

describe("renderCohortBars", () => {
  const groups = [
    { name: "Active", n: 40, meanDelta: 1200, flagged: 2 },
    { name: "Terminated", n: 35, meanDelta: -800, flagged: 5 },
    { name: "Retired", n: 25, meanDelta: 0, flagged: 0 },
  ];
  const opts = { title: "Mean Δ by status", unit: "$/month" };

  it("renders valid SVG with group names, n, and flagged counts", () => {
    const svg = renderCohortBars(groups, opts);
    assertValidSvg(svg);
    assert.ok(svg.includes("Mean Δ by status"));
    assert.ok(svg.includes("Active"));
    assert.ok(svg.includes("n = 40; flagged 2"));
    assert.ok(svg.includes("n = 100 participants"));
    assert.ok(svg.includes('data-group="Terminated"'));
    assert.ok(svg.includes('data-mean-delta="-800"'));
  });

  it("is deterministic", () => {
    assertDeterministic(() => renderCohortBars(groups, opts));
  });

  it("handles empty data and zero participants", () => {
    assertValidSvg(renderCohortBars([], opts));
    assert.ok(renderCohortBars([], opts).includes("No data"));
    const zero = renderCohortBars([{ name: "Active", n: 0, meanDelta: 0, flagged: 0 }], opts);
    assertValidSvg(zero);
    assert.ok(zero.includes("No data"));
  });

  it("handles a single group", () => {
    const svg = renderCohortBars([groups[0] as (typeof groups)[number]], opts);
    assertValidSvg(svg);
    assert.ok(svg.includes("Active"));
  });
});

// ---------------------------------------------------------------------------
// Bounds view
// ---------------------------------------------------------------------------

describe("renderBoundsView", () => {
  const rows = [
    { label: "SYN-001", min: 80000, max: 90000, recorded: 85000 },
    { label: "SYN-002", min: 100000, max: 110000, recorded: 115000 },
    { label: "SYN-003", min: 70000, max: 75000, recorded: null },
  ];
  const opts = { title: "Bounds vs recorded PA_AMB", unit: "$/month" };

  it("renders valid SVG with ranges and recorded points", () => {
    const svg = renderBoundsView(rows, opts);
    assertValidSvg(svg);
    assert.ok(svg.includes("Bounds vs recorded PA_AMB"));
    assert.ok(svg.includes("$/month"));
    assert.ok(svg.includes('data-label="SYN-001"'));
    assert.ok(svg.includes('data-min="80000"'));
    assert.ok(svg.includes('data-max="90000"'));
    assert.ok(svg.includes('data-recorded="85000"'));
  });

  it("is deterministic", () => {
    assertDeterministic(() => renderBoundsView(rows, opts));
  });

  it("shows a null recorded amount as missing, never as zero", () => {
    const svg = renderBoundsView(rows, opts);
    assert.ok(svg.includes('data-recorded="missing"'));
    assert.ok(svg.includes("recorded: missing"));
    // No circle is plotted for the missing row: only two recorded points.
    const circles = svg.match(/<circle/g) ?? [];
    assert.equal(circles.length, 2);
  });

  it("handles empty data", () => {
    const svg = renderBoundsView([], opts);
    assertValidSvg(svg);
    assert.ok(svg.includes("No data"));
  });

  it("handles a single row", () => {
    const svg = renderBoundsView([rows[0] as (typeof rows)[number]], opts);
    assertValidSvg(svg);
    assert.ok(svg.includes("SYN-001"));
  });
});

// ---------------------------------------------------------------------------
// Disposition bars
// ---------------------------------------------------------------------------

describe("renderDispositionBars", () => {
  const counts = [
    { disposition: "indeterminate", n: 3 },
    { disposition: "verified", n: 40 },
    { disposition: "requires-investigation", n: 12 },
    { disposition: "supported-for-acceptance", n: 8 },
    { disposition: "correction-recommended", n: 2 },
  ];
  const opts = { title: "Dispositions" };

  it("renders valid SVG with all five dispositions and counts", () => {
    const svg = renderDispositionBars(counts, opts);
    assertValidSvg(svg);
    assert.ok(svg.includes("Dispositions"));
    for (const d of DISPOSITION_ORDER) {
      assert.ok(svg.includes(`data-disposition="${d}"`), `missing ${d}`);
    }
    assert.ok(svg.includes('data-n="40"'));
    assert.ok(svg.includes("n = 65 participants"));
  });

  it("orders bars in canonical disposition order regardless of input order", () => {
    const svg = renderDispositionBars(counts, opts);
    const idx = (d: string): number => svg.indexOf(`data-disposition="${d}"`);
    assert.ok(idx("verified") < idx("supported-for-acceptance"));
    assert.ok(idx("supported-for-acceptance") < idx("requires-investigation"));
    assert.ok(idx("requires-investigation") < idx("correction-recommended"));
    assert.ok(idx("correction-recommended") < idx("indeterminate"));
  });

  it("shows a supplied disposition with zero count, never drops it", () => {
    const svg = renderDispositionBars(
      [
        { disposition: "verified", n: 5 },
        { disposition: "indeterminate", n: 0 },
      ],
      opts,
    );
    assertValidSvg(svg);
    assert.ok(svg.includes('data-disposition="indeterminate"'));
    assert.ok(svg.includes('data-n="0"'));
  });

  it("is deterministic", () => {
    assertDeterministic(() => renderDispositionBars(counts, opts));
  });

  it("handles empty data and an all-zero total", () => {
    const empty = renderDispositionBars([], opts);
    assertValidSvg(empty);
    assert.ok(empty.includes("No data"));
    const zero = renderDispositionBars(
      [{ disposition: "verified", n: 0 }],
      opts,
    );
    assertValidSvg(zero);
    assert.ok(zero.includes("No data"));
  });

  it("handles a single disposition", () => {
    const svg = renderDispositionBars([{ disposition: "verified", n: 7 }], opts);
    assertValidSvg(svg);
    assert.ok(svg.includes('data-n="7"'));
    assert.ok(svg.includes("(100%)"));
  });
});

// ---------------------------------------------------------------------------
// Boxplot (optional)
// ---------------------------------------------------------------------------

describe("renderBoxplot", () => {
  const groups = [
    { name: "Active", min: -500, q1: 0, median: 100, q3: 400, max: 900, n: 40 },
    { name: "Retired", min: -200, q1: 50, median: 150, q3: 300, max: 600, n: 25 },
  ];
  const opts = { title: "Δ by status", unit: "$/month" };

  it("renders valid SVG with five-number summaries", () => {
    const svg = renderBoxplot(groups, opts);
    assertValidSvg(svg);
    assert.ok(svg.includes("Δ by status"));
    assert.ok(svg.includes('data-group="Active"'));
    assert.ok(svg.includes('data-median="100"'));
    assert.ok(svg.includes('data-q1="0"'));
    assert.ok(svg.includes('data-q3="400"'));
  });

  it("is deterministic", () => {
    assertDeterministic(() => renderBoxplot(groups, opts));
  });

  it("handles empty data and a single group", () => {
    assert.ok(renderBoxplot([], opts).includes("No data"));
    assertValidSvg(renderBoxplot([groups[0] as (typeof groups)[number]], opts));
  });
});

// ---------------------------------------------------------------------------
// Waterfall (optional)
// ---------------------------------------------------------------------------

describe("renderWaterfall", () => {
  const steps = [
    { label: "Recorded", value: 100000, kind: "total" as const },
    { label: "Service fix", value: -2000, kind: "delta" as const },
    { label: "Comp. fix", value: 1500, kind: "delta" as const },
    { label: "Reconstructed", value: 99500, kind: "total" as const },
  ];
  const opts = { title: "Reconciliation waterfall", unit: "$/month" };

  it("renders valid SVG with every step labelled", () => {
    const svg = renderWaterfall(steps, opts);
    assertValidSvg(svg);
    assert.ok(svg.includes("Reconciliation waterfall"));
    for (const s of steps) {
      assert.ok(svg.includes(`data-label="${s.label}"`), `missing ${s.label}`);
      assert.ok(svg.includes(`data-value="${s.value}"`));
    }
    assert.ok(svg.includes('data-kind="total"'));
    assert.ok(svg.includes('data-kind="delta"'));
  });

  it("is deterministic", () => {
    assertDeterministic(() => renderWaterfall(steps, opts));
  });

  it("handles empty data and a single step", () => {
    assert.ok(renderWaterfall([], opts).includes("No data"));
    assertValidSvg(renderWaterfall([steps[0] as (typeof steps)[number]], opts));
  });
});
