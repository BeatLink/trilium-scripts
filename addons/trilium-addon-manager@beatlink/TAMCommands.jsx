// The data/command layer: owns every piece of state that comes from or drives a libTAM.js
// call, and processes dispatched commands. TAM.jsx itself only owns UI-navigation/dialog
// state (which view is open, validation results) and composes this hook's output into JSX.

import { useState, useEffect } from "trilium:preact"
import { activateNote } from "trilium:api"
import { TAM_ID } from "TAMShared.jsx"
const libTAMjs = require("libTAM.js")

// useTamCommands takes its cross-cutting dependencies as explicit parameters rather than
// reading them itself:
// - resolveDisplayNote(): currentNote only resolves correctly in the note it physically
//   executes in (tam-jsx, not here), so TAM.jsx owns that read and injects it in.
// - dialogActions: the handful of setters (setExternalRefWarning/setView/setValidationTitle/
//   setValidationIssues) that a few commands need to update — these are pure UI-dialog state
//   that belongs to TAM.jsx, not to this data layer.
function useTamCommands(resolveDisplayNote, dialogActions) {
    const { setExternalRefWarning, setView, setValidationTitle, setValidationIssues } = dialogActions

    const [command, setCommand] = useState(null)
    const [addons, setAddons] = useState(null)
    const [catalogs, setCatalogs] = useState([])
    const [catalogBrowse, setCatalogBrowse] = useState(null) // { url, webUrl, entries, loading }
    const [catalogAddons, setCatalogAddons] = useState({}) // merged { [addonId]: entry } across every added catalog
    const [pendingPrompts, setPendingPrompts] = useState([])
    const [promptAddonId, setPromptAddonId] = useState(null)
    const [promptQueue, setPromptQueue] = useState([])
    // Extra detail a handler can surface alongside its generic command label
    // while it's running — currently just update-all's "which addon, how
    // far through the queue" (the single dispatched command object doesn't
    // change across that whole loop, so it can't carry this by itself).
    const [progressDetail, setProgressDetail] = useState(null)

    async function reload() {
        const freshAddons = await libTAMjs.getAllAddons()
        setAddons(freshAddons)
        setCatalogs(await libTAMjs.getCatalogs())
        return freshAddons
    }

    // Merges every added catalog's addons into one id-keyed map, so the main
    // list can show everything browsable, not just what's installed.
    async function loadCatalogAddons(catalogUrls) {
        const results = await Promise.all(catalogUrls.map(async url => {
            try {
                const { addons: entries } = await libTAMjs.fetchCatalogAddons(url)
                return entries
            } catch (e) {
                console.error("TAM: failed to fetch catalog", url, e)
                return []
            }
        }))
        const merged = {}
        for (const entries of results) for (const e of entries) merged[e.id] = e
        setCatalogAddons(merged)
    }

    // Shared tail of most mutating commands: reload state, return to the note the widget
    // was opened from, and hard-reload the page so every other widget picks up the change.
    async function reloadAndActivate() {
        await reload()
        await activateNote(await resolveDisplayNote())
        window.location.reload()
    }

    // Shared by resolve-prompts and update-all: pop the next queued addon's prompts for
    // review, or clear out and fall through to reloadAndActivate if the queue is empty.
    async function advancePromptQueue(queue) {
        if (queue.length > 0) {
            const [next, ...rest] = queue
            setPendingPrompts(await libTAMjs.getPendingPrompts(next))
            setPromptAddonId(next)
            setPromptQueue(rest)
        } else {
            setPendingPrompts([])
            setPromptAddonId(null)
            await reloadAndActivate()
        }
    }

    async function handleLoadAddons() {
        const freshAddons = await reload()
        await loadCatalogAddons(await libTAMjs.getCatalogs())
        // TAM's own Database record starts out seeded with just a manifestSourceUrl (see
        // database.json) — if its first sync hasn't completed yet, run it now, the same
        // way any other addon's first sync would run.
        if (!freshAddons[TAM_ID]?.installedVersion) {
            setCommand({ command: "update-addon", addon: TAM_ID })
        }
    }

    async function handleAddCatalog(command) {
        await libTAMjs.addCatalog(command.url)
        await reload()
        await loadCatalogAddons(await libTAMjs.getCatalogs())
    }

    async function handleDeleteCatalog(command) {
        await libTAMjs.deleteCatalog(command.url)
        await reload()
        await loadCatalogAddons(await libTAMjs.getCatalogs())
    }

    async function handleBrowseCatalog(command) {
        setCatalogBrowse({ url: command.url, webUrl: null, entries: [], loading: true })
        const { webUrl, addons: entries } = await libTAMjs.fetchCatalogAddons(command.url)
        setCatalogBrowse({ url: command.url, webUrl, entries, loading: false })
    }

    async function handleVisitCatalogWebsite(command) {
        const { webUrl } = await libTAMjs.fetchCatalogMeta(command.url)
        if (webUrl) {
            window.open(webUrl, "_blank")
        } else {
            api.showMessage("This catalog doesn't declare a website URL.")
        }
    }

    async function handleInstallAddon(command) {
        await libTAMjs.syncAddon(command.addon, {
            manifestSourceUrl: command.manifestSourceUrl,
            catalogContext: command.catalogContext
        })
        await reloadAndActivate()
    }

    async function handleInstallByUrl(command) {
        await libTAMjs.installByUrl(command.url)
        await reloadAndActivate()
    }

    async function handleRequestUninstall(command) {
        const references = await libTAMjs.findExternalReferences(command.addon)
        if (references.length > 0) {
            setExternalRefWarning({ addonId: command.addon, references })
        } else {
            setCommand({ command: "delete-addon", addon: command.addon })
        }
    }

    async function handleDeleteAddon(command) {
        await libTAMjs.uninstallAddon(command.addon)
        await reload()
        setView({ type: "list" })
        await activateNote(await resolveDisplayNote())
        window.location.reload()
    }

    async function handleUpdateAddon(command) {
        await libTAMjs.syncAddon(command.addon)
        const prompts = await libTAMjs.getPendingPrompts(command.addon)
        if (prompts.length > 0) {
            setPendingPrompts(prompts)
            setPromptAddonId(command.addon)
        } else {
            await reloadAndActivate()
        }
    }

    async function handleResolvePrompts(command) {
        const { addonId, decisions } = command
        for (const [noteLocalId, useNew] of Object.entries(decisions)) {
            await libTAMjs.resolvePrompt(addonId, noteLocalId, useNew)
        }
        await libTAMjs.clearPendingPrompts(addonId)
        await advancePromptQueue(promptQueue)
    }

    async function handleUpdateAll() {
        const targets = Object.values(addons)
            // Libraries are hidden and update themselves as a side effect of updating
            // whatever depends on them — updating them here too would be redundant.
            .filter(a => a.type !== "library" && a.installedVersion && a.updateAvailable)
            .map(a => a.id)

        const queue = []
        for (let i = 0; i < targets.length; i++) {
            const addonId = targets[i]
            setProgressDetail(`${addonId} (${i + 1}/${targets.length})`)
            await libTAMjs.syncAddon(addonId)
            const prompts = await libTAMjs.getPendingPrompts(addonId)
            if (prompts.length > 0) queue.push(addonId)
        }
        setProgressDetail(null)
        await advancePromptQueue(queue)
    }

    async function handleEnableAddon(command) {
        await libTAMjs.enableAddon(command.addon, command.enabled)
        await reloadAndActivate()
    }

    async function handleCheckUpdates() {
        await libTAMjs.checkForAddonUpdates()
        await reload()
    }

    async function handleValidateDatabase() {
        setValidationTitle("Database Validation")
        setValidationIssues(await libTAMjs.validateDatabase())
    }

    async function handleCleanupPersistence() {
        await libTAMjs.cleanupEmptyPersistenceRoots()
        await reload()
    }

    async function handleSweepOrphans() {
        const removedTamFileIds = await libTAMjs.sweepOrphanedNotes()
        setValidationTitle("Orphaned Notes")
        setValidationIssues(removedTamFileIds.map(tamFileId => ({
            addonId: tamFileId.split("/")[0],
            message: `removed orphaned note '${tamFileId}'`
        })))
        await reload()
    }

    async function handleReinitializeDatabase() {
        await libTAMjs.reinitializeDatabase()
        await reloadAndActivate()
    }

    // Dispatched by command name — every handler either returns normally (falls through to
    // setCommand(null) below) or throws, caught by the same try/catch every command shares.
    const handlers = {
        "load-addons": handleLoadAddons,
        "add-catalog": handleAddCatalog,
        "delete-catalog": handleDeleteCatalog,
        "browse-catalog": handleBrowseCatalog,
        "visit-catalog-website": handleVisitCatalogWebsite,
        "install-addon": handleInstallAddon,
        "install-by-url": handleInstallByUrl,
        "request-uninstall": handleRequestUninstall,
        "delete-addon": handleDeleteAddon,
        "update-addon": handleUpdateAddon,
        "resolve-prompts": handleResolvePrompts,
        "update-all": handleUpdateAll,
        "enable-addon": handleEnableAddon,
        "check-updates": handleCheckUpdates,
        "validate-database": handleValidateDatabase,
        "cleanup-persistence": handleCleanupPersistence,
        "sweep-orphans": handleSweepOrphans,
        "reinitialize-database": handleReinitializeDatabase
    }

    useEffect(() => {
        if (!command) return
        async function commandHandler() {
            try {
                await handlers[command.command]?.(command)
            } catch (e) {
                console.error("TAM: command failed", command, e)
                api.showError(`TAM: ${e.message || e}`)
            }
            setProgressDetail(null)
            setCommand(null)
        }
        commandHandler()
    }, [command])

    return {
        addons, catalogs, catalogBrowse, catalogAddons,
        pendingPrompts, promptAddonId, promptQueue,
        pendingCommand: command, progressDetail,
        dispatch: setCommand
    }
}

module.exports = { useTamCommands }
