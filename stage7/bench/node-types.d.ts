/**
 * Minimal ambient declarations for the Node builtins the Stage 7 bench
 * runner uses. The project keeps TypeScript as its only dev dependency,
 * so @types/node is not installed; these cover exactly the bench's API
 * surface (fs read/write, process argv/memory/exit). Runtime behaviour
 * is Node's own.
 */
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
}

declare const process: {
  argv: string[];
  version: string;
  env: Record<string, string | undefined>;
  memoryUsage(): { rss: number; heapUsed: number; heapTotal: number };
  resourceUsage(): { maxRSS: number };
  exit(code: number): never;
};
