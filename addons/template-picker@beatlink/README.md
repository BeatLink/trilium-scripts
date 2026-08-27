# Template Picker

A right-pane widget that lets you assign or change the template of the currently active note (or of
several notes at once), plus a Missing Templates page that finds every note that still doesn't have
one.

## How it works

The widget appears in the right pane and shows a dropdown of your configured templates. Selecting a
template sets a `~template` relation on the current note (and, if the template row has a **Color**
configured, mirrors it onto `#color`). Selecting "None" removes the relation.

Which templates appear, and in what order, is configured in the addon's settings note rather than
derived from the tree on every note switch.

## Assigning to several notes at once

Ctrl-click (or shift-click) notes in the tree to select them and the picker retargets at the whole
selection, the same way Trilium's own bulk actions do. Its header reads "Template (3 notes)" so you
can see the scope before picking, and choosing a template writes it to all of them in one go.
Clicking a note normally clears the selection and the picker goes back to that single note.

When the selected notes don't all share one template, the dropdown shows "— Mixed —"; picking a real
template replaces it everywhere. Notes matching an [exclude filter](#exclude-filters) are dropped
from the selection, so the count in the header is what will actually be written.

This needs the note tree, so it does nothing on mobile.

## Configuring templates

Open the addon's settings note — the gear button in the picker's right-pane header goes straight
there — and use the **Templates** tab:

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

This addon ships nine ready-made templates under its own **Templates** container note, persisted so
your edits survive updates. Run **Scan** to register them in your dropdown if they aren't there
already.

When a later version changes a bundled template you have edited, TAM's **Update Review** shows both
versions and lets you choose; **Keep Mine** is the default. Your saved settings are reviewed the
same way but one setting at a time, so nothing you configured is ever replaced wholesale.

Seven are **item templates** — **Ideas**, **Goal**, **Routine**, **Task**, **Future**, **Project**,
**Note** — moved here from `agenda@beatlink` in 1.5.0.

**Link** (added in 1.14.0) is a saved web page: a **Web View** note whose `#webViewSrc` and `#url`
labels hold the address, which is the note shape
[`web-preview@beatlink`](../web-preview@beatlink/README.md) drives its toolbar from and the
Web2Trilium browser extension writes when it saves a bookmark or tab. Creating a note from it gives
you an empty Web View note with both labels settable as fields; fill in the address and the page
loads inline. Assigning it to an *existing* note only adds the labels — Trilium takes a note's type
from its template at creation time, so switch the note's type to Web View yourself.

The last one, **AreaCollection**, is a **container** template: it carries `#viewType=list` and
`#type=areacollection`, and is meant for the per-area root notes that
[`agenda-organize@beatlink`](../agenda-organize@beatlink/README.md)'s triage queues walk. It is not
meant to be picked as an item's own type — leave its registry row **disabled**.

## Bundled roots

The addon also ships one **root container note** per bundled item template — **Ideas**, **Goals**,
**Routines**, **Tasks**, **Future**, **Projects**, **Notes**, **Links** — inside the persisted **Templates**
container, beside the templates themselves.

Each root is an empty text note carrying the matching template's `#iconClass`, `#viewType=list`, and
a `#label:area=single` promoted-attribute definition (the same one the templates carry), so `#area`
is a settable field on the root itself. Nothing files notes into them automatically.

Since 1.13.0 they are no longer children of the AreaCollection template, so a note created from that
template does not come out holding its own copy of the set — move or copy a root where you want it.

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
**enabled** filter's query is dropped from the picker widget (which hides entirely when every note it
would target is excluded) and from the Missing Templates list — use
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
