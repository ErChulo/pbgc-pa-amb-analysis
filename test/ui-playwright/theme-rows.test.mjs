// Stage 6 — dark theme + 1,000-row render (Worker E).
//
// Dark theme renders by default (bg #000000, fg #f2f0e9 — the P-09
// probe tokens, not design-system tokens; see docs/STAGE6_BUILD.md).
// The toggle switches to light (PBGC blue #002d72 header) and back
// without a reload. A 1,000-row table renders in-page; the render
// time in ms is recorded, not asserted against an unmeasured
// threshold (MASTER_PROMPT §21: thresholds come after measuring the
// baseline).

import { openApp, assertBooted, check } from "./helpers.mjs";

async function main() {
  const { browser, page, errors, failedRequests } = await openApp();
  try {
    await page.waitForSelector("#pa-amb-app");
    assertBooted(errors, failedRequests);

    const theme = () =>
      page.evaluate(() => ({
        dataTheme: document.documentElement.getAttribute("data-theme"),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        bodyFg: getComputedStyle(document.body).color,
        headerBg: getComputedStyle(document.getElementById("app-header")).backgroundColor,
        toggleLabel: document.getElementById("theme-toggle").textContent,
      }));

    // Dark by default.
    let t = await theme();
    check(t.dataTheme === "dark", `default theme should be dark, got ${t.dataTheme}`);
    check(t.bodyBg === "rgb(0, 0, 0)", `dark body bg should be rgb(0, 0, 0), got ${t.bodyBg}`);
    check(t.bodyFg === "rgb(242, 240, 233)", `dark body fg should be rgb(242, 240, 233), got ${t.bodyFg}`);
    check(t.toggleLabel === "Switch to light theme", `dark toggle label should offer light, got ${t.toggleLabel}`);

    // Toggle to light: PBGC blue header, white page. No reload.
    await page.locator("#theme-toggle").click();
    t = await theme();
    check(t.dataTheme === "light", `theme after toggle should be light, got ${t.dataTheme}`);
    check(t.bodyBg === "rgb(255, 255, 255)", `light body bg should be white, got ${t.bodyBg}`);
    check(t.headerBg === "rgb(0, 45, 114)", `light header bg should be PBGC blue rgb(0, 45, 114), got ${t.headerBg}`);
    check(t.toggleLabel === "Switch to dark theme", `light toggle label should offer dark, got ${t.toggleLabel}`);

    // Toggle back to dark, still no reload.
    await page.locator("#theme-toggle").click();
    t = await theme();
    check(t.dataTheme === "dark", `theme after second toggle should be dark, got ${t.dataTheme}`);
    check(t.bodyBg === "rgb(0, 0, 0)", `dark body bg should be back to rgb(0, 0, 0), got ${t.bodyBg}`);

    // 1,000-row table render probe (synthetic rows, built in-page).
    const probe = await page.evaluate(() => {
      const t0 = performance.now();
      const table = document.createElement("table");
      table.id = "theme-rows-probe";
      let html = "<thead><tr><th>Key</th><th>Recorded</th><th>Reconstructed</th></tr></thead><tbody>";
      for (let i = 0; i < 1000; i += 1) {
        html += `<tr><td>SYN-${String(i).padStart(4, "0")}</td><td>$1,500.00</td><td>$1,500.00</td></tr>`;
      }
      html += "</tbody>";
      table.innerHTML = html;
      document.getElementById("pa-amb-app").appendChild(table);
      void table.offsetHeight; // force layout
      const ms = performance.now() - t0;
      const rows = table.querySelectorAll("tbody tr").length;
      const evenBg = getComputedStyle(table.querySelectorAll("tbody tr")[1].querySelector("td")).backgroundColor;
      return { ms, rows, evenBg };
    });
    check(probe.rows === 1000, `expected 1000 rendered rows, got ${probe.rows}`);
    check(
      probe.evenBg === "rgb(20, 20, 20)",
      `even row should use the dark row-alt token rgb(20, 20, 20), got ${probe.evenBg}`,
    );
    console.log(
      `PASS theme-rows: dark default (bg #000000, fg #f2f0e9), light toggle (header #002d72), back to dark without reload; 1,000-row table rendered in ${probe.ms.toFixed(1)} ms.`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`FAIL theme-rows: ${err.message}`);
  process.exit(1);
});
