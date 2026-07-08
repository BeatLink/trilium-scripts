// Facade: re-exports the same public surface this note has always had, now assembled from
// focused sibling files instead of one monolith. See CLAUDE.md's manifest-driven addon
// architecture section, and each required file's own header comment, for what owns what.

const { addCatalog, deleteCatalog, getCatalogs, fetchCatalogMeta, fetchCatalogAddons } = require("libTAMCatalog.js")
const { syncAddon, installByUrl, getPendingPrompts, resolvePrompt, clearPendingPrompts } = require("libTAMSync.js")
const { enableAddon, getAllAddons, checkForAddonUpdates, validateDatabase } = require("libTAMLifecycle.js")
const { cleanupEmptyPersistenceRoots } = require("libTAMPersistence.js")
const { sweepOrphanedNotes, deleteAddon, findExternalReferences, uninstallAddon, reinitializeDatabase } = require("libTAMUninstall.js")
const { fetchReadmeHtml } = require("libTAMNoteResolver.js")

module.exports.addCatalog = addCatalog
module.exports.deleteCatalog = deleteCatalog
module.exports.getCatalogs = getCatalogs
module.exports.fetchCatalogAddons = fetchCatalogAddons
module.exports.fetchCatalogMeta = fetchCatalogMeta
module.exports.getAllAddons = getAllAddons
module.exports.checkForAddonUpdates = checkForAddonUpdates
module.exports.syncAddon = syncAddon
module.exports.installByUrl = installByUrl
module.exports.deleteAddon = deleteAddon
module.exports.uninstallAddon = uninstallAddon
module.exports.reinitializeDatabase = reinitializeDatabase
module.exports.findExternalReferences = findExternalReferences
module.exports.enableAddon = enableAddon
module.exports.getPendingPrompts = getPendingPrompts
module.exports.resolvePrompt = resolvePrompt
module.exports.clearPendingPrompts = clearPendingPrompts
module.exports.validateDatabase = validateDatabase
module.exports.fetchReadmeHtml = fetchReadmeHtml
module.exports.cleanupEmptyPersistenceRoots = cleanupEmptyPersistenceRoots
module.exports.sweepOrphanedNotes = sweepOrphanedNotes
