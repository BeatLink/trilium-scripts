import { useState, useEffect } from "trilium:preact"
import { activateNote } from "trilium:api"

const {
    getItemTemplates, getAreas, getOrganizeCandidates, getMisfiledNotes,
    assignTemplate, assignArea, refileNote, deleteNote
} = require("workflowOrganize.js")

// A one-at-a-time triage section: heading, then a card per item showing the
// note's title (a link), tree path, content preview, a caller-supplied row of
// action buttons, and Back/Forward/Delete nav. The `renderActions(item, act)`
// render-prop supplies the buttons; `act(fn)` runs an async action while the
// card is disabled (busy). Delete removes the note (with a confirm). Sharing this
// shell keeps every Organize section visually and behaviorally identical.
function QueueSection({ heading, items, renderActions, onDelete, emptyMessage }) {
    const [index, setIndex] = useState(0)
    const [busy, setBusy] = useState(false)

    // Cursor clamps naturally when the list shrinks (an action drops an item).
    const current = index < items.length ? items[index] : null

    async function act(fn) {
        if (busy) return
        setBusy(true)
        try {
            await fn()
        } finally {
            setBusy(false)
        }
        // The acted-on item leaves the list, so the same index now points at the
        // next item — don't advance.
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
        await act(() => onDelete(current))
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
                            {renderActions(current, act, busy)}
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

// One-click option button used by the "assign" sections (template / area).
function OptionButton({ opt, busy, onClick }) {
    return (
        <button
            className={
                "workflow-organize-option-btn" +
                (opt.highlighted ? " workflow-organize-option-suggested" : "")
            }
            style={opt.color ? { borderLeft: `4px solid ${opt.color}` } : undefined}
            disabled={busy}
            onClick={onClick}
        >
            {opt.label}
        </button>
    )
}

// The Organize tab. Loads the candidate notes, the misfiled notes, and the
// template/area vocabularies once, then renders the triage sections. Mutations
// update the in-memory lists in place so an acted-on note leaves its queue.
export default function OrganizePanel() {
    const [templates, setTemplates] = useState(null)
    const [areas, setAreas] = useState(null)
    const [candidates, setCandidates] = useState(null)
    const [misfiled, setMisfiled] = useState(null)

    async function reload() {
        setCandidates(null)
        setMisfiled(null)
        const [tpls, ars, cands, mis] = await Promise.all([
            getItemTemplates(), getAreas(), getOrganizeCandidates(), getMisfiledNotes()
        ])
        setTemplates(tpls)
        setAreas(ars)
        setCandidates(cands)
        setMisfiled(mis)
    }

    useEffect(() => { reload() }, [])

    if (candidates === null || templates === null || areas === null || misfiled === null) {
        return <div className="workflow-organize"><div>Loading...</div></div>
    }

    function patch(noteId, changes) {
        setCandidates(cs => cs.map(c => c.noteId === noteId ? { ...c, ...changes } : c))
    }
    function drop(noteId) {
        setCandidates(cs => cs.filter(c => c.noteId !== noteId))
    }
    function dropMisfiled(noteId) {
        setMisfiled(ms => ms.filter(m => m.noteId !== noteId))
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

            <QueueSection
                heading="Notes Without Templates"
                items={untemplated}
                renderActions={(item, act, busy) =>
                    templates.map(t => (
                        <OptionButton
                            key={t.noteId}
                            opt={{ label: t.title }}
                            busy={busy}
                            onClick={() => act(async () => {
                                await assignTemplate(item.noteId, t.noteId)
                                patch(item.noteId, { hasTemplate: true })
                            })}
                        />
                    ))
                }
                onDelete={async (item) => { await deleteNote(item.noteId); drop(item.noteId) }}
                emptyMessage="Nothing to organize — every note under your Inbox and Areas already has a template."
            />

            <QueueSection
                heading="Notes Without Areas"
                items={arealess}
                renderActions={(item, act, busy) =>
                    areas.map(a => (
                        <OptionButton
                            key={a.slug}
                            opt={{ label: a.name, color: a.color, highlighted: a.slug === item.suggestedArea }}
                            busy={busy}
                            onClick={() => act(async () => {
                                await assignArea(item.noteId, a.slug, a.color)
                                patch(item.noteId, { hasArea: true })
                            })}
                        />
                    ))
                }
                onDelete={async (item) => { await deleteNote(item.noteId); drop(item.noteId) }}
                emptyMessage="Nothing to organize — every note under your Inbox and Areas already has an area."
            />

            <QueueSection
                heading="Misfiled Notes"
                items={misfiled}
                renderActions={(item, act, busy) => {
                    const f = item.fixes
                    const reasons = []
                    if (item.areaMisfiled) {
                        reasons.push(`area is ${item.noteArea} but it's filed under ${item.branchArea}`)
                    }
                    if (item.typeMisfiled) {
                        reasons.push(`type is ${item.noteTemplateTitle} but it's in the ${item.branchBucket} bucket`)
                    }
                    const buttons = [
                        <div key="reason" className="workflow-organize-reason">
                            Misfiled: {reasons.join("; ")}.
                        </div>
                    ]
                    if (f.moveTargetNoteId) {
                        buttons.push(
                            <button
                                key="move"
                                className="workflow-organize-option-btn"
                                disabled={busy}
                                onClick={() => act(async () => {
                                    await refileNote(item.noteId, item.currentParentId, f.moveTargetNoteId)
                                    dropMisfiled(item.noteId)
                                })}
                            >
                                Move to {f.moveTargetLabel}
                            </button>
                        )
                    }
                    if (item.areaMisfiled && f.updateAreaTo) {
                        buttons.push(
                            <button
                                key="area"
                                className="workflow-organize-option-btn"
                                disabled={busy}
                                onClick={() => act(async () => {
                                    await assignArea(item.noteId, f.updateAreaTo, f.updateAreaColor)
                                    dropMisfiled(item.noteId)
                                })}
                            >
                                Set area to {f.updateAreaTo}
                            </button>
                        )
                    }
                    if (item.typeMisfiled && f.updateTypeToId) {
                        buttons.push(
                            <button
                                key="type"
                                className="workflow-organize-option-btn"
                                disabled={busy}
                                onClick={() => act(async () => {
                                    await assignTemplate(item.noteId, f.updateTypeToId)
                                    dropMisfiled(item.noteId)
                                })}
                            >
                                Set type to {f.updateTypeToTitle}
                            </button>
                        )
                    }
                    return buttons
                }}
                onDelete={async (item) => { await deleteNote(item.noteId); dropMisfiled(item.noteId) }}
                emptyMessage="Nothing misfiled — every note's area and type match where it lives."
            />
        </div>
    )
}
