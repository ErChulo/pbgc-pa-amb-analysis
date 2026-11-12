"use strict";
// PA_AMB Stage 3 — live file:// browser test via Playwright.
// Runs the P-01..P-10 run sheet (01-poc-results.md §6) in Chromium (Playwright)
// on Linux under file://. Every result is labelled Chromium (Playwright) on
// Linux, file:// — NOT Microsoft Edge on Windows, NOT the restricted office
// workstation. The definitive Edge-on-Windows test still stands.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const STAGE3 = "/home/hatch/workspace/pbgc-pa-amb-analysis/stage3";
const POC = path.join(STAGE3, "poc");
const LIVE = path.join(STAGE3, "live-test");
const fileUrl = (p) => "file://" + p;
const R = { identity: {}, probes: {}, stopCondition: false, notes: [] };

function logLine(s) { console.log(s); }

async function newCapturedPage(context) {
  const page = await context.newPage();
  const cap = { console: [], pageErrors: [], failedRequests: [], requests: [] };
  page.on("console", (m) => cap.console.push(m.type() + ": " + m.text()));
  page.on("pageerror", (e) => cap.pageErrors.push(String(e)));
  page.on("requestfailed", (r) => cap.failedRequests.push(r.url() + " :: " + (r.failure() ? r.failure().errorText : "?")));
  page.on("request", (r) => cap.requests.push(r.url()));
  return { page, cap };
}

async function getLog(page) {
  return (await page.locator("#log").textContent()) || "";
}

async function waitForLog(page, needle, timeoutMs) {
  await page.locator("#log").waitFor({ state: "attached", timeout: timeoutMs });
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const t = await getLog(page);
    if (t.includes(needle)) return t;
    await page.waitForTimeout(100);
  }
  return await getLog(page);
}

