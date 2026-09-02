// The values the Overview widget reads. The #agendaOverviewConfig label and the
// schemaNote/configNote relations sit on the Settings note, which is the anchor
// this resolves through at runtime.
//
// CommonJS, and separate from the page that edits these values, so the widget
// pulls in the readers without the settings form's .jsx tree.

const { loadSettings } = require("libSettingsUI.jsx")
const { runMigrations } = require("migrate.js")

// The settings note's schema/config note ids, or null when the anchor (or
// either relation) is missing.
async function getConfigIds() {
    const anchors = await api.searchForNotes("#agendaOverviewConfig")
    if (!anchors.length) return null
    const anchor = anchors[0]

    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("configNote")
    if (!schemaNoteId || !configNoteId) return null
    return { anchorNoteId: anchor.noteId, schemaNoteId, configNoteId }
}

async function getAgendaSettings() {
    const ids = await getConfigIds()
    if (!ids) return null
    const { anchorNoteId, schemaNoteId, configNoteId } = ids

    // Bring an older install's persisted config up to the current shape before
    // anything reads it. Idempotent and near-free once the version is current
    // (a single label read short-circuits). See migrate.js.
    await runMigrations(anchorNoteId, configNoteId)

    const settings = await loadSettings(schemaNoteId, configNoteId)

    // The three task labels this addon reads (overview columns, iCal feed, due
    // notifications), declared in its own schema. The rest of the task
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

    return { constants, profileContext, schemaNoteId, configNoteId }
}

module.exports = { getAgendaSettings }
