// One-time migration script — NOT part of the addon's shipped manifest.
//
// Run this ONCE, manually, before updating priority-widget@beatlink past
// 2.2.1, if you already have profiles configured. Each profile's
// `priorities` field changed from a plain ordered list (no stable per-row
// id, no Enabled flag) to a registry (stable id per row, in-place Enabled
// toggle, Add/Remove controls) so it works the same way area-picker's Areas
// tab does.
//
// libsettings has no automatic list -> registry coercion: without this
// script, the next settings load would see config.json's old array-shaped
// `priorities` field on every profile, fail to match the new registry
// storage shape ({ entries, removedIds }), and silently fall back to
// schema.json's shipped defaults for each profile — discarding your
// customized priority levels, colors, and order.
//
// This script rewrites config.json's `profiles.*.priorities` field in place
// for every profile, converting each list row into a registry entry keyed by
// its own `key` (falling back to a generated id if two rows somehow share a
// key), with `enabled: true` on every existing row (nothing was previously
// disable-able, so every row was effectively enabled).
//
// HOW TO RUN:
//   1. In Trilium, create a new Code note (JS Backend).
//   2. Paste this whole file as its content.
//   3. Open the note and click the "Execute script" (play) button once.
//   4. Read the printed summary, then delete this note — it's single-use.
//
// Safe to re-run: a profile whose `priorities` field is already
// object-shaped (not an array) is left untouched, so running it twice does
// nothing to that profile the second time.

const anchors = api.searchForNotes("#priorityConfig")
if (!anchors.length) {
    api.showMessage("No priority-widget settings note found (#priorityConfig) — nothing to migrate.")
} else {
    const anchor = anchors[0]
    const configNoteId = anchor.getRelationValue("configNote")
    const configNote = configNoteId && api.getNote(configNoteId)

    if (!configNote) {
        api.showMessage("priority-widget's settings note has no configNote relation — nothing to migrate.")
    } else {
        const content = configNote.getContent()
        const stored = content ? JSON.parse(content) : {}
        const profiles = stored.profiles || {}

        const results = []
        for (const [profileId, profile] of Object.entries(profiles)) {
            if (!Array.isArray(profile.priorities)) {
                results.push(`SKIP  "${profile.name || profileId}" — already in the new format`)
                continue
            }

            const seen = new Set()
            const registry = {}
            let counter = 0
            for (const row of profile.priorities) {
                let id = row.key || `priority-${counter}`
                while (seen.has(id)) { counter += 1; id = `priority-${counter}` }
                seen.add(id)
                registry[id] = {
                    key: row.key || "",
                    title: row.title || "",
                    color: row.color || "",
                    enabled: true
                }
            }

            profile.priorities = registry
            results.push(`OK    "${profile.name || profileId}" — converted ${Object.keys(registry).length} level(s)`)
        }

        if (results.length === 0) {
            api.showMessage("No profiles found in priority-widget's config — nothing to migrate.")
        } else {
            stored.profiles = profiles
            configNote.setContent(JSON.stringify(stored, null, 4))
            api.showMessage(`Priority migration done:\n\n${results.join("\n")}`)
        }
    }
}
