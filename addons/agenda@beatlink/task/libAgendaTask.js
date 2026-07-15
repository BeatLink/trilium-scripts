const libRecurrence = require("libRecurrence.js")

function frequencyOf(recurrence) {
    if (!recurrence) return "NONE"
    try {
        const obj = libRecurrence.RRuleToObj(recurrence)
        return (obj && obj.enabled && obj.interval) ? obj.interval : "NONE"
    } catch (e) {
        return "NONE"
    }
}

function durationStringToHMS(duration){
    const durationObj = api.dayjs.duration(duration)
    const hours = durationObj.hours();
    const minutes = durationObj.minutes();
    const seconds = durationObj.seconds();
    return {hours, minutes, seconds}
}

function humanizeDuration(duration){
    if (!duration) return ""
    const { hours, minutes, seconds } = durationStringToHMS(duration)
    const parts = []
    if (hours) parts.push(`${hours}h`)
    if (minutes) parts.push(`${minutes}m`)
    if (seconds) parts.push(`${seconds}s`)
    return parts.length ? parts.join(" ") : "0m"
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

async function updateDependentAttributes(noteId, constants) {
    if (noteId) {
        // Humanized here on the frontend: the rrule humanizer isn't reachable
        // inside the serialized runOnBackend closure.
        const frontNote = await api.getNote(noteId)
        const durationDisplay = humanizeDuration(frontNote.getLabelValue(constants.DURATION_LABEL))
        const recurrenceDisplay = libRecurrence.humanize(frontNote.getLabelValue(constants.RECURRENCE_LABEL))

        await api.runOnBackend(
            (noteId, constants, durationDisplay, recurrenceDisplay) => {
            const note = api.getNote(noteId)
            let startDatetime = note.getLabelValue(constants.START_DATETIME_LABEL)
            let dueDatetime = note.getLabelValue(constants.DUE_DATETIME_LABEL)
            let duration = note.getLabelValue(constants.DURATION_LABEL)

            let title = note.title.replace(/\s*\([^)]*\)\s*$/, "")
            let durationString = duration ? ` (${duration.substring(2).toLowerCase()})` : ""
            note.title = `${title}${durationString}`
            note.save()

            if (durationDisplay) note.setLabel("durationDisplay", durationDisplay)
            else note.removeLabel("durationDisplay")
            if (recurrenceDisplay) note.setLabel("recurrenceDisplay", recurrenceDisplay)
            else note.removeLabel("recurrenceDisplay")

            if (startDatetime && duration) {
                dueDatetime = api.dayjs(startDatetime)
                    .add(api.dayjs.duration(duration))
                    .format("YYYY-MM-DDTHH:mm")
                note.setLabel(
                    constants.DUE_DATETIME_LABEL,
                    dueDatetime
                )
            }

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
        }, [noteId, constants, durationDisplay, recurrenceDisplay]);
    }
}

async function complete(noteId, constants){
    const note = await api.getNote(noteId)
    const startDatetime = note.getLabelValue(constants.START_DATETIME_LABEL)
    const recurrence = note.getLabelValue(constants.RECURRENCE_LABEL)
    if (startDatetime && recurrence) {
        const start = api.dayjs(startDatetime).utc().toDate()
        const next = libRecurrence.nextOccurrence(recurrence, start)
        if (next){
            const newStartDatetime = api.dayjs(next.nextDate).local().format("YYYY-MM-DDTHH:mm")
            await api.runOnBackend(
                (noteId, recurrence, startDatetime, constants) => {
                    const note = api.getNote(noteId)
                    note.setLabel(constants.START_DATETIME_LABEL, startDatetime)
                    note.setLabel(constants.RECURRENCE_LABEL, recurrence)
                },
                [noteId, next.recurrence, newStartDatetime, constants]
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
        const timeSource = startDateString ? api.dayjs(startDateString) : api.dayjs()
        const newDate = api.dayjs()
            .add(daysToAdd, 'day')
            .hour(timeSource.hour())
            .minute(timeSource.minute())
            .startOf('minute')
            .format("YYYY-MM-DDTHH:mm")
        note.setLabel(startDateLabel, newDate)
    }, [noteId, daysToAdd, constants.START_DATETIME_LABEL])
    await updateDependentAttributes(noteId, constants)
}

async function refreshDisplayLabels(noteId, constants) {
    if (!noteId) return
    const note = await api.getNote(noteId)
    if (!note) return
    const durationDisplay = humanizeDuration(note.getLabelValue(constants.DURATION_LABEL))
    const recurrenceDisplay = libRecurrence.humanize(note.getLabelValue(constants.RECURRENCE_LABEL))
    if ((note.getLabelValue("durationDisplay") || "") === durationDisplay
        && (note.getLabelValue("recurrenceDisplay") || "") === recurrenceDisplay) return
    await api.runOnBackend((noteId, durationDisplay, recurrenceDisplay) => {
        const note = api.getNote(noteId)
        if (!note) return
        if (durationDisplay) note.setLabel("durationDisplay", durationDisplay)
        else note.removeLabel("durationDisplay")
        if (recurrenceDisplay) note.setLabel("recurrenceDisplay", recurrenceDisplay)
        else note.removeLabel("recurrenceDisplay")
    }, [noteId, durationDisplay, recurrenceDisplay])
}

module.exports = {
    durationStringToHMS,
    humanizeDuration,
    frequencyOf,
    complete,
    markDone,
    markUndone,
    rescheduleByDays,
    updateDependentAttributes,
    refreshDisplayLabels
}
