/*
    Instructions: Paste the below into a new JS Frontend Script note. 
    Add the following label: #run=frontendStartup 
    Update the scriptNoteID with the IDs for the notes containing addToMyDay.js and removeFromMyDay.js respectively. 
*/

async function setupButtons() {
    await api.runOnBackend(() => {
        api.createOrUpdateLauncher({
            id: "addToMyDayButton",
            title: "Add to My Day",
            icon: "bxs-star",
            type: "script",
            isVisible: true,
            scriptNoteId: "<add-to-my-day-script>"
        });

        api.createOrUpdateLauncher({
            id: "removeFromMyDayButton",
            title: "Remove from My Day",
            icon: "bx-star",
            type: "script",
            isVisible: true,
            scriptNoteId: "<remove-from-my-day-script>"
        });
    })
}

setupButtons()

