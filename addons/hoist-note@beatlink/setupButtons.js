/*
    Instructions:
    Paste the below into a new JS Frontend Script note.
    Add the following label: #run=frontendStartup
*/

async function setupButton() {
    await api.runOnBackend(() => {
        const noteId = "al_hoistNoteButton"
        const launcher = api.getNote(noteId) || api.createNewNote({
            noteId: noteId,
            branchId: noteId,
            parentNoteId: "_lbVisibleLaunchers",
            title: "Hoist Note",
            type: "launcher",
            content: ""
        }).note

        launcher.title = "Hoist Note"
        launcher.save()
        launcher.setRelation("template", "_lbTplLauncherCommand")
        launcher.removeRelation("script")
        launcher.setLabel("command", "toggleNoteHoisting")
        launcher.setLabel("iconClass", "bx bx-pin")
    })
}

setupButton()
