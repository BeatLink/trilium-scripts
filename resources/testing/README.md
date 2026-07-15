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
  into it via `tamhelper.js tam-to-zip` + the notes-import endpoint, then stops the server. The
  result is a golden snapshot with TAM already installed.
- `trilium_server start` boots that snapshot with `TRILIUM_INTEGRATION_TEST=memory` — the server
  loads `document.db` into memory and never writes back to the file, so nothing a test run does can
  corrupt the seed. Every `trilium_server start` after the first begins from the exact same state.

## Usage

```bash
nix develop                    # once per shell session — builds trilium-server, sets $TRILIUM_SRC
trilium_seed                   # once — builds resources/testing/data/document.db with TAM installed
trilium_server start           # boots the seed in-memory on http://127.0.0.1:8090
```

Then drive it from Node (or anything that can speak HTTP — the seeded config has no auth):

```js
const tc = require("./resources/testing/trilium_client");

// Run arbitrary backend JS — enough to call into libTAMjs, inspect the
// Database note, create notes, etc. with no browser involved.
await tc.execScript("() => api.getInstanceName()");

// Import an addon zip built by tamhelper.js tam-to-zip
await tc.importZip("root", "agenda@beatlink.zip");

// Read-side inspection via ETAPI
await tc.searchNotes("#appCss");
```

```bash
trilium_server stop            # when done
```

Re-run `trilium_seed` any time you want to rebuild the snapshot from scratch (e.g. after a breaking
TAM change) — it always starts from a fresh copy of Trilium's own fixture, never from whatever state
a previous test run left behind.

## Browser-driven testing (Playwright)

`trilium_client.js`'s `execScript` only runs **backend**-env script bundles (Trilium's own
`/api/script/exec` route hardcodes `getScriptBundle(currentNote, true, "backend", ...)` — see its
docstring). TAM's own UI (`TAM.jsx` et al.) and anything else living in a `env=frontend` note —
including `require()`-driven module resolution, `fetch()`-based manifest installs, and actual
button clicks — can only be exercised by a real browser loading Trilium's frontend bundle. That's
what `browser_client.js` is for:

```js
const tc = require("./resources/testing/trilium_client");
const { withPage } = require("./resources/testing/browser_client");

const tamNote = (await tc.searchNotes('#TAMFILEID="trilium-addon-manager@beatlink/root"'))
    .results[0].noteId;

await withPage(async (page) => {         // launches headless Chromium
    await page.gotoNote(tamNote);        // navigates to http://127.0.0.1:8090/#root/<noteId>
    await page.enableRenderNote();       // dismisses the one-time "untrusted render note" warning
    await page.locator("a:visible", { hasText: "Settings" }).first().click();
    // ...from here `page` proxies a plain Playwright Page — use its full API.
});
```

`shell.nix` provisions everything this needs — `pkgs.nodejs` (which `npm install`s the `playwright`
package on first shell entry) plus `pkgs.playwright-driver.browsers` (prebuilt Chromium/Firefox/WebKit
binaries matching the pinned `playwright` package's expected revision) — and the shellHook sets
`PLAYWRIGHT_BROWSERS_PATH` / `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS` so `playwright install`
(which tries to download into `$HOME/.cache` and fails offline/in a sandbox) is never needed. Works
out of the box inside `nix develop`/`nix-shell`, no manual setup.

Known frontend-only gotcha: `exec_script`'s "any note works as an anchor" doesn't apply here —
`page.goto_note` needs `enable_render_note()` once per note before its widget mounts, and elements
matching by visible text can collide with the note tree's own titles (e.g. a literal note named
"Settings") — scope locators to `:visible` or a container role instead of bare text matches.

## Known harness/tooling bugs found this way

- **`tam-to-zip` silently dropped every clone branch** (same-addon multi-parent notes, and every
  cross-addon `children[]` dependency wiring) from its ZIP output. Trilium's own ZIP import walks
  *physical archive entries* — a meta.json `isClone` entry with no backing data file is never visited,
  so its branch never gets created (confirmed by reading Trilium's own export code, which writes a
  placeholder file per clone precisely so its own import can find it). Fixed by having `tam-to-zip`
  emit the same placeholder-file-per-clone convention. Before the fix, this even broke TAM's own
  seeded self-install (`seed.js` uses `tam-to-zip` on TAM itself) — its own `TAMListViews.jsx`
  failed to load with "Could not find module note TAMShared.jsx" because the clone wiring it depends
  on was silently missing.
- **In-memory mode (`trilium_server start`, no `--real`)** still fails with `SQLITE_CANTOPEN` — not
  yet root-caused. Use `--real` (disk-backed) for now and re-run `trilium_seed` afterward to reset the
  golden snapshot, since `--real` mode persists whatever a test run wrote.

## Files

- `../../flake.nix` — the `trilium` flake input, `trilium-server` on `PATH`, `$TRILIUM_SRC`,
  `trilium_seed`/`trilium_server` shell functions.
- `../../shell.nix` — also provisions `nodejs` (which `npm install`s `playwright`) +
  `playwright-driver.browsers` for the browser layer.
- `seed.js` — one-time (re-runnable) golden-snapshot bootstrap.
- `run_server.js` — start/stop the server against that snapshot.
- `trilium_client.js` — built-in-http client: `execScript`, `importZip`, `getNote`, `searchNotes`.
- `browser_client.js` — Playwright wrapper for frontend-only flows: `withPage()`, `gotoNote`,
  `enableRenderNote`.
