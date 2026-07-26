/*
 * media-tracker@beatlink — backend customRequestHandler ("mediaTracker").
 *
 * One HTTP endpoint (custom/mediaTracker) routed by ?action=:
 *
 *   listTitles       read the whole library out of the database note
 *   search           TMDB multi search (movies + shows)
 *   details          TMDB details for one title, incl. per-season episode counts
 *   addTitle         add a title to the database from a TMDB id
 *   removeTitle      drop a title from the database
 *   setStatus        set watch status
 *   setRating        set rating
 *   setEpisode       mark one episode watched/unwatched
 *   traktAuthStart   begin Trakt device authorization
 *   traktAuthPoll    poll for the user approving it
 *   importTrakt      one-way import of Trakt watched movies + shows
 *   stremioLogin     exchange Stremio email/password for an auth key
 *   importStremio    one-way import of the Stremio library
 *
 * Storage: every title lives in ONE JSON note titled "Database", a direct child
 * of the configured Library Root (find-or-create, see resolveDatabaseNote).
 * Imports read the document once, apply every change in memory, and write once
 * at the end -- a 400-title Trakt import is a single note write, and a partial
 * failure can't leave the document half-updated.
 *
 * Import is strictly one-way (external -> Trilium). Nothing here ever writes to
 * Trakt or Stremio, so no write scopes are used and no local edit can be pushed
 * upstream by accident.
 *
 * API contracts verified against live endpoints plus known-good clients:
 *   Trakt device OAuth  - PyTrakt (trakt/core.py); status codes 400 pending /
 *                         404 invalid / 409 used / 410 expired / 418 denied / 429 slow down
 *   Trakt watched shape - jellyfin-plugin-trakt DataContracts/Users/Watched/*.cs
 *   Stremio             - carried over from stremio-sync@beatlink, which this addon absorbs
 */

const { loadSettings, saveSettings } = require("libSettings.js")
const tracker = require("libMediaTracker.js")

const TMDB_API = "https://api.themoviedb.org/3"
const TRAKT_API = "https://api.trakt.tv"
const STREMIO_API = "https://api.strem.io/api"

const DATABASE_TITLE = "Database"

// --- settings ---------------------------------------------------------------

function getNoteIds() {
    const schemaNoteId = api.currentNote.getRelationValue("schemaNote")
    const settingsNoteId = api.currentNote.getRelationValue("settingsNote")
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
// data travels with the library: move or export the root and the titles follow.
// Find-or-create, and tagged #mediaTrackerDatabase so a renamed note is still
// found.
function resolveDatabaseNote(settings) {
    const root = requireLibraryRoot(settings)

    const tagged = root.getChildNotes().find(n => !n.isDeleted && n.hasLabel("mediaTrackerDatabase"))
    if (tagged) return tagged

    const byTitle = root.getChildNotes().find(n => !n.isDeleted && n.title === DATABASE_TITLE)
    if (byTitle) {
        byTitle.setLabel("mediaTrackerDatabase")
        return byTitle
    }

    const { note } = api.createNewNote({
        parentNoteId: root.noteId,
        title: DATABASE_TITLE,
        type: "code",
        mime: "application/json",
        content: tracker.serializeDocument(tracker.emptyDocument())
    })
    note.setLabel("mediaTrackerDatabase")
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

async function getJson(url, headers) {
    const res = await fetch(url, { headers: headers || {} })
    if (!res.ok) throw new Error(`Request failed (HTTP ${res.status})`)
    return res.json()
}

async function postJson(url, body, headers) {
    return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(headers || {}) },
        body: JSON.stringify(body)
    })
}

// --- TMDB -------------------------------------------------------------------

function requireTmdbKey(settings) {
    if (!settings.tmdbApiKey) throw new Error("Set a TMDB API key in Settings first")
    return settings.tmdbApiKey
}

