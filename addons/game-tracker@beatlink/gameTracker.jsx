import { useState, useEffect, useCallback } from "trilium:preact"
import { activateNote } from "trilium:api"
import { loadSettings } from "libSettingsUI.jsx"

/*
 * game-tracker@beatlink — the widget.
 *
 * Three tabs:
 *   Library  - the tracked games, with status/rating/playtime controls
 *   Add      - IGDB search, adds a game to the database
 *   Import   - one-way import from Steam
 *
 * Every game lives in one JSON note ("Database") under the library root. The
 * backend owns all reads and writes of that document; this widget never parses
 * or writes it directly, so there is exactly one writer per operation.
 */

const ENDPOINT = "custom/gameTracker"

const STATUS_LABELS = {
    backlog: "Backlog",
    playing: "Playing",
    beaten: "Beaten",
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

// POST variant, for payloads too large for a URL. An IGDB export is a couple of
// hundred kilobytes of HTML, which no query string will carry.
async function postBackend(action, payload) {
    const res = await fetch(`${ENDPOINT}?action=${encodeURIComponent(action)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
    let body
    try { body = await res.json() } catch (e) { body = { error: `HTTP ${res.status}` } }
    if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`)
    return body
}

// --- collections and sorting ------------------------------------------------
// Mirrors of libGameTracker.js: this file runs in the frontend and can't
// require the backend module. Kept deliberately small; the backend owns the
// authoritative versions used when writing.

const UNTAGGED = "Untagged"

// Must match libGameTracker.js: the bucket for collections in no group.
const UNGROUPED = "Ungrouped"

// Per-group "not in any collection of this group". A sentinel rather than a real
// collection name, prefixed so it can't collide with one a user creates.
const NONE = "__none__"

const SORTS = [
    { key: "title", label: "A-Z" },
    { key: "lastPlayed", label: "Recently played" },
    { key: "year", label: "Release date" },
    { key: "rating", label: "Rating" },
    { key: "playtime", label: "Playtime" },
    { key: "addedAt", label: "Recently added" }
]

// Minutes in, human-readable hours out. Games are read in hours; "6531 minutes"
// means nothing at a glance.
function formatPlaytime(minutes) {
    const total = Number(minutes) || 0
    if (total <= 0) return ""
    if (total < 60) return `${total}m`
    const hours = Math.floor(total / 60)
    const rest = total % 60
    return rest ? `${hours}h ${rest}m` : `${hours}h`
}

function compareMissingLast(a, b) {
    const aMissing = a === "" || a === null || a === undefined
    const bMissing = b === "" || b === null || b === undefined
    if (aMissing && bMissing) return 0
    if (aMissing) return 1
    if (bMissing) return -1
    return 0
}

function sortGames(games, sortKey, descending) {
    const direction = descending ? -1 : 1
    const sorted = [...games]
    sorted.sort((x, y) => {
        let a
        let b
        switch (sortKey) {
            case "lastPlayed": a = x.lastPlayed; b = y.lastPlayed; break
            case "year": a = x.year; b = y.year; break
            case "rating": a = x.rating; b = y.rating; break
            case "addedAt": a = x.addedAt; b = y.addedAt; break
            // Zero playtime is "never played", which belongs with the other
            // missing values rather than at the bottom of a numeric sort.
            case "playtime": a = x.playtime || null; b = y.playtime || null; break
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

// Genres and platforms arrive from IGDB as display strings
// ("Role-playing (RPG), Adventure").
function gameHasValue(game, field, wanted) {
    const target = String(wanted || "").toLowerCase()
    return String(game[field] || "")
        .split(",")
        .map(g => g.trim().toLowerCase())
        .some(g => g === target)
}

// A game in several collections appears under each; those with none land in
// one trailing Untagged bucket.
function groupByCollection(games) {
    const groups = new Map()
    const untagged = []
    for (const game of games) {
        const names = game.collections || []
        if (!names.length) { untagged.push(game); continue }
        for (const name of names) {
            if (!groups.has(name)) groups.set(name, [])
            groups.get(name).push(game)
        }
    }
    const named = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    return untagged.length ? [...named, [UNTAGGED, untagged]] : named
}

// --- details page -----------------------------------------------------------

function DetailsPage({ game, onBack, onChanged, showGenres = true }) {
    const [data, setData] = useState(null)
    const [error, setError] = useState(null)

    useEffect(() => {
        (async () => {
            if (!game.igdbId) {
                setError("This game has no IGDB id, so there is nothing more to show. "
                    + "Run Refresh on the Library tab to try linking it.")
                return
            }
            try {
                setData(await callBackend("fullDetails", {
                    igdbId: game.igdbId,
                    key: game.key
                }))
            } catch (e) {
                setError(e.message)
            }
        })()
    }, [game.key])

    return (
        <div class="gt-details">
            <div class="gt-details-nav">
                <button class="gt-btn" onClick={onBack}>&lsaquo; Back to library</button>
            </div>

            {error && <p class="gt-error">{error}</p>}
            {!data && !error && <p class="gt-hint">Loading details...</p>}

            {data && (
                <>
                    <div class="gt-details-head">
                        {data.cover
                            ? <img class="gt-details-cover" src={data.cover} alt="" />
                            : <div class="gt-details-cover gt-cover-empty" />}
                        <div class="gt-details-meta">
                            <h2 class="gt-details-title">{data.title}</h2>
                            <div class="gt-row-meta">
                                {data.year && <span>{data.year}</span>}
                                {data.entry?.status && (
                                    <span class={`gt-badge gt-status-${data.entry.status}`}>
                                        {STATUS_LABELS[data.entry.status]}
                                    </span>
                                )}
                                {data.entry?.rating != null && <span>★ {data.entry.rating}/10</span>}
                                {data.entry?.playtime > 0 && (
                                    <span>{formatPlaytime(data.entry.playtime)} played</span>
                                )}
                                {/* IGDB's own aggregate, distinct from the user's
                                    rating and labelled so the two aren't confused. */}
                                {data.totalRating != null && data.totalRatingCount > 0 && (
                                    <span class="gt-hint">
                                        IGDB {Math.round(data.totalRating)}%
                                        {" "}({data.totalRatingCount})
                                    </span>
                                )}
                            </div>

                            {data.developers.length > 0 && (
                                <p class="gt-hint">
                                    <strong>Developer</strong> {data.developers.join(", ")}
                                </p>
                            )}
                            {data.publishers.length > 0 && (
                                <p class="gt-hint">
                                    <strong>Publisher</strong> {data.publishers.join(", ")}
                                </p>
                            )}
                            {showGenres && data.genres && <p class="gt-hint">{data.genres}</p>}
                            {data.platforms && (
                                <p class="gt-hint">{data.platforms}</p>
                            )}
                            {data.modes.length > 0 && (
                                <p class="gt-hint">{data.modes.join(" · ")}</p>
                            )}

                            {(data.entry?.collections || []).length > 0 && (
                                <div class="gt-row-meta">
                                    {data.entry.collections.map(name => (
                                        <span class="gt-tag" key={name}>{name}</span>
                                    ))}
                                </div>
                            )}

                            {data.summary && <p class="gt-overview-full">{data.summary}</p>}
                            {data.url && (
                                <p>
                                    <a class="gt-link" href={data.url}
                                        target="_blank" rel="noopener noreferrer">
                                        View on IGDB
                                    </a>
                                    {data.entry?.steamAppId && (
                                        <>
                                            {" · "}
                                            <a class="gt-link"
                                                href={`https://store.steampowered.com/app/${data.entry.steamAppId}/`}
                                                target="_blank" rel="noopener noreferrer">
                                                View on Steam
                                            </a>
                                        </>
                                    )}
                                </p>
                            )}
                        </div>
                    </div>

                    {data.storyline && (
                        <div class="gt-section">
                            <h4>Storyline</h4>
                            <p class="gt-overview-full">{data.storyline}</p>
                        </div>
                    )}

                    {data.screenshots.length > 0 && (
                        <div class="gt-section">
                            <h4>Screenshots</h4>
                            <div class="gt-shots">
                                {data.screenshots.map(src => (
                                    <img class="gt-shot" src={src} alt="" loading="lazy" key={src} />
                                ))}
                            </div>
                        </div>
                    )}

                    {data.similar.length > 0 && (
                        <div class="gt-section">
                            <h4>Similar games</h4>
                            <p class="gt-hint">{data.similar.map(g => g.name).join(" · ")}</p>
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

// --- library ----------------------------------------------------------------

function GameRow({
    game, onChanged, onOpenDetails,
    allCollections = [], collectionGroups = []
}) {
    const [busy, setBusy] = useState(false)
    const [editingTags, setEditingTags] = useState(false)
    // Local copy of this game's collections while the picker is open, so the
    // checkboxes respond instantly rather than waiting for a round trip.
    const [selected, setSelected] = useState(game.collections || [])
    const [newTag, setNewTag] = useState("")
    const [editingTime, setEditingTime] = useState(false)
    const [hours, setHours] = useState("")

    const update = async (fn) => {
        setBusy(true)
        try { await fn(); await onChanged() } finally { setBusy(false) }
    }

    // Each change saves immediately: with checkboxes there is no natural "submit",
    // and a picker holding unsaved state is easy to close and lose.
    const persist = async (names) => {
        setSelected(names)
        await update(() => callBackend("setCollections", {
            key: game.key, collections: names.join(",")
        }))
    }

    const toggleCollection = (name) => {
        persist(selected.includes(name)
            ? selected.filter(n => n !== name)
            : [...selected, name])
    }

    // Sections for the picker. Built from the group structure, with any collection
    // the backend hasn't grouped yet (including one just created here) appended to
    // UNGROUPED so it never disappears from the list mid-edit.
    const pickerGroups = (() => {
        const grouped = new Set(collectionGroups.flatMap(([, names]) => names))
        const leftovers = allCollections.filter(n => !grouped.has(n))
        const sections = collectionGroups.map(([group, names]) => [group, names])
        if (leftovers.length) {
            const other = sections.find(([group]) => group === UNGROUPED)
            if (other) other[1] = [...other[1], ...leftovers]
            else sections.push([UNGROUPED, leftovers])
        }
        return sections
    })()

    const addNewCollection = () => {
        const name = newTag.trim()
        if (!name) return
        setNewTag("")
        // Case-insensitive match so "soulslikes" doesn't create a twin.
        const existing = allCollections.find(n => n.toLowerCase() === name.toLowerCase())
        const chosen = existing || name
        if (selected.some(n => n.toLowerCase() === chosen.toLowerCase())) return
        persist([...selected, chosen])
    }

    const savePlaytime = () => {
        const value = hours.trim()
        if (value === "") { setEditingTime(false); return }
        setEditingTime(false)
        update(() => callBackend("setPlaytime", { key: game.key, hours: value }))
    }

    return (
        <div class="gt-item">
            <div class="gt-row">
                {game.cover
                    ? <img class="gt-cover" src={game.cover} alt="" loading="lazy" />
                    : <div class="gt-cover gt-cover-empty" />}
                <div class="gt-row-main">
                    <button class="gt-row-title gt-row-title-link"
                        title="Open details" onClick={() => onOpenDetails(game)}>
                        {game.title}
                    </button>
                    <div class="gt-row-meta">
                        {game.year && <span>{game.year}</span>}
                        {game.playtime > 0 && (
                            <span class="gt-playtime">{formatPlaytime(game.playtime)}</span>
                        )}
                        {game.lastPlayed && (
                            <span class="gt-hint">last played {game.lastPlayed}</span>
                        )}
                        {game.steamAppId && <span class="gt-badge">Steam</span>}
                        {(game.collections || []).map(name => (
                            <span class="gt-tag" key={name}>{name}</span>
                        ))}
                    </div>
                    {game.platforms && (
                        <div class="gt-hint gt-platforms">{game.platforms}</div>
                    )}
                    {editingTags ? (
                        <div class="gt-tag-picker">
                            {/* One labelled section per collection group, so Series,
                                Mood and the rest are edited separately rather than
                                as one undifferentiated list. Still checkboxes, not
                                dropdowns: a game can be in several collections
                                within the same group. */}
                            {pickerGroups.length > 0 ? (
                                <div class="gt-tag-groups">
                                    {pickerGroups.map(([group, names]) => (
                                        <div class="gt-tag-group" key={group}>
                                            <div class="gt-tag-group-head">{group}</div>
                                            <div class="gt-tag-list">
                                                {names.map(name => (
                                                    <label class="gt-tag-option" key={name}>
                                                        <input
                                                            type="checkbox"
                                                            disabled={busy}
                                                            checked={selected.includes(name)}
                                                            onChange={() => toggleCollection(name)}
                                                        />
                                                        {name}
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p class="gt-hint">No collections yet — create the first one below.</p>
                            )}
                            <div class="gt-tag-edit">
                                <input
                                    class="gt-input"
                                    placeholder="New collection, e.g. Soulslikes"
                                    value={newTag}
                                    autofocus
                                    disabled={busy}
                                    onInput={e => setNewTag(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === "Enter") addNewCollection()
                                        if (e.key === "Escape") setEditingTags(false)
                                    }}
                                />
                                <button class="gt-btn" disabled={busy || !newTag.trim()}
                                    onClick={addNewCollection}>Add</button>
                                <button class="gt-btn" disabled={busy}
                                    onClick={() => setEditingTags(false)}>Done</button>
                            </div>
                        </div>
                    ) : (
                        <button class="gt-linkbtn" disabled={busy}
                            onClick={() => {
                                setSelected(game.collections || [])
                                setNewTag("")
                                setEditingTags(true)
                            }}>
                            {(game.collections || []).length ? "Edit collections" : "+ Add to collection"}
                        </button>
                    )}
                </div>
                <div class="gt-row-actions">
                    <select
                        class={`gt-select gt-status-${game.status || "backlog"}`}
                        disabled={busy}
                        value={game.status || "backlog"}
                        onChange={e => update(() =>
                            callBackend("setStatus", { key: game.key, status: e.target.value }))}
                    >
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                        ))}
                    </select>
                    <label class="gt-rating-field" title="Your rating, 0-10. Leave blank for unrated.">
                        <span class="gt-rating-star" aria-hidden="true">★</span>
                        <input
                            class="gt-rating"
                            type="number" min="0" max="10" step="1"
                            placeholder="–"
                            aria-label="Rating out of 10"
                            disabled={busy}
                            value={game.rating ?? ""}
                            onChange={e => update(() =>
                                callBackend("setRating", { key: game.key, rating: e.target.value }))}
                        />
                    </label>
                    {/* Playtime is editable by hand so a game played off Steam
                        still carries a real number. Imports never lower it. */}
                    {editingTime ? (
                        <input
                            class="gt-rating gt-hours"
                            type="number" min="0" step="0.5"
                            aria-label="Playtime in hours"
                            autofocus
                            disabled={busy}
                            value={hours}
                            onInput={e => setHours(e.target.value)}
                            onBlur={savePlaytime}
                            onKeyDown={e => {
                                if (e.key === "Enter") savePlaytime()
                                if (e.key === "Escape") setEditingTime(false)
                            }}
                        />
                    ) : (
                        <button class="gt-btn" disabled={busy}
                            title="Set playtime in hours"
                            onClick={() => {
                                setHours(game.playtime ? String(Math.round(game.playtime / 6) / 10) : "")
                                setEditingTime(true)
                            }}>
                            {game.playtime > 0 ? formatPlaytime(game.playtime) : "＋ time"}
                        </button>
                    )}
                    <button class="gt-btn" disabled={busy} title="Remove from library"
                        onClick={() => update(() => callBackend("removeGame", { key: game.key }))}>
                        &times;
                    </button>
                </div>
            </div>
        </div>
    )
}

function LibraryTab({ libraryRootNoteId, settings }) {
    const [games, setGames] = useState([])
    // Filter and sort choices are seeded from the saved view state, so the
    // Library opens the way you left it. The search box is deliberately not
    // remembered -- a filter that silently hides most of the library on load
    // reads as data loss.
    const [filter, setFilter] = useState(settings.viewStatusFilter || "all")
    const [platformFilter, setPlatformFilter] = useState(settings.viewPlatformFilter || "all")
    const [query, setQuery] = useState("")
    const [refreshing, setRefreshing] = useState(false)
    const [refreshResult, setRefreshResult] = useState(null)
    const [collections, setCollections] = useState([])
    const [genres, setGenres] = useState([])
    const [platforms, setPlatforms] = useState([])
    const [genreFilter, setGenreFilter] = useState(settings.viewGenreFilter || "all")
    // [[groupName, [collectionName, ...]], ...] from the backend.
    const [collectionGroups, setCollectionGroups] = useState([])
    // One active collection per group, keyed by group name. Groups filter
    // independently and combine with AND.
    const [groupFilters, setGroupFilters] = useState(() => {
        try {
            return JSON.parse(settings.viewGroupFilters || "{}")
        } catch (e) {
            return {}
        }
    })
    // Key of the game whose details page is open, or null for the list.
    const [detailsKey, setDetailsKey] = useState(null)
    const [sortKey, setSortKey] = useState(settings.viewSortKey || "title")
    const [sortDesc, setSortDesc] = useState(!!settings.viewSortDesc)
    const [grouped, setGrouped] = useState(!!settings.viewGrouped)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    // Persist a changed control. Fire-and-forget: remembering a preference must
    // never block the UI or surface an error over the list.
    const rememberView = (fields) => {
        callBackend("saveViewState", fields).catch(() => {})
    }

    const reload = useCallback(async () => {
        if (!libraryRootNoteId) { setGames([]); setLoading(false); return }
        try {
            const listed = await callBackend("listGames")
            setGames(listed.games)
            setCollections(listed.collections || [])
            setCollectionGroups(listed.collectionGroups || [])
            setGenres(listed.genres || [])
            setPlatforms(listed.platforms || [])
            setError(null)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [libraryRootNoteId])

    useEffect(() => { reload() }, [reload])

    // Housekeeping sweep: refresh metadata/covers from IGDB and link any
    // Steam-only entries to their IGDB records, then reload the list.
    const refresh = async () => {
        setRefreshing(true)
        setRefreshResult(null)
        try {
            const r = await callBackend("refreshLibrary")
            const parts = [`${r.total} games checked`]
            if (r.metadataUpdated) parts.push(`${r.metadataUpdated} updated`)
            if (r.linked) parts.push(`${r.linked} linked to IGDB`)
            if (r.failed) parts.push(`${r.failed} lookup${r.failed === 1 ? "" : "s"} failed`)
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
            <div class="gt-empty">
                <p>No library root set.</p>
                <p class="gt-hint">
                    Pick a note on the <strong>Library Root</strong> tab in Settings. Every tracked
                    game is created under it, and that note becomes this tracker.
                </p>
                {/* If a root WAS chosen and this still appears, the widget and the
                    settings page are reading different config notes -- so show
                    what this widget actually loaded rather than leaving the user
                    to re-pick a root that is already set. */}
                <details class="gt-diag">
                    <summary class="gt-hint">Already picked one?</summary>
                    <p class="gt-hint">
                        This widget read its settings from config note{" "}
                        <code class="gt-code gt-selectable">{settings.__configNoteId || "unknown"}</code>{" "}
                        and found <code class="gt-code">libraryRootNoteId</code> empty.
                        If you did pick a root, the settings page saved it somewhere this widget is
                        not reading — reinstall or update game-tracker in TAM so both point at the
                        same config note.
                    </p>
                </details>
            </div>
        )
    }

    // The details page replaces the list. Resolved from the live games array so
    // it reflects edits made while it's open.
    const detailsGame = detailsKey ? games.find(g => g.key === detailsKey) : null
    if (detailsGame) {
        return (
            <DetailsPage
                game={detailsGame}
                onBack={() => setDetailsKey(null)}
                onChanged={reload}
                showGenres={settings.genresEnabled !== false}
            />
        )
    }

    // Platform, text, and collection narrow the set first; the status counts
    // then apply within that narrowed set, so the numbers always describe what a
    // click would show.
    const needle = query.trim().toLowerCase()
    // Each group's selection is an independent condition; a game must satisfy
    // every active one. Selecting nothing in a group means that group doesn't
    // constrain the list at all.
    const groupMembers = new Map(collectionGroups.map(([group, names]) => [group, names]))

    const matchesCollection = (g) => {
        const names = g.collections || []
        for (const [group, value] of Object.entries(groupFilters)) {
            if (!value || value === "all") continue
            if (value === NONE) {
                const members = groupMembers.get(group) || []
                if (names.some(n => members.includes(n))) return false
                continue
            }
            if (!names.includes(value)) return false
        }
        return true
    }
    // A genre filter left over from before genres were disabled must not keep
    // silently narrowing the library.
    const genresOff = settings.genresEnabled === false
    const matchesGenre = (g) => genresOff || genreFilter === "all" || gameHasValue(g, "genres", genreFilter)
    const matchesPlatform = (g) => platformFilter === "all" || gameHasValue(g, "platforms", platformFilter)

    const scoped = games.filter(g =>
        matchesPlatform(g) &&
        (!needle || g.title.toLowerCase().includes(needle)) &&
        matchesCollection(g) &&
        matchesGenre(g)
    )
    const filtered = filter === "all" ? scoped : scoped.filter(g => g.status === filter)
    const shown = sortGames(filtered, sortKey, sortDesc)
    const groups = grouped ? groupByCollection(shown) : null

    // Collection counts are scoped by platform and search but NOT by the
    // collection filter itself -- otherwise picking one would zero every other
    // count and you could never see where else to go.
    const collectionScope = games.filter(g =>
        matchesPlatform(g) &&
        (!needle || g.title.toLowerCase().includes(needle))
    )

    const pickGroup = (group, value) => {
        const next = { ...groupFilters, [group]: value }
        // Don't persist inert "all" entries; keeps the stored object small and
        // stops removed groups lingering in settings forever.
        if (value === "all") delete next[group]
        setGroupFilters(next)
        rememberView({ groupFilters: JSON.stringify(next) })
    }

    // The first real collection selected across all groups, for rename/remove.
    const activeCollection = Object.entries(groupFilters)
        .filter(([, value]) => value && value !== "all" && value !== NONE)
        .map(([, value]) => value)[0] || ""

    // Genre counts are scoped by platform, search, and collection -- but not by
    // the genre filter itself, so selecting one genre doesn't zero the others.
    const genreScope = games.filter(g =>
        matchesPlatform(g) &&
        (!needle || g.title.toLowerCase().includes(needle)) &&
        matchesCollection(g)
    )

    const pickGenre = (value) => {
        setGenreFilter(value)
        rememberView({ genreFilter: value })
    }

    // Collections are derived from the games that carry them, so removing one
    // means clearing it from every game -- there is no separate list to delete
    // from. Both actions sweep the whole library in one write.
    const renameCollection = async (from) => {
        const to = prompt(`Rename "${from}" to:`, from)
        if (to === null || !to.trim() || to.trim() === from) return
        await applyCollectionChange(from, to.trim(), `Renamed to ${to.trim()}`)
    }

    const deleteCollection = async (from) => {
        const count = games.filter(g => (g.collections || []).includes(from)).length
        if (!confirm(
            `Remove the collection "${from}" from ${count} game${count === 1 ? "" : "s"}?\n\n`
            + `The games themselves are kept — only this tag is removed.`
        )) return
        await applyCollectionChange(from, "", `Removed ${from}`)
    }

    const applyCollectionChange = async (from, to, okMessage) => {
        setRefreshing(true)
        try {
            await callBackend("renameCollection", { from, to })
            // Any group still selecting the old name would point at a collection
            // that no longer exists, so retarget or clear it.
            const next = { ...groupFilters }
            let touched = false
            for (const [group, value] of Object.entries(next)) {
                if (value !== from) continue
                touched = true
                if (to) next[group] = to
                else delete next[group]
            }
            if (touched) {
                setGroupFilters(next)
                rememberView({ groupFilters: JSON.stringify(next) })
            }
            setRefreshResult(okMessage)
            await reload()
        } catch (e) {
            setError(e.message)
        } finally {
            setRefreshing(false)
        }
    }

    // Total time across whatever is currently shown, so filtering to a series or
    // a year answers "how long did I spend on this" directly.
    const totalMinutes = shown.reduce((sum, g) => sum + (Number(g.playtime) || 0), 0)

    return (
        <div>
            <div class="gt-search">
                <input
                    class="gt-input"
                    type="search"
                    placeholder="Filter library by title..."
                    value={query}
                    onInput={e => setQuery(e.target.value)}
                />
                <button class="gt-btn" disabled={refreshing}
                    title="Refresh metadata and covers from IGDB, and link Steam-only games to their IGDB records"
                    onClick={refresh}>
                    {refreshing ? "Refreshing..." : "Refresh"}
                </button>
            </div>
            {refreshResult && <p class="gt-ok">{refreshResult}</p>}

            {/* Counts live in the option labels so a dropdown still says how many
                rows each choice would show. Each list is scoped by the filters
                that precede it but never by itself, so selecting one option never
                zeroes the others. */}
            <div class="gt-controls">
                <label class="gt-control">
                    Status
                    {/* The colour follows the selection, so the dropdown itself
                        shows the status palette rather than only the options. */}
                    <select class={`gt-select ${filter === "all" ? "" : `gt-status-${filter}`}`} value={filter}
                        onChange={e => { setFilter(e.target.value); rememberView({ statusFilter: e.target.value }) }}>
                        <option value="all">All ({scoped.length})</option>
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                                {label} ({scoped.filter(g => g.status === value).length})
                            </option>
                        ))}
                    </select>
                </label>

                {platforms.length > 0 && (
                    <label class="gt-control">
                        Platform
                        <select class="gt-select" value={platformFilter}
                            onChange={e => {
                                setPlatformFilter(e.target.value)
                                rememberView({ platformFilter: e.target.value })
                            }}>
                            <option value="all">All ({games.length})</option>
                            {platforms.map(name => (
                                <option key={name} value={name}>
                                    {name} ({games.filter(g => gameHasValue(g, "platforms", name)).length})
                                </option>
                            ))}
                        </select>
                    </label>
                )}

                {/* One dropdown per collection group, titled after the group.
                    Groups are defined on the Collections tab in Settings;
                    collections with no group land in "Ungrouped". */}
                {collectionGroups.map(([group, names]) => {
                    const selected = groupFilters[group] || "all"
                    // Games in none of this group's collections.
                    const noneCount = collectionScope.filter(g =>
                        !(g.collections || []).some(n => names.includes(n))).length
                    return (
                        <label class="gt-control" key={group}>
                            {group}
                            <select class="gt-select" value={selected}
                                onChange={e => pickGroup(group, e.target.value)}>
                                <option value="all">All ({collectionScope.length})</option>
                                {names.map(name => (
                                    <option key={name} value={name}>
                                        {name} ({collectionScope.filter(g =>
                                            (g.collections || []).includes(name)).length})
                                    </option>
                                ))}
                                {noneCount > 0 && (
                                    <option value={NONE}>None ({noneCount})</option>
                                )}
                            </select>
                        </label>
                    )
                })}

                {/* Rename/remove act on whichever collection is currently selected
                    in any group. */}
                {activeCollection && (
                    <span class="gt-chip-group">
                        <button class="gt-btn gt-chip-action" disabled={refreshing}
                            title={`Rename "${activeCollection}" everywhere`}
                            onClick={() => renameCollection(activeCollection)}>✎</button>
                        <button class="gt-btn gt-chip-action" disabled={refreshing}
                            title={`Remove "${activeCollection}" from all games`}
                            onClick={() => deleteCollection(activeCollection)}>×</button>
                    </span>
                )}

                {genres.length > 0 && (
                    <label class="gt-control">
                        Genre
                        <select class="gt-select" value={genreFilter}
                            onChange={e => pickGenre(e.target.value)}>
                            <option value="all">All ({genreScope.length})</option>
                            {genres.map(name => (
                                <option key={name} value={name}>
                                    {name} ({genreScope.filter(g => gameHasValue(g, "genres", name)).length})
                                </option>
                            ))}
                        </select>
                    </label>
                )}
            </div>

            <div class="gt-controls">
                <label class="gt-control">
                    Sort
                    <select class="gt-select" value={sortKey}
                        onChange={e => { setSortKey(e.target.value); rememberView({ sortKey: e.target.value }) }}>
                        {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                </label>
                <button class="gt-btn" title={sortDesc ? "Descending" : "Ascending"}
                    onClick={() => { const next = !sortDesc; setSortDesc(next); rememberView({ sortDesc: String(next) }) }}>
                    {sortDesc ? "↓" : "↑"}
                </button>
                <button class={`gt-chip ${grouped ? "gt-chip-on" : ""}`}
                    title="Group rows under their collections"
                    onClick={() => { const next = !grouped; setGrouped(next); rememberView({ grouped: String(next) }) }}>
                    Group by collection
                </button>
                {totalMinutes > 0 && (
                    <span class="gt-hint gt-total">
                        {formatPlaytime(totalMinutes)} across {shown.length} game{shown.length === 1 ? "" : "s"}
                    </span>
                )}
            </div>

            {error && <p class="gt-error">{error}</p>}
            {loading && <p class="gt-hint">Loading...</p>}
            {!loading && !error && shown.length === 0 && (
                <p class="gt-hint">
                    {games.length === 0
                        ? "Nothing here yet. Use the Add tab to search for a game, or import your Steam library."
                        : "No games match these filters."}
                </p>
            )}
            {groups
                ? groups.map(([name, rows]) => (
                    <div class="gt-group" key={name}>
                        <div class="gt-group-head">
                            {name} <span class="gt-hint">({rows.length})</span>
                        </div>
                        {rows.map(game => (
                            <GameRow
                                // Keyed by group too: a game in several collections
                                // renders once per group, so the key must be unique.
                                key={`${name}:${game.key}`}
                                game={game}
                                onChanged={reload}
                                onOpenDetails={g => setDetailsKey(g.key)}
                                allCollections={collections}
                                collectionGroups={collectionGroups}
                            />
                        ))}
                    </div>
                ))
                : shown.map(game => (
                    <GameRow
                        key={game.key}
                        game={game}
                        onChanged={reload}
                        onOpenDetails={g => setDetailsKey(g.key)}
                        allCollections={collections}
                        collectionGroups={collectionGroups}
                    />
                ))}
        </div>
    )
}

// --- add --------------------------------------------------------------------

function AddTab({ onAdded }) {
    const [query, setQuery] = useState("")
    const [results, setResults] = useState([])
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)

    // A pasted IGDB or Steam link identifies one exact game, so it's added
    // directly instead of being fed to search as text (which would find nothing).
    const looksLikeLink = /igdb\.com\/games\/|steampowered\.com\/app\/\d+|steamcommunity\.com\/app\/\d+|^\s*\d{2,8}\s*$/i
        .test(query)

    const addByLink = async () => {
        setBusy(true); setStatus(null)
        try {
            const added = await callBackend("addFromLink", { url: query })
            setStatus({
                ok: added.existed
                    ? `${added.title} is already tracked`
                    : `Added ${added.title}`
            })
            setResults([])
            setQuery("")
            await onAdded()
        } catch (e) {
            setStatus({ error: e.message })
        } finally {
            setBusy(false)
        }
    }

    const search = async () => {
        if (!query.trim()) return
        if (looksLikeLink) return addByLink()
        setBusy(true); setStatus(null)
        try {
            const { results } = await callBackend("search", { query })
            setResults(results)
            if (results.length === 0) setStatus({ hint: "No matches." })
        } catch (e) {
            setStatus({ error: e.message })
        } finally {
            setBusy(false)
        }
    }

    const add = async (result) => {
        setBusy(true); setStatus(null)
        try {
            const added = await callBackend("addGame", { igdbId: result.igdbId })
            setStatus({ ok: added.existed ? `${added.title} is already tracked` : `Added ${added.title}` })
            // Flip this row to "Added" in place, so the state is visible without
            // having to run the search again.
            setResults(rows => rows.map(row =>
                row.igdbId === result.igdbId
                    ? { ...row, trackedKey: added.key || "added" }
                    : row
            ))
            await onAdded()
        } catch (e) {
            setStatus({ error: e.message })
        } finally {
            setBusy(false)
        }
    }

    return (
        <div>
            <div class="gt-search">
                <input
                    class="gt-input"
                    placeholder="Search, or paste an IGDB / Steam link..."
                    value={query}
                    disabled={busy}
                    onInput={e => setQuery(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && search()}
                />
                <button class="gt-btn gt-btn-primary" disabled={busy} onClick={search}>
                    {looksLikeLink ? "Add" : "Search"}
                </button>
            </div>

            {looksLikeLink && (
                <p class="gt-hint">Link detected — this will add that exact game.</p>
            )}

            {status?.ok && <p class="gt-ok">{status.ok}</p>}
            {status?.error && <p class="gt-error">{status.error}</p>}
            {status?.hint && <p class="gt-hint">{status.hint}</p>}
            {results.map(result => (
                <div class="gt-row" key={result.igdbId}>
                    {result.cover
                        ? <img class="gt-cover" src={result.cover} alt="" loading="lazy" />
                        : <div class="gt-cover gt-cover-empty" />}
                    <div class="gt-row-main">
                        <div class="gt-row-title">{result.title}</div>
                        <div class="gt-row-meta">
                            {result.year && <span>{result.year}</span>}
                            {result.genres && <span class="gt-hint">{result.genres}</span>}
                        </div>
                        {result.platforms && <div class="gt-hint gt-platforms">{result.platforms}</div>}
                        {result.summary && <p class="gt-overview">{result.summary}</p>}
                    </div>
                    <div class="gt-row-actions">
                        {result.trackedKey ? (
                            <span class="gt-btn gt-added" title="Already in your library">
                                ✓ Added
                            </span>
                        ) : (
                            <button class="gt-btn" disabled={busy} onClick={() => add(result)}>Add</button>
                        )}
                    </div>
                </div>
            ))}
        </div>
    )
}

// --- import -----------------------------------------------------------------

// Import a library file: IGDB's GDPR export, or any CSV/JSON list of games.
//
// Two steps on purpose. A file carrying only titles has to be matched against
// the metadata provider by name, and name matching is a guess -- so the preview
// shows exactly what matched, what didn't, and what is already tracked, and
// nothing is written until the user confirms.
function FileImportPanel({ settings, onImported }) {
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)
    const [preview, setPreview] = useState(null)
    const [filename, setFilename] = useState("")
    const [asCollections, setAsCollections] = useState(true)
    const [showUnmatched, setShowUnmatched] = useState(false)

    const providerLabel = settings.metadataProvider === "rawg" ? "RAWG" : "IGDB"

    const readFile = async (file) => {
        if (!file) return
        setBusy(true)
        setStatus(null)
        setPreview(null)
        setFilename(file.name)
        try {
            const text = await file.text()
            setStatus({ hint: `Matching titles against ${providerLabel}...` })
            const result = await postBackend("previewImport", { text, filename: file.name })
            setPreview(result)
            setStatus(null)
        } catch (e) {
            setStatus({ error: e.message })
        } finally {
            setBusy(false)
        }
    }

    const apply = async () => {
        setBusy(true)
        setStatus(null)
        try {
            // Only matched rows are sent: an unmatched row has no id to key on,
            // so there is nothing to write.
            const rows = preview.rows.filter(r => r.matched)
            const result = await postBackend("importFile", {
                rows,
                listsAsCollections: String(asCollections)
            })
            setStatus({ ok: `Imported: ${result.added} added, ${result.updated} updated.` })
            setPreview(null)
            setFilename("")
            await onImported()
        } catch (e) {
            setStatus({ error: e.message })
        } finally {
            setBusy(false)
        }
    }

    const unmatched = preview?.rows.filter(r => !r.matched) || []

    return (
        <div class="gt-source">
            <h4>Import from a file</h4>
            <p class="gt-hint">
                Accepts an <strong>IGDB data export</strong> (the <code>index.html</code> inside the
                ZIP IGDB emails you), or any CSV/JSON list of games with a title column. Nothing is
                written until you review what matched.
            </p>

            <div class="gt-toolbar">
                <label class="gt-btn gt-file-label">
                    Choose file
                    <input
                        class="gt-file-input"
                        type="file"
                        accept=".html,.htm,.csv,.json,.txt"
                        disabled={busy}
                        onChange={e => readFile(e.target.files?.[0])}
                    />
                </label>
                {filename && <span class="gt-hint">{filename}</span>}
            </div>

            {status?.hint && <p class="gt-hint">{status.hint}</p>}

            {preview && (
                <div class="gt-preview">
                    <p class="gt-hint">
                        Found <strong>{preview.total}</strong> games
                        {preview.format === "igdb-export" ? " in an IGDB export" : ""}.
                        {" "}<strong>{preview.matchedCount}</strong> matched on {providerLabel},
                        {" "}<strong>{preview.unmatchedCount}</strong> did not
                        {preview.existingCount > 0 && (
                            <>, and <strong>{preview.existingCount}</strong> are already tracked</>
                        )}.
                    </p>

                    {preview.lists.length > 0 && (
                        <p class="gt-hint">
                            Lists: {preview.lists.map(l => `${l.name} (${l.count})`).join(" · ")}
                        </p>
                    )}

                    {preview.lists.length > 0 && (
                        <label class="gt-tag-option">
                            <input
                                type="checkbox"
                                checked={asCollections}
                                disabled={busy}
                                onChange={e => setAsCollections(e.target.checked)}
                            />
                            File each game under its list as a collection
                        </label>
                    )}

                    {unmatched.length > 0 && (
                        <>
                            <button class="gt-linkbtn"
                                onClick={() => setShowUnmatched(!showUnmatched)}>
                                {showUnmatched ? "Hide" : "Show"} the {unmatched.length} unmatched
                            </button>
                            {showUnmatched && (
                                <div class="gt-unmatched">
                                    {unmatched.map(r => (
                                        <div class="gt-hint" key={r.title}>{r.title}</div>
                                    ))}
                                </div>
                            )}
                            <p class="gt-hint">
                                Unmatched games are skipped. They are usually titles {providerLabel} spells
                                differently, or does not have at all — add those by hand from the Add tab.
                            </p>
                        </>
                    )}

                    <div class="gt-toolbar">
                        <button class="gt-btn gt-btn-primary"
                            disabled={busy || !preview.matchedCount}
                            onClick={apply}>
                            Import {preview.matchedCount} games
                        </button>
                        <button class="gt-btn" disabled={busy}
                            onClick={() => { setPreview(null); setFilename("") }}>
                            Cancel
                        </button>
                    </div>

                    <div class="gt-preview-list">
                        {preview.rows.filter(r => r.matched).slice(0, 40).map(r => (
                            <div class="gt-preview-row" key={r.title + r.igdbId}>
                                {r.cover
                                    ? <img class="gt-preview-cover" src={r.cover} alt="" loading="lazy" />
                                    : <div class="gt-preview-cover gt-cover-empty" />}
                                <span class="gt-preview-title">
                                    {r.title}
                                    {/* The provider's own spelling, when it differs
                                        from the file's -- so a wrong match is
                                        visible before it is written. */}
                                    {r.matchedTitle && r.matchedTitle !== r.title && (
                                        <span class="gt-hint"> → {r.matchedTitle}</span>
                                    )}
                                </span>
                                {r.status && (
                                    <span class={`gt-badge gt-status-${r.status}`}>
                                        {STATUS_LABELS[r.status]}
                                    </span>
                                )}
                                {r.existingKey && <span class="gt-hint">already tracked</span>}
                            </div>
                        ))}
                        {preview.matchedCount > 40 && (
                            <div class="gt-hint">…and {preview.matchedCount - 40} more.</div>
                        )}
                    </div>
                </div>
            )}

            {status?.ok && <p class="gt-ok">{status.ok}</p>}
            {status?.error && <p class="gt-error">{status.error}</p>}
        </div>
    )
}

function ImportTab({ settings, reloadSettings, onImported }) {
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)
    const [check, setCheck] = useState(null)

    const run = async (fn) => {
        setBusy(true); setStatus(null)
        try { await fn() } catch (e) { setStatus({ error: e.message }) } finally { setBusy(false) }
    }

    const verify = () => run(async () => {
        const r = await callBackend("steamCheck")
        setCheck(r)
        setStatus({ ok: `Steam looks good: ${r.total} games owned, ${r.played} played.` })
    })

    const importSteam = () => run(async () => {
        const result = await callBackend("importSteam")
        setStatus({ ok: `Steam: ${result.added} added, ${result.updated} updated` })
        await onImported()
    })

    const ready = !!settings.steamApiKey && !!settings.steamId
    const providerLabel = settings.metadataProvider === "rawg" ? "RAWG" : "IGDB"

    const checkProvider = () => run(async () => {
        const r = await callBackend("providerCheck")
        setStatus({ ok: `${r.provider} is working${r.sample ? ` (sample: ${r.sample})` : ""}.` })
    })

    return (
        <div class="gt-import">
            <p class="gt-hint">
                Import is one-way. Games and playtime are copied into Trilium; nothing is ever
                written back to Steam, IGDB, or RAWG.
            </p>

            <div class="gt-source">
                <h4>Metadata provider</h4>
                <p class="gt-hint">
                    Currently using <strong>{providerLabel}</strong> for covers, genres, and
                    platforms. Change this on the Provider tab in Settings.
                </p>
                <button class="gt-btn" disabled={busy} onClick={checkProvider}>
                    Check {providerLabel} connection
                </button>
            </div>

            <FileImportPanel settings={settings} onImported={onImported} />

            {/* Scheduled imports run in the background, so their outcome would
                otherwise be invisible. */}
            {settings.autoSyncLastResult && (
                <p class="gt-hint">
                    Last automatic import — {settings.autoSyncLastResult}
                </p>
            )}

            <div class="gt-source">
                <h4>Steam</h4>
                {!ready && (
                    <p class="gt-hint">
                        Set a <strong>Steam Web API key</strong> and your <strong>SteamID64</strong> on
                        the Steam tab in Settings first. The key is free from{" "}
                        <a class="gt-link" href="https://steamcommunity.com/dev/apikey"
                            target="_blank" rel="noopener noreferrer">
                            steamcommunity.com/dev/apikey
                        </a>.
                    </p>
                )}
                <div class="gt-toolbar">
                    <button class="gt-btn" disabled={busy || !ready} onClick={verify}>
                        Check connection
                    </button>
                    <button class="gt-btn gt-btn-primary" disabled={busy || !ready}
                        onClick={importSteam}>
                        Import from Steam
                    </button>
                </div>
                {check && (
                    <p class="gt-hint">
                        {check.total} games owned · {check.played} with playtime.
                        {settings.steamOnlyPlayed
                            ? " Only played games will be imported (change this in Settings)."
                            : " All owned games will be imported."}
                    </p>
                )}
                <p class="gt-hint">
                    Steam supplies the appid and total playtime; IGDB supplies covers, genres, and
                    platforms. A game IGDB has never heard of is still imported with the name and
                    playtime Steam gave it.
                </p>
                <p class="gt-hint">
                    Your Steam profile's <strong>Game details</strong> privacy must be set to Public,
                    otherwise Steam returns an empty list regardless of the API key.
                </p>
            </div>

            {status?.ok && <p class="gt-ok">{status.ok}</p>}
            {status?.error && <p class="gt-error">{status.error}</p>}
        </div>
    )
}

// --- root -------------------------------------------------------------------

export default function GameTracker() {
    const [settings, setSettings] = useState(null)
    const [tab, setTab] = useState("library")
    const [reloadKey, setReloadKey] = useState(0)
    const [settingsPageNoteId, setSettingsPageNoteId] = useState("")
    // Why settings could not be resolved, if they couldn't. Distinct from
    // `settings` being null (still loading) and from a loaded-but-empty config.
    const [wiringError, setWiringError] = useState("")

    // Resolve the schema and config notes from this widget's own relations.
    //
    // Every failure here is reported rather than swallowed. loadSettings falls
    // back to schema defaults when given a bad id, and the default for
    // libraryRootNoteId is "" -- which renders as "No library root set" even
    // when a root IS saved in the config note. That makes a wiring problem look
    // exactly like an unset setting, so the two are separated explicitly.
    //
    // The usual cause is TAM: it renames activation attributes to
    // `disabled:<name>` while an addon is disabled, so a widget rendered from a
    // disabled addon finds no `schemaNote`/`settingsNote` at all.
    const readSettings = async () => {
        const schemaNoteId = await api.currentNote.getRelationValue("schemaNote")
            || await api.currentNote.getRelationValue("disabled:schemaNote")
        const settingsNoteId = await api.currentNote.getRelationValue("settingsNote")
            || await api.currentNote.getRelationValue("disabled:settingsNote")

        if (!schemaNoteId || !settingsNoteId) {
            throw new Error(
                "This widget's schemaNote/settingsNote relations are missing. That normally means "
                + "game-tracker is installed but not enabled in TAM — enable it, then reload."
            )
        }

        const settingsNote = await api.getNote(settingsNoteId)
        if (!settingsNote) {
            throw new Error("The settings note this widget points at no longer exists. "
                + "Reinstall or update game-tracker in TAM.")
        }

        const configNoteId = settingsNote.getRelationValue("configNote")
            || settingsNote.getRelationValue("disabled:configNote")
        if (!configNoteId) {
            throw new Error("The settings note has no configNote relation, so there is nowhere "
                + "to read saved settings from. Reinstall or update game-tracker in TAM.")
        }

        const values = await loadSettings(schemaNoteId, configNoteId)
        // Stamped on so the library view can name the note it actually read,
        // which is the one thing that distinguishes "not set" from "set, but
        // saved somewhere this widget isn't looking".
        return { ...values, __configNoteId: configNoteId }
    }

    const reloadSettings = useCallback(async () => {
        try {
            setSettings(await readSettings())
            setWiringError("")
        } catch (e) {
            setWiringError(e.message)
        }
    }, [])

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
            sessionStorage.setItem("gameTracker:returnTo", settings.libraryRootNoteId || "")
        } catch (e) {
            // sessionStorage can be unavailable; Back falls back to the launcher.
        }
        activateNote(settingsPageNoteId)
    }

    // A wiring failure is shown as itself, rather than falling through to the
    // library's "no library root set" message -- which would send the user off
    // to set a root they have very likely already set.
    if (wiringError) {
        return (
            <div class="gt-view">
                <p class="gt-error">Game Tracker could not read its settings.</p>
                <p class="gt-hint">{wiringError}</p>
                <button class="gt-btn" onClick={reloadSettings}>Retry</button>
            </div>
        )
    }

    if (!settings) return <div class="gt-view">Loading...</div>

    return (
        <div class="gt-view">
            <div class="gt-tabs">
                {[["library", "Library"], ["add", "Add"], ["import", "Import"]].map(([key, label]) => (
                    <button key={key} class={`gt-tab ${tab === key ? "gt-tab-on" : ""}`}
                        onClick={() => setTab(key)}>{label}</button>
                ))}
                <button class="gt-tab gt-tab-right" title="Open settings"
                    disabled={!settingsPageNoteId} onClick={openSettings}>
                    Settings
                </button>
            </div>

            {tab === "library" && (
                <LibraryTab
                    key={reloadKey}
                    libraryRootNoteId={settings.libraryRootNoteId}
                    settings={settings}
                />
            )}
            {tab === "add" && <AddTab onAdded={refresh} />}
            {tab === "import" && (
                <ImportTab settings={settings} reloadSettings={reloadSettings} onImported={refresh} />
            )}
        </div>
    )
}
