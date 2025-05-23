/*
Instructions: Paste the below into a new JS Backend Script note. Set the dueDateLabel if necessary
*/

async function run_script() {
    let dueDateLabel = await api.currentNote.getLabelValue("DueDateLabel")
    const currentNote = await api.getActiveContextNote();
    await api.runOnBackend((currentNoteID, dueDateLabel) => {
        const currentNote = api.getNote(currentNoteID)
        let dueDate = api.dayjs(currentNote.getLabelValue(dueDateLabel))
        let newDate = api.dayjs().add(1, 'day')
        newDate = newDate.hour(dueDate.hour())
        newDate = newDate.minute(dueDate.minute())
        newDate = newDate.second(0)
        newDate = newDate.millisecond(0)
        let newDateString = newDate.format("YYYY-MM-DDTHH:mm")
        currentNote.setLabel(dueDateLabel, newDateString)
    }, [currentNote.noteId, dueDateLabel]);
}
run_script()
