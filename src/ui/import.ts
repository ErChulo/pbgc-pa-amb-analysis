/**
 * File import — Stage 7 Robustness D3 (MASTER_PROMPT §6).
 *
 * The app shipped with no file-import surface at all: no file input, no
 * FileReader, no parser. This module is the import layer, pure functions
 * only (no DOM, no FileReader — main.ts owns the file picker and hands
 * the file text here):
 *
 * - CSV: a strict parser (quoted fields, CRLF; an unclosed quote or a
 *   ragged row rejects the file with the row named, never a silent
 *   partial load) plus a row mapper into ValidationParticipant records
 *   and into a CasePackage. Leading title rows (at most one non-empty
 *   cell) are skipped and warned, the first row with two or more
 *   non-empty cells is the header — the same rule as the XLSX reader
 *   (src/ui/headerRows.ts). Unparseable cells become badDates /
 *   badNumbers entries with the value kept null — the row is loaded and
 *   quarantined by S-07/S-08, never dropped and never guessed.
 * - Structured JSON: either a CasePackage (the app's own shape) or a
 *   row array / { rows } in the same CSV column shape.
 * - XLSX/XLSM: read by src/ui/xlsxReader.ts (Stage 8: hand-built
 *   inflate + ZIP + OOXML reader, no external package). The reader
 *   returns cached cell values only — it never runs macros and never
 *   evaluates formulas. The chosen sheet's headers and rows flow
 *   through the same mapper and package builder as CSV rows
 *   (mapImportedRow, rowsToCasePackage), so the same dopt rule, the
 *   same case-number fallback, and the same quarantine rules apply.
 *   A refused .xlsx changes nothing and says why in plain words.
 *
 * A blank is null, never zero. No value is invented: a CSV without a
 * `dopt` column is refused (DOPT is a case fact the validation context
 * needs, and no date is guessed for it), and a row without a
 * participantKey is quarantined, not keyed by row number. The imported
 * package carries no plan provisions (a census CSV has none) and no
 * case tolerance (tolerances stay case-set by the actuary); validation
 * runs on it, calculation needs provisions first.
 *
 * Synthetic data only in tests. No live case data.
 */

import { validateDateString } from "../dates";
import { makeMoney } from "../decimal";
import { findHeaderRow } from "./headerRows.js";
import { appendCaseEvent, createEmptyCasePackage, makeSourceRecord } from "../model";
import type {
  BenefitObservation,
  CasePackage,
  CompensationHistory,
  EmploymentPeriod,
  MissingDataItem,
  Money,
  Participant,
  Provenance,
  ServiceHistory,
  SourcedValue,
  SourceDocument,
  ToleranceRecord,
  TypedBenefitQuantity,
} from "../types";
import type {
  BadDateInput,
  BadNumberInput,
  FileContextInput,
  ValidationParticipant,
} from "../validation";

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/** Parse CSV text into a header row and row objects. Throws with the row
 *  named on an unclosed quote or a ragged row; an empty file throws.
 *  Title rows: the file is expected to be a table of data. Leading rows
 *  with at most one non-empty cell (plus blank rows) are skipped as
 *  title rows — each is reported in `warnings`, never dropped
 *  silently — and the first row with two or more non-empty cells is
 *  the header. A file with no such row is refused (no header row).
 *  The rule is shared with the XLSX reader (src/ui/headerRows.ts).
 *  Row numbers in warnings and errors are positions in the non-empty
 *  rows (index + 1), the existing convention. */
