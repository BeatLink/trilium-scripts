function expand() {
    const scriptNote = api.startNote
    var notes = api.searchForNotes('#alwaysExpanded')
    for (var note of notes) {
        note.setRelation('runOnBranchChange', scriptNote.noteId)
        for (var branch of note.getParentBranches()) {
            if (!branch.isExpanded) {
                branch.isExpanded = true
                branch.save()
            }
        }
    }
    var notesToRemove = api.searchForNotes(`~runOnBranchChange.noteId="${scriptNote.noteId}" AND not(#alwaysExpanded)`)
    for (var noteToRemove of notesToRemove) {
        while (noteToRemove.hasOwnedRelation("runOnBranchChange", scriptNote.noteId)) {
            noteToRemove.removeRelation("runOnBranchChange", scriptNote.noteId)
        }
    }
}
expand()