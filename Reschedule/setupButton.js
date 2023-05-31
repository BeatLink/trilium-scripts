/*
    Instructions: Paste the below into a new JS Frontend Script note. 
    Add the following label: #run=frontendStartup 
    Update the scriptNoteID with the IDs for the notes containing reschedule.js
*/


async function setupButton() {
    await api.runOnBackend(() => {
        api.createOrUpdateLauncher({
            id: "rescheduleOneDayButton",
            title: "Reschedule Task One Day Ahead",
            icon: "bx-calendar",
            type: "script",
            isVisible: true,
            scriptNoteId: "<set-to-reschedule.js-note-id>",
        });
    })
}

setupButton()