// `mediaType` scopes the search: "movie" and "show" use TMDB's dedicated
// search/movie and search/tv endpoints (a full page of one kind), anything else
// uses search/multi and keeps both. The dedicated endpoints don't return a
// media_type field, so it's stamped on from what was asked for.
async function tmdbSearch(settings, query, mediaType) {
    const key = requireTmdbKey(settings)
    const scoped = mediaType === "movie" || mediaType === "show"
    const path = scoped ? (mediaType === "show" ? "search/tv" : "search/movie") : "search/multi"

    const json = await getJson(
        `${TMDB_API}/${path}?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(query)}`
    )

    return (json.results || [])
        .filter(r => scoped || r.media_type === "movie" || r.media_type === "tv")
        .map(r => ({
            tmdbId: String(r.id),
            mediaType: scoped ? mediaType : (r.media_type === "tv" ? "show" : "movie"),
            title: r.title || r.name || "",
            year: (r.release_date || r.first_air_date || "").slice(0, 4),
            overview: r.overview || "",
            poster: tracker.posterUrl(r.poster_path, settings.posterSize)
        }))
}

// Full details for one title. For shows this includes per-season aired episode
// counts, which is what next-up detection needs.
async function tmdbDetails(settings, mediaType, tmdbId) {
    const key = requireTmdbKey(settings)
    const path = mediaType === "show" ? "tv" : "movie"
    const json = await getJson(
        `${TMDB_API}/${path}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(key)}&append_to_response=external_ids`
    )

    const details = {
        tmdbId: String(json.id),
        imdbId: json.imdb_id || json.external_ids?.imdb_id || "",
        mediaType,
        title: json.title || json.name || "",
        year: (json.release_date || json.first_air_date || "").slice(0, 4),
        overview: json.overview || "",
        poster: tracker.posterUrl(json.poster_path, settings.posterSize),
        genres: (json.genres || []).map(g => g.name).join(", "),
        runtime: json.runtime || json.episode_run_time?.[0] || 0,
        seasonCounts: {},
        totalEpisodes: 0
    }

    if (mediaType === "show") {
        // "Specials" (season 0) are excluded: they are not part of the main
        // running order, so counting them would make next-up start there.
        for (const season of json.seasons || []) {
            if (!season.season_number) continue
            details.seasonCounts[season.season_number] = season.episode_count || 0
        }
        details.totalEpisodes = Object.values(details.seasonCounts).reduce((a, b) => a + b, 0)
    }
    return details
}

// Resolve a TMDB id from an IMDb id. Imported titles often have only an IMDb id
// -- Stremio supplies nothing else, and a Trakt entry has none when metadata
// enrichment was off or its fetch failed -- so without this their episode lists
// are unreachable. TMDB's /find returns matches grouped by kind.
async function tmdbIdFromImdb(settings, imdbId, mediaType) {
    const key = requireTmdbKey(settings)
    if (!imdbId) return ""

    const json = await getJson(
        `${TMDB_API}/find/${encodeURIComponent(imdbId)}?api_key=${encodeURIComponent(key)}&external_source=imdb_id`
    )

    const results = mediaType === "show" ? json.tv_results : json.movie_results
    return results?.length ? String(results[0].id) : ""
}

// Details for one title, resolving a missing TMDB id from the IMDb id first.
// Returns the resolved tmdbId so the caller can persist it and avoid the extra
// lookup next time.
async function resolveDetails(settings, mediaType, tmdbId, imdbId) {
    let id = tmdbId
    if (!id) {
        id = await tmdbIdFromImdb(settings, imdbId, mediaType)
        if (!id) {
            throw new Error(imdbId
                ? "TMDB has no match for this title's IMDb id, so its episode list is unavailable."
                : "This title has no TMDB or IMDb id, so its episode list cannot be looked up.")
        }
    }
    return tmdbDetails(settings, mediaType, id)
}

