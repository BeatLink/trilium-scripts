# Area Picker

A right pane dropdown widget that allows you set a note to a specific area of life.

## Configuring the area list

The list of areas (and their colors) is a setting, not a hand-edited file — open this addon's
settings screen (via TAM's "Settings" button) to add, remove, reorder, rename, or recolor areas.
Each area has a `key` (the stable value stored on tagged notes — renaming it after notes are already
tagged orphans their `#area` label), a `title` (shown in the dropdown), and a `color` (applied as the
note's `#color` label when that area is selected).

## Sharing the area list with other addons

The settings note is tagged **`#areaConfig`** so other addons can discover and reuse the same area
vocabulary at runtime. A consumer searches for `#areaConfig`, reads the anchor's `schemaNote` and
`configNote` relations, and calls libsettings' `loadSettings(schemaNoteId, configNoteId)` to
get the `areas` list.
