# Area Picker

A right-pane widget that lets you assign or change the area of the currently active note, plus a
Missing Areas page that finds every note that still doesn't have one.

## Configuring the area list

Open the addon's settings note and use the **Areas** tab to add, remove, reorder, rename, or recolor
areas:

- **Enabled** controls whether an area appears in the dropdown and in the Missing Areas page.
- **Row order** is the dropdown order. Use each row's move-up/move-down controls to rearrange.
- **Key** is the stable identifier stored on tagged notes as `#area`. Renaming it after notes are
  already tagged orphans their `#area` label.
- **Title** is the text shown in the dropdown.
- **Color**, if set, is mirrored onto `#color` whenever this area is assigned.

Click **Save** to persist your changes.

If the active note's `#area` label points at a key that is disabled or not listed, the dropdown shows
"⚠ Invalid: \<key\>" rather than reporting the note as having no area.

## Missing Areas

A separate page (its own launcher note, "Missing Areas") lists every non-hidden note that has no
`#area` label, one at a time — title, tree path, a content preview, and a button per enabled area to
assign it on the spot. Assigning an area drops the note from the list; "Start over" replays it from
the top.

## Exclude Filters

The **Exclude Filters** tab holds a registry of named Trilium search queries. A note matching any
**enabled** filter's query is hidden from both the picker widget and the Missing Areas list — use this
for notes that intentionally never get an area (e.g. `note.type = code` or a specific subtree). A
filter with a blank query is ignored; an unparseable query is skipped rather than breaking the rest.

## Upgrading from 2.5.x

The `areas` setting changed from a plain ordered list to a registry (stable per-row id, an Enabled
toggle, Add/Remove controls), matching how `template-picker@beatlink`'s Templates tab works. If you
already have areas configured, **run
[`migrate-areas-config.js`](migrate-areas-config.js) once, manually, before updating** — it converts
your existing `areas` config in place so your customized areas, colors, and order survive. See that
script's own header comment for exact steps. A fresh install with no prior config has nothing to
migrate.
