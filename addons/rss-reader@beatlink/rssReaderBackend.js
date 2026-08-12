/*
 * rss-reader@beatlink -- backend customRequestHandler ("rssReader").
 *
 * This note does two unrelated jobs, and they are unrelated on purpose.
 *
 * 1. It is the fetcher. Feeds and FreshRSS both live on other origins and a
 *    feed is a static file that sends no CORS headers, so the widget cannot
 *    read one from Trilium's origin. Going through this note makes every
 *    request same-origin from the widget's side. Unlike a single-service proxy
 *    there is no fixed host allowlist, because fetching whatever URL you
 *    subscribed to is the entire function of a feed reader; what is refused is
 *    a non-http(s) scheme, and private/loopback addresses unless you turn them
 *    on or they are the FreshRSS server you configured.
 *
 * 2. It owns every read and write of the database note, so there is exactly one
 *    writer per operation and the widget never parses that document itself.
 *
 * Feeds are parsed in the widget rather than here: XML parsing needs DOMParser,
 * which exists in the browser and not in a Trilium backend script. That is also
 * why there is no scheduled refresh -- a background #run script is a backend
 * script, so it could fetch a feed but not read it. Refreshes happen when the
 * widget is open.
 *
 * Actions, routed by ?action=:
 *
 *   fetch             POST; forward one request and return its response
 *   load              read the whole document plus the settings the widget needs
 *   addFeeds          POST; merge feed records into the feed list
 *   syncFeeds         POST; replace the FreshRSS half of the feed list
 *   removeFeed        drop a feed and its cached articles
 *   setFeedFolder     move a feed into a folder
 *   setFeedErrors     POST; record or clear the last fetch error of each feed
 *   mergeArticles     POST; merge a batch of articles, then prune the cache
 *   stampRefresh      record that a refresh pass finished
 *   setState          mark one article read/unread or starred/unstarred
 *   setStateMany      POST; same for a list of ids, in one write
 *   applyRemoteState  POST; reconcile state against FreshRSS's own view of it
 *   clearPending      POST; drop queued changes that reached FreshRSS
 *   saveView          persist the widget's remembered view state
 */

const { loadSettings, saveSettings } = require("libSettings.js")
const store = require("libRssStore.js")

const DATABASE_TITLE = "Database"

// A feed that answers with tens of megabytes is a mistake or an attack, not a
// feed, and the whole body is buffered in memory here before the widget sees it.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

const FETCH_TIMEOUT_MS = 30000

// Headers that must not be copied from the widget's request. Hop-by-hop headers
// describe the browser-to-Trilium connection rather than the Trilium-to-feed
// one, and letting the caller set host/origin/referer would let it forge the
// request the far end actually sees.
const BLOCKED_REQUEST_HEADERS = new Set([
    "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade", "content-length",
    "origin", "referer", "cookie", "accept-encoding"
])

// --- settings ---------------------------------------------------------------

function getNoteIds() {
    const schemaNoteId = api.currentNote.getRelationValue("schemaNote")
    const settingsNoteId = api.currentNote.getRelationValue("settingsNote")
    if (!schemaNoteId || !settingsNoteId) throw new Error("RSS Reader settings notes not found")
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

    const tagged = api.getNoteWithLabel("rssReaderDatabase")
    if (tagged && !tagged.isDeleted) return tagged

    const { note } = api.createNewNote({
        parentNoteId: api.currentNote.getParentNoteIds()[0],
        title: DATABASE_TITLE,
        type: "code",
        mime: "application/json",
        content: JSON.stringify(store.emptyDoc(), null, 4)
    })
    note.setLabel("rssReaderDatabase")
    note.setLabel("iconClass", "bx bx-data")
    return note
}

function loadDocument() {
    return store.parseDoc(resolveDatabaseNote().getContent())
}

function saveDocument(doc) {
    resolveDatabaseNote().setContent(JSON.stringify(doc, null, 4))
}

// --- fetching ---------------------------------------------------------------

