/*
    The New Tab box, as a widget over the note being read rather than a page of its own.
    It stays hidden until the New Tab launcher toggles it, then covers the note's content
    with one box that either goes straight to an address or searches it with one of the
    configured providers. The result opens as a child of the note it was toggled over.
*/
import { defineWidget, useNoteContext, useState, useEffect, useRef, Button } from "trilium:preact"
import { currentNote } from "trilium:api"
import { loadSettings, resolveConfigNotes } from "libSettingsUI.jsx"

// The note a new tab is filed under: the one the box was toggled over, or the #inbox note
// when the split holds no note at all.
async function resolveParentNoteId(settings, noteId) {
    if (settings?.newTabParent === "specific" && settings.newTabParentNoteId) return settings.newTabParentNoteId
    if (noteId) return noteId
    return require("libWebPreview.js").resolveSaveParentNoteId("")
}

function NewTabBox({ noteId, onClose }) {
    const [settings, setSettings] = useState(null)
    const [providerId, setProviderId] = useState("")
    const [query, setQuery] = useState("")
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(false)
    // Web View notes already in the tree, and which of them the typed text is currently
    // matched against. `selected` is -1 while the box is set to open something new instead.
    const [notes, setNotes] = useState([])
    const [selected, setSelected] = useState(-1)
    const inputRef = useRef(null)

    useEffect(() => {
        (async () => {
            // `currentNote` must be read here — inside libsettings it resolves to the library's note.
            const { schemaNoteId, configNoteId } = await resolveConfigNotes(currentNote)
            if (!schemaNoteId || !configNoteId) return
            const values = await loadSettings(schemaNoteId, configNoteId)
            setSettings(values)
            setProviderId(values.defaultProvider || Object.keys(values.searchProviders || {})[0] || "")
        })()
    }, [])

    useEffect(() => { inputRef.current?.focus() }, [])

    useEffect(() => {
        require("libWebPreview.js").listWebViewNotes()
            .then(setNotes)
            .catch((err) => console.error("web-preview: could not list the existing Web View notes", err))
    }, [])

    const matches = require("libWebPreview.js").matchWebViewNotes(notes, query)

    async function openExisting(targetNoteId) {
        try {
            await api.activateNote(targetNoteId)
            onClose()
        } catch (err) {
            setError(`Could not open that note: ${err.message}`)
            console.error("web-preview: could not open an existing Web View note", err)
        }
    }

    // Enter opens whichever match the arrow keys are on; with none picked it falls through to
    // the form, which opens what was typed as a new page.
    function handleKeyDown(event) {
        if (event.key === "Escape") return onClose()
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            const step = event.key === "ArrowDown" ? 1 : -1
            setSelected((previous) => Math.min(matches.length - 1, Math.max(-1, previous + step)))
        }
    }

    async function handleSubmit(event) {
        event.preventDefault()
        if (busy || !query.trim()) return

        if (selected >= 0 && matches[selected]) return openExisting(matches[selected].noteId)

        const lib = require("libWebPreview.js")
        const providers = settings?.searchProviders || {}
        const target = lib.buildNewTabTarget(query, providers[providerId]?.urlTemplate)
        if (!target) {
            setError("That isn't an address and no search provider is configured — add one in this addon's settings.")
            return
        }

        setBusy(true)
        setError(null)
        try {
            const parentNoteId = await resolveParentNoteId(settings, noteId)
            const created = await lib.createWebViewNote(parentNoteId, target.url, target.title, settings?.reuseExistingNotes)
            await api.activateNote(created)
            onClose()
        } catch (err) {
            setBusy(false)
            setError(`Could not open it: ${err.message}`)
            console.error("web-preview: could not open a new tab", err)
        }
    }

    const providers = settings?.searchProviders || {}

    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "48px 16px" }}>
            <div style={{ fontSize: "13px", color: "#888" }}>Type an address, or search the web</div>
            <form onSubmit={handleSubmit} style={{ display: "flex", gap: "6px", width: "100%", maxWidth: "640px" }}>
                <select
                    title="Search provider"
                    value={providerId}
                    onChange={(event) => setProviderId(event.target.value)}
                    style={{ border: "1px solid #ddd", borderRadius: "6px", padding: "8px", background: "#eee", fontSize: "13px" }}
                >
                    {Object.entries(providers).map(([id, provider]) => (
                        <option key={id} value={id}>{provider.name}</option>
                    ))}
                </select>
                <input
                    ref={inputRef}
                    type="text"
                    placeholder="Search or enter address"
                    value={query}
                    onInput={(event) => { setQuery(event.target.value); setSelected(-1) }}
                    onKeyDown={handleKeyDown}
                    style={{ flex: 1, minWidth: 0, border: "1px solid #ddd", borderRadius: "6px", padding: "8px 12px", fontSize: "14px" }}
                />
                <Button kind="primary" icon="bx-right-arrow-alt" text={busy ? "Opening…" : "Go"} disabled={busy} />
                <Button icon="bx-x" text="Close" onClick={onClose} />
            </form>
            {matches.length > 0 && (
                <div style={{ width: "100%", maxWidth: "640px", display: "flex", flexDirection: "column", gap: "2px" }}>
                    <div style={{ fontSize: "11px", color: "#888" }}>Web View notes you already have</div>
                    {matches.map((match, index) => (
                        <button
                            key={match.noteId}
                            type="button"
                            onClick={() => openExisting(match.noteId)}
                            onMouseEnter={() => setSelected(index)}
                            style={{
                                display: "flex", gap: "8px", alignItems: "baseline", width: "100%", textAlign: "left",
                                border: "1px solid transparent", borderRadius: "6px", padding: "6px 10px", cursor: "pointer",
                                background: index === selected ? "#0000000f" : "transparent"
                            }}
                        >
                            <span style={{ fontSize: "13px" }}>{match.title}</span>
                            <span style={{ flex: 1, minWidth: 0, fontSize: "11px", color: "#888", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{match.url}</span>
                        </button>
                    ))}
                </div>
            )}
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
