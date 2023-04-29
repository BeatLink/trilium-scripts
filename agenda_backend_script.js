// #run=hourly

async function run_script() {
    let overdueNote = "<overdue-note-id>"
    let todayNote = "<today-note-id>"
    let thisWeekNote = "<this-week-note-id>"
    let thisMonthNote = "<this-month-note-id>"
    let thisYearNote = "<this-year-note-id>"
    let futureNote = "<future-note-id>"

    
    var now = api.dayjs()
    var startOfToday = now.startOf("day")
    var endOfToday = now.endOf("day")
    var endOfThisWeek = now.endOf("week")
    var endOfThisMonth = now.endOf("month")
    var endOfThisYear = now.endOf("year")

        
    for (let note of api.getNotesWithLabel("dueDate")){
        let dueDate = api.dayjs(note.getAttribute("label", "dueDate").value)               
        if (dueDate.isBefore(startOfToday)) {
            note.cloneTo(overdueNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, todayNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, thisWeekNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, thisMonthNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, thisYearNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, futureNote)
        } else if (dueDate.isBefore(endOfToday)) {
            note.cloneTo(todayNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, overdueNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, thisWeekNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, thisMonthNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, thisYearNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, futureNote)
        } else if (dueDate.isBefore(endOfThisWeek)) {
            note.cloneTo(thisWeekNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, overdueNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, todayNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, thisMonthNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, thisYearNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, futureNote)
        } else if (dueDate.isBefore(endOfThisMonth)) {
            note.cloneTo(thisMonthNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, overdueNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, todayNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, thisWeekNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, thisYearNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, futureNote)
        } else if (dueDate.isBefore(endOfThisYear)) {
            note.cloneTo(thisYearNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, overdueNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, todayNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, thisWeekNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, thisMonthNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, futureNote)
        }  else {
            note.cloneTo(futureNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, overdueNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, todayNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, thisWeekNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, thisMonthNote)
            api.ensureNoteIsAbsentFromParent(note.noteId, thisYearNote)
        } 
    }
}
run_script()
