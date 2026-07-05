// Constants -------------------------------------------------------------------
const databaseLabel = "database"
const addonRootLabel = "addonRoot"
const addonPersistenceLabel = "addonPersistence"
const githubURL = "https://github.com"
const releasesPath = "releases/latest/download"
const TAM_ID = "trilium-addon-manager@beatlink"
const TAM_VERSION = "2.5.2"
const addonLabels = [
    "widget",
    "renderNote",
    "run",
    "customRequestHandler",
    "customResourceHandler",
    "titleTemplate",
    "appCss",
    "webViewSrc",
    "iconPack",
    "runOnNoteCreation",
    "runOnNoteTitleChange",
    "runOnNoteChange",
    "runOnNoteContentChange",
    "runOnNoteDeletion",
    "runOnBranchCreation",
    "runOnBranchChange",
    "runOnBranchDeletion",
    "runOnChildNoteCreation",
    "runOnAttributeCreation",
    "runOnAttributeChange",
    "appTheme"
]


function versionCompare(remote, local) {
    return remote.localeCompare(local, undefined, { numeric: true, sensitivity: 'base' })
}


// Database Management ---------------------------------------------------------

async function getDatabaseNoteId() {
    return await api.currentNote.getRelationValue(databaseLabel)
}

async function loadDatabase() {
    const databaseId = await getDatabaseNoteId()
    const database = await api.runOnBackend((databaseId) => {
        return JSON.parse(api.getNote(databaseId).getContent())
    }, [databaseId])
    if (!database.repositories)    database.repositories    = {}
    if (!database.installedAddons) database.installedAddons = {}
    if (!database.persistence)     database.persistence     = {}
    return database
}

async function saveDatabase(database) {
    const databaseId = await getDatabaseNoteId()
    return await api.runOnBackend((databaseId, database) => {
        return api.getNote(databaseId).setContent(JSON.stringify(database, null, 4))
    }, [databaseId, database])
}


// Repository Management -------------------------------------------------------

async function addRepository(repoId) {
    if (!repoId.trim()) return
    let database = await loadDatabase()
    if (!database.repositories[repoId])            { database.repositories[repoId]            = {} }
    if (!database.repositories[repoId].addons)     { database.repositories[repoId].addons     = {} }
    if (!database.installedAddons[repoId])         { database.installedAddons[repoId]         = {} }
    if (!database.persistence[repoId])             { database.persistence[repoId]             = {} }
    await saveDatabase(database)
    await updateRepositories()
}

async function getAllRepositories() {
    let database = await loadDatabase()
    for (const [repoId, repoData] of Object.entries(database.repositories)) {
        const installedAddons = database.installedAddons[repoId] || {}
        for (const [addonId, addonData] of Object.entries(repoData.addons || {})) {
            if (installedAddons[addonId]) {
                Object.assign(addonData, installedAddons[addonId])
            } else if (addonId === TAM_ID) {
                addonData.installedVersion = TAM_VERSION
                addonData.updateAvailable = addonData.latestVersion !== TAM_VERSION
                addonData.enabled = true
            }
        }
    }
    return database.repositories
}

async function fetchMetadata(repoId) {
    const fullURL = `${githubURL}/${repoId}/${releasesPath}/metadata.json`
    return await api.runAsyncOnBackendWithManualTransactionHandling(async (fullURL) => {
        const response = await fetch(fullURL)
        return await response.json()
    }, [fullURL])
}

async function updateRepositories() {
    let database = await loadDatabase()
    for (let [repoId] of Object.entries(database.repositories)) {
        database.repositories[repoId] = await fetchMetadata(repoId)
    }
    await saveDatabase(database)
    await checkForAddonUpdates()
}

