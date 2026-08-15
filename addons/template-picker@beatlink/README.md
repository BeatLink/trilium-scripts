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
- **Bucket Icon**, if set, is used by other addons that scaffold one folder per template (a BoxIcons
  class without the leading `bx`, e.g. `bx-check`).
- **Root Note**, if set, is the container note collecting this template's notes — see
  [Bundled roots](#bundled-roots). Scan does not fill it in; point it at your root yourself.

Click **Save** to persist your changes.

Rows whose template note has been deleted are skipped automatically. If the active note's `~template`
points at a template that is disabled or not listed, the dropdown shows "⚠ Not listed" rather than
reporting the note as having no template.

Before the first scan the registry is empty, and the picker falls back to showing every `#template`
note sorted by title.

## Bundled templates

This addon ships eight ready-made templates under its own **Templates** container note, persisted so
your edits survive updates. Run **Scan** to register them in your dropdown if they aren't there
already.

When a later version changes a bundled template you have edited, TAM's **Update Review** shows both
versions and lets you choose; **Keep Mine** is the default. Your saved settings are reviewed the
same way but one setting at a time, so nothing you configured is ever replaced wholesale.

Seven are **item templates** — **Ideas**, **Goal**, **Routine**, **Task**, **Future**, **Project**,
**Note** — moved here from `agenda@beatlink` in 1.5.0.

The eighth, **AreaCollection**, is a **container** template: it carries `#viewType=list` and
`#type=areacollection`, and is meant for the per-area root notes that
[`agenda-organize@beatlink`](../agenda-organize@beatlink/README.md)'s triage queues walk. It is not
meant to be picked as an item's own type — leave its registry row **disabled**.

## Bundled roots

Since 1.9.0 the addon also ships one **root container note** per bundled item template — **Ideas Root**,
**Goal Root**, **Routine Root**, **Task Root**, **Future Root**, **Project Root**, **Note Root** —
as **children of the AreaCollection template**, so every note you create from that template gets its
own copy of the whole set. Trilium deep-duplicates a template's children into the instance, so a new
Area comes out already holding its Ideas / Goal / Routine / Task / Future / Project / Note roots,
ready to file into.

Each root is an empty text note carrying only the matching template's `#iconClass` plus
`#viewType=list`; nothing files notes into them automatically.

Two consequences of how Trilium templates work:

- The copy happens **on creation only**. Attaching `~template` to a note that already exists does not
  retroactively give it the roots — create the note from the template instead.
- The originals live under the AreaCollection template (inside the persisted **Templates** note), so
  editing one changes what *future* areas get, never the copies already made.

They stand in for the type roots that used to be provisioned for you, so the containers still exist
now that no addon scaffolds a notebook structure. Set a template's **Root Note** in the registry if
you want a single global root resolvable from the registry, and if you use
[`agenda-organize@beatlink`](../agenda-organize@beatlink/README.md), add its
`#agendaOrganizeType=<templateNoteId>` identity label to a root for its queues to see it.

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

## Upgrading from 1.4.x, if you already have agenda@beatlink installed

Version 1.5.0 takes over the seven item templates that used to ship with `agenda@beatlink`. If you
already have agenda installed, **run
[`migrate-templates-from-agenda.js`](migrate-templates-from-agenda.js) once, manually, before updating
either addon** — it re-tags your existing template notes so this addon adopts them in place instead of
agenda's next sync deleting them and this addon creating fresh blank ones. See that script's own header
comment for exact steps. A fresh install with no prior agenda has nothing to migrate.
