# Agenda

A schema-driven, multi-profile task/agenda system for TriliumNext, in three widgets that share one
configuration.

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

## Shared configuration

The config lives in one settings note holding a `schema.json`/`config.json` pair (label-name
vocabulary, profiles, and the searches/filters/sorts/prefixes/colors/groupings/date-rules those
profiles reference). That note is tagged **`#agendaConfig`**; every widget finds it at runtime via
`agendaSettings.jsx`, so a change made in the Agenda Editor is seen by all three widgets at once.

Task edits broadcast an `agenda:tasksChanged` event over
[`libipc@beatlink`](../libipc@beatlink/README.md); the Overview widget subscribes and re-files the
overview note live.