async function checkForAddonUpdates() {
    let database = await loadDatabase()
    for (const [remoteRepoId, remoteRepo] of Object.entries(database.repositories || {})) {
        const installedRepo = database.installedAddons[remoteRepoId]
        if (remoteRepo.addons && installedRepo) {
            for (const [remoteAddonId, remoteAddon] of Object.entries(remoteRepo.addons)) {
                const installedAddon = installedRepo[remoteAddonId]
                if (installedAddon?.installedVersion && remoteAddon?.latestVersion) {
                    installedAddon.updateAvailable = versionCompare(
                        remoteAddon.latestVersion,
                        installedAddon.installedVersion
                    ) > 0
                }
            }

            // Libraries are hidden from the UI, so an update sitting on one
            // would otherwise be invisible. Surface it on whatever depends on
            // it (directly or transitively) instead. Fixed-point loop since
            // updateAvailable only ever flips false->true here, so it always
            // terminates and is insensitive to iteration order (a diamond
            // dependency can otherwise get visited before its own upstream
            // flag has propagated).
            let changed = true
            while (changed) {
                changed = false
                for (const addon of Object.values(installedRepo)) {
                    if (!addon.updateAvailable) continue
                    for (const dependentId of (addon.dependents || [])) {
                        const dependent = installedRepo[dependentId]
                        if (dependent && !dependent.updateAvailable) {
                            dependent.updateAvailable = true
                            changed = true
                        }
                    }
                }
            }
        }
    }
    await saveDatabase(database)
}

async function deleteRepository(repoId) {
    if (!repoId.trim()) return
    let database = await loadDatabase()
    if (!database.installedAddons[repoId] || Object.keys(database.installedAddons[repoId]).length === 0) {
        delete database.installedAddons[repoId]
        delete database.repositories[repoId]
        await saveDatabase(database)
    }
}


// Addon Management ------------------------------------------------------------

async function fetchManifest(repoId, addonId) {
    const fullURL = `${githubURL}/${repoId}/${releasesPath}/${addonId}.json`
    return await api.runAsyncOnBackendWithManualTransactionHandling(async (fullURL) => {
        const response = await fetch(fullURL)
        return await response.json()
    }, [fullURL])
}

async function getAddonRootNoteId() {
    return await api.currentNote.getRelationValue(addonRootLabel)
}

function topologicalSort(noteIds, parentMap) {
    const result = []
    const visited = new Set()

    function visit(id) {
        if (visited.has(id)) return
        visited.add(id)
        const parentId = parentMap[id]
        if (parentId && noteIds.includes(parentId)) visit(parentId)
        result.push(id)
    }

    for (const id of noteIds) visit(id)
    return result
}

async function createNotes(m, addonRootNoteId) {
    // A local note can be listed as a child of more than one parent within
    // the same manifest (a same-addon clone, e.g. a shared settings note
    // pulled into several widgets) — only the first occurrence is where the
    // note actually gets created; every later occurrence is wired up as an
    // additional clone branch afterward. A flat parent-per-child map would
    // silently drop every parent but the last one processed.
    const primaryParent = {}
    const extraParents = {}
    for (const c of (m.children || []).filter(c => !c.addon)) {
        if (!(c.child in primaryParent)) {
            primaryParent[c.child] = c.parent
        } else {
            extraParents[c.child] = extraParents[c.child] || []
            extraParents[c.child].push(c.parent)
        }
    }

    const noteIds = m.notes.map(n => n.id)
    const sortedIds = topologicalSort(noteIds, primaryParent)

    const noteMap = {}
    for (const localId of sortedIds) {
        const noteDef = m.notes.find(n => n.id === localId)
        if (!noteDef) continue

        const parentLocalId = primaryParent[localId]
        const parentRealId = parentLocalId ? noteMap[parentLocalId] : addonRootNoteId
        const content   = noteDef.content  ?? ""
        const noteType  = noteDef.type     ?? "text"
        const mime      = noteDef.mime     ?? "text/html"
        const isBinary  = noteDef.binary   ?? false

        const realNoteId = await api.runOnBackend(
            (parentRealId, title, noteType, mime, content, isBinary) => {
                const result = api.createTextNote(parentRealId, title, "")
                const note = result.note
                if (noteType !== "text" || mime !== "text/html") {
                    note.type = noteType
                    note.mime = mime
                    note.save()
                }
                note.setContent(isBinary ? Buffer.from(content, "base64") : content)
                return note.noteId
            },
            [parentRealId, noteDef.title, noteType, mime, content, isBinary]
        )
        noteMap[localId] = realNoteId
    }

    for (const [childLocalId, parentLocalIds] of Object.entries(extraParents)) {
        const childRealId = noteMap[childLocalId]
        if (!childRealId) continue
        for (const parentLocalId of parentLocalIds) {
            const parentRealId = noteMap[parentLocalId]
            if (!parentRealId) continue
            await api.runOnBackend((sourceId, parentId) => {
                api.toggleNoteInParent(true, sourceId, parentId)
            }, [childRealId, parentRealId])
        }
    }

    return noteMap
}

