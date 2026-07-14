# Agenda Task

The task-editing half of the [Agenda](https://github.com/BeatLink/trilium-scripts) system: a
right-pane widget for editing a task's start/due dates, duration, recurrence, and quick actions
(complete, start today/tomorrow, plus Zen Mode and Hoist).

## Usage

Give a note (or a note template) the **`#agendaTaskWidget`** label with no value; the Task widget
appears in the right pane on that note (and on notes cloned from a template carrying it). Editing any
date/duration/recurrence field and quick action broadcasts an `agenda:tasksChanged` event over
[`libipc@beatlink`](../libipc@beatlink/README.md). This widget does **not** re-file the shared
Overview Note itself — the Agenda Overview widget owns the profile context and iCal note, so it
subscribes to that event and refreshes the overview live. That keeps this addon free of any
dependency on `libagendaoverview@beatlink`.

## Mark Done launcher

On install this addon also creates a global **Mark Done** launcher button. Pressing it advances the
active note's start date to its next recurrence (using the shared config's start-date and recurrence
labels), or archives the note when it doesn't recur or its recurrence is exhausted. It reads the same
`#agendaConfig` shared configuration, so it needs Agenda Overview installed just like the widget.

## Requires Agenda Overview

This addon reads the **shared Agenda configuration** owned by `agenda-overview@beatlink` — it does
not ship its own. On mount, `agendaSettings.jsx` finds that config by searching for the
**`#agendaConfig`** label (see the [Agenda Overview README](../agenda-overview@beatlink/README.md)
for how the shared config works), giving it the label-name vocabulary and the profile context its
quick actions and overview refresh need.

Install **Agenda Overview** for this widget to have a configuration to read; without a `#agendaConfig`
note present, the widget resolves no settings and does nothing.
