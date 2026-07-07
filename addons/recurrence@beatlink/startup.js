async function setupButton() {
    let markDone = await api.currentNote.getRelationValue("markDoneScript")
    await api.runOnBackend((markDone) => {
        api.createOrUpdateLauncher({
            id: "recurrenceMarkDoneButton",
            title: "Mark Done",
            icon: "bx bx-calendar-check",
            type: "script",
            scriptNoteId: markDone,
            isVisible: true
        })
    }, [markDone])
}
setupButton()
