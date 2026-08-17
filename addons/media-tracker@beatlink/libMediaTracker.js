/*
 * media-tracker@beatlink data model.
 *
 * Every tracked title lives in ONE JSON document, stored in a code note titled
 * "Database" that is a direct child of the configured Library Root. Keeping the
 * database under the root (rather than in the addon's own persistence tree)
 * means the data travels with the library: move or export the root and the
 * titles come along.
 *
 *   {
 *     "titles": {
 *       "<key>": {
 *         id, tmdbId, imdbId, traktId,
 *         mediaType: "movie" | "show",
 *         title, year, overview, poster, genres, runtime,
 *         status: "planned" | "watching" | "watched" | "dropped",
 *         rating: 0..10 | null,
 *         lastWatched: "YYYY-MM-DD" | "",
 *         watchedEpisodes: "s01e01-e10,s02e01",   // shows only
 *         totalEpisodes: number,
 *         addedAt: "YYYY-MM-DD",
 *         collections: ["Marvel Cinematic Universe", "Phase Four"]  // tags, set by hand
 *       }
 *     }
 *   }
 *
 * `key` is the title's stable id (see titleKey): TMDB id when known, else the
 * IMDb id, else the Trakt id, else a generated local id. Keying by identity is
 * what makes repeated imports from different sources converge on one entry
 * instead of duplicating.
 *
 * Episode progress is a compact run-collapsed string rather than an array, so a
 * fully-watched ten-season show stays a short value:
 *
 *   s01e01-e10,s02e01,s02e03-e05
 *
 * parseEpisodes -> { [season]: Set(episodeNumbers) }, formatEpisodes is its
 * inverse and always emits canonical (sorted, run-collapsed) output.
 */

const STATUSES = ["planned", "watching", "watched", "dropped"]

const IMAGE_BASE = "https://image.tmdb.org/t/p/"

function posterUrl(posterPath, size) {
    if (!posterPath) return ""
    return `${IMAGE_BASE}${size || "w342"}${posterPath}`
}

// --- episode encoding -------------------------------------------------------

function parseEpisodes(encoded) {
    const seasons = {}
    if (!encoded || typeof encoded !== "string") return seasons
    for (const chunk of encoded.split(",")) {
        const part = chunk.trim()
        if (!part) continue
        const match = /^s(\d+)e(\d+)(?:-e(\d+))?$/i.exec(part)
        if (!match) continue
        const season = Number(match[1])
        const from = Number(match[2])
        const to = match[3] === undefined ? from : Number(match[3])
        if (!seasons[season]) seasons[season] = new Set()
        for (let n = Math.min(from, to); n <= Math.max(from, to); n++) seasons[season].add(n)
    }
    return seasons
}

function pad2(n) {
    return String(n).padStart(2, "0")
}

function formatEpisodes(seasons) {
    const parts = []
    for (const season of Object.keys(seasons).map(Number).sort((a, b) => a - b)) {
        const episodes = [...seasons[season]].filter(n => Number.isFinite(n)).sort((a, b) => a - b)
        let runStart = null
        let previous = null
        const flush = () => {
            if (runStart === null) return
            parts.push(runStart === previous
                ? `s${pad2(season)}e${pad2(runStart)}`
                : `s${pad2(season)}e${pad2(runStart)}-e${pad2(previous)}`)
        }
        for (const n of episodes) {
            if (previous !== null && n === previous + 1) { previous = n; continue }
            flush()
            runStart = n
            previous = n
        }
        flush()
    }
    return parts.join(",")
}

function countEpisodes(seasons) {
    return Object.values(seasons).reduce((total, set) => total + set.size, 0)
}

function hasEpisode(seasons, season, episode) {
    return !!seasons[season]?.has(episode)
}

function withEpisode(seasons, season, episode, watched) {
    const next = {}
    for (const [key, set] of Object.entries(seasons)) next[key] = new Set(set)
    if (watched) {
        if (!next[season]) next[season] = new Set()
        next[season].add(episode)
    } else if (next[season]) {
        next[season].delete(episode)
        if (next[season].size === 0) delete next[season]
    }
    return next
}

