// Stage 7 audit: every engine module's exported names vs src/index.ts.
// Parses export declarations from source (types included). Reports:
//  - modules not re-exported by index.ts at all
//  - names exported by two or more star-exported modules (ambiguous star exports)
import { readFileSync, readdirSync } from "node:fs";

const SRC = new URL("../src/", import.meta.url).pathname;
const indexSrc = readFileSync(SRC + "index.ts", "utf8");

function exportedNames(file) {
  const src = readFileSync(SRC + file, "utf8");
  const names = new Set();
  // export function/const/class/interface/type/enum NAME
  for (const m of src.matchAll(/export\s+(?:declare\s+)?(?:async\s+function|function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // export { A, B as C, ... } [from "..."]
  for (const m of src.matchAll(/export\s*\{([^}]*)\}(?:\s*from\s*["'][^"']+["'])?/g)) {
    for (let part of m[1].split(",")) {
      part = part.trim();
      if (!part) continue;
      const as = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (as) names.add(as[2]); else names.add(part.split(/\s/)[0]);
    }
  }
  // export * from "./x" — resolve recursively
  for (const m of src.matchAll(/export\s*\*\s*from\s*["']\.\/([^"']+)["']/g)) {
    const sub = m[1].endsWith(".ts") ? m[1] : m[1] + ".ts";
    for (const n of exportedNames(sub)) names.add(n);
  }
  // export * as ns from — namespace only, no flat names
  return names;
}

const modules = readdirSync(SRC).filter((f) => f.endsWith(".ts") && f !== "index.ts");
// Which modules does index.ts re-export (directly or via a named export list)?
const indexStar = [...indexSrc.matchAll(/export\s*\*\s*from\s*["']\.\/([^"']+)["']/g)].map((m) => m[1] + ".ts");
const indexNamed = [...indexSrc.matchAll(/export\s*\{[^}]*\}\s*from\s*["']\.\/([^"']+)["']/g)].map((m) => m[1] + ".ts");
const indexCovers = new Set([...indexStar, ...indexNamed]);
// Resolve transitive coverage: contribution.ts re-exports publication.ts
const covered = new Set(indexCovers);
for (const mod of [...covered]) {
  const src = readFileSync(SRC + mod, "utf8");
  for (const m of src.matchAll(/export\s*\*\s*from\s*["']\.\/([^"']+)["']/g)) covered.add(m[1] + ".ts");
}

console.log("== modules NOT re-exported by src/index.ts ==");
for (const mod of modules) {
  if (!covered.has(mod)) {
    const names = [...exportedNames(mod)].sort();
    console.log(`MISSING: ${mod} (${names.length} exports): ${names.join(", ")}`);
  }
}
console.log("== star-export name collisions across index.ts-covered modules ==");
const byName = new Map();
for (const mod of [...covered]) {
  if (!indexStar.includes(mod) && !covered.has(mod)) continue;
  // only star-exported modules can collide ambiguously; named lists are explicit
  for (const n of exportedNames(mod)) {
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(mod);
  }
}
// restrict collision check to the star-exported set
const starSet = new Set(indexStar);
for (const mod of [...covered]) {
  const src = readFileSync(SRC + mod, "utf8");
  for (const m of src.matchAll(/export\s*\*\s*from\s*["']\.\/([^"']+)["']/g)) starSet.add(m[1] + ".ts");
}
const starByName = new Map();
for (const mod of [...starSet]) {
  for (const n of exportedNames(mod)) {
    if (!starByName.has(n)) starByName.set(n, []);
    starByName.get(n).push(mod);
  }
}
let collisions = 0;
for (const [n, mods] of [...starByName.entries()].sort()) {
  if (mods.length > 1) { console.log(`COLLISION: ${n} in ${mods.join(", ")}`); collisions++; }
}
console.log(`collisions: ${collisions}`);
// Also: does index.ts's own named-export lists repeat a star-exported name?
console.log("== named lists in index.ts that duplicate a star export ==");
const starNames = new Set([...starByName.keys()]);
for (const m of indexSrc.matchAll(/export\s*\{([^}]*)\}\s*from\s*["']\.\/([^"']+)["']/g)) {
  for (let part of m[1].split(",")) {
    part = part.trim();
    if (!part) continue;
    const as = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
    const out = as ? as[2] : part.split(/\s/)[0];
    if (starNames.has(out)) console.log(`DUP: ${out} (named from ./${m[2]}, also star-exported)`);
  }
}
console.log("audit done");
