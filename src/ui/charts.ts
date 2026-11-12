/**
 * Hand-built SVG charts — Stage 6 (Worker B).
 *
 * Governing spec: MASTER_PROMPT §15 (visualizations) and §18 (user
 * interface). Stage 6: interactive visualizations, hand-built SVG, no
 * chart library, no CDN, 0 fetch, working from file://.
 *
 * Rules enforced here:
 * - Pure functions only: plain data in, SVG string out. DOM-free,
 *   Node-testable. No Math.random, no Date.now, no fetch, no DOM access.
 *   Same input produces byte-identical output.
 * - No chart-side thresholds: outlier flagging comes from the engine's
 *   statistics module (src/statistics.ts) via the caller's `flagged`
 *   field. Charts never decide what an outlier is.
 * - Money is integer minor units (cents); service is DecimalString;
 *   never binary float in money. Chart values are display numbers only:
 *   formatting is exact decimal text, never a recomputed money amount.
 * - Theme: CSS variables only (var(--fg), var(--muted), var(--accent),
 *   var(--border), var(--bg)) — never hardcoded theme colors — so charts
 *   are legible in both themes under the PBGC Design System v1.1.0
 *   tokens (dark: provisional DS §2.5; light: DS §2.3). Flagged points
 *   are distinguished by shape as well as
 *   colour, so the flag never depends on colour alone.
 * - Every chart labels its denominator, units, dates, and participant
 *   population in the title/subtitle (MASTER_PROMPT §15). The caller
 *   supplies that text via `title` and `subtitle`; the unit is always
 *   shown on the relevant axis. Every chart carries an accessible
 *   <title> and <desc>. Data points carry data-* attributes so the app
 *   can wire drill-down click handlers later.
 * - Empty data renders a "no data" message, never a broken chart.
 * - ASD STE 100 minimal language for titles and labels.
 *
 * Synthetic data only in tests. Fictional participants only.
 */

export const CHARTS_MODULE_VERSION = "0.1.0";

/** Fixed chart width; heights vary per chart (see each renderer). */
export const CHART_WIDTH = 640;

/** The five dispositions, canonical order (MASTER_PROMPT §14). */
export const DISPOSITION_ORDER: readonly string[] = [
  "verified",
  "supported-for-acceptance",
  "requires-investigation",
  "correction-recommended",
  "indeterminate",
];

/** Display label for a disposition key. Unknown keys pass through. */
export function dispositionLabel(disposition: string): string {
  switch (disposition) {
    case "verified":
      return "Verified";
    case "supported-for-acceptance":
      return "Supported for acceptance";
    case "requires-investigation":
      return "Requires investigation";
    case "correction-recommended":
      return "Correction recommended";
    case "indeterminate":
      return "Indeterminate";
    default:
      return disposition;
  }
}

// ---------------------------------------------------------------------------
// Text helpers (exact decimal text; no binary-float money)
// ---------------------------------------------------------------------------

/** XML-escape text for safe inclusion in SVG. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Group an integer's digits with commas: 1234567 -> "1,234,567". */
function groupDigits(digits: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    const fromRight = digits.length - i;
    if (i > 0 && fromRight % 3 === 0) out += ",";
    out += digits[i];
  }
  return out;
}

/**
 * Format a number as plain text with thousands separators and at most
 * two decimals, trailing zeros trimmed ("1234.5", "-250", "0").
 * Deterministic: no locale dependence.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  const rounded = Math.round(value * 100) / 100;
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs);
  const frac = Math.round((abs - whole) * 100);
  const wholeText = groupDigits(String(whole));
  if (frac === 0) return sign + wholeText;
  const fracText = frac < 10 ? "0" + String(frac) : String(frac);
  return sign + wholeText + "." + fracText.replace(/0$/, "");
}

/**
 * Format an integer minor-unit (cents) value as dollars: 123456 ->
 * "$1,234.56". Exact integer arithmetic on the minor units; no float.
 */
export function formatMoneyMinor(minor: number): string {
  if (!Number.isFinite(minor) || !Number.isInteger(minor)) return "n/a";
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  const centsText = cents < 10 ? "0" + String(cents) : String(cents);
  return sign + "$" + groupDigits(String(dollars)) + "." + centsText;
}

/**
 * Format a chart value for display. When the unit names money
 * ("$/month", "cents", "minor units"), the value is integer minor units
 * and is formatted as dollars; otherwise it is a plain number.
 */
export function formatValue(value: number, unit: string): string {
  const moneyUnit = /\$|cent|minor/i.test(unit);
  if (moneyUnit) return formatMoneyMinor(Math.round(value));
  return formatNumber(value);
}

// ---------------------------------------------------------------------------
// SVG frame
// ---------------------------------------------------------------------------

interface FrameOpts {
  title: string;
  subtitle?: string;
  desc: string;
  height: number;
  width?: number;
}

