// What a fleet author writes. Everything here is plain data: no functions,
// no computed values. The build resolves it into fleet.json (resolved.ts).

/** Bytes as a number with a unit: "512M", "7G". */
export type Size = `${number}${"K" | "M" | "G" | "T"}`

export type Platform = "nixos" | "darwin"
export type System = "aarch64-linux" | "x86_64-linux" | "aarch64-darwin"

/** How a host is reachable over time. Sleeping and roaming hosts can't hold what others need. */
export type Power = "always-on" | "sleeps" | "roaming"

export type Visibility = "public" | "tailnet" | "local"

/** How an entity comes to exist. `manual` entities name the runbook a person follows. */
export type Realizer = "nix" | "stack" | "runtime" | "manual"

/** A step someone does by hand, until something does it for them. */
export interface Manual {
  step: string
  /** Repository path of the runbook, which the build checks exists, or an https URL. */
  runbook: string
}

/** A memory share for one workload class on one host, enforced as a systemd slice. */
export interface Budget {
  /** Hard ceiling (MemoryMax). */
  memory: Size
  /**
   * Throttle point (MemoryHigh). Defaults to 90 % of memory. "none" leaves the class unthrottled:
   * Nix builds share their cgroup with the daemon workers every evaluation talks to, so throttling
   * the builds stalls evaluations too.
   */
  high?: Size | "none"
  cpuWeight?: number
  ioWeight?: number
  swap?: Size
  /** Ceiling for one job or session inside the class; consumers derive their slot counts from it. */
  each?: Size
}

/** Workload classes besides `services`, whose budget is the sum of the services' own. */
export type HostClass = "agents" | "ci" | "builds" | "maintenance"

export interface HostNetwork {
  address?: string
  /** The host accepts public traffic on this network (ports 80 and 443). */
  publicIngress?: boolean
}

export interface Host<N extends string = string> {
  platform: Platform
  system: System
  /** External that hosts the machine, if any. */
  provider?: string
  /** Which repository builds and deploys the host while hosts move over. Defaults to infra. */
  deployedBy?: "infra" | "fleet"
  power: Power
  /** Domain below which this host's routes get their names, e.g. "host-a.example.org". */
  domain?: string
  resources: { cpu?: number; memory?: Size; disk?: Size; reserve?: Size }
  networks: Partial<Record<N, HostNetwork>>
  /** The host's sshd. Defaults to port 22. */
  ssh?: { port: number }
  budgets?: Partial<Record<HostClass, Budget>>
  /**
   * One ceiling that the listed classes share, as a parent slice around theirs. Each class keeps
   * its own ceiling inside it, so classes that peak at different times can each have more than
   * their share. The capacity check counts the parent once instead of its members.
   */
  batch?: Omit<Budget, "each"> & { classes: HostClass[] }
  /** Units whose failure after a switch means the switch failed. Everything else only alerts. */
  health?: { units?: string[] }
  /** State no service owns, such as host keys and home directories. */
  state?: Record<string, State>
  manual?: Manual[]
}

export interface Network {
  kind: "internet" | "overlay" | "lan"
  /** External that provides it, for an overlay. */
  provisionedBy?: string
  manual?: Manual[]
}

export interface External {
  provides: string
  realizer: Realizer
  /** Network the external sits on, when it isn't the internet. */
  network?: string
  manual?: Manual[]
}

export interface Route {
  /** Local port Caddy proxies to. Omit for static files and for runtime routes. */
  port?: number
  /** Caddy serves files itself. */
  static?: boolean
  visibility: Visibility
  /** Full name, when it isn't `<key>.<host domain>`. */
  fqdn?: string
  /** A controller creates it without a switch (agent-service, placements). */
  runtime?: boolean
}

/** A port a service listens on directly, without Caddy in front (SSH, a TCP API, a builder). */
export type Endpoint =
  | { protocol: "tcp" | "udp"; port: number; visibility: Visibility }
  /** Reached through the host's own sshd, so it shares the host's SSH port. */
  | { protocol: "ssh"; visibility: Visibility }

export interface State {
  path: string
  backup: "hourly" | "daily" | { none: string }
}

export interface Service<H extends string = string> {
  /** One host, or several: each gets its own instance `<service>@<host>`. */
  host: H | H[]
  description?: string
  /** HTTPS names this host's Caddy serves for the service. */
  routes?: Record<string, Route>
  endpoints?: Record<string, Endpoint>
  state?: Record<string, State>
  /** sops keys the service reads. `{host}` in a name becomes the instance's host; an object limits
   *  a key to some of the service's hosts. */
  secrets?: (string | { name: string; hosts: H[] })[]
  /** What this service connects to: other services by name, or externals as `ext:<name>`.
   *  The direction matters: an agent that dials its controller uses the controller. */
  uses?: string[]
  /** One budget for every instance, or one per host. */
  budget?: Budget | Partial<Record<H, Budget>>
  health?: { http?: string; units?: string[] }
  realizer?: Realizer
  manual?: Manual[]
}

/** Where a host's Nix inputs come from, so the build can find hosts that need themselves to rebuild. */
export interface Sources {
  /** Service that serves the flake's own inputs. */
  forge: string
  /** Externals or services that can stand in when the forge is down. */
  fallbacks?: string[]
}

export interface FleetInput<H extends string = string> {
  zone: string
  networks: Record<string, Network>
  externals: Record<string, External>
  hosts: Record<H, Host>
  services: Record<string, Service<H>>
  sources?: Sources
  /** Where backups go. */
  backup?: { target: string }
  /** People and accounts whose names must never reach the public tree; the leak guard reads them. */
  identities?: string[]
}
