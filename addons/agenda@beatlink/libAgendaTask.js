const libRecurrence = require("libRecurrence.js")

// The clean recurrence-frequency token for a task's `#recurrence` RRULE
// string — one of HOURLY/DAILY/WEEKLY/MONTHLY/YEARLY, or "NONE" when there's
// no (enabled) recurrence. Used to bucket tasks into a Kanban board's columns
// (a raw RRULE string like "FREQ=WEEKLY;INTERVAL=1;..." is unique per task and
// can't be grouped on directly). Returns "NONE" for empty/unparseable input.
function frequencyOf(recurrence) {
    if (!recurrence) return "NONE"
    try {
        const obj = libRecurrence.RRuleToObj(recurrence)
        return (obj && obj.enabled && obj.interval) ? obj.interval : "NONE"
    } catch (e) {
        return "NONE"
    }
}

// Regular expression to capture hours, minutes, seconds
function durationStringToHMS(duration){
    const durationObj = api.dayjs.duration(duration)
    const hours = durationObj.hours();
    const minutes = durationObj.minutes();
    const seconds = durationObj.seconds();
    return {hours, minutes, seconds}
}

// A human-readable duration ("1h 30m", "45m", "2h") from an ISO 8601 duration
// (`PT1H30M`). Returns "" for empty input so it can be used directly as a
// display label value. Only shows non-zero components; falls back to "0m".
function humanizeDuration(duration){
    if (!duration) return ""
    const { hours, minutes, seconds } = durationStringToHMS(duration)
    const parts = []
    if (hours) parts.push(`${hours}h`)
    if (minutes) parts.push(`${minutes}m`)
    if (seconds) parts.push(`${seconds}s`)
    return parts.length ? parts.join(" ") : "0m"
}

// Keeps the derived date/time labels (and the duration suffix on the title) in
// sync whenever the note's own start/due/duration labels change
async function updateDependentAttributes(noteId, constants) {
    if (noteId) {
        // Compute the human-readable display strings up front (frontend): the
        // recurrence humanizer needs the rrule library, which isn't reachable
        // inside the serialized runOnBackend closure. These are stamped as
        // `#durationDisplay`/`#recurrenceDisplay` so the overview's table/grid
        // columns show readable values instead of the raw `PT1H30M` / RRULE.
        const frontNote = await api.getNote(noteId)
        const durationDisplay = humanizeDuration(frontNote.getLabelValue(constants.DURATION_LABEL))
        const recurrenceDisplay = libRecurrence.humanize(frontNote.getLabelValue(constants.RECURRENCE_LABEL))

        await api.runOnBackend(
            (noteId, constants, durationDisplay, recurrenceDisplay) => {
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

            // Human-readable display labels for the overview's table/grid columns.
            if (durationDisplay) note.setLabel("durationDisplay", durationDisplay)
            else note.removeLabel("durationDisplay")
            if (recurrenceDisplay) note.setLabel("recurrenceDisplay", recurrenceDisplay)
            else note.removeLabel("recurrenceDisplay")

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
        }, [noteId, constants, durationDisplay, recurrenceDisplay]);
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
        // Preserve the existing time-of-day when there's an existing start;
        // otherwise (start date null) fall back to the current time-of-day so
        // rescheduling a not-yet-scheduled task still works.
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


// Stamps ONLY the human-readable display labels (`#durationDisplay`/
// `#recurrenceDisplay`) used by the overview's table/grid columns, without
// touching the title/due-date/calendar labels the way updateDependentAttributes
// does. Used by the overview to backfill these labels on tasks it files that
// were never edited through the picker (existing tasks, imports). No-op writes
// are skipped so it doesn't churn notes on routine refreshes.
async function refreshDisplayLabels(noteId, constants) {
    if (!noteId) return
    const note = await api.getNote(noteId)
    if (!note) return
    const durationDisplay = humanizeDuration(note.getLabelValue(constants.DURATION_LABEL))
    const recurrenceDisplay = libRecurrence.humanize(note.getLabelValue(constants.RECURRENCE_LABEL))
    // An absent label reads as null; treat that as "" so an empty display
    // (nothing to show) doesn't count as a change needing a write.
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
