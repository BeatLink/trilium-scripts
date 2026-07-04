import { loadSettings } from "libSettingsUI.jsx"

// Resolves this addon's settings into the shape every agenda library expects:
// a `constants` label-name object and a `profileNoteIds` array. Every widget
// that needs either calls this once (it re-reads its own relations, so it
// must run with `api.currentNote` pointing at that widget's own note).
export async function getAgendaSettings() {
    const schemaNoteId = await api.currentNote.getRelationValue("schemaNote")
    const settingsNoteId = await api.currentNote.getRelationValue("settingsNote")
    const configNoteId = (await api.getNote(settingsNoteId)).getRelationValue("AddonData:config")
    const defaultProfileNoteId = await api.currentNote.getRelationValue("defaultProfileNote")

    const settings = await loadSettings(schemaNoteId, configNoteId)

    const constants = {
        START_DATETIME_LABEL: settings.startDatetimeLabel,
        START_DATE_LABEL: settings.startDateLabel,
        START_TIME_LABEL: settings.startTimeLabel,
        DUE_DATETIME_LABEL: settings.dueDatetimeLabel,
        DUE_DATE_LABEL: settings.dueDateLabel,
        DUE_TIME_LABEL: settings.dueTimeLabel,
        DURATION_LABEL: settings.durationLabel,
        RECURRENCE_LABEL: settings.recurrenceLabel,
        RANK_LABEL: settings.rankLabel
    }

    const profileNoteIds = [settings.profileId || defaultProfileNoteId]

    return { constants, profileNoteIds }
}
