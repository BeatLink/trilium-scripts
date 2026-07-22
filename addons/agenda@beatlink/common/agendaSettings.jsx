import { loadSettings } from "libSettingsUI.jsx"

const { normalizeDimensions } = require("dimensions.js")
const { runMigrations } = require("migrate.js")

export async function getAgendaSettings() {
    const anchors = await api.searchForNotes("#agendaConfig")
    if (!anchors.length) return null
    const anchor = anchors[0]

    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("configNote")
    const icalNoteId = anchor.getRelationValue("icalNote") || ""
    if (!schemaNoteId || !configNoteId) return null

    // Bring an older install's persisted config up to the current shape before
    // anything reads it. Idempotent and near-free once the version is current
    // (a single label read short-circuits). See migrate.js.
    await runMigrations(anchor.noteId, configNoteId)

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

    // The classification axes (area/type/priority and any the user adds). Handed
    // out here so callers that already load settings don't round-trip a second
    // time; dimensions.js owns the shape.
    const dimensions = normalizeDimensions(settings)

    // The Task pane's Reschedule dropdown entries, in config order.
    const rescheduleOptions = Object.entries(settings.rescheduleOptions || {})
        .filter(([, opt]) => opt && opt.name)
        .map(([id, opt]) => ({
            id,
            name: opt.name,
            mode: opt.mode || "days",
            days: opt.days ?? 0,
            recurrence: opt.recurrence || ""
        }))

    return { constants, profileContext, myDay, organize, collect, dimensions, rescheduleOptions, schemaNoteId, configNoteId, icalNoteId }
}
