import { useState, useEffect, NoteAutocomplete } from "trilium:preact"
import { SettingsForm, loadSettings, saveSettings } from "libSettingsUI.jsx"
import { DimensionsPanel } from "organizeDimensions.jsx"

const { provisionStructure } = require("organizeProvision.js")
const { getOrganizeConfigIds } = require("organizeSettings.js")
const { getDimensions } = require("dimensions.js")

// The icon stamped on the note that hosts the Organize UI.
const ORGANIZE_ICON = "bx bx-sort-down"

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
// in Organize's own #agendaOrganizeConfig settings note.
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
// structure (Inbox, My Day, Agenda, and one note per Area, each with its Type
// subnotes) by find-or-create, tagging every note with its split identity labels
// (#agendaOrganizeArea / #agendaOrganizeBucket / #agendaOrganizeSpecial).
// Re-runnable and idempotent — notes you already made by hand at the right title
// and level are adopted (tagged) rather than duplicated. See organizeProvision.js.
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
    const labelMigration = outcome ? outcome.labelMigration : null
    const created = results ? results.filter(r => r.created).length : 0
    const adopted = results ? results.filter(r => r.adopted).length : 0
    const existing = results ? results.filter(r => !r.created && !r.adopted).length : 0

    return (
        <div className="workflow-setup">
            <p className="workflow-setup-blurb">
                Provision the notebook structure: <strong>Inbox</strong>, <strong>My Day</strong>,
                <strong> Agenda</strong>, one top-level note per Area (from the dimension that
                scaffolds areas) and one top-level note per enabled template. Both sets are one
                level deep — an item is filed in two places at once, its Area and its Type, as a
                clone. Notes are matched by title at the top level — an existing match is adopted
                (tagged <code>#agendaOrganizeArea</code> / <code>#agendaOrganizeType</code>) rather
                than duplicated, and anything missing is created.
                Only containers are provisioned here; filing items into them is the Organize page's
                job. Also re-keys any notes left on an old area slug after an area reorder. Safe to
                run more than once.
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

export default function OrganizeEditor() {
    const [ids, setIds] = useState(undefined)
    const [organizeNoteId, setOrganizeNoteId] = useState("")

    useEffect(() => {
        (async () => {
            const resolved = await getOrganizeConfigIds()
            if (!resolved) {
                setIds(null)
                return
            }
            const values = await loadSettings(resolved.schemaNoteId, resolved.configNoteId)
            setOrganizeNoteId(values.organizeNoteId || "")
            setIds(resolved)
        })()
    }, [])

    if (ids === undefined) return <div>Loading...</div>
    if (ids === null) return <div>Organize's configuration isn't discoverable.</div>

    // Panels the schema can't express on its own, injected into SettingsForm's
    // category/tab nav. The Dimensions tab reads agenda@beatlink's registry
    // rather than a copy of it — see organizeSettings.js for why.
    const extraPanels = [
        {
            category: "Organize",
            tab: "Organize Note",
            render: () => (
                <OrganizeNotePicker
                    schemaNoteId={ids.schemaNoteId}
                    configNoteId={ids.configNoteId}
                    initialNoteId={organizeNoteId}
                />
            )
        },
        {
            category: "Organize",
            tab: "Workflow Setup",
            render: () => <WorkflowSetup />
        },
        {
            category: "Dimensions",
            tab: "Dimensions",
            render: () => <DimensionsPanel />
        }
    ]

    return (
        <div className="profile-editor">
            <h2>Organize Editor</h2>
            <p>
                Pick the note that hosts the Organize triage UI and set the quick-times its start-date
                buttons use. Edit the classification vocabulary under Dimensions, and provision the
                notebook structure from Organize › Workflow Setup.
            </p>
            <SettingsForm
                schemaNoteId={ids.schemaNoteId}
                configNoteId={ids.configNoteId}
                extraPanels={extraPanels}
            />
        </div>
    )
}