export function parseCsv(text: string): {
  headers: string[];
  rows: Array<Record<string, string>>;
  warnings: string[];
} {
  if (text.trim().length === 0) {
    throw new Error("CSV import refused: the file is empty.");
  }
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let rowNumber = 1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (field.length !== 0) {
        throw new Error(`CSV import refused: unexpected quote at row ${rowNumber}.`);
      }
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      record.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    if (ch === "\n") {
      record.push(field);
      field = "";
      records.push(record);
      record = [];
      rowNumber += 1;
      continue;
    }
    field += ch;
  }
  if (inQuotes) {
    throw new Error(`CSV import refused: unclosed quote at row ${rowNumber}.`);
  }
  record.push(field);
  if (record.some((cell) => cell.trim().length > 0)) records.push(record);
  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim().length > 0));
  if (nonEmpty.length === 0) {
    throw new Error("CSV import refused: the file has no data rows.");
  }
  const found = findHeaderRow(nonEmpty);
  if (found.headerIndex === undefined) {
    throw new Error(
      "CSV import refused: the file has no header row — no rows hold two or more cells. The file is expected to be a table of data.",
    );
  }
  const warnings = found.skipped.map(
    (s) => `CSV row ${s.index + 1} "${s.text}" skipped — title row, not the header row.`,
  );
  const headerIndex = found.headerIndex;
  const headers = (nonEmpty[headerIndex] as string[]).map((h) => h.trim());
  if (headers.some((h) => h.length === 0)) {
    throw new Error("CSV import refused: the header row has a blank column name.");
  }
  const rows: Array<Record<string, string>> = [];
  for (let r = headerIndex + 1; r < nonEmpty.length; r += 1) {
    const cells = nonEmpty[r] as string[];
    if (cells.length !== headers.length) {
      throw new Error(
        `CSV import refused: row ${r + 1} has ${cells.length} columns, expected ${headers.length}.`,
      );
    }
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] as string).trim();
    });
    rows.push(row);
  }
  return { headers, rows, warnings };
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

/** Columns the importer understands. Anything else is an unknown field
 *  (S-03) and is kept in the package's unmapped list, never dropped. */
export const IMPORT_KNOWN_COLUMNS: ReadonlySet<string> = new Set([
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
  "dopt",
]);

const SALARY_COLUMN_RE = /^salary_(\d{4})$/;
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
const INTEGER_RE = /^-?\d+$/;

/** One imported row: typed values plus the bad-cell lists validation reads. */
export interface ImportedRow {
  key: string | null;
  raw: Record<string, string>;
  dob: string | null;
  doh: string | null;
  dote: string | null;
  dop: string | null;
  nrd: string | null;
  dopt: string | null;
  cs: string | null;
  vs: string | null;
  es: string | null;
  paAmbMinor: number | null;
  salaries: Array<{ year: number; minor: number | null }>;
  badDates: BadDateInput[];
  badNumbers: BadNumberInput[];
  /** True when the row cannot become a participant at all (no key). */
  quarantined: boolean;
  quarantineReason: string | null;
}

function blank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

function parseDateCell(
  row: Record<string, string>,
  field: string,
  badDates: BadDateInput[],
): string | null {
  const raw = row[field];
  if (blank(raw)) return null;
  try {
    return validateDateString((raw as string).trim());
  } catch {
    badDates.push({ field, raw: raw as string, ambiguous: false });
    return null;
  }
}

function parseDecimalCell(
  row: Record<string, string>,
  field: string,
  badNumbers: BadNumberInput[],
): string | null {
  const raw = row[field];
  if (blank(raw)) return null;
  const value = (raw as string).trim();
  if (!DECIMAL_RE.test(value)) {
    badNumbers.push({ field, raw: value, reason: "not a decimal number" });
    return null;
  }
  return value;
}

function parseMinorCell(
  row: Record<string, string>,
  field: string,
  badNumbers: BadNumberInput[],
): number | null {
  const raw = row[field];
  if (blank(raw)) return null;
  const value = (raw as string).trim();
  if (!INTEGER_RE.test(value)) {
    badNumbers.push({ field, raw: value, reason: "not integer minor units" });
    return null;
  }
  return Number(value);
}

/** Map one raw CSV/JSON row object into typed values. Never throws for
 *  a bad cell: the cell becomes a badDates/badNumbers entry and null. */
