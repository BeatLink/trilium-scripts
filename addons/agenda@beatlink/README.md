# Agenda

A schema-driven, multi-profile task/agenda system for TriliumNext, in two widgets sharing one
configuration. The Task widget (start/due dates, duration, recurrence,
Complete/Reschedule actions) is a separate addon, [`agenda-task@beatlink`](../agenda-task@beatlink/README.md)
— install it alongside this one for the full Task pane. The two are fully independent: this addon ships
none of that addon's code and reads none of its settings, and vice versa. They interoperate only through
note-label conventions and the `agenda:tasksChanged` event. The My Day focus panel is likewise its own addon,
[`agenda-myday@beatlink`](../agenda-myday@beatlink/README.md), and the GTD Organize workflow is
[`agenda-organize@beatlink`](../agenda-organize@beatlink/README.md).

## Widgets

- **Overview** — a right-pane widget whose per-profile search/filter/sort/prefix/color rules re-file
  the active profile's matching notes under a single shared overview note, shown as a built-in
  Trilium collection view (list/table/board). Exports the active profile's tasks as an iCal feed.
  Ships the **Agenda Editor** page that edits the whole configuration.
- **Note Actions** — a right-pane widget shown on every note with two quick actions, Zen Mode and
  Hoist Note, independent of the Task widget's actionable-note gating.
My Day (the note-detail countdown timer, and the optional loops that append due tasks and send due
notifications) moved to [`agenda-myday@beatlink`](../agenda-myday@beatlink/README.md). It clones this
addon's overview/query libraries to resolve which tasks are due from the active profile.

## Organize (GTD triage)

The opinionated Collect → Organize workflow (notebook provisioning + the triage page) is now a
separate addon, [`agenda-organize@beatlink`](../agenda-organize@beatlink/README.md) — install it
alongside this one for the full GTD flow.

It owns its own settings note (`#agendaOrganizeConfig`: the Organize-note picker and the quick-times)
and its own **Organize Editor** page, so those tabs are no longer in the Agenda Editor. It reads the
**`dimensions`** registry back out of this addon's `#agendaConfig`, because Overview's derived
prefix/color/grouping/filter variants come from the same list Organize's triage queues write to — one
registry, no drift. Editing that vocabulary still happens here, in the Agenda Editor's **Dimensions**
tab (and is mirrored on Organize's own Dimensions tab).

## Templates

The three structural templates the Organize workflow scaffolds with — **AreaCollection** (an area
root), **TypeCollection** (a per-template bucket inside an area), and **Special** (the Inbox / My Day /
Agenda singletons) — moved to [`agenda-organize@beatlink`](../agenda-organize@beatlink/README.md)
along with the provisioner that creates them. The item templates — Ideas, Goal, Routine, Task, Future,
Project, Note — ship with [`template-picker@beatlink`](../template-picker@beatlink/README.md) instead
(a dependency of this addon), since assigning them is entirely its concern now. Each carries
`#template` (so it is discoverable by Trilium and the Template Picker widget). Template content is
yours to customize — every template lives under its owning addon's `persistenceRoot`, so a future
update that changes a default prompts an Update Review rather than overwriting your edits.

Item type is no longer an agenda dimension — it's owned entirely by
[`template-picker@beatlink`](../template-picker@beatlink/README.md)'s own registry, and assigned via
its own right-pane widget (a note's `~template` relation, not a `#type` label).
[`agenda-organize@beatlink`](../agenda-organize@beatlink/README.md) reads that registry (via its
**`#templatePickerConfig`** anchor) for two things only: which enabled entries get an Organize bucket,
and which entries are marked **Actionable** — those items flow through the priority/start-date queues.
There's nothing to configure on agenda's side; add/rename/reorder/enable templates in
template-picker's own settings and Organize's buckets follow on the next **Workflow Setup** run.

Whether a note's Task editor shows at all (if [`agenda-task@beatlink`](../agenda-task@beatlink/README.md)
is installed) is the separate **`#agendaTaskWidget`** label, set as an inheritable label on the
template note so notes created from it get it automatically.

Priority is just another dimension, shipped by default. Any dimension can additionally mirror the
chosen value's colour onto `#color`. See [agenda-organize@beatlink](../agenda-organize@beatlink/README.md#2-dimensions).

## Shared configuration

The config lives in one settings note holding a `schema.json`/`config.json` pair (the inbox note, the
**dimensions** registry, profiles, and the searches/filters/sorts/prefixes/colors/groupings/date-rules
those profiles reference). That note is tagged **`#agendaConfig`**; every widget in this addon finds it
at runtime via `agendaSettings.jsx`, so a change made in the Agenda Editor is seen by all of them at
once. The prefix/color/grouping/filter variants for each dimension are **derived** from the registry at
read time, so adding a dimension yields all four with no extra setup and they can never drift from the
vocabulary.

The three task label names this addon reads — start datetime, due datetime, recurrence — are declared
in its own `schema.json` under **Settings**. [`agenda-task@beatlink`](../agenda-task@beatlink/README.md)
declares its own copy of that vocabulary in its own `#agendaTaskConfig` note, and
[`agenda-myday@beatlink`](../agenda-myday@beatlink/README.md) does the same. Renaming a label means
renaming it in each installed addon that reads it; in exchange none of them reads another's config note
or ships another's code.

The Agenda Editor groups its tabs under five workflow categories — **Collect**, **Review**,
**Display Elements**, **Dimensions**, **Settings** — using
[`libsettings@beatlink`](../libsettings@beatlink/README.md)'s category level (`_categories` +
per-field `category`):

