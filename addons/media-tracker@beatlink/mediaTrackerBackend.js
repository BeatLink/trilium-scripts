/*
 * media-tracker@beatlink — backend customRequestHandler ("mediaTracker").
 *
 * One HTTP endpoint (custom/mediaTracker) routed by ?action=:
 *
 *   search           TMDB multi search (movies + shows)
 *   details          TMDB details for one title, incl. per-season episode counts
 *   addTitle         create/update a title note from a TMDB id
 *   setStatus        set #watchStatus on a title note
 *   setRating        set #rating on a title note
 *   setEpisode       mark one episode watched/unwatched on a show note
 *   createLibrary    create a library root note with the collection views set up
 *   traktAuthStart   begin Trakt device authorization
 *   traktAuthPoll    poll for the user approving it
 *   importTrakt      one-way import of Trakt watched movies + shows
 *   stremioLogin     exchange Stremio email/password for an auth key
 *   importStremio    one-way import of the Stremio library
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

// --- http helpers -----------------------------------------------------------

async function getJson(url, headers) {
    const res = await fetch(url, { headers: headers || {} })
    if (!res.ok) throw new Error(`Request failed (HTTP ${res.status})`)
    return res.json()
}

async function postJson(url, body, headers) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(headers || {}) },
        body: JSON.stringify(body)
    })
    return res
}

// --- TMDB -------------------------------------------------------------------

function requireTmdbKey(settings) {
    if (!settings.tmdbApiKey) throw new Error("Set a TMDB API key in Settings first")
    return settings.tmdbApiKey
}

async function tmdbSearch(settings, query) {
    const key = requireTmdbKey(settings)
    const url = `${TMDB_API}/search/multi?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(query)}`
    const json = await getJson(url)
    return (json.results || [])
        .filter(r => r.media_type === "movie" || r.media_type === "tv")
        .map(r => ({
            tmdbId: String(r.id),
            mediaType: r.media_type === "tv" ? "show" : "movie",
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

// --- title notes ------------------------------------------------------------

function requireLibraryRoot(settings) {
    if (!settings.libraryRootNoteId) throw new Error("Set a Library Root in Settings, or click Create Library")
    const note = api.getNote(settings.libraryRootNoteId)
    if (!note || note.isDeleted) throw new Error("Library Root note not found")
    return note
}

// Find an existing title note by any known id, strongest first. This is what
// makes repeated imports idempotent and lets two sources converge on one note.
function findExistingTitle(rootNoteId, identity) {
    for (const label of tracker.ID_LABELS) {
        const value = identity[label]
        if (!value) continue
        const escaped = value.replace(/"/g, '\\"')
        const matches = api.searchForNotes(`#mediaTitle #${label}="${escaped}"`)
        const live = matches.find(n => !n.isDeleted && isUnder(n, rootNoteId))
        if (live) return live
    }
    return null
}

function isUnder(note, rootNoteId) {
    // A title note is a direct child of the library root by construction; check
    // parents rather than walking the whole ancestor chain.
    return note.getParentNotes().some(p => p.noteId === rootNoteId)
}

function setLabelIfValue(note, name, value) {
    if (value === undefined || value === null || value === "") return
    note.setLabel(name, String(value))
}

function createTitleNote(rootNote, details, settings) {
    const { note } = api.createNewNote({
        parentNoteId: rootNote.noteId,
        title: details.title || "Untitled",
        type: "text",
        content: details.overview ? `<p>${escapeHtml(details.overview)}</p>` : ""
    })
    note.setLabel("mediaTitle")
    note.setLabel("mediaType", details.mediaType)
    note.setLabel("watchStatus", settings.defaultStatus || "planned")
    note.setLabel("iconClass", details.mediaType === "show" ? "bx bx-tv" : "bx bx-film")
    return note
}

function applyMetadata(note, details) {
    setLabelIfValue(note, "tmdbId", details.tmdbId)
    setLabelIfValue(note, "imdbId", details.imdbId)
    setLabelIfValue(note, "traktId", details.traktId)
    setLabelIfValue(note, "year", details.year)
    setLabelIfValue(note, "poster", details.poster)
    setLabelIfValue(note, "genres", details.genres)
    if (details.runtime) note.setLabel("runtime", String(details.runtime))
    if (details.totalEpisodes) note.setLabel("totalEpisodes", String(details.totalEpisodes))
}

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ))
}

async function addTitle(settings, mediaType, tmdbId) {
    const rootNote = requireLibraryRoot(settings)
    const details = await tmdbDetails(settings, mediaType, tmdbId)
    const existing = findExistingTitle(rootNote.noteId, tracker.identityOf(details))
    const note = existing || createTitleNote(rootNote, details, settings)
    applyMetadata(note, details)
    return { noteId: note.noteId, title: details.title, existed: !!existing }
}

// --- library provisioning ---------------------------------------------------

// Creates the library root as a board grouped by watch status. Everything the
// user browses is a built-in Trilium collection view over real notes, so no
// custom rendering is needed for the library itself.
function createLibrary(settings) {
    const { note } = api.createNewNote({
        parentNoteId: "root",
        title: "Movies & TV",
        type: "book",
        content: ""
    })
    note.setLabel("viewType", "board")
    note.setLabel("board:groupBy", "watchStatus")
    note.setLabel("iconClass", "bx bx-movie-play")
    persistFields({ libraryRootNoteId: note.noteId })
    return { noteId: note.noteId }
}

// --- Trakt ------------------------------------------------------------------

function traktHeaders(settings, withAuth) {
    const headers = {
        "Content-Type": "application/json",
        "trakt-api-version": "2",
        "trakt-api-key": settings.traktClientId
    }
    if (withAuth) headers["Authorization"] = `Bearer ${settings.traktAccessToken}`
    return headers
}

async function traktAuthStart(settings) {
    if (!settings.traktClientId) throw new Error("Set a Trakt Client ID in Settings first")
    const res = await postJson(`${TRAKT_API}/oauth/device/code`, { client_id: settings.traktClientId })
    if (!res.ok) throw new Error(`Trakt rejected the client ID (HTTP ${res.status})`)
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
    if (!settings.traktClientSecret) throw new Error("Set a Trakt Client Secret in Settings first")
    const res = await postJson(`${TRAKT_API}/oauth/device/token`, {
        code: deviceCode,
        client_id: settings.traktClientId,
        client_secret: settings.traktClientSecret
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
        client_id: settings.traktClientId,
        client_secret: settings.traktClientSecret,
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
    const rootNote = requireLibraryRoot(current)

    const movies = await getJson(`${TRAKT_API}/sync/watched/movies`, traktHeaders(current, true))
    const shows = await getJson(`${TRAKT_API}/sync/watched/shows`, traktHeaders(current, true))

    let added = 0
    let updated = 0

    for (const entry of movies || []) {
        const movie = entry.movie || {}
        const result = await upsertImported(current, rootNote, {
            mediaType: "movie",
            title: movie.title,
            year: movie.year,
            tmdbId: movie.ids?.tmdb,
            imdbId: movie.ids?.imdb,
            traktId: movie.ids?.trakt,
            lastWatched: entry.last_watched_at,
            status: "watched"
        })
        result.existed ? updated++ : added++
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
        const result = await upsertImported(current, rootNote, {
            mediaType: "show",
            title: show.title,
            year: show.year,
            tmdbId: show.ids?.tmdb,
            imdbId: show.ids?.imdb,
            traktId: show.ids?.trakt,
            lastWatched: entry.last_watched_at,
            episodes: watched
        })
        result.existed ? updated++ : added++
    }

    return { added, updated, total: added + updated }
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
    const rootNote = requireLibraryRoot(settings)
    const items = await stremioPost("datastoreGet", {
        authKey: settings.stremioAuthKey,
        collection: "libraryItem",
        ids: [],
        all: true
    })

    let added = 0
    let updated = 0

    for (const item of items || []) {
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

        const result = await upsertImported(settings, rootNote, {
            mediaType,
            title: item.name,
            imdbId,
            lastWatched: item.state?.lastWatched,
            episodes: watched,
            status: mediaType === "movie" && item.state?.timesWatched > 0 ? "watched" : undefined
        })
        result.existed ? updated++ : added++
    }

    return { added, updated, total: added + updated }
}

// --- shared import upsert ---------------------------------------------------

// One-way: creates the note if missing, otherwise merges into it. Never removes
// local episode progress and never touches a user's rating unless explicitly
// allowed, so re-importing is always safe.
async function upsertImported(settings, rootNote, item) {
    const identity = tracker.identityOf(item)
    const existing = findExistingTitle(rootNote.noteId, identity)

    let details = {
        ...identity,
        mediaType: item.mediaType,
        title: item.title || "Untitled",
        year: item.year ? String(item.year) : ""
    }

    // Enrich from TMDB on first import only; an existing note already has it.
    if (!existing && settings.importFetchMetadata && settings.tmdbApiKey && item.tmdbId) {
        try {
            const fetched = await tmdbDetails(settings, item.mediaType, item.tmdbId)
            details = { ...fetched, traktId: identity.traktId, imdbId: fetched.imdbId || identity.imdbId }
        } catch (e) {
            // Metadata is a nice-to-have; never fail an import over it.
        }
    }

    const note = existing || createTitleNote(rootNote, details, settings)
    applyMetadata(note, details)

    if (item.lastWatched) setLabelIfValue(note, "lastWatched", String(item.lastWatched).slice(0, 10))

    if (item.mediaType === "show" && item.episodes && Object.keys(item.episodes).length) {
        const current = tracker.parseEpisodes(note.getLabelValue("watchedEpisodes") || "")
        const merged = tracker.mergeEpisodes(current, item.episodes)
        note.setLabel("watchedEpisodes", tracker.formatEpisodes(merged))
        if (settings.importMarksWatched) {
            const total = Number(note.getLabelValue("totalEpisodes")) || 0
            note.setLabel("watchStatus", tracker.statusFromProgress(tracker.countEpisodes(merged), total))
        }
    } else if (item.status && settings.importMarksWatched) {
        note.setLabel("watchStatus", item.status)
    }

    return { existed: !!existing, noteId: note.noteId }
}

// --- title mutations --------------------------------------------------------

function getTitleNote(noteId) {
    const note = api.getNote(noteId)
    if (!note || note.isDeleted) throw new Error("Title note not found")
    if (!note.hasLabel("mediaTitle")) throw new Error("That note is not a tracked title")
    return note
}

function setStatus(noteId, status) {
    if (!tracker.STATUSES.includes(status)) throw new Error(`Unknown status: ${status}`)
    const note = getTitleNote(noteId)
    note.setLabel("watchStatus", status)
    if (status === "watched") note.setLabel("lastWatched", new Date().toISOString().slice(0, 10))
    return { ok: true }
}

function setRating(noteId, rating) {
    const value = Number(rating)
    if (!Number.isFinite(value) || value < 0 || value > 10) throw new Error("Rating must be 0-10")
    const note = getTitleNote(noteId)
    note.setLabel("rating", String(value))
    return { ok: true }
}

function setEpisode(noteId, season, episode, watched) {
    const note = getTitleNote(noteId)
    const current = tracker.parseEpisodes(note.getLabelValue("watchedEpisodes") || "")
    const next = tracker.withEpisode(current, Number(season), Number(episode), !!watched)
    const encoded = tracker.formatEpisodes(next)
    note.setLabel("watchedEpisodes", encoded)

    const total = Number(note.getLabelValue("totalEpisodes")) || 0
    note.setLabel("watchStatus", tracker.statusFromProgress(tracker.countEpisodes(next), total))
    if (watched) note.setLabel("lastWatched", new Date().toISOString().slice(0, 10))
    return { ok: true, watchedEpisodes: encoded }
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
            case "search":
                return sendJson(200, { results: await tmdbSearch(settings, query.query || "") })
            case "details":
                return sendJson(200, await tmdbDetails(settings, query.mediaType, query.tmdbId))
            case "addTitle":
                return sendJson(200, await addTitle(settings, query.mediaType, query.tmdbId))
            case "setStatus":
                return sendJson(200, setStatus(query.noteId, query.status))
            case "setRating":
                return sendJson(200, setRating(query.noteId, query.rating))
            case "setEpisode":
                return sendJson(200, setEpisode(query.noteId, query.season, query.episode, query.watched === "true"))
            case "createLibrary":
                return sendJson(200, createLibrary(settings))
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
