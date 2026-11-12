/**
 * Pre-upload input-shape guide — drift + mismatch tests (Worker B).
 *
 * - Drift: the guide's column list must match the importer's accepted
 *   columns exactly (IMPORT_KNOWN_COLUMNS + the salary_YYYY pattern).
 *   The guide module (COLUMN_MEANINGS in src/ui/inputGuide.ts, or next
 *   to IMPORT_KNOWN_COLUMNS in src/ui/import.ts) had NOT landed when
 *   these tests were written, so the guide-drift test resolves the list
 *   from wherever it actually lives and skips with a plain message
 *   until the guide worker lands it. The pinned importer list below
 *   never skips: if the importer changes, this file fails and the
 *   guide must be updated with it.
 * - Mismatch: the Stage 2 BCV salary columns (S001–S050, FRSTYEAR,
 *   LASTYEAR, ANNACT, SALARYDESC) ARE accepted by the importer —
 *   a row carrying them maps into salary history (S001 is dollars
 *   in the file, stored as integer cents), never into unmapped.
 *
 * Synthetic data only. Fictional participants only. No live case data.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  IMPORT_KNOWN_COLUMNS,
  mapImportedRow,
  parseCsv,
  rowsToCasePackage,
  unknownColumns,
} from "../src/ui/import.js";
import type { ImportMeta } from "../src/ui/import.js";

/** The importer's accepted fixed columns, pinned from
 *  src/ui/import.ts IMPORT_KNOWN_COLUMNS (verified 2026-11-12). */
const EXPECTED_KNOWN_COLUMNS = [
  "participantKey",
  "caseNumber",
  "bcvRecId",
  "ssn",
  "firstName",
  "lastName",
  "dob",
  "sex",
  "doh",
  "dote",
  "dop",
  "nrd",
  "retstat",
  "cs",
  "vs",
  "es",
  "paAmbMinor",
  "FRSTYEAR",
  "LASTYEAR",
  "ANNACT",
  "SALARYDESC",
  "dopt",
];

/** Stage 2 BCV salary columns the importer accepts (§3.7). */
const STAGE2_SALARY_COLUMNS = ["S001", "FRSTYEAR", "LASTYEAR", "ANNACT", "SALARYDESC"];

const ACTOR = "A. Actuary";

/** True once the guide worker has landed a column list: a compiled
 *  src/ui/inputGuide.js, or COLUMN_MEANINGS exported from import.js.
 *  Checked synchronously against compiled dist/ (npm test runs tsc
 *  first) so the drift test registers as skipped until the guide
 *  lands, instead of failing on a module that does not exist yet. */
const guideLanded: boolean = (() => {
  if (existsSync(join(__dirname, "..", "src", "ui", "inputGuide.js"))) return true;
  try {
    return readFileSync(join(__dirname, "..", "src", "ui", "import.js"), "utf8").includes(
      "COLUMN_MEANINGS",
    );
  } catch {
    return false;
  }
})();

function testMeta(): ImportMeta {
  return {
    caseNumber: "00098765",
    planName: "Imported",
    planNumber: "x",
    dopt: "2024-06-30",
    importId: "imp-guide-1",
    importedDate: "2026-11-12",
    importedBy: ACTOR,
    sourceFileName: "case.csv",
    sourceFileHash: "not-computed",
  };
}

/**
 * Resolve the guide's column list from wherever the guide worker put
 * it: COLUMN_MEANINGS in src/ui/inputGuide.ts, or exported from
 * src/ui/import.ts next to IMPORT_KNOWN_COLUMNS. Returns null when
 * the guide has not landed yet.
 *
 * Adapted 2026-11-12 to the landed structure (src/ui/inputGuide.ts):
 * COLUMN_MEANINGS is Record<string, string> — one short meaning per
 * fixed column — and the salary pattern is NOT a key in it. The
 * salary shape is rendered separately by renderInputGuide() as the
 * literal `salary_YYYY` (the importer pattern is ^salary_(\d{4})$,
 * proved by the salary test below), and inputGuideColumns() lists
 * the fixed columns in the importer's order.
 */
async function loadGuideColumnList(): Promise<{
  keys: string[];
  orderedColumns: string[];
  salaryRendered: boolean;
  source: string;
} | null> {
  const importModule = (await import("../src/ui/import.js")) as unknown as Record<
    string,
    unknown
  >;
  const fromImport = importModule["COLUMN_MEANINGS"];
  if (fromImport !== null && typeof fromImport === "object") {
    return {
      keys: Object.keys(fromImport as Record<string, unknown>),
      orderedColumns: Object.keys(fromImport as Record<string, unknown>),
      salaryRendered: false,
      source: "src/ui/import.ts COLUMN_MEANINGS",
    };
  }
  // Deliberately a variable specifier: the module may not exist yet,
  // and a literal specifier would fail type-checking until it lands.
  const specifier = "../src/ui/inputGuide.js";
  try {
    const guideModule = (await import(specifier)) as unknown as Record<string, unknown>;
    const meanings = guideModule["COLUMN_MEANINGS"];
    if (meanings !== null && typeof meanings === "object") {
      const render = guideModule["renderInputGuide"];
      const columnsFn = guideModule["inputGuideColumns"];
      const orderedColumns =
        typeof columnsFn === "function"
          ? (columnsFn as () => Array<{ column: string }>)().map(
              (c: { column: string }) => c.column,
            )
          : Object.keys(meanings as Record<string, unknown>);
      return {
        keys: Object.keys(meanings as Record<string, unknown>),
        orderedColumns,
        salaryRendered:
          typeof render === "function" &&
          (render as () => string)().includes("salary_YYYY"),
        source: "src/ui/inputGuide.ts COLUMN_MEANINGS",
      };
    }
    // Module exists but carries no COLUMN_MEANINGS: that is a real
    // drift failure, not a skip — say exactly what it does export.
    throw new Error(
      `input guide module exists (${specifier}) but exports no COLUMN_MEANINGS; ` +
        `exports found: ${Object.keys(guideModule).join(", ") || "(none)"}`,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("input guide module exists")) {
      throw error;
    }
    return null;
  }
  return null;
}

