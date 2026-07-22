import { useState, useEffect, NoteAutocomplete } from "trilium:preact"
import { getAgendaSettings } from "agendaSettings.jsx"
import { SettingsForm, loadSettings, saveSettings } from "libSettingsUI.jsx"

const { provisionStructure } = require("organizeProvision.js")
const { getDimensions } = require("dimensions.js")

// The icon stamped on the note that hosts the Organize UI.
const ORGANIZE_ICON = "bx bx-sort-down"

// Preselect the Collect › Inbox Note setting to Trilium's own inbox the first
// time (when it's still empty), so a fresh install lands somewhere sensible and
// collection addons that read agenda's inboxNoteId have a target. Resolution
// order: a note tagged #inbox (Trilium's own inbox convention), else agenda's
// provisioned Inbox (#agendaOrganizeSpecial=inbox), else a root-level note
// titled "Inbox".
// Persists the resolved id back into the shared config; a no-op once set (so the
// user's own later choice is never overwritten). Returns the resolved id or "".
async function preselectInboxNote(schemaNoteId, configNoteId) {
    const values = await loadSettings(schemaNoteId, configNoteId)
    if (values.inboxNoteId) return values.inboxNoteId

    const resolved = await api.runOnBackend(() => {
        let hits = api.searchForNotes("#inbox")
        if (hits.length) return hits[0].noteId
        hits = api.searchForNotes('#agendaOrganizeSpecial = "inbox"')
        if (hits.length) return hits[0].noteId
        // Pre-split tree that hasn't been through migrateStructuralLabels yet.
        hits = api.searchForNotes('#workflowNote = "inbox"')
        if (hits.length) return hits[0].noteId
        hits = api.searchForNotes('note.title = "Inbox" AND note.parents.noteId = "root"')
        if (hits.length) return hits[0].noteId
        return ""
    }, [])

    if (resolved) {
        values.inboxNoteId = resolved
        await saveSettings(schemaNoteId, configNoteId, values)
    }
    return resolved
}

// Point `noteId` at the Organize page: make it a render note whose ~renderNote
// relation targets the Organize code note (found by #agendaOrganizeRender), and
// stamp its icon. Revert `previousNoteId` (if different) back to a plain text
// note. Runs on the backend — the closure may reference only `api`.
async function reconcileOrganizeNote(noteId, previousNoteId, icon) {
    return api.runOnBackend((noteId, previousNoteId, icon) => {
        const srcResults = api.searchForNotes("#agendaOrganizeRender")
        const srcId = srcResults.length ? srcResults[0].noteId : ""

        // Revert the previously-chosen note (only if it's no longer selected).
        if (previousNoteId && previousNoteId !== noteId) {
            const prev = api.getNote(previousNoteId)
            if (prev) {
                prev.removeRelation("renderNote")
                if (prev.getLabelValue("iconClass") === icon) prev.removeLabel("iconClass")
                if (prev.type === "render") {
                    prev.type = "text"
                    prev.save()
                }
            }
        }

        // Wire the newly-chosen note as the Organize render surface.
        if (noteId && srcId) {
            const note = api.getNote(noteId)
            if (note) {
                if (note.type !== "render") {
                    note.type = "render"
                    note.save()
                }
                if (note.getRelationValue("renderNote") !== srcId) note.setRelation("renderNote", srcId)
                if (note.getLabelValue("iconClass") !== icon) note.setLabel("iconClass", icon)
            }
        }

        return srcId
    }, [noteId, previousNoteId, icon])
}

