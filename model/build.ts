// Resolves a FleetInput into fleet.json. Pure: the same input gives the same bytes.

import type { Budget, FleetInput, HostClass, Realizer, Service, Size, State } from "./types.ts"
import type { Edge, Finding, Instance, ResolvedFleet, ResolvedHost, ResolvedRoute, Slice } from "./resolved.ts"

const UNIT: Record<string, number> = { K: 2 ** 10, M: 2 ** 20, G: 2 ** 30, T: 2 ** 40 }
export const bytes = (s: Size): number => Math.round(parseFloat(s) * UNIT[s.slice(-1)])
export const gib = (n: number): string => `${Math.round((n / 2 ** 30) * 10) / 10} GiB`

/** Accepts one error, by the id fleet.json gives the finding. */
export interface Acceptance {
  id: string
  reason: string
}

export interface BuildOptions {
  /** Findings the fleet knows about and accepts for now. */
  accepted?: Acceptance[]
  /** Whether a repository path exists, for runbook links. */
  exists?: (path: string) => boolean
}

const hostsOf = (s: Service): string[] => (Array.isArray(s.host) ? s.host : [s.host])
const backupOf = (st: State): "hourly" | "daily" | "none" => (typeof st.backup === "string" ? st.backup : "none")
const budgetOn = (s: Service, host: string): Budget | undefined =>
  !s.budget ? undefined : "memory" in s.budget ? (s.budget as Budget) : (s.budget as Record<string, Budget | undefined>)[host]
const secretsOn = (s: Service, host: string): string[] =>
  (s.secrets ?? []).flatMap((e) => (typeof e === "string" ? [e] : e.hosts.includes(host) ? [e.name] : [])).map((n) => n.replaceAll("{host}", host))
const byId = (a: [string, unknown], b: [string, unknown]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)

function closest(word: string, options: string[]): string | undefined {
  let best: [string, number] | undefined
  for (const o of options) {
    const d: number[][] = Array.from({ length: word.length + 1 }, (_, i) => [i, ...Array<number>(o.length).fill(0)])
    for (let j = 1; j <= o.length; j++) d[0][j] = j
    for (let i = 1; i <= word.length; i++)
      for (let j = 1; j <= o.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (word[i - 1] === o[j - 1] ? 0 : 1))
    const dist = d[word.length][o.length]
    if (!best || dist < best[1]) best = [o, dist]
  }
  return best && best[1] <= Math.max(2, Math.floor(word.length / 3)) ? best[0] : undefined
}

function slice(b: Omit<Budget, "each"> & { each?: Size }): Slice {
  const memory = bytes(b.memory)
  return {
    memory,
    ...(b.high !== "none" && { high: b.high ? bytes(b.high) : Math.floor(memory * 0.9) }),
    ...(b.cpuWeight !== undefined && { cpuWeight: b.cpuWeight }),
    ...(b.ioWeight !== undefined && { ioWeight: b.ioWeight }),
    ...(b.swap && { swap: bytes(b.swap) }),
    ...(b.each && { each: bytes(b.each) }),
  }
}

/** Networks a connection from `consumer` to an address with this visibility can take: every network of
 *  kind internet for a public one, the network called tailnet for a tailnet one. */
function via(visibility: string, consumer: ResolvedHost, provider: ResolvedHost, internet: string[]): string[] {
  if (visibility === "public") return internet
  if (visibility === "tailnet" && "tailnet" in consumer.networks && "tailnet" in provider.networks) return ["tailnet"]
  return []
}

