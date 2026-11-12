/**
 * Stage 6 — exports (Worker C).
 *
 * Pure builders + download helpers. DOM-free except `downloadBlob`
 * (guarded: no-op when `document` is undefined, so Node tests can
 * import this module).
 *
 * Governing spec: MASTER_PROMPT §15 (export CSV, XLSX, printable
 * PDF/HTML, machine-readable package) and §19 (explicit control of
 * file import/export; clear warnings before exporting sensitive
 * information). XLSX pattern adapted from the PF generator
 * (hand-built OOXML: direct XML + stored ZIP, no library, no CDN,
 * no fetch). Deterministic: fixed ZIP timestamps (1980-01-01), no
 * Math.random, no clock.
 *
 * Money is integer minor units (cents) in the engine; XLSX rows carry
 * caller-supplied numbers (dollars or factors) as plain numbers.
 * Blanks are null in the engine and must be passed as "" in a row,
 * never 0.
 */

import type { WorkProductContribution } from "../contribution.js";
import { CONTRIBUTION_PROTOCOL_VERSION } from "../contribution.js";

/** One workbook sheet: name + rows (first row is the header row). */
export interface XlsxSheet {
  name: string;
  rows: ReadonlyArray<ReadonlyArray<string | number>>;
}

/** One audit event. `at` is an ISO date/time string; sorting is lexicographic. */
export interface AuditEvent {
  at: string;
  actor: string;
  action: string;
  detail: string;
}

/**
 * Required warning text for a sensitive export (MASTER_PROMPT §19).
 * The UI dialog that shows this text lives in main.ts; this module
 * only documents the text. Never export participant data without the
 * reviewer seeing this warning first.
 */
export function sensitiveExportWarningText(kind: string): string {
  return (
    `Warning: this ${kind} export may contain sensitive participant information ` +
    `(names, dates of birth, benefit amounts). It is processed locally only and ` +
    `must not be sent outside PBGC systems. Confirm you need this export before it is written.`
  );
}

/** The warning text for the most common case (a participant-data export). */
export const SENSITIVE_EXPORT_WARNING_TEXT = sensitiveExportWarningText("participant-data");

/**
 * Sensitive-export gate. Returns false always: this function never
 * auto-approves an export. The caller (main.ts) must show
 * `sensitiveExportWarningText(kind)` in a dialog and proceed only
 * when the reviewer confirms. Returning true here would bypass the
 * §19 warning, so there is no path through this function that
 * returns true on its own.
 */
export function confirmSensitiveExport(_kind: string): boolean {
  return false;
}

// ---------------------------------------------------------------------------
// CSV (RFC 4180)
// ---------------------------------------------------------------------------

/** Quote one CSV field per RFC 4180: quote when it holds a comma,
 *  quote, CR, or LF; double inner quotes. */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** RFC 4180 CSV: quoted, escaped, CRLF line endings. */
export function buildCsv(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  if (rows.length === 0) return "";
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// XLSX — hand-built OOXML, stored ZIP (pattern: PF generator)
// ---------------------------------------------------------------------------

const XLSX_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const XLSX_NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** CRC-32 table (IEEE 802.3 polynomial), built once. */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}

function u32(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
}

function pushBytes(out: number[], bytes: Uint8Array): void {
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    out.push(...bytes.subarray(i, i + chunk));
  }
}

/**
 * Stored ZIP (method 0, no compression). Fixed DOS date 1980-01-01
 * so the same sheets always produce the same bytes.
 */
function buildZip(files: ReadonlyArray<{ name: string; data: Uint8Array }>): Uint8Array {
  const out: number[] = [];
  const central: Array<{ name: Uint8Array; crc: number; size: number; offset: number }> = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = 33; // 1980-01-01
  const encoder = new TextEncoder();
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    out.push(...[0x50, 0x4b, 0x03, 0x04], ...u16(20), ...u16(0), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(file.data.length), ...u32(file.data.length), ...u16(name.length), ...u16(0));
    pushBytes(out, name);
    pushBytes(out, file.data);
    central.push({ name, crc, size: file.data.length, offset });
    offset += 30 + name.length + file.data.length;
  }
  const cdStart = offset;
  for (const entry of central) {
    out.push(...[0x50, 0x4b, 0x01, 0x02], ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(entry.crc), ...u32(entry.size), ...u32(entry.size), ...u16(entry.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(entry.offset));
    pushBytes(out, entry.name);
    offset += 46 + entry.name.length;
  }
  const cdSize = offset - cdStart;
  out.push(...[0x50, 0x4b, 0x05, 0x06], ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(cdSize), ...u32(cdStart), ...u16(0));
  return new Uint8Array(out);
}

function escXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 1-based column number to Excel letters (1 -> A, 27 -> AA). */
function colLetter(n: number): string {
  let out = "";
  let value = n;
  while (value > 0) {
    const rem = (value - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    value = Math.trunc((value - 1) / 26);
  }
  return out;
}

/** Excel sheet name: no []:*?/\ , max 31 chars, unique in the workbook. */
function sanitizeSheetName(name: string, used: Set<string>): string {
  let clean = name.replace(/[\[\]:*?/\\]/g, "_").trim();
  if (clean === "") clean = "Sheet";
  if (clean.length > 31) clean = clean.slice(0, 31);
  let candidate = clean;
  let suffix = 2;
  while (used.has(candidate)) {
    const tail = ` (${suffix})`;
    candidate = clean.slice(0, 31 - tail.length) + tail;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

/** Number format for a column, from its header text. Money (0.00)
 *  for amount/benefit/delta columns; 4 decimals (0.0000) for factor /
 *  rate / ratio columns; general otherwise. */
function columnStyle(header: string): 0 | 2 | 3 {
  const h = header.toLowerCase();
  if (/factor|rate|ratio|\brel\b|relative|percent|%/.test(h)) return 3;
  if (/amount|benefit|delta|money|usd|\$|dollar|compensation|salary|pay/.test(h)) return 2;
  return 0;
}

function cellXml(ref: string, value: string | number, style: 0 | 1 | 2 | 3): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return `<c r="${ref}"/>`;
    const styleAttr = style === 0 ? "" : ` s="${style}"`;
    return `<c r="${ref}"${styleAttr}><v>${value}</v></c>`;
  }
  if (value === "") return `<c r="${ref}"/>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(value)}</t></is></c>`;
}

function sheetXml(rows: ReadonlyArray<ReadonlyArray<string | number>>): { xml: string; lastRow: number; lastCol: string } {
  const rowCount = rows.length;
  const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const lastCol = colLetter(Math.max(colCount, 1));
  const styles = rowCount > 0 ? (rows[0] as ReadonlyArray<string | number>).map((h) => columnStyle(typeof h === "string" ? h : "")) : [];
  const xmlRows: string[] = [];
  for (let r = 0; r < rowCount; r += 1) {
    const row = rows[r] as ReadonlyArray<string | number>;
    const cells: string[] = [];
    for (let c = 0; c < row.length; c += 1) {
      const ref = `${colLetter(c + 1)}${r + 1}`;
      const style = r === 0 ? 1 : ((styles[c] as 0 | 2 | 3 | undefined) ?? 0);
      cells.push(cellXml(ref, row[c] as string | number, style as 0 | 1 | 2 | 3));
    }
    xmlRows.push(`<row r="${r + 1}">${cells.join("")}</row>`);
  }
  const colsXml =
    colCount > 0
      ? `<cols>${Array.from({ length: colCount }, (_, i) => `<col width="18" customWidth="1" min="${i + 1}" max="${i + 1}"/>`).join("")}</cols>`
      : "";
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<worksheet xmlns="${XLSX_NS}" xmlns:r="${XLSX_NS_R}">` +
    `<dimension ref="A1:${lastCol}${Math.max(rowCount, 1)}"/>` +
    `<sheetViews><sheetView showGridLines="0" workbookViewId="0">${rowCount > 1 ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ""}<selection pane="${rowCount > 1 ? "bottomLeft" : "topLeft"}" activeCell="A1" sqref="A1"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    colsXml +
    `<sheetData>${xmlRows.join("")}</sheetData>` +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
    `<pageSetup paperSize="1" orientation="landscape" fitToWidth="1" fitToHeight="0"/>` +
    `</worksheet>`;
  return { xml, lastRow: Math.max(rowCount, 1), lastCol };
}

function stylesXml(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<styleSheet xmlns="${XLSX_NS}">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0000"/></numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><sz val="11"/><name val="Calibri"/><b/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="4">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

/**
 * Hand-built OOXML workbook (stored ZIP, deterministic, no library).
 * Sheets: reconciliation, participants, findings, dispositions at
 * minimum — the caller supplies the sheets; this builder writes
 * whatever sheets it is given. Throws when given no sheets.
 * Number formats: money 0.00, factors 0.0000 (by header text).
 */
export function buildXlsx(sheets: ReadonlyArray<XlsxSheet>): Uint8Array {
  if (sheets.length === 0) throw new Error("buildXlsx: at least one sheet is required");
  const encoder = new TextEncoder();
  const used = new Set<string>();
  const built = sheets.map((sheet) => {
    const name = sanitizeSheetName(sheet.name, used);
    const builtSheet = sheetXml(sheet.rows);
    return { name, ...builtSheet };
  });
  const workbookXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<workbook xmlns="${XLSX_NS}" xmlns:r="${XLSX_NS_R}"><sheets>` +
    built.map((s, i) => `<sheet name="${escXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
    `</sheets><definedNames>` +
    built
      .map(
        (s, i) =>
          `<definedName name="_xlnm.Print_Area" localSheetId="${i}">'${s.name.replace(/'/g, "''")}'!$A$1:$${s.lastCol}$${s.lastRow}</definedName>` +
          `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${s.name.replace(/'/g, "''")}'!$1:$1</definedName>`,
      )
      .join("") +
    `</definedNames><calcPr fullCalcOnLoad="1"/></workbook>`;
  const rels =
    built.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${built.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${built.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>`;
  const overrides = built
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("");
  const files: Array<{ name: string; data: Uint8Array }> = [
    {
      name: "[Content_Types].xml",
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          overrides +
          `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.extended-properties+xml"/></Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
      ),
    },
    { name: "xl/workbook.xml", data: encoder.encode(workbookXml) },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
      ),
    },
    { name: "xl/styles.xml", data: encoder.encode(stylesXml()) },
    {
      name: "docProps/core.xml",
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>PA_AMB Analysis export</dc:title><dc:creator>PA_AMB Analysis</dc:creator><dc:description>Generated by the PA_AMB Analysis System (contribution protocol v${CONTRIBUTION_PROTOCOL_VERSION}).</dc:description></cp:coreProperties>`,
      ),
    },
    {
      name: "docProps/app.xml",
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>PA_AMB Analysis</Application></Properties>`,
      ),
    },
  ];
  built.forEach((s, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: encoder.encode(s.xml) });
  });
  return buildZip(files);
}

