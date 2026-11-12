/**
 * XLSX reader — Stage 8, XLSX import.
 *
 * Pure TypeScript, no DOM, no fetch, no external package. Reads a
 * .xlsx file (a ZIP of OOXML parts) into header/row objects in the
 * same shape `parseCsv` returns, so the caller can feed them straight
 * into `mapImportedRow`.
 *
 * What it reads: workbook.xml (sheet names, in order), sharedStrings.xml
 * (shared strings), xl/styles.xml (number formats — only to tell a
 * date cell from a plain number), and each worksheet XML (rows/cells).
 *
 * Cell types: shared string (t="s"), inline string (t="inlineStr"),
 * formula-string result (t="str"), number (no t), boolean (t="b" →
 * "TRUE"/"FALSE"), blank (no value → ""). Numbers stay as decimal
 * strings; a blank is "", never zero. Formulas are never evaluated —
 * only the cached <v> is read, and a formula cell with no cached value
 * is blank with a warning naming the cell.
 *
 * Excel serial dates: a numeric cell whose style number format is a
 * date format converts to ISO YYYY-MM-DD (Excel epoch 1899-12-30).
 * Serial 60 is the fake 1900-02-29 from Excel's 1900 leap-year bug —
 * it is not a real date, so that cell is quarantined (empty string
 * plus a warning naming the cell), never invented into a date.
 *
 * Refusals (all throw an Error with a plain-language message, never a
 * partial workbook): not a ZIP, corrupt archive, encrypted entry,
 * external links (xl/externalLinks/* or <externalReferences>), a
 * workbook with no sheets, a sheet with no rows, a row with more cells
 * than headers, bad XML. Macros are never executed.
 *
 * Title rows: a sheet is expected to be a table of data. Leading
 * rows with at most one non-empty cell (plus blank rows) are skipped
 * as title rows — each skipped title row is recorded in the warnings
 * with its text — and the first row with two or more non-empty cells
 * is the header row. A sheet with no such row is refused (no header
 * row), never given a header made from a single cell.
 *
 * .xlsm: accepted read-only. A .xlsm is the same container; the macro
 * part (xl/vbaProject.bin) is ignored, never run, and recorded in the
 * warnings, and `isMacroEnabled` is true. The result always carries
 * the SHA-256 of the exact bytes read (`fileHashSha256`).
 *
 * Honest limit on that hash: a browser File is a snapshot of the file
 * at pick time, so the hash is of the bytes the app actually read.
 * There is no way to re-read the file later and compare — the file on
 * disk could change between the pick and any later check, and the
 * browser gives the app no second read of the same bytes. So the
 * Stage 2 "hash before AND after import must match" check cannot be
 * performed honestly here: there is no second, independent read to
 * compare against. The hash is recorded so the reviewer can compare
 * it against a hash taken outside the app, but no in-app before/after
 * match is claimed.
 */

import { dateFromDays } from "../dates.js";
import { sha256Hex } from "./sha256.js";
import { readZip } from "./zip.js";
import { findHeaderRow } from "./headerRows.js";

/** One sheet: headers + rows, same shape as `parseCsv` returns. */
export interface XlsxSheetData {
  name: string;
  headers: string[];
  rows: Array<Record<string, string>>;
  warnings: string[];
}

/** Parsed workbook. `warnings` holds every warning (file-level first,
 *  then per-sheet); each sheet also carries its own warnings. */
export interface XlsxParseResult {
  sheets: XlsxSheetData[];
  isMacroEnabled: boolean;
  fileHashSha256: string;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Minimal XML reader (no DOM — the app must run from file://)
// ---------------------------------------------------------------------------

interface XmlElement {
  /** Local name: the part after any namespace prefix. */
  name: string;
  attrs: Map<string, string>;
  children: XmlElement[];
  /** Direct text content (entity-decoded), not children's text. */
  text: string;
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, body: string) => {
    switch (body) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        const code = body.startsWith("#x")
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
          throw new Error(`XML is corrupt: invalid character reference "&${body};".`);
        }
        return String.fromCodePoint(code);
      }
    }
  });
}

