import { useState, useEffect } from "trilium:preact"
import { SettingsForm } from "libSettingsUI.jsx"

export default function RecurrenceSettings() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)

    useEffect(() => {
        (async () => {
            setSchemaNoteId(await api.currentNote.getRelationValue("schemaNote"))
            const target = await api.currentNote.getRelationTarget("AddonData:config")
            setConfigNoteId(target.noteId)
        })()
    }, [])

    if (!schemaNoteId || !configNoteId) return <div>Loading...</div>

    return (
        <div>
            <h3>Recurrence Settings</h3>
            <SettingsForm schemaNoteId={schemaNoteId} configNoteId={configNoteId} />
        </div>
    )
}
