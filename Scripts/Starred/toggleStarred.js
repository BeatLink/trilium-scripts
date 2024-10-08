/*
    Instructions: 
    Paste the below into a new JS Backend Script note. 
    Add a relationship "~starredNote" pointing to your the note you want to use as your Starred
*/

async function toggleStarred() {    
    let starredNoteId = await api.currentNote.getRelationValue("starredNote")
    let currentNote = await api.getActiveContextNote();
    await api.runOnBackend(
        (currentNoteId, starredNoteId) => {
            let noteInParent = api.getNote(currentNoteId).getParentNotes().some((note) => note.noteId == starredNoteId)
            api.toggleNoteInParent(!noteInParent, currentNoteId, starredNoteId)
        }, 
        [currentNote.noteId, starredNoteId]
    );
}

toggleStarred();