// Add or remove a whole run of episodes at once, e.g. "the rest of season 2" or
// "every episode of every season". `ranges` is [{ season, from, to }].
// Applied to a copy, so the caller's map is untouched.
function withEpisodeRanges(seasons, ranges, watched) {
    let next = seasons
    for (const range of ranges) {
        const season = Number(range.season)
        const from = Number(range.from)
        const to = Number(range.to)
        if (!Number.isFinite(season) || !Number.isFinite(from) || !Number.isFinite(to)) continue
        for (let n = Math.min(from, to); n <= Math.max(from, to); n++) {
            next = withEpisode(next, season, n, watched)
        }
    }
    return next
}

// Import is one-way and additive: an episode already marked watched locally is
// never un-watched by an import.
function mergeEpisodes(existing, incoming) {
    const merged = {}
    for (const [season, set] of Object.entries(existing)) merged[season] = new Set(set)
    for (const [season, set] of Object.entries(incoming)) {
        if (!merged[season]) merged[season] = new Set()
        for (const n of set) merged[season].add(n)
    }
    return merged
}

// First aired episode not yet watched, given TMDB's per-season counts.
function nextUnwatched(seasons, seasonCounts) {
    const numbers = Object.keys(seasonCounts || {}).map(Number).sort((a, b) => a - b)
    for (const season of numbers) {
        const aired = seasonCounts[season]
        for (let episode = 1; episode <= aired; episode++) {
            if (!hasEpisode(seasons, season, episode)) return { season, episode }
        }
    }
    return null
}

// --- status -----------------------------------------------------------------

function statusFromProgress(watchedCount, totalEpisodes) {
    if (!totalEpisodes) return watchedCount > 0 ? "watching" : "planned"
    if (watchedCount === 0) return "planned"
    return watchedCount >= totalEpisodes ? "watched" : "watching"
}

// --- document ---------------------------------------------------------------

function emptyDocument() {
    return { titles: {} }
}

