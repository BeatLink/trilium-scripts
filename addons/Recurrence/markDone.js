/*
    Instructions: Paste the below into a new JS Backend Script note. 
    Clone the requirrencelib.js widget to to this script as a subnote
    Create a label "#dueDateLabel=" with the label of notes with due dates to be repeated
*/

// User Editable ---------------------------------------------------------------------------
let rrulelib = require("rrule.min.js")

function formatDate(date) {
  const pad = (n) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function run_script() {
    const dueLabel = await api.currentNote.getLabelValue("dueDateLabel")
    const recurrenceLabel = await api.currentNote.getLabelValue("recurrenceLabel")
    const currentNote = await api.getActiveContextNote();
    if (currentNote.hasLabel(dueLabel) && currentNote.hasLabel(recurrenceLabel)) {
        const recurrenceString = currentNote.getLabelValue(recurrenceLabel) 
        const due = new Date(currentNote.getLabelValue(dueLabel))
        var options = rrulelib.RRule.parseString(recurrenceString)
		options.dtstart = due
		var rrule = new rrulelib.RRule(options)        
		const nextDate = rrule.after(due, false)
        const nextDateString = formatDate(nextDate)
        await api.runOnBackend((currentNoteID, dueLabel, newDue) => {
            const currentNote = api.getNote(currentNoteID)
            var content = currentNote.getContent()
            content = content.replaceAll('checked="checked"', "")
            currentNote.setContent(content, {forceSave: true})
            currentNote.setLabel(dueLabel, newDue)
            currentNote.removeLabel("archived") 
            function unarchiveChildren(childNote){
                childNote.removeLabel("archived")    
                var children = childNote.getChildNotes()
                for (let child of children){
                    unarchiveChildren(child)
                }
            }
            unarchiveChildren(currentNote)
        }, [currentNote.noteId, dueLabel, nextDateString]);    
    } else {
        await api.runOnBackend((currentNoteID) => {
            const currentNote = api.getNote(currentNoteID)
        	currentNote.setLabel("archived")    
        }, [currentNote.noteId])
    }
    api.refreshIncludedNote(currentNote) 
}
run_script()
