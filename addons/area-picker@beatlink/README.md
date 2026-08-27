# Area Picker

A right-pane widget that lets you assign or change the area of the currently active note — or of a
whole note-tree selection at once — plus a Missing Areas page that finds every note that still
doesn't have one.

## Configuring the area list

Open the addon's settings note — from the launcher, or with the cog button in the picker widget's
header — and use the **Areas** tab to add, remove, reorder, rename, or recolor areas:

- **Enabled** controls whether an area appears in the dropdown and in the Missing Areas page.
- **Row order** is the dropdown order. Use each row's move-up/move-down controls to rearrange.
- **Key** is the stable identifier behind the stored `#area` value. Renaming it after notes are
  already tagged orphans their `#area` label.
- **Title** is the text shown in the dropdown.
- **Color**, if set, is mirrored onto `#color` whenever this area is assigned.

Click **Save** to persist your changes.

If the active note's `#area` label points at a key that is disabled or not listed, the dropdown shows
"⚠ Invalid: \<key\>" rather than reporting the note as having no area.

## Assigning to several notes at once

Select notes in the note tree (ctrl-click, shift-click) and the picker retargets at the selection,
the way Trilium's own bulk actions do: its header reports how many notes are in play, and picking an
area writes it to all of them in one go. With nothing selected it stays on the active note. Targets
that currently disagree show a "— Mixed —" entry rather than letting one note's area stand in for
the rest, and notes caught by an exclude filter drop out of the selection, so the count is what
actually gets written.

### What updates do to your areas

Thirteen areas ship with the addon. Each one keeps tracking future versions for as long as you leave
it alone: if a later version renames or recolors one, the change reaches your install on the next
update without asking. Once you edit an area it is yours, and is never overwritten. Should a later
version change that same area, TAM's **Update Review** shows your version against the new one, one
area at a time, and asks which you want rather than deciding for you. Areas you added are never
touched, and an area you deleted stays deleted.

## What lands on a note

Assigning an area writes its position in the list in front of the key: the seventh area, keyed
`career`, tags the note `#area=07-career`, and mirrors that area's color onto `#color`. The prefix
is what makes anything that sorts or groups by the raw label — a board view, a saved search, a
sorted child list — follow your configured order instead of the alphabet. It is derived from the
list itself and never stored in the config, so moving an area changes what later assignments write.

## Maintenance

The picker writes the color and the prefix only at assignment time, so notes tagged earlier keep
whatever they were given. The **Maintenance** tab restates both on the notes you already have. Each
button reports how many notes it changed, how many were already correct, and how many it skipped;
both read the saved config, so save your changes in the **Areas** tab first.

- **Recolor tagged notes** sets `#color` on every note whose own `#area` names a listed area, to
  that area's current color (an area with no color has `#color` removed instead).
- **Reapply order to tagged notes** rewrites those notes' `#area` to the area's current prefixed
  value. It matches on the key alone, so `career`, `03-career` and `07-career` all land on the
  current `NN-career` — outdated prefixes and notes tagged before prefixes existed are both covered.

Notes that only inherit `#area` are left alone, since they inherit `#color` too, and notes whose
`#area` names no listed area keep what they have and are reported as skipped.

## Missing Areas

The **Missing Areas** tab lists every non-hidden note that has no `#area` label, one at a time —
title, tree path, a content preview, and a button per enabled area to assign it on the spot.
Assigning an area drops the note from the list; "Start over" replays it from the top. The same
triage queue is also its own page, on its own launcher note, for reaching it without the rest of the
settings.

## Exclude Filters

The **Exclude Filters** tab holds a registry of named Trilium search queries. A note matching any
**enabled** filter's query is dropped from what the picker writes to and skipped by the Missing
Areas list — use this
for notes that intentionally never get an area (e.g. `note.type = code` or a specific subtree). A
filter with a blank query is ignored; an unparseable query is skipped rather than breaking the rest.

## Upgrading to 4.x labels

Before this version the picker stored the bare key (`#area=career`). Those notes keep working — the
widget, the triage queue and both maintenance actions read prefixed and bare values alike — but they
sort by name until you run **Reapply order** once.

What the prefix does break is anything of your own that matches the exact value: a saved search or
exclude filter written as `#area = career` wants `#area %= '\d+-career'` (or just `#area *= career`),
and other addons that read `#area` see the new value too. `agenda@beatlink` is the one to check: its
`dimensions` registry deliberately stores order-free keys and `agenda-organize@beatlink` compares
`#area` against them, so its triage queues will read prefixed notes as misfiled and offer to write
the bare key back. Keep the two apart, or give agenda's area values the same prefixes.

## Upgrading from 2.5.x

The `areas` setting changed from a plain ordered list to a registry (stable per-row id, an Enabled
toggle, Add/Remove controls), matching how `template-picker@beatlink`'s Templates tab works. If you
already have areas configured, **run
[`migrate-areas-config.js`](migrate-areas-config.js) once, manually, before updating** — it converts
your existing `areas` config in place so your customized areas, colors, and order survive. See that
script's own header comment for exact steps. A fresh install with no prior config has nothing to
migrate.
