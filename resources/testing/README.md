# Trilium Testing Harness

A standalone, scriptable way to boot a real Trilium instance and drive it — no manual browser
clicking, no locally-cloned Trilium checkout required. Everything needed to build and run Trilium is
fetched and built by Nix, via this repo's own [`flake.nix`](../../flake.nix) (Trilium's own repo as a
flake input).

## How it works

- `nix develop` builds `trilium-server` (Trilium's headless server binary, no Electron involved) from
  the `trilium` flake input and puts it on `PATH`, alongside every existing `nix-shell` tool
  (`validate`, `tam_to_zip`, etc. — this repo's existing `shell.nix` workflow is unchanged and still
  works standalone).
- The same flake input also carries Trilium's own e2e-test seed database
  (`apps/server/spec/db/{document.db,config.ini}` in Trilium's source — the exact fixture its own
  Playwright suite uses) with `noAuthentication=true` already set, so there's no setup wizard or
  login flow to script around.
- `trilium_seed` copies that fixture into `resources/testing/data/` (gitignored — real SQLite
  content), boots a real (disk-writing) server against it, imports `trilium-addon-manager@beatlink`
  into it via `tam_to_zip.py` + the notes-import endpoint, then stops the server. The result is a
  golden snapshot with TAM already installed.
- `trilium_server start` boots that snapshot with `TRILIUM_INTEGRATION_TEST=memory` — the server
  loads `document.db` into memory and never writes back to the file, so nothing a test run does can
  corrupt the seed. Every `trilium_server start` after the first begins from the exact same state.

## Usage

```bash
nix develop                    # once per shell session — builds trilium-server, sets $TRILIUM_SRC
trilium_seed                   # once — builds resources/testing/data/document.db with TAM installed
trilium_server start           # boots the seed in-memory on http://127.0.0.1:8090
```

Then drive it from Python (or anything that can speak HTTP — the seeded config has no auth):

```python
import sys
sys.path.insert(0, "resources/testing")
import trilium_client as tc

# Run arbitrary backend JS — enough to call into libTAMjs, inspect the
# Database note, create notes, etc. with no browser involved.
tc.exec_script("return api.getInstanceName()")

# Import an addon zip built by tam_to_zip.py
tc.import_zip("root", "agenda@beatlink.zip")

# Read-side inspection via ETAPI
tc.search_notes("#appCss")
```

```bash
trilium_server stop            # when done
```

Re-run `trilium_seed` any time you want to rebuild the snapshot from scratch (e.g. after a breaking
TAM change) — it always starts from a fresh copy of Trilium's own fixture, never from whatever state
a previous test run left behind.

## What this doesn't cover (yet)

This is a headless layer only — it proves "does installing/syncing an addon produce the right note
tree / database state," via `/api/script/exec` and note import/inspection, not "does the rendered
widget actually look and behave right in a browser." That would mean a Playwright layer on top, the
same way Trilium's own `apps/server-e2e` package drives its e2e tests against this exact same kind of
seeded database — a reasonable future addition, not built here.

## Files

- `../../flake.nix` — the `trilium` flake input, `trilium-server` on `PATH`, `$TRILIUM_SRC`,
  `trilium_seed`/`trilium_server` shell functions.
- `seed.py` — one-time (re-runnable) golden-snapshot bootstrap.
- `run_server.py` — start/stop the server against that snapshot.
- `trilium_client.py` — stdlib HTTP client: `exec_script`, `import_zip`, `get_note`, `search_notes`.