// Hosts that resolve inside the network the Trilium server sits on. Matching is
// textual, so it stops the obvious cases and not a public name that resolves to
// a private address -- see the README's note on that.
function isPrivateHost(hostname) {
    const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "")
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (!ipv4) return false
    const [a, b] = ipv4.slice(1).map(Number)
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 169 && b === 254) return true
    return false
}

// The configured FreshRSS server is allowed whatever address it has: the user
// pointed the addon at it deliberately, and a self-hosted FreshRSS on the same
// LAN is the normal case rather than the exception.
function isConfiguredServer(target, settings) {
    const base = String(settings.freshrssUrl || "").trim()
    if (!base) return false
    try {
        return new URL(base).hostname.toLowerCase() === target.hostname.toLowerCase()
    } catch (e) {
        return false
    }
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

// Forwards one request and returns it as JSON rather than streaming it back
// verbatim, because the widget only needs the status, the content type and a
// text body -- feeds are XML or JSON and the FreshRSS API answers in JSON or
// plain text. It deliberately cannot carry binary.
async function forward(payload) {
    let target
    try {
        target = new URL(payload.url)
    } catch (e) {
        throw new Error("Request has no valid URL")
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") {
        throw new Error(`Refusing scheme: ${target.protocol}`)
    }

    const settings = getSettings()
    if (isPrivateHost(target.hostname) && !settings.allowPrivateHosts && !isConfiguredServer(target, settings)) {
        throw new Error(`Refusing private address: ${target.hostname}. Turn on "Allow Private Network Feeds" to fetch it.`)
    }

    const method = payload.method === "POST" ? "POST" : "GET"
    const response = await fetch(target.href, {
        method,
        headers: sanitizeRequestHeaders(payload.headers),
        body: method === "POST" ? payload.body : undefined,
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })

    const body = await response.text()
    if (body.length > MAX_RESPONSE_BYTES) throw new Error("Response is too large to read")

    return {
        status: response.status,
        headers: { "content-type": response.headers.get("content-type") || "" },
        body
    }
}

// --- actions ----------------------------------------------------------------

// Everything the widget needs for a first paint in one request: the document
// plus the settings that shape the view and drive syncing.
function load() {
    const settings = getSettings()
    const doc = loadDocument()
    return {
        feeds: doc.feeds,
        articles: doc.articles,
        read: doc.read,
        starred: doc.starred,
        pending: doc.pending,
        lastRefresh: doc.lastRefresh,
        lastSync: doc.lastSync,
        settings: {
            freshrssEnabled: settings.freshrssEnabled,
            freshrssUrl: settings.freshrssUrl,
            freshrssUser: settings.freshrssUser,
            freshrssPassword: settings.freshrssPassword,
            maxArticlesPerSync: settings.maxArticlesPerSync,
            retentionDays: settings.retentionDays,
            refreshIntervalHours: settings.refreshIntervalHours,
            markReadOnOpen: settings.markReadOnOpen,
            viewFilter: settings.viewFilter,
            viewFeed: settings.viewFeed,
            viewSortDesc: settings.viewSortDesc
        }
    }
}

function addFeeds(feeds) {
    if (!Array.isArray(feeds)) throw new Error("addFeeds needs a feeds array")
    const doc = loadDocument()
    const result = store.addFeeds(doc, feeds)
    saveDocument(doc)
    return result
}

function syncFeeds(feeds) {
    if (!Array.isArray(feeds)) throw new Error("syncFeeds needs a feeds array")
    const doc = loadDocument()
    const result = store.replaceRemoteFeeds(doc, feeds)
    saveDocument(doc)
    return result
}

function removeFeed(feedId) {
    if (!feedId) throw new Error("removeFeed needs a feedId")
    const doc = loadDocument()
    const result = store.removeFeed(doc, feedId)
    saveDocument(doc)
    return result
}

function setFeedFolder(feedId, folder) {
    if (!feedId) throw new Error("setFeedFolder needs a feedId")
    const doc = loadDocument()
    const result = store.setFeedFolder(doc, feedId, folder || "")
    saveDocument(doc)
    return result
}

function setFeedErrors(errors) {
    if (!errors || typeof errors !== "object") throw new Error("setFeedErrors needs an errors map")
    const doc = loadDocument()
    const result = store.setFeedErrors(doc, errors)
    saveDocument(doc)
    return result
}

// One write for a whole batch: merge the articles, then prune the cache. A
// batch that fails partway leaves the document untouched rather than
// half-updated.
function mergeArticles(articles) {
    if (!Array.isArray(articles)) throw new Error("mergeArticles needs an articles array")
    const settings = getSettings()
    const doc = loadDocument()
    const merged = store.mergeArticles(doc, articles)
    const pruned = store.pruneArticles(doc, settings.retentionDays)
    saveDocument(doc)
    return { ...merged, ...pruned }
}

// Stamped once a refresh pass has finished, whatever it turned up, so a refresh
// that finds nothing new still counts against the automatic refresh interval.
function stampRefresh() {
    const doc = loadDocument()
    doc.lastRefresh = new Date().toISOString()
    saveDocument(doc)
    return { lastRefresh: doc.lastRefresh }
}

function setState(articleId, field, value) {
    if (!articleId) throw new Error("setState needs an articleId")
    const doc = loadDocument()
    const result = store.setState(doc, articleId, field, value)
    saveDocument(doc)
    return result
}

function setStateMany(articleIds, field, value) {
    if (!Array.isArray(articleIds)) throw new Error("setStateMany needs an articleIds array")
    const doc = loadDocument()
    const result = store.setStateMany(doc, articleIds, field, value)
    saveDocument(doc)
    return result
}

function applyRemoteState(body) {
    const doc = loadDocument()
    const result = store.applyRemoteState(
        doc,
        Array.isArray(body.unreadIds) ? body.unreadIds : [],
        Array.isArray(body.starredIds) ? body.starredIds : [],
        body.reconcileRead === true,
        body.reconcileStarred === true
    )
    doc.lastSync = new Date().toISOString()
    saveDocument(doc)
    return { ...result, lastSync: doc.lastSync }
}

function clearPending(keys) {
    if (!Array.isArray(keys)) throw new Error("clearPending needs a keys array")
    const doc = loadDocument()
    const result = store.clearPending(doc, keys)
    saveDocument(doc)
    return result
}

// The widget's remembered filters live in the settings note as hidden fields,
// so they persist without cluttering the settings page.
function saveView(query) {
    const fields = {}
    if (query.viewFilter !== undefined) fields.viewFilter = query.viewFilter
    if (query.viewFeed !== undefined) fields.viewFeed = query.viewFeed
    if (query.viewSortDesc !== undefined) fields.viewSortDesc = query.viewSortDesc === "true"
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
    // Fetch payloads and bulk id lists arrive as POST bodies, well past what a
    // query string can carry. Trilium parses JSON bodies for a
    // customRequestHandler, so this is already an object.
    const body = api.req.body || {}

    try {
        switch (action) {
            case "fetch":
                return sendJson(200, await forward(body))
            case "load":
                return sendJson(200, load())
            case "addFeeds":
                return sendJson(200, addFeeds(body.feeds))
            case "syncFeeds":
                return sendJson(200, syncFeeds(body.feeds))
            case "removeFeed":
                return sendJson(200, removeFeed(query.feedId))
            case "setFeedFolder":
                return sendJson(200, setFeedFolder(query.feedId, query.folder))
            case "setFeedErrors":
                return sendJson(200, setFeedErrors(body.errors))
            case "mergeArticles":
                return sendJson(200, mergeArticles(body.articles))
            case "stampRefresh":
                return sendJson(200, stampRefresh())
            case "setState":
                return sendJson(200, setState(query.articleId, query.field, query.value === "true"))
            case "setStateMany":
                return sendJson(200, setStateMany(body.articleIds, body.field, body.value === true))
            case "applyRemoteState":
                return sendJson(200, applyRemoteState(body))
            case "clearPending":
                return sendJson(200, clearPending(body.keys))
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
