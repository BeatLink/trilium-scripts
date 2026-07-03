function getCalendarEvents() {
    
    // Load Script Variables
    let searchCriteria = api.currentNote.getLabelValue("searchCriteria")
    let startDateLabel = api.currentNote.getLabelValue("startDateLabel")
    let dueDateLabel = api.currentNote.getLabelValue("dueDateLabel")
    let icalNoteId = api.currentNote.getRelationValue("icalNote")
    
    // Generate caldav object from found tasks
    let calendar = new icalminjs.Component(['vcalendar', [], []]);
    calendar.updatePropertyWithValue('prodid', '-//Beatlink/Trilium Calendar Script');
    calendar.updatePropertyWithValue('version', '2.0');
    let now = new icalminjs.Time.now()
    for (let task of api.searchForNotes(searchCriteria)) {
        let startDate = task.getLabelValue(startDateLabel) 
        let dueDate = task.getLabelValue(dueDateLabel) 
        let recurrence = task.getLabelValue("recurrence")
    
        
        if (
            (startDate) && (startDate != "")
            && (dueDate) && (dueDate != "")
        ){
            let vevent = new icalminjs.Component("vevent")
            let event = new icalminjs.Event(vevent)
            vevent.updatePropertyWithValue('dtstamp', now);
            event.uid = String(task.noteId)
            event.summary = String(task.title)
            event.startDate = icalminjs.Time.fromJSDate(new Date(startDate))    
            event.endDate = icalminjs.Time.fromJSDate(new Date(dueDate))    
            if (recurrence) {
                vevent.updatePropertyWithValue("rrule", icalminjs.Recur.fromString(recurrence))
            }
            calendar.addSubcomponent(vevent)
        }
    // Save ical data to file
    let icalString = calendar.toString()
    const icalNote = api.getNote(icalNoteId)
    icalNote.setContent(icalString, {forceSave: true})}

}

module.exports.getCalendarEvents = getCalendarEvents
getCalendarEvents()