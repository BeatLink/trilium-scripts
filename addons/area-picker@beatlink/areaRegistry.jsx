import { loadSettings, saveSettings } from "libSettingsUI.jsx"

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

// The enabled exclude filters, in registry order: [{ id, name, query }].
export async function getExcludeFilters(schemaNoteId, configNoteId) {
    const settings = await loadSettings(schemaNoteId, configNoteId)
    return Object.entries(settings.excludeFilters || {})
        .filter(([, f]) => f && f.enabled && f.query)
        .map(([id, f]) => ({ id, name: f.name || "", query: f.query }))
}

// Every note matching any enabled exclude filter's query, as an array of
// noteIds (runOnBackend results cross a JSON boundary, so a Set doesn't
// survive the round-trip — callers build their own Set locally if needed). A
// bad/unparseable query is skipped rather than thrown, so one broken filter
// doesn't take down the rest.
async function getExcludedNoteIds(filters) {
    return api.runOnBackend((filters) => {
        const ids = new Set()
        for (const f of filters) {
            let results
            try { results = api.searchForNotes(f.query) } catch (e) { continue }
            for (const n of results) ids.add(n.noteId)
        }
        return Array.from(ids)
    }, [filters])
}

// Every non-hidden note lacking a #area label, minus anything matching an
// enabled exclude filter. Returns [{ noteId, title, path, preview }].
export async function getMissingAreaNotes(schemaNoteId, configNoteId) {
    const filters = await getExcludeFilters(schemaNoteId, configNoteId)
    const excludedIds = await getExcludedNoteIds(filters)

    return api.runOnBackend((excludedIdList) => {
        const excludedIds = new Set(excludedIdList)
        const PREVIEW_MAX = 240
        function previewOf(note) {
            if (note.type !== "text") return ""
            let content
            try { content = note.getContent() } catch (e) { return "" }
            if (!content || typeof content !== "string") return ""
            const text = content
                .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"').replace(/\s+/g, " ").trim()
            return text.length > PREVIEW_MAX ? text.slice(0, PREVIEW_MAX) + "…" : text
        }
        function pathOf(note) {
            const parts = []
            let cur = note.getParentNotes()[0]
            while (cur && cur.noteId !== "root") {
                parts.unshift(cur.title)
                cur = cur.getParentNotes()[0]
            }
            return parts.join(" › ")
        }

        const out = []
        for (const note of api.searchForNotes("#!area")) {
            if (note.isInHiddenSubtree()) continue
            if (note.hasLabel("area")) continue
            if (excludedIds.has(note.noteId)) continue
            out.push({
                noteId: note.noteId,
                title: note.title,
                path: pathOf(note),
                preview: previewOf(note)
            })
        }
        return out
    }, [excludedIds])
}

// Whether the active note should show the picker widget at all — true when it
// matches no enabled exclude filter.
export async function isExcludedFromPicker(schemaNoteId, configNoteId, noteId) {
    const filters = await getExcludeFilters(schemaNoteId, configNoteId)
    if (!filters.length) return false
    const excludedIds = await getExcludedNoteIds(filters)
    return excludedIds.includes(noteId)
}
