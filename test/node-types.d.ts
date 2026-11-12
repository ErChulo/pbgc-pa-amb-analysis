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

declare module "node:assert/strict" {
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    notDeepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    match(value: string, regex: RegExp, message?: string): void;
    doesNotMatch(value: string, regex: RegExp, message?: string): void;
    throws(fn: () => unknown, expected?: RegExp | string, message?: string): void;
  };
  export default assert;
}
