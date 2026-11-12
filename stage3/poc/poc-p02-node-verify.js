// P-02 Node verification (realistic-size kernel, byte-level).
// Kernel: rustc 1.99.1, --target wasm32-unknown-unknown -O --crate-type cdylib,
// source kernel.rs in this folder. No wasm-bindgen glue (wasm-pack not installed;
// compiling it would add ~10-20 KB of glue — noted, not assumed).
// The browser half is poc-p02-wasm-kernel.html; HTML size = this file's size.
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

(async () => {
  const wasmPath = path.join(__dirname, "kernel.wasm");
  const htmlPath = path.join(__dirname, "poc-p02-wasm-kernel.html");
  const bytes = fs.readFileSync(wasmPath);
  const b64 = bytes.toString("base64");
  const html = fs.readFileSync(htmlPath, "utf8");
  console.log("P-02 node verify");
  console.log("  kernel raw bytes:", bytes.length);
  console.log("  base64 chars:", b64.length, "ratio:", (b64.length / bytes.length).toFixed(3));
  console.log("  probe HTML file bytes:", Buffer.byteLength(html), "(kernel b64 is", ((b64.length / Buffer.byteLength(html)) * 100).toFixed(1) + "% of it)");
  console.log("  rustc: 1.99.1 (58cf8f9c3 2026-10-13); target wasm32-unknown-unknown; -O cdylib");
  const t0 = process.hrtime.bigint();
  const { instance } = await WebAssembly.instantiate(new Uint8Array(bytes), {});
  const t1 = process.hrtime.bigint();
  console.log("  instantiate ms:", (Number(t1 - t0) / 1e6).toFixed(3));
  const c0 = process.hrtime.bigint();
  await WebAssembly.compile(new Uint8Array(bytes));
  const c1 = process.hrtime.bigint();
  console.log("  compile ms:", (Number(c1 - c0) / 1e6).toFixed(3));
  const ex = instance.exports;
  console.log("  exports:", Object.keys(ex).join(", "));
  assert.strictEqual(ex.add(2, 3), 5);
  // Stage 2 §8 worked example: alpha 1.5% (150 bps), S = 20.000 y, Cbar = $5,000/mo = 500000 cents
  const accrual = ex.accrual_monthly_cents(150n, 20000n, 500000n);
  console.log("  accrual_monthly_cents(150,20000,500000) =", accrual, "(expect 150000 = $1,500.00)");
  assert.strictEqual(accrual, 150000n);
  assert.strictEqual(ex.delta_cents(150000n, 149500n), 500n);
  // slice path: sum / count_outside over WASM linear memory
  const view = new BigInt64Array(ex.memory.buffer);
  view.set([100n, 200n, 300n], 0);
  assert.strictEqual(ex.sum_i64(0, 3), 600n);
  assert.strictEqual(ex.count_outside(0, 3, 150n, 250n), 2n);
  console.log("  sum_i64([100,200,300]) = 600; count_outside(150..250) = 2");
  console.log("P-02 NODE RESULT: PASS (size + compile + behaviour proved in Node; Edge file:// load still needs live test)");
})().catch((e) => { console.error("P-02 NODE RESULT: FAIL", e); process.exit(1); });
