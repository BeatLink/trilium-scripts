// === Trilium Code note ===
// Title: agendaTaskSettings.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by agendaTask.jsx and rescheduleOptions.jsx).
//
// Task's own settings note, tagged #agendaTaskConfig: the label constants and
// the reschedule buttons' option registry, plus the raw note ids Task needs to
// save that registry back. This addon reads no other addon's settings note -
// agenda-overview@beatlink declares the handful of task labels it needs in its
// own #agendaOverviewConfig schema, so renaming a label here means renaming it
// there too.

async function getAgendaTaskSettings() {
    const anchors = await api.searchForNotes("#agendaTaskConfig")
    if (!anchors.length) return null
    const anchor = anchors[0]

    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("configNote")
    if (!schemaNoteId || !configNoteId) return null

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
