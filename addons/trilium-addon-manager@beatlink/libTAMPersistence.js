// Persisted user data (AddonData: notes): the persisted copy is a FULL, independent copy that
// lives under "Addon Data" and is identified by its own #TAMDATAID label (never #TAMFILEID), so
// no #TAMFILEID-based uninstall/prune sweep can ever delete it. connectAddonPersistence links an
// addon's freshly-synced AddonData: relations to that copy: it adopts a #TAMDATAID note that
// already exists, migrates a legacy clone recorded in persistenceNotes, or makes the copy on
// genuine first install. See libTAMSync.js's syncAddon for where this gets called from.

const { tamFileIdLabel, tamDataIdLabel, getPersistenceNoteId, loadDatabase, saveDatabase } = require("libTAMDatabase.js")
const { resolveStoredNoteId } = require("libTAMManifestUtils.js")

// One-time migration off the old design, run BEFORE resolveNotes so it can't clobber user data.
// In the old model the persisted copy was a duplicateSubtree clone living under "Addon Data" that
// kept the origin's copied #TAMFILEID; the in-tree origin was deleted. So the clone is now the
// SOLE bearer of `addonId/key` in the #TAMFILEID namespace — resolveNotes' find-by-#TAMFILEID
// would adopt it as the in-tree note and overwrite it with the shipped default. Re-tagging the
// recorded clone to #TAMDATAID first makes that lookup miss it (a fresh throwaway origin is
// created instead), and connectAddonPersistence then links the relation back to this same note.
async function migrateLegacyPersistence(addonId) {
    const database = await loadDatabase()
    const persistenceNotes = database.installedAddons?.[addonId]?.persistence?.persistenceNotes
    if (!persistenceNotes || Object.keys(persistenceNotes).length === 0) return

    await api.runOnBackend((tamFileIdLabel, tamDataIdLabel, addonId, persistenceNotes) => {
        for (const [key, noteId] of Object.entries(persistenceNotes)) {
            const note = api.getNote(noteId)
            if (!note || note.isDeleted) continue
            if (note.getLabelValue(tamDataIdLabel)) continue // already migrated
            note.removeLabel(tamFileIdLabel)
            note.setLabel(tamDataIdLabel, `${addonId}/${key}`)
        }
    }, [tamFileIdLabel, tamDataIdLabel, addonId, persistenceNotes])
}

