import { loadSettings, saveSettings } from "libSettingsUI.jsx"

// The active profile and its priority levels. Each profile's `priorities` is
// itself a registry keyed by id (stable across reorders/renames), same shape
// as area-picker's `areas` registry. There is no order field — the registry's
// own key order is the display order, so ordering is never a number to
// reconcile.
//
// A `selected` pointing at a deleted profile falls back to the first
// available profile, same guard the widget already had.

// Read the active profile: { label, priorities: [{ id, key, title, color,
// enabled }] } in registry order, or null if no profile exists at all.
export async function getActiveProfile(schemaNoteId, configNoteId) {
    const { selected, profiles } = await loadSettings(schemaNoteId, configNoteId)
    const profile = profiles[selected] ?? Object.values(profiles)[0]
    if (!profile) return null

    const priorities = Object.entries(profile.priorities || {})
        .filter(([, p]) => p && p.key)
        .map(([id, p]) => ({ id, key: p.key, title: p.title || p.key, color: p.color || "", enabled: !!p.enabled }))

    return { label: profile.label, priorities }
}

// Set (or clear, when `key` is falsy/"none") a note's priority label,
// mirroring the chosen level's color onto #color the same way area-picker's
// assignArea does. Shared by the picker widget and the Missing Priorities
// triage page so both write through one path.
export async function assignPriority(noteId, label, key, color) {
    return api.runOnBackend((noteId, label, key, color) => {
        const note = api.getNote(noteId)
        if (!note) return false
        if (key && key !== "none") {
            note.setLabel(label, key)
            if (color) note.setLabel("color", color)
            else note.removeLabel("color")
        } else {
            note.removeLabel(label)
            note.removeLabel("color")
        }
        return true
    }, [noteId, label, key || "", color || ""])
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

// Every non-hidden note lacking the active profile's label, minus anything
// matching an enabled exclude filter. Returns [{ noteId, title, path, preview }].
export async function getMissingPriorityNotes(schemaNoteId, configNoteId, label) {
    const filters = await getExcludeFilters(schemaNoteId, configNoteId)
    const excludedIds = await getExcludedNoteIds(filters)

    return api.runOnBackend((label, excludedIdList) => {
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
        for (const note of api.searchForNotes(`#!${label}`)) {
            if (note.isInHiddenSubtree()) continue
            if (note.hasLabel(label)) continue
            if (excludedIds.has(note.noteId)) continue
            out.push({
                noteId: note.noteId,
                title: note.title,
                path: pathOf(note),
                preview: previewOf(note)
            })
        }
        return out
    }, [label, excludedIds])
}

// Whether the active note should show the picker widget at all — true when it
// matches no enabled exclude filter.
export async function isExcludedFromPicker(schemaNoteId, configNoteId, noteId) {
    const filters = await getExcludeFilters(schemaNoteId, configNoteId)
    if (!filters.length) return false
    const excludedIds = await getExcludedNoteIds(filters)
    return excludedIds.includes(noteId)
}
