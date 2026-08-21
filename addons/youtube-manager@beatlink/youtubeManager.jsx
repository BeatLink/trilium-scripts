import { useState, useEffect, useCallback, useMemo, useRef } from "trilium:preact"
import { activateNote } from "trilium:api"

/*
 * youtube-manager@beatlink -- the widget.
 *
 * Three tabs:
 *   Feed           every recent upload across your subscriptions, watched-aware
 *   Search         YouTube search: videos, channels, and one channel's uploads
 *   Subscriptions  the channel list, plus adding and importing channels
 *
 * The whole library lives in one JSON note. The backend owns every read and
 * write of it, so this widget never parses or writes that document directly.
 *
 * Refreshing is a foreground job. YouTube.js only runs in the browser, so there
 * is no scheduled background sync -- the feed updates when this widget is open,
 * either automatically once the refresh interval has elapsed or on demand.
 */

const yt = require("libYouTube.js")
const sb = require("libSponsorBlock.js")

const FILTERS = [
    ["unwatched", "Unwatched"],
    ["watched", "Watched"],
    ["all", "All"]
]

// Search result caps. Fixed rather than configurable: one page of results is
// what the box is for, and following continuations to reach a larger number
// would make every search several requests instead of one.
const SEARCH_VIDEO_LIMIT = 30
const SEARCH_CHANNEL_LIMIT = 5
const PLAYLIST_LIMIT = 50
const PLAYLIST_VIDEO_LIMIT = 200
const FEATURED_LIMIT = 12

// --- formatting -------------------------------------------------------------

function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return ""
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const rest = seconds % 60
    const pad = value => String(value).padStart(2, "0")
    return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

function formatViews(views) {
    if (!Number.isFinite(views)) return ""
    if (views >= 1e6) return `${(views / 1e6).toFixed(1)}M views`
    if (views >= 1e3) return `${Math.round(views / 1e3)}K views`
    return `${views} views`
}

