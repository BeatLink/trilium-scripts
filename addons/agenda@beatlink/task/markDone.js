/*
    Launcher target: advances the active note's start date to its next
    recurrence, or archives the note (and un-archives its children, for a
    checklist-style to-do) if it doesn't recur or its recurrence is exhausted.

    Uses the shared Agenda configuration (owned by agenda-overview@beatlink,
    discovered via #agendaConfig) for the start-date and recurrence label names,
    so it stays in sync with the rest of the Agenda system.
*/
const libRecurrence = require("libRecurrence.js")
const { markDone, markUndone } = require("libAgendaTask.js")
const { getAgendaSettings } = require("agendaSettings.jsx")

function formatDate(date) {
    const pad = (n) => n.toString().padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function run_script() {
    const settings = await getAgendaSettings()
    if (!settings) return
    const dateLabel = settings.constants.START_DATETIME_LABEL
    const recurrenceLabel = settings.constants.RECURRENCE_LABEL

    const note = await api.getActiveContextNote()
    const startDatetime = note.getLabelValue(dateLabel)
    const recurrence = note.getLabelValue(recurrenceLabel)

    if (startDatetime && recurrence) {
        const next = libRecurrence.nextOccurrence(recurrence, new Date(startDatetime))
        if (next) {
            await api.runOnBackend((noteId, dateLabel, newStartDatetime, recurrenceLabel, newRecurrence) => {
                const note = api.getNote(noteId)
                note.setLabel(dateLabel, newStartDatetime)
                note.setLabel(recurrenceLabel, newRecurrence)
            }, [note.noteId, dateLabel, formatDate(next.nextDate), recurrenceLabel, next.recurrence])
            await markUndone(note.noteId)
        } else {
            await markDone(note.noteId)
        }
    } else {
        await markDone(note.noteId)
    }
    api.refreshIncludedNote(note)
}
run_script()
