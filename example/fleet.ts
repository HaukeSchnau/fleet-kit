import type { FleetInput } from "../model/index.ts"
import type { HostName } from "./hosts.ts"

export default {
  zone: "example.net",
  identities: ["Alex Example", "alex"],
  networks: {
    internet: { kind: "internet" },
    tailnet: { kind: "overlay", provisionedBy: "vpn" },
    "home-lan": { kind: "lan" },
  },
  externals: {
    vpn: { provides: "overlay coordination and its access policy", realizer: "stack" },
    hoster: { provides: "rented servers", realizer: "manual" },
    "object-store": { provides: "the restic repository", realizer: "manual" },
    mirror: { provides: "public mirrors of the forge", realizer: "runtime" },
  },
  sources: { forge: "forge", fallbacks: ["ext:mirror"] },
  backup: { target: "object-store" },
} satisfies Omit<FleetInput<HostName>, "hosts" | "services">
