import { loadSettings } from "libSettingsUI.jsx"

// Shared registry-support logic for right-pane "picker" widgets (area-picker,
// template-picker): the exclude-filter list, scanning for notes missing the
// thing this picker assigns, and the excluded-from-picker check. Each
// consumer keeps its own registry read/write (areaRegistry.jsx,
// templateRegistry.jsx) since that part's entry shape differs; this only
// covers the parts that were byte-for-byte identical between the two.

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
export async function getExcludedNoteIds(filters) {
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

// Whether the active note should show the picker widget at all — true when it
// matches no enabled exclude filter.
export async function isExcludedFromPicker(schemaNoteId, configNoteId, noteId) {
    const filters = await getExcludeFilters(schemaNoteId, configNoteId)
    if (!filters.length) return false
    const excludedIds = await getExcludedNoteIds(filters)
    return excludedIds.includes(noteId)
}

// Every non-hidden note matching `searchQuery` that lacks the given label or
// relation yet, minus anything matching an enabled exclude filter. `attrType`
// is "label" or "relation"; `attrName` is the label/relation name to check
// for absence (e.g. "area", "template"). Returns
// [{ noteId, title, path, preview }].
export async function getMissingAssignmentNotes(schemaNoteId, configNoteId, searchQuery, attrType, attrName) {
    const filters = await getExcludeFilters(schemaNoteId, configNoteId)
    const excludedIds = await getExcludedNoteIds(filters)

    return api.runOnBackend((searchQuery, excludedIdList, attrType, attrName) => {
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
        for (const note of api.searchForNotes(searchQuery)) {
            if (note.isInHiddenSubtree()) continue
            if (attrType === "relation" ? note.hasRelation(attrName) : note.hasLabel(attrName)) continue
            if (excludedIds.has(note.noteId)) continue
            out.push({
                noteId: note.noteId,
                title: note.title,
                path: pathOf(note),
                preview: previewOf(note)
            })
        }
        return out
    }, [searchQuery, excludedIds, attrType, attrName])
}