async function applyDepChildren(m, noteMap, database, repoId) {
    for (const c of (m.children || []).filter(c => c.addon)) {
        const parentRealId = noteMap[c.parent]
        if (!parentRealId) continue

        const depInstalled = (database.installedAddons[repoId] || {})[c.addon]
        if (!depInstalled) {
            console.error(`TAM: dependency ${c.addon} not installed, skipping clone`)
            continue
        }
        const depExportId = (depInstalled.exportedNotes || {})[c.child]
        if (!depExportId) {
            console.error(`TAM: dependency ${c.addon} has no export '${c.child}', skipping`)
            continue
        }

        await api.runOnBackend((sourceId, parentId) => {
            api.toggleNoteInParent(true, sourceId, parentId)
        }, [depExportId, parentRealId])
    }
}

async function applyLabels(labels, noteMap) {
    for (const label of labels) {
        const realNoteId = noteMap[label.note]
        if (!realNoteId) continue
        await api.runOnBackend((noteId, name, value) => {
            api.getNote(noteId).setLabel(name, value)
        }, [realNoteId, label.name, String(label.value ?? "")])
    }
}

async function applyRelations(relations, noteMap, database, repoId) {
    for (const rel of relations) {
        const fromRealId = noteMap[rel.from]
        if (!fromRealId) continue

        let toRealId
        if (rel.addon) {
            const depInstalled = (database.installedAddons[repoId] || {})[rel.addon]
            toRealId = (depInstalled?.exportedNotes || {})[rel.to]
        } else {
            toRealId = noteMap[rel.to] || rel.to
        }
        if (!toRealId) continue

        await api.runOnBackend((fromId, type, toId) => {
            api.getNote(fromId).setRelation(type, toId)
        }, [fromRealId, rel.type, toRealId])
    }
}

function storeExports(exports, noteMap) {
    const exportedNotes = {}
    for (const [localId, exportName] of Object.entries(exports || {})) {
        if (noteMap[localId]) {
            exportedNotes[exportName] = noteMap[localId]
        }
    }
    return exportedNotes
}

