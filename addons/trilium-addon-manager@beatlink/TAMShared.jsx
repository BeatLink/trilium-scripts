// Small presentational primitives (Badge, TamButton, BackLink, Spinner), the type-color
// palette, and the useAddonFilter hook shared by ListView and CatalogBrowseView.

import { useState, useEffect, useRef } from "trilium:preact"

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

const COMMAND_LABELS = {
    "load-addons": "Loading addons",
    "add-catalog": "Adding catalog",
    "delete-catalog": "Removing catalog",
    "browse-catalog": "Loading catalog",
    "visit-catalog-website": "Opening website",
    "install-addon": "Installing addon",
    "install-by-url": "Installing addon",
    "request-uninstall": "Checking for external references",
    "delete-addon": "Uninstalling addon",
    "update-addon": "Updating addon",
    "resolve-prompts": "Applying update",
    "update-all": "Updating all addons",
    "enable-addon": "Updating addon",
    "check-updates": "Checking for updates",
    "validate-database": "Validating database",
    "cleanup-persistence": "Cleaning up persisted data",
    "sweep-orphans": "Sweeping orphaned notes",
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
        const persistence = addonData.persistence
        const hasPersisted = persistence && (
            persistence.rootNote ||
            (persistence.persistenceNotes && Object.keys(persistence.persistenceNotes).length > 0)
        )
        if (hasPersisted) persistedCount++
    }
    return { catalogCount: catalogs.length, installedCount, persistedCount, updateCount }
}

// --- Dependency graph -> Mermaid -------------------------------------------
// Mirrors resources/scripts/generate_pages.py's graph builder so the in-Trilium
// diagram and the GitHub Pages catalog render identically from the same edges.
// `addons` is the id-keyed map TAM already loads; each value carries `.name`,
// `.type`, and `.manifest.dependencies` (bare-id strings or {id,...} objects).

function depIds(addonData) {
    const deps = addonData?.manifest?.dependencies || []
    return deps.map(d => (typeof d === "string" ? d : d && d.id)).filter(Boolean)
}

// { metas, edges } — edges keep only dependencies that are themselves present
// in `addons`, so an unresolved/uninstalled dep never dangles a node.
function buildDepGraph(addons) {
    const metas = addons
    const edges = {}
    for (const [id, data] of Object.entries(addons)) {
        edges[id] = depIds(data).filter(dep => metas[dep])
    }
    return { metas, edges }
}

function mermaidNodeId(addonId) {
    return "n_" + addonId.replace(/[^a-zA-Z0-9]/g, "_")
}

function closure(seed, adjacency) {
    const seen = new Set(), stack = [seed]
    while (stack.length) {
        const cur = stack.pop()
        for (const nxt of adjacency[cur] || []) {
            if (nxt !== seed && !seen.has(nxt)) { seen.add(nxt); stack.push(nxt) }
        }
    }
    return seen
}

