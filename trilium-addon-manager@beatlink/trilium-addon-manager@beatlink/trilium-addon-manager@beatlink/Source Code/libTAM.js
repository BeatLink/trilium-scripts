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
];


// Database Management ---------------------------------------------------------


// Get the database Note ID
async function getDatabaseNoteId() {
    return await api.currentNote.getRelationValue(databaseLabel)
}


// Load the database and initialize any missing elements
async function loadDatabase() {
    const databaseId = await getDatabaseNoteId()
    const database = await api.runOnBackend((databaseId) => {
        return JSON.parse(api.getNote(databaseId).getContent())
    }, [databaseId])
    if (!database.repositories) {database.repositories = {}}
    if (!database.installedAddons) {database.installedAddons = {}}
    if (!database.persistence) { database.persistence = {} }
    return database
}


// Save the database to file
async function saveDatabase(database) {
    const databaseId = await getDatabaseNoteId()
    return await api.runOnBackend((databaseId, database) => {
        return api.getNote(databaseId).setContent(JSON.stringify(database, null, 4))
    }, [databaseId, database])
}



// Repository Management --------------------------------------------------------


// Add a repository
async function addRepository(repoId) {
    if (!repoId.trim()) return
    let database = await loadDatabase()
    if (!database.repositories[repoId]) { database.repositories[repoId] = {} }
    if (!database.repositories[repoId].addons) { database.repositories[repoId].addons = {} }
    if (!database.installedAddons[repoId]) { database.installedAddons[repoId] = {} }
    if (!database.persistence[repoId]) { database.persistence[repoId] = {} }
    await saveDatabase(database)
    await updateRepositories()
}

    
// Get list of repos
async function getAllRepositories() {
    let database = await loadDatabase();
    for (const [repoId, repoData] of Object.entries(database.repositories)) {
        const installedAddons = database.installedAddons[repoId]
        for (const [addonId, addonData] of Object.entries(repoData.addons)) {
            if (installedAddons[addonId]) {
                Object.assign(addonData, installedAddons[addonId])
            }
        }
    }
    return database.repositories
}


// Fetch metadata.json from repo
async function fetchMetadata(repoId){
    const fullURL = `${githubURL}/${repoId}/${releasesPath}/metadata.json`
    return await api.runAsyncOnBackendWithManualTransactionHandling(async (fullURL) => {
        const response = await fetch(fullURL)
        return await response.json()
    }, [fullURL])  
}


// Update Repository 
async function updateRepositories() {
    let database = await loadDatabase()
    for (let [repoId, repoData] of Object.entries(database.repositories)) {
        repoData = await fetchMetadata(repoId)
        database.repositories[repoId] = repoData
    }
    await saveDatabase(database)
    await checkForAddonUpdates(database)
}


