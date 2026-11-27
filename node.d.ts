// Types for the few Node APIs the build scripts use, so type checking needs no npm
// packages. Replace with @types/node once the scripts need more of Node.
declare module "node:fs" {
  export function existsSync(path: string): boolean
  export function readdirSync(path: string): string[]
  export function readFileSync(path: string, encoding: "utf8"): string
  export function writeFileSync(path: string, data: string): void
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
  export function statSync(path: string): { isDirectory(): boolean }
}
declare const process: {
  argv: string[]
  env: Record<string, string | undefined>
  exit(code?: number): never
}
interface ImportMeta {
  url: string
}
