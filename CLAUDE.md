# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A collection of widgets, themes, and scripts for TriliumNext Notes, distributed through a custom
addon manager called **TAM** (Trilium Addon Manager, `addons/trilium-addon-manager@beatlink/`).
Addons live under `addons/`, are described by a `_tam_manifest_.json`, and get published as GitHub
Releases + a GitHub Pages catalog (https://beatlink.github.io/trilium-scripts/) by CI on every push
to `main`.

Not every directory under `addons/` is TAM-managed — only directories named `name@author` with a
`_tam_manifest_.json` participate in validate/publish/export. Directories without an `@author` suffix
(`Archived/`) are legacy/pre-TAM addons kept for reference and are skipped by the scripts.
`Recurrence`, `Reschedule`, and `Calendar` (also legacy/pre-TAM) were removed once
`librecurrence@beatlink`/`libagendatask@beatlink` and `libcalendar@beatlink`/
`libcalendarwidget@beatlink`/`simplecalendar@beatlink` fully subsumed them respectively — same
feature scope plus real fixes (unhandled recurrence exhaustion, a hardcoded `127.0.0.1:PORT` URL,
redundant triple-triggered ical regeneration) — with no functionality actually lost.

## Development commands

Python tooling is only available inside the Nix dev shell — `python3`/`gh` are not on the bare PATH.
Either `nix-shell` into an interactive shell, or run one-off commands with `nix-shell --run "..."`:

```bash
nix-shell --run "python3 resources/scripts/validate.py"
```

Inside `nix-shell`, these shell functions are defined (see `shell.nix`):

```bash
validate                   # resources/scripts/validate.py — lint all _tam_manifest_.json files, exit 1 on error
strip                      # resources/scripts/strip_no_import.py — delete noImport-flagged files from a raw Trilium export
publish                    # resources/scripts/publish.py — build metadata.json + per-addon {id}.json (inlines sourceUrl content)
ci                         # validate && publish
import_addon <zip>         # resources/scripts/import_addon.py — legacy pre-TAM importer, kept for reference only
generate_pages             # resources/scripts/generate_pages.py — build docs/ (GitHub Pages) and regenerate README.md
convert_zip <zip>          # resources/scripts/convert_zip.py — Trilium export ZIP -> _tam_manifest_.json + flat source files
export_zip <manifest-dir>  # resources/scripts/export_zip.py addons/{id}/ [--out x.zip] — manifest -> Trilium-importable ZIP
build_addon_zips           # resources/scripts/build_addon_zips.py — CI-only: {id}.zip for every addon via export_zip.py
publish_release            # resources/scripts/publish_release.py — CI-only: upload *.json/*.zip to the 'latest' GitHub release
```

Scripts live in `resources/scripts/`, not `scripts/` — all invocations (shell.nix functions and CI
workflow steps) assume the process's cwd is the repository root, not the scripts directory itself,
since several scripts resolve `addons/`/`docs/` as plain relative paths.

`validate` is the closest thing to a test suite here — always run it after editing any
`_tam_manifest_.json` or adding/removing addon source files. It checks required top-level fields,
that the addon directory name matches `id`, that `homepage` ends with `addons/{id}`, that every
`sourceUrl` resolves to a real file, and that every `children`/`relations`/`labels` entry references
a note id that actually exists in the manifest.

There is no separate build or test framework — CI (`.github/workflows/publish.yml`) just runs
`validate` then `publish` then loops `export_zip` over every addon dir, and
`.github/workflows/pages.yml` runs `generate_pages`.

## Manifest-driven addon architecture

Every TAM addon is a `_tam_manifest_.json` at `addons/{id}/` (id format `name@author`, must match the
directory name). It declares a tree of Trilium notes rather than raw exported files:

- **`notes[]`** — one entry per note (`id` = local id used only within the manifest, `title`, Trilium
  `type`, `mime`, `sourceUrl` pointing at a flat file in the same directory holding the note's
  content). `publish.py` inlines each `sourceUrl` file into a `content` field to produce the
  distribution JSON; nothing else reads `sourceUrl` at runtime. Add `"binary": true` on a note whose
  `sourceUrl` is non-text (e.g. a `type: "file"` note with mime `audio/wav`) — `publish.py` then
  base64-encodes it into `content` instead of reading it as text, and `lib-tam.js`'s `resolveNotes`
  decodes it back into a `Buffer` before `setContent()`. `convert_zip.py` sets this flag
  automatically for any `type: "file"` note found in a Trilium export. See `libtimer@beatlink` for a
  real example (bundled `.wav` sound effects).
- **Note identity: `#TAMFILEID`** — every note TAM creates or resolves carries a permanent,
  non-inheritable label `#TAMFILEID="{addonId}/{localId}"` (e.g.
  `#TAMFILEID="libical@kewisch/lib"`). This, not any id cached in TAM's Database, is the canonical
  way to find "which real note is local id X of addon Y" — `api.getNoteWithLabel("TAMFILEID",
  value)` looks it up directly against Trilium's own attribute index, so it can never silently drift
  the way an external id map (the old `noteMap`/`exportedNotes` fields, removed in TAM 2.8.0) could.
  Resolution is find-or-create: if a tagged note already exists (and isn't soft-deleted —
  `note.deleteNote()` never immediately removes it), it's cloned into whatever new parent needs it
  and its content is reconciled (respecting `skipOnUpdate`/`promptOnUpdate`, and unconditionally
  protected if it's an `AddonData:`-relation target — see the persistence note below); otherwise a
  fresh note is created and tagged immediately. **Nothing about note identity is cached in the
  Database at all** — not even `rootNoteId`/`settingsNoteId` anymore, as of the schema change
  described below; everything resolves live via TAMFILEID whenever needed. See
  `trilium-addon-manager@beatlink/README.md`'s "Note Identity" section for the full design and the
  one-time `backfillTamFileIds()` migration for addons installed before this convention existed.
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
  `import` can find it from each). `lib-tam.js`'s `resolveNotes` (renamed from `createNotes` in TAM
  2.8.0, the fix itself landed earlier in 2.5.2) resolves the note once under whichever
  `{parent, child}` entry appears first, then wires every later entry as a real clone via
  `api.ensureNoteIsPresentInParent` — before the 2.5.2 fix this used a flat `child → parent` map,
  which silently overwrote earlier entries and left the note attached only to whichever parent was
  *last* in the array (see `agenda@beatlink`'s `agenda-settings` note, 4 parents, and
  `togglenotes@beatlink`, 2 separate cases, for real examples this broke). `export_zip.py`'s
  `process_manifest` has the same first-occurrence-is-real / later-occurrences-are-clones handling
  for the same reason.
