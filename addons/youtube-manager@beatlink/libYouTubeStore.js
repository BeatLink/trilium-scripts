/*
 * youtube-manager@beatlink -- pure helpers over the database document.
 *
 * The document holds four things: the channels you subscribe to, a rolling
 * cache of their recent uploads, a permanent record of what you watched, and
 * your playlists.
 *
 * Only the video cache can be regenerated. It is rebuilt from YouTube on every
 * refresh, which is why pruning it is safe; the watched record and the
 * playlists are never pruned, so a video that falls out of the cache and later
 * comes back is still known to be watched and still sits in any playlist it
 * was added to.
 *
 * Nothing here touches notes or the network -- the backend owns both, so every
 * function is a plain document-in, document-out transform.
 */

// Videos carry an estimated publish timestamp derived from YouTube's relative
// "3 days ago" text, which is all the InnerTube listing gives. It is written
// once on first sight and never revised, so the feed keeps a stable order
// instead of reshuffling as that text ages into "1 month ago".
function emptyDoc() {
    return { channels: {}, videos: {}, watched: {}, playlists: {}, lastRefresh: "" }
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
        watched: normalizeWatched(parsed.watched),
        playlists: isObject(parsed.playlists) ? parsed.playlists : {},
        lastRefresh: typeof parsed.lastRefresh === "string" ? parsed.lastRefresh : ""
    }
}

