# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A collection of widgets, themes, and scripts for TriliumNext Notes, distributed through a custom
addon manager called **TAM** (Trilium Addon Manager, `addons/trilium-addon-manager@beatlink/`).
Addons live under `addons/`, are described by a `_tam_manifest_.json`, and TAM installs them
**directly from this repo** — each manifest's own `manifestSourceUrl` (a raw.githubusercontent URL)
is exactly what TAM fetches over the network, with no separate content-inlining/distribution build
step in between. CI still publishes a GitHub Pages catalog (https://beatlink.github.io/trilium-scripts/,
including `catalog.json`, the flat list of every addon's `manifestSourceUrl` that TAM's "add catalog"
action consumes) and cuts a versioned GitHub Release containing every addon's `{id}.zip` (for manual
import without going through TAM's network install flow at all) on every push to `main`.

Not every directory under `addons/` is TAM-managed — only directories named `name@author` with a
`_tam_manifest_.json` participate in validate/publish/export. Directories without an `@author` suffix
(`Archived/`) are legacy/pre-TAM addons kept for reference and are skipped by the scripts.

## Development commands

Python tooling is only available inside the Nix dev shell — `python3`/`gh` are not on the bare PATH.
Either `nix-shell` into an interactive shell, or run one-off commands with `nix-shell --run "..."`:

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

Scripts live in `resources/scripts/`, not `scripts/` — all invocations (shell.nix functions and CI
workflow steps) assume the process's cwd is the repository root, not the scripts directory itself,
since several scripts resolve `addons/`/`docs/` as plain relative paths.

`validate` is the closest thing to a test suite here — always run it after editing any
`_tam_manifest_.json` or adding/removing addon source files. It checks required top-level fields,
that `homepage` ends with `addons/{id}` when it points within this repo, that every relative
`sourceUrl` resolves to a real file on disk (a soft, local-dev-only check — the same manifest's
`sourceUrl` values are read verbatim by TAM at install time and resolved against `manifestSourceUrl`,
not this repo's filesystem), that `manifestSourceUrl` is present (a warning, not an error — a
not-yet-published addon legitimately won't have one yet), that every `children`/`relations`/`labels`
entry references a note id that actually exists in the manifest, and that every `dependencies[]`
entry is either a bare id string or a well-formed `{id, manifestSourceUrl}` object. It no longer
requires the addon's directory name to match its `id` — addon identity comes from the manifest's own
`id` field, not filesystem position, now that nothing resolves an addon by where it happens to sit in
this repo's tree.

There is no build framework, and `validate` is purely static (manifest shape, not runtime behavior).
CI (`.github/workflows/publish.yml`) just runs `validate` then `tam_to_zip --all` then
`publish_release`, and `.github/workflows/pages.yml` runs `generate_pages`. For actually running an
addon inside a real Trilium instance, see the next section — that layer isn't wired into CI, it's a
local/dev-time tool.

## Testing against a real Trilium instance

`resources/testing/` (see its own `README.md`) is a standalone harness — no manually-cloned Trilium
checkout required, everything is fetched/built by this repo's own `flake.nix` (Trilium's repo as a
flake input). `nix develop` builds a headless `trilium-server` binary and puts it on `PATH` alongside
the existing `nix-shell` tools above (`shell.nix` itself is untouched and still works standalone).

```bash
nix develop            # once per shell session
trilium_seed           # once — builds resources/testing/data/document.db with TAM installed
trilium_server start   # boots that snapshot in-memory on http://127.0.0.1:8090 — never corrupts it
trilium_server stop
```

Once running, `resources/testing/trilium_client.py` gives a stdlib HTTP client — `exec_script(...)`
runs arbitrary backend JS via Trilium's own `/api/script/exec` (enough to call `libTAMjs.syncAddon`
directly, inspect the Database note, etc.), `import_zip(...)` imports a `tam_to_zip.py`-built addon
zip, `get_note`/`search_notes` read state back via ETAPI. The seed database has
`noAuthentication=true` set, so none of this needs a token or login step. This is a headless layer
only (note-tree/database-state verification, not rendered-widget verification) — see the harness's
own README for why and what a browser-driven layer on top would look like.

## Manifest-driven addon architecture

