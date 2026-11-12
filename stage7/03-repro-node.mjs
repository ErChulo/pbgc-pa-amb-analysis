// Stage 7 reproducibility — Node rebuild check (NEW file, verification only).
//
// Runs the full Harborview demo flow (import -> validate -> calculate ->
// reconcile -> statistics -> decide -> approve -> publish -> snapshot)
// through the SHARED driver (stage7/03-repro-flow-driver.js) against the
// compiled engine (dist/), with every timestamp fixed
// (TS = 2026-11-12T00:00:00.000Z, fixed eventIds), and writes every
// output artifact to a run directory.
//
// Usage:
//   node stage7/03-repro-node.mjs            # runs A + B in-process, C in a
//                                            # fresh child process, compares all
//   node stage7/03-repro-node.mjs --single <dir>   # one run into <dir>
//
// Exit 0 = all artifacts byte-identical across A, B, C. Exit 1 = any diff
// (prints the sha256 table and the first differing bytes).
// Synthetic data only (Harborview demo case, case 00098765). No source
// file is edited; dist/ was rebuilt beforehand with `npm run build`.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import * as Main from "../dist/src/ui/main.js";
import { DEMO_CASE_PACKAGE, DEMO_TOLERANCE } from "../dist/src/ui/demo.js";
import { applyEvent } from "../dist/src/ui/state.js";
import { buildReconciliationInputs } from "../dist/src/reconciliation.js";
import {
  mapDisposition,
  recommendationIsNotApproval,
  toEntryCheckInput,
} from "../dist/src/dispositionMapping.js";
import { makeMoney } from "../dist/src/decimal.js";
import { datedValue, makeBenefit } from "../dist/src/formulas.js";
import { buildCsv, buildXlsx, buildContributionPackage } from "../dist/src/ui/exports.js";
import "../dist/src/ui/main.js";
import "./03-repro-flow-driver.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, "..");
const RUNS = join(DIR, "runs");

const ACTIONS = ["import", "validate", "calculate", "reconcile", "statistics", "decide", "approve", "publish", "goto-export", "state", "snapshot"];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** One full fixed-timestamp run. Returns { dir, files: {name: sha} }. */
export function runOnce(outDir) {
  mkdirSync(outDir, { recursive: true });
  // PaAmbApp shim: the same names the browser bundle exposes.
  globalThis.PaAmbApp = {
    ...Main,
    DEMO_CASE_PACKAGE,
    DEMO_TOLERANCE,
    buildReconciliationInputs,
    mapDisposition,
    recommendationIsNotApproval,
    toEntryCheckInput,
    makeMoney,
    datedValue,
    makeBenefit,
  };
  const handle = {
    _s: Main.createEmptyUiState(),
    getState() {
      return this._s;
    },
    dispatch(ev) {
      this._s = applyEvent(this._s, ev);
      return this;
    },
  };
  globalThis.__paAmbHandle = handle;
  const drive = globalThis.stage7Drive;
  const steps = {};
  for (const name of ACTIONS) {
    steps[name] = drive({ name });
  }
  const snap = steps.snapshot;
  const state = JSON.parse(snap.stateJson);
  const files = {};
  const write = (name, data) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    writeFileSync(join(outDir, name), buf);
    files[name] = sha256(buf);
  };
  write("state.json", snap.stateJson);
  write("steps.json", JSON.stringify(steps, null, 2) + "\n");
  write("reconciliation.csv", buildCsv(snap.csvRows));
  write("reconciliation.xlsx", buildXlsx([{ name: "Reconciliation", rows: snap.xlsxRows }]));
  write("contribution.json", buildContributionPackage(state.lastContribution));
  // audit-log.json: exactly JSON.stringify(auditLog, null, 2) with NO
  // trailing newline — byte-identical to what the Export step downloads
  // (main.ts export-audit-log handler). An earlier version of this
  // harness added "\n" here and produced a spurious 1-byte diff.
  write("audit-log.json", JSON.stringify(snap.auditLog, null, 2));
  write("audit-log.txt", snap.auditLogText);
  write("plan-report.html", snap.planReport);
  for (const [k, html] of Object.entries(snap.participantReports)) {
    write(`participant-${k}.html`, html ?? "");
  }
  write("amb-memo.html", snap.ambMemo ?? "");
  write("event-log.json", JSON.stringify(snap.eventLog, null, 2) + "\n");
  return { dir: outDir, files, steps };
}

function compareRuns(runs) {
  const names = Object.keys(runs[0].files).sort();
  let bad = 0;
  console.log("artifact                       " + runs.map((r) => r.dir.split("/").pop().padEnd(10)).join(" "));
  for (const name of names) {
    const hashes = runs.map((r) => r.files[name]);
    const same = hashes.every((h) => h === hashes[0]);
    if (!same) bad += 1;
    console.log(
      `${name.padEnd(30)} ${hashes.map((h) => h.slice(0, 12)).join("  ")}  ${same ? "IDENTICAL" : "DIFFERS <--"}`,
    );
  }
  return bad;
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--single" && args[1]) {
    const r = runOnce(args[1]);
    console.log(`single run written to ${r.dir}`);
    for (const [n, h] of Object.entries(r.files)) console.log(`  ${n} ${h}`);
    return 0;
  }
  const a = runOnce(join(RUNS, "node-A"));
  const b = runOnce(join(RUNS, "node-B"));
  const child = spawnSync(process.execPath, [join(DIR, "03-repro-node.mjs"), "--single", join(RUNS, "node-C")], {
    stdio: "inherit",
  });
  if (child.status !== 0) {
    console.error("FAIL: child process run C failed");
    return 1;
  }
  const cFiles = {};
  for (const n of readdirSync(join(RUNS, "node-C"))) {
    cFiles[n] = sha256(readFileSync(join(RUNS, "node-C", n)));
  }
  const c = { dir: join(RUNS, "node-C"), files: cFiles };
  console.log("\nNode rebuild comparison (A, B in-process; C fresh process):");
  const bad = compareRuns([a, b, c]);
  // Step summaries must also match (they are inside steps.json, but print the values).
  const s = (r) => JSON.stringify(r.steps);
  console.log(`step summaries A==B: ${s(a) === s(b)}, A==C: (see steps.json hashes above)`);
  if (bad > 0) {
    console.error(`FAIL: ${bad} artifact(s) differ across identical runs`);
    return 1;
  }
  console.log("PASS: all artifacts byte-identical across A, B, C");
  return 0;
}

process.exit(main());