/** Open an <svg> with title, subtitle, and accessible <title>/<desc>. */
function svgOpen(opts: FrameOpts): string {
  const width = opts.width ?? CHART_WIDTH;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${opts.height}" ` +
      `viewBox="0 0 ${width} ${opts.height}" role="img" ` +
      `aria-label="${escapeXml(opts.title)}" ` +
      `font-family="Helvetica Neue, Arial, sans-serif" font-size="14" ` +
      `fill="var(--fg)" style="background:var(--bg)">`,
  );
  parts.push(`<title>${escapeXml(opts.title)}</title>`);
  parts.push(`<desc>${escapeXml(opts.desc)}</desc>`);
  parts.push(
    `<text x="16" y="22" font-size="14" font-weight="bold" fill="var(--fg)">${escapeXml(opts.title)}</text>`,
  );
  if (opts.subtitle !== undefined && opts.subtitle.trim().length > 0) {
    parts.push(
      `<text x="16" y="40" font-size="14" fill="var(--muted)">${escapeXml(opts.subtitle)}</text>`,
    );
  }
  return parts.join("");
}

function svgClose(): string {
  return "</svg>";
}

/**
 * "No data" chart: same frame, same title, a message in place of the
 * plot. Never a broken chart.
 */
function noDataSvg(opts: FrameOpts): string {
  return (
    svgOpen(opts) +
    `<text x="16" y="80" font-size="14" fill="var(--muted)">No data: nothing to chart.</text>` +
    svgClose()
  );
}

/** Shared plot geometry. */
interface PlotBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  height: number;
}

function plotBox(height: number, hasSubtitle: boolean): PlotBox {
  const top = hasSubtitle ? 56 : 44;
  const x0 = 64;
  const y0 = top;
  const x1 = CHART_WIDTH - 16;
  const y1 = height - 48;
  return { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0 };
}

function axisLine(box: PlotBox): string {
  return (
    `<line x1="${box.x0}" y1="${box.y1}" x2="${box.x1}" y2="${box.y1}" stroke="var(--border)" />` +
    `<line x1="${box.x0}" y1="${box.y0}" x2="${box.x0}" y2="${box.y1}" stroke="var(--border)" />`
  );
}

/** Padded numeric domain; never degenerate (a single value still plots). */
function paddedDomain(min: number, max: number): [number, number] {
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.05;
  return [min - pad, max + pad];
}

/** Nice axis ticks: at most `count` ticks, round step, deterministic. */
function niceTicks(min: number, max: number, count: number): number[] {
  if (min === max) return [min];
  const rawStep = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = norm <= 1 ? mag : norm <= 2 ? 2 * mag : norm <= 5 ? 5 * mag : 10 * mag;
  const ticks: number[] = [];
  const first = Math.ceil(min / step) * step;
  for (let t = first; t <= max + step * 0.001; t += step) {
    ticks.push(Math.round(t * 1e10) / 1e10);
  }
  if (ticks.length === 0) ticks.push(min, max);
  return ticks;
}

// ---------------------------------------------------------------------------
// Histogram — Δ distribution
// ---------------------------------------------------------------------------

export interface HistogramOpts {
  title: string;
  unit: string;
  bins?: number;
  highlight?: (v: number) => boolean;
  subtitle?: string;
}

/**
 * Δ distribution histogram. Bins are equal-width over [min, max];
 * default count is Sturges' rule (ceil(log2 n) + 1), capped at 20.
 * Bars holding a value the caller's `highlight` marks (e.g. flagged
 * participants, supplied by the engine) use the accent fill; other bars
 * use the muted fill. Every bar carries data-bin, data-count, and
 * data-range.
 */
