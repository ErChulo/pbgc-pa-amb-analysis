/**
 * S001–S050 salary columns as input (Stage 2 §3.7).
 *
 * Covers the BCV salary form: S001 is the most recent year (year of
 * S00n = LASTYEAR − (n − 1)), S-values are dollars in the file and
 * are stored as integer cents (×100), FRSTYEAR/LASTYEAR give the
 * span, ANNACT (A/B) is recorded, SALARYDESC names the source, and
 * a file mixing salary_YYYY and S001–S050 is refused whole.
 *
 * Synthetic data only. Fictional participants only. No live case data.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildXlsx } from "../src/ui/exports.js";
import {
  mapImportedRow,
  parseCsv,
  rowsToCasePackage,
  rowsToValidationParticipants,
  salaryFormConflict,
  SALARY_FORM_CONFLICT_MESSAGE,
  unknownColumns,
} from "../src/ui/import.js";
import type { ImportMeta, ImportedRow } from "../src/ui/import.js";
import { importFileBytes, importFileText } from "../src/ui/main.js";
import { DEMO_CASE_PACKAGE } from "../src/ui/demo.js";
import {
  createCaseAnalysisState,
  createInitialUiState,
} from "../src/ui/state.js";
import type { UiState } from "../src/ui/state.js";
import { validateParticipant } from "../src/validation.js";
import type {
  FileContextInput,
  RuleEvaluation,
  RuleId,
  ValidationContext,
} from "../src/validation.js";

const ACTOR = "A. Actuary";
const AT = "2026-11-12T00:00:00.000Z";

function testMeta(): ImportMeta {
  return {
    caseNumber: "00098765",
    planName: "Imported",
    planNumber: "x",
    dopt: "2024-06-30",
    importId: "imp-s050-1",
    importedDate: "2026-11-12",
    importedBy: ACTOR,
    sourceFileName: "case.csv",
    sourceFileHash: "not-computed",
  };
}

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

function cleanFile(): FileContextInput {
  return {
    openable: true,
    truncated: false,
    hashMatches: true,
    hashBefore: "aaaa",
    hashAfter: "aaaa",
    macroRan: false,
    unknownFields: [],
  };
}

/** Minimal context for validateParticipant (same shape as the
 *  cleanContext in test/validation.test.ts). */
function cleanContext(): ValidationContext {
  return {
    dopt: "2021-06-30",
    today: "2026-11-12",
    runId: "run-test-1",
    recordedDate: "2026-11-12",
    tolerance: {
      version: 1,
      absoluteMinor: 200,
      relativeDecimal: null,
      application: "either",
      authority: "case actuary — case record M-7 (illustration only, not a PBGC rule)",
      approvedBy: "case actuary",
      approvedDate: "2026-11-12",
    },
    serviceTolerance: "0",
    monthlyBenefitPlausibilityCap: 2500000,
    plausibleBenefitCompRatioRange: null,
    planServiceCreditRule: null,
    validFormCodes: ["NSF", "NMF", "QPSA", "J&S50", "J&S75", "J&S100"],
    file: cleanFile(),
    priorExtract: null,
  };
}

function s10Outcome(rows: ImportedRow[]): RuleEvaluation {
  const { participants } = rowsToValidationParticipants(rows, "00098765", cleanFile());
  assert.equal(participants.length, 1);
  const found = validateParticipant(
    participants[0] as NonNullable<typeof participants[number]>,
    cleanContext(),
  ).find((e) => e.ruleId === ("S-10" as RuleId));
  assert.notEqual(found, undefined, "expected an S-10 evaluation");
  return found as RuleEvaluation;
}

/** Map one CSV text through parseCsv + mapImportedRow. */
function importCsv(csv: string): { headers: string[]; mapped: ImportedRow[] } {
  const { headers, rows } = parseCsv(csv);
  return { headers, mapped: rows.map(mapImportedRow) };
}

