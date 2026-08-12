import { useState, useEffect, useCallback, useMemo } from "trilium:preact"
import { activateNote } from "trilium:api"

/*
 * rss-reader@beatlink -- the widget.
 *
 * Two tabs:
 *   Articles  everything across every feed, read/starred-aware
 *   Feeds     the feed list, plus subscribing and unsubscribing
 *
 * The whole library lives in one JSON note. The backend owns every read and
 * write of it, so this widget never parses or writes that document directly.
 *
 * Refreshing is a foreground job: parsing a feed needs the browser's XML
 * parser, so there is no scheduled background sync. The reader updates when
 * this widget is open, either automatically once the refresh interval has
 * elapsed or on demand.
 */

const rss = require("libRss.js")

const FILTERS = [
    ["unread", "Unread"],
    ["starred", "Starred"],
    ["read", "Read"],
    ["all", "All"]
]

// --- formatting -------------------------------------------------------------

function formatAge(iso) {
    const then = Date.parse(iso)
    if (!Number.isFinite(then)) return ""
    const minutes = Math.floor((Date.now() - then) / 60000)
    if (minutes < 1) return "just now"
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days === 1) return "yesterday"
    if (days < 30) return `${days} days ago`
    if (days < 365) return `${Math.floor(days / 30)} months ago`
    return `${Math.floor(days / 365)} years ago`
}

function formatRefreshed(iso) {
    if (!iso) return "never refreshed"
    const age = formatAge(iso)
    return age ? `refreshed ${age}` : "never refreshed"
}

// A feed's own summary is often the whole article, so the list preview is built
// from the text of the body rather than from a separate summary field.
function previewOf(html) {
    const text = new DOMParser().parseFromString(String(html || ""), "text/html").body.textContent || ""
    return text.replace(/\s+/g, " ").trim().slice(0, 240)
}

function folderOf(feed) {
    return feed?.folder || "Uncategorized"
}

// --- reader -----------------------------------------------------------------

function Reader({ article, feed, read, starred, onClose, onToggle }) {
    const content = useMemo(
        () => rss.sanitizeHtml(article.content, article.url || feed?.siteUrl || ""),
        [article.id, article.content]
    )

    return (
        <div class="rss-reader">
            <div class="rss-reader-bar">
                <div class="rss-reader-meta">
                    <div class="rss-reader-title">{article.title}</div>
                    <div class="rss-reader-sub">
                        <span>{feed?.title || ""}</span>
                        {article.author && <span>{article.author}</span>}
                        <span>{formatAge(article.publishedAt)}</span>
                    </div>
                </div>
                <button class="rss-btn" onClick={() => onToggle(article.id, "starred", !starred)}>
                    {starred ? "Unstar" : "Star"}
                </button>
                <button class="rss-btn" onClick={() => onToggle(article.id, "read", !read)}>
                    {read ? "Mark unread" : "Mark read"}
                </button>
                {article.url && (
                    <a class="rss-btn" href={article.url} target="_blank" rel="noreferrer noopener">Open original</a>
                )}
                <button class="rss-btn" onClick={onClose}>Close</button>
            </div>
            <div class="rss-reader-body" dangerouslySetInnerHTML={{ __html: content }} />
        </div>
    )
}

// --- articles ---------------------------------------------------------------

function ArticleRow({ article, feedTitle, read, starred, onOpen, onToggle }) {
    // Parsing an article body is not free and the list re-renders on every
    // toggle, so the preview is built once per article rather than per render.
    const preview = useMemo(() => previewOf(article.content), [article.id])

    return (
        <div class={`rss-row ${read ? "rss-row-read" : ""}`}>
            <button
                class={`rss-star ${starred ? "rss-star-on" : ""}`}
                title={starred ? "Unstar" : "Star"}
                onClick={() => onToggle(article.id, "starred", !starred)}>
                {starred ? "★" : "☆"}
            </button>

            <div class="rss-row-body">
                <button class="rss-row-title" onClick={() => onOpen(article)}>{article.title}</button>
                <div class="rss-row-meta">
                    <span class="rss-row-feed">{feedTitle}</span>
                    <span>{formatAge(article.publishedAt)}</span>
                    {article.author && <span>{article.author}</span>}
                </div>
                <div class="rss-row-preview">{preview}</div>
            </div>

            <button
                class={`rss-mark ${read ? "rss-mark-on" : ""}`}
                title={read ? "Mark unread" : "Mark read"}
                onClick={() => onToggle(article.id, "read", !read)}>
                {read ? "Read" : "Mark read"}
            </button>
        </div>
    )
}

