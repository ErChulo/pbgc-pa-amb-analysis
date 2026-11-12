/**
 * PKZIP reader — Stage 8, XLSX import.
 *
 * Pure TypeScript, no DOM, no fetch, no external package. Reads the
 * central directory, lists entries, and extracts by name. Every entry
 * is verified against its stored CRC-32 before it is returned, so a
 * damaged archive is refused rather than half-read.
 *
 * Supported: method 0 (stored) and method 8 (deflated, via
 * src/ui/inflate.ts). Refused with a plain-language message: a file
 * that is not a ZIP, a corrupt or truncated archive, an encrypted
 * entry (flag bit 0 — the app never asks for a password and never
 * guesses one), any other compression method, a CRC mismatch, and
 * multi-disk or ZIP64 archives. Refusals throw an Error; entries are
 * never silently skipped.
 */

import { crc32 } from "./exports.js";
import { inflate } from "./inflate.js";

/** One ZIP entry, fully extracted and CRC-checked. */
export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  crc: number;
  data: Uint8Array;
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function u16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] as number) | ((bytes[offset + 1] as number) << 8)) >>> 0;
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] as number) |
      ((bytes[offset + 1] as number) << 8) |
      ((bytes[offset + 2] as number) << 16) |
      ((bytes[offset + 3] as number) << 24)) >>>
    0
  );
}

function need(bytes: Uint8Array, offset: number, count: number, what: string): void {
  if (offset < 0 || offset + count > bytes.length) {
    throw new Error(`ZIP file is truncated: ${what} runs past the end of the file.`);
  }
}

interface CentralRecord {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

/** Find the End Of Central Directory record, scanning the tail. */
function findEocd(bytes: Uint8Array): number {
  const minSize = 22;
  if (bytes.length < minSize) {
    throw new Error("This is not a ZIP file: it is too short to hold a ZIP directory.");
  }
  const scanStart = Math.max(0, bytes.length - minSize - 65535);
  for (let i = bytes.length - minSize; i >= scanStart; i -= 1) {
    if (u32(bytes, i) === EOCD_SIG) {
      const commentLen = u16(bytes, i + 20);
      if (i + minSize + commentLen === bytes.length) return i;
    }
  }
  throw new Error("This is not a ZIP file: no ZIP directory (End Of Central Directory) was found.");
}

function readCentralDirectory(bytes: Uint8Array): CentralRecord[] {
  const eocd = findEocd(bytes);
  const disk = u16(bytes, eocd + 4);
  const cdDisk = u16(bytes, eocd + 6);
  const entriesOnDisk = u16(bytes, eocd + 8);
  const entriesTotal = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (disk !== 0 || cdDisk !== 0) {
    throw new Error("ZIP file refused: multi-disk archives are not supported.");
  }
  if (entriesTotal === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error("ZIP file refused: ZIP64 archives are not supported.");
  }
  if (entriesOnDisk !== entriesTotal) {
    throw new Error("ZIP file is corrupt: the directory entry counts do not agree.");
  }
  if (entriesTotal === 0) {
    throw new Error("ZIP file is empty: the archive holds no entries.");
  }
  need(bytes, cdOffset, cdSize, "the ZIP central directory");
  const records: CentralRecord[] = [];
  const seen = new Set<string>();
  let offset = cdOffset;
  const decoder = new TextDecoder("utf-8");
  for (let n = 0; n < entriesTotal; n += 1) {
    need(bytes, offset, 46, "a ZIP central directory entry");
    if (u32(bytes, offset) !== CENTRAL_SIG) {
      throw new Error(`ZIP file is corrupt: central directory entry ${n + 1} has a bad signature.`);
    }
    const flags = u16(bytes, offset + 8);
    const method = u16(bytes, offset + 10);
    const crc = u32(bytes, offset + 16);
    const compressedSize = u32(bytes, offset + 20);
    const size = u32(bytes, offset + 24);
    const nameLen = u16(bytes, offset + 28);
    const extraLen = u16(bytes, offset + 30);
    const commentLen = u16(bytes, offset + 32);
    const diskStart = u16(bytes, offset + 34);
    const localOffset = u32(bytes, offset + 42);
    need(bytes, offset + 46, nameLen + extraLen + commentLen, "a ZIP central directory entry");
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    if (diskStart !== 0) {
      throw new Error(`ZIP file refused: entry "${name}" lives on another disk of a multi-disk archive.`);
    }
    if (seen.has(name)) {
      throw new Error(`ZIP file is corrupt: entry "${name}" appears more than once.`);
    }
    seen.add(name);
    records.push({ name, flags, method, crc, compressedSize, size, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  if (offset !== cdOffset + cdSize) {
    throw new Error("ZIP file is corrupt: the central directory does not end where its header says it ends.");
  }
  return records;
}

function extractEntry(bytes: Uint8Array, record: CentralRecord): Uint8Array {
  if ((record.flags & 0x01) !== 0) {
    throw new Error(
      `ZIP entry "${record.name}" is encrypted. Encrypted entries are refused — the app never asks for a password.`,
    );
  }
  if (record.method !== 0 && record.method !== 8) {
    throw new Error(
      `ZIP entry "${record.name}" uses compression method ${record.method}. Only stored (0) and deflated (8) entries are supported.`,
    );
  }
  need(bytes, record.localOffset, 30, `the local header of ZIP entry "${record.name}"`);
  if (u32(bytes, record.localOffset) !== LOCAL_SIG) {
    throw new Error(`ZIP file is corrupt: entry "${record.name}" has a bad local header.`);
  }
  const localNameLen = u16(bytes, record.localOffset + 26);
  const localExtraLen = u16(bytes, record.localOffset + 28);
  const dataStart = record.localOffset + 30 + localNameLen + localExtraLen;
  need(bytes, dataStart, record.compressedSize, `the data of ZIP entry "${record.name}"`);
  const compressed = bytes.subarray(dataStart, dataStart + record.compressedSize);
  let data: Uint8Array;
  try {
    data = record.method === 0 ? compressed.slice() : inflate(compressed);
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`ZIP entry "${record.name}" could not be decompressed: ${err.message}`);
    }
    throw new Error(`ZIP entry "${record.name}" could not be decompressed.`);
  }
  if (data.length !== record.size) {
    throw new Error(
      `ZIP entry "${record.name}" is corrupt: it decompressed to ${data.length} bytes, expected ${record.size}.`,
    );
  }
  if (crc32(data) !== record.crc) {
    throw new Error(
      `ZIP entry "${record.name}" is corrupt: its CRC-32 check failed (the stored data does not match its recorded checksum).`,
    );
  }
  return data;
}

/**
 * Read a PKZIP archive: list every entry, extract each one, and
 * verify its CRC-32. Returns the entries in central-directory order.
 * Throws an Error with a plain-language message on any refusal.
 */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const records = readCentralDirectory(bytes);
  return records.map((record) => ({
    name: record.name,
    method: record.method,
    compressedSize: record.compressedSize,
    size: record.size,
    crc: record.crc,
    data: extractEntry(bytes, record),
  }));
}