// Published dates are estimated from YouTube's relative text, so they are shown
// as an age rather than a date -- a precise-looking date would overstate what
// is actually known.
function formatAge(iso) {
    const then = Date.parse(iso)
    if (!Number.isFinite(then)) return ""
    const days = Math.floor((Date.now() - then) / 86400000)
    if (days <= 0) return "today"
    if (days === 1) return "yesterday"
    if (days < 7) return `${days} days ago`
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`
    if (days < 365) return `${Math.floor(days / 30)} months ago`
    return `${Math.floor(days / 365)} years ago`
}

function formatRefreshed(iso) {
    if (!iso) return "never refreshed"
    const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60000)
    if (!Number.isFinite(minutes)) return "never refreshed"
    if (minutes < 1) return "refreshed just now"
    if (minutes < 60) return `refreshed ${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `refreshed ${hours}h ago`
    return `refreshed ${Math.floor(hours / 24)}d ago`
}

// --- player -----------------------------------------------------------------

// YouTube's own iframe embed. YouTube.js can list and describe videos but
// cannot decode their streams here -- that needs PO-token minting, SABR part
// parsing, a DASH player, and a binary segment proxy -- so playback is handed
// back to YouTube. nocookie is the privacy-preserving host of the same player.
const EMBED_ORIGIN = "https://www.youtube-nocookie.com"

// One message of the embed's own postMessage protocol, which `enablejsapi=1`
// turns on: `listening` asks the player to start reporting, and a `command`
// drives it.
function postToEmbed(frame, message) {
    frame?.contentWindow?.postMessage(JSON.stringify({ ...message, id: 1, channel: "widget" }), EMBED_ORIGIN)
}

function Player({ video, channelName, onClose, onToggleWatched, watched, settings }) {
    const frameRef = useRef(null)
    // The message handler is bound once per video and reads both of these as it
    // runs: the segments arrive after it is bound, and what has been skipped is
    // not worth a re-render.
    const segmentsRef = useRef([])
    const skippedRef = useRef(new Set())
    const [skipNotice, setSkipNotice] = useState("")

    // The embed only talks back when asked to, and only to the origin declared
    // here, so the frame is addressable without loading YouTube's own API script.
    const src = `https://www.youtube-nocookie.com/embed/${video.id}` +
        `?autoplay=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`

    useEffect(() => {
        segmentsRef.current = []
        skippedRef.current = new Set()
        setSkipNotice("")
        if (!settings?.sponsorBlockEnabled) return

        let cancelled = false
        sb.fetchSponsorSegments(video.id, sb.sponsorBlockCategories(settings))
            .then(segments => { if (!cancelled) segmentsRef.current = segments })
            .catch(error => console.error("youtube-manager: SponsorBlock lookup failed", error))

        // The player reports its position roughly four times a second, which is
        // what a skip is decided on.
        const onMessage = event => {
            const frame = frameRef.current
            if (!frame || event.source !== frame.contentWindow) return

            let message
            try {
                message = JSON.parse(event.data)
            } catch {
                return
            }

            const time = message?.info?.currentTime
            if (typeof time !== "number") return

            const segment = sb.segmentAt(segmentsRef.current, time, skippedRef.current)
            if (!segment) return

            // Once per segment, so rewinding into one plays it.
            skippedRef.current.add(segment.uuid)
            postToEmbed(frame, { event: "command", func: "seekTo", args: [segment.end, true] })
            if (settings.sponsorBlockNotify) {
                setSkipNotice(sb.SPONSORBLOCK_LABELS[segment.category] || segment.category)
            }
        }

        window.addEventListener("message", onMessage)
        return () => {
            cancelled = true
            window.removeEventListener("message", onMessage)
        }
    }, [video.id, settings])

    useEffect(() => {
        if (!skipNotice) return
        const timer = setTimeout(() => setSkipNotice(""), 2500)
        return () => clearTimeout(timer)
    }, [skipNotice])

    return (
        <div class="ym-player">
            <div class="ym-player-frame">
                <iframe
                    ref={frameRef}
                    src={src}
                    title={video.title}
                    frameborder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowfullscreen
                    onLoad={() => postToEmbed(frameRef.current, { event: "listening" })}
                />
                {skipNotice && <div class="ym-skip-notice">Skipped: {skipNotice}</div>}
            </div>
            <div class="ym-player-bar">
                <div class="ym-player-meta">
                    <div class="ym-player-title">{video.title}</div>
                    <div class="ym-player-channel">{channelName}</div>
                </div>
                <button class="ym-btn" onClick={() => onToggleWatched(video.id, !watched, video)}>
                    {watched ? "Mark unwatched" : "Mark watched"}
                </button>
                <a class="ym-btn" href={`https://www.youtube.com/watch?v=${video.id}`}
                    target="_blank" rel="noreferrer">Open on YouTube</a>
                <button class="ym-btn" onClick={onClose}>Close</button>
            </div>
        </div>
    )
}

// --- feed -------------------------------------------------------------------

// One row, everywhere a video appears. `meta` replaces the default line when a
// view has something more useful to say than the publish age -- the history
// says when you watched it -- and `actions` adds buttons beside the mark
// button, for the reorder and remove controls a playlist needs.
function VideoRow({ video, channelName, watched, onPlay, onToggleWatched, onAddToPlaylist, meta, actions }) {
    return (
        <div class={`ym-row ${watched ? "ym-row-watched" : ""}`}>
            <button class="ym-thumb" onClick={() => onPlay(video)} title="Play">
                <img src={video.thumbnail} alt="" loading="lazy" />
                {video.duration !== null && (
                    <span class="ym-duration">{formatDuration(video.duration)}</span>
                )}
                {video.isShort && <span class="ym-short">Short</span>}
            </button>

            <div class="ym-row-body">
                <button class="ym-row-title" onClick={() => onPlay(video)}>{video.title}</button>
                <div class="ym-row-meta">
                    <span class="ym-row-channel">{channelName}</span>
                    {meta
                        ? meta.filter(Boolean).map(text => <span key={text}>{text}</span>)
                        : (
                            <>
                                <span>{formatAge(video.publishedAt)}</span>
                                {Number.isFinite(video.views) && <span>{formatViews(video.views)}</span>}
                            </>
                        )}
                </div>
            </div>

            {actions}

            {onAddToPlaylist && (
                <button class="ym-btn ym-btn-icon" title="Add to a playlist"
                    onClick={() => onAddToPlaylist(video)}>+</button>
            )}

            <button
                class={`ym-mark ${watched ? "ym-mark-on" : ""}`}
                title={watched ? "Mark unwatched" : "Mark watched"}
                onClick={() => onToggleWatched(video.id, !watched, video)}>
                {watched ? "Watched" : "Mark watched"}
            </button>
        </div>
    )
}

function FeedTab({ data, view, setView, onToggleWatched, onMarkAllWatched, onAddToPlaylist, busy }) {
    const [playing, setPlaying] = useState(null)
    const [search, setSearch] = useState("")

    const channels = data.channels
    const watched = data.watched

    // Filters compose, and each is applied to the same base list so no single
    // choice silently empties the others.
    const visible = useMemo(() => {
        const term = search.trim().toLowerCase()
        const rows = Object.values(data.videos).filter(video => {
            if (view.hideShorts && video.isShort) return false
            if (view.channel !== "all" && video.channelId !== view.channel) return false
            if (view.filter === "unwatched" && watched[video.id]) return false
            if (view.filter === "watched" && !watched[video.id]) return false
            if (term && !video.title.toLowerCase().includes(term)) return false
            return true
        })
        rows.sort((a, b) => {
            const diff = Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
            return view.sortDesc ? diff : -diff
        })
        return rows
    }, [data.videos, watched, view, search])

    // Scoped by everything except the watch filter itself, so it still reports
    // a useful number while looking at the Watched list rather than reading 0.
    const unwatchedCount = useMemo(
        () => Object.values(data.videos).filter(video => {
            if (watched[video.id]) return false
            if (view.hideShorts && video.isShort) return false
            if (view.channel !== "all" && video.channelId !== view.channel) return false
            return true
        }).length,
        [data.videos, watched, view.hideShorts, view.channel]
    )

    const playingWatched = playing ? !!watched[playing.id] : false

    // Opt-in, because the embedded player reports nothing back about how much
    // was actually watched -- starting a video is the only signal available.
    const play = video => {
        setPlaying(video)
        if (data.settings.markWatchedOnPlay && !watched[video.id]) onToggleWatched(video.id, true, video)
    }

    if (!Object.keys(channels).length) {
        return (
            <div class="ym-empty">
                <p>No subscriptions yet.</p>
                <p>Add a channel on the Subscriptions tab, or find one on the Search tab.</p>
            </div>
        )
    }

    return (
        <div class="ym-feed">
            {playing && (
                <Player
                    video={playing}
                    channelName={channels[playing.channelId]?.name || ""}
                    watched={playingWatched}
                    settings={data.settings}
                    onToggleWatched={onToggleWatched}
                    onClose={() => setPlaying(null)}
                />
            )}

            <div class="ym-toolbar">
                <input
                    class="ym-search"
                    type="search"
                    placeholder="Search titles"
                    value={search}
                    onInput={event => setSearch(event.target.value)}
                />

                <select value={view.filter} onChange={event => setView({ filter: event.target.value })}>
                    {FILTERS.map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                    ))}
                </select>

                <select value={view.channel} onChange={event => setView({ channel: event.target.value })}>
                    <option value="all">All channels</option>
                    {Object.values(channels)
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(channel => (
                            <option key={channel.id} value={channel.id}>{channel.name}</option>
                        ))}
                </select>

                <label class="ym-check">
                    <input
                        type="checkbox"
                        checked={view.hideShorts}
                        onChange={event => setView({ hideShorts: event.target.checked })}
                    />
                    Hide Shorts
                </label>

                <button class="ym-btn" title="Flip sort direction"
                    onClick={() => setView({ sortDesc: !view.sortDesc })}>
                    {view.sortDesc ? "Newest first" : "Oldest first"}
                </button>
            </div>

            <div class="ym-summary">
                <span>{visible.length} shown, {unwatchedCount} unwatched</span>
                {view.filter !== "watched" && visible.some(video => !watched[video.id]) && (
                    <button class="ym-btn" disabled={busy}
                        onClick={() => onMarkAllWatched(visible.filter(v => !watched[v.id]))}>
                        Mark these watched
                    </button>
                )}
            </div>

            {visible.length === 0 && <div class="ym-empty"><p>Nothing matches these filters.</p></div>}

            {visible.map(video => (
                <VideoRow
                    key={video.id}
                    video={video}
                    channelName={channels[video.channelId]?.name || ""}
                    watched={!!watched[video.id]}
                    onPlay={play}
                    onToggleWatched={onToggleWatched}
                    onAddToPlaylist={onAddToPlaylist}
                />
            ))}
        </div>
    )
}

// --- history ----------------------------------------------------------------

