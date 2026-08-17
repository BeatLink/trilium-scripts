// === Trilium Code note ===
// Title: newTabStartup.js
// Type: Code -> JS Frontend
// #run=frontendStartup

// ---------------------------------------------------------------------------
// Puts the New Tab button in the launchbar, wired to the script that opens the page.
// ---------------------------------------------------------------------------
async function registerLauncher() {
    const scriptNoteId = await api.currentNote.getRelationValue("newTabScriptNote");
    if (!scriptNoteId) return;

    await api.runOnBackend((scriptNoteId) => {
        api.createOrUpdateLauncher({
            id: "webPreviewNewTab",
            title: "New Tab",
            type: "script",
            icon: "bx-globe",
            isVisible: true,
            scriptNoteId
        });
    }, [scriptNoteId]);
}

registerLauncher();
