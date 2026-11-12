// Pre-upload input-shape guide — visible on the Import step.
//
// Opens pa-amb-analysis.html via file:// with NO file picked and checks
// the guide is visible up front (not hidden, not behind a Help click),
// carries the key lines, and sits BEFORE the file picker in DOM order.
// Also asserts 0 http/https requests for the page load.
// Synthetic data only. No live case data.

import {
  openApp,
  assertBooted,
  check,
  stepButton,
  wizardState,
} from "./helpers.mjs";

async function main() {
  const { browser, page, errors, failedRequests, requests } = await openApp();
  try {
    await page.waitForSelector("#pa-amb-app");
    assertBooted(errors, failedRequests);

    // --- 1. The Import step is the landing step; its panel is visible.
    const ws = await wizardState(page);
    check(ws.currentStep === "import", `expected to land on the import step, got ${ws.currentStep}`);
    const panel = page.locator('section[data-step-panel="import"]');
    check(await panel.isVisible(), "import panel should be visible on load");
    check(!(await stepButton(page, "import").isDisabled()), "import step button should be enabled");

    // --- 2. The guide is visible without picking a file or opening Help.
    // The guide is the text in the import panel that names the salary
    // shape; it must sit BEFORE the file input in DOM order (the old
    // CSV-columns paragraph sits after the input and does not count).
    const guideInfo = await page.evaluate(() => {
      const panelEl = document.querySelector('section[data-step-panel="import"]');
      const input = document.getElementById("import-file");
      if (panelEl === null || input === null) return null;
      const candidates = [...panelEl.querySelectorAll("*")].filter(
        (el) => el.children.length === 0 && (el.textContent ?? "").includes("salary_YYYY"),
      );
      const before = candidates.filter(
        (el) => el.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
      const visible = before.filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      });
      return {
        panelText: panelEl.textContent ?? "",
        beforeCount: before.length,
        visibleBeforeCount: visible.length,
        guideText: visible.length > 0 ? (visible[0].textContent ?? "") : "",
      };
    });
    check(guideInfo !== null, "import panel and #import-file should both exist");
    check(
      guideInfo.visibleBeforeCount > 0,
      `expected a visible salary_YYYY guide element before #import-file, found ${guideInfo.beforeCount} before the input (${guideInfo.visibleBeforeCount} visible)`,
    );

    // --- 3. The key lines are present as visible text in the import panel.
    const panelText = guideInfo.panelText;
    check(panelText.includes("salary_YYYY"), `guide should name the salary_YYYY shape, panel text: ${panelText.slice(0, 400)}`);
    check(
      panelText.includes("never filled with zero"),
      `guide should state the blank rule ("never filled with zero"), panel text: ${panelText.slice(0, 400)}`,
    );
    check(
      /title row/i.test(panelText),
      `guide should state the title-row rule, panel text: ${panelText.slice(0, 400)}`,
    );

    // --- 4. Still 0-fetch: the page load made no http/https request.
    // (The one recorded request is the file:// navigation itself.)
    const nonFile = requests.filter((u) => !u.startsWith("file://"));
    check(nonFile.length === 0, `no non-file requests should have been made, got: ${nonFile.join(", ")}`);
    assertBooted(errors, failedRequests);
    console.log(
      `PASS input-guide: guide visible on Import before the file picker, salary_YYYY + blank + title-row lines present; 0 fetch.`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`FAIL input-guide: ${err.message}`);
  process.exit(1);
});
