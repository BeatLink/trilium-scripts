import { useState, useEffect } from "trilium:preact"
import { activateNote } from "trilium:api"

const { getItemTemplates, getUntemplatedNotes, assignTemplate } = require("workflowOrganize.js")

// The Organize tab's "assign a template" triage queue. Loads every untemplated
// note under the Inbox / Area subtrees, then walks the user through them one at a
// time: each screen shows the note's title, where it lives in the tree, a short
// content preview, and a row of one-click template buttons. Clicking a template
// assigns it and auto-advances to the next note; Skip advances without changing
// anything. See workflowOrganize.js for the backend.
export default function OrganizePanel() {
    const [templates, setTemplates] = useState(null)
    const [queue, setQueue] = useState(null)
    const [index, setIndex] = useState(0)
    const [busy, setBusy] = useState(false)

    async function reload() {
        setQueue(null)
        setIndex(0)
        const [tpls, notes] = await Promise.all([getItemTemplates(), getUntemplatedNotes()])
        setTemplates(tpls)
        setQueue(notes)
    }

    useEffect(() => { reload() }, [])

    const current = queue && index < queue.length ? queue[index] : null

    // Assign the clicked template and advance. One click = assign + next.
    async function pick(templateId) {
        if (!current || busy) return
        setBusy(true)
        try {
            await assignTemplate(current.noteId, templateId)
        } finally {
            setBusy(false)
        }
        setIndex(i => i + 1)
    }

    function skip() {
        if (busy) return
        setIndex(i => i + 1)
    }

    if (queue === null || templates === null) {
        return <div className="workflow-organize">Loading...</div>
    }

    if (templates.length === 0) {
        return (
            <div className="workflow-organize">
                <div className="workflow-window-placeholder">
                    No item templates found. Install the Templates addon (templates@beatlink) so there
                    are types to assign.
                </div>
            </div>
        )
    }

    if (queue.length === 0) {
        return (
            <div className="workflow-organize">
                <div className="workflow-organize-done">
                    Nothing to organize — every note under your Inbox and Areas already has a template.
                </div>
                <button className="workflow-setup-button" onClick={reload}>Re-scan</button>
            </div>
        )
    }

    if (!current) {
        return (
            <div className="workflow-organize">
                <div className="workflow-organize-done">
                    Done — worked through all {queue.length} note{queue.length === 1 ? "" : "s"}.
                </div>
                <button className="workflow-setup-button" onClick={reload}>Re-scan</button>
            </div>
        )
    }

    return (
        <div className="workflow-organize">
            <div className="workflow-organize-progress">
                Note {index + 1} of {queue.length}
            </div>

            <div className="workflow-organize-card">
                <div
                    className="workflow-organize-title"
                    title="Open this note"
                    onClick={() => activateNote(current.noteId)}
                >
                    {current.title || "(untitled)"}
                </div>
                <div className="workflow-organize-path">
                    {current.path || "(top level)"}
                </div>

                {current.preview && (
                    <div className="workflow-organize-preview">{current.preview}</div>
                )}

                <div className="workflow-organize-templates">
                    {templates.map(t => (
                        <button
                            key={t.noteId}
                            className="workflow-organize-template-btn"
                            disabled={busy}
                            onClick={() => pick(t.noteId)}
                        >
                            {t.title}
                        </button>
                    ))}
                </div>

                <div className="workflow-organize-actions">
                    <button className="workflow-organize-skip" disabled={busy} onClick={skip}>
                        Skip
                    </button>
                </div>
            </div>
        </div>
    )
}
