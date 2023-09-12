/*
    Instructions: Paste the below into a new JS Backend Script note. Set the dueDateLabel if necessary
*/

async function run_script() {
    let dueDateLabel = "dueDate"
    const currentNote = await api.getActiveContextNote();
    await api.runOnBackend((currentNoteID, dueDateLabel) => {
        const currentNote = api.getNote(currentNoteID)
        let dueDate = api.dayjs(currentNote.getLabelValue(dueDateLabel))
        let newDate = dueDate.add(1, "d")
        newDateString = newDate.format("YYYY-MM-DD")
        currentNote.setLabel(dueDateLabel, newDateString)
    }, [currentNote.noteId, dueDateLabel]);
}
run_script()
