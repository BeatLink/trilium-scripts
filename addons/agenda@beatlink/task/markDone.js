const libRecurrence = require("libRecurrence.js")
const { markDone, markUndone } = require("libAgendaTask.js")
const { getAgendaSettings } = require("agendaSettings.jsx")

function formatAsLocalDatetimeLabel(date) {
    const pad = (number) => number.toString().padStart(2, '0')
    const year = date.getFullYear()
    const month = pad(date.getMonth() + 1)
    const day = pad(date.getDate())
    const hours = pad(date.getHours())
    const minutes = pad(date.getMinutes())
    return `${year}-${month}-${day}T${hours}:${minutes}`
}

async function advanceToNextOccurrence(noteId, startDatetimeLabel, recurrenceLabel, nextOccurrence) {
    await api.runOnBackend((noteId, startDatetimeLabel, nextStartDatetime, recurrenceLabel, nextRecurrence) => {
        const note = api.getNote(noteId)
        note.setLabel(startDatetimeLabel, nextStartDatetime)
        note.setLabel(recurrenceLabel, nextRecurrence)
    }, [
        noteId,
        startDatetimeLabel,
        formatAsLocalDatetimeLabel(nextOccurrence.nextDate),
        recurrenceLabel,
        nextOccurrence.recurrence
    ])
    await markUndone(noteId)
}

async function markCurrentTaskDone() {
    const settings = await getAgendaSettings()
    if (!settings) return

    const startDatetimeLabel = settings.constants.START_DATETIME_LABEL
    const recurrenceLabel = settings.constants.RECURRENCE_LABEL

    const note = await api.getActiveContextNote()
    const startDatetime = note.getLabelValue(startDatetimeLabel)
    const recurrence = note.getLabelValue(recurrenceLabel)

    const isRecurringTask = startDatetime && recurrence
    const nextOccurrence = isRecurringTask
        ? libRecurrence.nextOccurrence(recurrence, new Date(startDatetime))
        : null

    if (nextOccurrence) {
        await advanceToNextOccurrence(note.noteId, startDatetimeLabel, recurrenceLabel, nextOccurrence)
    } else {
        await markDone(note.noteId)
    }

    api.refreshIncludedNote(note)
}

markCurrentTaskDone()
