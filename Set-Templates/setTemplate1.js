async function run_script() {
    await api.runOnBackend((currentNoteID) => {
        api.getNote(currentNoteID).setRelation("template", "<path-to-template-1>")         
    }, [await api.getActiveContextNote().noteId]);
}
run_script()
