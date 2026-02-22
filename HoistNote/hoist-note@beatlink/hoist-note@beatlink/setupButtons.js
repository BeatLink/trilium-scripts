/*
    Instructions: 
    Paste the below into a new JS Frontend Script note. 
    Create a relation for ~hoistNoteScript pointing to the hoistNote.js
    Add the following label: #run=frontendStartup
*/

async function setupButton() {
    let hoistNote = await api.currentNote.getRelationValue("hoistNoteScript")
    await api.runOnBackend(
        (hoistNote) => {
            api.createOrUpdateLauncher({
                id: "hoistNoteButton",
                title: "Hoist Note",
                icon: "bx bx-pin",
                type: "script",
                isVisible: true,
                scriptNoteId: hoistNote
            });
        }, 
        [hoistNote]);
}

setupButton()
