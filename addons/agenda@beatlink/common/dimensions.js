// === Trilium Code note ===
// Title: dimensions.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by the Organize page and the overview
// libs).
//
// The single source of truth for agenda's classification axes. A "dimension" is
// one note label plus its ordered vocabulary of values — area and priority ship
// as defaults, but the set is open-ended: anything registered in agenda's
// `dimensions` config gets an Organize triage queue, a sort ordinal, and a
// derived prefix/color/grouping/filter variant, with no code change.
//
// Agenda OWNS this vocabulary. It used to be discovered at runtime from three
// other addons (area-picker's #areaConfig, template-picker's
// #templatePickerConfig, priority-widget's #priorityConfig), with the same
// ~9-line discovery block hand-copied six times and the vocabularies duplicated
// again inside agenda's own prefixes/colors/groupings/filters. Those addons are
// now fully independent; agenda no longer reads them at all.
//
// There used to be a `type` dimension here too, tagging notes #type and
// separately setting ~template via each value's templateNoteId. Both are gone:
// a note's classification is now its ~template relation alone, resolved against
// template-picker@beatlink's own registry (see organize.js, which is the only
// place agenda still reads that registry — bucket scaffolding and the
// actionable-item set). Assigning a template is template-picker's own widget's
// job, not agenda's.
//
// Value order is the registry's own key order, so a value's stored key carries
// no ordinal and reordering the vocabulary never rewrites a tagged note.
// getSortValueMaps resolves order for the sort layer instead.

const { loadSettings } = require("libSettingsUI.jsx")

// Normalize the `dimensions` registry into the array shape the callers use:
// [{ id, name, label, writeColor, triage, actionableOnly,
//    scaffoldsAreas, values: [{ key, name, color, actionable, icon }] }]
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
            triage: dim.triage !== false,
            actionableOnly: !!dim.actionableOnly,
            scaffoldsAreas: !!dim.scaffoldsAreas,
            values: Object.values(dim.values || {})
                .filter(v => v && v.key)
                .map(v => ({
                    key: v.key,
                    name: v.name || v.key,
                    color: v.color || "",
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
// Dimension values are stable, order-free keys ("career", "urgent"), so sorting
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
//
// One optional per-dimension behaviour: writeColor mirrors the value's colour
// onto #color, tinting the tree.
async function assignDimension(noteId, dimension, value) {
    return api.runOnBackend((noteId, label, writeColor, key, color) => {
        const note = api.getNote(noteId)
        if (!note) return false
        if (key) {
            note.setLabel(label, key)
            if (writeColor) {
                if (color) note.setLabel("color", color)
                else note.removeLabel("color")
            }
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
        (value && value.color) || ""
    ])
}

module.exports = {
    normalizeDimensions,
    getDimensions,
    getSortValueMaps,
    assignDimension
}