/**
 * Parse an XML document into a small element tree. Throws an Error
 * with a plain-language message on malformed XML. Namespace prefixes
 * are stripped (only the local name is kept); attribute names keep
 * their prefix, and `attr()` matches by local name.
 */
export function parseXml(text: string): XmlElement {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let pos = 0;
  const len = src.length;

  function fail(message: string): never {
    throw new Error(`XML is corrupt: ${message}`);
  }

  function skipMisc(): void {
    for (;;) {
      if (src.startsWith("<?", pos)) {
        const end = src.indexOf("?>", pos + 2);
        if (end < 0) fail("an instruction (<? ... ?>) is never closed.");
        pos = end + 2;
      } else if (src.startsWith("<!--", pos)) {
        const end = src.indexOf("-->", pos + 4);
        if (end < 0) fail("a comment (<!-- ... -->) is never closed.");
        pos = end + 3;
      } else if (src.startsWith("<!DOCTYPE", pos) || src.startsWith("<!doctype", pos)) {
        // Skip to the closing ">", honouring an internal [ ... ] subset.
        let depth = 0;
        let i = pos;
        let closed = false;
        while (i < len) {
          const ch = src[i] as string;
          if (ch === "[") depth += 1;
          else if (ch === "]") depth -= 1;
          else if (ch === ">" && depth === 0) {
            closed = true;
            break;
          }
          i += 1;
        }
        if (!closed) fail("a DOCTYPE declaration is never closed.");
        pos = i + 1;
      } else if (src[pos] === " " || src[pos] === "\t" || src[pos] === "\n" || src[pos] === "\r") {
        pos += 1;
      } else {
        return;
      }
    }
  }

  function parseElement(): XmlElement {
    if (src[pos] !== "<") fail(`expected "<" at character ${pos + 1}.`);
    pos += 1;
    const nameStart = pos;
    while (pos < len && !/[\s/>]/.test(src[pos] as string)) pos += 1;
    const rawName = src.slice(nameStart, pos);
    if (rawName.length === 0) fail(`a tag at character ${nameStart + 1} has no name.`);
    const name = rawName.includes(":") ? (rawName.split(":").pop() as string) : rawName;
    const attrs = new Map<string, string>();
    // Attributes.
    for (;;) {
      while (pos < len && /[\s]/.test(src[pos] as string)) pos += 1;
      if (pos >= len) fail(`tag <${rawName}> is never closed.`);
      if (src.startsWith("/>", pos)) {
        pos += 2;
        return { name, attrs, children: [], text: "" };
      }
      if (src[pos] === ">") {
        pos += 1;
        break;
      }
      const attrStart = pos;
      while (pos < len && !/[\s=/>]/.test(src[pos] as string)) pos += 1;
      const attrName = src.slice(attrStart, pos);
      if (attrName.length === 0) fail(`tag <${rawName}> has a malformed attribute.`);
      while (pos < len && /[\s]/.test(src[pos] as string)) pos += 1;
      if (src[pos] !== "=") fail(`attribute ${attrName} in tag <${rawName}> has no value.`);
      pos += 1;
      while (pos < len && /[\s]/.test(src[pos] as string)) pos += 1;
      const quote = src[pos] as string;
      if (quote !== '"' && quote !== "'") fail(`attribute ${attrName} in tag <${rawName}> is not quoted.`);
      pos += 1;
      const valueStart = pos;
      const valueEnd = src.indexOf(quote, pos);
      if (valueEnd < 0) fail(`attribute ${attrName} in tag <${rawName}> is never closed.`);
      attrs.set(attrName, decodeEntities(src.slice(valueStart, valueEnd)));
      pos = valueEnd + 1;
    }
    // Children and text.
    const children: XmlElement[] = [];
    let text = "";
    for (;;) {
      if (pos >= len) fail(`element <${rawName}> is never closed.`);
      if (src.startsWith("</", pos)) {
        const closeStart = pos + 2;
        let closeEnd = closeStart;
        while (closeEnd < len && !/[\s>]/.test(src[closeEnd] as string)) closeEnd += 1;
        const closeName = src.slice(closeStart, closeEnd);
        if (closeName !== rawName) {
          fail(`closing tag </${closeName}> does not match opening tag <${rawName}>.`);
        }
        const gt = src.indexOf(">", closeEnd);
        if (gt < 0) fail(`closing tag </${closeName}> is never closed.`);
        pos = gt + 1;
        return { name, attrs, children, text };
      }
      if (src.startsWith("<![CDATA[", pos)) {
        const end = src.indexOf("]]>", pos + 9);
        if (end < 0) fail("a CDATA section is never closed.");
        text += src.slice(pos + 9, end);
        pos = end + 3;
        continue;
      }
      if (src.startsWith("<!--", pos)) {
        const end = src.indexOf("-->", pos + 4);
        if (end < 0) fail("a comment (<!-- ... -->) is never closed.");
        pos = end + 3;
        continue;
      }
      if (src.startsWith("<?", pos)) {
        const end = src.indexOf("?>", pos + 2);
        if (end < 0) fail("an instruction (<? ... ?>) is never closed.");
        pos = end + 2;
        continue;
      }
      if (src[pos] === "<") {
        children.push(parseElement());
        continue;
      }
      const next = src.indexOf("<", pos);
      const chunk = next < 0 ? src.slice(pos) : src.slice(pos, next);
      text += decodeEntities(chunk);
      pos = next < 0 ? len : next;
    }
  }

  skipMisc();
  if (pos >= len) fail("the file is empty.");
  const root = parseElement();
  skipMisc();
  if (pos < len) fail("there is content after the closing tag of the document.");
  return root;
}

