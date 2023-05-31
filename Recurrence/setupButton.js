/*
    Instructions: Paste the below into a new JS Frontend Script note. 
    Add the following label: #run=frontendStartup 
    Update the scriptNoteID with the IDs for the notes containing updateRecurrence.js
*/


async function setupButton() {
    await api.runOnBackend(() => {
        api.createOrUpdateLauncher({
            id: "updateRecurrenceButton",
            title: "Update Recurrence",
            icon: "bx-refresh",
            type: "script",
            scriptNoteId: "<set-to-updateRecurrence.js>",
            isVisible: true
        });
    })
}

setupButton()



