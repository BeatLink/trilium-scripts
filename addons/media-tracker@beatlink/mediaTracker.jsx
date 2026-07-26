import { useState, useEffect, useCallback } from "trilium:preact"
import { activateNote } from "trilium:api"
import { loadSettings } from "libSettingsUI.jsx"

/*
 * media-tracker@beatlink — the widget.
 *
 * Three tabs:
 *   Library  - the tracked titles, with status/rating controls
 *   Add      - TMDB search, adds a title to the database
 *   Import   - one-way import from Trakt and Stremio
 *
 * Every title lives in one JSON note ("Database") under the library root. The
 * backend owns all reads and writes of that document; this widget never parses
 * or writes it directly, so there is exactly one writer per operation.
 */

const ENDPOINT = "custom/mediaTracker"

const STATUS_LABELS = {
    planned: "Planned",
    watching: "Watching",
    watched: "Watched",
    dropped: "Dropped"
}

async function callBackend(action, params = {}) {
    const search = new URLSearchParams({ action, ...params })
    const res = await fetch(`${ENDPOINT}?${search}`, { credentials: "same-origin" })
    let body
    try { body = await res.json() } catch (e) { body = { error: `HTTP ${res.status}` } }
    if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`)
    return body
}

function parseEpisodes(encoded) {
    const seasons = {}
    if (!encoded) return seasons
    for (const chunk of encoded.split(",")) {
        const match = /^s(\d+)e(\d+)(?:-e(\d+))?$/i.exec(chunk.trim())
        if (!match) continue
        const season = Number(match[1])
        const from = Number(match[2])
        const to = match[3] === undefined ? from : Number(match[3])
        if (!seasons[season]) seasons[season] = new Set()
        for (let n = from; n <= to; n++) seasons[season].add(n)
    }
    return seasons
}

function countEpisodes(seasons) {
    return Object.values(seasons).reduce((total, set) => total + set.size, 0)
}

// Seasons with at least one episode watched. This is all a collapsed row can
// know, since deciding a season is *complete* needs its aired-episode count,
// which only the expanded panel has fetched.
function countSeasonsStarted(seasons) {
    return Object.values(seasons).filter(set => set.size > 0).length
}

// Seasons where every aired episode is watched. Needs seasonCounts from TMDB.
function countSeasonsComplete(seasons, seasonCounts) {
    if (!seasonCounts) return 0
    return Object.entries(seasonCounts).filter(([season, aired]) =>
        aired > 0 && (seasons[season]?.size || 0) >= aired
    ).length
}

// --- collections and sorting ------------------------------------------------
// Mirrors of libMediaTracker.js: this file runs in the frontend and can't
// require the backend module. Kept deliberately small; the backend owns the
// authoritative versions used when writing.

const UNTAGGED = "Untagged"

const SORTS = [
    { key: "title", label: "A-Z" },
    { key: "lastWatched", label: "Recently watched" },
    { key: "year", label: "Release date" },
    { key: "rating", label: "Rating" },
    { key: "addedAt", label: "Recently added" },
    { key: "progress", label: "Progress" }
]

function compareMissingLast(a, b) {
    const aMissing = a === "" || a === null || a === undefined
    const bMissing = b === "" || b === null || b === undefined
    if (aMissing && bMissing) return 0
    if (aMissing) return 1
    if (bMissing) return -1
    return 0
}

function progressOf(title) {
    const total = Number(title.totalEpisodes) || 0
    if (!total) return null
    return countEpisodes(parseEpisodes(title.watchedEpisodes || "")) / total
}

function sortTitles(titles, sortKey, descending) {
    const direction = descending ? -1 : 1
    const sorted = [...titles]
    sorted.sort((x, y) => {
        let a
        let b
        switch (sortKey) {
            case "lastWatched": a = x.lastWatched; b = y.lastWatched; break
            case "year": a = x.year; b = y.year; break
            case "rating": a = x.rating; b = y.rating; break
            case "addedAt": a = x.addedAt; b = y.addedAt; break
            case "progress": a = progressOf(x); b = progressOf(y); break
            default: a = x.title; b = y.title
        }
        const missing = compareMissingLast(a, b)
        if (missing !== 0) return missing
        const result = (typeof a === "number" && typeof b === "number")
            ? a - b
            : String(a).localeCompare(String(b))
        return result !== 0 ? result * direction : x.title.localeCompare(y.title)
    })
    return sorted
}

// A title in several collections appears under each; those with none land in
// one trailing Untagged bucket.
function groupByCollection(titles) {
    const groups = new Map()
    const untagged = []
    for (const title of titles) {
        const names = title.collections || []
        if (!names.length) { untagged.push(title); continue }
        for (const name of names) {
            if (!groups.has(name)) groups.set(name, [])
            groups.get(name).push(title)
        }
    }
    const named = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    return untagged.length ? [...named, [UNTAGGED, untagged]] : named
}

// --- library ----------------------------------------------------------------

function TitleRow({ title, onChanged, expanded, onToggleEpisodes }) {
    const [busy, setBusy] = useState(false)
    const [editingTags, setEditingTags] = useState(false)
    const [tagDraft, setTagDraft] = useState("")

    const update = async (fn) => {
        setBusy(true)
        try { await fn(); await onChanged() } finally { setBusy(false) }
    }

    const saveTags = async () => {
        setEditingTags(false)
        await update(() => callBackend("setCollections", { key: title.key, collections: tagDraft }))
    }

    const seasons = parseEpisodes(title.watchedEpisodes)
    const watched = countEpisodes(seasons)
    const total = Number(title.totalEpisodes) || 0
    const seasonsStarted = countSeasonsStarted(seasons)

    return (
        <div class={`mt-item ${expanded ? "mt-item-open" : ""}`}>
            <div class="mt-row">
                {title.poster
                    ? <img class="mt-poster" src={title.poster} alt="" loading="lazy" />
                    : <div class="mt-poster mt-poster-empty" />}
                <div class="mt-row-main">
                    <div class="mt-row-title">{title.title}</div>
                    <div class="mt-row-meta">
                        {title.year && <span>{title.year}</span>}
                        <span class="mt-badge">{title.mediaType === "show" ? "TV" : "Movie"}</span>
                        {title.mediaType === "show" && watched > 0 && (
                            <span class="mt-progress">
                                {total > 0 ? `${watched}/${total} episodes` : `${watched} episodes`}
                                {seasonsStarted > 0 &&
                                    ` · ${seasonsStarted} season${seasonsStarted === 1 ? "" : "s"}`}
                            </span>
                        )}
                        {(title.collections || []).map(name => (
                            <span class="mt-tag" key={name}>{name}</span>
                        ))}
                    </div>
                    {editingTags ? (
                        <div class="mt-tag-edit">
                            <input
                                class="mt-input"
                                list="mt-collection-options"
                                placeholder="Comma-separated, e.g. Marvel Cinematic Universe, Phase Four"
                                value={tagDraft}
                                autofocus
                                disabled={busy}
                                onInput={e => setTagDraft(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === "Enter") saveTags()
                                    if (e.key === "Escape") setEditingTags(false)
                                }}
                            />
                            <button class="mt-btn" disabled={busy} onClick={saveTags}>Save</button>
                            <button class="mt-btn" disabled={busy}
                                onClick={() => setEditingTags(false)}>Cancel</button>
                        </div>
                    ) : (
                        <button class="mt-linkbtn" disabled={busy}
                            onClick={() => {
                                setTagDraft((title.collections || []).join(", "))
                                setEditingTags(true)
                            }}>
                            {(title.collections || []).length ? "Edit collections" : "+ Add to collection"}
                        </button>
                    )}
                </div>
                <div class="mt-row-actions">
                    <select
                        class={`mt-select mt-status-${title.status || "planned"}`}
                        disabled={busy}
                        value={title.status || "planned"}
                        onChange={e => update(() =>
                            callBackend("setStatus", { key: title.key, status: e.target.value }))}
                    >
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                        ))}
                    </select>
                    <label class="mt-rating-field" title="Your rating, 0-10. Leave blank for unrated.">
                        <span class="mt-rating-star" aria-hidden="true">★</span>
                        <input
                            class="mt-rating"
                            type="number" min="0" max="10" step="1"
                            placeholder="–"
                            aria-label="Rating out of 10"
                            disabled={busy}
                            value={title.rating ?? ""}
                            onChange={e => update(() =>
                                callBackend("setRating", { key: title.key, rating: e.target.value }))}
                        />
                    </label>
                    {title.mediaType === "show" && (
                        <button class="mt-btn" disabled={busy}
                            aria-expanded={expanded ? "true" : "false"}
                            onClick={() => onToggleEpisodes(title)}>
                            {expanded ? "Episodes ▴" : "Episodes ▾"}
                        </button>
                    )}
                    <button class="mt-btn" disabled={busy} title="Remove from library"
                        onClick={() => update(() => callBackend("removeTitle", { key: title.key }))}>
                        &times;
                    </button>
                </div>
            </div>

            {expanded && (
                <EpisodePanel title={title} onChanged={onChanged} />
            )}
        </div>
    )
}

function EpisodePanel({ title, onChanged }) {
    const [details, setDetails] = useState(null)
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(false)
    const [watchedEpisodes, setWatchedEpisodes] = useState(title.watchedEpisodes || "")

    useEffect(() => {
        (async () => {
            try {
                // A TMDB id may be missing on an imported title; the backend
                // resolves one from the IMDb id and stores it back.
                setDetails(await callBackend("details", {
                    mediaType: "show",
                    tmdbId: title.tmdbId || "",
                    imdbId: title.imdbId || "",
                    key: title.key
                }))
            } catch (e) {
                setError(e.message)
            }
        })()
    }, [title.key])

    const toggle = async (season, episode, watched) => {
        setBusy(true)
        try {
            const result = await callBackend("setEpisode", {
                key: title.key, season, episode, watched: String(watched),
                // Sent so the backend can decide "all episodes watched" even for
                // a title imported without TMDB metadata.
                totalEpisodes: String(details?.totalEpisodes || "")
            })
            setWatchedEpisodes(result.watchedEpisodes)
            await onChanged()
        } catch (e) {
            setError(e.message)
        } finally {
            setBusy(false)
        }
    }

    const seasons = parseEpisodes(watchedEpisodes)

    return (
        <div class="mt-episodes">
            {/* No title here: the row this expands from is directly above. */}
            {/* No Collapse button: the row's Episodes toggle already collapses this. */}
            {details && (
                <div class="mt-episodes-head">
                    <span class="mt-hint">
                        {countEpisodes(seasons)} of {details.totalEpisodes} episodes
                        {" · "}
                        {countSeasonsComplete(seasons, details.seasonCounts)} of{" "}
                        {Object.keys(details.seasonCounts || {}).length} seasons complete
                    </span>
                </div>
            )}
            {error && <p class="mt-error">{error}</p>}
            {!details && !error && <p class="mt-hint">Loading episodes...</p>}
            {details && Object.entries(details.seasonCounts).map(([season, count]) => (
                <div class="mt-season" key={season}>
                    <div class="mt-season-head">Season {season}</div>
                    <div class="mt-season-grid">
                        {Array.from({ length: count }, (_, i) => i + 1).map(episode => {
                            const isWatched = !!seasons[season]?.has(episode)
                            return (
                                <button
                                    key={episode}
                                    class={`mt-ep ${isWatched ? "mt-ep-on" : ""}`}
                                    disabled={busy}
                                    title={`S${season}E${episode}`}
                                    onClick={() => toggle(Number(season), episode, !isWatched)}
                                >
                                    {episode}
                                </button>
                            )
                        })}
                    </div>
                </div>
            ))}
        </div>
    )
}

function LibraryTab({ libraryRootNoteId }) {
    const [titles, setTitles] = useState([])
    const [filter, setFilter] = useState("all")
    const [typeFilter, setTypeFilter] = useState("all")
    const [query, setQuery] = useState("")
    // Key of the row whose episode grid is expanded, or null. One at a time, so
    // opening a show collapses whichever was open.
    const [expandedKey, setExpandedKey] = useState(null)
    const [refreshing, setRefreshing] = useState(false)
    const [refreshResult, setRefreshResult] = useState(null)
    const [collections, setCollections] = useState([])
    const [collectionFilter, setCollectionFilter] = useState("all")
    const [sortKey, setSortKey] = useState("title")
    const [sortDesc, setSortDesc] = useState(false)
    const [grouped, setGrouped] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    const reload = useCallback(async () => {
        if (!libraryRootNoteId) { setTitles([]); setLoading(false); return }
        try {
            const listed = await callBackend("listTitles")
            setTitles(listed.titles)
            setCollections(listed.collections || [])
            setError(null)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [libraryRootNoteId])

    useEffect(() => { reload() }, [reload])

    // Housekeeping sweep: refresh metadata/posters and re-derive show statuses
    // from episode progress, then reload the list.
    const refresh = async () => {
        setRefreshing(true)
        setRefreshResult(null)
        try {
            const r = await callBackend("refreshLibrary")
            const parts = [`${r.total} titles checked`]
            if (r.metadataUpdated) parts.push(`${r.metadataUpdated} updated`)
            if (r.statusUpdated) parts.push(`${r.statusUpdated} status fixed`)
            if (r.failed) parts.push(`${r.failed} could not be looked up`)
            setRefreshResult(parts.join(", "))
            await reload()
        } catch (e) {
            setError(e.message)
        } finally {
            setRefreshing(false)
        }
    }

    if (!libraryRootNoteId) {
        return (
            <div class="mt-empty">
                <p>No library root set.</p>
                <p class="mt-hint">
                    Pick a note on the <strong>Library Root</strong> tab in Settings. Every tracked
                    title is created under it, and that note becomes this tracker.
                </p>
            </div>
        )
    }

    // Type, text, and collection narrow the set first; the status chips then
    // count within that narrowed set, so the numbers always describe what a
    // click would show.
    const needle = query.trim().toLowerCase()
    const matchesCollection = (t) => {
        if (collectionFilter === "all") return true
        if (collectionFilter === UNTAGGED) return !(t.collections || []).length
        return (t.collections || []).includes(collectionFilter)
    }
    const scoped = titles.filter(t =>
        (typeFilter === "all" || t.mediaType === typeFilter) &&
        (!needle || t.title.toLowerCase().includes(needle)) &&
        matchesCollection(t)
    )
    const filtered = filter === "all" ? scoped : scoped.filter(t => t.status === filter)
    const shown = sortTitles(filtered, sortKey, sortDesc)
    const groups = grouped ? groupByCollection(shown) : null

    return (
        <div>
            <div class="mt-search">
                <input
                    class="mt-input"
                    type="search"
                    placeholder="Filter library by title..."
                    value={query}
                    onInput={e => setQuery(e.target.value)}
                />
                <button class="mt-btn" disabled={refreshing}
                    title="Refresh metadata and posters from TMDB, and recompute each show's status from its episode progress"
                    onClick={refresh}>
                    {refreshing ? "Refreshing..." : "Refresh"}
                </button>
            </div>
            {refreshResult && <p class="mt-ok">{refreshResult}</p>}

            <div class="mt-filters">
                {[["all", "All"], ["movie", "Movies"], ["show", "TV"]].map(([value, label]) => {
                    const count = value === "all"
                        ? titles.length
                        : titles.filter(t => t.mediaType === value).length
                    return (
                        <button key={value} class={`mt-chip ${typeFilter === value ? "mt-chip-on" : ""}`}
                            onClick={() => setTypeFilter(value)}>{label} ({count})</button>
                    )
                })}
            </div>

            <div class="mt-controls">
                <label class="mt-control">
                    Sort
                    <select class="mt-select" value={sortKey}
                        onChange={e => setSortKey(e.target.value)}>
                        {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                </label>
                <button class="mt-btn" title={sortDesc ? "Descending" : "Ascending"}
                    onClick={() => setSortDesc(v => !v)}>
                    {sortDesc ? "↓" : "↑"}
                </button>
                <label class="mt-control">
                    Collection
                    <select class="mt-select" value={collectionFilter}
                        onChange={e => setCollectionFilter(e.target.value)}>
                        <option value="all">All</option>
                        {collections.map(name => <option key={name} value={name}>{name}</option>)}
                        <option value={UNTAGGED}>{UNTAGGED}</option>
                    </select>
                </label>
                <button class={`mt-chip ${grouped ? "mt-chip-on" : ""}`}
                    title="Group rows under their collections"
                    onClick={() => setGrouped(v => !v)}>
                    Group by collection
                </button>
            </div>

            <div class="mt-filters">
                <button class={`mt-chip ${filter === "all" ? "mt-chip-on" : ""}`}
                    onClick={() => setFilter("all")}>All ({scoped.length})</button>
                {Object.entries(STATUS_LABELS).map(([value, label]) => {
                    const count = scoped.filter(t => t.status === value).length
                    return (
                        <button key={value}
                            class={`mt-chip ${filter === value ? `mt-chip-on mt-status-${value}` : ""}`}
                            onClick={() => setFilter(value)}>{label} ({count})</button>
                    )
                })}
            </div>

            {error && <p class="mt-error">{error}</p>}
            {loading && <p class="mt-hint">Loading...</p>}
            {!loading && !error && shown.length === 0 && (
                <p class="mt-hint">
                    {titles.length === 0
                        ? "Nothing here yet. Use the Add tab to search for something."
                        : "No titles match these filters."}
                </p>
            )}
            {/* Autocomplete source for every row's collection editor. */}
            <datalist id="mt-collection-options">
                {collections.map(name => <option key={name} value={name} />)}
            </datalist>

            {groups
                ? groups.map(([name, rows]) => (
                    <div class="mt-group" key={name}>
                        <div class="mt-group-head">
                            {name} <span class="mt-hint">({rows.length})</span>
                        </div>
                        {rows.map(title => (
                            <TitleRow
                                // Keyed by group too: a title in several collections
                                // renders once per group, so the key must be unique.
                                key={`${name}:${title.key}`}
                                title={title}
                                onChanged={reload}
                                expanded={expandedKey === title.key}
                                onToggleEpisodes={t => setExpandedKey(expandedKey === t.key ? null : t.key)}
                            />
                        ))}
                    </div>
                ))
                : shown.map(title => (
                    <TitleRow
                        key={title.key}
                        title={title}
                        onChanged={reload}
                        expanded={expandedKey === title.key}
                        onToggleEpisodes={t => setExpandedKey(expandedKey === t.key ? null : t.key)}
                    />
                ))}
        </div>
    )
}

// --- add --------------------------------------------------------------------

function AddTab({ onAdded }) {
    const [query, setQuery] = useState("")
    const [searchType, setSearchType] = useState("all")
    const [results, setResults] = useState([])
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)

    const search = async (type = searchType) => {
        if (!query.trim()) return
        setBusy(true); setStatus(null)
        try {
            const { results } = await callBackend("search", { query, mediaType: type })
            setResults(results)
            if (results.length === 0) setStatus({ hint: "No matches." })
        } catch (e) {
            setStatus({ error: e.message })
        } finally {
            setBusy(false)
        }
    }

    // Switching type re-runs the search immediately, so the chips act as a live
    // filter rather than a setting you have to remember to apply.
    const pickType = (type) => {
        if (type === searchType) return
        setSearchType(type)
        if (query.trim()) search(type)
    }

    const add = async (result) => {
        setBusy(true); setStatus(null)
        try {
            const added = await callBackend("addTitle", { mediaType: result.mediaType, tmdbId: result.tmdbId })
            setStatus({ ok: added.existed ? `${added.title} is already tracked` : `Added ${added.title}` })
            await onAdded()
        } catch (e) {
            setStatus({ error: e.message })
        } finally {
            setBusy(false)
        }
    }

    return (
        <div>
            <div class="mt-search">
                <input
                    class="mt-input"
                    placeholder="Search movies and TV..."
                    value={query}
                    disabled={busy}
                    onInput={e => setQuery(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && search()}
                />
                <button class="mt-btn mt-btn-primary" disabled={busy} onClick={() => search()}>Search</button>
            </div>

            <div class="mt-filters">
                {[["all", "All"], ["movie", "Movies"], ["show", "TV"]].map(([value, label]) => (
                    <button key={value} class={`mt-chip ${searchType === value ? "mt-chip-on" : ""}`}
                        disabled={busy} onClick={() => pickType(value)}>{label}</button>
                ))}
            </div>

            {status?.ok && <p class="mt-ok">{status.ok}</p>}
            {status?.error && <p class="mt-error">{status.error}</p>}
            {status?.hint && <p class="mt-hint">{status.hint}</p>}
            {results.map(result => (
                <div class="mt-row" key={`${result.mediaType}-${result.tmdbId}`}>
                    {result.poster
                        ? <img class="mt-poster" src={result.poster} alt="" loading="lazy" />
                        : <div class="mt-poster mt-poster-empty" />}
                    <div class="mt-row-main">
                        <div class="mt-row-title">{result.title}</div>
                        <div class="mt-row-meta">
                            {result.year && <span>{result.year}</span>}
                            <span class="mt-badge">{result.mediaType === "show" ? "TV" : "Movie"}</span>
                        </div>
                        {result.overview && <p class="mt-overview">{result.overview}</p>}
                    </div>
                    <div class="mt-row-actions">
                        <button class="mt-btn" disabled={busy} onClick={() => add(result)}>Add</button>
                    </div>
                </div>
            ))}
        </div>
    )
}

// --- import -----------------------------------------------------------------

// navigator.clipboard is only available in a secure context, which a Trilium
// server reached over plain HTTP is not, so fall back to the old execCommand
// path rather than silently doing nothing.
async function copyText(text) {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text)
            return true
        }
    } catch (e) {
        // Fall through to the textarea fallback.
    }

    try {
        const field = document.createElement("textarea")
        field.value = text
        field.setAttribute("readonly", "")
        field.style.position = "fixed"
        field.style.opacity = "0"
        document.body.appendChild(field)
        field.select()
        const copied = document.execCommand("copy")
        document.body.removeChild(field)
        return copied
    } catch (e) {
        return false
    }
}

function CopyButton({ value, label = "Copy" }) {
    const [copied, setCopied] = useState(false)

    return (
        <button
            class="mt-btn"
            title={`Copy ${value}`}
            onClick={async () => {
                if (await copyText(value)) {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                }
            }}
        >
            {copied ? "Copied" : label}
        </button>
    )
}

function ImportTab({ settings, reloadSettings, onImported }) {
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)
    const [device, setDevice] = useState(null)

    const run = async (fn) => {
        setBusy(true); setStatus(null)
        try { await fn() } catch (e) { setStatus({ error: e.message }) } finally { setBusy(false) }
    }

    // Poll until the user approves the code in their browser, respecting the
    // interval Trakt asks for and backing off when it says to slow down.
    const startTraktAuth = () => run(async () => {
        const started = await callBackend("traktAuthStart")
        setDevice(started)

        // Open the activation page straight away. Popup blockers only allow this
        // because it descends from the Authorize click; if it's blocked anyway the
        // link below stays available, so nothing is lost.
        if (started.verificationUrl) {
            try {
                window.open(started.verificationUrl, "_blank", "noopener,noreferrer")
            } catch (e) {
                // Blocked or unavailable; the visible link covers it.
            }
        }

        let interval = (started.interval || 5) * 1000
        const deadline = Date.now() + (started.expiresIn || 600) * 1000

        while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, interval))
            const poll = await callBackend("traktAuthPoll", { deviceCode: started.deviceCode })
            if (poll.state === "authorized") {
                setDevice(null)
                setStatus({ ok: "Authorized with Trakt" })
                await reloadSettings()
                return
            }
            if (poll.state === "slow_down") interval *= 2
        }
        setDevice(null)
        throw new Error("Authorization timed out. Try again.")
    })

    const importFrom = (action, label) => run(async () => {
        const result = await callBackend(action)
        setStatus({ ok: `${label}: ${result.added} added, ${result.updated} updated` })
        await onImported()
    })

    const stremioLogin = () => run(async () => {
        await callBackend("stremioLogin")
        setStatus({ ok: "Logged in to Stremio" })
        await reloadSettings()
    })

    return (
        <div class="mt-import">
            <p class="mt-hint">
                Import is one-way. Titles and watch history are copied into Trilium;
                nothing is ever written back to Trakt or Stremio.
            </p>

            <div class="mt-source">
                <h4>Trakt</h4>
                {device ? (
                    <div class="mt-device">
                        <p>
                            A Trakt activation page should have opened. If it did not, go to{" "}
                            <a class="mt-link" href={device.verificationUrl}
                                target="_blank" rel="noopener noreferrer">
                                {device.verificationUrl}
                            </a>
                            {" "}and enter this code:
                        </p>
                        <div class="mt-code-row">
                            <code class="mt-code mt-selectable">{device.userCode}</code>
                            <CopyButton value={device.userCode} label="Copy code" />
                            <CopyButton value={device.verificationUrl} label="Copy link" />
                        </div>
                        <p class="mt-hint">Waiting for you to approve it...</p>
                    </div>
                ) : (
                    <div class="mt-toolbar">
                        <button class="mt-btn" disabled={busy} onClick={startTraktAuth}>
                            {settings.traktAccessToken ? "Re-authorize" : "Authorize"}
                        </button>
                        <button class="mt-btn mt-btn-primary"
                            disabled={busy || !settings.traktAccessToken}
                            onClick={() => importFrom("importTrakt", "Trakt")}>
                            Import from Trakt
                        </button>
                    </div>
                )}
            </div>

            <div class="mt-source">
                <h4>Stremio</h4>
                <div class="mt-toolbar">
                    <button class="mt-btn" disabled={busy} onClick={stremioLogin}>
                        {settings.stremioAuthKey ? "Re-login" : "Login"}
                    </button>
                    <button class="mt-btn mt-btn-primary"
                        disabled={busy || !settings.stremioAuthKey}
                        onClick={() => importFrom("importStremio", "Stremio")}>
                        Import from Stremio
                    </button>
                </div>
                <p class="mt-hint">
                    Stremio only records your current position per show, so episodes up to
                    that point are marked watched.
                </p>
            </div>

            {status?.ok && <p class="mt-ok">{status.ok}</p>}
            {status?.error && <p class="mt-error">{status.error}</p>}
        </div>
    )
}

// --- root -------------------------------------------------------------------

export default function MediaTracker() {
    const [settings, setSettings] = useState(null)
    const [tab, setTab] = useState("library")
    const [reloadKey, setReloadKey] = useState(0)
    const [settingsPageNoteId, setSettingsPageNoteId] = useState("")

    const readSettings = async () => {
        const schemaNoteId = await api.currentNote.getRelationValue("schemaNote")
        const settingsNoteId = await api.currentNote.getRelationValue("settingsNote")
        const configNoteId = (await api.getNote(settingsNoteId)).getRelationValue("configNote")
        return loadSettings(schemaNoteId, configNoteId)
    }

    const reloadSettings = useCallback(async () => setSettings(await readSettings()), [])

    useEffect(() => { reloadSettings() }, [reloadSettings])

    // The Settings render page, resolved once. Activating the settings *code*
    // note would open its source instead of the rendered form, so this points at
    // the render note wrapping it.
    useEffect(() => {
        (async () => {
            setSettingsPageNoteId(await api.currentNote.getRelationValue("settingsPageNote") || "")
        })()
    }, [])

    const refresh = useCallback(async () => setReloadKey(k => k + 1), [])

    // Where "Back" on the settings page returns to. The widget renders from both
    // the launcher and the library root, and `api.currentNote` is the code note
    // in either case (not the note being viewed), so the target is recorded here
    // rather than inferred over there.
    const openSettings = () => {
        try {
            sessionStorage.setItem("mediaTracker:returnTo", settings.libraryRootNoteId || "")
        } catch (e) {
            // sessionStorage can be unavailable; Back falls back to the launcher.
        }
        activateNote(settingsPageNoteId)
    }

    if (!settings) return <div class="mt-view">Loading...</div>

    return (
        <div class="mt-view">
            <div class="mt-tabs">
                {[["library", "Library"], ["add", "Add"], ["import", "Import"]].map(([key, label]) => (
                    <button key={key} class={`mt-tab ${tab === key ? "mt-tab-on" : ""}`}
                        onClick={() => setTab(key)}>{label}</button>
                ))}
                <button class="mt-tab mt-tab-right" title="Open settings"
                    disabled={!settingsPageNoteId} onClick={openSettings}>
                    Settings
                </button>
            </div>

            {tab === "library" && (
                <LibraryTab
                    key={reloadKey}
                    libraryRootNoteId={settings.libraryRootNoteId}
                />
            )}
            {tab === "add" && <AddTab onAdded={refresh} />}
            {tab === "import" && (
                <ImportTab settings={settings} reloadSettings={reloadSettings} onImported={refresh} />
            )}
        </div>
    )
}
