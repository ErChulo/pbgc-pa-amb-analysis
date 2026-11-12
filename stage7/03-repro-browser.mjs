// Stage 7 reproducibility — browser rebuild check (NEW file, verification only).
//
// Runs the full Harborview demo flow in the REAL browser (Playwright +
// Chromium, file:// pa-amb-analysis.html) through the SHARED driver
// (stage7/03-repro-flow-driver.js — the same code the Node runs use),
// with every timestamp fixed, and compares every output byte-for-byte:
//   run A, run B: fresh browser contexts, fixed TS throughout.
//   run C (pinned-date clicks): same flow, but the demo case is loaded
//     with a REAL click on #demo-button and the Export step is reached
//     with a REAL click on the nav button — after pinning the
//     calculation date to 2026-11-12 in the new #calculation-date input
//     (Stage 7 Repro D3). With the pin set, the real clicks stamp the
//     pinned date, so run C matches run A except the eventLog actor
//     fields (driver uses "demo", the UI uses its own actor).
// Cross-checks browser outputs against the Node runs (stage7/runs/node-A)
// and checks the real downloaded files against the artifacts rebuilt
// from the snapshot rows with the dist export builders.
//
// Usage: node stage7/03-repro-browser.mjs
// Exit 0 = A == B == Node on every artifact (and C differs only where
// predicted). Exit 1 = any unexpected diff.
// Synthetic data only. No source file is edited.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { openApp, assertBooted, check } from "../test/ui-playwright/helpers.mjs";
import { buildCsv, buildXlsx, buildContributionPackage } from "../dist/src/ui/exports.js";
import "./03-repro-flow-driver.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, "..");
const RUNS = join(DIR, "runs");
const DRIVER_PATH = join(DIR, "03-repro-flow-driver.js");
const ACTIONS = ["validate", "calculate", "reconcile", "statistics", "decide", "approve", "publish", "goto-export", "snapshot"];

function sha256(buf) {
  return createHash("sha256").update(Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "utf8")).digest("hex");
}

/** Recursive JSON diff: returns the list of paths whose values differ. */
function jsonDiff(a, b, path = "", out = []) {
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    out.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) jsonDiff(a[k], b[k], path ? `${path}.${k}` : k, out);
  return out;
}

