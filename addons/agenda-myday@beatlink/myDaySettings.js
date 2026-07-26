// Settings access and suggestion queries for agenda-myday@beatlink.
//
// This addon is self-contained: it owns its settings (myDaySchema.json /
// myDayConfig.json, anchored on the #agendaMyDayConfig-tagged My Day Editor
// page) and resolves its own task list from a plain Trilium search, so nothing
// here depends on agenda@beatlink's code. Point `taskSearch` at whatever notes
// you want floated; the shipped default matches agenda's task vocabulary, so
// the two interoperate through shared label conventions, not a code dependency.

const { loadSettings } = require("libSettingsUI.jsx")
const notifications = require("libNotification.js")

const DEFAULTS = {
    myDayNoteId: "",
    enableSounds: true,
    addTasksWhenDue: false,
    sendDueNotifications: true,
    addToTop: false,
    // Dated notes, minus any note that already sits under a dated one - only the
    // outermost dated note in a subtree is worth floating.
    //
    // The ancestor test hangs off note.parents rather than note.ancestors:
    // note.ancestors compiles to DescendantOfExp, whose getSubtree() INCLUDES
    // the note itself, so `not(note.ancestors.labels.startDateTime != "")` would
    // make every dated note exclude itself and return nothing. Stepping to
    // parents first (ChildOfExp never includes self) and testing the parent and
    // its own ancestors covers every depth above without self-matching.
    taskSearch: '(#startDateTime != "" OR #dueDateTime != "") '
        + 'AND not(note.parents.labels.startDateTime != "") '
        + 'AND not(note.parents.labels.dueDateTime != "") '
        + 'AND not(note.parents.ancestors.labels.startDateTime != "") '
        + 'AND not(note.parents.ancestors.labels.dueDateTime != "")',
    startLabel: "startDateTime",
    dueLabel: "dueDateTime"
}

// My Day's own settings note ids, or null when it isn't discoverable. The
// #agendaMyDayConfig label and the schemaNote/configNote relations all sit on
// the My Day Editor page itself, so the editor is both the settings anchor and
// the UI that edits it.
async function getMyDayConfigIds() {
    const anchors = await api.searchForNotes("#agendaMyDayConfig")
    if (!anchors.length) return null
    const anchor = anchors[0]
    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("configNote")
    if (!schemaNoteId || !configNoteId) return null
    return { schemaNoteId, configNoteId }
}

// My Day's settings, falling back to the shipped defaults when the settings
// note can't be resolved.
async function getMyDaySettings() {
    const ids = await getMyDayConfigIds()
    if (!ids) return { ...DEFAULTS }

    const values = await loadSettings(ids.schemaNoteId, ids.configNoteId)
    return {
        myDayNoteId: values.myDayNoteId || "",
        enableSounds: values.enableSounds ?? DEFAULTS.enableSounds,
        addTasksWhenDue: values.addTasksWhenDue ?? DEFAULTS.addTasksWhenDue,
        sendDueNotifications: values.sendDueNotifications ?? DEFAULTS.sendDueNotifications,
        addToTop: values.addToTop ?? DEFAULTS.addToTop,
        taskSearch: values.taskSearch || DEFAULTS.taskSearch,
        startLabel: values.startLabel || DEFAULTS.startLabel,
        dueLabel: values.dueLabel || DEFAULTS.dueLabel
    }
}

// The candidate notes for suggestions and the due-task loops, as note objects.
async function getTaskNotes(settings) {
    if (!settings.taskSearch) return []
    return await api.searchForNotes(settings.taskSearch)
}

// The suggestion buckets, in the order the panel renders them. Each one keys on
// a task's start datetime, falling back to its due datetime when unset.
const BUCKETS = [
    { id: "overdue", display: "Earlier" },
    { id: "today", display: "Today" },
    { id: "soon", display: "Next 7 Days" }
]

