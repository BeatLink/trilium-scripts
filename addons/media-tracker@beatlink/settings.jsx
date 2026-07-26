import { useState, useEffect, NoteAutocomplete } from "trilium:preact"
import { SettingsForm, loadSettings, saveSettings } from "libSettingsUI.jsx"

// The icon stamped on the note that hosts the tracker UI.
const LIBRARY_ICON = "bx bx-movie-play"

// Point `noteId` at the tracker: make it a render note whose ~renderNote relation
// targets the widget code note (found by #mediaTrackerRender), and stamp its icon.
// Revert `previousNoteId` (if different) back to a plain text note, so switching
// roots never leaves an orphaned render note behind.
// Runs on the backend — the closure may reference only `api`.
async function reconcileLibraryNote(noteId, previousNoteId, icon) {
    return api.runOnBackend((noteId, previousNoteId, icon) => {
        const srcResults = api.searchForNotes("#mediaTrackerRender")
        const srcId = srcResults.length ? srcResults[0].noteId : ""

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

// The Library Root picker: selecting a note wires it as the tracker's render
// surface (and reverts the previously-selected one). Persisted as
// libraryRootNoteId in this addon's own settings note.
function LibraryRootPicker({ schemaNoteId, configNoteId, initialNoteId }) {
    const [noteId, setNoteId] = useState(initialNoteId || "")
    const [busy, setBusy] = useState(false)

    async function onPick(newNoteId) {
        if (busy || newNoteId === noteId) return
        setBusy(true)
        const previous = noteId
        setNoteId(newNoteId || "")
        try {
            const values = await loadSettings(schemaNoteId, configNoteId)
            values.libraryRootNoteId = newNoteId || ""
            await saveSettings(schemaNoteId, configNoteId, values)
            await reconcileLibraryNote(newNoteId || "", previous, LIBRARY_ICON)
        } finally {
            setBusy(false)
        }
    }

    return (
        <div>
            <div className="lst-field-row" title="The note that holds your tracked titles and displays the tracker. Selecting it converts that note into a render note pointing at the tracker widget.">
                <label>Library Root</label>
                <NoteAutocomplete noteId={noteId} noteIdChanged={onPick} />
            </div>
            <p class="mt-hint">
                Every tracked title is created as a child of this note, and the note itself becomes
                the tracker UI. Clearing it reverts the previously-chosen note back to a text note.
            </p>
        </div>
    )
}

export default function MediaTrackerSettings() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)
    const [libraryRootNoteId, setLibraryRootNoteId] = useState("")
    const [ready, setReady] = useState(false)

    useEffect(() => {
        (async () => {
            const schema = await api.currentNote.getRelationValue("schemaNote")
            const target = await api.currentNote.getRelationTarget("configNote")
            setSchemaNoteId(schema)
            setConfigNoteId(target.noteId)
            const values = await loadSettings(schema, target.noteId)
            setLibraryRootNoteId(values.libraryRootNoteId || "")
            setReady(true)
        })()
    }, [])

    if (!ready) return <div>Loading...</div>

    // The Library Root field is `hidden` in the schema so the form doesn't render
    // it twice — this panel owns it, because picking a note has side effects
    // beyond storing the id. It gets its own tab rather than joining "Library":
    // an extra panel sharing a schema tab's label replaces that tab's fields.
    const extraPanels = [
        {
            tab: "Library Root",
            render: () => (
                <LibraryRootPicker
                    schemaNoteId={schemaNoteId}
                    configNoteId={configNoteId}
                    initialNoteId={libraryRootNoteId}
                />
            )
        }
    ]

    return (
        <div class="mt-settings">
            <h3>Media Tracker</h3>
            <p class="mt-hint">
                A TMDB key powers search, posters, and episode lists. Trakt and Stremio are
                optional one-way import sources: they are read, never written to.
            </p>
            <SettingsForm
                schemaNoteId={schemaNoteId}
                configNoteId={configNoteId}
                extraPanels={extraPanels}
            />
        </div>
    )
}
