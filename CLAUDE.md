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
nix-shell --run "python3 scripts/validate.py"
```

Inside `nix-shell`, these shell functions are defined (see `shell.nix`):

```bash
validate                   # scripts/validate.py — lint all _tam_manifest_.json files, exit 1 on error
strip                      # scripts/strip_no_import.py — delete noImport-flagged files from a raw Trilium export
publish                    # scripts/publish.py — build metadata.json + per-addon {id}.json (inlines sourceUrl content)
ci                         # validate && publish
import_addon <zip>         # scripts/import_addon.py — legacy pre-TAM importer, kept for reference only
generate_pages             # scripts/generate_pages.py — build docs/ (GitHub Pages) and regenerate README.md
convert_zip <zip>          # scripts/convert_zip.py — Trilium export ZIP -> _tam_manifest_.json + flat source files
export_zip <manifest-dir>  # scripts/export_zip.py addons/{id}/ [--out x.zip] — manifest -> Trilium-importable ZIP
```

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
  base64-encodes it into `content` instead of reading it as text, and `lib-tam.js`'s `createNotes`
  decodes it back into a `Buffer` before `setContent()`. `convert_zip.py` sets this flag
  automatically for any `type: "file"` note found in a Trilium export. See `libtimer@beatlink` for a
  real example (bundled `.wav` sound effects).
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
  notes. `deleteAddon` only ever deletes `installedAddons[...].rootNoteId`'s subtree — a note with no
  local parent that isn't `root` would never get cleaned up on uninstall/update, leaking forever.
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
  `import` can find it from each). `lib-tam.js`'s `createNotes` (fixed in TAM 2.5.2) creates the note
  once under whichever `{parent, child}` entry appears first, then wires every later entry as a real
  clone via `api.toggleNoteInParent` — before that fix it used a flat `child → parent` map, which
  silently overwrote earlier entries and left the note attached only to whichever parent was *last*
  in the array (see `agenda@beatlink`'s `agenda-settings` note, 4 parents, and `togglenotes@beatlink`,
  2 separate cases, for real examples this broke). `export_zip.py`'s `process_manifest` has the same
  first-occurrence-is-real / later-occurrences-are-clones handling for the same reason.
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
  for this addon's settings screen. If present, TAM resolves it to a real note id at install time
  (`installedAddons[repoId][addonId].settingsNoteId`, set in `installAddon` in `lib-tam.js`) and
  shows a "Settings" button on the addon's row that activates that note. **Point this at the
  `render`-type note (typically `root`), not at the raw JSX note itself** — activating a JSX code
  note directly opens its source instead of the rendered UI. See
  `cinnamon-applet-agenda@beatlink`/`cinnamon-applet-inbox@beatlink`, where `settingsNote` is `root`
  and `root` in turn has a `renderNote` relation to the actual settings JSX — so the same note opens
  whether you click the addon's root note directly or the Settings button in TAM.

- **`type`** — `widget`/`script`/`theme` are user-facing and always shown in TAM's addon list;
  `library` is TAM-managed only. TAM's UI hides `type: "library"` addons entirely — a user never
  installs or uninstalls one directly, TAM does it automatically via `dependencies[]`/`dependents`
  as a side effect of installing/updating/uninstalling whatever depends on it (see below). If a
  library would be independently useful to a user on its own (not just as plumbing for another
  addon), split it into a thin user-facing `type` addon plus the actual `type: "library"` it depends
  on — e.g. `notifications@beatlink` (user-facing) wrapping `libnotification@beatlink` (hidden) —
  rather than shipping one library the user would have to find and install manually.

TAM itself (the addon that interprets all of this inside Trilium) is `libTAM.js` +
`trilium-addon-manager@beatlink`'s render note; see that addon's `README.md` for the full
install/update/persistence/self-update state machine — it's long and not worth duplicating here.
Since library addons are hidden from the list, a library's own available update is never shown
directly — `checkForAddonUpdates` propagates `updateAvailable` up through the installed
`dependents` graph (fixed-point loop, so it reaches transitive dependents too) so it surfaces on
whichever visible addon(s) actually depend on that library. TAM also tracks a full dependency graph
per install (`dependencies`/`dependents`/`manuallyInstalled` on each `installedAddons[repoId][addonId]`
record): installing an addon auto-installs (and, if stale, updates) its dependencies and records the
reverse edge; updating an addon cascades to every dependent (since update is delete+reinstall, and a
dependent's clones of the updated addon's exports would otherwise point at deleted notes);
uninstalling an addon cascades down to any dependency that's now unused (`dependents.length === 0`)
and wasn't itself manually installed. Persisted user data (`AddonData:` notes) lives nested on that
same `installedAddons[repoId][addonId]` record as a `persistence` sub-object rather than a separate
top-level tree — `deleteAddon` strips every installed-state field on uninstall but keeps `persistence`
if it has anything in it, so a record can exist for an addonId that isn't currently installed at all;
every "is this addon installed" check in `lib-tam.js` therefore tests `installedVersion` presence, not
just whether the record exists. `libTAMjs.validateDatabase()` (wired to TAM's "Validate
Database" button) audits all of this against the live note tree — dependency/dependent edges are
symmetric, every recorded note id (root, noteMap, exportedNotes, settingsNoteId, persistence
root/notes) still exists, and every live `AddonData:` relation still points at the persisted copy
TAM thinks it does — returning a flat list of issues rather than silently trusting the database.

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
