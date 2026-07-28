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
 *         status: "<status id>",      // a key of the `statuses` registry
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

// --- statuses ---------------------------------------------------------------
//
// Statuses are user-defined. The four below are what the addon ships, and they
// are only a fallback: the real set lives in the `statuses` registry in
// settings, where they can be renamed, recoloured, reordered, added to, or
// removed.
//
// A game stores a status *id* (the registry key), not a display name, so
// renaming a status never touches a single game.
//
// Nothing in the addon keys behaviour off a status id or name. Behaviour keys
// off a status's ROLE:
//
//   backlog    not started
//   playing    in progress
//   done       finished
//   abandoned  stopped
//   none       manual only; imports never set it
//
// That indirection is the whole point. "Beaten" can be renamed to "Finished",
// and "Someday" and "Shortlist" can both carry the backlog role, without any
// import or status-derivation logic changing.

const SHIPPED_STATUSES = {
    backlog: { name: "Backlog", role: "backlog", color: "#808080" },
    playing: { name: "Playing", role: "playing", color: "#3884ff" },
    beaten: { name: "Beaten", role: "done", color: "#2ea057" },
    dropped: { name: "Dropped", role: "abandoned", color: "#db4848" }
}

const ROLES = ["none", "backlog", "playing", "done", "abandoned"]

// The status list as an ordered array of { id, name, role, color }.
//
// Registries preserve insertion order, which is the order the user arranged, so
// it is kept as-is. Falls back to the shipped set when settings hold nothing
// usable, so the tracker is never left with no statuses at all.
function listStatuses(statusesValue) {
    const source = (statusesValue && typeof statusesValue === "object" && !Array.isArray(statusesValue)
        && Object.keys(statusesValue).length)
        ? statusesValue
        : SHIPPED_STATUSES

    const out = []
    for (const [id, entry] of Object.entries(source)) {
        if (!id || !entry || typeof entry !== "object") continue
        const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id
        out.push({
            id,
            name,
            role: ROLES.includes(entry.role) ? entry.role : "none",
            color: typeof entry.color === "string" && entry.color.trim() ? entry.color.trim() : "#808080"
        })
    }
    return out.length ? out : listStatuses(null)
}

function statusById(statuses, id) {
    return statuses.find(s => s.id === id) || null
}

// The first status carrying `role`, or null. First rather than only: several
// statuses may legitimately share a role, and the earliest in the user's own
// order is the reasonable default among them.
function statusForRole(statuses, role) {
    return statuses.find(s => s.role === role) || null
}

// The id an import should use for a role, falling back through roles that still
// make sense before giving up. A library with no "done" status should not lose
// an import's completion signal entirely, so it degrades to playing.
const ROLE_FALLBACKS = {
    backlog: ["backlog", "none"],
    playing: ["playing", "backlog"],
    done: ["done", "playing"],
    abandoned: ["abandoned", "done", "playing"]
}

function statusIdForRole(statuses, role) {
    for (const candidate of ROLE_FALLBACKS[role] || [role]) {
        const found = statusForRole(statuses, candidate)
        if (found) return found.id
    }
    return statuses[0]?.id || ""
}

// The status a newly added game gets: the user's explicit choice when it still
// exists, else the first backlog-role status, else the first status.
function defaultStatusId(statuses, configuredId) {
    if (configuredId && statusById(statuses, configuredId)) return configuredId
    return statusIdForRole(statuses, "backlog")
}

// A game may hold a status that has since been removed from settings. That is
// not corruption and must not be silently rewritten -- doing so would lose the
// user's own classification. It is surfaced as a synthetic entry instead, so the
// tracker can display it, filter on it, and let the user change it deliberately.
function resolveStatus(statuses, id) {
    if (!id) return null
    return statusById(statuses, id) || {
        id,
        name: id,
        role: "none",
        color: "#808080",
        missing: true
    }
}

// Every status id in use across the library that settings no longer defines.
function orphanStatusIds(doc, statuses) {
    const known = new Set(statuses.map(s => s.id))
    const seen = new Set()
    for (const entry of Object.values(doc.games || {})) {
        const id = entry?.status
        if (id && !known.has(id)) seen.add(id)
    }
    return [...seen]
}