// Tolerates a blank note, malformed JSON, or a document missing `titles`, so a
// hand-edited database can never hard-fail the widget.
function parseDocument(raw) {
    if (!raw || !String(raw).trim()) return emptyDocument()
    let parsed
    try {
        parsed = JSON.parse(raw)
    } catch (e) {
        return emptyDocument()
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyDocument()
    const titles = parsed.titles
    if (!titles || typeof titles !== "object" || Array.isArray(titles)) return emptyDocument()
    return { ...parsed, titles }
}

function serializeDocument(doc) {
    return JSON.stringify(doc, null, 4)
}

// Identity, strongest first: tmdb is primary (TMDB is the metadata source),
// imdb bridges sources (Stremio uses imdb ids), trakt last.
function titleKey(item) {
    if (item?.tmdbId) return `tmdb:${item.tmdbId}`
    if (item?.imdbId) return `imdb:${item.imdbId}`
    if (item?.traktId) return `trakt:${item.traktId}`
    return ""
}

// An entry already in the document that refers to the same title, matched on any
// shared id rather than only the key -- a title first imported from Stremio is
// keyed by imdb, and must still be found when Trakt later supplies its tmdb id.
function findTitle(doc, item) {
    const key = titleKey(item)
    if (key && doc.titles[key]) return key

    const wanted = {
        tmdbId: item?.tmdbId ? String(item.tmdbId) : "",
        imdbId: item?.imdbId ? String(item.imdbId) : "",
        traktId: item?.traktId ? String(item.traktId) : ""
    }
    for (const [existingKey, entry] of Object.entries(doc.titles)) {
        if (wanted.tmdbId && String(entry.tmdbId || "") === wanted.tmdbId) return existingKey
        if (wanted.imdbId && String(entry.imdbId || "") === wanted.imdbId) return existingKey
        if (wanted.traktId && String(entry.traktId || "") === wanted.traktId) return existingKey
    }
    return ""
}

function normalizeTitle(entry) {
    const rating = Number(entry?.rating)
    return {
        tmdbId: entry?.tmdbId ? String(entry.tmdbId) : "",
        imdbId: entry?.imdbId ? String(entry.imdbId) : "",
        traktId: entry?.traktId ? String(entry.traktId) : "",
        mediaType: entry?.mediaType === "show" ? "show" : "movie",
        title: typeof entry?.title === "string" ? entry.title : "",
        year: entry?.year ? String(entry.year) : "",
        overview: typeof entry?.overview === "string" ? entry.overview : "",
        poster: typeof entry?.poster === "string" ? entry.poster : "",
        genres: typeof entry?.genres === "string" ? entry.genres : "",
        runtime: Number.isFinite(Number(entry?.runtime)) ? Number(entry.runtime) : 0,
        status: STATUSES.includes(entry?.status) ? entry.status : "planned",
        rating: Number.isFinite(rating) && rating > 0 ? rating : null,
        lastWatched: typeof entry?.lastWatched === "string" ? entry.lastWatched : "",
        watchedEpisodes: typeof entry?.watchedEpisodes === "string" ? entry.watchedEpisodes : "",
        totalEpisodes: Number.isFinite(Number(entry?.totalEpisodes)) ? Number(entry.totalEpisodes) : 0,
        addedAt: typeof entry?.addedAt === "string" ? entry.addedAt : "",
        // Shared universes / franchises, set by hand. Tag-like: a title can be in
        // several at once. TMDB can't supply these -- belongs_to_collection is
        // movie-only and covers film series rather than universes (nothing joins
        // the MCU's films to its shows), and TV has no equivalent field.
        collections: normalizeCollections(entry?.collections ?? entry?.collection)
    }
}

// Accepts an array, a single string (the pre-tag shape, kept readable so an old
// document still loads), or nothing. Trims, drops blanks, and dedupes
// case-insensitively while keeping the first spelling seen.
function normalizeCollections(value) {
    const raw = Array.isArray(value) ? value : (typeof value === "string" ? [value] : [])
    const seen = new Map()
    for (const item of raw) {
        const name = typeof item === "string" ? item.trim() : ""
        if (!name) continue
        const key = name.toLowerCase()
        if (!seen.has(key)) seen.set(key, name)
    }
    return [...seen.values()]
}

// The bucket for titles carrying no collections at all.
const UNTAGGED = "Untagged"

// --- collection groups ------------------------------------------------------
//
// Groups let collections be organised into named axes -- Mood, Franchise,
// Format -- each of which becomes its own filter dropdown. The groups themselves
// and the collection -> group assignment live in settings (a JSON string), not on
// the titles: a title still just carries collection names, so grouping can be
// reorganised without rewriting a single title.
//
// Shape: { groups: ["Mood", "Franchise"], assign: { "MCU": "Franchise" } }
// A collection with no assignment falls into UNGROUPED. Collections are created
// inside a group now, so this only holds strays -- ones created before groups
// existed, or whose group was deleted. It is omitted entirely when empty.

const UNGROUPED = "Ungrouped"

function parseGroupConfig(raw) {
    let parsed
    try {
        parsed = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {})
    } catch (e) {
        return { groups: [], assign: {}, names: {} }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { groups: [], assign: {}, names: {} }
    }

    const groups = Array.isArray(parsed.groups)
        ? [...new Set(parsed.groups.map(g => String(g || "").trim()).filter(Boolean))]
        : []

    // Keys are lowercased so lookups are case-insensitive; `names` keeps the
    // spelling to display, since a collection assigned but not yet used on any
    // title has no other record of its casing.
    const assign = {}
    const names = {}
    if (parsed.assign && typeof parsed.assign === "object" && !Array.isArray(parsed.assign)) {
        for (const [collection, group] of Object.entries(parsed.assign)) {
            const name = String(collection || "").trim()
            const target = String(group || "").trim()
            // An assignment to a group that no longer exists is dropped rather
            // than creating a phantom dropdown.
            if (!name || !target || !groups.includes(target)) continue
            const key = name.toLowerCase()
            assign[key] = target
            names[key] = name
        }
    }
    // A previously stored `names` map wins for keys it covers, so display casing
    // survives a round trip even when the assign key is already lowercase.
    if (parsed.names && typeof parsed.names === "object" && !Array.isArray(parsed.names)) {
        for (const [key, display] of Object.entries(parsed.names)) {
            const k = String(key || "").trim().toLowerCase()
            const value = String(display || "").trim()
            if (k && value && assign[k]) names[k] = value
        }
    }
    return { groups, assign, names }
}

