/*
    Instructions: 
    Paste the below into a new JS Frontend Script note. 
*/

async function hoistNote() {
    let currentNote = await api.getActiveContextNote();
    if (api.getActiveContext().hoistedNoteId == currentNote.noteId) {
	    api.setHoistedNoteId('root')
    } else {
	    api.setHoistedNoteId(currentNote.noteId)
    }
 }

hoistNote();

