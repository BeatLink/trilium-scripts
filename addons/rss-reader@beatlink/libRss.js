/*
 * rss-reader@beatlink -- the frontend layer: fetching, parsing, and FreshRSS.
 *
 * Everything that talks to the outside world lives here, and all of it runs in
 * the browser, because feeds are XML and only the browser has an XML parser.
 * The requests themselves go through the addon's backend note: a feed is a
 * static file on someone else's origin with no CORS headers, so it cannot be
 * read from Trilium's origin directly, and routing through the backend makes
 * every call same-origin from here.
 *
 * The FreshRSS half speaks the Google Reader API that FreshRSS exposes at
 * /api/greader.php. Sync is deliberately state-first rather than date-first:
 * it asks the server which articles are unread and which are starred, fetches
 * only the ones it does not already hold, and reconciles from those two lists.
 * That avoids depending on how a server timestamps a read/unread change, and it
 * makes the unread set here exactly the unread set there.
 */

const ENDPOINT = "custom/rssReader"

const READ_TAG = "user/-/state/com.google/read"
const STARRED_TAG = "user/-/state/com.google/starred"
const READING_LIST = "user/-/state/com.google/reading-list"

// FreshRSS reads repeated parameters out of the raw request body, so these
// caps are about keeping one body a sane size rather than any documented limit.
const ID_PAGE_SIZE = 1000
const MAX_ID_PAGES = 20
const ITEM_CHUNK = 50
const EDIT_CHUNK = 100

let cachedSession = null

// --- transport --------------------------------------------------------------

async function callBackend(action, params = {}, body = null) {
    const search = new URLSearchParams({ action, ...params })
    const options = { credentials: "same-origin" }
    if (body) {
        options.method = "POST"
        options.headers = { "Content-Type": "application/json" }
        options.body = JSON.stringify(body)
    }

    const response = await fetch(`${ENDPOINT}?${search}`, options)
    const text = await response.text()

    let result
    try {
        result = JSON.parse(text)
    } catch (e) {
        // Trilium answers a customRequestHandler with plain text when backend
        // scripting is off, which is the one failure worth naming precisely:
        // nothing in this addon can fetch anything until it is turned on.
        if (response.status === 403) {
            throw new Error("Backend script execution is disabled on this server, so RSS Reader cannot fetch feeds. Enable it with [Security] backendScriptingEnabled=true in config.ini.")
        }
        throw new Error(`Unexpected response from the RSS Reader backend (HTTP ${response.status})`)
    }

    if (result.error) throw new Error(result.error)
    return result
}

// One request to the outside world, forwarded by the backend note.
async function request(url, { method = "GET", headers = {}, body = null } = {}) {
    return callBackend("fetch", {}, { url, method, headers, body })
}

function chunkList(items, size) {
    const chunks = []
    for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
    return chunks
}

// djb2, only ever used to shorten an already-unique string (a feed URL, or a
// feed-scoped article guid) into a database key of a predictable size.
function hashString(value) {
    let hash = 5381
    for (let index = 0; index < value.length; index++) hash = (hash * 33) ^ value.charCodeAt(index)
    return (hash >>> 0).toString(36)
}

function localFeedId(url) {
    return `L${hashString(url)}`
}

function localArticleId(feedId, guid) {
    return `${feedId}.${hashString(guid)}`
}

// --- feed parsing -----------------------------------------------------------

// Feed elements are matched on nodeName as well as localName so a namespaced
// element keeps working whether or not the document declared the namespace,
// which is how "content:encoded" and "dc:creator" are reached.
function childrenNamed(element, name) {
    return Array.from(element.children).filter(child => child.nodeName === name || child.localName === name)
}

function textOf(element, ...names) {
    for (const name of names) {
        const found = childrenNamed(element, name)[0]
        const text = found ? found.textContent.trim() : ""
        if (text) return text
    }
    return ""
}

function descendantsNamed(root, name) {
    return Array.from(root.getElementsByTagName("*")).filter(element => element.localName === name)
}

function parseDate(value) {
    const parsed = Date.parse(String(value || ""))
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : ""
}

// Atom allows several links per entry; the one meant for a reader is the
// alternate, which is also the default when rel is left out.
function atomLink(element) {
    const links = childrenNamed(element, "link")
    const alternate = links.find(link => {
        const rel = link.getAttribute("rel")
        return !rel || rel === "alternate"
    })
    return (alternate || links[0])?.getAttribute("href") || ""
}

