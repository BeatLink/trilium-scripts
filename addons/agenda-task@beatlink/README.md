# Agenda Task

A right-pane widget for a note's start/due dates, duration, recurrence, task dependencies, and an
Actions section with Complete Task and a row of reschedule buttons. Split out from `agenda@beatlink`
(which still ships Overview, My Day, and Organize) so Task can be installed, updated, and configured
independently.

Each of the four sections — Dates and Duration, Recurrence, Blocking, Actions — is a collapsible
disclosure, open by default.

## How it works

The widget appears in the right pane on any note whose type is marked actionable (`#agendaTaskWidget`
inheritable label, set by the item's template). It edits four kinds of note labels — start/due
datetime, duration, recurrence — via configurable label names, plus fires `agenda:tasksChanged` after
any change so `agenda@beatlink`'s Overview widget (if installed) re-files the note.

## Blocking

The Blocking section holds two note pickers, **Blocked By** (tasks this one waits on) and **Blocking**
(tasks waiting on this one). Both are the same stored relation seen from opposite ends: a single
multi-valued `~blockedBy` (name configurable) lives on the *blocked* note and points at each blocker,
so adding an entry under Blocking writes the relation onto the picked note rather than mirroring one.
There is no second relation to drift out of sync. Each listed entry is a click-to-remove button; the
autocomplete below adds another.

A relation exists only while the dependency is unmet — **Complete Task** drops every `~blockedBy`
pointing at the completed task, for recurring occurrences as well as one-offs. So "is this blocked?"
is just "does it still carry the relation?", which is what `agenda@beatlink`'s shipped **Blocking**
filter group tests with `~blockedBy` / `~!blockedBy`. That group ships with Unblocked enabled and
Blocked disabled, so blocked tasks stay out of the Overview until they're released; enable both for
"all". Nothing here is hardcoded into the query engine — it's ordinary profile filter config.

Completing a task with a recurrence rolls its start date forward instead of leaving it done; the
reschedule buttons offer a configurable set of quick date jumps (fixed days-from-now or a recurrence
rule evaluated from now). The stock set is Today, Tomorrow, Next Weekend (`FREQ=WEEKLY;BYDAY=SA`) and
End of Month (`FREQ=MONTHLY;BYMONTHDAY=-1`).

## Configuration

Task owns its own settings note (`schema.json`/`config.json`) tagged `#agendaTaskConfig`, independent
of `agenda@beatlink`'s `#agendaConfig` — the label names it reads/writes (start/due date/time,
duration, recurrence), the blocked-by relation name, and the reschedule buttons' option registry. This addon's own **Task Settings**
page (TAM's "Addon Settings" button) edits it directly. If `agenda@beatlink` is also installed, its
Agenda Editor embeds the same two panels (**Settings** and **Reschedule Options** tabs) instead, so
there's one editing surface either way — both read/write the same `#agendaTaskConfig` note.

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
