/*
    The New Tab box, as a widget over the note being read rather than a page of its own.
    It stays hidden until the New Tab launcher toggles it, then covers the note's content
    with one address bar: what is typed is offered as a page to visit or a search to run,
    alongside the Web View notes already in the tree whose title or URL matches it.
*/
import { defineWidget, useNoteContext, useState, useEffect, useRef, Button } from "trilium:preact"
import { currentNote } from "trilium:api"
import { loadSettings, resolveConfigNotes } from "libSettingsUI.jsx"

// How many notes the list offers, so a common word can't fill the whole pane with them.
const ROW_LIMIT = 6

// The note a new tab is filed under: the one the box was toggled over, or the #inbox note
// when the split holds no note at all.
async function resolveParentNoteId(settings, noteId) {
    if (settings?.newTabParent === "specific" && settings.newTabParentNoteId) return settings.newTabParentNoteId
    if (noteId) return noteId
    return require("libWebPreview.js").resolveSaveParentNoteId("")
}

// The bookmarks from the settings as rows, each either a page to open or a note to go to.
// A bookmarked note's own title is read so the row can show it, since the settings hold only
// its id. Bookmarks pointing nowhere yet are dropped rather than offered.
async function buildBookmarkRows(settings) {
    const entries = Object.entries(settings?.bookmarks || {})

    const rows = await Promise.all(entries.map(async ([id, bookmark]) => {
        const key = `bookmark:${id}`
        if (bookmark.target === "note") {
            const note = bookmark.noteId ? await api.getNote(bookmark.noteId) : null
            if (!note) return null
            const title = bookmark.name || note.title
            return { key, icon: "bx-bookmark", title, hint: title === note.title ? "Bookmark" : note.title, noteId: bookmark.noteId, match: `${title} ${note.title}` }
        }

        const url = (bookmark.url || "").trim()
        if (!url || url === "https://") return null
        const title = bookmark.name || url
        return { key, icon: "bx-bookmark", title, hint: url, target: { url, title }, match: `${title} ${url}` }
    }))

    return rows.filter(Boolean)
}

// The list under the box, in the order an address bar offers things: what Enter would do
// first, then the bookmarks and notes matching what is typed, then the other engines it could
// be searched with. With nothing typed yet, the bookmarks and the Web View notes last used.
function buildRows(query, settings, notes, bookmarks) {
    const lib = require("libWebPreview.js")
    const trimmed = query.trim()
    const noteRow = (note) => ({ key: `note:${note.noteId}`, icon: "bx-window-alt", title: note.title, hint: note.url, noteId: note.noteId })

    if (!trimmed) return [...bookmarks, ...notes.slice(0, ROW_LIMIT).map(noteRow)]

    const isDefault = (id) => id === settings?.defaultProvider
    const searches = Object.entries(settings?.searchProviders || {})
        .sort(([a], [b]) => (isDefault(b) ? 1 : 0) - (isDefault(a) ? 1 : 0))
        .map(([id, provider]) => ({
            key: `search:${id}`,
            icon: "bx-search",
            title: trimmed,
            hint: `Search with ${provider.name}`,
            target: lib.buildSearchTarget(trimmed, provider.urlTemplate)
        }))
        .filter((row) => row.target)

    // An address is what Enter takes; otherwise the default engine's search leads and the
    // rest of the engines stay available further down.
    const address = lib.parseAddress(trimmed)
    const first = address
        ? { key: "visit", icon: "bx-globe", title: address.url, hint: "Visit", target: address }
        : searches.shift()

    const needle = trimmed.toLowerCase()
    const marked = bookmarks.filter((row) => row.match.toLowerCase().includes(needle)).slice(0, ROW_LIMIT)

    return [first, ...marked, ...lib.matchWebViewNotes(notes, trimmed, ROW_LIMIT).map(noteRow), ...searches].filter(Boolean)
}

