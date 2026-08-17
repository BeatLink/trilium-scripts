import { useState, useEffect, useCallback, useMemo } from "trilium:preact"
import { activateNote } from "trilium:api"

/*
 * youtube-manager@beatlink -- the widget.
 *
 * Two tabs:
 *   Feed           every recent upload across your subscriptions, watched-aware
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

const FILTERS = [
    ["unwatched", "Unwatched"],
    ["watched", "Watched"],
    ["all", "All"]
]

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
function Player({ video, channelName, onClose, onToggleWatched, watched }) {
    const src = `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`

    return (
        <div class="ym-player">
            <div class="ym-player-frame">
                <iframe
                    src={src}
                    title={video.title}
                    frameborder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowfullscreen
                />
            </div>
            <div class="ym-player-bar">
                <div class="ym-player-meta">
                    <div class="ym-player-title">{video.title}</div>
                    <div class="ym-player-channel">{channelName}</div>
                </div>
                <button class="ym-btn" onClick={() => onToggleWatched(video.id, !watched)}>
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

function VideoRow({ video, channelName, watched, onPlay, onToggleWatched }) {
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
                    <span>{formatAge(video.publishedAt)}</span>
                    {video.views !== null && <span>{formatViews(video.views)}</span>}
                </div>
            </div>

            <button
                class={`ym-mark ${watched ? "ym-mark-on" : ""}`}
                title={watched ? "Mark unwatched" : "Mark watched"}
                onClick={() => onToggleWatched(video.id, !watched)}>
                {watched ? "Watched" : "Mark watched"}
            </button>
        </div>
    )
}

function FeedTab({ data, view, setView, onToggleWatched, onMarkAllWatched, busy }) {
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
        if (data.settings.markWatchedOnPlay && !watched[video.id]) onToggleWatched(video.id, true)
    }

    if (!Object.keys(channels).length) {
        return (
            <div class="ym-empty">
                <p>No subscriptions yet.</p>
                <p>Add a channel on the Subscriptions tab to start building a feed.</p>
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
                        onClick={() => onMarkAllWatched(visible.filter(v => !watched[v.id]).map(v => v.id))}>
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
                />
            ))}
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

    const toggleWatched = useCallback(async (videoId, watched) => {
        // Applied locally first so a row responds immediately; the write is
        // small and a failure surfaces in the status line.
        setData(current => ({
            ...current,
            watched: watched
                ? { ...current.watched, [videoId]: new Date().toISOString() }
                : Object.fromEntries(Object.entries(current.watched).filter(([id]) => id !== videoId))
        }))
        try {
            await yt.callBackend("setWatched", { videoId, watched: String(watched) })
        } catch (error) {
            setStatus({ error: error.message })
            await reload()
        }
    }, [reload])

    const markAllWatched = useCallback(async videoIds => {
        if (!videoIds.length) return
        if (!confirm(`Mark ${videoIds.length} video(s) watched?`)) return
        setBusy(true)
        try {
            await yt.callBackend("setWatchedMany", {}, { videoIds, watched: true })
            await reload()
        } catch (error) {
            setStatus({ error: error.message })
        } finally {
            setBusy(false)
        }
    }, [reload])

    // Settings live on a render note; activating the code note would open its
    // source instead of the rendered form.
    const openSettings = () => activateNote(settingsPageNoteId)

    if (!data) return <div class="ym-view">Loading...</div>

    return (
        <div class="ym-view">
            <div class="ym-tabs">
                {[["feed", "Feed"], ["subs", "Subscriptions"]].map(([key, label]) => (
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

            {tab === "feed" && (
                <FeedTab
                    data={data}
                    view={view}
                    setView={setView}
                    busy={busy}
                    onToggleWatched={toggleWatched}
                    onMarkAllWatched={markAllWatched}
                />
            )}
            {tab === "subs" && <SubscriptionsTab data={data} onChanged={reload} />}
        </div>
    )
}
