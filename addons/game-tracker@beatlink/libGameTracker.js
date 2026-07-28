/*
 * game-tracker@beatlink data model.
 *
 * Every tracked game lives in ONE JSON document, stored in a code note titled
 * "Database" that is a direct child of the configured Library Root. Keeping the
 * database under the root (rather than in the addon's own persistence tree)
 * means the data travels with the library: move or export the root and the
 * games come along.
 *
 *   {
 *     "games": {
 *       "<key>": {
 *         igdbId, steamAppId,
 *         title, year, summary, cover, genres, platforms,
 *         status: "backlog" | "playing" | "beaten" | "dropped",
 *         rating: 0..10 | null,
 *         playtime: minutes,          // total, from Steam or entered by hand
 *         lastPlayed: "YYYY-MM-DD",
 *         addedAt: "YYYY-MM-DD",
 *         collections: ["Soulslikes", "2024 Backlog"]  // tags, set by hand
 *       }
 *     }
 *   }
 *
 * `key` is the game's stable id (see gameKey): IGDB id when known, else the
 * Steam appid. Keying by identity is what makes repeated imports from different
 * sources converge on one entry instead of duplicating.
 *
 * The shape deliberately parallels media-tracker@beatlink so the two read alike,
 * but games have no episodes: where a show tracks per-episode progress, a game
 * tracks a single accumulated `playtime`. That difference is why "watched" is
 * "beaten" here -- a game with 200 hours logged may still not be finished, so
 * completion is the user's call and is never derived from playtime.
 */

const STATUSES = ["backlog", "playing", "beaten", "dropped"]

// IGDB serves images from a fixed path with an interchangeable size segment.
// Verified against api-docs.igdb.com: https://images.igdb.com/igdb/image/upload/t_{size}/{hash}.jpg
const IMAGE_BASE = "https://images.igdb.com/igdb/image/upload/"

function coverUrl(imageId, size) {
    if (!imageId) return ""
    return `${IMAGE_BASE}t_${size || "cover_big"}/${imageId}.jpg`
}

// --- playtime ---------------------------------------------------------------
//
// Stored as whole minutes because that is what Steam reports (playtime_forever
// is an int32 of minutes). Displayed as hours, since a games library is read in
// hours and "6531 minutes" means nothing at a glance.

function formatPlaytime(minutes) {
    const total = Number(minutes) || 0
    if (total <= 0) return ""
    if (total < 60) return `${total}m`
    const hours = Math.floor(total / 60)
    const rest = total % 60
    return rest ? `${hours}h ${rest}m` : `${hours}h`
}

// --- status -----------------------------------------------------------------
//
// Unlike shows, status is never derived from progress: playtime cannot tell
// whether a game was finished. An import may move a game out of the backlog
// once it has been played, but only that far -- calling something "beaten" is
// always the user's decision.
function statusFromPlaytime(previousStatus, minutes) {
    const played = Number(minutes) || 0
    if (played <= 0) return previousStatus || "backlog"
    // Anything the user has already classified is left alone.
    if (previousStatus && previousStatus !== "backlog") return previousStatus
    return "playing"
}

// --- document ---------------------------------------------------------------

function emptyDocument() {
    return { games: {} }
}

// Tolerates a blank note, malformed JSON, or a document missing `games`, so a
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
    const games = parsed.games
    if (!games || typeof games !== "object" || Array.isArray(games)) return emptyDocument()
    return { ...parsed, games }
}

function serializeDocument(doc) {
    return JSON.stringify(doc, null, 4)
}

// Identity, strongest first: IGDB is primary (it is the metadata source and
// spans every platform), Steam appid second (it only identifies PC releases).
function gameKey(item) {
    if (item?.igdbId) return `igdb:${item.igdbId}`
    if (item?.steamAppId) return `steam:${item.steamAppId}`
    return ""
}

