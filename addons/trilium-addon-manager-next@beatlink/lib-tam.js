// Constants -------------------------------------------------------------------
const databaseLabel = "database"
const addonRootLabel = "addonRoot"
const addonPersistenceLabel = "addonPersistence"
const githubURL = "https://github.com"
const releasesPath = "releases/latest/download"
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
    function versionCompare(remote, local) {
        return remote.localeCompare(local, undefined, { numeric: true, sensitivity: 'base' })
    }
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
    const parentMap = {}
    for (const c of (m.children || []).filter(c => !c.addon)) {
        parentMap[c.child] = c.parent
    }

    const noteIds = m.notes.map(n => n.id)
    const sortedIds = topologicalSort(noteIds, parentMap)

    const noteMap = {}
    for (const localId of sortedIds) {
        const noteDef = m.notes.find(n => n.id === localId)
        if (!noteDef) continue

        const parentLocalId = parentMap[localId]
        const parentRealId = parentLocalId ? noteMap[parentLocalId] : addonRootNoteId
        const content   = noteDef.content  ?? ""
        const noteType  = noteDef.type     ?? "text"
        const mime      = noteDef.mime     ?? "text/html"

        const realNoteId = await api.runOnBackend(
            (parentRealId, title, noteType, mime, content) => {
                const result = api.createTextNote(parentRealId, title, "")
                const note = result.note
                if (noteType !== "text") {
                    note.type = noteType
                    note.mime = mime
                    note.save()
                }
                note.setContent(content)
                return note.noteId
            },
            [parentRealId, noteDef.title, noteType, mime, content]
        )
        noteMap[localId] = realNoteId
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
            api.cloneNote(sourceId, parentId)
        }, [depExportId, parentRealId])
    }
}

async function applyLabels(labels, noteMap) {
    for (const label of labels) {
        const realNoteId = noteMap[label.note]
        if (!realNoteId) continue
        await api.runOnBackend((noteId, name, value) => {
            api.getNote(noteId).setLabel(name, value)
        }, [realNoteId, label.name, label.value ?? ""])
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

async function installAddon(repoId, addonId) {
    if (!repoId.trim() || !addonId.trim()) return

    let database = await loadDatabase()
    if ((database.installedAddons[repoId] || {})[addonId]) return

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

    // Install dependencies first
    for (const depAddonId of (m.dependencies || [])) {
        if (!((database.installedAddons[repoId] || {})[depAddonId])) {
            await installAddon(repoId, depAddonId)
            database = await loadDatabase()
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

    if (!database.installedAddons[repoId]) database.installedAddons[repoId] = {}
    database.installedAddons[repoId][addonId] = {
        installedVersion: manifest.latestVersion,
        rootNoteId,
        noteMap,
        exportedNotes,
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

    // Run entirely on the backend: froca (frontend cache) lags behind api.runOnBackend
    // writes, so note.getRelations() on the frontend would miss freshly-set AddonData:
    // relations. The backend becca cache is always current.
    const newPersistenceNotes = await api.runOnBackend((addonNoteId, persistRoot, existingNotes) => {
        const result = {}
        for (const noteId of api.getNote(addonNoteId).getSubtreeNoteIds()) {
            const note = api.getNote(noteId)
            for (const relation of note.getRelations()) {
                if (!relation.name.includes("AddonData:")) continue
                const key = relation.name.split("AddonData:")[1]
                let persistNoteId = existingNotes[key]
                if (!persistNoteId) {
                    // Branch the data note into the persistence tree — no copy needed.
                    // The same note gains a second parent (persistRoot), so it survives
                    // addon deletion (which only removes the addon-tree branch).
                    api.getNote(relation.value).ensureBranch(persistRoot)
                    persistNoteId = relation.value
                }
                note.setRelation(relation.name, persistNoteId)
                result[key] = persistNoteId
            }
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

async function updateAddon(repoId, addonId) {
    await deleteAddon(repoId, addonId)
    await installAddon(repoId, addonId)
}

async function selfUpdateAddon(repoId, addonId) {
    if (!repoId.trim() || !addonId.trim()) return

    let database = await loadDatabase()
    const installed = (database.installedAddons[repoId] || {})[addonId]
    if (!installed) throw new Error(`TAM: ${addonId} is not installed`)

    const manifest = await fetchManifest(repoId, addonId)
    const m = manifest.manifest ?? {
        notes: manifest.notes ?? [],
        children: [], relations: manifest.relations ?? [],
        labels: manifest.labels ?? [], root: null, dependencies: [], exports: {}
    }

    const { noteMap } = installed

    for (const noteDef of m.notes) {
        if (noteDef.skipOnUpdate) continue
        const realNoteId = noteMap[noteDef.id]
        if (!realNoteId) continue
        const content = noteDef.content ?? ""
        await api.runOnBackend((noteId, content) => {
            api.getNote(noteId).setContent(content)
        }, [realNoteId, content])
    }

    database.installedAddons[repoId][addonId].installedVersion = manifest.latestVersion
    database.installedAddons[repoId][addonId].updateAvailable  = false
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


// Exports ---------------------------------------------------------------------
module.exports.addRepository     = addRepository
module.exports.getAllRepositories = getAllRepositories
module.exports.updateRepositories = updateRepositories
module.exports.deleteRepository  = deleteRepository
module.exports.installAddon      = installAddon
module.exports.deleteAddon       = deleteAddon
module.exports.updateAddon       = updateAddon
module.exports.selfUpdateAddon   = selfUpdateAddon
module.exports.enableAddon       = enableAddon
