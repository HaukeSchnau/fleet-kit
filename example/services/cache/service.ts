import { service } from "../../define.ts"

// The edge agent reads a cache on a host that sleeps, which the power check reports.
export default service({
  host: "desk",
  description: "A binary cache of what desk builds",
  routes: { cache: { port: 5000, visibility: "tailnet" } },
  state: { store: { path: "/var/cache/builds", backup: { none: "rebuilt from the forge" } } },
  budget: { memory: "256M" },
})