describe("input-shape guide drift", () => {
  it("the importer accepts exactly the 22 documented fixed columns", () => {
    assert.deepEqual(
      [...IMPORT_KNOWN_COLUMNS].sort(),
      [...EXPECTED_KNOWN_COLUMNS].sort(),
    );
  });

  it("salary_YYYY is an accepted salary shape (four-digit year)", () => {
    // Accepted: a real salary year lands in salary history, never unmapped.
    const accepted = mapImportedRow({
      participantKey: "SYN-G-001",
      dopt: "2024-06-30",
      salary_2020: "6000000",
      salary_2024: "",
    });
    assert.deepEqual(
      accepted.salaries.map((s) => s.year),
      [2020, 2024],
    );
    assert.equal(accepted.salaries[0]?.minor, 6000000);
    assert.equal(accepted.salaries[1]?.minor, null);
    assert.deepEqual(unknownColumns(["participantKey", "salary_2020", "salary_2024"]), []);

    // Not accepted: two-digit year, non-year suffix, missing year.
    assert.deepEqual(
      unknownColumns(["salary_20", "salary_ABC", "salary_", "salary_2020x"]),
      ["salary_20", "salary_ABC", "salary_", "salary_2020x"],
    );
  });

  // Registered as skipped until the guide worker lands a column list
  // (see guideLanded above); the pinned importer tests never skip.
  const guideDriftTest = guideLanded ? it : it.skip;
  guideDriftTest("the guide's column list matches the importer's accepted columns", async () => {
    const guide = await loadGuideColumnList();
    assert.notEqual(
      guide,
      null,
      "guide module was detected but its column list could not be read",
    );
    const g = guide as NonNullable<typeof guide>;
    assert.deepEqual(
      [...g.keys].sort(),
      [...IMPORT_KNOWN_COLUMNS].sort(),
      `guide column list (${g.source}) drifted from IMPORT_KNOWN_COLUMNS`,
    );
    assert.deepEqual(
      g.orderedColumns,
      [...IMPORT_KNOWN_COLUMNS],
      `guide column order (${g.source}) drifted from IMPORT_KNOWN_COLUMNS order`,
    );
    // The salary shape is a pattern, not a fixed column: it must not
    // appear in the fixed list, and the rendered guide must name it
    // once as salary_YYYY (the importer pattern ^salary_(\d{4})$ is
    // proved by the salary-shape test below).
    assert.ok(!g.keys.includes("salary_YYYY"));
    assert.ok(
      g.salaryRendered,
      `rendered guide (${g.source}) must name the salary_YYYY shape`,
    );
  });
});

describe("Stage 2 BCV salary columns ARE accepted by the importer", () => {
  it("S001, FRSTYEAR, LASTYEAR, ANNACT and SALARYDESC map into salary history", () => {
    const csv =
      "participantKey,dopt,S001,FRSTYEAR,LASTYEAR,ANNACT,SALARYDESC\n" +
      "SYN-M-001,2024-06-30,120000,2019,2024,A,Annual\n";
    const { headers, rows } = parseCsv(csv);
    assert.deepEqual(unknownColumns(headers), []);
    const mapped = rows.map(mapImportedRow);
    assert.equal(mapped[0]?.key, "SYN-M-001");
    // S001 is dollars in the file; the app stores cents (×100).
    assert.deepEqual(mapped[0]?.salaries, [
      { year: 2024, minor: 12000000, sourceField: "S001" },
    ]);
    assert.equal(mapped[0]?.firstYear, 2019);
    assert.equal(mapped[0]?.lastYear, 2024);
    assert.equal(mapped[0]?.annact, "A");
    assert.equal(mapped[0]?.salaryDesc, "Annual");
    const { package: pkg, report } = rowsToCasePackage(
      mapped,
      testMeta(),
      unknownColumns(headers),
    );
    assert.equal(report.participantsImported, 1);
    assert.deepEqual(report.unknownFields, []);
    assert.deepEqual(pkg.unmapped, []);
    assert.equal(pkg.compensationHistories.length, 1);
    assert.equal(pkg.compensationHistories[0]?.firstYear.value, 2019);
    assert.equal(pkg.compensationHistories[0]?.lastYear.value, 2024);
    assert.deepEqual(
      pkg.compensationHistories[0]?.salaryByYear.map((s) => ({
        year: s.salaryYear,
        minor: s.amount?.amountMinor ?? null,
        sourceField: s.sourceField,
      })),
      [{ year: 2024, minor: 12000000, sourceField: "S001" }],
    );
    assert.equal(pkg.compensationHistories[0]?.salaryDesc.value, "Annual");
  });
});