// The watch history, newest first. Its entries carry the video's own details
// rather than pointing into the cache, so a video that aged out -- or was
// pulled from YouTube -- still reads as a row instead of a bare id.
//
// Entries written before those details existed have nothing to show but the id,
// and the backend fills in what it still can from the cache on load. Nothing
// here can invent what was never recorded.
function HistoryTab({ data, onToggleWatched, onPlay, onAddToPlaylist, onClearHistory, busy }) {
    const [search, setSearch] = useState("")

    const rows = useMemo(() => {
        const term = search.trim().toLowerCase()
        return Object.entries(data.watched)
            .map(([id, entry]) => ({
                id,
                title: entry.title || id,
                thumbnail: entry.thumbnail || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
                duration: entry.duration ?? null,
                isShort: !!entry.isShort,
                channelId: entry.channelId || "",
                channelName: entry.channelName || "",
                views: null,
                publishedAt: "",
                watchedAt: entry.watchedAt || "",
                watchCount: entry.watchCount || 1
            }))
            .filter(row => !term || row.title.toLowerCase().includes(term))
            .sort((a, b) => Date.parse(b.watchedAt) - Date.parse(a.watchedAt))
    }, [data.watched, search])

    if (!Object.keys(data.watched).length) {
        return (
            <div class="ym-empty">
                <p>Nothing watched yet.</p>
                <p>Marking a video watched anywhere in the widget records it here.</p>
            </div>
        )
    }

    return (
        <div class="ym-history">
            <div class="ym-toolbar">
                <input
                    class="ym-search"
                    type="search"
                    placeholder="Search titles"
                    value={search}
                    onInput={event => setSearch(event.target.value)}
                />
                <button class="ym-btn ym-btn-danger" disabled={busy} onClick={onClearHistory}>
                    Clear history
                </button>
            </div>

            <div class="ym-summary">
                <span>{rows.length} of {Object.keys(data.watched).length} shown</span>
            </div>

            {rows.length === 0 && <div class="ym-empty"><p>Nothing matches that search.</p></div>}

            {rows.map(row => (
                <VideoRow
                    key={row.id}
                    video={row}
                    channelName={row.channelName}
                    watched={true}
                    onPlay={onPlay}
                    onToggleWatched={onToggleWatched}
                    onAddToPlaylist={onAddToPlaylist}
                    meta={[
                        row.watchedAt ? `watched ${formatAge(row.watchedAt)}` : "",
                        row.watchCount > 1 ? `${row.watchCount} times` : ""
                    ]}
                />
            ))}
        </div>
    )
}

// --- playlists --------------------------------------------------------------

// Playlists you made and playlists you follow, in one list.
//
// A personal playlist is yours to edit. A followed one is a snapshot of someone
// else's, taken when you followed it: its contents belong to its author, so it
// is read-only here and carries the time it was last pulled rather than
// pretending to be live. Refresh takes a new snapshot.
function PlaylistsTab({ data, onToggleWatched, onPlay, onAddToPlaylist, onChanged, busy, run }) {
    const [openId, setOpenId] = useState(null)
    const [title, setTitle] = useState("")

    const watched = data.watched
    const playlists = useMemo(
        () => Object.values(data.playlists).sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === "personal" ? -1 : 1
            return a.title.localeCompare(b.title)
        }),
        [data.playlists]
    )

    const open = openId ? data.playlists[openId] : null

    const create = () => run(async () => {
        if (!title.trim()) return
        await yt.callBackend("savePlaylist", {}, { title })
        setTitle("")
        await onChanged()
    })

    const rename = playlist => run(async () => {
        const next = prompt("Rename playlist", playlist.title)
        if (next === null || !next.trim()) return
        await yt.callBackend("savePlaylist", {}, { playlistId: playlist.id, title: next })
        await onChanged()
    })

    const remove = playlist => run(async () => {
        const what = playlist.kind === "personal" ? "Delete" : "Unfollow"
        if (!confirm(`${what} "${playlist.title}"? Your watched history is kept.`)) return
        await yt.callBackend("deletePlaylist", { playlistId: playlist.id })
        setOpenId(null)
        await onChanged()
    })

    const edit = (playlistId, body) => run(async () => {
        await yt.callBackend("editPlaylist", {}, { playlistId, ...body })
        await onChanged()
    })

    // Re-following overwrites the stored snapshot, which is what refreshing one
    // means: the author's copy is the truth and ours is a copy of it.
    const refresh = playlist => run(async () => {
        const fetched = await yt.fetchPlaylist(playlist.id, PLAYLIST_VIDEO_LIMIT)
        await yt.callBackend("followPlaylist", {}, { playlist: fetched })
        await onChanged()
    })

    if (open) {
        const personal = open.kind === "personal"
        return (
            <div class="ym-playlist-view">
                <div class="ym-summary">
                    <button class="ym-btn" onClick={() => setOpenId(null)}>Back to playlists</button>
                    <span>{open.title}</span>
                    <span>{open.videos.length} video(s)</span>
                    {!personal && open.fetchedAt && <span>fetched {formatAge(open.fetchedAt)}</span>}
                    {personal
                        ? <button class="ym-btn" disabled={busy} onClick={() => rename(open)}>Rename</button>
                        : <button class="ym-btn" disabled={busy} onClick={() => refresh(open)}>Refresh</button>}
                    <button class="ym-btn ym-btn-danger" disabled={busy} onClick={() => remove(open)}>
                        {personal ? "Delete" : "Unfollow"}
                    </button>
                </div>

                {open.videos.length === 0 && (
                    <div class="ym-empty"><p>This playlist is empty.</p></div>
                )}

                {open.videos.map((video, index) => (
                    <VideoRow
                        key={video.id}
                        video={video}
                        channelName={video.channelName}
                        watched={!!watched[video.id]}
                        onPlay={onPlay}
                        onToggleWatched={onToggleWatched}
                        onAddToPlaylist={personal ? null : onAddToPlaylist}
                        actions={personal ? (
                            <span class="ym-row-actions">
                                <button class="ym-btn ym-btn-icon" title="Move up"
                                    disabled={busy || index === 0}
                                    onClick={() => edit(open.id, { op: "move", videoId: video.id, delta: -1 })}>
                                    ^
                                </button>
                                <button class="ym-btn ym-btn-icon" title="Move down"
                                    disabled={busy || index === open.videos.length - 1}
                                    onClick={() => edit(open.id, { op: "move", videoId: video.id, delta: 1 })}>
                                    v
                                </button>
                                <button class="ym-btn ym-btn-icon" title="Remove from playlist"
                                    disabled={busy}
                                    onClick={() => edit(open.id, { op: "remove", videoId: video.id })}>
                                    x
                                </button>
                            </span>
                        ) : null}
                    />
                ))}
            </div>
        )
    }

    return (
        <div class="ym-playlists-tab">
            <div class="ym-toolbar">
                <input
                    class="ym-search"
                    type="text"
                    placeholder="New playlist name"
                    value={title}
                    onInput={event => setTitle(event.target.value)}
                    onKeyDown={event => event.key === "Enter" && create()}
                />
                <button class="ym-btn ym-btn-primary" disabled={busy || !title.trim()} onClick={create}>
                    Create
                </button>
            </div>

            {playlists.length === 0 && (
                <div class="ym-empty">
                    <p>No playlists yet.</p>
                    <p>Create one above, or follow a channel's playlist from its page on the Search tab.</p>
                </div>
            )}

            {playlists.map(playlist => (
                <div class="ym-channel" key={playlist.id}>
                    {playlist.thumbnail
                        ? <img class="ym-avatar ym-avatar-square" src={playlist.thumbnail} alt="" loading="lazy" />
                        : <div class="ym-avatar ym-avatar-square ym-avatar-blank" />}
                    <div class="ym-channel-body">
                        <button class="ym-channel-name" onClick={() => setOpenId(playlist.id)}>
                            {playlist.title}
                        </button>
                        <div class="ym-channel-meta">
                            <span>{playlist.kind === "personal" ? "Yours" : "Followed"}</span>
                            <span>{playlist.videos.length} video(s)</span>
                            {playlist.author && <span>{playlist.author}</span>}
                        </div>
                    </div>
                    <button class="ym-btn ym-btn-danger" disabled={busy} onClick={() => remove(playlist)}>
                        {playlist.kind === "personal" ? "Delete" : "Unfollow"}
                    </button>
                </div>
            ))}
        </div>
    )
}

