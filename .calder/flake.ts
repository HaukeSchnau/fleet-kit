// The flake checks every system has, which Calder builds on every push.
import { Flake } from "@calder-ci/core"

export const flake = Flake.make({
  packages: ["diagrams", "explorer"],
  checks: ["diagrams", "explorer", "lint", "realizers"],
  devShells: ["default"],
})
