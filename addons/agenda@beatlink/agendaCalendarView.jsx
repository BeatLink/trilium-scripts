import { useState, useEffect } from "trilium:preact"
import { CalendarWidget } from "CalendarWidget.jsx"

// Thin composition over CalendarWidget — maps a sorted task-note-id list
// straight to a plain FullCalendar events array client-side, rather than
// round-tripping through the ical feed (setCalendarEvents/icalNoteId), so
// this view doesn't depend on that having already run for a virtual-mode
// profile.
export function AgendaCalendarView({ noteIds, constants, onEventClick }) {
    const [events, setEvents] = useState(null)

    useEffect(() => {
        if (!noteIds) return
        (async () => {
            const notes = await Promise.all(noteIds.map(noteId => api.getNote(noteId)))
            setEvents(notes.map(note => ({
                id: note.noteId,
                title: note.title,
                start: note.getLabelValue(constants.START_DATETIME_LABEL),
                end: note.getLabelValue(constants.DUE_DATETIME_LABEL) || undefined
            })).filter(event => event.start))
        })()
    }, [noteIds, constants])

    if (!events) return null

    return (
        <CalendarWidget
            events={events}
            onEventClick={onEventClick ? (event => onEventClick(event.id)) : undefined}
        />
    )
}
