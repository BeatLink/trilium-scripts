/*
    Launcher target: advances the active note's configured date label to its
    next recurrence, or archives the note (and un-archives its children, for
    a checklist-style to-do) if it doesn't recur or its recurrence is
    exhausted.
*/
const libRecurrence = require("libRecurrence.js")
const { markDone, markUndone } = require("libAgendaTask.js")
const { loadSettings } = require("libSettingsUI.jsx")

function formatDate(date) {
    const pad = (n) => n.toString().padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function run_script() {
    const schemaNoteId = await api.currentNote.getRelationValue("schemaNote")
    const settingsNoteId = await api.currentNote.getRelationValue("settingsNote")
    const configNoteId = await api.runOnBackend((settingsNoteId) => {
        return api.getNote(settingsNoteId).getRelationValue("AddonData:config")
    }, [settingsNoteId])
    const { dateLabel, recurrenceLabel } = await loadSettings(schemaNoteId, configNoteId)

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
