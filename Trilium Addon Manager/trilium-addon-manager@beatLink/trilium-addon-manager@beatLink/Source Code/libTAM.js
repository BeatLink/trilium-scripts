// Constants -------------------------------------------------------------------
const databaseLabel = "database"
const githubURL = "https://github.com"
const releasesPath = "releases/latest/download"
const dangerousLabels = [
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
];


// Helper Functions -------------------------------------------------------------


// Fetch metadata.json from repo
async function fetchMetadata(repoId){
    const fullURL = `${githubURL}/${repoId}/${releasesPath}/metadata.json`
    return await api.runAsyncOnBackendWithManualTransactionHandling(async (fullURL) => {
        const response = await fetch(fullURL)
        return await response.json()
    }, [fullURL])  
}


// Download and return the Addon zip file as blob
async function fetchAddonData(repoId, addonId){
    const fullURL = `${githubURL}/${repoId}/${releasesPath}/${addonId}.zip`
    const blobString = await api.runAsyncOnBackendWithManualTransactionHandling(async (fullURL) => {
        const response = await fetch(fullURL)
        const blob = await response.blob()
        const buffer = Buffer.from(await blob.arrayBuffer())
        return `data:${blob.type};base64,${buffer.toString('base64')}`    
    }, [fullURL])
    const blob = (await fetch(blobString)).blob()
    return blob
}


// Imports the addon into the application
async function importAddonZip(password, parentNote, addonId, addonData){
    // Get Authorization Token
    const loginResponse = await fetch(
        "/api/login/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: 'same-origin',
            body: JSON.stringify({ password: password })
        })
    const authToken = (await loginResponse.json()).token
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
            headers: { 
                "authorization": `Bearer ${authToken}`,
                "x-csrf-token": window.glob.csrfToken
            },
            credentials: 'same-origin',
            body: formData
        })).json()
    return response.noteId
}

// Check if the addon is enabled
async function addonEnabled(noteId) {
    if (!noteId) return
    const result = await api.runOnBackend((noteId) => {
        const ids = api.getNote(noteId).getSubtreeNoteIds()
        for (const id of ids) {
            const attributes = api.getNote(id).getAttributes() || [];
            for (const attribute of attributes) {
                if (attribute.name.toLowerCase().includes("disabled:")) {
                    return false;
                }
            }            
        }
        return true
    }, [noteId])
    return result
}


// Database Management ---------------------------------------------------------

async function getDatabaseNoteId() {
    return await api.currentNote.getRelationValue(databaseLabel)
}

async function loadDatabase() {
    const databaseId = await getDatabaseNoteId()
    return await api.runOnBackend((databaseId) => {
        return JSON.parse(api.getNote(databaseId).getContent())
    }, [databaseId])
}

async function saveDatabase(database) {
    const databaseId = await getDatabaseNoteId()
    return await api.runOnBackend((databaseId, database) => {
        return api.getNote(databaseId).setContent(JSON.stringify(database, null, 4))
    }, [databaseId, database])
}

// Repository Management --------------------------------------------------------
async function addRepository(repoId) {
    if (!repoId.trim()) return
    let database = await loadDatabase()
    if (database.repositories[repoId]) return
    database.repositories[repoId] = {}
    await saveDatabase(database)
    await updateRepositories()
}

// Get list of repos
async function getAllRepositories() {
    let database = await loadDatabase()
    for (const [repoId, repoData] of Object.entries(database.repositories)) {
        if (repoData.addons && database.installedAddons[repoId]){
            for (const [addonId, addonData] of Object.entries(database.repositories[repoId].addons)) {
                if (database.installedAddons[repoId][addonId]) {
                    database.repositories[repoId].addons[addonId].installedVersion = 
                        database.installedAddons[repoId][addonId].latestVersion
                    const installedVersion = database.repositories[repoId].addons[addonId].installedVersion
                    const latestVersion = database.repositories[repoId].addons[addonId].latestVersion
                    if ((latestVersion.localeCompare(installedVersion, undefined, { numeric: true, sensitivity: 'base' })) > 0 ) {
                        database.repositories[repoId].addons[addonId].updateAvailable = true
                    } else {
                        database.repositories[repoId].addons[addonId].updateAvailable = false
                    }
                    
                    if (await addonEnabled(database.installedAddons[repoId][addonId].noteId)){
                        database.repositories[repoId].addons[addonId].enabled = true
                    } else {
                        database.repositories[repoId].addons[addonId].enabled = false                        
                    }
                }
            }
        }
    }
    return database.repositories
}

async function updateRepositories() {
    let database = await loadDatabase()
    for (const repository of Object.keys(database.repositories)) {
        const repoData = await fetchMetadata(repository)
        database.repositories[repository] = repoData
    }
    await saveDatabase(database)
}

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


// Install the Addon
async function installAddon(repoId, addonId){
    if (!repoId.trim() || !addonId.trim()) return
    let database = await loadDatabase()
    if (!database.password){
        const response = await api.showPromptDialog({
            title: "Enter Client Password",
            message: "To install addons, please enter your Trilium Client Password (the password used to access the web interface)",
        })
        if (response) {
            console.log(response)
            database.password = response
        } else {
            api.showMessage("To install addons, set your Trilium Password in the Database section", 5000, "bx bx-error")
            return
        }
    }
    const addonData = await fetchAddonData(repoId, addonId)
    const addonRootNote = await getDatabaseNoteId()
    const addonNoteId = await importAddonZip(database.password, addonRootNote, addonId, addonData)
    if (!database.installedAddons[repoId]) {
        database.installedAddons[repoId] = {}    
    }
    database.installedAddons[repoId][addonId] = {
        "latestVersion": database.repositories[repoId].addons[addonId].latestVersion,
        "noteId": addonNoteId
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
    console.log(noteId)
    const result = await api.runOnBackend((noteId, enabled, dangerousLabels) => {
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
                    if (dangerousLabels.includes(attribute.name)){
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
    }, [noteId, enabled, dangerousLabels])
    
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