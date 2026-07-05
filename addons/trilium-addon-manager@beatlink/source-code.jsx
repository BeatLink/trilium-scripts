// Imports --------------------------------------------------------------------
import {
    defineWidget,
    useActiveNoteContext,
    FormTextBox,
    Button,
    LinkButton,
    RawHtml,
    LoadingSpinner,
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

function typeColor(type) {
    return TYPE_COLORS[type] || "#6b7280"
}

function titleCase(s) {
    return s.charAt(0).toUpperCase() + s.slice(1)
}

function Badge({ type }) {
    return <span className="TAM-badge" style={{ backgroundColor: typeColor(type) }}>{type}</span>
}

function computeStats(repositories) {
    let repoCount = 0, installedCount = 0, persistedCount = 0, updateCount = 0
    for (const repoData of Object.values(repositories)) {
        repoCount++
        for (const addonData of Object.values(repoData.addons ?? {})) {
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
    }
    return { repoCount, installedCount, persistedCount, updateCount }
}


// List View -------------------------------------------------------------------
function AddonCard({ repoId, addonId, addonData, onOpen, onInstall }) {
    return (
        <div className="TAM-card" onClick={() => onOpen(repoId, addonId)}>
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
            {!addonData.installedVersion && (
                <div className="TAM-card-install">
                    <Button
                        icon="bx bx-download"
                        text="Install"
                        onClick={e => {
                            e.stopPropagation()
                            onInstall(repoId, addonId)
                        }}
                    />
                </div>
            )}
        </div>
    )
}

function ListView({ repositories, onOpenAddon, onInstallAddon, onOpenSettings }) {
    const [search, setSearch] = useState("")
    const [typeFilter, setTypeFilter] = useState(null)

    const allAddons = []
    for (const [repoId, repoData] of Object.entries(repositories)) {
        for (const [addonId, addonData] of Object.entries(repoData.addons ?? {})) {
            // Libraries are an implementation detail of whatever addon depends
            // on them — TAM installs/updates/uninstalls them automatically via
            // the dependency graph, so there's nothing for the user to do with
            // one directly.
            if (addonData.type === "library") continue
            allAddons.push({ repoId, addonId, addonData })
        }
    }
    allAddons.sort((a, b) => (a.addonData.name || "").localeCompare(b.addonData.name || ""))

    const availableTypes = [...new Set(allAddons.map(a => a.addonData.type))].sort()

    const searchLower = search.trim().toLowerCase()
    const visible = allAddons.filter(({ addonData }) => {
        if (typeFilter && addonData.type !== typeFilter) return false
        if (!searchLower) return true
        return [addonData.name, addonData.description, addonData.author]
            .some(field => (field || "").toLowerCase().includes(searchLower))
    })

    return (
        <div>
            <div className="TAM-toolbar">
                <FormTextBox
                    placeholder="Search addons..."
                    currentValue={search}
                    onChange={setSearch}
                    className="TAM-search"
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
                    <p>No repositories added yet.</p>
                    <Button icon="bx bx-cog" text="Go to Settings to add a repository" onClick={onOpenSettings} />
                </div>
            ) : visible.length === 0 ? (
                <div className="TAM-empty-state">
                    <p>No addons match your search.</p>
                </div>
            ) : (
                <div className="TAM-grid">
                    {visible.map(({ repoId, addonId, addonData }) => (
                        <AddonCard
                            key={`${repoId}::${addonId}`}
                            repoId={repoId}
                            addonId={addonId}
                            addonData={addonData}
                            onOpen={onOpenAddon}
                            onInstall={onInstallAddon}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}


// Addon Detail View -------------------------------------------------------------
function AddonDetail({ repoId, addonId, addonData, isSelf, onBack, onInstall, onDelete, onUpdate, onRepair, onEnable }) {
    const [readmeHtml, setReadmeHtml] = useState(null)
    const [readmeLoading, setReadmeLoading] = useState(false)

    useEffect(() => {
        setReadmeHtml(null)
        const readmeLocalId = addonData.manifest?.readmeNote
        if (!addonData.installedVersion || !readmeLocalId) return
        setReadmeLoading(true)
        libTAMjs.fetchReadmeHtml(addonId, readmeLocalId).then(html => {
            setReadmeHtml(html)
            setReadmeLoading(false)
        })
    }, [addonId, addonData.installedVersion, addonData.manifest?.readmeNote])

    return (
        <div className="TAM-addon-layout">
            <div className="TAM-addon-sidebar">
                <LinkButton icon="bx bx-arrow-back" text="Back to Addons" onClick={onBack} />
                <Badge type={addonData.type} />
                <h2>{addonData.name}</h2>
                <table className="TAM-meta-table">
                    <tbody>
                        <tr><td>Author</td><td>{addonData.author}</td></tr>
                        <tr><td>Version</td><td>{addonData.installedVersion ?? addonData.latestVersion}</td></tr>
                        <tr><td>License</td><td>{addonData.license}</td></tr>
                        <tr><td>Repository</td><td>{repoId}</td></tr>
                    </tbody>
                </table>
                <div className="TAM-addon-actions">
                    <Button icon="bx bx-globe" text="Home Page" onClick={() => window.open(addonData.homepage, "_blank")} />
                    {!addonData.installedVersion && (
                        <Button icon="bx bx-download" text="Install Addon" onClick={() => onInstall(addonId)} />
                    )}
                    {addonData.installedVersion && !isSelf && (
                        <Button icon="bx bx-trash" text="Delete Addon" onClick={() => onDelete(addonId)} />
                    )}
                    {addonData.installedVersion && (
                        <Button
                            icon={addonData.enabled ? "bx bx-x-circle" : "bx bx-check-circle"}
                            text={addonData.enabled ? "Disable Addon" : "Enable Addon"}
                            onClick={() => onEnable(addonId, !addonData.enabled)}
                        />
                    )}
                    {addonData.installedVersion && addonData.settingsNoteId && (
                        <Button icon="bx bx-cog" text="Addon Settings" onClick={() => activateNote(addonData.settingsNoteId)} />
                    )}
                    {addonData.installedVersion && (
                        <Button icon="bx bx-wrench" text="Repair" onClick={() => onRepair(addonId)} />
                    )}
                    {addonData.updateAvailable && (
                        <Button icon="bx bx-sync" text={`Update (${addonData.latestVersion})`} onClick={() => onUpdate(addonId)} />
                    )}
                </div>
            </div>
            <div className="TAM-addon-main">
                <p className="TAM-addon-description">{addonData.description}</p>
                {addonData.installedVersion ? (
                    readmeLoading ? (
                        <LoadingSpinner />
                    ) : readmeHtml ? (
                        <RawHtml className="TAM-readme" html={readmeHtml} />
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
function NewRepo({ onSave }) {
    const [repoId, setRepoId] = useState("")
    return (
        <div className="TAM-new-repository-div">
            <FormTextBox
                placeholder="owner/repo"
                currentValue={repoId}
                onChange={(newValue) => { setRepoId(newValue) }}
                className="TAM-new-repository-text"
            />
            <Button
                icon="bx bx-plus"
                text="Add Repository"
                onClick={e => {
                    onSave(repoId)
                }}
            />
        </div>
    )
}

function SettingsView({
    repositories, onBack, onAddRepo, onDeleteRepo, onUpdateRepos, onUpdateAll,
    onValidate, onCleanup, onBackfillIds, onBackfillManifests, anyUpdateAvailable
}) {
    const stats = computeStats(repositories)
    return (
        <div className="TAM-settings">
            <LinkButton icon="bx bx-arrow-back" text="Back to Addons" onClick={onBack} />

            <div>
                <h3>Statistics</h3>
                <div className="TAM-stats-grid">
                    <div className="TAM-stat-card">
                        <span className="TAM-stat-value">{stats.repoCount}</span>
                        <span className="TAM-stat-label">Repositories</span>
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
                <h3>Repositories</h3>
                <div className="TAM-repo-list">
                    {Object.keys(repositories).map(repoId => (
                        <div key={repoId} className="TAM-repo-row">
                            <span>{repoId}</span>
                            <Button
                                icon="bx bx-trash"
                                text="Delete"
                                onClick={() => {
                                    const hasInstalled = Object.values(repositories[repoId].addons ?? {}).some(a => a.installedVersion)
                                    if (hasInstalled) {
                                        api.showMessage("Cannot delete repository: some addons are still installed. Uninstall them first.")
                                        return
                                    }
                                    onDeleteRepo(repoId)
                                }}
                            />
                        </div>
                    ))}
                    <NewRepo onSave={onAddRepo} />
                </div>
            </div>

            <div>
                <h3>Maintenance</h3>
                <div className="TAM-maintenance-actions">
                    <Button icon="bx bx-sync" text="Update Repositories" onClick={onUpdateRepos} />
                    {anyUpdateAvailable && <Button icon="bx bx-sync" text="Update All Addons" onClick={onUpdateAll} />}
                    <Button icon="bx bx-shield-quarter" text="Validate Database" onClick={onValidate} />
                    <Button icon="bx bx-broom" text="Clean Up Empty Persistence Roots" onClick={onCleanup} />
                    <Button icon="bx bx-tag" text="Backfill Note IDs" onClick={onBackfillIds} />
                    <Button icon="bx bx-archive" text="Backfill Installed Manifests" onClick={onBackfillManifests} />
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
            <Button icon="bx bx-check" text="Apply" onClick={() => onResolve(decisions)} />
        </div>
    )
}


// Widget ---------------------------------------------------------------------
export default function RepoManager() {
    const { note } = useActiveNoteContext()
    const [command, setCommand] = useState(null)
    const [repositories, setRepositories] = useState(null)
    const [pendingPrompts, setPendingPrompts] = useState([])
    const [promptContext, setPromptContext] = useState(null)
    const [promptQueue, setPromptQueue] = useState([])
    const [validationIssues, setValidationIssues] = useState(null)
    const [validationTitle, setValidationTitle] = useState("Database Validation")
    const [view, setView] = useState({ type: "list" })

    // Main Command Handler
    useEffect(() => {
        if (!command) return;
        async function commandHandler(){
            const displayNote = await currentNote.getRelationValue("displayNote")
            switch (command["command"]) {
                case "load-repository": {
                    setRepositories((await libTAMjs.getAllRepositories()))
                    setCommand(null)
                    break
                }
                case "add-repository": {
                    await libTAMjs.addRepository(command["repository"])
                    setCommand({command: "load-repository"})
                    await activateNote(displayNote)
                    break
                }
                case "update-repositories": {
                    await libTAMjs.updateRepositories()
                    setCommand({command: "load-repository"})
                    await activateNote(displayNote)
                    break
                }
                case "delete-repository": {
                    await libTAMjs.deleteRepository(command["repository"])
                    setCommand({command: "load-repository"})
                    await activateNote(displayNote)
                    break
                }
                case "install-addon": {
                    await libTAMjs.syncAddon(command["repository"], command["addon"])
                    setCommand({command: "load-repository"})
                    await activateNote(displayNote)
                    window.location.reload();
                    break
                }
                case "delete-addon": {
                    await libTAMjs.uninstallAddon(command["repository"], command["addon"])
                    setCommand({command: "load-repository"})
                    setView({ type: "list" })
                    await activateNote(displayNote)
                    window.location.reload();
                    break
                }
                case "update-addon": {
                    await libTAMjs.syncAddon(command["repository"], command["addon"])
                    const prompts = await libTAMjs.getPendingPrompts(command["repository"], command["addon"])
                    if (prompts.length > 0) {
                        setPendingPrompts(prompts)
                        setPromptContext({ repoId: command["repository"], addonId: command["addon"] })
                        setCommand(null)
                    } else {
                        setCommand({command: "load-repository"})
                        await activateNote(displayNote)
                        window.location.reload()
                    }
                    break
                }
                case "resolve-prompts": {
                    const { repoId, addonId, decisions } = command
                    for (const [noteLocalId, useNew] of Object.entries(decisions)) {
                        await libTAMjs.resolvePrompt(repoId, addonId, noteLocalId, useNew)
                    }
                    await libTAMjs.clearPendingPrompts(repoId, addonId)

                    if (promptQueue.length > 0) {
                        const [next, ...rest] = promptQueue
                        const prompts = await libTAMjs.getPendingPrompts(next.repoId, next.addonId)
                        setPendingPrompts(prompts)
                        setPromptContext(next)
                        setPromptQueue(rest)
                        setCommand(null)
                    } else {
                        setPendingPrompts([])
                        setPromptContext(null)
                        setCommand({command: "load-repository"})
                        await activateNote(displayNote)
                        window.location.reload()
                    }
                    break
                }
                case "update-all": {
                    const targets = []
                    for (const [repoId, repoData] of Object.entries(repositories)) {
                        for (const [addonId, addonData] of Object.entries(repoData.addons ?? {})) {
                            // Libraries are hidden and update themselves as a
                            // side effect of updating whatever depends on them
                            // (their updateAvailable flag is already
                            // propagated up to those dependents) — updating
                            // them here too would just be redundant work.
                            if (addonData.type === "library") continue
                            if (addonData.installedVersion && addonData.updateAvailable) {
                                targets.push({ repoId, addonId })
                            }
                        }
                    }

                    const queue = []
                    for (const { repoId, addonId } of targets) {
                        await libTAMjs.syncAddon(repoId, addonId)
                        const prompts = await libTAMjs.getPendingPrompts(repoId, addonId)
                        if (prompts.length > 0) queue.push({ repoId, addonId })
                    }

                    if (queue.length > 0) {
                        const [next, ...rest] = queue
                        const prompts = await libTAMjs.getPendingPrompts(next.repoId, next.addonId)
                        setPendingPrompts(prompts)
                        setPromptContext(next)
                        setPromptQueue(rest)
                        setCommand(null)
                    } else {
                        setCommand({command: "load-repository"})
                        await activateNote(displayNote)
                        window.location.reload()
                    }
                    break
                }
                case "repair-addon": {
                    const issues = await libTAMjs.repairAddon(command["repository"], command["addon"])
                    setValidationTitle(`Repair: ${command["addon"]}`)
                    setValidationIssues(issues)
                    setCommand(null)
                    break
                }
                case "enable-addon": {
                    await libTAMjs.enableAddon(command["repository"], command["addon"], command["enabled"])
                    setCommand({command: "load-repository"})
                    await activateNote(displayNote)
                    window.location.reload();
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
                    setCommand({command: "load-repository"})
                    break
                }
                case "backfill-tamfileids": {
                    await libTAMjs.backfillTamFileIds()
                    setCommand({command: "load-repository"})
                    break
                }
                case "backfill-manifests": {
                    await libTAMjs.backfillInstalledManifests()
                    setCommand({command: "load-repository"})
                    break
                }
            }
        }
        commandHandler()
    }, [command])

    // Trigger Loading of Repository on Page load
    useEffect(() => {
        if (!note) return;
        setCommand({command: "load-repository"})
    }, [note])

    if (!repositories) {
        return <div>Loading repositories...</div>;
    }

    if (pendingPrompts.length > 0 && promptContext) {
        return (
            <div className="TAM-body">
                <div className="TAM-header">
                    <div className="TAM-header-titles">
                        <h2>Trilium Addon Manager</h2>
                        <p><a href="https://beatlink.github.io/trilium-scripts/" target="_blank" className="TAM-catalog-link">Browse Addon Catalog ↗</a></p>
                    </div>
                </div>
                {promptQueue.length > 0 && (
                    <p>{promptContext.addonId} — {promptQueue.length} more addon(s) to review after this</p>
                )}
                <PromptReview
                    prompts={pendingPrompts}
                    onResolve={(decisions) => setCommand({
                        command: "resolve-prompts",
                        repoId: promptContext.repoId,
                        addonId: promptContext.addonId,
                        decisions
                    })}
                />
            </div>
        )
    }

    const anyUpdateAvailable = Object.values(repositories).some(repoData =>
        Object.values(repoData.addons ?? {}).some(a => a.type !== "library" && a.installedVersion && a.updateAvailable)
    )

    let bodyContent
    if (view.type === "settings") {
        bodyContent = (
            <SettingsView
                repositories={repositories}
                anyUpdateAvailable={anyUpdateAvailable}
                onBack={() => setView({ type: "list" })}
                onAddRepo={value => setCommand({ command: "add-repository", repository: value })}
                onDeleteRepo={repoId => setCommand({ command: "delete-repository", repository: repoId })}
                onUpdateRepos={() => setCommand({ command: "update-repositories" })}
                onUpdateAll={() => setCommand({ command: "update-all" })}
                onValidate={() => setCommand({ command: "validate-database" })}
                onCleanup={() => setCommand({ command: "cleanup-persistence" })}
                onBackfillIds={() => setCommand({ command: "backfill-tamfileids" })}
                onBackfillManifests={() => setCommand({ command: "backfill-manifests" })}
            />
        )
    } else if (view.type === "detail") {
        const addonData = repositories[view.repoId]?.addons?.[view.addonId]
        if (!addonData) {
            bodyContent = <p>Addon not found. <LinkButton text="Back to Addons" onClick={() => setView({ type: "list" })} /></p>
        } else {
            bodyContent = (
                <AddonDetail
                    repoId={view.repoId}
                    addonId={view.addonId}
                    addonData={addonData}
                    isSelf={view.addonId === "trilium-addon-manager@beatlink"}
                    onBack={() => setView({ type: "list" })}
                    onInstall={addonId => setCommand({ command: "install-addon", repository: view.repoId, addon: addonId })}
                    onDelete={addonId => setCommand({ command: "delete-addon", repository: view.repoId, addon: addonId })}
                    onUpdate={addonId => setCommand({ command: "update-addon", repository: view.repoId, addon: addonId })}
                    onRepair={addonId => setCommand({ command: "repair-addon", repository: view.repoId, addon: addonId })}
                    onEnable={(addonId, enabled) => setCommand({ command: "enable-addon", repository: view.repoId, addon: addonId, enabled })}
                />
            )
        }
    } else {
        bodyContent = (
            <ListView
                repositories={repositories}
                onOpenAddon={(repoId, addonId) => setView({ type: "detail", repoId, addonId })}
                onInstallAddon={(repoId, addonId) => setCommand({ command: "install-addon", repository: repoId, addon: addonId })}
                onOpenSettings={() => setView({ type: "settings" })}
            />
        )
    }

    return (
        <div className="TAM-body">
            <div className="TAM-header">
                <div className="TAM-header-titles">
                    <h2>Trilium Addon Manager</h2>
                    <p><a href="https://beatlink.github.io/trilium-scripts/" target="_blank" className="TAM-catalog-link">Browse Addon Catalog ↗</a></p>
                </div>
                {view.type === "list" && (
                    <div className="TAM-header-actions">
                        <Button icon="bx bx-cog" text="Settings" onClick={() => setView({ type: "settings" })} />
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
                        <pre className="TAM-validation-content">
                            {validationIssues.map(issue => `${issue.repoId} / ${issue.addonId}: ${issue.message}`).join("\n")}
                        </pre>
                    )}
                    <div className="TAM-validation-buttons">
                        {validationIssues.length > 0 && <Button
                            icon="bx bx-copy"
                            text="Copy to Clipboard"
                            onClick={e => {
                                const text = validationIssues
                                    .map(issue => `${issue.repoId} / ${issue.addonId}: ${issue.message}`)
                                    .join("\n")
                                navigator.clipboard.writeText(text)
                            }}
                        />}
                        <Button
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
