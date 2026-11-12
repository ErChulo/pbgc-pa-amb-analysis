/**
 * XLSX reader tests — Stage 8 (inflate + ZIP + SHA-256 + XLSX reader).
 *
 * Synthetic data only, except for two read-only real Excel-produced
 * fixtures already in the workspace (the PBGC rates calculator and
 * the DOPT listing report), used for structure only — no participant
 * assertions. Node's zlib is a test-only tool for building known
 * DEFLATE vectors; it is never in the app.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, constants as zlibConstants } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflate } from "../src/ui/inflate.js";
import { readZip } from "../src/ui/zip.js";
import type { ZipEntry } from "../src/ui/zip.js";
import { sha256Hex } from "../src/ui/sha256.js";
import { parseXlsx } from "../src/ui/xlsxReader.js";
import { buildXlsx, crc32 } from "../src/ui/exports.js";
import { mapImportedRow } from "../src/ui/import.js";

const encoder = new TextEncoder();
const PREDICATES_XLSX = join(process.cwd(), "..", "pbgc_review", "pa-amb", "BCV-DataValidation-predicates.xlsx");
const DOPT_LISTING_XLSX = join(process.cwd(), "..", "pbgc_review", "sample-dopt-listing-report.xlsx");
const APP_XLSX = join(process.cwd(), "stage7", "runs", "browser-A", "reconciliation.xlsx");

// ---------------------------------------------------------------------------
// Test-only ZIP builder (stored entries; deflated via Node zlib)
// ---------------------------------------------------------------------------

function u16(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}

function u32(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
}

interface TestZipEntry {
  name: string;
  data: Uint8Array;
  method?: 0 | 8 | number;
  flags?: number;
  crcOverride?: number;
}

/** Minimal stored/deflated ZIP, fixed 1980-01-01 timestamps. */
function makeZip(entries: TestZipEntry[]): Uint8Array {
  const out: number[] = [];
  const central: Array<{ name: Uint8Array; crc: number; compSize: number; size: number; offset: number; method: number; flags: number }> = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const method = entry.method ?? 0;
    const flags = entry.flags ?? 0;
    const crc = entry.crcOverride ?? crc32(entry.data);
    const stored = method === 8 ? deflateRawSync(entry.data) : entry.data;
    out.push(
      ...[0x50, 0x4b, 0x03, 0x04], ...u16(20), ...u16(flags), ...u16(method),
      ...u16(0), ...u16(33), ...u32(crc), ...u32(stored.length), ...u32(entry.data.length),
      ...u16(name.length), ...u16(0),
    );
    out.push(...name, ...stored);
    central.push({ name, crc, compSize: stored.length, size: entry.data.length, offset, method, flags });
    offset += 30 + name.length + stored.length;
  }
  const cdStart = offset;
  for (const entry of central) {
    out.push(
      ...[0x50, 0x4b, 0x01, 0x02], ...u16(20), ...u16(20), ...u16(entry.flags), ...u16(entry.method),
      ...u16(0), ...u16(33), ...u32(entry.crc), ...u32(entry.compSize), ...u32(entry.size),
      ...u16(entry.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(entry.offset),
    );
    out.push(...entry.name);
    offset += 46 + entry.name.length;
  }
  const cdSize = offset - cdStart;
  out.push(...[0x50, 0x4b, 0x05, 0x06], ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length), ...u32(cdSize), ...u32(cdStart), ...u16(0));
  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// Inflate
// ---------------------------------------------------------------------------

