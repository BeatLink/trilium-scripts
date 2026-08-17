/*
 * game-tracker@beatlink — backend customRequestHandler ("gameTracker").
 *
 * One HTTP endpoint (custom/gameTracker) routed by ?action=:
 *
 *   listGames        read the whole library out of the database note
 *   search           provider search
 *   fullDetails      details plus screenshots and companies
 *   addGame          add a game to the database from a provider id
 *   addFromLink      add from a pasted IGDB, RAWG, or Steam link
 *   removeGame       drop a game from the database
 *   setStatus        set play status
 *   setRating        set rating
 *   setPlaytime      set playtime by hand (minutes)
 *   refreshLibrary   re-fetch metadata and backfill ids
 *   providerCheck    verify the configured metadata provider's credentials
 *   steamCheck       verify the Steam key/id and report the library size
 *   importSteam      one-way import of the Steam library
 *   previewImport    parse an uploaded library file and report what it matched
 *   importFile       apply a previewed file import
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
 * written to Steam, IGDB, or RAWG -- all three are strictly read-only.
 *
 * METADATA PROVIDERS
 *
 * Metadata comes from one of two interchangeable providers, chosen by the
 * `metadataProvider` setting. Both are reached only through the PROVIDERS table
 * below, which gives each one the same five operations (searchByName,
 * gamesByIds, gamesByTitles, fullDetails, bySteamAppId) returning the same
 * normalised shape. Nothing outside that table knows which provider is in use,
 * so a game's stored `igdbId` is really "the current provider's id" and the two
 * are never mixed within one library.
 *
 *   IGDB  - the richer source, but authenticating means registering a Twitch
 *           application, and Twitch requires 2FA on the account to allow that.
 *   RAWG  - a plain email signup, no OAuth and no 2FA, so it is the fallback
 *           when the Twitch requirement is a blocker. Thinner metadata (no
 *           storyline or game modes) but broader coverage of older and
 *           non-Steam titles.
 *
 * API contracts verified against live endpoints and first-party docs:
 *   IGDB auth     - api-docs.igdb.com: POST https://id.twitch.tv/oauth2/token with
 *                   client_id/client_secret/grant_type=client_credentials as QUERY
 *                   params; response { access_token, expires_in, token_type }.
 *   IGDB requests - POST https://api.igdb.com/v4/{endpoint}, headers Client-ID and
 *                   "Authorization: Bearer <token>", APIcalypse query in the BODY.
 *                   Rate limit 4 requests/second, 8 concurrent. Confirmed live:
 *                   a bad token returns a JSON "Authorization Failure" body.
 *                   Filters: `~ "name"` is case-insensitive exact match, `|` is
 *                   OR, and `limit` caps at 500.
 *   IGDB images   - https://images.igdb.com/igdb/image/upload/t_{size}/{hash}.jpg
 *   IGDB->Steam   - external_games where category = 1 (steam); `uid` is the appid.
 *   RAWG          - GET https://api.rawg.io/api/games?key=...&search=...  Field
 *                   names and parameters taken from RAWG's own OpenAPI schema
 *                   (api.rawg.io/docs/?format=openapi): id, slug, name, released,
 *                   background_image, metacritic, rating, genres[].name,
 *                   platforms[].platform.name, description_raw, developers[].name,
 *                   publishers[].name, and the search_exact/search_precise flags.
 *                   Confirmed live: a missing key returns 401 with a JSON body.
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
const RAWG_API = "https://api.rawg.io/api"
const GOG_CATALOG = "https://catalog.gog.com/v1"
const LUTRIS_API = "https://lutris.net/api"
const SGDB_API = "https://www.steamgriddb.com/api/v2"
const TGDB_API = "https://api.thegamesdb.net"
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

// IGDB's raw game -> the normalised shape every provider returns.
//
// `igdbId` is really "the metadata provider's id for this game". It keeps the
// IGDB name because that is what the stored documents already use, and because
// a library is only ever populated by one provider -- switching providers means
// re-linking, which refreshLibrary does.
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

// Resolve game titles to IGDB entries in bulk.
//
// An imported file (an IGDB GDPR export in particular) carries only display
// titles, no ids, so every row has to be matched by name. `~ "name"` is IGDB's
// case-insensitive exact-match operator and `(a,b,c)` is its OR-list, so many
// titles can be asked for in one request -- 186 games becomes a handful of
// requests rather than 186, which is what keeps this inside the 4 req/s limit.
//
// Returns a Map of lowercased title -> mapped game.
async function igdbGamesByTitles(settings, titles, onProgress) {
    const found = new Map()
    const wanted = [...new Set(
        titles.map(t => String(t || "").trim()).filter(Boolean)
    )]
    if (!wanted.length) return found

    // Smaller batches than the id lookups: an OR-list of quoted strings is far
    // longer per item than a list of numbers, and one game can match several
    // rows (editions, regional releases) against the 500-row response cap.
    const BATCH = 40
    for (let i = 0; i < wanted.length; i += BATCH) {
        const batch = wanted.slice(i, i + BATCH)
        const list = batch.map(name => `~ ${quote(name)}`).join(" | ")

        try {
            const rows = await igdbQuery(settings, "games",
                `fields ${GAME_FIELDS}; where ${list}; limit 500;`)

            for (const raw of rows || []) {
                const key = String(raw.name || "").trim().toLowerCase()
                if (!key) continue
                // IGDB returns every edition and port that matches the name.
                // Prefer the entry that actually carries metadata, since the
                // duplicates are usually bare stubs.
                const existing = found.get(key)
                const mapped = mapGame(raw, settings)
                if (!existing || (!existing.cover && mapped.cover)) found.set(key, mapped)
            }
        } catch (e) {
            // One failed batch must not lose the rest of the import.
        }

        if (onProgress) onProgress(Math.min(i + BATCH, wanted.length), wanted.length)
        if (i + BATCH < wanted.length) await pause(300)
    }

    return found
}

// --- RAWG -------------------------------------------------------------------
//
// The no-OAuth alternative to IGDB: a RAWG key is a plain string from an email
// signup, with no Twitch application and no 2FA requirement. Free tier is 20,000
// requests/month, which is why the bulk paths below still batch rather than
// firing one request per game.
//
// RAWG has no bulk-by-id or bulk-by-name endpoint, so where IGDB resolves 200
// games in one request, RAWG needs one request per game. That is the main
// practical difference between the two providers and the reason a large Steam
// import is noticeably slower on RAWG.

function rawgKey(settings) {
    const key = String(settings.rawgApiKey || "").trim()
    if (!key) throw new Error("Set a RAWG API key in Settings first")
    return key
}

async function rawgGet(settings, path, params) {
    const key = rawgKey(settings)
    const query = new URLSearchParams({ key, ...(params || {}) })
    const res = await fetch(`${RAWG_API}${path}?${query}`, { headers: outboundHeaders() })

    if (res.status === 401 || res.status === 403) {
        throw new Error("RAWG rejected the API key. Check it in Settings against "
            + "your key at rawg.io/apidocs.")
    }
    if (res.status === 429) {
        throw new Error("RAWG rate limit reached. The free tier allows 20,000 requests "
            + "per month; wait a while and retry.")
    }
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`RAWG request failed (HTTP ${res.status})`)

    return res.json()
}

// RAWG's raw game -> the same normalised shape mapGame produces for IGDB.
//
// Field names are from RAWG's OpenAPI schema. `description_raw` only exists on
// the single-game endpoint, so a search result has no summary until the game is
// actually opened or added.
function mapRawgGame(raw) {
    return {
        igdbId: String(raw.id),
        title: raw.name || "",
        year: String(raw.released || "").slice(0, 4),
        summary: raw.description_raw || "",
        // RAWG serves one image URL rather than IGDB's size-templated path, so
        // the coverSize setting has no effect here.
        cover: raw.background_image || "",
        genres: (raw.genres || []).map(g => g.name).filter(Boolean).join(", "),
        platforms: (raw.platforms || [])
            .map(p => p.platform?.name)
            .filter(Boolean)
            .join(", ")
    }
}

async function rawgSearch(settings, query) {
    const text = String(query || "").trim()
    if (!text) return []

    const json = await rawgGet(settings, "/games", { search: text, page_size: "30" })

    let doc = { games: {} }
    try {
        doc = loadDocument(settings)
    } catch (e) {
        // No library root configured yet.
    }

    return (json?.results || [])
        .filter(r => r && r.name)
        .map(raw => {
            const game = mapRawgGame(raw)
            return { ...game, trackedKey: tracker.findGame(doc, game) || "" }
        })
}

async function rawgById(settings, id) {
    // The detail endpoint accepts a numeric id or a slug, so both link forms
    // work without a separate lookup.
    const json = await rawgGet(settings, `/games/${encodeURIComponent(id)}`)
    if (!json?.id) throw new Error("RAWG has no game with that id")
    return mapRawgGame(json)
}

// One request per id: RAWG has no bulk endpoint. Spaced so a large import does
// not look like an attack.
async function rawgGamesByIds(settings, ids, onProgress) {
    const out = new Map()
    const wanted = [...new Set(ids.map(String).filter(Boolean))]

    for (let i = 0; i < wanted.length; i++) {
        try {
            out.set(wanted[i], await rawgById(settings, wanted[i]))
        } catch (e) {
            // Skip a game RAWG can't serve rather than losing the whole batch.
        }
        if (onProgress) onProgress(i + 1, wanted.length)
        if (i + 1 < wanted.length) await pause(120)
    }
    return out
}

// Title matching. `search_exact` tells RAWG to treat the query as an exact
// phrase rather than fuzzy-matching it, which is what makes a title-only import
// land on the right game instead of a sequel.
async function rawgGamesByTitles(settings, titles, onProgress) {
    const found = new Map()
    const wanted = [...new Set(titles.map(t => String(t || "").trim()).filter(Boolean))]

    for (let i = 0; i < wanted.length; i++) {
        const title = wanted[i]
        try {
            const json = await rawgGet(settings, "/games", {
                search: title,
                search_exact: "true",
                page_size: "5"
            })
            const results = json?.results || []
            // Accept only a genuine name match: RAWG still returns near misses,
            // and silently importing "Tropico 6" for "Tropico" is worse than
            // reporting the row as unmatched.
            const exact = results.find(r =>
                normalizeTitle(r.name) === normalizeTitle(title))
            if (exact) found.set(title.toLowerCase(), mapRawgGame(exact))
        } catch (e) {
            // One failed lookup must not lose the rest of the import.
        }
        if (onProgress) onProgress(i + 1, wanted.length)
        if (i + 1 < wanted.length) await pause(120)
    }
    return found
}

// Punctuation and casing vary between sources ("Hitman 2" vs "HITMAN 2",
// "Half-Life" vs "Half Life"), so titles are compared on letters and digits
// alone. Deliberately not fuzzy beyond that: dropping a character would start
// matching sequels to each other.
function normalizeTitle(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, "")
}

// RAWG indexes store links, so a Steam appid can be resolved by asking for the
// game whose Steam store entry matches. There is no bulk form, so this is only
// used for single additions -- a Steam *import* keys off the appid directly and
// fills metadata in by title instead.
async function rawgBySteamAppId(settings, appId) {
    const store = await steamStoreDetails(appId)
    if (!store?.title) return null
    const matched = await rawgGamesByTitles(settings, [store.title])
    const hit = matched.get(store.title.toLowerCase())
    return hit ? { ...hit, steamAppId: String(appId) } : null
}

// --- Steam as a metadata source ---------------------------------------------
//
// Steam's storefront API needs no key at all, which makes it the only source
// that works with zero setup. It is genuinely rich for games that shipped on
// Steam -- description, genres, developers, screenshots, Metacritic -- but it
// has two hard limits that the source chain exists to cover:
//
//   * `platforms` is only {windows, mac, linux}. There is no console
//     information, so a Steam-only library has no PlayStation or Switch data.
//   * A game that never shipped on Steam simply is not there.
//
// Both endpoints are public and unauthenticated; verified live.

// Search the storefront by title. Returns the same shape as the other sources.
async function steamSearchByName(settings, query) {
    const text = String(query || "").trim()
    if (!text) return []

    const json = await getJson(`${STEAM_STORE}/storesearch/`
        + `?term=${encodeURIComponent(text)}&l=en&cc=US`)

    let doc = { games: {} }
    try {
        doc = loadDocument(settings)
    } catch (e) {
        // No library root configured yet.
    }

    // storesearch returns only a name and capsule image, so results are shallow
    // by design -- full metadata arrives when the game is actually added.
    return (json?.items || [])
        .filter(item => item && item.name && item.id)
        .map(item => {
            const game = {
                igdbId: "",
                steamAppId: String(item.id),
                title: item.name,
                year: "",
                summary: "",
                cover: item.tiny_image || "",
                genres: "",
                platforms: steamPlatformString(item.platforms)
            }
            return { ...game, trackedKey: tracker.findGame(doc, game) || "" }
        })
}

// Steam reports OS support, not the console platforms the other sources list.
// Named to match IGDB's spelling so the same platform filter covers both.
function steamPlatformString(platforms) {
    if (!platforms || typeof platforms !== "object") return ""
    const names = []
    if (platforms.windows) names.push("PC (Microsoft Windows)")
    if (platforms.mac) names.push("Mac")
    if (platforms.linux) names.push("Linux")
    return names.join(", ")
}

// Full metadata for one appid, mapped to the shared shape.
async function steamGameByAppId(settings, appId) {
    const details = await steamStoreDetails(appId)
    return details || null
}

// Resolve titles to Steam appids via the storefront search, accepting only an
// exact name match for the same reason RAWG's matcher does: importing
// "Hades II" for "Hades" is worse than reporting the row unmatched.
async function steamGamesByTitles(settings, titles, onProgress) {
    const found = new Map()
    const wanted = [...new Set(titles.map(t => String(t || "").trim()).filter(Boolean))]

    for (let i = 0; i < wanted.length; i++) {
        const title = wanted[i]
        try {
            const json = await getJson(`${STEAM_STORE}/storesearch/`
                + `?term=${encodeURIComponent(title)}&l=en&cc=US`)
            const exact = (json?.items || []).find(item =>
                item?.name && normalizeTitle(item.name) === normalizeTitle(title))
            if (exact) {
                // storesearch is shallow, so the full record is fetched for the
                // one match rather than for every candidate.
                const full = await steamStoreDetails(exact.id)
                if (full) found.set(title.toLowerCase(), full)
            }
        } catch (e) {
            // One failed lookup must not lose the rest.
        }
        if (onProgress) onProgress(i + 1, wanted.length)
        if (i + 1 < wanted.length) await pause(150)
    }
    return found
}

// --- GOG --------------------------------------------------------------------
//
// GOG's storefront catalog is public and needs no key. Its value in the chain is
// coverage of DRM-free and older PC titles Steam never carried, plus clean
// genre and developer data.
//
// Verified live against catalog.gog.com/v1/catalog: products carry id, slug,
// title, releaseDate ("YYYY.MM.DD"), coverVertical/coverHorizontal, developers,
// publishers, operatingSystems, and genres[].name. Search is fuzzy and ranks
// DLC and soundtracks alongside base games, so matching accepts only exact
// titles and prefers productType "game".

async function gogSearch(settings, query) {
    const text = String(query || "").trim()
    if (!text) return []

    const json = await getJson(`${GOG_CATALOG}/catalog`
        + `?limit=20&query=${encodeURIComponent(`like:${text}`)}`
        + `&locale=en-US&currencyCode=USD&countryCode=US`)

    let doc = { games: {} }
    try {
        doc = loadDocument(settings)
    } catch (e) {
        // No library root configured yet.
    }

    return (json?.products || [])
        .filter(p => p && p.title && p.productType !== "dlc")
        .map(raw => {
            const game = mapGogGame(raw)
            return { ...game, trackedKey: tracker.findGame(doc, game) || "" }
        })
}

function mapGogGame(raw) {
    return {
        // GOG ids live in their own namespace; the chain records them per source
        // rather than treating any one as the game's identity.
        igdbId: "",
        gogId: String(raw.id || ""),
        steamAppId: "",
        title: raw.title || "",
        // "2020.01.29"
        year: String(raw.releaseDate || "").slice(0, 4),
        summary: "",
        cover: raw.coverVertical || raw.coverHorizontal || "",
        genres: (raw.genres || []).map(g => g.name).filter(Boolean).join(", "),
        // GOG reports OS support, not console platforms.
        platforms: (raw.operatingSystems || [])
            .map(os => ({
                windows: "PC (Microsoft Windows)", osx: "Mac", mac: "Mac", linux: "Linux"
            })[String(os).toLowerCase()])
            .filter(Boolean)
            .join(", ")
    }
}

async function gogGamesByTitles(settings, titles, onProgress) {
    const found = new Map()
    const wanted = [...new Set(titles.map(t => String(t || "").trim()).filter(Boolean))]

    for (let i = 0; i < wanted.length; i++) {
        const title = wanted[i]
        try {
            const json = await getJson(`${GOG_CATALOG}/catalog`
                + `?limit=10&query=${encodeURIComponent(`like:${title}`)}`
                + `&locale=en-US&currencyCode=USD&countryCode=US`)
            // Exact name only, and never a DLC or soundtrack: GOG's fuzzy search
            // happily returns "The Pedestrian Soundtrack" for an unrelated query.
            const exact = (json?.products || []).find(p =>
                p?.title && p.productType !== "dlc"
                && normalizeTitle(p.title) === normalizeTitle(title))
            if (exact) found.set(title.toLowerCase(), mapGogGame(exact))
        } catch (e) {
            // One failed lookup must not lose the rest.
        }
        if (onProgress) onProgress(i + 1, wanted.length)
        if (i + 1 < wanted.length) await pause(150)
    }
    return found
}

// --- Lutris -----------------------------------------------------------------
//
// Public, no key. Community-contributed, so its data is uneven -- it dates Hades
// to its early-access year and sometimes lists only Windows for a
// multi-platform game -- which is why it belongs below IGDB and RAWG in the
// default order rather than above them.
//
// Its distinctive value is cross-referencing: a Lutris entry carries `steamid`
// and `gogslug`, so it can bridge a game's identity between stores when nothing
// else can.
//
// Verified live: /api/games?search= for search, /api/games/{slug} for detail,
// returning name, year, platforms[].name, genres[].name, description, coverart.

async function lutrisSearch(settings, query) {
    const text = String(query || "").trim()
    if (!text) return []

    const json = await getJson(`${LUTRIS_API}/games?search=${encodeURIComponent(text)}`)

    let doc = { games: {} }
    try {
        doc = loadDocument(settings)
    } catch (e) {
        // No library root configured yet.
    }

    return (json?.results || [])
        .filter(g => g && g.name)
        .slice(0, 20)
        .map(raw => {
            const game = mapLutrisGame(raw)
            return { ...game, trackedKey: tracker.findGame(doc, game) || "" }
        })
}

function mapLutrisGame(raw) {
    return {
        igdbId: "",
        lutrisSlug: String(raw.slug || ""),
        // The bridge: Lutris records the game's Steam appid where it knows one.
        steamAppId: raw.steamid ? String(raw.steamid) : "",
        gogSlug: String(raw.gogslug || ""),
        title: raw.name || "",
        year: raw.year ? String(raw.year) : "",
        summary: typeof raw.description === "string" ? raw.description.trim() : "",
        cover: raw.coverart || raw.banner_url || "",
        genres: (raw.genres || []).map(g => g.name).filter(Boolean).join(", "),
        platforms: (raw.platforms || []).map(p => p.name).filter(Boolean).join(", ")
    }
}

async function lutrisGamesByTitles(settings, titles, onProgress) {
    const found = new Map()
    const wanted = [...new Set(titles.map(t => String(t || "").trim()).filter(Boolean))]

    for (let i = 0; i < wanted.length; i++) {
        const title = wanted[i]
        try {
            const json = await getJson(`${LUTRIS_API}/games?search=${encodeURIComponent(title)}`)
            const exact = (json?.results || []).find(g =>
                g?.name && normalizeTitle(g.name) === normalizeTitle(title))
            if (exact) {
                // The search response omits `description`, so the detail record
                // is fetched for the one match.
                let full = exact
                try {
                    full = await getJson(`${LUTRIS_API}/games/${encodeURIComponent(exact.slug)}`) || exact
                } catch (e) {
                    // Fall back to the shallower search row.
                }
                found.set(title.toLowerCase(), mapLutrisGame(full))
            }
        } catch (e) {
            // One failed lookup must not lose the rest.
        }
        if (onProgress) onProgress(i + 1, wanted.length)
        if (i + 1 < wanted.length) await pause(150)
    }
    return found
}

// --- SteamGridDB ------------------------------------------------------------
//
// Art only: no genres, no summaries, no platforms. It exists in the chain purely
// to supply better cover art than the general sources manage, so it contributes
// exactly one field (`cover`) and leaves everything else to the others.
//
// Needs a free key (a plain signup, no OAuth). Contract taken from SteamGridDB's
// own npm client (steamgriddb@2.2.1): Bearer auth, every response wrapped as
// { success, data }, /search/autocomplete/{term}, /games/steam/{appid}, and
// /grids/game/{id} returning images with `url` and `thumb`.

function sgdbKey(settings) {
    const key = String(settings.steamGridDbApiKey || "").trim()
    if (!key) throw new Error("Set a SteamGridDB API key in Settings first")
    return key
}

async function sgdbGet(settings, path) {
    const res = await fetch(`${SGDB_API}${path}`, {
        headers: outboundHeaders({ Authorization: `Bearer ${sgdbKey(settings)}` })
    })

    if (res.status === 401 || res.status === 403) {
        throw new Error("SteamGridDB rejected the API key. Check it in Settings against "
            + "your key at steamgriddb.com/profile/preferences/api.")
    }
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`SteamGridDB request failed (HTTP ${res.status})`)

    const json = await res.json()
    // The envelope reports failure in-band rather than by status code.
    if (!json?.success) return null
    return json.data ?? null
}

// The best-scoring grid for a SteamGridDB game id. Grids are the vertical
// cover-style art, which is what this tracker displays.
async function sgdbCoverForGameId(settings, gameId) {
    const grids = await sgdbGet(settings, `/grids/game/${encodeURIComponent(gameId)}`)
    if (!Array.isArray(grids) || !grids.length) return ""
    // Highest community score first; `url` is the full-size image.
    const best = [...grids].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))[0]
    return best?.url ? String(best.url) : ""
}

// Art for a game, by Steam appid when known (exact) or by title (a search).
async function sgdbArtFor(settings, { steamAppId, title }) {
    try {
        if (steamAppId) {
            const game = await sgdbGet(settings, `/games/steam/${encodeURIComponent(steamAppId)}`)
            if (game?.id) {
                const cover = await sgdbCoverForGameId(settings, game.id)
                if (cover) return { title: game.name || "", cover }
            }
        }
        if (title) {
            const matches = await sgdbGet(settings,
                `/search/autocomplete/${encodeURIComponent(title)}`)
            const exact = (matches || []).find(m =>
                m?.name && normalizeTitle(m.name) === normalizeTitle(title))
            if (exact?.id) {
                const cover = await sgdbCoverForGameId(settings, exact.id)
                if (cover) return { title: exact.name || "", cover }
            }
        }
    } catch (e) {
        // Art is decorative; never fail a lookup over it.
    }
    return null
}

async function sgdbGamesByTitles(settings, titles, onProgress) {
    const found = new Map()
    const wanted = [...new Set(titles.map(t => String(t || "").trim()).filter(Boolean))]

    for (let i = 0; i < wanted.length; i++) {
        const title = wanted[i]
        const art = await sgdbArtFor(settings, { title })
        if (art?.cover) {
            // Only `cover` is populated: everything else is left empty so the
            // merge takes those fields from a real metadata source.
            found.set(title.toLowerCase(), {
                igdbId: "", steamAppId: "",
                title: art.title || title,
                year: "", summary: "", genres: "", platforms: "",
                cover: art.cover
            })
        }
        if (onProgress) onProgress(i + 1, wanted.length)
        if (i + 1 < wanted.length) await pause(150)
    }
    return found
}

// --- TheGamesDB -------------------------------------------------------------
//
// A community database whose strength is retro and console titles -- the gap
// every store-based source leaves. Free self-service key (a site login), but
// unlike the keyless sources it has a MONTHLY REQUEST QUOTA, which shapes how
// it is used here:
//
//   * It sits last in the default order, so it is only consulted for fields the
//     other sources left empty.
//   * Its genres, developers, publishers, and platform come back as integer
//     IDs, not names. Resolving those naively would cost 3-4 extra requests per
//     game, so the ID->name tables are fetched ONCE and cached in settings.
//
// Contract from TheGamesDB's own OpenAPI spec (api.thegamesdb.net/spec.yaml):
// every response carries { code, status, remaining_monthly_allowance, data },
// /v1/Games/ByGameName takes apikey + name + optional comma-delimited `fields`,
// and Game has game_title, release_date, overview, genres[], developers[],
// platform.

function tgdbKey(settings) {
    const key = String(settings.gamesDbApiKey || "").trim()
    if (!key) throw new Error("Set a TheGamesDB API key in Settings first")
    return key
}

async function tgdbGet(settings, path, params) {
    const query = new URLSearchParams({ apikey: tgdbKey(settings), ...(params || {}) })
    const res = await fetch(`${TGDB_API}${path}?${query}`, { headers: outboundHeaders() })

    if (res.status === 403) {
        throw new Error("TheGamesDB rejected the API key. Check it in Settings against "
            + "your key at thegamesdb.net (log in, then API Key).")
    }
    if (!res.ok) throw new Error(`TheGamesDB request failed (HTTP ${res.status})`)

    const json = await res.json()
    // The quota is reported in-band on every response. Surfacing it is the only
    // way a user can see they are close to the limit before requests start
    // failing.
    if (Number.isFinite(Number(json?.remaining_monthly_allowance))) {
        lastTgdbAllowance = Number(json.remaining_monthly_allowance)
    }
    return json
}

// Most recent quota figure seen, reported by the connection check.
let lastTgdbAllowance = null

// The ID -> name tables, fetched once and cached in the config note.
//
// Without this, every game would need extra requests just to turn `genres: [1,
// 8]` into "Action, Adventure" -- on a quota-limited API that is the difference
// between a usable source and one that exhausts itself on a single import.
async function tgdbLookups(settings) {
    let cached = null
    try {
        cached = JSON.parse(settings.gamesDbLookups || "null")
    } catch (e) {
        // Malformed cache; refetch below.
    }
    if (cached?.genres && cached?.developers && cached?.platforms) return cached

    const tables = { genres: {}, developers: {}, publishers: {}, platforms: {} }

    // Each of these is ONE request for the whole table.
    const sources = [
        ["genres", "/v1/Genres", "genres"],
        ["developers", "/v1/Developers", "developers"],
        ["publishers", "/v1/Publishers", "publishers"],
        ["platforms", "/v1/Platforms", "platforms"]
    ]

    for (const [key, path, field] of sources) {
        try {
            const json = await tgdbGet(settings, path)
            const rows = json?.data?.[field] || {}
            for (const [id, entry] of Object.entries(rows)) {
                if (entry?.name) tables[key][String(id)] = entry.name
            }
        } catch (e) {
            // A missing table just means those fields stay blank.
        }
        await pause(200)
    }

    persistFields({ gamesDbLookups: JSON.stringify(tables) })
    return tables
}

function tgdbNames(table, ids) {
    return (Array.isArray(ids) ? ids : [])
        .map(id => table?.[String(id)])
        .filter(Boolean)
        .join(", ")
}

function mapTgdbGame(raw, tables) {
    return {
        igdbId: "",
        gamesDbId: String(raw.id || ""),
        steamAppId: "",
        title: raw.game_title || "",
        year: String(raw.release_date || "").slice(0, 4),
        summary: typeof raw.overview === "string" ? raw.overview.trim() : "",
        // Boxart needs a separate include; the art sources cover that better.
        cover: "",
        genres: tgdbNames(tables?.genres, raw.genres),
        // A single platform id, which is exactly the console information the
        // store-based sources cannot provide.
        platforms: tables?.platforms?.[String(raw.platform)] || ""
    }
}

async function tgdbSearch(settings, query) {
    const text = String(query || "").trim()
    if (!text) return []

    const tables = await tgdbLookups(settings)
    const json = await tgdbGet(settings, "/v1/Games/ByGameName", {
        name: text,
        fields: "overview,genres,platform"
    })

    let doc = { games: {} }
    try {
        doc = loadDocument(settings)
    } catch (e) {
        // No library root configured yet.
    }

    return (json?.data?.games || [])
        .filter(g => g && g.game_title)
        .slice(0, 20)
        .map(raw => {
            const game = mapTgdbGame(raw, tables)
            return { ...game, trackedKey: tracker.findGame(doc, game) || "" }
        })
}

async function tgdbGamesByTitles(settings, titles, onProgress) {
    const found = new Map()
    const wanted = [...new Set(titles.map(t => String(t || "").trim()).filter(Boolean))]
    if (!wanted.length) return found

    const tables = await tgdbLookups(settings)

    for (let i = 0; i < wanted.length; i++) {
        const title = wanted[i]
        try {
            const json = await tgdbGet(settings, "/v1/Games/ByGameName", {
                name: title,
                fields: "overview,genres,platform"
            })
            const exact = (json?.data?.games || []).find(g =>
                g?.game_title && normalizeTitle(g.game_title) === normalizeTitle(title))
            if (exact) found.set(title.toLowerCase(), mapTgdbGame(exact, tables))
        } catch (e) {
            // One failed lookup must not lose the rest.
        }
        if (onProgress) onProgress(i + 1, wanted.length)
        if (i + 1 < wanted.length) await pause(200)
    }
    return found
}

// --- source registry --------------------------------------------------------
//
// Every metadata source implements the same operations and returns the same
// normalised shape, so the chain below can treat them interchangeably.

const PROVIDERS = {
    igdb: {
        id: "igdb",
        label: "IGDB",
        searchByName: (settings, query) => igdbSearch(settings, query),
        gamesByIds: (settings, ids, onProgress) => igdbGamesByIds(settings, ids, onProgress),
        gamesByTitles: (settings, titles, onProgress) =>
            igdbGamesByTitles(settings, titles, onProgress),
        byId: (settings, id) => igdbById(settings, id),
        bySlug: (settings, slug) => igdbBySlug(settings, slug),
        // IGDB can map many appids at once through external_games.
        idsForSteamAppIds: (settings, appIds, onProgress) =>
            igdbIdsForSteamAppIds(settings, appIds, onProgress),
        check: async (settings) => {
            const rows = await igdbQuery(settings, "games", "fields name; limit 1;")
            return { ok: true, provider: "IGDB", sample: rows?.[0]?.name || "" }
        }
    },
    rawg: {
        id: "rawg",
        label: "RAWG",
        searchByName: (settings, query) => rawgSearch(settings, query),
        gamesByIds: (settings, ids, onProgress) => rawgGamesByIds(settings, ids, onProgress),
        gamesByTitles: (settings, titles, onProgress) =>
            rawgGamesByTitles(settings, titles, onProgress),
        byId: (settings, id) => rawgById(settings, id),
        bySlug: (settings, slug) => rawgById(settings, slug),
        // No bulk store lookup; a Steam import resolves metadata by title.
        idsForSteamAppIds: null,
        check: async (settings) => {
            const json = await rawgGet(settings, "/games", { page_size: "1" })
            return {
                ok: true,
                provider: "RAWG",
                sample: json?.results?.[0]?.name || "",
                total: json?.count ?? null
            }
        }
    },
    steam: {
        id: "steam",
        label: "Steam",
        needsKey: false,
        searchByName: (settings, query) => steamSearchByName(settings, query),
        gamesByTitles: (settings, titles, onProgress) =>
            steamGamesByTitles(settings, titles, onProgress),
        // Steam's own id IS the appid, so a lookup by id is a direct hit.
        byId: (settings, id) => steamGameByAppId(settings, id),
        bySlug: (settings, slug) => steamGameByAppId(settings, slug),
        gamesByIds: async (settings, ids, onProgress) => {
            const out = new Map()
            for (let i = 0; i < ids.length; i++) {
                const game = await steamGameByAppId(settings, ids[i])
                if (game) out.set(String(ids[i]), game)
                if (onProgress) onProgress(i + 1, ids.length)
                await pause(150)
            }
            return out
        },
        idsForSteamAppIds: null,
        check: async () => {
            // Any public app confirms the endpoint is reachable; no key exists
            // to validate.
            const details = await steamStoreDetails(440)
            return { ok: !!details, provider: "Steam", sample: details?.title || "" }
        }
    },
    gog: {
        id: "gog",
        label: "GOG",
        needsKey: false,
        searchByName: (settings, query) => gogSearch(settings, query),
        gamesByTitles: (settings, titles, onProgress) =>
            gogGamesByTitles(settings, titles, onProgress),
        byId: null,
        bySlug: null,
        gamesByIds: null,
        idsForSteamAppIds: null,
        check: async () => {
            const json = await getJson(`${GOG_CATALOG}/catalog`
                + `?limit=1&query=${encodeURIComponent("like:witcher")}`
                + `&locale=en-US&currencyCode=USD&countryCode=US`)
            return {
                ok: true,
                provider: "GOG",
                sample: json?.products?.[0]?.title || ""
            }
        }
    },
    lutris: {
        id: "lutris",
        label: "Lutris",
        needsKey: false,
        searchByName: (settings, query) => lutrisSearch(settings, query),
        gamesByTitles: (settings, titles, onProgress) =>
            lutrisGamesByTitles(settings, titles, onProgress),
        byId: null,
        bySlug: null,
        gamesByIds: null,
        idsForSteamAppIds: null,
        check: async () => {
            const json = await getJson(`${LUTRIS_API}/games?search=portal`)
            return {
                ok: true,
                provider: "Lutris",
                sample: json?.results?.[0]?.name || ""
            }
        }
    },
    steamgriddb: {
        id: "steamgriddb",
        label: "SteamGridDB",
        needsKey: true,
        // Art only: it contributes `cover` and nothing else, so it has no
        // meaningful standalone search in this addon's sense.
        searchByName: null,
        gamesByTitles: (settings, titles, onProgress) =>
            sgdbGamesByTitles(settings, titles, onProgress),
        byId: null,
        bySlug: null,
        gamesByIds: null,
        idsForSteamAppIds: null,
        check: async (settings) => {
            const data = await sgdbGet(settings, "/search/autocomplete/portal")
            return {
                ok: true,
                provider: "SteamGridDB",
                sample: (data || [])[0]?.name || ""
            }
        }
    },
    gamesdb: {
        id: "gamesdb",
        label: "TheGamesDB",
        needsKey: true,
        searchByName: (settings, query) => tgdbSearch(settings, query),
        gamesByTitles: (settings, titles, onProgress) =>
            tgdbGamesByTitles(settings, titles, onProgress),
        byId: null,
        bySlug: null,
        gamesByIds: null,
        idsForSteamAppIds: null,
        check: async (settings) => {
            const json = await tgdbGet(settings, "/v1/Games/ByGameName", { name: "portal" })
            return {
                ok: true,
                provider: "TheGamesDB",
                sample: json?.data?.games?.[0]?.game_title || "",
                // The quota is the thing worth reporting for this source.
                remaining: lastTgdbAllowance
            }
        }
    }
}

// --- the metadata chain -----------------------------------------------------
//
// Sources are consulted in the user's configured order and merged PER FIELD:
// the first source supplying a non-empty value wins that field, independently of
// every other field. A game can end up with IGDB's platforms, SteamGridDB's
// cover, and Steam's summary.
//
// Every source is optional. One that is unconfigured, unreachable, or simply has
// no entry for a game is skipped without affecting the others -- which is why a
// chain is more robust than any single provider, not just richer.

function activeSources(settings) {
    return tracker.listSources(settings.sources)
        .map(id => PROVIDERS[id])
        .filter(Boolean)
}

// Look one title up across every configured source, in order, and merge.
async function chainByTitle(settings, title, options) {
    const results = []
    for (const source of activeSources(settings)) {
        if (!source.gamesByTitles) continue
        try {
            const found = await source.gamesByTitles(settings, [title])
            const game = found.get(String(title).toLowerCase())
            if (game) results.push({ source: source.id, game })
        } catch (e) {
            // A source that is unconfigured or failing must not stop the chain.
        }
        // Stop early once every merged field is filled, so a fully-answered
        // lookup does not spend quota on sources it does not need.
        if (!options?.exhaustive && isComplete(results)) break
    }
    return results.length ? tracker.mergeGameSources(results) : null
}

// Whether the merged result already has every field, so later sources can be
// skipped. This is what keeps the quota-limited sources cheap: placed last,
// they are usually never reached.
function isComplete(results) {
    const merged = tracker.mergeGameSources(results)
    return tracker.MERGED_FIELDS.every(f => tracker.hasValue(merged[f]))
}

// Bulk variant: resolve many titles across the chain in one pass per source,
// which matters because IGDB can answer 40 titles in one request.
async function chainByTitles(settings, titles, onProgress) {
    const wanted = [...new Set(titles.map(t => String(t || "").trim()).filter(Boolean))]
    if (!wanted.length) return new Map()

    // Per title, the ordered list of source results gathered so far.
    const perTitle = new Map(wanted.map(t => [t.toLowerCase(), []]))

    for (const source of activeSources(settings)) {
        if (!source.gamesByTitles) continue

        // Only ask a source about titles still missing something, so later
        // sources (the quota-limited ones) see a shrinking list.
        const outstanding = wanted.filter(t => {
            const got = perTitle.get(t.toLowerCase())
            return !got.length || !isComplete(got)
        })
        if (!outstanding.length) break

        try {
            const found = await source.gamesByTitles(settings, outstanding, onProgress)
            for (const [key, game] of found) {
                const bucket = perTitle.get(key)
                if (bucket) bucket.push({ source: source.id, game })
            }
        } catch (e) {
            // Skip a failing source entirely rather than failing the batch.
        }
    }

    const out = new Map()
    for (const [key, results] of perTitle) {
        if (results.length) out.set(key, tracker.mergeGameSources(results))
    }
    return out
}

// The PRIMARY source: the first configured one that can answer id-based
// lookups. A game's stored `igdbId` belongs to whichever source is primary, so
// operations addressed by id (add-by-id, refresh-by-id) go here while
// everything title-based goes through the chain.
function provider(settings) {
    const ordered = activeSources(settings)
    return ordered.find(s => s.byId && s.gamesByIds) || ordered[0] || PROVIDERS.igdb
}

// Search goes to the first source that supports it, rather than the whole
// chain: search results are a ranked list to pick from, and interleaving seven
// sources' rankings produces a worse list, not a better one.
function searchSource(settings) {
    return activeSources(settings).find(s => s.searchByName) || PROVIDERS.igdb
}

// --- file import ------------------------------------------------------------

// A status colour as an inline style, matching what the widget builds for its
// own badges. Produced here because the preview rows are assembled server-side.
function statusStyleFor(color) {
    const hex = /^#?([0-9a-f]{6})$/i.exec(String(color || "").trim())
    const n = hex ? parseInt(hex[1], 16) : 0x808080
    const rgb = `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
    return `background: rgba(${rgb}, 0.16); border-color: rgba(${rgb}, 0.6);`
}

// Parse an uploaded library file and report what it contains WITHOUT writing
// anything. Every title is resolved against IGDB so the caller can see exactly
// what matched before committing -- a title-matched import is a guess, and a
// guess that silently writes 180 rows is not something to discover afterwards.
async function previewImportFile(settings, text, filename) {
    const parsed = tracker.parseImportFile(text, filename)

    // Rows that already carry an id don't need matching at all.
    const needMatch = parsed.rows.filter(r => !r.igdbId && !r.steamAppId)
    const matched = needMatch.length
        ? await chainByTitles(settings, needMatch.map(r => r.title))
        : new Map()

    const doc = loadDocument(settings)
    const statuses = tracker.listStatuses(settings.statuses)

    const rows = parsed.rows.map(row => {
        const hit = matched.get(String(row.title || "").trim().toLowerCase())
        // A parsed row carries a ROLE; resolve it here so the preview shows the
        // status the import would actually apply, under the user's own name for
        // it, rather than an internal role word.
        const resolvedStatusId = row.status
            ? tracker.statusIdForRole(statuses, row.status)
            : ""
        const resolvedStatus = resolvedStatusId
            ? tracker.statusById(statuses, resolvedStatusId)
            : null
        const identity = {
            igdbId: row.igdbId || hit?.igdbId || "",
            steamAppId: row.steamAppId || ""
        }
        return {
            title: row.title,
            // The role, kept as-is: applyFileImport resolves it again at write
            // time, so a status added between preview and import is honoured.
            status: row.status || "",
            // What that role resolves to right now, for display only.
            statusName: resolvedStatus?.name || "",
            statusStyle: resolvedStatus ? statusStyleFor(resolvedStatus.color) : "",
            rating: row.rating ?? null,
            playtime: row.playtime || 0,
            list: row.list || "",
            lists: row.lists || null,
            igdbId: identity.igdbId,
            matchedTitle: hit?.title || "",
            year: hit?.year || "",
            cover: hit?.cover || "",
            // Whether this row can be imported at all, and whether it would land
            // on a game already tracked.
            matched: !!(identity.igdbId || identity.steamAppId),
            existingKey: tracker.findGame(doc, identity) || ""
        }
    })

    return {
        format: parsed.format,
        lists: parsed.lists || [],
        total: rows.length,
        matchedCount: rows.filter(r => r.matched).length,
        unmatchedCount: rows.filter(r => !r.matched).length,
        existingCount: rows.filter(r => r.existingKey).length,
        rows
    }
}

// Apply a file import. Takes the rows the preview produced (so what is written
// is exactly what was shown), and goes through the same additive applyImport as
// every other source.
//
// `listsAsCollections` files each game under the list it came from, which is how
// an IGDB export's own organisation survives the import.
async function importFile(settings, payload, options) {
    // Arrives as a real array from a JSON POST body, or as a JSON string when it
    // came up the query string. Both are accepted so the caller doesn't have to
    // care which transport was used.
    let rows = payload
    if (typeof rows === "string") {
        try {
            rows = JSON.parse(rows || "[]")
        } catch (e) {
            throw new Error("Malformed import payload")
        }
    }
    if (!Array.isArray(rows)) throw new Error("Malformed import payload")

    const usable = rows.filter(r => r && (r.igdbId || r.steamAppId))
    if (!usable.length) {
        throw new Error("Nothing to import: no row matched a game on IGDB.")
    }

    // Fetch full metadata for everything being imported, in bulk.
    let metadata = new Map()
    const igdbIds = usable.map(r => r.igdbId).filter(Boolean)
    if (igdbIds.length && settings.importFetchMetadata !== false) {
        try {
            metadata = await provider(settings).gamesByIds(settings, igdbIds)
        } catch (e) {
            // Metadata is a nice-to-have; never fail an import over it.
        }
    }

    const asCollections = options?.listsAsCollections === "true"
    const doc = loadDocument(settings)

    const items = usable.map(row => {
        const details = row.igdbId ? metadata.get(String(row.igdbId)) : null
        const item = {
            igdbId: row.igdbId || "",
            steamAppId: row.steamAppId || "",
            title: details?.title || row.matchedTitle || row.title || "Untitled",
            year: details?.year || "",
            summary: details?.summary || "",
            cover: details?.cover || "",
            genres: details?.genres || "",
            platforms: details?.platforms || "",
            rating: row.rating ?? null,
            playtime: Number(row.playtime) || 0,
            lastPlayed: row.lastPlayed || ""
        }

        // The file's status is explicit user intent, so unlike a Steam import it
        // may set "beaten" -- the user filed the game as played themselves.
        if (row.status) item.fileStatus = row.status

        if (asCollections) {
            const names = row.lists || (row.list ? [row.list] : [])
            if (names.length) item.collections = names
        }

        return item
    })

    return applyFileImport(settings, doc, items)
}

// File imports differ from Steam's in two ways, so they get their own apply:
// a file's status is explicit and may set "beaten", and its lists can become
// collections. Everything else -- additive, one read, one write, ratings and
// playtime preserved -- matches applyImport exactly.
function applyFileImport(settings, doc, items) {
    const statuses = tracker.listStatuses(settings.statuses)
    let added = 0
    let updated = 0

    for (const item of items) {
        const existingKey = tracker.findGame(doc, item)
        const key = existingKey || tracker.gameKey(item)
        if (!key) continue

        const previous = doc.games[key] || {}

        const incomingRating = Number.isFinite(Number(item.rating)) ? Number(item.rating) : null
        const rating = (incomingRating !== null
            && (settings.importOverwriteRatings || previous.rating == null))
            ? incomingRating
            : (previous.rating ?? null)

        const playtime = Math.max(Number(item.playtime) || 0, Number(previous.playtime) || 0)

        // Collections merge rather than replace: a game already filed under the
        // user's own tags keeps them, and the file's lists are added alongside.
        const collections = item.collections
            ? tracker.normalizeCollections([
                ...tracker.normalizeCollections(previous.collections),
                ...item.collections
            ])
            : tracker.normalizeCollections(previous.collections)

        const entry = tracker.normalizeGame({
            ...previous,
            igdbId: item.igdbId || previous.igdbId || "",
            steamAppId: item.steamAppId || previous.steamAppId || "",
            title: item.title || previous.title || "Untitled",
            year: item.year || previous.year || "",
            summary: item.summary || previous.summary || "",
            cover: item.cover || previous.cover || "",
            genres: item.genres || previous.genres || "",
            platforms: item.platforms || previous.platforms || "",
            status: previous.status,
            rating,
            playtime,
            collections,
            addedAt: previous.addedAt || today()
        })

        if (item.lastPlayed && String(item.lastPlayed) > String(entry.lastPlayed || "")) {
            entry.lastPlayed = String(item.lastPlayed).slice(0, 10)
        }

        // The file supplies a ROLE; which of the user's statuses that becomes is
        // decided here. A status the user set in Trilium is only overwritten by a
        // brand-new entry, or when the existing one is still an untouched backlog.
        if (item.fileStatus) {
            const isNew = !existingKey
            const previousStatus = previous.status
                ? tracker.statusById(statuses, previous.status)
                : null
            // A status settings no longer define counts as deliberate, not
            // untouched: it is the user's own classification.
            const untouched = !previous.status
                || (previousStatus && previousStatus.role === "backlog")
            if (isNew || untouched) {
                entry.status = tracker.statusIdForRole(statuses, item.fileStatus)
            }
        }

        doc.games[key] = entry
        existingKey ? updated++ : added++
    }

    saveDocument(settings, doc)
    return { added, updated, total: added + updated }
}

// --- game mutations ---------------------------------------------------------

// Add a game chosen from search. The id belongs to whichever source produced the
// search result, so that source answers first; the rest of the chain then fills
// whatever it left empty, by title.
async function addGame(settings, igdbId) {
    const primary = provider(settings)
    const details = await primary.byId(settings, igdbId)

    // Enrich from the remaining sources. A failure here costs nothing -- the
    // game is still added with what the primary source gave.
    try {
        const enriched = await enrichFromChain(settings, details, primary.id)
        if (enriched) return upsertGame(settings, enriched)
    } catch (e) {
        // Fall through to the unenriched record.
    }
    return upsertGame(settings, details)
}

// Merge `details` (already obtained from `fromSource`) with whatever the other
// configured sources can add for the same title. The originating source keeps
// priority, so this only ever fills gaps.
async function enrichFromChain(settings, details, fromSource) {
    if (!details?.title) return details

    const results = [{ source: fromSource, game: details }]
    for (const source of activeSources(settings)) {
        if (source.id === fromSource || !source.gamesByTitles) continue
        if (isComplete(results)) break
        try {
            const found = await source.gamesByTitles(settings, [details.title])
            const game = found.get(details.title.toLowerCase())
            if (game) results.push({ source: source.id, game })
        } catch (e) {
            // Skip a source that is unconfigured or failing.
        }
    }

    return tracker.mergeGameSources(results)
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
        status: tracker.defaultStatusId(
            tracker.listStatuses(settings.statuses), settings.defaultStatusId
        ),
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
    const statuses = tracker.listStatuses(settings.statuses)
    // Validated against the user's own set rather than a fixed list. An id the
    // settings no longer define is still accepted when a game already holds it,
    // so re-selecting a removed status from the dropdown is not an error.
    const known = tracker.statusById(statuses, status)
    const doc = loadDocument(settings)
    const entry = requireEntry(doc, key)
    if (!known && entry.status !== status) {
        throw new Error(`Unknown status: ${status}`)
    }
    entry.status = status
    // Stamped only for roles that imply the game was actually played.
    if (known && (known.role === "playing" || known.role === "done")) {
        entry.lastPlayed = today()
    }
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

    if (parsed.igdbSlug) {
        return upsertGame(settings, await provider(settings).bySlug(settings, parsed.igdbSlug))
    }

    // A Steam appid is resolved to the provider's entry so the game gets full
    // metadata; if the provider doesn't know it, fall back to the Steam store's
    // own data rather than refusing.
    const active = provider(settings)
    const mapped = await linkSteamAppIds(settings, [parsed.steamAppId])
    const providerId = mapped.get(String(parsed.steamAppId))
    if (providerId) {
        const details = await active.byId(settings, providerId)
        return upsertGame(settings, { ...details, steamAppId: String(parsed.steamAppId) })
    }

    const store = await steamStoreDetails(parsed.steamAppId)
    if (!store) {
        throw new Error(`Neither ${active.label} nor Steam has a game for appid ${parsed.steamAppId}.`)
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

// The rich fields the details page shows on top of the merged base fields.
// Sources that cannot supply one leave it empty, and the composite below takes
// the first non-empty value in source order -- exactly like the base fields.
const DETAIL_FIELDS = [
    "storyline", "url", "totalRating", "totalRatingCount",
    "developers", "publishers", "modes", "perspectives", "themes",
    "screenshots", "similar"
]

const EMPTY_DETAILS = {
    storyline: "", url: "", totalRating: null, totalRatingCount: 0,
    developers: [], publishers: [], modes: [], perspectives: [], themes: [],
    screenshots: [], similar: []
}

// Rich details from one source, by whatever id/title that source can use.
// Returns null when the source has nothing for this game, which is normal and
// never an error -- the composite simply moves on.
async function detailsFromSource(settings, sourceId, { id, title, steamAppId }) {
    try {
        switch (sourceId) {
            case "igdb":
                return id ? await igdbFullDetails(settings, id) : null
            case "rawg":
                return id ? await rawgFullDetails(settings, id) : null
            case "steam": {
                const appId = steamAppId || id
                return appId ? await steamFullDetails(settings, appId) : null
            }
            case "gog":
            case "lutris":
            case "gamesdb": {
                // These have no separate "rich" endpoint, so their base record
                // is reused: it still carries summary, genres, and platforms,
                // which is what the page needs from them.
                const source = PROVIDERS[sourceId]
                if (!source?.gamesByTitles || !title) return null
                const found = await source.gamesByTitles(settings, [title])
                const game = found.get(String(title).toLowerCase())
                return game ? { ...EMPTY_DETAILS, ...game } : null
            }
            case "steamgriddb": {
                const art = await sgdbArtFor(settings, { steamAppId, title })
                return art?.cover ? { ...EMPTY_DETAILS, cover: art.cover } : null
            }
            default:
                return null
        }
    } catch (e) {
        // One source failing must never take the page down.
        return null
    }
}

// Steam's rich details: it has screenshots, developers, publishers, and a
// Metacritic score, which maps onto the same aggregate-rating slot IGDB's
// total_rating uses.
async function steamFullDetails(settings, appId) {
    const raw = await steamStoreRaw(appId)
    if (!raw) return null

    return {
        ...EMPTY_DETAILS,
        ...(await steamStoreDetails(appId) || {}),
        url: `https://store.steampowered.com/app/${appId}/`,
        totalRating: Number.isFinite(Number(raw.metacritic?.score))
            ? Number(raw.metacritic.score)
            : null,
        totalRatingCount: 0,
        developers: Array.isArray(raw.developers) ? raw.developers : [],
        publishers: Array.isArray(raw.publishers) ? raw.publishers : [],
        // Steam's "categories" are the closest thing it has to game modes.
        modes: (raw.categories || [])
            .map(c => c.description)
            .filter(Boolean)
            .slice(0, 8),
        screenshots: (raw.screenshots || [])
            .slice(0, 8)
            .map(s => s.path_thumbnail || s.path_full)
            .filter(Boolean)
    }
}

// Full metadata for the details page, composed from EVERY enabled source.
//
// Previously this asked one provider and refused outright without an IGDB id,
// which made a Steam-only or file-imported game a dead end. Now the sources are
// tried in the user's configured order and merged field by field, exactly like
// the library metadata: the first source with a storyline wins the storyline,
// the first with screenshots wins those, and so on.
//
// Every source is optional and every failure is survivable, so the page renders
// with whatever could be gathered rather than erroring.
async function fullDetails(settings, igdbId, key) {
    const doc = loadDocument(settings)
    const entry = key && doc.games[key] ? tracker.normalizeGame(doc.games[key]) : null

    // Each source gets whichever handle it can actually use: its own recorded id
    // where the entry has one, the primary id, the Steam appid, or the title.
    const primary = provider(settings)
    const title = entry?.title || ""
    const steamAppId = entry?.steamAppId || ""

    const results = []
    for (const source of activeSources(settings)) {
        // A source's own id for this game, recorded by an earlier merge.
        const sourceId = entry?.sourceIds?.[source.id]
            || (source.id === primary.id ? igdbId : "")

        const details = await detailsFromSource(settings, source.id, {
            id: sourceId,
            title,
            steamAppId
        })
        if (details) results.push({ source: source.id, game: details })

        // Stop once the page has everything it can show.
        if (detailsComplete(results)) break
    }

    if (!results.length) {
        // Nothing answered. Fall back to what is already stored rather than
        // failing: the library record alone still makes a usable page.
        if (entry) {
            return { ...EMPTY_DETAILS, ...entry, entry, sources: entry.sources || {} }
        }
        throw new Error("No metadata source could return details for this game. "
            + "Check your sources on the Import tab.")
    }

    // Base fields merge through the same helper the library uses; the rich
    // fields merge with the same first-non-empty-wins rule.
    const base = tracker.mergeGameSources(results)
    const merged = { ...EMPTY_DETAILS, ...base }
    const provenance = { ...base.sources }

    for (const field of DETAIL_FIELDS) {
        for (const { source, game } of results) {
            if (!tracker.hasValue(game?.[field])) continue
            merged[field] = game[field]
            provenance[field] = source
            break
        }
    }

    // The stored entry fills anything no source could supply, so a game whose
    // metadata came from a file import still shows its title and cover.
    if (entry) {
        for (const field of tracker.MERGED_FIELDS) {
            if (!tracker.hasValue(merged[field]) && tracker.hasValue(entry[field])) {
                merged[field] = entry[field]
                provenance[field] = "stored"
            }
        }
    }

    return { ...merged, entry, sources: provenance }
}

// Whether every field the details page renders has been filled, so remaining
// sources can be skipped.
function detailsComplete(results) {
    const base = tracker.mergeGameSources(results)
    if (!tracker.MERGED_FIELDS.every(f => tracker.hasValue(base[f]))) return false
    return DETAIL_FIELDS.every(field =>
        results.some(r => tracker.hasValue(r.game?.[field])))
}

// RAWG's single-game endpoint, plus its separate screenshots endpoint.
//
// RAWG has no storyline, game modes, or player perspectives, so those come back
// empty. `metacritic` is 0-100, the same scale IGDB's total_rating uses, so it
// maps onto the same field the details page already renders.
async function rawgFullDetails(settings, id) {
    const json = await rawgGet(settings, `/games/${encodeURIComponent(id)}`)
    if (!json?.id) throw new Error("RAWG has no game with that id")

    let screenshots = []
    try {
        const shots = await rawgGet(settings, `/games/${encodeURIComponent(id)}/screenshots`)
        screenshots = (shots?.results || []).slice(0, 8).map(s => s.image).filter(Boolean)
    } catch (e) {
        // Screenshots are decorative; never fail the page over them.
    }

    return {
        ...mapRawgGame(json),
        storyline: "",
        url: json.website || `https://rawg.io/games/${json.slug || id}`,
        // RAWG's `metacritic` is the closest equivalent to IGDB's aggregate.
        totalRating: Number.isFinite(Number(json.metacritic)) ? Number(json.metacritic) : null,
        totalRatingCount: Number(json.ratings_count) || 0,
        developers: (json.developers || []).map(d => d.name).filter(Boolean),
        publishers: (json.publishers || []).map(p => p.name).filter(Boolean),
        modes: [],
        perspectives: [],
        themes: (json.tags || []).slice(0, 8).map(t => t.name).filter(Boolean),
        screenshots,
        similar: []
    }
}

// Full metadata from IGDB: everything a game lookup returns, plus screenshots,
// companies, and IGDB's aggregate rating.
//
// Every field is read defensively -- IGDB omits fields it has no data for (an
// unreleased game has no screenshots or rating), so a missing value must render
// as blank rather than "undefined".
async function igdbFullDetails(settings, igdbId) {
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

    return details
}

// --- housekeeping -----------------------------------------------------------

// Map Steam appids to provider ids, whichever provider is configured.
//
// IGDB indexes Steam appids directly (external_games), so it answers in bulk.
// RAWG does not, so the appids are resolved through the Steam store's own titles
// and then matched by name. The fallback is slower and slightly less certain,
// which is why the provider table exposes `idsForSteamAppIds: null` for RAWG
// rather than pretending the two are equivalent.
//
// Returns a Map of appid (string) -> provider id (string).
async function linkSteamAppIds(settings, appIds, onProgress) {
    const active = provider(settings)
    if (active.idsForSteamAppIds) {
        return active.idsForSteamAppIds(settings, appIds, onProgress)
    }

    const found = new Map()
    const wanted = [...new Set(appIds.map(String).filter(Boolean))]
    if (!wanted.length) return found

    // Steam's store API gives the canonical title for an appid without a key;
    // the provider is then asked for that exact title.
    const titles = new Map()
    for (let i = 0; i < wanted.length; i++) {
        const store = await steamStoreDetails(wanted[i])
        if (store?.title) titles.set(wanted[i], store.title)
        if (onProgress) onProgress(i + 1, wanted.length * 2)
        await pause(120)
    }

    const matched = await chainByTitles(settings, [...titles.values()])
    for (const [appId, title] of titles) {
        const hit = matched.get(title.toLowerCase())
        if (hit?.igdbId) found.set(appId, hit.igdbId)
    }
    return found
}

// Re-derives everything that can drift: refreshes metadata and covers from the
// configured provider and backfills missing provider ids from Steam appids.
// Reads the document once and writes once, like the importers. Never changes a
// rating, status, or playtime.
async function refreshLibrary(settings) {
    const doc = loadDocument(settings)
    const entries = Object.entries(doc.games)

    let metadataUpdated = 0
    let linked = 0
    let failed = 0

    // Backfill provider ids for Steam-only entries first, so the metadata pass
    // below can cover them too.
    const unlinked = entries
        .filter(([, raw]) => !raw.igdbId && raw.steamAppId)
        .map(([, raw]) => String(raw.steamAppId))

    if (unlinked.length) {
        try {
            const mapped = await linkSteamAppIds(settings, unlinked)
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

    // Entries that still have no provider id, but do have a title, can often be
    // matched by name -- this is what links a file-imported library after a
    // provider switch.
    const unmatchedTitles = entries
        .filter(([, raw]) => !raw.igdbId && !raw.steamAppId && raw.title)
        .map(([, raw]) => String(raw.title))

    if (unmatchedTitles.length) {
        try {
            const byTitle = await chainByTitles(settings, unmatchedTitles)
            for (const [, raw] of entries) {
                if (raw.igdbId || !raw.title) continue
                const hit = byTitle.get(String(raw.title).toLowerCase())
                if (hit?.igdbId) { raw.igdbId = hit.igdbId; linked++ }
            }
        } catch (e) {
            failed++
        }
    }

    // Metadata comes from the whole chain, not just the primary source.
    //
    // The primary source answers by id (exact, and cheap in bulk on IGDB); every
    // other enabled source is then asked by title for whatever that left empty.
    // Refreshing through only the primary would mean a field it lacks could
    // never be filled -- which was the point of having a chain at all.
    const primary = provider(settings)
    const withId = entries.filter(([, raw]) => raw.igdbId).map(([, raw]) => String(raw.igdbId))

    let byId = new Map()
    if (withId.length && primary.gamesByIds) {
        try {
            byId = await primary.gamesByIds(settings, withId)
        } catch (e) {
            failed++
        }
    }

    // Everything the primary could not fully answer goes through the chain by
    // title. chainByTitles asks each source only about the titles still missing
    // something, so this costs little for a library the primary already covers.
    const needsChain = []
    for (const [, raw] of entries) {
        const fromPrimary = raw.igdbId ? byId.get(String(raw.igdbId)) : null
        const candidate = fromPrimary
            ? [{ source: primary.id, game: fromPrimary }]
            : []
        if (!isComplete(candidate) && raw.title) needsChain.push(String(raw.title))
    }

    let byTitleChain = new Map()
    if (needsChain.length) {
        try {
            byTitleChain = await chainByTitles(settings, needsChain)
        } catch (e) {
            failed++
        }
    }

    for (const [key, raw] of entries) {
        const entry = tracker.normalizeGame(raw)

        // Merge in priority order: the primary source's own record first, then
        // the chain's composite, then whatever the entry already held. The
        // stored values come last so a field no source can supply is preserved
        // rather than blanked.
        const results = []
        const fromPrimary = entry.igdbId ? byId.get(entry.igdbId) : null
        if (fromPrimary) results.push({ source: primary.id, game: fromPrimary })

        const fromChain = entry.title
            ? byTitleChain.get(entry.title.toLowerCase())
            : null
        if (fromChain) results.push({ source: "chain", game: fromChain })

        if (results.length) {
            const before = JSON.stringify([
                entry.title, entry.cover, entry.summary, entry.genres,
                entry.platforms, entry.year
            ])

            const merged = tracker.mergeGameSources([
                ...results,
                // The existing entry is the final fallback, so refresh only ever
                // adds and corrects -- it never empties a field.
                { source: "stored", game: entry }
            ])

            for (const field of tracker.MERGED_FIELDS) {
                if (tracker.hasValue(merged[field])) entry[field] = merged[field]
            }
            // Provenance: which source each field actually came from, and each
            // source's own id, so the details page can show it.
            entry.sources = { ...entry.sources, ...merged.sources }
            entry.sourceIds = { ...entry.sourceIds, ...merged.sourceIds }

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
// The raw appdetails payload, for callers that need fields beyond the mapped
// shape (screenshots, developers, Metacritic). Returns null rather than
// throwing: a missing store page must never fail a lookup.
async function steamStoreRaw(appId) {
    try {
        const json = await getJson(`${STEAM_STORE}/appdetails?appids=${encodeURIComponent(appId)}`)
        const entry = json?.[String(appId)]
        if (!entry?.success || !entry.data) return null
        return entry.data
    } catch (e) {
        return null
    }
}

async function steamStoreDetails(appId) {
    const data = await steamStoreRaw(appId)
    if (!data) return null

    return {
        igdbId: "",
        steamAppId: String(appId),
        title: data.name || "",
        year: /(\d{4})/.exec(data.release_date?.date || "")?.[1] || "",
        summary: data.short_description || "",
        cover: data.header_image || "",
        genres: (data.genres || []).map(g => g.description).filter(Boolean).join(", "),
        // Read from the OS flags rather than assumed: a Steam entry can be
        // Mac/Linux-only, and hard-coding Windows would state that wrongly.
        platforms: steamPlatformString(data.platforms)
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

    // Resolve to the metadata provider. A failure here is not fatal: the import
    // falls back to Steam's own names so the library is still populated.
    //
    // IGDB maps appids directly in bulk. RAWG cannot, but Steam has already
    // given us every title, so those are matched by name instead -- far cheaper
    // than looking each appid up in the Steam store first.
    const active = provider(settings)
    let mapped = new Map()
    let metadata = new Map()
    let byTitle = new Map()

    if (settings.importFetchMetadata !== false) {
        try {
            if (active.idsForSteamAppIds) {
                mapped = await active.idsForSteamAppIds(settings, appIds)
                metadata = await active.gamesByIds(settings, [...mapped.values()])
            } else {
                byTitle = await chainByTitles(
                    settings, rows.map(g => g.name).filter(Boolean)
                )
            }
        } catch (e) {
            // Metadata is a nice-to-have; never fail an import over it.
        }
    }

    const items = []
    for (const row of rows) {
        const appId = String(row.appid)
        const matchedByTitle = byTitle.get(String(row.name || "").trim().toLowerCase())
        const igdbId = mapped.get(appId) || matchedByTitle?.igdbId || ""
        const details = matchedByTitle || (igdbId ? metadata.get(igdbId) : null)

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
            entry.status = tracker.statusFromPlaytime(
                tracker.listStatuses(settings.statuses), previous.status, playtime
            )
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

    // File imports arrive as POST bodies: an IGDB export is a couple of hundred
    // kilobytes of HTML, far past what a URL query string can carry. Trilium
    // parses JSON bodies for a customRequestHandler, so `body` is already an
    // object here. Everything else stays on the query string.
    const body = api.req.body || {}

    try {
        const settings = getSettings()

        switch (action) {
            case "listGames": {
                const doc = loadDocument(settings)
                const collections = tracker.listCollections(doc)
                const groupConfig = tracker.parseGroupConfig(settings.collectionGroups)
                const statuses = tracker.listStatuses(settings.statuses)
                // Any status id still in use that settings no longer define, so
                // the widget can offer it in filters and dropdowns rather than
                // rendering those games as blank.
                const orphans = tracker.orphanStatusIds(doc, statuses)
                return sendJson(200, {
                    games: tracker.listGames(doc),
                    // The user's own statuses, in their order, plus any orphans
                    // appended so nothing in the library is unrepresentable.
                    statuses: [
                        ...statuses,
                        ...orphans.map(id => tracker.resolveStatus(statuses, id))
                    ],
                    defaultStatusId: tracker.defaultStatusId(statuses, settings.defaultStatusId),
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
            // The user's statuses, for pickers that can't enumerate them from
            // schema.json because they are user-defined.
            case "listStatuses":
                return sendJson(200, { statuses: tracker.listStatuses(settings.statuses) })
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
                return sendJson(200, { results: await searchSource(settings).searchByName(settings, query.query || "") })
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
            // Confirms the configured provider's credentials actually work,
            // before a user discovers otherwise halfway through an import.
            // Every configured source, checked independently. "Metadata is
            // broken" is far less actionable than knowing which of seven
            // sources is the one failing, so each reports its own result.
            case "providerCheck": {
                const results = []
                for (const source of activeSources(settings)) {
                    try {
                        const r = await source.check(settings)
                        results.push({
                            id: source.id,
                            label: source.label,
                            ok: !!r.ok,
                            sample: r.sample || "",
                            remaining: r.remaining ?? null
                        })
                    } catch (e) {
                        results.push({
                            id: source.id,
                            label: source.label,
                            ok: false,
                            error: e.message
                        })
                    }
                }
                return sendJson(200, { sources: results })
            }
            // The file import is deliberately two calls: parse and match first,
            // show the user what it found, and only write when they confirm.
            case "previewImport":
                return sendJson(200, await previewImportFile(
                    settings, body.text ?? query.text, body.filename ?? query.filename
                ))
            case "importFile":
                return sendJson(200, await importFile(
                    settings,
                    body.rows ?? query.rows,
                    { listsAsCollections: String(body.listsAsCollections ?? query.listsAsCollections) }
                ))
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
