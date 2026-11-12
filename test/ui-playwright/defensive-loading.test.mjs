// Stage 6 — defensive-loading regression test (Worker E).
//
// The DEL lesson: every localStorage access must be inside try/catch
// with a no-persistence fallback, because a top-level localStorage
// access on an opaque origin throws SecurityError and kills the whole
// script. theme.ts already follows the DEL delSafeStorage pattern;
// this test proves the built app boots when storage throws.
//
// Two ways:
// (a) Node vm: the built bundle runs in a vm context whose
//     localStorage getter throws on access, with a stubbed document.
//     Boot must succeed, the theme must fall back to dark, and
//     loadTheme/setTheme must never throw. (jsdom is installed under
//     ~/workspace/pbgc-del-generator/node_modules, but the vm + stub
//     proves the same point with no extra dependency, so jsdom is not
//     used.)
// (b) Playwright: an init script makes window.localStorage access
//     throw before any page script runs; the app must still render
//     and the theme toggle must still work in-session.

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { openApp, assertBooted, check, APP_PATH } from "./helpers.mjs";

function extractBundle(html) {
  const start = html.indexOf("<script>");
  const end = html.indexOf("</script>", start);
  check(start !== -1 && end !== -1, "built HTML should contain exactly one inline <script>");
  return html.slice(start + "<script>".length, end);
}

function testVmThrowingStorage() {
  const html = readFileSync(APP_PATH, "utf8");
  const bundle = extractBundle(html);
  const rootStub = {
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  const documentStub = {
    readyState: "complete",
    documentElement: { setAttribute: () => {} },
    getElementById: () => rootStub,
    createElement: () => ({
      setAttribute: () => {},
      appendChild: () => {},
      click: () => {},
      style: {},
    }),
    body: { appendChild: () => {}, removeChild: () => {} },
  };
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    document: documentStub,
    // Dummy DOM classes: main.ts uses `instanceof HTMLElement` /
    // `instanceof HTMLButtonElement` (real browsers define these).
    HTMLElement: class HTMLElement {},
    HTMLButtonElement: class HTMLButtonElement {},
  };
  Object.defineProperty(sandbox, "localStorage", {
    get() {
      throw new Error("SecurityError: localStorage access blocked (test)");
    },
    configurable: true,
  });
  vm.createContext(sandbox);
  vm.runInContext(bundle, sandbox, { filename: "pa-amb-analysis.html" });
  check(typeof sandbox.PaAmbApp === "object", "bundle should expose window.PaAmbApp in the vm");
  check(typeof sandbox.__paAmbHandle === "object", "app should boot in the vm even when storage throws");
  check(sandbox.PaAmbApp.loadTheme() === "dark", "loadTheme should fall back to dark when storage throws");
  check(
    sandbox.PaAmbApp.setTheme("light") === "light",
    "setTheme should apply in-session and never throw when storage throws",
  );
  check(sandbox.PaAmbApp.loadTheme() === "dark", "loadTheme should still read dark (nothing persisted) when storage throws");
  check(
    sandbox.__paAmbHandle.getState().theme === "dark",
    "booted handle should be on the dark theme when storage throws",
  );
  console.log("PASS defensive-loading (a) vm: bundle boots with throwing localStorage; theme falls back to dark, no-persistence, no throw.");
}

async function testPlaywrightThrowingStorage() {
  const { browser, page, errors, failedRequests } = await openApp({
    initScript: () => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("SecurityError: localStorage access blocked (test)");
        },
        configurable: true,
      });
    },
  });
  try {
    await page.waitForSelector("#pa-amb-app");
    assertBooted(errors, failedRequests);
    const h1 = await page.locator("h1").textContent();
    check(h1 === "PA_AMB Analysis", `app should render with throwing storage, got h1 ${h1}`);
    const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    check(theme === "dark", `theme should fall back to dark with throwing storage, got ${theme}`);
    await page.locator("#theme-toggle").click();
    const after = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    check(after === "light", `theme toggle should still work in-session with throwing storage, got ${after}`);
    console.log("PASS defensive-loading (b) Playwright: app renders and the theme toggle works with throwing localStorage.");
  } finally {
    await browser.close();
  }
}

async function main() {
  testVmThrowingStorage();
  await testPlaywrightThrowingStorage();
  console.log("PASS defensive-loading: app boots with no-persistence fallback when localStorage throws (vm + Playwright).");
}

main().catch((err) => {
  console.error(`FAIL defensive-loading: ${err.message}`);
  process.exit(1);
});
