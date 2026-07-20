// === Trilium Code note ===
// Title: organizePriority.js
// Type: Code -> JS Frontend
// Library only (CommonJS, require()'d by the Organize page).
//
// The priority vocabulary the Organize triage queue offers. agenda does NOT own
// it — priority-widget@beatlink does, in its own settings note (found by
// #priorityConfig, the same discovery organizeAreas.jsx uses for area-picker's
// #areaConfig and organizeTemplates.jsx uses for template-picker's).
//
// The active profile supplies BOTH halves of the vocabulary:
//   label       the note label priorities are written to (not always "priority" —
//               the bundled Color profile writes #color instead)
//   priorities  [{ key, title, color }] in display order
// Reading the label from the profile rather than hardcoding "priority" is what
// keeps the triage queue writing to the same place the picker widget reads.

const { loadSettings } = require("libSettingsUI.jsx")

// Resolve priority-widget's settings note ids. Returns null when it isn't
// installed / discoverable, so callers degrade instead of throwing.
async function getPriorityConfigIds() {
    const anchors = await api.searchForNotes("#priorityConfig")
    if (!anchors.length) return null
    const anchor = anchors[0]
    const schemaNoteId = anchor.getRelationValue("schemaNote")
    const configNoteId = anchor.getRelationValue("AddonData:config")
    if (!schemaNoteId || !configNoteId) return null
    return { schemaNoteId, configNoteId }
}

// The active priority profile as { label, options: [{ value, label, color }] },
// in display order. `options` is the shape the Organize queue's buttons render.
//
// A `selected` pointing at a deleted profile falls back to the first one, matching
// the picker widget — a stale pointer shouldn't make the queue vanish with no
// explanation. Returns null when priority-widget isn't installed, so the queue
// can explain that rather than render zero buttons.
async function getPriorityOptions() {
    const ids = await getPriorityConfigIds()
    if (!ids) return null

    const { selected, profiles } = await loadSettings(ids.schemaNoteId, ids.configNoteId)
    const profile = (profiles && profiles[selected]) || Object.values(profiles || {})[0]
    if (!profile) return null

    return {
        label: profile.label || "priority",
        options: (profile.priorities || []).map(p => ({
            value: p.key, label: p.title, color: p.color
        }))
    }
}

module.exports = { getPriorityConfigIds, getPriorityOptions }
