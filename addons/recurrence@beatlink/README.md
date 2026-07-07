# Recurrence

Adds a repeatable-schedule (RRULE) picker and a "Mark Done" launcher button to any note — for
recurring to-dos that don't need the full [Agenda](../agenda@beatlink/) task system.

## How it works

- A right-pane **Recurrence** widget shows an RRULE picker (interval, weekdays, day-of-month, stop
  condition) on any note that already has your configured **date label** set.
- A **Mark Done** launchbar button advances the note's date label to the next occurrence (and
  un-archives its children, for a checklist-style to-do) if it recurs, or archives the note if it
  doesn't recur or its recurrence is exhausted.

## Configuring the label names

Open this addon's settings screen (via TAM's "Settings" button) to set:

- **Date Label** — the label holding each note's start date/time (default `startDate`).
- **Recurrence Label** — the label holding each note's RRULE string (default `recurrence`).

These are configurable rather than hardcoded so this addon can sit alongside other date-labeling
conventions already in use in your own notes.

## Relationship to Agenda

This addon composes the same building blocks [`agenda@beatlink`](../agenda@beatlink/) uses
internally — [`librecurrence@beatlink`](../librecurrence@beatlink/) for RRULE parsing/conversion and
[`librecurrencepicker@beatlink`](../librecurrencepicker@beatlink/) for the picker form itself — but is
not itself a dependency of, or dependent on, Agenda. Use Agenda if you want full task scheduling
(start/due/duration, ranking, an overview list); use this addon if you just want recurrence on
ordinary notes.
