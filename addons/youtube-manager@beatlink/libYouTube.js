/*
 * youtube-manager@beatlink -- the YouTube.js frontend layer.
 *
 * Everything that talks to YouTube lives here, and all of it runs in the
 * browser. YouTube.js ships as ESM only (no CommonJS entry anywhere in its
 * exports map), so a Trilium backend script cannot require() it at all; the
 * frontend is the only place it can run.
 *
 * Running in the browser costs a proxy. YouTube's InnerTube endpoints send no
 * CORS headers, so upstream's instruction is to proxy through your own server.
 * Trilium's backend is that server, which makes every call same-origin from
 * here -- see proxyFetch and the matching "proxy" action in the backend note.
 *
 * The session is created with retrieve_player: false and
 * generate_session_locally: true, so it never fetches or evaluates YouTube's JS
 * player. That is enough for channel metadata, upload listings, and search, and
 * skips the slowest part of session creation. It is deliberately not enough to
 * decode media streams, which is why playback uses YouTube's iframe embed.
 */

const BUNDLE_RESOURCE = "custom/libYoutubei.js"
const ENDPOINT = "custom/youtubeManager"

// YouTube's Videos tab already excludes Shorts, so this only catches the ones
// that leak into a listing. It is a heuristic: YouTube has allowed Shorts up to
// three minutes since 2024, so a longer Short reads as a normal video here.
const SHORT_MAX_SECONDS = 60

const RELATIVE_UNITS = {
    second: 1000,
    minute: 60000,
    hour: 3600000,
    day: 86400000,
    week: 604800000,
    month: 2629800000,
    year: 31557600000
}

let innertubePromise = null

// --- transport --------------------------------------------------------------

// The fetch implementation handed to YouTube.js. It repackages the request as a
// POST to the backend proxy and rebuilds a real Response from what comes back,
// so YouTube.js is unaware it is not talking to YouTube directly.
async function proxyFetch(input, init) {
    const request = input instanceof Request && !init ? input : new Request(input, init)

    const headers = {}
    for (const [name, value] of request.headers) headers[name] = value

    const hasBody = request.method !== "GET" && request.method !== "HEAD"
    const payload = {
        url: request.url,
        method: request.method,
        headers,
        body: hasBody ? await request.text() : null
    }

    const response = await fetch(`${ENDPOINT}?action=proxy`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })

    const result = await response.json()
    if (result.error) throw new Error(result.error)
    // The proxy's own status is 200 whenever forwarding worked; the status
    // YouTube.js reacts to is the one YouTube returned, carried in the payload.
    return new Response(result.body, { status: result.status, headers: result.headers })
}

// Calls a non-proxy backend action and unwraps its JSON.
async function callBackend(action, params = {}, body = null) {
    const search = new URLSearchParams({ action, ...params })
    const options = { credentials: "same-origin" }
    if (body) {
        options.method = "POST"
        options.headers = { "Content-Type": "application/json" }
        options.body = JSON.stringify(body)
    }
    const response = await fetch(`${ENDPOINT}?${search}`, options)
    let result
    try {
        result = await response.json()
    } catch (e) {
        result = { error: `HTTP ${response.status}` }
    }
    if (!response.ok || result.error) throw new Error(result.error || `HTTP ${response.status}`)
    return result
}

// --- session ----------------------------------------------------------------

// Loads the vendored ESM bundle from its customResourceProvider URL. The URL is
// resolved against the document base so a Trilium behind a reverse-proxy
// subpath still finds it, and the import goes through a constructed Function so
// no build step can rewrite it into a static dependency it cannot satisfy.
async function importBundle() {
    const url = new URL(BUNDLE_RESOURCE, document.baseURI).href
    const dynamicImport = new Function("specifier", "return import(specifier)")
    return dynamicImport(url)
}

async function createInnertube() {
    const { Innertube } = await importBundle()
    return Innertube.create({
        fetch: proxyFetch,
        retrieve_player: false,
        generate_session_locally: true
    })
}

