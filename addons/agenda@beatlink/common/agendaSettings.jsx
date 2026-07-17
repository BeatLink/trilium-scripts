import { loadSettings } from "libSettingsUI.jsx"

export async function getAgendaSettings() {
    const anchors = await api.searchForNotes("#agendaConfig")
    if (!anchors.length) return null
    const anchor = anchors[0]

    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("AddonData:config")
    const icalNoteId = anchor.getRelationValue("icalNote") || ""
    if (!schemaNoteId || !configNoteId) return null

    const settings = await loadSettings(schemaNoteId, configNoteId)

    const constants = {
        START_DATETIME_LABEL: settings.startDatetimeLabel,
        START_DATE_LABEL: settings.startDateLabel,
        START_TIME_LABEL: settings.startTimeLabel,
        DUE_DATETIME_LABEL: settings.dueDatetimeLabel,
        DUE_DATE_LABEL: settings.dueDateLabel,
        DUE_TIME_LABEL: settings.dueTimeLabel,
        DURATION_LABEL: settings.durationLabel,
        RECURRENCE_LABEL: settings.recurrenceLabel
    }

    const profileContext = {
        schemaNoteId,
        configNoteId,
        profileIds: Object.keys(settings.profiles || {}),
        overviewNoteId: settings.overviewNoteId || "",
        organizeNoteId: settings.organizeNoteId || "",
        activeProfileId: settings.activeProfileId || ""
    }

    const myDay = {
        myDayNoteId: settings.myDayNoteId,
        enableSounds: settings.enableSounds,
        addTasksWhenDue: settings.addTasksWhenDue,
        sendDueNotifications: settings.sendDueNotifications
    }

    const organize = {
        morningTime: settings.morningTime,
        noonTime: settings.noonTime,
        eveningTime: settings.eveningTime,
        nightTime: settings.nightTime
    }

    const collect = {
        inboxNoteId: settings.inboxNoteId || ""
    }

    return { constants, profileContext, myDay, organize, collect, schemaNoteId, configNoteId, icalNoteId }
}
