// Uninstall/delete lifecycle: removing an addon's own note branches, detecting external
// references that would dangle, and the recursive "uninstall unused dependencies too" logic.
// Companion to libTAMSync.js's install/update path.

const { tamFileIdLabel, TAM_ID, loadDatabase, saveDatabase, getAddonRootNoteId } = require("libTAMDatabase.js")
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

// Removes only the branches this addon's own manifest owns, never a blanket note-level delete —
// a note only disappears once none of its parents are left, so a clone held by a dependent survives.
async function detachAddonOwnedBranches(addonId, m) {
    const anchorIds = [await getAddonRootNoteId()].filter(Boolean)

    for (const noteDef of m.notes || []) {
        const noteId = await resolveStoredNoteId(addonId, noteDef.id)
        if (!noteId) continue
        await api.runOnBackend((tamFileIdLabel, addonId, noteId, anchorIds) => {
            const note = api.getNote(noteId)
            if (!note || note.isDeleted) return
            for (const parentNote of note.getParentNotes()) {
                const isAnchor = anchorIds.includes(parentNote.noteId)
                const parentTamId = parentNote.getLabelValue(tamFileIdLabel)
                const ownedByThisAddon = parentTamId && parentTamId.startsWith(`${addonId}/`)
                // Preserve a parent branch clearly owned by a different addon; detach everything else.
                const ownedByAnotherAddon = parentTamId && !ownedByThisAddon && !isAnchor
                if (!ownedByAnotherAddon) {
                    api.ensureNoteIsAbsentFromParent(noteId, parentNote.noteId)
                }
            }
            const stillLive = api.getNote(noteId)
            if (stillLive && !stillLive.isDeleted && stillLive.getParentNotes().length === 0) {
                stillLive.deleteNote()
            }
        }, [tamFileIdLabel, addonId, noteId, anchorIds])
    }
}

async function deleteAddon(addonId) {
    if (!addonId.trim()) return
    let database = await loadDatabase()
    const addonRecord = database.installedAddons[addonId]
    if (addonRecord?.manifest) {
        await detachAddonOwnedBranches(addonId, addonRecord.manifest)
    }

    const persistence = addonRecord.persistence
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
