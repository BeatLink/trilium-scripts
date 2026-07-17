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

Two render pages implement an opinionated Collect → Organize workflow on top of the widgets above
(uses the bundled item-type templates and
[`area-picker@beatlink`](../area-picker@beatlink/README.md) for the area vocabulary):

- **Workflow Setup** — one button provisions the notebook structure by find-or-create: **Inbox**,
  **My Day**, **Agenda**, and one note per Area (the areas defined in area-picker's settings, each
  with Ideas / Goals / Routines / Projects / Future / Notes buckets below it). Every structural note
  is tagged **`#workflowNote=<key>`**
  (this addon's analogue of TAM's `#TAMFILEID`, scoped to user notes) so it can be resolved later;
  re-running adopts hand-made notes rather than duplicating, and re-keys stale `#area` slugs after an
  area reorder. See [organize/README.md](organize/README.md) for the taxonomy and provisioning model.
- **Organize** — a one-at-a-time triage queue over every note under the Inbox / Area subtrees. Five
  sections assign the missing attributes agenda reads: **template** (type), **`#area`** (+ `#color`),
  **`#priority`** (MoSCoW), and **start date** (`#startDateTime`/`#startDate`/`#startTime`), plus a
  **Misfiled Notes** fixer for notes whose area/type disagrees with where they're filed. The Morning /
  Noon / Evening / Night quick-time buttons use the times on the Agenda Editor's **Organize › Times** tab.

  Organize has no dedicated page note of its own — you pick which note hosts it via the **Organize
  Note** picker on the Agenda Editor's **Organize › Settings** tab. Selecting a note converts it into a render
  note (`~renderNote` → the Organize code note, icon `bx-sort-down`); clearing or re-picking reverts
  the previously-chosen note to a plain text note.

## Templates

Bundled under a **Templates** container note is one template per item type — 0. Ideas, 1. Goal,
2. Routine, 3. Task, 4. Future, 5. Project, 6. Note, 7. Area, 8. Special. Each carries `#template`
(so it is discoverable by Trilium and the Template Picker widget) plus a `#type` label
(`0-ideas`…`8-special`) the widgets sort and group by; the task-type templates (Routine, Task,
Future, Project) also carry `#agendaTaskWidget`, and the Area template defaults to `#viewType=list`.
Organize's provisioning resolves these by title/`#template` search at runtime, so the templates and
the widgets stay decoupled.

Template content is yours to customize — the templates are tracked via `AddonData:` relations, so a
future update that changes a default prompts an Update Review rather than overwriting your edits.

## Shared configuration

The config lives in one settings note holding a `schema.json`/`config.json` pair (label-name
vocabulary, profiles, and the searches/filters/sorts/prefixes/colors/groupings/date-rules those
profiles reference). That note is tagged **`#agendaConfig`**; every widget finds it at runtime via
`agendaSettings.jsx`, so a change made in the Agenda Editor is seen by all three widgets at once.

The Agenda Editor groups its tabs under four workflow categories — **Collect**, **Organize**,
**Review**, **Execute** — using [`libsettings@beatlink`](../libsettings@beatlink/README.md)'s category
level (`_categories` + per-field `category`). Today every configuration tab lives under **Organize**
and My Day lives under **Execute**; **Collect** and **Review** are shown but empty, reserved for
future capture/review settings.

Task edits broadcast an `agenda:tasksChanged` event over
[`libipc@beatlink`](../libipc@beatlink/README.md); the Overview widget subscribes and re-files the
overview note live.