// --- add to playlist --------------------------------------------------------

// The picker one "+" opens. Only personal playlists are offered, because a
// followed playlist is someone else's and adding to the local copy would only
// last until the next refresh overwrote it.
function AddToPlaylist({ video, playlists, busy, onAdd, onCreate, onClose }) {
    const [title, setTitle] = useState("")

    const targets = useMemo(
        () => Object.values(playlists)
            .filter(playlist => playlist.kind === "personal")
            .sort((a, b) => a.title.localeCompare(b.title)),
        [playlists]
    )

    return (
        <div class="ym-picker">
            <div class="ym-picker-head">
                <span>Add "{video.title}" to</span>
                <button class="ym-btn" onClick={onClose}>Close</button>
            </div>

            {targets.length === 0 && <p class="ym-status">You have no playlists of your own yet.</p>}

            <div class="ym-picker-list">
                {targets.map(playlist => {
                    const already = playlist.videos.some(entry => entry.id === video.id)
                    return (
                        <button key={playlist.id} class="ym-btn" disabled={busy || already}
                            onClick={() => onAdd(playlist.id)}>
                            {already ? `${playlist.title} (already in)` : playlist.title}
                        </button>
                    )
                })}
            </div>

            <div class="ym-toolbar">
                <input
                    class="ym-search"
                    type="text"
                    placeholder="New playlist name"
                    value={title}
                    onInput={event => setTitle(event.target.value)}
                    onKeyDown={event => event.key === "Enter" && onCreate(title)}
                />
                <button class="ym-btn ym-btn-primary" disabled={busy || !title.trim()}
                    onClick={() => onCreate(title)}>
                    Create and add
                </button>
            </div>
        </div>
    )
}

// --- channel page -----------------------------------------------------------

function PlaylistCard({ playlist, followed, busy, onOpen, onFollow }) {
    return (
        <div class="ym-playlist">
            <button class="ym-playlist-open" onClick={() => onOpen(playlist)}>
                {playlist.thumbnail
                    ? <img src={playlist.thumbnail} alt="" loading="lazy" />
                    : <div class="ym-playlist-blank" />}
                <div class="ym-playlist-title">{playlist.title}</div>
                {playlist.count && <div class="ym-playlist-count">{playlist.count}</div>}
            </button>
            <button class="ym-btn ym-playlist-follow" disabled={busy || followed}
                onClick={() => onFollow(playlist)}>
                {followed ? "Followed" : "Follow"}
            </button>
        </div>
    )
}

