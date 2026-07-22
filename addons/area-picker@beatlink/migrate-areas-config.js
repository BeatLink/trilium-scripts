// One-time migration script — NOT part of the addon's shipped manifest.
//
// Run this ONCE, manually, before updating area-picker@beatlink past 2.5.1,
// if you already have areas configured. The `areas` field changed from a
// plain ordered list (no stable per-row id, no Enabled flag) to a registry
// (stable id per row, in-place Enabled toggle, Add/Remove controls) so it
// works the same way template-picker's Templates tab does.
//
// libsettings has no automatic list -> registry coercion: without this
// script, the next settings load would see config.json's old array-shaped
// `areas` field, fail to match the new registry storage shape
// ({ entries, removedIds }), and silently fall back to schema.json's shipped
// defaults — discarding your customized areas, colors, and order.
//
// This script rewrites config.json's `areas` field in place, converting each
// list row into a registry entry keyed by its own `key` (falling back to a
// generated id if two rows somehow share a key), with `enabled: true` on
// every existing row (nothing was previously disable-able, so every row was
// effectively enabled).
//
// HOW TO RUN:
//   1. In Trilium, create a new Code note (JS Backend).
//   2. Paste this whole file as its content.
//   3. Open the note and click the "Execute script" (play) button once.
//   4. Read the printed summary, then delete this note — it's single-use.
//
// Safe to re-run: a config note whose `areas` field is already object-shaped
// (not an array) is left untouched, so running it twice does nothing the
// second time.

const anchors = api.searchForNotes("#areaConfig")
if (!anchors.length) {
    api.showMessage("No area-picker settings note found (#areaConfig) — nothing to migrate.")
} else {
    const anchor = anchors[0]
    const configNoteId = anchor.getRelationValue("configNote")
    const configNote = configNoteId && api.getNote(configNoteId)

    if (!configNote) {
        api.showMessage("area-picker's settings note has no configNote relation — nothing to migrate.")
    } else {
        const content = configNote.getContent()
        const stored = content ? JSON.parse(content) : {}

        if (!Array.isArray(stored.areas)) {
            api.showMessage("area-picker's `areas` config is already in the new format — nothing to migrate.")
        } else {
            const seen = new Set()
            const registry = {}
            let counter = 0
            for (const row of stored.areas) {
                let id = row.key || `area-${counter}`
                while (seen.has(id)) { counter += 1; id = `area-${counter}` }
                seen.add(id)
                registry[id] = {
                    key: row.key || "",
                    title: row.title || "",
                    color: row.color || "gray",
                    enabled: true
                }
            }

            stored.areas = registry
            configNote.setContent(JSON.stringify(stored, null, 4))
            api.showMessage(`Area migration done: converted ${Object.keys(registry).length} area(s) to the new format.`)
        }
    }
}