export function build(input: FleetInput, options: BuildOptions = {}): ResolvedFleet {
  const findings: Finding[] = []
  const find = (check: string, severity: Finding["severity"], subject: string, message: string, key = "") =>
    findings.push({ id: `${check}:${subject}${key ? `:${key}` : ""}`, check, severity, subject, message })
  const edges = new Map<string, Edge>()
  const edge = (kind: Edge["kind"], from: string, to: string, derived: boolean, through?: string[]) =>
    edges.set(`${kind} ${from} ${to}`, { kind, from, to, derived, ...(through && { via: through }) })
  const ref = (check: string, subject: string, what: string, name: string, pool: string[]) => {
    if (pool.includes(name)) return true
    const near = closest(name, pool)
    find(check, "error", subject, `${what} "${name}" names nothing${near ? `; did you mean "${near}"?` : ""}`, `${what}:${name}`)
    return false
  }
  const hostNames = Object.keys(input.hosts).sort()
  const extNames = Object.keys(input.externals).sort()
  const netNames = Object.keys(input.networks).sort()
  const serviceNames = Object.keys(input.services).sort()
  const internet = netNames.filter((n) => input.networks[n].kind === "internet")
  const entries = (visibility: string) => (visibility === "public" ? internet : visibility === "tailnet" && netNames.includes("tailnet") ? ["tailnet"] : [])
  const realizers: Record<string, Realizer> = {}

  // Networks, externals, hosts
  for (const [name, n] of Object.entries(input.networks)) {
    realizers[`net:${name}`] = n.kind === "internet" ? "manual" : n.provisionedBy ? "stack" : "manual"
    if (n.provisionedBy && ref("references", `net:${name}`, "provisionedBy", n.provisionedBy, extNames))
      edge("provides", `ext:${n.provisionedBy}`, `net:${name}`, true)
  }
  for (const [name, e] of Object.entries(input.externals)) {
    realizers[`ext:${name}`] = e.realizer
    if (e.network && ref("references", `ext:${name}`, "network", e.network, netNames)) edge("memberOf", `ext:${name}`, `net:${e.network}`, false)
  }

  const hosts: Record<string, ResolvedHost> = {}
  for (const [name, h] of Object.entries(input.hosts).sort(byId)) {
    realizers[`host:${name}`] = "nix"
    const networks: ResolvedHost["networks"] = {}
    for (const [net, hn] of Object.entries(h.networks)) {
      if (!ref("references", `host:${name}`, "network", net, netNames)) continue
      networks[net] = { ...(hn?.address && { address: hn.address }), publicIngress: !!hn?.publicIngress }
      edge("memberOf", `host:${name}`, `net:${net}`, false)
    }
    if (h.provider && ref("references", `host:${name}`, "provider", h.provider, extNames)) edge("hostedBy", `host:${name}`, `ext:${h.provider}`, false)
    const slices: ResolvedHost["slices"] = {}
    for (const [cls, b] of Object.entries(h.budgets ?? {}) as [HostClass, Budget][]) slices[cls] = slice(b)
    const state = Object.entries(h.state ?? {}).sort(byId).map(([n, st]) => ({ name: n, path: st.path, backup: backupOf(st) }))
    for (const st of state) {
      const sid = `state:${name}:${st.name}`
      realizers[sid] = "nix"
      edge("storesIn", `host:${name}`, sid, false)
      if (input.backup && st.backup !== "none") edge("backedUpTo", sid, `ext:${input.backup.target}`, true)
    }
    hosts[name] = {
      platform: h.platform, system: h.system, power: h.power, deployedBy: h.deployedBy ?? "infra", networks,
      ssh: { port: h.ssh?.port ?? 22 },
      ...(h.resources.cpu && { cpu: h.resources.cpu }),
      ...(h.resources.memory && { memory: bytes(h.resources.memory) }),
      reserve: h.resources.reserve ? bytes(h.resources.reserve) : 0,
      ceilings: 0,
      instances: [], slices, routes: [], state,
      ...(h.batch && { batch: { ...slice(h.batch), classes: [...new Set(h.batch.classes)].sort() } }),
      backup: { ...(input.backup && { target: input.backup.target }), paths: [...new Set(state.filter((st) => st.backup !== "none").map((st) => st.path))] },
      secrets: [], health: { units: [...(h.health?.units ?? [])].sort(), http: [] },
    }
  }

  // Instances
  const instances: Record<string, Instance> = {}
  const instancesOf: Record<string, string[]> = {}
  for (const [name, s] of Object.entries(input.services).sort(byId)) {
    instancesOf[name] = []
    for (const host of hostsOf(s)) {
      if (!ref("references", `service:${name}`, "host", host, hostNames)) continue
      const id = `${name}@${host}`
      const h = input.hosts[host]
      instancesOf[name].push(id)
      realizers[id] = s.realizer ?? "nix"
      const routeEntries = Object.entries(s.routes ?? {}).sort(byId)
      const routes: ResolvedRoute[] = routeEntries.map(([key, r]) => ({
        fqdn: r.fqdn ?? `${key}.${h.domain ?? input.zone}`, ...(r.port !== undefined && { port: r.port }), static: !!r.static,
        visibility: r.visibility, runtime: !!r.runtime, instance: id,
      }))
      routes.forEach((r, i) => {
        const key = routeEntries[i][0]
        if (r.static && r.port !== undefined) find("routes", "error", id, `${r.fqdn} is static and has a port; pick one`, `${key}:static`)
        if (!r.static && !r.runtime && r.port === undefined) find("routes", "error", id, `${r.fqdn} needs a port, static: true or runtime: true`, `${key}:port`)
      })
      const budget = budgetOn(s, host)
      instances[id] = {
        service: name, host, realizer: s.realizer ?? "nix", routes,
        endpoints: Object.entries(s.endpoints ?? {}).sort(byId).map(([n, e]) => ({
          name: n, port: e.protocol === "ssh" ? hosts[host].ssh.port : e.port, protocol: e.protocol, visibility: e.visibility,
        })),
        state: Object.entries(s.state ?? {}).sort(byId).map(([n, st]) => ({ name: n, path: st.path, backup: backupOf(st) })),
        secrets: secretsOn(s, host).sort(), uses: [],
        ...(budget && { slice: slice(budget) }),
      }
      edge("runsOn", id, `host:${host}`, false)
      hosts[host].instances.push(id)
      hosts[host].routes.push(...routes)
      for (const r of routes) {
        realizers[`route:${r.fqdn}`] = r.runtime ? "runtime" : "nix"
        edge("serves", id, `route:${r.fqdn}`, false)
        for (const n of entries(r.visibility)) edge("enters", `net:${n}`, `route:${r.fqdn}`, true)
      }
      for (const st of instances[id].state) {
        const sid = `state:${id}:${st.name}`
        realizers[sid] = "nix"
        edge("storesIn", id, sid, false)
        if (st.backup !== "none") {
          if (!hosts[host].backup.paths.includes(st.path)) hosts[host].backup.paths.push(st.path)
          if (input.backup) edge("backedUpTo", sid, `ext:${input.backup.target}`, true)
        }
      }
      for (const sec of instances[id].secrets) {
        realizers[`secret:${sec}`] = "nix"
        edge("reads", id, `secret:${sec}`, false)
        if (!hosts[host].secrets.includes(sec)) hosts[host].secrets.push(sec)
      }
      if (s.health?.http) {
        const route = routes.find((r) => !r.runtime)
        if (route) hosts[host].health.http.push({ instance: id, url: `https://${route.fqdn}${s.health.http}` })
        else find("health", "error", id, `health.http is set, but ${name} has no route on ${host} to probe`)
      }
      if (budget) {
        const sv = (hosts[host].slices.services ??= { memory: 0, high: 0 })
        sv.memory += bytes(budget.memory)
        sv.high = Math.floor(sv.memory * 0.9)
      }
    }
  }

  // Uses, resolved to instances: the one on the same host if there is one, else all of them.
  // A use across hosts records the networks it can travel over; with none, it can't connect.
  for (const [id, inst] of Object.entries(instances)) {
    for (const u of input.services[inst.service].uses ?? []) {
      if (u.startsWith("ext:")) {
        if (ref("references", id, "uses", u.slice(4), extNames)) { inst.uses.push(u); edge("uses", id, u, false) }
        continue
      }
      if (!ref("references", id, "uses", u, serviceNames)) continue
      const local = instancesOf[u].filter((t) => instances[t].host === inst.host)
      for (const t of local.length ? local : instancesOf[u]) {
        inst.uses.push(t)
        const provider = instances[t]
        if (provider.host === inst.host) {
          edge("uses", id, t, false)
          continue
        }
        const nets = [...new Set([...provider.routes, ...provider.endpoints].flatMap((r) => via(r.visibility, hosts[inst.host], hosts[provider.host], internet)))].sort()
        edge("uses", id, t, false, nets)
        if (!nets.length)
          find("reachability", "error", t, `${id} connects to ${t} on another host, but ${t} declares no route or endpoint ${inst.host} can reach`, id)
      }
    }
    inst.uses.sort()
  }

  // Sources: every host rebuilds from the forge, or from a fallback while the forge is down. Each
  // edge records the networks the host reaches that source over, as uses edges do.
  if (input.sources && ref("references", "sources", "forge", input.sources.forge, serviceNames)) {
    const forge = instancesOf[input.sources.forge]
    const fallbacks = [...new Set((input.sources.fallbacks ?? []).flatMap((f) =>
      f.startsWith("ext:")
        ? ref("references", "sources", "fallback", f.slice(4), extNames) ? [f] : []
        : ref("references", "sources", "fallback", f, serviceNames) ? instancesOf[f] : [],
    ))].filter((f) => !forge.includes(f))
    // The networks a host reaches a source over; empty means it can't reach it.
    const pathTo = (host: string, t: string): string[] | undefined => {
      const provider = instances[t]
      if (!provider) {
        const net = input.externals[t.slice(4)].network
        return net ? (net in hosts[host].networks ? [net] : []) : internet
      }
      if (provider.host === host) return undefined
      return [...new Set([...provider.routes, ...provider.endpoints].flatMap((r) => via(r.visibility, hosts[host], hosts[provider.host], internet)))].sort()
    }
    for (const host of hostNames) for (const t of [...forge, ...fallbacks]) edge("buildsFrom", `host:${host}`, t, true, pathTo(host, t))
    for (const id of forge) {
      const host = instances[id].host
      const reachable = fallbacks.filter((f) => (pathTo(host, f) ?? ["local"]).length)
      if (reachable.length) find("sources", "warn", `host:${host}`, `${host} serves the forge its own rebuild needs; it relies on ${reachable.join(", ")} while ${id} is down`)
      else find("sources", "error", `host:${host}`, `${host} serves the forge its own rebuild needs, and no fallback it can reach stands in for it`)
    }
  }

  checkRoutes(hosts, instances, find)
  checkCapacity(hosts, instances, find)
  checkPower(input, instances, find)
  checkManual(input, options.exists, find)
  if (input.backup) ref("references", "backup", "target", input.backup.target, extNames)

  // Acceptances cover errors only; warnings stay visible.
  for (const f of findings) {
    const a = f.severity === "error" && options.accepted?.find((x) => x.id === f.id)
    if (a) f.accepted = a.reason
  }
  for (const a of options.accepted ?? [])
    if (!findings.some((f) => f.severity === "error" && f.id === a.id))
      find("accepted", "error", a.id, `accepted, but the finding no longer exists; remove the acceptance ("${a.reason}")`)

  for (const h of Object.values(hosts)) {
    h.instances.sort(); h.routes.sort((a, b) => (a.fqdn < b.fqdn ? -1 : 1)); h.backup.paths.sort(); h.secrets.sort()
    h.health.http.sort((a, b) => (a.instance < b.instance ? -1 : 1))
  }
  const coverage: Record<Realizer, number> = { nix: 0, stack: 0, runtime: 0, manual: 0 }
  for (const r of Object.values(realizers)) coverage[r] += 1

  return {
    version: 1,
    zone: input.zone,
    identities: [...(input.identities ?? [])].sort(),
    hosts,
    instances,
    externals: Object.fromEntries(Object.entries(input.externals).sort(byId).map(([n, e]) => [n, { provides: e.provides, realizer: e.realizer }])),
    networks: Object.fromEntries(Object.entries(input.networks).sort(byId).map(([n, v]) => [n, { kind: v.kind, realizer: realizers[`net:${n}`] }])),
    edges: [...edges.values()].sort((a, b) => (`${a.kind} ${a.from} ${a.to}` < `${b.kind} ${b.from} ${b.to}` ? -1 : 1)),
    findings: findings.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    coverage,
  }
}

