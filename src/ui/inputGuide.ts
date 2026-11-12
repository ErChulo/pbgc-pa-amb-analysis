/**
 * Pre-upload input-shape guide (Import step).
 *
 * The guide is rendered from the importer's own data, so it cannot
 * drift from what the importer accepts: the column list comes from
 * IMPORT_KNOWN_COLUMNS (src/ui/import.ts) in its own order, with one
 * short STE 100 meaning per column from COLUMN_MEANINGS below. The
 * salary columns are patterns, not fixed names
 * (^salary_(\d{4})$ and ^S(00[1-9]|0[1-4][0-9]|050)$ in the importer),
 * so they are listed once as salary_YYYY and S001–S050. Every other
 * section states only what the importer actually does (import.ts,
 * xlsxReader.ts, headerRows.ts).
 *
 * Pure HTML-string rendering, no DOM, no fetch. Safe to import in
 * Node tests. Synthetic data only in examples. No live case data.
 */

import { IMPORT_KNOWN_COLUMNS } from "./import";

/** One short STE 100 meaning per accepted column, in the importer's
 *  own terms. Every column in IMPORT_KNOWN_COLUMNS must have an
 *  entry here; a column without one renders with a plain fallback
 *  that says so, rather than inventing a meaning. */
export const COLUMN_MEANINGS: Readonly<Record<string, string>> = {
  participantKey: "Row key. Required. No key, no participant.",
  caseNumber: "Case number. Text. Leading zeros kept.",
  bcvRecId: "BCV record number.",
  ssn: "Social Security number.",
  firstName: "First name.",
  lastName: "Last name.",
  dob: "Date of birth. YYYY-MM-DD.",
  sex: "Sex code.",
  doh: "Date of hire. YYYY-MM-DD.",
  dote: "Date of termination of employment. YYYY-MM-DD.",
  dop: "Date of participation. YYYY-MM-DD.",
  nrd: "Normal retirement date. YYYY-MM-DD.",
  retstat: "Retirement status code.",
  cs: "Credited service. Decimal years.",
  vs: "Vesting service. Decimal years.",
  es: "Eligibility service. Decimal years.",
  paAmbMinor: "PA_AMB amount. Integer cents.",
  FRSTYEAR: "First salary year. Integer year.",
  LASTYEAR: "Last salary year. Integer year.",
  ANNACT: "A means Actual. B means Annualized.",
  SALARYDESC: "Salary source. Example: W-2.",
  dopt: "Date of plan termination. YYYY-MM-DD. Required. Same on every row.",
};

/** The accepted columns, in the importer's order, each with its
 *  short meaning. This is the single source for the guide's column
 *  list: add a column to the importer and it appears here; remove
 *  one and it leaves here too. */
export function inputGuideColumns(): Array<{ column: string; meaning: string }> {
  return [...IMPORT_KNOWN_COLUMNS].map((column) => ({
    column,
    meaning: COLUMN_MEANINGS[column] ?? "Accepted column. Meaning not yet written.",
  }));
}

/** The full pre-upload guide as HTML. Shown on the Import step
 *  before the file picker. Short sentences, one idea at a time
 *  (ASD STE 100). */
export function renderInputGuide(): string {
  const columns = inputGuideColumns()
    .map(
      (c) =>
        `<dt><code>${c.column}</code></dt><dd>${c.meaning}</dd>`,
    )
    .join("");
  return [
    '<section class="input-guide" aria-label="What the file must look like">',
    "<h3>File shape — read before you upload</h3>",
    "<h4>CSV columns</h4>",
    `<dl>${columns}</dl>`,
    "<p><code>salary_YYYY</code> — one column per year. Integer cents. Example: <code>salary_2020</code>.</p>",
    "<p><code>S001</code>–<code>S050</code> — one column per salary, most recent first. Year of <code>S00n</code> = LASTYEAR − (n − 1). Dollars in the file. The app stores cents. Example: <code>S001</code>.</p>",
    "<p>Unknown columns are kept, never dropped. They are listed as unmapped after import.</p>",
    "<h4>Salary shape</h4>",
    "<ul>",
    "<li>One column per year: <code>salary_YYYY</code>. Each value is integer cents.</li>",
    "<li>Or use the BCV form: <code>S001</code>–<code>S050</code>. <code>S001</code> is the most recent year. Year of <code>S00n</code> = LASTYEAR − (n − 1).</li>",
    "<li><code>S001</code>–<code>S050</code> are dollars in the file. The app stores cents. <code>S001=60000</code> becomes <code>6000000</code> cents.</li>",
    "<li>Use one salary form, not both. A file with both is refused.</li>",
    "<li><code>S001</code>–<code>S050</code> need <code>LASTYEAR</code>. Without <code>LASTYEAR</code>, the row is quarantined.</li>",
    "<li>A blank year means missing. It is never zero.</li>",
    "<li>ANNACT A means Actual. B means Annualized. The file's ANNACT is recorded.</li>",
    "<li>SALARYDESC names the source.</li>",
    "</ul>",
    "<h4>XLSX</h4>",
    "<ul>",
    "<li>Same columns as CSV.</li>",
    "<li>Cached values only. It never runs macros. It never reads formulas.</li>",
    "<li>A workbook with more than one sheet asks which sheet to import.</li>",
    "<li>Excel dates become YYYY-MM-DD dates. Serial 60, the fake 1900-02-29, is left blank.</li>",
    "<li>A .xlsm file is read only. Its macros are ignored, never run.</li>",
    "<li>External links are refused. An encrypted file is refused.</li>",
    "<li>Title rows are skipped, never dropped. A leading row with at most one cell is a title row. The first row with two or more cells is the header. A file with no header row is refused.</li>",
    "</ul>",
    "<h4>JSON</h4>",
    "<ul>",
    "<li>A CasePackage has: case, plan, participants, benefit observations, source documents.</li>",
    "<li>Or send a row array, or <code>{ rows: [...] }</code>, in the same CSV column shape.</li>",
    "<li>Anything else is refused.</li>",
    "</ul>",
    "<h4>Rules, before you upload</h4>",
    "<ul>",
    "<li>A blank stays blank. It is never filled with zero.</li>",
    "<li>Bad dates and bad numbers are quarantined. They are never guessed.</li>",
    "<li>participantKey is required. A row without one is quarantined. It cannot become a participant.</li>",
    "<li>A duplicate participantKey is never merged. The first row is kept. Later rows are quarantined.</li>",
    "<li>caseNumber is text. Leading zeros are kept. It comes from a caseNumber cell, or from the file name.</li>",
    "<li>dopt is required. YYYY-MM-DD. Same on every row.</li>",
    "<li>A file the app cannot read is refused. It changes nothing. It says why, in plain words.</li>",
    "</ul>",
    "</section>",
  ].join("");
}
