/*
 * game-tracker@beatlink — backend customRequestHandler ("gameTracker").
 *
 * One HTTP endpoint (custom/gameTracker) routed by ?action=:
 *
 *   listGames        read the whole library out of the database note
 *   search           IGDB search
 *   details          IGDB details for one game
 *   fullDetails      details plus screenshots, companies, and similar games
 *   addGame          add a game to the database from an IGDB id
 *   addFromLink      add from a pasted IGDB or Steam link
 *   removeGame       drop a game from the database
 *   setStatus        set play status
 *   setRating        set rating
 *   setPlaytime      set playtime by hand (minutes)
 *   refreshLibrary   re-fetch metadata and backfill ids
 *   steamCheck       verify the Steam key/id and report the library size
 *   importSteam      one-way import of the Steam library
 *
 * Storage: every game lives in ONE JSON note titled "Database", a direct child
 * of the configured Library Root (find-or-create, see resolveDatabaseNote).
 * Imports read the document once, apply every change in memory, and write once
 * at the end -- a 900-game Steam import is a single note write, and a partial
 * failure can't leave the document half-updated.
 *
 * Imports are additive: they only ever add and update games, never remove them.
 * A game removed from a Steam account upstream is left untouched here, so an
 * external change can't quietly delete your Trilium data. Nothing is ever
 * written to Steam or IGDB -- both are strictly read-only.
 *
 * API contracts verified against live endpoints and first-party docs:
 *   IGDB auth     - api-docs.igdb.com: POST https://id.twitch.tv/oauth2/token with
 *                   client_id/client_secret/grant_type=client_credentials as QUERY
 *                   params; response { access_token, expires_in, token_type }.
 *   IGDB requests - POST https://api.igdb.com/v4/{endpoint}, headers Client-ID and
 *                   "Authorization: Bearer <token>", APIcalypse query in the BODY.
 *                   Rate limit 4 requests/second, 8 concurrent. Confirmed live:
 *                   a bad token returns a JSON "Authorization Failure" body.
 *   IGDB images   - https://images.igdb.com/igdb/image/upload/t_{size}/{hash}.jpg
 *   IGDB->Steam   - external_games where category = 1 (steam); `uid` is the appid.
 *   Steam         - IPlayerService/GetOwnedGames/v1 on api.steampowered.com.
 *                   Request params and every response field name taken from Valve's
 *                   own protobuf (SteamDatabase/Protobufs steammessages_player):
 *                   appid, name, playtime_forever (minutes), rtime_last_played
 *                   (unix seconds), img_icon_url.
 */

const { loadSettings, saveSettings } = require("libSettings.js")
const tracker = require("libGameTracker.js")

const TWITCH_OAUTH = "https://id.twitch.tv/oauth2/token"
const IGDB_API = "https://api.igdb.com/v4"
const STEAM_API = "https://api.steampowered.com"
const STEAM_STORE = "https://store.steampowered.com/api"

const DATABASE_TITLE = "Database"

// IGDB's external_games.category value for Steam. From the documented enum
// (steam = 1), this is how a Steam appid is resolved to an IGDB game.
const EXTERNAL_STEAM = 1

// --- settings ---------------------------------------------------------------

// Normally resolved from this note's own relations. When these functions are
// required from another script (autoSync.js), `api.currentNote` is that script
// instead, so fall back to finding the settings note by its #gameTrackerConfig
// marker -- otherwise a scheduled import would fail the moment it tried to
// persist a refreshed token.
function getNoteIds() {
    let schemaNoteId = api.currentNote?.getRelationValue("schemaNote")
    let settingsNoteId = api.currentNote?.getRelationValue("settingsNote")

    if (!schemaNoteId || !settingsNoteId) {
        const marker = api.getNoteWithLabel("gameTrackerConfig")
        if (!marker) throw new Error("Game Tracker settings note not found")
        schemaNoteId = marker.getRelationValue("schemaNote")
        settingsNoteId = marker.noteId
    }

    const configNoteId = api.getNote(settingsNoteId).getRelationValue("configNote")
    return { schemaNoteId, configNoteId }
}

function getSettings() {
    const { schemaNoteId, configNoteId } = getNoteIds()
    return loadSettings(schemaNoteId, configNoteId)
}

function persistFields(fields) {
    const { schemaNoteId, configNoteId } = getNoteIds()
    const settings = loadSettings(schemaNoteId, configNoteId)
    Object.assign(settings, fields)
    saveSettings(schemaNoteId, configNoteId, settings)
}

// --- database ---------------------------------------------------------------

function requireLibraryRoot(settings) {
    if (!settings.libraryRootNoteId) throw new Error("Set a Library Root in Settings first")
    const note = api.getNote(settings.libraryRootNoteId)
    if (!note || note.isDeleted) throw new Error("Library Root note not found")
    return note
}

