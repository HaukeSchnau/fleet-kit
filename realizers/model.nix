# Gives every host its share of fleet.json. Works in NixOS and nix-darwin; realizers read
# `config.fleetModel.self` and never derive fleet facts themselves.
{ config, lib, ... }:
{
  options.fleetModel = {
    resolved = lib.mkOption {
      type = lib.types.attrs;
      description = "fleet.json, as builtins.fromJSON reads it.";
    };
    host = lib.mkOption {
      type = lib.types.str;
      description = "This host's name in fleet.json.";
    };
    self = lib.mkOption {
      type = lib.types.attrs;
      readOnly = true;
      description = "This host's entry in fleet.json.";
    };
  };
  config.fleetModel.self = config.fleetModel.resolved.hosts.${config.fleetModel.host};
}
