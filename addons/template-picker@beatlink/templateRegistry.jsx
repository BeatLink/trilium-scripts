import { loadSettings, saveSettings } from "libSettingsUI.jsx"

// The picker's template registry: which #template notes the dropdown offers, in
// what order. Keyed by note id so a reorder or rename never orphans a row.
//
// An entry: { name, templateNoteId, enabled, order }.
// Scan is discovery only — it adds rows for #template notes not already in the
// registry and never touches an existing row's name/enabled/order.

// Read the registry and drop rows whose note no longer exists. Returns
// [{ id, noteId, name, enabled, order }] sorted by order.
export async function getTemplates(schemaNoteId, configNoteId) {
    const settings = await loadSettings(schemaNoteId, configNoteId)
    const entries = Object.entries(settings.templates || {})

    const live = await api.runOnBackend((entries) => {
        return entries
            .filter(([, e]) => e.templateNoteId && api.getNote(e.templateNoteId))
            .map(([id, e]) => ({
                id, noteId: e.templateNoteId, name: e.name, enabled: e.enabled, order: e.order
            }))
    }, [entries])

    return live.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

// Search the tree for every #template note and add a row for any not already in
// the registry, enabled and appended after the highest existing order. Existing
// rows are preserved as-is. Returns { added, total }.
export async function scanTemplates(schemaNoteId, configNoteId) {
    const settings = await loadSettings(schemaNoteId, configNoteId)
    const registry = { ...(settings.templates || {}) }

    const known = new Set(
        Object.values(registry).map(e => e.templateNoteId).filter(Boolean)
    )
    const found = await api.runOnBackend(() => {
        return api.searchForNotes("#template").map(n => ({ noteId: n.noteId, title: n.title }))
    }, [])

    let maxOrder = -1
    for (const e of Object.values(registry)) maxOrder = Math.max(maxOrder, e.order ?? 0)

    let added = 0
    for (const t of found) {
        if (known.has(t.noteId)) continue
        maxOrder += 1
        registry[t.noteId] = {
            name: t.title, templateNoteId: t.noteId, enabled: true, order: maxOrder
        }
        added += 1
    }

    settings.templates = registry
    await saveSettings(schemaNoteId, configNoteId, settings)

    return { added, total: Object.keys(registry).length }
}
