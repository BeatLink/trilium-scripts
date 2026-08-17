// The schema semantics of libsettings: how an ordered chain of settings sources
// combines into the runtime values everything else works with, and how they come
// apart again on save.
//
// A *source* is one JSON config document. Sources are ordered lowest priority
// first and merged left to right, so the last one wins on conflict; the last is
// also the only writable one (everything under it is read-only context). An
// addon's own chain is normally two long — its shipped `defaults.json`, then the
// user's `config.json` — and grows when a source points at a further one, which
// is how one addon layers over another addon's config.
//
// schema.json therefore carries no top-level `default`: it describes fields
// (type, label, tabs), while values live in the sources. `default` still applies
// inside an `itemSchema`, where it seeds a field of an item created at runtime
// rather than shipping a value.
//
// This is a frontend module (`env=frontend`), shared as one note by every
// consumer's libSettingsUI.jsx *and* by TAM's own lib-tam.js — TAM produces the
// settings half of the Update Review itself and needs the identical reading of
// what "the user changed this" means. libsettings-backend.js still carries its
// own copy: Trilium only bundles a child module whose script env matches its
// parent's, so a backend script cannot require a frontend note however the
// notes are wired. Those two must stay in lockstep by hand; this file and TAM
// do not.

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

// The blank item a `list`/`registry` seeds a newly added entry from.
function blankItem(itemSchema) {
    const item = {}
    for (const [key, def] of Object.entries(itemSchema)) item[key] = fallbackFor(def)
    return item
}

// Several schemas merged into one field set, ordered lowest priority first — for
// a form that edits more than one addon's fields at once. A later schema wins on
// a duplicate key; `_`-prefixed array metadata (`_categories`) concatenates
// instead, so a merged form keeps every contributor's categories in order.
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
// below it: `entries` holds ids it adds or edits (an edit shadows the lower
// source's entry under the same id), `removedIds` the ids it drops. An entry a
// source leaves alone is never copied into it, so it keeps tracking whatever the
// layer below does with it. `mergeRegistryDefaults` reconstructs the flat runtime
// map (base, minus removed, with entries overlaid) that the rest of this module
// and the UI both work with; `filterRegistryBySchema` is the inverse, run on save.
//
// A source may also give a registry field a plain `{ [id]: item }` map instead of
// that wrapper, read as "these entries, nothing removed" — how a hand-written
// defaults.json states its shipped entries without wrapping every one of them.
//
// A registry field can itself nest further `list`/`registry` fields in its
// `itemSchema` (e.g. a colour/prefix variant's `children`, one flat label-value
// map per variant — see this library's README, "Nesting"). The baseline for such
// a nested field lives inside its *parent item's own* base item
// (`baseItem[key]`), so `mergeDefaults`/`filterBySchema` thread a `baseNode`
// parameter through every level of recursion. Kept in exact lockstep with the
// identically-named functions in libsettings-backend.js.
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
        // Keys starting with `_` are schema-level metadata (e.g. `_categories`,
        // the ordered category list SettingsForm reads), not fields — they
        // carry no per-user value, so they never enter the merged/persisted map.
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
// it. A value the base already holds is left out entirely, so it keeps following
// that source instead of freezing a copy — which is also what lets a shipped
// default the user never touched move on its own.
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

// An item's collapsed-summary title prefers an itemSchema field literally
// named `name` (matching the convention every consumer's item schema already
// uses for its display name — also what a `reference` field pointing at this
// registry shows in its own dropdown); otherwise it falls back to the first
// field's value — resolved through a `reference` field to the *referenced*
// entry's own name (rather than showing a raw reference id) when that first
// field is itself a `reference`. TAM names a reviewed entry the same way, so
// the Update Review and the form the user then opens agree on what to call it.
function titleFor(itemSchema, item, registries) {
    if ("name" in itemSchema) return item.name || "Untitled"
    const [firstKey, firstDef] = Object.entries(itemSchema)[0] || []
    if (!firstKey) return "Untitled"
    const rawValue = item[firstKey]
    if (firstDef.type === "reference") {
        const referenced = registries?.[firstDef.registry]?.[rawValue]
        return referenced?.name || rawValue || "Untitled"
    }
    return rawValue || "Untitled"
}

module.exports = {
    isPlainObject, fallbackFor, blankItem, mergeSchemas, mergeSources,
    mergeRegistryDefaults, filterRegistryBySchema, mergeDefaults, filterBySchema, titleFor
}
