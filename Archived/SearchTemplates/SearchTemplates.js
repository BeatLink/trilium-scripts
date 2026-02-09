/*

    This script searches for notes of a given label and clones them as a subnote of a parent note

    Paste the below into a new JS Frontend Script note. 
    Set #run=hourly as a label for this note.
    Add labels in the format #TemplateMap="ParentNoteID=TemplateNoteID"
    For all the notes with TemplateNoteID, they will be cloned as a child of ParentNoteID    
*/

// User Set Variables -----------------------------------------------------------------

await api.runOnBackend(() => {
    let templateMap = api.currentNote.getLabelValues("TemplateMap")
    for (let label of templateMap) {
        let parent = label.split('=')[0]
        let template = label.split('=')[1]

        // delete all children
        for (let note of api.searchForNotes(`note.parents.noteId=${parent}`)){
            api.toggleNoteInParent(false, note.noteId, parent)
        }    

        // get notes matching search
            for (let note of api.searchForNotes(`~template.noteId="${template}" AND not(note.parents.relations.template.noteId="${template}")`)){
                api.toggleNoteInParent(true, note.noteId, parent)
            }
        } 
})
