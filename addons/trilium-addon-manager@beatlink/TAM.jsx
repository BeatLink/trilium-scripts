// TAM's entire frontend widget in one JSX note. Previously split across
// TAMShared / TAMListViews / TAMDetailAndSettings / TAMDialogs / TAMCommands /
// TAM; merged into one file so TAM has a single JSX render note. Section
// banners below mark what each former file owned. The default export
// (RepoManager) is the render-note entry, exactly as before.
//
// The only require()d note is lib-tam.js (the merged backend/data layer);
// everything else comes from Trilium's own trilium:preact / trilium:api.

import {
    useActiveNoteContext,
    useState,
    useEffect
} from "trilium:preact"

import {
    activateNote,
    currentNote
} from "trilium:api"

const libTAMjs = require("lib-tam.js")

// =========================================================================
// Shared: presentational primitives (Badge, TamButton, BackLink, Spinner), the
// type-color palette, command labels, and the useAddonFilter hook.
// =========================================================================

// Same palette as tamhelper.js's TYPE_COLORS, so TAM's own UI matches the
// GitHub Pages catalog's badge colors exactly.
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

const COMMAND_LABELS = {
    "load-addons": "Loading addons",
    "add-catalog": "Adding catalog",
    "delete-catalog": "Removing catalog",
    "browse-catalog": "Loading catalog",
    "visit-catalog-website": "Opening website",
    "install-addon": "Installing addon",
    "install-by-url": "Installing addon",
    "request-uninstall": "Preparing uninstall",
    "delete-addon": "Uninstalling addon",
    "update-addon": "Updating addon",
    "resolve-prompts": "Applying update",
    "update-all": "Updating all addons",
    "enable-addon": "Updating addon",
    "check-updates": "Checking for updates",
    "validate-database": "Validating database",
    "sweep-orphans": "Sweeping orphaned notes",
    "sweep-invalid-tree": "Sweeping invalid addon tree notes",
    "reinitialize-database": "Reinitializing database"
}

// Turns the dispatched command object into a short human label for the
// progress overlay — falls back to the raw command name for anything not
// in the map (new commands don't need a matching entry to be safe).
function commandLabel(command) {
    if (!command) return ""
    const base = COMMAND_LABELS[command.command] || command.command
    return command.addon ? `${base}: ${command.addon}` : base
}