async function installAddon(repoId, addonId, options = {}) {
    const { manual = true, updating = new Set() } = options
    if (!repoId.trim() || !addonId.trim()) return

    let database = await loadDatabase()
    const existing = (database.installedAddons[repoId] || {})[addonId]
    if (existing) {
        // Promote a dependency-only install to a real, user-owned install —
        // but never demote the other way (a dependency-resolution call here
        // must not downgrade something the user already installed directly).
        if (manual && !existing.manuallyInstalled) {
            existing.manuallyInstalled = true
            await saveDatabase(database)
        }
        return
    }

    const manifest = await fetchManifest(repoId, addonId)

    // Normalize manifest: TAM-next sub-dict or ricolandia flat top-level
    const m = manifest.manifest ?? {
        notes:        manifest.notes     ?? [],
        children:     [],
        relations:    manifest.relations ?? [],
        labels:       manifest.labels    ?? [],
        root:         null,
        dependencies: [],
        exports:      {}
    }

    if (!m.root) throw new Error(`TAM: manifest for ${addonId} is missing required 'root' field`)

    // Install dependencies first — and update any that are already installed
    // but stale, otherwise a dependency bump (e.g. a note title rename) never
    // reaches addons that already had it installed before the bump, even via
    // "Update All Addons" on the addon that actually changed.
    for (const depAddonId of (m.dependencies || [])) {
        const installedDep = (database.installedAddons[repoId] || {})[depAddonId]
        if (!installedDep) {
            await installAddon(repoId, depAddonId, { manual: false, updating })
            database = await loadDatabase()
        } else {
            const depManifest = await fetchManifest(repoId, depAddonId)
            if (depManifest.latestVersion && installedDep.installedVersion &&
                versionCompare(depManifest.latestVersion, installedDep.installedVersion) > 0) {
                await updateAddon(repoId, depAddonId, updating)
                database = await loadDatabase()
            }
        }

        // Record that addonId depends on depAddonId, regardless of which
        // branch above ran — this is what lets a later update/uninstall of
        // depAddonId find and cascade to addonId.
        const dep = (database.installedAddons[repoId] || {})[depAddonId]
        if (dep) {
            dep.dependents = dep.dependents || []
            if (!dep.dependents.includes(addonId)) {
                dep.dependents.push(addonId)
                await saveDatabase(database)
            }
        }
    }

    const addonRootNoteId = await getAddonRootNoteId()
    const noteMap = await createNotes(m, addonRootNoteId)

    if (!noteMap[m.root]) throw new Error(`TAM: root note '${m.root}' was not created for ${addonId}`)
    const rootNoteId = noteMap[m.root]

    await applyDepChildren(m, noteMap, database, repoId)
    await applyLabels(m.labels || [], noteMap)
    await applyRelations(m.relations || [], noteMap, database, repoId)

    const exportedNotes = storeExports(m.exports, noteMap)
    const settingsNoteId = m.settingsNote ? (noteMap[m.settingsNote] || null) : null

    if (!database.installedAddons[repoId]) database.installedAddons[repoId] = {}
    database.installedAddons[repoId][addonId] = {
        installedVersion: manifest.latestVersion,
        rootNoteId,
        noteMap,
        exportedNotes,
        settingsNoteId,
        dependencies: m.dependencies || [],
        dependents: [],
        manuallyInstalled: manual,
        enabled: false
    }
    if (!database.persistence[repoId])          database.persistence[repoId]          = {}
    if (!database.persistence[repoId][addonId]) database.persistence[repoId][addonId] = {}

    await saveDatabase(database)
    await enableAddon(repoId, addonId, false)
    await connectAddonPersistence(repoId, addonId)
}

async function getPersistenceNoteId() {
    return await api.currentNote.getRelationValue(addonPersistenceLabel)
}