// ---------------------------------------------------------------------------
// Contribution package (protocol v0.1.0)
// ---------------------------------------------------------------------------

/** Required top-level fields of a WorkProductContribution package. */
const CONTRIBUTION_REQUIRED_FIELDS = [
  "productId",
  "productVersion",
  "caseId",
  "producedAt",
  "publishedBy",
  "sourceSnapshotId",
  "status",
  "findings",
  "fragments",
  "citations",
  "warnings",
  "requiredFollowups",
  "downstreamDependencies",
] as const;

/**
 * JSON string of the protocol v0.1.0 contribution package. Validates
 * the required fields first and throws (never emits an incomplete
 * package). The package JSON carries `contributionProtocolVersion`
 * "0.1.0" alongside the package fields. Deterministic: fixed key
 * order from the input object, 2-space indent.
 */
export function buildContributionPackage(contribution: WorkProductContribution): string {
  const missing: string[] = [];
  for (const field of CONTRIBUTION_REQUIRED_FIELDS) {
    const value = (contribution as unknown as Record<string, unknown>)[field];
    if (value === null || value === undefined) missing.push(field);
    else if (typeof value === "string" && value.trim() === "") missing.push(field);
  }
  if (missing.length > 0) {
    throw new Error(`buildContributionPackage: incomplete package, missing required field(s): ${missing.join(", ")}`);
  }
  const envelope = {
    contributionProtocolVersion: CONTRIBUTION_PROTOCOL_VERSION,
    ...contribution,
  };
  return JSON.stringify(envelope, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/**
 * Plain-text audit log, chronological (sorted by `at`, stable),
 * one event per line: "at | actor | action | detail".
 */
export function buildAuditLog(events: ReadonlyArray<AuditEvent>): string {
  if (events.length === 0) return "";
  const sorted = [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return sorted.map((e) => `${e.at} | ${e.actor} | ${e.action} | ${e.detail}`).join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Downloads (browser only; no-op without a document)
// ---------------------------------------------------------------------------

/**
 * Download a file via Blob + object URL + <a download>. No-op when
 * there is no document (Node). Revokes the object URL after the click.
 */
export function downloadBlob(filename: string, data: BlobPart, mime: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download a CSV string as a file. */
export function downloadCsv(filename: string, csv: string): void {
  downloadBlob(filename, csv, "text/csv");
}

/** Download XLSX bytes as a file. */
export function downloadXlsx(filename: string, xlsx: Uint8Array): void {
  const copy = new Uint8Array(xlsx);
  downloadBlob(filename, copy.buffer as ArrayBuffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

/** Download a JSON string as a file. */
export function downloadJson(filename: string, json: string): void {
  downloadBlob(filename, json, "application/json");
}
