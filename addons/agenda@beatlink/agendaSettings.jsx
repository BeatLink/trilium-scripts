import { startNote } from "trilium:api"
import { loadSettings } from "libSettingsUI.jsx"

// Resolves this addon's settings into the shape every agenda library expects:
// a `constants` label-name object and a `profileContext` ({ dataNoteId,
// profileIds }) pointing at the single shared agendaData.json note. Every
// widget that needs either calls this once. Must read via `startNote` (the
// note actually running the widget script), not `api.currentNote` (whichever
// note the user currently has open) — the schemaNote/settingsNote relations
// live on the widget's own note, not on whatever's being viewed.
//
// dataNoteId is resolved indirectly through the settings note's own
// AddonData:profile relation (same pattern as configNoteId/AddonData:config)
// rather than a direct relation from every widget straight to the data note —
// a direct relation would go dangling the moment the data note is duplicated
// into persisted storage on first sync, since only the relation literally
// named AddonData:profile gets rewired to the persisted copy.
//
// builtinElementsNoteId points at builtinElements.json instead, a plain
// (non-AddonData:) relation — that note is never duplicated/persisted, so it
// gets overwritten like any other addon note on every TAM update. This is
// what lets new built-in searches/filters/sorts/prefixes/colors ship to
// existing installs: loadData/saveData in libAgendaOverview.js merge this
// note's contents with the user's own additions/edits in the persisted data
// note rather than baking built-ins into the persisted note itself.
export async function getAgendaSettings() {
    const schemaNoteId = await startNote.getRelationValue("schemaNote")
    const settingsNoteId = await startNote.getRelationValue("settingsNote")
    const settingsNote = await api.getNote(settingsNoteId)
    const configNoteId = settingsNote.getRelationValue("AddonData:config")
    const dataNoteId = settingsNote.getRelationValue("AddonData:profile")
    const builtinElementsNoteId = settingsNote.getRelationValue("builtinElementsNote")

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

    const profileContext = { dataNoteId, builtinElementsNoteId, profileIds: [settings.profileId || "default"] }

    return { constants, profileContext }
}
