import { useState, useEffect } from "trilium:preact"
import { activateNote } from "trilium:api"
import { resolveConfigNotes } from "libSettingsUI.jsx"
import { getAreas, getMissingAreaNotes, assignArea } from "areaRegistry.jsx"

// One-at-a-time triage: heading, a card per note lacking #area (title, path,
// preview), a button per enabled area, Back/Forward nav. Assigning an area
// drops the note from the list — same shell shape as template-picker's
// Missing Templates page.
function MissingAreasQueue({ areas, notes, onAssigned }) {
    const [index, setIndex] = useState(0)
    const [busy, setBusy] = useState(false)

    const current = index < notes.length ? notes[index] : null

    async function assign(key) {
        if (busy || !current) return
        setBusy(true)
        try {
            const area = areas.find(a => a.key === key)
            await assignArea(current.noteId, key, area?.color)
            onAssigned(current.noteId)
        } finally {
            setBusy(false)
        }
    }

    function back() { if (!busy) setIndex(i => Math.max(0, i - 1)) }
    function forward() { if (!busy) setIndex(i => i + 1) }

    return (
        <section className="area-picker-page-section">
            <h4 className="area-picker-page-heading">Missing Areas</h4>
            {notes.length === 0 ? (
                <div className="area-picker-page-done">No notes are missing an area.</div>
            ) : !current ? (
                <div className="area-picker-page-done">
                    Done — worked through all {notes.length} note{notes.length === 1 ? "" : "s"}.
                    <button className="area-picker-page-restart" onClick={() => setIndex(0)}>Start over</button>
                </div>
            ) : (
                <>
                    <div className="area-picker-page-progress">Note {index + 1} of {notes.length}</div>
                    <div className="area-picker-page-card">
                        <div className="area-picker-page-title" title="Open this note" onClick={() => activateNote(current.noteId)}>
                            {current.title || "(untitled)"}
                        </div>
                        <div className="area-picker-page-path">{current.path || "(top level)"}</div>
                        {current.preview && <div className="area-picker-page-preview">{current.preview}</div>}

                        <div className="area-picker-page-options">
                            {areas.length === 0 ? (
                                <span className="area-picker-page-noareas">
                                    No areas configured — add some in the Areas tab.
                                </span>
                            ) : areas.map(a => (
                                <button
                                    key={a.key}
                                    className="area-picker-page-option-btn"
                                    style={a.color ? { borderLeft: `4px solid ${a.color}` } : undefined}
                                    disabled={busy}
                                    onClick={() => assign(a.key)}
                                >
                                    {a.title}
                                </button>
                            ))}
                        </div>

                        <div className="area-picker-page-actions">
                            <button className="area-picker-page-nav" disabled={busy || index === 0} onClick={back}>‹ Back</button>
                            <button className="area-picker-page-nav" disabled={busy} onClick={forward}>Forward ›</button>
                        </div>
                    </div>
                </>
            )}
        </section>
    )
}

export default function AreaPickerMissingPage() {
    const [notes, setNotes] = useState(null)
    const [areas, setAreas] = useState([])

    useEffect(() => {
        (async () => {
            const { schemaNoteId, configNoteId } = await resolveConfigNotes(api.currentNote)
            if (!schemaNoteId || !configNoteId) return
            const [allAreas, missing] = await Promise.all([
                getAreas(schemaNoteId, configNoteId),
                getMissingAreaNotes(schemaNoteId, configNoteId)
            ])
            setAreas(allAreas.filter(a => a.enabled))
            setNotes(missing)
        })()
    }, [])

    if (notes === null) return <div>Loading...</div>

    function onAssigned(noteId) {
        setNotes(list => list.filter(n => n.noteId !== noteId))
    }

    return (
        <div className="area-picker-page">
            <MissingAreasQueue areas={areas} notes={notes} onAssigned={onAssigned} />
        </div>
    )
}