function NewTabBox({ noteId, onClose }) {
    const [settings, setSettings] = useState(null)
    const [query, setQuery] = useState("")
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(false)
    // Web View notes already in the tree, and which row of the list below the box is armed:
    // Enter runs that one, and it starts on the first, as an address bar's does.
    const [notes, setNotes] = useState([])
    const [bookmarks, setBookmarks] = useState([])
    const [selected, setSelected] = useState(0)
    const inputRef = useRef(null)

    useEffect(() => {
        (async () => {
            // `currentNote` must be read here — inside libsettings it resolves to the library's note.
            const { schemaNoteId, configNoteId } = await resolveConfigNotes(currentNote)
            if (!schemaNoteId || !configNoteId) return
            setSettings(await loadSettings(schemaNoteId, configNoteId))
        })()
    }, [])

    useEffect(() => {
        if (!settings) return
        buildBookmarkRows(settings)
            .then(setBookmarks)
            .catch((err) => console.error("web-preview: could not read the bookmarks", err))
    }, [settings])

    useEffect(() => { inputRef.current?.focus() }, [])

    useEffect(() => {
        require("libWebPreview.js").listWebViewNotes()
            .then(setNotes)
            .catch((err) => console.error("web-preview: could not list the existing Web View notes", err))
    }, [])

    const rows = buildRows(query, settings, notes, bookmarks)
    // The list shrinks as the query narrows it, so an index from a longer list is pulled back in.
    const armed = Math.min(selected, Math.max(0, rows.length - 1))

    async function run(row) {
        if (!row || busy) return

        setBusy(true)
        setError(null)
        try {
            if (row.noteId) {
                await api.activateNote(row.noteId)
            } else {
                const lib = require("libWebPreview.js")
                const parentNoteId = await resolveParentNoteId(settings, noteId)
                const created = await lib.createWebViewNote(parentNoteId, row.target.url, row.target.title, settings?.reuseExistingNotes)
                await api.activateNote(created)
            }
            onClose()
        } catch (err) {
            setBusy(false)
            setError(`Could not open it: ${err.message}`)
            console.error("web-preview: could not open a new tab", err)
        }
    }

    function handleKeyDown(event) {
        if (event.key === "Escape") return onClose()
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return

        // Wrapping, so holding one arrow key walks the whole list either way.
        event.preventDefault()
        const step = event.key === "ArrowDown" ? 1 : -1
        setSelected((rows.length + armed + step) % Math.max(1, rows.length))
    }

    function handleSubmit(event) {
        event.preventDefault()
        if (rows.length === 0) {
            setError("That isn't an address and no search provider is configured — add one in this addon's settings.")
            return
        }
        run(rows[armed])
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", padding: "48px 16px" }}>
            <form onSubmit={handleSubmit} style={{ display: "flex", gap: "6px", width: "100%", maxWidth: "640px" }}>
                <input
                    ref={inputRef}
                    type="text"
                    placeholder="Search or enter address"
                    value={query}
                    onInput={(event) => { setQuery(event.target.value); setSelected(0) }}
                    onKeyDown={handleKeyDown}
                    style={{ flex: 1, minWidth: 0, border: "1px solid #ddd", borderRadius: "6px", padding: "8px 12px", fontSize: "14px" }}
                />
                <Button icon="bx-x" text="Close" onClick={onClose} />
            </form>
            <div style={{ width: "100%", maxWidth: "640px", display: "flex", flexDirection: "column", gap: "2px" }}>
                {rows.map((row, index) => (
                    <button
                        key={row.key}
                        type="button"
                        disabled={busy}
                        onClick={() => run(row)}
                        onMouseEnter={() => setSelected(index)}
                        style={{
                            display: "flex", gap: "8px", alignItems: "baseline", width: "100%", textAlign: "left",
                            border: "none", borderRadius: "6px", padding: "6px 10px", cursor: "pointer",
                            background: index === armed ? "#0000000f" : "transparent"
                        }}
                    >
                        <span className={`bx ${row.icon}`} style={{ color: "#888" }} />
                        <span style={{ fontSize: "13px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.title}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: "11px", color: "#888", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.hint}</span>
                    </button>
                ))}
            </div>
            {error && <div style={{ color: "#a33", fontSize: "12px", maxWidth: "640px" }}>{error}</div>}
        </div>
    )
}

export default defineWidget({
    parent: "note-detail-pane",
    render() {
        const { note, noteContext } = useNoteContext()
        const [open, setOpen] = useState(false)
        const hostRef = useRef(null)

        // One widget is mounted per split, so only the split the user is looking at reacts to
        // the launcher. `noteContext` is read through a ref because the listener is bound once.
        const contextRef = useRef(null)
        contextRef.current = noteContext
        useEffect(() => {
            const toggle = () => {
                if (contextRef.current?.isActive()) setOpen((previous) => !previous)
            }
            window.addEventListener("web-preview:new-tab", toggle)
            return () => window.removeEventListener("web-preview:new-tab", toggle)
        }, [])

        // Navigating away — including to the note a new tab just created — puts the note back.
        useEffect(() => { setOpen(false) }, [note?.noteId])

        // Trilium gives the note-detail-pane no place of its own to draw over the note, so the
        // note's own content is hidden for as long as the box is up and restored afterwards.
        useEffect(() => {
            if (!open) return
            const content = hostRef.current?.closest(".note-split")?.querySelector(".scrolling-container")
            if (!content) return

            const previous = content.style.display
            content.style.display = "none"
            return () => { content.style.display = previous }
        }, [open])

        // The host snapshots this widget's DOM children exactly once, so the root element must
        // exist on the very first render — returning null leaves it permanently empty.
        return (
            <div className="web-preview-new-tab-host" ref={hostRef} style={open ? { flex: "1 1 auto" } : null}>
                {open && <NewTabBox noteId={note?.noteId} onClose={() => setOpen(false)} />}
            </div>
        )
    }
})