describe("(a) S001–S050 map to the right years, dollars to cents", () => {
  it("S001 = LASTYEAR, S002 = LASTYEAR−1, S050 with LASTYEAR 2024 → 1975", () => {
    const { mapped } = importCsv(
      "participantKey,dopt,S001,S002,S003,S050,FRSTYEAR,LASTYEAR,ANNACT,SALARYDESC\n" +
        "SYN-S-001,2024-06-30,60000,58000,55000,10000,1975,2024,A,W-2\n",
    );
    assert.deepEqual(
      mapped[0]?.salaries.map((s) => ({ year: s.year, minor: s.minor, sourceField: s.sourceField })),
      [
        { year: 1975, minor: 1000000, sourceField: "S050" },
        { year: 2022, minor: 5500000, sourceField: "S003" },
        { year: 2023, minor: 5800000, sourceField: "S002" },
        { year: 2024, minor: 6000000, sourceField: "S001" },
      ],
    );
  });

  it("S001=60000 dollars becomes 6000000 cents", () => {
    const mapped = mapImportedRow({
      participantKey: "SYN-S-002",
      dopt: "2024-06-30",
      S001: "60000",
      LASTYEAR: "2024",
    });
    assert.deepEqual(
      mapped.salaries.map((s) => ({ year: s.year, minor: s.minor })),
      [{ year: 2024, minor: 6000000 }],
    );
  });

  it("S000 and S051 are not salary columns — they land in unmapped", () => {
    assert.deepEqual(unknownColumns(["S000", "S051", "S001", "S050"]), ["S000", "S051"]);
  });
});

describe("(b) FRSTYEAR/LASTYEAR span check (rule S-10)", () => {
  it("S-10 passes when the populated S-years fill the FRSTYEAR–LASTYEAR span", () => {
    const { mapped } = importCsv(
      "participantKey,dopt,S001,S002,S003,FRSTYEAR,LASTYEAR,ANNACT\n" +
        "SYN-S-010,2024-06-30,60000,58000,55000,2022,2024,A\n",
    );
    const evaluation = s10Outcome(mapped);
    assert.equal(evaluation.outcome, "pass");
  });

  it("S-10 fails when the span is wider than the populated S-years", () => {
    const { mapped } = importCsv(
      "participantKey,dopt,S001,S002,S003,FRSTYEAR,LASTYEAR,ANNACT\n" +
        "SYN-S-011,2024-06-30,60000,58000,55000,2020,2024,A\n",
    );
    const evaluation = s10Outcome(mapped);
    assert.equal(evaluation.outcome, "fail");
    assert.equal(evaluation.findings[0]?.ruleId, "S-10");
  });
});

describe("(c) a blank S-year inside the span is missing, never zero", () => {
  it("blank S002 maps to minor null in the row and in the package", () => {
    const { mapped } = importCsv(
      "participantKey,dopt,S001,S002,S003,FRSTYEAR,LASTYEAR,ANNACT\n" +
        "SYN-S-020,2024-06-30,60000,,55000,2022,2024,A\n",
    );
    assert.deepEqual(
      mapped[0]?.salaries.map((s) => ({ year: s.year, minor: s.minor })),
      [
        { year: 2022, minor: 5500000 },
        { year: 2023, minor: null },
        { year: 2024, minor: 6000000 },
      ],
    );
    assert.ok(
      (mapped[0]?.salaries ?? []).every((s) => s.minor !== 0),
      "no salary may be zero-filled",
    );
    const { package: pkg } = rowsToCasePackage(mapped, testMeta(), []);
    const byYear = pkg.compensationHistories[0]?.salaryByYear ?? [];
    assert.equal(byYear.find((s) => s.salaryYear === 2023)?.amount, null);
    assert.equal(byYear.find((s) => s.salaryYear === 2024)?.amount?.amountMinor, 6000000);
  });
});