function computeStats(addons, catalogs) {
    let installedCount = 0, persistedCount = 0, updateCount = 0
    for (const addonData of Object.values(addons)) {
        if (!addonData.installedVersion) continue
        installedCount++
        if (addonData.updateAvailable) updateCount++
        // An addon holds user data if its manifest attaches anything under the reserved
        // "persistence" parent keyword.
        if (addonData.manifest?.children?.some(c => c.parent === "persistence")) persistedCount++
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

// Replaces the identical search/type-filter state + [name, description, author] predicate
// ListView and CatalogBrowseView each used to hand-roll independently.
function useAddonFilter(items) {
    const [search, setSearch] = useState("")
    const [typeFilter, setTypeFilter] = useState(null)

    const availableTypes = [...new Set(items.map(a => a.type))].filter(Boolean).sort()
    const searchLower = search.trim().toLowerCase()
    const visible = items.filter(addonData => {
        if (typeFilter && addonData.type !== typeFilter) return false
        if (!searchLower) return true
        return [addonData.name, addonData.description, addonData.author]
            .some(field => (field || "").toLowerCase().includes(searchLower))
    })

    return { search, setSearch, typeFilter, setTypeFilter, visible, availableTypes }
}

// =========================================================================
// Dialogs: full-screen overlays — the update keep-mine/use-new review, and the
// dangling-references/delete-my-data questions asked before an uninstall.
// =========================================================================

// A hook-produced item's values are arbitrary JSON, not necessarily strings.
function formatPromptValue(value) {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2)
}

// One prompt is either a whole-note content diff (TAM's built-in producer, one
// boolean decision) or a list of items an addon's own updateReview hook produced
// (one boolean per item key). Both render as the same Keep Mine / Use New pair.
function PromptChoice({ selected, onSelect, current, incoming }) {
    return (
        <div className="TAM-prompt-options">
            <div
                className={`TAM-prompt-option${!selected ? " TAM-prompt-selected" : ""}`}
                onClick={() => onSelect(false)}
            >
                <label>Keep Mine</label>
                <pre className="TAM-prompt-content">{current}</pre>
            </div>
            <div
                className={`TAM-prompt-option${selected ? " TAM-prompt-selected" : ""}`}
                onClick={() => onSelect(true)}
            >
                <label>Use New Default</label>
                <pre className="TAM-prompt-content">{incoming}</pre>
            </div>
        </div>
    )
}

function PromptReview({ prompts, onResolve }) {
    const [decisions, setDecisions] = useState(
        Object.fromEntries(prompts.map(p => [
            p.noteLocalId,
            p.items ? Object.fromEntries(p.items.map(item => [item.key, false])) : false
        ]))
    )

    return (
        <div className="TAM-prompt-review">
            <h3>Update Review</h3>
            <p>The following changed upstream. Choose which version to keep for each:</p>
            {prompts.map(prompt => (
                <div key={prompt.noteLocalId} className="TAM-prompt-item">
                    <h4>{prompt.title}</h4>
                    {prompt.items ? prompt.items.map(item => (
                        <div key={item.key} className="TAM-prompt-field">
                            <h5>{item.label ?? item.key}</h5>
                            <PromptChoice
                                selected={decisions[prompt.noteLocalId][item.key]}
                                onSelect={value => setDecisions({
                                    ...decisions,
                                    [prompt.noteLocalId]: {
                                        ...decisions[prompt.noteLocalId],
                                        [item.key]: value
                                    }
                                })}
                                current={formatPromptValue(item.current)}
                                incoming={formatPromptValue(item.incoming)}
                            />
                        </div>
                    )) : (
                        <PromptChoice
                            selected={decisions[prompt.noteLocalId]}
                            onSelect={value => setDecisions({ ...decisions, [prompt.noteLocalId]: value })}
                            current={prompt.currentContent}
                            incoming={prompt.newContent}
                        />
                    )}
                </div>
            ))}
            <TamButton icon="bx bx-check" text="Apply" onClick={() => onResolve(decisions)} />
        </div>
    )
}

// Shown before an uninstall only when there's something to decide: dangling
// references, stored data, or both. With neither, the uninstall runs unprompted
// exactly as it always has.
function UninstallDialog({ addonId, references, hasData, onProceed, onCancel }) {
    const [deleteData, setDeleteData] = useState(false)

    return (
        <div className="TAM-prompt-review">
            <h3>Uninstall {addonId}</h3>
            {references.length > 0 && (
                <>
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
                </>
            )}
            {hasData && (
                <label className="TAM-uninstall-data">
                    <input
                        type="checkbox"
                        checked={deleteData}
                        onChange={e => setDeleteData(e.target.checked)}
                    />
                    Also delete this addon's stored data. Left unchecked, its settings and saved
                    content stay under Addon Data and are picked up again if you reinstall it.
                </label>
            )}
            <div className="TAM-validation-buttons">
                <TamButton className="btn-ghost" icon="bx bx-x" text="Cancel" onClick={onCancel} />
                <TamButton icon="bx bx-trash" text="Uninstall" onClick={() => onProceed(deleteData)} />
            </div>
        </div>
    )
}

// =========================================================================
// ListViews: the addon card and the two grid views — the main installed/
// catalog-only list, and a single catalog's browse results.
// =========================================================================

function AddonCard({ addonData, onOpen, onInstall, onUpdate, onEnable, onSettings }) {
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
            {addonData.installedVersion && (onUpdate && addonData.updateAvailable || onEnable || (onSettings && addonData.settingsNoteId && addonData.enabled)) && (
                <div className="TAM-card-quick-actions">
                    {onUpdate && addonData.updateAvailable && (
                        <TamButton
                            icon="bx bx-sync"
                            text={`Update${addonData.availableVersion ? ` (${addonData.availableVersion})` : ""}`}
                            onClick={e => {
                                e.stopPropagation()
                                onUpdate(addonData.id)
                            }}
                        />
                    )}
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
                    {onSettings && addonData.settingsNoteId && addonData.enabled && (
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

function ListView({ addons, catalogAddons, onOpenAddon, onOpenSettings, onInstall, onUpdate, onEnable, onSettings }) {
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

    const { search, setSearch, typeFilter, setTypeFilter, visible, availableTypes } = useAddonFilter(allAddons)
    const visibleInstalled = visible.filter(a => a.installedVersion)
    const visibleCatalogOnly = visible.filter(a => !a.installedVersion)

    function renderCard(addonData) {
        return (
            <AddonCard
                key={addonData.id}
                addonData={addonData}
                onOpen={onOpenAddon}
                onInstall={!addonData.installedVersion ? onInstall : undefined}
                onUpdate={addonData.installedVersion ? onUpdate : undefined}
                onEnable={addonData.installedVersion && addonData.id !== TAM_ID ? onEnable : undefined}
                onSettings={addonData.installedVersion ? onSettings : undefined}
            />
        )
    }

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
                <>
                    {visibleInstalled.length > 0 && (
                        <div className="TAM-addon-section">
                            <h3>Installed</h3>
                            <div className="grid">
                                {visibleInstalled.map(renderCard)}
                            </div>
                        </div>
                    )}
                    {visibleCatalogOnly.length > 0 && (
                        <div className="TAM-addon-section">
                            <h3>Available in Catalogs</h3>
                            <div className="grid">
                                {visibleCatalogOnly.map(renderCard)}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

function CatalogBrowseView({ catalogUrl, webUrl, entries, loading, installedIds, onOpenAddon, onInstall }) {
    const { search, setSearch, typeFilter, setTypeFilter, visible, availableTypes } = useAddonFilter(entries)

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

// =========================================================================
// DetailAndSettings: the addon detail page and the settings screen (stats,
// catalog list, maintenance actions).
// =========================================================================

function AddonDetail({ addonData, isSelf, onInstall, onDelete, onUpdate, onReinstall, onEnable }) {
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
                    {addonData.installedVersion && addonData.settingsNoteId && addonData.enabled && (
                        <TamButton className="btn-ghost" icon="bx bx-cog" text="Addon Settings" onClick={() => activateNote(addonData.settingsNoteId)} />
                    )}
                    {addonData.updateAvailable && (
                        <TamButton icon="bx bx-sync" text={`Update${addonData.availableVersion ? ` (${addonData.availableVersion})` : ""}`} onClick={() => onUpdate(addonData.id)} />
                    )}
                    {addonData.installedVersion && (
                        <TamButton className="btn-ghost" icon="bx bx-refresh" text="Reinstall" onClick={() => onReinstall(addonData.id)} />
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

// Replaces the two structurally-identical NewCatalog/NewAddonByUrl components — SettingsView
// calls this twice with different placeholder/icon/label/onSave props.
function NewUrlForm({ placeholder, buttonIcon, buttonText, onSave }) {
    const [url, setUrl] = useState("")
    return (
        <div className="TAM-new-repository-div">
            <input
                type="text"
                placeholder={placeholder}
                value={url}
                onChange={e => setUrl(e.target.value)}
                className="TAM-new-repository-text"
            />
            <TamButton icon={buttonIcon} text={buttonText} onClick={() => onSave(url)} />
        </div>
    )
}

function SettingsView({
    addons, catalogs, onAddCatalog, onDeleteCatalog, onVisitCatalogWebsite, onBrowseCatalog, onInstallByUrl, onCheckUpdates, onUpdateAll,
    onValidate, onSweepOrphans, onSweepInvalidTree, onReinitialize, anyUpdateAvailable
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
                    <NewUrlForm placeholder="https://.../catalog.json" buttonIcon="bx bx-plus" buttonText="Add Catalog" onSave={onAddCatalog} />
                </div>
                <h3>Install a single addon by URL</h3>
                <div className="TAM-repo-list">
                    <NewUrlForm placeholder="https://.../_tam_manifest_.json" buttonIcon="bx bx-plus" buttonText="Install by URL" onSave={onInstallByUrl} />
                </div>
            </div>

            <div>
                <h3>Maintenance</h3>
                <div className="TAM-maintenance-actions">
                    <TamButton className="btn-ghost" icon="bx bx-sync" text="Check for Updates" onClick={onCheckUpdates} />
                    {anyUpdateAvailable && <TamButton icon="bx bx-sync" text="Update All Addons" onClick={onUpdateAll} />}
                    <TamButton className="btn-ghost" icon="bx bx-shield-quarter" text="Validate Database" onClick={onValidate} />
                    <TamButton className="btn-ghost" icon="bx bx-broom" text="Sweep Orphaned Notes" onClick={onSweepOrphans} />
                    <TamButton className="btn-ghost" icon="bx bx-broom" text="Sweep Invalid Addon Tree Notes" onClick={onSweepInvalidTree} />
                    <TamButton
                        className="btn-ghost"
                        icon="bx bx-trash"
                        text="Reinitialize Database"
                        onClick={() => {
                            if (window.confirm(
                                "This uninstalls every addon (deleting their notes) except TAM itself, then " +
                                "clears TAM's own tracked install state too, prompting a fresh reinstall of TAM " +
                                "next sync. Your added catalogs are kept. This cannot be undone. Continue?"
                            )) {
                                onReinitialize()
                            }
                        }}
                    />
                </div>
            </div>
        </div>
    )
}

// =========================================================================
// Commands: the data/command layer — owns every piece of state that comes from
// or drives a lib-tam.js call, and processes dispatched commands. RepoManager
// (below) owns only UI-navigation/dialog state and composes this hook's output.
// =========================================================================

// useTamCommands takes its cross-cutting dependencies as explicit parameters rather than
// reading them itself:
// - resolveDisplayNote(): currentNote only resolves correctly in the note it physically
//   executes in (this note), so RepoManager owns that read and injects it in.
// - dialogActions: the handful of setters (setUninstallPrompt/setView/setValidationTitle/
//   setValidationIssues) that a few commands need to update — these are pure UI-dialog state
//   that belongs to RepoManager, not to this data layer.
function useTamCommands(resolveDisplayNote, dialogActions) {
    const { setUninstallPrompt, setView, setValidationTitle, setValidationIssues } = dialogActions

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
        await libTAMjs.syncAddon(command.addon, { manifestSourceUrl: command.manifestSourceUrl })
        await reloadAndActivate()
    }

    async function handleInstallByUrl(command) {
        await libTAMjs.installByUrl(command.url)
        await reloadAndActivate()
    }

    async function handleRequestUninstall(command) {
        const references = await libTAMjs.findExternalReferences(command.addon)
        const hasData = await libTAMjs.hasPersistentData(command.addon)
        if (references.length > 0 || hasData) {
            setUninstallPrompt({ addonId: command.addon, references, hasData })
        } else {
            setCommand({ command: "delete-addon", addon: command.addon })
        }
    }

    async function handleDeleteAddon(command) {
        await libTAMjs.uninstallAddon(command.addon, { deleteData: !!command.deleteData })
        await reload()
        setView({ type: "list" })
        await activateNote(await resolveDisplayNote())
        window.location.reload()
    }

    // Shared by update-addon and reinstall-addon — both are just syncAddon followed
    // by the same pending-prompt check.
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
        for (const [noteLocalId, decision] of Object.entries(decisions)) {
            await libTAMjs.resolvePrompt(addonId, noteLocalId, decision)
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

    async function handleSweepOrphans() {
        const removedTamFileIds = await libTAMjs.sweepOrphanedNotes()
        setValidationTitle("Orphaned Notes")
        setValidationIssues(removedTamFileIds.map(tamFileId => ({
            addonId: tamFileId.split("/")[0],
            message: `removed orphaned note '${tamFileId}'`
        })))
        await reload()
    }

    async function handleSweepInvalidTree() {
        const removed = await libTAMjs.sweepInvalidAddonTreeNotes()
        setValidationTitle("Invalid Addon Tree Notes")
        setValidationIssues(removed.map(({ title, tamFileId }) => ({
            addonId: tamFileId ? tamFileId.split("/")[0] : "(none)",
            message: tamFileId
                ? `removed note '${title}' with TAMFILEID '${tamFileId}' for an addon that isn't installed`
                : `removed note '${title}' with no TAMFILEID`
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
        "reinstall-addon": handleUpdateAddon,
        "resolve-prompts": handleResolvePrompts,
        "update-all": handleUpdateAll,
        "enable-addon": handleEnableAddon,
        "check-updates": handleCheckUpdates,
        "validate-database": handleValidateDatabase,
        "sweep-orphans": handleSweepOrphans,
        "sweep-invalid-tree": handleSweepInvalidTree,
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

// =========================================================================
// Root widget: owns UI-navigation/dialog state (view, validation results,
// external-reference warning) and the one currentNote-bound read (displayNote)
// that must live in this exact note. Everything else is composed from above.
// =========================================================================

async function resolveDisplayNote() {
    return await currentNote.getRelationValue("displayNote")
}

export default function RepoManager() {
    const { note } = useActiveNoteContext()
    const [view, setView] = useState({ type: "list" })
    const [validationIssues, setValidationIssues] = useState(null)
    const [validationTitle, setValidationTitle] = useState("Database Validation")
    const [uninstallPrompt, setUninstallPrompt] = useState(null) // { addonId, references, hasData }

    const {
        addons, catalogs, catalogBrowse, catalogAddons,
        pendingPrompts, promptAddonId, promptQueue,
        pendingCommand, progressDetail, dispatch
    } = useTamCommands(resolveDisplayNote, { setUninstallPrompt, setView, setValidationTitle, setValidationIssues })

    // Trigger loading of addons on page load.
    useEffect(() => {
        if (!note) return
        dispatch({ command: "load-addons" })
    }, [note])

    if (!addons) {
        return <div>Loading addons...</div>
    }

    if (uninstallPrompt) {
        return (
            <div className="TAM-body">
                <header>
                    <div className="hdr">
                        <h1>Trilium Addon Manager</h1>
                    </div>
                </header>
                <main>
                    <UninstallDialog
                        addonId={uninstallPrompt.addonId}
                        references={uninstallPrompt.references}
                        hasData={uninstallPrompt.hasData}
                        onProceed={deleteData => {
                            const addonId = uninstallPrompt.addonId
                            setUninstallPrompt(null)
                            dispatch({ command: "delete-addon", addon: addonId, deleteData })
                        }}
                        onCancel={() => setUninstallPrompt(null)}
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

    const handleInstall = entryData => dispatch({
        command: "install-addon",
        addon: entryData.id,
        manifestSourceUrl: entryData.manifestSourceUrl
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
                onSweepOrphans={() => dispatch({ command: "sweep-orphans" })}
                onSweepInvalidTree={() => dispatch({ command: "sweep-invalid-tree" })}
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
                        {anyUpdateAvailable && (
                            <a onClick={() => dispatch({ command: "update-all" })}>Update All</a>
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
