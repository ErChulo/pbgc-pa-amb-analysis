/**
 * SHA-256 (FIPS 180-4) — Stage 8, XLSX import.
 *
 * Pure TypeScript, no DOM, no fetch, no external package. `crypto.subtle`
 * is deliberately not used: it is asynchronous, and its availability
 * under file:// in the office browser is uncertain. This implementation
 * is synchronous and deterministic, so the file hash is the same on
 * every machine that reads the same bytes.
 */

const K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const H0: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** SHA-256 of `bytes`, as lowercase hex (64 characters). */
export function sha256Hex(bytes: Uint8Array): string {
  const h = [...H0];
  const bitLen = bytes.length * 8;
  // Padding: 0x80, zeroes, then the 64-bit big-endian bit length.
  const paddedLen = Math.floor((bytes.length + 9 + 63) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // Bit length as two 32-bit words (high, low). Inputs here are files,
  // far below 2^32 bits, so the high word is always 0.
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  padded[paddedLen - 8] = (hi >>> 24) & 0xff;
  padded[paddedLen - 7] = (hi >>> 16) & 0xff;
  padded[paddedLen - 6] = (hi >>> 8) & 0xff;
  padded[paddedLen - 5] = hi & 0xff;
  padded[paddedLen - 4] = (lo >>> 24) & 0xff;
  padded[paddedLen - 3] = (lo >>> 16) & 0xff;
  padded[paddedLen - 2] = (lo >>> 8) & 0xff;
  padded[paddedLen - 1] = lo & 0xff;

  const w = new Array<number>(64).fill(0);
  for (let block = 0; block < paddedLen; block += 64) {
    for (let t = 0; t < 16; t += 1) {
      const o = block + t * 4;
      w[t] =
        (((padded[o] as number) << 24) |
          ((padded[o + 1] as number) << 16) |
          ((padded[o + 2] as number) << 8) |
          (padded[o + 3] as number)) >>>
        0;
    }
    for (let t = 16; t < 64; t += 1) {
      const s0 = (rotr(w[t - 15] as number, 7) ^ rotr(w[t - 15] as number, 18) ^ ((w[t - 15] as number) >>> 3)) >>> 0;
      const s1 = (rotr(w[t - 2] as number, 17) ^ rotr(w[t - 2] as number, 19) ^ ((w[t - 2] as number) >>> 10)) >>> 0;
      w[t] = (((w[t - 16] as number) + s0 + (w[t - 7] as number) + s1) >>> 0) >>> 0;
    }
    let a = h[0] as number;
    let b = h[1] as number;
    let c = h[2] as number;
    let d = h[3] as number;
    let e = h[4] as number;
    let f = h[5] as number;
    let g = h[6] as number;
    let hh = h[7] as number;
    for (let t = 0; t < 64; t += 1) {
      const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (hh + s1 + ch + (K[t] as number) + (w[t] as number)) >>> 0;
      const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] as number) + a >>> 0;
    h[1] = (h[1] as number) + b >>> 0;
    h[2] = (h[2] as number) + c >>> 0;
    h[3] = (h[3] as number) + d >>> 0;
    h[4] = (h[4] as number) + e >>> 0;
    h[5] = (h[5] as number) + f >>> 0;
    h[6] = (h[6] as number) + g >>> 0;
    h[7] = (h[7] as number) + hh >>> 0;
  }
  return h.map((x) => (x as number).toString(16).padStart(8, "0")).join("");
}