function parseXmlFeed(text) {
    const parsed = new DOMParser().parseFromString(text, "application/xml")
    if (parsed.getElementsByTagName("parsererror").length) throw new Error("Feed is not valid XML")

    const root = parsed.documentElement
    const isAtom = root.localName === "feed"
    // RSS keeps the feed's own metadata in <channel>; Atom keeps it on the root
    // element; RSS 1.0 has a <channel> that is a sibling of the items.
    const container = isAtom ? root : (descendantsNamed(root, "channel")[0] || root)
    const entries = descendantsNamed(root, isAtom ? "entry" : "item")

    return {
        title: textOf(container, "title"),
        siteUrl: isAtom ? atomLink(container) : textOf(container, "link"),
        items: entries.map(entry => {
            const url = isAtom ? atomLink(entry) : (textOf(entry, "link") || textOf(entry, "guid"))
            const author = childrenNamed(entry, "author")[0]
            return {
                guid: textOf(entry, "guid", "id") || url || textOf(entry, "title"),
                title: textOf(entry, "title"),
                url,
                author: textOf(entry, "dc:creator") || (author ? (textOf(author, "name") || author.textContent.trim()) : ""),
                content: textOf(entry, "content:encoded", "content", "description", "summary"),
                publishedAt: parseDate(textOf(entry, "pubDate", "published", "dc:date", "updated"))
            }
        })
    }
}

function parseJsonFeed(text) {
    const data = JSON.parse(text)
    if (!Array.isArray(data.items)) throw new Error("Not a JSON feed")
    return {
        title: data.title || "",
        siteUrl: data.home_page_url || "",
        items: data.items.map(item => ({
            guid: String(item.id || item.url || item.title || ""),
            title: item.title || "",
            url: item.url || item.external_url || "",
            author: item.author?.name || item.authors?.[0]?.name || "",
            content: item.content_html || item.content_text || item.summary || "",
            publishedAt: parseDate(item.date_published || item.date_modified)
        }))
    }
}