describe("inflate (RFC 1951)", () => {
  const sample = encoder.encode(
    "The quick brown fox jumps over the lazy dog. ".repeat(20) +
      "Pack my box with five dozen liquor jugs! 0123456789",
  );

  it("decodes a stored block (level 0)", () => {
    assert.deepEqual(inflate(deflateRawSync(sample, { level: 0 })), sample);
  });

  it("decodes a fixed Huffman block", () => {
    const compressed = deflateRawSync(sample, { level: 6, strategy: zlibConstants.Z_FIXED });
    assert.ok(compressed.length < sample.length);
    assert.deepEqual(inflate(compressed), sample);
  });

  it("decodes a dynamic Huffman block", () => {
    assert.deepEqual(inflate(deflateRawSync(sample, { level: 6 })), sample);
  });

  it("decodes a tiny input and an empty stored stream", () => {
    assert.deepEqual(inflate(deflateRawSync(encoder.encode("x"))), encoder.encode("x"));
    // A stored block holding zero bytes: final bit + type 00, LEN 0.
    assert.deepEqual(inflate(new Uint8Array([0x01, 0x00, 0x00, 0xff, 0xff])), new Uint8Array(0));
  });

  it("refuses an empty stream", () => {
    assert.throws(() => inflate(new Uint8Array(0)), /empty/);
  });

  it("refuses a truncated stream", () => {
    const compressed = deflateRawSync(sample, { level: 6 });
    assert.throws(() => inflate(compressed.subarray(0, compressed.length - 1)), /truncated/);
    assert.throws(() => inflate(compressed.subarray(0, 2)), /truncated|corrupt/);
  });

  it("refuses an invalid block type", () => {
    // BFINAL=1, BTYPE=11 (reserved).
    assert.throws(() => inflate(new Uint8Array([0x07])), /invalid block type/);
  });

  it("refuses a stored block whose length check fails", () => {
    // Final stored block, LEN=1, NLEN=0 (must be ~LEN).
    assert.throws(() => inflate(new Uint8Array([0x01, 0x01, 0x00, 0x00, 0x00, 0x41])), /length check/);
  });

  it("refuses a stream with flipped payload bits", () => {
    const compressed = deflateRawSync(sample, { level: 6 });
    const bad = new Uint8Array(compressed);
    bad[bad.length - 2] = (bad[bad.length - 2] as number) ^ 0xff;
    assert.throws(() => inflate(bad), /truncated|corrupt|invalid/);
  });
});

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

describe("readZip (PKZIP)", () => {
  it("reads stored and deflated entries with names, sizes, and data", () => {
    const entries = readZip(
      makeZip([
        { name: "hello.txt", data: encoder.encode("hello world"), method: 0 },
        { name: "dir/data.bin", data: encoder.encode("x".repeat(500)), method: 8 },
      ]),
    );
    assert.equal(entries.length, 2);
    const first = entries[0] as ZipEntry;
    assert.equal(first.name, "hello.txt");
    assert.equal(first.method, 0);
    assert.equal(first.size, 11);
    assert.deepEqual(first.data, encoder.encode("hello world"));
    const second = entries[1] as ZipEntry;
    assert.equal(second.name, "dir/data.bin");
    assert.equal(second.method, 8);
    assert.equal(second.compressedSize < second.size, true);
    assert.deepEqual(second.data, encoder.encode("x".repeat(500)));
  });

  it("refuses a file that is not a ZIP", () => {
    assert.throws(() => readZip(encoder.encode("this is just text, not a zip")), /not a ZIP/);
    assert.throws(() => readZip(new Uint8Array(0)), /not a ZIP|too short/);
  });

  it("refuses a CRC mismatch", () => {
    const good = makeZip([{ name: "a.txt", data: encoder.encode("abcdef"), method: 0 }]);
    const bad = new Uint8Array(good);
    // The stored payload starts after the 30-byte local header + name.
    const payloadAt = 30 + "a.txt".length;
    bad[payloadAt] = (bad[payloadAt] as number) ^ 0xff;
    assert.throws(() => readZip(bad), /CRC-32/);
  });

  it("refuses an encrypted entry", () => {
    assert.throws(
      () => readZip(makeZip([{ name: "secret.txt", data: encoder.encode("x"), flags: 0x01 }])),
      /encrypted/,
    );
  });

  it("refuses an unsupported compression method", () => {
    assert.throws(
      () => readZip(makeZip([{ name: "bzip.txt", data: encoder.encode("x"), method: 12 }])),
      /method 12/,
    );
  });

  it("refuses a truncated archive", () => {
    const full = makeZip([{ name: "a.txt", data: encoder.encode("abcdef"), method: 0 }]);
    assert.throws(() => readZip(full.subarray(0, full.length - 10)), /truncated|not a ZIP|corrupt/);
  });
});

// ---------------------------------------------------------------------------
// SHA-256
// ---------------------------------------------------------------------------

