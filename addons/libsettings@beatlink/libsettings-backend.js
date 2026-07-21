// Schema-driven settings engine for backend (customRequestHandler) scripts.
// Stateless: callers pass in the noteIds of their own schema.json and config.json notes.

function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value)
}

// A registry's `default` doubles as its *shipped* entries — schema.json is a
// normal addon-shipped note (under addonRoot, not persistenceRoot), so it gets fully
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
// A registry field can itself nest further `list`/`registry` fields in its
// `itemSchema` (e.g. a colour/prefix variant's `children`, one flat
// label-value map per variant — see libsettings@beatlink's README "Nesting"
// section). The shipped baseline for such a nested field lives inside its
// *parent item's own* shipped default (`shippedItem[key]`, e.g.
// `colors.default.priority.children`), never in the nested field's own
// schema `default` (which is only the blank starting point for a brand-new
// item added through the UI, always `{}`) — so `mergeDefaults`/
// `filterBySchema` thread a `shippedNode` parameter through every level of
// recursion instead of re-deriving "shipped" from `def.default` past the
// top level.
function mergeRegistryDefaults(itemSchema, shipped, storedWrapper) {
    const storedEntries = isPlainObject(storedWrapper?.entries) ? storedWrapper.entries : {}
    const removedIds = Array.isArray(storedWrapper?.removedIds) ? storedWrapper.removedIds : []
    const merged = {}
    for (const [id, item] of Object.entries(shipped)) {
        if (!removedIds.includes(id)) merged[id] = mergeDefaults(itemSchema, item, null)
    }
    for (const [id, item] of Object.entries(storedEntries)) {
        merged[id] = mergeDefaults(itemSchema, shipped[id] ?? null, item)
    }
    return merged
}

function filterRegistryBySchema(itemSchema, shipped, effective) {
    const entries = {}
    const removedIds = []
    for (const [id, item] of Object.entries(effective)) {
        const shippedItem = shipped[id] ?? null
        const filteredItem = filterBySchema(itemSchema, item, shippedItem)
        const shippedFiltered = shippedItem
            ? filterBySchema(itemSchema, mergeDefaults(itemSchema, shippedItem, null), shippedItem)
            : null
        if (shippedFiltered === null || JSON.stringify(shippedFiltered) !== JSON.stringify(filteredItem)) {
            entries[id] = filteredItem
        }
    }
    for (const id of Object.keys(shipped)) {
        if (!(id in effective)) removedIds.push(id)
    }
    return { entries, removedIds }
}

function mergeDefaults(schema, shippedNode, storedNode) {
    const values = {}
    for (const [key, def] of Object.entries(schema)) {
        // Keys starting with `_` are schema-level metadata (e.g. `_categories`,
        // the ordered category list SettingsForm reads), not fields — they
        // carry no per-user value, so they never enter the merged/persisted map.
        if (key.startsWith("_")) continue
        const shippedValue = (shippedNode && key in shippedNode) ? shippedNode[key] : def.default
        if (def.type === "list") {
            const storedList = Array.isArray(storedNode?.[key]) ? storedNode[key] : (shippedValue ?? [])
            values[key] = storedList.map(item => mergeDefaults(def.itemSchema, item, item))
        } else if (def.type === "registry") {
            values[key] = mergeRegistryDefaults(def.itemSchema, shippedValue || {}, storedNode?.[key])
        } else {
            values[key] = (storedNode && key in storedNode) ? storedNode[key] : shippedValue
        }
    }
    return values
}

function filterBySchema(schema, values, shippedNode) {
    const filtered = {}
    for (const key of Object.keys(schema)) {
        if (key.startsWith("_")) continue
        const def = schema[key]
        if (def.type === "list") {
            const list = Array.isArray(values?.[key]) ? values[key] : []
            filtered[key] = list.map(item => filterBySchema(def.itemSchema, item, item))
        } else if (def.type === "registry") {
            const effective = isPlainObject(values?.[key]) ? values[key] : {}
            const shippedValue = (shippedNode && key in shippedNode) ? shippedNode[key] : (def.default || {})
            filtered[key] = filterRegistryBySchema(def.itemSchema, shippedValue || {}, effective)
        } else {
            filtered[key] = values[key]
        }
    }
    return filtered
}

function loadSettings(schemaNoteId, configNoteId) {
    const schema = JSON.parse(api.getNote(schemaNoteId).getContent() || "{}")
    const stored = JSON.parse(api.getNote(configNoteId).getContent() || "{}")
    return mergeDefaults(schema, null, stored)
}

function saveSettings(schemaNoteId, configNoteId, values) {
    const schema = JSON.parse(api.getNote(schemaNoteId).getContent() || "{}")
    const filtered = filterBySchema(schema, values, null)
    api.getNote(configNoteId).setContent(JSON.stringify(filtered, null, 4))
}

module.exports = { loadSettings, saveSettings }
