// Enable/disable, read-only addon listing, update-checking, and database validation —
// the "query and toggle" surface the UI reads/calls outside of an actual install/uninstall.

const { tamFileIdLabel, tamDataIdLabel, addonLabels, loadDatabase, saveDatabase } = require("libTAMDatabase.js")
const { resolveStoredNoteId, dependencyId, getDependents } = require("libTAMManifestUtils.js")
const { versionCompare, fetchManifest } = require("libTAMNetwork.js")
const { cleanupEmptyPersistenceRoots } = require("libTAMPersistence.js")

async function enableAddon(addonId, enabled) {
    if (!addonId.trim()) return
    let database = await loadDatabase()
    const rootNoteId = await resolveStoredNoteId(addonId, database.installedAddons[addonId].manifest?.root)
    if (!rootNoteId) return
    await api.runOnBackend((tamFileIdLabel, addonId, noteId, enabled, addonLabels) => {
        for (const id of api.getNote(noteId).getSubtreeNoteIds()) {
            const note = api.getNote(id)
            // TAM's own root descends into "Addons" — without this guard, disabling TAM
            // would disable every other installed addon too (see connectAddonPersistence).
            const ownTamFileId = note.getLabelValue(tamFileIdLabel)
            if (!ownTamFileId || !ownTamFileId.startsWith(`${addonId}/`)) continue
            for (const attribute of note.getAttributes() || []) {
                const isDisabledAttr = attribute.name.toLowerCase().includes("disabled:")
                if (enabled ? !isDisabledAttr : !addonLabels.includes(attribute.name)) continue
                const newName = enabled ? attribute.name.replace("disabled:", "") : `disabled:${attribute.name}`
                note.removeAttribute(attribute.type, attribute.name)
                note.addAttribute(attribute.type, newName, attribute.value, attribute.isInheritable, attribute.position)
            }
        }
    }, [tamFileIdLabel, addonId, rootNoteId, enabled, addonLabels])
    database.installedAddons[addonId].enabled = enabled
    await saveDatabase(database)
}

// Returns every installed addon merged with live-resolved rootNoteId/settingsNoteId —
// the data the list/detail views render. Never touches the network.
async function getAllAddons() {
    let database = await loadDatabase()

    const lookups = []
    for (const [addonId, addon] of Object.entries(database.installedAddons || {})) {
        if (!addon.installedVersion || !addon.manifest) continue
        lookups.push({ addonId, rootLocalId: addon.manifest.root, settingsLocalId: addon.manifest.settingsNote })
    }
    const resolved = await api.runOnBackend((tamFileIdLabel, lookups) => {
        const result = {}
        for (const { addonId, rootLocalId, settingsLocalId } of lookups) {
            function resolveLocal(localId) {
                if (!localId) return null
                const note = api.getNoteWithLabel(tamFileIdLabel, `${addonId}/${localId}`)
                return (note && !note.isDeleted) ? note.noteId : null
            }
            result[addonId] = { rootNoteId: resolveLocal(rootLocalId), settingsNoteId: resolveLocal(settingsLocalId) }
        }
        return result
    }, [tamFileIdLabel, lookups])

    const addons = {}
    for (const [addonId, addon] of Object.entries(database.installedAddons || {})) {
        if (!addon.installedVersion) continue
        addons[addonId] = {
            id: addonId,
            ...(addon.meta || {}),
            latestVersion: addon.installedVersion,
            ...addon,
            ...(resolved[addonId] || {})
        }
    }
    return addons
}

// Fetches every installed addon's own manifestSourceUrl and compares latestVersion against
// installedVersion. Best-effort per addon: a fetch failure leaves the prior state.
async function checkForAddonUpdates() {
    let database = await loadDatabase()
    const installed = database.installedAddons || {}

    await Promise.all(Object.entries(installed).map(async ([addonId, addon]) => {
        if (!addon.installedVersion || !addon.manifestSourceUrl) return
        try {
            const manifest = await fetchManifest(addon.manifestSourceUrl)
            if (manifest.latestVersion) {
                addon.updateAvailable = versionCompare(manifest.latestVersion, addon.installedVersion) > 0
                if (addon.updateAvailable) {
                    addon.availableVersion = manifest.latestVersion
                } else {
                    delete addon.availableVersion
                }
            }
        } catch (e) {
            // Best-effort — leave whatever updateAvailable state was there.
        }
    }))

    // Libraries are hidden from the UI, so surface an update sitting on one via whatever
    // depends on it instead. Fixed-point loop: updateAvailable only ever flips false->true.
    let changed = true
    while (changed) {
        changed = false
        for (const addonId of Object.keys(installed)) {
            const addon = installed[addonId]
            if (!addon.updateAvailable) continue
            for (const dependentId of getDependents(database, addonId)) {
                const dependent = installed[dependentId]
                if (dependent && !dependent.updateAvailable) {
                    dependent.updateAvailable = true
                    changed = true
                }
            }
        }
    }

    await saveDatabase(database)
    await cleanupEmptyPersistenceRoots()
}

