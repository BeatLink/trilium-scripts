// Uninstall/delete lifecycle: removing an addon's own note branches, detecting external
// references that would dangle, and the recursive "uninstall unused dependencies too" logic.
// Companion to libTAMSync.js's install/update path.

const { tamFileIdLabel, tamDataIdLabel, TAM_ID, loadDatabase, saveDatabase, getAddonRootNoteId } = require("libTAMDatabase.js")
const { resolveStoredNoteId, dependencyId, getDependents } = require("libTAMManifestUtils.js")

// User-triggered maintenance sweep: deletes any #TAMFILEID-tagged note with zero parents
// (a safety net for a partial sync failure). Returns the list of TAMFILEIDs removed.
async function sweepOrphanedNotes() {
    return await api.runOnBackend((tamFileIdLabel) => {
        const removed = []
        for (const note of api.getNotesWithLabel(tamFileIdLabel)) {
            if (note.isDeleted) continue
            if (note.getParentNotes().length > 0) continue
            removed.push(note.getLabelValue(tamFileIdLabel))
            note.deleteNote()
        }
        return removed
    }, [tamFileIdLabel])
}

// Removes every branch this addon owns, never a blanket note-level delete — a note only
// disappears once none of its parents are left, so a clone held by a dependent survives.
// Scans the live tree by #TAMFILEID prefix rather than walking a stored manifest's notes[]
// list, so it's self-healing against manifest churn: a note whose local id was dropped from
// a later manifest version (and so is absent from whatever manifest snapshot is on record)
// still gets found and cleaned up here, since this never depends on any particular stored
// manifest matching what's actually still in the tree.
async function detachAddonOwnedBranches(addonId) {
    const anchorIds = [await getAddonRootNoteId()].filter(Boolean)

    await api.runOnBackend((tamFileIdLabel, tamDataIdLabel, addonId, anchorIds) => {
        const prefix = `${addonId}/`
        for (const note of api.getNotesWithLabel(tamFileIdLabel)) {
            if (note.isDeleted) continue
            const tamFileId = note.getLabelValue(tamFileIdLabel)
            if (!tamFileId || !tamFileId.startsWith(prefix)) continue

            // A persisted (AddonData:) note must survive uninstall. It normally carries only
            // #TAMDATAID and so never reaches this #TAMFILEID scan, but a legacy clone from the
            // old design can still carry a copied #TAMFILEID until its first re-sync migrates it —
            // guard against deleting one here regardless.
            const dataId = note.getLabelValue(tamDataIdLabel)
            if (dataId && dataId.startsWith(prefix)) continue

            const parentsToDetach = []
            let keepsAnyParent = false
            for (const parentNote of note.getParentNotes()) {
                const isAnchor = anchorIds.includes(parentNote.noteId)
                const parentTamId = parentNote.getLabelValue(tamFileIdLabel)
                const ownedByThisAddon = parentTamId && parentTamId.startsWith(prefix)
                // Preserve a parent branch clearly owned by a different addon; detach everything else.
                const ownedByAnotherAddon = parentTamId && !ownedByThisAddon && !isAnchor
                if (ownedByAnotherAddon) {
                    keepsAnyParent = true
                } else {
                    parentsToDetach.push(parentNote)
                }
            }

            if (!keepsAnyParent) {
                // Every parent branch here is slated for removal — this note should end up fully
                // deleted. Go straight to deleteNote() instead of stripping branches one at a time
                // via ensureNoteIsAbsentFromParent: that function silently REFUSES to remove a
                // note's last remaining strong branch ("this would delete the note as well" is
                // exactly the outcome wanted here, not a reason to abort), so calling it on every
                // parent one-by-one always leaves exactly one branch behind and the note never
                // actually gets removed.
                note.deleteNote()
                continue
            }

            for (const parentNote of parentsToDetach) {
                api.ensureNoteIsAbsentFromParent(note.noteId, parentNote.noteId)
            }
        }
    }, [tamFileIdLabel, tamDataIdLabel, addonId, anchorIds])
}

