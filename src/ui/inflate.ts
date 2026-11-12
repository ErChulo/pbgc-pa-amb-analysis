/**
 * Raw DEFLATE decoder (RFC 1951) — Stage 8, XLSX import.
 *
 * Pure TypeScript, no DOM, no fetch, no external package, no clock,
 * no randomness. Handles stored blocks, fixed Huffman blocks, and
 * dynamic Huffman blocks. Throws an Error with a plain-language
 * message on a corrupt or truncated stream or an invalid block —
 * never a partial output, never a silent guess.
 *
 * Excel writes deflated ZIP entries, so this is the piece that lets
 * the app read a real .xlsx without a library.
 */

/** Bit reader: DEFLATE packs bits least-significant-bit first. */
class BitReader {
  private pos = 0;
  private bitBuf = 0;
  private bitCount = 0;

  constructor(private readonly data: Uint8Array) {}

  /** Read one bit (0 or 1). Throws on a truncated stream. */
  bit(): number {
    if (this.bitCount === 0) {
      if (this.pos >= this.data.length) {
        throw new Error("DEFLATE stream is truncated: ran out of data while reading a block.");
      }
      this.bitBuf = this.data[this.pos] as number;
      this.pos += 1;
      this.bitCount = 8;
    }
    const value = this.bitBuf & 1;
    this.bitBuf >>>= 1;
    this.bitCount -= 1;
    return value;
  }

  /** Read `count` bits, least-significant-bit first. */
  bits(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      value |= this.bit() << i;
    }
    return value;
  }

  /** Discard bits up to the next byte boundary (stored blocks). */
  alignToByte(): void {
    this.bitBuf = 0;
    this.bitCount = 0;
  }

  /** Bytes left unread (after aligning). */
  bytesLeft(): number {
    return this.data.length - this.pos;
  }

  /** Copy `count` raw bytes starting at the current byte position. */
  takeBytes(count: number): Uint8Array {
    if (count > this.bytesLeft()) {
      throw new Error("DEFLATE stream is truncated: a stored block claims more bytes than the stream holds.");
    }
    const out = this.data.subarray(this.pos, this.pos + count);
    this.pos += count;
    return out;
  }
}

/**
 * One canonical Huffman code. `counts[len]` is how many codes have
 * that length; `symbols` lists the symbols in canonical order
 * (sorted by length, then by symbol).
 */
interface HuffmanCode {
  counts: number[];
  symbols: number[];
}

function buildHuffman(lengths: readonly number[]): HuffmanCode {
  const counts = new Array<number>(16).fill(0);
  for (const len of lengths) {
    if (len < 0 || len > 15) {
      throw new Error("DEFLATE stream is corrupt: a Huffman code length is out of range.");
    }
    counts[len] = (counts[len] as number) + 1;
  }
  counts[0] = 0;
  // Oversubscription check: the Kraft sum must not exceed 1.
  let left = 1;
  for (let len = 1; len <= 15; len += 1) {
    left <<= 1;
    left -= counts[len] as number;
    if (left < 0) {
      throw new Error("DEFLATE stream is corrupt: a Huffman code is oversubscribed.");
    }
  }
  const offsets = new Array<number>(16).fill(0);
  for (let len = 1; len < 15; len += 1) {
    offsets[len + 1] = (offsets[len] as number) + (counts[len] as number);
  }
  const symbols = new Array<number>(lengths.length).fill(0);
  for (let i = 0; i < lengths.length; i += 1) {
    const len = lengths[i] as number;
    if (len !== 0) {
      symbols[offsets[len] as number] = i;
      offsets[len] = (offsets[len] as number) + 1;
    }
  }
  return { counts, symbols };
}

/** Decode one symbol. Throws on an invalid code or a truncated stream. */
function decodeSymbol(reader: BitReader, code: HuffmanCode): number {
  let first = 0;
  let index = 0;
  let codeValue = 0;
  for (let len = 1; len <= 15; len += 1) {
    codeValue = (codeValue << 1) | reader.bit();
    const count = code.counts[len] as number;
    if (codeValue - first < count) {
      return code.symbols[index + (codeValue - first)] as number;
    }
    index += count;
    first = (first + count) << 1;
  }
  throw new Error("DEFLATE stream is corrupt: an invalid Huffman code was found.");
}

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
  2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
  13,
];

/** Fixed Huffman tables (RFC 1951 §3.2.6). */
function fixedTables(): { literal: HuffmanCode; distance: HuffmanCode } {
  const litLengths = new Array<number>(288).fill(0);
  for (let i = 0; i <= 143; i += 1) litLengths[i] = 8;
  for (let i = 144; i <= 255; i += 1) litLengths[i] = 9;
  for (let i = 256; i <= 279; i += 1) litLengths[i] = 7;
  for (let i = 280; i <= 287; i += 1) litLengths[i] = 8;
  const distLengths = new Array<number>(30).fill(5);
  return { literal: buildHuffman(litLengths), distance: buildHuffman(distLengths) };
}

