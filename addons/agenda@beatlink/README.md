# Agenda

A schema-driven, multi-profile task/agenda system for TriliumNext, in three widgets plus an Organize
workflow, all sharing one configuration.

## Widgets

- **Overview** — a right-pane widget whose per-profile search/filter/sort/prefix/color rules re-file
  the active profile's matching notes under a single shared overview note, shown as a built-in
  Trilium collection view (list/table/board). Exports the active profile's tasks as an iCal feed.
  Ships the **Agenda Editor** page that edits the whole configuration.
- **Task** — a right-pane editor that appears on any note carrying the **`#agendaTaskWidget`** label,
  for editing a task's start/due dates, duration, recurrence, and quick actions (complete, start
  today/tomorrow, Zen, Hoist). Completing a task advances it to its next recurrence, or archives it
  when the recurrence is exhausted.
- **My Day** — a note-detail countdown timer that appears inline at the top of your designated My Day
  note. While that note is open it runs the optional background loops (append due tasks, send due
  notifications).

## Organize (GTD triage)

An opinionated Collect → Organize workflow on top of the widgets above (uses the bundled item-type
templates and [`area-picker@beatlink`](../area-picker@beatlink/README.md) for the area vocabulary):

- **Workflow Setup** — a tab in the Agenda Editor's **Settings › Workflow Setup**: one button
  provisions the notebook structure by find-or-create: **Inbox**, **My Day**, **Agenda**, and one note
  per Area (the areas defined in area-picker's settings, each with Ideas / Goals / Routines / Projects
  / Future / Notes buckets below it). Every structural note is tagged **`#workflowNote=<key>`** (this
  addon's analogue of TAM's `#TAMFILEID`, scoped to user notes) so it can be resolved later; re-running
  adopts hand-made notes rather than duplicating, and re-keys stale `#area` slugs after an area
  reorder. See [organize/README.md](organize/README.md) for the taxonomy and provisioning model.
- **Organize** — a two-tab page: **Triage** (a one-at-a-time queue over every note under the Inbox /
  Area subtrees, whose five sections assign the missing attributes agenda reads: **template** (type),
  **`#area`** (+ `#color`), **`#priority`** (MoSCoW), and **start date**
  (`#startDateTime`/`#startDate`/`#startTime`), plus a **Misfiled Notes** fixer for notes whose
  area/type disagrees with where they're filed) and **Templates** (manage which `#template` notes the
  workflow uses, their order, and whether each is actionable). The Morning / Noon / Evening / Night
  quick-time buttons use the times on the Agenda Editor's **Organize › Times** tab.

  Organize has no dedicated page note of its own — you pick which note hosts it via the **Organize
  Note** picker on the Agenda Editor's **Organize › Organize Note** tab. Selecting a note converts it into a render note
  (`~renderNote` → the Organize code note, icon `bx-sort-down`); clearing or re-picking reverts the
  previously-chosen note to a plain text note.

## Templates

Bundled under a **Templates** container note is one template per item type — 0. Ideas, 1. Goal,
2. Routine, 3. Task, 4. Future, 5. Project, 6. Note, 7. Area, 8. Special. Each carries `#template`
(so it is discoverable by Trilium and the Template Picker widget). Template content is yours to
customize — the templates are tracked via `AddonData:` relations, so a future update that changes a
default prompts an Update Review rather than overwriting your edits.

**Which templates the Organize workflow uses is managed, not hard-coded** — the seven item templates
(Ideas…Note) are seeded into a `templates` registry you edit on the Organize page's **Templates** tab
(also reachable under the Agenda Editor's **Organize › Templates**). Per template you set whether it's
**enabled** (offered in the assign queue + gets a scaffolding bucket), **actionable** (flows through
the priority/start-date queues + carries `#agendaTaskWidget`), and its **order** (assign/bucket
sequence + the numeric prefix of its derived `#type` sort key). A **Scan** action discovers any
`#template` note you have added and lets you opt it in. The two structural templates (7. Area,
8. Special) stay hard-coded scaffolding and aren't in the managed list. See
[organize/README.md](organize/README.md#types--user-managed-templates).

## Shared configuration

The config lives in one settings note holding a `schema.json`/`config.json` pair (label-name
vocabulary, the inbox note, the managed item templates, profiles, and the
searches/filters/sorts/prefixes/colors/groupings/date-rules those profiles reference). That note is
tagged **`#agendaConfig`**; every widget finds it at runtime via `agendaSettings.jsx`, so a change made
in the Agenda Editor is seen by all three widgets at once.

The Agenda Editor groups its tabs under five workflow categories — **Collect**, **Organize**,
**Review**, **Execute**, **Settings** — using [`libsettings@beatlink`](../libsettings@beatlink/README.md)'s
category level (`_categories` + per-field `category`, plus `extraPanels` for the non-schema Workflow
Setup tab):

- **Collect** — the Inbox Note captures land in (preselected to Trilium's `#inbox` note; shared via
  `#agendaConfig` so collection addons can file into the same place).
- **Organize** — Times, the managed Templates registry, and the Organize-note picker (which note hosts
  the Organize triage UI).
- **Review** — Overview Note, Active Profile, Profiles, Searches, Filters, Sorts, Prefixes, Colors,
  Groupings, Date Rules (everything that shapes what the overview shows).
- **Execute** — My Day.
- **Settings** — the label-name vocabulary and the Workflow Setup tab (provision button).

Task edits broadcast an `agenda:tasksChanged` event over
[`libipc@beatlink`](../libipc@beatlink/README.md); the Overview widget subscribes and re-files the
overview note live.
