// Owns the Database/Addons/Addon-Data note ids and their relations, all resolved via
// api.currentNote — that only works while this code physically executes in the note the
// manifest's database/addonRoot/addonPersistence relations point "from". Anything that
// just needs one of these ids should receive it as a parameter instead of living here.

const databaseLabel = "database"
const addonRootLabel = "addonRoot"
const addonPersistenceLabel = "addonPersistence"
const tamFileIdLabel = "TAMFILEID"
// Identity of a persisted (AddonData:) note living under "Addon Data". Deliberately a
// SEPARATE namespace from tamFileIdLabel: every uninstall/prune sweep scans by #TAMFILEID,
// so a persisted note tagged only with this can never be caught by them. Value: `addonId/key`.
const tamDataIdLabel = "TAMDATAID"
const TAM_ID = "trilium-addon-manager@beatlink"
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

module.exports.databaseLabel = databaseLabel
module.exports.addonRootLabel = addonRootLabel
module.exports.addonPersistenceLabel = addonPersistenceLabel
module.exports.tamFileIdLabel = tamFileIdLabel
module.exports.tamDataIdLabel = tamDataIdLabel
module.exports.TAM_ID = TAM_ID
module.exports.addonLabels = addonLabels
module.exports.getDatabaseNoteId = getDatabaseNoteId
module.exports.loadDatabase = loadDatabase
module.exports.saveDatabase = saveDatabase
module.exports.getAddonRootNoteId = getAddonRootNoteId
module.exports.getPersistenceNoteId = getPersistenceNoteId
