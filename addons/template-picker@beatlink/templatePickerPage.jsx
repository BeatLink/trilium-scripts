import { useState, useEffect } from "trilium:preact"
import { activateNote } from "trilium:api"
import { resolveConfigNotes } from "libSettingsUI.jsx"
import { getTemplates, getMissingTemplateNotes, assignTemplate } from "templateRegistry.jsx"

// One-at-a-time triage: heading, a card per note lacking ~template (title,
// path, preview), a button per enabled template, Back/Forward nav. Assigning
// a template drops the note from the list — same shell shape as agenda's
// Organize triage queues, kept local here since template-picker no longer
// depends on agenda.
function MissingTemplatesQueue({ templates, notes, onAssigned }) {
    const [index, setIndex] = useState(0)
    const [busy, setBusy] = useState(false)

    const current = index < notes.length ? notes[index] : null

    async function assign(templateId) {
        if (busy || !current) return
        setBusy(true)
        try {
            const template = templates.find(t => t.noteId === templateId)
            await assignTemplate(current.noteId, templateId, template?.color)
            onAssigned(current.noteId)
        } finally {
            setBusy(false)
        }
    }

    function back() { if (!busy) setIndex(i => Math.max(0, i - 1)) }
    function forward() { if (!busy) setIndex(i => i + 1) }

    return (
        <section className="template-picker-page-section">
            <h3 className="template-picker-page-heading">Missing Templates</h3>
            {notes.length === 0 ? (
                <div className="template-picker-page-done">No notes are missing a template.</div>
            ) : !current ? (
                <div className="template-picker-page-done">
                    Done — worked through all {notes.length} note{notes.length === 1 ? "" : "s"}.
                    <button className="template-picker-page-restart" onClick={() => setIndex(0)}>Start over</button>
                </div>
            ) : (
                <>
                    <div className="template-picker-page-progress">Note {index + 1} of {notes.length}</div>
                    <div className="template-picker-page-card">
                        <div className="template-picker-page-title" title="Open this note" onClick={() => activateNote(current.noteId)}>
                            {current.title || "(untitled)"}
                        </div>
                        <div className="template-picker-page-path">{current.path || "(top level)"}</div>
                        {current.preview && <div className="template-picker-page-preview">{current.preview}</div>}

                        <div className="template-picker-page-options">
                            {templates.length === 0 ? (
                                <span className="template-picker-page-notemplates">
                                    No templates configured — add some in the Templates tab.
                                </span>
                            ) : templates.map(t => (
                                <button
                                    key={t.noteId}
                                    className="template-picker-page-option-btn"
                                    style={t.color ? { borderLeft: `4px solid ${t.color}` } : undefined}
                                    disabled={busy}
                                    onClick={() => assign(t.noteId)}
                                >
                                    {t.name}
                                </button>
                            ))}
                        </div>

                        <div className="template-picker-page-actions">
                            <button className="template-picker-page-nav" disabled={busy || index === 0} onClick={back}>‹ Back</button>
                            <button className="template-picker-page-nav" disabled={busy} onClick={forward}>Forward ›</button>
                        </div>
                    </div>
                </>
            )}
        </section>
    )
}

export default function TemplatePickerMissingPage() {
    const [notes, setNotes] = useState(null)
    const [templates, setTemplates] = useState([])

    useEffect(() => {
        (async () => {
            const { schemaNoteId, configNoteId } = await resolveConfigNotes(api.currentNote)
            if (!schemaNoteId || !configNoteId) return
            const [allTemplates, missing] = await Promise.all([
                getTemplates(schemaNoteId, configNoteId),
                getMissingTemplateNotes(schemaNoteId, configNoteId)
            ])
            setTemplates(allTemplates.filter(t => t.enabled))
            setNotes(missing)
        })()
    }, [])

    if (notes === null) return <div>Loading...</div>

    function onAssigned(noteId) {
        setNotes(list => list.filter(n => n.noteId !== noteId))
    }

    return (
        <div className="template-picker-page">
            <MissingTemplatesQueue templates={templates} notes={notes} onAssigned={onAssigned} />
        </div>
    )
}
