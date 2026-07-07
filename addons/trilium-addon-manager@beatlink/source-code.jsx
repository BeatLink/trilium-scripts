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
    return <span className="badge" style={{ backgroundColor: typeColor(type) }}>{type}</span>
}

function TamButton({ icon, text, onClick, className = "" }) {
    return (
        <button className={`btn ${className}`.trim()} onClick={onClick}>
            {icon && <i className={icon}></i>}
            <span>{text}</span>
        </button>
    )
}

function BackLink({ onClick, text = "All Addons" }) {
    return <a className="back" onClick={onClick}>← {text}</a>
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


// Shared by ListView and CatalogBrowseView — both need the same
// search-box + type-filter-pills toolbar over a grid of addons.
function SearchFilterToolbar({ search, onSearchChange, typeFilter, onTypeFilterChange, availableTypes }) {
    return (
        <div className="toolbar">
            <div className="search-wrap">
                <input
                    type="search"
                    id="search"
                    placeholder="Search addons…"
                    autoComplete="off"
                    spellCheck="false"
                    value={search}
                    onChange={e => onSearchChange(e.target.value)}
                />
            </div>
            {availableTypes.length > 0 && (
                <div className="filters">
                    <button
                        className={`filter${typeFilter === null ? " active" : ""}`}
                        style={{ "--c": "#2563eb" }}
                        onClick={() => onTypeFilterChange(null)}
                    >
                        All
                    </button>
                    {availableTypes.map(type => (
                        <button
                            key={type}
                            className={`filter${typeFilter === type ? " active" : ""}`}
                            style={{ "--c": typeColor(type) }}
                            onClick={() => onTypeFilterChange(type)}
                        >
                            {titleCase(type)}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}


// List View -------------------------------------------------------------------
function AddonCard({ addonData, onOpen, onInstall, onEnable, onSettings }) {
    return (
        <div className="card" onClick={() => onOpen(addonData.id)}>
            <div className="card-top">
                <span className="card-name">{addonData.name}</span>
                <div className="TAM-card-badges">
                    <Badge type={addonData.type} />
                    {addonData.installedVersion && addonData.updateAvailable && (
                        <span className="TAM-pill TAM-pill-update">Update</span>
                    )}
                    {addonData.installedVersion && !addonData.updateAvailable && (
                        <span className="TAM-pill TAM-pill-installed">Installed</span>
                    )}
                </div>
            </div>
            <p className="card-desc">{addonData.description}</p>
            <div className="card-foot">
                <span>v{addonData.installedVersion ?? addonData.latestVersion}</span>
                <span
                    className="card-author"
                    onClick={e => {
                        e.stopPropagation()
                        window.open(`https://github.com/${addonData.author}`, "_blank")
                    }}
                >
                    {addonData.author}
                </span>
            </div>
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
            {addonData.installedVersion && (onEnable || (onSettings && addonData.settingsNoteId)) && (
                <div className="TAM-card-quick-actions">
                    {onEnable && (
                        <TamButton
                            className="btn-ghost"
                            icon={addonData.enabled ? "bx bx-x-circle" : "bx bx-check-circle"}
                            text={addonData.enabled ? "Disable" : "Enable"}
                            onClick={e => {
                                e.stopPropagation()
                                onEnable(addonData.id, !addonData.enabled)
                            }}
                        />
                    )}
                    {onSettings && addonData.settingsNoteId && (
                        <TamButton
                            className="btn-ghost"
                            icon="bx bx-cog"
                            text="Settings"
                            onClick={e => {
                                e.stopPropagation()
                                onSettings(addonData.settingsNoteId)
                            }}
                        />
                    )}
                </div>
            )}
        </div>
    )
}

function ListView({ addons, catalogAddons, onOpenAddon, onOpenSettings, onInstall, onEnable, onSettings }) {
    const [search, setSearch] = useState("")
    const [typeFilter, setTypeFilter] = useState(null)

    // Libraries are an implementation detail of whatever addon depends on
    // them — TAM installs/updates/uninstalls them automatically via the
    // dependency graph, so there's nothing for the user to do with one
    // directly. Catalog entries already installed are represented by their
    // real installed record instead — dedup by id.
    const installedIds = new Set(Object.keys(addons))
    const catalogOnly = Object.values(catalogAddons).filter(a => a.type !== "library" && !installedIds.has(a.id))
    const allAddons = [
        ...Object.values(addons).filter(a => a.type !== "library"),
        ...catalogOnly
    ]
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
            <SearchFilterToolbar
                search={search}
                onSearchChange={setSearch}
                typeFilter={typeFilter}
                onTypeFilterChange={setTypeFilter}
                availableTypes={availableTypes}
            />

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
                <div className="grid">
                    {visible.map(addonData => (
                        <AddonCard
                            key={addonData.id}
                            addonData={addonData}
                            onOpen={onOpenAddon}
                            onInstall={!addonData.installedVersion ? onInstall : undefined}
                            onEnable={addonData.installedVersion ? onEnable : undefined}
                            onSettings={addonData.installedVersion ? onSettings : undefined}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}


// Catalog Browse View -----------------------------------------------------------
function CatalogBrowseView({ catalogUrl, webUrl, entries, loading, installedIds, onOpenAddon, onInstall }) {
    const [search, setSearch] = useState("")
    const [typeFilter, setTypeFilter] = useState(null)

    const availableTypes = [...new Set(entries.map(a => a.type))].filter(Boolean).sort()
    const searchLower = search.trim().toLowerCase()
    const visible = entries.filter(addonData => {
        if (typeFilter && addonData.type !== typeFilter) return false
        if (!searchLower) return true
        return [addonData.name, addonData.description, addonData.author]
            .some(field => (field || "").toLowerCase().includes(searchLower))
    })

    return (
        <div>
            <h2>Browsing: {catalogUrl}</h2>
            {webUrl && <p><a href={webUrl} target="_blank">Visit Website ↗</a></p>}
            {!loading && entries.length > 0 && (
                <SearchFilterToolbar
                    search={search}
                    onSearchChange={setSearch}
                    typeFilter={typeFilter}
                    onTypeFilterChange={setTypeFilter}
                    availableTypes={availableTypes}
                />
            )}
            {loading ? (
                <Spinner />
            ) : entries.length === 0 ? (
                <div className="TAM-empty-state">
                    <p>No addons found at this catalog (or it couldn't be fetched).</p>
                </div>
            ) : visible.length === 0 ? (
                <div className="TAM-empty-state">
                    <p>No addons match your search.</p>
                </div>
            ) : (
                <div className="grid">
                    {visible.map(addonData => (
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
function AddonDetail({ addonData, isSelf, onInstall, onDelete, onUpdate, onEnable }) {
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
        <div className="addon-layout">
            <aside className="addon-sidebar">
                <table className="meta-table">
                    <tbody>
                        <tr><th>Author</th><td>{addonData.author}</td></tr>
                        <tr><th>Version</th><td>{addonData.installedVersion ?? addonData.latestVersion}</td></tr>
                        <tr><th>License</th><td>{addonData.license}</td></tr>
                    </tbody>
                </table>
                <div className="addon-actions">
                    <TamButton className="btn-ghost" icon="bx bx-globe" text="Home Page" onClick={() => window.open(addonData.homepage, "_blank")} />
                    {!addonData.installedVersion && (
                        <TamButton icon="bx bx-download" text="Install Addon" onClick={() => onInstall(addonData)} />
                    )}
                    {addonData.installedVersion && !isSelf && (
                        <TamButton className="btn-ghost" icon="bx bx-trash" text="Delete Addon" onClick={() => onDelete(addonData.id)} />
                    )}
                    {addonData.installedVersion && (
                        <TamButton
                            className="btn-ghost"
                            icon={addonData.enabled ? "bx bx-x-circle" : "bx bx-check-circle"}
                            text={addonData.enabled ? "Disable Addon" : "Enable Addon"}
                            onClick={() => onEnable(addonData.id, !addonData.enabled)}
                        />
                    )}
                    {addonData.installedVersion && addonData.settingsNoteId && (
                        <TamButton className="btn-ghost" icon="bx bx-cog" text="Addon Settings" onClick={() => activateNote(addonData.settingsNoteId)} />
                    )}
                    {addonData.updateAvailable && (
                        <TamButton icon="bx bx-sync" text={`Update (${addonData.latestVersion})`} onClick={() => onUpdate(addonData.id)} />
                    )}
                </div>
            </aside>
            <div className="addon-content">
                <p className="TAM-addon-description">{addonData.description}</p>
                {addonData.installedVersion ? (
                    readmeLoading ? (
                        <Spinner />
                    ) : readmeHtml ? (
                        <div className="readme" dangerouslySetInnerHTML={{ __html: readmeHtml }} />
                    ) : (
                        <p className="no-readme">No README available for this addon.</p>
                    )
                ) : (
                    <p className="no-readme">
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
    addons, catalogs, onAddCatalog, onDeleteCatalog, onVisitCatalogWebsite, onBrowseCatalog, onInstallByUrl, onCheckUpdates, onUpdateAll,
    onValidate, onCleanup, anyUpdateAvailable
}) {
    const stats = computeStats(addons, catalogs)
    return (
        <div className="TAM-settings">
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
                                <TamButton className="btn-ghost" icon="bx bx-list-ul" text="Browse" onClick={() => onBrowseCatalog(url)} />
                                <TamButton className="btn-ghost" icon="bx bx-globe" text="Visit Website" onClick={() => onVisitCatalogWebsite(url)} />
                                <TamButton className="btn-ghost" icon="bx bx-trash" text="Delete" onClick={() => onDeleteCatalog(url)} />
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
                    <TamButton className="btn-ghost" icon="bx bx-sync" text="Check for Updates" onClick={onCheckUpdates} />
                    {anyUpdateAvailable && <TamButton icon="bx bx-sync" text="Update All Addons" onClick={onUpdateAll} />}
                    <TamButton className="btn-ghost" icon="bx bx-shield-quarter" text="Validate Database" onClick={onValidate} />
                    <TamButton className="btn-ghost" icon="bx bx-broom" text="Clean Up Empty Persistence Roots" onClick={onCleanup} />
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


function ExternalReferenceWarning({ addonId, references, onProceed, onCancel }) {
    return (
        <div className="TAM-prompt-review">
            <h3>External References Found</h3>
            <p>
                The following note(s) outside of <strong>{addonId}</strong> reference note(s) that will
                be deleted. Uninstalling anyway will leave those relations pointing at a note that no
                longer exists.
            </p>
            <ul className="TAM-external-ref-list">
                {references.map((ref, i) => (
                    <li key={i}>
                        <strong>{ref.sourceTitle}</strong> —{" "}
                        <code>~{ref.relationName}</code> →{" "}
                        <strong>{ref.targetTitle}</strong>
                    </li>
                ))}
            </ul>
            <div className="TAM-validation-buttons">
                <TamButton className="btn-ghost" icon="bx bx-x" text="Cancel" onClick={onCancel} />
                <TamButton icon="bx bx-trash" text="Uninstall Anyway" onClick={onProceed} />
            </div>
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
    const [catalogAddons, setCatalogAddons] = useState({}) // merged { [addonId]: entry } across every added catalog
    const [pendingPrompts, setPendingPrompts] = useState([])
    const [promptAddonId, setPromptAddonId] = useState(null)
    const [promptQueue, setPromptQueue] = useState([])
    const [validationIssues, setValidationIssues] = useState(null)
    const [validationTitle, setValidationTitle] = useState("Database Validation")
    const [view, setView] = useState({ type: "list" })
    const [externalRefWarning, setExternalRefWarning] = useState(null) // { addonId, references }

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

    // Main Command Handler
    useEffect(() => {
        if (!command) return;
        async function commandHandler(){
            const displayNote = await currentNote.getRelationValue("displayNote")
            switch (command["command"]) {
                case "load-addons": {
                    const freshAddons = await reload()
                    await loadCatalogAddons(await libTAMjs.getCatalogs())
                    // TAM's own Database record starts out seeded with just a
                    // manifestSourceUrl (see database.json) — not a full
                    // record, since there's nowhere to derive one from before
                    // an actual sync resolves the real note tree. If that
                    // first sync has never completed yet, run it now, the
                    // exact same way any other addon's first sync would run
                    // — this is what actually gets TAM into its own
                    // installedAddons (fixing "Check for Updates"/"Update"
                    // never seeing it, since both work by iterating that
                    // list) rather than a synthetic display-only stand-in.
                    if (!freshAddons[TAM_ID]?.installedVersion) {
                        setCommand({ command: "update-addon", addon: TAM_ID })
                    } else {
                        setCommand(null)
                    }
                    break
                }
                case "add-catalog": {
                    await libTAMjs.addCatalog(command["url"])
                    await reload()
                    await loadCatalogAddons(await libTAMjs.getCatalogs())
                    setCommand(null)
                    break
                }
                case "delete-catalog": {
                    await libTAMjs.deleteCatalog(command["url"])
                    await reload()
                    await loadCatalogAddons(await libTAMjs.getCatalogs())
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
                case "request-uninstall": {
                    const addonId = command["addon"]
                    const references = await libTAMjs.findExternalReferences(addonId)
                    if (references.length > 0) {
                        setExternalRefWarning({ addonId, references })
                        setCommand(null)
                    } else {
                        setCommand({ command: "delete-addon", addon: addonId })
                    }
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
                            setCommand({ command: "delete-addon", addon: addonId })
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
                        prompts={pendingPrompts}
                        onResolve={(decisions) => setCommand({
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
    const handleInstall = entryData => setCommand({
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
                onAddCatalog={url => setCommand({ command: "add-catalog", url })}
                onDeleteCatalog={url => setCommand({ command: "delete-catalog", url })}
                onVisitCatalogWebsite={url => setCommand({ command: "visit-catalog-website", url })}
                onBrowseCatalog={url => {
                    setCatalogBrowse({ url, entries: [], loading: true })
                    setView({ type: "catalog", url })
                    setCommand({ command: "browse-catalog", url })
                }}
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
                    onDelete={addonId => setCommand({ command: "request-uninstall", addon: addonId })}
                    onUpdate={addonId => setCommand({ command: "update-addon", addon: addonId })}
                    onEnable={(addonId, enabled) => setCommand({ command: "enable-addon", addon: addonId, enabled })}
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
                onEnable={(addonId, enabled) => setCommand({ command: "enable-addon", addon: addonId, enabled })}
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
                        <a onClick={() => setCommand({ command: "check-updates" })}>Check for Updates</a>
                        {anyUpdateAvailable && (
                            <a onClick={() => setCommand({ command: "update-all" })}>Apply All Updates</a>
                        )}
                        <a onClick={() => setView({ type: "settings" })}>Settings</a>
                    </div>
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

    return (
        <div className="TAM-body">
            <header>{headerContent}</header>
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
                                <p className="no-readme">There's no offline repair anymore — reinstall/update the affected addon(s) below to fix these.</p>
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
