/*
 * youtube-manager@beatlink -- backend customRequestHandler ("youtubeManager").
 *
 * This note does two unrelated jobs, and they are unrelated on purpose.
 *
 * 1. It is the CORS proxy YouTube.js requires. YouTube's InnerTube endpoints
 *    send no CORS headers, so the widget cannot call them from Trilium's
 *    origin. Upstream's answer is "proxy through your own server"; Trilium's
 *    backend already is that server, and going through it makes every call
 *    same-origin from the widget's side. The proxy is deliberately narrow: it
 *    forwards to an allowlist of YouTube hosts and nothing else, so enabling
 *    this addon does not hand anyone on the network a general-purpose request
 *    forwarder into whatever the Trilium server can reach.
 *
 * 2. It owns every read and write of the database note, so there is exactly one
 *    writer per operation and the widget never parses that document itself.
 *
 * YouTube.js itself does NOT run here. The package is "type": "module" with no
 * CommonJS entry anywhere in its exports map, and backend scripts are CommonJS
 * require(), so it can only run in the frontend. That is also why this addon has
 * no scheduled refresh: a background #run script is a backend script, and a
 * backend script cannot load the library that does the fetching. Refreshes
 * happen when the widget is open.
 *
 * Actions, routed by ?action=:
 *
 *   proxy           POST; forward one YouTube.js request and return its response
 *   load            read the whole document plus the settings the widget needs
 *   addChannels     POST; merge channel records into the subscription list
 *   removeChannel   drop a channel and its cached videos
 *   mergeVideos     POST; merge a refresh result, then prune the cache
 *   setWatched      mark one video watched or unwatched
 *   setWatchedMany  POST; same for a list of ids, in one write
 *   saveView        persist the widget's remembered view state
 */

const { loadSettings, saveSettings } = require("libSettings.js")
const store = require("libYouTubeStore.js")

const DATABASE_TITLE = "Database"

// Only these hosts may be reached through the proxy. Matched as an exact host
// or a dot-suffix, so "evil-youtube.com" and "youtube.com.attacker.net" both
// fail. Without this the endpoint would forward anywhere the Trilium server can
// reach, including its own loopback interface and any private network it sits
// on.
const ALLOWED_HOSTS = [
    "youtube.com",
    "youtubei.googleapis.com",
    "ytimg.com",
    "ggpht.com"
]

// Headers that must not be copied from the widget's request. Hop-by-hop headers
// describe the browser-to-Trilium connection rather than the Trilium-to-YouTube
// one, and letting the caller set host/origin/referer would let it forge the
// request YouTube actually sees.
const BLOCKED_REQUEST_HEADERS = new Set([
    "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade", "content-length",
    "origin", "referer", "cookie", "accept-encoding"
])

// --- settings ---------------------------------------------------------------