// One session per page load, shared by every call.
function getInnertube() {
    if (!innertubePromise) {
        innertubePromise = createInnertube().catch(error => {
            innertubePromise = null
            throw error
        })
    }
    return innertubePromise
}

// --- parsing ----------------------------------------------------------------

// YouTube's listings carry only a relative published time ("3 days ago"), so an
// absolute timestamp has to be estimated from it. The caller stores the result
// once on first sight and never revises it, which keeps feed order stable as
// that text ages.
function estimatePublished(text) {
    const match = /(\d+)\s*(second|minute|hour|day|week|month|year)/i.exec(String(text || ""))
    if (!match) return new Date().toISOString()
    const unit = RELATIVE_UNITS[match[2].toLowerCase()]
    return new Date(Date.now() - Number(match[1]) * unit).toISOString()
}

// "12:34" and "1:02:03" to seconds.
function parseDuration(text) {
    const raw = String(text || "").trim()
    if (!raw) return null
    const parts = raw.split(":").map(Number)
    if (!parts.length || parts.some(part => !Number.isFinite(part))) return null
    return parts.reduce((total, part) => total * 60 + part, 0)
}

// "1,234,567 views" and the abbreviated "1.2M views" both to a number.
function parseViews(text) {
    const match = /([\d.,]+)\s*([KMB])?/i.exec(String(text || ""))
    if (!match) return null
    const number = Number(match[1].replace(/,/g, ""))
    if (!Number.isFinite(number)) return null
    const scale = { k: 1e3, m: 1e6, b: 1e9 }[String(match[2] || "").toLowerCase()] || 1
    return Math.round(number * scale)
}

// Thumbnails are derived from the video id rather than read off the node: the
// URL scheme is fixed, and a constructed one cannot arrive missing or expired.
function thumbnailFor(videoId) {
    return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
}

function firstUrl(candidates) {
    for (const candidate of candidates) {
        const url = candidate?.[0]?.url
        if (url) return url
    }
    return ""
}

// Maps one listing node to a stored video. Returns null for anything without a
// video id, which covers the shelves and banners YouTube mixes into a tab.
function mapVideo(node, channelId) {
    const id = node?.video_id || node?.id || node?.on_tap_endpoint?.payload?.videoId
    if (!id) return null

    const duration = parseDuration(node.length_text?.text)
    const shortByType = node.type === "ShortsLockupView" || node.type === "ReelItem"

    return {
        id,
        // Feed listings know the channel they were fetched from; search results
        // carry it on the node instead, so both paths land the same shape.
        channelId: channelId || node.author?.id || "",
        channelName: node.author?.name || "",
        title: node.title?.text || node.overlay_metadata?.primary_text?.text || node.accessibility_text || "",
        thumbnail: thumbnailFor(id),
        duration,
        isShort: shortByType || (duration !== null && duration <= SHORT_MAX_SECONDS),
        views: parseViews(node.view_count?.text || node.short_view_count?.text),
        publishedAt: estimatePublished(node.published?.text)
    }
}

// The widest thumbnail in a node's list. Avatar URLs sometimes come back
// protocol-relative ("//yt3..."), which no <img> in Trilium can load.
function bestThumbnail(thumbnails) {
    const list = Array.isArray(thumbnails) ? [...thumbnails] : []
    if (!list.length) return ""
    const url = list.sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || ""
    return url.startsWith("//") ? `https:${url}` : url
}

// One channel out of a search result list. YouTube now returns the @handle in
// subscriberCountText and the subscriber text in videoCountText, so the two are
// told apart by their content rather than by the field they arrive in.
function mapSearchChannel(node) {
    const texts = [node?.subscriber_count?.text, node?.video_count?.text].filter(Boolean)
    return {
        id: node?.id || node?.author?.id || "",
        name: node?.author?.name || "",
        thumbnail: bestThumbnail(node?.author?.thumbnails),
        handle: texts.find(text => text.startsWith("@")) || "",
        subscribers: texts.find(text => !text.startsWith("@")) || "",
        description: node?.description_snippet?.text || ""
    }
}

