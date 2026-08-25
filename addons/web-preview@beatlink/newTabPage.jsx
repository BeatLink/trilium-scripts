/*
    The page behind the New Tab launchbar button: one box that either goes straight
    to an address or searches it with one of the configured providers, then opens the
    result as a Web View note under whichever note the button was pressed from.
*/
import { useState, useEffect, useRef, Button } from "trilium:preact"
import { loadSettings, resolveConfigNotes } from "libSettingsUI.jsx"

// The note a new tab is filed under, defaulting to the one `newTabLauncher.js` recorded.
function resolveParentNoteId(settings) {
    if (settings?.newTabParent === "specific" && settings.newTabParentNoteId) return settings.newTabParentNoteId
    return window.webPreviewNewTab?.fromNoteId || "root"
}

export default function NewTabPage() {
    const [settings, setSettings] = useState(null)
    const [providerId, setProviderId] = useState("")
    const [query, setQuery] = useState("")
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(false)
    const inputRef = useRef(null)

    useEffect(() => {
        (async () => {
            // `api.currentNote` must be read here — inside libsettings it resolves to the library's note.
            const { schemaNoteId, configNoteId } = await resolveConfigNotes(api.currentNote)
            if (!schemaNoteId || !configNoteId) return
            const values = await loadSettings(schemaNoteId, configNoteId)
            setSettings(values)
            setProviderId(values.defaultProvider || Object.keys(values.searchProviders || {})[0] || "")
        })()
    }, [])

    // Pressing the launcher while already on this page re-activates the same note without
    // remounting, so the button announces itself and the box resets itself in response.
    useEffect(() => {
        const reset = () => {
            setQuery("")
            setError(null)
            inputRef.current?.focus()
        }
        reset()
        window.addEventListener("web-preview:new-tab", reset)
        return () => window.removeEventListener("web-preview:new-tab", reset)
    }, [])

    async function handleSubmit(event) {
        event.preventDefault()
        if (busy || !query.trim()) return

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
            const noteId = await lib.createWebViewNote(resolveParentNoteId(settings), target.url, target.title, settings?.reuseExistingNotes)
            await api.activateNote(noteId)
        } catch (err) {
            setBusy(false)
            setError(`Could not open it: ${err.message}`)
            console.error("web-preview: could not open a new tab", err)
        }
        // On success the widget is unmounted by the navigation away, so `busy` stays set.
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
                    onInput={(event) => setQuery(event.target.value)}
                    style={{ flex: 1, minWidth: 0, border: "1px solid #ddd", borderRadius: "6px", padding: "8px 12px", fontSize: "14px" }}
                />
                <Button kind="primary" icon="bx-right-arrow-alt" text={busy ? "Opening…" : "Go"} disabled={busy} />
            </form>
            {error && <div style={{ color: "#a33", fontSize: "12px", maxWidth: "640px" }}>{error}</div>}
        </div>
    )
}