async function fetchFeed(url) {
    const response = await request(url, {
        headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.8" }
    })
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`)

    const body = response.body.trim()
    if (!body) throw new Error("Feed is empty")

    const parsed = body.startsWith("{") ? parseJsonFeed(body) : parseXmlFeed(body)
    if (!parsed.items.length && !parsed.title) throw new Error("No feed found at this URL")
    return parsed
}

// --- rendering --------------------------------------------------------------

// Article bodies are HTML written by someone else and Trilium ships no content
// security policy, so anything executable has to be gone before this reaches
// the page. The allowed set is deliberately small: text, links, images, and the
// structural elements around them.
const FORBIDDEN_TAGS = new Set([
    "script", "style", "iframe", "object", "embed", "link", "meta", "base",
    "form", "input", "button", "select", "textarea", "svg", "math",
    "frame", "frameset", "noscript", "template"
])

const SAFE_SCHEMES = /^(https?|mailto):$/i

function resolveUrl(value, baseUrl) {
    const raw = String(value || "").trim()
    if (/^data:image\//i.test(raw)) return raw
    try {
        const url = new URL(raw, baseUrl || undefined)
        return SAFE_SCHEMES.test(url.protocol) ? url.href : ""
    } catch (e) {
        return ""
    }
}

function sanitizeHtml(html, baseUrl) {
    const parsed = new DOMParser().parseFromString(String(html || ""), "text/html")
    for (const element of Array.from(parsed.body.querySelectorAll("*"))) {
        if (FORBIDDEN_TAGS.has(element.localName)) {
            element.remove()
            continue
        }
        for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase()
            // srcset and style are dropped wholesale rather than parsed: both
            // can carry URLs, and neither is worth a second parser here.
            if (name.startsWith("on") || name === "style" || name === "srcset") {
                element.removeAttribute(attribute.name)
                continue
            }
            if (name === "href" || name === "src") {
                const resolved = resolveUrl(attribute.value, baseUrl)
                if (resolved) element.setAttribute(attribute.name, resolved)
                else element.removeAttribute(attribute.name)
            }
        }
        if (element.localName === "a") {
            element.setAttribute("target", "_blank")
            element.setAttribute("rel", "noreferrer noopener")
        }
    }
    return parsed.body.innerHTML
}

// --- FreshRSS ---------------------------------------------------------------

function apiBase(settings) {
    const configured = String(settings.freshrssUrl || "").trim().replace(/\/+$/, "")
    if (!configured) throw new Error("No FreshRSS server URL configured")
    return /\/api\/greader\.php$/.test(configured) ? configured : `${configured}/api/greader.php`
}

async function login(settings) {
    const base = apiBase(settings)
    const response = await request(`${base}/accounts/ClientLogin`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            Email: settings.freshrssUser || "",
            Passwd: settings.freshrssPassword || ""
        }).toString()
    })
    if (response.status !== 200) {
        throw new Error(`Login failed (HTTP ${response.status}). Check the server URL, the username, and the API password.`)
    }

    const auth = (response.body.match(/^Auth=(.+)$/m) || [])[1]
    if (!auth) throw new Error("Login returned no token; is this a FreshRSS server?")

    const session = { base, auth: auth.trim() }
    // Writes carry a second token, which FreshRSS derives from the same
    // credentials but checks separately.
    session.token = (await get(session, "/reader/api/0/token")).trim()
    return session
}

// Reused for the whole time the widget is open, so a sync and the actions
// around it cost one login rather than one per request.
async function getSession(settings) {
    const key = `${settings.freshrssUrl}|${settings.freshrssUser}|${settings.freshrssPassword}`
    if (cachedSession?.key === key) return cachedSession.value
    const value = await login(settings)
    cachedSession = { key, value }
    return value
}

async function get(session, path, params = {}) {
    const query = new URLSearchParams(params).toString()
    const response = await request(`${session.base}${path}${query ? `?${query}` : ""}`, {
        headers: { Authorization: `GoogleLogin auth=${session.auth}` }
    })
    if (response.status !== 200) throw new Error(`${path} failed (HTTP ${response.status})`)
    return response.body
}

async function getJson(session, path, params) {
    const body = await get(session, path, params)
    try {
        return JSON.parse(body)
    } catch (e) {
        throw new Error(`${path} did not return JSON`)
    }
}

// Built by hand rather than with URLSearchParams because FreshRSS reads
// repeated parameters (i=, a=, r=) straight out of the raw body, which a map
// cannot express.
async function post(session, path, pairs) {
    const body = pairs.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join("&")
    const response = await request(`${session.base}${path}`, {
        method: "POST",
        headers: {
            Authorization: `GoogleLogin auth=${session.auth}`,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body
    })
    if (response.status !== 200) {
        throw new Error(`${path} failed (HTTP ${response.status}): ${response.body.slice(0, 200)}`)
    }
    return response.body
}

async function listSubscriptions(session) {
    const data = await getJson(session, "/reader/api/0/subscription/list", { output: "json" })
    return (data.subscriptions || []).map(subscription => ({
        id: `R${String(subscription.id || "").replace(/^feed\//, "")}`,
        remoteId: subscription.id || "",
        url: subscription.url || "",
        title: subscription.title || subscription.url || "",
        siteUrl: subscription.htmlUrl || "",
        icon: subscription.iconUrl || "",
        folder: subscription.categories?.[0]?.label || ""
    }))
}

// Returns the ids and whether the walk actually reached the end, because a
// truncated unread list cannot be used to decide what is read.
async function listIds(session, params) {
    const ids = []
    let continuation = ""
    for (let page = 0; page < MAX_ID_PAGES; page++) {
        const data = await getJson(session, "/reader/api/0/stream/items/ids", {
            ...params,
            n: ID_PAGE_SIZE,
            ...(continuation ? { c: continuation } : {})
        })
        for (const ref of data.itemRefs || []) ids.push(String(ref.id))
        continuation = data.continuation || ""
        if (!continuation) return { ids, complete: true }
    }
    return { ids, complete: false }
}

// Item ids arrive as "tag:google.com,2005:reader/item/<16 hex digits>", and
// every other endpoint wants the same number in decimal.
function decimalItemId(itemId) {
    const tail = String(itemId || "").split("/").pop()
    if (/^\d+$/.test(tail)) return tail
    try {
        return BigInt(`0x${tail}`).toString()
    } catch (e) {
        return ""
    }
}

function toArticle(item) {
    const decimal = decimalItemId(item.id)
    if (!decimal) return null
    return {
        id: `R${decimal}`,
        feedId: `R${String(item.origin?.streamId || "").replace(/^feed\//, "")}`,
        title: item.title || "",
        url: item.canonical?.[0]?.href || item.alternate?.[0]?.href || "",
        author: item.author || "",
        content: item.summary?.content || item.content?.content || "",
        publishedAt: item.published ? new Date(item.published * 1000).toISOString() : ""
    }
}

