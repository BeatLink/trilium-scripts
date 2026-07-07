/*
    Shows a small toolbar (Back / Forward / Save to Inbox / Open in Browser)
    above any note of type "Web View". Drives the *actual* Electron <webview>
    element that Trilium's built-in Web View note type already renders —
    no separate popup window needed.
*/
import { defineWidget, useActiveNoteContext, useNoteProperty, useState, useEffect } from "trilium:preact"

// Locates the Electron <webview> element Trilium renders for the given note.
// Selector specifics can vary across Trilium versions — adjust if this
// doesn't find it in yours (see README "Known caveats").
function getWebviewEl(noteId) {
    let el = document.querySelector(
        `[data-note-id="${noteId}"] webview, .note-detail-web-view[data-note-id="${noteId}"] webview`
    )
    if (!el) {
        // Fallback: grab the first visible webview on the page.
        const candidates = Array.from(document.querySelectorAll("webview"))
        el = candidates.find((w) => w.offsetParent !== null) || candidates[0]
    }
    return el || null
}

function WebViewToolbar({ noteId }) {
    const [state, setState] = useState({ canGoBack: false, canGoForward: false, url: "" })
    const [saveStatus, setSaveStatus] = useState(null)

    useEffect(() => {
        let cancelled = false

        function refresh(wv) {
            if (cancelled) return
            setState({ canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward(), url: wv.getURL() })
        }

        // Webview element may not exist yet the instant the note switches in;
        // a short delay lets Trilium finish rendering it.
        const timer = setTimeout(() => {
            const wv = getWebviewEl(noteId)
            if (!wv || wv.__wvToolbarBound) return
            wv.__wvToolbarBound = true

            const onRefresh = () => refresh(wv)
            wv.addEventListener("did-navigate", onRefresh)
            wv.addEventListener("did-navigate-in-page", onRefresh)
            wv.addEventListener("dom-ready", onRefresh)
            onRefresh()
        }, 150)

        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [noteId])

    async function handleBack() {
        const wv = getWebviewEl(noteId)
        if (wv?.canGoBack()) wv.goBack()
    }

    async function handleForward() {
        const wv = getWebviewEl(noteId)
        if (wv?.canGoForward()) wv.goForward()
    }

    async function handleSave() {
        const wv = getWebviewEl(noteId)
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

    async function handleExternal() {
        const wv = getWebviewEl(noteId)
        if (!wv) return
        const lib = require("libWebPreview.js")
        await lib.openExternal(wv.getURL())
    }

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
        </div>
    )
}

export default defineWidget({
    parent: "center-pane",
    position: 90, // above the note content area
    render() {
        const { note } = useActiveNoteContext()
        const noteId = useNoteProperty(note, "noteId")
        const noteType = useNoteProperty(note, "type")

        if (noteType !== "webView") return null

        return <WebViewToolbar noteId={noteId} />
    }
})