// Legacy: the ids the addon originally hardcoded. Still exported because a
// document written before statuses were customizable holds exactly these, and
// they remain the shipped ids, so nothing needs migrating.
const STATUSES = Object.keys(SHIPPED_STATUSES)

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

// --- status derivation ------------------------------------------------------
//
// Unlike shows, status is never derived from progress: playtime cannot tell
// whether a game was finished. An import may move a game out of the backlog
// once it has been played, but only that far -- calling something finished is
// always the user's decision.
//
// Works entirely in terms of roles, so it behaves identically whatever the user
// has named or coloured their statuses.
function statusFromPlaytime(statuses, previousStatusId, minutes) {
    const played = Number(minutes) || 0
    const previous = previousStatusId
        ? statusById(statuses, previousStatusId)
        : null

    if (played <= 0) return previousStatusId || statusIdForRole(statuses, "backlog")

    // Anything the user has already classified beyond "not started" is left
    // alone. A status the settings no longer define counts as classified too:
    // it is the user's own, and an import must not overwrite it.
    if (previousStatusId && (!previous || previous.role !== "backlog")) return previousStatusId

    return statusIdForRole(statuses, "playing")
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
        // Any non-empty string is kept verbatim. Statuses are user-defined, so
        // this cannot validate against a fixed list -- and must not, since
        // rewriting an unrecognised status would silently destroy the user's own
        // classification the moment they renamed or removed one. Display-time
        // resolution (resolveStatus) handles ids settings no longer defines.
        status: typeof entry?.status === "string" && entry.status.trim()
            ? entry.status.trim()
            : "backlog",
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

// --- file import ------------------------------------------------------------
//
// Parsers for library files exported from elsewhere. All of them produce the
// same row shape so one importer handles every source:
//
//   { title, status, rating, playtime, lastPlayed, igdbId, steamAppId, list }
//
// Only `title` is required. Rows carrying an id are matched on it directly;
// title-only rows have to be resolved against IGDB by name, which is why the
// importer previews its matches before writing anything.
//
// A row's `status` is a ROLE, not a status id. The file says something means
// "finished"; which of the user's statuses that becomes is decided at import
// time by statusIdForRole. That keeps every parser independent of whatever the
// user has named their statuses.

// IGDB's GDPR export status values, per list, mapped to roles. The export
// carries a list name ("Played") and optionally a finer per-entry status
// ("Completed", "Abandoned"), so the entry status wins where present and the
// list name is the fallback.
//
// Verified against a real export: list sections are "Want to Play", "Playing",
// and "Played"; entry statuses seen are "", "Backlog", "Currently playing",
// "Completed", "Finished", and "Abandoned".
const IGDB_ENTRY_STATUS = {
    "completed": "done",
    "finished": "done",
    "beaten": "done",
    "abandoned": "abandoned",
    "dropped": "abandoned",
    "currently playing": "playing",
    "playing": "playing",
    "backlog": "backlog",
    "want to play": "backlog"
}

const IGDB_LIST_STATUS = {
    "want to play": "backlog",
    "wishlist": "backlog",
    "playing": "playing",
    "played": "done"
}

// A list called "Played" means the game was played, not necessarily finished.
// The done role is the closest honest mapping for a list the user themselves
// filed as played, but an entry status always overrides it -- "Abandoned" inside
// "Played" is a drop, not a completion.
function igdbStatusFor(listName, entryStatus) {
    const entry = String(entryStatus || "").trim().toLowerCase()
    if (entry && IGDB_ENTRY_STATUS[entry]) return IGDB_ENTRY_STATUS[entry]
    const list = String(listName || "").trim().toLowerCase()
    return IGDB_LIST_STATUS[list] || "backlog"  // role, not an id
}

// Strip HTML tags and decode the handful of entities an export actually
// contains. Deliberately minimal: this runs on a file the user chose, not on
// arbitrary remote input, and the result is only ever used as a title string.
function stripTags(html) {
    return String(html || "")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

// Parse IGDB's GDPR export (workingjoe-NNNN.zip -> index.html).
//
// Shape, confirmed against a real export: each list is an <h3> naming it,
// followed by a metadata table, then an entries table whose header row is
// Position | Description | Game | Platform | Status. Ratings live in their own
// section with a Game | Rating header.
//
// The export carries NO game ids -- only display titles -- so every row here
// must be resolved against IGDB by name.
function parseIgdbExport(html) {
    const text = String(html || "")
    if (!text.trim()) return { rows: [], lists: [] }

    const rows = []
    const lists = []
    const seen = new Set()

    // Split on headings, keeping them, so each chunk of tables is attributable
    // to the heading that introduced it.
    const parts = text.split(/(<h[1-4][^>]*>[\s\S]*?<\/h[1-4]>)/i)
    let current = ""

    for (const part of parts) {
        const heading = /^<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>$/i.exec(part)
        if (heading) {
            current = stripTags(heading[1]).replace(/^"|"$/g, "")
            continue
        }
        if (!current) continue

        for (const table of part.match(/<table[\s\S]*?<\/table>/gi) || []) {
            const tableRows = table.match(/<tr[\s\S]*?<\/tr>/gi) || []
            if (!tableRows.length) continue

            // Only entry tables have a <th> header row; the metadata tables
            // beside them are plain label/value pairs and are skipped.
            const headers = (tableRows[0].match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || [])
                .map(h => stripTags(h).toLowerCase())
            if (!headers.length) continue

            const columnOf = (name) => headers.indexOf(name)
            const gameAt = columnOf("game")
            if (gameAt < 0) continue

            const ratingAt = columnOf("rating")
            const statusAt = columnOf("status")
            const platformAt = columnOf("platform")

            let count = 0
            for (const row of tableRows.slice(1)) {
                const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map(stripTags)
                const title = cells[gameAt]
                if (!title) continue

                const parsed = { title, list: current }

                // The Ratings section carries scores rather than list membership.
                if (ratingAt >= 0) {
                    const rating = Number(cells[ratingAt])
                    // IGDB rates out of 100; the tracker uses 0-10.
                    if (Number.isFinite(rating) && rating > 0) {
                        parsed.rating = Math.round(rating / 10)
                    }
                } else {
                    parsed.status = igdbStatusFor(current, statusAt >= 0 ? cells[statusAt] : "")
                }

                if (platformAt >= 0 && cells[platformAt]) parsed.platforms = cells[platformAt]

                rows.push(parsed)
                count++
            }

            if (count) {
                lists.push({ name: current, count })
                seen.add(current)
            }
        }
    }

    return { rows: mergeRows(rows), lists }
}

// Rows for the same title, collapsed. A game can appear in a list AND in the
// ratings section, and the two carry different fields; merging means one import
// row per game rather than two that overwrite each other.
//
// Status precedence follows how definite each one is: an explicit finished or
// dropped state beats "currently playing", which beats a bare backlog entry.
// Ranked by how definite each ROLE is, for collapsing duplicate rows.
const STATUS_RANK = { backlog: 0, playing: 1, abandoned: 2, done: 3 }

function mergeRows(rows) {
    const byTitle = new Map()
    for (const row of rows) {
        const key = String(row.title || "").trim().toLowerCase()
        if (!key) continue

        const existing = byTitle.get(key)
        if (!existing) {
            byTitle.set(key, { ...row })
            continue
        }

        // Keep the first spelling of the title, fill in whatever is missing, and
        // let the more definite status win.
        if (row.rating != null && existing.rating == null) existing.rating = row.rating
        if (row.playtime && !existing.playtime) existing.playtime = row.playtime
        if (row.lastPlayed && !existing.lastPlayed) existing.lastPlayed = row.lastPlayed
        if (row.igdbId && !existing.igdbId) existing.igdbId = row.igdbId
        if (row.steamAppId && !existing.steamAppId) existing.steamAppId = row.steamAppId
        if (row.platforms && !existing.platforms) existing.platforms = row.platforms
        if (row.status && (STATUS_RANK[row.status] ?? -1) > (STATUS_RANK[existing.status] ?? -1)) {
            existing.status = row.status
        }
        // Remember every list a game came from, for the collection option.
        if (row.list && row.list !== existing.list) {
            existing.lists = [...new Set([...(existing.lists || [existing.list]), row.list])]
        }
    }
    return [...byTitle.values()]
}

// --- CSV --------------------------------------------------------------------

// A small RFC 4180 reader: quoted fields, escaped quotes (""), and newlines
// inside quotes. Written out rather than split(",") because a games CSV is full
// of titles containing commas.
function parseCsv(text) {
    const rows = []
    let row = []
    let field = ""
    let quoted = false

    const source = String(text || "").replace(/^﻿/, "")

    for (let i = 0; i < source.length; i++) {
        const char = source[i]

        if (quoted) {
            if (char === '"') {
                if (source[i + 1] === '"') { field += '"'; i++ }
                else quoted = false
            } else field += char
            continue
        }

        if (char === '"') { quoted = true; continue }
        if (char === ",") { row.push(field); field = ""; continue }
        if (char === "\r") continue
        if (char === "\n") {
            row.push(field)
            // Skip blank lines rather than emitting an empty row.
            if (row.some(c => c !== "")) rows.push(row)
            row = []
            field = ""
            continue
        }
        field += char
    }

    row.push(field)
    if (row.some(c => c !== "")) rows.push(row)
    return rows
}

// Column aliases, so a CSV from a spreadsheet, GOG export, or another tracker
// maps without the user having to rename headers first.
const CSV_COLUMNS = {
    title: ["title", "name", "game", "game name", "gamename"],
    status: ["status", "state", "progress", "list"],
    rating: ["rating", "score", "my rating", "userrating", "user rating"],
    playtime: ["playtime", "hours", "hours played", "time played", "playtime (hours)"],
    lastPlayed: ["lastplayed", "last played", "last_played", "date"],
    igdbId: ["igdbid", "igdb id", "igdb"],
    steamAppId: ["steamappid", "appid", "steam appid", "steam id", "app id"],
    platforms: ["platform", "platforms"]
}

function matchColumn(headers, aliases) {
    for (const alias of aliases) {
        const at = headers.indexOf(alias)
        if (at >= 0) return at
    }
    return -1
}

// Free-text status values from wherever the CSV came from, mapped onto roles.
// Anything unrecognised falls back to the backlog role rather than being
// dropped, so a row is never silently lost.
const CSV_STATUS = {
    ...IGDB_ENTRY_STATUS,
    "complete": "done",
    "completed": "done",
    "100%": "done",
    "played": "done",
    "in progress": "playing",
    "started": "playing",
    "now playing": "playing",
    "plan to play": "backlog",
    "unplayed": "backlog",
    "never played": "backlog",
    "not started": "backlog",
    "on hold": "abandoned",
    "quit": "abandoned",
    "shelved": "abandoned"
}

function parseGameCsv(text) {
    const table = parseCsv(text)
    if (table.length < 2) return { rows: [], lists: [] }

    const headers = table[0].map(h => String(h || "").trim().toLowerCase())
    const at = {}
    for (const [field, aliases] of Object.entries(CSV_COLUMNS)) {
        at[field] = matchColumn(headers, aliases)
    }
    if (at.title < 0) {
        throw new Error("No title column found. The CSV needs a header row with a "
            + "'Title', 'Name', or 'Game' column.")
    }

    const rows = []
    for (const cells of table.slice(1)) {
        const title = String(cells[at.title] || "").trim()
        if (!title) continue

        const row = { title }

        if (at.status >= 0) {
            const raw = String(cells[at.status] || "").trim().toLowerCase()
            if (raw) row.status = CSV_STATUS[raw] || "backlog"  // role
        }
        if (at.rating >= 0) {
            const rating = Number(cells[at.rating])
            // Accept both 0-10 and 0-100 scales: anything above 10 is treated as
            // a percentage, which is how most other trackers export.
            if (Number.isFinite(rating) && rating > 0) {
                row.rating = Math.round(rating > 10 ? rating / 10 : rating)
            }
        }
        if (at.playtime >= 0) {
            const hours = Number(cells[at.playtime])
            if (Number.isFinite(hours) && hours > 0) row.playtime = Math.round(hours * 60)
        }
        if (at.lastPlayed >= 0) {
            const date = String(cells[at.lastPlayed] || "").trim().slice(0, 10)
            if (/^\d{4}-\d{2}-\d{2}$/.test(date)) row.lastPlayed = date
        }
        if (at.igdbId >= 0 && String(cells[at.igdbId] || "").trim()) {
            row.igdbId = String(cells[at.igdbId]).trim()
        }
        if (at.steamAppId >= 0 && String(cells[at.steamAppId] || "").trim()) {
            row.steamAppId = String(cells[at.steamAppId]).trim()
        }
        if (at.platforms >= 0 && String(cells[at.platforms] || "").trim()) {
            row.platforms = String(cells[at.platforms]).trim()
        }

        rows.push(row)
    }

    return { rows: mergeRows(rows), lists: [] }
}

// A JSON array of objects, or an object wrapping one. Field names go through the
// same alias table as CSV, so an export from another tool usually just works.
function parseGameJson(text) {
    let parsed
    try {
        parsed = JSON.parse(text)
    } catch (e) {
        throw new Error("That file is not valid JSON.")
    }

    // Accept a bare array, or the first array-valued property of an object.
    let list = parsed
    if (!Array.isArray(list) && parsed && typeof parsed === "object") {
        list = Object.values(parsed).find(v => Array.isArray(v))
    }
    if (!Array.isArray(list)) {
        throw new Error("Expected a JSON array of games, or an object containing one.")
    }

    const pick = (entry, aliases) => {
        for (const key of Object.keys(entry || {})) {
            if (aliases.includes(key.trim().toLowerCase())) return entry[key]
        }
        return undefined
    }

    const rows = []
    for (const entry of list) {
        if (!entry || typeof entry !== "object") continue
        const title = String(pick(entry, CSV_COLUMNS.title) || "").trim()
        if (!title) continue

        const row = { title }

        const status = String(pick(entry, CSV_COLUMNS.status) || "").trim().toLowerCase()
        if (status) row.status = CSV_STATUS[status] || "backlog"  // role

        const rating = Number(pick(entry, CSV_COLUMNS.rating))
        if (Number.isFinite(rating) && rating > 0) {
            row.rating = Math.round(rating > 10 ? rating / 10 : rating)
        }

        const hours = Number(pick(entry, CSV_COLUMNS.playtime))
        if (Number.isFinite(hours) && hours > 0) row.playtime = Math.round(hours * 60)

        const igdbId = pick(entry, CSV_COLUMNS.igdbId)
        if (igdbId) row.igdbId = String(igdbId).trim()

        const steamAppId = pick(entry, CSV_COLUMNS.steamAppId)
        if (steamAppId) row.steamAppId = String(steamAppId).trim()

        const platforms = pick(entry, CSV_COLUMNS.platforms)
        if (platforms) {
            row.platforms = Array.isArray(platforms) ? platforms.join(", ") : String(platforms)
        }

        rows.push(row)
    }

    return { rows: mergeRows(rows), lists: [] }
}

// Dispatch on what the file actually looks like rather than on its extension, so
// a renamed file still imports. The IGDB export is an HTML document, which is
// unambiguous enough to detect by content.
function parseImportFile(text, filename) {
    const source = String(text || "")
    if (!source.trim()) throw new Error("That file is empty.")

    const name = String(filename || "").toLowerCase()

    if (/^\s*[[{]/.test(source) && !/<table/i.test(source)) {
        return { format: "json", ...parseGameJson(source) }
    }
    if (/<table/i.test(source) || /<html/i.test(source) || name.endsWith(".html")) {
        const result = parseIgdbExport(source)
        if (!result.rows.length) {
            throw new Error("No game lists found in that HTML file. An IGDB export should "
                + "contain Want to Play / Playing / Played sections.")
        }
        return { format: "igdb-export", ...result }
    }
    return { format: "csv", ...parseGameCsv(source) }
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
    SHIPPED_STATUSES,
    ROLES,
    listStatuses,
    statusById,
    statusForRole,
    statusIdForRole,
    defaultStatusId,
    resolveStatus,
    orphanStatusIds,
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
    parseImportFile,
    parseIgdbExport,
    parseGameCsv,
    parseGameJson,
    parseCsv,
    mergeRows,
    igdbStatusFor,
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
