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
(`Agenda`, `Agenda Next`, `Calendar`, `Cinnamon Applet Scripts`, `Recurrence`, `Reschedule`,
`Archived/`) are legacy/pre-TAM addons kept for reference and are skipped by the scripts.

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
  distribution JSON; nothing else reads `sourceUrl` at runtime.
- **`children[]`** — parent/child tree structure, either local (`{parent, child}`) or cross-addon
  (`{parent, addon, child}` where `child` resolves through the dependency's `exports` map).
- **`relations[]`** / **`labels[]`** — Trilium relations and labels applied after note creation, same
  local-vs-cross-addon shape.
- **`dependencies[]`** / **`exports{}`** — declares and exposes notes for other addons to clone/link
  against.
- **`skipOnUpdate`** (note never overwritten on update — settings/database notes) and
  **`promptOnUpdate`** (user is shown a Keep-Mine-vs-Use-New-Default diff on update — customizable
  content notes) control TAM's update behavior; both only make sense on notes also tracked by an
  `AddonData:key` persistence relation.

TAM itself (the addon that interprets all of this inside Trilium) is `libTAM.js` +
`trilium-addon-manager@beatlink`'s render note; see that addon's `README.md` for the full
install/update/persistence/self-update state machine — it's long and not worth duplicating here.

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
