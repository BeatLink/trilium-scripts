# Trilium Testing System

A single-command way to boot a real Trilium instance, deploy TAM into it, and drive it with
Playwright — no manual browser clicking, no locally-cloned Trilium checkout, no separate setup
steps. Everything is fetched and built by Nix via this repo's [`flake.nix`](../nix/flake.nix)
(Trilium's own repo as a flake input).

## Run it

```bash
nix develop ./resources/nix   # once per shell session — builds trilium-server, sets $TRILIUM_SRC, installs deps
run_tests       # the whole flow: seed + start + deploy TAM + run the Playwright suite + stop
```

`run_tests` (a shell function from the flake, = `npx playwright test`) is the entire pipeline. Each
run rebuilds the golden snapshot then runs the suite against it.

```bash
run_tests --headed                  # same, with a visible browser
run_tests -g "TAM UI"               # run only matching tests
TRILIUM_TESTING_NO_RESEED=1 run_tests   # reuse the existing snapshot (skip the reseed)
```

## How it works

The whole harness -- server lifecycle, http client, page wrapper, the
`test`/`expect` fixtures, and the Playwright lifecycle hook -- lives in one file,
[`testing.js`](testing.js). `playwright.config.js` (next to it) is the thin
Playwright entry point that wires it in:

- **globalSetup** (`testing.js`'s default export) calls `prepare()`, which:
  1. **Seeds**: copies Trilium's own e2e-test fixture db (`document.db` + `config.ini` with
     `noAuthentication=true` already set — fetched via the `trilium` flake input, exposed as
     `$TRILIUM_SRC`) into `data/` (gitignored), boots a real disk-backed server, imports
     `trilium-addon-manager@beatlink` via `tamhelper.js tam-to-zip` + the notes-import endpoint, and
     stops. The result is a golden snapshot with TAM already deployed. This happens on **every** run
     so each suite starts from the same known state (see the memory-mode note under known bugs); it's
     cheap (a file copy + one zip import). Set `TRILIUM_TESTING_NO_RESEED=1` to reuse the existing
     snapshot while iterating on non-mutating tests.
  2. **Starts** the server against that snapshot (disk-backed), plus a small static HTTP server
     over the repo's `addons/` dir so tests can install an addon-under-test through TAM itself
     (see "Installing an addon under test" below).
- **Tests** ([`tests/*.spec.js`](tests/)) import `{ test, expect }` from
  [`testing.js`](testing.js), which injects two Trilium-aware fixtures:
  - `tri` — a no-auth HTTP client (`searchNotes`, `getNote`, `importZip`, `execScript`, `request`)
    against the running server. `searchNotes`/`getNote` are plain ETAPI GETs (no anchor needed).
    `execScript` runs **backend**-env JS via `/api/script/exec` — it requires an existing
    backend/code note as its `startNoteId` anchor (the route builds the script bundle from that
    note), so use `searchNotes` to locate notes and reserve `execScript` for running logic.
  - `page` — the standard Playwright page, wrapped so `gotoNote(noteId)` / `enableRenderNote()` are
    available and everything else falls through to the real `Page`. Use this for **frontend**-env
    flows: TAM's own UI (`TAM.jsx` et al.), `#run=frontendStartup` scripts, `require()`-driven
    module resolution, `fetch()`-based manifest installs, real button clicks — none of which
    `/api/script/exec` can run.
- **globalTeardown** — there's no separate teardown file: `globalSetup` returns the teardown
  function and Playwright runs it after the suite. It stops the server (skip with
  `TRILIUM_TESTING_KEEP=1` to leave it up for manual poking).

Playwright's browser binaries come from `pkgs.playwright-driver.browsers` (pinned to the
`playwright` package's expected revision); the flake shellHook sets `PLAYWRIGHT_BROWSERS_PATH` /
`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS` so `playwright install` (which downloads into
`$HOME/.cache` and fails offline/in a sandbox) is never needed.

## Writing a test

```js
const { test, expect } = require("../testing");

// Backend: inspect notes via ETAPI — no browser.
test("TAM is deployed", async ({ tri }) => {
    const { results } = await tri.searchNotes("note.title = 'trilium-addon-manager@beatlink'");
    expect(results.length).toBeGreaterThan(0);
});

// Frontend: drive TAM's actual widget in a real browser.
test("TAM UI mounts", async ({ tri, page }) => {
    const { results } = await tri.searchNotes("note.title = 'trilium-addon-manager@beatlink'");
    await page.gotoNote(results[0].noteId);
    await page.enableRenderNote();   // dismiss the one-time "untrusted render note" warning
    await expect(page.locator(".note-detail-render :visible").first()).toBeVisible();
});
```

Known frontend-only gotchas: `gotoNote` needs `enableRenderNote()` once per note before its widget
mounts; elements matching by visible text can collide with the note tree's own titles (e.g. a note
literally named "Settings") — scope locators to `:visible` or a container role instead of bare text.

