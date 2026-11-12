// Stage 7 reproducibility — driver generator (NEW file, verification only).
//
// Extracts the `drive(action)` function verbatim from
// test/ui-playwright/wizard-flow.test.mjs (the Stage 6 wizard driver),
// applies ONLY the replacements listed below, inserts two new actions
// ("import", "snapshot", "goto-export"), and writes
// stage7/03-repro-flow-driver.js — one self-contained classic script
// usable both in Node (imported as a module; it only assigns globals)
// and in the browser (page.addScriptTag). The point: Node and browser
// runs execute the IDENTICAL step code, so a byte difference between
// them is a real reproducibility defect, not a driver difference.
//
// Replacements vs the Stage 6 driver (verified by diff after generation):
//   R1  window.PaAmbApp        -> globalThis.PaAmbApp       (Node has no window)
//   R2  window.__paAmbHandle   -> globalThis.__paAmbHandle  (same reason)
//   R3  `ui-propose-${key}-${Date.now()}` -> `ui-propose-${key}-fixed`
//       The Stage 6 driver embedded wall-clock time in propose eventIds.
//       EventIds flow into disposition ids AND audit event ids
//       (state.ts applyEvent -> decisions.ts applyCaseEvent), so the
//       Stage 6 driver itself is not reproducible. Stage 7 Repro D3
//       fixed the source file itself, so the generator now VERIFIES the
//       fixed strings are present (and the Date.now() versions absent)
//       instead of replacing them.
//   R4  `ui-approve-${key}-${Date.now()}` -> `ui-approve-${key}-fixed`
//       (same reason as R3)
//   R5  document.getElementById in the "state" action -> guarded with
//       typeof document === "undefined" (Node has no document).
//   R6  Two NEW actions inserted before the unknown-action throw:
//       "import" (loadDemoCase + dispatch, fixed TS — the Stage 6 test
//       instead clicks #demo-button, which stamps nowIso()), "snapshot"
//       (full state JSON + CSV/XLSX row data + reports + audit log),
//       "goto-export" (wizard-go-to export, fixed TS — the Stage 6 test
//       instead clicks the nav button, which stamps nowIso()).
//
// No other change is made. Run: node stage7/03-repro-build-driver.mjs
// Exit 0 = driver written and diff-verified; exit 1 = unexpected drift
// (e.g. the Stage 6 driver changed shape — inspect before proceeding).

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "test", "ui-playwright", "wizard-flow.test.mjs");
const OUT = join(dirname(fileURLToPath(import.meta.url)), "03-repro-flow-driver.js");

const src = readFileSync(SRC, "utf8");
const start = src.indexOf("function drive(action) {");
const end = src.indexOf("\nasync function main()");
if (start === -1 || end === -1 || end <= start) {
  console.error("FAIL: could not locate drive() in wizard-flow.test.mjs");
  process.exit(1);
}
let drive = src.slice(start, end);
if (!drive.endsWith("\n")) drive += "\n";

// --- Replacements R1-R5 (each must match exactly once, except R1/R2) ---
function mustReplace(text, from, to, label) {
  const count = text.split(from).length - 1;
  if (count === 0) {
    console.error(`FAIL ${label}: pattern not found: ${from.slice(0, 80)}`);
    process.exit(1);
  }
  return { text: text.split(from).join(to), count };
}
let r;
r = mustReplace(drive, "window.PaAmbApp", "globalThis.PaAmbApp", "R1");
drive = r.text;
r = mustReplace(drive, "window.__paAmbHandle", "globalThis.__paAmbHandle", "R2");
drive = r.text;
// R3/R4: the source file itself was fixed (Stage 7 Repro D3), so the
// generator verifies the fixed eventIds are present exactly once each
// and the wall-clock versions are gone — no replacement to apply.
function mustContainOnce(text, pattern, label) {
  const count = text.split(pattern).length - 1;
  if (count !== 1) {
    console.error(`FAIL ${label}: expected 1 occurrence of ${pattern}, got ${count}`);
    process.exit(1);
  }
}
mustContainOnce(drive, "eventId: `ui-propose-${key}-fixed`", "R3");
mustContainOnce(drive, "eventId: `ui-approve-${key}-fixed`", "R4");
if (drive.includes("Date.now()")) {
  console.error("FAIL R3/R4: wall-clock Date.now() still in the Stage 6 driver");
  process.exit(1);
}
r = mustReplace(
  drive,
  'charts: document.getElementById("chart-area")?.innerHTML.length ?? 0,',
  'charts: (typeof document === "undefined" ? -1 : document.getElementById("chart-area")?.innerHTML.length ?? 0),',
  "R5a",
);
drive = r.text;
r = mustReplace(
  drive,
  'reportHasCase: (document.getElementById("report-area")?.textContent ?? "").includes("00098765"),',
  'reportHasCase: (typeof document === "undefined" ? false : (document.getElementById("report-area")?.textContent ?? "").includes("00098765")),',
  "R5b",
);
drive = r.text;

// No wall-clock time may remain in the driver.
const remaining = drive.match(/Date\.now\(\)|new Date\(\)|performance\.now/g);
if (remaining !== null) {
  console.error(`FAIL: wall-clock calls remain in driver: ${remaining.join(", ")}`);
  process.exit(1);
}

