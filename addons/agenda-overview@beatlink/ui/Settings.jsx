import { useState, useEffect, LoadingSpinner } from "trilium:preact"
import { SettingsForm } from "libSettingsUI.jsx"

const { getAgendaSettings } = require("settings.js")

export default function AgendaSettings() {
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
    // along with the Organize config keys; the Task label and Reschedule Options
    // panels moved out to agenda-task@beatlink's own Task Settings page along
    // with #agendaTaskConfig.
    return (
        <div className="profile-editor">
            <h2>Agenda Settings</h2>
            <p>
                Override the label-name vocabulary (Settings). Under Review, pick the shared overview
                note and active profile, build out your profiles, choose their searches and filters, and
                manage the reusable sort/prefix/color/grouping/date-rule building blocks those profiles
                reference — each on its own tab; a profile only ever references an element by name, so
                editing the element on its own tab changes it everywhere it's used. Area and priority
                ship as entries in those tabs; classifying a note is agenda-organize@beatlink's job,
                out of its own separate vocabulary.
            </p>
            <SettingsForm
                schemaNoteId={schemaNoteId}
                configNoteId={configNoteId}
            />
        </div>
    )
}
