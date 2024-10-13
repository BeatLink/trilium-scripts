/*
    Instructions: Paste the below into a new JS Frontend Script note. 
    Add the following label: #run=frontendStartup 
    Create a note relation "~rescheduleScript" pointing to the reschedule.js note
*/


async function setupButton() {
    let rescheduleScript = await api.currentNote.getRelationValue("rescheduleScript")
    await api.runOnBackend((rescheduleScript) => {
        api.createOrUpdateLauncher({
            id: "rescheduleOneDayButton",
            title: "Reschedule Task One Day Ahead",
            icon: "bx-calendar",
            type: "script",
            isVisible: true,
            scriptNoteId: rescheduleScript,
        });
    }, [rescheduleScript])
}

setupButton()


