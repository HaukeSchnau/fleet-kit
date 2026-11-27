import { service } from "../../define.ts"

export default service({
  host: ["desk", "laptop"],
  description: "Coding agents, which push to the forge",
  state: { workspaces: { path: "/home/agents", backup: { none: "worktrees of the forge's repositories" } } },
  secrets: [{ name: "agents/model-key", hosts: ["desk"] }],
  uses: ["forge", "ci"],
  budget: { desk: { memory: "512M" } },
})
