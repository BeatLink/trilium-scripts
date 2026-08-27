/*
    Shows a small toolbar (Back / Forward / Open in Browser / Delete Note)
    above any note of type "Web View". Drives the *actual* Electron <webview>
    element that Trilium's built-in Web View note type already renders —
    no separate popup window needed.
*/
import { defineWidget, useActiveNoteContext, useNoteProperty, useState, useEffect, useRef, ActionButton, Button } from "trilium:preact"
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
    const [history, setHistory] = useState(null)
    const [showHistory, setShowHistory] = useState(false)
    // Read by the Back and Forward handlers, which are bound to buttons rather than to the note.
    const historyRef = useRef(null)
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
        let cancelled = false
        let stack = null
        let saveTimer = null
        let unsaved = false
        let lastUrl = ""
        // True until the first page of this mount is placed: Trilium loads the note where it was
        // left, which is a page already in the stack rather than somewhere new.
        let settling = true

        // The one place the stack changes — the listeners below hand it every page they see. The
        // stack is kept whatever the setting says, since settings load after the first page does;
        // what the setting decides is whether any of it reaches the note.
        const record = (url, title) => {
            const next = lib.recordHistoryVisit(stack, url, title, settling)
            settling = false
            if (!next) return

            stack = next
            historyRef.current = next
            setHistory(next)
            if (!settingsRef.current?.rememberHistory) return

            unsaved = true
            clearTimeout(saveTimer)
            saveTimer = setTimeout(() => {
                unsaved = false
                lib.saveWebViewHistory(noteId, next).catch((err) =>
                    console.error("web-preview: could not save the page history", err))
            }, 1000)
        }

        lib.loadWebViewHistory(noteId).then((stored) => {
            if (cancelled || !stored) return
            // A page can load while this is in flight, so it is placed against the stored stack
            // rather than the empty one it was placed against on the way here.
            stack = lib.recordHistoryVisit(stored, lastUrl, null, true) || stored
            historyRef.current = stack
            setHistory(stack)
        }).catch((err) => console.error("web-preview: could not read the page history", err))

        // Trilium mounts the <webview> after this widget re-renders for the new note.
        const poll = setInterval(() => {
            const found = getWebviewEl()
            if (!found) {
                if (++attempts > 30) clearInterval(poll)
                return
            }
            clearInterval(poll)
            wv = found
            // canGoBack() and the rest throw until the guest has attached and its first
            // dom-ready has fired, which the pass below this one is deliberately ahead of. The
            // toolbar still shows itself, with its buttons idle until the event arrives.
            onRefresh = () => {
                let page = { canGoBack: false, canGoForward: false, url: "" }
                try {
                    page = { canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward(), url: wv.getURL() }
                } catch {}
                if (page.url) lastUrl = page.url
                record(page.url, null)
                setState((prev) => ({ found: true, ...page, nav: prev.nav + 1 }))
            }
            // Injection only works once the guest document exists, so the first pass
            // (before dom-ready has fired) is expected to fail and is left to the event.
            onDomReady = () => {
                onRefresh()
                try {
                    wv.executeJavaScript(lib.linkInterceptScript(settingsRef.current?.interceptAllLinks)).catch(() => {})
                } catch {}
            }
            onConsole = async (event) => {
                const link = lib.parseLinkMessage(event.message)
                if (!link) return
                try {
                    const parentNoteId = await lib.resolveLinkParentNoteId(noteId, settingsRef.current?.linkPlacement)
                    const linkNoteId = await lib.createWebViewNote(parentNoteId, link.url, link.title, settingsRef.current?.reuseExistingNotes)
                    // A ctrl-click or right-click files the note without leaving this page.
                    if (link.background) api.showMessage(`Opened in new note: ${link.title || link.url}`)
                    else await api.activateNote(linkNoteId)
                } catch (err) {
                    console.error("web-preview: could not open the clicked link as a note", err)
                }
            }
            // Fires on the guest's own title changes too, not just on load, so a SPA
            // swapping its <title> keeps the note's title in step.
            onTitle = (event) => {
                record(lastUrl, event.title)
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
            cancelled = true
            clearInterval(poll)
            clearTimeout(saveTimer)
            if (unsaved && stack) {
                lib.saveWebViewHistory(noteId, stack).catch((err) =>
                    console.error("web-preview: could not save the page history", err))
            }
            // Only on the way out: this rewrites the label Trilium keys the element on, so doing it
            // any earlier would reload the page and throw away the history being left behind.
            if (settingsRef.current?.followPageUrl && lastUrl) {
                lib.updateWebViewSrc(noteId, lastUrl).catch((err) =>
                    console.error("web-preview: could not point the note at the page", err))
            }
            if (wv && onRefresh) {
                wv.removeEventListener("did-navigate", onRefresh)
                wv.removeEventListener("did-navigate-in-page", onRefresh)
                wv.removeEventListener("dom-ready", onDomReady)
                wv.removeEventListener("console-message", onConsole)
                wv.removeEventListener("page-title-updated", onTitle)
            }
            setState({ found: false, canGoBack: false, canGoForward: false, url: "", nav: 0 })
            setHistory(null)
            setShowHistory(false)
            historyRef.current = null
        }
    }, [noteId])

    // The script above is injected on dom-ready, which can beat the settings load, and the
    // setting can change while a page is open — so it is pushed in again from here, where
    // re-running it only updates the flag the already-bound listeners read.
    useEffect(() => {
        if (!state.found || !settings) return

        const lib = require("libWebPreview.js")
        try {
            getWebviewEl()?.executeJavaScript(lib.linkInterceptScript(settings.interceptAllLinks)).catch(() => {})
        } catch {}
    }, [state.found, state.nav, settings])

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

    // Chromium's own history is empty on a freshly mounted element, so the note's stack stands in
    // for it — a load of the page rather than a step back through it, which is as close as a
    // <webview> allows.
    function handleBack() {
        const wv = getWebviewEl()
        if (!wv) return
        if (wv.canGoBack()) return wv.goBack()

        const previous = historyRef.current?.entries[historyRef.current.index - 1]
        if (previous) wv.loadURL(previous.url)
    }

    function handleForward() {
        const wv = getWebviewEl()
        if (!wv) return
        if (wv.canGoForward()) return wv.goForward()

        const next = historyRef.current?.entries[historyRef.current.index + 1]
        if (next) wv.loadURL(next.url)
    }

    function handleHistoryPick(entry) {
        setShowHistory(false)
        getWebviewEl()?.loadURL(entry.url)
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
            await lib.createWebViewNote(parentNoteId, wv.getURL(), wv.getTitle() || wv.getURL(), settings?.reuseExistingNotes)
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

    const canGoBack = state.canGoBack || (history ? history.index > 0 : false)
    const canGoForward = state.canGoForward || (history ? history.index < history.entries.length - 1 : false)

    return (
        <div
            className="web-view-toolbar"
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px", borderBottom: "1px solid #ddd", contain: "none" }}
        >
            <ActionButton icon="bx bx-chevron-left" text="Back" disabled={!canGoBack} onClick={handleBack} />
            <ActionButton icon="bx bx-chevron-right" text="Forward" disabled={!canGoForward} onClick={handleForward} />
            {settings?.rememberHistory && history?.entries.length > 0 && (
                <div style={{ position: "relative" }}>
                    <ActionButton
                        icon="bx bx-history"
                        text="History"
                        onClick={() => setShowHistory((open) => !open)}
                    />
                    {showHistory && (
                        <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 1000, minWidth: "280px", maxHeight: "320px", overflowY: "auto", padding: "4px", borderRadius: "6px", border: "1px solid #ddd", background: "var(--main-background-color, #fff)" }}>
                            {history.entries.map((entry, index) => ({ entry, index })).reverse().map(({ entry, index }) => (
                                <div
                                    key={`${index}-${entry.url}`}
                                    title={entry.url}
                                    onClick={() => handleHistoryPick(entry)}
                                    style={{ padding: "4px 6px", borderRadius: "4px", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: index === history.index ? "bold" : "normal" }}
                                >
                                    {entry.title || entry.url}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
            <div style={{ flex: 1, minWidth: 0, fontSize: "11px", color: "#888", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {state.url}
            </div>
            {settings?.showSaveButton && (
                <Button
                    size="small" kind="primary" icon="bx-save"
                    title="Save this page as a note"
                    text={saving ? "Saving…" : "Save"}
                    disabled={saving}
                    onClick={handleSave}
                />
            )}
            <Button size="small" icon="bx-link-external" text="Open in Browser" onClick={handleExternal} />
            <Button
                size="small" icon="bx-trash"
                title="Delete this Web View note"
                text={deleting ? "Deleting…" : "Delete Note"}
                disabled={deleting}
                onClick={handleDelete}
            />
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
