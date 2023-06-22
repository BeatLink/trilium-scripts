/*
    Instructions: Paste the below into a new JS Backend Script note. Set the note variables to the IDs of the notes you want to use for your categories.
    Remember to set #run=hourly as a label for this note.
    To configure date formats use https://day.js.org/docs/en/display/format
*/

var isBetween = require('dayjs/plugin/isBetween')
api.dayjs.extend(isBetween)

function run_script() {

    // User Set Variables
    let todayNote = "OMvQqT8OVxtf"
    let upcomingNote = "oh7JADla4UBs"
    let dueDateLabel = "dueDate"
    let dueTimeLabel = "dueTime"
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

        api.toggleNoteInParent(false, note.noteId, todayNote)
        api.toggleNoteInParent(false, note.noteId, upcomingNote)

        // Set Today Notes
        let isToday = (dueDatePresent && dueDate.isBefore(endOfToday))
        if (isToday){
            dueDateString = dueTime
            api.toggleNoteInParent(isToday, note.noteId, todayNote, dueDateString)
            continue
        }

        // Set This Week Notes
        let isThisWeek = (dueDatePresent && dueDate.isBetween(endOfToday, endOfThisWeek, null, '[)'))
        if (isThisWeek){
            dueDateString = dueDate.format("ddd")
            api.toggleNoteInParent(isThisWeek, note.noteId, upcomingNote, dueDateString)
            continue
        }

        // Set This Month Notes
        let isThisMonth = (dueDatePresent && dueDate.isBetween(endOfThisWeek, endOfThisMonth, null, '[)'))
        if (isThisMonth) {
            dueDateString = dueDate.format("D")
            api.toggleNoteInParent(isThisMonth, note.noteId, upcomingNote, dueDateString)
            continue
        }

        // Set This Year Notes
        let isThisYear = (dueDatePresent && dueDate.isBetween(endOfThisMonth, endOfThisYear, null, '[]'))
        if (isThisYear){
            dueDateString = dueDate.format("MMM D")
            api.toggleNoteInParent(isThisYear, note.noteId, upcomingNote, dueDateString)
            continue
        }

        // Set Future Notes
        let isFuture = (dueDatePresent && dueDate.isAfter(endOfThisYear))
        if (isFuture){
            dueDateString = dueDate.format("YYYY")
            api.toggleNoteInParent(isFuture, note.noteId, upcomingNote, dueDateString)
        }

    }
}
run_script()