// Details for a library entry. When the TMDB id had to be resolved from the IMDb
// id, it's written back to the entry so the lookup happens once rather than on
// every open of the episode panel.
async function detailsForKey(settings, mediaType, tmdbId, imdbId, key) {
    const details = await resolveDetails(settings, mediaType, tmdbId, imdbId)

    if (key && details.tmdbId && details.tmdbId !== tmdbId) {
        const doc = loadDocument(settings)
        const entry = doc.titles[key]
        if (entry) {
            entry.tmdbId = details.tmdbId
            if (!entry.imdbId && details.imdbId) entry.imdbId = details.imdbId
            if (details.totalEpisodes) entry.totalEpisodes = details.totalEpisodes
            saveDocument(settings, doc)
        }
    }

    return details
}

// --- title mutations --------------------------------------------------------

async function addTitle(settings, mediaType, tmdbId) {
    const details = await tmdbDetails(settings, mediaType, tmdbId)
    const doc = loadDocument(settings)
    const existingKey = tracker.findTitle(doc, details)

    if (existingKey) {
        // Refresh metadata but keep the user's own status/rating/progress.
        const existing = doc.titles[existingKey]
        doc.titles[existingKey] = {
            ...existing,
            tmdbId: details.tmdbId,
            imdbId: details.imdbId || existing.imdbId || "",
            title: details.title,
            year: details.year,
            overview: details.overview,
            poster: details.poster,
            genres: details.genres,
            runtime: details.runtime,
            totalEpisodes: details.totalEpisodes || existing.totalEpisodes || 0
        }
        saveDocument(settings, doc)
        return { key: existingKey, title: details.title, existed: true }
    }

    const key = tracker.titleKey(details)
    doc.titles[key] = tracker.normalizeTitle({
        ...details,
        status: settings.defaultStatus || "planned",
        addedAt: today()
    })
    saveDocument(settings, doc)
    return { key, title: details.title, existed: false }
}

function requireEntry(doc, key) {
    const entry = doc.titles[key]
    if (!entry) throw new Error("That title is not in the library")
    return entry
}

