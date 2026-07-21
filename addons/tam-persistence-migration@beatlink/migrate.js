// One-time migration off TAM's old copy-on-write persistence model (#TAMDATAID) onto the
// two-roots placement model (persistent notes are ordinary #TAMFILEID notes under the shared
// "Addon Data" anchor). Run once after updating TAM + its addons to the persistenceRoot model,
// then uninstall this addon.
//
// The old model stored, per installed addon, `persistence.persistenceNotes = { key -> realNoteId }`
// where each realNoteId is a note tagged #TAMDATAID="addonId/key" living under a per-addon folder in
// "Addon Data". Each `key` equals the `AddonData:<key>` relation's target local id in that addon's
// stored manifest, which is exactly the note's persistent local id in the new model. So for each
// such note: drop #TAMDATAID, add #TAMFILEID="addonId/localId", and re-home it directly under the
// shared "Addon Data" anchor. Then drop the now-unused `persistence` bookkeeping from the record.
//
// Idempotent: an addon whose record has no `persistence.persistenceNotes` is skipped, so re-running
// is a no-op. Self-contained: reads/writes TAM's Database note directly, no lib-tam dependency.

const TAM_ID = "trilium-addon-manager@beatlink"
const tamFileIdLabel = "TAMFILEID"
const tamDataIdLabel = "TAMDATAID"

async function migrate() {
    const report = await api.runOnBackend((TAM_ID, tamFileIdLabel, tamDataIdLabel) => {
        // TAM's own Database note and the shared "Addon Data" anchor, found by TAM's #TAMFILEID.
        const dbNote = api.getNoteWithLabel(tamFileIdLabel, `${TAM_ID}/database`)
        const anchor = api.getNoteWithLabel(tamFileIdLabel, `${TAM_ID}/addon-data`)
        if (!dbNote) return { error: "TAM Database note not found — is TAM installed?" }
        if (!anchor) return { error: "TAM 'Addon Data' anchor not found." }

        const database = JSON.parse(dbNote.getContent())
        const migrated = []
        let changed = false

        for (const [addonId, record] of Object.entries(database.installedAddons || {})) {
            const persistenceNotes = record?.persistence?.persistenceNotes
            if (!persistenceNotes || Object.keys(persistenceNotes).length === 0) continue

            // key -> new local id, from the stored manifest's AddonData: relations (to === local id).
            const keyToLocalId = {}
            for (const rel of (record.manifest?.relations || [])) {
                const type = String(rel.type || "")
                if (type.startsWith("AddonData:")) keyToLocalId[type.slice("AddonData:".length)] = rel.to
            }

            for (const [key, noteId] of Object.entries(persistenceNotes)) {
                const localId = keyToLocalId[key]
                const note = api.getNote(noteId)
                if (!note || note.isDeleted || !localId) continue
                note.removeLabel(tamDataIdLabel)
                note.setLabel(tamFileIdLabel, `${addonId}/${localId}`)
                api.ensureNoteIsPresentInParent(noteId, anchor.noteId)
                migrated.push(`${addonId}/${localId}`)
            }

            // The new model keeps no persistence bookkeeping; pendingPrompts is transient.
            delete record.persistence
            changed = true
        }

        if (changed) dbNote.setContent(JSON.stringify(database, null, 4))
        return { migrated }
    }, [TAM_ID, tamFileIdLabel, tamDataIdLabel])

    if (report.error) {
        api.showError(`Persistence migration: ${report.error}`)
        return
    }
    if (report.migrated.length === 0) {
        api.showMessage("Persistence migration: nothing to migrate (already on the new model).")
    } else {
        api.showMessage(`Persistence migration: re-homed ${report.migrated.length} note(s): ${report.migrated.join(", ")}. You can uninstall this addon now.`)
    }
}

migrate()