/** Attribute value by local name (matches "r:id" for "id"). */
function attr(el: XmlElement, localName: string): string | undefined {
  for (const [key, value] of el.attrs) {
    const local = key.includes(":") ? (key.split(":").pop() as string) : key;
    if (local === localName) return value;
  }
  return undefined;
}

function children(el: XmlElement, localName: string): XmlElement[] {
  return el.children.filter((c) => c.name === localName);
}

function firstChild(el: XmlElement, localName: string): XmlElement | undefined {
  return el.children.find((c) => c.name === localName);
}

/** All descendant <t> texts concatenated (shared strings, rich text). */
function descendantText(el: XmlElement, localName: string): string {
  let out = "";
  for (const child of el.children) {
    if (child.name === localName) out += child.text;
    out += descendantText(child, localName);
  }
  return out;
}

function xmlText(bytes: Uint8Array, partName: string): XmlElement {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`XLSX import refused: part "${partName}" is not valid UTF-8 text.`);
  }
  try {
    return parseXml(text);
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`XLSX import refused: part "${partName}" has bad XML — ${err.message}`);
    }
    throw new Error(`XLSX import refused: part "${partName}" has bad XML.`);
  }
}

// ---------------------------------------------------------------------------
// Styles: which number formats are dates
// ---------------------------------------------------------------------------

/** Built-in Excel number-format ids that are dates/times (ECMA-376). */
const BUILTIN_DATE_FMT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 57,
]);

/**
 * A custom format code is a date format when, after removing quoted
 * text ("...") and bracketed sections ([Red], [$-409], ...), it still
 * holds a date/time letter (y, m, d, h, s). "General", "0.00", "#,##0"
 * and "@" (text) hold none, so they are not dates.
 */
function formatCodeIsDate(formatCode: string): boolean {
  const stripped = formatCode
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "");
  return /[ymdhs]/i.test(stripped);
}

interface StyleInfo {
  /** numFmtId per cellXfs entry (index = style index s=""). */
  cellXfs: number[];
  /** Custom numFmtId -> format code. */
  customFormats: Map<number, string>;
}

