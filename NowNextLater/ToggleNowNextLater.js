/*
    Instructions: Paste the below into a new JS Frontend Script note. 
    Create a relation "~nowNote" pointing to the note for Now
    Create a relation "~nextNote" pointing to the note for Next
    Create a relation "~laterNote" pointing to the note for Later
*/

async function ToggleNowNextLater() {    
    let currentNote = await api.getActiveContextNote();
    let nowNote = await api.currentNote.getRelationValue("nowNote")
    let nextNote = await api.currentNote.getRelationValue("nextNote")
    let laterNote = await api.currentNote.getRelationValue("laterNote")
    await api.runOnBackend(
        (currentNote, nowNote, nextNote, laterNote) => {
            let note = api.getNote(currentNote)
            var found = false;
            for (let parent of note.getParentNotes()){
                if (parent.noteId == nowNote) {
                    api.toggleNoteInParent(false, currentNote, nowNote)        
                    api.toggleNoteInParent(true, currentNote, nextNote)
                    api.toggleNoteInParent(false, currentNote, laterNote)
                    found = true;
                    break;        
                } else if (parent.noteId == nextNote) {
                    api.toggleNoteInParent(false, currentNote, nowNote)        
                    api.toggleNoteInParent(false, currentNote, nextNote)
                    api.toggleNoteInParent(true, currentNote, laterNote)        
                    found = true;
                    break;        
                } else if (parent.noteId == laterNote) {
                    api.toggleNoteInParent(false, currentNote, nowNote)        
                    api.toggleNoteInParent(false, currentNote, nextNote)
                    api.toggleNoteInParent(false, currentNote, laterNote)
                    found = true;
                    break;        
                } 
            }
            if (!found) {
                api.toggleNoteInParent(true, currentNote, nowNote)        
                api.toggleNoteInParent(false, currentNote, nextNote)
                api.toggleNoteInParent(false, currentNote, laterNote)
            } 
        }, 
        [currentNote.noteId, nowNote, nextNote, laterNote]
    );    
}

ToggleNowNextLater();
