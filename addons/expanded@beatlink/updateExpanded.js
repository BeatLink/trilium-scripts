const { loadSettings } = require("libSettings.js")

function expand() {
    const scriptNote = api.startNote

    // The label to pin on is an addon-wide setting shared with the widget.
    const schemaNoteId = scriptNote.getRelationValue("schemaNote")
    const settingsNoteId = scriptNote.getRelationValue("settingsNote")
    const configNoteId = api.getNote(settingsNoteId).getRelationValue("configNote")
    const { labelName } = loadSettings(schemaNoteId, configNoteId)

    var notes = api.searchForNotes(`#${labelName}`)
    for (var note of notes) {
        note.setRelation('runOnBranchChange', scriptNote.noteId)
        for (var branch of note.getParentBranches()) {
            if (!branch.isExpanded) {
                branch.isExpanded = true
                branch.save()
            }
        }
    }
    var notesToRemove = api.searchForNotes(`~runOnBranchChange.noteId="${scriptNote.noteId}" AND not(#${labelName})`)
    for (var noteToRemove of notesToRemove) {
        while (noteToRemove.hasOwnedRelation("runOnBranchChange", scriptNote.noteId)) {
            noteToRemove.removeRelation("runOnBranchChange", scriptNote.noteId)
        }
    }
}
expand()