// Read-only audit of the installed-addon graph against the real Trilium note tree.
// Never fixes anything — a flagged addon should be reinstalled/updated instead.
// Returns a flat list of { addonId, message } issues.
async function validateDatabase() {
    const database = await loadDatabase()
    const issues = []

    const duplicateIds = await api.runOnBackend((tamFileIdLabel, tamDataIdLabel) => {
        function duplicatesOf(label) {
            const byValue = {}
            for (const note of api.getNotesWithLabel(label)) {
                if (note.isDeleted) continue
                const value = note.getLabelValue(label)
                byValue[value] = byValue[value] || []
                byValue[value].push(note.noteId)
            }
            return Object.entries(byValue).filter(([, noteIds]) => noteIds.length > 1)
        }
        return { tamFileId: duplicatesOf(tamFileIdLabel), tamDataId: duplicatesOf(tamDataIdLabel) }
    }, [tamFileIdLabel, tamDataIdLabel])

    for (const [tamFileId, noteIds] of duplicateIds.tamFileId) {
        issues.push({
            addonId: tamFileId.split("/")[0],
            message: `TAMFILEID '${tamFileId}' is duplicated across notes ${noteIds.join(", ")}`
        })
    }

    for (const [tamDataId, noteIds] of duplicateIds.tamDataId) {
        issues.push({
            addonId: tamDataId.split("/")[0],
            message: `TAMDATAID '${tamDataId}' is duplicated across notes ${noteIds.join(", ")} (persisted data note has a conflicting copy)`
        })
    }

    for (const [addonId, addon] of Object.entries(database.installedAddons || {})) {
        const isInstalled = !!addon.installedVersion
        // A lazily-resolved dependency (see ensureDependencyExport) never forces its own root
        // note into existence, so a missing root is only an issue for a manually-installed addon.
        const requiresOwnRoot = isInstalled && !!addon.manuallyInstalled
        const persistence = addon.persistence || {}
        const manifest = addon.manifest || {}

        const backendIssues = await api.runOnBackend((tamFileIdLabel, tamDataIdLabel, addonId, manifest, persistence, isInstalled, requiresOwnRoot) => {
            const found = []

            function noteExists(noteId) {
                if (!noteId) return false
                const note = api.getNote(noteId)
                return !!(note && !note.isDeleted)
            }
            function resolveLocal(localId) {
                if (!localId) return null
                const note = api.getNoteWithLabel(tamFileIdLabel, `${addonId}/${localId}`)
                return (note && !note.isDeleted) ? note.noteId : null
            }

            let rootNoteId = resolveLocal(manifest.root)
            if (requiresOwnRoot) {
                if (!rootNoteId) {
                    found.push(`root note ('${manifest.root}') is missing`)
                }

                if (manifest.settingsNote && !resolveLocal(manifest.settingsNote)) {
                    found.push(`settings note ('${manifest.settingsNote}') is missing`)
                }
            }

            if (persistence.rootNote && !noteExists(persistence.rootNote)) {
                found.push(`persistence root note (${persistence.rootNote}) is missing`)
            }

            for (const [key, realId] of Object.entries(persistence.persistenceNotes || {})) {
                const note = noteExists(realId) ? api.getNote(realId) : null
                if (!note) {
                    found.push(`persisted note '${key}' (${realId}) is missing`)
                    continue
                }
                // A persisted note must live purely in the #TAMDATAID namespace: carrying
                // #TAMFILEID means it is still entangled with the addon's structural tree and
                // an uninstall/prune sweep could delete it (the hazard this model removes).
                if (note.getLabelValue(tamFileIdLabel)) {
                    found.push(`persisted note '${key}' (${realId}) still carries a #TAMFILEID label — not migrated to the #TAMDATAID model; re-sync ${addonId} to fix`)
                }
                if (note.getLabelValue(tamDataIdLabel) !== `${addonId}/${key}`) {
                    found.push(`persisted note '${key}' (${realId}) is missing its #TAMDATAID '${addonId}/${key}'`)
                }
            }

            if (isInstalled && rootNoteId) {
                for (const noteId of api.getNote(rootNoteId).getSubtreeNoteIds()) {
                    const note = api.getNote(noteId)
                    if (!note) continue
                    // Same guard as connectAddonPersistence/enableAddon (see there for why).
                    const ownTamFileId = note.getLabelValue(tamFileIdLabel)
                    if (!ownTamFileId || !ownTamFileId.startsWith(`${addonId}/`)) continue
                    for (const relation of note.getRelations()) {
                        if (!relation.name.includes("AddonData:")) continue
                        const key = relation.name.split("AddonData:")[1]
                        const expected = (persistence.persistenceNotes || {})[key]
                        if (!expected) {
                            found.push(`relation '${relation.name}' on note ${noteId} has no matching persistence record for key '${key}'`)
                        } else if (relation.value !== expected) {
                            found.push(`relation '${relation.name}' on note ${noteId} points at ${relation.value}, expected persisted note ${expected}`)
                        }
                    }
                }
            }

            return found
        }, [tamFileIdLabel, tamDataIdLabel, addonId, manifest, persistence, isInstalled, requiresOwnRoot])

        for (const message of backendIssues) {
            issues.push({ addonId, message })
        }

        if (!isInstalled) continue

        for (const depEntry of (manifest.dependencies || [])) {
            const depId = dependencyId(depEntry)
            if (!database.installedAddons[depId]?.installedVersion) {
                issues.push({ addonId, message: `depends on '${depId}', which is not installed` })
            }
        }
    }

    return issues
}

module.exports.enableAddon = enableAddon
module.exports.getAllAddons = getAllAddons
module.exports.checkForAddonUpdates = checkForAddonUpdates
module.exports.validateDatabase = validateDatabase
