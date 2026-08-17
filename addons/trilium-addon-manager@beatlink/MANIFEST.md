# The TAM Manifest and Toolchain

Everything an addon author writes or runs: the `_tam_manifest_.json` format, the catalog format,
and the `tamhelper.js` commands that validate, build and publish them. For how TAM itself resolves
what these describe, see **[ARCHITECTURE.md](ARCHITECTURE.md)**.

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
| `manifestSourceUrl` | No¹ | A URL where this exact manifest document can always be fetched from. Written by `publish`; see [Publishing](ARCHITECTURE.md#publishing). |
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
keyword — see [Persistence](ARCHITECTURE.md#persistence).

#### `root` *(TAM only)*

The one exception: `trilium-addon-manager@beatlink`'s own manifest still declares a real `root`
note, the local ID of the note the user manually ZIP-imports to bootstrap TAM in the first place.
Nothing else can synthesize an anchor for TAM before TAM exists to do it. No other addon's manifest
should ever set this field — `validate` doesn't require it, and `tam_to_zip`/live sync both treat
its absence as "TAM synthesizes the root," which is what every addon but TAM wants.

#### `settingsNote` *(optional)*

The local ID of the note TAM's UI should navigate to for this addon's settings screen. If present,
it's stored as-is in the addon's own `manifest.settingsNote` (see [The Database Record](ARCHITECTURE.md#the-database-record))
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
`"root"` works for the structural tree. See [Persistence](ARCHITECTURE.md#persistence) for the full behaviour.

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
[per-setting review](ARCHITECTURE.md#per-setting-review-manifestsettings): the config note stops being whole-file
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
[`promptOnUpdate`](ARCHITECTURE.md#promptonupdate)). On `collect` it returns the same shape TAM's own producer
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
| `id` | Local identifier for this note, used to reference it throughout the manifest. Not stored verbatim in Trilium, but TAM tags the resolved note with a permanent `#TAMFILEID="{addonId}/{id}"` label (see [Note Identity](ARCHITECTURE.md#note-identity-tamfileid)) so it can find this exact note again later. |
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

Trilium activation labels (those that cause scripts to run or themes to apply) are managed by TAM's enable/disable system — see [Enabling and Disabling](ARCHITECTURE.md#enabling-and-disabling).

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

TAM recursively syncs all declared dependencies before syncing the addon itself. If a dependency is already installed but its `latestVersion` is newer than what's currently installed, TAM syncs it in place first — otherwise a dependency bump (e.g. a shared library's note getting renamed) would never reach an addon that already had the old version of that dependency installed, even via "Update All Addons" on the addon that actually changed. See [How Sync Works](ARCHITECTURE.md#how-sync-works).

#### `exports`

Maps export names to local note IDs. This is how other addons reference specific notes in this addon:
```json
"exports": {
  "lib": "lib-note-local-id"
}
```

When a dependent addon references `"addon": "this-addon@author", "child": "lib"`, TAM resolves `"lib"` through this map to get the *local id*, then finds the real note live by its `#TAMFILEID` (see [Note Identity](ARCHITECTURE.md#note-identity-tamfileid)). `exports{}` stays purely a manifest-level encapsulation boundary — it lets an addon restructure its own internal local ids across a version bump without breaking consumers, as long as the exported name keeps meaning the same thing — no note ids are cached from it.

---

## `skipOnUpdate`

Set `"skipOnUpdate": true` on any note whose content should never be overwritten during an update. Typical uses:

- **Database / settings notes** — the user fills these in after installation; an update must not reset them.
- **Root render notes** — structural notes whose content is not meaningful (empty or a stub).

During a sync, `resolveNotes` skips content writes (and the sourceUrl fetch that would otherwise feed them) for any found note with `skipOnUpdate: true` — see [How Sync Works](ARCHITECTURE.md#how-sync-works).

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
- Every note gets a real `#TAMFILEID="{addonId}/{localId}"` label baked into the exported ZIP (see [Note Identity](ARCHITECTURE.md#note-identity-tamfileid)) — a manually-imported ZIP is fully self-identifying from the moment of import, with no separate bootstrap/tagging step needed for TAM to recognize its own notes on a later sync.
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
[Publishing](ARCHITECTURE.md#publishing) for what it does and why. Offline: nothing is fetched, and the same commit
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
- Renders a detail page (`resources/docs/{addon-id}/index.html`) with the README, metadata table, download buttons, and — when the addon has any dependency or dependent — a focused Mermaid dependency subgraph (see [Dependency graph](ARCHITECTURE.md#dependency-graph)).
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
   to the commit being deployed (see [Publishing](ARCHITECTURE.md#publishing)).
4. Uploads `resources/docs/` as a Pages artifact and deploys it.
