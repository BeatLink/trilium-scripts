/*
    Instructions: Paste the below into a new JS Frontend Script note. 
    Add the following label: #run=frontendStartup 
    Create a note relation "~rescheduleScript" pointing to the reschedule.js note
*/


async function setupButton() {
    let rescheduleTodayScript = await api.currentNote.getRelationValue("rescheduleTodayScript")
    await api.runOnBackend((rescheduleTodayScript) => {
        api.createOrUpdateLauncher({
            id: "rescheduleTodayButton",
            title: "Reschedule Task to Today",
            icon: "bx-calendar-star",
            type: "script",
            isVisible: true,
            scriptNoteId: rescheduleTodayScript,
        });
    }, [rescheduleTodayScript])
    let rescheduleTomorrowScript = await api.currentNote.getRelationValue("rescheduleTomorrowScript")
    await api.runOnBackend((rescheduleTomorrowScript) => {
        api.createOrUpdateLauncher({
            id: "rescheduleTomorrowButton",
            title: "Reschedule Task to Tomorrow",
            icon: "bx-calendar-event",
            type: "script",
            isVisible: true,
            scriptNoteId: rescheduleTomorrowScript,
        });
    }, [rescheduleTomorrowScript])
}

setupButton()


