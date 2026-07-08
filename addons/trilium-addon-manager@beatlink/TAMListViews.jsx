// The addon card and the two grid views that list them: the main installed/catalog-only
// list, and a single catalog's browse results. Both use TAMShared's useAddonFilter hook.

import { Badge, TamButton, Spinner, SearchFilterToolbar, useAddonFilter, TAM_ID } from "TAMShared.jsx"

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

module.exports = { AddonCard, ListView, CatalogBrowseView }
