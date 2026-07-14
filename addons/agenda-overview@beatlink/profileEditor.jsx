import { useState, useEffect } from "trilium:preact"
import { getAgendaSettings } from "agendaSettings.jsx"
import { SettingsForm } from "libSettingsUI.jsx"

// Every setting this addon has — the label-name vocabulary, every profile,
// and every search/filter/sort/prefix/color/date-rule registry a profile can
// reference — lives in one schema.json/config.json pair, so the whole editor
// page is just `SettingsForm` dropped in as-is. `SettingsForm` owns its own
// tabs (one per `tab` a schema field declares), autosave-vs-explicit-Save
// behavior (per field), and Add/remove/reorder editing for every registry —
// see libsettings@beatlink's README for the full schema this renders.
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