- **Collect** — the Inbox Note captures land in (preselected to Trilium's `#inbox` note; shared via
  `#agendaConfig` so collection addons can file into the same place).
- **Review** — Overview Note, Active Profile, Profiles, Searches, Filters (what the active profile
  shows).
- **Display Elements** — Sorts, Prefixes, Colors, Groupings, Date Rules: the reusable building blocks a
  profile references by name. Split out of Review because they're a shared library, not per-profile
  config (Date Rules in particular is the primitive Prefixes/Colors/Groupings/Filters all reference).
- **Dimensions** — the classification vocabulary registry (area, priority, any you add). This addon
  owns it; [`agenda-organize@beatlink`](../agenda-organize@beatlink/README.md) reads and mirrors the
  same registry on its own **Dimensions** tab. Item type lives in template-picker@beatlink's own
  settings instead, not here.
- **Settings** — the three task label names this addon reads: start datetime, due datetime and
  recurrence. The rest of the task vocabulary (the split date/time labels, duration) and the Task pane's
  Reschedule Options are edited on [`agenda-task@beatlink`](../agenda-task@beatlink/README.md)'s own
  **Task Settings** page, reachable from TAM's "Addon Settings" button.

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

Task edits (if [`agenda-task@beatlink`](../agenda-task@beatlink/README.md) is installed) broadcast an
`agenda:tasksChanged` event via Trilium's `api.triggerEvent`/`useTriliumEvent`; the Overview widget
subscribes and re-files the overview note live.

## Upgrading from 7.x

Version 8.0.0 finishes the split started in 4.0.0: this addon no longer references
[`agenda-task@beatlink`](../agenda-task@beatlink/README.md) in any way. Three things change.

- The Agenda Editor's **Settings** category now holds this addon's own three label fields (start
  datetime, due datetime, recurrence) instead of agenda-task's panels. If you had renamed any label,
  re-enter the new names here once — this addon previously read them out of a config key that no longer
  existed, so it was matching on `undefined` and the Start/Due columns, iCal feed and due notifications
  were silently doing nothing. The full label vocabulary and Reschedule Options keep living on
  agenda-task's own **Task Settings** page.
- The Overview's **Start All Tasks Today** button is gone. It was the last caller of agenda-task's
  reschedule library; per-task reschedule buttons in the Task pane are unaffected.
- The overview no longer backfills the `durationDisplay`/`recurrenceDisplay` labels on every refile.
  The two columns stay, populated by agenda-task itself on every task edit; a task never opened in the
  Task pane since installing shows them blank until it is.

## Upgrading from 3.x

Version 4.0.0 splits the Task widget out into its own addon,
[`agenda-task@beatlink`](../agenda-task@beatlink/README.md), with its own `#agendaTaskConfig` settings
note. **Install `agenda-task@beatlink` to keep the Task pane** — this addon no longer ships it. An
existing install's label-name overrides and Reschedule Options are copied automatically into the new
settings note on `agenda-task@beatlink`'s first read after both addons are updated; no manual migration
step is needed.

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
