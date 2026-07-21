import { useState, useEffect } from "trilium:preact"
import { activateNote } from "trilium:api"
import { getAgendaSettings } from "agendaSettings.jsx"
import { DimensionsPanel } from "organizeDimensions.jsx"

const {
    getOrganizeCandidates, getMisfiledNotes,
    assignStartDate, refileNote, deleteNote
} = require("organize.js")
const { getDimensions, assignDimension } = require("dimensions.js")

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

// Resolve the morning/noon/evening/night times from agenda's shared config
// (discovered via #agendaConfig by getAgendaSettings), falling back to the
// shipped defaults if the config can't be resolved (e.g. libsettings absent).
async function loadTimeSettings() {
    const DEFAULTS = { morning: "08:00", noon: "12:00", evening: "17:00", night: "20:00" }
    try {
        const settings = await getAgendaSettings()
        const o = settings && settings.organize
        if (!o) return DEFAULTS
        return {
            morning: o.morningTime || DEFAULTS.morning,
            noon: o.noonTime || DEFAULTS.noon,
            evening: o.eveningTime || DEFAULTS.evening,
            night: o.nightTime || DEFAULTS.night
        }
    } catch (e) {
        return DEFAULTS
    }
}

// The Triage tab. Loads the candidate notes, the misfiled notes, and the
// dimension vocabulary once, then renders one triage queue per triaged dimension
// (plus the start-date queue and the misfiled queue). Mutations update the
// in-memory lists in place so an acted-on note leaves its queue.
function TriagePanel() {
    const [dimensions, setDimensions] = useState(null)
    const [candidates, setCandidates] = useState(null)
    const [misfiled, setMisfiled] = useState(null)
    const [times, setTimes] = useState(null)

    async function reload() {
        setCandidates(null)
        setMisfiled(null)
        // The dimension vocabulary drives every queue and the misfiled check, so
        // load it first. The two scaffolding dimensions (root = Area, bucket =
        // Type) are the misfiled axes; the type dimension's actionable values gate
        // the actionable-only queues.
        const dims = await getDimensions()
        const rootDim = dims.find(d => d.scaffoldsAreas) || { label: "area", values: [] }
        const bucketDim = dims.find(d => d.scaffoldsBuckets) || { label: "type", values: [] }
        const actionableTypes = bucketDim.values.filter(v => v.actionable).map(v => v.key)

        const [cands, mis, tms] = await Promise.all([
            getOrganizeCandidates(dims.map(d => d.label), actionableTypes),
            getMisfiledNotes(rootDim, bucketDim),
            loadTimeSettings()
        ])
        setDimensions(dims)
        setCandidates(cands)
        setMisfiled(mis)
        setTimes(tms)
    }

    useEffect(() => { reload() }, [])

    if (candidates === null || dimensions === null || misfiled === null || times === null) {
        return <div className="workflow-organize"><div>Loading...</div></div>
    }

    // The two scaffolding dimensions drive the misfiled queue's fix buttons: the
    // root (Area) fix re-tags #area, the bucket (Type) fix re-tags #type. The set
    // of actionable #type values gates the actionable-only queues.
    const rootDim = dimensions.find(d => d.scaffoldsAreas)
    const bucketDim = dimensions.find(d => d.scaffoldsBuckets)
    const actionableTypes = new Set(
        (bucketDim ? bucketDim.values : []).filter(v => v.actionable).map(v => v.key))

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

    // The dimensions that get a triage queue, in config order. A queue lists the
    // candidates with no value for that dimension; an actionableOnly dimension
    // restricts to actionable-typed items (and, being about scheduling-shaped
    // work, excludes subtasks the same way the start-date queue does).
    const triaged = dimensions.filter(d => d.triage && d.values.length)
    function queueItems(dim) {
        return candidates.filter(c => {
            if (c.assigned[dim.label]) return false
            if (dim.actionableOnly && !(actionableTypes.has(c.type) && !c.isSubtask)) return false
            return true
        })
    }

    // Actionable items with no start date (#startDateTime) yet. Subtasks (filed
    // under a parent actionable note) are excluded — scheduled with the parent.
    const noStartDate = candidates.filter(c =>
        !c.hasStartDate && !c.isSubtask && actionableTypes.has(c.type))

    return (
        <div className="workflow-organize">
            {dimensions.length === 0 && (
                <div className="workflow-window-placeholder">
                    No dimensions configured. Add area/type/priority (or your own) in the Dimensions
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
                    onDelete={async (item) => { await deleteNote(item.noteId); drop(item.noteId) }}
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
                onDelete={async (item) => { await deleteNote(item.noteId); drop(item.noteId) }}
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
                    if (item.typeMisfiled && f.updateTypeTo && bucketDim) {
                        buttons.push(
                            <button
                                key="type"
                                className="workflow-organize-option-btn"
                                disabled={busy}
                                onClick={() => act(async () => {
                                    const v = bucketDim.values.find(x => x.key === f.updateTypeTo)
                                    await assignDimension(item.noteId, bucketDim, v || { key: f.updateTypeTo })
                                    dropMisfiled(item.noteId)
                                })}
                            >
                                Set {bucketDim.name.toLowerCase()} to {f.updateTypeToTitle}
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
