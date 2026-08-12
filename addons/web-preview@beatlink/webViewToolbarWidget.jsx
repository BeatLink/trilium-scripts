/*
    Shows a small toolbar (Back / Forward / Save to Inbox / Open in Browser /
    Delete Note) above any note of type "Web View". Drives the *actual* Electron <webview>
    element that Trilium's built-in Web View note type already renders —
    no separate popup window needed.
*/
import { defineWidget, useActiveNoteContext, useNoteProperty, useState, useEffect } from "trilium:preact"

// Extension point. Another addon (blockurl@beatlink) pushes a preact component into `extras` to
// have its control rendered as part of this toolbar rather than stacking a second toolbar row
// above the page; `host` tells it this toolbar is installed and will do that. Whichever widget's
// module loads first creates the object, so neither depends on the other's load order.
const toolbar = (window.webViewToolbar ||= { extras: [] })
toolbar.host = true

// Locates the Electron <webview> Trilium renders for a Web View note. Browser
// Trilium renders an <iframe> instead, so this returns null there.
function getWebviewEl() {
    const candidates = Array.from(document.querySelectorAll("webview.note-detail-web-view-content"))
    return candidates.find((w) => w.offsetParent !== null) || candidates[0] || null
}

function WebViewToolbar({ noteId }) {
    const [state, setState] = useState({ found: false, canGoBack: false, canGoForward: false, url: "" })
    const [saveStatus, setSaveStatus] = useState(null)
    const [deleting, setDeleting] = useState(false)

    useEffect(() => {
        let wv = null
        let onRefresh = null
        let attempts = 0

        // Trilium mounts the <webview> after this widget re-renders for the new note.
        const poll = setInterval(() => {
            const found = getWebviewEl()
            if (!found) {
                if (++attempts > 30) clearInterval(poll)
                return
            }
            clearInterval(poll)
            wv = found
            onRefresh = () => setState({ found: true, canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward(), url: wv.getURL() })
            wv.addEventListener("did-navigate", onRefresh)
            wv.addEventListener("did-navigate-in-page", onRefresh)
            wv.addEventListener("dom-ready", onRefresh)
            onRefresh()
        }, 100)

        return () => {
            clearInterval(poll)
            if (wv && onRefresh) {
                wv.removeEventListener("did-navigate", onRefresh)
                wv.removeEventListener("did-navigate-in-page", onRefresh)
                wv.removeEventListener("dom-ready", onRefresh)
            }
            setState({ found: false, canGoBack: false, canGoForward: false, url: "" })
        }
    }, [noteId])

    function handleBack() {
        const wv = getWebviewEl()
        if (wv?.canGoBack()) wv.goBack()
    }

    function handleForward() {
        const wv = getWebviewEl()
        if (wv?.canGoForward()) wv.goForward()
    }

    async function handleSave() {
        const wv = getWebviewEl()
        if (!wv) return
        const url = wv.getURL()
        const title = wv.getTitle() || url

        setSaveStatus("saving")
        try {
            const lib = require("libWebPreview.js")
            await lib.saveUrlToInbox(url, title)
            setSaveStatus("saved")
        } catch (err) {
            setSaveStatus("failed")
            console.error(err)
        } finally {
            setTimeout(() => setSaveStatus(null), 1500)
        }
    }

    function handleExternal() {
        const wv = getWebviewEl()
        if (!wv) return
        const lib = require("libWebPreview.js")
        lib.openExternal(wv.getURL())
    }

    async function handleDelete() {
        const lib = require("libWebPreview.js")
        if (!await api.showConfirmDialog("Delete this Web View note?")) return

        setDeleting(true)
        try {
            await lib.deleteWebViewNote(noteId)
        } catch (err) {
            setDeleting(false)
            console.error("web-preview: could not delete the note", err)
        }
        // On success the widget is unmounted by the navigation away, so `deleting` stays set.
    }

    // No <webview> means browser Trilium (an <iframe>), where none of these controls apply.
    if (!state.found) return null

    const saveLabel = saveStatus === "saving" ? "Saving…"
        : saveStatus === "saved" ? "Saved ✓"
        : saveStatus === "failed" ? "Save failed"
        : "Save to Inbox"

    return (
        <div
            className="web-view-toolbar"
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px", borderBottom: "1px solid #ddd", contain: "none" }}
        >
            <button
                title="Back"
                disabled={!state.canGoBack}
                style={{ border: "none", borderRadius: "6px", padding: "6px 10px", cursor: "pointer", background: "#eee" }}
                onClick={handleBack}
            >◀</button>
            <button
                title="Forward"
                disabled={!state.canGoForward}
                style={{ border: "none", borderRadius: "6px", padding: "6px 10px", cursor: "pointer", background: "#eee" }}
                onClick={handleForward}
            >▶</button>
            <div style={{ flex: 1, minWidth: 0, fontSize: "11px", color: "#888", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {state.url}
            </div>
            <button
                disabled={saveStatus === "saving"}
                style={{ border: "none", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", background: "#4b6fff", color: "white", fontSize: "12px" }}
                onClick={handleSave}
            >{saveLabel}</button>
            <button
                style={{ border: "none", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", background: "#eee", fontSize: "12px" }}
                onClick={handleExternal}
            >Open in Browser</button>
            <button
                title="Delete this Web View note"
                disabled={deleting}
                style={{ border: "none", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", background: "#eee", color: "#a33", fontSize: "12px" }}
                onClick={handleDelete}
            >{deleting ? "Deleting…" : "Delete Note"}</button>
            {toolbar.extras.map((Extra, index) => <Extra key={index} noteId={noteId} />)}
        </div>
    )
}

export default defineWidget({
    parent: "center-pane",
    position: -10, // before the note content, which the layout adds at position 0
    render() {
        const { note } = useActiveNoteContext()
        const noteId = useNoteProperty(note, "noteId")
        const noteType = useNoteProperty(note, "type")

        // The host snapshots this widget's DOM children exactly once, so the root element
        // must exist on the very first render — returning null leaves it permanently empty.
        return (
            <div className="web-view-toolbar-host">
                {noteType === "webView" && <WebViewToolbar noteId={noteId} />}
            </div>
        )
    }
})
