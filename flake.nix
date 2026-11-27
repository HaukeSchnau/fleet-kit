{
  description = "fleet-kit: a fleet of machines as a TypeScript model, with checks, diagrams and an explorer";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      inherit (nixpkgs) lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAll = f: lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      example = builtins.fromJSON (builtins.readFile ./example/fleet.json);
      src = lib.fileset.toSource {
        root = ./.;
        fileset = lib.fileset.unions [
          ./model
          ./generators
          ./explorer
          ./example
          ./node.d.ts
          ./package.json
          ./tsconfig.json
        ];
      };
      inSource =
        pkgs: name: inputs: script:
        pkgs.runCommand name { nativeBuildInputs = inputs; } ''
          cp -r ${src} source
          chmod -R u+w source
          cd source
          ${script}
        '';
    in
    {
      packages = forAll (pkgs: {
        # Every view of the example as D2 and SVG. d2 lays out with ELK, which gives the same bytes
        # for the same input, so `nix build .#diagrams --rebuild` checks the output is deterministic.
        diagrams = inSource pkgs "example-diagrams" [ pkgs.nodejs pkgs.d2 ] ''
          node generators/diagrams.ts example/fleet.json $out
          for f in $out/*.d2; do
            d2 --layout=elk --pad 10 "$f" "''${f%.d2}.svg" 2>/dev/null
          done
        '';

        # The explorer, a static page that renders the example's fleet.json.
        explorer = inSource pkgs "example-explorer" [ pkgs.typescript ] ''
          tsc --ignoreConfig generators/views.ts generators/d2.ts --outDir $out/lib --rootDir . \
            --target es2022 --module es2022 --moduleResolution bundler --strict --types "" \
            --allowImportingTsExtensions --rewriteRelativeImportExtensions
          cp explorer/index.html explorer/explorer.js example/fleet.json $out/
        '';
      });

      checks = forAll (pkgs: {
        # Types, and an example/fleet.json that is fresh and has no errors.
        lint = inSource pkgs "fleet-kit-lint" [ pkgs.nodejs pkgs.typescript ] ''
          tsc -p .
          node example/build.ts --check
          touch $out
        '';

        # The realizers' model module gives every example host its entry of fleet.json.
        realizers = pkgs.writeText "example-realizers.json" (
          builtins.toJSON (
            lib.mapAttrs (
              name: _:
              (lib.evalModules {
                modules = [
                  ./realizers/model.nix
                  {
                    fleetModel = {
                      resolved = example;
                      host = name;
                    };
                  }
                ];
              }).config.fleetModel.self.platform
            ) example.hosts
          )
        );

        inherit (self.packages.${pkgs.stdenv.hostPlatform.system}) diagrams explorer;
      });

      devShells = forAll (pkgs: {
        default = pkgs.mkShellNoCC {
          packages = [
            pkgs.nodejs
            pkgs.typescript
            pkgs.d2
          ];
        };
      });
    };
}
