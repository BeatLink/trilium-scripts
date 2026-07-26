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
function bucketFor(datetime) {
    if (!datetime) return null
    const moment = api.dayjs(datetime)
    if (moment.isBefore(api.dayjs())) return "overdue"
    if (moment.isBefore(api.dayjs().endOf("day"))) return "today"
    if (moment.isBefore(api.dayjs().startOf("day").add(7, "day"))) return "soon"
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
async function addTaskToMyDay(myDayNoteId, taskNoteId, renderAsTodo, addToTop = false) {
    await api.runOnBackend((myDayNoteId, taskNoteId, renderAsTodo, addToTop) => {
        const taskNote = api.getNote(taskNoteId)
        const taskLink = `<a class="reference-link" href="#root/${taskNoteId}">${taskNote.title}</a>`

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
    addDueTasksToMyDay,
    sendNotificationForDueTasks,
    DEFAULTS
}
