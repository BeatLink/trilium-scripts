const { loadSettings } = require("libSettings.js")
const { generateCalendar, respondWithCalendar } = require("libCalendar.js")

let schemaNoteId = api.currentNote.getRelationValue("schemaNote")
let settingsNoteId = api.currentNote.getRelationValue("settingsNote")
let configNoteId = api.getNote(settingsNoteId).getRelationValue("configNote")

let settings = loadSettings(schemaNoteId, configNoteId)

if (api.req.method === "GET") {
    if (settings.mode === "search") {
        const notes = api.searchForNotes(settings.searchQuery)
        const icalString = generateCalendar(notes, {
            startDateLabel: settings.startDateLabel,
            dueDateLabel: settings.dueDateLabel,
            recurrenceLabel: settings.recurrenceLabel
        })
        respondWithCalendar(api, icalString)
    } else {
        // Mode is "url" — the widget fetches the configured external feed
        // directly and never hits this endpoint.
        api.res.send(404)
    }
} else {
    api.res.send(400)
}
