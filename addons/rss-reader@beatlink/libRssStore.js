/*
 * rss-reader@beatlink -- pure helpers over the database document.
 *
 * The document holds four things: the feeds you subscribe to, a rolling cache
 * of their articles, the read/starred state of those articles, and a queue of
 * state changes that still have to reach FreshRSS.
 *
 * Only the state maps and the pending queue are data that cannot be
 * regenerated. Articles are re-fetched from feeds or from FreshRSS, which is
 * why pruning them is safe; the read map is keyed by article id and is never
 * pruned, so an article that falls out of the cache and later comes back is
 * still known to be read.
 *
 * Article ids carry their origin in the first character: "L..." for an article
 * from a feed this addon fetches itself, "R<decimal>" for one that came from
 * FreshRSS, where the decimal part is the entry id FreshRSS's API expects back.
 *
 * Nothing here touches notes or the network -- the backend owns both, so every
 * function is a plain document-in, document-out transform.
 */

function emptyDoc() {
    return { feeds: {}, articles: {}, read: {}, starred: {}, pending: {}, lastRefresh: "", lastSync: "" }
}

function parseDoc(text) {
    let parsed
    try {
        parsed = JSON.parse(text || "{}")
    } catch (e) {
        return emptyDoc()
    }
    if (!isObject(parsed)) return emptyDoc()
    return {
        feeds: isObject(parsed.feeds) ? parsed.feeds : {},
        articles: isObject(parsed.articles) ? parsed.articles : {},
        read: isObject(parsed.read) ? parsed.read : {},
        starred: isObject(parsed.starred) ? parsed.starred : {},
        pending: isObject(parsed.pending) ? parsed.pending : {},
        lastRefresh: typeof parsed.lastRefresh === "string" ? parsed.lastRefresh : "",
        lastSync: typeof parsed.lastSync === "string" ? parsed.lastSync : ""
    }
}

function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value)
}

function now() {
    return new Date().toISOString()
}

// --- feeds ------------------------------------------------------------------

// Additive: re-adding a feed refreshes its title, icon and folder but keeps the
// original addedAt, so a re-import over an existing feed list is a no-op rather
// than a reset.
function addFeeds(doc, feeds) {
    let added = 0
    let updated = 0
    for (const feed of feeds) {
        if (!feed || !feed.id || !feed.url) continue
        const existing = doc.feeds[feed.id]
        doc.feeds[feed.id] = {
            id: feed.id,
            url: feed.url,
            title: feed.title || existing?.title || feed.url,
            siteUrl: feed.siteUrl || existing?.siteUrl || "",
            icon: feed.icon || existing?.icon || "",
            folder: feed.folder ?? existing?.folder ?? "",
            source: feed.source || existing?.source || "local",
            remoteId: feed.remoteId || existing?.remoteId || "",
            addedAt: existing?.addedAt || now(),
            lastError: existing?.lastError || ""
        }
        if (existing) updated++
        else added++
    }
    return { added, updated }
}

// Replaces the whole FreshRSS half of the feed list in one pass, so a feed
// unsubscribed on the server disappears here too. Local feeds are untouched.
function replaceRemoteFeeds(doc, feeds) {
    const result = addFeeds(doc, feeds.map(feed => ({ ...feed, source: "freshrss" })))
    const keep = new Set(feeds.map(feed => feed.id))
    let removed = 0
    for (const [feedId, feed] of Object.entries(doc.feeds)) {
        if (feed.source !== "freshrss" || keep.has(feedId)) continue
        removeFeed(doc, feedId)
        removed++
    }
    return { ...result, removed }
}

// Drops the feed and its cached articles. The state maps are left alone so
// re-subscribing later does not resurface articles already read.
function removeFeed(doc, feedId) {
    if (!doc.feeds[feedId]) return { removed: false }
    delete doc.feeds[feedId]
    for (const [articleId, article] of Object.entries(doc.articles)) {
        if (article.feedId === feedId) delete doc.articles[articleId]
    }
    return { removed: true }
}

function setFeedFolder(doc, feedId, folder) {
    const feed = doc.feeds[feedId]
    if (!feed) return { updated: false }
    feed.folder = folder
    return { updated: true }
}

// A fetch failure is recorded on the feed rather than thrown away, so a feed
// that has been broken for a week says so in the feed list. Takes the result
// for every feed in a refresh at once, since that is one write instead of one
// per feed.
function setFeedErrors(doc, errors) {
    let updated = 0
    for (const [feedId, message] of Object.entries(errors)) {
        const feed = doc.feeds[feedId]
        if (!feed) continue
        feed.lastError = message || ""
        if (!message) feed.lastFetch = now()
        updated++
    }
    return { updated }
}

// --- articles ---------------------------------------------------------------

