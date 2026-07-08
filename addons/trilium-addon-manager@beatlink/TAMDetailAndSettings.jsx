// The addon detail page and the settings screen (stats, catalog list, maintenance actions).

import { useState, useEffect } from "trilium:preact"
import { activateNote } from "trilium:api"
import { TamButton, Spinner, computeStats } from "TAMShared.jsx"
const { fetchReadmeHtml } = require("libTAM.js")

function AddonDetail({ addonData, isSelf, onInstall, onDelete, onUpdate, onEnable }) {
    const [readmeHtml, setReadmeHtml] = useState(null)
    const [readmeLoading, setReadmeLoading] = useState(false)

    useEffect(() => {
        setReadmeHtml(null)
        const readmeLocalId = addonData.manifest?.readmeNote
        if (!addonData.installedVersion || !readmeLocalId) return
        setReadmeLoading(true)
        fetchReadmeHtml(addonData.id, readmeLocalId).then(html => {
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
                        <TamButton icon="bx bx-sync" text={`Update${addonData.availableVersion ? ` (${addonData.availableVersion})` : ""}`} onClick={() => onUpdate(addonData.id)} />
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
    onValidate, onCleanup, onSweepOrphans, onReinitialize, anyUpdateAvailable
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
                    <TamButton className="btn-ghost" icon="bx bx-broom" text="Clean Up Empty Persistence Roots" onClick={onCleanup} />
                    <TamButton className="btn-ghost" icon="bx bx-broom" text="Sweep Orphaned Notes" onClick={onSweepOrphans} />
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

module.exports = { AddonDetail, SettingsView }
