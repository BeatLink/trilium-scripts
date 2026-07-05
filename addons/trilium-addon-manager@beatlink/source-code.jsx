// Imports --------------------------------------------------------------------
// Deliberately not using trilium:preact's Button/FormTextBox/LinkButton/
// RawHtml/LoadingSpinner — their rendered markup/classes are Trilium's own
// and not fully under our control, which fought every CSS fix in this file.
// Plain native elements give TAM's own CSS full, predictable control.
import {
    useActiveNoteContext,
    useState,
    useEffect
} from "trilium:preact"

import {
    activateNote,
    currentNote
} from "trilium:api"


// Same palette as scripts/generate_pages.py's TYPE_COLORS, so TAM's own UI
// matches the GitHub Pages catalog's badge colors exactly.
const TYPE_COLORS = {
    widget: "#2563eb",
    theme: "#7c3aed",
    css: "#059669",
    script: "#d97706",
    library: "#0891b2",
    template: "#be185d"
}

const TAM_ID = "trilium-addon-manager@beatlink"

function typeColor(type) {
    return TYPE_COLORS[type] || "#6b7280"
}

function titleCase(s) {
    return s.charAt(0).toUpperCase() + s.slice(1)
}

function Badge({ type }) {
    return <span className="TAM-badge" style={{ backgroundColor: typeColor(type) }}>{type}</span>
}

function TamButton({ icon, text, onClick, className = "" }) {
    return (
        <button className={`btn ${className}`.trim()} onClick={onClick}>
            {icon && <i className={icon}></i>}
            <span>{text}</span>
        </button>
    )
}

function BackLink({ onClick, text = "Back to Addons" }) {
    return <a className="TAM-back" onClick={onClick}>← {text}</a>
}

function Spinner() {
    return <div className="TAM-spinner" />
}

function computeStats(addons, catalogs) {
    let installedCount = 0, persistedCount = 0, updateCount = 0
    for (const addonData of Object.values(addons)) {
        if (!addonData.installedVersion) continue
        installedCount++
        if (addonData.updateAvailable) updateCount++
        const persistence = addonData.persistence
        const hasPersisted = persistence && (
            persistence.rootNote ||
            (persistence.persistenceNotes && Object.keys(persistence.persistenceNotes).length > 0)
        )
        if (hasPersisted) persistedCount++
    }
    return { catalogCount: catalogs.length, installedCount, persistedCount, updateCount }
}


// List View -------------------------------------------------------------------
function AddonCard({ addonData, onOpen, onInstall }) {
    return (
        <div className="TAM-card" onClick={() => onOpen(addonData.id)}>
            <div className="TAM-card-top">
                <Badge type={addonData.type} />
                {addonData.installedVersion && addonData.updateAvailable && (
                    <span className="TAM-pill TAM-pill-update">Update available</span>
                )}
                {addonData.installedVersion && !addonData.updateAvailable && (
                    <span className="TAM-pill TAM-pill-installed">Installed</span>
                )}
            </div>
            <h3 className="TAM-card-title">{addonData.name}</h3>
            <p className="TAM-card-meta">by {addonData.author} · v{addonData.installedVersion ?? addonData.latestVersion}</p>
            <p className="TAM-card-desc">{addonData.description}</p>
            {!addonData.installedVersion && onInstall && (
                <div className="TAM-card-install">
                    <TamButton
                        icon="bx bx-download"
                        text="Install"
                        onClick={e => {
                            e.stopPropagation()
                            onInstall(addonData)
                        }}
                    />
                </div>
            )}
        </div>
    )
}

