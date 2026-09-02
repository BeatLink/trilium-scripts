// The sibling "picker" addons an agenda addon can take a classification
// vocabulary from, instead of keeping a copy of one: area-picker@beatlink,
// priority-widget@beatlink and template-picker@beatlink. Each owns its own
// vocabulary and its own settings note; this reads them, and never writes.
//
// Shared because more than one addon renders by these: agenda-overview@beatlink
// generates its display elements, searches, filters and sorts from them, and
// agenda-organize@beatlink generates its triage queues. One table means a picker
// that changes shape is fixed in one place rather than in each consumer.
//
// CommonJS. `read` turns a picker's settings into { kind, name, values } - kind
// being "label" or "relation" and name the attribute it tags with, which each
// picker decides for itself - or null when there is nothing to render by.

const { loadSettings } = require("libSettingsUI.jsx")

const PICKER_SOURCES = {
    area: {
        title: "Area",
        anchorLabel: "areaConfig",
        // area-picker tags a note with the area's key behind its 1-based
        // registry position, zero-padded ("01-career"); see its
        // areaRegistry.jsx, which owns that format. `index` counts entries that
        // survive the filter, exactly as it does there, or the prefixes here
        // would disagree with what the picker writes.
        defaultAttribute: { kind: "label", name: "area" },
        read(settings) {
            return {
                kind: "label",
                name: "area",
                values: Object.values(settings.areas || {})
                    .filter(area => area && area.key)
                    .map((area, index) => ({
                        labelValue: `${String(index + 1).padStart(2, "0")}-${area.key}`,
                        title: area.title || area.key,
                        color: area.color || ""
                    }))
            }
        }
    },
    priority: {
        title: "Priority",
        anchorLabel: "priorityConfig",
        defaultAttribute: { kind: "label", name: "priority" },
        // priority-widget keeps several named profiles and tags by the active
        // one, whose `label` it lets you rename - so the note label comes out of
        // the profile rather than being fixed. A `selected` pointing at a
        // deleted profile falls back to the first, the same guard its own
        // priorityRegistry.jsx applies. Levels are stored by their bare key
        // ("4-critical"), the rank being part of the key rather than a prefix.
        read(settings) {
            const profiles = settings.profiles || {}
            const profile = profiles[settings.selected] || Object.values(profiles)[0]
            if (!profile) return null
            return {
                kind: "label",
                name: profile.label || "priority",
                values: Object.values(profile.priorities || {})
                    .filter(level => level && level.key)
                    .map(level => ({
                        labelValue: level.key,
                        title: level.title || level.key,
                        color: level.color || ""
                    }))
            }
        }
    },
    template: {
        title: "Template",
        anchorLabel: "templatePickerConfig",
        defaultAttribute: { kind: "relation", name: "template" },
        // template-picker assigns a note's ~template RELATION rather than a
        // label, so its values are keyed by the template note's id - stable
        // across renames, and a valid search property (Trilium's search maps
        // `noteid`). A row whose note was deleted simply never matches; the
        // picker's own reader drops those with a backend lookup, which this
        // skips rather than pay a round-trip per load.
        // A note filed under another note of the SAME template is a part of it -
        // a task under a task is a subtask - so a search for that template skips
        // it, or the overview lists the tree rather than the work. Direct parents
        // only, matching the curated searches this replaces. Nothing equivalent
        // applies to area or priority: those group notes, they do not nest them.
        nestingExclusion(vocabulary, value) {
            return `not(note.parents.relations.${vocabulary.name}.noteId = '${value.labelValue}')`
        },
        read(settings) {
            return {
                kind: "relation",
                name: "template",
                values: Object.values(settings.templates || {})
                    .filter(entry => entry && entry.templateNoteId)
                    .map(entry => ({
                        labelValue: entry.templateNoteId,
                        title: entry.name || "",
                        color: entry.color || ""
                    }))
            }
        }
    }
}

// One picker's vocabulary, or null when that addon isn't installed (or holds
// nothing to render by), so an entry pointing at it degrades rather than errors.
async function getPickerVocabulary(sourceId) {
    const source = PICKER_SOURCES[sourceId]
    if (!source) return null

    const anchors = await api.searchForNotes(`#${source.anchorLabel}`)
    if (!anchors.length) return null
    const anchor = anchors[0]

    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("configNote")
    if (!schemaNoteId || !configNoteId) return null

    const vocabulary = source.read(await loadSettings(schemaNoteId, configNoteId))
    return vocabulary && vocabulary.values.length ? vocabulary : null
}

// The vocabulary of each named picker that resolves, read once per load. A
// picker that isn't installed is simply absent from the result, which is what
// makes every derived entry behind it disappear with it.
async function getPickerVocabularies(sourceIds) {
    const vocabularies = {}
    for (const sourceId of sourceIds) {
        const vocabulary = await getPickerVocabulary(sourceId)
        if (vocabulary) vocabularies[sourceId] = vocabulary
    }
    return vocabularies
}

module.exports = {
    PICKER_SOURCES,
    getPickerVocabulary,
    getPickerVocabularies
}