// The database note is a JSON code note titled "Database" directly under the
// library root. Kept there rather than in the addon's persistence tree so the
// data travels with the library: move or export the root and the games follow.
// Find-or-create, and tagged #gameTrackerDatabase so a renamed note is still
// found.
function resolveDatabaseNote(settings) {
    const root = requireLibraryRoot(settings)

    const tagged = root.getChildNotes().find(n => !n.isDeleted && n.hasLabel("gameTrackerDatabase"))
    if (tagged) return tagged

    const byTitle = root.getChildNotes().find(n => !n.isDeleted && n.title === DATABASE_TITLE)
    if (byTitle) {
        byTitle.setLabel("gameTrackerDatabase")
        return byTitle
    }

    const { note } = api.createNewNote({
        parentNoteId: root.noteId,
        title: DATABASE_TITLE,
        type: "code",
        mime: "application/json",
        content: tracker.serializeDocument(tracker.emptyDocument())
    })
    note.setLabel("gameTrackerDatabase")
    note.setLabel("iconClass", "bx bx-data")
    return note
}

function loadDocument(settings) {
    return tracker.parseDocument(resolveDatabaseNote(settings).getContent())
}

function saveDocument(settings, doc) {
    resolveDatabaseNote(settings).setContent(tracker.serializeDocument(doc))
}

function today() {
    return new Date().toISOString().slice(0, 10)
}

// --- http helpers -----------------------------------------------------------

const USER_AGENT = "game-tracker-beatlink/1.0.0"

function outboundHeaders(headers) {
    return { "User-Agent": USER_AGENT, ...(headers || {}) }
}

async function getJson(url, headers) {
    const res = await fetch(url, { headers: outboundHeaders(headers) })
    if (res.ok) return res.json()

    let detail = ""
    try {
        const body = await res.json()
        detail = body.message || body.error_description || body.error || ""
    } catch (e) {
        // Non-JSON error body; the status alone will have to do.
    }
    throw new Error(detail
        ? `${detail} (HTTP ${res.status})`
        : `Request failed (HTTP ${res.status})`)
}

// --- IGDB authentication ----------------------------------------------------
//
// IGDB authenticates as a Twitch application using the client-credentials grant.
// The token is an app token, not a user token: there is no user to authorize and
// no refresh token. It simply expires (typically ~60 days) and is re-fetched.
//
// Credentials are trimmed at every use: a client id pasted from the Twitch
// developer console often carries a trailing space or newline, which Twitch
// reports as "invalid client" -- indistinguishable from a genuinely wrong id.

function igdbClientId(settings) {
    return String(settings.igdbClientId || "").trim()
}

function igdbClientSecret(settings) {
    return String(settings.igdbClientSecret || "").trim()
}

// Returns a valid access token, fetching a new one when the stored token is
// missing or close to expiry. Refreshed a day early so a long import can't
// expire mid-run.
async function igdbToken(settings) {
    const clientId = igdbClientId(settings)
    const clientSecret = igdbClientSecret(settings)
    if (!clientId || !clientSecret) {
        throw new Error("Set an IGDB (Twitch) Client ID and Client Secret in Settings first")
    }

    const expiresAt = Number(settings.igdbTokenExpiresAt) || 0
    const now = Math.floor(Date.now() / 1000)
    if (settings.igdbAccessToken && now < expiresAt - 86400) return settings.igdbAccessToken

    // Verified against api-docs.igdb.com: the credentials go in the query string
    // on this endpoint, not in a JSON body.
    const url = `${TWITCH_OAUTH}?client_id=${encodeURIComponent(clientId)}`
        + `&client_secret=${encodeURIComponent(clientSecret)}`
        + `&grant_type=client_credentials`

    const res = await fetch(url, { method: "POST", headers: outboundHeaders() })
    if (!res.ok) {
        let detail = ""
        try {
            const body = await res.json()
            detail = body.message || body.error || ""
        } catch (e) {
            // Fall through to the status-only message.
        }
        if (res.status === 400 || res.status === 401 || res.status === 403) {
            throw new Error(
                `Twitch rejected the IGDB credentials${detail ? `: ${detail}` : ""} (HTTP ${res.status}). `
                + "Check the Client ID and Client Secret against your app at "
                + "dev.twitch.tv/console/apps — the Client Type must be Confidential "
                + "for a secret to exist at all."
            )
        }
        throw new Error(`Could not obtain an IGDB token (HTTP ${res.status})`)
    }

    const json = await res.json()
    persistFields({
        igdbAccessToken: json.access_token,
        igdbTokenExpiresAt: now + (Number(json.expires_in) || 0)
    })
    return json.access_token
}

// One IGDB query. The APIcalypse query goes in the request BODY as plain text;
// `fields`/`where`/`limit` are all expressed there rather than as parameters.
async function igdbQuery(settings, endpoint, body) {
    const token = await igdbToken(settings)
    const res = await fetch(`${IGDB_API}/${endpoint}`, {
        method: "POST",
        headers: outboundHeaders({
            "Client-ID": igdbClientId(settings),
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json"
        }),
        body
    })

    if (res.status === 401 || res.status === 403) {
        // The stored token is stale or was revoked. Drop it so the next call
        // fetches a fresh one rather than failing identically forever.
        persistFields({ igdbAccessToken: "", igdbTokenExpiresAt: 0 })
        throw new Error("IGDB rejected the access token. It has been cleared — try again.")
    }
    if (res.status === 429) {
        throw new Error("IGDB rate limit reached (4 requests/second). Wait a moment and retry.")
    }
    if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(`IGDB request failed (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`)
    }

    return res.json()
}

