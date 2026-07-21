// TAM's database-access layer: the Database note's read/write and the three
// relation-id getters. Split out of lib-tam.js into its own require()-able note
// so the database/addonRoot/addonPersistence relations resolve against THIS
// note's api.currentNote — a required note's api.currentNote is the required
// note itself (Trilium builds a FrontendScriptApi per note in the bundle), so
// those relations are declared "from" lib-tam-db, not from lib-tam.

const databaseLabel = "database"
const addonRootLabel = "addonRoot"
const addonPersistenceLabel = "addonPersistence"

async function getDatabaseNoteId() {
    return await api.currentNote.getRelationValue(databaseLabel)
}

async function loadDatabase() {
    const database = await api.runOnBackend((databaseId) => {
        return JSON.parse(api.getNote(databaseId).getContent())
    }, [await getDatabaseNoteId()])
    if (!database.catalogs) database.catalogs = []
    if (!database.installedAddons) database.installedAddons = {}
    return database
}

async function saveDatabase(database) {
    return await api.runOnBackend((databaseId, database) => {
        return api.getNote(databaseId).setContent(JSON.stringify(database, null, 4))
    }, [await getDatabaseNoteId(), database])
}

async function getAddonRootNoteId() {
    return await api.currentNote.getRelationValue(addonRootLabel)
}

async function getPersistenceNoteId() {
    return await api.currentNote.getRelationValue(addonPersistenceLabel)
}

module.exports.getDatabaseNoteId = getDatabaseNoteId
module.exports.loadDatabase = loadDatabase
module.exports.saveDatabase = saveDatabase
module.exports.getAddonRootNoteId = getAddonRootNoteId
module.exports.getPersistenceNoteId = getPersistenceNoteId
