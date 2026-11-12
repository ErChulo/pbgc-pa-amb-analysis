// P-08 local check: grep every probe HTML file for external-reference patterns.
// This is a STATIC check only. It cannot prove zero network requests at runtime
// (a script could construct a URL dynamically); the live check is DevTools
// Network = 0 in Edge under file://. What it does prove: no literal external
// reference exists in any probe file.
"use strict";
const fs = require("fs");
const path = require("path");

const PATTERNS = [
  [/https?:\/\//, "http(s) URL"],
  [/src\s*=\s*["']https?:/, "external src"],
  [/href\s*=\s*["']https?:/, "external href"],
  [/\bfetch\s*\(/, "fetch("],
  [/XMLHttpRequest/, "XMLHttpRequest"],
  [/import\s*\(/, "dynamic import("],
  [/import\s+[^=]+from\s+["']/, "static ES import"],
  [/<script[^>]+type\s*=\s*["']module["']/, "module script tag"],
  [/<link[^>]+href\s*=/, "link href (stylesheet/font)"],
  [/<img[^>]+src\s*=/, "img src"],
  [/url\(\s*["']?https?:/, "CSS url(http)"],
  [/WebSocket/, "WebSocket"],
  [/navigator\.sendBeacon/, "sendBeacon"],
];
let failures = 0;
for (const file of fs.readdirSync(__dirname).filter((f) => f.endsWith(".html")).sort()) {
  const text = fs.readFileSync(path.join(__dirname, file), "utf8");
  const hits = [];
  const expected = [];
  for (const [re, label] of PATTERNS) {
    if (!re.test(text)) continue;
    // The P-06 probe MUST mention fetch/import (it is the negative control
    // that attempts them); those are expected, not failures.
    if (file === "poc-p06-negative-control.html" && (label.startsWith("fetch") || label.includes("import") || label.includes("module"))) {
      expected.push(label);
    } else {
      hits.push(label);
    }
  }
  if (hits.length) {
    failures++;
    console.log("FAIL " + file + ": " + hits.join("; "));
  } else if (expected.length) {
    console.log("PASS " + file + ": only expected patterns (" + expected.join("; ") + " — P-06 negative control)");
  } else {
    console.log("PASS " + file + ": no external-reference pattern found");
  }
}
// P-06 is expected to contain fetch/import attempts; verify it does (else the control is vacuous).
const p06 = fs.readFileSync(path.join(__dirname, "poc-p06-negative-control.html"), "utf8");
const controlOk = /fetch\(/.test(p06) && /instantiateStreaming/.test(p06) && /import\(/.test(p06);
console.log(controlOk ? "PASS poc-p06-negative-control.html: contains all three forbidden attempts (control is live)"
  : "FAIL poc-p06-negative-control.html: missing a forbidden attempt");
if (!controlOk) failures++;
console.log(failures ? `P-08 LOCAL CHECK: ${failures} file(s) with findings (see above)` : "P-08 LOCAL CHECK: PASS (static; live DevTools Network check still needed)");
process.exit(failures ? 1 : 0);