// The Organize-note picker: selecting a note wires it as the Organize render
// surface (and reverts the previously-selected one). Persisted as organizeNoteId
// in the shared agenda config, so every consumer sees the same choice.
function OrganizeNotePicker({ schemaNoteId, configNoteId, initialNoteId }) {
    const [noteId, setNoteId] = useState(initialNoteId || "")
    const [busy, setBusy] = useState(false)

    async function onPick(newNoteId) {
        if (busy || newNoteId === noteId) return
        setBusy(true)
        const previous = noteId
        setNoteId(newNoteId || "")
        try {
            const values = await loadSettings(schemaNoteId, configNoteId)
            values.organizeNoteId = newNoteId || ""
            await saveSettings(schemaNoteId, configNoteId, values)
            await reconcileOrganizeNote(newNoteId || "", previous, ORGANIZE_ICON)
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="lst-field-row" title="The note that displays the Organize triage UI. Selecting it converts that note into a render note pointing at the Organize page.">
            <label>Organize Note</label>
            <NoteAutocomplete noteId={noteId} noteIdChanged={onPick} />
        </div>
    )
}

// The Workflow Setup panel: one button that provisions the opinionated notebook
// structure (Inbox, My Day, Agenda, and one note per area-picker Area, each with
// its six Type subnotes) by find-or-create, tagging every note with its split
// identity labels (#agendaOrganizeArea / #agendaOrganizeBucket /
// #agendaOrganizeSpecial). Re-runnable and idempotent — notes you already made by
// hand at the right title/level are adopted (tagged) rather than duplicated. See
// organizeProvision.js. (Formerly a standalone render page; now a tab inside the
// Agenda Editor's Settings category.)
function WorkflowSetup() {
    const [running, setRunning] = useState(false)
    const [outcome, setOutcome] = useState(null)
    const [error, setError] = useState(null)

    async function onProvision() {
        setRunning(true)
        setError(null)
        setOutcome(null)
        try {
            setOutcome(await provisionStructure(await getDimensions()))
        } catch (e) {
            setError(String(e && e.message ? e.message : e))
        } finally {
            setRunning(false)
        }
    }

    const results = outcome ? outcome.results : null
    const migratedAreaCount = outcome ? outcome.migratedAreaCount : 0
    const merges = outcome && outcome.merged ? outcome.merged.merges : []
    const labelMigration = outcome ? outcome.labelMigration : null
    const created = results ? results.filter(r => r.created).length : 0
    const adopted = results ? results.filter(r => r.adopted).length : 0
    const existing = results ? results.filter(r => !r.created && !r.adopted).length : 0

    return (
        <div className="workflow-setup">
            <p className="workflow-setup-blurb">
                Provision the notebook structure: <strong>Inbox</strong>, <strong>My Day</strong>,
                <strong> Agenda</strong>, and one note per Area (from area-picker@beatlink's area list,
                each with Ideas / Goals / Routines / Projects / Future / Notes below it). Notes are
                matched by title at the right level — an existing match is adopted (tagged
                <code>#agendaOrganizeArea</code> / <code>#agendaOrganizeBucket</code>) rather than
                duplicated, and anything missing is created.
                Also re-keys any notes left on an old area slug after an area reorder. Safe to run more
                than once.
            </p>

            <button
                className="workflow-setup-button"
                disabled={running}
                onClick={onProvision}
            >
                {running ? "Provisioning..." : "Provision structure"}
            </button>

            {error && (
                <div className="workflow-setup-error">Provisioning failed: {error}</div>
            )}

            {results && (
                <div className="workflow-setup-results">
                    <div className="workflow-setup-summary">
                        {created} created, {adopted} adopted, {existing} already present
                        ({results.length} total).
                        {migratedAreaCount > 0 &&
                            ` Migrated ${migratedAreaCount} note${migratedAreaCount === 1 ? "" : "s"} to updated area slugs.`}
                        {labelMigration && labelMigration.migrated > 0 &&
                            ` Converted ${labelMigration.migrated} structural note${labelMigration.migrated === 1 ? "" : "s"} to the split identity labels.`}
                        {labelMigration && labelMigration.unparsed.length > 0 &&
                            ` ${labelMigration.unparsed.length} legacy key${labelMigration.unparsed.length === 1 ? "" : "s"} could not be parsed and were left as-is.`}
                    </div>
                    {merges.length > 0 && (
                        <ul className="workflow-setup-log">
                            {merges.map(m => (
                                <li key={m.fromNoteId}>
                                    <span className="workflow-setup-tag workflow-setup-tag-adopted">merged</span>
                                    {m.rekeyedInPlace
                                        ? ` Re-keyed "${m.fromTitle}" to ${m.toKey}.`
                                        : ` Folded "${m.fromTitle}" into "${m.toTitle}"` +
                                          ` (${m.movedCount} note${m.movedCount === 1 ? "" : "s"}` +
                                          `${m.movedContent ? " + content" : ""} moved)` +
                                          (m.deleted ? " and removed the empty bucket." : ` — kept: ${m.keptReason}.`)}
                                </li>
                            ))}
                        </ul>
                    )}
                    <ul className="workflow-setup-log">
                        {results.map(r => (
                            <li key={r.key} style={{ marginLeft: `${r.depth * 16}px` }}>
                                <span className={
                                    "workflow-setup-tag workflow-setup-tag-" +
                                    (r.created ? "created" : r.adopted ? "adopted" : "existing")
                                }>
                                    {r.created ? "created" : r.adopted ? "adopted" : "present"}
                                </span>
                                {r.title}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    )
}

export default function ProfileEditor() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)
    const [organizeNoteId, setOrganizeNoteId] = useState("")

    useEffect(() => {
        (async () => {
            const settings = await getAgendaSettings()
            if (!settings) return
            // Preselect the inbox note (persists to config) before mounting the
            // SettingsForm below, so its Collect › Inbox tab shows the resolved
            // note rather than an empty picker on a fresh install.
            await preselectInboxNote(settings.schemaNoteId, settings.configNoteId)
            setSchemaNoteId(settings.schemaNoteId)
            setConfigNoteId(settings.configNoteId)
            setOrganizeNoteId(settings.profileContext.organizeNoteId || "")
        })()
    }, [])

    if (!schemaNoteId || !configNoteId) return <div>Loading...</div>

    // Panels the schema can't express on its own, injected into SettingsForm's
    // category/tab nav: the Organize-note picker under Organize (wires which note
    // hosts the Organize triage UI) and the provision button under Settings ›
    // Workflow Setup. The Dimensions tab needs no override any more — item TYPE
    // moved to template-picker@beatlink's own registry, so there's no "Match
    // Templates By Name" action left to inject above it. Everything else groups
    // by its own schema `category`.
    const extraPanels = [
        {
            category: "Organize",
            tab: "Organize Note",
            render: () => (
                <OrganizeNotePicker
                    schemaNoteId={schemaNoteId}
                    configNoteId={configNoteId}
                    initialNoteId={organizeNoteId}
                />
            )
        },
        {
            category: "Settings",
            tab: "Workflow Setup",
            render: () => <WorkflowSetup />
        }
    ]

    return (
        <div className="profile-editor">
            <h2>Agenda Editor</h2>
            <p>
                Override the label-name vocabulary (Settings). Under Review, pick the shared overview
                note and active profile, build out your profiles, and choose their searches and filters.
                Under Display Elements, manage the reusable sort/prefix/color/grouping/date-rule building
                blocks — each on its own tab; a profile only ever references an element by name, so
                editing the element on its own tab changes it everywhere it's used. Pick the inbox note
                captures land in under Collect. Set the quick-times and pick the note that hosts the
                Organize triage UI under Organize; edit the classification vocabulary under Dimensions;
                provision the notebook structure from Settings › Workflow Setup.
            </p>
            <SettingsForm
                schemaNoteId={schemaNoteId}
                configNoteId={configNoteId}
                extraPanels={extraPanels}
            />
        </div>
    )
}