function ArticlesTab({ data, view, setView, onToggle, onMarkAllRead, busy }) {
    const [open, setOpen] = useState(null)
    const [search, setSearch] = useState("")

    const { feeds, read, starred } = data

    // Filters compose, and each is applied to the same base list so no single
    // choice silently empties the others.
    const visible = useMemo(() => {
        const term = search.trim().toLowerCase()
        const rows = Object.values(data.articles).filter(article => {
            if (view.feed !== "all" && article.feedId !== view.feed) return false
            if (view.filter === "unread" && read[article.id]) return false
            if (view.filter === "read" && !read[article.id]) return false
            if (view.filter === "starred" && !starred[article.id]) return false
            if (term && !article.title.toLowerCase().includes(term)) return false
            return true
        })
        rows.sort((a, b) => {
            const diff = Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
            return view.sortDesc ? diff : -diff
        })
        return rows
    }, [data.articles, read, starred, view, search])

    // Scoped by everything except the read filter itself, so it still reports a
    // useful number while looking at the Read list rather than showing 0.
    const unreadCount = useMemo(
        () => Object.values(data.articles).filter(article => {
            if (read[article.id]) return false
            if (view.feed !== "all" && article.feedId !== view.feed) return false
            return true
        }).length,
        [data.articles, read, view.feed]
    )

    // Feeds are grouped by folder in the picker, which is the only place the
    // folders FreshRSS keeps actually show up in this view.
    const folders = useMemo(() => {
        const grouped = {}
        for (const feed of Object.values(feeds)) (grouped[folderOf(feed)] ||= []).push(feed)
        for (const list of Object.values(grouped)) list.sort((a, b) => a.title.localeCompare(b.title))
        return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))
    }, [feeds])

    // Opening an article is the strongest signal there is that it was read, so
    // this is on by default, unlike the equivalent for a video.
    const openArticle = article => {
        setOpen(article)
        if (data.settings.markReadOnOpen && !read[article.id]) onToggle(article.id, "read", true)
    }

    if (!Object.keys(feeds).length) {
        return (
            <div class="rss-empty">
                <p>No feeds yet.</p>
                <p>Add one on the Feeds tab, or point the addon at a FreshRSS server in Settings.</p>
            </div>
        )
    }

    return (
        <div class="rss-articles">
            {open && (
                <Reader
                    article={data.articles[open.id] || open}
                    feed={feeds[open.feedId]}
                    read={!!read[open.id]}
                    starred={!!starred[open.id]}
                    onToggle={onToggle}
                    onClose={() => setOpen(null)}
                />
            )}

            <div class="rss-toolbar">
                <input
                    class="rss-search"
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

                <select value={view.feed} onChange={event => setView({ feed: event.target.value })}>
                    <option value="all">All feeds</option>
                    {folders.map(([folder, list]) => (
                        <optgroup key={folder} label={folder}>
                            {list.map(feed => (
                                <option key={feed.id} value={feed.id}>{feed.title}</option>
                            ))}
                        </optgroup>
                    ))}
                </select>

                <button class="rss-btn" title="Flip sort direction"
                    onClick={() => setView({ sortDesc: !view.sortDesc })}>
                    {view.sortDesc ? "Newest first" : "Oldest first"}
                </button>
            </div>

            <div class="rss-summary">
                <span>{visible.length} shown, {unreadCount} unread</span>
                {view.filter !== "read" && visible.some(article => !read[article.id]) && (
                    <button class="rss-btn" disabled={busy}
                        onClick={() => onMarkAllRead(visible.filter(a => !read[a.id]).map(a => a.id))}>
                        Mark these read
                    </button>
                )}
            </div>

            {visible.length === 0 && <div class="rss-empty"><p>Nothing matches these filters.</p></div>}

            {visible.map(article => (
                <ArticleRow
                    key={article.id}
                    article={article}
                    feedTitle={feeds[article.feedId]?.title || ""}
                    read={!!read[article.id]}
                    starred={!!starred[article.id]}
                    onOpen={openArticle}
                    onToggle={onToggle}
                />
            ))}
        </div>
    )
}

// --- feeds ------------------------------------------------------------------

