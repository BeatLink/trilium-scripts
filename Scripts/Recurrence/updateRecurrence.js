/*
    Instructions: Paste the below into a new JS Backend Script note. Set the dueDateLabel and recurrenceLabel if necessary
    For recurrence options, see https://day.js.org/docs/en/manipulate/add 
*/
async function run_script() {
    let dueDateLabel = "dueDate"
    let recurrenceLabel = "repeats"
    const currentNote = await api.getActiveContextNote();
    await api.runOnBackend((currentNoteID, dueDateLabel, recurrenceLabel) => {
        const currentNote = api.getNote(currentNoteID)
        const recurrence = currentNote.getLabelValue(recurrenceLabel).split("")
        const dueDate = api.dayjs(currentNote.getLabelValue(dueDateLabel))
        const newDate = dueDate.add(recurrence[0], recurrence[1])
        const newDateString = newDate.format("YYYY-MM-DD")
        currentNote.setLabel(dueDateLabel, newDateString)
    }, [currentNote.noteId, dueDateLabel, recurrenceLabel]);    
}
run_script()

