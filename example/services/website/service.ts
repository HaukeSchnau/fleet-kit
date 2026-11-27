import { service } from "../../define.ts"

export default service({
  host: "edge",
  description: "A static site, the only thing the internet reaches",
  routes: { www: { static: true, visibility: "public" } },
})
