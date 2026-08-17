import { useState, useEffect } from "trilium:preact"
import { activateNote } from "trilium:api"
import { DimensionsPanel } from "organizeDimensions.jsx"

const {
    getBucketTemplates, getOrganizeCandidates, getMisfiledNotes, getInvalidBuckets,
    assignStartDate, assignTemplate, refileNote, deleteNote, mergeBucketInto
} = require("organize.js")
const { getDimensions, assignDimension } = require("dimensions.js")
const { getTimeSettings } = require("organizeSettings.js")

// Compute the YYYY-MM-DD for each quick date option, relative to today, using
// api.dayjs (bundled with Trilium). "Next weekend" = the upcoming Saturday.
function quickDates() {
    const now = api.dayjs()
    const fmt = d => d.format("YYYY-MM-DD")
    // Days until the next Saturday (day 6); if today is Saturday, jump a week.
    const daysToSat = ((6 - now.day()) + 7) % 7 || 7
    return [
        { key: "today",        label: "Today",         date: fmt(now) },
        { key: "tomorrow",     label: "Tomorrow",      date: fmt(now.add(1, "day")) },
        { key: "nextWeek",     label: "Next Week",     date: fmt(now.add(1, "week")) },
        { key: "nextWeekend",  label: "Next Weekend",  date: fmt(now.add(daysToSat, "day")) },
        { key: "nextMonth",    label: "Next Month",    date: fmt(now.add(1, "month")) }
    ]
}

// The two-step date+time picker for the "No Due Date" section. The user picks a
// date (quick button or custom) AND a time (morning/noon/evening/night from
// settings, or custom); once BOTH are set the note's start date is written and
// it auto-advances (the note leaves the filtered list). A preview shows the
// combined datetime as it's built.
function DueDatePicker({ item, act, busy, times, onAssigned }) {
    const [date, setDate] = useState("")
    const [time, setTime] = useState("")

    // Reset the picks each time we land on a new note.
    useEffect(() => { setDate(""); setTime("") }, [item.noteId])

    // When both are chosen, write the start date and drop the note from the queue.
    useEffect(() => {
        if (date && time && !busy) {
            act(async () => {
                await assignStartDate(item.noteId, date, time)
                onAssigned(item.noteId)
            })
        }
        // eslint-disable-next-line
    }, [date, time])

    const dates = quickDates()
    const timeOptions = [
        { key: "morning", label: "Morning", value: times.morning },
        { key: "noon",    label: "Noon",    value: times.noon },
        { key: "evening", label: "Evening", value: times.evening },
        { key: "night",   label: "Night",   value: times.night }
    ]

    return (
        <div className="workflow-duedate">
            <div className="workflow-duedate-row">
                <span className="workflow-duedate-label">Date:</span>
                {dates.map(d => (
                    <button
                        key={d.key}
                        className={"workflow-organize-option-btn" + (date === d.date ? " workflow-organize-option-suggested" : "")}
                        disabled={busy}
                        onClick={() => setDate(d.date)}
                    >
                        {d.label}
                    </button>
                ))}
                <input
                    type="date"
                    className="workflow-duedate-input"
                    value={date}
                    disabled={busy}
                    onChange={e => setDate(e.target.value)}
                />
            </div>

            <div className="workflow-duedate-row">
                <span className="workflow-duedate-label">Time:</span>
                {timeOptions.map(t => (
                    <button
                        key={t.key}
                        className={"workflow-organize-option-btn" + (time === t.value ? " workflow-organize-option-suggested" : "")}
                        disabled={busy}
                        onClick={() => setTime(t.value)}
                    >
                        {t.label} <span className="workflow-duedate-time">{t.value}</span>
                    </button>
                ))}
                <input
                    type="time"
                    className="workflow-duedate-input"
                    value={time}
                    disabled={busy}
                    onChange={e => setTime(e.target.value)}
                />
            </div>

            <div className="workflow-duedate-preview">
                {date && time
                    ? `Starts ${date} at ${time}`
                    : `Pick a date and a time${date ? ` (date: ${date})` : ""}${time ? ` (time: ${time})` : ""}.`}
            </div>
        </div>
    )
}

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

// One-click option button used by the per-dimension "assign" sections.
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

