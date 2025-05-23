/*
    Instructions: 
    Paste the below into a new JS Frontend Script note. 
*/

async function hoistNote() {
    let currentNote = await api.getActiveContextNote();
    if (api.getActiveContext().hoistedNoteId != "root") {
	    api.setHoistedNoteId('root')
    } else {
	    api.setHoistedNoteId(currentNote.noteId)
    }
 }

hoistNote();

