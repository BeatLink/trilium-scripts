// === Trilium Code note ===
// Title: agendaTaskSettings.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by agendaTask.jsx and rescheduleOptions.jsx).
//
// Task's own settings note, tagged #agendaTaskConfig, separate from the rest
// of agenda's #agendaConfig note: just the label constants and the Reschedule
// dropdown's option registry, plus the raw note ids Task needs to save that
// registry back. Everything else (profiles, My Day, Organize times,
// dimensions, ...) lives in agendaSettings.jsx/#agendaConfig and is
// deliberately out of reach here.
//
// One-time migration: these fields used to live in the shared #agendaConfig
// note. On an install that predates the split, the first read here copies
// their values out of the old note into this one, then stamps
// #agendaTaskConfigVersion so it never runs again. A fresh install (or one
// already past the split) has nothing to copy and just stamps straight away.

const TASK_CONFIG_VERSION_LABEL = "agendaTaskConfigVersion"
const LEGACY_FIELDS = [
    "startDatetimeLabel", "startDateLabel", "startTimeLabel",
    "dueDatetimeLabel", "dueDateLabel", "dueTimeLabel",
    "durationLabel", "recurrenceLabel", "rescheduleOptions"
]

async function migrateFromSharedConfig(anchorNoteId, schemaNoteId, configNoteId) {
    const already = await api.runOnBackend((id) => {
        const note = api.getNote(id)
        return note ? note.getLabelValue("agendaTaskConfigVersion") : null
    }, [anchorNoteId])
    if (already) return

    const { loadSettings, saveSettings } = require("libSettingsUI.jsx")

    const legacyAnchors = await api.searchForNotes("#agendaConfig")
    if (legacyAnchors.length) {
        const legacyAnchor = legacyAnchors[0]
        const legacySchemaNoteId = legacyAnchor.getRelationValue("schemaNote")
        const legacyConfigNoteId = legacyAnchor.getRelationValue("configNote")
        if (legacySchemaNoteId && legacyConfigNoteId) {
            const legacySettings = await loadSettings(legacySchemaNoteId, legacyConfigNoteId)
            const hasLegacyData = LEGACY_FIELDS.some(key => key in legacySettings)
            if (hasLegacyData) {
                const values = await loadSettings(schemaNoteId, configNoteId)
                for (const key of LEGACY_FIELDS) {
                    if (key in legacySettings) values[key] = legacySettings[key]
                }
                await saveSettings(schemaNoteId, configNoteId, values)
            }
        }
    }

    await api.runOnBackend((id) => {
        const note = api.getNote(id)
        if (note) note.setLabel("agendaTaskConfigVersion", "1")
    }, [anchorNoteId])
}

async function getAgendaTaskSettings() {
    const anchors = await api.searchForNotes("#agendaTaskConfig")
    if (!anchors.length) return null
    const anchor = anchors[0]

    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("configNote")
    if (!schemaNoteId || !configNoteId) return null

    await migrateFromSharedConfig(anchor.noteId, schemaNoteId, configNoteId)

    const { loadSettings } = require("libSettingsUI.jsx")
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

    const rescheduleOptions = Object.entries(settings.rescheduleOptions || {})
        .filter(([, opt]) => opt && opt.name)
        .map(([id, opt]) => ({
            id,
            name: opt.name,
            mode: opt.mode || "days",
            days: opt.days ?? 0,
            recurrence: opt.recurrence || ""
        }))

    return { constants, rescheduleOptions, schemaNoteId, configNoteId }
}

module.exports = { getAgendaTaskSettings }
