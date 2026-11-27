export type * from "./types.ts"
export type * from "./resolved.ts"
export { build, bytes, gib, type Acceptance, type BuildOptions } from "./build.ts"
export { stableJSON } from "./json.ts"
import type { Host, Service } from "./types.ts"

/** Typed identity helpers: the host names a fleet declares become a union type for its services. */
export const hosts = <const T extends Record<string, Host>>(h: T): T => h
export const serviceFor = <H extends string>() => (s: Service<H>): Service<H> => s