async function fetchItems(session, ids) {
    const body = await post(session, "/reader/api/0/stream/items/contents", ids.map(id => ["i", id]))
    let data
    try {
        data = JSON.parse(body)
    } catch (e) {
        throw new Error("stream/items/contents did not return JSON")
    }
    return (data.items || []).map(toArticle).filter(Boolean)
}

async function editTag(session, ids, addTags, removeTags) {
    for (const chunk of chunkList(ids, EDIT_CHUNK)) {
        await post(session, "/reader/api/0/edit-tag", [
            ["T", session.token],
            ...addTags.map(tag => ["a", tag]),
            ...removeTags.map(tag => ["r", tag]),
            ...chunk.map(id => ["i", id])
        ])
    }
}

// The category is always sent, because an empty label is what FreshRSS reads as
// "the default category" -- leaving it out instead asks for category 0.
//
// FreshRSS answers a subscribe for a feed it already has with a bare 400, which
// is worth translating: it is the one failure here that is not a real problem.
async function subscribe(session, url, folder) {
    try {
        await post(session, "/reader/api/0/subscription/edit", [
            ["T", session.token], ["ac", "subscribe"], ["s", `feed/${url}`], ["a", `user/-/label/${folder || ""}`]
        ])
    } catch (error) {
        if (error.message.includes("HTTP 400")) throw new Error("FreshRSS refused it; it may already be subscribed there.")
        throw error
    }
}

async function unsubscribe(session, remoteId) {
    await post(session, "/reader/api/0/subscription/edit", [
        ["T", session.token], ["ac", "unsubscribe"], ["s", remoteId]
    ])
}

async function moveFeed(session, remoteId, folder) {
    await post(session, "/reader/api/0/subscription/edit", [
        ["T", session.token], ["ac", "edit"], ["s", remoteId], ["a", `user/-/label/${folder}`]
    ])
}

// --- syncing ----------------------------------------------------------------

// Local changes go up before anything comes down, so a state change made here
// is never overwritten by the server's older answer for the same article.
async function pushPending(session, pending) {
    const groups = new Map()
    for (const [key, change] of Object.entries(pending || {})) {
        if (change.field !== "read" && change.field !== "starred") continue
        const groupKey = `${change.field}:${change.value === true}`
        const group = groups.get(groupKey) || { ids: [], keys: [] }
        group.ids.push(String(change.articleId).slice(1))
        group.keys.push(key)
        groups.set(groupKey, group)
    }

    const cleared = []
    for (const [groupKey, group] of groups) {
        const [field, value] = groupKey.split(":")
        const tag = field === "read" ? READ_TAG : STARRED_TAG
        await editTag(session, group.ids, value === "true" ? [tag] : [], value === "true" ? [] : [tag])
        cleared.push(...group.keys)
    }
    if (cleared.length) await callBackend("clearPending", {}, { keys: cleared })
    return cleared.length
}

// Pushes one state change immediately, so marking something read here shows up
// in FreshRSS without waiting for the next sync. A failure is not fatal: the
// change is already queued in the database and the next sync retries it.
async function pushState(settings, articleId, field, value) {
    const session = await getSession(settings)
    const tag = field === "read" ? READ_TAG : STARRED_TAG
    await editTag(session, [String(articleId).slice(1)], value ? [tag] : [], value ? [] : [tag])
    await callBackend("clearPending", {}, { keys: [`${field}:${articleId}`] })
}

// Flushes whatever is queued, for the bulk actions that write many changes at
// once rather than pushing each one as it happens.
async function pushQueued(settings, pending) {
    if (!settings.freshrssEnabled || !Object.keys(pending || {}).length) return 0
    return pushPending(await getSession(settings), pending)
}

async function syncFreshRss(settings, doc, onStatus) {
    const session = await getSession(settings)

    onStatus("Pushing local changes to FreshRSS...")
    await pushPending(session, doc.pending)

    onStatus("Reading FreshRSS subscriptions...")
    const feeds = await listSubscriptions(session)
    await callBackend("syncFeeds", {}, { feeds })

    onStatus("Reading unread and starred lists...")
    const unread = await listIds(session, { s: READING_LIST, xt: READ_TAG })
    const starred = await listIds(session, { s: STARRED_TAG })

    const limit = Number(settings.maxArticlesPerSync) > 0 ? Number(settings.maxArticlesPerSync) : 500
    const wanted = [...new Set([...unread.ids.slice(0, limit), ...starred.ids.slice(0, limit)])]
    const missing = wanted.filter(id => !doc.articles[`R${id}`])

    const articles = []
    for (const chunk of chunkList(missing, ITEM_CHUNK)) {
        onStatus(`Fetching ${articles.length + chunk.length} of ${missing.length} articles...`)
        articles.push(...await fetchItems(session, chunk))
    }
    if (articles.length) await callBackend("mergeArticles", {}, { articles })

    await callBackend("applyRemoteState", {}, {
        unreadIds: unread.ids,
        starredIds: starred.ids,
        reconcileRead: unread.complete,
        reconcileStarred: starred.complete
    })

    return {
        feeds: feeds.length,
        articles: articles.length,
        truncated: !unread.complete || !starred.complete
    }
}

