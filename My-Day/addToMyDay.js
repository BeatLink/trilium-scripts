/*
    Instructions: Paste the below into a new JS Backend Script note. Set the myDayNoteId variable to the ID of the note you want to use as your My Day 
*/
async function addToMyDay() {    

    let myDayNoteId = "<set-your-my-day-note-here>"
    let currentNote = await api.getActiveContextNote();

    await api.runOnBackend(
        (currentNoteId, myDayNoteId) => {api.toggleNoteInParent(true, currentNoteId, myDayNoteId)}, 
        [currentNote.noteId, myDayNoteId]
    );
}

addToMyDay();
