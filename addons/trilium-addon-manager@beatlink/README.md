# Trilium Addon Manager (TAM)

![Screenshot](./image.png)

Browse available addons at **https://beatlink.github.io/trilium-scripts/**

> ⚠️ **Work in progress.** TAM's manifest format and its Database/persistence model are under
> active development and changing frequently. Data loss is possible. Install this to test and
> explore only — do not use it to manage real/production Trilium data yet.
>
> **7.0.0 breaks in-place updates from 6.x.** Addons are now installed from published manifests (see
> [Publishing](#publishing)); the raw manifests a 6.x install points at no longer carry absolute
> URLs, which a 6.x client cannot resolve. Reinstall TAM from the
> [latest release](https://github.com/BeatLink/trilium-scripts/releases/latest) ZIP — every note is
> re-adopted by its `#TAMFILEID`, so nothing is duplicated and persisted data is untouched — and
> the new install points at the published catalog from then on.

## Overview

Trilium Addon Manager (TAM) is a widget-based addon installer for [TriliumNext Notes](https://github.com/TriliumNext/Notes). It lets you install, update, enable, disable, and remove addons from any manifest URL — a single addon directly, or a whole catalog of them — without leaving Trilium. Addons are described by a `_tam_manifest_.json` file that tells TAM what notes to create, how to wire them together, and how to handle updates. An addon's files don't need to live anywhere near its manifest — each note's own `sourceUrl` can point anywhere on the web, so an addon can be composed entirely from files hosted in someone else's repository.

---

## Architecture

TAM is itself an addon. Once installed, its note tree looks like this:

```
trilium-addon-manager@beatlink  (render note)
├── Database  (JSON code note)
│   ├── Addons  (text note — global addon-root anchor)
│   │   └── <Addon Name>  (TAM-owned root — titled/`#iconClass`-tagged after the addon; every
│   │                       note the manifest attaches via the "root" parent keyword nests here)
│   └── Addon Data  (JSON code note — global persistence anchor)
│       └── <Addon Name>  (TAM-owned persistence root — every note the manifest attaches via the
│                           "persistence" parent keyword nests here)
└── Source Code  (JSX render script)
    ├── TAM.jsx  (the entire frontend widget in one file — see below)
    │   └── lib-tam.js  (the entire backend/data layer in one file)
    │       └── marked.min.js  (vendored markdown renderer)
    └── TAM.css  (appCss stylesheet)
```

TAM is deliberately just a handful of source files — `TAM.jsx` (frontend) and `lib-tam.js`
(backend/data), plus the vendored `marked.min.js`. Each file is
organized into clearly-bannered sections (former `TAMShared`/`TAMListViews`/`TAMDetailAndSettings`/
`TAMDialogs`/`TAMCommands` inside `TAM.jsx`; former `Network`/`Catalog`/`ManifestUtils`/`NoteResolver`/
`Sync`/`Persistence`/`Uninstall`/`Lifecycle`/`libTAMDatabase` inside `lib-tam.js`) rather than
separate notes.

**Relations wired at install time:**

| From | Relation | To |
|------|----------|----|
| `trilium-addon-manager@beatlink` | `renderNote` | `TAM.jsx` |
| `TAM.jsx` | `displayNote` | `trilium-addon-manager@beatlink` |
| `lib-tam.js` | `database` | `Database` |
| `lib-tam.js` | `addonRoot` | `Addons` |
| `lib-tam.js` | `addonPersistence` | `Addon Data` |

### Key notes

- **Database** — a JSON code note that holds all TAM state: the list of added catalog URLs and, per addon, a single merged record covering its installed state, own manifest structure, and pending update prompts (see [The Database Record](#the-database-record) and [Persistence](#persistence)). TAM reads and writes this note on every operation.
- **Addons** — the global anchor under which every addon gets its own TAM-owned root note (titled, `#addonId`-tagged, and `#iconClass`-tagged after the addon), created on first sync via `ensureAddonAnchor`. An addon's manifest never declares or reparents this note itself — it only ever attaches notes to it via the reserved `"root"` parent keyword in `children[]` (see [`children`](#children)). TAM's own manifest is the one exception, since it bootstraps via a manual ZIP import before any TAM code can run to synthesize one for it — see [`root`](#root-tam-only).
- **Addon Data** — the global anchor under which every addon gets its own TAM-owned persistence root (same naming/tagging), attached to the same way via the reserved `"persistence"` parent keyword. Kept safe from uninstall/prune sweeps alongside the persistent notes it holds (see [Persistence](#persistence)).
- **lib-tam.js** — TAM's whole backend/data layer in one `require()`d note (its public surface is
  available globally as `libTAMjs`). It runs in the browser but uses `api.runOnBackend`/
  `api.runAsyncOnBackendWithManualTransactionHandling` for operations that need backend access
  (fetching URLs, creating notes, modifying note content). It owns the
  `database`/`addonRoot`/`addonPersistence` `currentNote`-bound lookups itself (their relations are
  declared `"from"` this note) — everything else receives an id as a parameter instead. Its
  `loadDatabase`/`saveDatabase` read and write the Database note directly.
- **Source Code** — a plain empty parent note, existing only to group the actual widget code and its
  own children under a clearly-labeled branch of the tree (same shape as any note wrapping multiple
  env variants — see CLAUDE.md's "JS/JSX code note mime" section).
- **TAM.jsx** — the Preact/JSX render widget, nested under **Source Code**, containing the entire
  frontend in one file. Its root component (`RepoManager`, the default export) owns UI-navigation/
  dialog state and the one other `currentNote`-bound read (`displayNote`); the sections above it hold
  the presentational primitives, list/catalog/detail/settings/dialog views, and the data/command
  layer (`useTamCommands`), which in turn calls `lib-tam.js` (`libTAMjs`).

### The UI

TAM's own widget is a self-contained Preact app (`TAM.jsx`), styled to match the
GitHub Pages catalog (`resources/docs/`) — same card grid, type badges, search/filter toolbar, and sidebar
detail layout — while still adapting to Trilium's light/dark theme via its own CSS custom properties
for surfaces and text. It has **no addon dependencies of its own** (`dependencies: []` in its own
manifest) — everything below is built directly against `trilium:preact`'s built-in components rather
than a shared library like `libsettings@beatlink`, since a dependency failure in the addon manager
itself would risk taking down the one thing that could otherwise fix it.

- **List view** (default) — a searchable, filterable card grid of every installed addon (libraries
  excluded — see [Hidden libraries](#hidden-libraries-and-update-propagation)) merged with every
  not-yet-installed addon from every added catalog (fetched live and deduped by id against what's
  already installed), so it shows everything available across every added catalog plus anything
  manually installed by URL, not just what's already on disk. Clicking an installed card opens its
  detail view; clicking a not-yet-installed one shows an **Install** button.
- **Catalog browse view** — fetches a specific catalog's `tam-addons[]` list and every manifest it
  points at, fresh, every time (nothing about a catalog's contents is ever cached — see
  [The Database Record](#the-database-record)). Not-yet-installed entries show an **Install** button;
  already-installed ones open the normal detail view instead. Reached via the **Browse** button on
  that catalog's row in the Settings view, not from the main list.
- **Addon detail view** — one page per addon (mirroring `resources/docs/{addon-id}/index.html`): a sticky
  sidebar with the addon's metadata table and full action set (Home Page, Install/Delete,
  Enable/Disable, Settings, Update), and a main panel with the description and — for
  installed addons that declare a `readmeNote` — the addon's own README rendered from its locally
  installed note (see [`readmeNote`](#readmenote-optional)), no network fetch required.
- **Settings view** — TAM's own housekeeping page, built manually (no `libsettings@beatlink`
  dependency): a stats overview (catalog count, installed addon count, addons with saved/persisted
  data, addons with an update available), catalog management (each catalog's row has **Browse**,
  **Visit Website**, and **Delete** actions, plus adding a new catalog by URL), a single-addon
  "install by URL" action, and maintenance triggers (Check for Updates, Update All Addons, Validate
  Database, Clean Up Empty Persistence Roots).

---

## Dependency graph

The **GitHub Pages catalog** (`resources/docs/`) renders a [Mermaid](https://mermaid.js.org/) flowchart of the
dependency edges between addons (every addon's `manifest.dependencies`): a collapsible whole-catalog
graph on the index page, and a focused per-addon subgraph (the addon plus its transitive dependencies
and dependents) on each addon's detail page. Built at generate time by `tamhelper.js generate-pages`
(`buildDepGraph` + `mermaidBody`/`mermaidForAddon`) and rendered client-side by the Mermaid ESM
build loaded from a CDN in `base.html`, only on pages that actually contain a diagram. Arrows point
from an addon to what it depends on; nodes are coloured by the type palette as the catalog badges
(`TYPE_COLORS`).

The in-Trilium TAM widget does not render dependency graphs.

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
- **Always read it with the *owned* accessors.** ⚠️ Writing the label non-inheritably is **not**
  enough to stop it propagating. Trilium's `~template` relation is a second, independent inheritance
  path: an instance inherits **all** of its template's labels regardless of `isInheritable`. So if a
  TAM-owned note is itself a `#template` (TAM ships several: `tpl-area`, `tpl-note`, `tpl-task`, …),
  then **every user note templated from it reports that template's `#TAMFILEID` as its own**.

  Consequently `note.getLabelValue("TAMFILEID")` and `note.hasLabel(...)` resolve inherited values
  and will claim ownership of user notes TAM never created. Every ownership check must use
  `getOwnedLabelValue` / `hasOwnedLabel` / `getOwnedAttributes` instead. Note that
  `api.getNotesWithLabel("TAMFILEID")` *also* returns template instances — the scan is only safe
  once each hit is re-checked with an owned accessor:

  ```js
  for (const note of api.getNotesWithLabel(tamFileIdLabel)) {
      if (note.isDeleted) continue
      const value = note.getOwnedLabelValue(tamFileIdLabel)  // NOT getLabelValue
      if (!value) continue                                   // inherited-only: not ours
      // ...
  }
  ```

  This matters most in the prune/sweep paths, where the value gates a `note.deleteNote()` — itself a
  **cascade** that takes the note's entire subtree. Getting this wrong deletes user data at scale: a
  single manifest change that drops a template's local id will otherwise delete every note templated
  from it. This is not hypothetical — it is the cause of the mass-deletion regression fixed in
  6.3.1.
- **Nothing about note identity is cached in the Database at all** — not `rootNoteId`, not
  `settingsNoteId`. Instead, each installed addon's Database record stores its own **manifest
  structure** (see [The Database Record](#the-database-record) below) — `rootNoteId` is derived on
  demand via a `#TAMFILEID` lookup for the addon's TAM-owned root anchor (the reserved local id
  `__tamAddonRoot__`, or the stored `manifest.root` for TAM's own self-bootstrap record), and
  `settingsNoteId` from `manifest.settingsNote` the same way, wherever they're needed
  (`enableAddon`, `deleteAddon`, the addon list UI — batched into one backend round trip there).
  Keeping them "as a cache" would have reintroduced exactly the drift risk this convention exists
  to remove.
- **Soft deletes are accounted for.** `note.deleteNote()` is a soft delete (`note.isDeleted`), so
  every TAMFILEID lookup treats a deleted match as "not found" rather than resurrecting/cloning a
  note that's on its way out.
- **Persisted user data is separated by placement, not by tag.** A note holding user data is an
  ordinary `#TAMFILEID` note, but it's attached under the reserved `"persistence"` parent keyword
  and resolved under the shared **Addon Data** anchor, which no uninstall/prune sweep ever touches.
  See [Persistence](#persistence).

### `#TAMSOURCEURL`: one note per URL, shared across addons

Alongside `#TAMFILEID`, every resolved note carries `#TAMSOURCEURL` with the URL its content came
from — its published `sourceId`, which tracks the branch, rather than the commit-pinned `sourceUrl`
it was fetched from, since a pinned URL is a different string every publish and would match nothing
(see [Publishing](#publishing)) — and `resolveNotes` uses it as a second lookup: a note that doesn't exist yet under *this*
addon's `#TAMFILEID`, but whose `sourceUrl` already exists somewhere, is **cloned into place rather
than copied**. Two addons vendoring the same library file therefore share one note in the database,
which is what keeps a shared library from being duplicated N times.

The consequence is an authoring rule worth stating outright:

> A note shared by `sourceUrl` may not carry per-addon labels or relations.

Only the first addon to install it gets its `#TAMFILEID` — every later addon's
`resolveStoredNoteId` for that local id returns nothing — and the manifest `relations` of *every*
addon declaring it are applied to the same note, so the last sync wins. A pure library module (no
attributes of its own, everything passed in by its caller) shares perfectly; anything that needs to
know which addon it belongs to must ship as that addon's own file, at its own URL. Uninstall is
already safe either way: `detachAddonOwnedBranches` only detaches a shared note from the departing
addon's parents, and deletes it only once nothing else parents it.

---

## Publishing

A manifest is written in one form and installed in another.

A **source manifest** (`addons/{id}/_tam_manifest_.json`) is the hand-authored one: it names each
note's file by a path relative to itself and carries no URLs of its own. `tamhelper.js publish`
turns every source manifest into a **published manifest**, deployed to the catalog site at
`https://beatlink.github.io/trilium-scripts/{id}/_tam_manifest_.json`, which is what TAM actually
fetches and installs from. Publishing does three things:

1. **Resolves every relative `sourceUrl`** against one commit —
   `raw.githubusercontent.com/{owner}/{repo}/{sha}/...`. A published URL therefore never moves, and
   never serves a stale cached copy the way a `refs/heads/main` URL does. Each note also gets a
   `sourceId`: the same file's branch-tracking URL, which is what note sharing is matched on (see
   [`#TAMSOURCEURL`](#tamsourceurl-one-note-per-url-shared-across-addons)) precisely because it does
   *not* change every publish.
2. **Hashes every file**, as a `sha` per note and one `contentHash` over the manifest as a whole.
3. **Writes `catalog.json`**, the list of every published manifest URL (see
   [Catalog Format](#catalog-format)).

It is deliberately offline and deterministic: only files on disk are hashed, and the same commit
always publishes byte-identically. A `sourceUrl` that was already absolute in the source manifest
points at someone else's repo, so it is carried through untouched and contributes its URL rather
than its content to the hash — fetching it here would make the same commit publish differently
depending on what upstream did that day. Such a note has no `sha`, so it simply refetches on every
sync, as everything did before hashes existed.

`contentHash` covers the manifest with each note's `sourceUrl` replaced by that note's `sha`, so it
tracks content and structure and **not** the commit the URLs happen to be pinned to — otherwise
every addon would report an update on every push.

### What the hashes are for

**Detecting updates without a version bump.** `checkForAddonUpdates` compares the fetched
`contentHash` against the one recorded at the last sync: any change to any file, or to the manifest's
structure, is an available update on its own. `latestVersion` is still declared, still shown, and
still the fallback comparison for a manifest carrying no hash (a hand-authored one, or an install
predating this) — but shipping a fix no longer depends on remembering to bump it.

**Not refetching what hasn't changed.** A sync used to fetch every file in the manifest whether or
not anything had moved. Now a note whose incoming `sha` matches the one recorded at the last sync is
skipped entirely — no fetch, no content write — so changing one file in a 25-note addon costs one
request instead of 25. Its title, type and mime still track the manifest, so a rename with no content
change still applies. A note whose fetch failed is left out of the recorded hashes, so the next sync
retries it rather than reading it as already current.

**Asking about a persistent note only when the shipped side moved.** A persistent note whose
upstream default is unchanged raises no Update Review entry, even if the user has edited theirs —
the same rule the per-setting review already followed (see
[per-setting review](#per-setting-review-manifestsettings)).

---

## The `_tam_manifest_.json` Format

Every TAM addon needs a `_tam_manifest_.json`. In this repo it lives at `addons/{id}/_tam_manifest_.json`
by convention, but nothing about that folder layout is actually required — TAM never discovers an
addon by filesystem position, only by fetching whatever URL it's given (see `manifestSourceUrl`
below), so an addon's manifest and its source files can live anywhere on the web.

### Top-level fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique addon identifier. Format: `addon-name@author`. No spaces. |
| `name` | Yes | Human-friendly display name. |
| `description` | Yes | Short description shown in the TAM UI and on the catalog website. |
| `author` | Yes | GitHub username of the author. |
| `homepage` | Yes | URL to the addon's GitHub page. Purely a human-facing link (TAM's "Home Page" button) — never used by any install/fetch logic. |
| `license` | Yes | SPDX license identifier (e.g., `GPL-3.0-or-later`). |
| `latestVersion` | Yes | Current version string. Follows semver. Incrementing this triggers an update prompt in TAM. |
| `type` | Yes | Addon category. One of: `widget`, `theme`, `css`, `script`, `library`. Used for display only. |
| `manifestSourceUrl` | No¹ | A URL where this exact manifest document can always be fetched from. Written by `publish`; see [Publishing](#publishing). |
| `contentHash` | — | *Published manifests only.* A hash over the manifest's structure and every note's content — what TAM compares to detect an update. Never hand-authored. |
| `readme` | No | Relative path to the README file for the catalog website (e.g., `README.md`). |
| `manifest` | No | The note-tree manifest (see below). Omit for metadata-only entries. |

¹ A source manifest in this repo carries it anyway, pointing at where `publish` serves that same
addon (`validate` errors if the two disagree), so an install that refetches the raw source manifest
is told where the published one lives and moves itself over on its next sync.

#### `manifestSourceUrl`

The single field that makes an addon installable/updatable by TAM at all. For an addon living in
this repo it is its published manifest's URL on the catalog site,
`https://beatlink.github.io/trilium-scripts/{id}/_tam_manifest_.json`, which `publish` writes and
`validate` enforces — nobody types it. Hand-author it only for a manifest that deliberately doesn't
live in this repo's own tree and is published somewhere else.

TAM's Database stores this value verbatim on the addon's own installed-record, exactly as read from
whichever manifest was fetched — TAM never computes or guesses it. It's what `checkForAddonUpdates`
re-fetches to check for a newer version, and what a catalog's `tam-addons[]` list is made of (see
[Catalog Format](#catalog-format)).

### `manifest` sub-object

```json
{
  "manifest": {
    "notes": [...],
    "children": [...],
    "relations": [...],
    "labels": [...],
    "dependencies": [...],
    "exports": {...},
    "settings": {...},
    "hooks": {...}
  }
}
```

An addon's manifest never declares its own root note. TAM alone creates and owns it — titled after
the addon, `#iconClass = bx bx-customize` (TAM's own icon; any per-addon `iconClass` a manifest
puts on the note it attaches directly to `"root"` is not read for this purpose), never present in
`notes[]`. The only way a manifest references it is the reserved `"root"` string as a `parent`
value in `children[]` (see [`children`](#children)) — "attach this note directly under the addon's
TAM-owned root." The same applies to the persistence anchor via the reserved `"persistence"` parent
keyword — see [Persistence](#persistence).

#### `root` *(TAM only)*

The one exception: `trilium-addon-manager@beatlink`'s own manifest still declares a real `root`
note, the local ID of the note the user manually ZIP-imports to bootstrap TAM in the first place.
Nothing else can synthesize an anchor for TAM before TAM exists to do it. No other addon's manifest
should ever set this field — `validate` doesn't require it, and `tam_to_zip`/live sync both treat
its absence as "TAM synthesizes the root," which is what every addon but TAM wants.

#### `settingsNote` *(optional)*

The local ID of the note TAM's UI should navigate to for this addon's settings screen. If present,
it's stored as-is in the addon's own `manifest.settingsNote` (see [The Database Record](#the-database-record))
and resolved to a real note ID live, via `#TAMFILEID`, whenever the UI needs it. TAM's UI then shows a
**Settings** button on that addon's row which activates (navigates to) that note. **Point this at a
`render`-type note, not at the raw JSX note itself** — activating a JSX code note directly opens its
source instead of the rendered UI. See `cinnamon-applet-agenda@beatlink`/`cinnamon-applet-inbox@beatlink`,
where `settingsNote` points at a `launcher` note (attached directly under the reserved `"root"`
parent) that in turn has a `renderNote` relation to the actual settings JSX — so the same note opens
whether you click the addon's root in the tree or the Settings button in TAM.

#### `"persistence"` parent keyword

Notes that must survive updates and uninstalls (user settings, cached data, customized content)
are attached under the reserved `"persistence"` parent keyword in `children[]`, the same way
`"root"` works for the structural tree. See [Persistence](#persistence) for the full behaviour.

#### `settings` *(optional)*

Names the notes that make up a [libsettings](../../libs/libsettings/README.md)-style settings set,
so TAM reviews the addon's settings **per setting** on update instead of diffing the config note as
a wall of JSON:

```json
"settings": {
  "schema": "schema",
  "defaults": "defaults",
  "config": "config"
}
```

* `schema` is the local ID of the addon's `schema.json` — **structural**, so every update replaces
  it and ships whatever the field set has become. It describes fields only; it carries no values.
* `defaults` is the local ID of its `defaults.json` — also **structural**, and the source every
  setting's shipped value now lives in. It must ship content (`sourceUrl` or `content`).
* `config` is the local ID of its `config.json` — attached under the reserved `"persistence"` parent,
  so it holds the user's answers and is never overwritten. It must ship **no content of its own**
  (`"sourceUrl": null`, no `content`); TAM creates it empty, which libsettings reads as `{}`.

The config note must also carry a `{"from": "config", "type": "sourceConfig", "to": "defaults"}`
relation — that is what puts the defaults note underneath it in libsettings' source chain, and what
TAM itself walks to find the shipped values. `validate` enforces all of this.

Declaring it changes three things, all described under
[per-setting review](#per-setting-review-manifestsettings): the config note stops being whole-file
diffed, TAM adopts changed defaults the user never diverged from without asking, and anything left
over becomes one Update Review entry with a Keep Mine / Use New Default choice per setting.

An addon that stores settings some other way simply leaves this out, and nothing changes for it.

#### `hooks` *(optional)*

Lifecycle scripts TAM runs on this addon's behalf at four points it can't otherwise reach:

```json
"hooks": {
  "postInstall":  "hook-install",
  "postUpdate":   "hook-update",
  "updateReview": "hook-review",
  "preUninstall": "hook-uninstall"
}
```

Each value is the local ID of a **structural** note (never one under `"persistence"` — hook code has
to be replaced on update like any other code) that is a **frontend** script: `text/jsx` or
`application/javascript;env=frontend`. `validate` enforces both. Backend work is still reachable from
inside a hook through its own `api.runOnBackend`.

TAM executes a hook with `FNote.executeScript()`, which takes no arguments and only hands back a
return value for a frontend note — hence the frontend-only rule. Context is passed in on a temporary
`#tamHookContext` label (JSON), written immediately before the call and removed immediately after:

```js
const ctx = JSON.parse(api.startNote.getLabelValue("tamHookContext"))
// { addonId, phase, previousVersion, newVersion }  — or, for preUninstall,
// { addonId, phase, version, deleteData }
```

`executeScript()` is independent of the `#run` labels TAM's enable/disable system toggles, so **a
hook runs even when its addon is disabled** — which `postInstall` (a fresh install is always left
disabled) and `preUninstall` both depend on. This is a deliberate exception to "disabled means none
of this addon's code runs."

A hook that throws is caught by Trilium's own bundle error handling — the user gets Trilium's
script-error toast, and the call comes back to TAM as `undefined`, which TAM logs and moves past. A
hook never aborts, and can never roll back, the operation that triggered it: there is no transaction
around any of this, so a hook that fails halfway leaves whatever it already wrote in place.

| Phase | When | Return value |
|-------|------|--------------|
| `postInstall` | After a first install completes, with the addon still disabled. | ignored |
| `postUpdate` | After an update's notes are resolved and the record is bumped. Non-interactive migrations belong here. | ignored |
| `updateReview` | Twice: `phase: "collect"` right after `postUpdate`, then `phase: "apply"` once the user submits the Update Review screen. | see below |
| `preUninstall` | Before anything is torn down, while every note the addon owns still exists. Read-only by contract — TAM asks the user about deleting stored data itself and reports the answer as `deleteData`. | ignored |

**`updateReview`** replaces TAM's built-in whole-file diff with per-item review (see
[`promptOnUpdate`](#promptonupdate)). On `collect` it returns the same shape TAM's own producer
does, except each entry carries `items[]` instead of two content blobs:

```js
return [{
    noteLocalId: "config",           // any stable key; groups the items under one heading
    title: "Agenda Configuration",
    items: [
        { key: "dimensions.area", label: "Area dimension", current: {...}, incoming: {...} }
    ]
}]
```

Returning `[]` means "nothing to review" and clears the built-in diff. Returning anything that isn't
an array (including a hook that threw) leaves the built-in diff in place as the fallback, so a broken
hook degrades to the old behaviour rather than losing the safety net. Non-string `current`/`incoming`
values are JSON-formatted for display.

On `apply`, TAM calls the same hook once per entry with the user's choices, and writes nothing
itself — only the addon knows what an item key means:

```js
// ctx = { addonId, phase: "apply", noteLocalId: "config", selections: { "dimensions.area": true } }
```

`true` means "use the new default" for that item; `false` means "keep mine".

Because `collect` runs *after* the sync, a hook reads its own updated code and any note the sync just
refreshed.

Reach for `updateReview` only for review TAM cannot do itself. Schema-driven settings do **not**
need it: declaring [`settings`](#settings-optional) gets the same per-item screen natively, without
a hook note, and the two compose — TAM appends its settings entry to whatever a hook returned rather
than replacing it.

#### `readmeNote` *(optional)*

The local ID of a note (typically `type: "code"`, `mime: "text/markdown"`, `sourceUrl` pointing at
the addon's own `README.md`) that ships as part of the addon's installed note tree, exactly parallel
to `settingsNote`. TAM's addon detail page resolves it live via `#TAMFILEID` and renders it
with `marked` — **no network fetch involved**, since the README is just another installed note, not
something fetched from GitHub at view time. Only available once the addon is actually installed —
browsing a catalog only ever fetches each addon's full manifest, never renders its README pre-install
— so an uninstalled addon's detail page links out to its GitHub homepage instead.

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
| `sourceUrl` | Where this note's actual content lives. In a **source** manifest it is a path relative to the manifest itself (`myWidget.jsx`, `../../libs/libsettings/libsettings-core.js`); `publish` rewrites it to an absolute URL pinned to one commit. A full `http(s)://` URL is left alone in both, for content hosted somewhere else entirely (e.g. an upstream project's own file instead of a vendored copy). TAM resolves whatever it finds against the URL the manifest was fetched from — exactly like an HTML `<base href>` — and fetches it fresh, backend-side, at install/update time; nothing is pre-inlined into any distribution artifact. |
| `sha` | *Published only.* The SHA-256 of that file's content. TAM skips both the fetch and the write for a note whose `sha` matches the one recorded at the last sync, and raises no update prompt for a persistent note whose shipped side hasn't moved. |
| `sourceId` | *Published only.* The same file's branch-tracking URL, and what `#TAMSOURCEURL` records. Sharing one note between two addons vendoring the same file is matched on this rather than on `sourceUrl`, which is pinned to a commit and so is a different string every publish. |
| `content` | An escape hatch: a literal inline content string, used directly (no fetch at all) if present. Mostly useful for hand-authored/special-case notes. |
| `skipOnUpdate` | If `true`, TAM never overwrites this note's content during updates. Use for user-configurable notes (settings, database). |
| `promptOnUpdate` | If `true`, TAM detects content changes during an update and prompts the user to choose between their current version and the new default. Use for notes users are expected to customize but that may receive meaningful upstream changes. |

#### `children`

Defines the parent-child tree structure. There are two forms:

**Local child** — the child note is in this manifest; the parent is either another local note or
one of the reserved anchor keywords, `"root"`/`"persistence"` (see [`root`](#root-tam-only) and
[`"persistence"` parent keyword](#persistence-parent-keyword)):
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

**Local relation** — both notes are in this manifest (unlike `children[]`, `from`/`to` here must
be real local ids — `"root"`/`"persistence"` are not valid targets):
```json
{"from": "launcher", "type": "renderNote", "to": "settings"}
```

A relation may cross the persistence boundary in either direction: a persistent note can point at a
structural one (`{"from": "template", "type": "renderNote", "to": "widget"}`) even though the
persistence pass runs first, because such a relation is deferred until every note has been resolved.

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

An array of addons that must be installed before this addon. Each entry is either a bare id string:
```json
"dependencies": ["libmultisort@beatlink"]
```
resolved by matching against whatever's already installed, or against the catalog the consuming
addon itself was installed from (this repo's own libraries all use this form — a monorepo catalog
naturally lists every addon it depends on too, so a sibling lookup always succeeds); or an explicit
object for a dependency that genuinely lives somewhere else entirely:
```json
"dependencies": [{"id": "lib-from-elsewhere@author", "manifestSourceUrl": "https://.../_tam_manifest_.json"}]
```

TAM recursively syncs all declared dependencies before syncing the addon itself. If a dependency is already installed but its `latestVersion` is newer than what's currently installed, TAM syncs it in place first — otherwise a dependency bump (e.g. a shared library's note getting renamed) would never reach an addon that already had the old version of that dependency installed, even via "Update All Addons" on the addon that actually changed. See [How Sync Works](#how-sync-works).

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

`database.installedAddons` is a **flat map keyed by `addonId` alone** — not nested under any
catalog/repository key, since an addon's identity is its own manifest `id`, independent of which
catalog (if any) it happened to be discovered through. `database.catalogs` is a plain array of added
catalog URLs — nothing about a catalog's *contents* is ever cached (see [Catalog Format](#catalog-format)),
so deleting a catalog from the browse list never touches anything already installed from it.

Every installed addon's entry in `database.installedAddons[addonId]` is:

```json
{
  "installedVersion": "1.2.3",
  "contentHash": "9f2c...",
  "noteHashes": { "widget": "3ab1...", "style": "c07e..." },
  "manifestSourceUrl": "https://beatlink.github.io/trilium-scripts/foo@bar/_tam_manifest_.json",
  "manuallyInstalled": true,
  "enabled": true,
  "meta": { "name": "...", "description": "...", "author": "...", "license": "...", "type": "...", "homepage": "..." },
  "manifest": { "settingsNote": "...", "readmeNote": "...", "settings": {...}, "hooks": {...}, "allowExternalReferences": false, "children": [...] },
  "persistence": { "pendingPrompts": [...], "settingsBaseline": {...} }
}
```

`manifest` is trimmed down to just the fields TAM still needs once the fetched manifest itself is
gone (`settingsNote`/`readmeNote`/`allowExternalReferences`, `hooks` for the uninstall/apply phases
that run without a fetched manifest in hand, plus `children[]` for walking `persistentLocalIds`) — see `stripManifestForStorage`. `root` is stored too, but only ever set for
TAM's own record (its self-bootstrap exception — see [`root`](#root-tam-only)); every other addon's
`manifest.root` is absent, and `rootNoteId` falls back to the reserved TAM-owned anchor local id
instead (see [Note Identity](#note-identity-tamfileid)). `notes[]`/`relations[]`/`labels[]`
aren't duplicated here since nothing ever reads them back from storage; they only drive a live
`resolveNotes` pass against a freshly fetched manifest. This is deliberately **not** "just re-fetch the
manifest whenever you need it": a `manifestSourceUrl` only ever serves the *current* version, so once a
newer one is published this is the only record of what's actually installed, and it means an upstream
manifest change never silently affects an addon until it's actually synced to that new version.

Only a handful of facts are genuinely irreducible and can't be derived from the manifest or the live
note tree:
- **`installedVersion`** — a manifest fetch always reflects the *latest* available version, never
  what's actually installed.
- **`contentHash`** / **`noteHashes`** — the published hashes of what is actually installed, for the
  same reason: the fetched manifest only ever describes what is current. `contentHash` is what an
  update check compares; `noteHashes` is what decides, per note, whether anything needs refetching.
  Left unset by a sync that skipped a note (its fetch failed), so the update check falls back to
  comparing versions until a clean sync records one. See [Publishing](#publishing).
- **`manifestSourceUrl`** — exactly which URL this install came from, read verbatim from the fetched
  manifest at sync time. Used to re-fetch for update checks.
- **`meta`** — a snapshot of the manifest's own top-level display fields (`name`/`description`/etc.)
  at sync time, needed to render the addon list/detail views without a live catalog to pull them from.
- **`manuallyInstalled`** — `true` if the user explicitly installed this addon; `false` if it was only
  ever pulled in as someone else's dependency. Pure user intent. Only ever *promotes* `false` → `true`,
  never the reverse.
- **`enabled`** — technically derivable (scan the root subtree for `disabled:`-prefixed activation
  labels), but cached here anyway since it's read on every addon-list render.

Everything else is read straight from the stored `manifest` (`dependencies`, `exports`) or derived on
demand: **`rootNoteId`** resolves via `#TAMFILEID` from `manifest.root` if set (TAM's own record
only) or else the reserved TAM-owned anchor local id; **`settingsNoteId`** resolves the same way
from `manifest.settingsNote`; **`dependents`** (who depends on *this* addon) is the reverse
of `dependencies`, computed by `getDependents(database, addonId)` scanning every other installed
addon's own record — nothing is pushed or maintained as edges change, so nothing can drift out of
sync. Used by `checkForAddonUpdates`'s update-propagation and `uninstallAddon`'s
cascade-uninstall-if-unused check.

`persistence` holds **`pendingPrompts`** — the update-review diffs collected during a
sync (plus any settings entry, and the item list an `updateReview` hook returned in their place),
cleared once the user applies them — and, for an addon declaring
[`settings`](#settings-optional), **`metadataBaseline`**: what the manifest declared about each
note's title, labels and relations at the last sync (see
[per-note metadata review](#per-note-metadata-review-titles-labels-and-relations)),
**`settingsBaseline`**: the merged read-only sources as of the last review,
which is what makes a per-setting review able to tell "the user chose this" from "this default moved
upstream" (see [per-setting review](#per-setting-review-manifestsettings)). The baseline lives here
rather than inside the user's own `config.json` because it is TAM's bookkeeping, not their data:
nothing in the addon has to know it exists, a settings save cannot drop it, and it is discarded with
the record on uninstall. The persistent *notes* themselves survive uninstall by living
under the Addon Data anchor, not by anything stored in this record — see [Persistence](#persistence).

### Hidden libraries, resolved lazily and rootlessly

Addons with `"type": "library"` are never shown in TAM's addon list — TAM installs, updates, and
uninstalls them automatically as a side effect of managing whatever depends on them. A library is
*never* installed on its own, so `syncAddon` never resolves one's whole manifest up front; dependency
resolution is entirely lazy and scoped, driven from whichever cross-addon `children[]`/`relations[]`
entry actually references it:

- **`ensureDependencyExport(depId, exportKey, parentRealId, ctx)`** is the whole mechanism. It looks
  up the export's local id in the dependency's manifest, then **`computeLocalClosure`** walks
  *outward* through the dependency's own `children[]`/local `relations[]` to find the transitive set
  of notes that export actually needs — nothing else in the dependency's manifest is touched. That
  closure is resolved via `resolveManifest` (the same pipeline a full addon install uses, just scoped)
  with the export note parented directly wherever the consumer needs it — **no addon-external anchor
  note anywhere**, since a dependency's notes only ever exist as clones under whichever consumer(s)
  pulled them in.
- A second consumer needing the same or overlapping export finds what was already resolved via
  `#TAMFILEID` and clones it in — there's no "which addon owns the master copy" question.
- A cross-addon reference within that closure (a library depending on another library) recurses into
  `ensureDependencyExport` one level deeper, with cycle protection (`ctx.resolvingExports`).
- Each dependency still gets its own `database.installedAddons[depId]` entry (`recordDependencyMeta`)
  with its full fetched manifest (not just the resolved closure — every lookup already tolerates "not
  found"), so update-checking and dependent-tracking work exactly as for a directly-installed addon.
  `pruneRemovedNotes` still runs on every resolution.
- **Known, deliberate gap:** the persistence pass and the enable/disable label-toggling machinery
  aren't wired into the lazy dependency path — both assume a single addon-owned root note whose
  subtree *is* the whole addon, which doesn't fit a partially-resolved closure. No current library in
  this repo attaches anything under the reserved `"persistence"` parent or needs independent
  enable/disable.

`deleteAddon` is branch-scoped, not a direct `note.deleteNote()` on the root: `detachAddonOwnedBranches`
scans every live `#TAMFILEID`-tagged note whose value starts with `{addonId}/` and detaches it from
each current parent unless that parent is tagged as belonging to a *different* addon. A note only
actually disappears once none of its parents are left — so a dependency still depended on by another
installed addon is provably safe to leave alone, not just probably safe, and this never depends on
assumptions about Trilium's own delete-cascade behavior toward a multi-parented note. Scanning the live
tree by tag (rather than walking `addonRecord.manifest.notes`, a stored snapshot from the last sync) is
what makes this self-healing: a note whose local id got removed from a later manifest version, but
whose removal was never picked up by a `pruneRemovedNotes` run on an in-between update, still gets
found here — cleanup no longer depends on the stored manifest matching what's actually in the tree.

**`sweepOrphanedNotes`** (Settings' "Sweep Orphaned Notes" button) is a separate, user-triggered
maintenance action — never run automatically — that deletes any `#TAMFILEID`-tagged note with zero
parents anywhere. Nothing in normal operation should ever produce one; it's a safety net for a partial
sync failure, not a routine cleanup step.

**`sweepInvalidAddonTreeNotes`** (Settings' "Sweep Invalid Addon Tree Notes" button) is another
user-triggered maintenance action, scoped to descendants of the global **Addons** root only (never
**Addon Data** — persisted user data must survive this). It deletes any note there with no
`#TAMFILEID` at all, or one whose addonId prefix doesn't match a currently-installed addon — e.g. a
stray manually-created note, or leftovers from an addon removed outside TAM's own uninstall flow.

---

## Catalog Format

A catalog is nothing more than a URL serving:

```json
{
  "webUrl": "https://.../",
  "tam-addons": ["https://.../addons/foo@bar/_tam_manifest_.json", "https://.../addons/baz@qux/_tam_manifest_.json"]
}
```

`tam-addons` is a flat array of `manifestSourceUrl`s, with no per-entry summary metadata at all.
`webUrl` is optional — a human-browsable website for the catalog (this repo's is its GitHub Pages
site) — fetched on demand (`fetchCatalogMeta`, a single lightweight request, no addon manifests
involved) for the "Visit Website" button in Settings' catalog list, and included "for free" as part of
the fuller `fetchCatalogAddons` fetch used to actually browse a catalog's addons.

TAM's "add catalog" action just remembers the URL; every time you actually *browse* that catalog
(`fetchCatalogAddons`), it re-fetches the list and then fetches every manifest on it, fresh — nothing
about a catalog's contents is ever cached, so there's no separate "refresh this catalog" action
needed, unlike the old per-repository `metadata.json` registry this replaced. This repo's own catalog
(`https://beatlink.github.io/trilium-scripts/catalog.json`) is written by `tamhelper.js publish`,
listing every manifest it published, and served via GitHub Pages alongside them — no GitHub Releases involvement at
all for the catalog or the install/update path; Releases are used purely for the `{id}.zip` exports
(see [Scripts Reference](#scripts-reference)).

You don't need a catalog at all to install a single addon — TAM's "install by URL" action
(`installByUrl`) fetches one manifest directly, discovers its own `id`, and installs it exactly like
any catalog-sourced install.

---

## How Sync Works

`syncAddon(addonId, options)` is the single entry point for getting an addon's notes to match its
manifest — a first install, a version update, and TAM updating *itself* are all the same call.
`options.manifestSourceUrl` is required for a fresh install and optional for an update (falls back to
the stored record). This used to be three separate functions (`installAddon`/`updateAddon`/
`selfUpdateAddon`) before find-or-create-by-`#TAMFILEID` removed the need to delete everything first
for a clean slate.

1. Fetch the addon's manifest from `manifestSourceUrl`, resolving any relative `sourceUrl` in it against that URL.
2. `collectPendingPrompts` snapshots any `promptOnUpdate` diffs against currently persisted content, before anything touches it (see [`promptOnUpdate`](#promptonupdate)).
3. `ensureAddonAnchor` find-or-creates this addon's own TAM-owned root anchor (under **Addons**) and, if its manifest attaches anything under the reserved `"persistence"` parent keyword, its own persistence anchor (under **Addon Data**) — titled, `#addonId`-tagged, and `#iconClass`-tagged after the addon, never something the addon's manifest declares itself. `resolveManifest` then resolves the addon's notes (`resolveNotes`, topological order) and walks `children[]`/`relations[]`, recursing into `ensureDependencyExport` for cross-addon references (see [Hidden libraries](#hidden-libraries-resolved-lazily-and-rootlessly)). A note whose declared parent is the reserved `"root"`/`"persistence"` keyword resolves directly under the matching anchor instead of another local note. Per note: found via `#TAMFILEID` (and not soft-deleted) → cloned into the correct parent, content/type/mime overwritten unless `skipOnUpdate` (or persistent placement) says otherwise; not found → created and tagged. Content is fetched fresh from `sourceUrl`, backend-side, through the same 429 retry-with-backoff wrapper every fetch in this file uses — skipped entirely for a note whose published `sha` matches the one recorded at the last sync (see [Publishing](#publishing)). A note's fetch failure is logged and it (and anything parented under it) is skipped, not fatal. TAM's own root note is the one structural special case — its manifest still declares a real `root` note (see [`root`](#root-tam-only)), which lives above the Addons tree (wherever it was manually ZIP-imported) and skips the per-addon anchor entirely, so its own parent is never touched. This step runs twice when the addon's manifest attaches anything under `"persistence"`: a **persistence pass** resolving that subtree under this addon's own persistence anchor first, then a **structural pass** resolving everything else under this addon's own root anchor — both writing into one shared note map so cross-anchor relations resolve (see [Persistence](#persistence)). A persistent note is never content-overwritten once it exists.
4. `reconcileNoteParenting` clones every note into every parent its manifest currently declares and detaches it from any parent it's no longer declared under — scoped to only ever detach a branch *this addon's own* manifest created, so a lazily-resolved dependency export shared by multiple consumers is never mistaken as stale by another consumer's clone.
5. Labels/relations are (re)applied, scoped to whatever was just resolved. Both are disable-state aware — if the addon is currently disabled, writes go to the `disabled:`-prefixed name instead of live-reactivating it. A trailing `(inheritable)` suffix on a label name sets a real `isInheritable` attribute.
6. `pruneRemovedNotes` deletes any live `#TAMFILEID`-tagged note under this addon's prefix whose local id is no longer in the current manifest — for the top-level addon and again for every dependency touched along the way.
7. The Database record is updated: merged in place (never resetting `manuallyInstalled`/`enabled`) if already installed, written fresh only for a genuine first install. `updateAvailable` is explicitly cleared on the merge path.
8. A brand-new (non-self) install is left disabled; an already-installed addon's `enabled` state is untouched.
9. The addon's own lifecycle hooks run, if it declares any (see [`hooks`](#hooks-optional)): `postInstall` on a first install, or `postUpdate` followed by the `updateReview` collect pass on an update. TAM's own record is exempt — a hook for TAM would run mid-self-replacement. Hooks only run on this top-level call, never for a dependency resolved along the way by `ensureDependencyExport`, which only ever resolves the exports a consumer asked for rather than the whole addon.
10. The settings review runs last for an addon declaring [`settings`](#settings-optional): on a first install it just records the merged defaults sources as the `settingsBaseline`; on an update it adopts defaults the user never diverged from, then appends one per-setting entry to the pending prompts if anything is left to decide (see [per-setting review](#per-setting-review-manifestsettings)). Being last and additive is what lets it coexist with both the whole-file diff and an `updateReview` hook.

There is no cascade to a dependent when its own dependency updates: a dependency's notes resolve in
place (the real note id a dependent's clone points at never changes across a version bump), so there's
nothing for existing clones to break. The one known gap: if a dependency *removes* a previously
exported note while a dependent still holds a clone of it, that dependent isn't automatically
resynced — `ensureDependencyExport` just returns `null` for a vanished export (logged and skipped).

**Update All Addons:** calls `syncAddon` for every out-of-date addon in sequence, TAM included. If any
have pending `promptOnUpdate` prompts, the Update Review screen is shown once per addon until the
queue is empty.

---

## Validating the Database

The **Validate Database** button runs `libTAMjs.validateDatabase()`, which audits every installed
addon against the live Trilium note tree — read-only, never fixes anything:

- **Duplicate `#TAMFILEID`s** — no two live notes claim the same `{addonId}/{localId}` id (the one thing
  a live-lookup design can't self-correct, since `getNoteWithLabel` just returns whichever match it finds
  first).
- **Missing dependency** — a declared `manifest.dependencies` entry that isn't actually installed.
- **Note existence** — the addon's root note (the stored `manifest.root` local id for TAM itself,
  or the reserved TAM-owned anchor local id for every other addon) and the stored
  `manifest.settingsNote` local id still resolve, checked only for an addon that's both installed
  *and* `manuallyInstalled` — a lazily-resolved dependency's root is never forced into existence at
  all (see [Hidden libraries](#hidden-libraries-resolved-lazily-and-rootlessly)), so a missing one
  there is expected, not an issue.
- **Persistence integrity** — for an addon whose manifest attaches anything under the reserved
  `"persistence"` parent keyword, every persistent note still resolves by its `#TAMFILEID` under
  that addon's own persistence anchor (a child of Addon Data). A missing one means the note was
  lost and a re-sync is needed.

Returns a flat list of `{ addonId, message }` issues, rendered as a dismissible panel. **There is no
offline "repair" action** — an addon flagged here should just be reinstalled/updated, since `syncAddon`
already idempotently reconciles everything fresh via `#TAMFILEID` against a real network fetch.
Related but separate: **Sweep Orphaned Notes** (`sweepOrphanedNotes`) is the one action here that *does*
fix something — it deletes any `#TAMFILEID`-tagged note with zero parents, a safety net for a partial
sync failure.

---

## Enabling and Disabling

TAM enables and disables addons by toggling Trilium activation labels. The following labels are considered "activation labels":

`widget`, `renderNote`, `run`, `customRequestHandler`, `customResourceHandler`, `titleTemplate`, `appCss`, `webViewSrc`, `iconPack`, `runOnNoteCreation`, `runOnNoteTitleChange`, `runOnNoteChange`, `runOnNoteContentChange`, `runOnNoteDeletion`, `runOnBranchCreation`, `runOnBranchChange`, `runOnBranchDeletion`, `runOnChildNoteCreation`, `runOnAttributeCreation`, `runOnAttributeChange`, `appTheme`

**Disabling:** Each activation label is renamed to `disabled:{labelName}` (e.g., `run` → `disabled:run`). Trilium does not recognize `disabled:` prefixed labels, so the scripts stop running.

**Enabling:** Each `disabled:{labelName}` label is renamed back to `{labelName}`.

TAM scans the entire subtree of the addon's root note, so activation labels on any descendant note are toggled correctly.

---

## Persistence

Some addon notes hold user data (settings, cached data, customized content) that should survive addon
updates *and* uninstalls. A manifest attaches one or more notes (directly or via further nesting)
under the reserved **`"persistence"`** parent keyword in `children[]` — the persistence-anchor
equivalent of `"root"`. Everything reachable from `"persistence"` through `children[]` is the
addon's *persistent* notes; everything else is *structural*.

The rule is placement, not per-note flags: a note is persistent because it's reachable from the
reserved `"persistence"` parent, full stop. Persistent notes are **created once and never
overwritten on update** (they are implicitly prompt-on-update — see
[`promptOnUpdate`](#promptonupdate)), and they are **never deleted on update**. An uninstall keeps
them too unless the user explicitly asks otherwise: for an addon that owns any persistent note, the
uninstall dialog offers **"Also delete this addon's stored data"**, off by default, which drops the
protected-id list so the same sweep takes the persistent notes and their anchor along with everything
else. An addon's own `preUninstall` hook is told which way that went via `deleteData`, but does not
make the decision (see [`hooks`](#hooks-optional)).

### Two anchors, two passes

Persistent notes are ordinary `#TAMFILEID` notes — same identity as any structural note — but they are
resolved under a different, stable anchor. Structural notes hang under this addon's own TAM-owned root
anchor (a child of **Addons**, torn down on uninstall); persistent notes hang under this addon's own
TAM-owned persistence anchor (a child of **Addon Data**) that no uninstall or prune sweep ever touches.
So survival is a property of *which anchor a note lives under*, not of a separate tag namespace. Both
per-addon anchors are created by `ensureAddonAnchor`, titled/`#addonId`/`#iconClass`-tagged after the
addon — an addon's own manifest never declares or reparents either one, only attaches children beneath
them via the reserved `"root"`/`"persistence"` parent keywords.

`syncAddon` therefore resolves an addon in two passes over the same shared note map:

1. **Persistence pass** — resolves everything reachable from the reserved `"persistence"` parent
   under this addon's persistence anchor. Runs first so persistent notes are already in the note
   map before any relation is applied.
2. **Structural pass** — resolves everything else under this addon's root anchor. A cross-anchor
   relation (e.g. `settings --configNote--> config`, where `config` is persistent) resolves cleanly
   because the persistence pass already populated its target.

`resolveNotes` skips content writes for any note whose local id is in the persistent set, so a persistent
note that already exists keeps the user's data; a persistent note that doesn't exist yet is created from
its shipped `sourceUrl`/inline content exactly once.

### Sweeps skip persistent notes

Every uninstall/prune sweep (`detachAddonOwnedBranches`, `pruneRemovedNotes`) is passed the addon's
persistent id set — which `deleteAddon` extends with the persistence anchor's own synthetic local id, so
the anchor holding those notes survives alongside them — and leaves all of it in place. The structural
root anchor is not protected, so it (and everything under it) is torn down along with the rest of the
structural tree; the persistence anchor and its subtree remain under Addon Data, and a later reinstall of
the same addonId re-adopts each note by its `#TAMFILEID`, user data intact.

⚠️ The persistent-id set protects notes TAM *owns*. It does nothing for **user notes templated from a
TAM-owned template**, which are not TAM notes at all but inherit the template's `#TAMFILEID` and are
therefore invisible to this protection. That is a read-side concern: the sweeps must resolve ownership
with the owned accessors, per
[Note Identity: `#TAMFILEID`](#note-identity-tamfileid). A sweep that reads the inherited value will
delete those user notes and their whole subtrees regardless of what the persistent set contains. Deleting stored data on uninstall is opt-in per uninstall for exactly
this reason.

---

## `skipOnUpdate`

Set `"skipOnUpdate": true` on any note whose content should never be overwritten during an update. Typical uses:

- **Database / settings notes** — the user fills these in after installation; an update must not reset them.
- **Root render notes** — structural notes whose content is not meaningful (empty or a stub).

During a sync, `resolveNotes` skips content writes (and the sourceUrl fetch that would otherwise feed them) for any found note with `skipOnUpdate: true` — see [How Sync Works](#how-sync-works).

---

## `promptOnUpdate`

Every **persistent** note (one reachable from the reserved `"persistence"` parent keyword — see
[Persistence](#persistence)) is prompt-on-update *by default*: TAM never overwrites it silently, but
it does surface an upstream change so the user can opt in. There is no per-note `promptOnUpdate`
flag to set — placement under `"persistence"` is what enables this behaviour.

Before an update, for each persistent note — skipping any whose published `sha` is unchanged since
the last sync, since nothing upstream moved to ask about:
1. TAM reads the note's current content (the live persistent note).
2. TAM reads the new content from the incoming manifest (fetched fresh from its `sourceUrl`, or the
   inline default).
3. If they differ, TAM stores a pending prompt (both versions of the content plus the note title).

After reinstallation, if there are pending prompts, TAM shows the **Update Review** screen:
- Each changed note is shown with two side-by-side panels: **Keep Mine** (current) and **Use New Default** (incoming).
- The default selection is **Keep Mine**, unless the row itself says otherwise (a per-setting or
  per-metadata row the user never diverged from starts on **Use New Default** — see below).
- The user can switch any note to "Use New Default" before clicking Apply.
- Choosing "Use New Default" writes the new content to the persistent note. Choosing "Keep Mine" leaves it untouched.
- Once all choices are applied, the review is dismissed and the addon UI reloads.

### Per-setting review: `manifest.settings`

Whole-file diffing is the right shape for a note whose *content* is the thing the user edited (a
bundled template, a seeded page). It is the wrong shape for a settings document: `config.json` is
one blob holding dozens of unrelated answers, so a whole-file prompt asks a question nobody can
answer well, and "Use New Default" replaces every setting at once.

An addon that declares [`settings`](#settings-optional) gets a per-setting review instead, produced
by TAM itself — no hook note, no code in the addon:

1. Its config note is **excluded** from whole-file diffing (a config note ships empty, so diffing it
   would offer to replace everything the user ever saved with `{}`).
2. On a **first install**, TAM records the merged read-only sources — everything under the config
   note in its `sourceConfig` chain — as that addon's `settingsBaseline`.
3. On an **update**, TAM compares those sources against that baseline. **Every default that moved
   gets a row**, whether or not the user ever customized it — an update that brings new defaults is
   shown key by key rather than silently adopted.
4. The entry has one row per setting: **Keep Mine** against what the user has today, **Use New
   Default** against the new shipped value. A row the user never customized starts on Use New
   Default (it is already following the source); one that conflicts starts on Keep Mine.
5. **Use New Default** drops the user's override — the scalar's key, or a registry entry's shadowing
   entry — so the setting tracks the defaults source again. **Keep Mine** *pins* what they have
   today into `config.json`, which is what stops an untouched setting from following the new default.
   Either way the baseline advances, so the same question is never asked twice.

An item is only raised when the **shipped** side changed since the baseline. Everything else stays
silent: a value that already equals the new default, a customization made against a default that has
not moved, a field new in this version (no baseline to diff), and — for registries — entries the
user deleted (a removal is never resurrected) or that the addon no longer ships. An install
predating this feature has no baseline, so its first update records one and reviews nothing: there
is genuinely no way to know which of its stored values were deliberate.

`list` fields are skipped entirely: a stored list replaces its default wholesale rather than
reconciling per entry, so "use the new default" could only mean discarding the user's entries.

TAM reads all of this through the very same `libSettingsCore.js` note that libsettings' own frontend
half uses, wired under `lib-tam.js` in TAM's manifest, so "the user changed this" means exactly what
the settings form that wrote the file meant by it.

### Per-note metadata review: titles, labels and relations

Content is not the only thing an update rewrites. `resolveNotes` sets every declared title, and
`applyLabels`/`applyRelation` set every declared label and relation — so a note the user renamed, or
a label they retargeted, is silently reverted on the next update. That metadata gets the same
key-by-key review a settings document does, for every addon, with nothing to declare:

1. Before the sync rewrites anything, TAM reads the live title, label values and relation targets of
   every note the manifest declares.
2. It compares what the manifest declares **now** against `metadataBaseline` — what it declared at
   the last sync, kept on the addon's own database record.
3. Every declaration that moved becomes one Update Review row: `<note>: title`,
   `<note>: label <name>`, `<note>: relation <type>`. A declaration the manifest **dropped** shows
   `(removed)` as its incoming side; one it **added** shows `(none)` as the current side.
4. A row starts on **Use New Default** when the live value still matches the old declaration (the
   user never touched it), and on **Keep Mine** when it does not.
5. **Use New Default** makes the note match the manifest — which is also the only way a label or
   relation the manifest no longer declares is ever removed. **Keep Mine** writes the pre-update
   value back, since the sync has already overwritten it by the time the user answers.

A row is only raised where the *declaration* changed: a title the user renamed against a manifest
that still says the same thing is left alone and never asked about. An install predating this
feature has no baseline, so its first update records one and reviews nothing. The baseline advances
at sync time, not when the user answers — each row already carries both values, so it stays
applicable either way.

### Replacing the diff with per-item review

An addon that declares an `updateReview` hook (see [`hooks`](#hooks-optional)) supplies its own list
of reviewable items instead of the whole-file diff, and applies the chosen ones itself. TAM renders
whole-file, hook and settings entries on the same Update Review screen; on the hook path it writes
nothing itself.

The built-in diff is still collected before every sync, so an addon whose hook throws or returns
something unusable falls back to it rather than losing the prompt entirely. The settings entry is
**additive** — it is appended after the hook has had its say, so an addon can have both.

Setting `promptOnUpdate` or `skipOnUpdate` on a note that is already reachable from the reserved
`"persistence"` parent is redundant (the placement already governs it) and `validate` warns about it.

---

## Scripts Reference

The toolchain is a single Node.js CLI, `resources/scripts/tamhelper.js`, run from the repository root as `node resources/scripts/tamhelper.js <command>`. Inside `nix-shell resources/nix`/`nix develop ./resources/nix` each command is also exposed as a shell function (`validate`, `tam_to_zip`, `zip_to_tam`, `generate_pages`, `publish`, `generate_readme`, `publish_release`). The only runtime dependency is `marked` (installed via `npm ci` from the committed `resources/package-lock.json`).

### `validate`

Validates all `_tam_manifest_.json` files before publishing. Checks:

- All required top-level fields are present (`id`, `name`, `description`, `author`, `homepage`, `license`, `latestVersion`, `type`).
- `homepage` ends with `addons/{id}` when the path contains `/addons/` (auto-fixable with `--fix`).
- `readme` file exists on disk if declared.
- `manifestSourceUrl` matches where `publish` will serve this manifest (auto-fixable with `--fix`; only a warning when absent entirely).
- If `manifest.root` is set (TAM's own self-bootstrap exception only), it exists in `manifest.notes`; otherwise `manifest.children` attaches at least one note to the reserved `"root"` parent keyword.
- Every relative `sourceUrl` resolves to a real file on disk, and is read from there rather than fetched (an absolute one is still fetched, since it isn't in this repo).
- All `children`, `relations`, and `labels` reference note IDs that exist in `manifest.notes` — except `children[].parent`, which also accepts the reserved `"root"`/`"persistence"` anchor keywords.
- `manifest.dependencies` is a list where each entry is a bare id string or a well-formed `{id, manifestSourceUrl}` object.
- `manifest.settings`, when present, names a `schema`, a `defaults` and a `config` that all exist in `manifest.notes`. The schema and defaults notes must not be attached under the reserved `"persistence"` parent (both ship anew every update), and the defaults note must ship content; the config must be persistent, and must ship no `sourceUrl`/`content` of its own (or it would still be offered for whole-file replacement). The config must carry a `sourceConfig` relation to the defaults note, or libsettings would read no defaults at all. A mime other than `application/json` on any of them is a warning.
- Every `manifest.hooks` entry names a known phase, points at a note that exists in `manifest.notes`, is a frontend script (`text/jsx` or `env=frontend`), and is not attached under the reserved `"persistence"` parent. An `updateReview` hook on an addon with no persistent notes is a warning.

Run in CI before every publish. Exits with code 1 if any errors are found.

```
node resources/scripts/tamhelper.js validate [--fix]
```

### `tam-to-zip`

Converts a `_tam_manifest_.json` into a Trilium-importable ZIP export (the format Trilium's "Import" function accepts). Automatically discovers and bundles dependency addons from the sibling `addons/` directory.

- For each note in the manifest, fresh Trilium note IDs are generated. Content comes off disk for a relative `sourceUrl` (so a ZIP always matches the working copy, and builds offline); only an absolute one is fetched.
- Every note gets a real `#TAMFILEID="{addonId}/{localId}"` label baked into the exported ZIP (see [Note Identity](#note-identity-tamfileid)) — a manually-imported ZIP is fully self-identifying from the moment of import, with no separate bootstrap/tagging step needed for TAM to recognize its own notes on a later sync.
- Dependency addons are read from `addons/{dep-id}/_tam_manifest_.json` in the same repo and bundled as additional root entries in the ZIP's `!!!meta.json` — this only works for a bare-id dependency (or an explicit one that happens to also have a local sibling folder); a dependency that only exists at a remote `manifestSourceUrl` can't be bundled into an offline ZIP and is skipped with a warning.
- Cross-addon clone children and relations are wired using the generated UUIDs, resolved via each dependency's `exports` map.

```
node resources/scripts/tamhelper.js tam-to-zip addons/{addon-id}/ [--out output.zip] [--addons-dir path/to/addons/]
```

The `--addons-dir` defaults to the parent directory of the addon being exported (i.e., `addons/`). Override it if running from a different working directory.

Pass `--all` instead of a manifest path to build every addon's ZIP in one call — scans `--addons-dir` (default `addons/`) for every `*/_tam_manifest_.json` and writes `{id}.zip` for each into `--out-dir` (default the current directory). This is what the publish workflow uses instead of shelling out to `tam-to-zip` once per addon:

```
node resources/scripts/tamhelper.js tam-to-zip --all [--addons-dir addons/] [--out-dir .]
```

### `zip-to-tam`

Converts a Trilium export ZIP into a `_tam_manifest_.json` + flat source files. This is the reverse of `tam-to-zip` and is used when migrating an existing addon (developed and exported from Trilium) into the TAM manifest format.

- Reads `!!!meta.json` from the export ZIP.
- Assigns stable local IDs to notes by slugifying their titles.
- Copies source files flat into the output directory, resolving each note's data file by its exact path in the archive (so notes that share a basename, e.g. several bundled deps each with a `README.md`, don't collide).
- Handles clone entries (notes that appear under multiple parents) correctly — they become extra `children` entries referencing the same local ID rather than duplicate note entries.
- Filters out `noImport` scaffold entries.
- Writes each note's `sourceUrl` as a plain filename relative to the manifest, the form a source manifest uses; `publish` resolves it later, so no `manifestSourceUrl` is scaffolded at all.
- Outputs a `_tam_manifest_.json` with `FILL_IN` placeholders for top-level metadata fields that must be filled in manually.

```
node resources/scripts/tamhelper.js zip-to-tam path/to/export.zip [--out ./output-dir/]
```

After running, fill in the `FILL_IN` fields in `_tam_manifest_.json`, review the auto-generated local IDs, add `dependencies`/`exports` if needed, and set `skipOnUpdate`/`promptOnUpdate` on appropriate notes.

### `publish`

Turns every source manifest into the published one TAM installs from — resolved, hashed, and written
to `resources/docs/{id}/_tam_manifest_.json` alongside `catalog.json`. See
[Publishing](#publishing) for what it does and why. Offline: nothing is fetched, and the same commit
always publishes byte-identically.

```
node resources/scripts/tamhelper.js publish [--addons-dir addons/] [--out-dir resources/docs/] [--commit SHA]
```

`--commit` defaults to `GITHUB_SHA` in CI, else `HEAD`. Run in CI on every push (see
[`pages.yml`](#pagesyml)) — a local run is only useful for inspecting the output, since
`resources/docs/` is gitignored and only the deployed copy is ever installed from.

### `generate-pages`

Generates the static GitHub Pages catalog site at `resources/docs/`. For each addon:

- Renders a card on the index page with name, type badge, description, version, and author.
- Renders a detail page (`resources/docs/{addon-id}/index.html`) with the README, metadata table, download buttons, and — when the addon has any dependency or dependent — a focused Mermaid dependency subgraph (see [Dependency graph](#dependency-graph)).
- The index page has a search bar, type filter buttons, and a collapsible whole-catalog Mermaid dependency graph.
- Author names link to their GitHub profiles.
- Download buttons: **Download ZIP** (Trilium import), **View Manifest** (the addon's published manifest), **Source** (GitHub homepage).

```
node resources/scripts/tamhelper.js generate-pages
```

Requires the `marked` package (installed via `npm ci`).

### `generate-readme`

Regenerates the repo-root `README.md` from `resources/README_base.md` by injecting an addon table (name, type, description, version) between the `<!-- GENERATED:START -->` and `<!-- GENERATED:END -->` markers. Shares manifest loading with `generate-pages`.

```
node resources/scripts/tamhelper.js generate-readme
```

### `publish-release` *(CI-only)*

Uploads every `{id}.zip` produced by `tam-to-zip --all` to **two** GitHub releases: a new, uniquely-tagged release for this exact publish run (permanent — this is how a user gets an older version, by grabbing that release's zip and importing it manually) and the floating `latest`-tagged release (refreshed with the same assets, so "download current" links keep working without needing to know a specific version tag). Requires an authenticated `gh` CLI (`GITHUB_TOKEN` in the environment).

```
node resources/scripts/tamhelper.js publish-release
```

---

## GitHub Actions Workflows

### `publish.yml`

Runs on every push to `main` and on manual dispatch. Steps:

1. `tamhelper.js validate` — validates all manifests, fails the workflow on errors.
2. `tamhelper.js tam-to-zip --all` — produces `{id}.zip` for every addon.
3. `tamhelper.js publish-release` — publishes both the new versioned release and the refreshed `latest` release.

### `pages.yml`

Runs on every push to `main` and on manual dispatch. Builds and deploys the GitHub Pages catalog site:

1. Installs the npm dependencies (`npm ci`).
2. Runs `tamhelper.js generate-pages` to produce `resources/docs/`.
3. Runs `tamhelper.js publish` to write every published manifest and `catalog.json` into it, pinned
   to the commit being deployed (see [Publishing](#publishing)).
4. Uploads `resources/docs/` as a Pages artifact and deploys it.

---

## Installing TAM

The only thing that's actually different about installing TAM itself is *how* it gets its first
manifest fetch — there's no other TAM around to click "Install" for you. Everything else is the
ordinary sync path:

1. Download `trilium-addon-manager@beatlink.zip` from the [latest release](https://github.com/BeatLink/trilium-scripts/releases/latest).
2. In TriliumNext, use **Import** to import the ZIP under any note.
3. Open the imported `trilium-addon-manager@beatlink` render note.
4. `database.json`'s seed content pre-populates `installedAddons["trilium-addon-manager@beatlink"]`
   with just TAM's own `manifestSourceUrl` (not a full record — there's nowhere to derive the rest
   from before a real sync resolves the actual note tree). On load, the UI checks whether that
   record is fully populated yet (has an `installedVersion`); if not, it triggers one ordinary
   `syncAddon` call for TAM against that seeded URL — the exact same call any other addon's first
   sync would make. Since every note in the ZIP already carries its correct `#TAMFILEID` (baked in
   by `tamhelper.js tam-to-zip` at build time), that sync finds everything by lookup rather than creating
   anything, and finishes by writing a real, fully-populated Database record — after which TAM is
   indistinguishable from any other installed addon, including showing up correctly in future
   "Check for Updates" runs.
5. Add `https://beatlink.github.io/trilium-scripts/catalog.json` as a catalog (pre-added by default, in `database.json`'s seed content) and browse it to install addons — or install any single addon directly by pasting its `manifestSourceUrl`.