// An entry already in the document that refers to the same game, matched on any
// shared id rather than only the key -- a game first imported from Steam is
// keyed by appid, and must still be found when IGDB later supplies its own id.
function findGame(doc, item) {
    const key = gameKey(item)
    if (key && doc.games[key]) return key

    const wanted = {
        igdbId: item?.igdbId ? String(item.igdbId) : "",
        steamAppId: item?.steamAppId ? String(item.steamAppId) : ""
    }
    for (const [existingKey, entry] of Object.entries(doc.games)) {
        if (wanted.igdbId && String(entry.igdbId || "") === wanted.igdbId) return existingKey
        if (wanted.steamAppId && String(entry.steamAppId || "") === wanted.steamAppId) return existingKey
    }
    return ""
}

function normalizeGame(entry) {
    const rating = Number(entry?.rating)
    const playtime = Number(entry?.playtime)
    return {
        igdbId: entry?.igdbId ? String(entry.igdbId) : "",
        steamAppId: entry?.steamAppId ? String(entry.steamAppId) : "",
        title: typeof entry?.title === "string" ? entry.title : "",
        year: entry?.year ? String(entry.year) : "",
        summary: typeof entry?.summary === "string" ? entry.summary : "",
        cover: typeof entry?.cover === "string" ? entry.cover : "",
        genres: typeof entry?.genres === "string" ? entry.genres : "",
        platforms: typeof entry?.platforms === "string" ? entry.platforms : "",
        status: STATUSES.includes(entry?.status) ? entry.status : "backlog",
        rating: Number.isFinite(rating) && rating > 0 ? rating : null,
        playtime: Number.isFinite(playtime) && playtime > 0 ? Math.round(playtime) : 0,
        lastPlayed: typeof entry?.lastPlayed === "string" ? entry.lastPlayed : "",
        addedAt: typeof entry?.addedAt === "string" ? entry.addedAt : "",
        // Series / themes / personal buckets, set by hand. IGDB's own franchise
        // and collection fields are inconsistently populated, so these stay the
        // user's own vocabulary rather than an imported one.
        collections: normalizeCollections(entry?.collections ?? entry?.collection)
    }
}

// Accepts an array, a single string, or nothing. Trims, drops blanks, and
// dedupes case-insensitively while keeping the first spelling seen.
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

// The bucket for games carrying no collections at all.
const UNTAGGED = "Untagged"

// --- collection groups ------------------------------------------------------
//
// Groups let collections be organised into named axes -- Mood, Series, Format --
// each of which becomes its own filter dropdown. The groups themselves and the
// collection -> group assignment live in settings (a JSON string), not on the
// games: a game still just carries collection names, so grouping can be
// reorganised without rewriting a single game.
//
// Shape: { groups: ["Mood", "Series"], assign: { "Soulslikes": "Series" } }

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
    // game has no other record of its casing.
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

    // Collections created in Settings but not yet applied to any game still
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

// --- genres and platforms ---------------------------------------------------
//
// Unlike collections, both come from IGDB and are refreshed automatically, so
// they are never hand-edited here. They arrive as a display string
// ("Role-playing (RPG), Adventure") and are split for filtering.

function parseList(value) {
    if (!value || typeof value !== "string") return []
    return value.split(",").map(g => g.trim()).filter(Boolean)
}