function parseStyles(root: XmlElement | undefined): StyleInfo {
  const info: StyleInfo = { cellXfs: [], customFormats: new Map() };
  if (root === undefined) return info;
  const numFmts = firstChild(root, "numFmts");
  if (numFmts !== undefined) {
    for (const fmt of children(numFmts, "numFmt")) {
      const id = attr(fmt, "numFmtId");
      const code = attr(fmt, "formatCode");
      if (id !== undefined && code !== undefined) {
        const n = Number(id);
        if (Number.isInteger(n)) info.customFormats.set(n, code);
      }
    }
  }
  const cellXfs = firstChild(root, "cellXfs");
  if (cellXfs !== undefined) {
    for (const xf of children(cellXfs, "xf")) {
      const id = attr(xf, "numFmtId");
      info.cellXfs.push(id === undefined ? 0 : Number(id) || 0);
    }
  }
  return info;
}

function styleIsDate(info: StyleInfo, styleIndex: number | undefined): boolean {
  if (styleIndex === undefined) return false;
  const fmtId = info.cellXfs[styleIndex];
  if (fmtId === undefined) return false;
  if (BUILTIN_DATE_FMT_IDS.has(fmtId)) return true;
  const code = info.customFormats.get(fmtId);
  return code !== undefined && formatCodeIsDate(code);
}

// ---------------------------------------------------------------------------
// Excel serial dates
// ---------------------------------------------------------------------------

/** Excel serial 1 is 1900-01-01; the Excel epoch is 1899-12-30, which
 *  is 25,569 days before the Unix epoch (1970-01-01). */
const EXCEL_EPOCH_OFFSET_DAYS = 25569;

/**
 * Convert an Excel serial to ISO YYYY-MM-DD. Returns "" (with a
 * warning) when the serial is not a real date: serial 60 is the fake
 * 1900-02-29, serials below 1 have no date, and a fractional part
 * (a time of day) is dropped with a warning — the value is a date
 * cell, so the time is not invented into the date.
 */
function serialToIso(serial: number, cellRef: string, warnings: string[]): string {
  if (serial === 60) {
    warnings.push(
      `Sheet cell ${cellRef}: the value is Excel serial 60, the fake date 1900-02-29 (Excel's 1900 leap-year bug) — it is not a real date, so the cell is left blank.`,
    );
    return "";
  }
  if (!(serial >= 1)) {
    warnings.push(
      `Sheet cell ${cellRef}: the date value ${serial} is not a valid Excel serial date, so the cell is left blank.`,
    );
    return "";
  }
  const whole = Math.floor(serial);
  if (serial !== whole) {
    warnings.push(
      `Sheet cell ${cellRef}: the date value ${serial} holds a time of day as well as a date; only the date is kept.`,
    );
  }
  try {
    return dateFromDays(whole - EXCEL_EPOCH_OFFSET_DAYS);
  } catch {
    warnings.push(
      `Sheet cell ${cellRef}: the date value ${serial} is outside the supported date range, so the cell is left blank.`,
    );
    return "";
  }
}

// ---------------------------------------------------------------------------
// Worksheet cells
// ---------------------------------------------------------------------------

const NUMBER_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

