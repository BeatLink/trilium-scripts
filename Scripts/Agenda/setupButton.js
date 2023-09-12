/*
    Instructions: Paste the below into a new JS Frontend Script note. 
    Add the following label: #run=frontendStartup 
    Update the scriptNoteID with the IDs for the notes containing updateAgenda.js 
*/

async function setupButton() {
    await api.runOnBackend(() => {
        api.createOrUpdateLauncher({
            id: "updateAgendaButton",
            title: "Update Agenda",
            icon: "bx-calendar",
            type: "script",
            isVisible: true,
            scriptNoteId: "<backend-script-note-id>",
        });
    })
}

setupButton()
