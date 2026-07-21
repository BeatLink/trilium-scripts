# Priority Widget

A right pane dropdown widget that allows you to set the priority of a note. The widget appears only
on notes that declare the active profile's label via `#label:<name>` (by default `#label:priority`).

## Configuring priorities

Priorities are a setting, not a hand-edited file — open this addon's settings screen (via TAM's
"Settings" button) to edit them.

Priorities are grouped into **profiles**, and the **Active Profile** dropdown chooses which one the
picker offers. Three ship by default: **Standard** (Critical/High/Medium/Low), **MoSCoW** (Must/
Should/Could/Want To Do), and **Color** (which writes colors directly to `#color`). You can add your
own, rename them, or edit any profile's levels.

Each profile has a `name` (shown in the Active Profile dropdown), a `label` (the note label this
profile reads and writes, without the leading `#`), and an ordered list of priority levels. Each
level has a `key` (the stable value stored on tagged notes — the numeric prefix is what makes notes
sort by priority, and renaming a key after notes are tagged orphans their label), a `title` (shown in
the dropdown), and an optional `color` (applied as the note's `#color` label when that level is
selected; left unset in the Color profile, whose keys are already colors).

Switching profiles changes both the dropdown options and the label they are written to, so notes
tagged under one profile keep their old label until re-set under the new one.

## Sharing the priority list with other addons

The settings note is tagged **`#priorityConfig`** so other addons can discover and reuse the same
priority vocabulary at runtime (the same pattern `area-picker@beatlink` uses with `#areaConfig`). A
consumer searches for `#priorityConfig`, reads the anchor's `schemaNote` and `AddonData:config`
relations, and calls libsettings' `loadSettings(schemaNoteId, configNoteId)` to get `selected` and
`profiles`.

## Installation

Import the Zip file from the releases page or use Trilium Addon Manager
