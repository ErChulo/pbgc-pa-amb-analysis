/**
 * Minimal ambient declarations for the Node builtins the test suite uses
 * (`node:test`, `node:assert/strict`).
 *
 * Why this file exists: the project allows TypeScript as its ONLY dev
 * dependency, so `@types/node` is not installed. These declarations cover
 * exactly the API surface the tests use — nothing more — so `tsc` can
 * type-check the tests without a second dev dependency. The runtime
 * behaviour is Node's own; nothing here re-implements it.
 */

declare module "node:test" {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
}

declare module "node:zlib" {
  export const constants: { Z_FIXED: number; Z_DEFAULT_STRATEGY: number };
  export function deflateRawSync(
    data: Uint8Array,
    options?: { level?: number; strategy?: number },
  ): Uint8Array;
}

declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
}

declare const process: { cwd(): string };

declare module "node:assert/strict" {
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    notDeepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    match(value: string, regex: RegExp, message?: string): void;
    doesNotMatch(value: string, regex: RegExp, message?: string): void;
    throws(fn: () => unknown, expected?: RegExp | string | ((err: unknown) => boolean), message?: string): void;
  };
  export default assert;
}
