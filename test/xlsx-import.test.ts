/**
 * Stage 8 — XLSX import wiring tests (Worker B).
 *
 * Covers the UI wiring in src/ui/main.ts (importFileBytes, the shared
 * row path, the import report), not the reader core itself — the
 * reader core (inflate / ZIP / XLSX) is Worker A's, tested in
 * test/xlsx-reader.test.ts. Fixtures are built with the app's own
 * buildXlsx, so the test exercises the real writer → reader round
 * trip. Synthetic data only. No live case data.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildXlsx } from "../src/ui/exports.js";
import {
  importFileBytes,
  importReportSummary,
} from "../src/ui/main.js";
import { DEMO_CASE_PACKAGE } from "../src/ui/demo.js";
import {
  createCaseAnalysisState,
  createInitialUiState,
} from "../src/ui/state.js";
import type { UiState } from "../src/ui/state.js";

function freshUiState(): UiState {
  return createInitialUiState(
    createCaseAnalysisState({
      caseId: "00098765",
      participantKeys: DEMO_CASE_PACKAGE.participants.map((p) => p.participantKey),
      snapshotHash: "snap-test",
      sourceDocuments: [],
      planVersions: [],
      toleranceSetId: "not-set",
    }),
  );
}

const ACTOR = "A. Actuary";
const AT = "2026-11-12T00:00:00.000Z";

/** Census-shaped sheet: 3 rows, one with a blank benefit cell. */
function censusRows(): Array<Array<string | number>> {
  return [
    ["participantKey", "dopt", "paAmbMinor", "salary_2020", "dob", "dote"],
    ["SYN-X-001", "2024-06-30", 124000, 6000000, "1962-03-14", "2019-06-15"],
    ["SYN-X-002", "2024-06-30", 98500, 5400000, "1965-07-02", "2020-01-31"],
    ["SYN-X-003", "2024-06-30", "", 4800000, "1970-11-20", "2021-05-10"],
  ];
}

