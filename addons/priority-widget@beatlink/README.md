# Priority Widget

A right-pane widget that lets you assign or change the priority of the currently active note, plus a
Missing Priorities page that finds every note that still doesn't have one under the active profile.
The widget appears only on notes that declare the active profile's label via `#label:<name>` (by
default `#label:priority`).

## Configuring priorities

Open the addon's settings note. The **Active Profile** dropdown chooses which profile the picker
offers. Three ship by default: **Standard** (Critical/High/Medium/Low), **MoSCoW** (Must/Should/
Could/Want To Do), and **Color** (which writes colors directly to `#color`). You can add your own,
rename them, or edit any profile's levels.

Each profile has a `name` (shown in the Active Profile dropdown), a `label` (the note label this
profile reads and writes, without the leading `#`), and its own **Priorities** registry of levels:

- **Enabled** controls whether a level appears in the dropdown and in the Missing Priorities page.
- **Row order** is the dropdown order. Use each row's move-up/move-down controls to rearrange.
- **Key** is the stable value stored on tagged notes. The numeric prefix is what makes notes sort by
  priority; renaming a key after notes are tagged orphans their label.
- **Title** is the text shown in the dropdown.
- **Color**, if set, is mirrored onto `#color` whenever this level is assigned — left unset in the
  Color profile, whose keys are already colors.

Switching profiles changes both the dropdown options and the label they are written to, so notes
tagged under one profile keep their old label until re-set under the new one.

If the active note's label points at a key that is disabled or not listed, the dropdown shows
"⚠ Invalid: \<key\>" rather than reporting the note as having no priority.

## Missing Priorities

A separate page (its own launcher note, "Missing Priorities") lists every non-hidden note that lacks
the active profile's label, one at a time — title, tree path, a content preview, and a button per
enabled priority level to assign it on the spot. Assigning a level drops the note from the list;
"Start over" replays it from the top.

## Exclude Filters

The **Exclude Filters** tab holds a registry of named Trilium search queries. A note matching any
**enabled** filter's query is hidden from both the picker widget and the Missing Priorities list — use
this for notes that intentionally never get a priority (e.g. `note.type = code` or a specific
subtree). A filter with a blank query is ignored; an unparseable query is skipped rather than breaking
the rest.

## Sharing the priority list with other addons

The settings note is tagged **`#priorityConfig`** so other addons can discover and reuse the same
priority vocabulary at runtime (the same pattern `area-picker@beatlink` uses with `#areaConfig`). A
consumer searches for `#priorityConfig`, reads the anchor's `schemaNote` and `configNote`
relations, and calls libsettings' `loadSettings(schemaNoteId, configNoteId)` to get `selected` and
`profiles`.

## Upgrading from 2.2.x

Each profile's `priorities` setting changed from a plain ordered list to a registry (stable per-row
id, an Enabled toggle, Add/Remove controls), matching how `area-picker@beatlink`'s Areas tab works. If
you already have profiles configured, **run
[`migrate-priorities-config.js`](migrate-priorities-config.js) once, manually, before updating** — it
converts every profile's `priorities` config in place so your customized levels, colors, and order
survive. See that script's own header comment for exact steps. A fresh install with no prior config
has nothing to migrate.

## Installation

Import the Zip file from the releases page or use Trilium Addon Manager
