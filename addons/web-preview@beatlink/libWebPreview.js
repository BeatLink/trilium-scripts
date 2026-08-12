// === Trilium Code note ===
// Title: libWebPreview.js
// Type: Code -> JS Frontend
// Library only — no #run attribute. require()'d by webViewToolbarWidget.js

// ---------------------------------------------------------------------------
// Creates a Web View note for `url` under `parentNoteId` and returns its noteId.
// ---------------------------------------------------------------------------
async function createWebViewNote(parentNoteId, url, title) {
    return api.runOnBackend((parentNoteId, url, title) => {
        const { note } = api.createNewNote({
            parentNoteId,
            title: title || url,
            type: "webView",
            content: "",
            mime: "text/html"
        });
        note.setLabel("webViewSrc", url);
        return note.noteId;
    }, [parentNoteId, url, title]);
}

// ---------------------------------------------------------------------------
// Opens a URL in the system's default browser. Uses the renderer's electronApi
// bridge — backend scripts can't require("electron"), it isn't on the allowed
// module list.
// ---------------------------------------------------------------------------
function openExternal(url) {
    window.electronApi?.shell?.openExternal(url);
}

// ---------------------------------------------------------------------------
// Deletes the Web View note itself, for clearing out saved links once you're
// done with them. Trilium's delete is soft,
// so the note stays recoverable from Recent Changes. The parent is read before
// the delete and activated after, since the tab would otherwise be left sitting
// on a note that no longer exists.
// ---------------------------------------------------------------------------
async function deleteWebViewNote(noteId) {
    const note = await api.getNote(noteId);
    const parentNoteId = note?.getParentNoteIds()[0];

    await api.runOnBackend((noteId) => api.getNote(noteId).deleteNote(), [noteId]);

    if (parentNoteId) await api.activateNote(parentNoteId);
}

// ---------------------------------------------------------------------------
// Guest-page script, injected on every page load, that swallows link clicks and
// reports them to the toolbar. Trilium's <webview> has no preload script, so the
// guest's console is the only channel back to the host; the host's `will-navigate`
// can't be cancelled, hence intercepting the click instead of the navigation.
// ---------------------------------------------------------------------------
const LINK_MESSAGE_PREFIX = "web-preview:link:";

const LINK_INTERCEPT_SCRIPT = `(() => {
    if (window.__webPreviewLinkIntercept) return;
    window.__webPreviewLinkIntercept = true;
    document.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const anchor = event.target && event.target.closest && event.target.closest("a[href]");
        if (!anchor || !/^https?:/i.test(anchor.href)) return;
        event.preventDefault();
        event.stopPropagation();
        console.log(${JSON.stringify(LINK_MESSAGE_PREFIX)} + JSON.stringify({ url: anchor.href, title: (anchor.textContent || "").trim() }));
    }, true);
})()`;

// ---------------------------------------------------------------------------
// Reads one console message from the guest page, returning {url, title} for a
// clicked link and null for the page's own console output.
// ---------------------------------------------------------------------------
function parseLinkMessage(message) {
    if (typeof message !== "string" || !message.startsWith(LINK_MESSAGE_PREFIX)) return null;
    try {
        return JSON.parse(message.slice(LINK_MESSAGE_PREFIX.length));
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Turns what was typed into the New Tab box into the URL to open and a note title.
// A full URL or a bare host goes straight there; anything else is a query for
// `urlTemplate`, whose `%s` placeholder receives it URL-encoded. Returns null for
// a query when no template was given, so the caller can say no provider is set up.
// ---------------------------------------------------------------------------
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const LOCAL_HOST_RE = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:[/?#]|$)/i;
const BARE_HOST_RE = /^[^\s/?#]+\.[a-z]{2,}(?:[:/?#]|$)/i;

function buildNewTabTarget(text, urlTemplate) {
    const trimmed = text.trim();
    let url = null;
    if (SCHEME_RE.test(trimmed)) url = trimmed;
    // A bare host or IP is nearly always a server on the LAN, which rarely speaks TLS.
    else if (LOCAL_HOST_RE.test(trimmed)) url = `http://${trimmed}`;
    else if (BARE_HOST_RE.test(trimmed)) url = `https://${trimmed}`;

    if (url) return { url, title: hostnameOf(url) };
    if (!urlTemplate) return null;
    return { url: urlTemplate.replace(/%s/g, encodeURIComponent(trimmed)), title: trimmed };
}

// Hostname of a URL, falling back to the URL itself when it can't be parsed.
function hostnameOf(url) {
    try {
        return new URL(url).hostname || url;
    } catch {
        return url;
    }
}

module.exports = { createWebViewNote, openExternal, deleteWebViewNote, LINK_INTERCEPT_SCRIPT, parseLinkMessage, buildNewTabTarget };
