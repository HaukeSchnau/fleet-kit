import { service } from "../../define.ts"

export default service({
  host: "core",
  description: "Git hosting, and the source every host rebuilds from",
  routes: { git: { port: 3000, visibility: "tailnet" } },
  endpoints: { ssh: { protocol: "ssh", visibility: "tailnet" } },
  state: { repositories: { path: "/var/lib/forge", backup: "hourly" } },
  secrets: ["forge/admin-token"],
  uses: ["ext:mirror"],
  budget: { memory: "1G" },
  health: { http: "/api/healthz", units: ["forge.service"] },
})
