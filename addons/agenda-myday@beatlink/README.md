# Agenda My Day

The My Day focus panel, split out of [`agenda@beatlink`](../agenda@beatlink/README.md) into its own
addon. It's a note-detail widget that appears inline at the top of one designated note — your My Day
note — and stays hidden everywhere else.

It carries:

- a **countdown timer** with selectable durations and start / select / end sounds;
- an optional loop that **files tasks into the My Day note** as their start time arrives (every 30s);
- an optional loop that **sends a desktop notification** as each task comes due (every 15s).

## Configuration

This addon owns its own settings note (`myDaySchema.json` / `myDayConfig.json`) tagged
**`#agendaMyDayConfig`**, edited from the **My Day Editor** page:

| Setting | Effect |
|---------|--------|
| **My Day Note** | The note the panel appears on. Falls back to the addon's own bundled My Day note (via the `~nowNote` relation) when unset. |
| **Enable Timer Sounds** | Whether the timer plays its start / select / end sounds. |
| **Add Tasks When Due** | Append each task to the My Day note as its start time arrives. |
| **Send Due Notifications** | Send a desktop notification as each task's start time arrives. |

## Relationship to agenda@beatlink

The two due-task loops answer "which tasks exist, and which are due now?" — and that question is
agenda's to answer, not this addon's. Both call `getTaskList(profileContext)`, which resolves the
**active profile's** searches, filters and sorts, and both read the **start/due label vocabulary**
(`constants`) so "due now" keys on the same labels the Task widget writes.

So unlike a fully standalone split, this addon clones agenda's query engine in by `sourceUrl` —
`agendaSettings.jsx`, `libAgendaOverview.js`, `libAgendaQuery.js`, `libAgendaConfig.js`,
`dimensions.js`, plus `libmultisort` / `libnotification` / `libcalendar` and `agenda-task`'s
`libAgendaTask.js`. This is the same pattern `agenda@beatlink` uses to clone `agenda-task@beatlink`'s
panels.

`getMyDayContext()` in [`myDaySettings.js`](myDaySettings.js) merges this addon's own settings with
agenda's profile context in one round-trip and reports **`hasAgenda`**. When agenda isn't installed
that's `false`, and [`myDayWidget.jsx`](myDayWidget.jsx) skips both polling loops — there's no task
list to poll. **The countdown timer still works**, so the panel remains useful on its own; only the
due-task automation needs agenda.
