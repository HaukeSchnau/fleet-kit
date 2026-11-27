import { service } from "../../define.ts"

export default service({
  host: "edge",
  description: "The CI controller: it plans runs and hands jobs to its agents",
  routes: { ci: { port: 8080, visibility: "tailnet" } },
  state: { runs: { path: "/var/lib/ci", backup: "daily" } },
  secrets: ["ci/webhook-secret", "ci/forge-token"],
  uses: ["forge"],
  budget: { memory: "512M" },
})
