import { useState, useEffect } from "trilium:preact"
import { activateNote } from "trilium:api"

const {
    getItemTemplates, getAreas, getOrganizeCandidates,
    assignTemplate, assignArea, deleteNote
} = require("workflowOrganize.js")

// A generic one-at-a-time triage queue: shows each item's title (a link to the
// note), tree path, content preview, and a row of one-click option buttons.
// Clicking an option calls onPick and auto-advances; Back/Forward move without
// changing anything; Delete removes the note (with a confirm). Used for both the
// "Notes Without Templates" and "Notes Without Areas" sections.
function TriageQueue({ heading, items, options, onPick, onDelete, emptyMessage }) {
    const [index, setIndex] = useState(0)
    const [busy, setBusy] = useState(false)

    // Clamp the cursor when the item list shrinks (an action removes an item).
    const current = index < items.length ? items[index] : null

    async function pick(optionKey) {
        if (!current || busy) return
        setBusy(true)
        try {
            await onPick(current, optionKey)
        } finally {
            setBusy(false)
        }
        // The acted-on item leaves the list, so the same index now points at the
        // next item — don't advance. If it was the last, index falls off the end
        // and the done state shows.
    }

    function back() {
        if (busy) return
        setIndex(i => Math.max(0, i - 1))
    }

    function forward() {
        if (busy) return
        setIndex(i => i + 1)
    }

    async function remove() {
        if (!current || busy) return
        if (!window.confirm(`Delete note "${current.title || "(untitled)"}"? This cannot be undone.`)) return
        setBusy(true)
        try {
            await onDelete(current)
        } finally {
            setBusy(false)
        }
    }

    return (
        <section className="workflow-organize-section">
            <h3 className="workflow-organize-heading">{heading}</h3>
            {items.length === 0 ? (
                <div className="workflow-organize-done">{emptyMessage}</div>
            ) : !current ? (
                <div className="workflow-organize-done">
                    Done — worked through all {items.length} note{items.length === 1 ? "" : "s"}.
                    <button className="workflow-organize-restart" onClick={() => setIndex(0)}>
                        Start over
                    </button>
                </div>
            ) : (
                <>
                    <div className="workflow-organize-progress">
                        Note {index + 1} of {items.length}
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

                        <div className="workflow-organize-options">
                            {options(current).map(opt => (
                                <button
                                    key={opt.key}
                                    className={
                                        "workflow-organize-option-btn" +
                                        (opt.highlighted ? " workflow-organize-option-suggested" : "")
                                    }
                                    style={opt.color ? { borderLeft: `4px solid ${opt.color}` } : undefined}
                                    disabled={busy}
                                    onClick={() => pick(opt.key)}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>

                        <div className="workflow-organize-actions">
                            <button
                                className="workflow-organize-nav"
                                disabled={busy || index === 0}
                                onClick={back}
                            >
                                ‹ Back
                            </button>
                            <button className="workflow-organize-nav" disabled={busy} onClick={forward}>
                                Forward ›
                            </button>
                            <button className="workflow-organize-delete" disabled={busy} onClick={remove}>
                                Delete
                            </button>
                        </div>
                    </div>
                </>
            )}
        </section>
    )
}

// The Organize tab. Loads the candidate notes + the template/area vocabularies
// once, then renders two triage sections over the same candidate list: notes
// missing a ~template, and notes missing an #area. Mutations update the shared
// candidate list in place so an acted-on note leaves the relevant queue.
export default function OrganizePanel() {
    const [templates, setTemplates] = useState(null)
    const [areas, setAreas] = useState(null)
    const [candidates, setCandidates] = useState(null)

    async function reload() {
        setCandidates(null)
        const [tpls, ars, cands] = await Promise.all([
            getItemTemplates(), getAreas(), getOrganizeCandidates()
        ])
        setTemplates(tpls)
        setAreas(ars)
        setCandidates(cands)
    }

    useEffect(() => { reload() }, [])

    if (candidates === null || templates === null || areas === null) {
        return (
            <div className="workflow-organize">
                <div>Loading...</div>
            </div>
        )
    }

    function patch(noteId, changes) {
        setCandidates(cs => cs.map(c => c.noteId === noteId ? { ...c, ...changes } : c))
    }
    function drop(noteId) {
        setCandidates(cs => cs.filter(c => c.noteId !== noteId))
    }

    const untemplated = candidates.filter(c => !c.hasTemplate)
    const arealess = candidates.filter(c => !c.hasArea)

    return (
        <div className="workflow-organize">
            {templates.length === 0 && (
                <div className="workflow-window-placeholder">
                    No item templates found. Install the Templates addon (templates@beatlink) so there
                    are types to assign.
                </div>
            )}

            <TriageQueue
                heading="Notes Without Templates"
                items={untemplated}
                options={() => templates.map(t => ({ key: t.noteId, label: t.title }))}
                onPick={async (item, templateId) => {
                    await assignTemplate(item.noteId, templateId)
                    patch(item.noteId, { hasTemplate: true })
                }}
                onDelete={async (item) => { await deleteNote(item.noteId); drop(item.noteId) }}
                emptyMessage="Nothing to organize — every note under your Inbox and Areas already has a template."
            />

            <TriageQueue
                heading="Notes Without Areas"
                items={arealess}
                options={(item) => areas.map(a => ({
                    key: a.slug,
                    label: a.name,
                    color: a.color,
                    highlighted: a.slug === item.suggestedArea
                }))}
                onPick={async (item, slug) => {
                    const area = areas.find(a => a.slug === slug)
                    await assignArea(item.noteId, slug, area ? area.color : "")
                    patch(item.noteId, { hasArea: true })
                }}
                onDelete={async (item) => { await deleteNote(item.noteId); drop(item.noteId) }}
                emptyMessage="Nothing to organize — every note under your Inbox and Areas already has an area."
            />
        </div>
    )
}
