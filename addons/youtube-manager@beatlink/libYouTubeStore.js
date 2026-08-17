/*
 * youtube-manager@beatlink -- pure helpers over the database document.
 *
 * The document holds three things: the channels you subscribe to, a rolling
 * cache of their recent uploads, and a permanent record of what you watched.
 *
 * Only the watched record is data that cannot be regenerated. The video cache
 * is rebuilt from YouTube on every refresh, which is why pruning it is safe;
 * the watched map is keyed by video id and is never pruned, so a video that
 * falls out of the cache and later comes back is still known to be watched.
 *
 * Nothing here touches notes or the network -- the backend owns both, so every
 * function is a plain document-in, document-out transform.
 */

// Videos carry an estimated publish timestamp derived from YouTube's relative
// "3 days ago" text, which is all the InnerTube listing gives. It is written
// once on first sight and never revised, so the feed keeps a stable order
// instead of reshuffling as that text ages into "1 month ago".
function emptyDoc() {
    return { channels: {}, videos: {}, watched: {}, lastRefresh: "" }
}

function parseDoc(text) {
    let parsed
    try {
        parsed = JSON.parse(text || "{}")
    } catch (e) {
        return emptyDoc()
    }
    if (!parsed || typeof parsed !== "object") return emptyDoc()
    return {
        channels: isObject(parsed.channels) ? parsed.channels : {},
        videos: isObject(parsed.videos) ? parsed.videos : {},
        watched: isObject(parsed.watched) ? parsed.watched : {},
        lastRefresh: typeof parsed.lastRefresh === "string" ? parsed.lastRefresh : ""
    }
}

function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value)
}

function now() {
    return new Date().toISOString()
}

// --- channels ---------------------------------------------------------------

// Additive: re-adding a channel refreshes its name and avatar but keeps the
// original addedAt, so an import over an existing subscription list is a no-op
// rather than a reset.
function addChannels(doc, channels) {
    let added = 0
    let updated = 0
    for (const channel of channels) {
        if (!channel || !channel.id) continue
        const existing = doc.channels[channel.id]
        doc.channels[channel.id] = {
            id: channel.id,
            name: channel.name || existing?.name || channel.id,
            thumbnail: channel.thumbnail || existing?.thumbnail || "",
            handle: channel.handle || existing?.handle || "",
            addedAt: existing?.addedAt || now()
        }
        if (existing) updated++
        else added++
    }
    return { added, updated }
}

// Drops the channel and its cached videos. The watched record is left alone so
// re-subscribing later does not resurface videos already seen.
function removeChannel(doc, channelId) {
    if (!doc.channels[channelId]) return { removed: false }
    delete doc.channels[channelId]
    for (const [videoId, video] of Object.entries(doc.videos)) {
        if (video.channelId === channelId) delete doc.videos[videoId]
    }
    return { removed: true }
}

// --- videos -----------------------------------------------------------------

// Merges a refresh result. publishedAt is preserved from the existing entry so
// the estimate never drifts; everything else is refreshed from the new listing.
function mergeVideos(doc, videos) {
    let added = 0
    for (const video of videos) {
        if (!video || !video.id || !doc.channels[video.channelId]) continue
        const existing = doc.videos[video.id]
        if (!existing) added++
        doc.videos[video.id] = {
            id: video.id,
            channelId: video.channelId,
            title: video.title || existing?.title || "",
            thumbnail: video.thumbnail || existing?.thumbnail || "",
            duration: Number.isFinite(video.duration) ? video.duration : (existing?.duration ?? null),
            isShort: video.isShort ?? existing?.isShort ?? false,
            views: video.views ?? existing?.views ?? null,
            publishedAt: existing?.publishedAt || video.publishedAt || now(),
            firstSeen: existing?.firstSeen || now()
        }
    }
    return { added }
}

// Drops cached videos older than the retention window, and any left orphaned by
// a channel that is no longer subscribed.
function pruneVideos(doc, retentionDays) {
    const days = Number(retentionDays)
    const cutoff = Number.isFinite(days) && days > 0
        ? Date.now() - days * 86400000
        : null
    let pruned = 0
    for (const [videoId, video] of Object.entries(doc.videos)) {
        const orphaned = !doc.channels[video.channelId]
        const expired = cutoff !== null && Date.parse(video.publishedAt) < cutoff
        if (orphaned || expired) {
            delete doc.videos[videoId]
            pruned++
        }
    }
    return { pruned }
}

// --- watched ----------------------------------------------------------------

function setWatched(doc, videoId, watched) {
    if (watched) doc.watched[videoId] = now()
    else delete doc.watched[videoId]
    return { videoId, watched: !!watched }
}

// Bulk-marks a list of ids in one pass, for "mark everything in this view
// watched" without a request per video.
function setWatchedMany(doc, videoIds, watched) {
    let changed = 0
    for (const videoId of videoIds) {
        if (!videoId) continue
        const already = !!doc.watched[videoId]
        if (already === !!watched) continue
        if (watched) doc.watched[videoId] = now()
        else delete doc.watched[videoId]
        changed++
    }
    return { changed }
}

module.exports = {
    emptyDoc,
    parseDoc,
    addChannels,
    removeChannel,
    mergeVideos,
    pruneVideos,
    setWatched,
    setWatchedMany
}
