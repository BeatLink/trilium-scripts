/*
    Shows a small toolbar (Back / Forward / Open in Browser / Delete Note)
    above any note of type "Web View". Drives the *actual* Electron <webview>
    element that Trilium's built-in Web View note type already renders —
    no separate popup window needed.
*/
import { defineWidget, useActiveNoteContext, useNoteProperty, useState, useEffect, useRef } from "trilium:preact"
import { currentNote } from "trilium:api"
import { loadSettings, resolveConfigNotes } from "libSettingsUI.jsx"

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
    const [state, setState] = useState({ found: false, canGoBack: false, canGoForward: false, url: "", nav: 0 })
    const [deleting, setDeleting] = useState(false)
    const [saving, setSaving] = useState(false)
    const [settings, setSettings] = useState(null)
    // The <webview> listeners are bound once per note, so they read settings through a ref
    // rather than a closure that would still hold the null from before settings loaded.
    const settingsRef = useRef(null)
    settingsRef.current = settings

    useEffect(() => {
        (async () => {
            const { schemaNoteId, configNoteId } = await resolveConfigNotes(currentNote)
            if (!schemaNoteId || !configNoteId) return
            setSettings(await loadSettings(schemaNoteId, configNoteId))
        })()
    }, [])

    useEffect(() => {
        const lib = require("libWebPreview.js")
        let wv = null
        let onRefresh = null
        let onDomReady = null
        let onConsole = null
        let onTitle = null
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
            onRefresh = () => setState((prev) => ({ found: true, canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward(), url: wv.getURL(), nav: prev.nav + 1 }))
            // Injection only works once the guest document exists, so the first pass
            // (before dom-ready has fired) is expected to fail and is left to the event.
            onDomReady = () => {
                onRefresh()
                try {
                    wv.executeJavaScript(lib.LINK_INTERCEPT_SCRIPT).catch(() => {})
                } catch {}
            }
            onConsole = async (event) => {
                const link = lib.parseLinkMessage(event.message)
                if (!link) return
                try {
                    await api.activateNote(await lib.createWebViewNote(noteId, link.url, link.title))
                } catch (err) {
                    console.error("web-preview: could not open the clicked link as a note", err)
                }
            }
            // Fires on the guest's own title changes too, not just on load, so a SPA
            // swapping its <title> keeps the note's title in step.
            onTitle = (event) => {
                if (!settingsRef.current?.syncNoteTitle) return
                lib.renameNote(noteId, event.title).catch((err) =>
                    console.error("web-preview: could not rename the note to the page title", err))
            }
            wv.addEventListener("page-title-updated", onTitle)
            wv.addEventListener("did-navigate", onRefresh)
            wv.addEventListener("did-navigate-in-page", onRefresh)
            wv.addEventListener("dom-ready", onDomReady)
            wv.addEventListener("console-message", onConsole)
            onDomReady()
        }, 100)

        return () => {
            clearInterval(poll)
            if (wv && onRefresh) {
                wv.removeEventListener("did-navigate", onRefresh)
                wv.removeEventListener("did-navigate-in-page", onRefresh)
                wv.removeEventListener("dom-ready", onDomReady)
                wv.removeEventListener("console-message", onConsole)
                wv.removeEventListener("page-title-updated", onTitle)
            }
            setState({ found: false, canGoBack: false, canGoForward: false, url: "", nav: 0 })
        }
    }, [noteId])

    // SponsorBlock. Re-runs on every navigation and reload: injecting the skipper is
    // idempotent, but a reload gives the guest a new document that has lost it, and a
    // single-page navigation to another video needs the new video's segments pushed in.
    useEffect(() => {
        if (!state.found || !settings?.sponsorBlockEnabled) return

        const lib = require("libWebPreview.js")
        const sb = require("libSponsorBlock.js")
        const wv = getWebviewEl()
        if (!wv) return

        const videoId = sb.parseYouTubeVideoId(state.url)
        const notify = settings.sponsorBlockNotify
        let cancelled = false

        ;(async () => {
            try {
                // The injected script is the record of what is already set up: a reload
                // leaves the new document without it, and YouTube fires an in-page
                // navigation for things like a chapter click, which need no new lookup.
                const applied = await wv.executeJavaScript("window.__webPreviewSponsorBlock ? window.__webPreviewSponsorBlock.videoId : null")
                if (videoId && applied === videoId) return

                await wv.executeJavaScript(lib.SPONSORBLOCK_SCRIPT)
                // Clear first, so the previous video's segments can't act on this one
                // while its own are still being fetched.
                await wv.executeJavaScript(lib.sponsorBlockApplyScript({ videoId: videoId || "", segments: [], notify }))
                if (!videoId) return

                const segments = await sb.fetchSponsorSegments(videoId, sb.sponsorBlockCategories(settings))
                if (cancelled || segments.length === 0) return
                await wv.executeJavaScript(lib.sponsorBlockApplyScript({ videoId, segments, notify }))
            } catch (err) {
                console.error("web-preview: SponsorBlock could not be applied", err)
            }
        })()

        return () => { cancelled = true }
    }, [state.found, state.nav, settings])

    function handleBack() {
        const wv = getWebviewEl()
        if (wv?.canGoBack()) wv.goBack()
    }

    function handleForward() {
        const wv = getWebviewEl()
        if (wv?.canGoForward()) wv.goForward()
    }

    function handleExternal() {
        const wv = getWebviewEl()
        if (!wv) return
        const lib = require("libWebPreview.js")
        lib.openExternal(wv.getURL())
    }

    // Files the page being read as a Web View note of its own, outside the browsing
    // tree the clicked-link notes build up, so it survives pruning that tree.
    async function handleSave() {
        const wv = getWebviewEl()
        if (!wv) return

        setSaving(true)
        try {
            const lib = require("libWebPreview.js")
            const parentNoteId = await lib.resolveSaveParentNoteId(settings?.saveParentNoteId)
            await lib.createWebViewNote(parentNoteId, wv.getURL(), wv.getTitle() || wv.getURL())
            api.showMessage("Page saved.")
        } catch (err) {
            api.showError(`Could not save this page: ${err.message}`)
            console.error("web-preview: could not save the page", err)
        }
        setSaving(false)
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
            {settings?.showSaveButton && (
                <button
                    title="Save this page as a note"
                    disabled={saving}
                    style={{ border: "none", borderRadius: "6px", padding: "6px 12px", cursor: "pointer", background: "#4b6fff", color: "white", fontSize: "12px" }}
                    onClick={handleSave}
                >{saving ? "Saving…" : "Save"}</button>
            )}
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
