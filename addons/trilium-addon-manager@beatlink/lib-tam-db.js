const databaseLabel = "database"

async function loadDatabase() {
    const databaseNoteId = await api.currentNote.getRelationValue(databaseLabel)
    const database = await api.runOnBackend(
        (databaseId) => {
            const note = api.getNote(databaseId)
            const content = note.getContent()
            const json = JSON.parse(content)
            return json
        },
        [databaseNoteId]
    )
    if (!database.catalogs) database.catalogs = []
    if (!database.installedAddons) database.installedAddons = {}
    return database
}

async function saveDatabase(database) {
    const databaseNoteId = await api.currentNote.getRelationValue(databaseLabel)
    return await api.runOnBackend(
        (databaseId, database) => {
            const note = api.getNote(databaseId)
            const json = JSON.stringify(database, null, 4)
            return note.setContent(json)
        },
        [databaseNoteId, database]
    )
}


const addonRootLabel = "addonRoot"

async function getAddonRootNoteId() {
    return await api.currentNote.getRelationValue(addonRootLabel)
}

const addonPersistenceLabel = "addonPersistence"

async function getPersistenceNoteId() {
    return await api.currentNote.getRelationValue(addonPersistenceLabel)
}

module.exports.getDatabaseNoteId = getDatabaseNoteId
module.exports.loadDatabase = loadDatabase
module.exports.saveDatabase = saveDatabase
module.exports.getAddonRootNoteId = getAddonRootNoteId
module.exports.getPersistenceNoteId = getPersistenceNoteId
