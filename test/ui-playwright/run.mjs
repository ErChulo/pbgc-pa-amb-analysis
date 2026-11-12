// Stage 6 — Playwright suite runner (Worker E).
//
// Runs the four UI suites in order and prints a pass/fail summary.
// Usage: node test/ui-playwright/run.mjs
// Playwright is required by absolute path from stage3/live-test/ (see
// helpers.mjs); it is not a repo-root dependency.

import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const SUITES = [
  "wizard-flow.test.mjs",
  "zero-fetch.test.mjs",
  "theme-rows.test.mjs",
  "defensive-loading.test.mjs",
];

let failures = 0;
for (const suite of SUITES) {
  const result = spawnSync(process.execPath, [join(DIR, suite)], { stdio: "inherit" });
  if (result.status !== 0) {
    failures += 1;
    console.error(`SUITE FAIL: ${suite}`);
  }
}
if (failures > 0) {
  console.error(`UI PLAYWRIGHT: ${SUITES.length - failures}/${SUITES.length} suites passed.`);
  process.exit(1);
}
console.log(`UI PLAYWRIGHT: ${SUITES.length}/${SUITES.length} suites passed.`);
