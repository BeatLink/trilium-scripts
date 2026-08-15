// Schema-driven settings engine for backend (customRequestHandler) scripts.
// Stateless: callers pass in the noteIds of their own schema.json and config.json
// notes, and the config note's own `sourceConfig` relation chain supplies every
// lower-priority source underneath it (see libsettings-core.js for the model).
//
// The merge helpers below are duplicated from libsettings-core.js, which the
// frontend half and TAM share as a single note. Trilium only bundles a child
// module whose script env matches its parent's, so a backend script can never
// require that frontend note however the notes are wired — the two copies have
// to be changed together.

function isPlainObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value)
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// What a field holds when no source below it says anything: an `itemSchema`
// field's own `default` if it has one, otherwise its type's empty value — a
// top-level field has no `default` to fall back on, since its shipped value
// belongs in the addon's defaults source.
function fallbackFor(def) {
    if (def.default !== undefined) return def.default
    switch (def.type) {
        case "number": return 0
        case "boolean": return false
        case "list": return []
        case "registry": return {}
        default: return ""
    }
}

// Several schemas merged into one field set, ordered lowest priority first; a
// later schema wins on a duplicate key, `_`-prefixed array metadata concatenates.
function mergeSchemas(schemas) {
    const merged = {}
    for (const schema of schemas) {
        for (const [key, def] of Object.entries(schema || {})) {
            if (key.startsWith("_") && Array.isArray(def) && Array.isArray(merged[key])) {
                merged[key] = [...merged[key], ...def.filter(v => !merged[key].includes(v))]
            } else {
                merged[key] = def
            }
        }
    }
    return merged
}

// The runtime values of a whole source chain: fold each source's stored document
// over what the sources below it already resolved to.
function mergeSources(schema, storedDocs) {
    return storedDocs.reduce((base, stored) => mergeDefaults(schema, base, stored), null)
}

// A registry field is stored as `{ entries, removedIds }` rather than as the flat
// runtime map, because a source only records how it *diverges* from the sources
// below it: `entries` holds ids it adds or edits, `removedIds` the ids it drops.
// An entry a source leaves alone is never copied into it, so it keeps tracking
// whatever the layer below does with it. A plain `{ [id]: item }` map is also
// accepted, read as "these entries, nothing removed" — how a hand-written
// defaults.json states its shipped entries.
//
// A registry field can itself nest further `list`/`registry` fields in its
// `itemSchema`; the baseline for such a nested field lives inside its *parent
// item's own* base item, so `mergeDefaults`/`filterBySchema` thread a `baseNode`
// parameter through every level of recursion. Kept in lockstep with
// libsettings-core.js.
function registryEntriesOf(storedNode) {
    if (!isPlainObject(storedNode)) return { entries: {}, removedIds: [] }
    const isWrapper = isPlainObject(storedNode.entries) || Array.isArray(storedNode.removedIds)
    if (!isWrapper) return { entries: storedNode, removedIds: [] }
    return {
        entries: isPlainObject(storedNode.entries) ? storedNode.entries : {},
        removedIds: Array.isArray(storedNode.removedIds) ? storedNode.removedIds : []
    }
}

function mergeRegistryDefaults(itemSchema, base, storedNode) {
    const { entries, removedIds } = registryEntriesOf(storedNode)
    const merged = {}
    for (const [id, item] of Object.entries(base)) {
        if (!removedIds.includes(id)) merged[id] = mergeDefaults(itemSchema, item, null)
    }
    for (const [id, item] of Object.entries(entries)) {
        merged[id] = mergeDefaults(itemSchema, base[id] ?? null, item)
    }
    return merged
}

function filterRegistryBySchema(itemSchema, base, effective) {
    const entries = {}
    const removedIds = []
    for (const [id, item] of Object.entries(effective)) {
        const baseItem = base[id] ?? null
        if (baseItem && sameJson(baseItem, item)) continue
        entries[id] = filterBySchema(itemSchema, item, baseItem)
    }
    for (const id of Object.keys(base)) {
        if (!(id in effective)) removedIds.push(id)
    }
    return { entries, removedIds }
}

