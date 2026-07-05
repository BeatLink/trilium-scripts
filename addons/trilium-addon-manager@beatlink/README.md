# Trilium Addon Manager (TAM)

![Screenshot](./image.png)

Browse available addons at **https://beatlink.github.io/trilium-scripts/**

> ⚠️ **Work in progress.** TAM's manifest format and its Database/persistence model are under
> active development and changing frequently. Data loss is possible. Install this to test and
> explore only — do not use it to manage real/production Trilium data yet.

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

- **Database** — a JSON code note that holds all TAM state: repository metadata and, per addon, a single merged record covering its installed state, own manifest structure, persisted data, and pending update prompts (see [The Database Record](#the-database-record) and [Persistence](#persistence)). TAM reads and writes this note on every operation.
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
`syncAddon` never needs to special-case "did this already happen".

- **Never inheritable.** `#TAMFILEID` is set with a plain `setLabel`/`note.setLabel` call (no
  `isInheritable` flag) — it identifies exactly one note, and must never propagate to its children,
  which would make every descendant falsely match the same lookup.
- **Nothing about note identity is cached in the Database at all anymore** — not `rootNoteId`, not
  `settingsNoteId`, not the old `noteMap`/`exportedNotes` maps. Instead, each installed addon's
  Database record stores its own **manifest structure** (see [The Database Record](#the-database-record)
  below) — `rootNoteId`/`settingsNoteId` are derived on demand from `manifest.root`/`manifest.settingsNote`
  plus a `#TAMFILEID` lookup wherever they're needed (`enableAddon`, `deleteAddon`, the addon list UI —
  batched into one backend round trip there). Keeping them "as a cache" would have reintroduced
  exactly the drift risk this convention exists to remove.
- **Migration**: addons installed before this convention existed have no `#TAMFILEID` labels yet.
  `backfillTamFileIds()` tags every note already recorded in an addon's now-otherwise-unused old
  `noteMap` (leftover in the Database from before), run opportunistically whenever "Update
  Repositories" is clicked (see [The Database Record](#the-database-record)'s
  `cleanupEmptyPersistenceRoots`, which runs alongside it). This only ever *adds* a label to a note
  that already exists — it never creates, deletes, or moves anything.
- **Soft deletes are accounted for.** `note.deleteNote()` is a soft delete (`note.isDeleted`), so
  every TAMFILEID lookup treats a deleted match as "not found" rather than resurrecting/cloning a
  note that's on its way out.

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
it's stored as-is in the addon's own `manifest.settingsNote` (see [The Database Record](#the-database-record))
and resolved to a real note ID live, via `#TAMFILEID`, whenever the UI needs it. TAM's UI then shows a
**Settings** button on that addon's row which activates (navigates to) that note. **Point this at the `render`-type note (typically `root`),
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

TAM recursively syncs all declared dependencies from the same repository before syncing the addon itself. If a dependency is already installed but its `latestVersion` is newer than what's currently installed, TAM syncs it in place first — otherwise a dependency bump (e.g. a shared library's note getting renamed) would never reach an addon that already had the old version of that dependency installed, even via "Update All Addons" on the addon that actually changed. See [How Sync Works](#how-sync-works).

#### `exports`

Maps export names to local note IDs. This is how other addons reference specific notes in this addon:
```json
"exports": {
  "lib": "lib-note-local-id"
}
```

When a dependent addon references `"addon": "this-addon@author", "child": "lib"`, TAM resolves `"lib"` through this map to get the *local id*, then finds the real note live by its `#TAMFILEID` (see [Note Identity](#note-identity-tamfileid)). `exports{}` stays purely a manifest-level encapsulation boundary — it lets an addon restructure its own internal local ids across a version bump without breaking consumers, as long as the exported name keeps meaning the same thing — no note ids are cached from it.

---

## The Database Record

Every installed addon's entry in `database.installedAddons[repoId][addonId]` is:

```json
{
  "installedVersion": "1.2.3",
  "manuallyInstalled": true,
  "enabled": true,
  "manifest": { "root": "...", "settingsNote": "...", "notes": [...], "children": [...], "relations": [...], "labels": [...], "dependencies": [...], "exports": {...} },
  "persistence": { "rootNote": "...", "persistenceNotes": {...}, "pendingPrompts": [...] }
}
```

`manifest` is the addon's own manifest structure — the *exact same shape* as `_tam_manifest_.json`'s
`manifest` sub-object — minus `sourceUrl`/`content` on each note (see `stripManifestForStorage`).
This is deliberately **not** "just re-fetch the manifest whenever you need it": GitHub Releases only
ever serves the *latest* version, so once a newer one is published there is no other way to know
what structure is actually installed. Storing it locally also means an upstream manifest change
never silently affects an addon until it's actually synced to that new version, and — since the
exact same shape describes both "what a repository offers" and "what's currently installed" — the
same resolve/apply functions (`resolveNotes`, `applyDepChildren`, `applyLabels`, `applyRelations`)
work identically on either one.

Only three facts are genuinely irreducible and can't be derived from the manifest or the live note
tree:
- **`installedVersion`** — a manifest fetch always reflects the *latest* available version, never
  what's actually installed.
- **`manuallyInstalled`** — `true` if the user explicitly installed this addon; `false` if it was
  only ever pulled in as someone else's dependency. Pure user intent, not derivable from anything.
  Installing an addon that's already installed only ever *promotes* this from `false` to `true` —
  never demotes the other way, and a dependency-resolution call installing something for the first
  time always passes `manual: false`.
- **`enabled`** — technically derivable (scan the root subtree for `disabled:`-prefixed activation
  labels), but cached here anyway since it's read on every addon-list render.

Everything else that used to be its own field is now either read straight from the stored
`manifest` (`dependencies`, `exports` — see [`_tam_manifest_.json` Format](#the-_tam_manifest_json-format))
or derived on demand:

- **`rootNoteId`/`settingsNoteId`** — resolved via `#TAMFILEID` from `manifest.root`/`manifest.settingsNote`
  whenever needed (`enableAddon`, `deleteAddon`; batched into one backend round trip for the whole
  addon list in `getAllRepositories`). No longer cached at all.
- **`dependents`** (who depends on *this* addon) — the reverse of `dependencies`, which is already
  stored on every *other* installed addon's own record. `getDependents(database, repoId, addonId)`
  computes it by scanning `installedAddons[repoId]` for whichever ones list `addonId` in their own
  `manifest.dependencies` — nothing is pushed or maintained as edges are added/removed, so there is
  nothing that can drift out of sync. Used by `checkForAddonUpdates`'s update-propagation and by
  `uninstallAddon`'s cascade-uninstall-if-unused check.

`persistence` is the one part of the record allowed to survive after `installedVersion`/`manifest`/
etc. disappear on uninstall — see [Persistence](#persistence).

Addons installed before this schema existed have the old flat fields (`rootNoteId`, `dependencies`,
`dependents`, etc.) instead of a `manifest` snapshot — there was nowhere to get one from before this
existed. `backfillInstalledManifests()` bridges this: for any installed addon missing `manifest`, it
fetches that addon's current manifest (the only way to get one) and stores its stripped structure —
a best-effort, one-time approximation (if the upstream manifest changed since that addon was
actually installed, the backfill reflects the newer structure) run opportunistically from
`updateRepositories`, alongside `backfillTamFileIds`/`cleanupEmptyPersistenceRoots`. From that point
on the stored manifest is authoritative and immune to future upstream changes, like everything
synced from here on.

### Hidden libraries and update propagation

Addons with `"type": "library"` are never shown in TAM's addon list — there's nothing for a user to do with one directly, since TAM installs, updates, and uninstalls them automatically as a side effect of managing whatever depends on them. This means a library's own available update would otherwise be invisible. To fix that, `checkForAddonUpdates` propagates `updateAvailable` up through the computed `dependents` graph after computing each addon's direct version comparison: if a library has an update, every addon that depends on it — directly or transitively — is also flagged, using a fixed-point loop so the flag reaches dependents-of-dependents too. The visible addon's own "Update Addon" button then syncs it as usual, which (via the dependency-staleness check in `syncAddon`) picks up the library update along the way. "Update All Addons" skips library entries directly for the same reason — updating the visible addon(s) that depend on them already covers it.

---

## How Sync Works

`syncAddon(repoId, addonId, options)` is the single entry point for getting an addon's notes to
match its manifest — a genuine first install, a version update, and TAM updating *itself* are all
the same call, differing only where they structurally must (see below). This used to be three
separate functions (`installAddon`/`updateAddon`/`selfUpdateAddon`) because note resolution used to
require deleting everything first to guarantee a clean slate; find-or-create by `#TAMFILEID` removes
that requirement, so nothing is ever deleted-then-recreated as part of an ordinary sync anymore.

1. TAM fetches the addon's manifest (`{repoId}.json` from the GitHub release).
2. `collectPendingPrompts` snapshots any `promptOnUpdate` content diffs against what's currently persisted, before anything else touches note content (see [`promptOnUpdate`](#promptonupdate)).
3. Each declared dependency is synced only if it's missing entirely or stale (older `installedVersion` than the dependency's own `latestVersion`) — an already-installed, up-to-date dependency is left untouched. Its `exports` map is read straight from its own stored `manifest` (no network fetch needed unless it's actually being synced right now).
4. Notes are resolved (`resolveNotes`) in topological order: for each, TAM looks up its `#TAMFILEID` — if found (and not soft-deleted — `note.deleteNote()` is a soft delete, and a deleted match is always treated as "not found," so a deleted note is never resurrected/cloned back in), the existing note is cloned into the correct parent and its content/type/mime overwritten *unless* `skipOnUpdate`/`promptOnUpdate` say otherwise, or it's the target of an `AddonData:` relation (see [Persistence](#persistence)); if not found, a fresh note is created and immediately tagged. A local note listed under more than one parent (a same-addon clone) only goes through this step once, under whichever `children[]` entry appears first — every later entry just clones the same resolved note into that additional parent. TAM's own root note is a special case: it lives wherever the user manually ZIP-imported it (an *ancestor* of the Addons tree, not a sibling under it), so `resolveNotes` never touches its parent, and TAM's own untagged notes are bridged to `#TAMFILEID` first via a one-time title-matching traversal (`tagUntaggedSelfNotes`) so this step always finds them rather than trying to create them.
5. `reconcileNoteParenting` ensures every note is cloned into every parent its manifest currently declares, and detached from any parent it's no longer declared under — scoped to only ever detach a branch *this same addon's own* manifest created (checked via that stale parent's own `#TAMFILEID` prefix), so it can never rip out a clone another addon's `applyDepChildren` placed there, or one a user made by hand.
6. Cross-addon children/relations are resolved live the same way, through the dependency's `exports` map (see [Exports](#exports)).
7. Labels/relations are (re)applied. Both are disable-state aware: if the addon is currently disabled, its activation labels/relations live under a `disabled:` prefix, and reapplying writes there instead of creating a live-named duplicate that would silently re-enable just that one label/relation. (Confirmed non-hypothetical: TAM's own manifest declares `renderNote` as a relation, which is in the activation list.) A trailing `(inheritable)` suffix on a label name (e.g. `iconClass(inheritable)`) sets a real `isInheritable` attribute instead of literally creating one named that.
8. `pruneRemovedNotes` deletes any live note tagged `#TAMFILEID` under this addon's prefix whose local id is no longer in the *current* manifest's note list — a note an author intentionally removed in a newer version actually disappears, rather than orphaning forever.
9. The Database record is updated: merged in place (never resetting `manuallyInstalled`/`enabled`/`persistence`) if the addon was already installed, or written fresh only for a genuine first-time install. `updateAvailable` is explicitly cleared on the merge path (there's no more full-object replacement to clear it as a side effect).
10. Persistence is (re)connected — see [Persistence](#persistence). Runs unconditionally, so a newly-added `AddonData:` relation in a later manifest version gets picked up on an already-installed addon's next sync.
11. A brand-new (non-self) install is left disabled; an already-installed addon's `enabled` state is never touched.

A re-entrancy guard (a `Set` of `repoId::addonId` keys threaded through the whole call graph) stops an addon from being synced twice in one top-level call — this comes up with diamond dependencies. There is no cascade to a dependent when its dependency is updated: since dependencies resolve in place (the real note id a dependent's clone points at never changes across an ordinary version bump), there's nothing for a dependent's existing clones to break, unlike the old delete+reinstall design. The one narrow, pre-existing gap this leaves: if a dependency *removes* a previously-exported note (via `pruneRemovedNotes`) while a dependent still holds a clone of it, that dependent isn't automatically resynced — `applyDepChildren`'s `resolveDepNoteId` already just silently skips a vanished export today, cascade or no cascade, so this isn't a new regression, just a limitation worth knowing about.

**Update All Addons:** the "Update All Addons" button (shown whenever at least one installed addon has an update available) calls `syncAddon` for every out-of-date addon in sequence — TAM itself included, no special-casing needed. If any of the synced addons have pending `promptOnUpdate` prompts, the Update Review screen is shown once per addon, one after another, until the queue is empty.

---

## Repair

The **Repair** button (per addon) runs `libTAMjs.repairAddon(repoId, addonId)` — a purely offline
structural reconciliation against the addon's own **locally stored** manifest, never a network
fetch. It fixes missing/stale parent-child branches, labels, and relations, but:

- **Never touches note content.** There's nothing to repair *to* for content without a network
  fetch, and unlike `syncAddon`, repair has no legitimate "new" content to apply — it only restores
  structure that should already be there.
- **Never creates a note that's been fully deleted.** With no content available locally to rebuild
  it, a fully-missing note is reported as an issue instead (`"note 'x' is missing and can't be
  repaired offline — use Update instead"`), using the same `{ repoId, addonId, message }` shape as
  `validateDatabase`, shown in the same dismissible panel.
- Reuses `reconcileNoteParenting`/`applyDepChildren`/`applyLabels`/`applyRelations` — the exact same
  logic `syncAddon` uses for structure, just fed the stored manifest and never allowed to create or
  touch content.

Use this when something's structurally drifted (a manual note move, a clone that got broken) but you
don't want to risk pulling in an upstream update, or don't have network access. Use **Update** when
a note has actually been deleted, or you want the latest version.

---

## Validating the Database

The **Validate Database** button runs `libTAMjs.validateDatabase()`, which audits every installed addon against the live Trilium note tree and reports anything inconsistent — read-only, never fixes anything (use [Repair](#repair) or Update for that):

- **Duplicate `#TAMFILEID`s** — no two live notes claim the same `{addonId}/{localId}` value. This is the one thing a live-lookup-based design can't self-correct (`getNoteWithLabel` just returns whichever match it finds first), so it's the one thing worth actively checking for — a bad migration run or a manually duplicated note are the realistic causes.
- **Missing dependency** — a declared `manifest.dependencies` entry that isn't actually installed. (There's no dependent-symmetry check anymore — `dependents` is computed on demand, never stored, so it can't go out of sync with anything.)
- **Note existence** — the stored `manifest.root`/`manifest.settingsNote` local ids still resolve to real, non-deleted notes, checked only while the addon is actually installed.
- **Persistence integrity** — the record's `persistence.rootNote` and every `persistence.persistenceNotes` entry still exist, and (for addons that are actually installed) every live `AddonData:key` relation found while walking the addon's subtree still points at the persisted note TAM's database says it should. This check runs even for records with no currently-installed addon, since surviving persisted data should stay valid regardless.

It returns a flat list of `{ repoId, addonId, message }` issues (empty if everything checks out), which the UI renders as a dismissible panel.

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

Persistence data lives nested under the same `database.installedAddons[repoId][addonId]` record as everything else TAM tracks about that addon (`persistence: { rootNote, persistenceNotes, pendingPrompts }`) — there is no separate top-level tree to keep in sync with it. `installedVersion`/`manifest`/etc. describe the *currently installed* state and disappear on uninstall; `persistence` is the one part of the record that's allowed to outlive it.

**A persisted note's content is always protected from `resolveNotes`' content-overwrite, regardless of `skipOnUpdate`/`promptOnUpdate`.** `api.duplicateSubtree` (used below to create the persisted copy) copies every attribute from the original — including its `#TAMFILEID` label — so once the original is deleted, the persisted copy becomes the only note left carrying that tag. Without this protection, the next sync's TAMFILEID lookup would find the persisted copy, clone it back into the addon's tree, and overwrite its content with the manifest's shipped default, destroying the user's actual saved data. `resolveNotes` checks every manifest note against the set of `AddonData:`-relation targets and skips the content overwrite unconditionally for any match.

When an addon is first installed:
1. TAM scans the addon's note subtree for any `AddonData:key` relations.
2. For each one found, TAM duplicates the target note into the **Addon Data** tree, under a per-addon folder — created **just in time**, the first time this addon actually has something to persist. An addon with no `AddonData:` relations at all never gets a folder under Addon Data, and its record carries no `persistence` field at all.
3. The `AddonData:key` relation on the addon note is updated to point to the persisted copy instead of the original.
4. The mapping `key → persistedNoteId` is saved into the addon's own `persistence.persistenceNotes`.

On reinstall after an update:
1. TAM finds the existing persistence mapping already on the addon's record.
2. Instead of duplicating again, the relation is rewired to point to the already-existing persisted note.
3. User data is preserved unchanged.

Notes in the persistence tree are never deleted by TAM (even if the addon is uninstalled), ensuring data is not accidentally lost — `deleteAddon` deletes the addon's own note tree and every *installed*-state field, but if the record has any surviving `persistence` data (a `rootNote` or a non-empty `persistenceNotes`), it keeps a reduced record containing just that `persistence` sub-object rather than removing the entry outright. A later reinstall of that same addonId picks the surviving data back up automatically (see [How Sync Works](#how-sync-works)). The one exception is the per-addon *folder* itself: if it ends up with zero children (nothing to persist, or everything that was persisted is gone), TAM deletes the empty folder and clears the `rootNote` reference — checked for the addon just installed/updated every time `connectAddonPersistence` runs, and swept across every installed addon by `cleanupEmptyPersistenceRoots` whenever "Update Repositories" is clicked (this is what retroactively cleans up addons that got an empty folder before persistence roots were made just-in-time). If that sweep empties out a record that also has no installed state and no pending prompts, the whole record is dropped.

---

## `skipOnUpdate`

Set `"skipOnUpdate": true` on any note whose content should never be overwritten during an update. Typical uses:

- **Database / settings notes** — the user fills these in after installation; an update must not reset them.
- **Root render notes** — structural notes whose content is not meaningful (empty or a stub).

During a sync, `resolveNotes` skips content writes for any found note with `skipOnUpdate: true` — see [How Sync Works](#how-sync-works).

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
4. TAM will detect any of its own notes not yet carrying a `#TAMFILEID` label (a manual import has none yet) and handle syncs correctly regardless — see [How Sync Works](#how-sync-works).
5. Add `BeatLink/trilium-scripts` as a repository and click "Update Repositories" to populate the addon list.
