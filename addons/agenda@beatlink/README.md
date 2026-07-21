# Agenda

A schema-driven, multi-profile task/agenda system for TriliumNext, in three widgets plus an Organize
workflow, all sharing one configuration.

## Widgets

- **Overview** — a right-pane widget whose per-profile search/filter/sort/prefix/color rules re-file
  the active profile's matching notes under a single shared overview note, shown as a built-in
  Trilium collection view (list/table/board). Exports the active profile's tasks as an iCal feed.
  Ships the **Agenda Editor** page that edits the whole configuration.
- **Task** — a right-pane editor that appears on any note carrying the **`#agendaTaskWidget`** label,
  for editing a task's classification (one dropdown per dimension — area, type, priority, or any you
  add), start/due dates, duration, recurrence, and quick actions (complete, start today/tomorrow,
  Zen, Hoist). Completing a task advances it to its next recurrence, or archives it when the
  recurrence is exhausted.
- **My Day** — a note-detail countdown timer that appears inline at the top of your designated My Day
  note. While that note is open it runs the optional background loops (append due tasks, send due
  notifications).

## Organize (GTD triage)

An opinionated Collect → Organize workflow on top of the widgets above, driven by agenda's own
open-ended **dimensions** (area, type and priority ship as defaults; add your own in the Dimensions
tab):

- **Workflow Setup** — a tab in the Agenda Editor's **Settings › Workflow Setup**: one button
  provisions the notebook structure by find-or-create: **Inbox**, **My Day**, **Agenda**, and one note
  per value of the root dimension (Area, each with an Ideas / Goals / Routines / Tasks / Future /
  Projects / Notes bucket per value of the bucket dimension below it). Every structural note is tagged
  with its identity labels (**`#agendaOrganizeArea`** / **`#agendaOrganizeBucket`** /
  **`#agendaOrganizeSpecial`** — this addon's analogue of TAM's `#TAMFILEID`, scoped to user notes) so
  it can be resolved later; re-running adopts hand-made notes rather than duplicating, and re-keys
  stale slugs after a reorder. See [organize/README.md](organize/README.md) for the taxonomy and
  provisioning model.
- **Organize** — a two-tab page: **Triage** (a one-at-a-time queue over every note under the Inbox /
  Area subtrees, with one section per triaged dimension assigning its missing value — **`#area`** (+
  `#color`), **`#type`** (+ `~template`), **`#priority`** (+ `#color`), or any dimension you add —
  plus a **start date** section (`#startDateTime`/`#startDate`/`#startTime`), a **Misfiled Notes**
  fixer for notes whose area/type disagrees with where they're filed, and an **Invalid Buckets**
  table listing scaffolded buckets whose area/type slug no longer maps to a current dimension value,
  each row offering **Merge** into a chosen valid bucket or **Delete**) and
  **Dimensions** (the vocabulary itself — see below). The Morning / Noon / Evening / Night quick-time
  buttons use the times on the Agenda Editor's **Organize › Times** tab.

  Organize has no dedicated page note of its own — you pick which note hosts it via the **Organize
  Note** picker on the Agenda Editor's **Organize › Organize Note** tab. Selecting a note converts it into a render note
  (`~renderNote` → the Organize code note, icon `bx-sort-down`); clearing or re-picking reverts the
  previously-chosen note to a plain text note.

## Templates

Bundled under a **Templates** container note is one template per item type — Ideas, Goal, Routine,
Task, Future, Project, Note — plus three structural containers the Organize workflow scaffolds with:
**AreaCollection** (an area root), **TypeCollection** (a per-type bucket inside an area), and
**Special** (the Inbox / My Day / Agenda singletons). Each carries `#template` (so it is discoverable
by Trilium and the Template Picker widget). Template content is yours to customize — the templates are
tracked via `AddonData:` relations, so a future update that changes a default prompts an Update Review
rather than overwriting your edits.

Which item types the Organize workflow offers is agenda's own **type dimension** (in the Dimensions
tab), one value per type. Each value's **Name** is the bucket/dropdown label, its **Key** the stored
`#type` value, and its **Template Note** the `~template` relation assigned along with it (fill these
in with **Match Templates By Name**, which pairs each value's Name to a `#template` note by title —
Workflow Setup runs it too, so a fresh install self-heals). The value list's order sets the
assign/bucket sequence and how types sort across agenda's views.

Whether a type is **actionable** — its items flow through the priority/start-date queues — is a
per-value checkbox on the type dimension. This is separate from the **`#agendaTaskWidget`** label,
which still gates whether the Task editor *mounts* on a note; set that on the template note as before.

Priority is just another dimension, shipped by default. Any dimension can additionally mirror the
chosen value's colour onto `#color`. See [organize/README.md](organize/README.md#dimensions).

## Shared configuration

The config lives in one settings note holding a `schema.json`/`config.json` pair (label-name
vocabulary, the inbox note, the **dimensions** registry, profiles, and the
searches/filters/sorts/prefixes/colors/groupings/date-rules those profiles reference). That note is
tagged **`#agendaConfig`**; every widget finds it at runtime via `agendaSettings.jsx`, so a change made
in the Agenda Editor is seen by all three widgets at once. The prefix/color/grouping/filter variants
for each dimension are **derived** from the registry at read time, so adding a dimension yields all
four with no extra setup and they can never drift from the vocabulary.

The Agenda Editor groups its tabs under six workflow categories — **Collect**, **Organize**,
**Review**, **Execute**, **Dimensions**, **Settings** — using [`libsettings@beatlink`](../libsettings@beatlink/README.md)'s
category level (`_categories` + per-field `category`, plus `extraPanels` for the non-schema Workflow
Setup, Organize-note and Match-Templates tabs):

- **Collect** — the Inbox Note captures land in (preselected to Trilium's `#inbox` note; shared via
  `#agendaConfig` so collection addons can file into the same place).
- **Organize** — Times and the Organize-note picker (which note hosts the Organize triage UI).
- **Review** — Overview Note, Active Profile, Profiles, Searches, Filters, Sorts, Prefixes, Colors,
  Groupings, Date Rules (everything that shapes what the overview shows).
- **Execute** — My Day.
- **Dimensions** — the classification vocabulary registry, plus a **Match Templates** tab (fill each
  type value's blank Template Note by matching its Name to a `#template` title). The Organize page
  embeds this same registry on its own **Dimensions** tab.
- **Settings** — the label-name vocabulary and the Workflow Setup tab (provision button).

### Config migrations

Adding a new default dimension/sort/colour/etc. reaches existing installs for free — a registry's
`default` in `schema.json` is its *shipped* entry set, reconciled into every install on read/write, so
no migration is needed for additive changes. Reshaping data the user already owns (renaming a stored
key, moving a value between fields, dropping a field) is what [`common/migrate.js`](common/migrate.js)
handles: an ordered list of one-time transforms of the raw persisted config, gated by a
`#agendaConfigVersion` label on the `#agendaConfig` note so each step runs exactly once per install.
`getAgendaSettings()` runs any pending steps before the first read, so every widget sees migrated
config. The shipped list is empty (nothing to reshape yet); adding a step is push-one-entry +
bump the version.

Task edits broadcast an `agenda:tasksChanged` event over
[`libipc@beatlink`](../libipc@beatlink/README.md); the Overview widget subscribes and re-files the
overview note live.