function mapChannel(channel) {
    const metadata = channel?.metadata || {}
    const id = metadata.external_id || channel?.header?.author?.id
    if (!id) throw new Error("Could not read a channel id from YouTube's response")
    return {
        id,
        name: metadata.title || channel?.header?.author?.name || id,
        thumbnail: firstUrl([metadata.avatar, metadata.thumbnail, channel?.header?.author?.thumbnails]),
        handle: metadata.vanity_channel_url ? `@${metadata.vanity_channel_url.split("@").pop()}` : ""
    }
}

// --- channel input ----------------------------------------------------------

// A raw UC id, if the input already contains one. Channel ids are a fixed
// 24-character shape, so this is unambiguous wherever it appears.
function channelIdIn(input) {
    const match = /(UC[A-Za-z0-9_-]{22})/.exec(String(input || ""))
    return match ? match[1] : null
}

// Anything else becomes a canonical channel URL for YouTube to resolve: a bare
// handle gets the @ form, a bare name is treated as a handle, and a full URL is
// passed through.
function channelUrlFor(input) {
    const raw = String(input || "").trim()
    if (!raw) throw new Error("Enter a channel URL or @handle")
    if (/^https?:\/\//i.test(raw)) return raw
    if (raw.startsWith("@")) return `https://www.youtube.com/${raw}`
    return `https://www.youtube.com/@${raw}`
}

// --- search input -----------------------------------------------------------

// The video id in a watch, shorts, embed, live, or youtu.be URL, if there is
// one. The id shape is checked as well as the path, so a URL that carries some
// other value in that position is not mistaken for a video.
function videoIdInUrl(raw) {
    let url
    try {
        url = new URL(raw)
    } catch (e) {
        return null
    }

    const host = url.hostname.toLowerCase().replace(/^www\./, "")
    const asId = value => /^[A-Za-z0-9_-]{11}$/.test(String(value || "")) ? value : null

    if (host === "youtu.be") return asId(url.pathname.slice(1))
    if (!/^(.+\.)?youtube(-nocookie)?\.com$/.test(host)) return null

    const segments = url.pathname.split("/").filter(Boolean)
    if (segments[0] === "watch") return asId(url.searchParams.get("v"))
    if (["shorts", "embed", "live", "v"].includes(segments[0])) return asId(segments[1])
    return null
}

// Decides what one box of text means: a video URL opens that video, a channel
// URL, @handle, or UC id opens that channel, and anything else is a search.
//
// Only a URL is ever read as a video. A bare eleven-character word is a
// perfectly plausible search term, so guessing at one would silently swallow
// the search instead of running it.
function parseTarget(input) {
    const raw = String(input || "").trim()
    if (!raw) return null

    if (/^https?:\/\//i.test(raw)) {
        const videoId = videoIdInUrl(raw)
        return videoId ? { kind: "video", id: videoId } : { kind: "channel", input: raw }
    }
    if (/^@[^\s/]+$/.test(raw)) return { kind: "channel", input: raw }
    if (/^UC[A-Za-z0-9_-]{22}$/.test(raw)) return { kind: "channel", input: raw }
    return { kind: "query", query: raw }
}

// --- public API -------------------------------------------------------------

// Resolves one channel URL, @handle, or UC id into a stored channel record.
async function resolveChannel(input) {
    const yt = await getInnertube()

    const directId = channelIdIn(input)
    if (directId) return mapChannel(await yt.getChannel(directId))

    const endpoint = await yt.resolveURL(channelUrlFor(input))
    const browseId = endpoint?.payload?.browseId
    if (!browseId) throw new Error(`Not a channel: ${input}`)
    return mapChannel(await yt.getChannel(browseId))
}

// Recent uploads for one channel, following continuations until `limit` is
// reached or the tab runs out.
async function fetchChannelVideos(channelId, limit) {
    const yt = await getInnertube()
    const channel = await yt.getChannel(channelId)

    let tab = await channel.getVideos()
    const videos = []

    while (tab) {
        for (const node of tab.videos || []) {
            const video = mapVideo(node, channelId)
            if (video) videos.push(video)
        }
        if (videos.length >= limit || !tab.has_continuation) break
        tab = await tab.getContinuation()
    }

    return videos.slice(0, limit)
}

// Videos matching a search term, across all of YouTube.
async function searchVideos(query, limit) {
    const yt = await getInnertube()
    const results = await yt.search(query)

    const videos = []
    for (const node of results.videos || []) {
        const video = mapVideo(node, null)
        if (video) videos.push(video)
    }
    return videos.slice(0, limit)
}

// Channels matching a search term. A separate request from searchVideos: the
// unfiltered result page carries at most a channel or two, so the channel
// filter is the only way to get a list worth subscribing from.
async function searchChannels(query, limit) {
    const yt = await getInnertube()
    const results = await yt.search(query, { type: "channel" })
    return (results.channels || [])
        .map(mapSearchChannel)
        .filter(channel => channel.id)
        .slice(0, limit)
}

// Videos matching a search term within one channel, using the channel's own
// search tab. A channel that does not expose that tab reports it rather than
// silently returning nothing.
async function searchChannelVideos(channelId, query, limit) {
    const yt = await getInnertube()
    const channel = await yt.getChannel(channelId)
    if (typeof channel.search !== "function") throw new Error("This channel cannot be searched")

    const results = await channel.search(query)
    const videos = []
    for (const node of results.videos || []) {
        const video = mapVideo(node, channelId)
        if (video) videos.push(video)
    }
    return videos.slice(0, limit)
}

// One video's metadata, for a pasted watch URL. getBasicInfo only reads the
// watch response's own details, so it works without the JS player this session
// deliberately never fetches. Unlike a listing, it carries a real publish date.
async function fetchVideo(videoId) {
    const yt = await getInnertube()
    const details = (await yt.getBasicInfo(videoId)).basic_info || {}

    const duration = Number.isFinite(details.duration) ? details.duration : null
    // start_timestamp arrives as a Date, not a string, so it is read as one.
    const published = new Date(details.start_timestamp || 0).getTime()

    return {
        id: videoId,
        channelId: details.channel_id || "",
        channelName: details.author || "",
        title: details.title || videoId,
        thumbnail: thumbnailFor(videoId),
        duration,
        isShort: duration !== null && duration <= SHORT_MAX_SECONDS,
        views: Number.isFinite(details.view_count) ? details.view_count : null,
        publishedAt: published ? new Date(published).toISOString() : ""
    }
}

// Reads a FreeTube subscription export (.db). Each line is one profile as JSON,
// so a file is parsed line by line rather than as a single document. The older
// flat format, one channel per line, is accepted too -- FreeTube's own importer
// still converts it, so exports in that shape are still in circulation.
function parseFreeTubeExport(text) {
    const channels = []
    const seen = new Set()

    const push = (id, name, thumbnail) => {
        if (!id || seen.has(id)) return
        seen.add(id)
        channels.push({ id, name: name || id, thumbnail: thumbnail || "" })
    }

    for (const line of String(text || "").split("\n")) {
        const trimmed = line.trim()
        if (!trimmed) continue

        let entry
        try {
            entry = JSON.parse(trimmed)
        } catch (e) {
            continue
        }

        if (entry.channelId) {
            push(entry.channelId, entry.channelName, entry.channelThumbnail)
            continue
        }
        // A profile's subscriptions. Every profile in the file contributes, so
        // channels only in a secondary profile are not silently dropped.
        for (const sub of entry.subscriptions || []) push(sub.id, sub.name, sub.thumbnail)
    }

    if (!channels.length) throw new Error("No subscriptions found. Export as \"FreeTube\" (.db), not OPML or CSV.")
    return channels
}

module.exports = {
    callBackend,
    parseTarget,
    resolveChannel,
    fetchChannelVideos,
    fetchVideo,
    searchVideos,
    searchChannels,
    searchChannelVideos,
    parseFreeTubeExport,
    estimatePublished,
    parseDuration,
    parseViews
}