async function connectAddonPersistence(repoId, addonId) {
    const persistenceRoot = await getPersistenceNoteId()
    let database = await loadDatabase()

    if (!database.persistence[repoId][addonId].rootNote) {
        const addonPersistRoot = await api.runOnBackend((persistenceRoot, addonId) => {
            const result = api.createTextNote(persistenceRoot, addonId, "")
            result.note.setLabel("iconClass", "bx bx-customize")
            return result.note.noteId
        }, [persistenceRoot, addonId])
        database.persistence[repoId][addonId].rootNote = addonPersistRoot
    }
    if (!database.persistence[repoId][addonId].persistenceNotes) {
        database.persistence[repoId][addonId].persistenceNotes = {}
    }

    const addonNoteId = database.installedAddons[repoId][addonId].rootNoteId
    const persistRoot  = database.persistence[repoId][addonId].rootNote
    const existingNotes = database.persistence[repoId][addonId].persistenceNotes

    // Single pass: create persisted copies, rewire AddonData: relations, delete originals.
    // Uses removeRelation + addRelation instead of setRelation: removeRelation fires attributeDeleted
    // which properly updates becca's targetRelations reverse index for the old target note.
    // This prevents deleteNote's cascade from finding and killing the rewired relation.
    // Everything runs in one runOnBackend so UI reload from note deletion can't interrupt it.
    const newPersistenceNotes = await api.runOnBackend((addonNoteId, persistRoot, existingNotes) => {
        const result = {}
        const toDelete = []
        for (const noteId of api.getNote(addonNoteId).getSubtreeNoteIds()) {
            const note = api.getNote(noteId)
            for (const relation of note.getRelations()) {
                if (!relation.name.includes("AddonData:")) continue
                const key = relation.name.split("AddonData:")[1]
                const origNoteId = relation.value
                let persistNoteId = existingNotes[key]
                if (!persistNoteId || !api.getNote(persistNoteId)) {
                    const origTitle = api.getNote(origNoteId).title
                    const dup = api.duplicateSubtree(origNoteId, persistRoot)
                    dup.note.title = origTitle
                    dup.note.save()
                    persistNoteId = dup.note.noteId
                }
                note.removeRelation(relation.name)
                note.addRelation(relation.name, persistNoteId)
                result[key] = persistNoteId
                if (origNoteId !== persistNoteId) {
                    toDelete.push(origNoteId)
                }
            }
        }
        for (const noteId of toDelete) {
            const note = api.getNote(noteId)
            if (note) note.deleteNote()
        }
        return result
    }, [addonNoteId, persistRoot, existingNotes])

    database.persistence[repoId][addonId].persistenceNotes = {
        ...existingNotes,
        ...newPersistenceNotes
    }
    await saveDatabase(database)
}

async function deleteAddon(repoId, addonId) {
    if (!repoId.trim() || !addonId.trim()) return
    let database = await loadDatabase()
    const rootNoteId = database.installedAddons[repoId][addonId].rootNoteId
    await api.runOnBackend((noteId) => {
        api.getNote(noteId).deleteNote()
    }, [rootNoteId])
    delete database.installedAddons[repoId][addonId]
    if (Object.keys(database.installedAddons[repoId]).length === 0) {
        delete database.installedAddons[repoId]
    }
    await saveDatabase(database)
}

// The user-facing "uninstall" action. Unlike deleteAddon (the low-level
// primitive — just remove this one addon's own notes), this also removes
// addonId from each of its dependencies' `dependents` list, and recursively
// uninstalls any dependency that's now unused (nothing left depends on it)
// and wasn't itself installed directly by the user.
async function uninstallAddon(repoId, addonId) {
    if (!repoId.trim() || !addonId.trim()) return
    let database = await loadDatabase()
    const installed = (database.installedAddons[repoId] || {})[addonId]
    if (!installed) return

    const dependencies = installed.dependencies || []

    await deleteAddon(repoId, addonId)

    for (const depAddonId of dependencies) {
        database = await loadDatabase()
        const dep = (database.installedAddons[repoId] || {})[depAddonId]
        if (!dep) continue

        dep.dependents = (dep.dependents || []).filter(id => id !== addonId)
        await saveDatabase(database)

        const depIsManual = dep.manuallyInstalled ?? true
        if (!depIsManual && dep.dependents.length === 0) {
            await uninstallAddon(repoId, depAddonId)
        }
    }
}

async function collectPendingPrompts(repoId, addonId, m) {
    let database = await loadDatabase()
    const persistenceNotes = database.persistence?.[repoId]?.[addonId]?.persistenceNotes || {}

    const prompts = []
    for (const noteDef of (m.notes || [])) {
        if (!noteDef.promptOnUpdate) continue

        // Find the AddonData relation that targets this note
        const rel = (m.relations || []).find(r =>
            r.to === noteDef.id && r.type.startsWith("AddonData:")
        )
        if (!rel) continue

        const key = rel.type.split("AddonData:")[1]
        const persistedNoteId = persistenceNotes[key]
        if (!persistedNoteId) continue

        const newContent = noteDef.content ?? ""
        const currentContent = await api.runOnBackend((id) => {
            const note = api.getNote(id)
            return note ? note.getContent() : null
        }, [persistedNoteId])

        if (currentContent === null) continue
        if (currentContent === newContent) continue

        prompts.push({
            noteLocalId: noteDef.id,
            title:       noteDef.title,
            persistedNoteId,
            newContent,
            currentContent
        })
    }
    return prompts
}