type Find = (check: string, severity: Finding["severity"], subject: string, message: string, key?: string) => void

function checkRoutes(hosts: Record<string, ResolvedHost>, instances: Record<string, Instance>, find: Find) {
  const seen = new Map<string, string>()
  for (const [name, h] of Object.entries(hosts)) {
    // Occupancy per transport. Caddy's upstreams are TCP; sshd holds its port for every SSH endpoint.
    const ports = new Map<string, string>([[`tcp/${h.ssh.port}`, "sshd"]])
    const take = (key: string, id: string) => {
      const p = ports.get(key)
      if (p && p !== id) find("routes", "error", id, `${key} on ${name} is also taken by ${p}`, key)
      ports.set(key, id)
    }
    for (const id of h.instances)
      for (const e of instances[id].endpoints) if (e.protocol !== "ssh") take(`${e.protocol}/${e.port}`, id)
    for (const r of h.routes) {
      const other = seen.get(r.fqdn)
      if (other) find("routes", "error", r.instance, `${r.fqdn} is also served by ${other}`, `${r.fqdn}:duplicate:${other}`)
      seen.set(r.fqdn, r.instance)
      if (r.port !== undefined) take(`tcp/${r.port}`, r.instance)
      if (r.visibility === "public" && !Object.values(h.networks).some((n) => n.publicIngress))
        find("routes", "error", r.instance, `${r.fqdn} is public, but ${name} takes no public traffic`, `${r.fqdn}:public`)
    }
  }
}

