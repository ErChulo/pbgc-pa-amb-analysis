// Stage 8 — XLSX import performance bench (Node).
//
// Builds census-shaped .xlsx fixtures with the app's own buildXlsx
// and times parse + map (parseXlsx, then mapImportedRow over the
// rows) at 1,000 and 10,000 rows, median of 3 timed runs after a
// warm-up. Also times the full rowsToCasePackage import for context
// (that step builds the case package; it is not part of the §21
// Import threshold, which covers parse + map). Prints the numbers
// and the §21 verdict (Import: 1,000: 150 ms, 10,000: 1,500 ms).
// Writes the results to stage7/xlsx-import-perf.md when run with
// --write. Synthetic data only. Usage: node stage7/bench-xlsx-import.mjs [--write]

import { writeFileSync } from "node:fs";
import { buildXlsx } from "../dist/src/ui/exports.js";
import { parseXlsx } from "../dist/src/ui/xlsxReader.js";
import { mapImportedRow, rowsToCasePackage } from "../dist/src/ui/import.js";

const HEADERS = ["participantKey", "dopt", "paAmbMinor", "salary_2020", "dob", "dote"];

function censusRows(n) {
  const rows = [HEADERS];
  for (let i = 1; i <= n; i += 1) {
    rows.push([
      `SYN-P-${String(i).padStart(5, "0")}`,
      "2024-06-30",
      100000 + i,
      6000000,
      "1962-03-14",
      "2019-06-15",
    ]);
  }
  return rows;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function timeParseMap(bytes) {
  const start = performance.now();
  const parsed = parseXlsx(bytes);
  const mapped = parsed.sheets[0].rows.map(mapImportedRow);
  const ms = performance.now() - start;
  return { ms, rows: mapped.length };
}

function timeFullImport(bytes) {
  const start = performance.now();
  const parsed = parseXlsx(bytes);
  const mapped = parsed.sheets[0].rows.map(mapImportedRow);
  rowsToCasePackage(mapped, {
    caseNumber: "00098765",
    planName: "Imported plan — name not supplied in file",
    planNumber: "not supplied",
    dopt: "2024-06-30",
    importId: "bench",
    importedDate: "2026-11-12",
    importedBy: "bench",
    sourceFileName: "bench.xlsx",
    sourceFileHash: parsed.fileHashSha256,
  }, []);
  return performance.now() - start;
}

const results = [];
for (const n of [1000, 10000]) {
  const buildStart = performance.now();
  const bytes = buildXlsx([{ name: "Census", rows: censusRows(n) }]);
  const buildMs = performance.now() - buildStart;
  timeParseMap(bytes); // Warm-up.
  const parseMapRuns = [timeParseMap(bytes), timeParseMap(bytes), timeParseMap(bytes)];
  const parseMapMs = median(parseMapRuns.map((r) => r.ms));
  timeFullImport(bytes); // Warm-up.
  const fullMs = median([timeFullImport(bytes), timeFullImport(bytes), timeFullImport(bytes)]);
  const threshold = n === 1000 ? 150 : 1500;
  results.push({ n, bytes: bytes.length, buildMs, parseMapMs, fullMs, threshold, pass: parseMapMs <= threshold });
  console.log(
    `${n} rows: fixture ${bytes.length} bytes (build ${buildMs.toFixed(1)} ms) | ` +
      `parse+map ${parseMapMs.toFixed(1)} ms (threshold ${threshold} ms) ${parseMapMs <= threshold ? "PASS" : "FAIL"} | ` +
      `full import ${fullMs.toFixed(1)} ms`,
  );
}

if (process.argv.includes("--write")) {
  const lines = [
    "# XLSX import performance (Stage 8)",
    "",
    "Measured 2026-11-12 on the build machine (Linux VM, Node v24.22.1, 1.5 shared CPUs).",
    "Fixtures are census-shaped .xlsx files built with the app's own `buildXlsx`",
    "(participantKey, dopt, paAmbMinor, salary_2020, dob, dote). Times are the",
    "median of 3 runs after a warm-up. `parse+map` is `parseXlsx` plus",
    "`mapImportedRow` over the rows — the §21 Import threshold. `Full import`",
    "adds `rowsToCasePackage` (package build) and is context only.",
    "",
    "| Rows | Fixture bytes | Parse+map (ms) | §21 threshold (ms) | Verdict | Full import (ms) |",
    "|---:|---:|---:|---:|:---:|---:|",
    ...results.map(
      (r) =>
        `| ${r.n} | ${r.bytes} | ${r.parseMapMs.toFixed(1)} | ${r.threshold} | ${r.pass ? "PASS" : "FAIL"} | ${r.fullMs.toFixed(1)} |`,
    ),
    "",
  ];
  writeFileSync(new URL("./xlsx-import-perf.md", import.meta.url), lines.join("\n"));
  console.log("Wrote stage7/xlsx-import-perf.md");
}
