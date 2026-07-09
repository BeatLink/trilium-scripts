// Schema-driven settings engine for backend (customRequestHandler) scripts.
// Stateless: callers pass in the noteIds of their own schema.json and config.json notes.

function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value)
}

// A registry's `default` doubles as its *shipped* entries — schema.json is a
// normal addon-shipped note (not `AddonData:`-tracked), so it gets fully
// overwritten on every TAM update just like the rest of the addon, meaning a
// newly-added shipped entry reaches existing installs for free. The
// persisted (config.json) shape for a registry field is therefore not the
// flat runtime map itself but `{ entries, removedIds }`: `entries` holds
// only additions/edits that differ from the shipped version (keyed by the
// same id to shadow a specific shipped entry), and `removedIds` records
// which shipped ids the user deleted — an untouched shipped entry is never
// duplicated into config.json, so it keeps tracking future shipped edits
// until the user actually changes it. `mergeRegistryDefaults` reconstructs
// the flat runtime map (shipped, minus removed, with entries overlaid) that
// the rest of this module and the UI both work with; `filterRegistryBySchema`
// is the inverse, run on save.
function mergeRegistryDefaults(itemSchema, shipped, storedWrapper) {
    const storedEntries = isPlainObject(storedWrapper?.entries) ? storedWrapper.entries : {}
    const removedIds = Array.isArray(storedWrapper?.removedIds) ? storedWrapper.removedIds : []
    const merged = {}
    for (const [id, item] of Object.entries(shipped)) {
        if (!removedIds.includes(id)) merged[id] = mergeDefaults(itemSchema, item)
    }
    for (const [id, item] of Object.entries(storedEntries)) {
        merged[id] = mergeDefaults(itemSchema, item)
    }
    return merged
}

function filterRegistryBySchema(itemSchema, shipped, effective) {
    const entries = {}
    const removedIds = []
    for (const [id, item] of Object.entries(effective)) {
        const filteredItem = filterBySchema(itemSchema, item)
        const shippedItem = shipped[id]
        const shippedFiltered = shippedItem ? filterBySchema(itemSchema, mergeDefaults(itemSchema, shippedItem)) : null
        if (shippedFiltered === null || JSON.stringify(shippedFiltered) !== JSON.stringify(filteredItem)) {
            entries[id] = filteredItem
        }
    }
    for (const id of Object.keys(shipped)) {
        if (!(id in effective)) removedIds.push(id)
    }
    return { entries, removedIds }
}

function mergeDefaults(schema, stored) {
    const values = {}
    for (const [key, def] of Object.entries(schema)) {
        if (def.type === "list") {
            const storedList = Array.isArray(stored?.[key]) ? stored[key] : (def.default ?? [])
            values[key] = storedList.map(item => mergeDefaults(def.itemSchema, item))
        } else if (def.type === "registry") {
            values[key] = mergeRegistryDefaults(def.itemSchema, def.default || {}, stored?.[key])
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
        } else if (def.type === "registry") {
            const effective = isPlainObject(values?.[key]) ? values[key] : {}
            filtered[key] = filterRegistryBySchema(def.itemSchema, def.default || {}, effective)
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