// Which bucket a datetime falls into, or null when it is unset or further out
// than a week (undated and far-future tasks are not suggested).
//
// Buckets are calendar-day based, not clock based: anything dated today is
// "Today" even if its time has already passed. Keying "overdue" off the current
// instant instead would drop this morning's tasks into Earlier, and would put
// every date-only value (which parses as midnight) there the moment the day
// started - leaving Today empty most of the time.
function bucketFor(datetime) {
    if (!datetime) return null
    const moment = api.dayjs(datetime)
    const startOfToday = api.dayjs().startOf("day")
    if (moment.isBefore(startOfToday)) return "overdue"
    if (moment.isBefore(startOfToday.add(1, "day"))) return "today"
    if (moment.isBefore(startOfToday.add(7, "day"))) return "soon"
    return null
}

// Tasks matching the configured search that are worth adding to today, grouped
// into BUCKETS. Anything already linked on the My Day note is dropped, so a
// suggestion disappears once it is added.
async function getSuggestedTasks(settings, myDayNoteId) {
    const tasks = await getTaskNotes(settings)

    const myDayNote = myDayNoteId ? await api.getNote(myDayNoteId) : null
    const myDayContent = myDayNote ? await myDayNote.getContent() : ""

    const byBucket = Object.fromEntries(BUCKETS.map(bucket => [bucket.id, []]))
    for (const task of tasks) {
        // #agendaMyDay is the record of what is already on my day; the content
        // check stays as a fallback for links added by hand.
        if (task.hasLabel("agendaMyDay")) continue
        if (myDayContent.includes(`#root/${task.noteId}`)) continue

        const datetime = task.getLabelValue(settings.startLabel)
            || task.getLabelValue(settings.dueLabel)

        const bucketId = bucketFor(datetime)
        if (bucketId) byBucket[bucketId].push({ noteId: task.noteId, title: task.title, datetime })
    }

    for (const tasks of Object.values(byBucket)) {
        tasks.sort((a, b) => a.datetime.localeCompare(b.datetime))
    }

    return BUCKETS
        .map(bucket => ({ ...bucket, tasks: byBucket[bucket.id] }))
        .filter(bucket => bucket.tasks.length > 0)
}

// Files a link to the task onto the My Day note, skipping notes already there.
// `addToTop` prepends instead of appending.
//
// The task is tagged #agendaMyDay, which is what marks it as "on my day" - the
// note content is just the visible rendering of that. agenda-task@beatlink
// removes the label when a task is completed or rescheduled, and pruneMyDayNote()
// then drops any linked note that has lost it.
async function addTaskToMyDay(myDayNoteId, taskNoteId, renderAsTodo, addToTop = false) {
    await api.runOnBackend((myDayNoteId, taskNoteId, renderAsTodo, addToTop) => {
        const taskNote = api.getNote(taskNoteId)
        const taskLink = `<a class="reference-link" href="#root/${taskNoteId}">${taskNote.title}</a>`

        // Set before the content check: a task already linked on the note still
        // needs the label, otherwise the next prune would strip it right back out.
        taskNote.setLabel("agendaMyDay")

        const myDayNote = api.getNote(myDayNoteId)
        const myDayContent = myDayNote.getContent()
        if (myDayContent.includes(taskLink)) return

        const todoListItem =
            `<ul class="todo-list"><li data-list-item-id="${api.randomString(32)}">` +
            `<label class="todo-list__label"><input type="checkbox" disabled="disabled">` +
            `<span class="todo-list__label__description">${taskLink}</span></label></li></ul>`
        const entry = renderAsTodo ? todoListItem : `<p>${taskLink}</p>`

        myDayNote.setContent(addToTop ? entry.concat(myDayContent) : myDayContent.concat(entry))
        myDayNote.save()
    }, [myDayNoteId, taskNoteId, renderAsTodo, addToTop])
}

