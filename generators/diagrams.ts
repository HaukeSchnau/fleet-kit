// node generators/diagrams.ts <fleet.json> <dir>: writes every view of a resolved fleet as D2.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import type { ResolvedFleet } from "../model/index.ts"
import { d2 } from "./d2.ts"
import { views, viewGraph } from "./views.ts"

const [input, out] = process.argv.slice(2)
if (!input || !out) {
  console.error("usage: node generators/diagrams.ts <fleet.json> <dir>")
  process.exit(2)
}
const fleet: ResolvedFleet = JSON.parse(readFileSync(input, "utf8"))
mkdirSync(out, { recursive: true })
for (const [name, view] of Object.entries(views)) writeFileSync(`${out}/${name}.d2`, d2(viewGraph(fleet, view)))
