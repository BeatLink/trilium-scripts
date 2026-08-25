import { useState, useEffect, LoadingSpinner } from "trilium:preact"
import { SettingsForm } from "libSettingsUI.jsx"
import { activateNote } from "trilium:api"

export default function RssReaderSettings() {
    const [schemaNoteId, setSchemaNoteId] = useState(null)
    const [configNoteId, setConfigNoteId] = useState(null)
    const [managerNoteId, setManagerNoteId] = useState("")

    useEffect(() => {
        (async () => {
            setSchemaNoteId(await api.currentNote.getRelationValue("schemaNote"))
            const target = await api.currentNote.getRelationTarget("configNote")
            setConfigNoteId(target.noteId)
            setManagerNoteId(await api.currentNote.getRelationValue("managerPageNote") || "")
        })()
    }, [])

    if (!schemaNoteId || !configNoteId) return <div><LoadingSpinner /> Loading...</div>

    return (
        <div>
            <button class="rss-btn" disabled={!managerNoteId} onClick={() => activateNote(managerNoteId)}>
                Back
            </button>
            <SettingsForm schemaNoteId={schemaNoteId} configNoteId={configNoteId} />
        </div>
    )
}