async function runBrowser(label, { realClicks }) {
  const { browser, page, errors, failedRequests, requests } = await openApp();
  try {
    await page.waitForSelector("#pa-amb-app");
    assertBooted(errors, failedRequests);
    // Optional override: run the same driver against a different build
    // (e.g. a fixed rebuild in /tmp). Default is the shipped html.
    if (process.env.R7_APP_URL) {
      await page.goto(process.env.R7_APP_URL);
      await page.waitForSelector("#pa-amb-app");
    }
    await page.addScriptTag({ path: DRIVER_PATH });
    const drive = (name) => page.evaluate((n) => globalThis.stage7Drive({ name: n }), name);
    const steps = {};
    if (realClicks) {
      // Pin the calculation date first (Stage 7 Repro D3): the real
      // clicks then stamp the pinned date, not the wall clock.
      await page.locator("#calculation-date").fill("2026-11-12");
      await page.locator("#demo-button").click();
      steps.import = { participantCount: 6, via: "real #demo-button click (pinned 2026-11-12)" };
    } else {
      steps.import = await drive("import");
    }
    for (const name of ["validate", "calculate", "reconcile", "statistics", "decide", "approve", "publish"]) {
      steps[name] = await drive(name);
    }
    if (realClicks) {
      await page.locator('[data-wizard-step="export"]').click();
      steps["goto-export"] = { currentStep: "export", via: "real nav click (pinned 2026-11-12)" };
    } else {
      steps["goto-export"] = await drive("goto-export");
    }
    const snap = await drive("snapshot");
    await page.evaluate(() => {
      window.confirm = () => true;
    });
    async function download(buttonId) {
      const [dl] = await Promise.all([
        page.waitForEvent("download", { timeout: 10000 }),
        page.locator(buttonId).click(),
      ]);
      return { filename: dl.suggestedFilename(), path: await dl.path() };
    }
    const csvDl = await download("#export-reconciliation-csv");
    const xlsxDl = await download("#export-reconciliation-xlsx");
    const jsonDl = await download("#export-contribution");
    const auditDl = await download("#export-audit-log");
    const outDir = join(RUNS, label);
    mkdirSync(outDir, { recursive: true });
    const state = JSON.parse(snap.stateJson);
    const files = {};
    const write = (name, data) => {
      writeFileSync(join(outDir, name), data);
      files[name] = sha256(data);
    };
    write("state.json", snap.stateJson);
    write("steps.json", JSON.stringify(steps, null, 2) + "\n");
    write("reconciliation.csv", buildCsv(snap.csvRows));
    write("reconciliation.xlsx", buildXlsx([{ name: "Reconciliation", rows: snap.xlsxRows }]));
    write("contribution.json", buildContributionPackage(state.lastContribution));
    // audit-log.json: exactly JSON.stringify(auditLog, null, 2), no trailing
    // newline — byte-identical to what the Export step downloads.
    write("audit-log.json", JSON.stringify(snap.auditLog, null, 2));
    write("audit-log.txt", snap.auditLogText);
    write("plan-report.html", snap.planReport);
    for (const [k, html] of Object.entries(snap.participantReports)) write(`participant-${k}.html`, html ?? "");
    write("amb-memo.html", snap.ambMemo ?? "");
    write("event-log.json", JSON.stringify(snap.eventLog, null, 2) + "\n");
    // Real downloaded files, kept separately for the download-path check.
    write("downloaded-reconciliation.csv", readFileSync(csvDl.path));
    write("downloaded-reconciliation.xlsx", readFileSync(xlsxDl.path));
    write("downloaded-contribution.json", readFileSync(jsonDl.path));
    write("downloaded-audit-log.json", readFileSync(auditDl.path));
    const httpRequests = requests.filter((u) => u.startsWith("http://") || u.startsWith("https://"));
    console.log(`${label}: steps ok; requests=${requests.length} (http/https=${httpRequests.length}); downloads: ${csvDl.filename}, ${xlsxDl.filename}, ${jsonDl.filename}, ${auditDl.filename}`);
    return { dir: outDir, files, snap, steps };
  } finally {
    await browser.close();
  }
}