const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Dynamic Huffman tables (RFC 1951 §3.2.7). */
function dynamicTables(reader: BitReader): { literal: HuffmanCode; distance: HuffmanCode } {
  const hlit = reader.bits(5) + 257;
  const hdist = reader.bits(5) + 1;
  const hclen = reader.bits(4) + 4;
  if (hlit > 286 || hdist > 30) {
    throw new Error("DEFLATE stream is corrupt: a dynamic block claims too many literal or distance codes.");
  }
  const codeLengths = new Array<number>(19).fill(0);
  for (let i = 0; i < hclen; i += 1) {
    codeLengths[CODE_LENGTH_ORDER[i] as number] = reader.bits(3);
  }
  const codeLengthCode = buildHuffman(codeLengths);
  const lengths = new Array<number>(hlit + hdist).fill(0);
  let i = 0;
  while (i < hlit + hdist) {
    const symbol = decodeSymbol(reader, codeLengthCode);
    if (symbol <= 15) {
      lengths[i] = symbol;
      i += 1;
    } else if (symbol === 16) {
      if (i === 0) {
        throw new Error("DEFLATE stream is corrupt: a repeat code has no previous code length to copy.");
      }
      const repeat = reader.bits(2) + 3;
      const prev = lengths[i - 1] as number;
      for (let j = 0; j < repeat; j += 1) {
        if (i >= hlit + hdist) {
          throw new Error("DEFLATE stream is corrupt: a repeat code runs past the end of the code lengths.");
        }
        lengths[i] = prev;
        i += 1;
      }
    } else if (symbol === 17) {
      const repeat = reader.bits(3) + 3;
      for (let j = 0; j < repeat; j += 1) {
        if (i >= hlit + hdist) {
          throw new Error("DEFLATE stream is corrupt: a repeat code runs past the end of the code lengths.");
        }
        lengths[i] = 0;
        i += 1;
      }
    } else if (symbol === 18) {
      const repeat = reader.bits(7) + 11;
      for (let j = 0; j < repeat; j += 1) {
        if (i >= hlit + hdist) {
          throw new Error("DEFLATE stream is corrupt: a repeat code runs past the end of the code lengths.");
        }
        lengths[i] = 0;
        i += 1;
      }
    } else {
      throw new Error("DEFLATE stream is corrupt: an invalid code-length symbol was found.");
    }
  }
  const litLengths = lengths.slice(0, hlit);
  const distLengths = lengths.slice(hlit);
  // A literal code with no end-of-block symbol (256) cannot terminate.
  if ((litLengths[256] as number) === 0) {
    throw new Error("DEFLATE stream is corrupt: a dynamic block has no end-of-block code.");
  }
  return { literal: buildHuffman(litLengths), distance: buildHuffman(distLengths) };
}

/** Growable byte output. */
class Output {
  private buf = new Uint8Array(1024);
  private len = 0;

  push(byte: number): void {
    if (this.len >= this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len] = byte;
    this.len += 1;
  }

  pushBytes(bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length; i += 1) this.push(bytes[i] as number);
  }

  /** Copy `length` bytes from `distance` bytes back (may overlap). */
  copy(distance: number, length: number): void {
    if (distance < 1 || distance > this.len) {
      throw new Error("DEFLATE stream is corrupt: a back-reference reaches before the start of the output.");
    }
    for (let i = 0; i < length; i += 1) {
      this.push(this.buf[this.len - distance] as number);
    }
  }

  get length(): number {
    return this.len;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

function inflateBlock(
  reader: BitReader,
  out: Output,
  literal: HuffmanCode,
  distance: HuffmanCode,
): void {
  for (;;) {
    const symbol = decodeSymbol(reader, literal);
    if (symbol === 256) return;
    if (symbol < 256) {
      out.push(symbol);
      continue;
    }
    const lengthIndex = symbol - 257;
    if (lengthIndex < 0 || lengthIndex >= LENGTH_BASE.length) {
      throw new Error("DEFLATE stream is corrupt: an invalid literal/length symbol was found.");
    }
    const length =
      (LENGTH_BASE[lengthIndex] as number) + reader.bits(LENGTH_EXTRA[lengthIndex] as number);
    const distSymbol = decodeSymbol(reader, distance);
    if (distSymbol < 0 || distSymbol >= DIST_BASE.length) {
      throw new Error("DEFLATE stream is corrupt: an invalid distance symbol was found.");
    }
    const dist =
      (DIST_BASE[distSymbol] as number) + reader.bits(DIST_EXTRA[distSymbol] as number);
    out.copy(dist, length);
  }
}

/**
 * Decode a raw DEFLATE stream (RFC 1951) — the compression format
 * inside a ZIP entry. Not zlib (RFC 1950) and not gzip (RFC 1952):
 * there is no 2-byte zlib header and no checksum here; callers that
 * need those must strip or check them first.
 */
export function inflate(data: Uint8Array): Uint8Array {
  if (data.length === 0) {
    throw new Error("DEFLATE stream is empty: there is nothing to decode.");
  }
  const reader = new BitReader(data);
  const out = new Output();
  for (;;) {
    const isFinal = reader.bit();
    const blockType = reader.bits(2);
    if (blockType === 0) {
      reader.alignToByte();
      if (reader.bytesLeft() < 4) {
        throw new Error("DEFLATE stream is truncated: a stored block is missing its length.");
      }
      const lenBytes = reader.takeBytes(4);
      const len = (lenBytes[0] as number) | ((lenBytes[1] as number) << 8);
      const nlen = (lenBytes[2] as number) | ((lenBytes[3] as number) << 8);
      if (len !== (~nlen & 0xffff)) {
        throw new Error("DEFLATE stream is corrupt: a stored block's length check (LEN vs NLEN) failed.");
      }
      out.pushBytes(reader.takeBytes(len));
    } else if (blockType === 1) {
      const tables = fixedTables();
      inflateBlock(reader, out, tables.literal, tables.distance);
    } else if (blockType === 2) {
      const tables = dynamicTables(reader);
      inflateBlock(reader, out, tables.literal, tables.distance);
    } else {
      throw new Error("DEFLATE stream is corrupt: an invalid block type (3) was found.");
    }
    if (isFinal === 1) return out.finish();
  }
}
