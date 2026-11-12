/**
 * esbuild entry for the single-file deliverable (Stage 6, Worker E).
 *
 * Re-exports the UI entry point (src/ui/main.ts) plus the small set of
 * engine/UI helpers the browser workflow needs to drive a case
 * end-to-end from the page: the synthetic demo case, the
 * reconciliation-input builder, the disposition mapping, and the
 * decimal/benefit constructors the step drivers use to build engine
 * inputs. Nothing here re-implements engine logic; it only makes the
 * modules' own exports reachable from the page (and from the
 * Playwright tests) as `window.PaAmbApp`.
 *
 * Auto-boot: the template loads this bundle in a classic <script> at
 * the end of <body>. When the DOM is ready the app boots into
 * #pa-amb-app and the handle is stored on `window.__paAmbHandle` for
 * tests and for later step controls. No fetch, no network, no CDN.
 * The bundle is an IIFE (globalName PaAmbApp); there is no
 * type="module" and no dynamic import.
 */

export * from "../src/ui/main";
export { DEMO_CASE_PACKAGE, DEMO_TOLERANCE } from "../src/ui/demo";
export { loadTheme, setTheme, themeTokens, toggleTheme } from "../src/ui/theme";
export { buildReconciliationInputs } from "../src/reconciliation";
export {
  mapDisposition,
  recommendationIsNotApproval,
  toEntryCheckInput,
} from "../src/dispositionMapping";
export { makeMoney } from "../src/decimal";
export { datedValue, makeBenefit } from "../src/formulas";
// Stage 7 Accuracy G-ACC-2: the read-only engine functions verification
// needs through the shipped file — per-date provision selection, direct
// formula evaluation, and counterfactual testing/ranking. No behaviour
// change; they only make the engine's own exports reachable from the
// page (and from Playwright checks) as `window.PaAmbApp`.
export { selectProvisionsByDate } from "../src/compose";
export { evaluateFormulaCall } from "../src/formulas";
export { testCounterfactual } from "../src/pipeline";
export { rankCounterfactuals } from "../src/reconciliation";
// Stage 8 XLSX import: the reader and the XLSX writer, reachable
// from the page so the Playwright suites can build fixtures with the
// app's own writer and parse real workbooks through the app's own
// reader. No behaviour change.
export { parseXlsx } from "../src/ui/xlsxReader";
export { buildXlsx } from "../src/ui/exports";
export { mapImportedRow } from "../src/ui/import";
export { COLUMN_MEANINGS, inputGuideColumns, renderInputGuide } from "../src/ui/inputGuide";

import { bootApp } from "../src/ui/main";

type BootHandle = ReturnType<typeof bootApp>;

declare const globalThis: {
  __paAmbHandle?: BootHandle;
  document?: Document;
};

function boot(): void {
  if (typeof globalThis.document === "undefined") return;
  const handle = bootApp();
  if (handle !== null) {
    globalThis.__paAmbHandle = handle;
  }
}

if (typeof globalThis.document !== "undefined") {
  if (globalThis.document.readyState === "loading") {
    globalThis.document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
