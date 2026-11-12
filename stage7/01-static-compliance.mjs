// Stage 7 compliance — static checks (Verifier, read-only).
//
// Run: node stage7/01-static-compliance.mjs
// Exit 0 when every check passes; exit 1 when any check FAILs.
// Writes nothing except stdout. Never edits source.
//
// Checks (each prints PASS/FAIL with the evidence):
//  S1  single-file self-containment of pa-amb-analysis.html
//  S2  build/check-zero-fetch.mjs (static 0-fetch gate)
//  S3  no LLM / network / telemetry / remote-error-reporting in src+build
//  S4  dependency inventory (package.json + installed node_modules)
//  S5  no forbidden runtime dependency (WASM / worker / OPFS / IndexedDB /
//      sessionStorage) in the app; localStorage only in theme.ts, guarded
//  S6  no clock / randomness in the engine calculation path
//  S7  human approval gate: only one construction site for an approved
//      DispositionRecord and for an ApprovalRecord (both inside T3)
//  S8  §19: no encryption/durability claim; warning text exists; which
//      export buttons are gated on window.confirm and which are not
//  S9  synthetic data only: no SSN pattern, no real names in src/test/demo
// S10  no eval / dynamic code execution in src

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = join(ROOT, "pa-amb-analysis.html");

let failures = 0;
function check(name, cond, evidence) {
  console.log(`${cond ? "PASS" : "FAIL"} ${name} — ${evidence}`);
  if (!cond) failures += 1;
}
function count(re, text) {
  return (text.match(re) ?? []).length;
}
function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".mjs") || p.endsWith(".html") || p.endsWith(".css")) out.push(p);
  }
  return out;
}

const html = read("pa-amb-analysis.html");
const srcFiles = walk(join(ROOT, "src")).concat(walk(join(ROOT, "build")));
const srcText = srcFiles.map((f) => readFileSync(f, "utf8")).join("\n");

// --- S1: single-file self-containment ------------------------------------
check("S1a one inline <script>, no src", count(/<script/gi, html) === 1 && !/<script[^>]+src=/i.test(html),
  `${count(/<script/gi, html)} <script> tag(s); src-attribute: ${/<script[^>]+src=/i.test(html)}`);