// IGDB's rate limit is 4 requests/second. Sequential awaits alone don't
// guarantee that when responses are fast, so calls that loop are spaced.
function pause(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

// A quoted APIcalypse string literal. Quotes and backslashes are escaped so a
// title containing one can't terminate the literal and change the query.
function quote(value) {
    return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

// --- IGDB mapping -----------------------------------------------------------

// The field list every game lookup requests. Kept in one place so search,
// details, and refresh all store exactly the same shape.
//
// Dotted fields are IGDB "expanders": genres.name pulls the related genre's name
// in the same request rather than needing a second call per id.
const GAME_FIELDS = "id,name,slug,summary,storyline,first_release_date,"
    + "cover.image_id,genres.name,platforms.name,involved_companies.company.name,"
    + "involved_companies.developer,involved_companies.publisher,"
    + "total_rating,total_rating_count,url"

function releaseYear(seconds) {
    const value = Number(seconds)
    if (!Number.isFinite(value) || value <= 0) return ""
    return new Date(value * 1000).toISOString().slice(0, 4)
}

function mapGame(raw, settings) {
    return {
        igdbId: String(raw.id),
        title: raw.name || "",
        year: releaseYear(raw.first_release_date),
        summary: raw.summary || "",
        cover: tracker.coverUrl(raw.cover?.image_id, settings.coverSize),
        genres: (raw.genres || []).map(g => g.name).filter(Boolean).join(", "),
        platforms: (raw.platforms || []).map(p => p.name).filter(Boolean).join(", ")
    }
}

// IGDB's `search` sorts by relevance but returns versions, bundles, and DLC
// alongside the base game. `where` clauses can't be combined with `search` on
// some endpoints, so filtering stays minimal: results with no name are dropped
// and the rest are kept in IGDB's own order.
async function igdbSearch(settings, query) {
    const text = String(query || "").trim()
    if (!text) return []

    const rows = await igdbQuery(settings, "games",
        `search ${quote(text)}; fields ${GAME_FIELDS}; limit 30;`)

    // Each result is marked with whether it's already tracked, so the UI can say
    // so instead of offering an Add that turns out to be a no-op.
    // The library root may not be set yet -- searching before that is legitimate,
    // so treat an unreadable document as "nothing tracked" rather than failing.
    let doc = { games: {} }
    try {
        doc = loadDocument(settings)
    } catch (e) {
        // No library root configured yet.
    }

    return (rows || [])
        .filter(r => r && r.name)
        .map(raw => {
            const game = mapGame(raw, settings)
            return { ...game, trackedKey: tracker.findGame(doc, game) || "" }
        })
}

async function igdbById(settings, igdbId) {
    const rows = await igdbQuery(settings, "games",
        `fields ${GAME_FIELDS}; where id = ${Number(igdbId)};`)
    if (!rows?.length) throw new Error("IGDB has no game with that id")
    return mapGame(rows[0], settings)
}

async function igdbBySlug(settings, slug) {
    const rows = await igdbQuery(settings, "games",
        `fields ${GAME_FIELDS}; where slug = ${quote(slug)};`)
    if (!rows?.length) throw new Error(`IGDB has no game with the slug "${slug}"`)
    return mapGame(rows[0], settings)
}

// Resolve Steam appids to IGDB ids in bulk through the external_games endpoint.
// One request covers many appids, which is what keeps a 900-game Steam import
// inside IGDB's rate limit instead of making a request per game.
//
// Returns a Map of appid (string) -> igdbId (string).
async function igdbIdsForSteamAppIds(settings, appIds, onProgress) {
    const found = new Map()
    const ids = [...new Set(appIds.map(String).filter(Boolean))]
    if (!ids.length) return found

    // IGDB caps a response at 500 rows, so batches stay under it.
    const BATCH = 200
    for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH)
        // `uid` is a string field on external_games, so the values are quoted.
        const list = batch.map(id => quote(id)).join(",")
        const rows = await igdbQuery(settings, "external_games",
            `fields game,uid,category; where category = ${EXTERNAL_STEAM} & uid = (${list}); limit 500;`)

        for (const row of rows || []) {
            const uid = String(row.uid || "")
            const gameId = row.game?.id ?? row.game
            if (uid && gameId) found.set(uid, String(gameId))
        }

        if (onProgress) onProgress(Math.min(i + BATCH, ids.length), ids.length)
        // Stay well inside the 4 req/s limit.
        if (i + BATCH < ids.length) await pause(300)
    }

    return found
}

// Full metadata for a set of IGDB ids, in bulk. Same batching rationale as
// above: one request per 200 games rather than one per game.
async function igdbGamesByIds(settings, igdbIds) {
    const out = new Map()
    const ids = [...new Set(igdbIds.map(String).filter(Boolean))]
    if (!ids.length) return out

    const BATCH = 200
    for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH)
        const rows = await igdbQuery(settings, "games",
            `fields ${GAME_FIELDS}; where id = (${batch.join(",")}); limit 500;`)
        for (const raw of rows || []) out.set(String(raw.id), mapGame(raw, settings))
        if (i + BATCH < ids.length) await pause(300)
    }
    return out
}

