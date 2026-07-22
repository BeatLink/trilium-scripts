import { useState, useEffect } from "trilium:preact"
import { activateNote } from "trilium:api"
import { resolveConfigNotes } from "libSettingsUI.jsx"
import { getActiveProfile, getMissingPriorityNotes, assignPriority } from "priorityRegistry.jsx"

// One-at-a-time triage: heading, a card per note lacking the active profile's
// label (title, path, preview), a button per enabled priority level,
// Back/Forward nav. Assigning a level drops the note from the list — same
// shell shape as area-picker's Missing Areas page.
function MissingPrioritiesQueue({ label, priorities, notes, onAssigned }) {
    const [index, setIndex] = useState(0)
    const [busy, setBusy] = useState(false)

    const current = index < notes.length ? notes[index] : null

    async function assign(key) {
        if (busy || !current) return
        setBusy(true)
        try {
            const priority = priorities.find(p => p.key === key)
            await assignPriority(current.noteId, label, key, priority?.color)
            onAssigned(current.noteId)
        } finally {
            setBusy(false)
        }
    }

    function back() { if (!busy) setIndex(i => Math.max(0, i - 1)) }
    function forward() { if (!busy) setIndex(i => i + 1) }

    return (
        <section className="priority-picker-page-section">
            <h4 className="priority-picker-page-heading">Missing Priorities</h4>
            {notes.length === 0 ? (
                <div className="priority-picker-page-done">No notes are missing a priority.</div>
            ) : !current ? (
                <div className="priority-picker-page-done">
                    Done — worked through all {notes.length} note{notes.length === 1 ? "" : "s"}.
                    <button className="priority-picker-page-restart" onClick={() => setIndex(0)}>Start over</button>
                </div>
            ) : (
                <>
                    <div className="priority-picker-page-progress">Note {index + 1} of {notes.length}</div>
                    <div className="priority-picker-page-card">
                        <div className="priority-picker-page-title" title="Open this note" onClick={() => activateNote(current.noteId)}>
                            {current.title || "(untitled)"}
                        </div>
                        <div className="priority-picker-page-path">{current.path || "(top level)"}</div>
                        {current.preview && <div className="priority-picker-page-preview">{current.preview}</div>}

                        <div className="priority-picker-page-options">
                            {priorities.length === 0 ? (
                                <span className="priority-picker-page-nopriorities">
                                    No priority levels configured — add some in the Profiles tab.
                                </span>
                            ) : priorities.map(p => (
                                <button
                                    key={p.key}
                                    className="priority-picker-page-option-btn"
                                    style={p.color ? { borderLeft: `4px solid ${p.color}` } : undefined}
                                    disabled={busy}
                                    onClick={() => assign(p.key)}
                                >
                                    {p.title}
                                </button>
                            ))}
                        </div>

                        <div className="priority-picker-page-actions">
                            <button className="priority-picker-page-nav" disabled={busy || index === 0} onClick={back}>‹ Back</button>
                            <button className="priority-picker-page-nav" disabled={busy} onClick={forward}>Forward ›</button>
                        </div>
                    </div>
                </>
            )}
        </section>
    )
}

export default function PriorityPickerMissingPage() {
    const [notes, setNotes] = useState(null)
    const [priorities, setPriorities] = useState([])
    const [label, setLabel] = useState("priority")

    useEffect(() => {
        (async () => {
            const { schemaNoteId, configNoteId } = await resolveConfigNotes(api.currentNote)
            if (!schemaNoteId || !configNoteId) return
            const profile = await getActiveProfile(schemaNoteId, configNoteId)
            if (!profile) { setNotes([]); return }

            setLabel(profile.label)
            const missing = await getMissingPriorityNotes(schemaNoteId, configNoteId, profile.label)
            setPriorities(profile.priorities.filter(p => p.enabled))
            setNotes(missing)
        })()
    }, [])

    if (notes === null) return <div>Loading...</div>

    function onAssigned(noteId) {
        setNotes(list => list.filter(n => n.noteId !== noteId))
    }

    return (
        <div className="priority-picker-page">
            <MissingPrioritiesQueue label={label} priorities={priorities} notes={notes} onAssigned={onAssigned} />
        </div>
    )
}
