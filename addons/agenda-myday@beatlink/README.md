# Agenda My Day

The My Day focus panel, split out of [`agenda@beatlink`](../agenda@beatlink/README.md) into its own
addon. It's a **right-pane widget**, visible on every note, modelled on Microsoft To Do's My Day page.

It carries:

- a list of **suggested tasks** to add to your day, grouped into **Earlier** (overdue), **Today**, and
  **Next 7 Days**. Each row has a `+` that appends the task to your My Day note as a todo item;
- a **countdown timer** with selectable durations and start / select / end sounds;
- an optional loop that **files tasks into the My Day note** as their start time arrives (every 30s);
- an optional loop that **sends a desktop notification** as each task comes due (every 15s).

## Suggestions

Candidates are the active agenda profile's tasks, bucketed by **start datetime**, falling back to
**due datetime** when no start is set. Tasks with neither date, and tasks scheduled more than a week
out, are not suggested.

A task drops off the list once it's in your day: adding it appends a reference link to the My Day
note, and any task already linked there is filtered out. The list refreshes when you add something,
when the auto-file loop runs, and whenever another agenda widget broadcasts `agenda:tasksChanged`.

## Configuration

This addon owns its own settings note (`myDaySchema.json` / `myDayConfig.json`) tagged
**`#agendaMyDayConfig`**, edited from the **My Day Editor** page:

| Setting | Effect |
|---------|--------|
| **My Day Note** | The note that collects today's tasks. Falls back to the addon's own bundled My Day note (via the `~nowNote` relation) when unset. |
| **Enable Timer Sounds** | Whether the timer plays its start / select / end sounds. |
| **Add Tasks When Due** | Append each task to the My Day note as its start time arrives. |
| **Send Due Notifications** | Send a desktop notification as each task's start time arrives. |

## Relationship to agenda@beatlink

Suggestions and the two due-task loops all answer "which tasks exist, and when are they scheduled?" —
and that question is agenda's to answer, not this addon's. All three call `getTaskList(profileContext)`,
which resolves the **active profile's** searches, filters and sorts, and all three read the
**start/due label vocabulary** (`constants`) so dates key on the same labels the Task widget writes.

So unlike a fully standalone split, this addon clones agenda's query engine in by `sourceUrl` —
`agendaSettings.jsx`, `libAgendaOverview.js`, `libAgendaQuery.js`, `libAgendaConfig.js`,
`dimensions.js`, plus `libmultisort` / `libnotification` / `libcalendar` and `agenda-task`'s
`libAgendaTask.js`. This is the same pattern `agenda@beatlink` uses to clone `agenda-task@beatlink`'s
panels.

`getMyDayContext()` in [`myDaySettings.js`](myDaySettings.js) merges this addon's own settings with
agenda's profile context in one round-trip and reports **`hasAgenda`**. When agenda isn't installed
that's `false`, and [`myDayWidget.jsx`](myDayWidget.jsx) skips the suggestion query and both polling
loops — there's no task list to poll. **The countdown timer still works**, so the panel remains useful
on its own; only the suggestions and due-task automation need agenda.