describe("(d) ANNACT A/B recorded; missing ANNACT warned", () => {
  it("ANNACT A is recorded and no salary is annualized", () => {
    const { mapped } = importCsv(
      "participantKey,dopt,S001,FRSTYEAR,LASTYEAR,ANNACT\n" +
        "SYN-S-030,2024-06-30,60000,2024,2024,A\n",
    );
    assert.equal(mapped[0]?.annact, "A");
    const { package: pkg } = rowsToCasePackage(mapped, testMeta(), []);
    const ch = pkg.compensationHistories[0];
    assert.equal(ch?.annualizedFlagSource.value, "A");
    assert.deepEqual(
      ch?.salaryByYear.map((s) => s.annualized),
      [false],
    );
  });

  it("ANNACT B is recorded and the salary is annualized", () => {
    const { mapped } = importCsv(
      "participantKey,dopt,S001,FRSTYEAR,LASTYEAR,ANNACT\n" +
        "SYN-S-031,2024-06-30,60000,2024,2024,B\n",
    );
    assert.equal(mapped[0]?.annact, "B");
    const { package: pkg } = rowsToCasePackage(mapped, testMeta(), []);
    const ch = pkg.compensationHistories[0];
    assert.equal(ch?.annualizedFlagSource.value, "B");
    assert.deepEqual(
      ch?.salaryByYear.map((s) => s.annualized),
      [true],
    );
  });

  it("missing ANNACT with the LASTYEAR salary present is flagged in the import warnings", () => {
    const { mapped } = importCsv(
      "participantKey,dopt,S001,FRSTYEAR,LASTYEAR\n" +
        "SYN-S-032,2024-06-30,60000,2024,2024\n",
    );
    assert.equal(mapped[0]?.annact, null);
    assert.deepEqual(mapped[0]?.warnings, [
      "ANNACT missing — the LASTYEAR salary is present, so ANNACT is required (A = Actual, B = Annualized).",
    ]);
    const { report } = rowsToCasePackage(mapped, testMeta(), []);
    assert.ok(
      report.warnings.some((w) =>
        w.includes(
          "Row 2: ANNACT missing — the LASTYEAR salary is present, so ANNACT is required (A = Actual, B = Annualized).",
        ),
      ),
      `expected the missing-ANNACT warning in the report, got: ${JSON.stringify(report.warnings)}`,
    );
  });
});

describe("(e) SALARYDESC recorded as the source", () => {
  it("SALARYDESC lands in CompensationHistory.salaryDesc", () => {
    const { mapped } = importCsv(
      "participantKey,dopt,S001,FRSTYEAR,LASTYEAR,ANNACT,SALARYDESC\n" +
        "SYN-S-040,2024-06-30,60000,2024,2024,A,W-2\n",
    );
    assert.equal(mapped[0]?.salaryDesc, "W-2");
    const { package: pkg } = rowsToCasePackage(mapped, testMeta(), []);
    assert.equal(pkg.compensationHistories[0]?.salaryDesc.value, "W-2");
  });
});

describe("(f) both salary forms in one file are refused", () => {
  it("salaryFormConflict returns the exact plain conflict message", () => {
    assert.equal(
      SALARY_FORM_CONFLICT_MESSAGE,
      "The file mixes salary_YYYY columns and S001–S050 columns. Use one salary form, not both.",
    );
    assert.equal(
      salaryFormConflict(["participantKey", "salary_2020", "S001"]),
      SALARY_FORM_CONFLICT_MESSAGE,
    );
    assert.equal(salaryFormConflict(["participantKey", "salary_2020"]), null);
    assert.equal(salaryFormConflict(["participantKey", "S001", "LASTYEAR"]), null);
  });

  it("a mixed CSV is refused whole through the file import", () => {
    const before = freshUiState();
    const { state, report, error } = importFileText(
      before,
      "mixed.csv",
      "participantKey,dopt,salary_2020,S001,LASTYEAR\n" +
        "SYN-S-050,2024-06-30,6000000,60000,2024\n",
      ACTOR,
      AT,
    );
    assert.equal(report, null);
    assert.equal(error, `Import refused: ${SALARY_FORM_CONFLICT_MESSAGE}`);
    assert.equal(state.casePackage, null);
  });
});

