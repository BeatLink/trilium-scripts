import { useState, useEffect, NoteAutocomplete } from "trilium:preact"
import { getAgendaSettings } from "agendaSettings.jsx"
import { getAreaSettings } from "organizeAreas.jsx"
import { SettingsForm, loadSettings, saveSettings } from "libSettingsUI.jsx"

const { provisionStructure } = require("organizeProvision.js")

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
// its six Type subnotes) by find-or-create, tagging every note with
// #workflowNote=<key>. Re-runnable and idempotent — notes you already made by
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
            const areas = await getAreaSettings()
            setOutcome(await provisionStructure(areas))
        } catch (e) {
            setError(String(e && e.message ? e.message : e))
        } finally {
            setRunning(false)
        }
    }

    const results = outcome ? outcome.results : null
    const migratedAreaCount = outcome ? outcome.migratedAreaCount : 0
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
                <code>#workflowNote</code>) rather than duplicated, and anything missing is created.
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

export default function ProfileEditor() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)
    const [organizeNoteId, setOrganizeNoteId] = useState("")

    useEffect(() => {
        (async () => {
            const settings = await getAgendaSettings()
            if (!settings) return
            setSchemaNoteId(settings.schemaNoteId)
            setConfigNoteId(settings.configNoteId)
            setOrganizeNoteId(settings.profileContext.organizeNoteId || "")
        })()
    }, [])

    if (!schemaNoteId || !configNoteId) return <div>Loading...</div>

    // The Settings category's "Workflow Setup" tab: the Organize-note picker
    // (a side-effecting picker the schema can't express) plus the provision
    // button, injected into SettingsForm's own category/tab nav. The schema's
    // label vocabulary and Active Profile live on the Settings category's
    // "Settings" tab; everything else groups by its own category.
    const extraPanels = [
        {
            category: "Settings",
            tab: "Workflow Setup",
            render: () => (
                <>
                    <OrganizeNotePicker
                        schemaNoteId={schemaNoteId}
                        configNoteId={configNoteId}
                        initialNoteId={organizeNoteId}
                    />
                    <WorkflowSetup />
                </>
            )
        }
    ]

    return (
        <div className="profile-editor">
            <h2>Agenda Editor</h2>
            <p>
                Override the label-name vocabulary and pick the active profile (Settings), choose the
                shared overview note (Review), build out your profiles (their collection view,
                search/filter groups, and sort/prefix/color pick), and manage every shared
                search/filter/sort/prefix/color/date-rule element — each on its own tab under its
                workflow category. A profile only ever references an element by name; edit the element
                on its own tab to change it everywhere it's used. Provision the notebook structure from
                Settings › Workflow Setup.
            </p>
            <SettingsForm
                schemaNoteId={schemaNoteId}
                configNoteId={configNoteId}
                extraPanels={extraPanels}
            />
        </div>
    )
}