/** Column letters to a 0-based index: A -> 0, Z -> 25, AA -> 26. */
function columnIndex(letters: string): number {
  let index = 0;
  for (const ch of letters) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

function parseCellRef(ref: string): { col: number; row: number } | null {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (match === null) return null;
  return { col: columnIndex(match[1] as string), row: Number(match[2]) };
}

/**
 * One cell's value as a string. `warnings` collects plain-language
 * notes naming the cell. A blank is "".
 */
function cellValue(
  cell: XmlElement,
  ref: string,
  sharedStrings: readonly string[],
  styles: StyleInfo,
  warnings: string[],
): string {
  const type = attr(cell, "t");
  const valueEl = firstChild(cell, "v");
  const styleAttr = attr(cell, "s");
  const styleIndex = styleAttr === undefined ? undefined : Number(styleAttr);
  const hasFormula = firstChild(cell, "f") !== undefined;

  if (type === "s") {
    if (valueEl === undefined) return "";
    const index = Number(valueEl.text.trim());
    if (!Number.isInteger(index) || index < 0 || index >= sharedStrings.length) {
      warnings.push(`Sheet cell ${ref}: the shared-string index "${valueEl.text.trim()}" does not exist, so the cell is left blank.`);
      return "";
    }
    return (sharedStrings[index] as string).trim();
  }
  if (type === "inlineStr") {
    const is = firstChild(cell, "is");
    if (is === undefined) return "";
    return descendantText(is, "t").trim();
  }
  if (type === "str") {
    if (valueEl === undefined) {
      if (hasFormula) {
        warnings.push(`Sheet cell ${ref}: the formula has no saved value, so the cell is left blank.`);
      }
      return "";
    }
    return valueEl.text.trim();
  }
  if (type === "b") {
    if (valueEl === undefined) return "";
    const raw = valueEl.text.trim();
    if (raw === "1" || raw.toLowerCase() === "true") return "TRUE";
    if (raw === "0" || raw.toLowerCase() === "false") return "FALSE";
    warnings.push(`Sheet cell ${ref}: the boolean value "${raw}" is not 0 or 1, so the cell is left blank.`);
    return "";
  }
  if (type === "e") {
    warnings.push(`Sheet cell ${ref}: the cell holds an error value, so it is left blank.`);
    return "";
  }
  if (type === "d") {
    if (valueEl === undefined) return "";
    const raw = valueEl.text.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    warnings.push(`Sheet cell ${ref}: the date value "${raw}" is not an ISO date, so the cell is left blank.`);
    return "";
  }
  // Number (no t) or unknown t.
  if (type !== undefined && type !== "n") {
    warnings.push(`Sheet cell ${ref}: the cell type "${type}" is not understood, so the cell is left blank.`);
    return "";
  }
  if (valueEl === undefined) {
    if (hasFormula) {
      warnings.push(`Sheet cell ${ref}: the formula has no saved value, so the cell is left blank.`);
    }
    return "";
  }
  const raw = valueEl.text.trim();
  if (!NUMBER_RE.test(raw)) {
    warnings.push(`Sheet cell ${ref}: the number value "${raw}" is not a number, so the cell is left blank.`);
    return "";
  }
  if (styleIndex !== undefined && styleIsDate(styles, styleIndex)) {
    return serialToIso(Number(raw), ref, warnings);
  }
  return raw;
}

/** Parse one worksheet into headers + row objects. */
function parseSheet(
  name: string,
  root: XmlElement,
  sharedStrings: readonly string[],
  styles: StyleInfo,
): XlsxSheetData {
  const warnings: string[] = [];
  const sheetData = firstChild(root, "sheetData");
  if (sheetData === undefined) {
    throw new Error(`XLSX import refused: sheet "${name}" has no rows (no sheet data).`);
  }
  // Row number -> column index -> value.
  const grid = new Map<number, Map<number, string>>();
  let fallbackRow = 0;
  for (const rowEl of children(sheetData, "row")) {
    fallbackRow += 1;
    const rowAttr = attr(rowEl, "r");
    const rowNum = rowAttr === undefined ? fallbackRow : Number(rowAttr);
    if (!Number.isInteger(rowNum) || rowNum < 1) {
      throw new Error(`XLSX import refused: sheet "${name}" has a row with no valid row number.`);
    }
    const cells = new Map<number, string>();
    let fallbackCol = 0;
    for (const cell of children(rowEl, "c")) {
      const ref = attr(cell, "r");
      let col: number;
      let refText: string;
      if (ref === undefined) {
        col = fallbackCol;
        refText = `row ${rowNum} column ${col + 1}`;
      } else {
        const parsed = parseCellRef(ref);
        if (parsed === null) {
          throw new Error(`XLSX import refused: sheet "${name}" has a cell with a bad reference "${ref}".`);
        }
        col = parsed.col;
        refText = ref;
      }
      fallbackCol = col + 1;
      const value = cellValue(cell, refText, sharedStrings, styles, warnings);
      cells.set(col, value);
    }
    grid.set(rowNum, cells);
  }
  const rowNums = [...grid.keys()].sort((a, b) => a - b);
  // Header row: the user said to skip row one and use row two as the
  // headers, assuming the sheet is a table of data. Generalised to
  // skip every leading row with at most one non-empty cell (a title
  // row) plus blank rows, until the first row with two or more
  // non-empty cells; that row is the header. Each skipped title row
  // is recorded in the warnings, never dropped silently. The rule
  // itself lives in src/ui/headerRows.ts, shared with the CSV parser.
  const rowCellsList: string[][] = rowNums.map((rowNum) => {
    const cells = grid.get(rowNum) as Map<number, string>;
    const maxCol = Math.max(-1, ...cells.keys());
    const rowCells: string[] = [];
    for (let c = 0; c <= maxCol; c += 1) rowCells.push((cells.get(c) ?? "").trim());
    while (rowCells.length > 0 && rowCells[rowCells.length - 1] === "") rowCells.pop();
    return rowCells;
  });
  const found = findHeaderRow(rowCellsList);
  for (const skipped of found.skipped) {
    warnings.push(
      `Sheet "${name}": row ${rowNums[skipped.index] as number} "${skipped.text}" skipped — title row, not the header row.`,
    );
  }
  let headerRowNum: number | undefined;
  let headers: string[] = [];
  if (found.headerIndex !== undefined) {
    headerRowNum = rowNums[found.headerIndex] as number;
    headers = rowCellsList[found.headerIndex] as string[];
  }
  if (headerRowNum === undefined) {
    throw new Error(
      `XLSX import refused: sheet "${name}" has no header row — no rows hold two or more cells. The sheet is expected to be a table of data.`,
    );
  }
  for (let i = 0; i < headers.length; i += 1) {
    if ((headers[i] as string) === "") {
      throw new Error(`XLSX import refused: sheet "${name}" has a blank column name in its header row.`);
    }
  }
  const seenHeaders = new Set<string>();
  for (const h of headers) {
    if (seenHeaders.has(h)) {
      warnings.push(`Sheet "${name}": the header "${h}" appears more than once; later columns with the same name overwrite earlier ones in a row.`);
    }
    seenHeaders.add(h);
  }
  const rows: Array<Record<string, string>> = [];
  for (const rowNum of rowNums) {
    if (rowNum <= (headerRowNum as number)) continue;
    const cells = grid.get(rowNum) as Map<number, string>;
    const maxCol = Math.max(-1, ...cells.keys());
    const rowCells: string[] = [];
    for (let c = 0; c <= maxCol; c += 1) rowCells.push((cells.get(c) ?? "").trim());
    while (rowCells.length > 0 && rowCells[rowCells.length - 1] === "") rowCells.pop();
    if (rowCells.length === 0) continue; // Completely empty row: skipped.
    if (rowCells.length > headers.length) {
      throw new Error(
        `XLSX import refused: sheet "${name}" row ${rowNum} has ${rowCells.length} cells, more than the ${headers.length} header columns.`,
      );
    }
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = rowCells[i] ?? "";
    });
    rows.push(row);
  }
  return { name, headers, rows, warnings };
}