function mergeDefaults(schema, baseNode, storedNode) {
    const values = {}
    for (const [key, def] of Object.entries(schema)) {
        // Keys starting with `_` are schema-level metadata (e.g. `_categories`),
        // not fields — they carry no per-user value.
        if (key.startsWith("_")) continue
        const baseValue = (baseNode && key in baseNode) ? baseNode[key] : fallbackFor(def)
        if (def.type === "list") {
            const storedList = Array.isArray(storedNode?.[key]) ? storedNode[key] : (baseValue ?? [])
            values[key] = storedList.map(item => mergeDefaults(def.itemSchema, item, item))
        } else if (def.type === "registry") {
            values[key] = mergeRegistryDefaults(def.itemSchema, isPlainObject(baseValue) ? baseValue : {}, storedNode?.[key])
        } else {
            values[key] = (storedNode && key in storedNode) ? storedNode[key] : baseValue
        }
    }
    return values
}

// The document one source stores: only what it changes about the sources below
// it, so a value the base already holds keeps following that source.
function filterBySchema(schema, values, baseNode) {
    const filtered = {}
    for (const key of Object.keys(schema)) {
        if (key.startsWith("_")) continue
        const def = schema[key]
        const hasBase = !!baseNode && key in baseNode
        const baseValue = hasBase ? baseNode[key] : fallbackFor(def)
        if (def.type === "registry") {
            const effective = isPlainObject(values?.[key]) ? values[key] : {}
            const delta = filterRegistryBySchema(def.itemSchema, isPlainObject(baseValue) ? baseValue : {}, effective)
            if (Object.keys(delta.entries).length > 0 || delta.removedIds.length > 0) filtered[key] = delta
        } else if (def.type === "list") {
            // A list is stored whole rather than as a delta (its entries have no
            // stable id to reconcile by), so each item keeps every field.
            const list = Array.isArray(values?.[key]) ? values[key] : []
            const items = list.map(item => filterBySchema(def.itemSchema, item, null))
            if (!hasBase || !sameJson(baseValue, list)) filtered[key] = items
        } else if (!hasBase || !sameJson(baseValue, values[key])) {
            filtered[key] = values[key]
        }
    }
    return filtered
}

function readJson(noteId) {
    const note = noteId ? api.getNote(noteId) : null
    if (!note) return {}
    try {
        return JSON.parse(note.getContent() || "{}")
    } catch (e) {
        console.error(`libsettings: note ${noteId} does not hold valid JSON`, e)
        return {}
    }
}

// Every source under a config note, lowest priority first and the note itself
// last: each source may name further sources through its own `sourceConfig`
// relations, and its own fields through a `schemaNote` relation, so one addon's
// config can layer over another's. Depth-first and post-order, so a source is
// always read before whatever points at it; a cycle stops at the note it
// revisits.
function collectSources(configNoteId) {
    const sources = []
    const seen = new Set()
    const visit = (noteId) => {
        if (!noteId || seen.has(noteId)) return
        seen.add(noteId)
        const note = api.getNote(noteId)
        if (!note) return
        for (const relation of note.getOwnedRelations("sourceConfig")) visit(relation.value)
        sources.push({
            configNoteId: noteId,
            schema: readJson(note.getRelationValue("schemaNote")),
            stored: readJson(noteId)
        })
    }
    visit(configNoteId)
    return sources
}

// The merged schema and values of a config note's whole source chain, with
// `schemaNoteId`'s fields on top of whatever the chain itself declares.
function resolveSettings(schemaNoteId, configNoteId) {
    const sources = collectSources(configNoteId)
    const schema = mergeSchemas([...sources.map(s => s.schema), readJson(schemaNoteId)])
    return { sources, schema, values: mergeSources(schema, sources.map(s => s.stored)) }
}

function loadSettings(schemaNoteId, configNoteId) {
    return resolveSettings(schemaNoteId, configNoteId).values
}

// Writes only what `values` changes about the read-only sources below the config
// note — the config note is the one writable source in its chain.
function saveSettings(schemaNoteId, configNoteId, values) {
    const { sources, schema } = resolveSettings(schemaNoteId, configNoteId)
    const base = mergeSources(schema, sources.slice(0, -1).map(s => s.stored))
    api.getNote(configNoteId).setContent(JSON.stringify(filterBySchema(schema, values, base), null, 4))
}

module.exports = { loadSettings, saveSettings }
