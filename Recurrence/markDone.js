/*
    Instructions: Paste the below into a new JS Backend Script note.
    Clone the requirrencelib.js widget to to this script as a subnote
    Create a label "#dueDateLabel=" with the label of notes with due dates to be repeated
*/

// User Editable ---------------------------------------------------------------------------
let recurrencelib = require("recurrencelib")

async function run_script() {
    const dueLabel = await api.currentNote.getLabelValue("dueDateLabel")
    var currentNote = await api.getActiveContextNote();
    if (currentNote.hasLabel(dueLabel)) {
        const recurrenceJSON = await api.runOnBackend(
            (currentNoteID) => {
                const note = api.getNote(currentNoteID)
                const attachment = note.getAttachmentByTitle("Recurrence.json")
                return attachment ? attachment.getContent().toString() : ""

        }, [currentNote.noteId])
        if (recurrenceJSON){
            var due = new Date(currentNote.getLabelValue(dueLabel))
            const recurrence = recurrencelib.recurrenceFromJSON(recurrenceJSON)
            const newDue = recurrence.getNextDate(due)
            const year = String(newDue.getFullYear())
            const month = String(newDue.getMonth()+1).padStart(2, '0')
            const day = String(newDue.getDate()).padStart(2, '0')
            const hour = String(newDue.getHours()).padStart(2, '0')
            const minute = String(newDue.getMinutes()).padStart(2, '0')
            const newDueString = `${year}-${month}-${day}T${hour}:${minute}`
            await api.runOnBackend((currentNoteID, dueLabel, newDue) => {
                const currentNote = api.getNote(currentNoteID)
                var content = currentNote.getContent()
                content = content.replaceAll('checked="checked"', "")
                currentNote.setContent(content, {forceSave: true})
                currentNote.setLabel(dueLabel, newDue)
            }, [currentNote.noteId, dueLabel, newDueString]);

        } else {
            await currentNote.setLabel(dueLabel, "")
            await currentNote.setLabel("archived")
        }
        api.refreshIncludedNote(currentNote)
    }
}
run_script()