// Removes a task's entry from the My Day note, including its wrapper: the
// enclosing <li> when it was filed as a todo item, or the enclosing <p>
// otherwise. Stripping just the <a> would leave an orphan checkbox behind.
//
// Only the containing <li> is removed, never the whole <ul> - the editor merges
// consecutive todo items into a single list, so dropping the <ul> would take
// unrelated tasks with it. An emptied <ul> is cleaned up afterwards.
async function removeTaskFromMyDay(myDayNoteId, taskNoteId) {
    if (!myDayNoteId) return
    await api.runOnBackend((myDayNoteId, taskNoteId) => {
        // Clear the label first, and unconditionally: the note content and the
        // label have to end up consistent even when only one of them was set.
        const taskNote = api.getNote(taskNoteId)
        if (taskNote) taskNote.removeLabel("agendaMyDay")

        const myDayNote = api.getNote(myDayNoteId)
        const before = myDayNote.getContent()
        if (!before.includes(`#root/${taskNoteId}`)) return

        const linkPattern = `<a[^>]*href="#root/${taskNoteId}"[^>]*>.*?</a>`
        const after = before
            .replace(new RegExp(`<li\\b[^>]*>(?:(?!</li>).)*?${linkPattern}(?:(?!</li>).)*?</li>`, "gs"), "")
            .replace(new RegExp(`<p\\b[^>]*>(?:(?!</p>).)*?${linkPattern}(?:(?!</p>).)*?</p>`, "gs"), "")
            .replace(new RegExp(linkPattern, "gs"), "")
            .replace(/<ul class="todo-list">\s*<\/ul>/g, "")

        if (after === before) return
        myDayNote.setContent(after)
        myDayNote.save()
    }, [myDayNoteId, taskNoteId])
}

// Drops any linked task that has lost its #agendaMyDay label. The label is the
// record of "this is on my day"; the note content is just its rendering, so a
// link whose task is no longer tagged is stale and comes out.
//
// agenda-task@beatlink removes the label when a task is completed or its dates
// change, which is what makes completed and rescheduled tasks disappear here.
//
// A linked note that never had the label is left alone: hand-written links and
// plain notes on the My Day page are not this addon's to remove.
async function pruneMyDayNote(myDayNoteId) {
    if (!myDayNoteId) return
    const myDayNote = await api.getNote(myDayNoteId)
    if (!myDayNote) return
    const content = await myDayNote.getContent()

    const linkedIds = [...content.matchAll(/href="#root\/([a-zA-Z0-9_]+)"/g)].map(m => m[1])
    if (!linkedIds.length) return

    // Checked per note rather than via a #agendaMyDay search: completing a task
    // archives it, and archived notes are excluded from search results, so a
    // search would report every completed task as untagged whether or not it
    // ever carried the label.
    const stale = []
    for (const noteId of new Set(linkedIds)) {
        const note = await api.getNote(noteId)
        if (note && !note.hasLabel("agendaMyDay")) stale.push(noteId)
    }

    for (const noteId of stale) {
        await removeTaskFromMyDay(myDayNoteId, noteId)
    }
}

// Files every task whose start time is this minute onto the My Day note.
async function addDueTasksToMyDay(settings, myDayNoteId) {
    if (!myDayNoteId) return
    for (const task of await getTaskNotes(settings)) {
        const startDatetime = task.getLabelValue(settings.startLabel)
        if (startDatetime && api.dayjs().isSame(startDatetime, "minute")) {
            await addTaskToMyDay(myDayNoteId, task.noteId, true, settings.addToTop)
        }
    }
}

// Sends a desktop notification for every task whose start time is this minute.
async function sendNotificationForDueTasks(settings) {
    for (const task of await getTaskNotes(settings)) {
        const startDatetime = task.getLabelValue(settings.startLabel)
        if (startDatetime && api.dayjs().isSame(startDatetime, "minute")) {
            notifications.sendNotification(task.title, "", task.noteId)
        }
    }
}

module.exports = {
    getMyDayConfigIds,
    getMyDaySettings,
    getSuggestedTasks,
    addTaskToMyDay,
    removeTaskFromMyDay,
    pruneMyDayNote,
    addDueTasksToMyDay,
    sendNotificationForDueTasks,
    DEFAULTS
}
