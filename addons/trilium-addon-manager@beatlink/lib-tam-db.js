// The Database note's read/write, split out of lib-tam.js into its own
// require()-able note. The `database` relation is resolved via api.currentNote,
// which for a required note is that note itself (Trilium builds a
// FrontendScriptApi per note in the bundle) — so the relation is declared
// "from" lib-tam-db, not from lib-tam. lib-tam.js require()s this as `db`.

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

module.exports.loadDatabase = loadDatabase
module.exports.saveDatabase = saveDatabase
