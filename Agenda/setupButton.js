/*
    Instructions: Paste the below into a new JS Frontend Script note. 
    Add the following label: #run=frontendStartup 
    Add a relation ~UpdateAgendaNote pointing to the updateAgenda.js script
*/

async function setupButton() {
    let scriptNote = await api.currentNote.getRelationValue("UpdateAgendaNote")
        await api.runOnBackend((scriptNote) => {
        api.createOrUpdateLauncher({
            id: "updateAgendaButton",
            title: "Update Agenda",
            icon: "bx-calendar",
            type: "script",
            isVisible: true,
            scriptNoteId: scriptNote,
        });
    },
    [scriptNote])
}

setupButton()
