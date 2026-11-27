import { hosts } from "../model/index.ts"

// A made-up fleet: two rented servers, a desktop at home that sleeps, and a laptop.
const all = hosts({
  edge: {
    platform: "nixos",
    system: "aarch64-linux",
    provider: "hoster",
    power: "always-on",
    domain: "example.net",
    ssh: { port: 2222 },
    resources: { cpu: 4, memory: "8G", reserve: "1G" },
    networks: { internet: { publicIngress: true }, tailnet: { address: "100.64.0.1" } },
    budgets: { ci: { memory: "3G", each: "1G" } },
    state: { "ssh-host-keys": { path: "/etc/ssh", backup: "daily" } },
  },
  core: {
    platform: "nixos",
    system: "aarch64-linux",
    provider: "hoster",
    power: "always-on",
    domain: "core.example.net",
    resources: { cpu: 4, memory: "8G", reserve: "1G" },
    networks: { internet: {}, tailnet: { address: "100.64.0.2" } },
    budgets: { builds: { memory: "4G", swap: "2G" } },
    health: { units: ["forge.service"] },
  },
  desk: {
    platform: "nixos",
    system: "x86_64-linux",
    power: "sleeps",
    domain: "desk.example.net",
    resources: { cpu: 16, memory: "32G", reserve: "2G" },
    networks: { "home-lan": { address: "192.168.1.10" }, tailnet: { address: "100.64.0.3" } },
    budgets: { agents: { memory: "16G", each: "4G" }, builds: { memory: "8G" } },
  },
  laptop: {
    platform: "darwin",
    system: "aarch64-darwin",
    power: "roaming",
    resources: { memory: "16G" },
    networks: { tailnet: { address: "100.64.0.4" } },
  },
})

export default all
export type HostName = keyof typeof all
