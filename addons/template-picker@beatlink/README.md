# Template Picker

A right-pane widget that lets you assign or change the template of the currently active note, plus a
Missing Templates page that finds every note that still doesn't have one.

## How it works

The widget appears in the right pane and shows a dropdown of your configured templates. Selecting a
template sets a `~template` relation on the current note (and, if the template row has a **Color**
configured, mirrors it onto `#color`). Selecting "None" removes the relation.

Which templates appear, and in what order, is configured in the addon's settings note rather than
derived from the tree on every note switch.

## Configuring templates

Open the addon's settings note and use the **Templates** tab:

- **Scan for templates** (its own tab) searches the tree for every `#template` note and adds a row for
  any not already listed, enabled, at the end of the list. Existing rows keep their name, enabled
  state, and position, so scanning again after adding a template is safe.
- **Enabled** controls whether a template appears in the dropdown and in the Missing Templates page.
- **Row order** is the dropdown order. Use each row's move-up/move-down controls to rearrange.
- **Name** is the text shown in the dropdown. It defaults to the template note's title and editing it
  does not rename the note.
- **Color**, if set, is mirrored onto `#color` whenever this template is assigned.
- **Actionable** marks this template's notes as representing actionable work — for other addons that
  key off it rather than owning their own type vocabulary.

Click **Save** to persist your changes.

Rows whose template note has been deleted are skipped automatically. If the active note's `~template`
points at a template that is disabled or not listed, the dropdown shows "⚠ Not listed" rather than
reporting the note as having no template.

Before the first scan the registry is empty, and the picker falls back to showing every `#template`
note sorted by title.

## Missing Templates

A separate page (its own launcher note, "Missing Templates") lists every non-hidden note that has no
`~template` relation, one at a time — title, tree path, a content preview, and a button per enabled
template to assign it on the spot. `#template` notes themselves are never listed. Assigning a template
drops the note from the list; "Start over" replays it from the top.

## Exclude Filters

The **Exclude Filters** tab holds a registry of named Trilium search queries. A note matching any
**enabled** filter's query is hidden from both the picker widget and the Missing Templates list — use
this for notes that intentionally never get a template (e.g. `note.type = code` or a specific subtree).
A filter with a blank query is ignored; an unparseable query is skipped rather than breaking the rest.

## Upgrading from 1.0.x

The `#noTemplatePicker` label is no longer read. To hide a template, scan once and untick its
**Enabled** box.
