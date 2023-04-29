// #run=frontendStartup 

async function setupButton() {
    await api.runOnBackend(() => {
        api.createOrUpdateLauncher({
            id: "update_agenda_button",
            title: "Update Agenda",
            icon: "bx-calendar",
            type: "script",
            scriptNoteId: "<backend-script-note-id>",
            isVisible: true,
            keyboardShortcut: "ctrl+alt+a"
        });
    })
}

setupButton()
