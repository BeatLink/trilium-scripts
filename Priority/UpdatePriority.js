/*
    Instructions: Paste the below into a new JS Backend Script note. 
    Remember to set #run=hourly as a label for this note.
    Set a #priorityLabel= label for the label to store the priority of each note
*/

async function run_script() {  
    let priorityLabel = await api.currentNote.getLabelValue("priorityLabel")
    let searchCriteria = `# #${priorityLabel}`
    var priorityColors = {
        "3-high": "red",
        "2-medium": "yellow",
        "1-low": "blue",
        "0-none": "#D3D3D3"
    }
    for (let note of await api.searchForNotes(searchCriteria)){
        api.log(note.title)
        var priority = note.getLabelValue(priorityLabel)
        api.log(priority)
        let noteID = note.noteId
        let color = priorityColors[priority]
        await api.runOnBackend((noteID, color) => {
            api.getNote(noteID).setLabel("color", color)
        }, [noteID, color])
    }
}
run_script()