export function mapImportedRow(raw: Record<string, string>): ImportedRow {
  const badDates: BadDateInput[] = [];
  const badNumbers: BadNumberInput[] = [];
  const salaries: Array<{ year: number; minor: number | null }> = [];
  for (const [header, value] of Object.entries(raw)) {
    const match = SALARY_COLUMN_RE.exec(header);
    if (match === null) continue;
    const year = Number(match[1]);
    if (blank(value)) {
      salaries.push({ year, minor: null });
      continue;
    }
    const minor = parseMinorCell(raw, header, badNumbers);
    salaries.push({ year, minor });
  }
  salaries.sort((a, b) => a.year - b.year);
  const key = blank(raw["participantKey"]) ? null : (raw["participantKey"] as string).trim();
  return {
    key,
    raw: { ...raw },
    dob: parseDateCell(raw, "dob", badDates),
    doh: parseDateCell(raw, "doh", badDates),
    dote: parseDateCell(raw, "dote", badDates),
    dop: parseDateCell(raw, "dop", badDates),
    nrd: parseDateCell(raw, "nrd", badDates),
    dopt: parseDateCell(raw, "dopt", badDates),
    cs: parseDecimalCell(raw, "cs", badNumbers),
    vs: parseDecimalCell(raw, "vs", badNumbers),
    es: parseDecimalCell(raw, "es", badNumbers),
    paAmbMinor: parseMinorCell(raw, "paAmbMinor", badNumbers),
    salaries,
    badDates,
    badNumbers,
    quarantined: key === null,
    quarantineReason: key === null ? "Row has no participantKey — it cannot become a participant." : null,
  };
}

