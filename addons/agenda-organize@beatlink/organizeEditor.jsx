import { useState, useEffect, NoteAutocomplete } from "trilium:preact"
import { SettingsForm, loadSettings, saveSettings } from "libSettingsUI.jsx"
import { DimensionsPanel } from "organizeDimensions.jsx"

const { getOrganizeConfigIds } = require("organizeSettings.js")

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
                buttons use. Edit the classification vocabulary under Dimensions. Provisioning the
                notebook structure the triage queues walk lives in agenda-structure@beatlink.
            </p>
            <SettingsForm
                schemaNoteId={ids.schemaNoteId}
                configNoteId={ids.configNoteId}
                extraPanels={extraPanels}
            />
        </div>
    )
}
