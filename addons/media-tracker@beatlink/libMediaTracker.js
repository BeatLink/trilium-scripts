/*
 * media-tracker@beatlink shared data model.
 *
 * A tracked title is a real Trilium note under the configured library root:
 *
 *   #mediaTitle              marker, present on every tracked note
 *   #mediaType=movie|show
 *   #watchStatus=planned|watching|watched|dropped
 *   #rating=0..10            user's own rating (never overwritten by import unless enabled)
 *   #year, #runtime, #genres
 *   #tmdbId, #imdbId, #traktId   identity, used to match an imported item to an existing note
 *   #poster                  full https image URL
 *   #lastWatched             ISO date
 *   #watchedEpisodes         compact season/episode encoding (shows only), see below
 *   #totalEpisodes           aired episode count from TMDB, for progress
 *
 * Episode progress lives in ONE label on the show note rather than one note per
 * episode: a 10-season show would otherwise add ~250 notes to the tree and slow
 * every search. Encoding is a comma-separated list of per-season runs:
 *
 *   s01e01-e10,s02e01,s02e03-e05
 *
 * parseEpisodes -> { [season]: Set(episodeNumbers) }, formatEpisodes is its inverse
 * and always emits canonical (sorted, run-collapsed) output.
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

// Merge imported progress into existing progress. Import is one-way and additive:
// an episode already marked watched locally is never un-watched by an import.
function mergeEpisodes(existing, incoming) {
    const merged = {}
    for (const [season, set] of Object.entries(existing)) merged[season] = new Set(set)
    for (const [season, set] of Object.entries(incoming)) {
        if (!merged[season]) merged[season] = new Set()
        for (const n of set) merged[season].add(n)
    }
    return merged
}

// First aired episode not yet watched, given TMDB's season/episode counts.
// `seasonCounts` is { [seasonNumber]: airedEpisodeCount }.
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

// Status implied by episode progress, used when importing a show.
function statusFromProgress(watchedCount, totalEpisodes) {
    if (!totalEpisodes) return watchedCount > 0 ? "watching" : "planned"
    if (watchedCount === 0) return "planned"
    return watchedCount >= totalEpisodes ? "watched" : "watching"
}

// --- identity ---------------------------------------------------------------

// Ordered strongest-first: tmdb is the primary key since TMDB is the metadata
// source, imdb is the cross-source bridge (Stremio uses imdb ids), trakt last.
const ID_LABELS = ["tmdbId", "imdbId", "traktId"]

function identityOf(item) {
    return {
        tmdbId: item?.tmdbId ? String(item.tmdbId) : "",
        imdbId: item?.imdbId ? String(item.imdbId) : "",
        traktId: item?.traktId ? String(item.traktId) : ""
    }
}

module.exports = {
    STATUSES,
    IMAGE_BASE,
    ID_LABELS,
    posterUrl,
    parseEpisodes,
    formatEpisodes,
    countEpisodes,
    hasEpisode,
    withEpisode,
    mergeEpisodes,
    nextUnwatched,
    statusFromProgress,
    identityOf
}
