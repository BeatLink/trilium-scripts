import { TaskCard } from "TaskCard.jsx"

// Renders a flat, already-sorted list of TaskCards. There's no parent/child
// structure to nest here — the note ids this receives (e.g. from
// libagendaoverview@beatlink's getSortedTaskList) are a flat filtered+sorted
// array, matching what the reparenting flow already flattens into one
// parent today.
export function TreeView({ noteIds, titles, prefixDict, colorDict, onCardClick }) {
    if (!noteIds || noteIds.length === 0) {
        return <div className="libagendatreeview-empty">No tasks.</div>
    }

    return (
        <div className="libagendatreeview">
            {noteIds.map(noteId => (
                <TaskCard
                    key={noteId}
                    noteId={noteId}
                    title={titles?.[noteId] ?? noteId}
                    prefix={prefixDict?.[noteId]}
                    color={colorDict?.[noteId]}
                    onClick={onCardClick}
                />
            ))}
        </div>
    )
}
