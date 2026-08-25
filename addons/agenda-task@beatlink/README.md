# Agenda Task

A right-pane widget for a note's start/due dates, duration, recurrence, and an Actions section with
Complete Task and a row of reschedule buttons. Split out from `agenda@beatlink` (which still ships
Overview and Note Actions) so Task can be installed, updated, and configured independently — the two
addons no longer share any code or settings.

Dates and Duration and Actions are collapsible disclosures, open by default. Recurrence is a single
button reading the current rule back in plain English ("Every 2 weeks on Monday", or "Does not
repeat"); clicking it opens the recurrence picker in a popover.

## How it works

The widget appears in the right pane on any note whose type is marked actionable (`#agendaTaskWidget`
inheritable label, set by the item's template). It edits four kinds of note labels — start/due
datetime, duration, recurrence — via configurable label names, plus fires `agenda:tasksChanged` after
any change so `agenda@beatlink`'s Overview widget (if installed) re-files the note.

Completing a task with a recurrence rolls its start date forward instead of leaving it done; the
reschedule buttons offer a configurable set of quick date jumps (fixed days-from-now or a recurrence
rule evaluated from now). The stock set is Today, Tomorrow, Next Weekend (`FREQ=WEEKLY;BYDAY=SA`) and
End of Month (`FREQ=MONTHLY;BYMONTHDAY=-1`).

## Configuration

Task owns its own settings note (`taskSchema.json`/`taskDefaults.json`/`taskConfig.json`) tagged `#agendaTaskConfig` — the label
names it reads/writes (start/due date/time, duration, recurrence) and the reschedule buttons' option
registry. Its own **Task Settings** page (TAM's "Addon Settings" button) is the only place that edits
it.

## Independence from agenda@beatlink

Task used to live inside `agenda@beatlink` (`task/` folder), sharing its `#agendaConfig` settings note.
The two are now fully decoupled in both directions: neither ships the other's code, neither reads the
other's settings note, and neither declares the other as a TAM dependency. Either one runs on its own.

What they still share is a vocabulary, not a wire:

| Convention | Who writes it | Who reads it |
|---|---|---|
| start/due datetime + recurrence label names | this addon | `agenda@beatlink` and `agenda-myday@beatlink`, each from their own copy of the setting |
| `durationDisplay` / `recurrenceDisplay` | this addon | `agenda@beatlink`'s overview columns, if installed |
| `agenda:tasksChanged` (`api.triggerEvent`) | this addon, after any change | `agenda@beatlink`'s Overview, if installed |
| `#agendaTaskWidget` (inheritable, from the item's template) | `template-picker@beatlink`'s templates | this addon, to decide whether the pane shows |

The cost of that independence: renaming a label name here means renaming it in each other installed
addon that reads it. Nothing detects the drift for you.

## Upgrading from 2.x

Version 3.0.0 removes the one-time migration that copied label names and Reschedule Options out of
`agenda@beatlink`'s `#agendaConfig` note. Any install that ran a 2.x version at least once has already
migrated and is unaffected. Installing 3.0.0 fresh onto a pre-4.0.0 agenda gets the default label names
instead of the old shared ones — re-enter them on the Task Settings page if you had customized them.