- **`relations[]`** / **`labels[]`** — Trilium relations and labels applied after note creation, same
  local-vs-cross-addon shape.
- **`dependencies[]`** / **`exports{}`** — declares and exposes notes for other addons to clone/link
  against. A dependency doesn't strictly need a matching `children`/`relations` cross-addon entry —
  e.g. a static-resource-only vendor library (see `libfullcalendar@arshaw`) is referenced by a fixed
  `custom/...` URL string baked into the consumer's code, not by cloning a note, so it only ever
  appears in `dependencies[]`. `lib-tam.js`'s real install path already handles this correctly (it
  walks `dependencies[]` directly, independent of any cloning); `export_zip.py`'s dependency
  discovery also treats `dependencies[]` as authoritative for what to bundle, for the same reason.
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
  an addon's catalog metadata (`metadata.json`, see `publish.py`) carries no manifest content, so an
  uninstalled addon's detail page links out to its GitHub homepage instead of trying to render one.

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
persistence/repair state machine — it's long and not worth duplicating here. The short version:

- **One entry point.** `syncAddon(repoId, addonId, options)` replaces what used to be three separate
  functions (`installAddon`/`updateAddon`/`selfUpdateAddon`) — a fresh install, a version update, and
  TAM updating *itself* are all the same call now that find-or-create-by-`#TAMFILEID` removes the
  reason delete+reinstall ever existed. Nothing is deleted-then-recreated on an ordinary sync
  anymore, so there's no more cascade-to-dependents either (a dependent's clone of a dependency's
  exported note points at a real id that never changes across an ordinary version bump).