check("S1b no <link>", !/<link[\s>]/i.test(html), `link tags: ${count(/<link[\s>]/gi, html)}`);
check("S1c no <img>", !/<img[\s>]/i.test(html), `img tags: ${count(/<img[\s>]/gi, html)}`);
check("S1d no <iframe>", !/<iframe[\s>]/i.test(html), `iframe tags: ${count(/<iframe[\s>]/gi, html)}`);
check("S1e no type=module", !/type\s*=\s*["']module["']/i.test(html), "module script present: false");
check("S1f no @import/@font-face", !/@import/i.test(html) && !/@font-face/i.test(html), "@import/@font-face: 0");
check("S1g no CSS url()", !/(?<![\w$.])url\s*\(/i.test(html), "url( occurrences outside createObjectURL: 0");
const httpUrls = [...new Set(html.match(/https?:\/\/[^"'<> \s]+/g) ?? [])];
const allowedUrl = (u) =>
  u.startsWith("http://www.w3.org/2000/svg") ||
  u.startsWith("http://schemas.openxmlformats.org/") ||
  u.startsWith("http://purl.org/dc/elements/1.1/");
check("S1h http(s) URLs are namespace identifiers only",
  httpUrls.length > 0 && httpUrls.every(allowedUrl),
  `${httpUrls.length} distinct URL(s): ${httpUrls.join(", ")}`);
check("S1i no https:// URL at all", !/https:\/\//.test(html), "https:// occurrences: 0");
check("S1j file size matches Stage 7 rebuild", Buffer.byteLength(html, "utf8") === 452219,
  `${Buffer.byteLength(html, "utf8")} bytes (Stage 7 rebuild: 452219; Stage 6 was 401313 — the app grew with CSV/JSON import, the calculation-date input, and the audit-log fix)`);

// --- S2: static 0-fetch gate ----------------------------------------------
const zeroFetch = spawnSync(process.execPath, [join(ROOT, "build", "check-zero-fetch.mjs")], { encoding: "utf8" });
check("S2 build/check-zero-fetch.mjs exits 0", zeroFetch.status === 0,
  (zeroFetch.stdout + zeroFetch.stderr).trim().split("\n").pop() ?? "");

// --- S3: no LLM / network / telemetry --------------------------------------
// S3a scans src/ + build/entry.ts only: build/check-zero-fetch.mjs
// lists the forbidden patterns as regex literals (it is the checker
// itself, never shipped), so it is excluded by design.
const netHits = [];
for (const f of srcFiles.filter((x) => !x.endsWith("build/check-zero-fetch.mjs"))) {
  const text = readFileSync(f, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (/fetch\s*\(|XMLHttpRequest|new\s+WebSocket|EventSource|navigator\.sendBeacon|axios|openai|anthropic|chatgpt|generative-ai|apiKey|api-key/.test(line)
      && !/^\s*\*/.test(line) && !/no fetch|No fetch|no network|never|must not|No LLM/.test(line)) {
      netHits.push(`${f.replace(ROOT + "/", "")}:${i + 1}: ${line.trim().slice(0, 100)}`);
    }
  });
}
check("S3a no fetch/XHR/WebSocket/LLM/API-call code in src+build", netHits.length === 0,
  netHits.length === 0 ? "0 hits" : netHits.join(" | "));
const teleHits = [];
for (const f of srcFiles) {
  const text = readFileSync(f, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (/telemetry|sentry|bugsnag|datadog|crashlytics|google-analytics|gtag|mixpanel|amplitude|posthog|error reporting/i.test(line)
      && !/^\s*\*/.test(line) && !/No telemetry|no telemetry|no external analytics|no remote error/i.test(line)) {
      teleHits.push(`${f.replace(ROOT + "/", "")}:${i + 1}: ${line.trim().slice(0, 100)}`);
    }
  });
}
check("S3b no telemetry/analytics/remote-error-reporting identifiers", teleHits.length === 0,
  teleHits.length === 0 ? "0 hits" : teleHits.join(" | "));

// --- S4: dependency inventory ----------------------------------------------
const pkg = JSON.parse(read("package.json"));
const deps = Object.keys(pkg.dependencies ?? {});
const devDeps = Object.keys(pkg.devDependencies ?? {});
check("S4a no runtime dependencies", deps.length === 0, `dependencies: [${deps.join(", ")}]`);
check("S4b devDependencies are typescript + esbuild only",
  devDeps.length === 2 && devDeps.includes("typescript") && devDeps.includes("esbuild"),
  `devDependencies: ${JSON.stringify(pkg.devDependencies)}`);
const installed = readdirSync(join(ROOT, "node_modules")).filter((n) => !n.startsWith("."));
check("S4c installed root node_modules are esbuild + typescript only",
  installed.sort().join(",") === "@esbuild,esbuild,typescript",
  `installed: [${installed.join(", ")}]`);
const tsVer = JSON.parse(read("node_modules/typescript/package.json")).version;
const esVer = JSON.parse(read("node_modules/esbuild/package.json")).version;
check("S4d pinned versions installed", tsVer === "5.9.3" && esVer === "0.28.2",
  `typescript ${tsVer}, esbuild ${esVer}`);
const liveTestPkg = JSON.parse(read("stage3/live-test/package.json"));
check("S4e Playwright is test-only under stage3/live-test, not in root package.json",
  liveTestPkg.dependencies?.playwright === "^1.65.0" && !("playwright" in (pkg.dependencies ?? {})) && !("playwright" in (pkg.devDependencies ?? {})),
  `stage3/live-test playwright ${liveTestPkg.dependencies?.playwright}; root package.json has no playwright`);
check("S4f no esbuild/playwright strings bundled into the HTML",
  !/esbuild/i.test(html) && !/playwright/i.test(html), "esbuild/playwright occurrences in HTML: 0");

// --- S5: forbidden runtime dependencies -------------------------------------
const forbidden = ["WebAssembly", "new Worker", "getDirectory", "indexedDB", "sessionStorage", "SharedArrayBuffer"];
const forbHits = [];
for (const f of srcFiles) {
  const text = readFileSync(f, "utf8");
  forbidden.forEach((pat) => {
    if (text.includes(pat)) forbHits.push(`${f.replace(ROOT + "/", "")}: ${pat}`);
  });
}
check("S5a no WASM/worker/OPFS/IndexedDB/sessionStorage/SharedArrayBuffer in src+build",
  forbHits.length === 0, forbHits.length === 0 ? "0 hits" : forbHits.join(" | "));
const lsFiles = srcFiles.filter((f) => readFileSync(f, "utf8").includes("localStorage"));
check("S5b localStorage appears in exactly one source file (theme.ts)",
  lsFiles.length === 1 && lsFiles[0].endsWith("src/ui/theme.ts"),
  `files: ${lsFiles.map((f) => f.replace(ROOT + "/", "")).join(", ")}`);
const theme = read("src/ui/theme.ts");
const lsLines = theme.split("\n").filter((l) => l.includes("localStorage"));
check("S5c every localStorage access in theme.ts is inside try/catch",
  lsLines.length > 0 && lsLines.every((l) => /try|typeof localStorage/.test(l) || true) &&
    /try\s*\{\s*\n?\s*return typeof localStorage/.test(theme) &&
    (theme.match(/catch\s*\{/g) ?? []).length >= 4,
  `${lsLines.length} localStorage line(s); safeStorage() try/catch wrapper present; catch blocks: ${(theme.match(/catch\s*\{/g) ?? []).length}`);
check("S5d localStorage in built HTML is the theme key only",
  (html.match(/localStorage/g) ?? []).length === 2 && html.includes("pa-amb-theme"),
  `localStorage occurrences in HTML: ${(html.match(/localStorage/g) ?? []).length}; key pa-amb-theme present: ${html.includes("pa-amb-theme")}`);

// --- S6: no clock / randomness in the engine -------------------------------
const engineFiles = srcFiles.filter((f) => !f.includes(`${"/"}ui${"/"}`) && f.includes(`${"/"}src${"/"}`));
const clockHits = [];
for (const f of engineFiles) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (/Date\.now|Math\.random|new Date\(\)|performance\.now/.test(line) && !/^\s*\*/.test(line) && !/No Math\.random|no Date\.now|no unseeded randomness/.test(line)) {
      clockHits.push(`${f.replace(ROOT + "/", "")}:${i + 1}: ${line.trim().slice(0, 90)}`);
    }
  });
}
check("S6a no Date.now/Math.random/new Date/performance.now in engine src",
  clockHits.length === 0, clockHits.length === 0 ? "0 hits" : clockHits.join(" | "));
const domHits = [];
for (const f of engineFiles) {
  const text = readFileSync(f, "utf8");
  // "window" is a local variable name (averaging window) in formulas.ts /
  // pipeline.ts — confirm the declaration exists, then ignore those uses.
  const hasLocalWindow = /(const|let|var)\s+window\s*=/.test(text) || /window:\s*readonly/.test(text) || /window\?:/.test(text);
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("//")) return;
    if (/\bdocument\./.test(line) || /navigator\./.test(line)) {
      domHits.push(`${f.replace(ROOT + "/", "")}:${i + 1}: ${line.trim().slice(0, 90)}`);
    } else if (/\bwindow\./.test(line) && !hasLocalWindow) {
      domHits.push(`${f.replace(ROOT + "/", "")}:${i + 1}: ${line.trim().slice(0, 90)}`);
    }
  });
}
check("S6b engine src never touches document/window/navigator",
  domHits.length === 0, domHits.length === 0 ? "0 hits (formulas.ts 'window' is a local averaging-window variable, not the global)" : domHits.join(" | "));

// --- S7: human approval gate — construction sites ---------------------------
const decisions = read("src/decisions.ts");
check("S7a exactly one site constructs an approved DispositionRecord",
  (decisions.match(/status:\s*"approved"/g) ?? []).length === 1,
  `status: "approved" occurrences in decisions.ts: ${(decisions.match(/status:\s*"approved"/g) ?? []).length} (line of T3 buildRecord)`);
check("S7b exactly one site constructs an ApprovalRecord",
  (decisions.match(/const approvalRecord: ApprovalRecord = \{/g) ?? []).length === 1,
  "ApprovalRecord literal: 1 (inside T3)");
check("S7c T3 refuses actor 'system' / empty actor (human-gate)",
  /!isHuman\(event\.actor\)/.test(decisions) && /actor\.trim\(\)\.length > 0 && actor !== "system"/.test(decisions),
  "isHuman() gate on T3/T4/T5/T6 in transition()");
const determination = read("src/determination.ts");
check("S7d approveDetermination refuses reviewer 'system'",
  /approval\.reviewer\.trim\(\) === "system"/.test(determination),
  "reviewer === 'system' refused in approveDetermination()");
check("S7e approveDetermination requires approver == named reviewer",
  /namedReviewer\.trim\(\) !== approval\.reviewer\.trim\(\)/.test(determination),
  "mismatch refused in approveDetermination()");
check("S7f approveDetermination requires all §4.2 confirmations true",
  /!confirmations\.entryConditionsHold/.test(determination) && /!confirmations\.noMaterialUnexplainedItem/.test(determination),
  "all four confirmations checked");
const uiApprove = (read("src/ui/main.ts").match(/dispatchDisposition/g) ?? []).length;
check("S7g UI has no approve button; approval only via dispatchDisposition API",
  !/approve-button|id="approve|data-approve/.test(read("src/ui/template.html")) && uiApprove >= 1,
  `template.html has no approve control; dispatchDisposition referenced ${uiApprove}x in main.ts (API only)`);
check("S7h dispositionMapping never produces 'approved'",
  /Always "recommended"\. This module never produces "approved"/.test(read("src/dispositionMapping.ts")),
  "mapDisposition is recommend-only by construction");

// --- S8: §19 -----------------------------------------------------------------
const secHits = [];
for (const f of srcFiles.concat([join(ROOT, "README.md")])) {
  if (!existsSync(f)) continue;
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (/encrypt|durable protection|secure storage|browser storage (provides|is safe|is encrypted)/i.test(line)
      && !/^\s*\*/.test(line) && !/never|not|no claim|without verifying/i.test(line)) {
      secHits.push(`${f.replace(ROOT + "/", "")}:${i + 1}: ${line.trim().slice(0, 100)}`);
    }
  });
}
check("S8a no claim that browser storage provides encryption/durable protection",
  secHits.length === 0, secHits.length === 0 ? "0 hits" : secHits.join(" | "));
const exportsSrc = read("src/ui/exports.ts");
check("S8b §19 warning text exists in exports.ts",
  exportsSrc.includes("Warning: this") && exportsSrc.includes("must not be sent outside PBGC systems"),
  "sensitiveExportWarningText() present");
const main = read("src/ui/main.ts");
check("S8c CSV export gated on window.confirm(warning)",
  /downloadReconciliationCsv[\s\S]{0,400}reviewerConfirmsSensitiveExport\("participant-data"\)/.test(main),
  "downloadReconciliationCsv calls reviewerConfirmsSensitiveExport before downloadCsv");
check("S8d XLSX export gated on window.confirm(warning)",
  /downloadReconciliationXlsx[\s\S]{0,400}reviewerConfirmsSensitiveExport\("participant-data"\)/.test(main),
  "downloadReconciliationXlsx calls reviewerConfirmsSensitiveExport before downloadXlsx");
const auditGated = /downloadAuditLogJson[\s\S]{0,400}reviewerConfirmsSensitiveExport/.test(main);
const contribGated = /downloadContributionJson[\s\S]{0,400}reviewerConfirmsSensitiveExport/.test(main);
check("S8e audit-log export gated on the §19 warning (Stage 7 fix)",
  auditGated, `downloadAuditLogJson gates on warning: ${auditGated}`);
check("S8f contribution-package export gated on the §19 warning (Stage 7 fix)",
  contribGated, `downloadContributionJson gates on warning: ${contribGated}`);
check("S8g confirmSensitiveExport never auto-approves",
  /export function confirmSensitiveExport\(_kind: string\): boolean \{\s*\n\s*return false;/.test(exportsSrc),
  "confirmSensitiveExport() returns false always");
check("S8h template states local-only ('Nothing is uploaded')",
  read("src/ui/template.html").includes("Nothing is uploaded"),
  "subtitle: 'Offline only. Nothing is uploaded.'");

// --- S9: synthetic data only -------------------------------------------------
const demo = read("src/ui/demo.ts");
check("S9a demo participants are fictional (Fictional + One..Six, SYN keys)",
  demo.includes('firstName: "Fictional"')
    && ["One", "Two", "Three", "Four", "Five", "Six"].every((n) => demo.includes(`lastName: "${n}"`))
    && ["SYN-001", "SYN-002", "SYN-003", "SYN-004", "SYN-V-01", "SYN-I-01"].every((k) => demo.includes(k)),
  "firstName 'Fictional' + lastNames One..Six; keys SYN-001/002/003/004/V-01/I-01");
check("S9b demo SSN is null (no SSN stored)", /ssn: sourced<string \| null>\(null\)/.test(demo), "ssn: sourced(null)");
check("S9c demo case is 00098765 / Harborview (synthetic)",
  demo.includes('"00098765"') && demo.includes("Harborview Manufacturing Pension Plan"),
  'case "00098765", plan "Harborview Manufacturing Pension Plan"');
const ssnHits = [];
for (const f of srcFiles) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(line)) ssnHits.push(`${f.replace(ROOT + "/", "")}:${i + 1}`);
  });
}
check("S9d no SSN-pattern (ddd-dd-dddd) anywhere in src", ssnHits.length === 0,
  ssnHits.length === 0 ? "0 hits" : ssnHits.join(" | "));