async function updateAddon(repoId, addonId, updating = new Set()) {
    if (!repoId.trim() || !addonId.trim()) return

    // Re-entrancy guard: updating a dependency cascades to its dependents,
    // which can legitimately re-encounter the same addon more than once in
    // one cascade (diamond dependencies, or a dependent being the very addon
    // whose own install triggered the dependency update in the first place).
    const key = `${repoId}::${addonId}`
    if (updating.has(key)) return
    updating.add(key)

    const manifest = await fetchManifest(repoId, addonId)
    const m = manifest.manifest ?? {
        notes: manifest.notes ?? [], children: [], relations: manifest.relations ?? [],
        labels: manifest.labels ?? [], root: null, dependencies: [], exports: {}
    }

    const pendingPrompts = await collectPendingPrompts(repoId, addonId, m)

    if (pendingPrompts.length > 0) {
        let database = await loadDatabase()
        if (!database.persistence[repoId])          database.persistence[repoId]          = {}
        if (!database.persistence[repoId][addonId]) database.persistence[repoId][addonId] = {}
        database.persistence[repoId][addonId].pendingPrompts = pendingPrompts
        await saveDatabase(database)
    }

    const database = await loadDatabase()
    const existing      = database.installedAddons[repoId]?.[addonId]
    const wasEnabled     = existing?.enabled ?? false
    const wasManual      = existing?.manuallyInstalled ?? true
    const oldDependents  = existing?.dependents ?? []

    await deleteAddon(repoId, addonId)
    await installAddon(repoId, addonId, { manual: wasManual, updating })

    // installAddon always starts a freshly-(re)installed addon with an empty
    // dependents list (from its own perspective it has none yet) — restore
    // the ones it actually had. Those dependents' clones still point at
    // notes this reinstall just deleted and recreated with new ids, which is
    // exactly why they get cascaded to below.
    if (oldDependents.length > 0) {
        const afterInstall = await loadDatabase()
        if (afterInstall.installedAddons[repoId]?.[addonId]) {
            afterInstall.installedAddons[repoId][addonId].dependents = oldDependents
            await saveDatabase(afterInstall)
        }
    }

    if (wasEnabled) {
        await enableAddon(repoId, addonId, true)
    }

    // Cascade: every dependent's clones of this addon's exports now point at
    // deleted notes, so they need reinstalling too.
    for (const dependentId of oldDependents) {
        const stillInstalled = await loadDatabase()
        if (stillInstalled.installedAddons[repoId]?.[dependentId]) {
            await updateAddon(repoId, dependentId, updating)
        }
    }
}

async function getPendingPrompts(repoId, addonId) {
    const database = await loadDatabase()
    return database.persistence?.[repoId]?.[addonId]?.pendingPrompts || []
}

async function resolvePrompt(repoId, addonId, noteLocalId, useNew) {
    if (!useNew) return
    const database = await loadDatabase()
    const prompts = database.persistence?.[repoId]?.[addonId]?.pendingPrompts || []
    const prompt = prompts.find(p => p.noteLocalId === noteLocalId)
    if (!prompt) return
    await api.runOnBackend((noteId, content) => {
        api.getNote(noteId).setContent(content)
    }, [prompt.persistedNoteId, prompt.newContent])
}

async function clearPendingPrompts(repoId, addonId) {
    let database = await loadDatabase()
    if (database.persistence?.[repoId]?.[addonId]) {
        delete database.persistence[repoId][addonId].pendingPrompts
    }
    await saveDatabase(database)
}

