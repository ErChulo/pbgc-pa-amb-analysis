// Stage 8 — XLSX import performance bench (browser, file://).
//
// Opens pa-amb-analysis.html, builds census-shaped .xlsx fixtures
// in-page with the app's own buildXlsx, and times parse + map
// (parseXlsx, then mapImportedRow) at 1,000 and 10,000 rows, median
// of 3 timed runs after a warm-up. Prints the numbers and the §21
// verdict (Import: 1,000: 150 ms, 10,000: 1,500 ms), and appends the
// browser rows to stage7/xlsx-import-perf.md when run with --write.
// Synthetic data only. Usage: node stage7/bench-xlsx-import-browser.mjs [--write]

import { readFileSync, appendFileSync } from "node:fs";
import { openApp, assertBooted, check } from "../test/ui-playwright/helpers.mjs";

const HEADERS = ["participantKey", "dopt", "paAmbMinor", "salary_2020", "dob", "dote"];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function main() {
  const { browser, page, errors, failedRequests } = await openApp();
  try {
    await page.waitForSelector("#pa-amb-app");
    assertBooted(errors, failedRequests);
    const results = [];
    for (const n of [1000, 10000]) {
      const { bytes, buildMs } = await page.evaluate((n) => {
        const headers = ["participantKey", "dopt", "paAmbMinor", "salary_2020", "dob", "dote"];
        const rows = [headers];
        for (let i = 1; i <= n; i += 1) {
          rows.push([`SYN-P-${String(i).padStart(5, "0")}`, "2024-06-30", 100000 + i, 6000000, "1962-03-14", "2019-06-15"]);
        }
        const start = performance.now();
        const bytes = window.PaAmbApp.buildXlsx([{ name: "Census", rows }]);
        return { bytes: Array.from(bytes), buildMs: performance.now() - start };
      }, n);
      // Warm-up, then 3 timed parse+map runs in the page.
      const timed = await page.evaluate((bytes) => {
        const run = () => {
          const start = performance.now();
          const parsed = window.PaAmbApp.parseXlsx(new Uint8Array(bytes));
          const mapped = parsed.sheets[0].rows.map(window.PaAmbApp.mapImportedRow);
          return { ms: performance.now() - start, rows: mapped.length };
        };
        run();
        return [run(), run(), run()];
      }, bytes);
      const ms = median(timed.map((r) => r.ms));
      const threshold = n === 1000 ? 150 : 1500;
      const pass = ms <= threshold;
      results.push({ n, bytes: bytes.length, buildMs, ms, threshold, pass });
      console.log(
        `browser ${n} rows: fixture ${bytes.length} bytes (build ${buildMs.toFixed(1)} ms) | ` +
          `parse+map ${ms.toFixed(1)} ms (threshold ${threshold} ms) ${pass ? "PASS" : "FAIL"}`,
      );
    }
    check(errors.length === 0, `page errors during bench: ${errors.join(" | ")}`);
    if (process.argv.includes("--write")) {
      const lines = [
        "",
        "## Browser (Chromium headless, file://)",
        "",
        "Same fixtures, timed in-page with `performance.now()` around `parseXlsx` + `mapImportedRow`.",
        "",
        "| Rows | Fixture bytes | Parse+map (ms) | §21 threshold (ms) | Verdict |",
        "|---:|---:|---:|---:|:---:|",
        ...results.map(
          (r) => `| ${r.n} | ${r.bytes} | ${r.ms.toFixed(1)} | ${r.threshold} | ${r.pass ? "PASS" : "FAIL"} |`,
        ),
        "",
      ];
      appendFileSync(new URL("./xlsx-import-perf.md", import.meta.url), lines.join("\n"));
      console.log("Appended browser rows to stage7/xlsx-import-perf.md");
    }
    console.log("PASS xlsx-import-browser-bench");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`FAIL xlsx-import-browser-bench: ${err.message}`);
  process.exit(1);
});
