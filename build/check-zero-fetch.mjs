// Stage 6 — 0-fetch static checker (Worker E).
//
// Reads the built pa-amb-analysis.html and fails (exit non-zero) when
// it contains any pattern that could reach the network or load an
// external resource. This is a STATIC check only: it proves no literal
// external reference exists in the deliverable. The live check is the
// Playwright network test (test/ui-playwright/zero-fetch.test.mjs),
// which asserts 0 http/https requests at runtime.
//
// Documented exceptions (namespace identifiers, never fetched):
// - http://www.w3.org/2000/svg — SVG namespace in chart output.
// - http://schemas.openxmlformats.org/... — OOXML namespace /
//   relationship-type URIs inside the hand-built XLSX writer.
// - http://purl.org/dc/elements/1.1/ — Dublin Core namespace in the
//   XLSX core properties.
// - https://json-schema.org/draft/2020-12/schema and
//   https://pbgc-caseworkbench/contribution/... — JSON Schema $id /
//   $schema identifiers in the contribution package (plain strings,
//   never dereferenced).
// Any other http:// or https:// string is a failure. There is no
// https://drive.google.com reference in the deliverable (that URL
// lives only in MASTER_PROMPT.md, which is not bundled).

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "pa-amb-analysis.html");

const ALLOWED_URL_PREFIXES = [
  "http://www.w3.org/2000/svg",
  "http://schemas.openxmlformats.org/",
  "http://purl.org/dc/elements/1.1/",
  "https://json-schema.org/draft/2020-12/schema",
  "https://pbgc-caseworkbench/contribution/",
];

const FORBIDDEN = [
  [/fetch\s*\(/, "fetch("],
  [/XMLHttpRequest/, "XMLHttpRequest"],
  [/import\s*\(/, "dynamic import("],
  [/<link[\s>]/i, "<link"],
  [/<script[^>]+src=/i, "<script src"],
  [/<img[^>]+src=/i, "<img src"],
  [/@import/i, "@import"],
  // CSS url( — the lookbehind excludes URL.createObjectURL /
  // URL.revokeObjectURL (local blob URLs for downloads, not network).
  [/(?<![\w$.])url\s*\(/i, "url("],
  [/type\s*=\s*["']module["']/i, 'type="module"'],
  [/WebSocket/, "WebSocket"],
  [/navigator\.sendBeacon/, "navigator.sendBeacon"],
  [/EventSource/, "EventSource"],
];

function main() {
  let html;
  try {
    html = readFileSync(FILE, "utf8");
  } catch (err) {
    console.error(`FAIL: cannot read ${FILE}: ${err.message}`);
    process.exit(1);
  }
  const failures = [];

  for (const [re, label] of FORBIDDEN) {
    if (re.test(html)) failures.push(label);
  }

  // http(s) URLs: strip the documented namespace identifiers first;
  // anything left is a failure.
  let scrubbed = html;
  for (const prefix of ALLOWED_URL_PREFIXES) {
    scrubbed = scrubbed.split(prefix).join("");
  }
  const urlHits = scrubbed.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  if (urlHits.length > 0) {
    failures.push(`http(s) URL(s): ${[...new Set(urlHits)].join(", ")}`);
  }

  if (failures.length > 0) {
    console.error(`FAIL 0-fetch check: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log(
    `PASS 0-fetch check: pa-amb-analysis.html (${Buffer.byteLength(html, "utf8")} bytes) — no fetch/XHR/import/link/script-src/img-src/url(/module, and no http(s) URL outside the documented XML/JSON-Schema namespace identifiers.`,
  );
}

main();