// Check addons for updates
async function checkForAddonUpdates(){
    function versionCompare(remote, local){
        return remote.localeCompare(local, undefined, { numeric: true, sensitivity: 'base' })
    }
    let database = await loadDatabase()
    for (const [remoteRepoId, remoteRepo] of Object.entries(database.repositories || {})) {
        let installedRepo = database.installedAddons[remoteRepoId]
        if (remoteRepo.addons && installedRepo){
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


// Delete Repository
async function deleteRepository(repoId) {
    if (!repoId.trim()) return
    let database = await loadDatabase()
    if (!database.installedAddons[repoId] || Object.keys(database.installedAddons[repoId]).length === 0){
        delete database.installedAddons[repoId]
        delete database.repositories[repoId]
        await saveDatabase(database)
    }
}


// Addon Management -------------------------------------------------------------------------


// Download and return the Addon zip file as blob
async function fetchAddonData(repoId, addonId){
    const fullURL = `${githubURL}/${repoId}/${releasesPath}/${addonId}.zip`
    const blobString = await api.runAsyncOnBackendWithManualTransactionHandling(async (fullURL) => {
        const response = await fetch(fullURL)
        const blob = await response.blob()
        const buffer = Buffer.from(await blob.arrayBuffer())
        return `data:${blob.type};base64,${buffer.toString('base64')}`    
    }, [fullURL])
    const blob = await (await fetch(blobString)).blob()
    return blob
}


// Imports the addon into the application
async function importAddonZip(parentNote, addonId, addonData){
    // Prepare Addon Form Data
    const addonDataFile = new File([addonData], `${addonId}.zip`)
    const formData  = new FormData()
    formData.append("upload", addonDataFile)
    formData.append("safeImport", true)
    formData.append("textImportedAsText", true)
    formData.append("codeImportedAsCode", true)
    formData.append("explodeArchives", true)
    formData.append("last", true)
    // Import the addon zip
    const response = await (await fetch(
        `/api/notes/${parentNote}/notes-import`, {
            method: "POST",
            headers: { "x-csrf-token": window.glob.csrfToken },
            credentials: 'same-origin',
            body: formData
        })).json()
    return response.noteId
}


// Get the addon source code root note ID
async function getAddonRootNoteId() {
    return await api.currentNote.getRelationValue(addonRootLabel)
}


// Install the Addon
async function installAddon(repoId, addonId){
    if (!repoId.trim() || !addonId.trim()) return
    let database = await loadDatabase()
    const addonData = await fetchAddonData(repoId, addonId)
    const addonRootNote = await getAddonRootNoteId()
    const addonNoteId = await importAddonZip(addonRootNote, addonId, addonData)
    database.installedAddons[repoId][addonId] = {
        "installedVersion": database.repositories[repoId].addons[addonId].latestVersion,
        "noteId": addonNoteId
    }
    if (!database.persistence[repoId][addonId]) { database.persistence[repoId][addonId] = {} }
    await saveDatabase(database)
    await enableAddon(repoId, addonId, false)
    await connectAddonPersistence(repoId, addonId)
}

async function getPersistenceNoteId() {
    return await api.currentNote.getRelationValue(addonPersistenceLabel)
}


async function connectAddonPersistence(repoId, addonId){
    let persistenceRoot = await getPersistenceNoteId()
    let database = await loadDatabase()

    // Initialize Database Fields
    if (!database.persistence[repoId][addonId].rootNote){
        const addonRoot = await api.runOnBackend((persistenceRoot, addonId) => {
            const result = api.createTextNote(
                persistenceRoot,
                addonId,
                ""
            )
            result.note.setLabel("iconClass", "bx bx-customize")
            return result.note.noteId
        }, [persistenceRoot, addonId])
        database.persistence[repoId][addonId].rootNote = addonRoot 
    }
    if (!database.persistence[repoId][addonId].persistenceNotes){
        database.persistence[repoId][addonId].persistenceNotes = {}
    }
    // Get the Addon Source Code Root
    const addonNoteId = database.installedAddons[repoId][addonId].noteId
    // For each note in addon source code
    const addonNotes = await (await api.getNote(addonNoteId)).getSubtreeNotes()
    for (const note of addonNotes){
        for (const relation of note.getRelations()){
            // If relation includes AddonData:
            if (relation.name.includes("AddonData:")){
                const relationName = relation.name.split("AddonData:")[1];
                // If relation doesnt have a persistence note in the database
                if (!(relationName in database.persistence[repoId][addonId].persistenceNotes)) {
                    // Clone the current note to the persistence store and save to database
                    const noteId = await api.runOnBackend((addonNote, addonRootNote) => {
                        const result = api.duplicateSubtree(addonNote, addonRootNote)
                        result.note.title = result.note.title.replace(" (dup)", "")
                        result.note.save()
                        return result.note.noteId
                    }, [relation.value, database.persistence[repoId][addonId].rootNote])
                    database.persistence[repoId][addonId].persistenceNotes[relationName] = noteId
                // Relation has a persistence note in the database
                }
                // Point the relation to the persistence note
                await api.runOnBackend((noteId, relation, target) => {
                    api.getNote(noteId).setRelation(relation, target)                        
                }, [note.noteId, relation.name, database.persistence[repoId][addonId].persistenceNotes[relationName]])
            }
        }
    }
    await saveDatabase(database)
}


// Delete the addon
async function deleteAddon(repoId, addonId){
    if (!repoId.trim() || !addonId.trim()) return
    let database = await loadDatabase()
    const noteId = database.installedAddons[repoId][addonId].noteId
    await api.runOnBackend((noteId) => {
        api.getNote(noteId).deleteNote()  
    }, [noteId])
    delete database.installedAddons[repoId][addonId]
    if (Object.keys(database.installedAddons[repoId]).length === 0){
        delete database.installedAddons[repoId]
    }
    await saveDatabase(database)
}


// Update the addon
async function updateAddon(repoId, addonId){
    await deleteAddon(repoId, addonId)
    await installAddon(repoId, addonId)
}


// Enable or Disable the Addon
async function enableAddon(repoId, addonId, enabled){
    if (!repoId.trim() || !addonId.trim()) return
    let database = await loadDatabase()
    const noteId = database.installedAddons[repoId][addonId].noteId
    await api.runOnBackend((noteId, enabled, addonLabels) => {
        const ids = api.getNote(noteId).getSubtreeNoteIds()
        for (const id of ids) {
            const note = api.getNote(id)
            const attributes = note.getAttributes() || [];
            for (const attribute of attributes) {
                if (enabled == true){
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
                    if (addonLabels.includes(attribute.name)){
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
    }, [noteId, enabled, addonLabels])
    database.installedAddons[repoId][addonId].enabled = enabled
    await saveDatabase(database)
}


// Exports ---------------------------------------------------------------------------------------
module.exports.addRepository = addRepository
module.exports.getAllRepositories = getAllRepositories
module.exports.updateRepositories = updateRepositories
module.exports.deleteRepository = deleteRepository
module.exports.installAddon = installAddon
module.exports.deleteAddon = deleteAddon
module.exports.updateAddon = updateAddon
module.exports.enableAddon = enableAddon