function setStatus(settings, key, status) {
    if (!tracker.STATUSES.includes(status)) throw new Error(`Unknown status: ${status}`)
    const doc = loadDocument(settings)
    const entry = requireEntry(doc, key)
    entry.status = status
    if (status === "watched") entry.lastWatched = today()
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

function setEpisode(settings, key, season, episode, watched) {
    const doc = loadDocument(settings)
    const entry = requireEntry(doc, key)

    const current = tracker.parseEpisodes(entry.watchedEpisodes || "")
    const next = tracker.withEpisode(current, Number(season), Number(episode), !!watched)
    entry.watchedEpisodes = tracker.formatEpisodes(next)
    entry.status = tracker.statusFromProgress(tracker.countEpisodes(next), Number(entry.totalEpisodes) || 0)
    if (watched) entry.lastWatched = today()

    saveDocument(settings, doc)
    return { ok: true, watchedEpisodes: entry.watchedEpisodes, status: entry.status }
}

function removeTitle(settings, key) {
    const doc = loadDocument(settings)
    requireEntry(doc, key)
    delete doc.titles[key]
    saveDocument(settings, doc)
    return { ok: true }
}

// --- Trakt ------------------------------------------------------------------

// Credentials are trimmed at every use: a client id pasted from Trakt's site
// often carries a trailing space or newline, and Trakt reports that as
// "client not found" -- indistinguishable from a genuinely wrong id.
function traktClientId(settings) {
    return String(settings.traktClientId || "").trim()
}

function traktClientSecret(settings) {
    return String(settings.traktClientSecret || "").trim()
}

// Trakt returns a specific error_description ("client not found",
// "client_id is required", ...). Surface it instead of only the status code,
// and add the likely cause for the ambiguous ones.
async function traktError(res, clientId) {
    let detail = ""
    try {
        const body = await res.json()
        detail = body.error_description || body.error || ""
    } catch (e) {
        // Non-JSON body; fall back to the status alone.
    }

    if (res.status === 401 && detail === "client not found") {
        return "Trakt does not recognise this Client ID. Check it against your app at "
            + "trakt.tv/oauth/applications -- copy the Client ID, not the Client Secret, "
            + `and make sure the whole value was pasted (currently ${clientId.length} characters).`
    }
    if (res.status === 403) {
        return "Trakt refused the request (HTTP 403). The API app may be suspended or deleted."
    }
    return detail
        ? `Trakt rejected the request: ${detail} (HTTP ${res.status})`
        : `Trakt rejected the request (HTTP ${res.status})`
}

function traktHeaders(settings, withAuth) {
    const headers = {
        "Content-Type": "application/json",
        "trakt-api-version": "2",
        "trakt-api-key": traktClientId(settings)
    }
    if (withAuth) headers["Authorization"] = `Bearer ${settings.traktAccessToken}`
    return headers
}

async function traktAuthStart(settings) {
    const clientId = traktClientId(settings)
    if (!clientId) throw new Error("Set a Trakt Client ID in Settings first")

    const res = await postJson(`${TRAKT_API}/oauth/device/code`, { client_id: clientId })
    if (!res.ok) throw new Error(await traktError(res, clientId))
    const json = await res.json()
    return {
        deviceCode: json.device_code,
        userCode: json.user_code,
        verificationUrl: json.verification_url,
        expiresIn: json.expires_in,
        interval: json.interval
    }
}

// Polled by the frontend. Status codes are Trakt's documented device-flow
// semantics, so each maps to a distinct UI state rather than a generic error.
async function traktAuthPoll(settings, deviceCode) {
    if (!traktClientSecret(settings)) throw new Error("Set a Trakt Client Secret in Settings first")
    const res = await postJson(`${TRAKT_API}/oauth/device/token`, {
        code: deviceCode,
        client_id: traktClientId(settings),
        client_secret: traktClientSecret(settings)
    })

    if (res.status === 200) {
        const json = await res.json()
        persistFields({
            traktAccessToken: json.access_token,
            traktRefreshToken: json.refresh_token,
            traktTokenExpiresAt: (json.created_at || 0) + (json.expires_in || 0)
        })
        return { state: "authorized" }
    }
    if (res.status === 400) return { state: "pending" }
    if (res.status === 429) return { state: "slow_down" }
    if (res.status === 404) throw new Error("Authorization code is not valid. Start again.")
    if (res.status === 409) throw new Error("This code was already used. Start again.")
    if (res.status === 410) throw new Error("The code expired. Start again.")
    if (res.status === 418) throw new Error("Authorization was denied.")
    throw new Error(`Unexpected Trakt response (HTTP ${res.status})`)
}

async function traktRefreshIfNeeded(settings) {
    const expiresAt = Number(settings.traktTokenExpiresAt) || 0
    const now = Math.floor(Date.now() / 1000)
    // Refresh a little early so a long import doesn't expire mid-run.
    if (!settings.traktRefreshToken || expiresAt === 0 || now < expiresAt - 300) return settings
    const res = await postJson(`${TRAKT_API}/oauth/token`, {
        refresh_token: settings.traktRefreshToken,
        client_id: traktClientId(settings),
        client_secret: traktClientSecret(settings),
        grant_type: "refresh_token"
    })
    if (!res.ok) throw new Error("Trakt session expired and could not be renewed. Authorize again.")
    const json = await res.json()
    const fields = {
        traktAccessToken: json.access_token,
        traktRefreshToken: json.refresh_token,
        traktTokenExpiresAt: (json.created_at || 0) + (json.expires_in || 0)
    }
    persistFields(fields)
    return { ...settings, ...fields }
}

async function importTrakt(settings) {
    if (!settings.traktAccessToken) throw new Error("Authorize with Trakt first")
    const current = await traktRefreshIfNeeded(settings)

    const movies = await getJson(`${TRAKT_API}/sync/watched/movies`, traktHeaders(current, true))
    const shows = await getJson(`${TRAKT_API}/sync/watched/shows`, traktHeaders(current, true))

    const items = []

    for (const entry of movies || []) {
        const movie = entry.movie || {}
        items.push({
            mediaType: "movie",
            title: movie.title,
            year: movie.year,
            tmdbId: movie.ids?.tmdb,
            imdbId: movie.ids?.imdb,
            traktId: movie.ids?.trakt,
            lastWatched: entry.last_watched_at,
            status: "watched"
        })
    }

    for (const entry of shows || []) {
        const show = entry.show || {}
        const watched = {}
        for (const season of entry.seasons || []) {
            if (!season.number) continue
            for (const episode of season.episodes || []) {
                if (!episode.number) continue
                if (!watched[season.number]) watched[season.number] = new Set()
                watched[season.number].add(episode.number)
            }
        }
        items.push({
            mediaType: "show",
            title: show.title,
            year: show.year,
            tmdbId: show.ids?.tmdb,
            imdbId: show.ids?.imdb,
            traktId: show.ids?.trakt,
            lastWatched: entry.last_watched_at,
            episodes: watched
        })
    }

    return applyImport(current, items)
}

// --- Stremio ----------------------------------------------------------------

async function stremioPost(path, body) {
    const res = await postJson(`${STREMIO_API}/${path}`, body)
    let json
    try { json = await res.json() } catch (e) { throw new Error(`Stremio API error (HTTP ${res.status})`) }
    if (json.error) throw new Error(json.error.message || "Stremio API error")
    return json.result
}

async function stremioLogin(settings) {
    if (!settings.stremioEmail || !settings.stremioPassword) {
        throw new Error("Set a Stremio email and password in Settings first")
    }
    const result = await stremioPost("login", {
        type: "Login",
        email: settings.stremioEmail,
        password: settings.stremioPassword
    })
    // Drop the password once it has served its purpose.
    persistFields({ stremioAuthKey: result.authKey, stremioPassword: "" })
    return { ok: true }
}

async function importStremio(settings) {
    if (!settings.stremioAuthKey) throw new Error("Log in to Stremio first")
    const library = await stremioPost("datastoreGet", {
        authKey: settings.stremioAuthKey,
        collection: "libraryItem",
        ids: [],
        all: true
    })

    const items = []

    for (const item of library || []) {
        if (item.removed || item.type === "other") continue
        // Stremio ids are imdb ids, optionally suffixed ":season:episode".
        const imdbId = String(item._id || "").split(":")[0]
        if (!imdbId.startsWith("tt")) continue

        const mediaType = item.type === "series" ? "show" : "movie"
        const watched = {}
        if (mediaType === "show" && item.state?.video_id) {
            const parts = String(item.state.video_id).split(":")
            const season = Number(parts[1])
            const episode = Number(parts[2])
            // Stremio tracks only the current position, not full history, so
            // this marks everything up to it as watched within that season.
            if (Number.isFinite(season) && Number.isFinite(episode)) {
                watched[season] = new Set()
                for (let n = 1; n <= episode; n++) watched[season].add(n)
            }
        }

        items.push({
            mediaType,
            title: item.name,
            imdbId,
            lastWatched: item.state?.lastWatched,
            episodes: watched,
            status: mediaType === "movie" && item.state?.timesWatched > 0 ? "watched" : undefined
        })
    }

    return applyImport(settings, items)
}

// --- shared import ----------------------------------------------------------

// One-way and idempotent: matches each incoming item against the document by any
// shared id, merges episode progress rather than replacing it, and never touches
// a rating unless explicitly allowed. Reads the document once and writes once,
// so a large import is a single note write and can't half-apply.
async function applyImport(settings, items) {
    const doc = loadDocument(settings)
    let added = 0
    let updated = 0

    for (const item of items) {
        const existingKey = tracker.findTitle(doc, item)

        let details = {
            tmdbId: item.tmdbId ? String(item.tmdbId) : "",
            imdbId: item.imdbId ? String(item.imdbId) : "",
            traktId: item.traktId ? String(item.traktId) : "",
            mediaType: item.mediaType,
            title: item.title || "Untitled",
            year: item.year ? String(item.year) : ""
        }

        // Enrich from TMDB on first import only; an existing entry already has it.
        // An item with only an IMDb id (every Stremio item, and Trakt entries
        // whose TMDB id is absent) is resolved through /find first, so it still
        // gets a poster, overview, and -- for shows -- an episode count.
        if (!existingKey && settings.importFetchMetadata && settings.tmdbApiKey
            && (item.tmdbId || item.imdbId)) {
            try {
                const fetched = await resolveDetails(
                    settings, item.mediaType, item.tmdbId ? String(item.tmdbId) : "", details.imdbId
                )
                details = {
                    ...fetched,
                    traktId: details.traktId,
                    imdbId: fetched.imdbId || details.imdbId
                }
            } catch (e) {
                // Metadata is a nice-to-have; never fail an import over it.
            }
        }

        const key = existingKey || tracker.titleKey(details)
        if (!key) continue

        const previous = doc.titles[key] || {}

        // A rating from the source is only taken when the user opted in;
        // otherwise their own rating always wins.
        const incomingRating = Number.isFinite(Number(item.rating)) ? Number(item.rating) : null
        const rating = (settings.importOverwriteRatings && incomingRating !== null)
            ? incomingRating
            : (previous.rating ?? null)
        const entry = tracker.normalizeTitle({
            ...previous,
            ...details,
            // Preserve the user's own fields across a re-import.
            status: previous.status,
            rating,
            watchedEpisodes: previous.watchedEpisodes,
            totalEpisodes: details.totalEpisodes || previous.totalEpisodes || 0,
            addedAt: previous.addedAt || today()
        })

        if (item.lastWatched) entry.lastWatched = String(item.lastWatched).slice(0, 10)

        if (item.mediaType === "show" && item.episodes && Object.keys(item.episodes).length) {
            const merged = tracker.mergeEpisodes(
                tracker.parseEpisodes(entry.watchedEpisodes || ""),
                item.episodes
            )
            entry.watchedEpisodes = tracker.formatEpisodes(merged)
            if (settings.importMarksWatched) {
                entry.status = tracker.statusFromProgress(
                    tracker.countEpisodes(merged),
                    Number(entry.totalEpisodes) || 0
                )
            }
        } else if (item.status && settings.importMarksWatched) {
            entry.status = item.status
        }

        doc.titles[key] = entry
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
            case "listTitles":
                return sendJson(200, { titles: tracker.listTitles(loadDocument(settings)) })
            case "search":
                return sendJson(200, { results: await tmdbSearch(settings, query.query || "", query.mediaType) })
            case "details":
                return sendJson(200, await detailsForKey(settings, query.mediaType, query.tmdbId, query.imdbId, query.key))
            case "addTitle":
                return sendJson(200, await addTitle(settings, query.mediaType, query.tmdbId))
            case "removeTitle":
                return sendJson(200, removeTitle(settings, query.key))
            case "setStatus":
                return sendJson(200, setStatus(settings, query.key, query.status))
            case "setRating":
                return sendJson(200, setRating(settings, query.key, query.rating))
            case "setEpisode":
                return sendJson(200, setEpisode(settings, query.key, query.season, query.episode, query.watched === "true"))
            case "traktAuthStart":
                return sendJson(200, await traktAuthStart(settings))
            case "traktAuthPoll":
                return sendJson(200, await traktAuthPoll(settings, query.deviceCode))
            case "importTrakt":
                return sendJson(200, await importTrakt(settings))
            case "stremioLogin":
                return sendJson(200, await stremioLogin(settings))
            case "importStremio":
                return sendJson(200, await importStremio(settings))
            default:
                return sendJson(400, { error: `Unknown action: ${action}` })
        }
    } catch (e) {
        return sendJson(500, { error: e.message })
    }
}

handle()
