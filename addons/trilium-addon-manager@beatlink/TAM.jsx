// Root widget: owns UI-navigation/dialog state (view, validation results, external-reference
// warning) and the one currentNote-bound read (displayNote) that must live in this exact note
// — see TAMCommands.jsx's useTamCommands for why. Everything else is composed from siblings.

import {
    useActiveNoteContext,
    useState,
    useEffect
} from "trilium:preact"

import {
    activateNote,
    currentNote
} from "trilium:api"

import { Badge, BackLink, TamButton, Spinner, commandLabel, TAM_ID } from "TAMShared.jsx"
import { ListView, CatalogBrowseView } from "TAMListViews.jsx"
import { AddonDetail, SettingsView } from "TAMDetailAndSettings.jsx"
import { PromptReview, ExternalReferenceWarning } from "TAMDialogs.jsx"
import { useTamCommands } from "TAMCommands.jsx"

async function resolveDisplayNote() {
    return await currentNote.getRelationValue("displayNote")
}

export default function RepoManager() {
    const { note } = useActiveNoteContext()
    const [view, setView] = useState({ type: "list" })
    const [validationIssues, setValidationIssues] = useState(null)
    const [validationTitle, setValidationTitle] = useState("Database Validation")
    const [externalRefWarning, setExternalRefWarning] = useState(null) // { addonId, references }

    const {
        addons, catalogs, catalogBrowse, catalogAddons,
        pendingPrompts, promptAddonId, promptQueue,
        pendingCommand, progressDetail, dispatch
    } = useTamCommands(resolveDisplayNote, { setExternalRefWarning, setView, setValidationTitle, setValidationIssues })

    // Trigger loading of addons on page load.
    useEffect(() => {
        if (!note) return
        dispatch({ command: "load-addons" })
    }, [note])

    if (!addons) {
        return <div>Loading addons...</div>
    }

    if (externalRefWarning) {
        return (
            <div className="TAM-body">
                <header>
                    <div className="hdr">
                        <h1>Trilium Addon Manager</h1>
                    </div>
                </header>
                <main>
                    <ExternalReferenceWarning
                        addonId={externalRefWarning.addonId}
                        references={externalRefWarning.references}
                        onProceed={() => {
                            const addonId = externalRefWarning.addonId
                            setExternalRefWarning(null)
                            dispatch({ command: "delete-addon", addon: addonId })
                        }}
                        onCancel={() => setExternalRefWarning(null)}
                    />
                </main>
            </div>
        )
    }

    if (pendingPrompts.length > 0 && promptAddonId) {
        return (
            <div className="TAM-body">
                <header>
                    <div className="hdr">
                        <h1>Trilium Addon Manager</h1>
                    </div>
                </header>
                <main>
                    {promptQueue.length > 0 && (
                        <p>{promptAddonId} — {promptQueue.length} more addon(s) to review after this</p>
                    )}
                    <PromptReview
                        key={promptAddonId}
                        prompts={pendingPrompts}
                        onResolve={(decisions) => dispatch({
                            command: "resolve-prompts",
                            addonId: promptAddonId,
                            decisions
                        })}
                    />
                </main>
            </div>
        )
    }

    const anyUpdateAvailable = Object.values(addons).some(a => a.type !== "library" && a.installedVersion && a.updateAvailable)

    // Dependency resolution during install needs to look up bare-id deps
    // against whatever catalogs are known — built once from the merged
    // catalogAddons map so it covers every added catalog, not just one.
    const catalogContext = Object.fromEntries(Object.values(catalogAddons).map(e => [e.id, e.manifestSourceUrl]))
    const handleInstall = entryData => dispatch({
        command: "install-addon",
        addon: entryData.id,
        manifestSourceUrl: entryData.manifestSourceUrl,
        catalogContext
    })

    let bodyContent
    if (view.type === "settings") {
        bodyContent = (
            <SettingsView
                addons={addons}
                catalogs={catalogs}
                anyUpdateAvailable={anyUpdateAvailable}
                onAddCatalog={url => dispatch({ command: "add-catalog", url })}
                onDeleteCatalog={url => dispatch({ command: "delete-catalog", url })}
                onVisitCatalogWebsite={url => dispatch({ command: "visit-catalog-website", url })}
                onBrowseCatalog={url => {
                    setView({ type: "catalog", url })
                    dispatch({ command: "browse-catalog", url })
                }}
                onInstallByUrl={url => dispatch({ command: "install-by-url", url })}
                onCheckUpdates={() => dispatch({ command: "check-updates" })}
                onUpdateAll={() => dispatch({ command: "update-all" })}
                onValidate={() => dispatch({ command: "validate-database" })}
                onCleanup={() => dispatch({ command: "cleanup-persistence" })}
                onSweepOrphans={() => dispatch({ command: "sweep-orphans" })}
                onReinitialize={() => dispatch({ command: "reinitialize-database" })}
            />
        )
    } else if (view.type === "catalog") {
        const installedIds = new Set(Object.keys(addons))
        bodyContent = (
            <CatalogBrowseView
                catalogUrl={catalogBrowse?.url ?? view.url}
                webUrl={catalogBrowse?.webUrl ?? null}
                entries={catalogBrowse?.entries ?? []}
                loading={catalogBrowse?.loading ?? true}
                installedIds={installedIds}
                onOpenAddon={addonId => setView({ type: "detail", addonId })}
                onInstall={handleInstall}
            />
        )
    } else if (view.type === "detail") {
        const addonData = addons[view.addonId] || catalogAddons[view.addonId]
        if (!addonData) {
            bodyContent = <p>Addon not found.</p>
        } else {
            bodyContent = (
                <AddonDetail
                    addonData={addonData}
                    isSelf={view.addonId === TAM_ID}
                    onInstall={handleInstall}
                    onDelete={addonId => dispatch({ command: "request-uninstall", addon: addonId })}
                    onUpdate={addonId => dispatch({ command: "update-addon", addon: addonId })}
                    onReinstall={addonId => dispatch({ command: "reinstall-addon", addon: addonId })}
                    onEnable={(addonId, enabled) => dispatch({ command: "enable-addon", addon: addonId, enabled })}
                />
            )
        }
    } else {
        bodyContent = (
            <ListView
                addons={addons}
                catalogAddons={catalogAddons}
                onOpenAddon={addonId => setView({ type: "detail", addonId })}
                onOpenSettings={() => setView({ type: "settings" })}
                onInstall={handleInstall}
                onUpdate={addonId => dispatch({ command: "update-addon", addon: addonId })}
                onEnable={(addonId, enabled) => dispatch({ command: "enable-addon", addon: addonId, enabled })}
                onSettings={settingsNoteId => activateNote(settingsNoteId)}
            />
        )
    }

    const installedCount = Object.values(addons).filter(a => a.type !== "library" && a.installedVersion).length

    let headerContent
    if (view.type === "list") {
        headerContent = (
            <div className="hdr">
                <div className="hdr-left">
                    <h1>Trilium Addon Manager</h1>
                    <p>{installedCount} addon{installedCount === 1 ? "" : "s"} installed</p>
                </div>
                <div className="hdr-right">
                    <div className="hdr-links">
                        <a onClick={() => dispatch({ command: "check-updates" })}>Check for Updates</a>
                        <a onClick={() => setView({ type: "settings" })}>Settings</a>
                    </div>
                    {anyUpdateAvailable && (
                        <TamButton icon="bx bx-sync" text="Update All" onClick={() => dispatch({ command: "update-all" })} />
                    )}
                </div>
            </div>
        )
    } else if (view.type === "detail" && (addons[view.addonId] || catalogAddons[view.addonId])) {
        const addonData = addons[view.addonId] || catalogAddons[view.addonId]
        headerContent = (
            <div className="hdr">
                <BackLink onClick={() => setView({ type: "list" })} />
                <div className="hdr-name">
                    <h1>{addonData.name}</h1>
                    <Badge type={addonData.type} />
                </div>
            </div>
        )
    } else {
        headerContent = (
            <div className="hdr">
                <BackLink onClick={() => setView({ type: "list" })} />
                <div className="hdr-name">
                    <h1>Trilium Addon Manager</h1>
                </div>
            </div>
        )
    }

    // browse-catalog already shows its own inline Spinner in CatalogBrowseView —
    // the blocking overlay is for everything else, where nothing on screen
    // otherwise indicates a long-running mutation is in flight.
    const showProgressOverlay = pendingCommand && pendingCommand.command !== "browse-catalog"

    return (
        <div className="TAM-body">
            <header>{headerContent}</header>
            {showProgressOverlay && (
                <div className="TAM-progress-overlay">
                    <Spinner />
                    <p>{progressDetail || commandLabel(pendingCommand)}…</p>
                </div>
            )}
            <main>
                {validationIssues !== null && (
                    <div className="TAM-validation-results">
                        <h4>
                            {validationTitle} —{" "}
                            {validationIssues.length === 0
                                ? "no issues found"
                                : `${validationIssues.length} issue(s) found`}
                        </h4>
                        {validationIssues.length > 0 && (
                            <>
                                <p className="no-readme">
                                    {validationTitle === "Orphaned Notes"
                                        ? "Already removed — nothing further to do."
                                        : "There's no offline repair anymore — reinstall/update the affected addon(s) below to fix these."}
                                </p>
                                <pre className="TAM-validation-content">
                                    {validationIssues.map(issue => `${issue.addonId}: ${issue.message}`).join("\n")}
                                </pre>
                            </>
                        )}
                        <div className="TAM-validation-buttons">
                            {validationIssues.length > 0 && <TamButton
                                className="btn-ghost"
                                icon="bx bx-copy"
                                text="Copy to Clipboard"
                                onClick={e => {
                                    const text = validationIssues
                                        .map(issue => `${issue.addonId}: ${issue.message}`)
                                        .join("\n")
                                    navigator.clipboard.writeText(text)
                                }}
                            />}
                            <TamButton
                                className="btn-ghost"
                                icon="bx bx-x"
                                text="Dismiss"
                                onClick={e => { setValidationIssues(null) }}
                            />
                        </div>
                    </div>
                )}
                {bodyContent}
            </main>
        </div>
    )
}
