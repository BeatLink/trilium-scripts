# Agenda

A schema-driven, multi-profile task/agenda system for TriliumNext, in three widgets plus an Organize
workflow, all sharing one configuration.

## Widgets

- **Overview** — a right-pane widget whose per-profile search/filter/sort/prefix/color rules re-file
  the active profile's matching notes under a single shared overview note, shown as a built-in
  Trilium collection view (list/table/board). Exports the active profile's tasks as an iCal feed.
  Ships the **Agenda Editor** page that edits the whole configuration.
- **Task** — a right-pane editor shown on notes carrying the **`#agendaTaskWidget`** label (inherited
  from actionable templates): start/due dates, duration, recurrence, a configurable **Reschedule**
  dropdown, and quick actions (complete, Zen, Hoist). Classification (area, priority, item type) is
  assigned via each dimension's own dedicated picker addon
  ([`area-picker@beatlink`](../area-picker@beatlink/README.md),
  [`priority-widget@beatlink`](../priority-widget@beatlink/README.md),
  [`template-picker@beatlink`](../template-picker@beatlink/README.md)), not here. Completing a task
  advances it to its next recurrence, or archives it when the recurrence is exhausted. The Reschedule
  dropdown's entries are configured on the Agenda Editor's **Settings › Reschedule Options** tab —
  each is either a fixed number of days from now (ships with Today/Tomorrow) or the next occurrence
  (from now) of a recurrence rule, in any order you choose.
- **My Day** — a note-detail countdown timer that appears inline at the top of your designated My Day
  note. While that note is open it runs the optional background loops (append due tasks, send due
  notifications).

## Organize (GTD triage)

An opinionated Collect → Organize workflow on top of the widgets above, driven by agenda's own
open-ended **dimensions** (area and priority ship as defaults; add your own in the Dimensions tab) plus
[`template-picker@beatlink`](../template-picker@beatlink/README.md)'s registry for item type:

- **Workflow Setup** — a tab in the Agenda Editor's **Settings › Workflow Setup**: one button
  provisions the notebook structure by find-or-create: **Inbox**, **My Day**, **Agenda**, and one note
  per value of the root dimension (Area, each with a bucket per **enabled template** in
  template-picker's registry below it). Every structural note is tagged
  with its identity labels (**`#agendaOrganizeArea`** / **`#agendaOrganizeBucket`** /
  **`#agendaOrganizeSpecial`** — this addon's analogue of TAM's `#TAMFILEID`, scoped to user notes) so
  it can be resolved later; re-running adopts hand-made notes rather than duplicating, and re-keys
  stale slugs after a reorder. See [organize/README.md](organize/README.md) for the taxonomy and
  provisioning model.
- **Organize** — a two-tab page: **Triage** (a one-at-a-time queue over every note under the Inbox /
  Area subtrees, with one section per triaged dimension assigning its missing value — **`#area`** (+
  `#color`), **`#priority`** (+ `#color`), or any dimension you add —
  plus a **start date** section (`#startDateTime`/`#startDate`/`#startTime`), a **Misfiled Notes**
  fixer for notes whose area/`~template` disagrees with where they're filed, and an **Invalid Buckets**
  table listing scaffolded buckets whose area/template no longer maps to a current value,
  each row offering **Merge** into a chosen valid bucket or **Delete**. Note without a `~template` at
  all are surfaced by template-picker's own **Missing Templates** page, not here.) and
  **Dimensions** (the vocabulary itself — see below). The Morning / Noon / Evening / Night quick-time
  buttons use the times on the Agenda Editor's **Organize › Times** tab.

  Organize has no dedicated page note of its own — you pick which note hosts it via the **Organize
  Note** picker on the Agenda Editor's **Organize › Organize Note** tab. Selecting a note converts it into a render note
  (`~renderNote` → the Organize code note, icon `bx-sort-down`); clearing or re-picking reverts the
  previously-chosen note to a plain text note.

## Templates

Agenda's own **Templates** container note holds only the three structural templates the Organize
workflow scaffolds with: **AreaCollection** (an area root), **TypeCollection** (a per-template bucket
inside an area), and **Special** (the Inbox / My Day / Agenda singletons). The seven item templates —
Ideas, Goal, Routine, Task, Future, Project, Note — ship with
[`template-picker@beatlink`](../template-picker@beatlink/README.md) instead (a dependency of this
addon), since assigning them is entirely its concern now. Each carries `#template` (so it is
discoverable by Trilium and the Template Picker widget). Template content is yours to customize — every
template lives under its owning addon's `persistenceRoot`, so a future update that changes a default
prompts an Update Review rather than overwriting your edits.

Item type is no longer an agenda dimension — it's owned entirely by
[`template-picker@beatlink`](../template-picker@beatlink/README.md)'s own registry, and assigned via
its own right-pane widget (a note's `~template` relation, not a `#type` label). Agenda reads that
registry (via its **`#templatePickerConfig`** anchor) for two things only: which enabled entries get an
Organize bucket, and which entries are marked **Actionable** — those items flow through the
priority/start-date queues. There's nothing to configure on agenda's side; add/rename/reorder/enable
templates in template-picker's own settings and Organize's buckets follow on the next **Workflow
Setup** run.

Whether a note's Task editor shows at all is the separate **`#agendaTaskWidget`** label, set as an
inheritable label on the template note so notes created from it get it automatically.

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

The Agenda Editor groups its tabs under seven workflow categories — **Collect**, **Organize**,
**Review**, **Display Elements**, **Execute**, **Dimensions**, **Settings** — using
[`libsettings@beatlink`](../libsettings@beatlink/README.md)'s category level (`_categories` +
per-field `category`, plus `extraPanels` for the non-schema Workflow Setup and Organize-note tabs):

- **Collect** — the Inbox Note captures land in (preselected to Trilium's `#inbox` note; shared via
  `#agendaConfig` so collection addons can file into the same place).
- **Organize** — Times and the Organize-note picker (which note hosts the Organize triage UI).
- **Review** — Overview Note, Active Profile, Profiles, Searches, Filters (what the active profile
  shows).
- **Display Elements** — Sorts, Prefixes, Colors, Groupings, Date Rules: the reusable building blocks a
  profile references by name. Split out of Review because they're a shared library, not per-profile
  config (Date Rules in particular is the primitive Prefixes/Colors/Groupings/Filters all reference).
- **Execute** — My Day.
- **Dimensions** — the classification vocabulary registry (area, priority, any you add). The Organize
  page embeds this same registry on its own **Dimensions** tab. Item type lives in
  template-picker@beatlink's own settings instead, not here.
- **Settings** — the label-name vocabulary (grouped into **Start** / **Due** / **Task** sub-groups via
  libsettings' `subgroup`), the Workflow Setup tab (provision button), and Reschedule Options (the
  Task pane's Reschedule dropdown entries — a custom panel, `rescheduleOptions.jsx`, since a
  recurrence-mode entry needs the same rich picker the Task pane's own Recurrence section uses, not a
  raw rrule text box).

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

## Upgrading from 2.x

Version 3.0.0 removes the `type` dimension entirely and requires
[`template-picker@beatlink`](../template-picker@beatlink/README.md) as a dependency. Item
classification is now purely a note's `~template` relation; agenda no longer writes `#type`. The seven
item templates (Ideas/Goal/Routine/Task/Future/Project/Note) moved out of agenda's own manifest into
template-picker's — **if you already have agenda installed, run
[`template-picker@beatlink/migrate-templates-from-agenda.js`](../template-picker@beatlink/migrate-templates-from-agenda.js)
once, manually, before updating**, or TAM's next sync will delete your existing (possibly customized)
template notes and recreate blank ones under template-picker instead. See that script's own header
comment for exact steps. Notes that only ever carried `#type` (never `~template`) aren't automatically
migrated — they'll surface in template-picker's **Missing Templates** page for manual re-triage.