describe("sha256Hex", () => {
  it("matches the empty-string vector", () => {
    assert.equal(
      sha256Hex(new Uint8Array(0)),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the 'abc' vector", () => {
    assert.equal(
      sha256Hex(encoder.encode("abc")),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches the 56-byte FIPS vector", () => {
    assert.equal(
      sha256Hex(encoder.encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("matches the million-'a' vector (multi-block)", () => {
    assert.equal(
      sha256Hex(encoder.encode("a".repeat(1000000))),
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });

  it("returns lowercase hex of length 64", () => {
    const hex = sha256Hex(encoder.encode("PA_AMB"));
    assert.equal(hex.length, 64);
    assert.match(hex, /^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// XLSX — hand-built workbook helper (stored ZIP, exact XML parts)
// ---------------------------------------------------------------------------

const XLSX_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function xlsxParts(parts: Record<string, string>): Uint8Array {
  const entries: TestZipEntry[] = Object.entries(parts).map(([name, xml]) => ({
    name,
    data: encoder.encode(xml),
    method: 0 as const,
  }));
  return makeZip(entries);
}

function standardXlsx(sheetXml: string, extra: Record<string, string> = {}): Uint8Array {
  return xlsxParts({
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<workbook xmlns="${XLSX_NS}"><sheets><sheet name="Census" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/styles.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<styleSheet xmlns="${XLSX_NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="mm/dd/yyyy"/></numFmts>` +
      `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    "xl/sharedStrings.xml":
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<sst xmlns="${XLSX_NS}" count="2" uniqueCount="2"><si><t>SYN-A</t></si><si><t>SYN-B</t></si></sst>`,
    "xl/worksheets/sheet1.xml": sheetXml,
    ...extra,
  });
}

describe("parseXlsx — hand-built workbook (dates, types, serial 60)", () => {
  const sheetXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<worksheet xmlns="${XLSX_NS}"><sheetData>` +
    `<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>DOB</t></is></c><c r="C1" t="inlineStr"><is><t>Amount</t></is></c><c r="D1" t="inlineStr"><is><t>Active</t></is></c><c r="E1" t="inlineStr"><is><t>Note</t></is></c></row>` +
    // Shared string, date serial 44927 = 2023-01-01, number, boolean, blank.
    `<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" s="1"><v>44927</v></c><c r="C2"><v>123.5</v></c><c r="D2" t="b"><v>1</v></c><c r="E2"/></row>` +
    // Serial 60 (fake 1900-02-29) is quarantined; fractional serial keeps the date.
    `<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" s="1"><v>60</v></c><c r="C3"><v>0</v></c><c r="D3" t="b"><v>0</v></c><c r="E3" t="inlineStr"><is><t>serial sixty</t></is></c></row>` +
    `<row r="4"><c r="A4" t="inlineStr"><is><t>Third</t></is></c><c r="B4" s="1"><v>44927.5</v></c><c r="C4"><v>-42</v></c><c r="D4" t="b"><v>0</v></c><c r="E4"/></row>` +
    `<row r="5"></row>` +
    // Ragged row (fewer cells) is padded with "".
    `<row r="6"><c r="A6" t="inlineStr"><is><t>Short</t></is></c><c r="B6" s="1"><v>45658</v></c></row>` +
    `</sheetData></worksheet>`;

  it("parses shared strings, dates, numbers, booleans, and blanks", () => {
    const result = parseXlsx(standardXlsx(sheetXml));
    assert.equal(result.isMacroEnabled, false);
    assert.equal(result.fileHashSha256, sha256Hex(standardXlsx(sheetXml)));
    assert.equal(result.sheets.length, 1);
    const sheet = result.sheets[0] as NonNullable<(typeof result.sheets)[number]>;
    assert.equal(sheet.name, "Census");
    assert.deepEqual(sheet.headers, ["Name", "DOB", "Amount", "Active", "Note"]);
    assert.equal(sheet.rows.length, 4); // Empty row 5 is skipped.
    assert.deepEqual(sheet.rows[0], {
      Name: "SYN-A",
      DOB: "2023-01-01",
      Amount: "123.5",
      Active: "TRUE",
      Note: "",
    });
    assert.equal(sheet.rows[1]?.["DOB"], ""); // Serial 60 quarantined.
    assert.equal(sheet.rows[1]?.["Active"], "FALSE");
    assert.equal(sheet.rows[2]?.["DOB"], "2023-01-01"); // Fractional serial: date kept.
    assert.equal(sheet.rows[2]?.["Amount"], "-42");
    assert.deepEqual(sheet.rows[3], {
      Name: "Short",
      DOB: "2025-01-01",
      Amount: "",
      Active: "",
      Note: "",
    });
  });

  it("warns by cell for serial 60 and for a dropped time of day", () => {
    const result = parseXlsx(standardXlsx(sheetXml));
    const sheet = result.sheets[0] as NonNullable<(typeof result.sheets)[number]>;
    assert.ok(sheet.warnings.some((w) => /B3/.test(w) && /60/.test(w)));
    assert.ok(sheet.warnings.some((w) => /B4/.test(w) && /time of day/.test(w)));
    assert.ok(result.warnings.some((w) => /B3/.test(w)));
  });

  it("refuses a row with more cells than headers, naming the row", () => {
    const wide =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<worksheet xmlns="${XLSX_NS}"><sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>A</t></is></c><c r="B1" t="inlineStr"><is><t>B</t></is></c></row>` +
      `<row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>2</v></c><c r="C2"><v>3</v></c></row>` +
      `</sheetData></worksheet>`;
    assert.throws(() => parseXlsx(standardXlsx(wide)), /row 2.*3 cells|more than the 2 header/);
  });

  it("reads a formula's cached value and blanks a formula with none", () => {
    const formulas =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<worksheet xmlns="${XLSX_NS}"><sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>Total</t></is></c><c r="B1" t="inlineStr"><is><t>Missing</t></is></c></row>` +
      `<row r="2"><c r="A2"><f>SUM(C1:C9)</f><v>99</v></c><c r="B2"><f>NOW()</f></c></row>` +
      `</sheetData></worksheet>`;
    const result = parseXlsx(standardXlsx(formulas));
    const sheet = result.sheets[0] as NonNullable<(typeof result.sheets)[number]>;
    assert.equal(sheet.rows[0]?.["Total"], "99");
    assert.equal(sheet.rows[0]?.["Missing"], "");
    assert.ok(sheet.warnings.some((w) => /B2/.test(w) && /no saved value/.test(w)));
  });

  it("accepts .xlsm read-only: macros ignored, hash recorded, warned", () => {
    const bytes = standardXlsx(sheetXml, {
      "xl/vbaProject.bin": "\u0000macro bytes are never run\u0000",
    });
    const result = parseXlsx(bytes);
    assert.equal(result.isMacroEnabled, true);
    assert.equal(result.sheets.length, 1);
    assert.ok(result.warnings.some((w) => /macro/i.test(w) && /never run/.test(w)));
    assert.ok(result.warnings.some((w) => /snapshot/.test(w)));
  });
});

describe("parseXlsx — round-trip through the app's own buildXlsx", () => {
  it("writes a census-shaped workbook and reads back identical values", () => {
    const bytes = buildXlsx([
      {
        name: "Census",
        rows: [
          ["participantKey", "dopt", "paAmbMinor", "salary_2020", "dob", "dote"],
          ["SYN-001", "2023-09-30", 150000, 6000000, "1960-05-15", "2023-09-30"],
          ["SYN-002", "2023-09-30", 0, "", "1975-11-02", ""],
          ["SYN-003", "2023-09-30", 84950, 4200000, "1980-01-31", "2023-09-30"],
        ],
      },
    ]);
    const result = parseXlsx(bytes);
    assert.equal(result.isMacroEnabled, false);
    assert.equal(result.fileHashSha256.length, 64);
    assert.deepEqual(result.sheets[0]?.headers, [
      "participantKey",
      "dopt",
      "paAmbMinor",
      "salary_2020",
      "dob",
      "dote",
    ]);
    assert.deepEqual(result.sheets[0]?.rows, [
      {
        participantKey: "SYN-001",
        dopt: "2023-09-30",
        paAmbMinor: "150000",
        salary_2020: "6000000",
        dob: "1960-05-15",
        dote: "2023-09-30",
      },
      {
        participantKey: "SYN-002",
        dopt: "2023-09-30",
        paAmbMinor: "0",
        salary_2020: "",
        dob: "1975-11-02",
        dote: "",
      },
      {
        participantKey: "SYN-003",
        dopt: "2023-09-30",
        paAmbMinor: "84950",
        salary_2020: "4200000",
        dob: "1980-01-31",
        dote: "2023-09-30",
      },
    ]);
    // The rows feed straight into mapImportedRow (Worker B's handoff).
    const mapped = mapImportedRow(result.sheets[0]?.rows[0] as Record<string, string>);
    assert.equal(mapped.key, "SYN-001");
    assert.equal(mapped.paAmbMinor, 150000);
    assert.equal(mapped.dob, "1960-05-15");
    assert.equal(mapped.salaries[0]?.minor, 6000000);
  });
});

describe("parseXlsx — real Excel-produced fixtures (structure only)", () => {
  it("parses a real Excel-produced workbook: sheet name, headers, values", () => {
    const result = parseXlsx(readFileSync(PREDICATES_XLSX));
    assert.equal(result.sheets.length, 1);
    assert.equal(result.sheets[0]?.name, "Sheet 1");
    assert.equal(result.isMacroEnabled, false);
    const sheet = result.sheets[0] as NonNullable<(typeof result.sheets)[number]>;
    assert.deepEqual(sheet.headers.slice(0, 6), [
      "DATA_VLDTN_ID",
      "DATA_VLDTN_TYPE",
      "ENABLE_FL",
      "DATA_VLDTN_SQL_TYPE",
      "DATA_VLDTN_SQL",
      "DATA_VLDTN_REPORT_SQL",
    ]);
    assert.equal(sheet.rows.length, 249);
    // Numbers stay decimal strings; shared strings resolve; blanks stay "".
    assert.equal(sheet.rows[0]?.["DATA_VLDTN_ID"], "200");
    assert.equal(sheet.rows[0]?.["DATA_VLDTN_TYPE"], "3");
    assert.equal(sheet.rows[0]?.["ENABLE_FL"], "Y");
    assert.ok((sheet.rows[0]?.["DATA_VLDTN_REPORT_SQL"] as string).startsWith("INSERT INTO"));
    assert.equal(sheet.rows[0]?.[sheet.headers[8] as string], "");
  });

  it("refuses the PBGC rates calculator: the title row is skipped, the header is row 2, and row 3 is wider", () => {
    // Row 1 is a one-cell title ("PBGC R5 Header Rates Calculator —
    // Inputs"), so it is skipped and row 2 ("Version", "1.1.2", ...) is
    // the header (3 columns). Row 3 then has 4 cells — the unchanged
    // ragged-row refusal, naming the row.
    const rates = join(process.cwd(), "..", "pbgc_review", "bcv", "pbgc-rates-r5-header-v1.1.2.xlsx");
    assert.throws(() => parseXlsx(readFileSync(rates)), /row 3.*more than the 3 header/);
  });

  it("parses the app-produced reconciliation workbook", () => {
    const result = parseXlsx(readFileSync(APP_XLSX));
    assert.equal(result.sheets.length, 1);
    assert.equal(result.sheets[0]?.name, "Reconciliation");
    assert.ok((result.sheets[0]?.headers.length as number) > 0);
    assert.ok((result.sheets[0]?.rows.length as number) > 0);
  });

  it("refuses the DOPT listing report: it links to an external workbook", () => {
    assert.throws(() => parseXlsx(readFileSync(DOPT_LISTING_XLSX)), /external/i);
  });
});

describe("parseXlsx — title rows above the header", () => {
  const TITLE = "Synthetic Census Title";
  const HEADERS = ["participantKey", "dopt", "paAmbMinor"];
  const TITLE_WARNING = `Sheet "Census": row 1 "${TITLE}" skipped — title row, not the header row.`;

  function sheetOf(bytes: Uint8Array) {
    const result = parseXlsx(bytes);
    return { result, sheet: result.sheets[0] as NonNullable<(typeof result.sheets)[number]> };
  }

  it("(a) one-cell title row + header + data rows imports with the header from row 2", () => {
    const { sheet } = sheetOf(
      buildXlsx([
        {
          name: "Census",
          rows: [
            [TITLE],
            HEADERS,
            ["SYN-T-001", "2024-06-30", 100000],
            ["SYN-T-002", "2024-06-30", 200000],
          ],
        },
      ]),
    );
    assert.deepEqual(sheet.headers, HEADERS);
    assert.equal(sheet.rows.length, 2);
    assert.equal(sheet.rows[0]?.["participantKey"], "SYN-T-001");
    assert.equal(sheet.rows[0]?.["paAmbMinor"], "100000");
    assert.equal(sheet.rows[1]?.["participantKey"], "SYN-T-002");
    assert.deepEqual(sheet.warnings, [TITLE_WARNING]);
  });

  it("(b) two title rows, then header", () => {
    const { sheet } = sheetOf(
      buildXlsx([
        {
          name: "Census",
          rows: [
            [TITLE],
            ["Second Title Row"],
            HEADERS,
            ["SYN-T-001", "2024-06-30", 100000],
          ],
        },
      ]),
    );
    assert.deepEqual(sheet.headers, HEADERS);
    assert.equal(sheet.rows.length, 1);
    assert.equal(sheet.rows[0]?.["participantKey"], "SYN-T-001");
    assert.deepEqual(sheet.warnings, [
      TITLE_WARNING,
      `Sheet "Census": row 2 "Second Title Row" skipped — title row, not the header row.`,
    ]);
  });

  it("(c) title row, blank row, then header", () => {
    const { sheet } = sheetOf(
      buildXlsx([
        {
          name: "Census",
          rows: [[TITLE], [], HEADERS, ["SYN-T-001", "2024-06-30", 100000]],
        },
      ]),
    );
    assert.deepEqual(sheet.headers, HEADERS);
    assert.equal(sheet.rows.length, 1);
    assert.equal(sheet.rows[0]?.["participantKey"], "SYN-T-001");
    // The blank row is skipped silently; only the title row is warned.
    assert.deepEqual(sheet.warnings, [TITLE_WARNING]);
  });

  it("(d) no title row — behavior unchanged, header from row 1", () => {
    const { sheet, result } = sheetOf(
      buildXlsx([
        {
          name: "Census",
          rows: [HEADERS, ["SYN-T-001", "2024-06-30", 100000]],
        },
      ]),
    );
    assert.deepEqual(sheet.headers, HEADERS);
    assert.equal(sheet.rows.length, 1);
    assert.equal(sheet.rows[0]?.["participantKey"], "SYN-T-001");
    assert.deepEqual(sheet.warnings, []);
    assert.deepEqual(result.warnings, []);
  });

  it("(e) only single-cell rows — refused, no header row", () => {
    const bytes = buildXlsx([
      {
        name: "Census",
        rows: [[TITLE], ["Only one cell"], ["Another single cell"]],
      },
    ]);
    assert.throws(
      () => parseXlsx(bytes),
      (err: unknown) =>
        err instanceof Error &&
        err.message ===
          'XLSX import refused: sheet "Census" has no header row — no rows hold two or more cells. The sheet is expected to be a table of data.',
    );
  });

  it("(f) a data row wider than the header is still refused, title row or not", () => {
    const bytes = buildXlsx([
      {
        name: "Census",
        rows: [[TITLE], ["participantKey", "dopt"], ["SYN-T-001", "2024-06-30", 100000]],
      },
    ]);
    assert.throws(() => parseXlsx(bytes), /row 3.*3 cells, more than the 2 header/);
  });

  it("(g) the skipped title text appears in the workbook warnings", () => {
    const { result } = sheetOf(
      buildXlsx([
        {
          name: "Census",
          rows: [[TITLE], HEADERS, ["SYN-T-001", "2024-06-30", 100000]],
        },
      ]),
    );
    assert.ok(result.warnings.includes(TITLE_WARNING));
    assert.ok(result.warnings.some((w) => w.includes(TITLE)));
  });
});

describe("parseXlsx — malformed input", () => {
  it("refuses a truncated .xlsx", () => {
    const bytes = buildXlsx([{ name: "S", rows: [["A"], ["1"]] }]);
    assert.throws(() => parseXlsx(bytes.subarray(0, Math.floor(bytes.length / 2))), /ZIP|truncated|not a ZIP/);
  });

  it("refuses a non-ZIP file with a .xlsx name", () => {
    assert.throws(
      () => parseXlsx(encoder.encode("PK this is not a zip at all, just text")),
      (err: unknown) => err instanceof Error && /not a ZIP|ZIP/.test(err.message),
    );
  });

  it("refuses a ZIP missing workbook.xml", () => {
    const bytes = makeZip([{ name: "xl/worksheets/sheet1.xml", data: encoder.encode("<worksheet/>") }]);
    assert.throws(() => parseXlsx(bytes), /workbook\.xml/);
  });

  it("refuses a workbook with no sheets", () => {
    const bytes = xlsxParts({
      "xl/workbook.xml":
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<workbook xmlns="${XLSX_NS}"><sheets></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels":
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
    });
    assert.throws(() => parseXlsx(bytes), /no sheets/);
  });

  it("refuses a sheet with no rows", () => {
    const empty =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<worksheet xmlns="${XLSX_NS}"><sheetData></sheetData></worksheet>`;
    assert.throws(() => parseXlsx(standardXlsx(empty)), /no rows/);
  });

  it("refuses bad XML in a worksheet", () => {
    const bad =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<worksheet xmlns="${XLSX_NS}"><sheetData><row><c></row></sheetData></worksheet>`;
    assert.throws(() => parseXlsx(standardXlsx(bad)), /bad XML/);
  });

  it("refusals are always Errors, never a partial workbook", () => {
    for (const bad of [
      new Uint8Array(0),
      encoder.encode("hello"),
      makeZip([{ name: "x.txt", data: encoder.encode("y") }]),
    ]) {
      assert.throws(
        () => parseXlsx(bad),
        (err: unknown) => err instanceof Error && err.message.length > 0,
      );
    }
  });
});
