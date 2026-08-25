import { useState, useEffect, LoadingSpinner } from "trilium:preact"
import { getAgendaSettings } from "agendaSettings.jsx"
import { SettingsForm } from "libSettingsUI.jsx"


export default function ProfileEditor() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)

    useEffect(() => {
        (async () => {
            const settings = await getAgendaSettings()
            if (!settings) return
            setSchemaNoteId(settings.schemaNoteId)
            setConfigNoteId(settings.configNoteId)
        })()
    }, [])

    if (!schemaNoteId || !configNoteId) return <div><LoadingSpinner /> Loading...</div>

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
                editing the element on its own tab changes it everywhere it's used. Edit the classification
                vocabulary under Dimensions.
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