function getNoteIds() {
    const schemaNoteId = api.currentNote.getRelationValue("schemaNote")
    const settingsNoteId = api.currentNote.getRelationValue("settingsNote")
    if (!schemaNoteId || !settingsNoteId) throw new Error("YouTube Manager settings notes not found")
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

// The database note lives in the addon's own persistence tree, so there is no
// library-root setup step before the addon works. Resolved by relation, with a
// find-or-create fallback so a fresh install works before TAM has wired it.
function resolveDatabaseNote() {
    const relationTarget = api.currentNote.getRelationValue("databaseNote")
    if (relationTarget) {
        const note = api.getNote(relationTarget)
        if (note && !note.isDeleted) return note
    }

    const tagged = api.getNoteWithLabel("youtubeManagerDatabase")
    if (tagged && !tagged.isDeleted) return tagged

    const { note } = api.createNewNote({
        parentNoteId: api.currentNote.getParentNoteIds()[0],
        title: DATABASE_TITLE,
        type: "code",
        mime: "application/json",
        content: JSON.stringify(store.emptyDoc(), null, 4)
    })
    note.setLabel("youtubeManagerDatabase")
    note.setLabel("iconClass", "bx bx-data")
    return note
}

function loadDocument() {
    return store.parseDoc(resolveDatabaseNote().getContent())
}

function saveDocument(doc) {
    resolveDatabaseNote().setContent(JSON.stringify(doc, null, 4))
}

// --- proxy ------------------------------------------------------------------

function isAllowedHost(host) {
    const lower = String(host || "").toLowerCase()
    return ALLOWED_HOSTS.some(allowed => lower === allowed || lower.endsWith(`.${allowed}`))
}

function sanitizeRequestHeaders(headers) {
    const clean = {}
    if (headers && typeof headers === "object") {
        for (const [name, value] of Object.entries(headers)) {
            if (BLOCKED_REQUEST_HEADERS.has(String(name).toLowerCase())) continue
            if (typeof value === "string") clean[name] = value
        }
    }
    return clean
}

// Forwards one YouTube.js request. The response is returned as JSON rather than
// streamed back verbatim because YouTube.js only needs the status, a couple of
// headers, and a text body -- every InnerTube response is JSON or JS text. It
// deliberately cannot carry binary, which is the other reason media streams are
// out of scope for this addon.
async function proxy(payload) {
    let target
    try {
        target = new URL(payload.url)
    } catch (e) {
        throw new Error("Proxy request has no valid URL")
    }
    if (target.protocol !== "https:") throw new Error("Proxy only forwards https")
    if (!isAllowedHost(target.hostname)) throw new Error(`Proxy refuses host: ${target.hostname}`)

    const method = ["GET", "POST", "HEAD"].includes(payload.method) ? payload.method : "GET"
    const response = await fetch(target.href, {
        method,
        headers: sanitizeRequestHeaders(payload.headers),
        body: method === "GET" || method === "HEAD" ? undefined : payload.body,
        redirect: "follow"
    })

    return {
        status: response.status,
        headers: { "content-type": response.headers.get("content-type") || "application/json" },
        body: await response.text()
    }
}

// --- actions ----------------------------------------------------------------

// Everything the widget needs for a first paint in one request: the document
// plus the handful of settings that shape the view.
function load() {
    const settings = getSettings()
    const doc = loadDocument()
    return {
        channels: doc.channels,
        videos: doc.videos,
        watched: doc.watched,
        lastRefresh: doc.lastRefresh,
        settings: {
            hideShorts: settings.hideShorts,
            videosPerChannel: settings.videosPerChannel,
            retentionDays: settings.retentionDays,
            refreshIntervalHours: settings.refreshIntervalHours,
            markWatchedOnPlay: settings.markWatchedOnPlay,
            viewFilter: settings.viewFilter,
            viewChannel: settings.viewChannel,
            viewSortDesc: settings.viewSortDesc
        }
    }
}

function addChannels(channels) {
    if (!Array.isArray(channels)) throw new Error("addChannels needs a channels array")
    const doc = loadDocument()
    const result = store.addChannels(doc, channels)
    saveDocument(doc)
    return result
}

function removeChannel(channelId) {
    if (!channelId) throw new Error("removeChannel needs a channelId")
    const doc = loadDocument()
    const result = store.removeChannel(doc, channelId)
    saveDocument(doc)
    return result
}

// One write for a whole refresh: merge every channel's videos, prune the cache,
// stamp the refresh time. A refresh that fails partway leaves the document
// untouched rather than half-updated.
function mergeVideos(videos) {
    if (!Array.isArray(videos)) throw new Error("mergeVideos needs a videos array")
    const settings = getSettings()
    const doc = loadDocument()
    const merged = store.mergeVideos(doc, videos)
    const pruned = store.pruneVideos(doc, settings.retentionDays)
    doc.lastRefresh = new Date().toISOString()
    saveDocument(doc)
    return { ...merged, ...pruned, lastRefresh: doc.lastRefresh }
}

function setWatched(videoId, watched) {
    if (!videoId) throw new Error("setWatched needs a videoId")
    const doc = loadDocument()
    const result = store.setWatched(doc, videoId, watched)
    saveDocument(doc)
    return result
}

function setWatchedMany(videoIds, watched) {
    if (!Array.isArray(videoIds)) throw new Error("setWatchedMany needs a videoIds array")
    const doc = loadDocument()
    const result = store.setWatchedMany(doc, videoIds, watched)
    saveDocument(doc)
    return result
}

// The widget's remembered filters live in the settings note as hidden fields,
// so they persist without cluttering the settings page.
function saveView(query) {
    const fields = {}
    if (query.viewFilter !== undefined) fields.viewFilter = query.viewFilter
    if (query.viewChannel !== undefined) fields.viewChannel = query.viewChannel
    if (query.viewSortDesc !== undefined) fields.viewSortDesc = query.viewSortDesc === "true"
    if (query.hideShorts !== undefined) fields.hideShorts = query.hideShorts === "true"
    if (Object.keys(fields).length) persistFields(fields)
    return { ok: true }
}

// --- routing ----------------------------------------------------------------

function sendJson(status, obj) {
    api.res.status(status).json(obj)
}

async function handle() {
    const query = api.req.query
    const action = query.action
    // Proxy payloads and bulk id lists arrive as POST bodies; a serialized
    // InnerTube request is far past what a query string can carry. Trilium
    // parses JSON bodies for a customRequestHandler, so this is already an
    // object.
    const body = api.req.body || {}

    try {
        switch (action) {
            case "proxy":
                return sendJson(200, await proxy(body))
            case "load":
                return sendJson(200, load())
            case "addChannels":
                return sendJson(200, addChannels(body.channels))
            case "removeChannel":
                return sendJson(200, removeChannel(query.channelId))
            case "mergeVideos":
                return sendJson(200, mergeVideos(body.videos))
            case "setWatched":
                return sendJson(200, setWatched(query.videoId, query.watched === "true"))
            case "setWatchedMany":
                return sendJson(200, setWatchedMany(body.videoIds, body.watched === true))
            case "saveView":
                return sendJson(200, saveView(query))
            default:
                return sendJson(400, { error: `Unknown action: ${action}` })
        }
    } catch (e) {
        return sendJson(500, { error: e.message })
    }
}

// Only serve a request when there actually is one, so requiring this note for
// its exports cannot trigger the handler on a missing api.req/api.res.
if (typeof api !== "undefined" && api.req && api.res) handle()
