// === Trilium Code note ===
// Title: dimensions.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by the overview libs).
//
// The classification axes the Overview renders by. A "dimension" is one note
// label plus its ordered vocabulary of values — area and priority ship as
// defaults, but the set is open-ended: anything registered in agenda's
// `dimensions` config gets a sort ordinal and a derived prefix/color/grouping/
// filter variant, with no code change.
//
// This registry lives in agenda's own #agendaConfig note. agenda-organize@beatlink
// keeps a separate registry of the same shape in #agendaOrganizeConfig, for its
// triage queues and the flags only they need (triage, actionableOnly,
// scaffoldsAreas, writeColor). The two are independent and free to diverge:
// neither addon reads the other's config note, and assigning a value to a note is
// Organize's own job.
//
// Value order is the registry's own key order, so a value's stored key carries
// no ordinal and reordering the vocabulary never rewrites a tagged note.
// getSortValueMaps resolves order for the sort layer instead.

const { loadSettings } = require("libSettingsUI.jsx")

// Normalize the `dimensions` registry into the array shape the callers use:
// [{ id, name, label, values: [{ key, name, color }] }]
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
            values: Object.values(dim.values || {})
                .filter(v => v && v.key)
                .map(v => ({
                    key: v.key,
                    name: v.name || v.key,
                    color: v.color || ""
                }))
        }))
}

// Resolve agenda's own settings note ids, the same #agendaConfig discovery
// settings.js does; duplicated here to keep this module free of a require() on
// the .jsx tree — it loads in every widget.
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

module.exports = {
    normalizeDimensions,
    getDimensions,
    getSortValueMaps
}
