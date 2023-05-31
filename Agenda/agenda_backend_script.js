// #run=hourly
// To configure date formats use https://day.js.org/docs/en/display/format

var isBetween = require('dayjs/plugin/isBetween')
api.dayjs.extend(isBetween)

async function run_script() {
    // User Set Variables
    let dueDateLabel = "dueDate"
    let dueTimeLabel = "dueTime"
    let overdueNote = "<overdue-note-id>"
    let todayNote = "<today-note-id>"
    let thisWeekNote = "<this-week-note-id>"
    let thisMonthNote = "<this-month-note-id>"
    let thisYearNote = "<this-year-note-id>"
    let futureNote = "<future-note-id>"
    let useNumberOfDays = true     // If set to true, intervals are determined based on number of days

    // Dynamic Variables
    let now = api.dayjs()
    let startOfToday = now.startOf("day")
    let endOfToday = now.endOf("day")
    let endOfThisWeek = useNumberOfDays ? startOfToday.add(7, "day") : now.endOf("week")
    let endOfThisMonth = useNumberOfDays ? startOfToday.add(30, "day") : now.endOf("month")
    let endOfThisYear = useNumberOfDays ? startOfToday.add(365, "day") : now.endOf("year")


    for (let note of api.getNotesWithLabel(dueDateLabel)){
        // Get due date and time
        let dueDatePresent = note.getLabelValue(dueDateLabel) ? true : false
        let dueDate = api.dayjs(note.getLabelValue(dueDateLabel))
        let dueTime = note.hasLabel(dueTimeLabel) ? note.getLabelValue(dueTimeLabel) : ""
        let dueDateString = ""

        // Set Overdue Notes
        let isOverdue = (dueDatePresent && dueDate.isBefore(startOfToday))
        dueDateString = dueDate.format("MMM D, YYYY")
        api.toggleNoteInParent(false, note.noteId, overdueNote)
        api.toggleNoteInParent(isOverdue, note.noteId, overdueNote, dueDateString)

        // Set Today Notes
        let isToday = (dueDatePresent && dueDate.isBetween(startOfToday, endOfToday, null, '[)'))
        dueDateString = dueTime
        api.toggleNoteInParent(false, note.noteId, todayNote)
        api.toggleNoteInParent(isToday, note.noteId, todayNote, dueDateString)

        // Set This Week Notes
        let isThisWeek = (dueDatePresent && dueDate.isBetween(endOfToday, endOfThisWeek, null, '[)'))
        dueDateString = dueDate.format("ddd")
        api.toggleNoteInParent(false, note.noteId, thisWeekNote)
        api.toggleNoteInParent(isThisWeek, note.noteId, thisWeekNote, dueDateString)

        // Set This Month Notes
        let isThisMonth = (dueDatePresent && dueDate.isBetween(endOfThisWeek, endOfThisMonth, null, '[)'))
        dueDateString = dueDate.format("D")
        api.toggleNoteInParent(false, note.noteId, thisMonthNote)
        api.toggleNoteInParent(isThisMonth, note.noteId, thisMonthNote, dueDateString)

        // Set This Year Notes
        let isThisYear = (dueDatePresent && dueDate.isBetween(endOfThisMonth, endOfThisYear, null, '[]'))
        dueDateString = dueDate.format("MMM D")
        api.toggleNoteInParent(false, note.noteId, thisYearNote)
        api.toggleNoteInParent(isThisYear, note.noteId, thisYearNote, dueDateString)

        // Set Future Notes
        let isFuture = (dueDatePresent && dueDate.isAfter(endOfThisYear))
        dueDateString = dueDate.format("YYYY")
        api.toggleNoteInParent(false, note.noteId, futureNote)
        api.toggleNoteInParent(isFuture, note.noteId, futureNote, dueDateString)

    }
}
run_script()
