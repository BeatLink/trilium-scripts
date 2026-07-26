import { useState, useEffect, NoteAutocomplete } from "trilium:preact"
import { activateNote } from "trilium:api"
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
        // The widget note carries #mediaTrackerRender. An install predating that
        // label won't have it until the addon is updated in TAM, so fall back to
        // the note's title rather than silently leaving the root unwired.
        const srcResults = api.searchForNotes("#mediaTrackerRender")
        const found = srcResults[0] || api.searchForNotes('note.title = "mediaTracker.jsx"')[0]
        const srcId = found ? found.noteId : ""

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

        if (!noteId) return { ok: true, cleared: true }
        if (!srcId) return { ok: false, reason: "no-render-source" }

        const note = api.getNote(noteId)
        if (!note || note.isDeleted) return { ok: false, reason: "note-not-found" }

        if (note.type !== "render") {
            note.type = "render"
            note.save()
        }
        // TAM renames activation attributes to `disabled:<name>` while an addon
        // is disabled, and ~renderNote is one of them. Clear that stale copy so
        // the note doesn't end up carrying both spellings.
        if (note.getRelationValue("disabled:renderNote")) note.removeRelation("disabled:renderNote")
        if (note.getRelationValue("renderNote") !== srcId) note.setRelation("renderNote", srcId)
        if (note.getLabelValue("iconClass") !== icon) note.setLabel("iconClass", icon)

        // Report what the note actually looks like now, so the UI can confirm
        // the wiring landed instead of assuming it did.
        return {
            ok: note.type === "render" && note.getRelationValue("renderNote") === srcId,
            type: note.type,
            renderNote: note.getRelationValue("renderNote"),
            srcId
        }
    }, [noteId, previousNoteId, icon])
}

// The Library Root picker: selecting a note wires it as the tracker's render
// surface (and reverts the previously-selected one). Persisted as
// libraryRootNoteId in this addon's own settings note.
function LibraryRootPicker({ schemaNoteId, configNoteId, initialNoteId }) {
    const [noteId, setNoteId] = useState(initialNoteId || "")
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)

    function describe(result) {
        if (!result) return { error: "Wiring did not run." }
        if (result.cleared) return { ok: "Cleared. The previous note was reverted to a text note." }
        if (result.reason === "no-render-source") {
            return {
                error: "Could not find the tracker widget note. Make sure media-tracker is enabled " +
                    "in TAM, then apply again."
            }
        }
        if (result.reason === "note-not-found") return { error: "That note no longer exists." }
        if (!result.ok) return { error: `Wiring failed (type is "${result.type}").` }
        return { ok: "Wired. Open the note to see the tracker." }
    }

    async function wire(targetNoteId, previous) {
        setBusy(true)
        setStatus(null)
        try {
            const values = await loadSettings(schemaNoteId, configNoteId)
            values.libraryRootNoteId = targetNoteId || ""
            await saveSettings(schemaNoteId, configNoteId, values)
            setStatus(describe(await reconcileLibraryNote(targetNoteId || "", previous, LIBRARY_ICON)))
        } catch (e) {
            setStatus({ error: String(e && e.message ? e.message : e) })
        } finally {
            setBusy(false)
        }
    }

    async function onPick(newNoteId) {
        if (busy || newNoteId === noteId) return
        const previous = noteId
        setNoteId(newNoteId || "")
        await wire(newNoteId, previous)
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
            {/* Re-runs the wiring on the note already selected. Needed because
                picking the same note again is a no-op, so a root that was set
                while the addon was disabled (or before it wired roots at all)
                would otherwise have no way to get fixed. */}
            <button class="mt-btn" disabled={busy || !noteId} onClick={() => wire(noteId, "")}>
                Apply render wiring
            </button>
            {status?.ok && <p class="mt-ok">{status.ok}</p>}
            {status?.error && <p class="mt-error">{status.error}</p>}
        </div>
    )
}

export default function MediaTrackerSettings() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)
    const [libraryRootNoteId, setLibraryRootNoteId] = useState("")
    const [backNoteId, setBackNoteId] = useState("")
    const [ready, setReady] = useState(false)

    useEffect(() => {
        (async () => {
            const schema = await api.currentNote.getRelationValue("schemaNote")
            const target = await api.currentNote.getRelationTarget("configNote")
            setSchemaNoteId(schema)
            setConfigNoteId(target.noteId)
            const values = await loadSettings(schema, target.noteId)
            setLibraryRootNoteId(values.libraryRootNoteId || "")

            // Prefer the note the user actually came from (recorded by the
            // tracker's Settings button), then the library root, then the
            // launcher -- so Back works however this page was reached.
            let returnTo = ""
            try {
                returnTo = sessionStorage.getItem("mediaTracker:returnTo") || ""
            } catch (e) {
                // sessionStorage unavailable; fall through to the relations.
            }
            setBackNoteId(
                returnTo
                || values.libraryRootNoteId
                || await api.currentNote.getRelationValue("trackerPageNote")
                || ""
            )
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
            <div class="mt-settings-head">
                <button class="mt-btn" disabled={!backNoteId} title="Back to the tracker"
                    onClick={() => activateNote(backNoteId)}>
                    &lsaquo; Back
                </button>
                <h3>Media Tracker</h3>
            </div>
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
