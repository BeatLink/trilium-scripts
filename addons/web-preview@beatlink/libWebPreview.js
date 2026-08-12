// === Trilium Code note ===
// Title: libWebPreview.js
// Type: Code -> JS Frontend
// Library only — no #run attribute. require()'d by webViewToolbarWidget.js

// ---------------------------------------------------------------------------
// Finds the Inbox note (looks for #inbox label first, falls back to a note
// titled "Inbox" directly under root). Adjust to taste.
// ---------------------------------------------------------------------------
async function getInboxNoteId() {
    let results = await api.searchForNotes("#inbox");
    if (results.length > 0) return results[0].noteId;

    results = await api.searchForNotes('note.title = "Inbox" AND note.parents.noteId = "root"');
    if (results.length > 0) return results[0].noteId;

    throw new Error("Couldn't find an Inbox note. Add a #inbox label to one, or edit getInboxNoteId().");
}

// ---------------------------------------------------------------------------
// Saves a URL to the Inbox as a new Web View note (so opening it later shows
// the embedded page directly, toolbar and all — same as the note you're
// browsing from). Falls back gracefully if your Trilium version's note
// creation API differs — see README "Known caveats".
// ---------------------------------------------------------------------------
async function saveUrlToInbox(url, title) {
    return createWebViewNote(await getInboxNoteId(), url, title);
}

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
// Deletes the Web View note itself — the counterpart to saveUrlToInbox, for
// clearing out saved links once you're done with them. Trilium's delete is soft,
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

module.exports = { getInboxNoteId, saveUrlToInbox, createWebViewNote, openExternal, deleteWebViewNote, LINK_INTERCEPT_SCRIPT, parseLinkMessage };
