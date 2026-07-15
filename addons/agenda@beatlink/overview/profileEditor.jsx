import { useState, useEffect } from "trilium:preact"
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
            <SettingsForm schemaNoteId={schemaNoteId} configNoteId={configNoteId} />
        </div>
    )
}
