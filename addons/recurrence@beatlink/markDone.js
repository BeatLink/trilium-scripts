/*
    Launcher target: advances the active note's configured date label to its
    next recurrence, or archives the note (and un-archives its children, for
    a checklist-style to-do) if it doesn't recur or its recurrence is
    exhausted.
*/
const libRecurrence = require("libRecurrence.js")
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
        const start = new Date(startDatetime)
        const options = libRecurrence.rrule.RRule.parseString(recurrence)
        options.dtstart = start
        const rule = new libRecurrence.rrule.RRule(options)
        // Guards the exhausted-recurrence case (a COUNT/UNTIL-bounded rule
        // with nothing left after `start`) — rrule.after() returns null
        // there, which the original version of this script didn't check for.
        const nextDate = rule.after(start, false)

        if (nextDate) {
            let updatedOptions = libRecurrence.rrule.RRule.parseString(recurrence)
            if (updatedOptions.count) updatedOptions.count -= 1
            const newRecurrence = libRecurrence.cleanRRuleString(
                libRecurrence.rrule.RRule.optionsToString(updatedOptions)
            )
            const newStartDatetime = formatDate(nextDate)
            await api.runOnBackend((noteId, dateLabel, newStartDatetime, recurrenceLabel, newRecurrence) => {
                const note = api.getNote(noteId)
                note.setContent(note.getContent().replaceAll('checked="checked"', ""), { forceSave: true })
                note.setLabel(dateLabel, newStartDatetime)
                note.setLabel(recurrenceLabel, newRecurrence)
                note.removeLabel("archived")
                function unarchiveChildren(childNote) {
                    childNote.removeLabel("archived")
                    for (const child of childNote.getChildNotes()) unarchiveChildren(child)
                }
                unarchiveChildren(note)
            }, [note.noteId, dateLabel, newStartDatetime, recurrenceLabel, newRecurrence])
        } else {
            await api.runOnBackend((noteId) => {
                api.getNote(noteId).setLabel("archived")
            }, [note.noteId])
        }
    } else {
        await api.runOnBackend((noteId) => {
            api.getNote(noteId).setLabel("archived")
        }, [note.noteId])
    }
    api.refreshIncludedNote(note)
}
run_script()
