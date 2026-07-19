import { loadSettings, saveSettings } from "libSettingsUI.jsx"

// The picker's template registry: which #template notes the dropdown offers, in
// what order. Keyed by note id so a reorder or rename never orphans a row.
//
// An entry: { name, templateNoteId, enabled }. There is no order field — the
// registry's own key order is the display order (the settings form's move
// controls rewrite the key order, and libsettings preserves it through both the
// defaults merge and the save), so ordering is never a number to reconcile.
//
// Scan is discovery only — it appends rows for #template notes not already in
// the registry and never touches an existing row.

// Read the registry and drop rows whose note no longer exists. Returns
// [{ id, noteId, name, enabled }] in registry order.
export async function getTemplates(schemaNoteId, configNoteId) {
    const settings = await loadSettings(schemaNoteId, configNoteId)
    const entries = Object.entries(settings.templates || {})

    return api.runOnBackend((entries) => {
        return entries
            .filter(([, e]) => e.templateNoteId && api.getNote(e.templateNoteId))
            .map(([id, e]) => ({
                id, noteId: e.templateNoteId, name: e.name, enabled: e.enabled
            }))
    }, [entries])
}

// Search the tree for every #template note and add a row for any not already in
// the registry, enabled. New keys land at the end of the object, which is the
// end of the display order. Existing rows are preserved as-is, keeping the order
// the user arranged. Returns { added, total }.
export async function scanTemplates(schemaNoteId, configNoteId) {
    const settings = await loadSettings(schemaNoteId, configNoteId)
    const registry = { ...(settings.templates || {}) }

    const known = new Set(
        Object.values(registry).map(e => e.templateNoteId).filter(Boolean)
    )
    const found = await api.runOnBackend(() => {
        return api.searchForNotes("#template").map(n => ({ noteId: n.noteId, title: n.title }))
    }, [])

    let added = 0
    for (const t of found) {
        if (known.has(t.noteId)) continue
        registry[t.noteId] = { name: t.title, templateNoteId: t.noteId, enabled: true }
        added += 1
    }

    settings.templates = registry
    await saveSettings(schemaNoteId, configNoteId, settings)

    return { added, total: Object.keys(registry).length }
}
