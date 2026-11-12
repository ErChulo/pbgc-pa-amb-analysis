// Stage 8 — CSV import end-to-end, title-row tolerance.
//
// Opens pa-amb-analysis.html via file:// and imports a census-shaped
// .csv through the real file picker. Covers:
// - a one-cell title row above the header: skipped, header taken
//   from row 2, rows land, the title warning is visible in the import
//   status, and the wizard moves past Import (Validate unlocks);
// - a plain CSV with no title row: header from row 1, no warning.
// Synthetic data only. No live case data.

import {
  openApp,
  assertBooted,
  check,
  stepButton,
  wizardState,
} from "./helpers.mjs";

const HEADERS = "participantKey,dopt,paAmbMinor,salary_2020,dob,dote";
const TITLE = "Synthetic Census Title";

function titledCsv() {
  return (
    `${TITLE}\n${HEADERS}\n` +
    "SYN-C-001,2024-06-30,124000,6000000,1962-03-14,2019-06-15\n" +
    "SYN-C-002,2024-06-30,98500,5400000,1965-07-02,2020-01-31\n"
  );
}

function plainCsv() {
  return (
    `${HEADERS}\n` +
    "SYN-P-001,2024-06-30,124000,6000000,1962-03-14,2019-06-15\n"
  );
}

async function importText(page, name, text) {
  await page.locator("#import-file").setInputFiles({
    name,
    buffer: Buffer.from(text, "utf8"),
    mimeType: "text/csv",
  });
}

async function waitImportStatus(page, text, timeout = 10000) {
  await page.waitForFunction(
    (t) => (document.getElementById("import-status")?.textContent ?? "").includes(t),
    text,
    { timeout },
  );
}

async function main() {
  const { browser, page, errors, failedRequests, requests } = await openApp();
  try {
    await page.waitForSelector("#pa-amb-app");
    assertBooted(errors, failedRequests);

    // --- 1. Title row above the header: skipped, header from row 2.
    await importText(page, "titled.csv", titledCsv());
    await waitImportStatus(page, "participant(s) imported");
    const status1 = await page.locator("#import-status").textContent();
    check(status1.includes("2 participant(s) imported from 2 row(s)"), `title-row import should report 2 imported, got: ${status1}`);
    check(
      status1.includes(`CSV row 1 "${TITLE}" skipped — title row`),
      `status should warn about the skipped title row, got: ${status1}`,
    );
    let ws = await wizardState(page);
    check(ws.completed.import === true, "import step should complete after the title-row CSV import");
    check(ws.participantCount === 2, `expected 2 imported participants, got ${ws.participantCount}`);
    check(!(await stepButton(page, "validate").isDisabled()), "validate should unlock after the title-row CSV import");
    const titledKey = await page.evaluate(() => {
      const pkg = window.__paAmbHandle.getState().casePackage;
      return pkg.participants[0]?.participantKey ?? null;
    });
    check(titledKey === "SYN-C-001", `expected SYN-C-001 from the title-row CSV, got ${titledKey}`);

    // --- 2. Plain CSV, no title row: header from row 1, no warning.
    await importText(page, "plain.csv", plainCsv());
    await waitImportStatus(page, "participant(s) imported");
    const status2 = await page.locator("#import-status").textContent();
    check(status2.includes("1 participant(s) imported from 1 row(s)"), `plain import should report 1 imported, got: ${status2}`);
    check(!status2.includes("title row"), `plain import should carry no title-row warning, got: ${status2}`);
    ws = await wizardState(page);
    check(ws.participantCount === 1, `expected 1 imported participant, got ${ws.participantCount}`);

    // --- 3. Still 0-fetch: the import path made no network request.
    // (The one recorded request is the file:// navigation itself.)
    const nonFile = requests.filter((u) => !u.startsWith("file://"));
    check(nonFile.length === 0, `no non-file requests should have been made, got: ${nonFile.join(", ")}`);
    assertBooted(errors, failedRequests);
    console.log(
      `PASS csv-import: title-row CSV imports 2 rows with the title warned, validate unlocks; ` +
        `plain CSV imports 1 row with no warning; 0 fetch.`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`FAIL csv-import: ${err.message}`);
  process.exit(1);
});
