// Settings access and suggestion queries for agenda-myday@beatlink.
//
// My Day owns its own settings note (myDaySchema.json / myDayConfig.json) tagged
// #agendaMyDayConfig: which note shows the controls, and the three behaviour
// toggles (timer sounds, add-tasks-when-due, due notifications).
//
// It still reads agenda@beatlink's #agendaConfig for two things it cannot own:
//
//   profileContext - the active profile / searches / filters that getTaskList()
//                    resolves "which tasks exist" from. This is agenda's query
//                    engine, not a value that could be copied here.
//   constants      - the start/due label-name vocabulary, so "due now" keys on
//                    the same labels the Task widget writes.
//
// Both come from getAgendaSettings() (cloned in from agenda@beatlink). When
// agenda isn't installed that returns null, and getMyDayContext() reports
// hasAgenda: false — the countdown timer still works, but the due-task filing and
// notification loops stay off, since there is no task list to poll.

const { getAgendaSettings } = require("agendaSettings.jsx")
const { loadSettings } = require("libSettingsUI.jsx")

const DEFAULTS = {
    myDayNoteId: "",
    enableSounds: true,
    addTasksWhenDue: false,
    sendDueNotifications: true
}

// My Day's own settings note ids, or null when it isn't discoverable.
async function getMyDayConfigIds() {
    const anchors = await api.searchForNotes("#agendaMyDayConfig")
    if (!anchors.length) return null
    const anchor = anchors[0]
    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("configNote")
    if (!schemaNoteId || !configNoteId) return null
    return { schemaNoteId, configNoteId }
}

// My Day's own settings, falling back to the shipped defaults when the settings
// note can't be resolved.
async function getMyDaySettings() {
    const ids = await getMyDayConfigIds()
    if (!ids) return { ...DEFAULTS }

    const values = await loadSettings(ids.schemaNoteId, ids.configNoteId)
    return {
        myDayNoteId: values.myDayNoteId || "",
        enableSounds: values.enableSounds ?? DEFAULTS.enableSounds,
        addTasksWhenDue: values.addTasksWhenDue ?? DEFAULTS.addTasksWhenDue,
        sendDueNotifications: values.sendDueNotifications ?? DEFAULTS.sendDueNotifications
    }
}

// Everything the widget needs in one round-trip: My Day's own settings plus the
// agenda profile context / label constants the due-task loops run against.
// `hasAgenda` is false when agenda@beatlink isn't installed — callers must skip
// the polling loops in that case.
async function getMyDayContext() {
    const [myDay, agenda] = await Promise.all([
        getMyDaySettings(),
        getAgendaSettings()
    ])

    return {
        myDay,
        hasAgenda: !!agenda,
        profileContext: agenda ? agenda.profileContext : null,
        constants: agenda ? agenda.constants : null
    }
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

// Tasks from agenda's active profile that are worth adding to today, grouped
// into BUCKETS. Anything already linked on the My Day note is dropped, so a
// suggestion disappears once it is added.
async function getSuggestedTasks(profileContext, constants, myDayNoteId) {
    const { getTaskList } = require("libAgendaOverview.js")
    const taskIds = await getTaskList(profileContext)

    const myDayNote = myDayNoteId ? await api.getNote(myDayNoteId) : null
    const myDayContent = myDayNote ? await myDayNote.getContent() : ""

    const byBucket = Object.fromEntries(BUCKETS.map(bucket => [bucket.id, []]))
    for (const taskId of taskIds) {
        if (myDayContent.includes(`#root/${taskId}`)) continue

        const task = await api.getNote(taskId)
        const datetime = task.getLabelValue(constants.START_DATETIME_LABEL)
            || task.getLabelValue(constants.DUE_DATETIME_LABEL)

        const bucketId = bucketFor(datetime)
        if (bucketId) byBucket[bucketId].push({ noteId: taskId, title: task.title, datetime })
    }

    for (const tasks of Object.values(byBucket)) {
        tasks.sort((a, b) => a.datetime.localeCompare(b.datetime))
    }

    return BUCKETS
        .map(bucket => ({ ...bucket, tasks: byBucket[bucket.id] }))
        .filter(bucket => bucket.tasks.length > 0)
}

module.exports = {
    getMyDayConfigIds,
    getMyDaySettings,
    getMyDayContext,
    getSuggestedTasks,
    DEFAULTS
}
