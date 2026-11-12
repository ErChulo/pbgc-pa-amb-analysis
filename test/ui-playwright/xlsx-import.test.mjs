// Stage 8 — XLSX import end-to-end (Worker B).
//
// Opens pa-amb-analysis.html via file:// and imports a census-shaped
// .xlsx through the real file picker. The fixture is built in-page
// with the app's own buildXlsx, so the test exercises the real
// writer -> reader round trip. Covers:
// - single-sheet import: rows land, blank cell stays blank, the
//   wizard moves past Import (Validate unlocks);
// - multi-sheet import: the sheet chooser lists the sheets and the
//   chosen sheet is the one imported;
// - a malformed .xlsx (truncated bytes) is refused cleanly with a
//   visible error, no crash, and the loaded case unchanged;
// - a real Excel-produced .xlsx already in the workspace parses
//   (structure check only, through the app's own parseXlsx).
// Synthetic data only. No live case data.

import { readFileSync } from "node:fs";
import {
  openApp,
  assertBooted,
  check,
  stepButton,
  wizardState,
} from "./helpers.mjs";

const HEADERS = ["participantKey", "dopt", "paAmbMinor", "salary_2020", "dob", "dote"];

function censusRows(n, prefix) {
  const rows = [HEADERS];
  for (let i = 1; i <= n; i += 1) {
    // One blank benefit cell (row 3): a blank stays blank, never zero.
    const paAmb = i === 3 ? "" : 100000 + i * 1000;
    rows.push([
      `${prefix}-${String(i).padStart(3, "0")}`,
      "2024-06-30",
      paAmb,
      6000000,
      "1962-03-14",
      "2019-06-15",
    ]);
  }
  return rows;
}

/** Build a .xlsx in the page with the app's own buildXlsx; returns a byte array. */
async function buildFixture(page, sheets) {
  return page.evaluate((sheets) => {
    const bytes = window.PaAmbApp.buildXlsx(sheets);
    return Array.from(bytes);
  }, sheets);
}

