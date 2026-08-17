// === Trilium Code note ===
// Title: newTabLauncher.js
// Type: Code -> JS Frontend
// Run by the New Tab launchbar button, not by an attribute.
// Must not be a child of a #run=frontendStartup note: children are bundled with it and run at startup.

// ---------------------------------------------------------------------------
// Records the note the button was pressed from before navigating away from it,
// since that is where the New Tab page files the Web View note it creates.
// ---------------------------------------------------------------------------
async function openNewTab() {
    const pageNoteId = await api.currentNote.getRelationValue("newTabPageNote");
    if (!pageNoteId) return;

    const active = api.getActiveContextNote();
    if (active && active.noteId !== pageNoteId) {
        window.webPreviewNewTab = { fromNoteId: active.noteId };
    }

    await api.activateNote(pageNoteId);
    window.dispatchEvent(new CustomEvent("web-preview:new-tab"));
}

openNewTab();
