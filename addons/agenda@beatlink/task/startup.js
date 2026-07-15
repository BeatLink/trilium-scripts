async function createMarkDoneLauncher() {
    const markDoneScriptNoteId = await api.currentNote.getRelationValue("markDoneScript")

    await api.runOnBackend((markDoneScriptNoteId) => {
        api.createOrUpdateLauncher({
            id: "recurrenceMarkDoneButton",
            title: "Mark Done",
            icon: "bx bx-calendar-check",
            type: "script",
            scriptNoteId: markDoneScriptNoteId,
            isVisible: true
        })
    }, [markDoneScriptNoteId])
}

createMarkDoneLauncher()
