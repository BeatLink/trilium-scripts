import { startNote } from "trilium:api"
import { loadSettings } from "libSettingsUI.jsx"

// Resolves this addon's settings into the shape every agenda library expects:
// a `constants` label-name object and a `profileContext` ({ schemaNoteId,
// configNoteId, profileIds }) pointing at the addon's own unified
// schema.json/config.json pair (every search/filter/sort/prefix/color/date-
// rule registry and every profile all live there, schema-driven — see
// libAgendaOverview.js's README for the full shape). Every widget that needs
// any of these calls this once. Must read via `startNote` (the note actually
// running the widget script), not `api.currentNote` (whichever note the user
// currently has open) — the schemaNote/settingsNote relations live on the
// widget's own note, not on whatever's being viewed.
//
// profileIds is every id currently in the `profiles` registry (not a single
// hardcoded id) — multiple profiles are supported, and it's up to
// getMatchingProfile/getAllProfiles (in libAgendaOverview.js) to pick the
// right one(s) for a given widget instance.
export async function getAgendaSettings() {
    const schemaNoteId = await startNote.getRelationValue("schemaNote")
    const settingsNoteId = await startNote.getRelationValue("settingsNote")
    const settingsNote = await api.getNote(settingsNoteId)
    const configNoteId = settingsNote.getRelationValue("AddonData:config")

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
        activeProfileId: settings.activeProfileId || ""
    }

    // My Day flags + the note the My Day focus widget attaches to. The widget
    // renders its controls (timer, mark done) only while browsing myDayNoteId.
    const myDay = {
        myDayNoteId: settings.myDayNoteId,
        enableSounds: settings.enableSounds,
        addTasksWhenDue: settings.addTasksWhenDue,
        sendDueNotifications: settings.sendDueNotifications
    }

    return { constants, profileContext, myDay, schemaNoteId, configNoteId }
}
