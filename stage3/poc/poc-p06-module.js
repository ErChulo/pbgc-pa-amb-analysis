// P-06 companion: a trivial ES module. Under file:// in Chromium/Edge,
// importing this from a module script must fail with a CORS error
// (origin "null" can never satisfy a CORS check). It exists only so the
// negative control has a real relative module to attempt.
export const p06 = true;