// --- game mutations ---------------------------------------------------------

async function addGame(settings, igdbId) {
    const details = await igdbById(settings, igdbId)
    return upsertGame(settings, details)
}

// Shared by every "add one game" path so they behave identically.
function upsertGame(settings, details) {
    const doc = loadDocument(settings)
    const existingKey = tracker.findGame(doc, details)

    if (existingKey) {
        // Refresh metadata but keep the user's own status/rating/playtime.
        const existing = doc.games[existingKey]
        doc.games[existingKey] = {
            ...existing,
            igdbId: details.igdbId || existing.igdbId || "",
            steamAppId: details.steamAppId || existing.steamAppId || "",
            title: details.title,
            year: details.year,
            summary: details.summary,
            cover: details.cover,
            genres: details.genres,
            platforms: details.platforms
        }
        saveDocument(settings, doc)
        return { key: existingKey, title: details.title, existed: true }
    }

    const key = tracker.gameKey(details)
    if (!key) throw new Error("That game has no IGDB or Steam id, so it cannot be tracked")

    doc.games[key] = tracker.normalizeGame({
        ...details,
        status: settings.defaultStatus || "backlog",
        addedAt: today()
    })
    saveDocument(settings, doc)
    return { key, title: details.title, existed: false }
}

function requireEntry(doc, key) {
    const entry = doc.games[key]
    if (!entry) throw new Error("That game is not in the library")
    return entry
}

function setStatus(settings, key, status) {
    if (!tracker.STATUSES.includes(status)) throw new Error(`Unknown status: ${status}`)
    const doc = loadDocument(settings)
    const entry = requireEntry(doc, key)
    entry.status = status
    if (status === "playing" || status === "beaten") entry.lastPlayed = today()
    saveDocument(settings, doc)
    return { ok: true }
}

function setRating(settings, key, rating) {
    const value = Number(rating)
    if (!Number.isFinite(value) || value < 0 || value > 10) throw new Error("Rating must be 0-10")
    const doc = loadDocument(settings)
    const entry = requireEntry(doc, key)
    entry.rating = value > 0 ? value : null
    saveDocument(settings, doc)
    return { ok: true }
}

// Playtime is entered in hours (what the UI shows) but stored in minutes (what
// Steam reports), so a hand-typed value and an imported one stay comparable.
function setPlaytime(settings, key, hours) {
    const value = Number(hours)
    if (!Number.isFinite(value) || value < 0) throw new Error("Playtime must be zero or more hours")
    const doc = loadDocument(settings)
    const entry = requireEntry(doc, key)
    entry.playtime = Math.round(value * 60)
    saveDocument(settings, doc)
    return { ok: true, playtime: entry.playtime }
}

// Add a game from a pasted IGDB or Steam link (or a bare Steam appid).
async function addFromLink(settings, input) {
    const parsed = tracker.parseGameLink(input)
    if (!parsed) {
        throw new Error("Not an IGDB or Steam link. Expected something like "
            + "https://www.igdb.com/games/hades or "
            + "https://store.steampowered.com/app/1145360/Hades/")
    }

    if (parsed.igdbSlug) return upsertGame(settings, await igdbBySlug(settings, parsed.igdbSlug))

    // A Steam appid is resolved to its IGDB entry so the game gets full
    // metadata; if IGDB doesn't know it, fall back to the Steam store's own
    // data rather than refusing.
    const mapped = await igdbIdsForSteamAppIds(settings, [parsed.steamAppId])
    const igdbId = mapped.get(String(parsed.steamAppId))
    if (igdbId) {
        const details = await igdbById(settings, igdbId)
        return upsertGame(settings, { ...details, steamAppId: String(parsed.steamAppId) })
    }

    const store = await steamStoreDetails(parsed.steamAppId)
    if (!store) {
        throw new Error(`Neither IGDB nor Steam has a game for appid ${parsed.steamAppId}.`)
    }
    return upsertGame(settings, store)
}

// Persist the Library view's filter/sort choices so they survive a reload.
// Only the known keys are accepted, so a stray query parameter can't write
// arbitrary settings. The search box is deliberately not remembered: a filter
// that silently hides most of the library on load reads as data loss.
const VIEW_FIELDS = {
    statusFilter: "viewStatusFilter",
    platformFilter: "viewPlatformFilter",
    collectionFilter: "viewCollectionFilter",
    groupFilters: "viewGroupFilters",
    genreFilter: "viewGenreFilter",
    sortKey: "viewSortKey",
    sortDesc: "viewSortDesc",
    grouped: "viewGrouped"
}

function saveViewState(query) {
    const fields = {}
    for (const [param, setting] of Object.entries(VIEW_FIELDS)) {
        const value = query[param]
        if (value === undefined) continue
        fields[setting] = (setting === "viewSortDesc" || setting === "viewGrouped")
            ? value === "true"
            : String(value)
    }
    if (Object.keys(fields).length) persistFields(fields)
    return { ok: true }
}

