# Area Picker

A right-pane widget that lets you assign or change the area of the currently active note, plus a
Missing Areas page that finds every note that still doesn't have one.

## Configuring the area list

Open the addon's settings note — from the launcher, or with the cog button in the picker widget's
header — and use the **Areas** tab to add, remove, reorder, rename, or recolor areas:

- **Enabled** controls whether an area appears in the dropdown and in the Missing Areas page.
- **Row order** is the dropdown order. Use each row's move-up/move-down controls to rearrange.
- **Key** is the stable identifier stored on tagged notes as `#area`. Renaming it after notes are
  already tagged orphans their `#area` label.
- **Title** is the text shown in the dropdown.
- **Color**, if set, is mirrored onto `#color` whenever this area is assigned.

Click **Save** to persist your changes.

If the active note's `#area` label points at a key that is disabled or not listed, the dropdown shows
"⚠ Invalid: \<key\>" rather than reporting the note as having no area.

### What updates do to your areas

Thirteen areas ship with the addon. Each one keeps tracking future versions for as long as you leave
it alone: if a later version renames or recolors one, the change reaches your install on the next
update without asking. Once you edit an area it is yours, and is never overwritten. Should a later
version change that same area, TAM's **Update Review** shows your version against the new one, one
area at a time, and asks which you want rather than deciding for you. Areas you added are never
touched, and an area you deleted stays deleted.

## Recolor

Changing an area's color only affects notes tagged with it from then on; notes already tagged keep
the `#color` they were given at assignment time. The **Recolor** tab has a button that re-stamps
`#color` on every note whose own `#area` names a listed area, using that area's current color (an
area with no color has `#color` removed instead). It reads the saved config, so save your color
changes first. Notes that only inherit `#area` are left alone, since they inherit `#color` too, and
notes whose `#area` names no listed area are reported as skipped rather than changed.

## Missing Areas

The **Missing Areas** tab lists every non-hidden note that has no `#area` label, one at a time —
title, tree path, a content preview, and a button per enabled area to assign it on the spot.
Assigning an area drops the note from the list; "Start over" replays it from the top. The same
triage queue is also its own page, on its own launcher note, for reaching it without the rest of the
settings.

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
