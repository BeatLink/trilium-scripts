# Agenda My Day

The My Day focus panel, originally split out of [`agenda@beatlink`](../agenda@beatlink/README.md) and
now fully standalone. It's a **right-pane widget**, visible on every note, modelled on Microsoft To
Do's My Day page.

It carries:

- a list of **suggested tasks** to add to your day, grouped into **Earlier** (overdue), **Today**, and
  **Next 7 Days**. Each row has a `+` that appends the task to your My Day note as a todo item;
- a **countdown timer** with selectable durations and start / select / end sounds;
- an optional loop that **files tasks into the My Day note** as their start time arrives (every 30s);
- an optional loop that **sends a desktop notification** as each task comes due (every 15s).

## Suggestions

Candidates are the notes matched by the **Task Search** setting, bucketed by **start datetime**,
falling back to **due datetime** when no start is set. Tasks with neither date, and tasks scheduled
more than a week out, are not suggested.

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
| **Task Search** | The Trilium search deciding which notes can be suggested. Default: `(#startDateTime != "" OR #dueDateTime != "") AND not(note.parents.relations.template.title='3. Task')` |
| **Start Datetime Label** | Note label holding a task's start datetime, without the `#`. Default `startDateTime`. |
| **Due Datetime Label** | Note label holding a task's due datetime, without the `#`. Default `dueDateTime`. |

## Relationship to agenda@beatlink

**None, in code.** This addon is standalone: it requires nothing from `agenda@beatlink` and works
with it uninstalled. "Which tasks exist, and when are they scheduled?" is answered by the **Task
Search** setting plus the two label-name settings, all owned here.

The defaults are chosen to match agenda's task vocabulary — `#startDateTime` / `#dueDateTime`, minus
subtasks — so if you run both, My Day suggests exactly the notes agenda manages. That coupling is a
**shared label convention**, not a code dependency: point Task Search at anything you like and My Day
follows, no agenda involved. It also still refreshes on the `agenda:tasksChanged` event when some
other addon broadcasts one, which is a no-op if nothing does.

What this trades away versus the old clone-in approach: My Day no longer follows agenda's **active
profile**, and no longer uses agenda's filter groups or recurrence-aware date rules. Plain date
windows are expressible in Trilium search (`TODAY+7`); recurrence expansion is not.