function checkCapacity(hosts: Record<string, ResolvedHost>, instances: Record<string, Instance>, find: Find) {
  for (const [name, h] of Object.entries(hosts)) {
    const shared = new Set<string>(h.batch?.classes)
    for (const cls of shared) {
      const member = h.slices[cls as HostClass]
      if (!member) find("capacity", "error", `host:${name}`, `batch shares ${cls}, which has no budget on ${name}`, `batch:${cls}`)
      else if (member.memory > h.batch!.memory)
        find("capacity", "error", `host:${name}`, `${cls}'s ceiling ${gib(member.memory)} is above batch's ${gib(h.batch!.memory)}, so it can never reach it`, `batch:${cls}`)
    }
    const top = Object.entries(h.slices).filter(([cls]) => !shared.has(cls))
    h.ceilings = h.reserve + (h.batch?.memory ?? 0) + top.reduce((a, [, s]) => a + s.memory, 0)
    const without = h.instances.filter((id) => !instances[id].slice && instances[id].realizer !== "runtime")
    if (without.length) find("capacity", "warn", `host:${name}`, `${without.length} of ${h.instances.length} services declare no budget: ${without.join(", ")}`, "budgets")
    if (h.memory === undefined) {
      find("capacity", "warn", `host:${name}`, `${name} declares no memory, so nothing on it can be checked`, "memory")
      continue
    }
    const classes = top.sort(byId).map(([c, s]) => `${c} ${gib(s.memory)}`)
    if (h.batch) classes.push(`batch ${gib(h.batch.memory)} for ${h.batch.classes.join(" and ")}`)
    if (h.ceilings > h.memory)
      find("capacity", "error", `host:${name}`, `ceilings add up to ${gib(h.ceilings)} (reserve ${gib(h.reserve)}, ${classes.join(", ")}) on ${gib(h.memory)}`, "ceilings")
  }
}

