// Stage 8 — S001–S050 salary import end-to-end (S-form acceptance).
//
// Opens pa-amb-analysis.html via file:// and imports a CSV with the
// BCV salary form (S001–S050, FRSTYEAR, LASTYEAR, ANNACT, SALARYDESC)
// through the real file picker. Covers:
// - rows land, the wizard moves past Import (Validate unlocks);
// - S001 maps to LASTYEAR, S002 to LASTYEAR−1, S003 to LASTYEAR−2;
// - S-values are dollars in the file, stored as cents (S001=60000
//   becomes 6000000 cents);
// - a blank S-year stays missing, never zero.
// Synthetic data only. No live case data.

import {
  openApp,
  assertBooted,
  check,
  stepButton,
  wizardState,
} from "./helpers.mjs";

function s050Csv() {
  return (
    "participantKey,dopt,S001,S002,S003,FRSTYEAR,LASTYEAR,ANNACT,SALARYDESC\n" +
    "SYN-S-001,2024-06-30,60000,58000,55000,2022,2024,A,W-2\n" +
    "SYN-S-002,2024-06-30,62000,60000,,2022,2024,B,W-2\n"
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

    await importText(page, "s050.csv", s050Csv());
    await waitImportStatus(page, "participant(s) imported");
    const status = await page.locator("#import-status").textContent();
    check(status.includes("2 participant(s) imported from 2 row(s)"), `S-form import should report 2 imported, got: ${status}`);
    const ws = await wizardState(page);
    check(ws.completed.import === true, "import step should complete after the S-form CSV import");
    check(ws.participantCount === 2, `expected 2 imported participants, got ${ws.participantCount}`);
    check(!(await stepButton(page, "validate").isDisabled()), "validate should unlock after the S-form CSV import");

    // S001 = LASTYEAR (2024), S002 = 2023, S003 = 2022; dollars in
    // the file become cents in the app (60000 -> 6000000).
    const salaries = await page.evaluate(() => {
      const pkg = window.__paAmbHandle.getState().casePackage;
      return pkg.compensationHistories.map((ch) => ({
        key: ch.participantKey,
        firstYear: ch.firstYear.value,
        lastYear: ch.lastYear.value,
        salaryDesc: ch.salaryDesc.value,
        years: ch.salaryByYear.map((s) => ({
          year: s.salaryYear,
          minor: s.amount === null ? null : s.amount.amountMinor,
          sourceField: s.sourceField,
        })),
      }));
    });
    const first = salaries.find((s) => s.key === "SYN-S-001");
    check(first !== undefined, "SYN-S-001 should have a compensation history");
    check(first.firstYear === 2022 && first.lastYear === 2024, `SYN-S-001 span should be 2022–2024, got: ${first.firstYear}–${first.lastYear}`);
    check(first.salaryDesc === "W-2", `SYN-S-001 salary source should be W-2, got: ${first.salaryDesc}`);
    check(
      JSON.stringify(first.years) ===
        JSON.stringify([
          { year: 2022, minor: 5500000, sourceField: "S003" },
          { year: 2023, minor: 5800000, sourceField: "S002" },
          { year: 2024, minor: 6000000, sourceField: "S001" },
        ]),
      `SYN-S-001 salaries should map S001=2024/S002=2023/S003=2022 in cents, got: ${JSON.stringify(first.years)}`,
    );
    // The blank S003 on SYN-S-002 stays missing, never zero.
    const second = salaries.find((s) => s.key === "SYN-S-002");
    check(second !== undefined, "SYN-S-002 should have a compensation history");
    const blank = second.years.find((y) => y.year === 2022);
    check(blank !== undefined && blank.minor === null, `SYN-S-002 year 2022 should be missing (null), got: ${JSON.stringify(blank)}`);
    check(
      second.years.find((y) => y.year === 2024)?.minor === 6200000,
      `SYN-S-002 S001=62000 should become 6200000 cents, got: ${JSON.stringify(second.years)}`,
    );

    // Still 0-fetch: the import path made no network request.
    // (The one recorded request is the file:// navigation itself.)
    const nonFile = requests.filter((u) => !u.startsWith("file://"));
    check(nonFile.length === 0, `no non-file requests should have been made, got: ${nonFile.join(", ")}`);
    assertBooted(errors, failedRequests);
    console.log(
      `PASS salary-s050: S-form CSV imports 2 rows, validate unlocks; ` +
        `S001=2024/S002=2023/S003=2022 in cents (S001=60000 -> 6000000); ` +
        `blank S-year stays null; 0 fetch.`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`FAIL salary-s050: ${err.message}`);
  process.exit(1);
});
