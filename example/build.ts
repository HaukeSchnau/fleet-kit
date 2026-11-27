// node example/build.ts [--check]: writes example/fleet.json and prints open findings.
// --check also fails when fleet.json is stale. Exits 1 on any error.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { build, stableJSON, type Service } from "../model/index.ts"
import fleet from "./fleet.ts"
import hosts from "./hosts.ts"

const dir = new URL(".", import.meta.url).pathname
const services: Record<string, Service> = {}
for (const name of readdirSync(`${dir}services`).sort())
  services[name] = (await import(`${dir}services/${name}/service.ts`)).default

const resolved = build({ ...fleet, hosts, services }, { exists: (p) => existsSync(`${dir}../${p}`) })
const out = stableJSON(resolved)
const path = `${dir}fleet.json`
let stale = false
if (!process.argv.includes("--check")) writeFileSync(path, out)
else if (!existsSync(path) || readFileSync(path, "utf8") !== out) {
  console.error("example/fleet.json is stale; run node example/build.ts")
  stale = true
}

for (const f of resolved.findings) console.log(`${f.severity.padEnd(5)} ${f.check.padEnd(12)} ${f.subject}: ${f.message}`)
const errors = resolved.findings.filter((f) => f.severity === "error").length
console.log(
  `${Object.keys(resolved.instances).length} instances on ${Object.keys(resolved.hosts).length} hosts, ${resolved.edges.length} edges; ` +
    `${errors} errors, ${resolved.findings.length - errors} warnings`,
)
process.exit(errors || stale ? 1 : 0)
