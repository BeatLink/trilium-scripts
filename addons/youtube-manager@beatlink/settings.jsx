import { useState, useEffect, NoteAutocomplete } from "trilium:preact"
import { SettingsForm, loadSettings, saveSettings } from "libSettingsUI.jsx"
import { activateNote } from "trilium:api"

// The icon stamped on the note that hosts the manager UI.
const DISPLAY_ICON = "bx bxl-youtube"

// Point `noteId` at the manager: make it a render note whose ~renderNote relation
// targets the widget code note (found by #youtubeManagerRender), and stamp its icon.
// Revert `previousNoteId` (if different) back to a plain text note, so switching
// display notes never leaves an orphaned render note behind.
// Runs on the backend -- the closure may reference only `api`.
async function reconcileDisplayNote(noteId, previousNoteId, icon) {
    return api.runOnBackend((noteId, previousNoteId, icon) => {
        // The widget note carries #youtubeManagerRender. An install predating that
        // label won't have it until the addon is updated in TAM, so fall back to
        // the note's title rather than silently leaving the note unwired.
        const found = api.searchForNotes("#youtubeManagerRender")[0]
            || api.searchForNotes('note.title = "youtubeManager.jsx"')[0]
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

// The Display Note picker: selecting a note wires it as a second render surface
// for the manager (and reverts the previously-selected one). Persisted as
// displayNoteId in this addon's own settings note.
function DisplayNotePicker({ schemaNoteId, configNoteId, initialNoteId }) {
    const [noteId, setNoteId] = useState(initialNoteId || "")
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)

    function describe(result) {
        if (!result) return { error: "Wiring did not run." }
        if (result.cleared) return { ok: "Cleared. The previous note was reverted to a text note." }
        if (result.reason === "no-render-source") {
            return {
                error: "Could not find the manager widget note. Make sure youtube-manager is " +
                    "enabled in TAM, then apply again."
            }
        }
        if (result.reason === "note-not-found") return { error: "That note no longer exists." }
        if (!result.ok) return { error: `Wiring failed (type is "${result.type}").` }
        return { ok: "Wired. Open the note to see the manager." }
    }

    async function wire(targetNoteId, previous) {
        setBusy(true)
        setStatus(null)
        try {
            const values = await loadSettings(schemaNoteId, configNoteId)
            values.displayNoteId = targetNoteId || ""
            await saveSettings(schemaNoteId, configNoteId, values)
            setStatus(describe(await reconcileDisplayNote(targetNoteId || "", previous, DISPLAY_ICON)))
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
            <div className="lst-field-row" title="A note of your choosing that displays the manager. Selecting it converts that note into a render note pointing at the manager widget.">
                <label>Display Note</label>
                <NoteAutocomplete noteId={noteId} noteIdChanged={onPick} />
            </div>
            <p class="ym-status">
                Optional. The manager already lives under its own addon note; this puts a second copy
                of it wherever you want it in your tree. Clearing it reverts the previously-chosen
                note back to a text note.
            </p>
            {/* Re-runs the wiring on the note already selected. Needed because
                picking the same note again is a no-op, so a note that was set
                while the addon was disabled would otherwise have no way to get fixed. */}
            <button class="ym-btn" disabled={busy || !noteId} onClick={() => wire(noteId, "")}>
                Apply render wiring
            </button>
            {status?.ok && <p class="ym-status">{status.ok}</p>}
            {status?.error && <p class="ym-error">{status.error}</p>}
        </div>
    )
}

export default function YouTubeManagerSettings() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)
    const [managerNoteId, setManagerNoteId] = useState("")
    const [displayNoteId, setDisplayNoteId] = useState("")
    const [ready, setReady] = useState(false)

    useEffect(() => {
        (async () => {
            const schema = await api.currentNote.getRelationValue("schemaNote")
            const target = await api.currentNote.getRelationTarget("configNote")
            setSchemaNoteId(schema)
            setConfigNoteId(target.noteId)
            setManagerNoteId(await api.currentNote.getRelationValue("managerPageNote") || "")
            const values = await loadSettings(schema, target.noteId)
            setDisplayNoteId(values.displayNoteId || "")
            setReady(true)
        })()
    }, [])

    if (!ready) return <div>Loading...</div>

    // The Display Note field is `hidden` in the schema so the form doesn't render
    // it twice -- this panel owns it, because picking a note has side effects
    // beyond storing the id. It gets its own tab rather than joining "Feed":
    // an extra panel sharing a schema tab's label replaces that tab's fields.
    const extraPanels = [
        {
            tab: "Display Note",
            render: () => (
                <DisplayNotePicker
                    schemaNoteId={schemaNoteId}
                    configNoteId={configNoteId}
                    initialNoteId={displayNoteId}
                />
            )
        }
    ]

    return (
        <div>
            <button class="ym-btn" disabled={!managerNoteId} onClick={() => activateNote(managerNoteId)}>
                Back
            </button>
            <SettingsForm
                schemaNoteId={schemaNoteId}
                configNoteId={configNoteId}
                extraPanels={extraPanels}
            />
        </div>
    )
}
