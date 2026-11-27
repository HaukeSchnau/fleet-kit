// fleet.json: what the build writes and Nix, Calder, Alchemy and the
// generators read. Every fact is resolved here: names are full, sizes are
// bytes, references point at instances. Readers never derive fleet facts.

import type { HostClass, Platform, Power, Realizer, System, Visibility } from "./types.ts"

export interface ResolvedFleet {
  version: 1
  zone: string
  identities: string[]
  hosts: Record<string, ResolvedHost>
  /** One per service and host it runs on, keyed `<service>@<host>`. */
  instances: Record<string, Instance>
  externals: Record<string, { provides: string; realizer: Realizer }>
  networks: Record<string, { kind: string; realizer: Realizer }>
  edges: Edge[]
  findings: Finding[]
  coverage: Record<Realizer, number>
}

export interface ResolvedHost {
  platform: Platform
  system: System
  power: Power
  deployedBy: "infra" | "fleet"
  networks: Record<string, { address?: string; publicIngress: boolean }>
  ssh: { port: number }
  cpu?: number
  memory?: number
  reserve: number
  /** reserve plus every top-level slice's ceiling, batch once; the capacity check compares it with memory. */
  ceilings: number
  instances: string[]
  /** One systemd slice per workload class; `services` holds a sub-slice per instance. */
  slices: Partial<Record<"services" | HostClass, Slice>>
  /** The parent slice that `classes` share. */
  batch?: Slice & { classes: HostClass[] }
  /** What this host's Caddy serves. */
  routes: ResolvedRoute[]
  /** State no service owns. */
  state: { name: string; path: string; backup: "hourly" | "daily" | "none" }[]
  backup: { target?: string; paths: string[] }
  secrets: string[]
  /** What decides whether a switch succeeded. */
  health: { units: string[]; http: { instance: string; url: string }[] }
}

export interface Slice {
  memory: number
  /** Absent when the class is unthrottled. */
  high?: number
  cpuWeight?: number
  ioWeight?: number
  swap?: number
  /** Consumers derive slot counts from this: slots = floor(memory / each). */
  each?: number
}

export interface Instance {
  service: string
  host: string
  realizer: Realizer
  routes: ResolvedRoute[]
  endpoints: { name: string; port: number; protocol: "tcp" | "udp" | "ssh"; visibility: Visibility }[]
  state: { name: string; path: string; backup: "hourly" | "daily" | "none" }[]
  secrets: string[]
  /** Instance ids or `ext:<name>`. */
  uses: string[]
  slice?: Slice
}

export interface ResolvedRoute {
  fqdn: string
  /** Missing for static files and runtime routes. */
  port?: number
  static: boolean
  visibility: Visibility
  runtime: boolean
  instance: string
}

export type EdgeKind =
  | "memberOf" | "hostedBy" | "provides" | "runsOn" | "serves" | "enters"
  | "uses" | "storesIn" | "backedUpTo" | "reads" | "buildsFrom"

export interface Edge {
  kind: EdgeKind
  from: string
  to: string
  /** Derived by the build rather than written by an author. */
  derived: boolean
  /** For a use across hosts: the networks the connection can travel over. */
  via?: string[]
}

export interface Finding {
  /** Stable: `<check>:<subject>[:<key>]`. Acceptances name it. */
  id: string
  check: string
  severity: "error" | "warn"
  subject: string
  message: string
  /** Set when the fleet accepted this finding, with the reason it gave. */
  accepted?: string
}
