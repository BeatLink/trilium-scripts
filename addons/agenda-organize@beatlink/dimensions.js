// === Trilium Code note ===
// Title: dimensions.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by the Organize page).
//
// Organize's own classification axes. A "dimension" is one note label plus its
// ordered vocabulary of values — area and priority ship as defaults, but the set
// is open-ended: anything registered in this addon's `dimensions` config gets a
// triage queue and a picker on the Organize page, with no code change.
//
// This registry lives in Organize's OWN #agendaOrganizeConfig note.
// agenda-overview@beatlink keeps a separate registry of the same shape in
// #agendaOverviewConfig, for the Overview's
// derived prefix/color/grouping/filter variants and its sort ordinals. The two are
// independent and free to diverge: neither addon reads the other's config note.
//
// Value order is the registry's own key order, so a value's stored key carries no
// ordinal and reordering the vocabulary never rewrites a tagged note.

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

// Resolve Organize's settings note ids, the same #agendaOrganizeConfig discovery
// organizeSettings.js does; duplicated here to keep this module free of a
// require() on the .jsx tree.
async function getDimensionConfigIds() {
    const anchors = await api.searchForNotes("#agendaOrganizeConfig")
    if (!anchors.length) return null
    const anchor = anchors[0]
    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("configNote")
    if (!schemaNoteId || !configNoteId) return null
    return { schemaNoteId, configNoteId }
}

// The registered dimensions, in config order, or [] when the config isn't
// discoverable so callers degrade to "no dimensions" rather than throw.
async function getDimensions() {
    const ids = await getDimensionConfigIds()
    if (!ids) return []
    return normalizeDimensions(await loadSettings(ids.schemaNoteId, ids.configNoteId))
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
    assignDimension
}
