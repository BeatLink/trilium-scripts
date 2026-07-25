// Settings access for agenda-myday@beatlink.
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

module.exports = {
    getMyDayConfigIds,
    getMyDaySettings,
    getMyDayContext,
    DEFAULTS
}