async function selfUpdateAddon(repoId, addonId) {
    if (!repoId.trim() || !addonId.trim()) return

    let database = await loadDatabase()
    const manifest = await fetchManifest(repoId, addonId)
    const m = manifest.manifest ?? {
        notes: manifest.notes ?? [],
        children: [], relations: manifest.relations ?? [],
        labels: manifest.labels ?? [], root: null, dependencies: [], exports: {}
    }

    const installed = (database.installedAddons[repoId] || {})[addonId]
    let noteMap
    if (installed) {
        noteMap = installed.noteMap
    } else {
        // TAM was imported manually — discover note IDs by traversing from lib-tam upward
        const libTamNoteId = api.currentNote.noteId
        noteMap = await api.runOnBackend((libTamNoteId, manifestNotes) => {
            const result = {}
            const sourceCode = api.getNote(libTamNoteId).getParentNotes()[0]
            const tamRoot = sourceCode ? sourceCode.getParentNotes()[0] : null
            if (!tamRoot) return result
            for (const noteId of tamRoot.getSubtreeNoteIds()) {
                const note = api.getNote(noteId)
                const def = manifestNotes.find(n => n.title === note.title)
                if (def) result[def.id] = noteId
            }
            return result
        }, [libTamNoteId, m.notes])
    }

    for (const noteDef of m.notes) {
        if (noteDef.skipOnUpdate) continue
        const realNoteId = noteMap[noteDef.id]
        if (!realNoteId) continue
        const content = noteDef.content ?? ""
        await api.runOnBackend((noteId, content) => {
            api.getNote(noteId).setContent(content)
        }, [realNoteId, content])
    }

    if (!database.installedAddons[repoId]) database.installedAddons[repoId] = {}
    if (!installed) {
        database.installedAddons[repoId][addonId] = {
            installedVersion: manifest.latestVersion,
            rootNoteId: noteMap[m.root],
            noteMap,
            exportedNotes: {},
            dependencies: [],
            dependents: [],
            manuallyInstalled: true,
            enabled: true
        }
    } else {
        database.installedAddons[repoId][addonId].installedVersion = manifest.latestVersion
        database.installedAddons[repoId][addonId].updateAvailable  = false
    }
    await saveDatabase(database)
}

async function enableAddon(repoId, addonId, enabled) {
    if (!repoId.trim() || !addonId.trim()) return
    let database = await loadDatabase()
    const rootNoteId = database.installedAddons[repoId][addonId].rootNoteId
    await api.runOnBackend((noteId, enabled, addonLabels) => {
        const ids = api.getNote(noteId).getSubtreeNoteIds()
        for (const id of ids) {
            const note = api.getNote(id)
            const attributes = note.getAttributes() || []
            for (const attribute of attributes) {
                if (enabled === true) {
                    if (attribute.name.toLowerCase().includes("disabled:")) {
                        const name = attribute.name.replace("disabled:", "")
                        const value = attribute.value
                        const type = attribute.type
                        const isInheritable = attribute.isInheritable
                        const position = attribute.position
                        note.removeAttribute(type, attribute.name)
                        note.addAttribute(type, name, value, isInheritable, position)
                    }
                } else {
                    if (addonLabels.includes(attribute.name)) {
                        const name = `disabled:${attribute.name}`
                        const value = attribute.value
                        const type = attribute.type
                        const isInheritable = attribute.isInheritable
                        const position = attribute.position
                        note.removeAttribute(type, attribute.name)
                        note.addAttribute(type, name, value, isInheritable, position)
                    }
                }
            }
        }
    }, [rootNoteId, enabled, addonLabels])
    database.installedAddons[repoId][addonId].enabled = enabled
    await saveDatabase(database)
}


