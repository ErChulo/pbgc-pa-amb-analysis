/**
 * Unit tests for Stage 6 exports (src/ui/exports.ts).
 *
 * Run: npm test (tsc, then node --test dist/test/).
 * Synthetic data only. No network, no external packages.
 * The ZIP check parses the stored-ZIP structure by hand with Buffer
 * reads (no compression library, no external package).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SENSITIVE_EXPORT_WARNING_TEXT,
  buildAuditLog,
  buildContributionPackage,
  buildCsv,
  buildXlsx,
  confirmSensitiveExport,
  downloadCsv,
  downloadJson,
  downloadXlsx,
  sensitiveExportWarningText,
} from "../src/ui/exports.js";
import type { WorkProductContribution } from "../src/contribution.js";
import { CONTRIBUTION_PROTOCOL_VERSION } from "../src/contribution.js";

describe("buildCsv", () => {
  it("writes plain rows with CRLF endings", () => {
    assert.equal(buildCsv([["a", "b"], ["1", "2"]]), "a,b\r\n1,2\r\n");
  });

  it("quotes fields with commas, quotes, or newlines (RFC 4180)", () => {
    assert.equal(
      buildCsv([["name", "note"], ["Smith, John", 'He said "hi"\nthen left']]),
      'name,note\r\n"Smith, John","He said ""hi""\nthen left"\r\n',
    );
  });

  it("returns an empty string for no rows", () => {
    assert.equal(buildCsv([]), "");
  });
});

/** Minimal stored-ZIP reader: local file headers + central directory.
 *  Uses DataView/TextDecoder only (no Buffer: the repo has no
 *  @types/node, per test/node-types.d.ts). */
function parseZip(bytes: Uint8Array): Array<{ name: string; data: Uint8Array }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8");
  assert.equal(view.getUint32(0, true), 0x04034b50, "first bytes must be PK\\x03\\x04");
  const entries: Array<{ name: string; data: Uint8Array }> = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;
    assert.equal(method, 0, "entries must be stored (method 0)");
    entries.push({ name, data: bytes.subarray(dataStart, dataStart + compSize) });
    offset = dataStart + compSize;
  }
  // Central directory must follow.
  assert.equal(view.getUint32(offset, true), 0x02014b50, "central directory must follow the entries");
  return entries;
}

/** Find one ZIP entry by name, or throw. */
function zipEntry(entries: Array<{ name: string; data: Uint8Array }>, name: string): Uint8Array {
  const found = entries.find((e) => e.name === name);
  if (found === undefined) throw new Error(`missing ZIP entry: ${name}`);
  return found.data;
}

function zipText(entries: Array<{ name: string; data: Uint8Array }>, name: string): string {
  return new TextDecoder("utf-8").decode(zipEntry(entries, name));
}

describe("buildXlsx", () => {
  const sheets = [
    { name: "reconciliation", rows: [["participant", "pa_amb_amount", "delta_amount"], ["SYN-001", 850, 0.5]] },
    { name: "participants", rows: [["participant", "status"], ["SYN-001", "active"]] },
    { name: "findings", rows: [["finding", "statement"], ["f-1", "Reconstructed benefit."]] },
    { name: "dispositions", rows: [["disposition", "count"], ["verified", 60]] },
  ];

  it("starts with PK\\x03\\x04 and parses as a valid stored ZIP with the expected sheets", () => {
    const bytes = buildXlsx(sheets);
    assert.equal(bytes[0], 0x50);
    assert.equal(bytes[1], 0x4b);
    assert.equal(bytes[2], 0x03);
    assert.equal(bytes[3], 0x04);
    const entries = parseZip(bytes);
    const names = entries.map((e) => e.name);
    for (const expected of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "docProps/core.xml",
      "docProps/app.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
      "xl/worksheets/sheet3.xml",
      "xl/worksheets/sheet4.xml",
    ]) {
      assert.ok(names.includes(expected), `missing ZIP entry: ${expected}`);
    }
    const workbookText = zipText(entries, "xl/workbook.xml");
    for (const sheetName of ["reconciliation", "participants", "findings", "dispositions"]) {
      assert.ok(workbookText.includes(`name="${sheetName}"`), `workbook must list sheet ${sheetName}`);
    }
    const sheet1Text = zipText(entries, "xl/worksheets/sheet1.xml");
    assert.ok(sheet1Text.includes("SYN-001"));
    assert.ok(sheet1Text.includes("<v>850</v>"));
  });

  it("applies money (0.00) and 4-decimal factor formats by header", () => {
    const bytes = buildXlsx([
      { name: "factors", rows: [["factor_name", "factor_value", "benefit_amount"], ["erf", 0.9234, 850.5]] },
    ]);
    const entries = parseZip(bytes);
    const stylesText = zipText(entries, "xl/styles.xml");
    assert.ok(stylesText.includes('formatCode="0.0000"'));
    assert.ok(stylesText.includes('numFmtId="2"'));
    const sheetText = zipText(entries, "xl/worksheets/sheet1.xml");
    // Header row is bold (style 1); factor cell uses style 3, money cell style 2.
    assert.ok(sheetText.includes('s="3"><v>0.9234</v>'), "factor cell must use the 0.0000 style");
    assert.ok(sheetText.includes('s="2"><v>850.5</v>'), "money cell must use the 0.00 style");
  });

  it("is deterministic: same sheets give the same bytes", () => {
    assert.deepEqual(buildXlsx(sheets), buildXlsx(sheets));
  });

  it("throws on no sheets and sanitises duplicate/long sheet names", () => {
    assert.throws(() => buildXlsx([]), /at least one sheet/);
    const bytes = buildXlsx([
      { name: "a".repeat(40), rows: [["x"], ["1"]] },
      { name: "a".repeat(40), rows: [["x"], ["2"]] },
    ]);
    const entries = parseZip(bytes);
    const text = zipText(entries, "xl/workbook.xml");
    assert.ok(!text.includes("a".repeat(40)), "sheet name must be cut to 31 chars");
    assert.ok(text.includes("(2)"), "duplicate names must be made unique");
  });
});