function FeedsTab({ data, onChanged }) {
    const [input, setInput] = useState("")
    const [folder, setFolder] = useState("")
    const [status, setStatus] = useState(null)
    const [busy, setBusy] = useState(false)

    const feeds = useMemo(
        () => Object.values(data.feeds).sort((a, b) =>
            folderOf(a).localeCompare(folderOf(b)) || a.title.localeCompare(b.title)),
        [data.feeds]
    )

    const unreadCounts = useMemo(() => {
        const counts = {}
        for (const article of Object.values(data.articles)) {
            if (data.read[article.id]) continue
            counts[article.feedId] = (counts[article.feedId] || 0) + 1
        }
        return counts
    }, [data.articles, data.read])

    const remote = data.settings.freshrssEnabled && !!String(data.settings.freshrssUrl || "").trim()

    const add = async () => {
        const urls = input.split("\n").map(line => line.trim()).filter(Boolean)
        if (!urls.length) return

        setBusy(true)
        setStatus({ text: `Subscribing to ${urls.length} feed(s)...` })
        try {
            const result = await rss.addFeeds(urls, folder.trim(), data.settings)
            // Only the lines that failed are left in the box, verbatim, so they
            // can be corrected without retyping the ones that worked.
            setInput(result.failures.map(failure => failure.url).join("\n"))
            setStatus({
                text: `Subscribed to ${result.added} feed(s).${remote ? " Refresh to pull their articles." : ""}`,
                error: result.failures.length
                    ? result.failures.map(failure => `${failure.url}: ${failure.message}`).join("\n")
                    : null
            })
            if (result.added) await onChanged()
        } catch (error) {
            setStatus({ error: error.message })
        } finally {
            setBusy(false)
        }
    }

    const remove = async feed => {
        const where = feed.source === "freshrss" ? " from FreshRSS" : ""
        if (!confirm(`Unsubscribe from ${feed.title}${where}? Its cached articles are dropped; your read history is kept.`)) return
        setBusy(true)
        try {
            await rss.removeFeed(feed, data.settings)
            await onChanged()
        } catch (error) {
            setStatus({ error: error.message })
        } finally {
            setBusy(false)
        }
    }

    const move = async (feed, value) => {
        if (value === (feed.folder || "")) return
        setBusy(true)
        try {
            await rss.setFeedFolder(feed, value, data.settings)
            await onChanged()
        } catch (error) {
            setStatus({ error: error.message })
        } finally {
            setBusy(false)
        }
    }

    return (
        <div class="rss-feeds">
            <div class="rss-add">
                <label class="rss-add-label">Add feeds, one URL per line</label>
                <textarea
                    class="rss-add-input"
                    rows="3"
                    placeholder={"https://example.com/feed.xml\nhttps://example.org/atom"}
                    value={input}
                    onInput={event => setInput(event.target.value)}
                />
                <div class="rss-add-actions">
                    <input
                        class="rss-folder-input"
                        type="text"
                        placeholder="Folder (optional)"
                        value={folder}
                        onInput={event => setFolder(event.target.value)}
                    />
                    <button class="rss-btn rss-btn-primary" disabled={busy || !input.trim()} onClick={add}>
                        {remote ? "Subscribe in FreshRSS" : "Add"}
                    </button>
                </div>
                {status?.text && <p class="rss-status">{status.text}</p>}
                {status?.error && <pre class="rss-error">{status.error}</pre>}
            </div>

            {feeds.length === 0 && <div class="rss-empty"><p>No feeds yet.</p></div>}

            {feeds.map(feed => (
                <div class="rss-feed" key={feed.id}>
                    {feed.icon
                        ? <img class="rss-favicon" src={feed.icon} alt="" loading="lazy" />
                        : <div class="rss-favicon rss-favicon-blank" />}
                    <div class="rss-feed-body">
                        <a class="rss-feed-title" href={feed.siteUrl || feed.url}
                            target="_blank" rel="noreferrer noopener">{feed.title}</a>
                        <div class="rss-feed-meta">
                            <span>{unreadCounts[feed.id] || 0} unread</span>
                            <span class="rss-tag">{feed.source === "freshrss" ? "FreshRSS" : "local"}</span>
                            <input
                                class="rss-folder-input"
                                type="text"
                                value={feed.folder || ""}
                                placeholder="Folder"
                                disabled={busy}
                                onBlur={event => move(feed, event.target.value.trim())}
                            />
                        </div>
                        {feed.lastError && <div class="rss-feed-error">{feed.lastError}</div>}
                    </div>
                    <button class="rss-btn rss-btn-danger" disabled={busy}
                        onClick={() => remove(feed)}>Unsubscribe</button>
                </div>
            ))}
        </div>
    )
}

// --- root -------------------------------------------------------------------

