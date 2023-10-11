async function updateRoutines(){
    let dailyNote = "OLi1tXaNGETm"
    let weeklyNote = "h3f3pIgSFR1L"
    let monthlyNote = "Y8cKiKSdr3A2"
    let yearlyNote = "IOkkH4Bmdi2z"
    let noRecurrenceNote = "Pj92an1vufc8"
    let dueDateLabel = "dueDate"
    let dueTimeLabel = "dueTime"
    let recurrenceLabel = "repeats"
    
    // remove existing notes
    var allIntervals = [dailyNote, weeklyNote, monthlyNote, yearlyNote, noRecurrenceNote]
    for (let parentID of allIntervals) {
        parent = await api.getNote(parentID)
        childNotes = parent.getChildNotes()
        for (let childNote of childNotes){
            await api.ensureNoteIsAbsentFromParent(childNote.noteId, parentID) 
        }
    }
    
    for (let note of api.getNotesWithLabel(recurrenceLabel)){
        const recurrence = note.getLabelValue(recurrenceLabel) ? note.getLabelValue(recurrenceLabel).split("") : ["", ""]
        if (recurrence[1] == "d") {
            let dueTime = note.hasLabel(dueTimeLabel) ? note.getLabelValue(dueTimeLabel) : ""
            api.toggleNoteInParent(true, note.noteId, dailyNote, dueTime)
        } else if (recurrence[1] == "w") {
            let dueTime = note.hasLabel(dueTimeLabel) ? note.getLabelValue(dueTimeLabel) : ""
            let dueDatePresent = note.getLabelValue(dueDateLabel) ? true : false
            let dueDate = note.hasLabel(dueDateLabel) ? api.dayjs(note.getLabelValue(dueDateLabel)).format("ddd") : ""
            api.toggleNoteInParent(true, note.noteId, weeklyNote, dueDate + " " + dueTime)
        } else if (recurrence[1] == "M")  {
            let dueDatePresent = note.getLabelValue(dueDateLabel) ? true : false
            let dueDate = note.hasLabel(dueDateLabel) ? api.dayjs(note.getLabelValue(dueDateLabel)).format("D") : ""
            api.toggleNoteInParent(true, note.noteId, monthlyNote, dueDate)
        } else if (recurrence[1] == "y"){
            let dueDatePresent = note.getLabelValue(dueDateLabel) ? true : false
            let dueDate = note.hasLabel(dueDateLabel) ? api.dayjs(note.getLabelValue(dueDateLabel)).format("MMM D") : ""
            api.toggleNoteInParent(true, note.noteId, yearlyNote, dueDate)        
        }  else {
            api.toggleNoteInParent(true, note.noteId, noRecurrenceNote, "")       
        }
    }
}

//updateRoutines()
