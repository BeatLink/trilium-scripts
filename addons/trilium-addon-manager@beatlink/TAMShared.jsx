// Small presentational primitives (Badge, TamButton, BackLink, Spinner), the type-color
// palette, and the useAddonFilter hook shared by ListView and CatalogBrowseView.

import { useState } from "trilium:preact"

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

module.exports = {
    TYPE_COLORS,
    TAM_ID,
    typeColor,
    titleCase,
    Badge,
    TamButton,
    BackLink,
    Spinner,
    computeStats,
    SearchFilterToolbar,
    useAddonFilter
}
