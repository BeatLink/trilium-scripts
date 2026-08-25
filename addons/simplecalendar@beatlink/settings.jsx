import { useState, useEffect, LoadingSpinner } from "trilium:preact"
import { SettingsForm } from "libSettingsUI.jsx"

export default function SimpleCalendarSettings() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)

    useEffect(() => {
        (async () => {
            setSchemaNoteId(await api.currentNote.getRelationValue("schemaNote"))
            const target = await api.currentNote.getRelationTarget("configNote")
            setConfigNoteId(target.noteId)
        })()
    }, [])

    if (!schemaNoteId || !configNoteId) return <div><LoadingSpinner /> Loading...</div>

    return <SettingsForm schemaNoteId={schemaNoteId} configNoteId={configNoteId} />
}