- **Each installed addon's Database record stores its own manifest structure** (same shape as
  `_tam_manifest_.json`'s `manifest` sub-object, minus `sourceUrl`/`content`) rather than a grab-bag
  of derived fields — `dependencies`/`exports` are read straight from it, and `rootNoteId`/
  `settingsNoteId` are resolved live from `manifest.root`/`manifest.settingsNote` whenever needed. The
  only genuinely irreducible per-install facts, stored alongside it, are `installedVersion` (a
  manifest fetch always reflects latest, never what's installed) and `manuallyInstalled` (pure user
  intent); `enabled` is technically derivable too (scan for `disabled:`-prefixed activation labels)
  but is cached anyway since it's read on every addon-list render.
- **`dependents` (who depends on this addon) is computed, never stored** — `getDependents` scans
  every other installed addon's own stored `manifest.dependencies` for the reverse edge, so there is
  nothing pushed/maintained that could drift out of sync. Used by `checkForAddonUpdates`'s
  update-propagation up through hidden `type: "library"` addons (fixed-point loop, since library
  addons never show in the list, so their own available update needs surfacing on whichever visible
  addon(s) depend on them) and by `uninstallAddon`'s cascade-uninstall-if-now-unused check.
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
  returning a flat list of issues rather than fixing anything.
- **`libTAMjs.repairAddon()`** (wired to a per-addon "Repair" button) is the fix-it counterpart —
  but purely offline, working only from the addon's own *locally stored* manifest (never a network
  fetch), fixing structure (parent branches, labels, relations) but never touching content and never
  recreating a fully-deleted note (nothing stored locally to rebuild it with — that's reported as an
  issue instead, fixable only by an actual sync/update).

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

The bug this caused: a shared helper (`getAgendaSettings()` in `agenda@beatlink/agendaSettings.jsx`)
read `api.currentNote.getRelationValue("schemaNote")` to fetch relations that live on *whichever
widget note imports it* (`task`/`overview`/`now-window`, each carrying its own `schemaNote`/
`settingsNote`/etc. relations per the manifest) — but since that code physically lives in
`agendaSettings.jsx`'s own note (which has zero attributes), `currentNote` resolved to itself, not
the caller, and the relation lookups silently returned `null`. Fixed by switching to `startNote`,
which correctly stays bound to whichever widget note started the bundle regardless of which shared
module the code calling it lives in. Rule of thumb: any code reading relations that the *manifest*
places on a specific note (not the note the function happens to be written in) should use
`startNote`, never `currentNote` — `currentNote` only does what you want when the reading code and
the relation-bearing note are guaranteed to be the same note.

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
2. Develop inside Trilium, export via **Trilium → Export**, then `convert_zip <export.zip>` to
   generate a starting `_tam_manifest_.json` + source files (it leaves `FILL_IN` placeholders for
   `id`/`name`/`description`/`author`/`homepage`/`type` that must be filled in by hand, and copies
   note content **verbatim** from the export — for `text`/`html` notes that's usually the raw
   Trilium export wrapper, not the bare fragment other templates in this repo use, so strip it down
   to match sibling notes' `sourceUrl` content).

Always run `validate` before considering the change done. Use `export_zip addons/{id}/` if you need
to hand someone (or yourself, for manual Trilium import testing) a ZIP without waiting for CI.

## Destructive actions require confirmation

Always confirm with the user before deleting a file, including cleanup after `convert_zip`/
`import_addon` (e.g. the original exported ZIP once its contents are copied into `addons/`) —
even when the deletion seems like obvious tidying. The only exceptions: the file was generated
this session and can be trivially regenerated (a scratch `--out` ZIP from `export_zip`, a temp
directory), or the user has explicitly authorized the deletion. This matters most for untracked
files, since git can't recover them.

## Maintaining this file

Keep this file up to date as the repo evolves: when a task reveals a convention, gotcha, or workflow
not already captured here (e.g. a new script, a new manifest field convention, a recurring mistake),
update the relevant section in the same session rather than leaving it for later.
