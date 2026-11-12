// Stage 6 — single-file build (Worker E).
//
// Bundles src/ui/main.ts (via build/entry.ts) into one classic-script
// IIFE with esbuild (build-time only, never in the deliverable), then
// inlines src/ui/styles.css and the bundle into src/ui/template.html
// and writes pa-amb-analysis.html at the repo root.
//
// Office constraint (MASTER_PROMPT §16, critical): the deliverable
// must be a SINGLE HTML file opened directly via file:// — 0 fetch,
// no CDN, no external resources, no build step the office must run.
// Compilation happens on this build machine only.
//
// Fails loudly when:
// - esbuild reports any unresolved import (esbuild errors exit non-zero),
// - the <!--STYLES--> or <!--BUNDLE--> placeholders are missing,
// - the post-build 0-fetch check (build/check-zero-fetch.mjs) fails.
//
// Usage: npm run bundle  (or: node build/bundle.mjs)

import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = join(ROOT, "build", "entry.ts");
const TEMPLATE = join(ROOT, "src", "ui", "template.html");
const STYLES = join(ROOT, "src", "ui", "styles.css");
const OUT = join(ROOT, "pa-amb-analysis.html");

const STYLE_PLACEHOLDER = "<!--STYLES-->";
const BUNDLE_PLACEHOLDER = "<!--BUNDLE-->";

async function main() {
  const out = await build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "iife",
    globalName: "PaAmbApp",
    target: "es2022",
    minify: true,
    sourcemap: false,
    write: false,
    logLevel: "warning",
  });
  const bundleFile = out.outputFiles?.[0];
  if (bundleFile === undefined) {
    throw new Error("esbuild produced no output file");
  }
  const bundleJs = bundleFile.text;

  const template = readFileSync(TEMPLATE, "utf8");
  const css = readFileSync(STYLES, "utf8");
  if (!template.includes(STYLE_PLACEHOLDER)) {
    throw new Error(`template ${TEMPLATE} is missing placeholder ${STYLE_PLACEHOLDER}`);
  }
  if (!template.includes(BUNDLE_PLACEHOLDER)) {
    throw new Error(`template ${TEMPLATE} is missing placeholder ${BUNDLE_PLACEHOLDER}`);
  }
  // The CSS must not close the <style> element, and the bundle must not
  // close the <script> element (a literal "</script>" inside a string
  // would break the single file).
  if (css.includes("</style")) {
    throw new Error("styles.css contains a literal </style — refusing to inline");
  }
  if (bundleJs.includes("</script")) {
    throw new Error("bundle contains a literal </script — refusing to inline");
  }

  const html = template
    .replace(STYLE_PLACEHOLDER, () => `<style>\n${css}\n</style>`)
    .replace(BUNDLE_PLACEHOLDER, () => `\n${bundleJs}\n`);
  // Build gate (Stage 7 Repro D1): String.replace with a string
  // replacement interprets `$` patterns (`$$` collapses to `$`), which
  // once stripped every `$` before `${` in the bundle (money strings,
  // the XLSX print area). Replacement functions above pass the text
  // through verbatim; this gate proves it — the inlined bundle must
  // equal the esbuild output byte-for-byte, and every `$$` in the
  // bundle must survive into the HTML.
  const inlined = html.includes(bundleJs);
  if (!inlined) {
    throw new Error("build gate: inlined bundle does not equal the esbuild output — refusing to ship");
  }
  const bundleDollarDollar = (bundleJs.match(/\$\$/g) ?? []).length;
  const htmlDollarDollar = (html.match(/\$\$/g) ?? []).length;
  if (bundleDollarDollar === 0) {
    throw new Error("build gate: esbuild output contains no `$$` — the gate itself cannot verify anything; refusing to ship");
  }
  if (htmlDollarDollar !== bundleDollarDollar) {
    throw new Error(
      `build gate: \`$$\` collapse detected — bundle has ${bundleDollarDollar} \`$$\` sequences, shipped HTML has ${htmlDollarDollar}; refusing to ship`,
    );
  }
  writeFileSync(OUT, html, "utf8");
  console.log(`Built ${OUT} (${Buffer.byteLength(html, "utf8")} bytes)`);

  // Post-build gate: the 0-fetch static check. A failure here fails
  // the build.
  const check = spawnSync(process.execPath, [join(ROOT, "build", "check-zero-fetch.mjs")], {
    stdio: "inherit",
  });
  if (check.status !== 0) {
    throw new Error("0-fetch check failed — build rejected");
  }
}

main().catch((err) => {
  console.error(`BUILD FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