Every TAM addon is a `_tam_manifest_.json`, by convention at `addons/{id}/` in this repo (id format
`name@author`) though nothing actually requires that folder layout anymore — see `manifestSourceUrl`
below. It declares a tree of Trilium notes rather than raw exported files:

- **`manifestSourceUrl`** (top-level, sibling of `id`/`homepage`/etc.) — a URL where this exact
  manifest document can always be fetched from (for this repo's own addons, a
  `raw.githubusercontent.com/.../refs/heads/main/addons/{id}/_tam_manifest_.json` URL). This is the
  single thing that makes an addon installable/updatable by TAM at all — TAM never discovers an addon
  by filesystem position, only by fetching whatever URL it's given (directly, or via a catalog's
  `tam-addons[]` list). `zip_to_tam.py` auto-fills it when its output directory is inside a git
  working copy with a `github.com` origin remote (detects the current branch + the manifest's path
  relative to the repo root); `resources/scripts/backfill_manifest_source_url.py` does the same for
  every existing addon in this repo (re-run it if an addon's folder ever moves). Hand-author it
  directly for anything not authored via `zip_to_tam.py`, or when a manifest deliberately isn't meant
  to live in this repo's own tree at all.
- **`notes[]`** — one entry per note (`id` = local id used only within the manifest, `title`, Trilium
  `type`, `mime`, `sourceUrl`). `sourceUrl` is the location of that note's actual content: a plain
  relative path (resolved via `new URL(sourceUrl, manifestSourceUrl)` — exactly like an HTML
  `<base href>`) for a file that ships alongside the manifest, or a full `http(s)://` URL for content
  hosted anywhere else entirely (e.g. pointing straight at an upstream project's own files instead of
  vendoring a copy into this repo). `lib-tam.js`'s `resolveNotes` fetches it fresh, backend-side, at
  install/update time — there's no more separate "inline everything into a distribution JSON" build
  step; the manifest committed in this repo, the manifest TAM fetches over the network, and the
  manifest snapshot in TAM's own Database are all the same document (modulo `manifestSourceUrl`
  itself, which is never authored for the *installed* snapshot, since it's the addon's own identity,
  not part of its content). Add `"binary": true` on a note whose `sourceUrl` is non-text (e.g. a
  `type: "file"` note with mime `audio/wav`) — `resolveNotes` then fetches raw bytes into a `Buffer`
  directly (no base64 round-trip needed at all, unlike the old inlined-JSON approach) before
  `setContent()`. `zip_to_tam.py` sets this flag automatically for any `type: "file"` note found in a
  Trilium export. See `libtimer@beatlink` for a real example (bundled `.wav` sound effects). Add
  `"renderAsHTML": true` on a note whose `sourceUrl`/`content` is plain markdown source (e.g. a
  `README.md`) that should install as a rendered note rather than raw markdown text — `resolveNotes`
  fetches it frontend-side (not backend-side like every other note, since `marked` is only reachable
  where `require()` has note-tree access — see the comment above the flag's handling in
  `resolveNotes`), runs it through the same `marked` parser TAM's own UI uses for `readmeNote`
  rendering, and forces the note's installed `type`/`mime` to `text`/`text/html` regardless of what
  the manifest declares — so the source file itself keeps living as ordinary markdown you can hand-
  edit, while the installed note displays formatted when opened directly in Trilium. See
  `whitebluenext@beatlink`'s `readme` note for a real example.
