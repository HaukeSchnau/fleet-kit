import { service } from "../../define.ts"

// Agents dial the controller, so they use ci and not the other way round.
export default service({
  host: ["edge", "desk"],
  description: "Runs CI jobs inside the host's ci budget",
  secrets: ["ci/agent-token"],
  uses: ["ci", "forge"],
  budget: { edge: { memory: "256M" }, desk: { memory: "512M" } },
})
