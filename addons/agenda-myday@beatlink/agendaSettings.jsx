import { loadSettings } from "libSettingsUI.jsx"

// Resolves the shared agenda settings into the shape every agenda library
// expects: a `constants` label-name object and a `profileContext` ({
// schemaNoteId, configNoteId, profileIds, ... }) pointing at the single shared
// schema.json/config.json pair owned by agenda-overview@beatlink.
//
// Cross-plugin discovery: the three agenda widgets ship as three separate
// addons (overview / task / My Day), yet must read ONE live config so a profile
// or label-name edited in the Agenda Editor is seen by all of them. TAM's
// AddonData: persistence is per-addon (each addon gets its own persisted copy),
// so the widgets cannot share config via TAM relations. Instead the overview
// addon tags its settings-anchor note with `#agendaConfig`; every widget finds
// that one note by label at runtime. The anchor carries both a `schemaNote`
// relation (-> the schema note) and the `AddonData:config` relation (-> the
// persisted config note), so a single search yields both ids.
//
// Returns null when no config note is found (the overview addon, which owns it,
// isn't installed) — callers render nothing in that case.
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

    return { constants, profileContext, myDay, schemaNoteId, configNoteId, icalNoteId }
}