## Installing an addon under test

Only TAM is in the seed. To test any other addon, install it **through TAM itself** — the real user
path — with `installViaTam(page, tri, addonId)`:

```js
const { test, expect, installViaTam, httpClient, wrapPage } = require("../testing");

test.beforeAll(async ({ browser }) => {
    const raw = await browser.newPage();            // beforeAll has no `page` fixture
    try { await installViaTam(wrapPage(raw), httpClient(), "hoist-note@beatlink"); }
    finally { await raw.close(); }
});
```

It drives TAM's UI end to end: Settings → **Install by URL** (pointed at the addon on the local
addon server, `http://127.0.0.1:8091/<addonId>/_tam_manifest_.json`) → **Enable Addon** → reload
the frontend. No ZIP import. Because TAM resolves each note's `sourceUrl` relative to the manifest
URL, the whole addon (manifest + every source file) is served straight from `addons/` with no
rewriting. See [`hoist-note.spec.js`](tests/hoist-note.spec.js) for a full example.

Two things this exercises that a raw import wouldn't: fresh installs are **disabled** by default, so
`#run=frontendStartup` (and other activation labels) live under a `disabled:` prefix until the
Enable step flips them — assert on the *live* label to prove enable worked. And the addon server
plus TAM's own fetch/resolve path is the same one users hit against GitHub.

## Manual debugging

The `run_tests` flow manages the server for you. To poke at the same state by hand, drive the harness CLI:

```bash
trilium_harness seed     # rebuild the golden snapshot
trilium_harness start    # boot it (in-memory); add --real for disk-backed
trilium_harness stop
```

## Known harness/tooling bugs found this way

- **`tam-to-zip` silently dropped every clone branch** (same-addon multi-parent notes, and every
  cross-addon `children[]` dependency wiring) from its ZIP output. Trilium's own ZIP import walks
  *physical archive entries* — a meta.json `isClone` entry with no backing data file is never visited,
  so its branch never gets created. Fixed by having `tam-to-zip` emit a placeholder file per clone
  (Trilium's own export does the same so its own import can find them). Before the fix this even broke
  TAM's own seeded self-install — `TAMListViews.jsx` failed with "Could not find module note
  TAMShared.jsx" because the clone wiring it depends on was silently missing.
- **In-memory mode (`TRILIUM_INTEGRATION_TEST=memory`) crashes on boot** with `SQLITE_CANTOPEN` in
  trilium-server 0.103 — not yet root-caused (the fixture db has no uncheckpointed WAL sidecar, so
  it isn't that). Memory mode would let the server load the db read-only into RAM so no test run
  could touch the file; until it's fixed, the harness runs disk-backed and re-seeds every run
  instead, which gives the same clean-start guarantee.

## Files

- `playwright.config.js` — the thin Playwright entry point (points `globalSetup` at
  `testing.js`, sets reporter/timeout/browser opts).
- `../nix/flake.nix` — `trilium` flake input, `trilium-server` on `PATH`, `$TRILIUM_SRC`, the
  `run_tests` and `trilium_harness` shell functions.
- `../nix/shell.nix` — provisions `nodejs` + `playwright-driver.browsers` and installs npm deps.
- `testing.js` — **the whole harness in one file**: all the primitives (seed / start / stop /
  prepare / http client / page wrapper / addon server / `installViaTam`), the `test`/`expect`
  fixtures, the `globalSetup` hook (which returns its own teardown), plus a `seed|start|stop` CLI
  for manual debugging.
- `tests/` — the Playwright specs (`tam-*` for TAM, `hoist-note.spec.js` for hoist-note).
