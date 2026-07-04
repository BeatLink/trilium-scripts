// Schema-driven settings engine for backend (customRequestHandler) scripts.
// Stateless: callers pass in the noteIds of their own schema.json and config.json notes.

function loadSettings(schemaNoteId, configNoteId) {
    const schema = JSON.parse(api.getNote(schemaNoteId).getContent() || "{}")
    const stored = JSON.parse(api.getNote(configNoteId).getContent() || "{}")
    const values = {}
    for (const [key, def] of Object.entries(schema)) {
        values[key] = (key in stored) ? stored[key] : def.default
    }
    return values
}

function saveSettings(schemaNoteId, configNoteId, values) {
    const schema = JSON.parse(api.getNote(schemaNoteId).getContent() || "{}")
    const filtered = {}
    for (const key of Object.keys(schema)) {
        filtered[key] = values[key]
    }
    api.getNote(configNoteId).setContent(JSON.stringify(filtered, null, 4))
}

module.exports = { loadSettings, saveSettings }