// Validates the whole installed-addon graph against the real Trilium note
// tree: dependency/dependent edges are symmetric, every note id TAM recorded
// (root, noteMap, exportedNotes, settingsNoteId, persistence root/notes)
// still exists, and every live AddonData: relation in an addon's subtree
// still points at the persisted copy TAM thinks it does. Returns a flat list
// of { repoId, addonId, message } issues (empty if everything checks out).
async function validateDatabase() {
    const database = await loadDatabase()
    const issues = []

    for (const [repoId, addons] of Object.entries(database.installedAddons || {})) {
        for (const [addonId, addon] of Object.entries(addons || {})) {
            const persistence = database.persistence?.[repoId]?.[addonId] || {}

            const backendIssues = await api.runOnBackend((addon, persistence) => {
                const found = []

                function noteExists(noteId) {
                    if (!noteId) return false
                    const note = api.getNote(noteId)
                    return !!(note && !note.isDeleted)
                }

                if (!noteExists(addon.rootNoteId)) {
                    found.push(`root note (${addon.rootNoteId}) is missing`)
                }

                for (const [localId, realId] of Object.entries(addon.noteMap || {})) {
                    if (!noteExists(realId)) {
                        found.push(`note '${localId}' (${realId}) is missing`)
                    }
                }

                for (const [exportName, realId] of Object.entries(addon.exportedNotes || {})) {
                    if (!noteExists(realId)) {
                        found.push(`export '${exportName}' (${realId}) is missing`)
                    }
                }

                if (addon.settingsNoteId && !noteExists(addon.settingsNoteId)) {
                    found.push(`settings note (${addon.settingsNoteId}) is missing`)
                }

                if (persistence.rootNote && !noteExists(persistence.rootNote)) {
                    found.push(`persistence root note (${persistence.rootNote}) is missing`)
                }

                for (const [key, realId] of Object.entries(persistence.persistenceNotes || {})) {
                    if (!noteExists(realId)) {
                        found.push(`persisted note '${key}' (${realId}) is missing`)
                    }
                }

                if (noteExists(addon.rootNoteId)) {
                    for (const noteId of api.getNote(addon.rootNoteId).getSubtreeNoteIds()) {
                        const note = api.getNote(noteId)
                        if (!note) continue
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
            }, [addon, persistence])

            for (const message of backendIssues) {
                issues.push({ repoId, addonId, message })
            }

            for (const depAddonId of (addon.dependencies || [])) {
                const dep = addons[depAddonId]
                if (!dep) {
                    issues.push({ repoId, addonId, message: `depends on '${depAddonId}', which is not installed` })
                    continue
                }
                if (!(dep.dependents || []).includes(addonId)) {
                    issues.push({ repoId, addonId, message: `depends on '${depAddonId}', but is not listed in its dependents` })
                }
            }
            for (const dependentId of (addon.dependents || [])) {
                const dependent = addons[dependentId]
                if (!dependent) {
                    issues.push({ repoId, addonId, message: `lists '${dependentId}' as a dependent, but it is not installed` })
                    continue
                }
                if (!(dependent.dependencies || []).includes(addonId)) {
                    issues.push({ repoId, addonId, message: `lists '${dependentId}' as a dependent, but it does not declare this as a dependency` })
                }
            }
        }
    }

    return issues
}


// Exports ---------------------------------------------------------------------
module.exports.addRepository      = addRepository
module.exports.getAllRepositories  = getAllRepositories
module.exports.updateRepositories  = updateRepositories
module.exports.deleteRepository   = deleteRepository
module.exports.installAddon       = installAddon
module.exports.deleteAddon        = deleteAddon
module.exports.uninstallAddon     = uninstallAddon
module.exports.updateAddon        = updateAddon
module.exports.selfUpdateAddon    = selfUpdateAddon
module.exports.enableAddon        = enableAddon
module.exports.getPendingPrompts  = getPendingPrompts
module.exports.resolvePrompt      = resolvePrompt
module.exports.clearPendingPrompts = clearPendingPrompts
module.exports.validateDatabase    = validateDatabase