/** Unknown (unmapped) column names across rows, in first-seen order. */
export function unknownColumns(headers: readonly string[]): string[] {
  const out: string[] = [];
  for (const h of headers) {
    if (!IMPORT_KNOWN_COLUMNS.has(h) && SALARY_COLUMN_RE.exec(h) === null && !out.includes(h)) {
      out.push(h);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation participants
// ---------------------------------------------------------------------------

function nrdOf(dob: string | null): string | null {
  if (dob === null) return null;
  return `${Number(dob.slice(0, 4)) + 65}${dob.slice(4)}`;
}

function ageAt(dob: string | null, date: string | null): number | null {
  if (dob === null || date === null) return null;
  const years = Number(date.slice(0, 4)) - Number(dob.slice(0, 4));
  return date.slice(5) < dob.slice(5) ? years - 1 : years;
}

/** Map imported rows to ValidationParticipant records for validation.
 *  Quarantined rows (no key) are excluded here — they are reported in
 *  the import report and never reach validation as a participant. */
export function rowsToValidationParticipants(
  rows: readonly ImportedRow[],
  caseNumber: string,
  file: FileContextInput,
): { participants: ValidationParticipant[]; file: FileContextInput } {
  const participants: ValidationParticipant[] = [];
  let recId = 0;
  for (const row of rows) {
    if (row.key === null) continue;
    recId += 1;
    const knownSalaries = row.salaries.filter((s) => s.minor !== null);
    const meanAnnualMinor =
      knownSalaries.length === 0
        ? null
        : Math.round(knownSalaries.reduce((s, x) => s + (x.minor as number), 0) / knownSalaries.length);
    const lastSalary = knownSalaries[knownSalaries.length - 1];
    const nrd = row.nrd ?? nrdOf(row.dob);
    participants.push({
      participantKey: row.key,
      bcvRecId: blank(row.raw["bcvRecId"]) ? recId : Number(row.raw["bcvRecId"]),
      caseNumber,
      idType: "1",
      ssn: blank(row.raw["ssn"]) ? null : (row.raw["ssn"] as string).trim(),
      firstName: blank(row.raw["firstName"]) ? null : (row.raw["firstName"] as string).trim(),
      lastName: blank(row.raw["lastName"]) ? null : (row.raw["lastName"] as string).trim(),
      dob: row.dob,
      sex: blank(row.raw["sex"]) ? null : (row.raw["sex"] as string).trim(),
      dateOfDeath: null,
      retstat: blank(row.raw["retstat"]) ? "2" : (row.raw["retstat"] as string).trim(),
      rettyp: null,
      doh: row.doh,
      dote: row.dote,
      dop: row.dop ?? row.doh,
      dobfParticipant: null,
      dor: null,
      postDoptDote: null,
      nrd,
      anb: ageAt(row.dob, row.dote),
      sanb: null,
      rbd: nrd,
      rbdDeterminable: nrd !== null,
      rbdMissingFields: nrd === null ? ["NRD"] : [],
      inPayAtDopt: null,
      isPreDoptRetiree: false,
      isDeferredRecord: true,
      sbcd: null,
      spouseSsn: null,
      spouseLastName: null,
      spouseDob: null,
      spouseSex: null,
      spouseDateOfDeath: null,
      benSsn: null,
      benLastName: null,
      benDob: null,
      benSex: null,
      benDateOfDeath: null,
      apDob: null,
      apSex: null,
      apDateOfDeath: null,
      cspa: row.cs,
      vspa: row.vs,
      espa: row.es,
      cs: row.cs,
      vs: row.vs,
      es: row.es,
      csUnit: row.cs === null ? null : "years",
      vsUnit: row.vs === null ? null : "years",
      vppa: "1",
      paAmb: row.paAmbMinor,
      paAcomp: meanAnnualMinor === null ? null : Math.round(meanAnnualMinor / 12),
      paAcompPeriodicity: "monthly",
      cuComp:
        lastSalary === undefined
          ? null
          : Math.round((lastSalary.minor as number) / 12),
      pia: null,
      integrationMethod: "none",
      firstYear: row.salaries.length === 0 ? null : (row.salaries[0] as { year: number }).year,
      lastYear:
        row.salaries.length === 0
          ? null
          : (row.salaries[row.salaries.length - 1] as { year: number }).year,
      salaryByYear: row.salaries.map((s) => ({ year: s.year, amount: s.minor })),
      annact: "A",
      annualizationBasisNoted: true,
      averagingPeriodYears: knownSalaries.map((s) => s.year),
      formCode: row.dote === null ? null : "NSF",
      formCodeNsf: "NSF",
      formCodeNmf: "NMF",
      formCodeQpsa: null,
      formCodeArd: null,
      spcVal: "0",
      spcNsf: "0",
      spcArd: "0",
      mths: 0,
      mthsNsf: 0,
      mthsArd: 0,
      formCodeIsJointLife: false,
      recordIsSingleLife: true,
      lsTerm: "N",
      xrd: nrd,
      xrdMbTerm: row.paAmbMinor,
      pvReteec: null,
      measurementDate: row.dote,
      recordedDate: row.dote === null ? null : row.dote,
      measurementDisagreementExplained: false,
      assertedBasisNrd: false,
      nrdBasisEvidence: false,
      explicitNoBenefitStatement: false,
      vestingTreatment: "gross",
      annuityForm: row.dote === null ? null : "NSF",
      annuityFormConversionDocumented: false,
      calcMeasurementDate: row.dote,
      calcAnnuityForm: row.dote === null ? null : "NSF",
      calcVestingTreatment: "gross",
      planFreezeDate: null,
      accrualAfterFreeze: false,
      benefitReflectsPostFreezeAccrual: false,
      mandcwi: null,
      volcwi: null,
      cashBalDopt: null,
      formulaType: "unit-credit",
      contributionTreatmentDocumented: true,
      cashBalanceExplanationDocumented: true,
      documentedMinimumOrGrandfatherOrPastServiceCredit: false,
      participationBeforeEligibility: false,
      serviceAccruesBeforeDop: false,
      parseError: null,
      badDates: row.badDates,
      badNumbers: row.badNumbers,
      fieldsWithoutProvenance: [],
      supportingEvidenceForScale: true,
      s001Derivable: true,
      scheduleProvided: true,
      scheduleRowExists: true,
      schedulePaAmb: row.paAmbMinor,
      scheduleExplanationDocumented: false,
      bcvComparison: null,
      paymentAmountMinor: null,
      convertedPaAmbMinor: null,
      ardFactorsPresent: false,
      priorDistribution: null,
      formulaCheckValueMinor: null,
      formulaKnownForX06: false,
      formulaCheckValuesMinor: null,
      documentedHypothesis: false,
      pfFactors: null,
      proposedDisposition: null,
      evidenceCount: 0,
      paAmbAccept: null,
      disposition: null,
      decisionExists: false,
      rejectionRationaleStated: false,
      sourcesUsed: [],
      candidateMeasurementDates: row.dote === null ? [] : [row.dote],
      establishedMeasurementDate: row.dote,
      prior: null,
    });
  }
  return { participants, file };
}

// ---------------------------------------------------------------------------
// CasePackage building (rows → package)
// ---------------------------------------------------------------------------

export interface ImportMeta {
  caseNumber: string;
  planName: string;
  planNumber: string;
  dopt: string;
  importId: string;
  importedDate: string;
  importedBy: string;
  sourceFileName: string;
  sourceFileHash: string;
}

export interface ImportReport {
  fileName: string;
  rowsRead: number;
  participantsImported: number;
  quarantinedRows: Array<{ rowNumber: number; reason: string }>;
  unknownFields: string[];
  badDates: number;
  badNumbers: number;
  snapshotHash: string;
  /** Reader warnings (XLSX and CSV; empty for JSON). */
  warnings: string[];
  /** Sheet the rows came from (XLSX only; null for CSV/JSON). */
  sheetName: string | null;
  /** Every sheet in the file (XLSX only; empty for CSV/JSON). */
  sheetNames: string[];
}

/** The "no tolerance set" record a fresh import carries. It is not a
 *  tolerance: reconciliation with it is refused by the engine (null
 *  tolerance in the validation context), and the authority string says
 *  so. No built-in acceptance tolerance is ever supplied. */
export function noToleranceSetRecord(importedDate: string): ToleranceRecord {
  return {
    version: 0,
    absoluteMinor: 0,
    relativeDecimal: null,
    application: "either",
    authority:
      "No case tolerance set. The case actuary must set the case tolerance before any reconciliation (MASTER_PROMPT §10; the app ships with no built-in acceptance tolerance).",
    approvedBy: "",
    approvedDate: importedDate,
  };
}

function importProv(meta: ImportMeta): Provenance {
  return {
    documentId: meta.sourceFileName,
    location: {
      kind: "user-entered",
      enteredBy: meta.importedBy,
      enteredDate: meta.importedDate,
      entryForm: "file-import",
    },
    acquisition: "user-entered",
    derivation: null,
    sourceFileHash: meta.sourceFileHash,
  };
}

function sourced<T>(value: T | null, prov: Provenance): SourcedValue<T> {
  return { value, provenance: prov };
}

function importEntity(id: string, meta: ImportMeta): {
  id: string;
  version: number;
  supersedesId: string | null;
  sourceRecordIds: string[];
  createdDate: string;
  createdBy: string;
} {
  return {
    id,
    version: 1,
    supersedesId: null,
    sourceRecordIds: [],
    createdDate: meta.importedDate,
    createdBy: meta.importedBy,
  };
}

function moneyOrNull(minor: number | null): Money | null {
  return minor === null ? null : makeMoney(minor);
}

/** Build a CasePackage from imported rows (mirrors src/ui/demo.ts).
 *  Quarantined rows and duplicate keys are excluded from the package
 *  and listed in the report; the package itself carries no plan
 *  provisions and no case tolerance. */
export function rowsToCasePackage(
  rows: readonly ImportedRow[],
  meta: ImportMeta,
  unknownFields: readonly string[],
  extra?: {
    warnings?: readonly string[];
    sheetName?: string | null;
    sheetNames?: readonly string[];
  },
): { package: CasePackage; report: ImportReport } {
  const prov = importProv(meta);
  const snapshotHash = `import-${meta.importId}`;
  const base = createEmptyCasePackage({
    formatVersion: "1.0.0",
    caseId: `case-${meta.caseNumber}`,
    planId: `plan-${meta.planNumber}`,
    caseNumber: meta.caseNumber,
    planNumber: meta.planNumber,
    planName: meta.planName,
    dopt: meta.dopt,
    tolerance: noToleranceSetRecord(meta.importedDate),
    createdBy: meta.importedBy,
    createdDate: meta.importedDate,
    provenance: prov,
    initialSnapshotHash: snapshotHash,
  });
  const quarantinedRows: ImportReport["quarantinedRows"] = [];
  const seenKeys = new Set<string>();
  const participants: Participant[] = [];
  const employmentPeriods: EmploymentPeriod[] = [];
  const compensationHistories: CompensationHistory[] = [];
  const serviceHistories: ServiceHistory[] = [];
  const benefitObservations: BenefitObservation[] = [];
  const sourceRecords = [];
  let badDates = 0;
  let badNumbers = 0;
  let rowNumber = 1;
  for (const row of rows) {
    rowNumber += 1;
    badDates += row.badDates.length;
    badNumbers += row.badNumbers.length;
    sourceRecords.push(
      makeSourceRecord({
        id: `src-${meta.importId}-row-${rowNumber}`,
        documentId: meta.sourceFileName,
        importId: meta.importId,
        location: {
          kind: "user-entered",
          enteredBy: meta.importedBy,
          enteredDate: meta.importedDate,
          entryForm: "file-import",
        },
        rawFields: row.raw,
        sourceFileHash: meta.sourceFileHash,
        importedDate: meta.importedDate,
        status: row.quarantined ? "quarantined" : "imported",
        quarantineReason: row.quarantineReason,
      }),
    );
    if (row.quarantined || row.key === null) {
      quarantinedRows.push({
        rowNumber,
        reason: row.quarantineReason ?? "Row quarantined.",
      });
      continue;
    }
    if (seenKeys.has(row.key)) {
      quarantinedRows.push({
        rowNumber,
        reason: `Duplicate participantKey ${row.key} — the first row is kept; this row is quarantined, never merged.`,
      });
      continue;
    }
    seenKeys.add(row.key);
    const key = row.key;
    const missing: MissingDataItem[] = [];
    if (row.dote === null) {
      missing.push({
        field: "EmploymentPeriod.dote",
        missingClass: "e",
        consequence: "No measurement date, so no comparison basis and no delta.",
        resolvesBy: "DOTE from the PA benefit schedule.",
      });
    }
    if (row.paAmbMinor === null) {
      missing.push({
        field: "BenefitObservation.paAmb",
        missingClass: "a",
        consequence: "No recorded amount, so nothing to compare.",
        resolvesBy: "PA_AMB from the PA benefit schedule.",
      });
    }
    participants.push({
      ...importEntity(`participant-${key}`, meta),
      bcvRecId: sourced(blank(row.raw["bcvRecId"]) ? null : Number(row.raw["bcvRecId"]), prov),
      caseNumber: sourced(meta.caseNumber, prov),
      idType: sourced<"1" | "2" | "4">("1", prov),
      ssn: sourced<string | null>(blank(row.raw["ssn"]) ? null : (row.raw["ssn"] as string).trim(), prov),
      firstName: sourced<string | null>(blank(row.raw["firstName"]) ? null : (row.raw["firstName"] as string).trim(), prov),
      middleName: sourced<string | null>(null, prov),
      lastName: sourced(blank(row.raw["lastName"]) ? null : (row.raw["lastName"] as string).trim(), prov),
      nameSuffix: sourced<string | null>(null, prov),
      dob: sourced(row.dob, prov),
      sex: sourced<"M" | "F" | "U">(blank(row.raw["sex"]) ? "U" : ((row.raw["sex"] as string).trim() as "M" | "F" | "U"), prov),
      maritalStatus: sourced<"M" | "S" | "D" | "W" | "U" | null>(null, prov),
      healthStatus: sourced<"0" | "1" | "2" | null>(null, prov),
      survivorOwner: sourced<string | null>(null, prov),
      survivorMonths: sourced<number | null>(null, prov),
      dateOfMarriage: sourced<string | null>(null, prov),
      dateOfDeath: sourced<string | null>(null, prov),
      spouse: sourced(null, prov),
      beneficiary: sourced(null, prov),
      alternatePayee: sourced(null, prov),
      retstat: sourced<"1" | "2" | "3" | "4" | "5">(blank(row.raw["retstat"]) ? "2" : ((row.raw["retstat"] as string).trim() as "1" | "2" | "3" | "4" | "5"), prov),
      rettyp: sourced<string | null>(null, prov),
      participantKey: key,
      recordRole: "participant",
      completenessGrade: missing.length === 0 ? "complete" : "partial",
      missingData: missing,
    });
    if (row.doh !== null) {
      employmentPeriods.push({
        ...importEntity(`ep-${key}`, meta),
        participantKey: key,
        doh: sourced(row.doh, prov),
        dote: sourced(row.dote, prov),
        dop: sourced(row.dop ?? row.doh, prov),
        dobfParticipant: sourced<string | null>(null, prov),
        dor: sourced<string | null>(null, prov),
        postDoptDote: sourced<string | null>(null, prov),
        periodSeq: 1,
        periodType: "initial-hire",
        periodStart: row.doh,
        periodEnd: row.dote,
        breakInService: null,
        hoursPerPeriod: sourced<number | null>(null, prov),
      });
    } else {
      missing.push({
        field: "EmploymentPeriod.doh",
        missingClass: "e",
        consequence: "No hire date, so no employment period can be stated and service cannot be measured from dates.",
        resolvesBy: "DOH from the census or employment records.",
      });
    }
    const firstSalary = row.salaries[0];
    const lastSalary = row.salaries[row.salaries.length - 1];
    compensationHistories.push({
      ...importEntity(`ch-${key}`, meta),
      participantKey: key,
      firstYear: sourced(firstSalary === undefined ? null : firstSalary.year, prov),
      lastYear: sourced(lastSalary === undefined ? null : lastSalary.year, prov),
      salaryByYear: row.salaries.map((s, i) => ({
        salaryYear: s.year,
        sourceField: `salary_${s.year}`,
        amount: moneyOrNull(s.minor),
        annualized: false,
        provenance: prov,
      })),
      annualizedFlagSource: sourced(null, prov),
      salaryDesc: sourced("Imported salary row.", prov),
      currentMonthlyComp: sourced<Money | null>(null, prov),
      paAverageComp: sourced<Money | null>(null, prov),
      compensationDefinitionApplied: "Not stated in the imported file.",
      nonCensusInputs: [],
    });
    const service = row.cs === null ? null : Number(row.cs);
    serviceHistories.push({
      ...importEntity(`sh-${key}`, meta),
      participantKey: key,
      asOfDate: sourced(row.dote ?? meta.dopt, prov),
      paCreditedService: sourced(service, prov),
      paVestingService: sourced(service, prov),
      paEligibilityService: sourced(service, prov),
      bcvCreditedService: sourced(service, prov),
      bcvVestingService: sourced(service, prov),
      bcvEligibilityService: sourced(service, prov),
      paVestingPercent: sourced("1", prov),
      bcvVestingPercent: sourced("1", prov),
      serviceMeasure: "years",
      servicePeriods: [],
      breaksApplied: [],
      distributions: [],
    });
    const benefit: TypedBenefitQuantity = {
      amount: moneyOrNull(row.paAmbMinor),
      periodicity: "monthly",
      measurementDate: row.dote,
      measurementBasis: row.dote === null ? "unresolved" : "dote",
      basisNote: null,
      commencementBasis: row.dote === null ? null : "payable at NRD",
      retirementAge: 65,
      retirementDate: null,
      annuityForm: row.dote === null ? "unknown" : "NSF",
      vestingTreatment: row.dote === null ? "unknown" : "vested",
      planVersionId: "",
      formulaId: "",
      source: "prior-administrator",
      status: "recorded",
      ownerId: `obs-${key}`,
    };
    benefitObservations.push({
      ...importEntity(`obs-${key}`, meta),
      participantKey: key,
      paAmb: sourced<Money | null>(moneyOrNull(row.paAmbMinor), prov),
      benefit,
      measurementDate: row.dote,
      measurementBasis: row.dote === null ? "unresolved" : "dote",
      annuityForm: row.dote === null ? "unknown" : "NSF",
      vestingTreatment: row.dote === null ? "unknown" : "vested",
      recordedDate: sourced<string | null>(row.dote, prov),
      sourceScheduleRow: `${meta.sourceFileName} row ${rowNumber}`,
      observationType: "census",
      paAmbAccept: null,
      qdroSplitDate: sourced<string | null>(null, prov),
      sourceDocumentId: meta.sourceFileName,
    });
  }
  const sourceDocument: SourceDocument = {
    ...importEntity(`doc-${meta.importId}`, meta),
    documentId: meta.sourceFileName,
    documentType: "census-file",
    title: `Imported file ${meta.sourceFileName}`,
    fileHash: meta.sourceFileHash,
    location: "File import.",
    versionDate: meta.importedDate,
    effectiveDate: null,
    reliabilityGrade: "unassessed",
    otherTypeDescription: null,
  };
  const pkg: CasePackage = {
    ...base,
    participants,
    employmentPeriods,
    compensationHistories,
    serviceHistories,
    benefitObservations,
    sourceDocuments: [sourceDocument],
    sourceRecords,
    // Unknown columns are retained in _unmapped (path + first-seen
    // value), never dropped (S-03).
    unmapped: unknownFields.map((field) => ({
      path: field,
      value: rows.map((r) => r.raw[field] ?? null).find((v) => v !== null) ?? null,
      provenance: prov,
    })),
  };
  const withEvent = appendCaseEvent(pkg, {
    id: `case-${meta.caseNumber}-event-2`,
    sequence: 2,
    eventDate: meta.importedDate,
    actor: meta.importedBy,
    kind: "source-imported",
    summary: `File ${meta.sourceFileName} imported: ${participants.length} participants, ${quarantinedRows.length} row(s) quarantined.`,
    affectedEntityIds: [`case-${meta.caseNumber}`],
    affectedParticipantKeys: participants.map((p) => p.participantKey),
    revision: null,
    snapshotHashAfter: snapshotHash,
  });
  return {
    package: withEvent,
    report: {
      fileName: meta.sourceFileName,
      rowsRead: rows.length,
      participantsImported: participants.length,
      quarantinedRows,
      unknownFields: [...unknownFields],
      badDates,
      badNumbers,
      snapshotHash,
      warnings: [...(extra?.warnings ?? [])],
      sheetName: extra?.sheetName ?? null,
      sheetNames: [...(extra?.sheetNames ?? [])],
    },
  };
}

// ---------------------------------------------------------------------------
// Structured JSON import
// ---------------------------------------------------------------------------

/** Parse structured JSON import text. Returns either a CasePackage
 *  (the app's own shape) or mapped rows (an array, or { rows }). */
export function parseJsonImport(text: string): {
  kind: "case-package";
  package: CasePackage;
} | {
  kind: "rows";
  rows: Array<Record<string, string>>;
  headers: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    throw new Error(
      `JSON import refused: not valid JSON (${err instanceof Error ? err.message : String(err)}).`,
    );
  }
  if (Array.isArray(parsed)) {
    return { kind: "rows", rows: coerceRowArray(parsed), headers: rowHeaders(parsed) };
  }
  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj["rows"])) {
      const rows = coerceRowArray(obj["rows"]);
      return { kind: "rows", rows, headers: rowHeaders(rows) };
    }
    if (typeof obj["case"] === "object" && obj["case"] !== null && Array.isArray(obj["participants"])) {
      return { kind: "case-package", package: coerceCasePackage(obj) };
    }
  }
  throw new Error(
    "JSON import refused: expected a CasePackage ({ case, participants, ... }), a row array, or { rows: [...] }.",
  );
}

