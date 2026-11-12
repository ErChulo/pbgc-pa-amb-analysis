// Stage 6 — 0-fetch live check (Worker E).
//
// Loads pa-amb-analysis.html via file://, records every request while
// loading and reloading, and asserts 0 http/https requests (file://
// document loads only). This is the live companion to the static
// build/check-zero-fetch.mjs check: a script could in principle build
// a URL at runtime, so the static check alone is not proof.

import { openApp, assertBooted, check } from "./helpers.mjs";

async function main() {
  const { browser, page, errors, failedRequests, requests } = await openApp();
  try {
    await page.waitForSelector("#pa-amb-app");
    await page.reload();
    await page.waitForSelector("#pa-amb-app");
    await page.waitForTimeout(500);
    assertBooted(errors, failedRequests);
    const http = requests.filter((u) => u.startsWith("http://") || u.startsWith("https://"));
    const nonFile = requests.filter((u) => !u.startsWith("file://"));
    check(http.length === 0, `expected 0 http/https requests, got ${http.length}: ${http.join(", ")}`);
    check(nonFile.length === 0, `expected only file:// requests, got: ${nonFile.join(", ")}`);
    check(requests.length > 0, "expected at least the file:// document loads to be recorded");
    console.log(
      `PASS zero-fetch: ${requests.length} request(s) recorded across load + reload, all file://, 0 http/https.`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`FAIL zero-fetch: ${err.message}`);
  process.exit(1);
});