// A watched entry used to be the bare timestamp the video was marked at. It now
// carries the video's own details as well, so the history reads without the
// video still being in the cache.
//
// The old shape is read as the new one rather than migrated: a rewrite would be
// a destructive pass over the one part of the document that cannot be
// regenerated, and the details it cannot invent stay blank either way.
function normalizeWatched(watched) {
    if (!isObject(watched)) return {}
    const entries = {}
    for (const [videoId, value] of Object.entries(watched)) {
        if (typeof value === "string") entries[videoId] = { watchedAt: value, watchCount: 1 }
        else if (isObject(value)) entries[videoId] = value
    }
    return entries
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

// The details a history row needs, copied off the video rather than referenced.
// A watched entry outlives the cache by design, so a reference would leave the
// history full of bare ids once the video aged out.
function watchedEntry(existing, video) {
    return {
        watchedAt: now(),
        watchCount: (existing?.watchCount || 0) + 1,
        title: video?.title || existing?.title || "",
        channelId: video?.channelId || existing?.channelId || "",
        channelName: video?.channelName || existing?.channelName || "",
        thumbnail: video?.thumbnail || existing?.thumbnail || "",
        duration: Number.isFinite(video?.duration) ? video.duration : (existing?.duration ?? null),
        isShort: video?.isShort ?? existing?.isShort ?? false
    }
}

function setWatched(doc, videoId, watched, video) {
    if (watched) doc.watched[videoId] = watchedEntry(doc.watched[videoId], video)
    else delete doc.watched[videoId]
    return { videoId, watched: !!watched }
}

// Bulk-marks a list of ids in one pass, for "mark everything in this view
// watched" without a request per video. Details are looked up by id from the
// videos handed alongside, so the caller can send the whole visible list.
function setWatchedMany(doc, videoIds, watched, videos) {
    const byId = {}
    for (const video of videos || []) {
        if (video?.id) byId[video.id] = video
    }

    let changed = 0
    for (const videoId of videoIds) {
        if (!videoId) continue
        const already = !!doc.watched[videoId]
        if (already === !!watched) continue
        if (watched) doc.watched[videoId] = watchedEntry(doc.watched[videoId], byId[videoId])
        else delete doc.watched[videoId]
        changed++
    }
    return { changed }
}

// Wipes the whole history. The only operation here that discards data the addon
// cannot get back, so it exists as its own call rather than as a flag.
function clearWatched(doc) {
    const cleared = Object.keys(doc.watched).length
    doc.watched = {}
    return { cleared }
}

// Fills in the details of watched entries that predate them, from whatever is
// still in the video cache. Entries whose video is long gone stay bare -- there
// is nowhere to read them from -- so this improves the history where it can
// rather than promising to complete it.
function backfillWatched(doc) {
    let filled = 0
    for (const [videoId, entry] of Object.entries(doc.watched)) {
        if (entry.title) continue
        const video = doc.videos[videoId]
        if (!video) continue
        doc.watched[videoId] = {
            ...entry,
            title: video.title || "",
            channelId: video.channelId || "",
            channelName: doc.channels[video.channelId]?.name || "",
            thumbnail: video.thumbnail || "",
            duration: video.duration ?? null,
            isShort: !!video.isShort
        }
        filled++
    }
    return { filled }
}

// --- playlists --------------------------------------------------------------

// Personal and subscribed playlists share one map, told apart by `kind`. They
// are listed and opened identically; only who may edit them differs.
//
// A playlist's videos are self-contained copies, not references into the cache.
// A playlist has to keep working when a video ages out of the cache or is
// pulled from YouTube, and a reference would leave a hole where the row was.
function playlistVideo(video) {
    return {
        id: video.id,
        title: video.title || "",
        channelId: video.channelId || "",
        channelName: video.channelName || "",
        thumbnail: video.thumbnail || "",
        duration: Number.isFinite(video.duration) ? video.duration : null,
        isShort: !!video.isShort,
        views: video.views ?? null,
        publishedAt: video.publishedAt || ""
    }
}

// Local ids are prefixed so they can never collide with a YouTube playlist id,
// which is what a subscribed playlist is keyed by.
function createPlaylist(doc, title) {
    const id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    doc.playlists[id] = {
        id,
        kind: "personal",
        title: String(title || "").trim() || "Untitled playlist",
        videos: [],
        createdAt: now(),
        updatedAt: now()
    }
    return { id }
}

function renamePlaylist(doc, playlistId, title) {
    const playlist = doc.playlists[playlistId]
    if (!playlist || playlist.kind !== "personal") throw new Error("Not a playlist you can rename")
    playlist.title = String(title || "").trim() || playlist.title
    playlist.updatedAt = now()
    return { id: playlistId, title: playlist.title }
}

function deletePlaylist(doc, playlistId) {
    if (!doc.playlists[playlistId]) return { removed: false }
    delete doc.playlists[playlistId]
    return { removed: true }
}

function addToPlaylist(doc, playlistId, video) {
    const playlist = doc.playlists[playlistId]
    if (!playlist || playlist.kind !== "personal") throw new Error("Not a playlist you can add to")
    if (!video?.id) throw new Error("addToPlaylist needs a video")
    if (playlist.videos.some(entry => entry.id === video.id)) return { added: false }

    playlist.videos.push(playlistVideo(video))
    playlist.updatedAt = now()
    return { added: true }
}

function removeFromPlaylist(doc, playlistId, videoId) {
    const playlist = doc.playlists[playlistId]
    if (!playlist || playlist.kind !== "personal") throw new Error("Not a playlist you can remove from")

    const before = playlist.videos.length
    playlist.videos = playlist.videos.filter(entry => entry.id !== videoId)
    if (playlist.videos.length === before) return { removed: false }
    playlist.updatedAt = now()
    return { removed: true }
}

// Moves one video a single step. A list reorders fine one step at a time, and
// anything finer needs a drag surface this widget does not have.
function movePlaylistVideo(doc, playlistId, videoId, delta) {
    const playlist = doc.playlists[playlistId]
    if (!playlist || playlist.kind !== "personal") throw new Error("Not a playlist you can reorder")

    const from = playlist.videos.findIndex(entry => entry.id === videoId)
    const to = from + (delta < 0 ? -1 : 1)
    if (from < 0 || to < 0 || to >= playlist.videos.length) return { moved: false }

    const [entry] = playlist.videos.splice(from, 1)
    playlist.videos.splice(to, 0, entry)
    playlist.updatedAt = now()
    return { moved: true }
}

// Upserts a snapshot of someone else's playlist. The contents belong to its
// author, so following one stores what it held at fetch time and records when,
// rather than pretending the local copy is live.
function saveSubscribedPlaylist(doc, playlist) {
    if (!playlist?.id) throw new Error("saveSubscribedPlaylist needs a playlist id")
    const existing = doc.playlists[playlist.id]

    doc.playlists[playlist.id] = {
        id: playlist.id,
        kind: "subscribed",
        title: playlist.title || existing?.title || playlist.id,
        author: playlist.author || existing?.author || "",
        authorId: playlist.authorId || existing?.authorId || "",
        thumbnail: playlist.thumbnail || existing?.thumbnail || "",
        videos: (playlist.videos || []).map(playlistVideo),
        subscribedAt: existing?.subscribedAt || now(),
        fetchedAt: now()
    }
    return { id: playlist.id, videos: doc.playlists[playlist.id].videos.length, refreshed: !!existing }
}

module.exports = {
    emptyDoc,
    parseDoc,
    addChannels,
    removeChannel,
    mergeVideos,
    pruneVideos,
    setWatched,
    setWatchedMany,
    clearWatched,
    backfillWatched,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    movePlaylistVideo,
    saveSubscribedPlaylist
}
