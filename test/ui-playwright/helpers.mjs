// Shared helpers for the Stage 6 Playwright suites (Worker E).
//
// Playwright stays a test-only dependency under stage3/live-test/; it
// is required by absolute path so the repo root package.json never
// gains a playwright dependency. All suites open the single-file
// deliverable via file:// only. Synthetic data only.

import { createRequire } from "node:module";

const require = createRequire(
  "/home/hatch/workspace/pbgc-pa-amb-analysis/stage3/live-test/package.json",
);
export const { chromium } = require("playwright");

export const ROOT = "/home/hatch/workspace/pbgc-pa-amb-analysis";
export const APP_PATH = `${ROOT}/pa-amb-analysis.html`;
export const APP_URL = `file://${APP_PATH}`;

/** Fail with a plain message (suites print PASS/FAIL, no stack noise). */
export function check(cond, message) {
  if (!cond) throw new Error(message);
}

/** Launch Chromium and open the app, capturing page errors and console errors. */
export async function openApp({ initScript = null } = {}) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  if (initScript !== null) await context.addInitScript(initScript);
  const page = await context.newPage();
  const errors = [];
  const failedRequests = [];
  const requests = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("requestfailed", (r) => failedRequests.push(r.url()));
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(APP_URL);
  await page.waitForTimeout(300);
  return { browser, context, page, errors, failedRequests, requests };
}

/** Assert the page booted with no errors. */
export function assertBooted(errors, failedRequests) {
  check(errors.length === 0, `page errors: ${errors.join(" | ")}`);
  check(
    failedRequests.length === 0,
    `failed requests: ${failedRequests.join(" | ")}`,
  );
}

/** The wizard nav button for a step. */
export function stepButton(page, stepId) {
  return page.locator(`[data-wizard-step="${stepId}"]`);
}

/** Current wizard state from the booted app handle. */
export async function wizardState(page) {
  return page.evaluate(() => {
    const handle = window.__paAmbHandle;
    const state = handle.getState();
    return {
      currentStep: state.wizard.currentStep,
      completed: { ...state.wizard.completed },
      lastRefusal: state.lastRefusal,
      participantCount: Object.keys(state.analysis.participants).length,
      statusLine: document.getElementById("status-line")?.textContent ?? "",
    };
  });
}