export function renderHistogram(
  values: readonly number[],
  opts: HistogramOpts,
): string {
  const subtitle =
    opts.subtitle !== undefined
      ? opts.subtitle
      : `n = ${values.length} participants; unit: ${opts.unit}`;
  const desc =
    `Histogram of ${opts.title}. ${values.length} values, unit ${opts.unit}. ` +
    `Bars show the count of participants per bin.`;
  const height = 360;
  if (values.length === 0) {
    return noDataSvg({ title: opts.title, subtitle, desc, height });
  }
  const n = values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const binCount =
    opts.bins !== undefined && opts.bins >= 1
      ? Math.floor(opts.bins)
      : Math.min(20, Math.max(1, Math.ceil(Math.log2(n)) + 1));
  const width = max === min ? 1 : (max - min) / binCount;
  const counts: number[] = [];
  const highlighted: boolean[] = [];
  for (let i = 0; i < binCount; i += 1) {
    counts.push(0);
    highlighted.push(false);
  }
  for (const v of values) {
    let idx = max === min ? 0 : Math.floor((v - min) / width);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    counts[idx] = (counts[idx] as number) + 1;
    if (opts.highlight !== undefined && opts.highlight(v)) {
      highlighted[idx] = true;
    }
  }
  const maxCount = Math.max(...counts);
  const box = plotBox(height, true);
  const parts: string[] = [svgOpen({ title: opts.title, subtitle, desc, height })];
  parts.push(axisLine(box));
  const barGap = 2;
  for (let i = 0; i < binCount; i += 1) {
    const count = counts[i] as number;
    const barW = (box.width / binCount) - barGap;
    const x = box.x0 + (i * box.width) / binCount + barGap / 2;
    const barH = maxCount === 0 ? 0 : (count / maxCount) * box.height;
    const y = box.y1 - barH;
    const lo = min + i * width;
    const hi = i === binCount - 1 ? max : min + (i + 1) * width;
    const fill = highlighted[i] ? "var(--accent)" : "var(--muted)";
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" ` +
        `fill="${fill}" data-bin="${i}" data-count="${count}" ` +
        `data-range="${escapeXml(formatValue(lo, opts.unit))} to ${escapeXml(formatValue(hi, opts.unit))}">` +
        `<title>Bin ${i + 1}: ${count} of ${n} participants, ` +
        `${escapeXml(formatValue(lo, opts.unit))} to ${escapeXml(formatValue(hi, opts.unit))}</title></rect>`,
    );
    if (count > 0) {
      parts.push(
        `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="14" fill="var(--fg)">${count}</text>`,
      );
    }
  }
  for (const t of niceTicks(min, max, 5)) {
    const x = box.x0 + ((t - min) / (max === min ? 1 : max - min)) * box.width;
    parts.push(
      `<text x="${x.toFixed(1)}" y="${box.y1 + 16}" text-anchor="middle" font-size="14" fill="var(--muted)">${escapeXml(formatValue(t, opts.unit))}</text>`,
    );
  }
  parts.push(
    `<text x="${box.x0 + box.width / 2}" y="${height - 12}" text-anchor="middle" font-size="14" fill="var(--muted)">Δ (${escapeXml(opts.unit)})</text>`,
  );
  parts.push(
    `<text x="16" y="${box.y0 + box.height / 2}" text-anchor="middle" font-size="14" fill="var(--muted)" transform="rotate(-90 16 ${box.y0 + box.height / 2})">Participants</text>`,
  );
  parts.push(svgClose());
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Scatter — Δ vs reconstructed benefit
// ---------------------------------------------------------------------------

export interface ScatterPoint {
  x: number;
  y: number;
  label: string;
  flagged: boolean;
}

export interface ScatterOpts {
  title: string;
  xLabel: string;
  yLabel: string;
  subtitle?: string;
}

/**
 * Scatterplot of Δ (y) against the reconstructed benefit (x). Flagged
 * points — flagged by the engine's statistics module, never by this
 * chart — are diamonds with a label; other points are circles. A
 * dashed zero line marks Δ = 0. Every point carries data-participant,
 * data-x, and data-y for drill-down wiring.
 */
