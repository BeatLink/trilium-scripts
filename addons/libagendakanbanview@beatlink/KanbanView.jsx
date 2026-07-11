import { useState } from "trilium:preact"
import { TaskCard } from "TaskCard.jsx"

const UNGROUPED_KEY = "__ungrouped__"

// One column per `columns` entry plus a trailing "Ungrouped" column for
// notes whose groupDict[noteId] doesn't match any column key. Drag-and-drop
// uses native HTML5 DnD (no framework/library for this exists anywhere in
// this repo, and none is needed for a plain reorder-into-column gesture).
export function KanbanView({
    noteIds,
    titles,
    groupDict,
    columns,
    prefixDict,
    colorDict,
    onCardClick,
    onCardMove,
    dragEnabled = false
}) {
    const [draggingId, setDraggingId] = useState(null)
    const [dragOverKey, setDragOverKey] = useState(null)

    if (!columns || columns.length === 0) {
        return <div className="libagendakanbanview-empty">No grouping configured.</div>
    }

    const allColumns = [...columns, { key: UNGROUPED_KEY, display: "Ungrouped", color: null }]
    const notesByColumn = Object.fromEntries(allColumns.map(c => [c.key, []]))
    for (const noteId of noteIds || []) {
        const key = groupDict?.[noteId]
        const targetKey = notesByColumn[key] ? key : UNGROUPED_KEY
        notesByColumn[targetKey].push(noteId)
    }

    return (
        <div className="libagendakanbanview">
            {allColumns.map(column => (
                <div
                    key={column.key}
                    className={"libagendakanbanview-column" + (dragOverKey === column.key ? " libagendakanbanview-column-dragover" : "")}
                    onDragOver={dragEnabled ? (e => { e.preventDefault(); setDragOverKey(column.key) }) : undefined}
                    onDragLeave={dragEnabled ? (() => setDragOverKey(k => k === column.key ? null : k)) : undefined}
                    onDrop={dragEnabled ? (e => {
                        e.preventDefault()
                        setDragOverKey(null)
                        const noteId = e.dataTransfer.getData("text/plain")
                        if (noteId && column.key !== UNGROUPED_KEY && column.droppable !== false) onCardMove?.(noteId, column.key)
                    }) : undefined}
                >
                    <div
                        className="libagendakanbanview-column-header"
                        style={column.color ? { borderTopColor: column.color } : undefined}
                    >
                        {column.display}
                    </div>
                    <div className="libagendakanbanview-column-body">
                        {notesByColumn[column.key].map(noteId => (
                            <div
                                key={noteId}
                                className={draggingId === noteId ? "libagendakanbanview-card-dragging" : undefined}
                            >
                                <TaskCard
                                    noteId={noteId}
                                    title={titles?.[noteId] ?? noteId}
                                    prefix={prefixDict?.[noteId]}
                                    color={colorDict?.[noteId]}
                                    onClick={onCardClick}
                                    draggable={dragEnabled}
                                    onDragStart={(e, id) => {
                                        e.dataTransfer.setData("text/plain", id)
                                        setDraggingId(id)
                                    }}
                                    onDragEnd={() => setDraggingId(null)}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}
