// === Trilium Code note ===
// Title: dimensions.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by the Organize page).
//
// The classification axes Organize triages by, one per picker addon installed:
// area-picker@beatlink's areas and priority-widget@beatlink's levels. Nothing
// about either vocabulary is stored here - the picker owns it, this reads it
// (pickerSources.js), so a value renamed, recoloured or reordered there shows up
// in the queues immediately and the two can never drift.
//
// Item TYPE is the third axis and is handled separately in organize.js, out of
// template-picker@beatlink's registry, because a note's type is a ~template
// relation rather than a label and assigning one is that addon's own job.
//
// Install a picker and its queue appears; uninstall it and the queue leaves. A
// value's stored key is whatever its picker writes - area-picker tags the key
// behind its position ("01-career"), priority-widget tags the bare key - so
// assigning from a queue here produces exactly what assigning from the picker's
// own widget would.

const { getPickerVocabularies } = require("pickerSources.js")

// How each axis behaves in Organize, keyed by picker. These are Organize's own
// concerns rather than anything a picker declares:
//
//   scaffoldsAreas  this axis's values are the notebook's root notes, so a root
//                   is judged against this vocabulary (only area is structural)
//   actionableOnly  the queue lists only actionable-typed items, priority being
//                   about scheduling work rather than filing it
const QUEUE_BEHAVIOUR = {
    area: { scaffoldsAreas: true, actionableOnly: false },
    priority: { scaffoldsAreas: false, actionableOnly: true }
}

const PICKER_TITLES = { area: "Area", priority: "Priority" }

// The axes Organize triages by, in the order listed above, or [] when neither
// picker is installed so callers degrade to "no queues" rather than throw.
//
// Shaped the way the page has always consumed a dimension:
// [{ id, name, label, writeColor, triage, actionableOnly, scaffoldsAreas,
//    values: [{ key, name, color }] }]
async function getDimensions() {
    const vocabularies = await getPickerVocabularies(Object.keys(QUEUE_BEHAVIOUR))

    return Object.keys(QUEUE_BEHAVIOUR)
        .filter(id => vocabularies[id])
        .map(id => {
            const vocabulary = vocabularies[id]
            return {
                id,
                name: PICKER_TITLES[id],
                label: vocabulary.name,
                // Both pickers mirror the chosen value's colour onto #color when
                // they assign, so a queue assigning the same value has to too or
                // the tree tint would depend on which widget you used.
                writeColor: true,
                triage: true,
                ...QUEUE_BEHAVIOUR[id],
                values: vocabulary.values.map(value => ({
                    key: value.labelValue,
                    name: value.title,
                    color: value.color || ""
                }))
            }
        })
}

// Assign (or clear, when `value` is null) one dimension's value on a note,
// mirroring the value's colour onto #color the way both pickers' own writers do.
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
    getDimensions,
    assignDimension
}
