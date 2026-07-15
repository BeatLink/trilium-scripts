const libRecurrence = require("libRecurrence.js")
const { markDone, markUndone } = require("libAgendaTask.js")
const { getAgendaSettings } = require("agendaSettings.jsx")

async function run_script() {
    function formatDate(date) {
        const pad = (n) => n.toString().padStart(2, '0')
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

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
