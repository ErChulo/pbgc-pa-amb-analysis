"use strict";
// Follow-up: (a) re-run P-05 with a proper wait for the async IndexedDB lines
// (the first run captured the log before the IDB callbacks fired), fresh profile;
// (b) re-run P-10 while sampling the Chromium process RSS from the shell, so
// the peak-memory figure is a process measure, not just in-page JS heap.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const STAGE3 = "/home/hatch/workspace/pbgc-pa-amb-analysis/stage3";
const POC = path.join(STAGE3, "poc");
const LIVE = path.join(STAGE3, "live-test");
const fileUrl = (p) => "file://" + p;

function chromiumRssMB() {
  try {
    const out = execSync("ps -eo rss,comm | awk '/chrom/ {s+=$1} END {print s+0}'", { encoding: "utf8" });
    return parseInt(out.trim(), 10) / 1024;
  } catch (_) { return null; }
}

async function waitForLog(page, needle, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const t = (await page.locator("#log").textContent()) || "";
    if (t.includes(needle)) return t;
    await page.waitForTimeout(150);
  }
  return (await page.locator("#log").textContent()) || "";
}

async function main() {
  const R = JSON.parse(fs.readFileSync(path.join(LIVE, "results.json"), "utf8"));
  // Fix the P-01 summary bug: both runs passed, but the probe object had no
  // top-level .pass field, so the summary printed FAIL.
  R.probes.p01.pass = R.probes.p01.first.pass && R.probes.p01.afterRestart.pass;

  const browser = await chromium.launch({ headless: true });

  // ---- P-05 re-run, fresh profile, wait for the IndexedDB lines ----
  {
    const profile = path.join(LIVE, "profile-p05b");
    fs.rmSync(profile, { recursive: true, force: true });
    let ctx = await chromium.launchPersistentContext(profile, { headless: true });
    let pg = await ctx.newPage();
    await pg.goto(fileUrl(path.join(POC, "poc-p05-storage.html")));
    // Wait until an IndexedDB line appears (success or error), up to 10 s.
    let log1 = "";
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      log1 = (await pg.locator("#log").textContent()) || "";
      if (log1.includes("IndexedDB marker read back") || log1.includes("IndexedDB ERROR")) break;
      await pg.waitForTimeout(150);
    }
    const idb1 = (log1.match(/IndexedDB.*/g) || []).join(" | ");
    const ls1 = (log1.match(/localStorage usable: .*/g) || [""])[0];
    await ctx.close();
    // Restart: reopen the probe and wait for the IndexedDB lines again.
    ctx = await chromium.launchPersistentContext(profile, { headless: true });
    pg = await ctx.newPage();
    await pg.goto(fileUrl(path.join(POC, "poc-p05-storage.html")));
    let log2 = "";
    const t1 = Date.now();
    while (Date.now() - t1 < 10000) {
      log2 = (await pg.locator("#log").textContent()) || "";
      if (log2.includes("IndexedDB marker read back") || log2.includes("IndexedDB ERROR")) break;
      await pg.waitForTimeout(150);
    }
    const idb2 = (log2.match(/IndexedDB.*/g) || []).join(" | ");
    const prev2 = (log2.match(/previous localStorage marker: .*/g) || [""])[0];
    await ctx.close();
    // Cross-file reader (different path) with a proper wait.
    ctx = await chromium.launchPersistentContext(profile, { headless: true });
    pg = await ctx.newPage();
    await pg.goto(fileUrl(path.join(LIVE, "p05-reader.html")));
    const readerLog = await waitForLog(pg, "READER DONE", 15000);
    await ctx.close();
    R.probes.p05.followup = {
      run1: { localStorage: ls1, indexedDB: idb1 },
      afterRestart: { previousLocalStorage: prev2, indexedDB: idb2 },
      crossFileReader: readerLog,
    };
    R.probes.p05.pass = R.probes.p05.pass && idb1.includes("IndexedDB marker read back") && idb2.includes("IndexedDB marker read back");
    console.log("P-05 follow-up run1 IDB:", idb1);
    console.log("P-05 follow-up restart IDB:", idb2);
    console.log("P-05 follow-up reader:", readerLog.replace(/\n/g, " | "));
    console.log("P-05 pass now:", R.probes.p05.pass);
  }

  // ---- P-10 re-run with Chromium process RSS sampling ----
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const rssSamples = [];
    const sampler = setInterval(() => { const v = chromiumRssMB(); if (v !== null) rssSamples.push(v); }, 150);
    const rssBefore = chromiumRssMB();
    await page.goto(fileUrl(path.join(LIVE, "p10-browser.html")));
    await page.setInputFiles("#file", path.join(POC, "poc-p10-synthetic-100000.csv"));
    await page.waitForFunction(() => window.__p10done === true, null, { timeout: 120000 });
    clearInterval(sampler);
    const rssAfter = chromiumRssMB();
    const log = (await page.locator("#log").textContent()) || "";
    const peak = rssSamples.length ? Math.max(...rssSamples) : null;
    R.probes.p10.followup = {
      rssBeforeMB: rssBefore, rssAfterMB: rssAfter, peakRssMB: peak,
      samples: rssSamples.length,
      importMs: (log.match(/import ms: .*/g) || [])[0] || null,
      calcMs: (log.match(/calc\+reconciliation ms: .*/g) || [])[0] || null,
      totalMs: (log.match(/total \(import\+calc\) ms: .*/g) || [])[0] || null,
    };
    console.log("P-10 follow-up: rssBefore=" + rssBefore + " MB, peak=" + peak + " MB, rssAfter=" + rssAfter + " MB, samples=" + rssSamples.length);
    console.log("P-10 follow-up times:", R.probes.p10.followup.importMs, R.probes.p10.followup.calcMs, R.probes.p10.followup.totalMs);
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(LIVE, "results.json"), JSON.stringify(R, null, 2));
  const passes = Object.entries(R.probes).map(([k, v]) => k + "=" + (v.pass ? "PASS" : "FAIL")).join(", ");
  console.log("SUMMARY: " + passes);
}

main().catch((e) => { console.error("FOLLOW-UP ERROR:", e); process.exit(1); });
