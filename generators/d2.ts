import type { ViewGraph } from "./views.ts"

const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
const shape: Record<string, string> = { ext: "cloud", state: "cylinder", route: "oval", net: "parallelogram", secret: "hexagon" }

export function d2(g: ViewGraph): string {
  const key = (id: string) => {
    const n = g.nodes.find((x) => x.id === id)
    return n?.host ? `${q(`host:${n.host}`)}.${q(id)}` : q(id)
  }
  const line = (n: ViewGraph["nodes"][number], indent: string) =>
    `${indent}${q(n.id)}: ${q(n.label)}${shape[n.kind] ? ` {shape: ${shape[n.kind]}}` : ""}`
  const out = ["direction: right", ""]
  const hosts = [...new Set(g.nodes.flatMap((n) => (n.host ? [n.host] : [])))].sort()
  for (const h of hosts) {
    out.push(`${q(`host:${h}`)}: ${q(h)} {`, ...g.nodes.filter((n) => n.host === h).map((n) => line(n, "  ")), "}")
  }
  out.push(...g.nodes.filter((n) => !n.host).map((n) => line(n, "")), "")
  for (const e of g.edges) out.push(`${key(e.from)} -> ${key(e.to)}: ${q(e.kind)}${e.derived ? " {style.stroke-dash: 3}" : ""}`)
  return out.join("\n") + "\n"
}