export function renderScatter(
  points: ReadonlyArray<ScatterPoint>,
  opts: ScatterOpts,
): string {
  const flaggedCount = points.filter((p) => p.flagged).length;
  const subtitle =
    opts.subtitle !== undefined
      ? opts.subtitle
      : `n = ${points.length} participants; ${flaggedCount} flagged by the statistics module`;
  const desc =
    `Scatterplot of ${opts.title}. ${opts.yLabel} against ${opts.xLabel}. ` +
    `${points.length} participants, ${flaggedCount} flagged as outliers by the engine. ` +
    `Flagged points are diamonds with labels.`;
  const height = 360;
  if (points.length === 0) {
    return noDataSvg({ title: opts.title, subtitle, desc, height });
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [xMin, xMax] = paddedDomain(Math.min(...xs), Math.max(...xs));
  const [yMin, yMax] = paddedDomain(Math.min(...ys), Math.max(...ys));
  const box = plotBox(height, true);
  const xScale = (v: number): number => box.x0 + ((v - xMin) / (xMax - xMin)) * box.width;
  const yScale = (v: number): number => box.y1 - ((v - yMin) / (yMax - yMin)) * box.height;
  const parts: string[] = [svgOpen({ title: opts.title, subtitle, desc, height })];
  parts.push(axisLine(box));
  if (yMin < 0 && yMax > 0) {
    parts.push(
      `<line x1="${box.x0}" y1="${yScale(0).toFixed(1)}" x2="${box.x1}" y2="${yScale(0).toFixed(1)}" stroke="var(--muted)" stroke-dasharray="4 4" />`,
    );
    parts.push(
      `<text x="${box.x1 - 2}" y="${(yScale(0) - 4).toFixed(1)}" text-anchor="end" font-size="14" fill="var(--muted)">Δ = 0</text>`,
    );
  }
  for (const t of niceTicks(xMin, xMax, 5)) {
    parts.push(
      `<text x="${xScale(t).toFixed(1)}" y="${box.y1 + 16}" text-anchor="middle" font-size="14" fill="var(--muted)">${escapeXml(formatNumber(t))}</text>`,
    );
  }
  for (const t of niceTicks(yMin, yMax, 5)) {
    parts.push(
      `<text x="${box.x0 - 6}" y="${(yScale(t) + 3).toFixed(1)}" text-anchor="end" font-size="14" fill="var(--muted)">${escapeXml(formatNumber(t))}</text>`,
    );
  }
  for (const p of points) {
    const cx = xScale(p.x).toFixed(1);
    const cy = yScale(p.y).toFixed(1);
    const attrs =
      `data-participant="${escapeXml(p.label)}" data-x="${p.x}" data-y="${p.y}" ` +
      `data-flagged="${p.flagged ? "true" : "false"}"`;
    if (p.flagged) {
      parts.push(
        `<g ${attrs}><polygon points="${cx},${(Number(cy) - 6).toFixed(1)} ${(Number(cx) + 6).toFixed(1)},${cy} ${cx},${(Number(cy) + 6).toFixed(1)} ${(Number(cx) - 6).toFixed(1)},${cy}" ` +
          `fill="var(--accent)" stroke="var(--fg)" stroke-width="1">` +
          `<title>${escapeXml(p.label)}: flagged outlier</title></polygon>` +
          `<text x="${(Number(cx) + 9).toFixed(1)}" y="${(Number(cy) + 3).toFixed(1)}" font-size="14" fill="var(--fg)">${escapeXml(p.label)}</text></g>`,
      );
    } else {
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="4" fill="var(--muted)" ${attrs}>` +
          `<title>${escapeXml(p.label)}</title></circle>`,
      );
    }
  }
  parts.push(
    `<text x="${box.x0 + box.width / 2}" y="${height - 12}" text-anchor="middle" font-size="14" fill="var(--muted)">${escapeXml(opts.xLabel)}</text>`,
  );
  parts.push(
    `<text x="16" y="${box.y0 + box.height / 2}" text-anchor="middle" font-size="14" fill="var(--muted)" transform="rotate(-90 16 ${box.y0 + box.height / 2})">${escapeXml(opts.yLabel)}</text>`,
  );
  parts.push(svgClose());
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Cohort bars — mean Δ by cohort
// ---------------------------------------------------------------------------

export interface CohortGroup {
  name: string;
  n: number;
  meanDelta: number;
  flagged: number;
}

export interface CohortBarsOpts {
  title: string;
  subtitle?: string;
  unit?: string;
}

/**
 * Cohort comparison: mean Δ per cohort, bars from the zero line, with
 * the cohort size (n) and the flagged count under each name. Negative
 * means extend below zero. Every bar carries data-group, data-n,
 * data-mean-delta, and data-flagged.
 */
export function renderCohortBars(
  groups: ReadonlyArray<CohortGroup>,
  opts: CohortBarsOpts,
): string {
  const total = groups.reduce((s, g) => s + g.n, 0);
  const unit = opts.unit ?? "$/month";
  const subtitle =
    opts.subtitle !== undefined
      ? opts.subtitle
      : `n = ${total} participants in ${groups.length} cohorts; unit: ${unit}`;
  const desc =
    `Cohort comparison of ${opts.title}. Mean Δ per cohort, unit ${unit}. ` +
    `${total} participants in ${groups.length} cohorts.`;
  const height = 360;
  if (groups.length === 0 || total === 0) {
    return noDataSvg({ title: opts.title, subtitle, desc, height });
  }
  const means = groups.map((g) => g.meanDelta);
  const lo = Math.min(0, ...means);
  const hi = Math.max(0, ...means);
  const [yMin, yMax] = paddedDomain(lo, hi);
  const box = plotBox(height, true);
  const yScale = (v: number): number => box.y1 - ((v - yMin) / (yMax - yMin)) * box.height;
  const parts: string[] = [svgOpen({ title: opts.title, subtitle, desc, height })];
  parts.push(axisLine(box));
  parts.push(
    `<line x1="${box.x0}" y1="${yScale(0).toFixed(1)}" x2="${box.x1}" y2="${yScale(0).toFixed(1)}" stroke="var(--muted)" stroke-dasharray="4 4" />`,
  );
  const slot = box.width / groups.length;
  const barW = Math.min(64, slot * 0.6);
  groups.forEach((g, i) => {
    const x = box.x0 + i * slot + (slot - barW) / 2;
    const yTop = yScale(Math.max(0, g.meanDelta));
    const yBot = yScale(Math.min(0, g.meanDelta));
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, yBot - yTop).toFixed(1)}" ` +
        `fill="var(--accent)" data-group="${escapeXml(g.name)}" data-n="${g.n}" ` +
        `data-mean-delta="${g.meanDelta}" data-flagged="${g.flagged}">` +
        `<title>${escapeXml(g.name)}: mean Δ ${escapeXml(formatValue(g.meanDelta, unit))}, n = ${g.n}, ${g.flagged} flagged</title></rect>`,
    );
    const labelY = g.meanDelta >= 0 ? yTop - 4 : yBot + 14;
    parts.push(
      `<text x="${(x + barW / 2).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="14" fill="var(--fg)">${escapeXml(formatValue(g.meanDelta, unit))}</text>`,
    );
    parts.push(
      `<text x="${(x + barW / 2).toFixed(1)}" y="${box.y1 + 16}" text-anchor="middle" font-size="14" fill="var(--fg)">${escapeXml(g.name)}</text>`,
    );
    parts.push(
      `<text x="${(x + barW / 2).toFixed(1)}" y="${box.y1 + 30}" text-anchor="middle" font-size="14" fill="var(--muted)">n = ${g.n}; flagged ${g.flagged}</text>`,
    );
  });
  for (const t of niceTicks(yMin, yMax, 5)) {
    parts.push(
      `<text x="${box.x0 - 6}" y="${(yScale(t) + 3).toFixed(1)}" text-anchor="end" font-size="14" fill="var(--muted)">${escapeXml(formatValue(t, unit))}</text>`,
    );
  }
  parts.push(
    `<text x="${box.x0 + box.width / 2}" y="${height - 6}" text-anchor="middle" font-size="14" fill="var(--muted)">Mean Δ (${escapeXml(unit)}) by cohort</text>`,
  );
  parts.push(svgClose());
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Bounds view — min–max bar with recorded point
// ---------------------------------------------------------------------------

export interface BoundsRow {
  label: string;
  min: number;
  max: number;
  recorded: number | null;
}

export interface BoundsViewOpts {
  title: string;
  unit: string;
  subtitle?: string;
}

/**
 * Bounds width vs missing-data view. Each row shows the justified
 * [min, max] range as a bar and the recorded PA_AMB as a point on it.
 * A null recorded amount is shown as "missing" — never as zero, never
 * plotted at the origin. Every row carries data-label, data-min,
 * data-max, and data-recorded (or "missing").
 */
export function renderBoundsView(
  rows: ReadonlyArray<BoundsRow>,
  opts: BoundsViewOpts,
): string {
  const withRecorded = rows.filter((r) => r.recorded !== null).length;
  const subtitle =
    opts.subtitle !== undefined
      ? opts.subtitle
      : `n = ${rows.length} participants; recorded amount present for ${withRecorded}; unit: ${opts.unit}`;
  const desc =
    `Bounds view of ${opts.title}. Each row shows the justified benefit range ` +
    `and the recorded amount as a point. ${rows.length} participants, ` +
    `${withRecorded} with a recorded amount, ${rows.length - withRecorded} missing. ` +
    `A missing recorded amount is shown as missing, never as zero.`;
  const rowH = 36;
  const height = 76 + rows.length * rowH + 24;
  if (rows.length === 0) {
    return noDataSvg({ title: opts.title, subtitle, desc, height: 200 });
  }
  const allValues: number[] = [];
  for (const r of rows) {
    allValues.push(r.min, r.max);
    if (r.recorded !== null) allValues.push(r.recorded);
  }
  const [xMin, xMax] = paddedDomain(Math.min(...allValues), Math.max(...allValues));
  const box: PlotBox = {
    x0: 140,
    y0: 56,
    x1: CHART_WIDTH - 16,
    y1: 56 + rows.length * rowH,
    width: CHART_WIDTH - 16 - 140,
    height: rows.length * rowH,
  };
  const xScale = (v: number): number => box.x0 + ((v - xMin) / (xMax - xMin)) * box.width;
  const parts: string[] = [svgOpen({ title: opts.title, subtitle, desc, height })];
  for (const t of niceTicks(xMin, xMax, 5)) {
    parts.push(
      `<text x="${xScale(t).toFixed(1)}" y="${box.y1 + 16}" text-anchor="middle" font-size="14" fill="var(--muted)">${escapeXml(formatValue(t, opts.unit))}</text>`,
    );
  }
  rows.forEach((r, i) => {
    const cy = box.y0 + i * rowH + rowH / 2;
    const xLo = xScale(r.min);
    const xHi = xScale(r.max);
    const recordedAttr = r.recorded === null ? "missing" : String(r.recorded);
    parts.push(
      `<text x="${box.x0 - 8}" y="${(cy + 3).toFixed(1)}" text-anchor="end" font-size="14" fill="var(--fg)">${escapeXml(r.label)}</text>`,
    );
    parts.push(
      `<g data-label="${escapeXml(r.label)}" data-min="${r.min}" data-max="${r.max}" data-recorded="${recordedAttr}">`,
    );
    parts.push(
      `<line x1="${xLo.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${xHi.toFixed(1)}" y2="${cy.toFixed(1)}" stroke="var(--accent)" stroke-width="6" />`,
    );
    parts.push(
      `<line x1="${xLo.toFixed(1)}" y1="${(cy - 7).toFixed(1)}" x2="${xLo.toFixed(1)}" y2="${(cy + 7).toFixed(1)}" stroke="var(--fg)" stroke-width="1" />`,
    );
    parts.push(
      `<line x1="${xHi.toFixed(1)}" y1="${(cy - 7).toFixed(1)}" x2="${xHi.toFixed(1)}" y2="${(cy + 7).toFixed(1)}" stroke="var(--fg)" stroke-width="1" />`,
    );
    if (r.recorded !== null) {
      const xr = xScale(r.recorded);
      parts.push(
        `<circle cx="${xr.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="var(--bg)" stroke="var(--fg)" stroke-width="2">` +
          `<title>${escapeXml(r.label)}: recorded ${escapeXml(formatValue(r.recorded, opts.unit))}, range ${escapeXml(formatValue(r.min, opts.unit))} to ${escapeXml(formatValue(r.max, opts.unit))}</title></circle>`,
      );
    } else {
      parts.push(
        `<text x="${((xLo + xHi) / 2).toFixed(1)}" y="${(cy - 10).toFixed(1)}" text-anchor="middle" font-size="14" fill="var(--muted)">recorded: missing</text>`,
      );
    }
    parts.push("</g>");
  });
  parts.push(
    `<text x="${box.x0 + box.width / 2}" y="${height - 6}" text-anchor="middle" font-size="14" fill="var(--muted)">Benefit (${escapeXml(opts.unit)}); bar = justified range, point = recorded PA_AMB</text>`,
  );
  parts.push(svgClose());
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Disposition bars — counts for the five dispositions
// ---------------------------------------------------------------------------

export interface DispositionCount {
  disposition: string;
  n: number;
}

export interface DispositionBarsOpts {
  title: string;
  subtitle?: string;
}

/**
 * Disposition counts, in the canonical five-disposition order
 * (MASTER_PROMPT §14). Counts supplied in any order are re-ordered;
 * dispositions with no count supplied are shown as zero, never dropped.
 * Each bar shows n and the share of the total. Every bar carries
 * data-disposition and data-n.
 */
export function renderDispositionBars(
  counts: ReadonlyArray<DispositionCount>,
  opts: DispositionBarsOpts,
): string {
  const byKey = new Map<string, number>();
  for (const c of counts) {
    byKey.set(c.disposition, (byKey.get(c.disposition) ?? 0) + c.n);
  }
  const ordered = DISPOSITION_ORDER.map((d) => ({
    disposition: d,
    n: byKey.get(d) ?? 0,
  }));
  // Any non-canonical disposition keys are appended after the five, in
  // first-seen order, so nothing the caller supplied is silently dropped.
  for (const c of counts) {
    if (!DISPOSITION_ORDER.includes(c.disposition) && !ordered.some((o) => o.disposition === c.disposition)) {
      ordered.push({ disposition: c.disposition, n: byKey.get(c.disposition) ?? 0 });
    }
  }
  const total = ordered.reduce((s, o) => s + o.n, 0);
  const subtitle =
    opts.subtitle !== undefined
      ? opts.subtitle
      : `n = ${total} participants with a disposition`;
  const desc =
    `Disposition counts of ${opts.title}. ${total} participants. ` +
    `Five dispositions: Verified, Supported for acceptance, Requires investigation, ` +
    `Correction recommended, Indeterminate.`;
  const rowH = 34;
  const height = 76 + ordered.length * rowH + 24;
  if (counts.length === 0 || total === 0) {
    return noDataSvg({ title: opts.title, subtitle, desc, height: 200 });
  }
  const maxN = Math.max(...ordered.map((o) => o.n));
  const labelW = 200;
  const barX0 = 16 + labelW;
  const barWMax = CHART_WIDTH - 16 - barX0 - 90;
  const parts: string[] = [svgOpen({ title: opts.title, subtitle, desc, height })];
  ordered.forEach((o, i) => {
    const y = 56 + i * rowH;
    const barW = maxN === 0 ? 0 : (o.n / maxN) * barWMax;
    const pct = total === 0 ? 0 : (o.n / total) * 100;
    parts.push(
      `<text x="16" y="${(y + 15).toFixed(1)}" font-size="14" fill="var(--fg)">${escapeXml(dispositionLabel(o.disposition))}</text>`,
    );
    parts.push(
      `<rect x="${barX0}" y="${y}" width="${Math.max(o.n > 0 ? 2 : 0, barW).toFixed(1)}" height="20" ` +
        `fill="var(--accent)" data-disposition="${escapeXml(o.disposition)}" data-n="${o.n}">` +
        `<title>${escapeXml(dispositionLabel(o.disposition))}: ${o.n} of ${total} participants (${formatNumber(pct)}%)</title></rect>`,
    );
    parts.push(
      `<text x="${(barX0 + barW + 8).toFixed(1)}" y="${(y + 15).toFixed(1)}" font-size="14" fill="var(--fg)">${o.n} (${formatNumber(pct)}%)</text>`,
    );
  });
  parts.push(svgClose());
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Boxplot (optional) — five-number summary per group
// ---------------------------------------------------------------------------

export interface BoxplotGroup {
  name: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  n: number;
}

export interface BoxplotOpts {
  title: string;
  unit: string;
  subtitle?: string;
}

/**
 * Boxplot: one box per group from a caller-supplied five-number
 * summary (min, Q1, median, Q3, max). The chart never computes
 * quartiles itself — the statistics module owns them.
 */
export function renderBoxplot(
  groups: ReadonlyArray<BoxplotGroup>,
  opts: BoxplotOpts,
): string {
  const total = groups.reduce((s, g) => s + g.n, 0);
  const subtitle =
    opts.subtitle !== undefined
      ? opts.subtitle
      : `n = ${total} participants in ${groups.length} groups; unit: ${opts.unit}`;
  const desc =
    `Boxplot of ${opts.title}. Each box shows min, Q1, median, Q3, max. ` +
    `${total} participants in ${groups.length} groups, unit ${opts.unit}.`;
  const height = 360;
  if (groups.length === 0 || total === 0) {
    return noDataSvg({ title: opts.title, subtitle, desc, height });
  }
  const all = groups.flatMap((g) => [g.min, g.q1, g.median, g.q3, g.max]);
  const [yMin, yMax] = paddedDomain(Math.min(...all), Math.max(...all));
  const box = plotBox(height, true);
  const yScale = (v: number): number => box.y1 - ((v - yMin) / (yMax - yMin)) * box.height;
  const parts: string[] = [svgOpen({ title: opts.title, subtitle, desc, height })];
  parts.push(axisLine(box));
  const slot = box.width / groups.length;
  const boxW = Math.min(72, slot * 0.5);
  groups.forEach((g, i) => {
    const cx = box.x0 + i * slot + slot / 2;
    const x0 = cx - boxW / 2;
    const x1 = cx + boxW / 2;
    parts.push(
      `<g data-group="${escapeXml(g.name)}" data-n="${g.n}" ` +
        `data-min="${g.min}" data-q1="${g.q1}" data-median="${g.median}" data-q3="${g.q3}" data-max="${g.max}">`,
    );
    parts.push(
      `<line x1="${cx.toFixed(1)}" y1="${yScale(g.min).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yScale(g.max).toFixed(1)}" stroke="var(--muted)" />`,
    );
    parts.push(
      `<line x1="${(cx - boxW / 4).toFixed(1)}" y1="${yScale(g.min).toFixed(1)}" x2="${(cx + boxW / 4).toFixed(1)}" y2="${yScale(g.min).toFixed(1)}" stroke="var(--muted)" />`,
    );
    parts.push(
      `<line x1="${(cx - boxW / 4).toFixed(1)}" y1="${yScale(g.max).toFixed(1)}" x2="${(cx + boxW / 4).toFixed(1)}" y2="${yScale(g.max).toFixed(1)}" stroke="var(--muted)" />`,
    );
    parts.push(
      `<rect x="${x0.toFixed(1)}" y="${yScale(g.q3).toFixed(1)}" width="${boxW.toFixed(1)}" height="${Math.max(1, yScale(g.q1) - yScale(g.q3)).toFixed(1)}" fill="var(--accent)" fill-opacity="0.35" stroke="var(--accent)">` +
        `<title>${escapeXml(g.name)}: min ${escapeXml(formatValue(g.min, opts.unit))}, Q1 ${escapeXml(formatValue(g.q1, opts.unit))}, median ${escapeXml(formatValue(g.median, opts.unit))}, Q3 ${escapeXml(formatValue(g.q3, opts.unit))}, max ${escapeXml(formatValue(g.max, opts.unit))}, n = ${g.n}</title></rect>`,
    );
    parts.push(
      `<line x1="${x0.toFixed(1)}" y1="${yScale(g.median).toFixed(1)}" x2="${x1.toFixed(1)}" y2="${yScale(g.median).toFixed(1)}" stroke="var(--fg)" stroke-width="2" />`,
    );
    parts.push("</g>");
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${box.y1 + 16}" text-anchor="middle" font-size="14" fill="var(--fg)">${escapeXml(g.name)}</text>`,
    );
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${box.y1 + 30}" text-anchor="middle" font-size="14" fill="var(--muted)">n = ${g.n}</text>`,
    );
  });
  for (const t of niceTicks(yMin, yMax, 5)) {
    parts.push(
      `<text x="${box.x0 - 6}" y="${(yScale(t) + 3).toFixed(1)}" text-anchor="end" font-size="14" fill="var(--muted)">${escapeXml(formatValue(t, opts.unit))}</text>`,
    );
  }
  parts.push(
    `<text x="${box.x0 + box.width / 2}" y="${height - 6}" text-anchor="middle" font-size="14" fill="var(--muted)">Value (${escapeXml(opts.unit)}) by group</text>`,
  );
  parts.push(svgClose());
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Waterfall (optional) — reconciliation waterfall
// ---------------------------------------------------------------------------

export interface WaterfallStep {
  label: string;
  /** Change from the previous step, in the chart unit (e.g. minor
   *  units). The first step is the starting total; the last step is the
   *  final total. Intermediate steps are deltas. */
  value: number;
  /** "total" for the first and last steps, "delta" for the rest. */
  kind: "total" | "delta";
}

export interface WaterfallOpts {
  title: string;
  unit: string;
  subtitle?: string;
}

/**
 * Reconciliation waterfall: a starting total, a sequence of deltas, and
 * a final total. Totals are bars from zero; deltas float from the
 * running total. The caller supplies the steps — the chart never
 * computes a reconciliation. Every bar carries data-label, data-value,
 * and data-kind.
 */
export function renderWaterfall(
  steps: ReadonlyArray<WaterfallStep>,
  opts: WaterfallOpts,
): string {
  const subtitle =
    opts.subtitle !== undefined
      ? opts.subtitle
      : `n = ${steps.length} steps; unit: ${opts.unit}`;
  const desc =
    `Waterfall chart of ${opts.title}. ${steps.length} steps, unit ${opts.unit}. ` +
    `Totals are bars from zero; deltas float from the running total.`;
  const height = 360;
  if (steps.length === 0) {
    return noDataSvg({ title: opts.title, subtitle, desc, height });
  }
  // Running levels: totals are absolute, deltas accumulate.
  const levels: number[] = [];
  let running = 0;
  for (const s of steps) {
    if (s.kind === "total") {
      running = s.value;
      levels.push(s.value);
    } else {
      const from = running;
      running += s.value;
      levels.push(from);
    }
  }
  const ends = steps.map((s, i) =>
    s.kind === "total" ? s.value : (levels[i] as number) + s.value,
  );
  const all = [0, ...ends, ...levels];
  const [yMin, yMax] = paddedDomain(Math.min(...all), Math.max(...all));
  const box = plotBox(height, true);
  const yScale = (v: number): number => box.y1 - ((v - yMin) / (yMax - yMin)) * box.height;
  const parts: string[] = [svgOpen({ title: opts.title, subtitle, desc, height })];
  parts.push(axisLine(box));
  const slot = box.width / steps.length;
  const barW = Math.min(72, slot * 0.6);
  steps.forEach((s, i) => {
    const x = box.x0 + i * slot + (slot - barW) / 2;
    const from = levels[i] as number;
    const to = ends[i] as number;
    const yTop = yScale(Math.max(from, to));
    const yBot = yScale(Math.min(from, to));
    const fill =
      s.kind === "total"
        ? "var(--accent)"
        : s.value >= 0
          ? "var(--accent)"
          : "var(--muted)";
    parts.push(
      `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, yBot - yTop).toFixed(1)}" ` +
        `fill="${fill}" fill-opacity="${s.kind === "total" ? "1" : "0.7"}" ` +
        `data-label="${escapeXml(s.label)}" data-value="${s.value}" data-kind="${s.kind}">` +
        `<title>${escapeXml(s.label)}: ${escapeXml(formatValue(s.value, opts.unit))} (${s.kind})</title></rect>`,
    );
    parts.push(
      `<text x="${(x + barW / 2).toFixed(1)}" y="${(yTop - 4).toFixed(1)}" text-anchor="middle" font-size="14" fill="var(--fg)">${escapeXml(formatValue(s.value, opts.unit))}</text>`,
    );
    parts.push(
      `<text x="${(x + barW / 2).toFixed(1)}" y="${box.y1 + 16}" text-anchor="middle" font-size="14" fill="var(--fg)">${escapeXml(s.label)}</text>`,
    );
    if (i < steps.length - 1) {
      const nextFrom = levels[i + 1] as number;
      const cx = box.x0 + (i + 1) * slot;
      parts.push(
        `<line x1="${(x + barW).toFixed(1)}" y1="${yScale(to).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yScale(nextFrom).toFixed(1)}" stroke="var(--muted)" stroke-dasharray="3 3" />`,
      );
    }
  });
  for (const t of niceTicks(yMin, yMax, 5)) {
    parts.push(
      `<text x="${box.x0 - 6}" y="${(yScale(t) + 3).toFixed(1)}" text-anchor="end" font-size="14" fill="var(--muted)">${escapeXml(formatValue(t, opts.unit))}</text>`,
    );
  }
  parts.push(
    `<text x="${box.x0 + box.width / 2}" y="${height - 6}" text-anchor="middle" font-size="14" fill="var(--muted)">Value (${escapeXml(opts.unit)})</text>`,
  );
  parts.push(svgClose());
  return parts.join("");
}
