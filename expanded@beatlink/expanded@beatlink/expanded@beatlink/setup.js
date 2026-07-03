async function setupExpandedHandler(){
    
    // Get the root note
    const rootNote = await api.getNote('root');
    
    // Get the script note via the 'scriptNote' relation on the current note
    const scriptNote = await api.startNote.getRelationValue('scriptNote');
    
    if (!scriptNote) {
        api.log('No scriptNote relation found on this note.');
        return;
    }

    // Set runOnBranchChange relations on root note
    await api.runOnBackend((rootNoteId, scriptNote) => {
        const rootNote = api.getNote(rootNoteId)
        rootNote.setRelation('runOnBranchChange', scriptNote);
        let relation = rootNote.getRelation('runOnBranchChange')
        relation.isInheritable = true
        relation.save
    }, [rootNote.noteId, scriptNote])
    
}

setupExpandedHandler()