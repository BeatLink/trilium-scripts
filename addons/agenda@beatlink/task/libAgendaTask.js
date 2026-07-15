const libRecurrence = require("libRecurrence.js")

function frequencyOf(recurrence) {
    if (!recurrence) return "NONE"
    try {
        const recurrenceObj = libRecurrence.RRuleToObj(recurrence)
        const hasFrequency = recurrenceObj && recurrenceObj.enabled && recurrenceObj.interval
        return hasFrequency ? recurrenceObj.interval : "NONE"
    } catch (error) {
        return "NONE"
    }
}

function durationStringToHMS(duration) {
    const parsed = api.dayjs.duration(duration)
    return {
        hours: parsed.hours(),
        minutes: parsed.minutes(),
        seconds: parsed.seconds()
    }
}

function humanizeDuration(duration) {
    if (!duration) return ""
    const { hours, minutes, seconds } = durationStringToHMS(duration)
    const parts = []
    if (hours) parts.push(`${hours}h`)
    if (minutes) parts.push(`${minutes}m`)
    if (seconds) parts.push(`${seconds}s`)
    return parts.length ? parts.join(" ") : "0m"
}

async function markUndone(noteId) {
    await api.runOnBackend((noteId) => {
        function markNoteAndChildrenUndone(note) {
            note.setContent(note.getContent().replaceAll('checked="checked"', ""), { forceSave: true })
            note.removeLabel("archived")
            for (const child of note.getChildNotes()) {
                markNoteAndChildrenUndone(child)
            }
        }
        markNoteAndChildrenUndone(api.getNote(noteId))
    }, [noteId])
}

async function markDone(noteId) {
    await api.runOnBackend((noteId) => {
        api.getNote(noteId).setLabel("archived")
    }, [noteId])
}

// Writes the human-readable duration/recurrence labels onto a note.
// Backend-safe: takes already-humanized strings because the rrule humanizer
// is not reachable inside a serialized runOnBackend closure.
function writeDisplayLabelsOnBackend(noteId, durationDisplay, recurrenceDisplay) {
    return api.runOnBackend((noteId, durationDisplay, recurrenceDisplay) => {
        const note = api.getNote(noteId)
        if (!note) return
        if (durationDisplay) note.setLabel("durationDisplay", durationDisplay)
        else note.removeLabel("durationDisplay")
        if (recurrenceDisplay) note.setLabel("recurrenceDisplay", recurrenceDisplay)
        else note.removeLabel("recurrenceDisplay")
    }, [noteId, durationDisplay, recurrenceDisplay])
}

async function updateDependentAttributes(noteId, constants) {
    if (!noteId) return

    const note = await api.getNote(noteId)
    const durationDisplay = humanizeDuration(note.getLabelValue(constants.DURATION_LABEL))
    const recurrenceDisplay = libRecurrence.humanize(note.getLabelValue(constants.RECURRENCE_LABEL))

    await api.runOnBackend((noteId, constants, durationDisplay, recurrenceDisplay) => {
        const note = api.getNote(noteId)
        const startDatetime = note.getLabelValue(constants.START_DATETIME_LABEL)
        const duration = note.getLabelValue(constants.DURATION_LABEL)

        // Append the duration to the title, e.g. "Meeting (1h)".
        const titleWithoutSuffix = note.title.replace(/\s*\([^)]*\)\s*$/, "")
        const durationSuffix = duration ? ` (${duration.substring(2).toLowerCase()})` : ""
        note.title = `${titleWithoutSuffix}${durationSuffix}`
        note.save()

        if (durationDisplay) note.setLabel("durationDisplay", durationDisplay)
        else note.removeLabel("durationDisplay")
        if (recurrenceDisplay) note.setLabel("recurrenceDisplay", recurrenceDisplay)
        else note.removeLabel("recurrenceDisplay")

        // Derive the due datetime from start + duration when both are present.
        let dueDatetime = note.getLabelValue(constants.DUE_DATETIME_LABEL)
        if (startDatetime && duration) {
            dueDatetime = api.dayjs(startDatetime)
                .add(api.dayjs.duration(duration))
                .format("YYYY-MM-DDTHH:mm")
            note.setLabel(constants.DUE_DATETIME_LABEL, dueDatetime)
        }

        // Split start/due datetimes into their separate date and time labels.
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
    }, [noteId, constants, durationDisplay, recurrenceDisplay])
}

// Marks a task complete. Recurring tasks advance to their next occurrence
// and are reset to undone; one-off tasks are archived.
async function complete(noteId, constants) {
    const note = await api.getNote(noteId)
    const startDatetime = note.getLabelValue(constants.START_DATETIME_LABEL)
    const recurrence = note.getLabelValue(constants.RECURRENCE_LABEL)

    const nextOccurrence = (startDatetime && recurrence)
        ? libRecurrence.nextOccurrence(recurrence, api.dayjs(startDatetime).utc().toDate())
        : null

    if (nextOccurrence) {
        const nextStartDatetime = api.dayjs(nextOccurrence.nextDate).local().format("YYYY-MM-DDTHH:mm")
        await api.runOnBackend((noteId, recurrence, startDatetime, constants) => {
            const note = api.getNote(noteId)
            note.setLabel(constants.START_DATETIME_LABEL, startDatetime)
            note.setLabel(constants.RECURRENCE_LABEL, recurrence)
        }, [noteId, nextOccurrence.recurrence, nextStartDatetime, constants])
        await markUndone(noteId)
    } else {
        await markDone(noteId)
    }

    await updateDependentAttributes(noteId, constants)
}

async function rescheduleByDays(noteId, constants, daysToAdd = 0) {
    await api.runOnBackend((noteId, daysToAdd, startDatetimeLabel) => {
        const note = api.getNote(noteId)
        const currentStart = note.getLabelValue(startDatetimeLabel)
        const timeSource = currentStart ? api.dayjs(currentStart) : api.dayjs()
        const newStart = api.dayjs()
            .add(daysToAdd, 'day')
            .hour(timeSource.hour())
            .minute(timeSource.minute())
            .startOf('minute')
            .format("YYYY-MM-DDTHH:mm")
        note.setLabel(startDatetimeLabel, newStart)
    }, [noteId, daysToAdd, constants.START_DATETIME_LABEL])
    await updateDependentAttributes(noteId, constants)
}

// Refreshes the display labels only when they are actually stale, to avoid
// unnecessary backend writes.
async function refreshDisplayLabels(noteId, constants) {
    if (!noteId) return

    const note = await api.getNote(noteId)
    if (!note) return

    const durationDisplay = humanizeDuration(note.getLabelValue(constants.DURATION_LABEL))
    const durationUnchanged = (note.getLabelValue("durationDisplay") || "") === durationDisplay
    
    const recurrenceDisplay = libRecurrence.humanize(note.getLabelValue(constants.RECURRENCE_LABEL))
    const recurrenceUnchanged = (note.getLabelValue("recurrenceDisplay") || "") === recurrenceDisplay
    
    if (durationUnchanged && recurrenceUnchanged) return

    await writeDisplayLabelsOnBackend(noteId, durationDisplay, recurrenceDisplay)
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