async function deleteAddon(addonId) {
    if (!addonId.trim()) return
    let database = await loadDatabase()
    const addonRecord = database.installedAddons[addonId]
    await detachAddonOwnedBranches(addonId)

    const persistence = addonRecord?.persistence
    const hasPersistedData = persistence && (
        persistence.rootNote ||
        (persistence.persistenceNotes && Object.keys(persistence.persistenceNotes).length > 0)
    )

    if (hasPersistedData) {
        // Keep the persisted user data around — it must survive uninstall.
        database.installedAddons[addonId] = { persistence }
    } else {
        delete database.installedAddons[addonId]
    }
    await saveDatabase(database)
}

// Pre-uninstall safety check: finds every relation pointing into an addon's subtree from
// outside it, which would dangle once deleteAddon removes the subtree. A manifest can opt
// out via "allowExternalReferences": true (see expanded@beatlink).
async function findExternalReferences(addonId) {
    const addonRecord = (await loadDatabase()).installedAddons[addonId]
    if (addonRecord?.manifest?.allowExternalReferences) return []

    const rootNoteId = await resolveStoredNoteId(addonId, addonRecord?.manifest?.root)
    if (!rootNoteId) return []

    return await api.runOnBackend((rootNoteId) => {
        const subtreeIds = new Set(api.getNote(rootNoteId).getSubtreeNoteIds())
        const found = []
        for (const noteId of subtreeIds) {
            const note = api.getNote(noteId)
            for (const rel of note.getTargetRelations()) {
                if (subtreeIds.has(rel.noteId)) continue
                const sourceNote = api.getNote(rel.noteId)
                found.push({
                    sourceNoteId: rel.noteId,
                    sourceTitle: sourceNote ? sourceNote.title : "(unknown)",
                    relationName: rel.name,
                    targetNoteId: noteId,
                    targetTitle: note.title
                })
            }
        }
        return found
    }, [rootNoteId])
}

// The user-facing "uninstall": unlike deleteAddon, also recursively uninstalls any of its
// own dependencies that are now unused and weren't installed directly by the user.
async function uninstallAddon(addonId) {
    if (!addonId.trim()) return
    let database = await loadDatabase()
    const installed = database.installedAddons[addonId]
    if (!installed?.installedVersion) return

    const dependencies = installed.manifest?.dependencies || []

    await deleteAddon(addonId)

    for (const depEntry of dependencies) {
        const depId = dependencyId(depEntry)
        database = await loadDatabase()
        const dep = database.installedAddons[depId]
        if (!dep) continue

        const stillNeeded = getDependents(database, depId).length > 0
        const depIsManual = dep.manuallyInstalled ?? true
        if (!depIsManual && !stillNeeded) {
            await uninstallAddon(depId)
        }
    }
}

// Recovery tool: uninstalls every addon except TAM itself, then hard-resets the Database
// note to just its catalogs and a bare TAM entry. TAM re-derives its own installed state
// next time it's synced.
async function reinitializeDatabase() {
    let database = await loadDatabase()
    for (const addonId of Object.keys(database.installedAddons || {}).filter(id => id !== TAM_ID)) {
        await uninstallAddon(addonId)
    }

    database = await loadDatabase()
    await saveDatabase({
        catalogs: database.catalogs || [],
        installedAddons: {
            [TAM_ID]: {
                manifestSourceUrl: database.installedAddons[TAM_ID]?.manifestSourceUrl
            }
        }
    })
}

module.exports.sweepOrphanedNotes = sweepOrphanedNotes
module.exports.detachAddonOwnedBranches = detachAddonOwnedBranches
module.exports.deleteAddon = deleteAddon
module.exports.findExternalReferences = findExternalReferences
module.exports.uninstallAddon = uninstallAddon
module.exports.reinitializeDatabase = reinitializeDatabase
