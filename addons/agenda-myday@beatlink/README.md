# Agenda My Day

The My Day focus panel, originally split out of [`agenda@beatlink`](../agenda@beatlink/README.md) and
now fully standalone. It ships **two right-pane widgets**: the main panel, shown only while the **My
Day note** is active and modelled on Microsoft To Do's My Day page, and a small **per-task panel**
shown on task notes themselves.

The main panel carries:

- a list of **suggested tasks** to add to your day, grouped into **Earlier** (overdue), **Today**, and
  **Next 7 Days**. Each row has a `+` that appends the task to your My Day note as a todo item;
- a **countdown timer** with selectable durations and start / select / end sounds;
- an optional loop that **files tasks into the My Day note** as their start time arrives (every 30s);
- an optional loop that **sends a desktop notification** as each task comes due (every 15s).

## The per-task panel

A second **My Day** panel appears in the right pane on any note carrying the **Task Label** setting
(default `#agendaTaskWidget`, the inheritable label agenda's task templates set). It holds one button:

- **Add to My Day** when the task isn't on today — files it onto the My Day note and tags it
  `#agendaMyDay`, exactly as the `+` in the suggestion list does;
- **Remove from My Day** when it is — strips the link and clears the label.

It is skipped on the My Day note itself, and stays hidden until **My Day Note** is set. Either action
broadcasts `agenda:tasksChanged`, so the suggestion list updates to match; the button also re-reads
its state on that event, which is how it follows a task completed or rescheduled elsewhere.

This lives here rather than in `agenda-task@beatlink` because everything it needs — the My Day note
id, and the add/remove pair that keeps the label and the note's links consistent — is owned by this
addon. It reaches tasks the same way the suggestion list does: through a **shared label convention**,
not a code dependency, so `agenda-task@beatlink` need not be installed.

## Visibility

The main panel renders **only when the active note is your My Day note** (the **My Day Note**
setting). Everywhere else it returns `null`. No note ships with this addon, so **the panel stays
hidden until you point that setting at a note of your own**.

The two background loops — **Add Tasks When Due** and **Send Due Notifications** — are deliberately
kept *outside* that gate, so they keep firing wherever you are in the tree. Only the suggestion query
is skipped while the panel is off screen.

## Suggestions

Candidates are the notes matched by the **Task Search** setting, bucketed by **start datetime**,
falling back to **due datetime** when no start is set. Tasks with neither date, and tasks scheduled
more than a week out, are not suggested.

A task drops off the list once it's in your day: adding it appends a reference link to the My Day
note, and any task already linked there is filtered out. The list refreshes when you add something,
when the auto-file loop runs, and whenever another agenda widget broadcasts `agenda:tasksChanged`.

## The `#agendaMyDay` label

Adding a task — from the suggestion list, the per-task panel, or the auto-file loop — tags it
**`#agendaMyDay`**. That label - not the note's content - is the record of what
is on your day; the link on the My Day note is just its visible rendering. Removing a task clears the
label again, and a tagged task stops appearing in the suggestion list.

`agenda-task@beatlink` **removes the label** when a task leaves today: on completion (a one-off is
archived, a recurring task advances to its next occurrence), on reschedule, and on a manual date edit
in the Task widget. A task moved to *later today* keeps its label, since it still belongs on today's
page.

## Pruning

Whenever My Day loads - and on every `agenda:tasksChanged` event - it checks each task linked on the
My Day note and **removes any that has lost its `#agendaMyDay` label**. That is what makes completed
and rescheduled tasks disappear from the page.

The prune is **not** gated on visibility, since tasks are usually completed from their own note
rather than from My Day. It also runs when the panel becomes visible, catching changes made while it
wasn't mounted.

Labels are checked per note rather than by searching `#agendaMyDay`, because completing a task
archives it and archived notes drop out of search results - a search would report every completed
task as untagged whether or not it ever carried the label.

Removal strips the whole entry - the enclosing `<li>` or `<p>`, never just the `<a>` - so no orphan
checkboxes remain, and only the containing `<li>` goes, so neighbouring tasks in a merged todo list
survive.

> **Note:** anything linked on the My Day note that lacks `#agendaMyDay` is removed on the next
> prune, including links you added by hand. Keep hand-written references on a different note, or tag
> them `#agendaMyDay` to make them stick.

## Configuration

Everything is edited from the **My Day Editor** page, which is also the settings anchor: it carries
the **`#agendaMyDayConfig`** label plus the `~schemaNote` / `~configNote` relations the widget follows
to find its configuration. `myDaySchema.json` sits under the editor; `myDayConfig.json` lives in the
addon's TAM persistence anchor, so your settings survive updates and reinstalls.

| Setting | Effect |
|---------|--------|
| **My Day Note** | The note that collects today's tasks. **Required** — the panel stays hidden until this is set. |
| **Enable Timer Sounds** | Whether the timer plays its start / select / end sounds. |
| **Add Tasks When Due** | Append each task to the My Day note as its start time arrives. |
| **Send Due Notifications** | Send a desktop notification as each task's start time arrives. |
| **Add Tasks To Top** | Insert new tasks at the top of the My Day note instead of the bottom. Applies to both the `+` button and the auto-file loop. |
| **Task Search** | The Trilium search deciding which notes can be suggested. Default: `(#startDateTime != "" OR #dueDateTime != "") AND not(note.parents.relations.template.title='3. Task')` |
| **Start Datetime Label** | Note label holding a task's start datetime, without the `#`. Default `startDateTime`. |
| **Due Datetime Label** | Note label holding a task's due datetime, without the `#`. Default `dueDateTime`. |
| **Task Label** | Note label marking a note as a task, without the `#`. Any note carrying it gets the per-task Add / Remove button. Default `agendaTaskWidget`. |

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
