import { loadSettings, saveSettings } from "libSettingsUI.jsx"
import { getMissingAssignmentNotes } from "pickerRegistry.jsx"

// The picker's area registry: which areas the dropdown offers, in what order.
// Keyed by registry id (stable across reorders/renames) rather than the
// area's own `key` field, so renaming a key never orphans a row.
//
// An entry: { key, title, color, enabled }. There is no order field — the
// registry's own key order is the display order (the settings form's move
// controls rewrite the key order, and libsettings preserves it through both
// the defaults merge and the save).
//
// What lands on a note is not the bare key but `label`: the key behind the
// area's 1-based registry position, zero-padded ("01-career"), so anything
// sorting or grouping by the raw #area value follows the configured order.
// The prefix is derived on read, never stored in the registry, so reordering
// areas restates every label — which is what reapplyAreaOrder is for. Reads
// go through areaKeyOf, which also accepts the bare keys written before
// prefixes existed.

// The #area value for an area at `index` in the registry.
export function areaLabelValue(key, index) {
    return `${String(index + 1).padStart(2, "0")}-${key}`
}

// The registry key inside a stored #area value, prefixed or bare.
export function areaKeyOf(value) {
    return (value || "").replace(/^\d+-/, "")
}

// Read the registry. Returns [{ id, key, label, title, color, enabled }] in
// registry order.
export async function getAreas(schemaNoteId, configNoteId) {
    const settings = await loadSettings(schemaNoteId, configNoteId)
    return Object.entries(settings.areas || {})
        .filter(([, a]) => a && a.key)
        .map(([id, a], index) => ({
            id, key: a.key, label: areaLabelValue(a.key, index),
            title: a.title || a.key, color: a.color || "", enabled: !!a.enabled
        }))
}

// Set (or clear, when `value` is falsy/"none") the #area label of one note or
// of a whole selection, mirroring the chosen area's color onto #color the same
// way template-picker's assignTemplate does. `value` is an area's `label`,
// prefix included. Shared by the picker widget and the Missing Areas triage
// page so both write through one path.
export async function assignArea(noteIds, value, color) {
    const ids = Array.isArray(noteIds) ? noteIds : [noteIds]

    return api.runOnBackend((ids, value, color) => {
        for (const noteId of ids) {
            const note = api.getNote(noteId)
            if (!note) continue
            if (value && value !== "none") {
                note.setLabel("area", value)
                if (color) note.setLabel("color", color)
                else note.removeLabel("color")
            } else {
                note.removeLabel("area")
                note.removeLabel("color")
            }
        }
        return true
    }, [ids, value || "", color || ""])
}

// Every non-hidden note lacking a #area label, minus anything matching an
// enabled exclude filter. Returns [{ noteId, title, path, preview }].
export async function getMissingAreaNotes(schemaNoteId, configNoteId) {
    return getMissingAssignmentNotes(schemaNoteId, configNoteId, "#!area", "label", "area")
}

// Re-apply every area's registry color to the notes already tagged with it, so
// a color changed in settings reaches notes assigned before the change. Only
// own #area labels count — a note inheriting one also inherits its #color, so
// stamping it here would shadow the inherited value. Notes whose #area matches
// no registry key are left alone and reported as `unknown`.
export async function recolorAreaNotes(schemaNoteId, configNoteId) {
    const areas = await getAreas(schemaNoteId, configNoteId)
    const colorsByKey = Object.fromEntries(areas.map(a => [a.key, a.color]))
    return api.runOnBackend((colorsByKey) => {
        let updated = 0, unchanged = 0, unknown = 0
        for (const note of api.searchForNotes("#area", { includeArchivedNotes: true })) {
            // areaKeyOf's body, inlined: runOnBackend ships this function alone,
            // so it can't reach anything else in this module.
            const key = (note.getOwnedLabelValue("area") || "").replace(/^\d+-/, "")
            if (!key) continue
            if (!(key in colorsByKey)) { unknown++; continue }
            const color = colorsByKey[key] || ""
            if ((note.getOwnedLabelValue("color") || "") === color) { unchanged++; continue }
            if (color) note.setLabel("color", color)
            else note.removeLabel("color")
            updated++
        }
        return { updated, unchanged, unknown }
    }, [colorsByKey])
}

// Restate the order prefix on every note already carrying an #area, matching
// on the key alone so both an outdated prefix and a bare key are brought to
// the area's current position. Notes whose key names no area keep the value
// they have and are reported as `unknown`.
export async function reapplyAreaOrder(schemaNoteId, configNoteId) {
    const areas = await getAreas(schemaNoteId, configNoteId)
    const labelsByKey = Object.fromEntries(areas.map(a => [a.key, a.label]))
    return api.runOnBackend((labelsByKey) => {
        let updated = 0, unchanged = 0, unknown = 0
        for (const note of api.searchForNotes("#area", { includeArchivedNotes: true })) {
            const value = note.getOwnedLabelValue("area")
            if (!value) continue
            const wanted = labelsByKey[value.replace(/^\d+-/, "")]
            if (!wanted) { unknown++; continue }
            if (value === wanted) { unchanged++; continue }
            note.setLabel("area", wanted)
            updated++
        }
        return { updated, unchanged, unknown }
    }, [labelsByKey])
}