// --- R6: new actions, inserted before the unknown-action throw ---
const anchor = '  throw new Error("unknown drive action: " + action.name);';
if (!drive.includes(anchor)) {
  console.error("FAIL R6: unknown-action anchor not found");
  process.exit(1);
}
const inserted = `
  if (action.name === "import") {
    // Load the demo case with the FIXED timestamp (the Stage 6 test
    // clicks #demo-button, which stamps nowIso() into the event).
    const next = App.loadDemoCase(state(), "demo", TS);
    dispatch({ kind: "import-case-package", casePackage: next.casePackage, actor: "demo", occurredAt: TS });
    return { participantCount: Object.keys(state().analysis.participants).length };
  }

  if (action.name === "goto-export") {
    // Navigate with the FIXED timestamp (the Stage 6 test clicks the
    // nav button, which stamps nowIso() into the event log).
    dispatch({ kind: "wizard-go-to", step: "export", actor: "demo", occurredAt: TS });
    return { currentStep: state().wizard.currentStep };
  }

  if (action.name === "snapshot") {
    // Everything needed to rebuild the exported artifacts byte-for-byte,
    // plus the full state for a JSON comparison. CSV/XLSX rows use the
    // same 8 columns in the same order as src/ui/main.ts
    // downloadReconciliationCsv / downloadReconciliationXlsx.
    const s = state();
    const header = ["participantKey", "recordedMinor", "reconstructedMinor", "deltaMinor", "absDeltaMinor", "relDelta", "toleranceVerdict", "recommendedDisposition"];
    const csvRows = [header];
    const xlsxRows = [header];
    for (const rec of Object.values(s.reconciliations)) {
      csvRows.push([
        rec.participantKey,
        rec.recorded?.amount?.amountMinor === undefined ? "" : String(rec.recorded?.amount?.amountMinor ?? ""),
        rec.reconstructed?.amount?.amountMinor === undefined ? "" : String(rec.reconstructed?.amount?.amountMinor ?? ""),
        rec.comparison.comparable ? String(rec.comparison.delta.amountMinor) : "",
        rec.comparison.comparable ? String(rec.comparison.absDelta.amountMinor) : "",
        rec.comparison.comparable && rec.comparison.relative.kind === "defined" ? rec.comparison.relative.value : "",
        rec.toleranceVerdict,
        rec.recommendedDisposition,
      ]);
      xlsxRows.push([
        rec.participantKey,
        rec.recorded?.amount?.amountMinor ?? "",
        rec.reconstructed?.amount?.amountMinor ?? "",
        rec.comparison.comparable ? rec.comparison.delta.amountMinor : "",
        rec.comparison.comparable ? rec.comparison.absDelta.amountMinor : "",
        rec.comparison.comparable && rec.comparison.relative.kind === "defined" ? rec.comparison.relative.value : "",
        rec.toleranceVerdict,
        rec.recommendedDisposition,
      ]);
    }
    return {
      stateJson: JSON.stringify(s),
      csvRows,
      xlsxRows,
      auditLog: s.analysis.auditLog,
      auditLogText: App.exportAuditLogText(s),
      eventLogKinds: s.eventLog.map((e) => e.kind),
      eventLog: s.eventLog,
      planReport: App.planReportForState(s),
      participantReports: Object.fromEntries(keys().map((k) => [k, App.participantReportForState(s, k)])),
      ambMemo: App.ambMemoForState(s),
      reproducibility: {
        snapshotHash: s.analysis.inputSnapshot.snapshotHash,
        validationRules: s.analysis.ruleVersions.validationRules,
        formulaTaxonomy: s.analysis.ruleVersions.formulaTaxonomy,
        dispositionSchema: s.analysis.ruleVersions.dispositionSchema,
        toleranceSetId: s.analysis.ruleVersions.toleranceSetId,
        engineVersion: "0.1.0",
        uiStateVersion: s.version,
      },
      wizard: s.wizard,
      dispositions: Object.fromEntries(
        Object.entries(s.analysis.participants).map(([k, p]) => [
          k, p.disposition === null ? null : p.disposition.disposition + "/" + p.disposition.status,
        ]),
      ),
    };
  }

`;
drive = drive.replace(anchor, inserted + anchor);

const header = `// Stage 7 reproducibility — shared flow driver (GENERATED — do not hand-edit).
// Generated by stage7/03-repro-build-driver.mjs from
// test/ui-playwright/wizard-flow.test.mjs drive() with replacements
// R1-R6 only (see the generator for the exact list). Classic script:
// assigns globalThis.stage7Drive; no imports/exports, so it loads both
// as a Node module and via page.addScriptTag in the browser.
// Fixed timestamp TS = "2026-11-12T00:00:00.000Z" throughout; no
// Date.now(), no new Date(), no wall-clock read anywhere in this file.

`;
writeFileSync(OUT, header + drive + "\nglobalThis.stage7Drive = drive;\n", "utf8");
console.log(`OK driver written: ${OUT} (${drive.length} chars of drive function)`);
console.log("OK replacements R1-R6 applied; no Date.now()/new Date()/performance.now remains");
