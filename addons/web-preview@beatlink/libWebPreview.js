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
    const inboxNoteId = await getInboxNoteId();

    return api.runOnBackend((inboxNoteId, url, title) => {
        const { note } = api.createNewNote({
            parentNoteId: inboxNoteId,
            title: title || url,
            type: "webView",
            content: "",
            mime: "text/html"
        });
        note.setLabel("webViewSrc", url);
        note.setLabel("url", url);
        return note.noteId;
    }, [inboxNoteId, url, title]);
}

// ---------------------------------------------------------------------------
// Opens a URL in the system's default browser. Uses the renderer's electronApi
// bridge — backend scripts can't require("electron"), it isn't on the allowed
// module list.
// ---------------------------------------------------------------------------
function openExternal(url) {
    window.electronApi?.shell?.openExternal(url);
}

module.exports = { getInboxNoteId, saveUrlToInbox, openExternal };