function mergeArticles(doc, articles) {
    let added = 0
    for (const article of articles) {
        if (!article || !article.id || !doc.feeds[article.feedId]) continue
        const existing = doc.articles[article.id]
        if (!existing) added++
        doc.articles[article.id] = {
            id: article.id,
            feedId: article.feedId,
            title: article.title || existing?.title || "(untitled)",
            url: article.url || existing?.url || "",
            author: article.author || existing?.author || "",
            content: article.content ?? existing?.content ?? "",
            publishedAt: article.publishedAt || existing?.publishedAt || now(),
            firstSeen: existing?.firstSeen || now()
        }
    }
    return { added }
}

// Drops cached articles older than the retention window, and any left orphaned
// by a feed that is no longer subscribed.
//
// Only articles that are read and not starred age out. Pruning an unread one
// would also be pointless work against FreshRSS, whose unread set is exactly
// what the next sync fetches back: an old unread article would be re-downloaded
// and re-pruned on every refresh, and never once be readable.
function pruneArticles(doc, retentionDays) {
    const days = Number(retentionDays)
    const cutoff = Number.isFinite(days) && days > 0 ? Date.now() - days * 86400000 : null
    let pruned = 0
    for (const [articleId, article] of Object.entries(doc.articles)) {
        const orphaned = !doc.feeds[article.feedId]
        const expired = cutoff !== null && Date.parse(article.publishedAt) < cutoff
        const disposable = !!doc.read[articleId] && !doc.starred[articleId]
        if (orphaned || (expired && disposable)) {
            delete doc.articles[articleId]
            pruned++
        }
    }
    return { pruned }
}

// --- state ------------------------------------------------------------------

function stateMap(doc, field) {
    if (field !== "read" && field !== "starred") throw new Error(`Unknown state field: ${field}`)
    return doc[field]
}

// A change to a FreshRSS-backed article is queued as well as applied, so it
// still reaches the server if the push right after this fails. The key collapses
// repeated toggles of the same field to whatever the last one said.
function queuePending(doc, articleId, field, value) {
    const article = doc.articles[articleId]
    if (!article || doc.feeds[article.feedId]?.source !== "freshrss") return null
    const key = `${field}:${articleId}`
    doc.pending[key] = { articleId, field, value: !!value, at: now() }
    return key
}

function setState(doc, articleId, field, value) {
    const map = stateMap(doc, field)
    if (value) map[articleId] = now()
    else delete map[articleId]
    return { articleId, field, value: !!value, pending: queuePending(doc, articleId, field, value) }
}

// Bulk version, for "mark everything in this view read" without a request per
// article.
function setStateMany(doc, articleIds, field, value) {
    const map = stateMap(doc, field)
    let changed = 0
    const pending = []
    for (const articleId of articleIds) {
        if (!articleId) continue
        if (!!map[articleId] === !!value) continue
        if (value) map[articleId] = now()
        else delete map[articleId]
        const key = queuePending(doc, articleId, field, value)
        if (key) pending.push(key)
        changed++
    }
    return { changed, pending }
}

function clearPending(doc, keys) {
    let cleared = 0
    for (const key of keys) {
        if (!(key in doc.pending)) continue
        delete doc.pending[key]
        cleared++
    }
    return { cleared }
}

// Reconciles local state against what FreshRSS reports, for the articles that
// came from FreshRSS in the first place.
//
// A field with an unpushed local change is skipped: that change is newer than
// the server's answer, and overwriting it here would undo a click the user has
// already seen take effect.
//
// Each list is only applied when it was read to the end: a truncated list no
// longer means "everything absent from it is read/unstarred", so applying one
// would mark a backlog read that was never opened, or unstar articles the
// server still has starred.
function applyRemoteState(doc, unreadIds, starredIds, reconcileRead, reconcileStarred) {
    const unread = new Set(unreadIds.map(String))
    const starred = new Set(starredIds.map(String))
    let changed = 0
    for (const [articleId, article] of Object.entries(doc.articles)) {
        if (doc.feeds[article.feedId]?.source !== "freshrss") continue
        const remoteNum = articleId.slice(1)
        if (reconcileRead && !doc.pending[`read:${articleId}`]) {
            const isRead = !unread.has(remoteNum)
            if (isRead !== !!doc.read[articleId]) {
                if (isRead) doc.read[articleId] = now()
                else delete doc.read[articleId]
                changed++
            }
        }
        if (reconcileStarred && !doc.pending[`starred:${articleId}`]) {
            const isStarred = starred.has(remoteNum)
            if (isStarred !== !!doc.starred[articleId]) {
                if (isStarred) doc.starred[articleId] = now()
                else delete doc.starred[articleId]
                changed++
            }
        }
    }
    return { changed }
}

module.exports = {
    emptyDoc,
    parseDoc,
    addFeeds,
    replaceRemoteFeeds,
    removeFeed,
    setFeedFolder,
    setFeedErrors,
    mergeArticles,
    pruneArticles,
    setState,
    setStateMany,
    clearPending,
    applyRemoteState
}