// Every collection the panel should show: those actually in use on games, plus
// any that exist only as a group assignment. A collection created in Settings has
// no members yet, and collections are otherwise derived from games, so without
// this it would vanish the moment it was created.
function collectionRows(doc, config) {
    const seen = new Map()
    for (const name of tracker.listCollections(doc)) {
        seen.set(name.toLowerCase(), { name, group: tracker.groupOf(config, name), inUse: true })
    }
    for (const [key, group] of Object.entries(config.assign)) {
        if (seen.has(key)) continue
        const display = config.names?.[key] || key
        seen.set(key, { name: display, group, inUse: false })
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// Removes a collection from every game that carries it, or renames it across
// all of them. Collections are derived from the games rather than stored in
// their own list, so a collection ceases to exist exactly when no game
// references it -- there is nothing else to delete.
function renameCollection(settings, from, to) {
    const source = String(from || "").trim().toLowerCase()
    if (!source) throw new Error("Which collection?")

    const target = String(to || "").trim()
    const doc = loadDocument(settings)
    let changed = 0

    for (const entry of Object.values(doc.games)) {
        const names = tracker.normalizeCollections(entry.collections)
        if (!names.some(n => n.toLowerCase() === source)) continue

        const rest = names.filter(n => n.toLowerCase() !== source)
        // A blank target means delete; otherwise re-add under the new name unless
        // the game already has it (which is how a merge collapses).
        const next = target && !rest.some(n => n.toLowerCase() === target.toLowerCase())
            ? [...rest, target]
            : rest

        entry.collections = tracker.normalizeCollections(next)
        changed++
    }

    if (changed) saveDocument(settings, doc)
    return { ok: true, changed, deleted: !target }
}

// Collections are tags: the whole set is replaced at once, sent comma-separated.
function setCollections(settings, key, raw) {
    const doc = loadDocument(settings)
    const entry = requireEntry(doc, key)
    entry.collections = tracker.normalizeCollections(String(raw || "").split(","))
    saveDocument(settings, doc)
    return { ok: true, collections: entry.collections }
}

function removeGame(settings, key) {
    const doc = loadDocument(settings)
    requireEntry(doc, key)
    delete doc.games[key]
    saveDocument(settings, doc)
    return { ok: true }
}

// Full metadata for the details page: everything a game lookup returns, plus
// screenshots, companies, and IGDB's aggregate rating.
//
// Every field is read defensively -- IGDB omits fields it has no data for (an
// unreleased game has no screenshots or rating), so a missing value must render
// as blank rather than "undefined".
async function fullDetails(settings, igdbId, key) {
    const rows = await igdbQuery(settings, "games",
        `fields ${GAME_FIELDS},screenshots.image_id,similar_games.name,similar_games.id,`
        + `game_modes.name,player_perspectives.name,themes.name;`
        + ` where id = ${Number(igdbId)};`)
    if (!rows?.length) throw new Error("IGDB has no game with that id")
    const raw = rows[0]

    const companies = { developers: [], publishers: [] }
    for (const involved of raw.involved_companies || []) {
        const name = involved.company?.name
        if (!name) continue
        if (involved.developer) companies.developers.push(name)
        if (involved.publisher) companies.publishers.push(name)
    }

    const details = {
        ...mapGame(raw, settings),
        storyline: raw.storyline || "",
        url: raw.url || "",
        totalRating: Number.isFinite(Number(raw.total_rating)) ? Number(raw.total_rating) : null,
        totalRatingCount: Number(raw.total_rating_count) || 0,
        developers: [...new Set(companies.developers)],
        publishers: [...new Set(companies.publishers)],
        modes: (raw.game_modes || []).map(m => m.name).filter(Boolean),
        perspectives: (raw.player_perspectives || []).map(p => p.name).filter(Boolean),
        themes: (raw.themes || []).map(t => t.name).filter(Boolean),
        screenshots: (raw.screenshots || [])
            .slice(0, 8)
            .map(s => tracker.coverUrl(s.image_id, "screenshot_med"))
            .filter(Boolean),
        similar: (raw.similar_games || [])
            .filter(g => g?.name)
            .slice(0, 8)
            .map(g => ({ id: String(g.id), name: g.name }))
    }

    // The entry's own tracked state, so the page can show status and playtime.
    const doc = loadDocument(settings)
    const entry = key && doc.games[key] ? tracker.normalizeGame(doc.games[key]) : null

    return { ...details, entry }
}

// --- housekeeping -----------------------------------------------------------

// Re-derives everything that can drift: refreshes metadata and covers from IGDB
// and backfills missing IGDB ids from Steam appids. Reads the document once and
// writes once, like the importers. Never changes a rating, status, or playtime.
async function refreshLibrary(settings) {
    const doc = loadDocument(settings)
    const entries = Object.entries(doc.games)

    let metadataUpdated = 0
    let linked = 0
    let failed = 0

    // Backfill IGDB ids for Steam-only entries first, in bulk, so the metadata
    // pass below can cover them too.
    const unlinked = entries
        .filter(([, raw]) => !raw.igdbId && raw.steamAppId)
        .map(([, raw]) => String(raw.steamAppId))

    if (unlinked.length) {
        try {
            const mapped = await igdbIdsForSteamAppIds(settings, unlinked)
            for (const [, raw] of entries) {
                if (raw.igdbId || !raw.steamAppId) continue
                const igdbId = mapped.get(String(raw.steamAppId))
                if (igdbId) { raw.igdbId = igdbId; linked++ }
            }
        } catch (e) {
            // A failed link pass shouldn't stop the metadata refresh.
            failed++
        }
    }

    // One bulk fetch for every entry that has an IGDB id.
    const withIgdb = entries.filter(([, raw]) => raw.igdbId).map(([, raw]) => String(raw.igdbId))
    let fetched = new Map()
    if (withIgdb.length) {
        try {
            fetched = await igdbGamesByIds(settings, withIgdb)
        } catch (e) {
            failed++
        }
    }

    for (const [key, raw] of entries) {
        const entry = tracker.normalizeGame(raw)
        const details = entry.igdbId ? fetched.get(entry.igdbId) : null

        if (details) {
            const before = JSON.stringify([
                entry.title, entry.cover, entry.summary, entry.genres,
                entry.platforms, entry.year
            ])

            entry.title = details.title || entry.title
            entry.year = details.year || entry.year
            entry.summary = details.summary || entry.summary
            entry.cover = details.cover || entry.cover
            entry.genres = details.genres || entry.genres
            entry.platforms = details.platforms || entry.platforms

            const after = JSON.stringify([
                entry.title, entry.cover, entry.summary, entry.genres,
                entry.platforms, entry.year
            ])
            if (before !== after) metadataUpdated++
        }

        doc.games[key] = entry
    }

    saveDocument(settings, doc)
    return { total: entries.length, metadataUpdated, linked, failed }
}

// --- Steam ------------------------------------------------------------------
//
// Read-only. Steam is never written to; there is no endpoint here that would.
//
// GetOwnedGames requires the profile's game details to be public. When they are
// not, Steam answers 200 with an empty `response` object rather than an error,
// which is why an empty result is reported as a privacy problem rather than an
// empty library.

function steamKey(settings) {
    return String(settings.steamApiKey || "").trim()
}

function steamId(settings) {
    return String(settings.steamId || "").trim()
}

function requireSteam(settings) {
    const key = steamKey(settings)
    const id = steamId(settings)
    if (!key) throw new Error("Set a Steam Web API key in Settings first")
    if (!id) throw new Error("Set your SteamID64 in Settings first")
    if (!/^\d{17}$/.test(id)) {
        throw new Error(`"${id}" is not a SteamID64. It is a 17-digit number starting with 7656 — `
            + "use the Look up button on the Steam tab to convert a profile name or URL.")
    }
    return { key, id }
}

// Resolves a vanity profile name to a SteamID64, so the user can paste what they
// actually have (a profile URL) rather than hunting for the numeric id.
// Accepts a bare name, /id/name, or a full profile URL.
async function steamResolveVanity(settings, input) {
    const key = steamKey(settings)
    if (!key) throw new Error("Set a Steam Web API key in Settings first")

    const text = String(input || "").trim()
    if (!text) throw new Error("Enter a Steam profile name or URL")

    // A /profiles/ URL already carries the numeric id.
    const direct = /(?:profiles\/)?(\d{17})/.exec(text)
    if (direct) return { steamId: direct[1], resolved: false }

    const vanity = /steamcommunity\.com\/id\/([^/?#]+)/i.exec(text)
    const name = vanity ? vanity[1] : text.replace(/^\/+|\/+$/g, "")

    const json = await getJson(`${STEAM_API}/ISteamUser/ResolveVanityURL/v1/`
        + `?key=${encodeURIComponent(key)}&vanityurl=${encodeURIComponent(name)}`)

    // success = 1 means resolved; 42 means no match.
    if (json.response?.success !== 1 || !json.response?.steamid) {
        throw new Error(`Steam has no profile called "${name}".`)
    }
    return { steamId: json.response.steamid, resolved: true }
}

// Fetches the owned-games list. Field names are Valve's own, from the published
// protobuf for IPlayerService: appid, name, playtime_forever (minutes),
// rtime_last_played (unix seconds), img_icon_url.
async function steamOwnedGames(settings) {
    const { key, id } = requireSteam(settings)

    const json = await getJson(`${STEAM_API}/IPlayerService/GetOwnedGames/v1/`
        + `?key=${encodeURIComponent(key)}&steamid=${encodeURIComponent(id)}`
        + `&include_appinfo=true&include_played_free_games=true&format=json`)

    const games = json.response?.games
    if (!Array.isArray(games)) {
        throw new Error("Steam returned no game list. That normally means the profile's "
            + "game details are not public: set Steam → Profile → Privacy Settings → "
            + "Game details to Public, then try again.")
    }
    return games
}

// A quick, read-only check so the Steam credentials can be verified before
// committing to a full import.
async function steamCheck(settings) {
    const games = await steamOwnedGames(settings)
    const played = games.filter(g => Number(g.playtime_forever) > 0).length
    return { total: games.length, played }
}

// Steam's public store API, used only as a fallback when IGDB has no entry for
// an appid. No key required. Returns null rather than throwing, since a missing
// store page must never fail an import.
async function steamStoreDetails(appId) {
    try {
        const json = await getJson(`${STEAM_STORE}/appdetails?appids=${encodeURIComponent(appId)}`)
        const entry = json?.[String(appId)]
        if (!entry?.success || !entry.data) return null
        const data = entry.data

        return {
            igdbId: "",
            steamAppId: String(appId),
            title: data.name || "",
            year: /(\d{4})/.exec(data.release_date?.date || "")?.[1] || "",
            summary: data.short_description || "",
            cover: data.header_image || "",
            genres: (data.genres || []).map(g => g.description).filter(Boolean).join(", "),
            platforms: "PC (Microsoft Windows)"
        }
    } catch (e) {
        return null
    }
}

// One-way import of the Steam library.
//
// Steam knows appids and playtime; IGDB knows everything else. So the appids are
// resolved to IGDB ids in bulk first (a handful of requests for a whole library),
// then metadata is fetched in bulk for the ones that matched. A game IGDB doesn't
// know is still imported, keyed by its Steam appid, with the name and playtime
// Steam supplied -- it just has no cover or genres until IGDB learns about it.
async function importSteam(settings) {
    const owned = await steamOwnedGames(settings)

    // `onlyPlayed` keeps a 900-game "owned but never launched" library out of the
    // tracker for people who only want what they've actually played.
    const rows = settings.steamOnlyPlayed
        ? owned.filter(g => Number(g.playtime_forever) > 0)
        : owned

    const appIds = rows.map(g => String(g.appid)).filter(Boolean)

    // Resolve to IGDB in bulk. A failure here is not fatal: the import falls
    // back to Steam's own names so the library is still populated.
    let mapped = new Map()
    let metadata = new Map()
    if (settings.importFetchMetadata !== false) {
        try {
            mapped = await igdbIdsForSteamAppIds(settings, appIds)
            metadata = await igdbGamesByIds(settings, [...mapped.values()])
        } catch (e) {
            // Metadata is a nice-to-have; never fail an import over it.
        }
    }

    const items = []
    for (const row of rows) {
        const appId = String(row.appid)
        const igdbId = mapped.get(appId) || ""
        const details = igdbId ? metadata.get(igdbId) : null

        items.push({
            igdbId,
            steamAppId: appId,
            // IGDB's name wins when known: it is the canonical title, where
            // Steam's often carries edition and trademark noise.
            title: details?.title || row.name || "Untitled",
            year: details?.year || "",
            summary: details?.summary || "",
            cover: details?.cover || "",
            genres: details?.genres || "",
            platforms: details?.platforms || "",
            playtime: Number(row.playtime_forever) || 0,
            // rtime_last_played is unix seconds; 0 means never played.
            lastPlayed: Number(row.rtime_last_played) > 0
                ? new Date(Number(row.rtime_last_played) * 1000).toISOString().slice(0, 10)
                : ""
        })
    }

    return applyImport(settings, items)
}

// --- shared import ----------------------------------------------------------

// One-way and idempotent: matches each incoming item against the document by any
// shared id, and never touches a rating unless explicitly allowed. Reads the
// document once and writes once, so a large import is a single note write and
// can't half-apply.
function applyImport(settings, items) {
    const doc = loadDocument(settings)
    let added = 0
    let updated = 0

    for (const item of items) {
        const existingKey = tracker.findGame(doc, item)
        const key = existingKey || tracker.gameKey(item)
        if (!key) continue

        const previous = doc.games[key] || {}

        // A rating from the source is only taken when the user opted in;
        // otherwise their own rating always wins.
        const incomingRating = Number.isFinite(Number(item.rating)) ? Number(item.rating) : null
        const rating = (settings.importOverwriteRatings && incomingRating !== null)
            ? incomingRating
            : (previous.rating ?? null)

        // Playtime is authoritative from Steam (it is the total Steam has
        // recorded, not a delta), but a smaller incoming value never overwrites
        // a larger stored one: time played on another platform, or entered by
        // hand, would otherwise be silently discarded.
        const incomingPlaytime = Number(item.playtime) || 0
        const previousPlaytime = Number(previous.playtime) || 0
        const playtime = Math.max(incomingPlaytime, previousPlaytime)

        const entry = tracker.normalizeGame({
            ...previous,
            // Only overwrite metadata fields the import actually supplied, so a
            // Steam-only row can't blank out metadata IGDB gave an earlier run.
            igdbId: item.igdbId || previous.igdbId || "",
            steamAppId: item.steamAppId || previous.steamAppId || "",
            title: item.title || previous.title || "Untitled",
            year: item.year || previous.year || "",
            summary: item.summary || previous.summary || "",
            cover: item.cover || previous.cover || "",
            genres: item.genres || previous.genres || "",
            platforms: item.platforms || previous.platforms || "",
            // Preserve the user's own fields across a re-import.
            status: previous.status,
            rating,
            playtime,
            addedAt: previous.addedAt || today()
        })

        // The later of the two: re-importing must never move a game's last-played
        // date backwards.
        if (item.lastPlayed && String(item.lastPlayed) > String(entry.lastPlayed || "")) {
            entry.lastPlayed = String(item.lastPlayed).slice(0, 10)
        }

        // Status only ever moves out of the backlog, and only when the source
        // shows the game has been played. Whether it was finished is the user's
        // call, so an import never sets "beaten".
        if (settings.importMarksPlaying !== false) {
            entry.status = tracker.statusFromPlaytime(previous.status, playtime)
        }

        doc.games[key] = entry
        existingKey ? updated++ : added++
    }

    saveDocument(settings, doc)
    return { added, updated, total: added + updated }
}

// --- routing ----------------------------------------------------------------

function sendJson(status, obj) {
    api.res.status(status).json(obj)
}

async function handle() {
    const query = api.req.query
    const action = query.action

    try {
        const settings = getSettings()

        switch (action) {
            case "listGames": {
                const doc = loadDocument(settings)
                const collections = tracker.listCollections(doc)
                const groupConfig = tracker.parseGroupConfig(settings.collectionGroups)
                return sendJson(200, {
                    games: tracker.listGames(doc),
                    collections,
                    // One entry per group that actually has collections; the
                    // widget renders a dropdown for each.
                    collectionGroups: tracker.collectionsByGroup(collections, groupConfig),
                    // Only genres the user hasn't hidden reach the filter row, and
                    // none at all when the genre system is switched off.
                    genres: settings.genresEnabled === false
                        ? []
                        : tracker.visibleGenres(doc, settings.hiddenGenres),
                    platforms: tracker.listPlatforms(doc)
                })
            }
            // Every genre in the library plus its hidden state, for the settings
            // panel. Separate from listGames because that one deliberately omits
            // hidden genres, and the panel needs to show them to un-hide them.
            case "listAllGenres": {
                const doc = loadDocument(settings)
                const hidden = tracker.hiddenSet(settings.hiddenGenres)
                return sendJson(200, {
                    genres: tracker.listGenres(doc).map(name => ({
                        name,
                        hidden: hidden.has(name.toLowerCase())
                    }))
                })
            }
            case "setHiddenGenres":
                persistFields({ hiddenGenres: String(query.hiddenGenres || "") })
                return sendJson(200, { ok: true })
            case "collectionGroups": {
                const doc = loadDocument(settings)
                const config = tracker.parseGroupConfig(settings.collectionGroups)
                return sendJson(200, {
                    // Raw stored value, so a mismatch between what was saved and
                    // what is rendered can be seen rather than inferred.
                    raw: settings.collectionGroups ?? null,
                    groups: config.groups,
                    collections: collectionRows(doc, config)
                })
            }
            case "setCollectionGroups": {
                // Re-parsed before saving so an unknown group or malformed payload
                // can't be written into settings.
                const config = tracker.parseGroupConfig(query.config)
                persistFields({ collectionGroups: tracker.serializeGroupConfig(config) })

                // Return the state that was just written rather than making the
                // caller re-read it: a read issued immediately after the write can
                // still see the previous note content.
                const doc = loadDocument(settings)
                const stored = tracker.serializeGroupConfig(config)
                return sendJson(200, {
                    ok: true,
                    raw: stored,
                    groups: config.groups,
                    collections: tracker.listCollections(doc).map(name => ({
                        name,
                        group: tracker.groupOf(config, name)
                    }))
                })
            }
            case "saveViewState":
                return sendJson(200, saveViewState(query))
            case "setCollections":
                return sendJson(200, setCollections(settings, query.key, query.collections))
            case "renameCollection":
                return sendJson(200, renameCollection(settings, query.from, query.to))
            case "fullDetails":
                return sendJson(200, await fullDetails(settings, query.igdbId, query.key))
            case "refreshLibrary":
                return sendJson(200, await refreshLibrary(settings))
            case "search":
                return sendJson(200, { results: await igdbSearch(settings, query.query || "") })
            case "addGame":
                return sendJson(200, await addGame(settings, query.igdbId))
            case "addFromLink":
                return sendJson(200, await addFromLink(settings, query.url))
            case "removeGame":
                return sendJson(200, removeGame(settings, query.key))
            case "setStatus":
                return sendJson(200, setStatus(settings, query.key, query.status))
            case "setRating":
                return sendJson(200, setRating(settings, query.key, query.rating))
            case "setPlaytime":
                return sendJson(200, setPlaytime(settings, query.key, query.hours))
            case "steamResolveVanity":
                return sendJson(200, await steamResolveVanity(settings, query.input))
            case "steamCheck":
                return sendJson(200, await steamCheck(settings))
            case "importSteam":
                return sendJson(200, await importSteam(settings))
            default:
                return sendJson(400, { error: `Unknown action: ${action}` })
        }
    } catch (e) {
        return sendJson(500, { error: e.message })
    }
}

// Exported so the scheduled importer (autoSync.js) reuses these exact functions
// rather than reimplementing them.
module.exports = { importSteam }

// Only serve a request when there actually is one. Requiring this note for its
// exports must not trigger the HTTP handler, which would fail on the missing
// api.req/api.res.
if (typeof api !== "undefined" && api.req && api.res) handle()