function checkPower(input: FleetInput, instances: Record<string, Instance>, find: Find) {
  for (const [id, inst] of Object.entries(instances)) {
    for (const t of inst.uses) {
      if (t.startsWith("ext:")) continue
      const provider = instances[t]
      const power = input.hosts[provider.host].power
      if (provider.host !== inst.host && power !== "always-on")
        find("power", "warn", t, `${id} needs ${t}, but ${provider.host} ${power === "sleeps" ? "sleeps" : "roams"}`, id)
    }
  }
}

function checkManual(input: FleetInput, exists: BuildOptions["exists"], find: Find) {
  if (!exists) return
  const all: [string, { runbook: string }[] | undefined][] = [
    ...Object.entries(input.hosts).map(([n, h]): [string, typeof h.manual] => [`host:${n}`, h.manual]),
    ...Object.entries(input.services).map(([n, s]): [string, typeof s.manual] => [`service:${n}`, s.manual]),
    ...Object.entries(input.externals).map(([n, e]): [string, typeof e.manual] => [`ext:${n}`, e.manual]),
    ...Object.entries(input.networks).map(([n, v]): [string, typeof v.manual] => [`net:${n}`, v.manual]),
  ]
  for (const [subject, manual] of all)
    for (const m of manual ?? [])
      if (!m.runbook.startsWith("https://") && !exists(m.runbook)) find("manual", "error", subject, `runbook ${m.runbook} doesn't exist`, m.runbook)
}
