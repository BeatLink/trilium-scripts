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

- **Database** — a JSON code note that holds all TAM state: repository metadata, installed addon registry, persistence data, and pending update prompts. TAM reads and writes this note on every operation.
- **Addons** — the parent note under which all installed addons are placed as children.
- **Addon Data** — the parent note under which persistence copies of addon data notes are stored (see [Persistence](#persistence)).
- **libTAM.js** — the frontend library that does all the heavy lifting. It runs in the browser but uses `api.runOnBackend` and `api.runAsyncOnBackendWithManualTransactionHandling` for operations that need backend access (fetching URLs, creating notes, modifying note content).
- **Source Code** — the Preact/JSX render widget. It calls functions from `libTAM.js` (available globally as `libTAMjs`) and manages UI state.

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
| `id` | Local identifier for this note, used to reference it throughout the manifest. Not stored in Trilium — TAM maps local IDs to real Trilium note IDs after creation. |
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
`child` is the export name from the dependency's `exports` map (see [Exports](#exports)).

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

TAM recursively installs all declared dependencies from the same repository before installing the addon itself.

#### `exports`

Maps export names to local note IDs. This is how other addons reference specific notes in this addon:
```json
"exports": {
  "lib": "lib-note-local-id"
}
```

When a dependent addon references `"addon": "this-addon@author", "child": "lib"`, TAM resolves `"lib"` through this map to get the real Trilium note ID.

---

## How Installation Works

1. TAM fetches `{repoId}.json` from the GitHub release (the addon's full manifest with inlined content).
2. Dependencies listed in `manifest.dependencies` are installed first (recursively).
3. Notes are created in topological order (parents before children) under the Addons root note, using `api.createTextNote`.
4. Cross-addon children are wired using `api.toggleNoteInParent` to create a clone branch from the dependency note into the new parent.
5. Labels are applied with `note.setLabel`.
6. Relations are applied with `note.setRelation`. Cross-addon relations resolve the target note ID through the dependency's stored `exportedNotes` map.
7. The local ID → real Trilium note ID mapping (`noteMap`) and exported note IDs (`exportedNotes`) are saved to the Database note.
8. The addon is registered in `database.installedAddons` with `installedVersion`, `rootNoteId`, `noteMap`, and `exportedNotes`.
9. Persistence is initialized — see [Persistence](#persistence).
10. The addon is left disabled. The user enables it manually (or it can be auto-enabled by the installing user).

---

## How Updates Work

Updating an addon does **not** do an in-place content patch. Instead:

1. TAM fetches the latest manifest.
2. Before deleting anything, `collectPendingPrompts` scans for notes with `promptOnUpdate: true`, compares their current persisted content against the new content in the manifest, and stores any differences in the Database.
3. The old addon note tree is deleted entirely.
4. The addon is reinstalled from scratch (following the install steps above).
5. Persistence is reconnected — existing persisted notes are reattached rather than duplicated (see [Persistence](#persistence)).
6. If there were pending prompts, the UI shows the Update Review screen.

This approach ensures the note structure is always clean and matches the manifest, while user data in persisted notes survives.

---

## Enabling and Disabling

TAM enables and disables addons by toggling Trilium activation labels. The following labels are considered "activation labels":

`widget`, `renderNote`, `run`, `customRequestHandler`, `customResourceHandler`, `titleTemplate`, `appCss`, `webViewSrc`, `iconPack`, `runOnNoteCreation`, `runOnNoteTitleChange`, `runOnNoteChange`, `runOnNoteContentChange`, `runOnNoteDeletion`, `runOnBranchCreation`, `runOnBranchChange`, `runOnBranchDeletion`, `runOnChildNoteCreation`, `runOnAttributeCreation`, `runOnAttributeChange`, `appTheme`

**Disabling:** Each activation label is renamed to `disabled:{labelName}` (e.g., `run` → `disabled:run`). Trilium does not recognize `disabled:` prefixed labels, so the scripts stop running.

**Enabling:** Each `disabled:{labelName}` label is renamed back to `{labelName}`.

TAM scans the entire subtree of the addon's root note, so activation labels on any descendant note are toggled correctly.

---

## Persistence

Some addon notes are meant to hold user data (settings, cached data, user-customized content) that should survive addon updates. These notes are marked with an `AddonData:key` relation in the manifest.

When an addon is first installed:
1. TAM scans the addon's note subtree for any `AddonData:key` relations.
2. For each one found, TAM duplicates the target note into the **Addon Data** tree (`addonPersistenceLabel` note), under a per-addon folder.
3. The `AddonData:key` relation on the addon note is updated to point to the persisted copy instead of the original.
4. The mapping `key → persistedNoteId` is saved in the Database.

On reinstall after an update:
1. TAM finds the existing persistence mapping from the Database.
2. Instead of duplicating again, the relation is rewired to point to the already-existing persisted note.
3. User data is preserved unchanged.

Notes in the persistence tree are never deleted by TAM (even if the addon is uninstalled), ensuring data is not accidentally lost.

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
2. For each note in the manifest, if `skipOnUpdate` is false, TAM writes the new content directly to the existing note (looked up from `noteMap`).
3. Notes with `skipOnUpdate: true` (Database, Addons root, Addon Data root) are left untouched, preserving all installed addon state and user data.
4. The installed version is updated in the Database.

If TAM was originally imported via ZIP (not installed through TAM), there is no `noteMap` in the database. In that case, TAM discovers note IDs by traversing the note tree upward from `libTAM.js` and matching note titles against the manifest.

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
4. TAM will detect it was imported manually (no `noteMap` in the database) and handle self-updates correctly.
5. Add `BeatLink/trilium-scripts` as a repository and click "Update Repositories" to populate the addon list.
