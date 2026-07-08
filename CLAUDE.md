# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A collection of widgets, themes, and scripts for TriliumNext Notes, distributed through a custom
addon manager called **TAM** (Trilium Addon Manager, `addons/trilium-addon-manager@beatlink/`).
Addons live under `addons/`, each described by a `_tam_manifest_.json`. TAM installs addons
**directly from this repo**: each manifest's own `manifestSourceUrl` is exactly what TAM fetches
over the network, with no separate build/inlining step. CI publishes a GitHub Pages catalog
(https://beatlink.github.io/trilium-scripts/, incl. `catalog.json`) and cuts a versioned GitHub
Release containing every addon's `{id}.zip` on every push to `main`.

Every directory under `addons/` is named `name@author` and has a `_tam_manifest_.json`.

## Development commands

Python tooling (`python3`/`gh`) is only available inside the Nix dev shell, not the bare PATH.

```bash
nix-shell --run "python3 resources/scripts/validate.py"
```

Inside `nix-shell`, these shell functions are defined (see `shell.nix`):

```bash
validate                       # resources/scripts/validate.py — lint all _tam_manifest_.json files, exit 1 on error
ci                             # validate && tam_to_zip --all
generate_pages                 # resources/scripts/generate_pages.py — build docs/ (GitHub Pages incl. catalog.json) and regenerate README.md
zip_to_tam <zip>               # resources/scripts/zip_to_tam.py — Trilium export ZIP -> _tam_manifest_.json + flat source files
tam_to_zip <manifest-dir>      # resources/scripts/tam_to_zip.py addons/{id}/ [--out x.zip] — manifest -> Trilium-importable ZIP
tam_to_zip --all               # same script, all-addons mode — CI-only: {id}.zip for every addon under --addons-dir into --out-dir
publish_release                # resources/scripts/publish_release.py — CI-only: cuts a new versioned release + refreshes 'latest', both carrying every {id}.zip
backfill_manifest_source_url   # resources/scripts/backfill_manifest_source_url.py — one-time: add manifestSourceUrl to every addon missing one
```

Scripts live in `resources/scripts/`, not `scripts/`, and all invocations assume cwd is the repo
root, not the scripts directory.

`validate` is the closest thing to a test suite here — always run it after editing any
`_tam_manifest_.json` or adding/removing addon source files. Addon identity is the manifest's own
`id` field, not the directory name.

There is no build framework; `validate` is purely static (manifest shape, not runtime behavior).
CI (`.github/workflows/publish.yml`) runs `validate` → `tam_to_zip --all` → `publish_release`;
`.github/workflows/pages.yml` runs `generate_pages`. Running an addon inside a real Trilium
instance (next section) is a local/dev-time tool, not wired into CI.

## Testing against a real Trilium instance

`resources/testing/` (see its own `README.md`) is a standalone harness built entirely from this
repo's `flake.nix` (Trilium's repo as a flake input) — no manually-cloned Trilium checkout needed.

```bash
nix develop            # once per shell session
trilium_seed           # once — builds resources/testing/data/document.db with TAM installed
trilium_server start   # boots that snapshot in-memory on http://127.0.0.1:8090 — never corrupts it
trilium_server stop
```

Once running, `resources/testing/trilium_client.py` is a stdlib HTTP client: `exec_script(...)` runs
arbitrary backend JS via Trilium's `/api/script/exec`, `import_zip(...)` imports a `tam_to_zip.py`
ZIP, `get_note`/`search_notes` read state back via ETAPI. The seed database has
`noAuthentication=true`, so no token/login needed. This is a headless layer only — note-tree/
database-state verification, not rendered-widget verification.

## Manifest-driven addon architecture

Every TAM addon is a `_tam_manifest_.json`, by convention at `addons/{id}/` (id format
`name@author`), declaring a tree of Trilium notes rather than raw exported files:

- **`manifestSourceUrl`** (top-level) — the URL TAM fetches this manifest from (for this repo's own
  addons, a `raw.githubusercontent.com/.../refs/heads/main/addons/{id}/_tam_manifest_.json` URL).
  This is what makes an addon installable — TAM never discovers an addon by filesystem position.
  `zip_to_tam.py` auto-fills it when run inside a git working copy with a `github.com` origin;
  `resources/scripts/backfill_manifest_source_url.py` backfills it for existing addons (re-run if an
  addon's folder moves). Hand-author it for anything not authored via `zip_to_tam.py`.
- **`notes[]`** — one entry per note (`id` = local id, `title`, Trilium `type`, `mime`, `sourceUrl`).
  `sourceUrl` is a relative path (resolved via `new URL(sourceUrl, manifestSourceUrl)`, like an HTML
  `<base href>`) or a full `http(s)://` URL. Add `"binary": true` for a non-text note (e.g. a
  `type: "file"` note with mime `audio/wav`, see `libtimer@beatlink`) — fetched as raw bytes, no
  base64. Add `"renderAsHTML": true` on a note whose source is plain markdown (e.g. `README.md`) that
  should install as a rendered `text`/`text/html` note (see `whitebluenext@beatlink`'s `readme`
  note) — the source file itself stays hand-editable markdown.
- **Note identity: `#TAMFILEID`** — every note TAM creates/resolves carries a permanent,
  non-inheritable label `#TAMFILEID="{addonId}/{localId}"` (e.g. `#TAMFILEID="libical@kewisch/lib"`).
  This is the sole canonical way to find "which real note is local id X of addon Y" —
  `api.getNoteWithLabel("TAMFILEID", value)`. Resolution is find-or-create; nothing about note
  identity is cached in TAM's Database. `tam_to_zip.py` bakes `#TAMFILEID` into every exported note
  at build time so a manually-imported addon (notably TAM itself) is self-identifying from import.
  See `trilium-addon-manager@beatlink/README.md`'s "Note Identity" section for the full design.
- **JS/JSX code note mime** encodes execution environment: `application/javascript;env=frontend` or
  `;env=backend`. **There is no `env=hybrid`** — a note can only `require()` another note of the
  same environment. A library needed from both environments ships as **two separate notes** (same
  `sourceUrl`, one `env=frontend` one `env=backend`, export names `lib`/`backend` per
  `libnotification@beatlink`'s convention) — duplicates the note, not the source file. **Every addon
  needs exactly one `root`**; make the two environment variants children of a plain empty `root` text
  note (see `libical@kewisch`, `libcalendar@beatlink`) — `deleteAddon` only deletes the subtree rooted
  at `manifest.root`, so an independent top-level note would leak forever. `require()` matches the
  literal note title verbatim; the separate `sanitizeVariableName` mechanism in `script.ts` also
  exposes every child note as a bare pseudo-global (`highlight.min.js` → `highlightminjs`), in
  addition to `require()`, not instead of it.
- **`children[]`** — parent/child tree, local (`{parent, child}`) or cross-addon
  (`{parent, addon, child}`, `child` resolved through the dependency's `exports` map). A local note
  can be listed under more than one parent in the same manifest (a same-addon clone, e.g. a shared
  settings-resolver note under several widgets — see `agenda@beatlink`'s `agenda-settings`, 4
  parents). The first `{parent, child}` occurrence is where the note resolves; later occurrences are
  wired as clones via `api.ensureNoteIsPresentInParent`. `tam_to_zip.py`'s `process_manifest` mirrors
  this first-occurrence-is-real ordering.
- **`relations[]`** / **`labels[]`** — Trilium relations/labels applied after note creation, same
  local-vs-cross-addon shape.
- **`dependencies[]`** / **`exports{}`** — declares and exposes notes for other addons to clone/link.
  Each `dependencies[]` entry is a bare id string (resolved against what's installed, or the catalog
  the consumer was installed from) or `{"id": "...", "manifestSourceUrl": "..."}` for a dependency
  from elsewhere. A dependency doesn't need a matching `children`/`relations` entry — a
  static-resource-only vendor library (see `libfullcalendar@arshaw`) can be referenced by a fixed
  `custom/...` URL baked into the consumer's code and appear only in `dependencies[]`. `tam_to_zip.py`
  can only bundle a dependency into an offline ZIP if a matching sibling `addons/{dep-id}/` exists
  locally.
- **`skipOnUpdate`** (note never overwritten on update) / **`promptOnUpdate`** (user shown a
  Keep-Mine-vs-Use-New-Default diff on update) — only meaningful on notes also tracked by an
  `AddonData:key` relation. To make a note persistent + promptable: `"promptOnUpdate": true` on the
  note, plus `{"from": "root", "type": "AddonData:<local-note-id>", "to": "<local-note-id>"}`
  (see `templates@beatlink`, `drawio@siriusxt`) — key matches the note's local manifest id by
  convention.
- **`latestVersion`** must be bumped on any manifest structure/content change — it's the only thing
  that makes TAM show existing installs an update prompt.
- **`settingsNote`** (optional, sibling of `root`) — local id TAM's "Settings" button navigates to.
  Must point at the `render`-type note (typically `root`), not the raw JSX note — activating a JSX
  note directly opens its source. See `cinnamon-applet-agenda@beatlink`.
- **`readmeNote`** (optional) — local id of a `README.md` note shipped in the installed tree, rendered
  with `marked` on the addon's detail page. Only resolvable once installed; browsing an uninstalled
  addon's catalog entry links out to its GitHub homepage instead.
- **`allowExternalReferences`** (optional, default false) — before uninstall, TAM warns about any
  relation pointing *into* the addon's subtree from outside it (it would dangle post-delete). Set
  `true` to skip the warning for an addon whose own code re-establishes such a relation on every load
  (see `expanded@beatlink`'s `runOnBranchChange` on Trilium's real root note).
- **`type`** — `widget`/`script`/`theme` are user-facing and shown in TAM's addon list; `library` is
  hidden and TAM-managed only, installed/removed automatically via `dependencies[]`. If a library is
  independently useful to a user, split it into a thin user-facing addon wrapping a hidden
  `type: "library"` (see `notifications@beatlink` / `libnotification@beatlink`).

TAM itself is `libTAM.js` + `trilium-addon-manager@beatlink`'s render note; see that addon's
`README.md` for the full sync/persistence state machine. Rules:

- **One entry point.** `syncAddon(addonId, options)` handles fresh install, version update, and TAM
  self-update through the same call. `options.manifestSourceUrl` is required for a fresh install,
  optional for an update (falls back to the stored record).
- **`database.installedAddons` is a flat map keyed by `addonId` alone**, never nested under a
  catalog. `database.catalogs` is just an array of URLs — catalog contents are never cached;
  `fetchCatalogAddons` fetches every listed manifest fresh each time.
- **Each installed addon's Database record stores its own manifest structure** (same shape as
  `_tam_manifest_.json`'s `manifest`, minus per-note `sourceUrl`), plus a `meta` sub-object
  (name/description/author/license/type/homepage) for list/detail rendering without a live catalog.
  Irreducible per-install fields: `installedVersion`, `manifestSourceUrl`, `manuallyInstalled`.
  `enabled` is cached (derivable from `disabled:`-prefixed labels, but read on every list render).
- **`dependents` is computed, never stored** — `getDependents` scans every other installed addon's
  `manifest.dependencies` for the reverse edge. Used by `checkForAddonUpdates`'s update-propagation
  through hidden `library` addons, and by `uninstallAddon`'s cascade-uninstall-if-now-unused check.
- **`checkForAddonUpdates` fetches each installed addon's own `manifestSourceUrl` directly** and
  compares `latestVersion` vs `installedVersion`, best-effort per addon.
- **Persisted user data (`AddonData:` notes)** lives in a `persistence` sub-object on the addon's
  record — the one part allowed to survive `deleteAddon`. A record can exist for an addonId that
  isn't installed at all; every "is this addon installed" check tests `installedVersion` presence,
  not record existence. A persisted note's content is unconditionally protected from `resolveNotes`'
  overwrite, independent of `skipOnUpdate`/`promptOnUpdate`.
- **`libTAMjs.validateDatabase()`** (TAM's "Validate Database" button) is a read-only audit —
  duplicate `#TAMFILEID`s, missing dependencies, unresolvable `root`/`settingsNote`, missing
  persisted notes, mismatched `AddonData:` relations. **There is no offline "repair" path** — reinstall
  the flagged addon instead (`syncAddon` reconciles fresh via `#TAMFILEID`).

### `api.currentNote` vs `api.startNote` vs the active-note-context

- **`api.currentNote`** — the note whose *code* is currently executing; changes per module inside a
  bundle (a shared library note sees itself, not the importer).
- **`api.startNote`** (also `startNote` from `"trilium:api"`) — the note that kicked off execution
  (e.g. the `widget`-labeled note Trilium loaded); constant across every module in that bundle.
- **`useActiveNoteContext()`'s `note`** (Preact-only) — the note currently open in the main editor
  pane; unrelated to the above.

Rule: code reading relations the *manifest* places on a specific note (not the note the function is
written in) must use `startNote`, never `currentNote`. See `agenda@beatlink/agendaSettings.jsx`'s
`getAgendaSettings()`.

### Library note titles must be fully qualified

`require("Title")` and the implicit bundle-global (punctuation stripped) both resolve by exact note
**title** — a global identifier shared across every addon that clones it. Never use a generic title
(`lib`, `libsettings`); use a fully-qualified one matching what consumers `require()`/`import`
(`libSettings.js`, `libNotificationBackend.js`, `FormToggleButton.jsx`), including secondary exports
(`-Backend`/`-UI` suffix, not a duplicate base name). Renaming a shipped library's title is a breaking
change — bump its `latestVersion` and update every consumer's `require()`/`import` string and
`latestVersion` together.

## Workflow for adding/editing an addon

1. Hand-edit `_tam_manifest_.json` and the flat source files directly (the common path), or
2. Develop inside Trilium, export via **Trilium → Export**, then `zip_to_tam <export.zip>` to
   generate a starting `_tam_manifest_.json` + source files. Fill in the `FILL_IN` placeholders
   (`id`/`name`/`description`/`author`/`homepage`/`type`) by hand, and strip the raw Trilium export
   wrapper from `text`/`html` note content to match sibling notes' `sourceUrl` content.

Always run `validate` before considering the change done. Use `tam_to_zip addons/{id}/` for a ZIP
without waiting for CI.

## Destructive actions require confirmation

Always confirm with the user before deleting a file, including `zip_to_tam` cleanup (e.g. the
original exported ZIP), even when it looks like obvious tidying. Exceptions: the file was generated
this session and is trivially regenerable, or the user explicitly authorized the deletion. This
matters most for untracked files, since git can't recover them.

## Maintaining this file

Keep this file up to date as the repo evolves: when a task reveals a convention, gotcha, or workflow
not already captured here, update the relevant section in the same session.