async function main() {
  R.identity.node = process.version;
  R.identity.playwright = require("playwright/package.json").version;
  R.identity.platform = process.platform + " " + process.arch;

  const browser = await chromium.launch({ headless: true });
  R.identity.chromium = browser.version();
  const uaPage = await browser.newPage();
  R.identity.userAgent = await uaPage.evaluate(() => navigator.userAgent);
  R.identity.platformDetail = await uaPage.evaluate(() => navigator.platform);
  await uaPage.close();
  logLine("Browser identity: Chromium " + R.identity.chromium + " (Playwright " + R.identity.playwright + "), Node " + R.identity.node);
  logLine("UserAgent: " + R.identity.userAgent);

  // ---- P-06 FIRST as an environment gate (stop condition) ----
  {
    const ctx = await browser.newContext();
    const { page, cap } = await newCapturedPage(ctx);
    await page.goto(fileUrl(path.join(POC, "poc-p06-negative-control.html")));
    await page.waitForTimeout(3000);
    const log = await getLog(page);
    const fetchLine = (log.match(/fetch:.*/g) || ["(no fetch line)"])[0];
    const streamLine = (log.match(/instantiateStreaming:.*/g) || ["(no instantiateStreaming line)"])[0];
    const dynLine = (log.match(/ES module import:.*/g) || ["(no dynamic import line)"])[0];
    const originLine = (log.match(/location\.origin:.*/g) || ["(no origin line)"])[0];
    const staticSuccess = cap.console.some((c) => c.includes("UNEXPECTED SUCCESS"));
    const anySuccess = log.includes("UNEXPECTED SUCCESS") || staticSuccess;
    R.probes.p06 = {
      origin: originLine, fetch: fetchLine, instantiateStreaming: streamLine,
      dynamicImport: dynLine,
      staticImportConsole: cap.console.filter((c) => c.toLowerCase().includes("module") || c.includes("UNEXPECTED")),
      pageErrors: cap.pageErrors, failedRequests: cap.failedRequests,
      pass: !anySuccess && fetchLine.includes("failed as expected") && streamLine.includes("failed as expected") && dynLine.includes("failed as expected"),
    };
    logLine("P-06 gate: pass=" + R.probes.p06.pass + " (anySuccess=" + anySuccess + ")");
    await ctx.close();
    if (anySuccess) {
      R.stopCondition = true;
      R.notes.push("P-06 STOP CONDITION TRIGGERED: a forbidden attempt succeeded. The environment is not the restricted one. The run stopped here; no other probe result can be trusted.");
      fs.writeFileSync(path.join(LIVE, "results.json"), JSON.stringify(R, null, 2));
      logLine("STOP: P-06 forbidden attempt succeeded. Aborting the run.");
      await browser.close();
      process.exit(1);
    }
  }

  // ---- P-01 (twice: fresh launch, then after a browser restart) ----
  async function runP01(label) {
    const ctx = await browser.newContext();
    const { page, cap } = await newCapturedPage(ctx);
    const t0 = Date.now();
    await page.goto(fileUrl(path.join(POC, "poc-p01-wasm-embed.html")));
    const log = await waitForLog(page, "P-01 RESULT:", 15000);
    const addLine = (log.match(/add\(2,3\) = .*/g) || ["(no add line)"])[0];
    const msLine = (log.match(/instantiate ms: .*/g) || ["(no ms line)"])[0];
    const resLine = (log.match(/P-01 RESULT: .*/g) || ["(no result line)"])[0];
    const out = { label, add: addLine, instantiateMs: msLine, result: resLine, wallMs: Date.now() - t0, consoleErrors: cap.console.filter((c) => c.startsWith("error")), pageErrors: cap.pageErrors, pass: log.includes("P-01 RESULT: PASS") };
    await ctx.close();
    return out;
  }
  const p01a = await runP01("first launch");
  await browser.close();
  // Restart the browser (new launch = new process) and repeat P-01.
  const browser2 = await chromium.launch({ headless: true });
  R.probes.p01 = { first: p01a };
  const p01b = await (async () => {
    const ctx = await browser2.newContext();
    const { page, cap } = await newCapturedPage(ctx);
    await page.goto(fileUrl(path.join(POC, "poc-p01-wasm-embed.html")));
    const log = await waitForLog(page, "P-01 RESULT:", 15000);
    const out = {
      label: "after browser restart",
      add: (log.match(/add\(2,3\) = .*/g) || ["(no add line)"])[0],
      instantiateMs: (log.match(/instantiate ms: .*/g) || ["(no ms line)"])[0],
      result: (log.match(/P-01 RESULT: .*/g) || ["(no result line)"])[0],
      consoleErrors: cap.console.filter((c) => c.startsWith("error")), pageErrors: cap.pageErrors,
      pass: log.includes("P-01 RESULT: PASS"),
    };
    await ctx.close();
    return out;
  })();
  R.probes.p01.afterRestart = p01b;
  logLine("P-01: first pass=" + p01a.pass + ", after-restart pass=" + p01b.pass);

  // ---- P-02 ----
  {
    const ctx = await browser2.newContext();
    const { page, cap } = await newCapturedPage(ctx);
    const nav0 = Date.now();
    await page.goto(fileUrl(path.join(POC, "poc-p02-wasm-kernel.html")));
    const log = await waitForLog(page, "P-02 RESULT:", 15000);
    const navMs = Date.now() - nav0;
    // Responsiveness check: main-thread round trip after load.
    const rt0 = Date.now();
    await page.evaluate(() => 1 + 1);
    const roundTripMs = Date.now() - rt0;
    // The probe page does not expose sum_i64/count_outside; re-instantiate the
    // SAME kernel bytes in-page and call all five exports (Node verifier calls).
    const html = fs.readFileSync(path.join(POC, "poc-p02-wasm-kernel.html"), "utf8");
    const b64 = html.match(/var B64 = "([^"]+)"/)[1];
    const extra = await page.evaluate(async (b64in) => {
      const bin = atob(b64in);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const { instance } = await WebAssembly.instantiate(bytes, {});
      const ex = instance.exports;
      const view = new BigInt64Array(ex.memory.buffer);
      view.set([100n, 200n, 300n], 0);
      return {
        add: ex.add(2, 3),
        accrual: ex.accrual_monthly_cents(150n, 20000n, 500000n).toString(),
        delta: ex.delta_cents(150000n, 149500n).toString(),
        sum: ex.sum_i64(0, 3).toString(),
        countOutside: ex.count_outside(0, 3, 150n, 250n).toString(),
      };
    }, b64);
    R.probes.p02 = {
      log, navToPassMs: navMs, roundTripMs,
      probeValues: {
        add: (log.match(/add\(2,3\) = .*/g) || [])[0] || null,
        accrual: (log.match(/accrual\(150,20000,500000\) = .*/g) || [])[0] || null,
        delta: (log.match(/delta\(150000,149500\) = .*/g) || [])[0] || null,
        instantiateMs: (log.match(/instantiate ms: .*/g) || [])[0] || null,
      },
      allFiveExports: extra,
      expected: { add: 5, accrual: "150000", delta: "500", sum: "600", countOutside: "2" },
      consoleErrors: cap.console.filter((c) => c.startsWith("error")), pageErrors: cap.pageErrors,
      pass: log.includes("P-02 RESULT: PASS") && extra.add === 5 && extra.accrual === "150000" && extra.delta === "500" && extra.sum === "600" && extra.countOutside === "2",
    };
    logLine("P-02: pass=" + R.probes.p02.pass + ", allFive=" + JSON.stringify(extra));
    await ctx.close();
  }

  // ---- P-03 ----
  {
    const ctx = await browser2.newContext();
    const { page, cap } = await newCapturedPage(ctx);
    await page.goto(fileUrl(path.join(POC, "poc-p03-blob-worker.html")));
    const log = await waitForLog(page, "P-03 RESULT:", 15000);
    R.probes.p03 = {
      log,
      pong: (log.match(/worker replied: \{"type":"pong".*/g) || [])[0] || null,
      wasmResult: (log.match(/worker replied: \{"type":"wasm-result".*/g) || [])[0] || null,
      result: (log.match(/P-03 RESULT: .*/g) || [])[0] || null,
      consoleErrors: cap.console.filter((c) => c.startsWith("error")), pageErrors: cap.pageErrors,
      pass: log.includes("P-03 RESULT: PASS"),
    };
    logLine("P-03: pass=" + R.probes.p03.pass);
    await ctx.close();
  }

  // ---- P-04 (persistent profile: restart + move + origin keying) ----
  {
    const profile = path.join(LIVE, "profile-p04");
    fs.rmSync(profile, { recursive: true, force: true });
    const probeName = "poc-p04-opfs.html";
    const probePath = path.join(POC, probeName);
    const movedPath = path.join(POC, "poc-p04-opfs-moved.html");
    const readerCopy = path.join(POC, "opfs-reader.html");
    try {
      // Run 1: probe writes the marker.
      let ctx = await chromium.launchPersistentContext(profile, { headless: true });
      let pg = await ctx.newPage();
      await pg.goto(fileUrl(probePath));
      const log1 = await waitForLog(pg, "P-04 main-thread RESULT:", 15000);
      const marker1 = (log1.match(/marker read back: .*/g) || ["(no marker line)"])[0];
      const est1 = (log1.match(/storage estimate: .*/g) || ["(no estimate line)"])[0];
      const origin1 = (log1.match(/location\.origin: .*/g) || [""])[0];
      const secure1 = (log1.match(/isSecureContext: .*/g) || [""])[0];
      await ctx.close();
      // Restart: relaunch same profile, read via reader at a DIFFERENT path
      // (live-test/) and via a reader copy in the SAME directory (poc/).
      fs.copyFileSync(path.join(LIVE, "opfs-reader.html"), readerCopy);
      ctx = await chromium.launchPersistentContext(profile, { headless: true });
      pg = await ctx.newPage();
      await pg.goto(fileUrl(path.join(LIVE, "opfs-reader.html")));
      const readerDiffPath = await waitForLog(pg, "READER DONE", 15000);
      await pg.goto(fileUrl(readerCopy));
      const readerSameDir = await waitForLog(pg, "READER DONE", 15000);
      await ctx.close();
      // Move the probe file, then read again (both readers) before opening it.
      fs.renameSync(probePath, movedPath);
      ctx = await chromium.launchPersistentContext(profile, { headless: true });
      pg = await ctx.newPage();
      await pg.goto(fileUrl(path.join(LIVE, "opfs-reader.html")));
      const readerAfterMoveDiff = await waitForLog(pg, "READER DONE", 15000);
      await pg.goto(fileUrl(readerCopy));
      const readerAfterMoveSame = await waitForLog(pg, "READER DONE", 15000);
      // Open the MOVED probe: writes a new marker, proves OPFS works at the new path.
      await pg.goto(fileUrl(movedPath));
      const logMoved = await waitForLog(pg, "P-04 main-thread RESULT:", 15000);
      await ctx.close();
      R.probes.p04 = {
        run1: { origin: origin1, secureContext: secure1, marker: marker1, estimate: est1, result: (log1.match(/P-04 main-thread RESULT: .*/g) || [])[0] || null },
        afterRestartDifferentPath: readerDiffPath,
        afterRestartSameDir: readerSameDir,
        afterMoveDifferentPath: readerAfterMoveDiff,
        afterMoveSameDir: readerAfterMoveSame,
        movedProbeLog: logMoved,
        pass: log1.includes("P-04 main-thread RESULT: PASS") && readerDiffPath.includes("marker exists: YES") && logMoved.includes("P-04 main-thread RESULT: PASS"),
      };
      logLine("P-04: run1 pass=" + log1.includes("P-04 main-thread RESULT: PASS") + ", restart-diff-path marker=" + (readerDiffPath.includes("marker exists: YES") ? "YES" : "NO"));
    } finally {
      if (fs.existsSync(movedPath)) fs.renameSync(movedPath, probePath);
      if (fs.existsSync(readerCopy)) fs.unlinkSync(readerCopy);
    }
  }

  // ---- P-05 (persistent profile: restart + move + cross-file) ----
  {
    const profile = path.join(LIVE, "profile-p05");
    fs.rmSync(profile, { recursive: true, force: true });
    const probeName = "poc-p05-storage.html";
    const probePath = path.join(POC, probeName);
    const movedPath = path.join(POC, "poc-p05-storage-moved.html");
    const readerCopy = path.join(POC, "p05-reader.html");
    try {
      let ctx = await chromium.launchPersistentContext(profile, { headless: true });
      let pg = await ctx.newPage();
      await pg.goto(fileUrl(probePath));
      const log1 = await waitForLog(pg, "P-05 OVERALL:", 15000);
      await ctx.close();
      // Restart: the probe itself reports the previous localStorage marker.
      ctx = await chromium.launchPersistentContext(profile, { headless: true });
      pg = await ctx.newPage();
      await pg.goto(fileUrl(probePath));
      const log2 = await waitForLog(pg, "P-05 OVERALL:", 15000);
      const prevMarker = (log2.match(/previous localStorage marker: .*/g) || ["(no previous-marker line)"])[0];
      // Cross-file check: a DIFFERENT local HTML file reads the markers.
      fs.copyFileSync(path.join(LIVE, "p05-reader.html"), readerCopy);
      await pg.goto(fileUrl(path.join(LIVE, "p05-reader.html")));
      const readerDiffPath = await waitForLog(pg, "READER DONE", 15000);
      await pg.goto(fileUrl(readerCopy));
      const readerSameDir = await waitForLog(pg, "READER DONE", 15000);
      await ctx.close();
      // Move the probe, then reopen it and re-read.
      fs.renameSync(probePath, movedPath);
      ctx = await chromium.launchPersistentContext(profile, { headless: true });
      pg = await ctx.newPage();
      await pg.goto(fileUrl(movedPath));
      const logMoved = await waitForLog(pg, "P-05 OVERALL:", 15000);
      const prevAfterMove = (logMoved.match(/previous localStorage marker: .*/g) || ["(no previous-marker line)"])[0];
      await pg.goto(fileUrl(path.join(LIVE, "p05-reader.html")));
      const readerAfterMove = await waitForLog(pg, "READER DONE", 15000);
      await ctx.close();
      R.probes.p05 = {
        run1: log1, afterRestart: { log: log2, previousMarker: prevMarker },
        crossFileDifferentPath: readerDiffPath, crossFileSameDir: readerSameDir,
        afterMove: { log: logMoved, previousMarker: prevAfterMove },
        crossFileAfterMove: readerAfterMove,
        pass: log1.includes("localStorage usable: true") && !prevMarker.includes("(none") && readerDiffPath.includes("localStorage marker: written"),
      };
      logLine("P-05: run1 ls usable=" + log1.includes("localStorage usable: true") + ", after-restart prev=" + prevMarker);
    } finally {
      if (fs.existsSync(movedPath)) fs.renameSync(movedPath, probePath);
      if (fs.existsSync(readerCopy)) fs.unlinkSync(readerCopy);
    }
  }

  // ---- P-07 (downloads) ----
  {
    const dlDir = path.join(LIVE, "downloads");
    fs.mkdirSync(dlDir, { recursive: true });
    const ctx = await browser2.newContext({ acceptDownloads: true });
    const { page } = await newCapturedPage(ctx);
    await page.goto(fileUrl(path.join(POC, "poc-p07-export-download.html")));
    const dl1 = page.waitForEvent("download", { timeout: 15000 });
    await page.click("#bJson");
    const d1 = await dl1;
    const p1 = path.join(dlDir, "pa-amb-p07-case.json");
    await d1.saveAs(p1);
    const c1 = fs.readFileSync(p1, "utf8");
    const dl2 = page.waitForEvent("download", { timeout: 15000 });
    await page.click("#bCsv");
    const d2 = await dl2;
    const p2 = path.join(dlDir, "pa-amb-p07-reconciliation.csv");
    await d2.saveAs(p2);
    const c2 = fs.readFileSync(p2, "utf8");
    R.probes.p07 = {
      json: { suggestedName: d1.suggestedFilename(), savedBytes: fs.statSync(p1).size, content: c1, matches: c1 === JSON.stringify({ formatVersion: "1.0.0", case: "SYNTHETIC-P07", participants: 3 }, null, 2) },
      csv: { suggestedName: d2.suggestedFilename(), savedBytes: fs.statSync(p2).size, content: c2, matches: c2 === "participantKey,paAmbCents,reconCents,deltaCents\nSYN-001,150000,150000,0\nSYN-002,150000,149500,500\n" },
      pass: d1.suggestedFilename() === "pa-amb-p07-case.json" && d2.suggestedFilename() === "pa-amb-p07-reconciliation.csv",
    };
    R.probes.p07.pass = R.probes.p07.pass && R.probes.p07.json.matches && R.probes.p07.csv.matches;
    logLine("P-07: pass=" + R.probes.p07.pass + ", json=" + R.probes.p07.json.suggestedName + " (" + R.probes.p07.json.savedBytes + " B), csv=" + R.probes.p07.csv.suggestedName + " (" + R.probes.p07.csv.savedBytes + " B)");
    await ctx.close();
  }

  // ---- P-08 (request counts) ----
  async function countRequests(file) {
    const ctx = await browser2.newContext();
    const { page, cap } = await newCapturedPage(ctx);
    await page.goto(fileUrl(path.join(POC, file)));
    await page.waitForTimeout(1500);
    await page.reload();
    await page.waitForTimeout(1500);
    const all = cap.requests;
    const http = all.filter((u) => /^(https?:|wss?:|data:|blob:)/.test(u));
    const fileReqs = all.filter((u) => u.startsWith("file://"));
    await ctx.close();
    return { total: all.length, httpLike: http.length, httpUrls: http, fileDocRequests: fileReqs.length };
  }
  R.probes.p08 = {
    zeroFetch: await countRequests("poc-p08-zero-fetch.html"),
    wasmKernel: await countRequests("poc-p02-wasm-kernel.html"),
  };
  R.probes.p08.pass = R.probes.p08.zeroFetch.httpLike === 0 && R.probes.p08.wasmKernel.httpLike === 0;
  logLine("P-08: zero-fetch http=" + R.probes.p08.zeroFetch.httpLike + " (total " + R.probes.p08.zeroFetch.total + "), wasm-kernel http=" + R.probes.p08.wasmKernel.httpLike + " (total " + R.probes.p08.wasmKernel.total + ")");

  // ---- P-09 (dark theme) ----
  {
    const ctx = await browser2.newContext();
    const { page, cap } = await newCapturedPage(ctx);
    await page.goto(fileUrl(path.join(POC, "poc-p09-dark-theme.html")));
    await page.waitForTimeout(1500);
    const dark = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      const th = document.querySelector("th");
      return {
        bodyBg: cs.backgroundColor, bodyFg: cs.color,
        thBg: th ? getComputedStyle(th).backgroundColor : null,
        rows: document.querySelectorAll("#tb tr").length,
        status: document.getElementById("status").textContent,
        math: document.body.textContent.includes("B") && document.body.textContent.includes("Δ"),
      };
    });
    await page.click("#toggle");
    await page.waitForTimeout(300);
    const light = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      const th = document.querySelector("th");
      return { bodyBg: cs.backgroundColor, bodyFg: cs.color, thBg: th ? getComputedStyle(th).backgroundColor : null, theme: document.body.getAttribute("data-theme") };
    });
    await page.click("#toggle");
    await page.waitForTimeout(300);
    const backDark = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return { bodyBg: cs.backgroundColor, bodyFg: cs.color, theme: document.body.getAttribute("data-theme") };
    });
    const httpReqs = cap.requests.filter((u) => /^(https?:|wss?:|data:)/.test(u));
    R.probes.p09 = {
      dark, light, backDark,
      httpRequests: httpReqs.length,
      pass: dark.bodyBg === "rgb(0, 0, 0)" && dark.bodyFg === "rgb(242, 240, 233)" && dark.rows === 1000
        && light.bodyBg === "rgb(255, 255, 255)" && light.thBg === "rgb(0, 45, 114)" && light.theme === "light"
        && backDark.bodyBg === "rgb(0, 0, 0)" && backDark.theme === "dark" && httpReqs.length === 0,
    };
    logLine("P-09: pass=" + R.probes.p09.pass + ", dark bg=" + dark.bodyBg + ", rows=" + dark.rows + ", light th=" + light.thBg);
    await ctx.close();
  }

  // ---- P-10 (file picker, 100k rows) ----
  {
    const ctx = await browser2.newContext();
    const { page, cap } = await newCapturedPage(ctx);
    await page.goto(fileUrl(path.join(LIVE, "p10-browser.html")));
    await page.setInputFiles("#file", path.join(POC, "poc-p10-synthetic-100000.csv"));
    await page.waitForFunction(() => window.__p10done === true, null, { timeout: 120000 });
    const log = await getLog(page);
    R.probes.p10 = {
      log,
      importMs: (log.match(/import ms: .*/g) || [])[0] || null,
      calcMs: (log.match(/calc\+reconciliation ms: .*/g) || [])[0] || null,
      totalMs: (log.match(/total \(import\+calc\) ms: .*/g) || [])[0] || null,
      counts: (log.match(/exact: .*/g) || [])[0] || null,
      tolerance: (log.match(/within \$5 tolerance: .*/g) || [])[0] || null,
      bounds: (log.match(/PA inside bounds: .*/g) || [])[0] || null,
      meanMax: (log.match(/mean \|delta\|: .*/g) || [])[0] || null,
      heapBefore: (log.match(/heap before import: .*/g) || [])[0] || null,
      heapAfterImport: (log.match(/heap after import: .*/g) || [])[0] || null,
      heapAfterCalc: (log.match(/heap after calc: .*/g) || [])[0] || null,
      consoleErrors: cap.console.filter((c) => c.startsWith("error")), pageErrors: cap.pageErrors,
      pass: log.includes("P-10 BROWSER RESULT: PASS"),
    };
    logLine("P-10: pass=" + R.probes.p10.pass + ", " + R.probes.p10.importMs + ", " + R.probes.p10.calcMs + ", " + R.probes.p10.totalMs);
    await ctx.close();
  }

  await browser2.close();
  fs.writeFileSync(path.join(LIVE, "results.json"), JSON.stringify(R, null, 2));
  logLine("Results written to live-test/results.json");
  const passes = Object.entries(R.probes).map(([k, v]) => k + "=" + (v.pass ? "PASS" : "FAIL")).join(", ");
  logLine("SUMMARY: " + passes);
}

main().catch((e) => {
  console.error("RUNNER ERROR:", e);
  try { fs.writeFileSync(path.join(LIVE, "results.json"), JSON.stringify(R, null, 2)); } catch (_) {}
  process.exit(1);
});
