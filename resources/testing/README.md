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

## Browser-driven testing (Playwright)

`trilium_client.py`'s `exec_script` only runs **backend**-env script bundles (Trilium's own
`/api/script/exec` route hardcodes `getScriptBundle(currentNote, true, "backend", ...)` — see its
docstring). TAM's own UI (`TAM.jsx` et al.) and anything else living in a `env=frontend` note —
including `require()`-driven module resolution, `fetch()`-based manifest installs, and actual
button clicks — can only be exercised by a real browser loading Trilium's frontend bundle. That's
what `browser_client.py` is for:

```python
import sys
sys.path.insert(0, "resources/testing")
import trilium_client as tc
from browser_client import launch

tam_note = tc.search_notes('#TAMFILEID="trilium-addon-manager@beatlink/root"')["results"][0]["noteId"]

with launch() as page:                 # launches headless Chromium
    page.goto_note(tam_note)           # navigates to http://127.0.0.1:8090/#root/<noteId>
    page.enable_render_note()          # dismisses the one-time "untrusted render note" warning
    page.locator("a:visible", has_text="Settings").first.click()
    # ...from here `page` is a plain Playwright Page — use its full API.
```

`shell.nix` provisions everything this needs — `pkgs.python3.withPackages (ps: [... ps.playwright])`
plus `pkgs.playwright-driver.browsers` (prebuilt Chromium/Firefox/WebKit binaries matching the pinned
`playwright` package's expected revision) — and the shellHook sets `PLAYWRIGHT_BROWSERS_PATH` /
`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS` so `playwright install` (which tries to download into
`$HOME/.cache` and fails offline/in a sandbox) is never needed. Works out of the box inside
`nix develop`/`nix-shell`, no manual setup.

Known frontend-only gotcha: `exec_script`'s "any note works as an anchor" doesn't apply here —
`page.goto_note` needs `enable_render_note()` once per note before its widget mounts, and elements
matching by visible text can collide with the note tree's own titles (e.g. a literal note named
"Settings") — scope locators to `:visible` or a container role instead of bare text matches.

## Known harness/tooling bugs found this way

- **`tam_to_zip.py` silently dropped every clone branch** (same-addon multi-parent notes, and every
  cross-addon `children[]` dependency wiring) from its ZIP output. Trilium's own ZIP import walks
  *physical archive entries* — a meta.json `isClone` entry with no backing data file is never visited,
  so its branch never gets created (confirmed by reading Trilium's own export code, which writes a
  placeholder file per clone precisely so its own import can find it). Fixed by having `tam_to_zip.py`
  emit the same placeholder-file-per-clone convention. Before the fix, this even broke TAM's own
  seeded self-install (`seed.py` uses `tam_to_zip.py` on TAM itself) — its own `TAMListViews.jsx`
  failed to load with "Could not find module note TAMShared.jsx" because the clone wiring it depends
  on was silently missing.
- **In-memory mode (`trilium_server start`, no `--real`)** still fails with `SQLITE_CANTOPEN` — not
  yet root-caused. Use `--real` (disk-backed) for now and re-run `trilium_seed` afterward to reset the
  golden snapshot, since `--real` mode persists whatever a test run wrote.

## Files

- `../../flake.nix` — the `trilium` flake input, `trilium-server` on `PATH`, `$TRILIUM_SRC`,
  `trilium_seed`/`trilium_server` shell functions.
- `../../shell.nix` — also provisions `playwright` + `playwright-driver.browsers` for the browser layer.
- `seed.py` — one-time (re-runnable) golden-snapshot bootstrap.
- `run_server.py` — start/stop the server against that snapshot.
- `trilium_client.py` — stdlib HTTP client: `exec_script`, `import_zip`, `get_note`, `search_notes`.
- `browser_client.py` — Playwright wrapper for frontend-only flows: `launch()`, `goto_note`,
  `enable_render_note`.