function serializeGroupConfig(config) {
    return JSON.stringify({
        groups: config.groups || [],
        assign: config.assign || {},
        names: config.names || {}
    })
}

function groupOf(config, collectionName) {
    return config.assign[String(collectionName || "").trim().toLowerCase()] || UNGROUPED
}

// Collections bucketed by their group, in the order the groups were defined.
// Only groups that actually contain collections are returned, so an empty group
// doesn't render a dropdown with nothing in it. UNGROUPED sorts last.
function collectionsByGroup(collections, config) {
    const buckets = new Map()
    const seen = new Set()

    for (const name of collections) {
        const group = groupOf(config, name)
        if (!buckets.has(group)) buckets.set(group, [])
        buckets.get(group).push(name)
        seen.add(name.toLowerCase())
    }

    // Collections created in Settings but not yet applied to any title still
    // belong in their group's dropdown -- otherwise they would be invisible
    // until something happened to use them.
    for (const [key, group] of Object.entries(config.assign)) {
        if (seen.has(key)) continue
        if (!buckets.has(group)) buckets.set(group, [])
        buckets.get(group).push(config.names?.[key] || key)
    }
    for (const list of buckets.values()) list.sort((a, b) => a.localeCompare(b))

    const ordered = []
    for (const group of config.groups) {
        if (buckets.has(group)) ordered.push([group, buckets.get(group)])
    }
    if (buckets.has(UNGROUPED)) ordered.push([UNGROUPED, buckets.get(UNGROUPED)])
    return ordered
}

// --- genres -----------------------------------------------------------------
//
// Unlike collections, genres come from TMDB and are refreshed automatically, so
// they are never hand-edited here. They arrive as a display string
// ("Drama, Sci-Fi & Fantasy") and are split for filtering.

function parseGenres(value) {
    if (!value || typeof value !== "string") return []
    return value.split(",").map(g => g.trim()).filter(Boolean)
}