describe("Stage 8 — XLSX import wiring", () => {
  it("a single-sheet census .xlsx imports, blank benefit stays null, hash recorded", () => {
    const bytes = buildXlsx([{ name: "Census", rows: censusRows() }]);
    const { state, report, error } = importFileBytes(freshUiState(), "census.xlsx", bytes, ACTOR, AT);
    assert.equal(error, null);
    assert.notEqual(report, null);
    assert.equal(report?.participantsImported, 3);
    assert.equal(report?.rowsRead, 3);
    assert.equal(report?.sheetName, "Census");
    assert.deepEqual(report?.sheetNames, ["Census"]);
    assert.ok(Array.isArray(report?.warnings));
    // The file hash is the reader's SHA-256, not the "not-computed" placeholder.
    const hash = state.casePackage?.sourceDocuments[0]?.fileHash ?? "";
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(state.casePackage?.participants.length, 3);
    const obs = state.casePackage?.benefitObservations ?? [];
    assert.equal(obs[0]?.paAmb.value?.amountMinor, 124000);
    // Blank paAmbMinor is null, never zero.
    assert.equal(obs[2]?.paAmb.value, null);
    assert.equal(state.casePackage?.case.dopt.value, "2024-06-30");
    assert.match(importReportSummary(report!), /Sheet "Census" used/);
  });

  it("a multi-sheet workbook imports the first sheet by default", () => {
    const bytes = buildXlsx([
      { name: "Census", rows: censusRows() },
      {
        name: "Other",
        rows: [
          ["participantKey", "dopt", "paAmbMinor"],
          ["SYN-X-OTHER", "2024-06-30", 1000],
        ],
      },
    ]);
    const { state, report, error } = importFileBytes(freshUiState(), "two.xlsx", bytes, ACTOR, AT);
    assert.equal(error, null);
    assert.equal(report?.participantsImported, 3);
    assert.equal(report?.sheetName, "Census");
    assert.deepEqual(report?.sheetNames, ["Census", "Other"]);
    assert.match(importReportSummary(report!), /Other sheets in the file \(not imported\): Other/);
    assert.equal(state.casePackage?.participants[0]?.participantKey, "SYN-X-001");
  });

  it("a named sheet imports instead of the first", () => {
    const bytes = buildXlsx([
      { name: "Census", rows: censusRows() },
      {
        name: "Other",
        rows: [
          ["participantKey", "dopt", "paAmbMinor"],
          ["SYN-X-OTHER", "2024-06-30", 1000],
        ],
      },
    ]);
    const { state, report, error } = importFileBytes(freshUiState(), "two.xlsx", bytes, ACTOR, AT, "Other");
    assert.equal(error, null);
    assert.equal(report?.participantsImported, 1);
    assert.equal(report?.sheetName, "Other");
    assert.equal(state.casePackage?.participants[0]?.participantKey, "SYN-X-OTHER");
    assert.equal(state.casePackage?.benefitObservations[0]?.paAmb.value?.amountMinor, 1000);
  });

  it("an unknown sheet name is refused and changes nothing", () => {
    const bytes = buildXlsx([{ name: "Census", rows: censusRows() }]);
    const before = freshUiState();
    const { state, report, error } = importFileBytes(before, "census.xlsx", bytes, ACTOR, AT, "Nope");
    assert.notEqual(error, null);
    assert.match(error ?? "", /no sheet named "Nope"/);
    assert.equal(report, null);
    assert.equal(state.casePackage, null);
  });

  it("truncated bytes are refused cleanly and change nothing", () => {
    const full = buildXlsx([{ name: "Census", rows: censusRows() }]);
    const truncated = full.subarray(0, Math.floor(full.length / 2));
    const before = freshUiState();
    const { state, report, error } = importFileBytes(before, "cut.xlsx", truncated, ACTOR, AT);
    assert.notEqual(error, null);
    assert.equal(report, null);
    assert.equal(state.casePackage, null);
  });

  it("random bytes are refused cleanly and change nothing", () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const before = freshUiState();
    const { state, report, error } = importFileBytes(before, "junk.xlsx", junk, ACTOR, AT);
    assert.notEqual(error, null);
    assert.equal(report, null);
    assert.equal(state.casePackage, null);
  });

  it("a .xlsm name takes the same bytes path (macros ignored by the reader)", () => {
    const bytes = buildXlsx([{ name: "Census", rows: censusRows() }]);
    const { state, report, error } = importFileBytes(freshUiState(), "census.xlsm", bytes, ACTOR, AT);
    assert.equal(error, null);
    assert.equal(report?.participantsImported, 3);
    assert.equal(state.casePackage?.participants.length, 3);
  });

  it("a non-xlsx name is refused by the bytes path", () => {
    const bytes = buildXlsx([{ name: "Census", rows: censusRows() }]);
    const { error } = importFileBytes(freshUiState(), "census.csv", bytes, ACTOR, AT);
    assert.notEqual(error, null);
    assert.match(error ?? "", /not a \.xlsx or \.xlsm file/);
  });

  it("an .xlsx without a dopt value is refused — no date is guessed", () => {
    const bytes = buildXlsx([
      {
        name: "Census",
        rows: [
          ["participantKey", "paAmbMinor"],
          ["SYN-X-001", 124000],
        ],
      },
    ]);
    const { state, error } = importFileBytes(freshUiState(), "nodopt.xlsx", bytes, ACTOR, AT);
    assert.notEqual(error, null);
    assert.match(error ?? "", /dopt/);
    assert.equal(state.casePackage, null);
  });

  it("a duplicate participantKey keeps the first row, same as CSV", () => {
    const bytes = buildXlsx([
      {
        name: "Census",
        rows: [
          ["participantKey", "dopt", "paAmbMinor"],
          ["SYN-DUP", "2024-06-30", 100000],
          ["SYN-DUP", "2024-06-30", 200000],
        ],
      },
    ]);
    const { state, report, error } = importFileBytes(freshUiState(), "dup.xlsx", bytes, ACTOR, AT);
    assert.equal(error, null);
    assert.equal(report?.participantsImported, 1);
    assert.equal(report?.quarantinedRows.length, 1);
    assert.equal(state.casePackage?.benefitObservations[0]?.paAmb.value?.amountMinor, 100000);
  });

  it("a one-cell title row above the header imports, and the title is warned in the report", () => {
    const title = "Synthetic Census Title";
    const bytes = buildXlsx([
      {
        name: "Census",
        rows: [
          [title],
          ["participantKey", "dopt", "paAmbMinor", "salary_2020", "dob", "dote"],
          ["SYN-T-001", "2024-06-30", 124000, 6000000, "1962-03-14", "2019-06-15"],
          ["SYN-T-002", "2024-06-30", 98500, 5400000, "1965-07-02", "2020-01-31"],
        ],
      },
    ]);
    const { state, report, error } = importFileBytes(freshUiState(), "titled.xlsx", bytes, ACTOR, AT);
    assert.equal(error, null);
    assert.equal(report?.participantsImported, 2);
    assert.equal(report?.rowsRead, 2);
    assert.equal(state.casePackage?.participants[0]?.participantKey, "SYN-T-001");
    const expected = `Sheet "Census": row 1 "${title}" skipped — title row, not the header row.`;
    assert.ok(report?.warnings.includes(expected), `report warnings should hold the title warning, got: ${JSON.stringify(report?.warnings)}`);
    assert.ok(importReportSummary(report!).includes(title), "the import summary should name the skipped title");
  });
});