function mermaidBody(nodeIds, edges, metas, focus) {
    const ids = [...nodeIds]
    const lines = ["flowchart LR"]
    for (const id of ids) {
        const label = (metas[id]?.name || id).replace(/"/g, "'")
        lines.push(`    ${mermaidNodeId(id)}["${label}"]`)
    }
    for (const id of ids) {
        for (const dep of edges[id] || []) {
            if (nodeIds.has(dep)) lines.push(`    ${mermaidNodeId(id)} --> ${mermaidNodeId(dep)}`)
        }
    }
    for (const id of ids) {
        const color = typeColor(metas[id]?.type)
        lines.push(`    style ${mermaidNodeId(id)} fill:${color},stroke:${color},color:#fff`)
    }
    if (focus) lines.push(`    style ${mermaidNodeId(focus)} stroke:#0f172a,stroke-width:4px`)
    return lines.join("\n")
}

// Whole-catalog diagram over every addon in the map.
function buildCatalogMermaid(addons) {
    const { metas, edges } = buildDepGraph(addons)
    const ids = new Set(Object.keys(metas))
    return mermaidBody(ids, edges, metas)
}

// Focused subgraph: the addon plus its transitive deps and dependents.
// Returns null when the addon has no edges at all (nothing worth drawing).
function buildAddonMermaid(addons, addonId) {
    const { metas, edges } = buildDepGraph(addons)
    if (!metas[addonId]) return null
    const dependents = {}
    for (const id of Object.keys(metas)) dependents[id] = []
    for (const [id, deps] of Object.entries(edges)) {
        for (const dep of deps) dependents[dep].push(id)
    }
    const hasEdge = (edges[addonId] || []).length > 0 || dependents[addonId].length > 0
    if (!hasEdge) return null
    const nodes = new Set([addonId, ...closure(addonId, edges), ...closure(addonId, dependents)])
    return mermaidBody(nodes, edges, metas, addonId)
}

// Loads mermaid once and memoizes it. Trilium bundles mermaid but never exposes
// it as a global, and a bare ES `import()` here does NOT reach the network —
// Trilium's JSX transpiler rewrites every `import(...)` into its own note-module
// resolver, which then fails with "Could not find module note <url>". So we load
// the UMD build the classic way, by injecting a <script> tag (a plain runtime DOM
// call the transpiler leaves alone), which sets globalThis.mermaid.
//
// This is TAM's one deliberate runtime CDN dependency: mermaid's build is ~3.5MB,
// and vendoring it as a note inside TAM's own install ZIP was measured to break
// the ZIP import (large note silently dropping sibling notes), while shipping it
// as a separate library addon would give TAM its first-ever addon dependency —
// something the manager deliberately avoids so a dep failure can't break the one
// tool that could fix it. The graph views degrade gracefully (an inline error
// line) when offline; nothing else in TAM depends on this load.
// Same CDN/version the GitHub Pages catalog uses.
const MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"
let mermaidPromise = null
function loadMermaid() {
    if (mermaidPromise) return mermaidPromise
    mermaidPromise = new Promise((resolve, reject) => {
        if (window.mermaid) return resolve(window.mermaid)
        const script = document.createElement("script")
        script.src = MERMAID_URL
        script.onload = () => window.mermaid ? resolve(window.mermaid) : reject(new Error("mermaid did not initialize"))
        script.onerror = () => reject(new Error("failed to load mermaid from " + MERMAID_URL))
        document.head.appendChild(script)
    }).then(mermaid => {
        const dark = document.body.classList.contains("theme-dark")
            || window.matchMedia("(prefers-color-scheme: dark)").matches
        mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "neutral", securityLevel: "strict" })
        return mermaid
    })
    return mermaidPromise
}

let mermaidSeq = 0

// Renders a mermaid `source` string into an SVG. Shows the Spinner while the
// (one-time) library load and render are in flight, and a plain error line if
// the source fails to parse rather than blanking the whole view.
function MermaidDiagram({ source }) {
    const ref = useRef(null)
    const [error, setError] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setError(null)
        loadMermaid()
            .then(mermaid => mermaid.render(`tam-mermaid-${++mermaidSeq}`, source))
            .then(({ svg }) => {
                if (cancelled) return
                if (ref.current) ref.current.innerHTML = svg
                setLoading(false)
            })
            .catch(e => {
                if (cancelled) return
                console.error("TAM: mermaid render failed", e)
                setError(e.message || String(e))
                setLoading(false)
            })
        return () => { cancelled = true }
    }, [source])

    return (
        <div className="TAM-mermaid">
            {loading && <Spinner />}
            {error && <p className="no-readme">Could not render diagram: {error}</p>}
            <div className="TAM-mermaid-svg" ref={ref} />
        </div>
    )
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
    commandLabel,
    computeStats,
    SearchFilterToolbar,
    useAddonFilter,
    buildCatalogMermaid,
    buildAddonMermaid,
    MermaidDiagram
}
