// P-03 Node verification (worker-source-as-string construction only).
// Checks: (1) the worker source string extracted from poc-p03-blob-worker.html
// parses as valid JS; (2) it actually runs in a Node worker_threads Worker with
// eval:true and answers ping + instantiates WASM bytes posted to it.
// This proves the SOURCE STRING is valid and its logic is sound. It does NOT
// prove a blob-URL worker starts in Edge under file:// — that is the live test.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { Worker } = require("worker_threads");
const assert = require("assert");

(async () => {
  const html = fs.readFileSync(path.join(__dirname, "poc-p03-blob-worker.html"), "utf8");
  const m = html.match(/<script type="text\/plain" id="worker-src">([\s\S]*?)<\/script>/);
  assert.ok(m, "worker source block must be present in the probe HTML");
  const src = m[1].trim();
  console.log("P-03 node verify");
  console.log("  worker source chars:", src.length);
  new vm.Script(src);
  console.log("  worker source parses as valid JS: OK");
  // Node worker_threads has no `self` global by default; shim it like a browser worker.
  const shimmed = "const { parentPort } = require('worker_threads');\n"
    + "const self = { postMessage: (msg) => parentPort.postMessage(msg) };\n"
    + src.replace("self.onmessage = function (e) {", "parentPort.on('message', (data) => { const e = { data };")
    .replace(/\n\};\s*$/, "\n});\n");
  new vm.Script(shimmed);
  console.log("  shimmed worker source parses: OK");
  const worker = new Worker(shimmed, { eval: true });
  const wasmBytes = fs.readFileSync(path.join(__dirname, "add.wasm"));
  const pong = await new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.postMessage({ type: "ping", echo: "hello" });
  });
  console.log("  ping reply:", JSON.stringify(pong));
  assert.strictEqual(pong.type, "pong");
  const wasmRes = await new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.postMessage({ type: "wasm", bytes: new Uint8Array(wasmBytes) });
  });
  console.log("  wasm reply:", JSON.stringify(wasmRes));
  assert.strictEqual(wasmRes.type, "wasm-result");
  assert.strictEqual(wasmRes.value, 5);
  await worker.terminate();
  console.log("P-03 NODE RESULT: PASS (worker source valid + logic proved in Node worker_threads; blob-URL start in Edge under file:// still needs live test)");
})().catch((e) => { console.error("P-03 NODE RESULT: FAIL", e); process.exit(1); });
