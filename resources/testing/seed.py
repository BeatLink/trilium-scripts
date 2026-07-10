#!/usr/bin/env python3
"""One-time (re-runnable) bootstrap of the golden test-data snapshot.

Copies Trilium's own e2e-test seed database (fetched via the `trilium` flake
input — see flake.nix, exposed here as $TRILIUM_SRC) into
resources/testing/data/, boots a *real* (disk-writing) server against it,
imports TAM into it via tam_to_zip.py + the notes-import endpoint, then stops
the server.

From then on every `trilium_server start` boots this exact snapshot
in-memory (TRILIUM_INTEGRATION_TEST=memory) and can never corrupt it — re-run
this script any time you want to rebuild the snapshot from scratch (e.g.
after a breaking TAM change).
"""
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import run_server  # noqa: E402
import trilium_client  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = run_server.DATA_DIR
TRILIUM_SRC = __import__("os").environ.get("TRILIUM_SRC")


# Where each fixture file lives has moved at least once as the upstream
# TriliumNext monorepo has been restructured — document.db used to sit
# alongside config.ini under apps/server/spec/db, then moved to
# packages/trilium-core/src/test/fixtures while config.ini stayed put. Check
# every known location for each file independently rather than assuming
# they're still siblings, so a future restructuring only needs a new
# candidate added here instead of the whole layout re-derived.
SEED_FIXTURE_DIRS = (
    "apps/server/spec/db",
    "packages/trilium-core/src/test/fixtures",
)


def find_seed_file(name):
    for rel_dir in SEED_FIXTURE_DIRS:
        candidate = Path(TRILIUM_SRC) / rel_dir / name
        if candidate.exists():
            return candidate
    searched = ", ".join(str(Path(TRILIUM_SRC) / d / name) for d in SEED_FIXTURE_DIRS)
    sys.exit(f"No {name} fixture found -- looked in: {searched} -- did the trilium flake input change shape?")


def main():
    if not TRILIUM_SRC:
        sys.exit("$TRILIUM_SRC not set -- run inside `nix develop` (see flake.nix)")

    if DATA_DIR.exists():
        shutil.rmtree(DATA_DIR)
    DATA_DIR.mkdir(parents=True)
    for name in ("document.db", "config.ini"):
        src = find_seed_file(name)
        dest = DATA_DIR / name
        shutil.copy(src, dest)
        # Files fetched out of the Nix store are read-only (the store itself
        # is immutable) -- shutil.copy preserves that mode bit, but the
        # server needs to write to its own copy of document.db.
        dest.chmod(0o644)
        print(f"Copied {src} to {dest}")

    print("Starting server for real (disk-backed) to import TAM...")
    run_server.start(real=True)
    try:
        tam_zip = DATA_DIR.parent / "trilium-addon-manager@beatlink.zip"
        subprocess.run(
            [
                sys.executable,
                str(REPO_ROOT / "resources" / "scripts" / "tam_to_zip.py"),
                str(REPO_ROOT / "addons" / "trilium-addon-manager@beatlink"),
                "--out", str(tam_zip),
            ],
            check=True, cwd=REPO_ROOT,
        )
        result = trilium_client.import_zip("root", tam_zip)
        note_id = (result or {}).get("noteId")
        if not note_id:
            sys.exit(f"TAM import didn't return a noteId -- response was: {result}")
        print(f"TAM imported as note {note_id}")
        tam_zip.unlink()
    finally:
        run_server.stop()

    print(f"Golden seed ready at {DATA_DIR / 'document.db'}")


if __name__ == "__main__":
    main()
