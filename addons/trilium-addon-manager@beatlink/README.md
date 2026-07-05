# Trilium Addon Manager (TAM)

![Screenshot](./image.png)

Browse available addons at **https://beatlink.github.io/trilium-scripts/**

## Overview

Trilium Addon Manager (TAM) is a widget-based addon installer for [TriliumNext Notes](https://github.com/TriliumNext/Notes). It lets you install, update, enable, disable, and remove addons from GitHub repositories without leaving Trilium. Addons are described by a `_tam_manifest_.json` file that tells TAM what notes to create, how to wire them together, and how to handle updates.

---

## Architecture

TAM is itself an addon. Once installed, its note tree looks like this:

```
trilium-addon-manager@beatlink  (render note)
├── Database  (JSON code note)
│   ├── Addons  (text note — addon root)
│   └── Addon Data  (JSON code note — persistence root)
└── Source Code  (JSX render script)
    ├── libTAM.js  (frontend JS library)
    └── TAM.css  (appCss stylesheet)
```

**Relations wired at install time:**

| From | Relation | To |
|------|----------|----|
| `trilium-addon-manager@beatlink` | `renderNote` | `Source Code` |
| `Source Code` | `displayNote` | `trilium-addon-manager@beatlink` |
| `libTAM.js` | `database` | `Database` |
| `libTAM.js` | `addonRoot` | `Addons` |
| `libTAM.js` | `addonPersistence` | `Addon Data` |

### Key notes

- **Database** — a JSON code note that holds all TAM state: repository metadata and, per addon, a single merged record covering its installed state, dependency graph, persisted data, and pending update prompts (see [Dependency Tracking](#dependency-tracking) and [Persistence](#persistence)). TAM reads and writes this note on every operation.
- **Addons** — the parent note under which all installed addons are placed as children.
- **Addon Data** — the parent note under which persistence copies of addon data notes are stored (see [Persistence](#persistence)).
- **libTAM.js** — the frontend library that does all the heavy lifting. It runs in the browser but uses `api.runOnBackend` and `api.runAsyncOnBackendWithManualTransactionHandling` for operations that need backend access (fetching URLs, creating notes, modifying note content).
- **Source Code** — the Preact/JSX render widget. It calls functions from `libTAM.js` (available globally as `libTAMjs`) and manages UI state.

---

## Note Identity: `#TAMFILEID`

Every note TAM creates or resolves gets a permanent label: `#TAMFILEID="{addonId}/{localId}"` (e.g.
`#TAMFILEID="libical@kewisch/lib"`). This label — not any id TAM caches in the Database — is the
canonical way to answer "which real Trilium note is local id X of addon Y": the note carries its
own identity, so it can always be found directly by searching Trilium's own attribute index
(`api.getNoteWithLabel("TAMFILEID", value)`), instead of trusting an external id map that could
silently drift out of sync with the actual note tree (a partial install failure, a manual edit, a
bug).

This makes resolving/placing a note **idempotent**: whether a note is being created for the first
time, or one already exists (a retried operation, a note that survived from before, a cross-addon
export being referenced), the same "look it up by TAMFILEID, then clone or create" logic applies —
`installAddon` never needs to special-case "did this already happen".

- **Never inheritable.** `#TAMFILEID` is set with a plain `setLabel`/`note.setLabel` call (no
  `isInheritable` flag) — it identifies exactly one note, and must never propagate to its children,
  which would make every descendant falsely match the same lookup.
- **Only `rootNoteId` and `settingsNoteId` are still cached** in the Database per addon (both
  single-valued and read on hot paths — `enableAddon`, `deleteAddon`, every UI render of the addon
  list). The old `noteMap` (local id → real id) and `exportedNotes` (export name → real id) maps are
  gone entirely — nothing needs them once every note can be found live by its own label, and keeping
  them "as a cache" would have reintroduced exactly the drift risk this convention exists to remove.
- **Migration**: addons installed before this convention existed have no `#TAMFILEID` labels yet.
  `backfillTamFileIds()` tags every note already recorded in an addon's now-otherwise-unused old
  `noteMap` (leftover in the Database from before), run opportunistically whenever "Update
  Repositories" is clicked (see [Dependency Tracking](#dependency-tracking)'s
  `cleanupEmptyPersistenceRoots`, which runs alongside it). This only ever *adds* a label to a note
  that already exists — it never creates, deletes, or moves anything.
- **Soft deletes are accounted for.** `note.deleteNote()` is a soft delete (`note.isDeleted`), so
  every TAMFILEID lookup treats a deleted match as "not found" rather than resurrecting/cloning a
  note that's on its way out — this is why `deleteAddon` followed by a reinstall still always
  produces fresh notes, never resurrects the old (now-deleted) ones.

---

## The `_tam_manifest_.json` Format

Every addon in a TAM-compatible repository must have a `_tam_manifest_.json` file at the root of its addon directory.

### Top-level fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique addon identifier. Format: `addon-name@author`. Must match the directory name. No spaces. |
| `name` | Yes | Human-friendly display name. |
| `description` | Yes | Short description shown in the TAM UI and on the catalog website. |
| `author` | Yes | GitHub username of the author. |
| `homepage` | Yes | URL to the addon's GitHub page. Must end with `addons/{id}`. |
| `license` | Yes | SPDX license identifier (e.g., `GPL-3.0-or-later`). |
| `latestVersion` | Yes | Current version string. Follows semver. Incrementing this triggers an update prompt in TAM. |
| `type` | Yes | Addon category. One of: `widget`, `theme`, `css`, `script`, `library`. Used for display only. |
| `readme` | No | Relative path to the README file for the catalog website (e.g., `README.md`). |
| `manifest` | No | The note-tree manifest (see below). Omit for metadata-only entries. |

### `manifest` sub-object

```json
{
  "manifest": {
    "root": "note-local-id",
    "notes": [...],
    "children": [...],
    "relations": [...],
    "labels": [...],
    "dependencies": [...],
    "exports": {...}
  }
}
```

#### `root`

The local ID of the note that becomes the addon's root note, placed as a child of the Addons parent note.

#### `settingsNote` *(optional)*

The local ID of the note TAM's UI should navigate to for this addon's settings screen. If present,
`installAddon` resolves it to a real note ID at install time and stores it as `settingsNoteId` on the
addon's entry in `installedAddons`. TAM's UI then shows a **Settings** button on that addon's row
which activates (navigates to) that note. **Point this at the `render`-type note (typically `root`),
not at the raw JSX note itself** — activating a JSX code note directly opens its source instead of
the rendered UI. See `cinnamon-applet-agenda@beatlink`/`cinnamon-applet-inbox@beatlink`, where
`settingsNote` is `root` and `root` in turn has a `renderNote` relation to the actual settings JSX —
so the same note opens whether you click the addon's root note directly or the Settings button in
TAM.

#### `notes`

An array of note definitions. Each entry describes one note to create:

```json
{
  "id":           "local-id",
  "title":        "Note Title",
  "type":         "code",
  "mime":         "application/javascript;env=frontend",
  "sourceUrl":    "filename.js",
  "skipOnUpdate": false,
  "promptOnUpdate": false
}
```

| Field | Description |
|-------|-------------|
| `id` | Local identifier for this note, used to reference it throughout the manifest. Not stored verbatim in Trilium, but TAM tags the resolved note with a permanent `#TAMFILEID="{addonId}/{id}"` label (see [Note Identity](#note-identity-tamfileid)) so it can find this exact note again later. |
| `title` | The Trilium note title. |
| `type` | Trilium note type: `text`, `code`, `render`, `book`, `canvas`, `mermaid`, etc. |
| `mime` | MIME type. For code notes: `application/javascript;env=frontend`, `application/javascript;env=backend`, `text/jsx`, `text/css`, `application/json`, etc. |
| `sourceUrl` | Path relative to the addon directory for the note's content. The `publish.py` script inlines this content into the distribution JSON. |
| `content` | Inline content string (used in the distribution JSON after `publish.py` inlines `sourceUrl`). |
| `skipOnUpdate` | If `true`, TAM never overwrites this note's content during updates. Use for user-configurable notes (settings, database). |
| `promptOnUpdate` | If `true`, TAM detects content changes during an update and prompts the user to choose between their current version and the new default. Use for notes users are expected to customize but that may receive meaningful upstream changes. |

#### `children`

Defines the parent-child tree structure. There are two forms:

**Local child** — both notes are in this manifest:
```json
{"parent": "root", "child": "script-note"}
```

**Cross-addon child** — the child is a note exported by a dependency. This creates a clone branch so the dep note appears under the parent:
```json
{"parent": "script-note", "addon": "libmultisort@beatlink", "child": "lib"}
```
`child` is the export name from the dependency's `exports` map (see [Exports](#exports)). Resolved
live: TAM looks up the dependency's *local id* for that export name (from the dependency's own
fetched manifest), then finds the real note by `#TAMFILEID="{depAddonId}/{localId}"`.

#### `relations`

Defines Trilium relations (typed links between notes).

**Local relation** — both notes are in this manifest:
```json
{"from": "root", "type": "renderNote", "to": "source-code"}
```

**Cross-addon relation** — the target is a note exported by a dependency:
```json
{"from": "script", "type": "scriptNote", "addon": "lib@author", "to": "main"}
```
`to` is the export name from the dependency's `exports` map.

#### `labels`

Applies Trilium labels (key-value attributes) to notes after creation:
```json
{"note": "script", "name": "run", "value": "frontendStartup"}
```

Trilium activation labels (those that cause scripts to run or themes to apply) are managed by TAM's enable/disable system — see [Enabling and Disabling](#enabling-and-disabling).

#### `dependencies`

An array of addon IDs that must be installed before this addon:
```json
"dependencies": ["libmultisort@beatlink"]
```

TAM recursively installs all declared dependencies from the same repository before installing the addon itself. If a dependency is already installed but its `latestVersion` is newer than what's currently installed, TAM updates it in place (delete + reinstall, same as a manual update) before proceeding — otherwise a dependency bump (e.g. a shared library's note getting renamed) would never reach an addon that already had the old version of that dependency installed, even via "Update All Addons" on the addon that actually changed.

#### `exports`

Maps export names to local note IDs. This is how other addons reference specific notes in this addon:
```json
"exports": {
  "lib": "lib-note-local-id"
}
```

When a dependent addon references `"addon": "this-addon@author", "child": "lib"`, TAM resolves `"lib"` through this map to get the *local id*, then finds the real note live by its `#TAMFILEID` (see [Note Identity](#note-identity-tamfileid)). `exports{}` stays purely a manifest-level encapsulation boundary — it lets an addon restructure its own internal local ids across a version bump without breaking consumers, as long as the exported name keeps meaning the same thing — no note ids are cached from it.

---

## How Installation Works

1. TAM fetches `{repoId}.json` from the GitHub release (the addon's full manifest with inlined content).
2. Dependencies listed in `manifest.dependencies` are installed first (recursively) — or updated (delete + reinstall, same as a manual update) first if already installed at an older version than the dependency's own `latestVersion`. Either way, this addon is then recorded as a **dependent** of each dependency — see [Dependency Tracking](#dependency-tracking). Each dependency's own manifest (fetched here regardless of which branch ran) is kept around just for this install, since `applyDepChildren`/`applyRelations` below need its `exports` map.
3. Notes are resolved in topological order (parents before children) under the Addons root note: for each, TAM looks up its `#TAMFILEID` — if found (and not soft-deleted), the existing note is cloned into the correct parent (`api.ensureNoteIsPresentInParent`) and its content/type/mime overwritten (unless `skipOnUpdate`/`promptOnUpdate` say otherwise); if not found, a fresh note is created via `api.createTextNote` and immediately tagged. See [Note Identity](#note-identity-tamfileid). A local note listed under more than one parent in `children[]` (a same-addon clone) only goes through this resolve-or-create step once, under whichever entry appears first — every later entry just clones the same resolved note into that additional parent.
4. Cross-addon children are resolved live by `#TAMFILEID` (through the dependency's `exports` map — see [Exports](#exports)) and cloned in with `api.ensureNoteIsPresentInParent`.
5. Labels are applied with `note.setLabel`.
6. Relations are applied with `note.setRelation`. Cross-addon relations resolve the target note the same live way as step 4.
7. The addon is registered in `database.installedAddons[repoId][addonId]` with `installedVersion`, `rootNoteId`, `settingsNoteId`, `dependencies`, `dependents`, and `manuallyInstalled` — merged onto (not replacing) any `persistence` sub-object already sitting on that record from a previous install of this same addonId (see [Persistence](#persistence)). Every "is this addon already installed?" check elsewhere in TAM looks for `installedVersion` specifically, since a record can exist with *only* a `persistence` field for an addon that isn't currently installed at all.
8. Persistence is initialized — see [Persistence](#persistence).
9. The addon is left disabled. The user enables it manually (or it can be auto-enabled by the installing user).

---

## How Updates Work

Updating an addon does **not** do an in-place content patch. Instead:

1. TAM fetches the latest manifest.
2. Before deleting anything, `collectPendingPrompts` scans for notes with `promptOnUpdate: true`, compares their current persisted content against the new content in the manifest, and stores any differences in the Database.
3. The old addon note tree is deleted entirely — every note gets a fresh Trilium note ID on reinstall, none of the old ones survive. (`note.deleteNote()` is a soft delete, but the reinstall's TAMFILEID lookups explicitly treat a deleted match as "not found," so a soft-deleted note is never resurrected/cloned back in — see [Note Identity](#note-identity-tamfileid).)
4. The addon is reinstalled from scratch (following the install steps above).
5. Its `dependents` list (who clones this addon's exports) is restored across the delete/reinstall — `installAddon` always starts a fresh record with an empty list, since from its own perspective it doesn't know who depends on it yet.
6. Persistence is reconnected — existing persisted notes are reattached rather than duplicated (see [Persistence](#persistence)).
7. If the addon was enabled before the update, it is re-enabled afterward.
8. If there were pending prompts, the UI shows the Update Review screen.
9. **Every recorded dependent is then updated too** (same delete + reinstall, recursively cascading to *their* dependents), because step 3 just deleted the exact notes their `children`/`relations` clones point at — without this cascade, every addon that depends on the one just updated would be left with dangling clones pointing at now-deleted notes (this is why step 3 is not an in-place patch: a manifest can add/remove/rename notes between versions, and diffing that safely against a live note tree is far more failure-prone than "delete everything, rebuild from the manifest, keep it idempotent").

This approach ensures the note structure is always clean and matches the manifest, while user data in persisted notes survives. A re-entrancy guard (a `Set` of `repoId::addonId` keys threaded through the whole cascade) stops an addon from being updated twice in the same cascade — this comes up with diamond dependencies, and with an addon's own stale-dependency check (during its own install/update) triggering a dependency update that cascades right back to itself.

**Update All Addons:** the "Update All Addons" button (shown whenever at least one installed addon has an update available) runs this same update flow for every out-of-date addon in sequence, including a self-update of TAM itself if applicable. If any of the updated addons have pending `promptOnUpdate` prompts, the Update Review screen is shown once per addon, one after another, until the queue is empty.

---

## Dependency Tracking

Every installed addon's Database entry carries three extra fields (on top of `persistence` — see [Persistence](#persistence) — which is the one field allowed to survive after the addon is no longer installed):

- **`dependencies`** — the addon IDs it directly depends on (copied from `manifest.dependencies` at install time, so uninstalling later doesn't need to refetch a manifest that may have changed or disappeared).
- **`dependents`** — the addon IDs that directly depend on *it* (the reverse edge, built up as other addons install/update and declare it as a dependency).
- **`manuallyInstalled`** — `true` if the user explicitly installed this addon; `false` if it was only ever pulled in as someone else's dependency.

Installing an addon that's already installed only ever *promotes* `manuallyInstalled` from `false` to `true` (the user directly installing something that was already present as a dependency) — it never demotes the other way, and a dependency-resolution call installing something for the first time always passes `manual: false`.

**Uninstalling** (`uninstallAddon`, what the UI's delete button calls — distinct from the lower-level `deleteAddon`, which just removes one addon's own notes) removes the addon, then for each of *its own* dependencies removes it from that dependency's `dependents` list, and recursively uninstalls that dependency too if it's now unused (`dependents` is empty) and wasn't manually installed. This is why installing one addon that pulls in five shared libraries, then uninstalling it later, cleans up all five automatically — but only the ones nothing else still needs, and never one you separately chose to install yourself.

Addons installed before this tracking existed won't have these fields; they're treated conservatively (`manuallyInstalled` defaults to `true`, `dependencies`/`dependents` default to empty) until they're next installed, updated, or otherwise touched, at which point the fields get populated normally.

### Hidden libraries and update propagation

Addons with `"type": "library"` are never shown in TAM's addon list — there's nothing for a user to do with one directly, since TAM installs, updates, and uninstalls them automatically as a side effect of managing whatever depends on them. This means a library's own available update would otherwise be invisible. To fix that, `checkForAddonUpdates` propagates `updateAvailable` up through the `dependents` graph after computing each addon's direct version comparison: if a library has an update, every addon that depends on it — directly or transitively — is also flagged, using a fixed-point loop so the flag reaches dependents-of-dependents too. The visible addon's own "Update Addon" button then updates it as usual, which (via the dependency-staleness check in `installAddon`'s reinstall path) picks up the library update along the way. "Update All Addons" skips library entries directly for the same reason — updating the visible addon(s) that depend on them already covers it.

---

## Validating the Database

The **Validate Database** button runs `libTAMjs.validateDatabase()`, which audits the installed-addon registry against the live Trilium note tree and reports anything inconsistent:

- **Duplicate `#TAMFILEID`s** — no two live notes claim the same `{addonId}/{localId}` value. This is the one thing a live-lookup-based design can't self-correct (`getNoteWithLabel` just returns whichever match it finds first), so it's the one thing worth actively checking for — a bad migration run or a manually duplicated note are the realistic causes.
- **Dependency graph symmetry** — every `dependencies` edge has a matching reverse `dependents` edge on the other side, and vice versa. Skipped for records that only hold surviving `persistence` data with nothing currently installed.
- **Note existence** — the addon's `rootNoteId` and `settingsNoteId` (if set) still resolve to real, non-deleted notes. Same as above, only checked while the addon is actually installed. (`noteMap`/`exportedNotes` no longer exist as stored fields to check — see [Note Identity](#note-identity-tamfileid).)
- **Persistence integrity** — the record's `persistence.rootNote` and every `persistence.persistenceNotes` entry still exist, and (for addons that are actually installed) every live `AddonData:key` relation found while walking the addon's subtree still points at the persisted note TAM's database says it should. This check runs even for records with no currently-installed addon, since surviving persisted data should stay valid regardless.

It returns a flat list of `{ repoId, addonId, message }` issues (empty if everything checks out), which the UI renders as a dismissible panel. This doesn't fix anything automatically — it's a diagnostic for tracking down drift (e.g. a note deleted by hand outside TAM, or a relation that got repointed) rather than a repair tool.

---

## Enabling and Disabling

TAM enables and disables addons by toggling Trilium activation labels. The following labels are considered "activation labels":

`widget`, `renderNote`, `run`, `customRequestHandler`, `customResourceHandler`, `titleTemplate`, `appCss`, `webViewSrc`, `iconPack`, `runOnNoteCreation`, `runOnNoteTitleChange`, `runOnNoteChange`, `runOnNoteContentChange`, `runOnNoteDeletion`, `runOnBranchCreation`, `runOnBranchChange`, `runOnBranchDeletion`, `runOnChildNoteCreation`, `runOnAttributeCreation`, `runOnAttributeChange`, `appTheme`

**Disabling:** Each activation label is renamed to `disabled:{labelName}` (e.g., `run` → `disabled:run`). Trilium does not recognize `disabled:` prefixed labels, so the scripts stop running.

**Enabling:** Each `disabled:{labelName}` label is renamed back to `{labelName}`.

TAM scans the entire subtree of the addon's root note, so activation labels on any descendant note are toggled correctly.

---

## Persistence

Some addon notes are meant to hold user data (settings, cached data, user-customized content) that should survive addon updates *and* uninstalls. These notes are marked with an `AddonData:key` relation in the manifest.

Persistence data lives nested under the same `database.installedAddons[repoId][addonId]` record as everything else TAM tracks about that addon (`persistence: { rootNote, persistenceNotes, pendingPrompts }`) — there is no separate top-level tree to keep in sync with it. `installedVersion`/`rootNoteId`/`noteMap`/etc. describe the *currently installed* state and disappear on uninstall; `persistence` is the one part of the record that's allowed to outlive it.

When an addon is first installed:
1. TAM scans the addon's note subtree for any `AddonData:key` relations.
2. For each one found, TAM duplicates the target note into the **Addon Data** tree, under a per-addon folder — created **just in time**, the first time this addon actually has something to persist. An addon with no `AddonData:` relations at all never gets a folder under Addon Data, and its record carries no `persistence` field at all.
3. The `AddonData:key` relation on the addon note is updated to point to the persisted copy instead of the original.
4. The mapping `key → persistedNoteId` is saved into the addon's own `persistence.persistenceNotes`.

On reinstall after an update:
1. TAM finds the existing persistence mapping already on the addon's record.
2. Instead of duplicating again, the relation is rewired to point to the already-existing persisted note.
3. User data is preserved unchanged.

Notes in the persistence tree are never deleted by TAM (even if the addon is uninstalled), ensuring data is not accidentally lost — `deleteAddon` deletes the addon's own note tree and every *installed*-state field, but if the record has any surviving `persistence` data (a `rootNote` or a non-empty `persistenceNotes`), it keeps a reduced record containing just that `persistence` sub-object rather than removing the entry outright. A later reinstall of that same addonId picks the surviving data back up automatically (see [How Installation Works](#how-installation-works)). The one exception is the per-addon *folder* itself: if it ends up with zero children (nothing to persist, or everything that was persisted is gone), TAM deletes the empty folder and clears the `rootNote` reference — checked for the addon just installed/updated every time `connectAddonPersistence` runs, and swept across every installed addon by `cleanupEmptyPersistenceRoots` whenever "Update Repositories" is clicked (this is what retroactively cleans up addons that got an empty folder before persistence roots were made just-in-time). If that sweep empties out a record that also has no installed state and no pending prompts, the whole record is dropped.

---

## `skipOnUpdate`

Set `"skipOnUpdate": true` on any note whose content should never be overwritten during an update. Typical uses:

- **Database / settings notes** — the user fills these in after installation; an update must not reset them.
- **Root render notes** — structural notes whose content is not meaningful (empty or a stub).

During a self-update, TAM skips content writes for any note with `skipOnUpdate: true`.

---

## `promptOnUpdate`

Set `"promptOnUpdate": true` on notes that users are expected to customize, but where upstream changes may also be meaningful and should be surfaced. This is a middle ground between "always overwrite" (default) and "never overwrite" (`skipOnUpdate`).

Before an update:
1. TAM reads the note's current content from its persisted copy.
2. TAM reads the new content from the incoming manifest.
3. If they differ, TAM stores a pending prompt (both versions of the content plus the note title).

After reinstallation, if there are pending prompts, TAM shows the **Update Review** screen:
- Each changed note is shown with two side-by-side panels: **Keep Mine** (current) and **Use New Default** (incoming).
- The default selection is **Keep Mine**.
- The user can switch any note to "Use New Default" before clicking Apply.
- Choosing "Use New Default" writes the new content to the persisted note. Choosing "Keep Mine" leaves it untouched.
- Once all choices are applied, the review is dismissed and the addon UI reloads.

`promptOnUpdate` only makes sense on notes that are also tracked by an `AddonData:key` relation (i.e., notes in the persistence tree). If a note has `promptOnUpdate` but no `AddonData:` relation, it will be skipped.

---

## Self-Update

TAM's own update path is different because deleting and reinstalling TAM while it is running would break the process. Instead, `selfUpdateAddon` does an in-place content update:

1. TAM fetches the latest manifest for itself.
2. For each note in the manifest, TAM resolves it by `#TAMFILEID="trilium-addon-manager@beatlink/{localId}"` — uniformly, whether TAM was TAM-installed or manually ZIP-imported, since there's no separate `noteMap`-based branch anymore (see [Note Identity](#note-identity-tamfileid)). Any note not yet tagged (a fresh manual import, or one from before this convention existed) falls back to the old title-matching traversal — discovering note ids by walking the tree upward from `libTAM.js` and matching manifest note titles against live note titles — for *that one note only*, then immediately tags it. This self-heals after the first successful self-update; the traversal never needs to run again for a note once it's tagged.
3. If `skipOnUpdate` is false, TAM writes the new content directly to the resolved note.
4. Notes with `skipOnUpdate: true` (Database, Addons root, Addon Data root) have their content left untouched, preserving all installed addon state and user data.
5. **Structural moves are applied regardless of `skipOnUpdate`.** For every note in the manifest's `children[]`, TAM compares its live parent(s) against what the manifest currently declares and reparents it with `api.ensureNoteIsPresentInParent`/`api.ensureNoteIsAbsentFromParent` if they differ — adding any parent it should have and detaching it from any parent it no longer should. `skipOnUpdate` only protects *content*; a note's position in the tree can still change between versions (e.g. Addons/Addon Data moving to be direct children of root instead of nested under Database), and since TAM never goes through the delete+reinstall every other addon's update uses, this is the only path that would ever apply such a move to an already-installed TAM.
6. The installed version is updated in the Database, and `rootNoteId` is refreshed from the just-resolved note (self-healing it if it had ever drifted).

---

## Repository Format

A TAM-compatible GitHub repository must:

1. Have one or more addon directories under `addons/`, each named to match the addon's `id`.
2. Each addon directory contains a `_tam_manifest_.json`.
3. Have a GitHub Actions workflow (see `publish.yml`) that builds and publishes a release named `latest` containing:
   - `metadata.json` — merged metadata for all addons (used by TAM to populate its addon list).
   - `{addon-id}.json` — per-addon distribution manifest with all `sourceUrl` content inlined.
   - `{addon-id}.zip` — Trilium-importable ZIP export (for manual installation without TAM).

TAM fetches `metadata.json` when you click "Update Repositories" and fetches `{addon-id}.json` when installing or updating an individual addon.

---

## Scripts Reference

All scripts live in `scripts/` and are run from the repository root.

### `validate.py`

Validates all `_tam_manifest_.json` files before publishing. Checks:

- All required top-level fields are present (`id`, `name`, `description`, `author`, `homepage`, `license`, `latestVersion`, `type`).
- Addon directory name matches the `id` field (auto-fixable with `--fix`).
- `homepage` ends with `addons/{id}` when the path contains `/addons/` (auto-fixable with `--fix`).
- `readme` file exists on disk if declared.
- `manifest.root` exists in `manifest.notes`.
- All `sourceUrl` paths resolve to real files.
- All `children`, `relations`, and `labels` reference note IDs that exist in `manifest.notes`.
- `manifest.dependencies` is a list of strings.

Run in CI before every publish. Exits with code 1 if any errors are found.

```
python scripts/validate.py [--fix]
```

### `publish.py`

Builds the distribution files released to GitHub:

- For each addon, reads `_tam_manifest_.json` and inlines each note's `sourceUrl` file content into a `content` field, producing `{addon-id}.json`.
- Produces `metadata.json` — a merged registry of all addon metadata (top-level fields only, no manifest content).

```
python scripts/publish.py
```

### `export_zip.py`

Converts a `_tam_manifest_.json` into a Trilium-importable ZIP export (the format Trilium's "Import" function accepts). Automatically discovers and bundles dependency addons from the sibling `addons/` directory.

- For each note in the manifest, fresh Trilium note IDs are generated.
- Dependency addons are read from `addons/{dep-id}/_tam_manifest_.json` in the same repo and bundled as additional root entries in the ZIP's `!!!meta.json`.
- Cross-addon clone children and relations are wired using the generated UUIDs, resolved via each dependency's `exports` map.

```
python scripts/export_zip.py addons/{addon-id}/ [--out output.zip] [--addons-dir path/to/addons/]
```

The `--addons-dir` defaults to the parent directory of the addon being exported (i.e., `addons/`). Override it if running from a different working directory.

### `convert_zip.py`

Converts a Trilium export ZIP into a `_tam_manifest_.json` + flat source files. This is the reverse of `export_zip.py` and is used when migrating an existing addon (developed and exported from Trilium) into the TAM manifest format.

- Reads `!!!meta.json` from the export ZIP.
- Assigns stable local IDs to notes by slugifying their titles.
- Copies source files flat into the output directory.
- Handles clone entries (notes that appear under multiple parents) correctly — they become extra `children` entries referencing the same local ID rather than duplicate note entries.
- Filters out `noImport` scaffold entries.
- Outputs a `_tam_manifest_.json` with `FILL_IN` placeholders for top-level metadata fields that must be filled in manually.

```
python scripts/convert_zip.py path/to/export.zip [--out ./output-dir/]
```

After running, fill in the `FILL_IN` fields in `_tam_manifest_.json`, review the auto-generated local IDs, add `dependencies`/`exports` if needed, and set `skipOnUpdate`/`promptOnUpdate` on appropriate notes.

### `generate_pages.py`

Generates the static GitHub Pages catalog site at `docs/`. For each addon:

- Renders a card on the index page with name, type badge, description, version, and author.
- Renders a detail page (`docs/{addon-id}/index.html`) with the README, metadata table, and download buttons.
- The index page has a search bar and type filter buttons.
- Author names link to their GitHub profiles.
- Download buttons: **Download ZIP** (Trilium import), **Download Manifest** (TAM JSON), **Source** (GitHub homepage).

Also regenerates `README.md` from `README_base.md` by injecting an addon table between `<!-- GENERATED:START -->` and `<!-- GENERATED:END -->` markers.

```
python scripts/generate_pages.py
```

Requires the `markdown` package (`pip install markdown`).

### `publish.py`

See above — builds `metadata.json` and per-addon `{id}.json` distribution files.

### `strip_no_import.py`

A cleanup utility for raw Trilium export directories. Trilium exports sometimes include `noImport` scaffold HTML files that serve no purpose when converting to `_tam_manifest_.json`. This script:

- Scans all `!!!meta.json` files in the current tree.
- Deletes the physical files for any entry with `"noImport": true`.
- Removes those entries from `!!!meta.json`.

```
python scripts/strip_no_import.py
```

Run this on a freshly extracted Trilium export before running `convert_zip.py` if you want a clean directory.

### `import_addon.py` *(legacy)*

An older utility that extracts a Trilium export ZIP into the pre-TAM repo structure (`addons/{name}/{note-title}/` with a `metadata.json` stub). This format predates `_tam_manifest_.json` and is no longer used for new addons. Kept for reference.

---

## GitHub Actions Workflows

### `publish.yml`

Runs on every push to `main` and on manual dispatch. Steps:

1. `validate.py` — validates all manifests, fails the workflow on errors.
2. `publish.py` — builds `metadata.json` and per-addon `{id}.json` files.
3. A shell loop over `addons/*/` calls `export_zip.py` for each addon to produce `{id}.zip`.
4. Creates or updates the `latest` GitHub release and uploads all `*.json` and `*.zip` files.

### `pages.yml`

Runs on every push to `main` and on manual dispatch. Builds and deploys the GitHub Pages catalog site:

1. Installs the `markdown` Python package.
2. Runs `generate_pages.py` to produce `docs/`.
3. Uploads `docs/` as a Pages artifact and deploys it.

---

## Installing TAM

TAM itself is bootstrapped differently from other addons because there is no TAM to install it:

1. Download `trilium-addon-manager@beatlink.zip` from the [latest release](https://github.com/BeatLink/trilium-scripts/releases/latest).
2. In TriliumNext, use **Import** to import the ZIP under any note.
3. Open the imported `trilium-addon-manager@beatlink` render note.
4. TAM will detect any of its own notes not yet carrying a `#TAMFILEID` label (a manual import has none yet) and handle self-updates correctly regardless — see [Self-Update](#self-update).
5. Add `BeatLink/trilium-scripts` as a repository and click "Update Repositories" to populate the addon list.
