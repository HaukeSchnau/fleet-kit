# fleet-kit

A fleet of machines written down as a TypeScript model: hosts, networks, services, routes, state,
secrets and memory budgets as plain data. The build resolves the model into one `fleet.json`, runs
checks on it, and draws it. Nix reads `fleet.json` and never runs TypeScript.

The checks find what goes wrong in a fleet before a host does. A route can name a port that another
service already holds. Budgets can add up to more memory than the host has. A service can depend on
a machine that sleeps, or the forge can be needed to rebuild its own host.

`example/` is a made-up fleet of four hosts that this repository's checks build.

## Commands

```sh
nix develop                                          # node, tsc, d2
node example/build.ts                                # write example/fleet.json, print findings
node example/build.ts --check                        # fail when fleet.json is stale or has an error
node generators/diagrams.ts example/fleet.json out   # every view as D2
nix build .#diagrams                                 # the example's views as D2 and SVG
nix build .#explorer                                 # the explorer with the example, ready to serve
nix flake check                                      # types, the example, diagrams, explorer, realizers
```

Node 24 or newer runs the TypeScript directly. The model has no npm dependencies, so type checking
needs only `typescript`.

## Layout

| Path | Holds |
| --- | --- |
| `model/types.ts` | What a fleet's author writes |
| `model/resolved.ts` | `fleet.json`, what the build writes |
| `model/build.ts` | The build and its checks |
| `generators/` | Views of the resolved fleet, and their D2 |
| `explorer/` | A static page that renders every view of a `fleet.json` and simulates failures |
| `realizers/model.nix` | A NixOS and nix-darwin module that gives each host its entry of `fleet.json` |
| `example/` | A made-up fleet: `hosts.ts`, `fleet.ts`, a folder per service, and its `fleet.json` |

## Writing a fleet

Copy `example/`. `hosts.ts` declares the hosts, and its keys become the `HostName` type, so a
service that names a host that doesn't exist fails to type-check. Each service is a folder with a
`service.ts`, and `build.ts` finds them. A service's `uses` names what it connects to, in the
direction of the connection. Its `secrets` name keys and never hold values.

The build reports findings as errors and warnings. Its `accepted` option takes the ids of errors
you know about and accept for now, each with a reason.

## Snapshots

This repository is published from a private one, whose CI writes each commit here as one snapshot
of this tree. `CHANGELOG.md` lists what each snapshot changed. Only that CI pushes here, so a pull
request here can't be merged; open an issue instead.

## License

MIT, see `LICENSE`.