// One row of the Invalid Buckets table: the offending bucket, why it's invalid,
// its note count, and the merge-target picker + Merge / Delete actions. Merge
// folds the bucket's notes into the selected valid bucket (mergeBucketInto) then
// drops the row; Delete cascade-deletes it (confirm warns when it holds notes).
function InvalidBucketRow({ item, targets, onMerged, onDeleted }) {
    const [targetId, setTargetId] = useState(targets[0] ? targets[0].noteId : "")
    const [busy, setBusy] = useState(false)

    async function run(fn) {
        if (busy) return
        setBusy(true)
        try { await fn() } finally { setBusy(false) }
    }

    async function merge() {
        const target = targets.find(t => t.noteId === targetId)
        if (!target) return
        await run(async () => {
            const r = await mergeBucketInto(item.noteId, target.noteId)
            if (r.deleted) onMerged(item.noteId)
            else window.alert(
                `Merged ${r.moved} note${r.moved === 1 ? "" : "s"} into ${target.label}, ` +
                `but the empty bucket was kept: ${r.keptReason}.`)
        })
    }

    // Buckets are structural, so deleteNote() refuses them unless the subtree is
    // explicitly acknowledged. A bucket with notes inside should be merged, not
    // deleted — the confirm says so, and only an empty one deletes on one click.
    async function remove() {
        if (item.childCount > 0) {
            window.alert(
                `"${item.title || "(untitled)"}" still holds ${item.childCount} note${item.childCount === 1 ? "" : "s"}. ` +
                `Merge it into a valid bucket first — that moves those notes across, ` +
                `then removes the emptied bucket. Deleting here would take them with it.`)
            return
        }
        if (!window.confirm(`Delete empty bucket "${item.title || "(untitled)"}"? This cannot be undone.`)) return
        await run(async () => {
            const r = await deleteNote(item.noteId, { allowSubtree: true, allowStructural: true })
            if (r && r.deleted === false) throw new Error(r.refusedReason || "delete refused")
            onDeleted(item.noteId)
        })
    }

    return (
        <tr className="invalid-buckets-row">
            <td className="invalid-buckets-name">
                <span
                    className="invalid-buckets-title"
                    title="Open this note"
                    onClick={() => activateNote(item.noteId)}
                >
                    {item.title || "(untitled)"}
                </span>
                {item.path && <span className="invalid-buckets-path">{item.path}</span>}
            </td>
            <td className="invalid-buckets-reason">{item.reason}</td>
            <td className="invalid-buckets-count">{item.childCount}</td>
            <td className="invalid-buckets-actions">
                {targets.length > 0 ? (
                    <>
                        <select
                            className="invalid-buckets-select"
                            value={targetId}
                            disabled={busy}
                            onChange={e => setTargetId(e.target.value)}
                        >
                            {targets.map(t => (
                                <option key={t.noteId} value={t.noteId}>{t.label}</option>
                            ))}
                        </select>
                        <button className="workflow-organize-option-btn" disabled={busy} onClick={merge}>
                            Merge
                        </button>
                    </>
                ) : (
                    <span className="invalid-buckets-notarget">No valid bucket to merge into</span>
                )}
                <button className="workflow-organize-delete" disabled={busy} onClick={remove}>
                    Delete
                </button>
            </td>
        </tr>
    )
}

// The Invalid Buckets section: all invalid buckets at once as a table (they're a
// cleanup list, not a one-at-a-time triage flow), a row per bucket. Empty state
// mirrors the queue sections' "done" message.
function InvalidBucketsTable({ items, targets, onMerged, onDeleted }) {
    return (
        <section className="workflow-organize-section">
            <h3 className="workflow-organize-heading">Invalid Buckets</h3>
            {items.length === 0 ? (
                <div className="workflow-organize-done">
                    No invalid buckets — every scaffolded bucket maps to a current area and type.
                </div>
            ) : (
                <table className="invalid-buckets-table">
                    <thead>
                        <tr>
                            <th>Bucket</th>
                            <th>Why Invalid</th>
                            <th>Notes</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map(item => (
                            <InvalidBucketRow
                                key={item.noteId}
                                item={item}
                                targets={targets}
                                onMerged={onMerged}
                                onDeleted={onDeleted}
                            />
                        ))}
                    </tbody>
                </table>
            )}
        </section>
    )
}