- **Note identity: `#TAMFILEID`** — every note TAM creates or resolves carries a permanent,
  non-inheritable label `#TAMFILEID="{addonId}/{localId}"` (e.g.
  `#TAMFILEID="libical@kewisch/lib"`). This, not any id cached in TAM's Database, is the canonical
  way to find "which real note is local id X of addon Y" — `api.getNoteWithLabel("TAMFILEID",
  value)` looks it up directly against Trilium's own attribute index, so it can never silently drift
  the way an external id map would. Resolution is find-or-create: if a tagged note already exists (and isn't soft-deleted —
  `note.deleteNote()` never immediately removes it), it's cloned into whatever new parent needs it
  and its content is reconciled (respecting `skipOnUpdate`/`promptOnUpdate`, and unconditionally
  protected if it's an `AddonData:`-relation target — see the persistence note below); otherwise a
  fresh note is created and tagged immediately. **Nothing about note identity is cached in the
  Database at all** — not even `rootNoteId`/`settingsNoteId` anymore, as of the schema change
  described below; everything resolves live via TAMFILEID whenever needed. `tam_to_zip.py` bakes a
  real `#TAMFILEID` label into every note of every exported ZIP at build time — so a manually
  imported addon (most importantly TAM itself, which can only ever be bootstrapped this way) is
  already fully self-identifying from the moment of import, with no separate runtime bootstrap/
  tagging bridge needed. See
  `trilium-addon-manager@beatlink/README.md`'s "Note Identity" section for the full design.
- **JS/JSX code note mime** encodes execution environment: `application/javascript;env=frontend` or
  `;env=backend`. **There is no `env=hybrid`** — Trilium's bundler only lets a note `require()`
  another note of the *same* environment (`packages/trilium-core/.../script_context.ts` and
  `apps/client/.../script_context.ts` both resolve `require(moduleName)` by exact `note.title`
  match against the calling note's own available children — there's no cross-environment case at
  all). If a library is genuinely needed from both environments (pure computation, no
  `window`/`Notification`/DOM/Node-only APIs — e.g. a vendored calendar library), ship the *same*
  `sourceUrl` file as **two separate notes** in the manifest, one `env=frontend` one `env=backend`,
  under export names `lib`/`backend` (matching `libnotification@beatlink`'s existing convention).
  This duplicates the note in Trilium but not the source file. **Every addon still needs exactly one
  `root`** — make the two environment variants children of a plain empty `root` text note (same
  shape as `libnotification@beatlink`/`libsettings@beatlink`), never two independent top-level
  notes. `deleteAddon` only ever deletes the subtree rooted at the addon's own `manifest.root`
  (resolved live via `#TAMFILEID`) — a note with no local parent that isn't `root` would never get
  cleaned up on uninstall/update, leaking forever.
  See `libical@kewisch` and
  `libcalendar@beatlink` for real examples. `require()` itself never strips or sanitizes its
  argument — it matches the literal note title. A *different*, unrelated mechanism
  (`sanitizeVariableName` in `script.ts`, stripping to `[a-z0-9_]`) exposes every child note as an
  additional bare pseudo-global parameter (`highlight.min.js` → `highlightminjs`) alongside
  `require()`, not instead of it.
- **`children[]`** — parent/child tree structure, either local (`{parent, child}`) or cross-addon
  (`{parent, addon, child}` where `child` resolves through the dependency's `exports` map). A local
  note **can** be listed under more than one parent within the same manifest (a same-addon clone —
  e.g. a shared settings-resolver note pulled in as a child of several widget notes so `require()`/
  `import` can find it from each). `lib-tam.js`'s `resolveNotes` resolves the note once under
  whichever `{parent, child}` entry appears first, then wires every later entry as a real clone via
  `api.ensureNoteIsPresentInParent` (see `agenda@beatlink`'s `agenda-settings` note, 4 parents, for
  a real example). `tam_to_zip.py`'s `process_manifest` has the same first-occurrence-is-real /
  later-occurrences-are-clones handling for the same reason.
- **`relations[]`** / **`labels[]`** — Trilium relations and labels applied after note creation, same
  local-vs-cross-addon shape.
- **`dependencies[]`** / **`exports{}`** — declares and exposes notes for other addons to clone/link
  against. Each `dependencies[]` entry is either a bare id string (resolved by matching against
  whatever's already installed, or against the catalog the consuming addon itself was installed
  from — this repo's own libraries all use this form, since a monorepo catalog naturally lists every
  addon it depends on too) or an explicit `{"id": "...", "manifestSourceUrl": "..."}` object for a
  dependency that genuinely lives somewhere else entirely. A dependency doesn't strictly need a
  matching `children`/`relations` cross-addon entry — e.g. a static-resource-only vendor library (see
  `libfullcalendar@arshaw`) is referenced by a fixed `custom/...` URL string baked into the consumer's
  code, not by cloning a note, so it only ever appears in `dependencies[]`. `lib-tam.js`'s real
  install path already handles this correctly (it walks `dependencies[]` directly, independent of any
  cloning); `tam_to_zip.py`'s dependency discovery also treats `dependencies[]` as authoritative for
  what to bundle, for the same reason — though it can only ever bundle a dependency into an offline
  ZIP if a matching sibling `addons/{dep-id}/` folder exists locally, regardless of which
  `dependencies[]` form declared it.
- **`skipOnUpdate`** (note never overwritten on update — settings/database notes) and
  **`promptOnUpdate`** (user is shown a Keep-Mine-vs-Use-New-Default diff on update — customizable
  content notes) control TAM's update behavior; both only make sense on notes also tracked by an
  `AddonData:key` persistence relation. To make a note persistent + promptable, add both
  `"promptOnUpdate": true` on the note and a `{"from": "root", "type": "AddonData:<local-note-id>",
  "to": "<local-note-id>"}` relation (see `templates@beatlink` or `drawio@siriusxt` for examples) —
  the key by convention matches the note's local manifest id.
- **`latestVersion`** must be bumped whenever a manifest's structure or note content changes —
  that's the only thing that makes TAM show existing installs an update prompt.
- **`settingsNote`** (optional, sibling of `root`) — local id of the note TAM's UI should navigate to
  for this addon's settings screen. If present, it's stored verbatim as part of the addon's own
  `manifest.settingsNote` (see below) and resolved to a real note id live, via `#TAMFILEID`, whenever
  the UI needs it — no separate cached id. TAM shows a "Settings" button on the addon's row that
  activates that note. **Point this at the
  `render`-type note (typically `root`), not at the raw JSX note itself** — activating a JSX code
  note directly opens its source instead of the rendered UI. See
  `cinnamon-applet-agenda@beatlink`/`cinnamon-applet-inbox@beatlink`, where `settingsNote` is `root`
  and `root` in turn has a `renderNote` relation to the actual settings JSX — so the same note opens
  whether you click the addon's root note directly or the Settings button in TAM.
- **`readmeNote`** (optional, sibling of `root`/`settingsNote`) — local id of a note (typically
  `type: "code"`, `mime: "text/markdown"`, `sourceUrl` pointing at the addon's own `README.md`) that
  ships as part of the addon's installed note tree. TAM's per-addon detail page resolves it live via
  `#TAMFILEID` and renders it with `marked` — deliberately a manifest-native installed note rather
  than a network fetch of the addon's GitHub README, so viewing it never needs network access and
  never risks rendering a mismatched version. Only meaningful once the addon is actually installed;
  browsing a catalog (`catalog.json`'s flat `manifestSourceUrl` list, see `generate_pages.py`) only
  ever fetches each addon's full manifest — no README rendering happens pre-install — so an
  uninstalled addon's detail page links out to its GitHub homepage instead of trying to render one.

- **`allowExternalReferences`** (optional, sibling of `root`, defaults to unset/false) — before
  uninstalling, TAM's UI calls `findExternalReferences` to warn about any relation pointing *into*
  the addon's subtree from a note outside it (that relation would otherwise dangle once the subtree
  is deleted — `deleteNote`'s cascade only follows relations owned by the notes being deleted, never
  ones that merely target them). Set this to `true` to skip that warning entirely, for an addon whose
  own code re-establishes any such relation itself on every load — e.g. `expanded@beatlink` sets a
  `runOnBranchChange` relation on Trilium's real root note, pointing at its own backend script note,
  every time its widget runs, so a dangling copy left behind by uninstall is harmless and self-heals
  on reinstall rather than needing a user-facing warning.

- **`type`** — `widget`/`script`/`theme` are user-facing and always shown in TAM's addon list;
  `library` is TAM-managed only. TAM's UI hides `type: "library"` addons entirely — a user never
  installs or uninstalls one directly, TAM does it automatically via `dependencies[]`/`dependents`
  as a side effect of installing/updating/uninstalling whatever depends on it (see below). If a
  library would be independently useful to a user on its own (not just as plumbing for another
  addon), split it into a thin user-facing `type` addon plus the actual `type: "library"` it depends
  on — e.g. `notifications@beatlink` (user-facing) wrapping `libnotification@beatlink` (hidden) —
  rather than shipping one library the user would have to find and install manually.

TAM itself (the addon that interprets all of this inside Trilium) is `libTAM.js` +
`trilium-addon-manager@beatlink`'s render note; see that addon's `README.md` for the full sync/
persistence state machine — it's long and not worth duplicating here. The short version:

- **One entry point.** `syncAddon(addonId, options)` handles fresh install, version update, and TAM
  updating *itself* through the same call — find-or-create-by-`#TAMFILEID` means nothing is ever
  deleted-then-recreated. `options.manifestSourceUrl` is required for a fresh install (nothing stored
  yet to fall back to) and optional for an update (falls back to whatever's already recorded on the
  addon's own Database entry).
- **`database.installedAddons` is a flat map keyed by `addonId` alone** — not nested under a
  repository/catalog key. An addon's identity is its own manifest `id`, independent of which catalog
  (if any) it happened to be discovered through; deleting a catalog from the browse list never
  touches anything already installed from it. `database.catalogs` is just an array of added catalog
  URLs — nothing about a catalog's contents is ever cached, since a catalog is nothing more than a
  `{"tam-addons": [...]}` list of other manifests' own `manifestSourceUrl`s; browsing one
  (`fetchCatalogAddons`) fetches every listed manifest fresh, every time.
- **Each installed addon's Database record stores its own manifest structure** (same shape as
  `_tam_manifest_.json`'s `manifest` sub-object, minus per-note `sourceUrl`) rather than a grab-bag
  of derived fields — `dependencies`/`exports` are read straight from it, and `rootNoteId`/
  `settingsNoteId` are resolved live from `manifest.root`/`manifest.settingsNote` whenever needed. It
  also stores a `meta` sub-object (`name`/`description`/`author`/`license`/`type`/`homepage`,
  snapshotted from the manifest's own top-level fields at sync time) purely for rendering the addon
  list/detail views without needing a live catalog. The only genuinely irreducible per-install
  facts, stored alongside it, are `installedVersion` (a
  manifest fetch always reflects latest, never what's installed), `manifestSourceUrl` (exactly which
  URL this install came from — read verbatim from the fetched manifest, never guessed by TAM itself;
  used to re-fetch for update checks), and `manuallyInstalled` (pure user intent); `enabled` is
  technically derivable too (scan for `disabled:`-prefixed activation labels) but is cached anyway
  since it's read on every addon-list render.
- **`dependents` (who depends on this addon) is computed, never stored** — `getDependents` scans
  every other installed addon's own stored `manifest.dependencies` for the reverse edge, so there is
  nothing pushed/maintained that could drift out of sync. Used by `checkForAddonUpdates`'s
  update-propagation up through hidden `type: "library"` addons (fixed-point loop, since library
  addons never show in the list, so their own available update needs surfacing on whichever visible
  addon(s) depend on them) and by `uninstallAddon`'s cascade-uninstall-if-now-unused check.
- **`checkForAddonUpdates` fetches each installed addon's own `manifestSourceUrl` directly** and
  compares `latestVersion` against `installedVersion` — there's no more per-repository cached registry
  to diff against first (catalogs cache nothing), so this is now one best-effort fetch per installed
  addon rather than one fetch per repository.
- **Persisted user data (`AddonData:` notes)** lives nested on the same per-addon record as a
  `persistence` sub-object — the one part of a record allowed to survive after `installedVersion`/
  `manifest`/etc. disappear on uninstall. `deleteAddon` strips every installed-state field but keeps
  `persistence` if it has anything in it, so a record can exist for an addonId that isn't currently
  installed at all — every "is this addon installed" check in `lib-tam.js` tests `installedVersion`
  presence, not just whether the record exists. A persisted note's content is unconditionally
  protected from `resolveNotes`' overwrite (independent of `skipOnUpdate`/`promptOnUpdate`) — `api.
  duplicateSubtree` copies every attribute including `#TAMFILEID` onto the persisted copy it creates,
  so without this guard the next sync would find *that* copy and clobber it with the shipped default.
- **`libTAMjs.validateDatabase()`** (wired to TAM's "Validate Database" button) audits all of this
  against the live note tree — duplicate `#TAMFILEID`s, a declared dependency that isn't actually
  installed, the stored `manifest.root`/`manifest.settingsNote` still resolving, persisted notes
  still existing, `AddonData:` relations still pointing where the database says — read-only,
  returning a flat list of issues rather than fixing anything. **There is no offline "repair" path**
  — an addon `validateDatabase` flags an issue for should just be reinstalled/updated instead
  (`syncAddon` already idempotently reconciles everything fresh via `#TAMFILEID`), rather than
  reconciled from a locally stored snapshot that might itself be stale or wrong.

### `api.currentNote` vs `api.startNote` vs the active-note-context

Three distinct notions of "which note", easy to conflate and a real source of bugs:

- **`api.currentNote`** — the note whose *code* is currently executing. Inside a single bundle
  (a widget note plus everything it `require()`s/imports), this changes per module: code physically
  written in a shared library note sees `currentNote` as *that library's own note*, not the note that
  imported it.
- **`api.startNote`** (also importable as `startNote` from `"trilium:api"`) — the note that kicked
  off the whole execution (e.g. the widget note with the `widget` label that Trilium actually
  loaded). This stays the same across every module in that bundle, including shared libraries it
  imports.
- **`useActiveNoteContext()`'s `note`** (Preact-only) — the note the user currently has open/visible
  in the main editor pane. Unrelated to either of the above; a persistent right-pane widget's own
  note stays fixed while this changes as the user navigates.

Rule of thumb: any code reading relations that the *manifest* places on a specific note (not the note
the function happens to be written in) should use `startNote`, never `currentNote` —
`currentNote` only does what you want when the reading code and the relation-bearing note are
guaranteed to be the same note. See `agenda@beatlink/agendaSettings.jsx`'s `getAgendaSettings()` for
a real example (it reads relations placed on whichever widget note imports it).

### Library note titles must be fully qualified

Trilium resolves both `require("Title")` and the implicit bundle-global it creates for a cloned
code/JSX note by that note's exact **title** (punctuation stripped for the implicit-global form,
kept verbatim for explicit `require()`/`import` calls). This means a library's title is effectively
a global identifier shared across every addon that clones it — a generic title (e.g. `lib`,
`libsettings`) risks colliding with an unrelated library that happens to pick the same short name.
Give every library note a fully-qualified, distinctive title matching what consumers actually
`require()`/`import` (e.g. `libSettings.js`, `libNotificationBackend.js`, `FormToggleButton.jsx`),
never a bare generic name. This applies to every note a consumer can reference by name, including
secondary exports (a `-Backend`/`-UI` suffix, not a second copy of the base name). Renaming an
already-shipped library's title is a breaking change for every consumer — bump the library's own
`latestVersion` and update every consuming addon's `require()`/`import` string and its own
`latestVersion` in the same change.

## Workflow for adding/editing an addon

1. Hand-edit `_tam_manifest_.json` and the flat source files directly (this is the common path), or
2. Develop inside Trilium, export via **Trilium → Export**, then `zip_to_tam <export.zip>` to
   generate a starting `_tam_manifest_.json` + source files (it leaves `FILL_IN` placeholders for
   `id`/`name`/`description`/`author`/`homepage`/`type` that must be filled in by hand, and copies
   note content **verbatim** from the export — for `text`/`html` notes that's usually the raw
   Trilium export wrapper, not the bare fragment other templates in this repo use, so strip it down
   to match sibling notes' `sourceUrl` content).

Always run `validate` before considering the change done. Use `tam_to_zip addons/{id}/` if you need
to hand someone (or yourself, for manual Trilium import testing) a ZIP without waiting for CI.

## Destructive actions require confirmation

Always confirm with the user before deleting a file, including cleanup after `zip_to_tam`
(e.g. the original exported ZIP once its contents are copied into `addons/`) —
even when the deletion seems like obvious tidying. The only exceptions: the file was generated
this session and can be trivially regenerated (a scratch `--out` ZIP from `tam_to_zip`, a temp
directory), or the user has explicitly authorized the deletion. This matters most for untracked
files, since git can't recover them.

## Maintaining this file

Keep this file up to date as the repo evolves: when a task reveals a convention, gotcha, or workflow
not already captured here (e.g. a new script, a new manifest field convention, a recurring mistake),
update the relevant section in the same session rather than leaving it for later.
