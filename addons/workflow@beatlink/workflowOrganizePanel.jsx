import { useState, useEffect, FormDropdownList } from "trilium:preact"
import { activateNote } from "trilium:api"

const { getItemTemplates, getUntemplatedNotes, assignTemplate } = require("workflowOrganize.js")

// The Organize tab's "assign a template" triage queue. Loads every untemplated
// note under the Inbox / Area subtrees, then walks the user through them one at a
// time: each screen shows the note's title + where it lives in the tree and a
// template picker. Picking a template assigns it and advances; Skip advances
// without changing anything. See workflowOrganize.js for the backend.
export default function OrganizePanel() {
    const [templates, setTemplates] = useState(null)
    const [queue, setQueue] = useState(null)
    const [index, setIndex] = useState(0)
    const [choice, setChoice] = useState("none")
    const [busy, setBusy] = useState(false)

    async function reload() {
        setQueue(null)
        setIndex(0)
        setChoice("none")
        const [tpls, notes] = await Promise.all([getItemTemplates(), getUntemplatedNotes()])
        setTemplates(tpls)
        setQueue(notes)
    }

    useEffect(() => { reload() }, [])

    const current = queue && index < queue.length ? queue[index] : null

    // Reset the picker each time we land on a new note.
    useEffect(() => { setChoice("none") }, [current && current.noteId])

    async function apply() {
        if (!current || choice === "none") return
        setBusy(true)
        try {
            await assignTemplate(current.noteId, choice)
        } finally {
            setBusy(false)
        }
        setIndex(i => i + 1)
    }

    function skip() {
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

    const templateOptions = [
        { noteId: "none", title: "Select a template..." },
        ...templates.map(t => ({ noteId: t.noteId, title: t.title }))
    ]

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

                <div className="workflow-organize-picker">
                    <FormDropdownList
                        values={templateOptions}
                        currentValue={choice}
                        onChange={setChoice}
                        keyProperty="noteId"
                        titleProperty="title"
                        class="dropdown-component form-control"
                    />
                </div>

                <div className="workflow-organize-actions">
                    <button
                        className="workflow-setup-button"
                        disabled={busy || choice === "none"}
                        onClick={apply}
                    >
                        {busy ? "Assigning..." : "Assign & next"}
                    </button>
                    <button className="workflow-organize-skip" disabled={busy} onClick={skip}>
                        Skip
                    </button>
                </div>
            </div>
        </div>
    )
}
