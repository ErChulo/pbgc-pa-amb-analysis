// P-01 Node verification (byte-level mechanism only).
// Proves in Node what the live Edge file:// test must still prove in a browser:
// WebAssembly.instantiate from raw bytes (base64 -> atob-equivalent -> Uint8Array)
// with no fetch, no MIME type, no server. The browser half is poc-p01-wasm-embed.html.
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

(async () => {
  const wasmPath = path.join(__dirname, "add.wasm");
  const bytes = fs.readFileSync(wasmPath);
  const b64 = bytes.toString("base64");
  console.log("P-01 node verify");
  console.log("  wasm file bytes:", bytes.length);
  console.log("  base64 chars:", b64.length, "ratio:", (b64.length / bytes.length).toFixed(3));
  // atob-equivalent round trip (Buffer is the Node stand-in for atob + Uint8Array)
  const decoded = Buffer.from(b64, "base64");
  assert.deepStrictEqual(decoded, bytes, "base64 round trip must be exact");
  console.log("  base64 round trip: exact");
  // Reproduce the exact HTML-probe path: base64 string -> bytes -> instantiate
  const t0 = process.hrtime.bigint();
  const { instance } = await WebAssembly.instantiate(new Uint8Array(decoded), {});
  const t1 = process.hrtime.bigint();
  const v = instance.exports.add(2, 3);
  console.log("  add(2,3) =", v, "(expect 5)");
  console.log("  add(-1,41) =", instance.exports.add(-1, 41), "(expect 40)");
  console.log("  instantiate ms:", (Number(t1 - t0) / 1e6).toFixed(3));
  const c0 = process.hrtime.bigint();
  await WebAssembly.compile(new Uint8Array(decoded));
  const c1 = process.hrtime.bigint();
  console.log("  compile ms:", (Number(c1 - c0) / 1e6).toFixed(3));
  assert.strictEqual(v, 5);
  console.log("P-01 NODE RESULT: PASS (byte-level mechanism proved; browser file:// half still needs live test)");
})().catch((e) => { console.error("P-01 NODE RESULT: FAIL", e); process.exit(1); });
