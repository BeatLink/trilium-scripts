# Agenda Task

A right-pane widget for a note's start/due dates, duration, recurrence, and an Actions section with
Complete Task and a Reschedule dropdown. Split out from `agenda@beatlink` (which still ships Overview,
My Day, and Organize) so Task can be installed, updated, and configured independently.

## How it works

The widget appears in the right pane on any note whose type is marked actionable (`#agendaTaskWidget`
inheritable label, set by the item's template). It edits four kinds of note labels — start/due
datetime, duration, recurrence — via configurable label names, plus fires `agenda:tasksChanged` after
any change so `agenda@beatlink`'s Overview widget (if installed) re-files the note.

Completing a task with a recurrence rolls its start date forward instead of leaving it done; the
Reschedule dropdown offers a configurable set of quick date jumps (fixed days-from-now or a recurrence
rule evaluated from now).

## Configuration

Task owns its own settings note (`schema.json`/`config.json`) tagged `#agendaTaskConfig`, independent
of `agenda@beatlink`'s `#agendaConfig` — the label names it reads/writes (start/due date/time,
duration, recurrence) and the Reschedule dropdown's option registry. There's no standalone settings
page for this addon; if `agenda@beatlink` is installed, its Agenda Editor embeds Task's settings panels
(**Settings** and **Reschedule Options** tabs) via this addon's exported panel components. Without
`agenda@beatlink`, Task keeps working off schema defaults — there's just nowhere in the UI to change
them.

## Exports

Other addons (`agenda@beatlink`) reference these notes without a hard install-order dependency, via
TAM's `sourceUrl` dedup-clone: declare a note with the identical `sourceUrl` and it clones in rather
than re-fetching if this addon is already installed.

| Export | What it is |
|---|---|
| `lib-task` | `libAgendaTask.js` — complete/reschedule/refresh-display-labels logic, used by `agenda@beatlink`'s Overview query/render path. |
| `lib-recurrence` | `libRecurrence.js` — rrule parsing/formatting, required by `lib-task`. |
| `recurrence-picker` | `recurrencePicker.jsx` — the standalone recurrence editor component, reused by `reschedule-options`. |
| `reschedule-options` | `rescheduleOptions.jsx` — the Reschedule Options settings panel. |
| `task-labels-panel` | `taskLabelsPanel.jsx` — the label-name overrides settings panel. |

## Split from agenda@beatlink

Task used to live inside `agenda@beatlink` (`task/` folder), sharing its `#agendaConfig` settings note.
As of this split, Task has its own settings note and anchor tag. An existing install's first read after
updating both addons copies the old shared label/reschedule-option values into the new note
automatically (see `agendaTaskSettings.js`'s migration step) — no manual action needed.