async function connectAddonPersistence(addonId) {
    const persistenceRoot = await getPersistenceNoteId()
    let database = await loadDatabase()

    const addonRecord = database.installedAddons[addonId]
    if (!addonRecord.persistence) addonRecord.persistence = {}
    if (!addonRecord.persistence.persistenceNotes) addonRecord.persistence.persistenceNotes = {}

    const addonNoteId = await resolveStoredNoteId(addonId, addonRecord.manifest?.root)
    if (!addonNoteId) return
    const existingNotes = addonRecord.persistence.persistenceNotes

    // Single pass so a UI reload can't interrupt it partway: for each AddonData: relation, find
    // (by #TAMDATAID, else adopt the recorded legacy clone, else make a fresh copy) the persisted
    // note under "Addon Data". Every reference to the shipped-default origin is then moved to the
    // copy — the AddonData: relation and any OTHER inbound relation (e.g. templates' `template`
    // relation on root) — before the origin is deleted, so nothing dangles. Uses removeRelation +
    // addRelation rather than setRelation, since removeRelation updates becca's reverse index for
    // the old target, preventing the origin's deleteNote cascade from killing a rewired relation.
    const outcome = await api.runOnBackend((tamFileIdLabel, tamDataIdLabel, addonNoteId, persistenceRoot, addonId, existingPersistRoot, existingNotes) => {
        const result = {}
        const toDelete = []
        const originToPersisted = {}
        let persistRoot = existingPersistRoot

        function tagAsPersisted(note, key) {
            // A persisted note lives only in the #TAMDATAID namespace. Strip any #TAMFILEID it
            // inherited (a legacy clone carries the origin's copied tag; duplicateSubtree copies
            // it too) so no #TAMFILEID sweep can see it, and stamp its stable data identity.
            note.removeLabel(tamFileIdLabel)
            note.setLabel(tamDataIdLabel, `${addonId}/${key}`)
        }
        function ensurePersistRoot() {
            if (persistRoot && api.getNote(persistRoot)) return persistRoot
            const rootResult = api.createTextNote(persistenceRoot, addonId, "")
            rootResult.note.setLabel("iconClass", "bx bx-customize")
            persistRoot = rootResult.note.noteId
            return persistRoot
        }

        for (const noteId of api.getNote(addonNoteId).getSubtreeNoteIds()) {
            const note = api.getNote(noteId)
            // TAM's own root descends into "Addons", the parent of every other addon's tree —
            // without this guard, TAM's self-sync would corrupt every other addon's bookkeeping.
            const ownTamFileId = note.getLabelValue(tamFileIdLabel)
            if (!ownTamFileId || !ownTamFileId.startsWith(`${addonId}/`)) continue
            // Snapshot name+value up front: the remove/add below mutates this note's attribute
            // list, and a note like templates' root carries many AddonData: relations at once.
            const addonDataRelations = note.getRelations()
                .filter(r => r.name.includes("AddonData:"))
                .map(r => ({ name: r.name, value: r.value }))
            for (const relation of addonDataRelations) {
                const key = relation.name.split("AddonData:")[1]
                const origNoteId = relation.value

                // 1. Authoritative link: a persisted note already carrying this data identity.
                let persisted = api.getNoteWithLabel(tamDataIdLabel, `${addonId}/${key}`)
                if (persisted && persisted.isDeleted) persisted = null

                // 2. Migration: a legacy clone from the old design, recorded but not yet re-tagged.
                if (!persisted && existingNotes[key]) {
                    const legacy = api.getNote(existingNotes[key])
                    if (legacy && !legacy.isDeleted) {
                        tagAsPersisted(legacy, key)
                        persisted = legacy
                    }
                }

                // 3. First install: make a full, independent copy of the shipped-default origin.
                if (!persisted) {
                    const origTitle = api.getNote(origNoteId).title
                    const dup = api.duplicateSubtree(origNoteId, ensurePersistRoot())
                    dup.note.title = origTitle
                    dup.note.save()
                    tagAsPersisted(dup.note, key)
                    persisted = dup.note
                }

                note.removeRelation(relation.name)
                note.addRelation(relation.name, persisted.noteId)
                result[key] = persisted.noteId
                if (origNoteId !== persisted.noteId) {
                    toDelete.push(origNoteId)
                    originToPersisted[origNoteId] = persisted.noteId
                }
            }
        }

        // Move every OTHER inbound relation off each origin onto its persisted copy, so a
        // reference like templates' `root --template--> special` survives the origin's deletion.
        // (The AddonData: relation itself was already rewired above.) duplicateSubtree copied the
        // origin's OUTBOUND relations onto the copy, but inbound ones still point at the origin.
        for (const [origNoteId, persistedNoteId] of Object.entries(originToPersisted)) {
            const origin = api.getNote(origNoteId)
            if (!origin) continue
            const inbound = origin.getTargetRelations()
                .filter(r => !r.name.includes("AddonData:"))
                .map(r => ({ name: r.name, sourceId: r.noteId }))
            for (const { name, sourceId } of inbound) {
                const source = api.getNote(sourceId)
                if (!source) continue
                source.removeRelation(name)
                source.addRelation(name, persistedNoteId)
            }
        }

        for (const noteId of toDelete) {
            const note = api.getNote(noteId)
            if (note) note.deleteNote()
        }

        if (persistRoot) {
            const rootNote = api.getNote(persistRoot)
            if (rootNote && rootNote.getChildNotes().length === 0) {
                rootNote.deleteNote()
                persistRoot = null
            }
        }

        return { persistRoot, persistenceNotes: result }
    }, [tamFileIdLabel, tamDataIdLabel, addonNoteId, persistenceRoot, addonId, addonRecord.persistence.rootNote || null, existingNotes])

    if (outcome.persistRoot) {
        addonRecord.persistence.rootNote = outcome.persistRoot
    } else {
        delete addonRecord.persistence.rootNote
    }
    addonRecord.persistence.persistenceNotes = {
        ...existingNotes,
        ...outcome.persistenceNotes
    }
    await saveDatabase(database)
}

// Removes any recorded persistence root that's now empty and clears the stale reference.
async function cleanupEmptyPersistenceRoots() {
    let database = await loadDatabase()
    let changed = false

    for (const [addonId, addonRecord] of Object.entries(database.installedAddons || {})) {
        const persistence = addonRecord.persistence
        const rootNoteId = persistence?.rootNote
        if (!rootNoteId) continue

        const isEmpty = await api.runOnBackend((rootNoteId) => {
            const note = api.getNote(rootNoteId)
            if (!note) return true
            if (note.getChildNotes().length > 0) return false
            note.deleteNote()
            return true
        }, [rootNoteId])

        if (isEmpty) {
            delete persistence.rootNote
            changed = true

            // Nothing installed and nothing left worth keeping — drop the whole record.
            const hasPersistedNotes = persistence.persistenceNotes &&
                Object.keys(persistence.persistenceNotes).length > 0
            if (!addonRecord.installedVersion && !hasPersistedNotes && !persistence.pendingPrompts) {
                delete database.installedAddons[addonId]
            }
        }
    }

    if (changed) await saveDatabase(database)
}

module.exports.migrateLegacyPersistence = migrateLegacyPersistence
module.exports.connectAddonPersistence = connectAddonPersistence
module.exports.cleanupEmptyPersistenceRoots = cleanupEmptyPersistenceRoots
