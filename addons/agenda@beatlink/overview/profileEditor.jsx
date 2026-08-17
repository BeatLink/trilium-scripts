import { useState, useEffect } from "trilium:preact"
import { getAgendaSettings } from "agendaSettings.jsx"
import { SettingsForm, loadSettings, saveSettings } from "libSettingsUI.jsx"


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

export default function ProfileEditor() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)

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
        })()
    }, [])

    if (!schemaNoteId || !configNoteId) return <div>Loading...</div>

    // Every tab here comes from the schema's own `category`/`tab` keys. The
    // Organize-note picker moved out to agenda-organize@beatlink's own editor
    // along with the Organize config keys;
    // the Task label and Reschedule Options panels moved out to
    // agenda-task@beatlink's own Task Settings page along with #agendaTaskConfig.
    return (
        <div className="profile-editor">
            <h2>Agenda Editor</h2>
            <p>
                Override the label-name vocabulary (Settings). Under Review, pick the shared overview
                note and active profile, build out your profiles, and choose their searches and filters.
                Under Display Elements, manage the reusable sort/prefix/color/grouping/date-rule building
                blocks — each on its own tab; a profile only ever references an element by name, so
                editing the element on its own tab changes it everywhere it's used. Pick the inbox note
                captures land in under Collect, and edit the classification vocabulary under Dimensions.
                The Organize triage UI and its notebook provisioning live in
                agenda-organize@beatlink's own editor.
            </p>
            <SettingsForm
                schemaNoteId={schemaNoteId}
                configNoteId={configNoteId}
            />
        </div>
    )
}
