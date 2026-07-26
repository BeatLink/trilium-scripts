import { useState, useEffect, useCallback } from "trilium:preact"
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

// --- library ----------------------------------------------------------------

function TitleRow({ title, onChanged, onOpenEpisodes }) {
    const [busy, setBusy] = useState(false)

    const update = async (fn) => {
        setBusy(true)
        try { await fn(); await onChanged() } finally { setBusy(false) }
    }

    const watched = countEpisodes(parseEpisodes(title.watchedEpisodes))
    const total = Number(title.totalEpisodes) || 0

    return (
        <div class="mt-row">
            {title.poster
                ? <img class="mt-poster" src={title.poster} alt="" loading="lazy" />
                : <div class="mt-poster mt-poster-empty" />}
            <div class="mt-row-main">
                <div class="mt-row-title">{title.title}</div>
                <div class="mt-row-meta">
                    {title.year && <span>{title.year}</span>}
                    <span class="mt-badge">{title.mediaType === "show" ? "TV" : "Movie"}</span>
                    {title.mediaType === "show" && total > 0 && (
                        <span class="mt-progress">{watched}/{total} episodes</span>
                    )}
                </div>
            </div>
            <div class="mt-row-actions">
                <select
                    class="mt-select"
                    disabled={busy}
                    value={title.status || "planned"}
                    onChange={e => update(() =>
                        callBackend("setStatus", { key: title.key, status: e.target.value }))}
                >
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                    ))}
                </select>
                <input
                    class="mt-rating"
                    type="number" min="0" max="10" step="1"
                    placeholder="-"
                    disabled={busy}
                    value={title.rating ?? ""}
                    onChange={e => update(() =>
                        callBackend("setRating", { key: title.key, rating: e.target.value }))}
                />
                {title.mediaType === "show" && (
                    <button class="mt-btn" disabled={busy} onClick={() => onOpenEpisodes(title)}>
                        Episodes
                    </button>
                )}
                <button class="mt-btn" disabled={busy} title="Remove from library"
                    onClick={() => update(() => callBackend("removeTitle", { key: title.key }))}>
                    &times;
                </button>
            </div>
        </div>
    )
}

function EpisodePanel({ title, onClose, onChanged }) {
    const [details, setDetails] = useState(null)
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(false)
    const [watchedEpisodes, setWatchedEpisodes] = useState(title.watchedEpisodes || "")

    useEffect(() => {
        (async () => {
            try {
                if (!title.tmdbId) throw new Error("This show has no TMDB id, so its episode list is unknown.")
                setDetails(await callBackend("details", { mediaType: "show", tmdbId: title.tmdbId }))
            } catch (e) {
                setError(e.message)
            }
        })()
    }, [title.key])

    const toggle = async (season, episode, watched) => {
        setBusy(true)
        try {
            const result = await callBackend("setEpisode", {
                key: title.key, season, episode, watched: String(watched)
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
            <div class="mt-episodes-head">
                <strong>{title.title}</strong>
                <button class="mt-btn" onClick={onClose}>Close</button>
            </div>
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
    const [episodesFor, setEpisodesFor] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    const reload = useCallback(async () => {
        if (!libraryRootNoteId) { setTitles([]); setLoading(false); return }
        try {
            const { titles } = await callBackend("listTitles")
            setTitles(titles)
            setError(null)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [libraryRootNoteId])

    useEffect(() => { reload() }, [reload])

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

    // Type and text narrow the set first; the status chips then count within
    // that narrowed set, so the numbers always describe what a click would show.
    const needle = query.trim().toLowerCase()
    const scoped = titles.filter(t =>
        (typeFilter === "all" || t.mediaType === typeFilter) &&
        (!needle || t.title.toLowerCase().includes(needle))
    )
    const shown = filter === "all" ? scoped : scoped.filter(t => t.status === filter)

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
            </div>

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

            <div class="mt-filters">
                <button class={`mt-chip ${filter === "all" ? "mt-chip-on" : ""}`}
                    onClick={() => setFilter("all")}>All ({scoped.length})</button>
                {Object.entries(STATUS_LABELS).map(([value, label]) => {
                    const count = scoped.filter(t => t.status === value).length
                    return (
                        <button key={value} class={`mt-chip ${filter === value ? "mt-chip-on" : ""}`}
                            onClick={() => setFilter(value)}>{label} ({count})</button>
                    )
                })}
            </div>

            {episodesFor && (
                <EpisodePanel
                    title={titles.find(t => t.key === episodesFor.key) || episodesFor}
                    onClose={() => setEpisodesFor(null)}
                    onChanged={reload}
                />
            )}

            {error && <p class="mt-error">{error}</p>}
            {loading && <p class="mt-hint">Loading...</p>}
            {!loading && !error && shown.length === 0 && (
                <p class="mt-hint">
                    {titles.length === 0
                        ? "Nothing here yet. Use the Add tab to search for something."
                        : "No titles match these filters."}
                </p>
            )}
            {shown.map(title => (
                <TitleRow key={title.key} title={title} onChanged={reload} onOpenEpisodes={setEpisodesFor} />
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
                        <p>Go to <strong>{device.verificationUrl}</strong> and enter this code:</p>
                        <div class="mt-code">{device.userCode}</div>
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

    const readSettings = async () => {
        const schemaNoteId = await api.currentNote.getRelationValue("schemaNote")
        const settingsNoteId = await api.currentNote.getRelationValue("settingsNote")
        const configNoteId = (await api.getNote(settingsNoteId)).getRelationValue("configNote")
        return loadSettings(schemaNoteId, configNoteId)
    }

    const reloadSettings = useCallback(async () => setSettings(await readSettings()), [])

    useEffect(() => { reloadSettings() }, [reloadSettings])

    const refresh = useCallback(async () => setReloadKey(k => k + 1), [])

    if (!settings) return <div class="mt-view">Loading...</div>

    return (
        <div class="mt-view">
            <div class="mt-tabs">
                {[["library", "Library"], ["add", "Add"], ["import", "Import"]].map(([key, label]) => (
                    <button key={key} class={`mt-tab ${tab === key ? "mt-tab-on" : ""}`}
                        onClick={() => setTab(key)}>{label}</button>
                ))}
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
