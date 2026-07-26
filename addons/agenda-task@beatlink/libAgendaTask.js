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
        // The task lives on at its next occurrence, so it only leaves today if
        // that occurrence isn't today.
        await clearMyDayFlagIfNotToday(noteId, constants)
    } else {
        await markDone(noteId)
        // Done and archived. It keeps its start date, so the "still today"
        // check would wrongly hold the flag - clear it outright.
        await clearMyDayFlag(noteId)
    }

    await updateDependentAttributes(noteId, constants)
}

// Removes #agendaMyDay, the label agenda-myday@beatlink uses to track which
// tasks are on the My Day note. Called when a task stops belonging to today.
// A plain label write: agenda-task does not depend on agenda-myday, and this is
// harmless when that addon isn't installed.
async function clearMyDayFlag(noteId) {
    await api.runOnBackend((noteId) => {
        const note = api.getNote(noteId)
        if (note) note.removeLabel("agendaMyDay")
    }, [noteId])
}

// Clears the My Day flag unless the task's new start date is still today - a
// task pushed to "later today" stays on today's page.
async function clearMyDayFlagIfNotToday(noteId, constants) {
    const note = await api.getNote(noteId)
    if (!note) return
    const startDatetime = note.getLabelValue(constants.START_DATETIME_LABEL)
    if (startDatetime && api.dayjs(startDatetime).isSame(api.dayjs(), "day")) return
    await clearMyDayFlag(noteId)
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
    await clearMyDayFlagIfNotToday(noteId, constants)
    await updateDependentAttributes(noteId, constants)
}

// Reschedules from a Reschedule Options entry: either a fixed number of days
// from now, or the next occurrence (from now) of a recurrence rule. A
// recurrence option that yields nothing (e.g. an exhausted count/until) is a
// no-op.
async function rescheduleByOption(noteId, constants, option) {
    if (option.mode === "recurrence") {
        const nextDate = libRecurrence.nextFromNow(option.recurrence)
        if (!nextDate) return
        const newStart = api.dayjs(nextDate).local().format("YYYY-MM-DDTHH:mm")
        await api.runOnBackend((noteId, startDatetimeLabel, newStart) => {
            api.getNote(noteId).setLabel(startDatetimeLabel, newStart)
        }, [noteId, constants.START_DATETIME_LABEL, newStart])
        await clearMyDayFlagIfNotToday(noteId, constants)
        await updateDependentAttributes(noteId, constants)
        return
    }
    await rescheduleByDays(noteId, constants, option.days)
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
    rescheduleByOption,
    updateDependentAttributes,
    refreshDisplayLabels,
    clearMyDayFlag,
    clearMyDayFlagIfNotToday,
    // Re-exported from libRecurrence so consumers that already require this
    // module (e.g. the Task widget) reach the recurrence helpers through a
    // single require path instead of bundling libRecurrence a second time.
    RRuleToObj: libRecurrence.RRuleToObj,
    ObjToRRule: libRecurrence.ObjToRRule
}