function rowHeaders(rows: readonly unknown[]): string[] {
  const headers: string[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    for (const key of Object.keys(row as Record<string, unknown>)) {
      if (!headers.includes(key)) headers.push(key);
    }
  }
  return headers;
}

function coerceRowArray(value: readonly unknown[]): Array<Record<string, string>> {
  return value.map((row, index) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error(`JSON import refused: row ${index + 1} is not an object.`);
    }
    const out: Record<string, string> = {};
    for (const [key, v] of Object.entries(row as Record<string, unknown>)) {
      if (v === null || v === undefined) out[key] = "";
      else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[key] = String(v);
      else throw new Error(`JSON import refused: row ${index + 1} field ${key} is not a plain value.`);
    }
    return out;
  });
}

/** Minimal structural check for a CasePackage JSON payload. The payload
 *  is the app's own shape; anything missing its case/participants is
 *  refused rather than guessed into shape. */
function coerceCasePackage(obj: Record<string, unknown>): CasePackage {
  const caseObj = obj["case"] as Record<string, unknown>;
  const caseNumber =
    (caseObj["caseNumber"] as Record<string, unknown> | undefined)?.["value"] ??
    caseObj["caseNumber"];
  if (typeof caseNumber !== "string" || caseNumber.trim().length === 0) {
    throw new Error("JSON import refused: CasePackage case.caseNumber is missing.");
  }
  const participants = obj["participants"];
  if (!Array.isArray(participants)) {
    throw new Error("JSON import refused: CasePackage participants is not an array.");
  }
  return obj as unknown as CasePackage;
}
