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
          # run the testing harness's seed step.
          packages = baseShell.nativeBuildInputs ++ [ triliumServer ];

          shellHook = baseShell.shellHook + ''
            # Points the testing harness (resources/testing/harness.js) at
            # Trilium's own e2e-test seed database (document.db + config.ini with
            # noAuthentication=true), fetched reproducibly via the trilium flake
            # input above.
            export TRILIUM_SRC="${trilium}"

            # The one-run test system: `run_tests` seeds the golden snapshot,
            # boots trilium-server with TAM deployed, drives the Playwright
            # suite, then stops the server -- all via playwright.config.js's
            # globalSetup/teardown. Extra args pass through to `playwright test`
            # (e.g. `run_tests --headed`, `run_tests -g TAM`). Named run_tests
            # rather than `test` because `test` is a bash builtin.
            run_tests()       { npx playwright test "$@"; }
            # Manual escape hatch for debugging the seed/server by hand -- the
            # normal path is `run_tests`.
            trilium_harness() { node resources/testing/harness.js "$@"; }

            export -f run_tests trilium_harness

            echo ""
            echo "  Trilium Testing System (see resources/testing/README.md)"
            echo ""
            echo "  run_tests                      Seed + start Trilium + deploy TAM + run Playwright suite"
            echo "  run_tests --headed             Same, with a visible browser"
            echo "  run_tests -g <pattern>         Run only matching tests"
            echo "  TRILIUM_TESTING_NO_RESEED=1 run_tests   Reuse the existing snapshot (skip reseed)"
            echo "  trilium_harness <seed|start|stop>       Manual server control (debugging)"
            echo ""
          '';
        };
      }
    );
}