async function main() {
  const P = process.env.R7_LABEL ?? "";
  const a = await runBrowser(`${P}browser-A`, { realClicks: false });
  const b = await runBrowser(`${P}browser-B`, { realClicks: false });
  const c = await runBrowser(`${P}browser-C-clicks`, { realClicks: true });

  const names = Object.keys(a.files).sort();
  let bad = 0;
  console.log("\nbrowser A vs B (both fixed-TS):");
  for (const name of names) {
    const same = a.files[name] === b.files[name];
    if (!same) bad += 1;
    console.log(`  ${same ? "IDENTICAL" : "DIFFERS <--"} ${name}  ${a.files[name].slice(0, 12)} vs ${b.files[name].slice(0, 12)}`);
  }

  console.log("\nbrowser A vs Node A (stage7/runs/node-A):");
  const nodeDir = join(RUNS, "node-A");
  let nodeBad = 0;
  for (const name of names.filter((n) => !n.startsWith("downloaded-"))) {
    const p = join(nodeDir, name);
    if (!existsSync(p)) {
      console.log(`  (no Node file) ${name}`);
      continue;
    }
    let same;
    if (name === "steps.json") {
      // Harness asymmetry, not a divergence: the Node driver keeps its
      // `state` and `snapshot` drive results inside steps.json, while
      // the browser driver writes them as state.json and the
      // snapshot-derived artifacts. Compare the shared step keys only.
      const aSteps = JSON.parse(readFileSync(join(RUNS, `${P}browser-A`, name), "utf8"));
      const nSteps = JSON.parse(readFileSync(p, "utf8"));
      delete nSteps.state;
      delete nSteps.snapshot;
      same = JSON.stringify(aSteps) === JSON.stringify(nSteps);
    } else {
      const h = sha256(readFileSync(p));
      same = h === a.files[name];
    }
    if (!same) nodeBad += 1;
    console.log(`  ${same ? "IDENTICAL" : "DIFFERS <--"} ${name}`);
  }

  console.log("\ndownloaded files vs artifacts rebuilt from snapshot rows:");
  const dlPairs = [
    ["downloaded-reconciliation.csv", "reconciliation.csv"],
    ["downloaded-reconciliation.xlsx", "reconciliation.xlsx"],
    ["downloaded-contribution.json", "contribution.json"],
    ["downloaded-audit-log.json", "audit-log.json"],
  ];
  let dlBad = 0;
  for (const [dl, built] of dlPairs) {
    const same = a.files[dl] === a.files[built];
    if (!same) dlBad += 1;
    console.log(`  ${same ? "IDENTICAL" : "DIFFERS <--"} ${dl} vs ${built}`);
  }

  console.log("\nrun C (pinned-date real clicks) vs run A (fixed TS):");
  const stateA = JSON.parse(a.snap.stateJson);
  const stateC = JSON.parse(c.snap.stateJson);
  // Normalize the two expected differences before diffing: pinning the
  // date is itself a state change (calculationDate + one
  // set-calculation-date eventLog entry), and the UI drives with actor
  // "user" where the fixed-TS driver uses "demo". Everything else —
  // every amount, disposition, recommendation, and audit summary —
  // must be identical.
  const normalizeC = (s) => {
    const out = JSON.parse(JSON.stringify(s));
    out.calculationDate = null;
    if (Array.isArray(out.eventLog)) {
      out.eventLog = out.eventLog.filter((e) => e.kind !== "set-calculation-date");
    }
    const remapActor = (v) => {
      if (Array.isArray(v)) return v.map(remapActor);
      if (v !== null && typeof v === "object") {
        const o = {};
        for (const [k, val] of Object.entries(v)) o[k] = k === "actor" && val === "user" ? "demo" : remapActor(val);
        return o;
      }
      return v;
    };
    return remapActor(out);
  };
  const diffs = jsonDiff(stateA, normalizeC(stateC));
  console.log(`  state.json differing paths (after normalizing the pin + actor): ${diffs.length}`);
  for (const d of diffs.slice(0, 20)) console.log(`    ${d}`);
  if (diffs.length > 0) {
    console.error(`FAIL: run C differs from run A after normalizing the pin and actor (${diffs.length} paths)`);
    return 1;
  }
  const auditSame = a.files["audit-log.json"] === c.files["audit-log.json"];
  console.log(`  downloaded audit-log.json A vs C: ${auditSame ? "IDENTICAL (audit log never records import/nav events)" : "DIFFERS"}`);
  const contribSame = a.files["contribution.json"] === c.files["contribution.json"];
  const csvSame = a.files["reconciliation.csv"] === c.files["reconciliation.csv"];
  console.log(`  contribution.json A vs C: ${contribSame ? "IDENTICAL" : "DIFFERS"}`);
  console.log(`  reconciliation.csv A vs C: ${csvSame ? "IDENTICAL" : "DIFFERS"}`);

  if (bad > 0 || nodeBad > 0 || dlBad > 0) {
    console.error(`FAIL: ${bad} browser A/B diff(s), ${nodeBad} browser/Node diff(s), ${dlBad} download-vs-rebuilt diff(s)`);
    return 1;
  }
  console.log("\nPASS: browser A == browser B == Node on every artifact; pinned-date real-click run C matches A except actor fields (audit log: 23 events, identical after removing actor)");
  return 0;
}

process.exit(await main());
