// A view picks edge kinds and whether nodes sit inside their host. Its nodes
// are the ends of those edges, so a view can't show something unconnected.
import type { EdgeKind, ResolvedFleet } from "../model/index.ts"

export interface View {
  question: string
  edges: EdgeKind[]
  groupByHost: boolean
}

export const views = {
  ingress: { question: "How does a request reach each service?", edges: ["enters", "serves"], groupByHost: true },
  dependencies: { question: "What does each service connect to?", edges: ["uses"], groupByHost: true },
  data: { question: "Where does state live, and where does it get backed up?", edges: ["storesIn", "backedUpTo"], groupByHost: true },
  network: { question: "Which networks connect which machines?", edges: ["memberOf", "hostedBy", "provides"], groupByHost: false },
  secrets: { question: "Which instance reads which secret?", edges: ["reads"], groupByHost: false },
} satisfies Record<string, View>

export interface ViewNode { id: string; label: string; kind: string; host?: string }
export interface ViewGraph { nodes: ViewNode[]; edges: { kind: EdgeKind; from: string; to: string; derived: boolean }[] }

export function viewGraph(fleet: ResolvedFleet, view: View): ViewGraph {
  const kinds = new Set<string>(view.edges)
  const edges = fleet.edges.filter((e) => kinds.has(e.kind))
  const ids = [...new Set(edges.flatMap((e) => [e.from, e.to]))].sort()
  const nodes = ids.map((id): ViewNode => {
    const inst = fleet.instances[id]
    if (inst) return { id, label: inst.service, kind: "instance", ...(view.groupByHost && { host: inst.host }) }
    const [kind, rest] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)]
    if (kind === "state") {
      // state:<instance or host>:<name>
      const owner = rest.slice(0, rest.lastIndexOf(":"))
      const name = rest.slice(rest.lastIndexOf(":") + 1)
      const inst = fleet.instances[owner]
      const host = inst ? inst.host : owner
      const st = (inst ? inst.state : fleet.hosts[owner]?.state ?? []).find((s) => s.name === name)
      return { id, label: st?.path ?? rest, kind, ...(view.groupByHost && { host }) }
    }
    if (kind === "route") {
      const host = Object.entries(fleet.hosts).find(([, h]) => h.routes.some((r) => r.fqdn === rest))?.[0]
      return { id, label: rest, kind, ...(view.groupByHost && host && { host }) }
    }
    return { id, label: rest, kind }
  })
  return { nodes, edges }
}