// A channel, as its own page: header, uploads with a server-side sort and
// paging, its playlists, and the About panel.
//
// Each tab loads on first use rather than up front. The channel object is a
// separate request per tab either way, so fetching all of them on mount would
// spend three requests to fill two panels nobody had opened yet.
function ChannelPage({ channelId, seed, data, busy, run, onPlay, onToggleWatched, onAddToPlaylist, onOpenChannel, onSubscribe, onChanged }) {
    const [info, setInfo] = useState(seed)
    const [tab, setTab] = useState("videos")
    const [sort, setSort] = useState(yt.CHANNEL_SORTS[0])
    const [videos, setVideos] = useState([])
    const [next, setNext] = useState(null)
    const [query, setQuery] = useState("")
    const [searched, setSearched] = useState(false)
    const [hideWatched, setHideWatched] = useState(false)
    const [playlists, setPlaylists] = useState(null)
    const [openPlaylist, setOpenPlaylist] = useState(null)
    const [featured, setFeatured] = useState(null)

    const watched = data.watched
    const subscribed = !!data.channels[channelId]

    // Videos are stamped with the channel here because a channel-tab listing
    // carries no author of its own, and the player bar reads the name off the
    // video it was handed.
    const stamp = list => list.map(video => ({ ...video, channelName: info?.name || "" }))

    const loadPage = order => run(async () => {
        const page = await yt.fetchChannelPage(channelId, order)
        setVideos(stamp(page.videos))
        setNext(() => page.next)
        setSearched(false)
    })

    // The caller keys this component by channel id, so a different channel
    // remounts it and nothing from the previous one survives into the new page.
    useEffect(() => {
        run(async () => {
            const [loaded, page] = await Promise.all([
                yt.fetchChannelInfo(channelId),
                yt.fetchChannelPage(channelId, yt.CHANNEL_SORTS[0])
            ])
            setInfo(loaded)
            setVideos(page.videos.map(video => ({ ...video, channelName: loaded.name })))
            setNext(() => page.next)
        })
    }, [])

    const loadMore = () => run(async () => {
        const page = await next()
        setVideos(current => [...current, ...stamp(page.videos)])
        setNext(() => page.next)
    })

    const changeSort = order => {
        setSort(order)
        loadPage(order)
    }

    // An empty box goes back to the uploads, so clearing the search undoes it
    // rather than leaving the list empty.
    const searchHere = () => {
        const term = query.trim()
        if (!term) return loadPage(sort)
        run(async () => {
            setVideos(stamp(await yt.searchChannelVideos(channelId, term, SEARCH_VIDEO_LIMIT)))
            setNext(null)
            setSearched(true)
        })
    }

    const showPlaylists = () => {
        setTab("playlists")
        setOpenPlaylist(null)
        if (playlists === null) {
            run(async () => setPlaylists(await yt.fetchChannelPlaylists(channelId, PLAYLIST_LIMIT)))
        }
    }

    const showAbout = () => {
        setTab("about")
        if (featured === null) {
            run(async () => setFeatured(await yt.fetchFeaturedChannels(channelId, FEATURED_LIMIT)))
        }
    }

    const openPlaylistVideos = playlist => run(async () => {
        setOpenPlaylist(await yt.fetchPlaylist(playlist.id, PLAYLIST_VIDEO_LIMIT))
    })

    // Following stores a snapshot of the playlist as it is now, which is also
    // what re-following it later does.
    const follow = playlist => run(async () => {
        const fetched = playlist.videos
            ? playlist
            : await yt.fetchPlaylist(playlist.id, PLAYLIST_VIDEO_LIMIT)
        await yt.callBackend("followPlaylist", {}, {
            playlist: { ...fetched, author: fetched.author || info?.name || "", authorId: channelId }
        })
        await onChanged()
    })

    const shown = hideWatched ? videos.filter(video => !watched[video.id]) : videos

    const tabs = [["videos", "Videos"]]
    if (info?.hasPlaylists) tabs.push(["playlists", "Playlists"])
    tabs.push(["about", "About"])

    const showTab = key => {
        if (key === "playlists") return showPlaylists()
        if (key === "about") return showAbout()
        setTab("videos")
    }

    if (!info) return <div class="ym-empty"><p>Loading channel...</p></div>

    return (
        <div class="ym-channel-page">
            {info.banner && <img class="ym-banner" src={info.banner} alt="" />}

            <div class="ym-channel ym-channel-header">
                {info.thumbnail
                    ? <img class="ym-avatar ym-avatar-big" src={info.thumbnail} alt="" />
                    : <div class="ym-avatar ym-avatar-big ym-avatar-blank" />}
                <div class="ym-channel-body">
                    <a class="ym-channel-name ym-channel-title"
                        href={`https://www.youtube.com/channel/${info.id}`}
                        target="_blank" rel="noreferrer">{info.name}</a>
                    <div class="ym-channel-meta">
                        {info.handle && <span>{info.handle}</span>}
                        {info.subscribers && <span>{info.subscribers}</span>}
                        {info.videoCount && <span>{info.videoCount}</span>}
                    </div>
                </div>
                <button class={`ym-btn ${subscribed ? "ym-btn-danger" : "ym-btn-primary"}`}
                    disabled={busy}
                    onClick={() => onSubscribe(info, subscribed)}>
                    {subscribed ? "Unsubscribe" : "Subscribe"}
                </button>
            </div>

            <div class="ym-tabs ym-subtabs">
                {tabs.map(([key, label]) => (
                    <button key={key} class={`ym-tab ${tab === key ? "ym-tab-on" : ""}`}
                        onClick={() => showTab(key)}>{label}</button>
                ))}
            </div>

            {tab === "videos" && (
                <>
                    <div class="ym-toolbar">
                        <input
                            class="ym-search"
                            type="search"
                            placeholder={`Search within ${info.name}`}
                            value={query}
                            onInput={event => setQuery(event.target.value)}
                            onKeyDown={event => event.key === "Enter" && searchHere()}
                        />
                        <button class="ym-btn" disabled={busy} onClick={searchHere}>Search channel</button>

                        <select value={sort} disabled={busy || searched}
                            onChange={event => changeSort(event.target.value)}>
                            {yt.CHANNEL_SORTS.map(order => (
                                <option key={order} value={order}>{order}</option>
                            ))}
                        </select>

                        <label class="ym-check">
                            <input type="checkbox" checked={hideWatched}
                                onChange={event => setHideWatched(event.target.checked)} />
                            Hide watched
                        </label>
                    </div>

                    <div class="ym-summary">
                        <span>{shown.length} shown{searched ? ", matching your search" : ""}</span>
                    </div>

                    {!busy && shown.length === 0 && (
                        <div class="ym-empty"><p>No videos to show.</p></div>
                    )}

                    {shown.map(video => (
                        <VideoRow
                            key={video.id}
                            video={video}
                            channelName={info.name}
                            watched={!!watched[video.id]}
                            onPlay={onPlay}
                            onToggleWatched={onToggleWatched}
                            onAddToPlaylist={onAddToPlaylist}
                        />
                    ))}

                    {next && (
                        <button class="ym-btn ym-load-more" disabled={busy} onClick={loadMore}>
                            {busy ? "Loading..." : "Load more"}
                        </button>
                    )}
                </>
            )}

            {tab === "playlists" && !openPlaylist && (
                <>
                    {playlists?.length === 0 && (
                        <div class="ym-empty"><p>This channel has no public playlists.</p></div>
                    )}
                    <div class="ym-playlists">
                        {(playlists || []).map(playlist => (
                            <PlaylistCard key={playlist.id} playlist={playlist}
                                followed={!!data.playlists[playlist.id]}
                                busy={busy}
                                onOpen={openPlaylistVideos}
                                onFollow={follow} />
                        ))}
                    </div>
                </>
            )}

            {tab === "playlists" && openPlaylist && (
                <>
                    <div class="ym-summary">
                        <button class="ym-btn" onClick={() => setOpenPlaylist(null)}>
                            Back to playlists
                        </button>
                        <span>{openPlaylist.title}</span>
                        <span>{openPlaylist.videos.length} video(s)</span>
                        <button class="ym-btn" disabled={busy || !!data.playlists[openPlaylist.id]}
                            onClick={() => follow(openPlaylist)}>
                            {data.playlists[openPlaylist.id] ? "Followed" : "Follow"}
                        </button>
                    </div>
                    {openPlaylist.videos.map(video => (
                        <VideoRow
                            key={video.id}
                            video={video}
                            channelName={video.channelName}
                            watched={!!watched[video.id]}
                            onPlay={onPlay}
                            onToggleWatched={onToggleWatched}
                            onAddToPlaylist={onAddToPlaylist}
                        />
                    ))}
                </>
            )}

            {tab === "about" && (
                <div class="ym-about">
                    {info.description
                        ? <p class="ym-about-text">{info.description}</p>
                        : <p class="ym-about-text">This channel has no description.</p>}

                    <div class="ym-about-facts">
                        {info.subscribers && <span>{info.subscribers}</span>}
                        {info.videoCount && <span>{info.videoCount}</span>}
                        {info.totalViews && <span>{info.totalViews}</span>}
                        {info.joined && <span>{info.joined}</span>}
                        {info.country && <span>{info.country}</span>}
                    </div>

                    {featured?.length > 0 && (
                        <>
                            <h4 class="ym-about-heading">Featured channels</h4>
                            {featured.map(channel => (
                                <div class="ym-channel" key={channel.id}>
                                    {channel.thumbnail
                                        ? <img class="ym-avatar" src={channel.thumbnail} alt="" loading="lazy" />
                                        : <div class="ym-avatar ym-avatar-blank" />}
                                    <div class="ym-channel-body">
                                        <button class="ym-channel-name"
                                            onClick={() => onOpenChannel(channel.id, channel)}>
                                            {channel.name}
                                        </button>
                                        {channel.subscribers && (
                                            <div class="ym-channel-meta"><span>{channel.subscribers}</span></div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </>
                    )}
                </div>
            )}
        </div>
    )
}

// --- search -----------------------------------------------------------------

function ChannelResult({ channel, subscribed, busy, onOpen, onSubscribe }) {
    return (
        <div class="ym-channel">
            {channel.thumbnail
                ? <img class="ym-avatar" src={channel.thumbnail} alt="" loading="lazy" />
                : <div class="ym-avatar ym-avatar-blank" />}
            <div class="ym-channel-body">
                <button class="ym-channel-name" onClick={() => onOpen(channel.id, channel)}>
                    {channel.name}
                </button>
                <div class="ym-channel-meta">
                    {channel.handle && <span>{channel.handle}</span>}
                    {channel.subscribers && <span>{channel.subscribers}</span>}
                </div>
                {channel.description && <div class="ym-channel-desc">{channel.description}</div>}
            </div>
            <button class={`ym-btn ${subscribed ? "" : "ym-btn-primary"}`}
                disabled={busy || subscribed}
                onClick={() => onSubscribe(channel, false)}>
                {subscribed ? "Subscribed" : "Subscribe"}
            </button>
        </div>
    )
}

// One box for everything. A watch URL opens that video, a channel URL, @handle,
// or UC id opens that channel, and anything else is searched for -- so pasting
// whatever was on the clipboard does the obvious thing without a mode switch.
//
// Nothing here is remembered between sessions and nothing is written to the
// cache: results are live YouTube data, and only what you mark watched and who
// you subscribe to become part of the library.
function SearchTab({ data, onToggleWatched, onAddToPlaylist, onChanged }) {
    const [input, setInput] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)
    const [results, setResults] = useState(null)
    const [channel, setChannel] = useState(null)
    const [playing, setPlaying] = useState(null)

    const watched = data.watched
    const subscribed = data.channels

    const run = async job => {
        setBusy(true)
        setError(null)
        try {
            await job()
        } catch (e) {
            setError(e.message)
        } finally {
            setBusy(false)
        }
    }

    // Same opt-in as the Feed: an embedded player reports nothing back about how
    // much was actually watched, so starting a video is the only signal there is.
    const play = video => {
        setPlaying(video)
        if (data.settings.markWatchedOnPlay && !watched[video.id]) onToggleWatched(video.id, true, video)
    }

    // The seed is whatever was already known about the channel -- a search
    // result's name and avatar -- so the header paints before its own request
    // comes back.
    const openChannel = (channelId, seed) => {
        setResults(null)
        setError(null)
        setChannel({ id: channelId, seed: seed || null })
    }

    const submit = () => run(async () => {
        const target = yt.parseTarget(input)
        if (!target) return

        if (target.kind === "video") {
            play(await yt.fetchVideo(target.id))
            return
        }
        if (target.kind === "channel") {
            const record = await yt.resolveChannel(target.input)
            openChannel(record.id, record)
            return
        }

        // Videos and channels are separate requests: the unfiltered result page
        // carries at most a channel or two, so the channel filter is the only
        // way to get a list worth subscribing from.
        const [videos, channels] = await Promise.all([
            yt.searchVideos(target.query, SEARCH_VIDEO_LIMIT),
            yt.searchChannels(target.query, SEARCH_CHANNEL_LIMIT)
        ])
        setChannel(null)
        setResults({ videos, channels })
    })

    // Unsubscribing keeps the watched history, exactly as it does on the
    // Subscriptions tab -- only the channel and its cached videos go.
    const toggleSubscribed = (record, isSubscribed) => run(async () => {
        if (isSubscribed) {
            if (!confirm(`Unsubscribe from ${record.name}? Its cached videos are dropped; your watched history is kept.`)) return
            await yt.callBackend("removeChannel", { channelId: record.id })
        } else {
            await yt.callBackend("addChannels", {}, {
                channels: [{
                    id: record.id,
                    name: record.name,
                    thumbnail: record.thumbnail,
                    handle: record.handle
                }]
            })
        }
        await onChanged()
    })

    return (
        <div class="ym-search-tab">
            {playing && (
                <Player
                    video={playing}
                    channelName={playing.channelName || ""}
                    watched={!!watched[playing.id]}
                    settings={data.settings}
                    onToggleWatched={onToggleWatched}
                    onClose={() => setPlaying(null)}
                />
            )}

            <div class="ym-toolbar">
                <input
                    class="ym-search"
                    type="search"
                    placeholder="Search YouTube, or paste a video or channel URL"
                    value={input}
                    onInput={event => setInput(event.target.value)}
                    onKeyDown={event => event.key === "Enter" && submit()}
                />
                <button class="ym-btn ym-btn-primary" disabled={busy || !input.trim()} onClick={submit}>
                    {busy ? "Working..." : "Search"}
                </button>
                {channel && (
                    <button class="ym-btn" onClick={() => setChannel(null)}>Close channel</button>
                )}
            </div>

            {error && <pre class="ym-error">{error}</pre>}

            {channel && (
                <ChannelPage
                    key={channel.id}
                    channelId={channel.id}
                    seed={channel.seed}
                    data={data}
                    busy={busy}
                    run={run}
                    onPlay={play}
                    onToggleWatched={onToggleWatched}
                    onAddToPlaylist={onAddToPlaylist}
                    onOpenChannel={openChannel}
                    onSubscribe={toggleSubscribed}
                    onChanged={onChanged}
                />
            )}

            {results && (
                <>
                    {results.channels.map(result => (
                        <ChannelResult
                            key={result.id}
                            channel={result}
                            subscribed={!!subscribed[result.id]}
                            busy={busy}
                            onOpen={openChannel}
                            onSubscribe={toggleSubscribed}
                        />
                    ))}

                    {results.videos.length === 0 && results.channels.length === 0 && (
                        <div class="ym-empty"><p>Nothing found.</p></div>
                    )}

                    {results.videos.map(video => (
                        <VideoRow
                            key={video.id}
                            video={video}
                            channelName={video.channelName}
                            watched={!!watched[video.id]}
                            onPlay={play}
                            onToggleWatched={onToggleWatched}
                            onAddToPlaylist={onAddToPlaylist}
                        />
                    ))}
                </>
            )}

            {!results && !channel && !error && (
                <div class="ym-empty">
                    <p>Search YouTube without leaving Trilium.</p>
                    <p>Subscribe to a channel from its result, or paste a video URL to watch it here.</p>
                </div>
            )}
        </div>
    )
}

// --- subscriptions ----------------------------------------------------------

function SubscriptionsTab({ data, onChanged }) {
    const [input, setInput] = useState("")
    const [status, setStatus] = useState(null)
    const [busy, setBusy] = useState(false)

    const channels = useMemo(
        () => Object.values(data.channels).sort((a, b) => a.name.localeCompare(b.name)),
        [data.channels]
    )

    const videoCounts = useMemo(() => {
        const counts = {}
        for (const video of Object.values(data.videos)) {
            counts[video.channelId] = (counts[video.channelId] || 0) + 1
        }
        return counts
    }, [data.videos])

    // Each line is resolved separately so one bad entry reports itself instead
    // of failing the whole paste.
    const addChannels = async () => {
        const lines = input.split("\n").map(line => line.trim()).filter(Boolean)
        if (!lines.length) return

        setBusy(true)
        setStatus({ text: `Resolving ${lines.length} channel(s)...` })

        const resolved = []
        const failures = []
        for (const line of lines) {
            try {
                resolved.push(await yt.resolveChannel(line))
            } catch (error) {
                failures.push({ line, message: error.message })
            }
        }

        try {
            if (resolved.length) await yt.callBackend("addChannels", {}, { channels: resolved })
            // Only the lines that failed are left in the box, verbatim, so they
            // can be corrected without retyping the ones that worked.
            setInput(failures.map(failure => failure.line).join("\n"))
            setStatus({
                text: `Added ${resolved.length} channel(s).`,
                error: failures.length
                    ? failures.map(failure => `${failure.line}: ${failure.message}`).join("\n")
                    : null
            })
            if (resolved.length) await onChanged()
        } catch (error) {
            setStatus({ error: error.message })
        } finally {
            setBusy(false)
        }
    }

    // FreeTube exports carry the channel id directly, so the whole file is one
    // write with no per-channel lookup.
    const importFreeTube = async event => {
        const file = event.target.files?.[0]
        if (!file) return
        event.target.value = ""

        setBusy(true)
        setStatus({ text: `Reading ${file.name}...` })
        try {
            const parsed = yt.parseFreeTubeExport(await file.text())
            const result = await yt.callBackend("addChannels", {}, { channels: parsed })
            setStatus({ text: `Imported ${result.added} new channel(s), ${result.updated} already subscribed.` })
            await onChanged()
        } catch (error) {
            setStatus({ error: error.message })
        } finally {
            setBusy(false)
        }
    }

    const removeChannel = async channel => {
        if (!confirm(`Unsubscribe from ${channel.name}? Its cached videos are dropped; your watched history is kept.`)) return
        setBusy(true)
        try {
            await yt.callBackend("removeChannel", { channelId: channel.id })
            await onChanged()
        } catch (error) {
            setStatus({ error: error.message })
        } finally {
            setBusy(false)
        }
    }

    return (
        <div class="ym-subs">
            <div class="ym-add">
                <label class="ym-add-label">Add channels, one per line</label>
                <textarea
                    class="ym-add-input"
                    rows="3"
                    placeholder={"https://www.youtube.com/@LinusTechTips\n@veritasium\nUCXuqSBlHAE6Xw-yeJA0Tunw"}
                    value={input}
                    onInput={event => setInput(event.target.value)}
                />
                <div class="ym-add-actions">
                    <button class="ym-btn ym-btn-primary" disabled={busy || !input.trim()} onClick={addChannels}>
                        Add
                    </button>
                    <label class={`ym-btn ${busy ? "ym-btn-off" : ""}`}>
                        Import FreeTube (.db)
                        <input type="file" accept=".db,.json,.txt" disabled={busy}
                            onChange={importFreeTube} hidden />
                    </label>
                </div>
                {status?.text && <p class="ym-status">{status.text}</p>}
                {status?.error && <pre class="ym-error">{status.error}</pre>}
            </div>

            {channels.length === 0 && <div class="ym-empty"><p>No subscriptions yet.</p></div>}

            {channels.map(channel => (
                <div class="ym-channel" key={channel.id}>
                    {channel.thumbnail
                        ? <img class="ym-avatar" src={channel.thumbnail} alt="" loading="lazy" />
                        : <div class="ym-avatar ym-avatar-blank" />}
                    <div class="ym-channel-body">
                        <a class="ym-channel-name" href={`https://www.youtube.com/channel/${channel.id}`}
                            target="_blank" rel="noreferrer">{channel.name}</a>
                        <div class="ym-channel-meta">
                            <span>{videoCounts[channel.id] || 0} cached</span>
                            {channel.handle && <span>{channel.handle}</span>}
                        </div>
                    </div>
                    <button class="ym-btn ym-btn-danger" disabled={busy}
                        onClick={() => removeChannel(channel)}>Unsubscribe</button>
                </div>
            ))}
        </div>
    )
}

// --- root -------------------------------------------------------------------

export default function YouTubeManager() {
    const [data, setData] = useState(null)
    const [tab, setTab] = useState("feed")
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)
    const [settingsPageNoteId, setSettingsPageNoteId] = useState("")
    const [pickerVideo, setPickerVideo] = useState(null)
    const [playing, setPlaying] = useState(null)
    const [view, setViewState] = useState({
        filter: "unwatched",
        channel: "all",
        hideShorts: true,
        sortDesc: true
    })

    const reload = useCallback(async () => {
        const loaded = await yt.callBackend("load")
        setData(loaded)
        return loaded
    }, [])

    // View state is remembered in the settings note, so the feed opens the way
    // it was left. The search box deliberately is not: a text filter silently
    // hiding most of the feed on load reads as data loss.
    //
    // The next value is computed outside the state updater rather than inside
    // it, so persisting stays a plain effect of the call instead of a write
    // that fires again whenever the updater is re-run.
    const setView = updates => {
        const next = { ...view, ...updates }
        setViewState(next)
        yt.callBackend("saveView", {
            viewFilter: next.filter,
            viewChannel: next.channel,
            viewSortDesc: String(next.sortDesc),
            hideShorts: String(next.hideShorts)
        }).catch(() => {})
    }

    // Fetches every subscribed channel, then commits the whole result in one
    // write. A channel that fails is reported without losing the others.
    const refresh = useCallback(async loaded => {
        const source = loaded || data
        const channels = Object.values(source?.channels || {})
        if (!channels.length) return

        setBusy(true)
        const limit = source.settings.videosPerChannel || 15
        const videos = []
        const failures = []

        for (const channel of channels) {
            setStatus({ text: `Refreshing ${channel.name}...` })
            try {
                videos.push(...await yt.fetchChannelVideos(channel.id, limit))
            } catch (error) {
                failures.push(`${channel.name}: ${error.message}`)
            }
        }

        try {
            await yt.callBackend("mergeVideos", {}, { videos })
            await reload()
            setStatus(failures.length
                ? { text: `Refreshed ${channels.length - failures.length}/${channels.length} channels.`, error: failures.join("\n") }
                : null)
        } catch (error) {
            setStatus({ error: error.message })
        } finally {
            setBusy(false)
        }
    }, [data, reload])

    // First paint, then an automatic refresh only once the configured interval
    // has actually elapsed -- opening the note repeatedly must not hammer
    // YouTube from one address.
    useEffect(() => {
        (async () => {
            const loaded = await reload()
            setSettingsPageNoteId(await api.currentNote.getRelationValue("settingsPageNote") || "")

            // Seeded once from the persisted view, not re-synced on every
            // reload: load() hands back a fresh settings object each time, so
            // re-syncing would reset a filter the moment anything refreshed.
            setViewState(current => ({
                filter: loaded.settings.viewFilter || current.filter,
                channel: loaded.settings.viewChannel || current.channel,
                hideShorts: loaded.settings.hideShorts ?? current.hideShorts,
                sortDesc: loaded.settings.viewSortDesc ?? current.sortDesc
            }))

            const hours = Number(loaded.settings.refreshIntervalHours)
            if (!Number.isFinite(hours) || hours <= 0) return
            const last = Date.parse(loaded.lastRefresh)
            const due = !Number.isFinite(last) || Date.now() - last >= hours * 3600000
            if (due) refresh(loaded)
        })().catch(error => setStatus({ error: error.message }))
    }, [])

    // The video travels with the id because a watched entry keeps its own copy
    // of the details: the history has to read long after the video has dropped
    // out of the cache.
    const toggleWatched = useCallback(async (videoId, watched, video) => {
        // Applied locally first so a row responds immediately; the write is
        // small and a failure surfaces in the status line.
        setData(current => ({
            ...current,
            watched: watched
                ? {
                    ...current.watched,
                    [videoId]: {
                        watchedAt: new Date().toISOString(),
                        watchCount: (current.watched[videoId]?.watchCount || 0) + 1,
                        title: video?.title || "",
                        channelId: video?.channelId || "",
                        channelName: video?.channelName || "",
                        thumbnail: video?.thumbnail || "",
                        duration: video?.duration ?? null,
                        isShort: !!video?.isShort
                    }
                }
                : Object.fromEntries(Object.entries(current.watched).filter(([id]) => id !== videoId))
        }))
        try {
            await yt.callBackend("setWatched", { videoId, watched: String(watched) }, { video: video || null })
        } catch (error) {
            setStatus({ error: error.message })
            await reload()
        }
    }, [reload])

    const markAllWatched = useCallback(async videos => {
        if (!videos.length) return
        if (!confirm(`Mark ${videos.length} video(s) watched?`)) return
        setBusy(true)
        try {
            await yt.callBackend("setWatchedMany", {}, {
                videoIds: videos.map(video => video.id),
                videos,
                watched: true
            })
            await reload()
        } catch (error) {
            setStatus({ error: error.message })
        } finally {
            setBusy(false)
        }
    }, [reload])

    // Clearing the history is the only thing here that discards data the addon
    // cannot get back, so it asks twice as loudly as anything else.
    const clearHistory = useCallback(async () => {
        const count = Object.keys(data?.watched || {}).length
        if (!confirm(`Delete the whole watch history? ${count} entr(ies) go, and nothing can bring them back. Your subscriptions and playlists are kept.`)) return
        setBusy(true)
        try {
            await yt.callBackend("clearWatched")
            await reload()
        } catch (error) {
            setStatus({ error: error.message })
        } finally {
            setBusy(false)
        }
    }, [data, reload])

    // The picker is at the root because a "+" can be pressed from any tab, and
    // a panel per tab would be four copies of the same list.
    const addToPlaylist = useCallback(async (playlistId, video) => {
        setBusy(true)
        try {
            await yt.callBackend("editPlaylist", {}, { playlistId, op: "add", video })
            setPickerVideo(null)
            await reload()
        } catch (error) {
            setStatus({ error: error.message })
        } finally {
            setBusy(false)
        }
    }, [reload])

    const createAndAdd = useCallback(async (title, video) => {
        if (!title.trim()) return
        setBusy(true)
        try {
            const created = await yt.callBackend("savePlaylist", {}, { title })
            await yt.callBackend("editPlaylist", {}, { playlistId: created.id, op: "add", video })
            setPickerVideo(null)
            await reload()
        } catch (error) {
            setStatus({ error: error.message })
        } finally {
            setBusy(false)
        }
    }, [reload])

    // Playback for the tabs that have no list of their own to hang it off.
    // Feed and Search each open a video inside their own list; Playlists and
    // History are flat, so their player sits here.
    const playRoot = useCallback(video => {
        setPlaying(video)
        if (data?.settings.markWatchedOnPlay && !data.watched[video.id]) {
            toggleWatched(video.id, true, video)
        }
    }, [data, toggleWatched])

    const run = useCallback(async job => {
        setBusy(true)
        try {
            await job()
        } catch (error) {
            setStatus({ error: error.message })
        } finally {
            setBusy(false)
        }
    }, [])

    // Settings live on a render note; activating the code note would open its
    // source instead of the rendered form.
    const openSettings = () => activateNote(settingsPageNoteId)

    if (!data) return <div class="ym-view">Loading...</div>

    return (
        <div class="ym-view">
            <div class="ym-tabs">
                {[["feed", "Feed"], ["search", "Search"], ["playlists", "Playlists"],
                    ["history", "History"], ["subs", "Subscriptions"]].map(([key, label]) => (
                    <button key={key} class={`ym-tab ${tab === key ? "ym-tab-on" : ""}`}
                        onClick={() => setTab(key)}>{label}</button>
                ))}

                <span class="ym-refreshed">{formatRefreshed(data.lastRefresh)}</span>

                <button class="ym-tab" disabled={busy || !Object.keys(data.channels).length}
                    onClick={() => refresh()}>
                    {busy ? "Refreshing..." : "Refresh"}
                </button>
                <button class="ym-tab" disabled={!settingsPageNoteId} onClick={openSettings}>
                    Settings
                </button>
            </div>

            {status?.text && <p class="ym-status">{status.text}</p>}
            {status?.error && <pre class="ym-error">{status.error}</pre>}

            {playing && (tab === "playlists" || tab === "history") && (
                <Player
                    video={playing}
                    channelName={playing.channelName || ""}
                    watched={!!data.watched[playing.id]}
                    settings={data.settings}
                    onToggleWatched={toggleWatched}
                    onClose={() => setPlaying(null)}
                />
            )}

            {pickerVideo && (
                <AddToPlaylist
                    video={pickerVideo}
                    playlists={data.playlists}
                    busy={busy}
                    onAdd={playlistId => addToPlaylist(playlistId, pickerVideo)}
                    onCreate={title => createAndAdd(title, pickerVideo)}
                    onClose={() => setPickerVideo(null)}
                />
            )}

            {tab === "feed" && (
                <FeedTab
                    data={data}
                    view={view}
                    setView={setView}
                    busy={busy}
                    onToggleWatched={toggleWatched}
                    onMarkAllWatched={markAllWatched}
                    onAddToPlaylist={setPickerVideo}
                />
            )}
            {tab === "search" && (
                <SearchTab
                    data={data}
                    onToggleWatched={toggleWatched}
                    onAddToPlaylist={setPickerVideo}
                    onChanged={reload}
                />
            )}
            {tab === "playlists" && (
                <PlaylistsTab
                    data={data}
                    busy={busy}
                    run={run}
                    onPlay={playRoot}
                    onToggleWatched={toggleWatched}
                    onAddToPlaylist={setPickerVideo}
                    onChanged={reload}
                />
            )}
            {tab === "history" && (
                <HistoryTab
                    data={data}
                    busy={busy}
                    onPlay={playRoot}
                    onToggleWatched={toggleWatched}
                    onAddToPlaylist={setPickerVideo}
                    onClearHistory={clearHistory}
                />
            )}
            {tab === "subs" && <SubscriptionsTab data={data} onChanged={reload} />}
        </div>
    )
}