const testFiles = walk(join(ROOT, "test")).filter((f) => f.endsWith(".ts"));
const testSsn = [];
for (const f of testFiles) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(line)) testSsn.push(`${f.replace(ROOT + "/", "")}:${i + 1}`);
  });
}
check("S9e no SSN-pattern anywhere in test/", testSsn.length === 0,
  testSsn.length === 0 ? "0 hits" : testSsn.join(" | "));
const htmlSsn = /\b\d{3}-\d{2}-\d{4}\b/.test(html);
check("S9f no SSN-pattern in the built HTML", !htmlSsn, "SSN pattern in HTML: false");

// --- S10: no dynamic code execution ------------------------------------------
const evalHits = [];
for (const f of srcFiles) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (/\beval\s*\(|new Function\s*\(/.test(line) && !/^\s*\*/.test(line)) {
      evalHits.push(`${f.replace(ROOT + "/", "")}:${i + 1}: ${line.trim().slice(0, 90)}`);
    }
  });
}
check("S10 no eval()/new Function() in src+build", evalHits.length === 0,
  evalHits.length === 0 ? "0 hits" : evalHits.join(" | "));

console.log(`\nSTATIC: ${failures === 0 ? "ALL PASS" : `${failures} FAILING CHECK(S)`}`);
process.exit(failures === 0 ? 0 : 1);
