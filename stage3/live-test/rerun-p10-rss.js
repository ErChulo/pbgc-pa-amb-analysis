"use strict";
// Clean P-10 peak-memory measurement: launch Chromium with a KNOWN user-data-dir
// and sample only the processes belonging to that browser (by command-line match),
// every 50 ms, during the 100k-row import + calculation.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const STAGE3 = "/home/hatch/workspace/pbgc-pa-amb-analysis/stage3";
const POC = path.join(STAGE3, "poc");
const LIVE = path.join(STAGE3, "live-test");
const PROFILE = "/tmp/p10-rss-profile";
const fileUrl = (p) => "file://" + p;

function browserRssMB() {
  try {
    const out = execSync("ps -eo rss,args | grep -F '" + PROFILE + "' | grep -v grep | awk '{s+=$1} END {print s+0}'", { encoding: "utf8" });
    return parseInt(out.trim(), 10) / 1024;
  } catch (_) { return 0; }
}

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true });
  const page = await ctx.newPage();
  const samples = [];
  const sampler = setInterval(() => { samples.push(browserRssMB()); }, 50);
  const before = browserRssMB();
  await page.goto(fileUrl(path.join(LIVE, "p10-browser.html")));
  await page.setInputFiles("#file", path.join(POC, "poc-p10-synthetic-100000.csv"));
  await page.waitForFunction(() => window.__p10done === true, null, { timeout: 120000 });
  clearInterval(sampler);
  const after = browserRssMB();
  const log = (await page.locator("#log").textContent()) || "";
  const peak = samples.length ? Math.max(...samples) : null;
  console.log("P-10 RSS (this browser only): before=" + before.toFixed(1) + " MB, peak=" + (peak !== null ? peak.toFixed(1) : "n/a") + " MB, after=" + after.toFixed(1) + " MB, samples=" + samples.length);
  console.log("P-10 times:", (log.match(/import ms: .*/g) || [])[0], "|", (log.match(/calc\+reconciliation ms: .*/g) || [])[0], "|", (log.match(/total \(import\+calc\) ms: .*/g) || [])[0]);
  console.log("P-10 heap:", (log.match(/heap after calc: .*/g) || [])[0]);
  const R = JSON.parse(fs.readFileSync(path.join(LIVE, "results.json"), "utf8"));
  R.probes.p10.rss = { beforeMB: +before.toFixed(1), peakMB: peak !== null ? +peak.toFixed(1) : null, afterMB: +after.toFixed(1), samples: samples.length, method: "sum of RSS of Chromium processes whose command line contains the test browser's user-data-dir, sampled every 50 ms" };
  fs.writeFileSync(path.join(LIVE, "results.json"), JSON.stringify(R, null, 2));
  await ctx.close();
}

main().catch((e) => { console.error("RSS RUN ERROR:", e); process.exit(1); });
