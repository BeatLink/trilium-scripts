{
  description = "Trilium Scripts (addon repo) with a standalone Trilium testing harness";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs";
    flake-utils.url = "github:numtide/flake-utils";
    # Pulled in solely to read its e2e-test seed database
    # (apps/server/spec/db) — see resources/testing/. Nothing here assumes a
    # local checkout of this repo exists anywhere; Nix fetches it (a plain
    # source fetch, no build). The server *binary* itself comes from
    # nixpkgs' own prebuilt `trilium-server` package below instead of
    # building this input from source — nixpkgs' copy is a cached release
    # tarball, so it resolves in seconds rather than a full compile.
    trilium.url = "github:BeatLink/Trilium";
    trilium.flake = false;
  };

  outputs = { self, nixpkgs, flake-utils, trilium }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        # Reuse the existing nix-shell workflow (validate/tam_to_zip/etc.)
        # rather than duplicating it — this repo's own shell.nix is the
        # source of truth for that tooling, `nix-shell` alone still works
        # exactly as before.
        baseShell = import ./shell.nix { inherit pkgs; };
        triliumServer = pkgs.trilium-server;
      in
      {
        devShells.default = pkgs.mkShell {
          # `pkgs.mkShell`'s `packages` argument is stored as
          # `nativeBuildInputs` on the resulting derivation, not
          # `buildInputs` — baseShell.buildInputs silently evaluated to `[]`
          # here (nodejs/gh from shell.nix were never actually reaching
          # this shell's PATH) until this was caught by trying to actually
          # run trilium_seed.
          packages = baseShell.nativeBuildInputs ++ [ triliumServer ];

          shellHook = baseShell.shellHook + ''
            # Points resources/testing/seed.js at Trilium's own e2e-test seed
            # database (document.db + config.ini with noAuthentication=true),
            # fetched reproducibly via the trilium flake input above.
            export TRILIUM_SRC="${trilium}"

            trilium_seed()   { node resources/testing/seed.js "$@"; }
            trilium_server() { node resources/testing/run_server.js "$@"; }

            export -f trilium_seed trilium_server

            echo ""
            echo "  Trilium Testing Harness (see resources/testing/README.md)"
            echo ""
            echo "  trilium_seed                   One-time: build the golden test-data snapshot"
            echo "  trilium_server start            Start the test server (background, in-memory db)"
            echo "  trilium_server start --real     Start against the real db file (writes persist)"
            echo "  trilium_server stop              Stop the test server"
            echo ""
          '';
        };
      }
    );
}