// The Triage tab. Loads the candidate notes, the misfiled notes, and the
// dimension vocabulary once, then renders one triage queue per triaged dimension
// (plus the start-date queue and the misfiled queue). Mutations update the
// in-memory lists in place so an acted-on note leaves its queue.
function TriagePanel() {
    const [dimensions, setDimensions] = useState(null)
    const [bucketTemplates, setBucketTemplates] = useState([])
    const [candidates, setCandidates] = useState(null)
    const [misfiled, setMisfiled] = useState(null)
    const [invalidBuckets, setInvalidBuckets] = useState(null)
    const [bucketTargets, setBucketTargets] = useState([])
    const [times, setTimes] = useState(null)

    async function reload() {
        setCandidates(null)
        setMisfiled(null)
        setInvalidBuckets(null)
        // The dimension vocabulary (area, priority, any user-added) drives the
        // per-dimension triage queues. Item TYPE is no longer a dimension — the
        // misfiled axis and the actionable-only gate both key on template-picker's
        // own registry instead (getBucketTemplates), via ~template.
        const dims = await getDimensions()
        const rootDim = dims.find(d => d.scaffoldsAreas) || { label: "area", values: [] }
        const templates = await getBucketTemplates()
        const actionableTemplateIds = templates.filter(t => t.actionable).map(t => t.noteId)

        const [cands, mis, invalid, tms] = await Promise.all([
            getOrganizeCandidates(dims.map(d => d.label), actionableTemplateIds),
            getMisfiledNotes(rootDim, templates),
            getInvalidBuckets(rootDim, templates),
            getTimeSettings()
        ])
        setDimensions(dims)
        setBucketTemplates(templates)
        setCandidates(cands)
        setMisfiled(mis)
        setInvalidBuckets(invalid.invalid)
        setBucketTargets(invalid.targets)
        setTimes(tms)
    }

    useEffect(() => { reload() }, [])

    if (candidates === null || dimensions === null || misfiled === null ||
        invalidBuckets === null || times === null) {
        return <div className="workflow-organize"><div>Loading...</div></div>
    }

    // The Area dimension drives the misfiled queue's area fix (re-tags #area);
    // the bucket fix re-points ~template instead, using template-picker's
    // registry. The set of actionable templates' noteIds gates the
    // actionable-only queues.
    const rootDim = dimensions.find(d => d.scaffoldsAreas)
    const actionableTemplateIds = new Set(
        bucketTemplates.filter(t => t.actionable).map(t => t.noteId))

    // Record a dimension value onto a candidate's in-memory `assigned` map so the
    // acted-on note leaves that dimension's queue.
    function patchAssigned(noteId, label, key) {
        setCandidates(cs => cs.map(c =>
            c.noteId === noteId ? { ...c, assigned: { ...c.assigned, [label]: key } } : c))
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
    function dropInvalidBucket(noteId) {
        setInvalidBuckets(bs => bs.filter(b => b.noteId !== noteId))
    }

    // Queue Delete is for junk captured into the Inbox, so it deletes a leaf on
    // one click but asks before cascading a subtree, and never silently drops a
    // row the backend refused to delete.
    async function removeQueueItem(item, dropRow) {
        let r = await deleteNote(item.noteId)
        if (r && r.deleted === false && r.descendantCount > 0) {
            const ok = window.confirm(
                `"${item.title || "(untitled)"}" has ${r.descendantCount} note${r.descendantCount === 1 ? "" : "s"} ` +
                `inside it. Delete all of them? This cannot be undone.`)
            if (!ok) return
            r = await deleteNote(item.noteId, { allowSubtree: true })
        }
        if (r && r.deleted === false) {
            window.alert(`Not deleted: ${r.refusedReason}`)
            return
        }
        dropRow(item.noteId)
    }

    // The dimensions that get a triage queue, in config order. A queue lists the
    // candidates with no value for that dimension; an actionableOnly dimension
    // restricts to actionable-typed items (and, being about scheduling-shaped
    // work, excludes subtasks the same way the start-date queue does).
    const triaged = dimensions.filter(d => d.triage && d.values.length)
    function queueItems(dim) {
        return candidates.filter(c => {
            if (c.assigned[dim.label]) return false
            if (dim.actionableOnly && !(actionableTemplateIds.has(c.templateId) && !c.isSubtask)) return false
            return true
        })
    }

    // Actionable items with no start date (#startDateTime) yet. Subtasks (filed
    // under a parent actionable note) are excluded — scheduled with the parent.
    const noStartDate = candidates.filter(c =>
        !c.hasStartDate && !c.isSubtask && actionableTemplateIds.has(c.templateId))

    return (
        <div className="workflow-organize">
            {dimensions.length === 0 && (
                <div className="workflow-window-placeholder">
                    No dimensions configured. Add area/priority (or your own) in the Dimensions
                    tab so there are values to assign.
                </div>
            )}

            {triaged.map(dim => (
                <QueueSection
                    key={dim.id}
                    heading={`Notes Without ${dim.name}`}
                    items={queueItems(dim)}
                    renderActions={(item, act, busy) =>
                        dim.values.map(v => (
                            <OptionButton
                                key={v.key}
                                opt={{ label: v.name, color: v.color, highlighted: v.key === item.suggested[dim.label] }}
                                busy={busy}
                                onClick={() => act(async () => {
                                    await assignDimension(item.noteId, dim, v)
                                    patchAssigned(item.noteId, dim.label, v.key)
                                })}
                            />
                        ))
                    }
                    onDelete={async (item) => { await removeQueueItem(item, drop) }}
                    emptyMessage={`Nothing to organize — every note under your Inbox and Areas already has ${dim.name.toLowerCase()}.`}
                />
            ))}

            <QueueSection
                heading="Tasks Without a Start Date"
                items={noStartDate}
                renderActions={(item, act, busy) => (
                    <DueDatePicker
                        item={item}
                        act={act}
                        busy={busy}
                        times={times}
                        onAssigned={(noteId) => patch(noteId, { hasStartDate: true })}
                    />
                )}
                onDelete={async (item) => { await removeQueueItem(item, drop) }}
                emptyMessage="Nothing to organize — every routine, task, project, and future item has a start date."
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
                        reasons.push(`type is ${item.noteTemplateTitle || "(unknown)"} but it's filed in a different bucket`)
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
                    if (item.areaMisfiled && f.updateAreaTo && rootDim) {
                        buttons.push(
                            <button
                                key="area"
                                className="workflow-organize-option-btn"
                                disabled={busy}
                                onClick={() => act(async () => {
                                    await assignDimension(item.noteId, rootDim,
                                        { key: f.updateAreaTo, color: f.updateAreaColor })
                                    dropMisfiled(item.noteId)
                                })}
                            >
                                Set {rootDim.name.toLowerCase()} to {f.updateAreaTo}
                            </button>
                        )
                    }
                    if (item.typeMisfiled && f.updateTemplateTo) {
                        buttons.push(
                            <button
                                key="type"
                                className="workflow-organize-option-btn"
                                disabled={busy}
                                onClick={() => act(async () => {
                                    await assignTemplate(item.noteId, f.updateTemplateTo)
                                    dropMisfiled(item.noteId)
                                })}
                            >
                                Set type to {f.updateTemplateToTitle || "(unknown)"}
                            </button>
                        )
                    }
                    return buttons
                }}
                onDelete={async (item) => { await removeQueueItem(item, dropMisfiled) }}
                emptyMessage="Nothing misfiled — every note's area and type match where it lives."
            />

            <InvalidBucketsTable
                items={invalidBuckets}
                targets={bucketTargets}
                onMerged={dropInvalidBucket}
                onDeleted={dropInvalidBucket}
            />
        </div>
    )
}

// The Organize page: two tabs — Triage (the one-at-a-time triage queues) and
// Dimensions (the vocabulary the notebook is scaffolded from and the pickers/
// queues assign). Both read agenda's own #agendaConfig.
export default function OrganizePanel() {
    const [tab, setTab] = useState("triage")

    return (
        <div className="workflow-window">
            <div className="workflow-window-tabs">
                <button
                    className={"workflow-window-tab" + (tab === "triage" ? " workflow-window-tab-active" : "")}
                    onClick={() => setTab("triage")}
                >
                    Triage
                </button>
                <button
                    className={"workflow-window-tab" + (tab === "dimensions" ? " workflow-window-tab-active" : "")}
                    onClick={() => setTab("dimensions")}
                >
                    Dimensions
                </button>
            </div>
            <div className="workflow-window-panel">
                {tab === "triage" ? <TriagePanel /> : <DimensionsPanel />}
            </div>
        </div>
    )
}