// Every distinct value of `field` across the library, sorted. Case-insensitive
// dedupe keeping the first spelling seen, so IGDB casing quirks don't create
// twins.
function listField(doc, field) {
    const seen = new Map()
    for (const entry of Object.values(doc.games)) {
        for (const name of parseList(entry?.[field])) {
            const key = name.toLowerCase()
            if (!seen.has(key)) seen.set(key, name)
        }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

function listGenres(doc) {
    return listField(doc, "genres")
}

function listPlatforms(doc) {
    return listField(doc, "platforms")
}

// Values the user has hidden, as a lookup set. Stored as a comma-separated
// string in settings for the same reason genres themselves are: it stays
// readable in the config note.
function hiddenSet(hiddenValue) {
    return new Set(parseList(hiddenValue).map(g => g.toLowerCase()))
}

function visibleGenres(doc, hiddenValue) {
    const hidden = hiddenSet(hiddenValue)
    return listGenres(doc).filter(name => !hidden.has(name.toLowerCase()))
}

function gameHasValue(entry, field, wanted) {
    const target = String(wanted || "").toLowerCase()
    return parseList(entry?.[field]).some(g => g.toLowerCase() === target)
}

function gameHasGenre(entry, genre) {
    return gameHasValue(entry, "genres", genre)
}

function gameHasPlatform(entry, platform) {
    return gameHasValue(entry, "platforms", platform)
}

// --- link parsing -----------------------------------------------------------

// Recognises a pasted IGDB or Steam link (or a bare Steam appid) and returns
// what to look up: { igdbSlug } or { steamAppId }, else null.
//
// Verified against live URLs: IGDB games are addressed by slug
// (igdb.com/games/hades), and Steam store pages are /app/{appid}/{slug}/ where
// the leading numeric segment is the appid. Trailing paths and query strings are
// ignored, so no search is needed for either.
function parseGameLink(input) {
    const text = String(input || "").trim()
    if (!text) return null

    // Steam store or community link, with or without a trailing slug.
    const steam = /steampowered\.com\/app\/(\d+)|steamcommunity\.com\/app\/(\d+)/i.exec(text)
    if (steam) return { steamAppId: steam[1] || steam[2] }

    // IGDB link. Accepts http/https, with or without www.
    const igdb = /igdb\.com\/games\/([a-z0-9-]+)/i.exec(text)
    if (igdb) return { igdbSlug: igdb[1].toLowerCase() }

    // A bare number is treated as a Steam appid: IGDB ids are not something a
    // user encounters as a bare value, but appids are printed all over Steam.
    if (/^\d{2,8}$/.test(text)) return { steamAppId: text }

    return null
}

// --- sorting ----------------------------------------------------------------

const SORTS = [
    { key: "title", label: "A-Z" },
    { key: "lastPlayed", label: "Recently played" },
    { key: "year", label: "Release date" },
    { key: "rating", label: "Rating" },
    { key: "playtime", label: "Playtime" },
    { key: "addedAt", label: "Recently added" }
]

// Missing values always sort last regardless of direction -- an unrated or
// never-played game shouldn't lead a descending list just because "" < "2024".
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
    for (const entry of Object.values(doc.games)) {
        for (const name of normalizeCollections(entry?.collections ?? entry?.collection)) {
            const key = name.toLowerCase()
            if (!seen.has(key)) seen.set(key, name)
        }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

// Group games by collection, preserving the incoming sort within each group.
// A game in several collections appears under each of them -- that's the point
// of tags -- so groups intentionally overlap. Games with none land in Untagged,
// which sorts last because it's the leftovers, not a collection.
function groupByCollection(games) {
    const groups = new Map()
    const untagged = []

    for (const game of games) {
        const names = normalizeCollections(game.collections)
        if (!names.length) {
            untagged.push(game)
            continue
        }
        for (const name of names) {
            if (!groups.has(name)) groups.set(name, [])
            groups.get(name).push(game)
        }
    }

    const named = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    return untagged.length ? [...named, [UNTAGGED, untagged]] : named
}

// Every game in the document, normalized and key-stamped, sorted by title.
function listGames(doc) {
    return Object.entries(doc.games)
        .map(([key, entry]) => ({ key, ...normalizeGame(entry) }))
        .sort((a, b) => a.title.localeCompare(b.title))
}

module.exports = {
    STATUSES,
    IMAGE_BASE,
    coverUrl,
    formatPlaytime,
    statusFromPlaytime,
    emptyDocument,
    parseDocument,
    serializeDocument,
    gameKey,
    findGame,
    normalizeGame,
    listGames,
    parseGameLink,
    parseList,
    listGenres,
    listPlatforms,
    hiddenSet,
    visibleGenres,
    gameHasGenre,
    gameHasPlatform,
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
    sortGames
}
