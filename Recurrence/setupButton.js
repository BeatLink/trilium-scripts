/*
    Instructions: Paste the below into a new JS Frontend Script note. 
    Add the following label: #run=frontendStartup
    Create a note relation "~markDoneScript" pointing to markDone.js
*/

async function setupButton() {
    let markDone = await api.currentNote.getRelationValue("markDoneScript")
    await api.runOnBackend(
        (markDone) => {
            api.createOrUpdateLauncher({
                id: "markDoneButton",
                title: "Mark Done",
                icon: " bx-calendar-check",
                type: "script",
                scriptNoteId: markDone,
                isVisible: true
            });
        },
    [markDone])
}
setupButton()
