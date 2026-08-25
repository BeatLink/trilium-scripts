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

    // The three task labels agenda itself reads (overview columns, iCal feed,
    // due notifications), declared in agenda's own schema. The rest of the task
    // vocabulary - the split date/time labels and duration - is written and read
    // only by agenda-task@beatlink, out of its own #agendaTaskConfig note.
    const constants = {
        START_DATETIME_LABEL: settings.startDatetimeLabel,
        DUE_DATETIME_LABEL: settings.dueDatetimeLabel,
        RECURRENCE_LABEL: settings.recurrenceLabel
    }

    const profileContext = {
        schemaNoteId,
        configNoteId,
        profileIds: Object.keys(settings.profiles || {}),
        overviewNoteId: settings.overviewNoteId || "",
        activeProfileId: settings.activeProfileId || ""
    }

    // The classification axes (area/type/priority and any the user adds). Handed
    // out here so callers that already load settings don't round-trip a second
    // time; dimensions.js owns the shape.
    const dimensions = normalizeDimensions(settings)

    return { constants, profileContext, dimensions, schemaNoteId, configNoteId, icalNoteId }
}