describe("(g) plain salary_YYYY files are unchanged — no regression", () => {
  it("salary_YYYY values are already cents and are NOT multiplied by 100", () => {
    const mapped = mapImportedRow({
      participantKey: "SYN-S-060",
      dopt: "2024-06-30",
      salary_2020: "6000000",
      salary_2024: "",
    });
    assert.deepEqual(
      mapped.salaries.map((s) => ({ year: s.year, minor: s.minor })),
      [
        { year: 2020, minor: 6000000 },
        { year: 2024, minor: null },
      ],
    );
    const { package: pkg } = rowsToCasePackage([mapped], testMeta(), []);
    assert.deepEqual(
      pkg.compensationHistories[0]?.salaryByYear.map((s) => ({
        year: s.salaryYear,
        minor: s.amount?.amountMinor ?? null,
      })),
      [
        { year: 2020, minor: 6000000 },
        { year: 2024, minor: null },
      ],
    );
  });
});

describe("(h) XLSX with S001–S050 imports the same as CSV", () => {
  it("same years, same converted values as the equivalent CSV", () => {
    const csv =
      "participantKey,dopt,S001,S002,S050,FRSTYEAR,LASTYEAR,ANNACT,SALARYDESC\n" +
      "SYN-S-070,2024-06-30,60000,58000,10000,1975,2024,A,W-2\n";
    const csvResult = importFileText(freshUiState(), "s050.csv", csv, ACTOR, AT);
    assert.equal(csvResult.error, null);
    assert.equal(csvResult.report?.participantsImported, 1);

    const bytes = buildXlsx([
      {
        name: "Census",
        rows: [
          ["participantKey", "dopt", "S001", "S002", "S050", "FRSTYEAR", "LASTYEAR", "ANNACT", "SALARYDESC"],
          ["SYN-S-070", "2024-06-30", 60000, 58000, 10000, 1975, 2024, "A", "W-2"],
        ],
      },
    ]);
    const xlsxResult = importFileBytes(freshUiState(), "s050.xlsx", bytes, ACTOR, AT);
    assert.equal(xlsxResult.error, null);
    assert.equal(xlsxResult.report?.participantsImported, 1);
    assert.equal(xlsxResult.report?.sheetName, "Census");

    const csvSalaries = csvResult.state.casePackage?.compensationHistories[0]?.salaryByYear.map(
      (s) => ({ year: s.salaryYear, minor: s.amount?.amountMinor ?? null, sourceField: s.sourceField }),
    );
    const xlsxSalaries = xlsxResult.state.casePackage?.compensationHistories[0]?.salaryByYear.map(
      (s) => ({ year: s.salaryYear, minor: s.amount?.amountMinor ?? null, sourceField: s.sourceField }),
    );
    assert.deepEqual(xlsxSalaries, csvSalaries);
    assert.deepEqual(xlsxSalaries, [
      { year: 1975, minor: 1000000, sourceField: "S050" },
      { year: 2023, minor: 5800000, sourceField: "S002" },
      { year: 2024, minor: 6000000, sourceField: "S001" },
    ]);
    assert.equal(
      xlsxResult.state.casePackage?.compensationHistories[0]?.salaryDesc.value,
      "W-2",
    );
  });
});

describe("S001–S050 without LASTYEAR quarantines the row", () => {
  it("S-values with no LASTYEAR are quarantined and never reach the package", () => {
    const { mapped } = importCsv(
      "participantKey,dopt,S001,FRSTYEAR,ANNACT\n" +
        "SYN-S-080,2024-06-30,60000,2024,A\n",
    );
    assert.equal(mapped[0]?.quarantined, true);
    assert.equal(
      mapped[0]?.quarantineReason,
      "S001–S050 present but LASTYEAR missing — salary years cannot be derived.",
    );
    const { package: pkg, report } = rowsToCasePackage(mapped, testMeta(), []);
    assert.equal(report.participantsImported, 0);
    assert.equal(report.quarantinedRows.length, 1);
    assert.equal(pkg.compensationHistories.length, 0);
  });
});