// Every distinct genre across the library, sorted. Case-insensitive dedupe
// keeping the first spelling seen, so TMDB casing quirks don't create twins.
function listGenres(doc) {
    const seen = new Map()
    for (const entry of Object.values(doc.titles)) {
        for (const name of parseGenres(entry?.genres)) {
            const key = name.toLowerCase()
            if (!seen.has(key)) seen.set(key, name)
        }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

// Genres the user has hidden, as a lookup set. Stored as a comma-separated
// string in settings for the same reason genres themselves are: it stays
// readable in the config note.
function hiddenGenreSet(hiddenValue) {
    return new Set(parseGenres(hiddenValue).map(g => g.toLowerCase()))
}

function visibleGenres(doc, hiddenValue) {
    const hidden = hiddenGenreSet(hiddenValue)
    return listGenres(doc).filter(name => !hidden.has(name.toLowerCase()))
}

function titleHasGenre(entry, genre) {
    const wanted = String(genre || "").toLowerCase()
    return parseGenres(entry?.genres).some(g => g.toLowerCase() === wanted)
}

// --- link parsing -----------------------------------------------------------

// Recognises a pasted TMDB or IMDb link (or a bare id) and returns what to look
// up: { mediaType, tmdbId } or { imdbId }, else null.
//
// Verified against live TMDB URLs: the canonical forms are /movie/{id} and
// /tv/{id}, where {id} may carry a "-slug" suffix TMDB appends on redirect
// (/movie/693134 -> /movie/693134-dune-part-two). Trailing paths (/season/2)
// and query strings are ignored -- the leading numeric segment is the id and the
// path segment before it gives the type, so no search is needed.
function parseMediaLink(input) {
    const text = String(input || "").trim()
    if (!text) return null

    // Bare IMDb id, or any imdb.com/title/ttNNNNN link.
    const imdb = /(?:^|imdb\.com\/title\/)(tt\d{6,})/i.exec(text)
    if (imdb) return { imdbId: imdb[1].toLowerCase() }

    // TMDB link. Accepts http/https, with or without www, and any trailing
    // path or query after the id.
    const tmdb = /themoviedb\.org\/(movie|tv)\/(\d+)/i.exec(text)
    if (tmdb) {
        return {
            mediaType: tmdb[1].toLowerCase() === "tv" ? "show" : "movie",
            tmdbId: tmdb[2]
        }
    }

    return null
}

// --- sorting ----------------------------------------------------------------

const SORTS = [
    { key: "title", label: "A-Z" },
    { key: "lastWatched", label: "Recently watched" },
    { key: "year", label: "Release date" },
    { key: "rating", label: "Rating" },
    { key: "addedAt", label: "Recently added" },
    { key: "progress", label: "Progress" }
]

// Missing values always sort last regardless of direction -- an unrated or
// never-watched title shouldn't lead a descending list just because "" < "2024".
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

        let result
        if (typeof a === "number" && typeof b === "number") result = a - b
        else result = String(a).localeCompare(String(b))

        // Ties fall back to title so ordering is stable and predictable.
        return result !== 0 ? result * direction : x.title.localeCompare(y.title)
    })

    return sorted
}

// Distinct collection names in use, sorted, for autocomplete and filtering.
function listCollections(doc) {
    const seen = new Map()
    for (const entry of Object.values(doc.titles)) {
        for (const name of normalizeCollections(entry?.collections ?? entry?.collection)) {
            const key = name.toLowerCase()
            if (!seen.has(key)) seen.set(key, name)
        }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

// Group titles by collection, preserving the incoming sort within each group.
// A title in several collections appears under each of them -- that's the point
// of tags -- so groups intentionally overlap. Titles with none land in Untagged,
// which sorts last because it's the leftovers, not a collection.
function groupByCollection(titles) {
    const groups = new Map()
    const untagged = []

    for (const title of titles) {
        const names = normalizeCollections(title.collections)
        if (!names.length) {
            untagged.push(title)
            continue
        }
        for (const name of names) {
            if (!groups.has(name)) groups.set(name, [])
            groups.get(name).push(title)
        }
    }

    const named = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    return untagged.length ? [...named, [UNTAGGED, untagged]] : named
}

// Every title in the document, normalized and key-stamped, sorted by title.
function listTitles(doc) {
    return Object.entries(doc.titles)
        .map(([key, entry]) => ({ key, ...normalizeTitle(entry) }))
        .sort((a, b) => a.title.localeCompare(b.title))
}

module.exports = {
    STATUSES,
    IMAGE_BASE,
    posterUrl,
    parseEpisodes,
    formatEpisodes,
    countEpisodes,
    hasEpisode,
    withEpisode,
    withEpisodeRanges,
    mergeEpisodes,
    nextUnwatched,
    statusFromProgress,
    emptyDocument,
    parseDocument,
    serializeDocument,
    titleKey,
    findTitle,
    normalizeTitle,
    listTitles,
    parseMediaLink,
    parseGenres,
    listGenres,
    hiddenGenreSet,
    visibleGenres,
    titleHasGenre,
    parseGroupConfig,
    serializeGroupConfig,
    groupOf,
    collectionsByGroup,
    UNGROUPED,
    normalizeCollections,
    listCollections,
    groupByCollection,
    UNTAGGED,
    SORTS,
    sortTitles
}