// ---------------------------------------------------------------------------
// Workbook assembly
// ---------------------------------------------------------------------------

/** Normalise a ZIP entry name (strip a leading "/"). */
function entryName(name: string): string {
  return name.startsWith("/") ? name.slice(1) : name;
}

/** Resolve a workbook relationship target to a ZIP entry name. */
function resolveTarget(target: string): string {
  let t = target.trim();
  while (t.startsWith("/")) t = t.slice(1);
  if (t.startsWith("xl/")) return t;
  return `xl/${t}`;
}

/**
 * Parse an .xlsx (or read-only .xlsm) file into sheets of header/row
 * objects. Throws an Error with a plain-language message on any
 * refusal; never returns a partial workbook.
 */
export function parseXlsx(bytes: Uint8Array): XlsxParseResult {
  const fileHashSha256 = sha256Hex(bytes);
  const fileWarnings: string[] = [];
  let entries;
  try {
    entries = readZip(bytes);
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`XLSX import refused: ${err.message}`);
    }
    throw new Error("XLSX import refused: the file could not be read as a ZIP archive.");
  }
  const byName = new Map<string, Uint8Array>();
  for (const entry of entries) byName.set(entryName(entry.name), entry.data);

  const isMacroEnabled = byName.has("xl/vbaProject.bin");
  if (isMacroEnabled) {
    fileWarnings.push(
      "This file is macro-enabled (.xlsm): it holds macros (xl/vbaProject.bin). The macros are ignored and never run; only the sheets are read. " +
        `The file hash (SHA-256) is of the exact bytes read; a browser file is a snapshot, so the hash cannot be re-checked by re-reading the file after import.`,
    );
  }
  if ([...byName.keys()].some((n) => n.startsWith("xl/externalLinks/"))) {
    throw new Error(
      "XLSX import refused: the workbook links to an external workbook (xl/externalLinks). External links are refused — only the values in this file can be trusted.",
    );
  }
  const workbookBytes = byName.get("xl/workbook.xml");
  if (workbookBytes === undefined) {
    throw new Error('XLSX import refused: the file has no workbook part ("xl/workbook.xml").');
  }
  const workbookRoot = xmlText(workbookBytes, "xl/workbook.xml");
  if (
    firstChild(workbookRoot, "externalReferences") !== undefined ||
    children(workbookRoot, "externalReference").length > 0
  ) {
    throw new Error(
      "XLSX import refused: the workbook links to an external workbook (external references). External links are refused — only the values in this file can be trusted.",
    );
  }
  const sheetsEl = firstChild(workbookRoot, "sheets");
  const sheetEls = sheetsEl === undefined ? [] : children(sheetsEl, "sheet");
  if (sheetEls.length === 0) {
    throw new Error("XLSX import refused: the workbook has no sheets.");
  }

  // Shared strings (optional: some workbooks have none).
  let sharedStrings: string[] = [];
  const sharedBytes = byName.get("xl/sharedStrings.xml");
  if (sharedBytes !== undefined) {
    const sharedRoot = xmlText(sharedBytes, "xl/sharedStrings.xml");
    sharedStrings = children(sharedRoot, "si").map((si) => descendantText(si, "t"));
  }

  // Styles (optional).
  const stylesBytes = byName.get("xl/styles.xml");
  const styles = parseStyles(stylesBytes === undefined ? undefined : xmlText(stylesBytes, "xl/styles.xml"));

  // Workbook relationships: r:id -> target part.
  const relTargets = new Map<string, string>();
  const relsBytes = byName.get("xl/_rels/workbook.xml.rels");
  if (relsBytes !== undefined) {
    const relsRoot = xmlText(relsBytes, "xl/_rels/workbook.xml.rels");
    for (const rel of children(relsRoot, "Relationship")) {
      const id = attr(rel, "Id");
      const target = attr(rel, "Target");
      if (id !== undefined && target !== undefined) relTargets.set(id, target);
    }
  }

  const sheets: XlsxSheetData[] = [];
  const allWarnings: string[] = [...fileWarnings];
  sheetEls.forEach((sheetEl, index) => {
    const name = attr(sheetEl, "name");
    if (name === undefined || name === "") {
      throw new Error(`XLSX import refused: sheet ${index + 1} has no name.`);
    }
    const relId = attr(sheetEl, "id");
    let partName: string | undefined;
    if (relId !== undefined) {
      const target = relTargets.get(relId);
      if (target !== undefined) partName = resolveTarget(target);
    }
    if (partName === undefined) {
      partName = `xl/worksheets/sheet${index + 1}.xml`;
    }
    const sheetBytes = byName.get(partName);
    if (sheetBytes === undefined) {
      throw new Error(`XLSX import refused: sheet "${name}" (part "${partName}") is missing from the file.`);
    }
    const sheetRoot = xmlText(sheetBytes, partName);
    const sheet = parseSheet(name, sheetRoot, sharedStrings, styles);
    sheets.push(sheet);
    allWarnings.push(...sheet.warnings);
  });

  return { sheets, isMacroEnabled, fileHashSha256, warnings: allWarnings };
}
