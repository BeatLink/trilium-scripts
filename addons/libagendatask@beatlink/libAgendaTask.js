const libRecurrence = require("libRecurrence.js")

// Regular expression to capture hours, minutes, seconds
function durationStringToHMS(duration){
    const durationObj = api.dayjs.duration(duration)
    const hours = durationObj.hours();
    const minutes = durationObj.minutes();
    const seconds = durationObj.seconds();
    return {hours, minutes, seconds}
}

// Keeps the derived date/time labels (and the duration suffix on the title) in
// sync whenever the note's own start/due/duration labels change
async function updateDependentAttributes(noteId, constants) {
    if (noteId) {
        await api.runOnBackend(
            (noteId, constants) => {
            // Get Required Variables
            const note = api.getNote(noteId)
            let startDatetime = note.getLabelValue(constants.START_DATETIME_LABEL)
            let dueDatetime = note.getLabelValue(constants.DUE_DATETIME_LABEL)
            let duration = note.getLabelValue(constants.DURATION_LABEL)

            // Update the title to include the duration
            let title = note.title.replace(/\s*\([^)]*\)\s*$/, "")
            let durationString = duration ? ` (${duration.substring(2).toLowerCase()})` : ""
            note.title = `${title}${durationString}`
            note.save()

            // Update the Due Datetime if both start datetime and duration is present
            if (startDatetime && duration) {
                dueDatetime = api.dayjs(startDatetime)
                    .add(api.dayjs.duration(duration))
                    .format("YYYY-MM-DDTHH:mm")
                note.setLabel(
                    constants.DUE_DATETIME_LABEL,
                    dueDatetime
                )
            }

            // Update the separate start and due datetimes for calendar functionality
            if (startDatetime) {
                note.setLabel(constants.START_DATE_LABEL, api.dayjs(startDatetime).format("YYYY-MM-DD"))
                note.setLabel(constants.START_TIME_LABEL, api.dayjs(startDatetime).format("HH:mm"))
            } else {
                note.removeLabel(constants.START_DATE_LABEL)
                note.removeLabel(constants.START_TIME_LABEL)
            }
            if (dueDatetime) {
                note.setLabel(constants.DUE_DATE_LABEL, api.dayjs(dueDatetime).format("YYYY-MM-DD"))
                note.setLabel(constants.DUE_TIME_LABEL, api.dayjs(dueDatetime).format("HH:mm"))
            } else {
                note.removeLabel(constants.DUE_DATE_LABEL)
                note.removeLabel(constants.DUE_TIME_LABEL)
            }
        }, [noteId, constants]);
    }
}

async function markUndone(noteId){
    await api.runOnBackend((noteId) => {
        function markUndone(note){
            note.setContent(note.getContent().replaceAll('checked="checked"', ""), {forceSave: true})
            note.removeLabel("archived")
            for (let child of note.getChildNotes()){
                markUndone(child)
            }
        }
        markUndone(api.getNote(noteId))
    }, [noteId]);
}

async function markDone(noteId){
    await api.runOnBackend((noteId) => {
        api.getNote(noteId).setLabel("archived")
    }, [noteId])
}

// Marks a task done, or — if it recurs and has a next occurrence — advances it
// to that next occurrence instead
async function complete(noteId, constants){
    const note = await api.getNote(noteId)
    const startDatetime = note.getLabelValue(constants.START_DATETIME_LABEL)
    const recurrence = note.getLabelValue(constants.RECURRENCE_LABEL)
    if (startDatetime && recurrence) {
        const start =  api.dayjs(startDatetime).utc().toDate()
        var options = libRecurrence.rrule.RRule.parseString(recurrence)
        options.dtstart = start
        var rrule = new libRecurrence.rrule.RRule(options)
        const nextDate = rrule.after(start, false)
        if (nextDate){
            let updatedOptions = libRecurrence.rrule.RRule.parseString(recurrence)
            if (updatedOptions.count){ updatedOptions.count -= 1 }
            const newRecurrence = libRecurrence.cleanRRuleString(
                libRecurrence.rrule.RRule.optionsToString(updatedOptions)
            )
            const newStartDatetime = api.dayjs(nextDate).local().format("YYYY-MM-DDTHH:mm")
            await api.runOnBackend(
                (noteId, recurrence, startDatetime, constants) => {
                    const note = api.getNote(noteId)
                    note.setLabel(constants.START_DATETIME_LABEL, startDatetime)
                    note.setLabel(constants.RECURRENCE_LABEL, recurrence)
                },
                [noteId, newRecurrence, newStartDatetime, constants]
            )
            await markUndone(noteId)
        } else {
            await markDone(noteId)
        }
    }
    await updateDependentAttributes(noteId, constants)
}

async function rescheduleByDays(noteId, constants, daysToAdd = 0){
    await api.runOnBackend((noteId, daysToAdd, startDateLabel) => {
        const note = api.getNote(noteId)
        const startDateString = note.getLabelValue(startDateLabel)
        if (startDateString) {
            const startDate = api.dayjs(startDateString)
            const newDate = api.dayjs()
                .add(daysToAdd, 'day')
                .hour(startDate.hour())
                .minute(startDate.minute())
                .startOf('minute')
                .format("YYYY-MM-DDTHH:mm")
            note.setLabel(startDateLabel, newDate)
        }
    }, [noteId, daysToAdd, constants.START_DATETIME_LABEL])
    await updateDependentAttributes(noteId, constants)
}


module.exports = {
    durationStringToHMS,
    complete,
    rescheduleByDays,
    updateDependentAttributes
}