function contributionPackage(): WorkProductContribution {
  return {
    productId: "AMB",
    productVersion: "0.1.0",
    caseId: "12345678",
    producedAt: "2026-11-12",
    publishedBy: "system",
    sourceSnapshotId: "snap-abc123",
    calculationRunId: "run1",
    status: "draft",
    findings: [],
    fragments: [],
    citations: [],
    warnings: [],
    requiredFollowups: [],
    downstreamDependencies: ["R1"],
  };
}

describe("buildContributionPackage", () => {
  it("emits valid JSON with protocol version 0.1.0 and all required fields", () => {
    const json = buildContributionPackage(contributionPackage());
    const parsed = JSON.parse(json) as Record<string, unknown>;
    assert.equal(parsed.contributionProtocolVersion, "0.1.0");
    assert.equal(parsed.contributionProtocolVersion, CONTRIBUTION_PROTOCOL_VERSION);
    for (const field of [
      "productId", "productVersion", "caseId", "producedAt", "publishedBy",
      "sourceSnapshotId", "status", "findings", "fragments", "citations",
      "warnings", "requiredFollowups", "downstreamDependencies",
    ]) {
      assert.ok(field in parsed, `missing field: ${field}`);
    }
    assert.equal(parsed.productId, "AMB");
    assert.equal(parsed.caseId, "12345678");
  });

  it("never emits an incomplete package: throws on a missing required field", () => {
    const bad = contributionPackage();
    (bad as unknown as Record<string, unknown>).caseId = "";
    assert.throws(() => buildContributionPackage(bad), /missing required field\(s\): caseId/);
    const bad2 = contributionPackage();
    delete (bad2 as unknown as Record<string, unknown>).sourceSnapshotId;
    assert.throws(() => buildContributionPackage(bad2), /sourceSnapshotId/);
  });
});

describe("buildAuditLog", () => {
  it("is chronological, one event per line", () => {
    const log = buildAuditLog([
      { at: "2026-11-12T10:00:00Z", actor: "reviewer-1", action: "report-generated", detail: "Plan report." },
      { at: "2026-11-12T09:00:00Z", actor: "system", action: "calculation-run-completed", detail: "Run run1." },
      { at: "2026-11-12T09:30:00Z", actor: "system", action: "comparison-computed", detail: "90 compared." },
    ]);
    const lines = log.trim().split("\n");
    assert.equal(lines.length, 3);
    assert.ok((lines[0] as string).startsWith("2026-11-12T09:00:00Z"));
    assert.ok((lines[1] as string).startsWith("2026-11-12T09:30:00Z"));
    assert.ok((lines[2] as string).startsWith("2026-11-12T10:00:00Z"));
    assert.ok((lines[2] as string).includes("reviewer-1 | report-generated | Plan report."));
  });

  it("returns an empty string for no events", () => {
    assert.equal(buildAuditLog([]), "");
  });
});

describe("sensitive-export warning", () => {
  it("documents the §19 warning text naming the export kind", () => {
    const text = sensitiveExportWarningText("participant-data");
    assert.ok(text.includes("participant-data"));
    assert.ok(text.includes("sensitive participant information"));
    assert.ok(text.includes("must not be sent outside PBGC systems"));
    assert.ok(SENSITIVE_EXPORT_WARNING_TEXT.includes("sensitive participant information"));
  });

  it("confirmSensitiveExport never auto-approves: returns false without a reviewer confirmation", () => {
    assert.equal(confirmSensitiveExport("participant-data"), false);
  });
});

describe("download helpers", () => {
  it("are no-ops without a document (Node) and do not throw", () => {
    assert.equal(typeof document, "undefined");
    downloadCsv("test.csv", "a,b\r\n");
    downloadXlsx("test.xlsx", buildXlsx([{ name: "s", rows: [["x"]] }]));
    downloadJson("test.json", "{}");
  });
});
