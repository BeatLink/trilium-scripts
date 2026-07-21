// === Trilium Code note ===
// Title: dimensions.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by the Organize page, the Task widget and
// the overview libs).
//
// The single source of truth for agenda's classification axes. A "dimension" is
// one note label plus its ordered vocabulary of values — area, type and priority
// ship as defaults, but the set is open-ended: anything registered in agenda's
// `dimensions` config gets a Task-pane picker, an Organize triage queue, a sort
// ordinal, and a derived prefix/color/grouping/filter variant, with no code
// change.
//
// Agenda OWNS this vocabulary. It used to be discovered at runtime from three
// other addons (area-picker's #areaConfig, template-picker's
// #templatePickerConfig, priority-widget's #priorityConfig), with the same
// ~9-line discovery block hand-copied six times and the vocabularies duplicated
// again inside agenda's own prefixes/colors/groupings/filters. Those addons are
// now fully independent; agenda no longer reads them at all.
//
// Value order is the registry's own key order, so a value's stored key carries
// no ordinal and reordering the vocabulary never rewrites a tagged note.
// getSortValueMaps resolves order for the sort layer instead.

const { loadSettings, saveSettings } = require("libSettingsUI.jsx")

// Normalize the `dimensions` registry into the array shape the callers use:
// [{ id, name, label, writeColor, picker, triage, actionableOnly,
//    scaffoldsAreas, scaffoldsBuckets, values: [{ key, name, color,
//    templateNoteId, actionable, icon }] }]
//
// Registry ids are libsettings-generated and meaningless — `key` is the stored
// note value. Dimensions with no label, and values with no key, are dropped:
// they are half-filled rows in the settings form, not vocabulary.
function normalizeDimensions(settings) {
    return Object.entries(settings.dimensions || {})
        .filter(([, dim]) => dim && dim.label)
        .map(([id, dim]) => ({
            id,
            name: dim.name || dim.label,
            label: dim.label,
            writeColor: !!dim.writeColor,
            picker: dim.picker !== false,
            triage: dim.triage !== false,
            actionableOnly: !!dim.actionableOnly,
            scaffoldsAreas: !!dim.scaffoldsAreas,
            scaffoldsBuckets: !!dim.scaffoldsBuckets,
            values: Object.values(dim.values || {})
                .filter(v => v && v.key)
                .map(v => ({
                    key: v.key,
                    name: v.name || v.key,
                    color: v.color || "",
                    templateNoteId: v.templateNoteId || "",
                    actionable: !!v.actionable,
                    icon: v.icon || ""
                }))
        }))
}

// Resolve agenda's own settings note ids. Same #agendaConfig discovery
// agendaSettings.jsx uses; duplicated here (rather than imported) to keep this
// module free of a require() on the .jsx tree — it loads in every widget.
async function getDimensionConfigIds() {
    const anchors = await api.searchForNotes("#agendaConfig")
    if (!anchors.length) return null
    const anchor = anchors[0]
    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("configNote")
    if (!schemaNoteId || !configNoteId) return null
    return { schemaNoteId, configNoteId }
}

// The registered dimensions, in config order. Returns [] when agenda's config
// isn't discoverable, so callers degrade to "no dimensions" rather than throw.
async function getDimensions() {
    const ids = await getDimensionConfigIds()
    if (!ids) return []
    return normalizeDimensions(await loadSettings(ids.schemaNoteId, ids.configNoteId))
}

// Ordinal maps for sorting, in libMultisort's `valueMaps` shape:
// { attribute: { value: ordinal } }.
//
// Dimension values are stable, order-free keys ("career", "task"), so sorting
// them as strings yields alphabetical rather than the configured order. The
// order is resolved here from each value's position in its dimension, keyed by
// the dimension's LABEL (the attribute notes are actually tagged with), so a
// newly registered dimension sorts correctly with no further wiring.
//
// Accepts a pre-loaded dimension list to avoid a second settings round-trip;
// loads them itself when called with no argument (libAgendaQuery's call site).
async function getSortValueMaps(dimensions) {
    const dims = dimensions || await getDimensions()
    const maps = {}
    for (const dim of dims) {
        if (!dim.values.length) continue
        const map = {}
        dim.values.forEach((value, index) => { map[value.key] = index })
        maps[dim.label] = map
    }
    return maps
}

// Assign (or clear, when `value` is null) one dimension's value on a note.
// Replaces the old assignArea / assignPriority / assignTemplate trio.
//
// Two optional per-dimension behaviours:
//   writeColor       mirror the value's colour onto #color, tinting the tree
//   templateNoteId   also set ~template (only the `type` dimension uses this)
//
// Deliberate asymmetry: clearing does NOT remove ~template. The template drives
// the note's promoted attributes and its editor; dropping a classification
// label should not strip the note's whole shape out from under it.
async function assignDimension(noteId, dimension, value) {
    return api.runOnBackend((noteId, label, writeColor, key, color, templateNoteId) => {
        const note = api.getNote(noteId)
        if (!note) return false
        if (key) {
            note.setLabel(label, key)
            if (writeColor) {
                if (color) note.setLabel("color", color)
                else note.removeLabel("color")
            }
            if (templateNoteId) note.setRelation("template", templateNoteId)
        } else {
            note.removeLabel(label)
            if (writeColor) note.removeLabel("color")
        }
        return true
    }, [
        noteId,
        dimension.label,
        dimension.writeColor,
        (value && value.key) || "",
        (value && value.color) || "",
        (value && value.templateNoteId) || ""
    ])
}

// Fill in each value's templateNoteId by matching its Name against the title of
// a #template note, and persist the result.
//
// Note ids are install-specific, so schema.json cannot ship them — a fresh
// install would otherwise assign a type without ever setting ~template. Called
// at the end of provisioning (so a fresh install self-heals) and exposed as a
// button in the Dimensions settings panel for re-running after a rename.
//
// Only fills BLANK ids, so a hand-picked template note is never overwritten by a
// title collision. Returns the number of values matched.
async function matchTemplatesByName() {
    const ids = await getDimensionConfigIds()
    if (!ids) return 0

    const settings = await loadSettings(ids.schemaNoteId, ids.configNoteId)
    const names = []
    for (const dim of Object.values(settings.dimensions || {})) {
        for (const value of Object.values((dim && dim.values) || {})) {
            if (value && value.name && !value.templateNoteId) names.push(value.name)
        }
    }
    if (!names.length) return 0

    const byName = await api.runOnBackend((names) => {
        const out = {}
        for (const name of names) {
            const results = api.searchForNotes(`#template note.title = "${name}"`)
            if (results.length) out[name] = results[0].noteId
        }
        return out
    }, [names])

    let matched = 0
    for (const dim of Object.values(settings.dimensions || {})) {
        for (const value of Object.values((dim && dim.values) || {})) {
            if (!value || !value.name || value.templateNoteId) continue
            const noteId = byName[value.name]
            if (!noteId) continue
            value.templateNoteId = noteId
            matched++
        }
    }
    if (matched) await saveSettings(ids.schemaNoteId, ids.configNoteId, settings)
    return matched
}

module.exports = {
    normalizeDimensions,
    getDimensions,
    getSortValueMaps,
    assignDimension,
    matchTemplatesByName
}
