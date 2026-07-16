import { useState, useEffect, NoteAutocomplete } from "trilium:preact"
import { getAgendaSettings } from "agendaSettings.jsx"
import { SettingsForm, loadSettings, saveSettings } from "libSettingsUI.jsx"

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

    return (
        <div className="profile-editor">
            <h2>Agenda Editor</h2>
            <p>
                Override the label-name vocabulary, pick the shared overview note and active profile
                (Settings tab), build out your profiles (their collection view, search/filter groups,
                and sort/prefix/color pick), and manage every shared
                search/filter/sort/prefix/color/date-rule element — each on its own tab below. A
                profile only ever references an element by name; edit the element on its own tab to
                change it everywhere it's used.
            </p>
            <OrganizeNotePicker
                schemaNoteId={schemaNoteId}
                configNoteId={configNoteId}
                initialNoteId={organizeNoteId}
            />
            <SettingsForm schemaNoteId={schemaNoteId} configNoteId={configNoteId} />
        </div>
    )
}
