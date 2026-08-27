import { loadSettings, saveSettings } from "libSettingsUI.jsx"
import { getMissingAssignmentNotes } from "pickerRegistry.jsx"

// The picker's area registry: which areas the dropdown offers, in what order.
// Keyed by registry id (stable across reorders/renames) rather than the
// area's own `key` field, so renaming a key never orphans a row.
//
// An entry: { key, title, color, enabled }. There is no order field — the
// registry's own key order is the display order (the settings form's move
// controls rewrite the key order, and libsettings preserves it through both
// the defaults merge and the save), so ordering is never a number to
// reconcile.

// Read the registry. Returns [{ id, key, title, color, enabled }] in registry
// order.
export async function getAreas(schemaNoteId, configNoteId) {
    const settings = await loadSettings(schemaNoteId, configNoteId)
    return Object.entries(settings.areas || {})
        .filter(([, a]) => a && a.key)
        .map(([id, a]) => ({
            id, key: a.key, title: a.title || a.key, color: a.color || "", enabled: !!a.enabled
        }))
}

// Set (or clear, when `key` is falsy/"none") a note's #area label, mirroring
// the chosen area's color onto #color the same way template-picker's
// assignTemplate does. Shared by the picker widget and the Missing Areas
// triage page so both write through one path.
export async function assignArea(noteId, key, color) {
    return api.runOnBackend((noteId, key, color) => {
        const note = api.getNote(noteId)
        if (!note) return false
        if (key && key !== "none") {
            note.setLabel("area", key)
            if (color) note.setLabel("color", color)
            else note.removeLabel("color")
        } else {
            note.removeLabel("area")
            note.removeLabel("color")
        }
        return true
    }, [noteId, key || "", color || ""])
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
            const key = note.getOwnedLabelValue("area")
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