export default function RssReader() {
    const [data, setData] = useState(null)
    const [tab, setTab] = useState("articles")
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)
    const [settingsPageNoteId, setSettingsPageNoteId] = useState("")
    const [view, setViewState] = useState({ filter: "unread", feed: "all", sortDesc: true })

    const reload = useCallback(async () => {
        const loaded = await rss.callBackend("load")
        setData(loaded)
        return loaded
    }, [])

    // View state is remembered in the settings note, so the list opens the way
    // it was left. The search box deliberately is not: a text filter silently
    // hiding most of the list on load reads as data loss.
    const setView = updates => {
        const next = { ...view, ...updates }
        setViewState(next)
        rss.callBackend("saveView", {
            viewFilter: next.filter,
            viewFeed: next.feed,
            viewSortDesc: String(next.sortDesc)
        }).catch(() => {})
    }

    const refresh = useCallback(async loaded => {
        const source = loaded || data
        if (!source) return

        setBusy(true)
        try {
            const summary = await rss.refresh(source, text => setStatus({ text }))
            await reload()
            const truncated = summary.truncated
                ? " FreshRSS has more unread or starred articles than one sync lists, so that state was left alone this time."
                : ""
            setStatus(summary.failures.length
                ? { text: `Refreshed with ${summary.failures.length} problem(s).${truncated}`, error: summary.failures.join("\n") }
                : (truncated ? { text: truncated.trim() } : null))
        } catch (error) {
            setStatus({ error: error.message })
        } finally {
            setBusy(false)
        }
    }, [data, reload])

    // First paint, then an automatic refresh only once the configured interval
    // has actually elapsed -- reopening the note repeatedly must not re-fetch
    // every feed from one address.
    useEffect(() => {
        (async () => {
            const loaded = await reload()
            setSettingsPageNoteId(await api.currentNote.getRelationValue("settingsPageNote") || "")

            // Seeded once from the persisted view, not re-synced on every
            // reload: load() hands back a fresh settings object each time, so
            // re-syncing would reset a filter the moment anything refreshed.
            setViewState(current => ({
                filter: loaded.settings.viewFilter || current.filter,
                feed: loaded.settings.viewFeed || current.feed,
                sortDesc: loaded.settings.viewSortDesc ?? current.sortDesc
            }))

            const hours = Number(loaded.settings.refreshIntervalHours)
            if (!Number.isFinite(hours) || hours <= 0) return
            const last = Date.parse(loaded.lastRefresh)
            const due = !Number.isFinite(last) || Date.now() - last >= hours * 3600000
            if (due) refresh(loaded)
        })().catch(error => setStatus({ error: error.message }))
    }, [])

    // Applied locally first so a row responds immediately. The backend queues
    // the change for FreshRSS as it writes it, so a failed push is retried on
    // the next sync rather than lost.
    const toggle = useCallback(async (articleId, field, value) => {
        setData(current => {
            const map = { ...current[field] }
            if (value) map[articleId] = new Date().toISOString()
            else delete map[articleId]
            return { ...current, [field]: map }
        })

        try {
            await rss.callBackend("setState", { articleId, field, value: String(value) })
        } catch (error) {
            setStatus({ error: error.message })
            await reload()
            return
        }

        const article = data?.articles[articleId]
        if (data?.feeds[article?.feedId]?.source !== "freshrss") return
        rss.pushState(data.settings, articleId, field, value).catch(() => {})
    }, [data, reload])

    const markAllRead = useCallback(async articleIds => {
        if (!articleIds.length) return
        if (!confirm(`Mark ${articleIds.length} article(s) read?`)) return
        setBusy(true)
        try {
            await rss.callBackend("setStateMany", {}, { articleIds, field: "read", value: true })
            const loaded = await reload()
            await rss.pushQueued(loaded.settings, loaded.pending)
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

    if (!data) return <div class="rss-view">Loading...</div>

    return (
        <div class="rss-view">
            <div class="rss-tabs">
                {[["articles", "Articles"], ["feeds", "Feeds"]].map(([key, label]) => (
                    <button key={key} class={`rss-tab ${tab === key ? "rss-tab-on" : ""}`}
                        onClick={() => setTab(key)}>{label}</button>
                ))}

                <span class="rss-refreshed">{formatRefreshed(data.lastRefresh)}</span>

                <button class="rss-tab" disabled={busy} onClick={() => refresh()}>
                    {busy ? "Refreshing..." : "Refresh"}
                </button>
                <button class="rss-tab" disabled={!settingsPageNoteId} onClick={openSettings}>
                    Settings
                </button>
            </div>

            {status?.text && <p class="rss-status">{status.text}</p>}
            {status?.error && <pre class="rss-error">{status.error}</pre>}

            {tab === "articles" && (
                <ArticlesTab
                    data={data}
                    view={view}
                    setView={setView}
                    busy={busy}
                    onToggle={toggle}
                    onMarkAllRead={markAllRead}
                />
            )}
            {tab === "feeds" && <FeedsTab data={data} onChanged={reload} />}
        </div>
    )
}
