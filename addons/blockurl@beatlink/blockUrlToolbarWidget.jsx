/*
    Adds a Block / Unblock button above any note of type "Web View", the
    equivalent of the BlockURL extension's toolbar button: it toggles the page
    currently loaded in the Electron <webview> on the sync server's block list,
    then reloads so blockUrl.js applies the change immediately.
*/
import { defineWidget, useActiveNoteContext, useNoteProperty, useState, useEffect } from "trilium:preact"
import { currentNote } from "trilium:api"

// Locates the Electron <webview> Trilium renders for a Web View note. Browser
// Trilium renders an <iframe> instead, so this returns null there.
function getWebviewEl() {
    const candidates = Array.from(document.querySelectorAll("webview.note-detail-web-view-content"))
    return candidates.find((w) => w.offsetParent !== null) || candidates[0] || null
}

function BlockUrlToolbar({ noteId }) {
    const [state, setState] = useState({ found: false, url: "" })
    const [blocked, setBlocked] = useState(null)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        let wv = null
        let onRefresh = null
        let attempts = 0
        let cancelled = false

        async function refreshBlockedState(url) {
            const { normalizeUrl, checkUrls } = require("libBlockUrl.js")
            const normalized = normalizeUrl(url)
            try {
                const result = await checkUrls(currentNote, [normalized])
                if (!cancelled) setBlocked(!!result[normalized])
            } catch (err) {
                if (!cancelled) setBlocked(null)
                console.warn("blockurl: could not read the block state of this page", err)
            }
        }

        // Trilium mounts the <webview> after this widget re-renders for the new note.
        const poll = setInterval(() => {
            const found = getWebviewEl()
            if (!found) {
                if (++attempts > 30) clearInterval(poll)
                return
            }
            clearInterval(poll)
            wv = found
            onRefresh = () => {
                const url = wv.getURL()
                setState({ found: true, url })
                if (url.startsWith("http")) refreshBlockedState(url)
            }
            wv.addEventListener("did-navigate", onRefresh)
            wv.addEventListener("did-navigate-in-page", onRefresh)
            wv.addEventListener("dom-ready", onRefresh)
            onRefresh()
        }, 100)

        return () => {
            cancelled = true
            clearInterval(poll)
            if (wv && onRefresh) {
                wv.removeEventListener("did-navigate", onRefresh)
                wv.removeEventListener("did-navigate-in-page", onRefresh)
                wv.removeEventListener("dom-ready", onRefresh)
            }
            setState({ found: false, url: "" })
            setBlocked(null)
        }
    }, [noteId])

    async function handleToggle() {
        const wv = getWebviewEl()
        if (!wv) return

        const { blockUrls, unblockUrls } = require("libBlockUrl.js")
        setBusy(true)
        try {
            if (blocked) {
                await unblockUrls(currentNote, [wv.getURL()])
                setBlocked(false)
            } else {
                await blockUrls(currentNote, [wv.getURL()])
                setBlocked(true)
            }
            wv.reload()
        } catch (err) {
            console.error("blockurl: could not update the block list", err)
        } finally {
            setBusy(false)
        }
    }

    // No <webview> means browser Trilium (an <iframe>), where none of this applies.
    if (!state.found) return null

    const label = busy ? "Working…" : blocked ? "Unblock This Page" : "Block This Page"

    return (
        <div
            className="blockurl-toolbar"
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px", borderBottom: "1px solid #ddd", contain: "none" }}
        >
            <div style={{ flex: 1, minWidth: 0, fontSize: "11px", color: "#888", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {state.url}
            </div>
            <button
                disabled={busy || blocked === null}
                style={{ border: "none", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", background: blocked ? "#eee" : "#d64545", color: blocked ? "#222" : "white", fontSize: "12px" }}
                onClick={handleToggle}
            >{label}</button>
        </div>
    )
}

export default defineWidget({
    parent: "center-pane",
    position: -9, // just after web-preview@beatlink's toolbar, before the note content at 0
    render() {
        const { note } = useActiveNoteContext()
        const noteId = useNoteProperty(note, "noteId")
        const noteType = useNoteProperty(note, "type")

        // The host snapshots this widget's DOM children exactly once, so the root element
        // must exist on the very first render — returning null leaves it permanently empty.
        return (
            <div className="blockurl-toolbar-host">
                {noteType === "webView" && <BlockUrlToolbar noteId={noteId} />}
            </div>
        )
    }
})
