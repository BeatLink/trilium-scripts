// The single place the label name and its promoted definition come from: each of the three scripts
// requires this module rather than hardcoding either value, so settings drive all of them at once.

const { loadSettings } = require("libSettings.js")

// Captured at module load: `api` here belongs to this note, so it keeps resolving to this module's
// own settings relations however deep the requiring script is.
const moduleNote = api.currentNote

function loadConfig() {
    const schemaNoteId = moduleNote.getRelationValue("schemaNote")
    const configNoteId = moduleNote.getRelationValue("configNote")
    return loadSettings(schemaNoteId, configNoteId)
}

module.exports = { loadConfig }
