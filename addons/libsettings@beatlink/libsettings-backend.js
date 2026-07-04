// Schema-driven settings engine for backend (customRequestHandler) scripts.
// Stateless: callers pass in the noteIds of their own schema.json and config.json notes.

function mergeDefaults(schema, stored) {
    const values = {}
    for (const [key, def] of Object.entries(schema)) {
        if (def.type === "list") {
            const storedList = Array.isArray(stored?.[key]) ? stored[key] : (def.default ?? [])
            values[key] = storedList.map(item => mergeDefaults(def.itemSchema, item))
        } else {
            values[key] = (stored && key in stored) ? stored[key] : def.default
        }
    }
    return values
}

function filterBySchema(schema, values) {
    const filtered = {}
    for (const key of Object.keys(schema)) {
        const def = schema[key]
        if (def.type === "list") {
            const list = Array.isArray(values?.[key]) ? values[key] : []
            filtered[key] = list.map(item => filterBySchema(def.itemSchema, item))
        } else {
            filtered[key] = values[key]
        }
    }
    return filtered
}

function loadSettings(schemaNoteId, configNoteId) {
    const schema = JSON.parse(api.getNote(schemaNoteId).getContent() || "{}")
    const stored = JSON.parse(api.getNote(configNoteId).getContent() || "{}")
    return mergeDefaults(schema, stored)
}

function saveSettings(schemaNoteId, configNoteId, values) {
    const schema = JSON.parse(api.getNote(schemaNoteId).getContent() || "{}")
    const filtered = filterBySchema(schema, values)
    api.getNote(configNoteId).setContent(JSON.stringify(filtered, null, 4))
}

module.exports = { loadSettings, saveSettings }