// Fetches every feed this addon owns, then commits the whole result in one
// write. A feed that fails is recorded on the feed itself and the others still
// land.
async function refreshLocalFeeds(feeds, onStatus) {
    const articles = []
    const errors = {}
    const failures = []

    for (const feed of feeds) {
        onStatus(`Fetching ${feed.title}...`)
        try {
            const parsed = await fetchFeed(feed.url)
            for (const item of parsed.items) {
                if (!item.guid) continue
                articles.push({
                    id: localArticleId(feed.id, item.guid),
                    feedId: feed.id,
                    title: item.title,
                    url: item.url,
                    author: item.author,
                    content: item.content,
                    publishedAt: item.publishedAt
                })
            }
            errors[feed.id] = ""
        } catch (error) {
            errors[feed.id] = error.message
            failures.push(`${feed.title}: ${error.message}`)
        }
    }

    await callBackend("setFeedErrors", {}, { errors })
    if (articles.length) await callBackend("mergeArticles", {}, { articles })
    return { articles: articles.length, failures }
}

async function refresh(data, onStatus) {
    const summary = { failures: [], articles: 0, truncated: false }
    const settings = data.settings

    if (settings.freshrssEnabled && String(settings.freshrssUrl || "").trim()) {
        try {
            const result = await syncFreshRss(settings, data, onStatus)
            summary.articles += result.articles
            summary.truncated = result.truncated
        } catch (error) {
            summary.failures.push(`FreshRSS: ${error.message}`)
        }
    }

    const localFeeds = Object.values(data.feeds).filter(feed => feed.source !== "freshrss")
    if (localFeeds.length) {
        const result = await refreshLocalFeeds(localFeeds, onStatus)
        summary.articles += result.articles
        summary.failures.push(...result.failures)
    }

    // Stamped even when the pass turned up nothing, so an empty refresh still
    // counts against the automatic refresh interval.
    await callBackend("stampRefresh")
    return summary
}

// --- subscribing ------------------------------------------------------------

// One line at a time, so a URL that is not a feed reports itself instead of
// failing the whole paste.
//
// With FreshRSS configured the subscription is made there and read back, which
// keeps the server the single owner of the feed list; without it the feed is
// fetched once for its title and stored locally.
async function addFeeds(urls, folder, settings) {
    const useRemote = settings.freshrssEnabled && String(settings.freshrssUrl || "").trim()
    const session = useRemote ? await getSession(settings) : null
    const added = []
    const failures = []

    for (const url of urls) {
        try {
            if (useRemote) {
                await subscribe(session, url, folder)
                added.push(url)
            } else {
                const parsed = await fetchFeed(url)
                added.push(url)
                await callBackend("addFeeds", {}, {
                    feeds: [{
                        id: localFeedId(url),
                        url,
                        title: parsed.title || url,
                        siteUrl: parsed.siteUrl,
                        folder,
                        source: "local"
                    }]
                })
            }
        } catch (error) {
            failures.push({ url, message: error.message })
        }
    }

    if (useRemote && added.length) {
        await callBackend("syncFeeds", {}, { feeds: await listSubscriptions(session) })
    }
    return { added: added.length, failures }
}

async function removeFeed(feed, settings) {
    if (feed.source === "freshrss") {
        await unsubscribe(await getSession(settings), feed.remoteId)
    }
    await callBackend("removeFeed", { feedId: feed.id })
}

async function setFeedFolder(feed, folder, settings) {
    if (feed.source === "freshrss") {
        await moveFeed(await getSession(settings), feed.remoteId, folder)
    }
    await callBackend("setFeedFolder", { feedId: feed.id, folder })
}

module.exports = {
    callBackend,
    fetchFeed,
    sanitizeHtml,
    refresh,
    pushState,
    pushQueued,
    addFeeds,
    removeFeed,
    setFeedFolder
}
