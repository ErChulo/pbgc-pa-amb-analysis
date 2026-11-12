// Stage 7 reproducibility — nondeterminism source sweep (NEW file).
//
// Greps src/ + the built bundle for every known nondeterminism source
// and prints each hit with the traced verdict (reaches an output, or
// contained). The verdicts below were established by tracing each hit
// to its consumers; this script re-verifies the hits still exist in
// the same places (line numbers may shift — it reports current lines).
//
//   T1  wall-clock reads (Date.now, new Date, performance.now)
//   T2  unseeded randomness (Math.random, crypto.randomUUID)
//   T3  sort comparators that can tie (stable sort => deterministic
//       for identical input order, but noted)
//   T4  module-global mutable state
//   T5  iteration over unordered collections feeding outputs
//   T6  fixed timestamps in export paths (XLSX DOS date, audit sort)
//
// Usage: node stage7/03-repro-sweep.mjs
// Exit 0 = sweep completed (findings are reported; a finding is not
// itself a failure). No source file is edited.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

function files(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) files(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}
const srcFiles = files(SRC);
const rel = (p) => p.slice(ROOT.length + 1);

function grep(re, label) {
  const hits = [];
  for (const f of srcFiles) {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (re.test(line)) hits.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  console.log(`\n== ${label}: ${hits.length} hit(s) ==`);
  for (const h of hits) console.log(`  ${h}`);
  return hits;
}

console.log("Stage 7 nondeterminism sweep over src/ (" + srcFiles.length + " .ts files)");

grep(/Date\.now|performance\.now/, "T1a Date.now / performance.now");
grep(/new Date\(/, "T1b new Date( — check each: pure date math vs wall clock");
grep(/Math\.random|crypto\.randomUUID|randomUUID/, "T2 unseeded randomness");
grep(/\.sort\(/, "T3 sort calls (tie behaviour traced in the report)");
grep(/^let |^var /, "T4 module-global mutable bindings (let/var at top level)");
grep(/Object\.keys\(|Object\.values\(|Object\.entries\(/, "T5 Object.keys/values/entries (insertion-ordered; see report)");
grep(/new Map\(|new Set\(/, "T5b Map/Set constructions (insertion-ordered; see report)");

// T6: fixed timestamps in export paths (positive controls — these must exist).
const exportsSrc = readFileSync(join(SRC, "ui", "exports.ts"), "utf8");
console.log("\n== T6 fixed timestamps in export paths ==");
console.log("  XLSX fixed DOS date 1980-01-01 present:", /dosDate = 33/.test(exportsSrc));
console.log("  XLSX fixed DOS time 0 present:", /dosTime = 0/.test(exportsSrc));
console.log("  buildAuditLog sorts by `at` (stable):", /\.sort\(\(a, b\) => \(a\.at < b\.at/.test(exportsSrc));
console.log("  buildContributionPackage fixed key order + 2-space indent:", /JSON\.stringify\(envelope, null, 2\)/.test(exportsSrc));

console.log(`
Traced verdicts (see stage7/03-reproducibility.md for the evidence):
  - src/statistics.ts: NO Math.random / Date.now anywhere; every stochastic
    function takes an explicit seed (mulberry32) or a constant default
    (20261112). Verified by re-running in 03-repro-stats.mjs.
  - src/ui/main.ts nowIso() (new Date().toISOString) is the ONLY wall-clock
    read in the app. It stamps UI dispatches -> audit log occurredAt and
    eventIds (ui-disp-<key>-<occurredAt>). REACHES outputs: two hand-driven
    runs differ in eventLog occurredAt values (proven by browser run C).
    The engine never reads a clock (decisions.ts: "reads no DOM, no
    storage, no clock, and no network").
  - src/dates.ts new Date(n * DAY_MS): pure epoch-day conversion, input
    determined. src/validation.ts new Date(Date.UTC(...)): pure
    days-in-month computation. Both contained.
  - src/pipeline.ts stepCounter (mutable module global): reset at the
    start of calculateAccruedBenefit (pipeline.ts:2305) and saved/restored
    around speculative runs (runExactPathIsolated). Contained: in-process
    repeat runs produce identical trace step numbers (03-repro-node.mjs
    runs A/B identical, including state.json).
  - Sort comparators that can tie (pipeline.ts:556 returns 1 on tie;
    missingdata.ts:746/799, reconciliation.ts:564, statistics.ts:2303,
    exports.ts:406 sort by one key): JS Array.sort is stable (ES2019+),
    so ties keep insertion order, and insertion order is deterministic
    for identical inputs. Contained; pipeline.ts:556 is a latent smell
    (comparator never returns 0) but not a reproducibility defect.
  - Object.keys/values/entries and Map/Set iteration: all insertion-
    ordered; every order fed into an output derives from a fixed array
    order (package participant order, first-seen merge order). Contained.
  - mergeLogs order: deterministic first-seen order; associative but NOT
    commutative (verified in 03-repro-merge.mjs).
`);
