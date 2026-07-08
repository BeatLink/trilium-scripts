{
  description = "Trilium Scripts (addon repo) with a standalone Trilium testing harness";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs";
    flake-utils.url = "github:numtide/flake-utils";
    # Pulled in solely to build a headless trilium-server binary and to read
    # its e2e-test seed database (apps/server/spec/db) — see
    # resources/testing/. Nothing here assumes a local checkout of this repo
    # exists anywhere; Nix fetches and builds it.
    trilium.url = "github:BeatLink/Trilium";
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
        triliumServer = trilium.packages.${system}.server;
      in
      {
        devShells.default = pkgs.mkShell {
          packages = baseShell.buildInputs ++ [ triliumServer ];

          shellHook = baseShell.shellHook + ''
            # Points resources/testing/seed.py at Trilium's own e2e-test seed
            # database (document.db + config.ini with noAuthentication=true),
            # fetched reproducibly via the trilium flake input above.
            export TRILIUM_SRC="${trilium}"

            trilium_seed()   { python3 resources/testing/seed.py "$@"; }
            trilium_server() { python3 resources/testing/run_server.py "$@"; }

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
