// Blob-URL worker source (P-03). Runs in a worker created from a blob URL.
// Receives {type:'ping'} -> replies {type:'pong'}.
// Receives {type:'wasm', bytes} -> instantiates embedded bytes, calls add(2,3),
// replies {type:'wasm-result', value}.
self.onmessage = function (e) {
  var d = e.data;
  if (d.type === 'ping') { self.postMessage({ type: 'pong', echo: d.echo }); return; }
  if (d.type === 'wasm') {
    WebAssembly.instantiate(d.bytes, {}).then(function (r) {
      self.postMessage({ type: 'wasm-result', value: r.instance.exports.add(2, 3) });
    }).catch(function (err) {
      self.postMessage({ type: 'wasm-error', error: String(err) });
    });
    return;
  }
  self.postMessage({ type: 'unknown', got: d.type });
};