function ListView({ addons, catalogs, onOpenAddon, onOpenSettings, onBrowseCatalog }) {
    const [search, setSearch] = useState("")
    const [typeFilter, setTypeFilter] = useState(null)

    // Libraries are an implementation detail of whatever addon depends on
    // them — TAM installs/updates/uninstalls them automatically via the
    // dependency graph, so there's nothing for the user to do with one
    // directly.
    const allAddons = Object.values(addons).filter(a => a.type !== "library")
    allAddons.sort((a, b) => (a.name || "").localeCompare(b.name || ""))

    const availableTypes = [...new Set(allAddons.map(a => a.type))].sort()

    const searchLower = search.trim().toLowerCase()
    const visible = allAddons.filter(addonData => {
        if (typeFilter && addonData.type !== typeFilter) return false
        if (!searchLower) return true
        return [addonData.name, addonData.description, addonData.author]
            .some(field => (field || "").toLowerCase().includes(searchLower))
    })

    return (
        <div>
            {catalogs.length > 0 && (
                <div className="TAM-toolbar">
                    <div className="TAM-filters">
                        {catalogs.map(url => (
                            <button key={url} className="TAM-filter-pill" onClick={() => onBrowseCatalog(url)}>
                                Browse: {url.replace(/^https?:\/\//, "")}
                            </button>
                        ))}
                    </div>
                </div>
            )}
            <div className="TAM-toolbar">
                <input
                    type="text"
                    className="TAM-search"
                    placeholder="Search addons..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                {availableTypes.length > 0 && (
                    <div className="TAM-filters">
                        <button
                            className={`TAM-filter-pill${typeFilter === null ? " TAM-filter-active" : ""}`}
                            onClick={() => setTypeFilter(null)}
                        >
                            All
                        </button>
                        {availableTypes.map(type => (
                            <button
                                key={type}
                                className={`TAM-filter-pill${typeFilter === type ? " TAM-filter-active" : ""}`}
                                style={{ "--c": typeColor(type) }}
                                onClick={() => setTypeFilter(type)}
                            >
                                {titleCase(type)}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {allAddons.length === 0 ? (
                <div className="TAM-empty-state">
                    <p>No addons installed yet.</p>
                    <TamButton icon="bx bx-cog" text="Go to Settings to add a catalog" onClick={onOpenSettings} />
                </div>
            ) : visible.length === 0 ? (
                <div className="TAM-empty-state">
                    <p>No addons match your search.</p>
                </div>
            ) : (
                <div className="TAM-grid">
                    {visible.map(addonData => (
                        <AddonCard key={addonData.id} addonData={addonData} onOpen={onOpenAddon} />
                    ))}
                </div>
            )}
        </div>
    )
}


// Catalog Browse View -----------------------------------------------------------
function CatalogBrowseView({ catalogUrl, webUrl, entries, loading, installedIds, onBack, onOpenAddon, onInstall }) {
    return (
        <div>
            <BackLink onClick={onBack} text="Back to Addons" />
            <h2>Browsing: {catalogUrl}</h2>
            {webUrl && <p><a href={webUrl} target="_blank">Visit Website ↗</a></p>}
            {loading ? (
                <Spinner />
            ) : entries.length === 0 ? (
                <div className="TAM-empty-state">
                    <p>No addons found at this catalog (or it couldn't be fetched).</p>
                </div>
            ) : (
                <div className="TAM-grid">
                    {entries.map(addonData => (
                        installedIds.has(addonData.id) ? (
                            <AddonCard key={addonData.id} addonData={{ ...addonData, installedVersion: "installed" }} onOpen={() => onOpenAddon(addonData.id)} />
                        ) : (
                            <AddonCard key={addonData.id} addonData={addonData} onOpen={() => {}} onInstall={onInstall} />
                        )
                    ))}
                </div>
            )}
        </div>
    )
}


// Addon Detail View -------------------------------------------------------------
function AddonDetail({ addonData, isSelf, onBack, onInstall, onDelete, onUpdate, onEnable }) {
    const [readmeHtml, setReadmeHtml] = useState(null)
    const [readmeLoading, setReadmeLoading] = useState(false)

    useEffect(() => {
        setReadmeHtml(null)
        const readmeLocalId = addonData.manifest?.readmeNote
        if (!addonData.installedVersion || !readmeLocalId) return
        setReadmeLoading(true)
        libTAMjs.fetchReadmeHtml(addonData.id, readmeLocalId).then(html => {
            setReadmeHtml(html)
            setReadmeLoading(false)
        }).catch(e => {
            console.error("TAM: failed to render README", e)
            setReadmeLoading(false)
        })
    }, [addonData.id, addonData.installedVersion, addonData.manifest?.readmeNote])

    return (
        <div className="TAM-addon-layout">
            <div className="TAM-addon-sidebar">
                <BackLink onClick={onBack} />
                <Badge type={addonData.type} />
                <h2>{addonData.name}</h2>
                <table className="TAM-meta-table">
                    <tbody>
                        <tr><td>Author</td><td>{addonData.author}</td></tr>
                        <tr><td>Version</td><td>{addonData.installedVersion ?? addonData.latestVersion}</td></tr>
                        <tr><td>License</td><td>{addonData.license}</td></tr>
                    </tbody>
                </table>
                <div className="TAM-addon-actions">
                    <TamButton icon="bx bx-globe" text="Home Page" onClick={() => window.open(addonData.homepage, "_blank")} />
                    {!addonData.installedVersion && (
                        <TamButton icon="bx bx-download" text="Install Addon" onClick={() => onInstall(addonData)} />
                    )}
                    {addonData.installedVersion && !isSelf && (
                        <TamButton icon="bx bx-trash" text="Delete Addon" onClick={() => onDelete(addonData.id)} />
                    )}
                    {addonData.installedVersion && (
                        <TamButton
                            icon={addonData.enabled ? "bx bx-x-circle" : "bx bx-check-circle"}
                            text={addonData.enabled ? "Disable Addon" : "Enable Addon"}
                            onClick={() => onEnable(addonData.id, !addonData.enabled)}
                        />
                    )}
                    {addonData.installedVersion && addonData.settingsNoteId && (
                        <TamButton icon="bx bx-cog" text="Addon Settings" onClick={() => activateNote(addonData.settingsNoteId)} />
                    )}
                    {addonData.updateAvailable && (
                        <TamButton icon="bx bx-sync" text={`Update (${addonData.latestVersion})`} onClick={() => onUpdate(addonData.id)} />
                    )}
                </div>
            </div>
            <div className="TAM-addon-main">
                <p className="TAM-addon-description">{addonData.description}</p>
                {addonData.installedVersion ? (
                    readmeLoading ? (
                        <Spinner />
                    ) : readmeHtml ? (
                        <div className="TAM-readme" dangerouslySetInnerHTML={{ __html: readmeHtml }} />
                    ) : (
                        <p className="TAM-muted">No README available for this addon.</p>
                    )
                ) : (
                    <p className="TAM-muted">
                        Install this addon to view its full README, or{" "}
                        <a href={addonData.homepage} target="_blank">view it on GitHub</a>.
                    </p>
                )}
            </div>
        </div>
    )
}


// Settings View -----------------------------------------------------------------
function NewCatalog({ onSave }) {
    const [url, setUrl] = useState("")
    return (
        <div className="TAM-new-repository-div">
            <input
                type="text"
                placeholder="https://.../catalog.json"
                value={url}
                onChange={e => setUrl(e.target.value)}
                className="TAM-new-repository-text"
            />
            <TamButton icon="bx bx-plus" text="Add Catalog" onClick={() => onSave(url)} />
        </div>
    )
}

function NewAddonByUrl({ onSave }) {
    const [url, setUrl] = useState("")
    return (
        <div className="TAM-new-repository-div">
            <input
                type="text"
                placeholder="https://.../_tam_manifest_.json"
                value={url}
                onChange={e => setUrl(e.target.value)}
                className="TAM-new-repository-text"
            />
            <TamButton icon="bx bx-plus" text="Install by URL" onClick={() => onSave(url)} />
        </div>
    )
}

function SettingsView({
    addons, catalogs, onBack, onAddCatalog, onDeleteCatalog, onVisitCatalogWebsite, onInstallByUrl, onCheckUpdates, onUpdateAll,
    onValidate, onCleanup, anyUpdateAvailable
}) {
    const stats = computeStats(addons, catalogs)
    return (
        <div className="TAM-settings">
            <BackLink onClick={onBack} />

            <div>
                <h3>Statistics</h3>
                <div className="TAM-stats-grid">
                    <div className="TAM-stat-card">
                        <span className="TAM-stat-value">{stats.catalogCount}</span>
                        <span className="TAM-stat-label">Catalogs</span>
                    </div>
                    <div className="TAM-stat-card">
                        <span className="TAM-stat-value">{stats.installedCount}</span>
                        <span className="TAM-stat-label">Installed Addons</span>
                    </div>
                    <div className="TAM-stat-card">
                        <span className="TAM-stat-value">{stats.persistedCount}</span>
                        <span className="TAM-stat-label">With Saved Data</span>
                    </div>
                    <div className="TAM-stat-card">
                        <span className="TAM-stat-value">{stats.updateCount}</span>
                        <span className="TAM-stat-label">Updates Available</span>
                    </div>
                </div>
            </div>

            <div>
                <h3>Catalogs</h3>
                <div className="TAM-repo-list">
                    {catalogs.map(url => (
                        <div key={url} className="TAM-repo-row">
                            <span>{url}</span>
                            <div className="TAM-validation-buttons">
                                <TamButton icon="bx bx-globe" text="Visit Website" onClick={() => onVisitCatalogWebsite(url)} />
                                <TamButton icon="bx bx-trash" text="Delete" onClick={() => onDeleteCatalog(url)} />
                            </div>
                        </div>
                    ))}
                    <NewCatalog onSave={onAddCatalog} />
                </div>
                <h3>Install a single addon by URL</h3>
                <div className="TAM-repo-list">
                    <NewAddonByUrl onSave={onInstallByUrl} />
                </div>
            </div>

            <div>
                <h3>Maintenance</h3>
                <div className="TAM-maintenance-actions">
                    <TamButton icon="bx bx-sync" text="Check for Updates" onClick={onCheckUpdates} />
                    {anyUpdateAvailable && <TamButton icon="bx bx-sync" text="Update All Addons" onClick={onUpdateAll} />}
                    <TamButton icon="bx bx-shield-quarter" text="Validate Database" onClick={onValidate} />
                    <TamButton icon="bx bx-broom" text="Clean Up Empty Persistence Roots" onClick={onCleanup} />
                </div>
            </div>
        </div>
    )
}


// Prompt Review -----------------------------------------------------------------
function PromptReview({ prompts, onResolve }) {
    const [decisions, setDecisions] = useState(
        Object.fromEntries(prompts.map(p => [p.noteLocalId, false]))
    )

    return (
        <div className="TAM-prompt-review">
            <h3>Update Review</h3>
            <p>The following files were updated. Choose which version to keep for each:</p>
            {prompts.map(prompt => (
                <div key={prompt.noteLocalId} className="TAM-prompt-item">
                    <h4>{prompt.title}</h4>
                    <div className="TAM-prompt-options">
                        <div
                            className={`TAM-prompt-option${!decisions[prompt.noteLocalId] ? " TAM-prompt-selected" : ""}`}
                            onClick={() => setDecisions({ ...decisions, [prompt.noteLocalId]: false })}
                        >
                            <label>Keep Mine</label>
                            <pre className="TAM-prompt-content">{prompt.currentContent}</pre>
                        </div>
                        <div
                            className={`TAM-prompt-option${decisions[prompt.noteLocalId] ? " TAM-prompt-selected" : ""}`}
                            onClick={() => setDecisions({ ...decisions, [prompt.noteLocalId]: true })}
                        >
                            <label>Use New Default</label>
                            <pre className="TAM-prompt-content">{prompt.newContent}</pre>
                        </div>
                    </div>
                </div>
            ))}
            <TamButton icon="bx bx-check" text="Apply" onClick={() => onResolve(decisions)} />
        </div>
    )
}


// Widget ---------------------------------------------------------------------
export default function RepoManager() {
    const { note } = useActiveNoteContext()
    const [command, setCommand] = useState(null)
    const [addons, setAddons] = useState(null)
    const [catalogs, setCatalogs] = useState([])
    const [catalogBrowse, setCatalogBrowse] = useState(null) // { url, webUrl, entries, loading }
    const [pendingPrompts, setPendingPrompts] = useState([])
    const [promptAddonId, setPromptAddonId] = useState(null)
    const [promptQueue, setPromptQueue] = useState([])
    const [validationIssues, setValidationIssues] = useState(null)
    const [validationTitle, setValidationTitle] = useState("Database Validation")
    const [view, setView] = useState({ type: "list" })

    async function reload() {
        setAddons(await libTAMjs.getAllAddons())
        setCatalogs(await libTAMjs.getCatalogs())
    }

    // Main Command Handler
    useEffect(() => {
        if (!command) return;
        async function commandHandler(){
            const displayNote = await currentNote.getRelationValue("displayNote")
            switch (command["command"]) {
                case "load-addons": {
                    await reload()
                    setCommand(null)
                    break
                }
                case "add-catalog": {
                    await libTAMjs.addCatalog(command["url"])
                    await reload()
                    setCommand(null)
                    break
                }
                case "delete-catalog": {
                    await libTAMjs.deleteCatalog(command["url"])
                    await reload()
                    setCommand(null)
                    break
                }
                case "browse-catalog": {
                    setCatalogBrowse({ url: command["url"], webUrl: null, entries: [], loading: true })
                    const { webUrl, addons: entries } = await libTAMjs.fetchCatalogAddons(command["url"])
                    setCatalogBrowse({ url: command["url"], webUrl, entries, loading: false })
                    setCommand(null)
                    break
                }
                case "visit-catalog-website": {
                    const { webUrl } = await libTAMjs.fetchCatalogMeta(command["url"])
                    if (webUrl) {
                        window.open(webUrl, "_blank")
                    } else {
                        api.showMessage("This catalog doesn't declare a website URL.")
                    }
                    setCommand(null)
                    break
                }
                case "install-addon": {
                    await libTAMjs.syncAddon(command["addon"], {
                        manifestSourceUrl: command["manifestSourceUrl"],
                        catalogContext: command["catalogContext"]
                    })
                    await reload()
                    await activateNote(displayNote)
                    window.location.reload();
                    break
                }
                case "install-by-url": {
                    await libTAMjs.installByUrl(command["url"])
                    await reload()
                    await activateNote(displayNote)
                    window.location.reload();
                    break
                }
                case "delete-addon": {
                    await libTAMjs.uninstallAddon(command["addon"])
                    await reload()
                    setView({ type: "list" })
                    await activateNote(displayNote)
                    window.location.reload();
                    break
                }
                case "update-addon": {
                    await libTAMjs.syncAddon(command["addon"])
                    const prompts = await libTAMjs.getPendingPrompts(command["addon"])
                    if (prompts.length > 0) {
                        setPendingPrompts(prompts)
                        setPromptAddonId(command["addon"])
                        setCommand(null)
                    } else {
                        await reload()
                        await activateNote(displayNote)
                        window.location.reload()
                    }
                    break
                }
                case "resolve-prompts": {
                    const { addonId, decisions } = command
                    for (const [noteLocalId, useNew] of Object.entries(decisions)) {
                        await libTAMjs.resolvePrompt(addonId, noteLocalId, useNew)
                    }
                    await libTAMjs.clearPendingPrompts(addonId)

                    if (promptQueue.length > 0) {
                        const [next, ...rest] = promptQueue
                        const prompts = await libTAMjs.getPendingPrompts(next)
                        setPendingPrompts(prompts)
                        setPromptAddonId(next)
                        setPromptQueue(rest)
                        setCommand(null)
                    } else {
                        setPendingPrompts([])
                        setPromptAddonId(null)
                        await reload()
                        await activateNote(displayNote)
                        window.location.reload()
                    }
                    break
                }
                case "update-all": {
                    const targets = Object.values(addons)
                        // Libraries are hidden and update themselves as a side
                        // effect of updating whatever depends on them (their
                        // updateAvailable flag is already propagated up to
                        // those dependents) — updating them here too would
                        // just be redundant work.
                        .filter(a => a.type !== "library" && a.installedVersion && a.updateAvailable)
                        .map(a => a.id)

                    const queue = []
                    for (const addonId of targets) {
                        await libTAMjs.syncAddon(addonId)
                        const prompts = await libTAMjs.getPendingPrompts(addonId)
                        if (prompts.length > 0) queue.push(addonId)
                    }

                    if (queue.length > 0) {
                        const [next, ...rest] = queue
                        const prompts = await libTAMjs.getPendingPrompts(next)
                        setPendingPrompts(prompts)
                        setPromptAddonId(next)
                        setPromptQueue(rest)
                        setCommand(null)
                    } else {
                        await reload()
                        await activateNote(displayNote)
                        window.location.reload()
                    }
                    break
                }
                case "enable-addon": {
                    await libTAMjs.enableAddon(command["addon"], command["enabled"])
                    await reload()
                    await activateNote(displayNote)
                    window.location.reload();
                    break
                }
                case "check-updates": {
                    await libTAMjs.checkForAddonUpdates()
                    await reload()
                    setCommand(null)
                    break
                }
                case "validate-database": {
                    setValidationTitle("Database Validation")
                    setValidationIssues(await libTAMjs.validateDatabase())
                    setCommand(null)
                    break
                }
                case "cleanup-persistence": {
                    await libTAMjs.cleanupEmptyPersistenceRoots()
                    await reload()
                    setCommand(null)
                    break
                }
            }
        }
        commandHandler()
    }, [command])

    // Trigger Loading of Addons on Page load
    useEffect(() => {
        if (!note) return;
        setCommand({command: "load-addons"})
    }, [note])

    if (!addons) {
        return <div>Loading addons...</div>;
    }

    if (pendingPrompts.length > 0 && promptAddonId) {
        return (
            <div className="TAM-body">
                <div className="TAM-header">
                    <div className="TAM-header-titles">
                        <h2>Trilium Addon Manager</h2>
                    </div>
                </div>
                {promptQueue.length > 0 && (
                    <p>{promptAddonId} — {promptQueue.length} more addon(s) to review after this</p>
                )}
                <PromptReview
                    prompts={pendingPrompts}
                    onResolve={(decisions) => setCommand({
                        command: "resolve-prompts",
                        addonId: promptAddonId,
                        decisions
                    })}
                />
            </div>
        )
    }

    const anyUpdateAvailable = Object.values(addons).some(a => a.type !== "library" && a.installedVersion && a.updateAvailable)

    let bodyContent
    if (view.type === "settings") {
        bodyContent = (
            <SettingsView
                addons={addons}
                catalogs={catalogs}
                anyUpdateAvailable={anyUpdateAvailable}
                onBack={() => setView({ type: "list" })}
                onAddCatalog={url => setCommand({ command: "add-catalog", url })}
                onDeleteCatalog={url => setCommand({ command: "delete-catalog", url })}
                onVisitCatalogWebsite={url => setCommand({ command: "visit-catalog-website", url })}
                onInstallByUrl={url => setCommand({ command: "install-by-url", url })}
                onCheckUpdates={() => setCommand({ command: "check-updates" })}
                onUpdateAll={() => setCommand({ command: "update-all" })}
                onValidate={() => setCommand({ command: "validate-database" })}
                onCleanup={() => setCommand({ command: "cleanup-persistence" })}
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
                onBack={() => setView({ type: "list" })}
                onOpenAddon={addonId => setView({ type: "detail", addonId })}
                onInstall={entryData => {
                    const catalogContext = Object.fromEntries(
                        (catalogBrowse?.entries ?? []).map(e => [e.id, e.manifestSourceUrl])
                    )
                    setCommand({
                        command: "install-addon",
                        addon: entryData.id,
                        manifestSourceUrl: entryData.manifestSourceUrl,
                        catalogContext
                    })
                }}
            />
        )
    } else if (view.type === "detail") {
        const addonData = addons[view.addonId]
        if (!addonData) {
            bodyContent = <p>Addon not found. <BackLink onClick={() => setView({ type: "list" })} /></p>
        } else {
            bodyContent = (
                <AddonDetail
                    addonData={addonData}
                    isSelf={view.addonId === TAM_ID}
                    onBack={() => setView({ type: "list" })}
                    onInstall={entryData => setCommand({
                        command: "install-addon",
                        addon: entryData.id,
                        manifestSourceUrl: entryData.manifestSourceUrl
                    })}
                    onDelete={addonId => setCommand({ command: "delete-addon", addon: addonId })}
                    onUpdate={addonId => setCommand({ command: "update-addon", addon: addonId })}
                    onEnable={(addonId, enabled) => setCommand({ command: "enable-addon", addon: addonId, enabled })}
                />
            )
        }
    } else {
        bodyContent = (
            <ListView
                addons={addons}
                catalogs={catalogs}
                onOpenAddon={addonId => setView({ type: "detail", addonId })}
                onOpenSettings={() => setView({ type: "settings" })}
                onBrowseCatalog={url => {
                    setCatalogBrowse({ url, entries: [], loading: true })
                    setView({ type: "catalog", url })
                    setCommand({ command: "browse-catalog", url })
                }}
            />
        )
    }

    return (
        <div className="TAM-body">
            <div className="TAM-header">
                <div className="TAM-header-titles">
                    <h2>Trilium Addon Manager</h2>
                </div>
                {view.type === "list" && (
                    <div className="TAM-header-actions">
                        <TamButton icon="bx bx-cog" text="Settings" onClick={() => setView({ type: "settings" })} />
                    </div>
                )}
            </div>
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
                            <p className="TAM-muted">There's no offline repair anymore — reinstall/update the affected addon(s) below to fix these.</p>
                            <pre className="TAM-validation-content">
                                {validationIssues.map(issue => `${issue.addonId}: ${issue.message}`).join("\n")}
                            </pre>
                        </>
                    )}
                    <div className="TAM-validation-buttons">
                        {validationIssues.length > 0 && <TamButton
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
                            icon="bx bx-x"
                            text="Dismiss"
                            onClick={e => { setValidationIssues(null) }}
                        />
                    </div>
                </div>
            )}
            {bodyContent}
        </div>
    )
}