async function importBytes(page, name, byteArray) {
  await page.locator("#import-file").setInputFiles({
    name,
    buffer: Buffer.from(byteArray),
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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

    // --- 1. Single-sheet import through the real file picker.
    const single = await buildFixture(page, [
      { name: "Census", rows: censusRows(4, "SYN-X") },
    ]);
    await importBytes(page, "census.xlsx", single);
    await waitImportStatus(page, "participant(s) imported");
    const status1 = await page.locator("#import-status").textContent();
    check(status1.includes('Sheet "Census" used'), `status should name the sheet used, got: ${status1}`);
    check(status1.includes("4 participant(s) imported from 4 row(s)"), `status should report 4 imported, got: ${status1}`);
    let ws = await wizardState(page);
    check(ws.completed.import === true, "import step should complete after the XLSX import");
    check(ws.participantCount === 4, `expected 4 imported participants, got ${ws.participantCount}`);
    check(!(await stepButton(page, "validate").isDisabled()), "validate should unlock after the XLSX import");
    // The blank benefit cell stays blank: the imported observation is null, never zero.
    const blank = await page.evaluate(() => {
      const pkg = window.__paAmbHandle.getState().casePackage;
      const obs = pkg.benefitObservations.find((o) => o.participantKey === "SYN-X-003");
      return obs === undefined ? "missing" : obs.paAmb.value;
    });
    check(blank === null, `SYN-X-003 benefit should be null (blank cell), got: ${JSON.stringify(blank)}`);

    // --- 2. Multi-sheet import: the chooser lists the sheets; the chosen sheet imports.
    const multi = await buildFixture(page, [
      { name: "Census", rows: censusRows(2, "SYN-M") },
      {
        name: "Other",
        rows: [
          HEADERS,
          ["SYN-O-001", "2024-06-30", 77000, 5000000, "1970-01-05", "2020-06-01"],
        ],
      },
    ]);
    await importBytes(page, "two.xlsx", multi);
    await page.waitForSelector("#import-sheet-row:not([hidden])", { timeout: 10000 });
    const options = await page.locator("#import-sheet option").allTextContents();
    check(options.length === 2 && options[0] === "Census" && options[1] === "Other", `chooser should list Census and Other, got: ${JSON.stringify(options)}`);
    await page.locator("#import-sheet").selectOption("Other");
    await page.locator("#import-sheet-confirm").click();
    await waitImportStatus(page, "participant(s) imported");
    const status2 = await page.locator("#import-status").textContent();
    check(status2.includes('Sheet "Other" used'), `status should name the chosen sheet, got: ${status2}`);
    check(status2.includes("Other sheets in the file (not imported): Census"), `status should name the sheet not imported, got: ${status2}`);
    ws = await wizardState(page);
    check(ws.participantCount === 1, `expected 1 participant from the Other sheet, got ${ws.participantCount}`);
    const onlyKey = await page.evaluate(() => {
      const pkg = window.__paAmbHandle.getState().casePackage;
      return pkg.participants[0]?.participantKey ?? null;
    });
    check(onlyKey === "SYN-O-001", `expected SYN-O-001 from the Other sheet, got ${onlyKey}`);
    check(
      await page.locator("#import-sheet-row").isHidden(),
      "sheet chooser should hide again after the import completes",
    );

    // --- 3. Malformed .xlsx (truncated bytes): refused cleanly, no crash, case unchanged.
    const truncated = single.slice(0, Math.floor(single.length / 2));
    await importBytes(page, "cut.xlsx", truncated);
    await waitImportStatus(page, "refused");
    const status3 = await page.locator("#import-status").textContent();
    check(status3.length > 0 && !status3.includes("participant(s) imported"), `malformed file should show a refusal, got: ${status3}`);
    ws = await wizardState(page);
    check(ws.participantCount === 1, `malformed import must not change the loaded case, got ${ws.participantCount} participants`);
    check(errors.length === 0, `malformed import must not raise page errors: ${errors.join(" | ")}`);

    // --- 4. Real Excel-produced .xlsx (structure check only, app's own reader).
    // BCV-DataValidation-predicates.xlsx is the Excel-produced file in
    // the workspace that parses: the V1 samples link to external
    // workbooks (refused by design) and the rates file's one-cell
    // title row is skipped, its header is row 2, and row 3 is wider
    // than the header (refused — see the reader test).
    const realPath = "/home/hatch/workspace/pbgc_review/pa-amb/BCV-DataValidation-predicates.xlsx";
    const realB64 = readFileSync(realPath).toString("base64");
    const real = await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const parsed = window.PaAmbApp.parseXlsx(bytes);
      return {
        sheets: parsed.sheets.map((s) => ({ name: s.name, headers: s.headers, rows: s.rows.length })),
        isMacroEnabled: parsed.isMacroEnabled,
        hashLen: parsed.fileHashSha256.length,
      };
    }, realB64);
    check(real.sheets.length > 0, "real Excel file should have at least one sheet");
    for (const s of real.sheets) {
      check(s.name.length > 0, "every sheet should have a name");
      check(Array.isArray(s.headers) && s.headers.length > 0, `sheet "${s.name}" should have headers`);
    }
    check(real.hashLen === 64, `file hash should be 64 hex chars, got ${real.hashLen}`);

    // --- 5. Title row above the header: skipped, header taken from row 2.
    const titled = await buildFixture(page, [
      {
        name: "Census",
        rows: [
          ["Synthetic Census Title"],
          HEADERS,
          ["SYN-T-001", "2024-06-30", 124000, 6000000, "1962-03-14", "2019-06-15"],
          ["SYN-T-002", "2024-06-30", 98500, 5400000, "1965-07-02", "2020-01-31"],
        ],
      },
    ]);
    await importBytes(page, "titled.xlsx", titled);
    await waitImportStatus(page, "participant(s) imported");
    const status5 = await page.locator("#import-status").textContent();
    check(status5.includes("2 participant(s) imported from 2 row(s)"), `title-row import should report 2 imported, got: ${status5}`);
    check(
      status5.includes('row 1 "Synthetic Census Title" skipped — title row'),
      `status should warn about the skipped title row, got: ${status5}`,
    );
    ws = await wizardState(page);
    check(ws.completed.import === true, "import step should complete after the title-row XLSX import");
    check(ws.participantCount === 2, `expected 2 imported participants, got ${ws.participantCount}`);
    check(!(await stepButton(page, "validate").isDisabled()), "validate should unlock after the title-row XLSX import");
    const titledKey = await page.evaluate(() => {
      const pkg = window.__paAmbHandle.getState().casePackage;
      return pkg.participants[0]?.participantKey ?? null;
    });
    check(titledKey === "SYN-T-001", `expected SYN-T-001 from the title-row sheet, got ${titledKey}`);

    // --- 6. Still 0-fetch: the import path made no network request.
    // (The one recorded request is the file:// navigation itself.)
    const nonFile = requests.filter((u) => !u.startsWith("file://"));
    check(nonFile.length === 0, `no non-file requests should have been made, got: ${nonFile.join(", ")}`);
    assertBooted(errors, failedRequests);
    console.log(
      `PASS xlsx-import: single-sheet 4 rows (blank stays null, sheet named); ` +
        `multi-sheet chooser Census/Other, imported Other (1 row); ` +
        `truncated file refused cleanly, case unchanged; ` +
        `real Excel file "${realPath.split("/").pop()}" parses (${real.sheets.length} sheets, hash 64 chars); ` +
        `title-row file imports 2 rows with the title warned; 0 fetch.`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`FAIL xlsx-import: ${err.message}`);
  process.exit(1);
});
